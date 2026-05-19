// Built-in player window management
const path = require('path')
const fs = require('fs')
const cookieManager = require('../../../cookieManager')

async function openBuiltinPlayer(bvid, cid, title, dimension, progress, deps, episodeData = null) {
  const { log, app, formatProgressTime, reportPlayHistory, startReportTimer, cleanupMpvSocket, getVideoInfo, state } = deps
  const { BrowserWindow } = require('electron')

  log('Opening builtin player for:', bvid, title, 'dimension:', dimension, 'progress:', progress)

  if (state.playerWindow) {
    state.playerWindow.close()
    state.playerWindow = null
  }

  let finalCid = cid
  let videoDimension = dimension
  let videoAid = null
  let videoDuration = null

  if (!finalCid || !videoDimension) {
    try {
      const videoInfo = await getVideoInfo(bvid)
      if (videoInfo) {
        if (!finalCid && videoInfo.cid) {
          finalCid = videoInfo.cid
          log('Got cid from video info:', finalCid)
        }
        if (!videoDimension && videoInfo.dimension) {
          videoDimension = videoInfo.dimension
          log('Got dimension from video info:', videoDimension)
        }
        videoAid = videoInfo.aid
        videoDuration = videoInfo.duration
      }
    } catch (error) {
      log('Failed to get video info:', error.message)
    }
  }

  // 计算窗口大小 — 默认使用工作区 70% 高度，而非直接最大化
  let windowWidth = 1280
  let windowHeight = 720

  if (videoDimension && videoDimension.width && videoDimension.height) {
    let videoW = videoDimension.width
    let videoH = videoDimension.height

    if (videoDimension.rotate === 90 || videoDimension.rotate === 270) {
      const temp = videoW
      videoW = videoH
      videoH = temp
    }

    const screen = require('electron').screen
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea

    const videoAspect = videoW / videoH

    // 默认 70% 工作区高度，让最大化按钮有存在感
    const defaultHeight = Math.floor(workArea.height * 0.7)
    const defaultWidth = Math.floor(defaultHeight * videoAspect)

    if (defaultWidth > workArea.width * 0.85) {
      windowWidth = Math.floor(workArea.width * 0.85)
      windowHeight = Math.floor(windowWidth / videoAspect)
    } else {
      windowWidth = defaultWidth
      windowHeight = defaultHeight
    }

    windowWidth = Math.max(480, windowWidth)
    windowHeight = Math.max(270, windowHeight)

    log(`Calculated window size: ${windowWidth}x${windowHeight}, video: ${videoW}x${videoH}, aspect: ${videoAspect.toFixed(2)}`)
    state.playerVideoAspect = videoAspect
  }

  state.playerWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    frame: false,
    menuBarVisible: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      sandbox: false,
      partition: 'persist:main'
    }
  })

  const screen = require('electron').screen
  const primaryDisplay = screen.getPrimaryDisplay()
  const workArea = primaryDisplay.workArea
  const x = Math.floor((workArea.width - windowWidth) / 2)
  const y = Math.floor((workArea.height - windowHeight) / 2)
  state.playerWindow.setPosition(Math.max(0, x), Math.max(0, y))
  const session = state.playerWindow.webContents.session
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url
    if (url.includes('bilivideo.com') ||
        url.includes('bilivideo.cn') ||
        url.includes('bilibili.com') ||
        url.includes('mountaintoys.cn') ||
        url.includes('hdslb.com')) {
      log('Intercepting video request:', url.substring(0, 100))
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      details.requestHeaders['Referer'] = 'https://www.bilibili.com/'
      details.requestHeaders['Origin'] = 'https://www.bilibili.com'
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  state.playerWindow.loadFile('src/pages/player.html')

  // 复制主窗口的cookie到播放器窗口
  const copyCookies = async () => {
    try {
      const mainCookies = await deps.mainWindow.webContents.session.cookies.get({})
      log('Copying', mainCookies.length, 'cookies to player window')

      const playerSession = state.playerWindow.webContents.session
      for (const cookie of mainCookies) {
        try {
          await playerSession.cookies.set({
            url: `https://${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}`,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            expirationDate: cookie.expirationDate
          })
        } catch (e) {
          log('Failed to set cookie:', cookie.name, e.message)
        }
      }
    } catch (e) {
      log('Failed to copy cookies:', e.message)
    }
  }

  state.playerWindow.webContents.on('did-finish-load', async () => {
    await copyCookies()
    state.playerWindow.webContents.send('play-video-data', {
      bvid: bvid,
      cid: finalCid,
      title: title || '哔哩哔哩视频',
      cookies: cookieManager.getSavedCookies(),
      progress: progress,
      episodeData: episodeData
    })
  })

  // 设置当前播放视频信息用于历史上报
  state.currentVideoInfo = {
    bvid: bvid,
    aid: videoAid,
    cid: finalCid,
    duration: videoDuration,
    title: title,
    startTime: Date.now(),
    lastReportProgress: 0
  }

  // 立即上报一次播放历史（进度为10秒，作为初始记录）
  if (videoAid && finalCid) {
    log(`[初始上报] 开始播放视频, aid=${videoAid}, cid=${finalCid}, 初始进度=0:10`)
    reportPlayHistory(videoAid, finalCid, 10)
  }

  // 启动定时上报
  startReportTimer()

  state.playerWindow.on('closed', () => {
    log('[播放器窗口关闭]')
    // 上报最终播放进度
    if (state.currentVideoInfo && state.currentVideoInfo.aid && state.currentVideoInfo.cid) {
      const elapsedSeconds = Math.floor((Date.now() - state.currentVideoInfo.startTime) / 1000)
      const estimatedProgress = Math.min(elapsedSeconds, state.currentVideoInfo.duration || 300)
      const formattedProgress = formatProgressTime(estimatedProgress)
      log(`[播放器窗口关闭] 上报最终进度: ${formattedProgress} (${Math.floor(estimatedProgress)}秒)`)
      reportPlayHistory(state.currentVideoInfo.aid, state.currentVideoInfo.cid, estimatedProgress)
    }
    cleanupMpvSocket()
    state.playerWindow = null
  })

  return { success: true, hasDanmaku: false, playerOpened: true }
}

function registerBuiltinPlayerHandlers(deps) {
  const { ipcMain, log, state } = deps

  ipcMain.handle('minimize-player-window', async () => {
    if (state.playerWindow) {
      state.playerWindow.minimize()
    }
  })

  ipcMain.handle('maximize-player-window', async () => {
    if (state.playerWindow) {
      if (state.playerWindow.isMaximized()) {
        state.playerWindow.unmaximize()
      } else {
        state.playerWindow.maximize()
      }
    }
  })

  ipcMain.handle('open-player-dev-tools', async () => {
    if (state.playerWindow) {
      state.playerWindow.webContents.openDevTools()
    }
  })

  ipcMain.handle('get-window-position', async () => {
    if (state.playerWindow) {
      const pos = state.playerWindow.getPosition()
      return { x: pos[0], y: pos[1] }
    }
    return { x: 0, y: 0 }
  })

  ipcMain.handle('get-window-bounds', async () => {
    if (state.playerWindow) {
      const bounds = state.playerWindow.getBounds()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    }
    return null
  })

  ipcMain.on('move-window-bounds', (event, x, y, width, height) => {
    if (state.playerWindow) {
      state.playerWindow.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
      }, false)
    }
  })

  ipcMain.handle('set-window-position', async (event, x, y) => {
    if (state.playerWindow) {
      state.playerWindow.setPosition(x, y)
    }
  })

  ipcMain.handle('set-window-position-direct', async (event, x, y) => {
    if (state.playerWindow) {
      state.playerWindow.setPosition(Math.round(x), Math.round(y), false)
    }
  })

  ipcMain.handle('is-window-maximized', async () => {
    if (state.playerWindow) {
      return state.playerWindow.isMaximized()
    }
    return false
  })

  ipcMain.handle('zoom-player-window', async (event, delta) => {
    if (state.playerWindow) {
      if (state.playerWindow.isFullScreen()) {
        if (delta < 0) {
          state.playerWindow.setFullScreen(false)
        }
        return
      }

      const currentBounds = state.playerWindow.getBounds()
      const { screen } = require('electron')
      const primaryDisplay = screen.getPrimaryDisplay()
      const workArea = primaryDisplay.workArea

      const aspect = state.playerVideoAspect || 16 / 9
      const minWidth = 320
      const minHeight = Math.round(minWidth / aspect)
      const maxWidth = Math.floor(workArea.width * 0.98)
      const maxHeight = Math.floor(workArea.height * 0.96)

      // 已经接近最大 → 放大进入全屏
      const isNearMax = currentBounds.width >= maxWidth - 10 && currentBounds.height >= maxHeight - 10
      if (delta > 0 && isNearMax) {
        state.playerWindow.setFullScreen(true)
        return
      }

      // mpv-like zoom: ~1.1x per step, center-anchored
      const scale = delta > 0 ? 1.1 : 1 / 1.1

      let newWidth = Math.round(currentBounds.width * scale)
      let newHeight = Math.round(newWidth / aspect)

      if (newWidth < minWidth || newHeight < minHeight) {
        if (delta < 0) return
        newWidth = minWidth
        newHeight = minHeight
      }
      // Clamp by width first, derive height from clamped width (avoids position drift)
      if (newWidth > maxWidth) { newWidth = maxWidth; newHeight = Math.round(maxWidth / aspect) }
      if (newHeight > maxHeight) { newHeight = maxHeight; newWidth = Math.round(maxHeight * aspect) }

      // Anchor at window center (mpv behavior)
      const cx = currentBounds.x + currentBounds.width / 2
      const cy = currentBounds.y + currentBounds.height / 2
      let newX = Math.round(cx - newWidth / 2)
      let newY = Math.round(cy - newHeight / 2)

      // Keep on screen
      newX = Math.max(0, Math.min(workArea.width - newWidth, newX))
      newY = Math.max(0, Math.min(workArea.height - newHeight, newY))

      state.playerWindow.setBounds({
        x: newX, y: newY,
        width: newWidth, height: newHeight
      }, true)
    }
  })

  ipcMain.handle('toggle-fullscreen', async () => {
    if (state.playerWindow) {
      if (state.playerWindow.isFullScreen()) {
        state.playerWindow.setFullScreen(false)
      } else {
        state.playerWindow.setFullScreen(true)
      }
    }
  })

  ipcMain.handle('resize-player-window', async (event, width, height) => {
    if (state.playerWindow && width && height) {
      const { screen } = require('electron')
      const primaryDisplay = screen.getPrimaryDisplay()
      const workArea = primaryDisplay.workArea

      const maxWindowWidth = Math.floor(workArea.width * 0.9)
      const maxWindowHeight = Math.floor(workArea.height * 0.9)
      const minWindowWidth = 480
      const minWindowHeight = Math.max(270, Math.round(minWindowWidth / state.playerVideoAspect))

      const videoAspect = width / height

      let newWidth = Math.round(width)
      let newHeight = Math.round(height)

      if (newWidth > maxWindowWidth) {
        newWidth = maxWindowWidth
        newHeight = Math.round(maxWindowWidth / videoAspect)
      }

      if (newHeight > maxWindowHeight) {
        newHeight = maxWindowHeight
        newWidth = Math.round(maxWindowHeight * videoAspect)
      }

      newWidth = Math.max(minWindowWidth, newWidth)
      newHeight = Math.max(minWindowHeight, newHeight)

      const currentBounds = state.playerWindow.getBounds()
      const widthDelta = newWidth - currentBounds.width
      const heightDelta = newHeight - currentBounds.height

      state.playerWindow.setBounds({
        x: Math.max(0, Math.min(workArea.width - newWidth, currentBounds.x - widthDelta / 2)),
        y: Math.max(0, Math.min(workArea.height - newHeight, currentBounds.y - heightDelta / 2)),
        width: newWidth,
        height: newHeight
      }, true)

      log(`Resized player window to ${newWidth}x${newHeight}`)
      return { success: true, width: newWidth, height: newHeight }
    }
    return { success: false }
  })

  ipcMain.handle('set-window-position-smooth', async (event, x, y) => {
    if (state.playerWindow) {
      state.playerWindow.setPosition(Math.round(x), Math.round(y), false)
    }
  })

  ipcMain.handle('move-to-next-display', async () => {
    if (state.playerWindow) {
      const { screen } = require('electron')
      const displays = screen.getAllDisplays()

      if (displays.length <= 1) {
        return false
      }

      const currentBounds = state.playerWindow.getBounds()
      const currentDisplay = screen.getDisplayMatching(currentBounds)

      let nextDisplayIndex = displays.findIndex(d => d.id === currentDisplay.id) + 1
      if (nextDisplayIndex >= displays.length) {
        nextDisplayIndex = 0
      }

      const nextDisplay = displays[nextDisplayIndex]
      const newX = nextDisplay.workArea.x + (nextDisplay.workArea.width - currentBounds.width) / 2
      const newY = nextDisplay.workArea.y + (nextDisplay.workArea.height - currentBounds.height) / 2

      state.playerWindow.setBounds({
        x: Math.round(newX),
        y: Math.round(newY),
        width: currentBounds.width,
        height: currentBounds.height
      })

      return true
    }
    return false
  })

  ipcMain.handle('move-player-window', async (event, direction) => {
    if (state.playerWindow && !state.playerWindow.isFullScreen()) {
      const currentBounds = state.playerWindow.getBounds()
      const step = 50

      let newX = currentBounds.x
      let newY = currentBounds.y

      switch (direction) {
        case 'up':
          newY -= step
          break
        case 'down':
          newY += step
          break
        case 'left':
          newX -= step
          break
        case 'right':
          newX += step
          break
      }

      state.playerWindow.setPosition(newX, newY)
    }
  })
}

module.exports = { openBuiltinPlayer, registerBuiltinPlayerHandlers }
