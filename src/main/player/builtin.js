// Built-in player window management
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const ffmpegPath = require('ffmpeg-static')
const cookieManager = require('../cookieManager')

// 从 DASH 视频流中选出浏览器可播放的最佳流。
// Chromium 不支持 HEVC (codecid=12)，优先选 AVC (codecid=7)，其次 AV1 (codecid=13)，最后 HEVC。
function pickBestPlayableDashVideo(dashVideo) {
  const sorted = [...dashVideo].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
  const avc = sorted.filter(v => (v.codecid || v.codec_id) === 7)
  const av1 = sorted.filter(v => (v.codecid || v.codec_id) === 13)
  const hevc = sorted.filter(v => (v.codecid || v.codec_id) === 12)
  return avc[0] || av1[0] || hevc[0]
}

// 获取视频播放URL（并行尝试多个清晰度，取最优可用者）
async function fetchPlayUrl(bvid, cid, cookieString, log) {
  const qualities = [
    { qn: 80, name: '1080P' },
    { qn: 64, name: '720P' },
    { qn: 32, name: '480P' }
  ]

  // 并行请求所有清晰度，用第一个成功的
  const results = await Promise.allSettled(
    qualities.map(async (level) => {
      const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${level.qn}&fnval=16`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://www.bilibili.com/video/${bvid}`,
            'Cookie': cookieString
          },
          signal: controller.signal
        })
        clearTimeout(timeout)
        const data = await response.json()
        if (data.code === 0) return { qn: level.qn, name: level.name, data }
        return null
      } catch (err) {
        clearTimeout(timeout)
        return null
      }
    })
  )

  // 按清晰度从高到低取第一个成功的
  const sorted = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .sort((a, b) => b.qn - a.qn)

  for (const r of sorted) {
    const dash = r.data.dash
    if (dash && dash.video && dash.video.length > 0) {
      const bestVideo = pickBestPlayableDashVideo(dash.video)
      if (!bestVideo) continue
      const videoUrl = bestVideo.baseUrl || bestVideo.url || bestVideo.base_url
      let audioUrl = null
      if (dash.audio && dash.audio.length > 0) {
        dash.audio.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
        audioUrl = dash.audio[0].baseUrl || dash.audio[0].url || dash.audio[0].base_url
      }
      if (videoUrl) {
        const codecLabel = (bestVideo.codecid || bestVideo.codec_id) === 13 ? 'AV1' : ''
        log(`[播放器预加载] 获取到 ${r.name}${codecLabel ? ' ' + codecLabel : ''} (DASH)`)
        return { success: true, url: videoUrl, audioUrl: audioUrl, quality: r.name + ' (DASH)', isCombined: false }
      }
    }

    const durl = r.data.durl
    if (durl && durl.length > 0) {
      log(`[播放器预加载] 获取到 ${r.name} (durl)`)
      return { success: true, url: durl[0].url, quality: r.name + ' (durl)', isCombined: true }
    }
  }

  return null
}

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
  let firstVideoInfo = null

  if (!finalCid || !videoDimension) {
    try {
      firstVideoInfo = await getVideoInfo(bvid)
      if (firstVideoInfo) {
        if (!finalCid && firstVideoInfo.cid) {
          finalCid = firstVideoInfo.cid
          log('Got cid from video info:', finalCid)
        }
        if (!videoDimension && firstVideoInfo.dimension) {
          videoDimension = firstVideoInfo.dimension
          log('Got dimension from video info:', videoDimension)
        }
        videoAid = firstVideoInfo.aid
        videoDuration = firstVideoInfo.duration
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

  // Add CORS headers to video CDN responses (required for WebGL texImage2D)
  session.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url
    if (url.includes('bilivideo.com') || url.includes('bilivideo.cn') ||
        url.includes('mcdn.bilivideo.cn') || url.includes('hdslb.com')) {
      const headers = details.responseHeaders || {}
      headers['Access-Control-Allow-Origin'] = ['*']
      headers['Access-Control-Allow-Methods'] = ['GET, OPTIONS']
      headers['Access-Control-Allow-Credentials'] = ['true']
      callback({ responseHeaders: headers })
    } else {
      callback({ responseHeaders: details.responseHeaders })
    }
  })

  state.playerWindow.loadFile('src/pages/player.html')

  // Capture window reference locally to prevent stale closures from sending
  // data to the wrong window after rapid re-opens.
  const playerWindow = state.playerWindow

  playerWindow.on('enter-full-screen', () => {
    playerWindow.webContents.send('fullscreen-changed', true)
  })
  playerWindow.on('leave-full-screen', () => {
    playerWindow.webContents.send('fullscreen-changed', false)
  })

  // 立即启动预加载：与窗口加载并行获取视频URL和视频信息
  const cookieString = cookieManager.getCookieString()
  const preFetchPromise = (async () => {
    const targetCid = finalCid
    if (!targetCid) return null

    const videoInfoPromise = firstVideoInfo
      ? Promise.resolve(firstVideoInfo)
      : getVideoInfo(bvid).catch(() => null)

    const [videoInfoResult, playUrlResult] = await Promise.all([
      videoInfoPromise,
      fetchPlayUrl(bvid, targetCid, cookieString, log)
    ])

    return {
      videoInfo: videoInfoResult ? {
        aid: videoInfoResult.aid,
        cid: videoInfoResult.cid,
        duration: videoInfoResult.duration,
        title: videoInfoResult.title,
        dimension: videoInfoResult.dimension,
        owner: videoInfoResult.owner,
        stat: videoInfoResult.stat,
        desc: videoInfoResult.desc,
        pic: videoInfoResult.pic,
        pubdate: videoInfoResult.pubdate,
        bvid: videoInfoResult.bvid,
        ugc_season: videoInfoResult.ugc_season,
        related: videoInfoResult.related
      } : null,
      videoUrlResult: playUrlResult
    }
  })()

  // 复制主窗口的cookie到播放器窗口
  const copyCookies = async () => {
    try {
      const mainCookies = await deps.mainWindow.webContents.session.cookies.get({})
      log('Copying', mainCookies.length, 'cookies to player window')
      const playerSession = playerWindow.webContents.session
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

  // Send play-video-data when the page finishes loading.
  // Wait briefly (up to 500ms) for the prefetch to complete so we can
  // include its result directly. If it's not ready, the player page will
  // receive it via a follow-up 'prefetch-data' event.
  playerWindow.webContents.once('did-finish-load', async () => {
    let preFetchData = null
    try {
      preFetchData = await Promise.race([
        preFetchPromise,
        new Promise(r => setTimeout(() => r(null), 500))
      ])
    } catch (e) {
      log('[播放器预加载] 等待异常:', e.message)
    }

    const hasPrefetch = preFetchData && preFetchData.videoUrlResult

    playerWindow.webContents.send('play-video-data', {
      bvid: bvid,
      cid: finalCid,
      title: title || '哔哩哔哩视频',
      cookies: cookieManager.getSavedCookies(),
      progress: progress,
      episodeData: episodeData,
      preFetchVideoUrl: hasPrefetch ? preFetchData.videoUrlResult : null,
      preFetchVideoInfo: hasPrefetch ? preFetchData.videoInfo : null
    })

    if (hasPrefetch) {
      log('[播放器预加载] 数据已随 play-video-data 发送')
    }

    // Do slow operations in background
    copyCookies().catch(e => log('copyCookies error:', e.message))

    // If prefetch wasn't ready within the window, send when it completes
    if (!hasPrefetch) {
      try {
        const lateData = preFetchData || await preFetchPromise
        if (lateData && lateData.videoUrlResult && !playerWindow.isDestroyed()) {
          log('[播放器预加载] 数据补发至播放器')
          playerWindow.webContents.send('prefetch-data', {
            preFetchVideoUrl: lateData.videoUrlResult,
            preFetchVideoInfo: lateData.videoInfo || null
          })
        }
      } catch (e) {
        log('[播放器预加载] 补发异常:', e.message)
      }
    }
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

  playerWindow.on('closed', () => {
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
    if (state.playerWindow === playerWindow) {
      state.playerWindow = null
    }
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

  // 下载视频（获取最高画质，合并音视频）
  ipcMain.handle('download-video', async (event, bvid, cid, title) => {
    const { dialog } = require('electron')
    const os = require('os')

    const cookieString = cookieManager.getCookieString()
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': `https://www.bilibili.com/video/${bvid}`,
      'Origin': 'https://www.bilibili.com',
      'Cookie': cookieString
    }

    // 安全推送进度（播放窗口关闭后不再推送，但不影响下载继续）
    function sendProgress(data) {
      try {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('download-progress', data)
        }
      } catch (e) {}
    }

    // 获取播放URL（fnval=16 为 DASH，fnval=1 为 durl 合并流）
    async function getPlayUrl(qn, useDurl) {
      const fnval = useDurl ? 1 : 16
      const extra = useDurl ? '&fnver=0&fourk=0' : ''
      const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${qn}&fnval=${fnval}${extra}`
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 8000)
      try {
        const response = await fetch(url, { headers: reqHeaders, signal: controller.signal })
        clearTimeout(t)
        const data = await response.json()
        if (data.code === 0) return { qn, data, isDurl: !!useDurl }
        return null
      } catch (err) {
        clearTimeout(t)
        return null
      }
    }

    // 从响应中提取视频/音频URL
    function extractUrls(result) {
      if (!result) return null
      const dash = result.data.data?.dash
      if (dash && dash.video && dash.video.length > 0) {
        dash.video.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
        const videoUrl = dash.video[0].baseUrl || dash.video[0].url || dash.video[0].base_url
        let audioUrl = null
        if (dash.audio && dash.audio.length > 0) {
          dash.audio.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
          audioUrl = dash.audio[0].baseUrl || dash.audio[0].url || dash.audio[0].base_url
        }
        return { videoUrl, audioUrl, isDash: true }
      }
      const durl = result.data.data?.durl
      if (durl && durl.length > 0) {
        return { videoUrl: durl[0].url, audioUrl: null, isDash: false }
      }
      return null
    }

    // fetch 流式下载到文件
    async function downloadFile(url, filePath, stepLabel) {
      const dlHeaders = {
        'User-Agent': reqHeaders['User-Agent'],
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com'
      }

      const response = await fetch(url, { headers: dlHeaders })
      if (!response.ok) throw new Error('CDN 返回 ' + response.status)

      const total = parseInt(response.headers.get('content-length') || '0', 10)
      const reader = response.body.getReader()
      const file = fs.createWriteStream(filePath)

      let downloaded = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          downloaded += value.length
          file.write(value)
          if (total > 0) {
            sendProgress({
              step: stepLabel,
              percent: (downloaded / total) * 100
            })
          }
        }
      } finally {
        reader.releaseLock()
      }

      return new Promise((resolve, reject) => {
        file.end()
        file.on('finish', resolve)
        file.on('error', reject)
      })
    }

    try {
      // 1. 并行探测所有清晰度，找到最高可用者
      sendProgress({ step: '正在获取最高画质下载地址...' })

      const allQualities = [125, 120, 116, 112, 80, 74, 64, 32]
      const results = await Promise.allSettled(allQualities.map(qn => getPlayUrl(qn)))

      const successful = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value)
        .sort((a, b) => b.qn - a.qn)

      if (successful.length === 0) {
        return { success: false, error: '无法获取视频下载地址，请确认已登录' }
      }

      const bestQn = successful[0].qn
      const qnNames = { 125: 'HDR1080P60', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P' }
      const qualityLabel = qnNames[bestQn] || ('qn=' + bestQn)
      const hasDash = !!(successful[0].data.data?.dash?.video?.length)
      const qualityTitle = qualityLabel + (hasDash ? ' (DASH)' : ' (durl)')
      log('[下载] 最高可用画质:', qualityTitle)

      // 2. 显示保存对话框
      const safeTitle = (title || 'bilibili_video').replace(/[<>:"/\\|?*]/g, '_').substring(0, 100)
      const saveResult = await dialog.showSaveDialog(state.playerWindow || undefined, {
        title: '下载视频 — ' + qualityTitle,
        defaultPath: safeTitle + '.mp4',
        filters: [
          { name: 'MP4 视频', extensions: ['mp4'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, cancelled: true }
      }

      const savePath = saveResult.filePath

      // 3. 用户确认后，重新获取最新URL（避免CDN链接在对话框等待期间过期）
      sendProgress({ step: '正在获取最新下载链接...' })

      // 先尝试 DASH 最高画质
      const freshResult = await getPlayUrl(bestQn, false)
      const urls = extractUrls(freshResult)

      if (!urls) {
        return { success: false, error: '获取下载链接失败，请重试' }
      }

      log('[下载] 开始下载:', qualityTitle)

      // 下载函数：DASH 合并模式
      async function downloadDashMerge(videoUrl, audioUrl, label) {
        const tempDir = os.tmpdir()
        const videoTemp = path.join(tempDir, `bili_video_${Date.now()}.m4s`)
        const audioTemp = path.join(tempDir, `bili_audio_${Date.now()}.m4s`)

        try {
          sendProgress({ step: 'video', percent: 0 })
          await downloadFile(videoUrl, videoTemp, 'video')

          sendProgress({ step: 'audio', percent: 0 })
          await downloadFile(audioUrl, audioTemp, 'audio')

          sendProgress({ step: 'merge' })
          await new Promise((resolve, reject) => {
            const proc = spawn(ffmpegPath, [
              '-y', '-i', videoTemp, '-i', audioTemp,
              '-c', 'copy', '-movflags', '+faststart', savePath
            ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 300000 })
            proc.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code)))
            proc.on('error', reject)
          })
          log('[下载] DASH 合并完成:', savePath)
          return { success: true, fileName: path.basename(savePath), quality: label }
        } finally {
          try { fs.unlinkSync(videoTemp) } catch (e) {}
          try { fs.unlinkSync(audioTemp) } catch (e) {}
        }
      }

      // 4. 下载：DASH（需合并）或 durl（已合并）
      if (urls.isDash && urls.audioUrl) {
        // DASH 模式：尝试 ffmpeg 合并，失败则回退到 durl
        try {
          return await downloadDashMerge(urls.videoUrl, urls.audioUrl, qualityTitle)
        } catch (mergeErr) {
          log('[下载] ffmpeg 不可用，回退到 durl 合并流:', mergeErr.message)

          // 删除可能的不完整文件
          try { fs.unlinkSync(savePath) } catch (e) {}

          // 回退: durl 格式（内置音视频合并），尝试 720P → 480P → 360P
          const durlQualities = [64, 32, 16]
          for (const dqn of durlQualities) {
            sendProgress({ step: '正在获取合并流 ' + (qnNames[dqn] || dqn) + '...' })
            const durlResult = await getPlayUrl(dqn, true)
            const durlUrls = extractUrls(durlResult)
            if (durlUrls && durlUrls.videoUrl && !durlUrls.isDash) {
              sendProgress({ step: 'video', percent: 0 })
              await downloadFile(durlUrls.videoUrl, savePath, 'video')
              const durlLabel = (qnNames[dqn] || ('qn=' + dqn)) + ' (durl)'
              log('[下载] durl 下载完成:', savePath)
              return { success: true, fileName: path.basename(savePath), quality: durlLabel }
            }
          }

          // durl 也失败，最后回退：保存 DASH 纯视频
          log('[下载] durl 也失败，保存纯视频')
          sendProgress({ step: 'video', percent: 0 })
          await downloadFile(urls.videoUrl, savePath, 'video')
          return { success: true, fileName: path.basename(savePath), quality: qualityTitle + ' (无音频)' }
        }
      } else {
        // 非 DASH 或没有独立音频：直接下载
        sendProgress({ step: 'video', percent: 0 })
        await downloadFile(urls.videoUrl, savePath, 'video')
        log('[下载] 下载完成:', savePath)
        return { success: true, fileName: path.basename(savePath), quality: qualityTitle }
      }
    } catch (error) {
      log('[下载] 错误:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { openBuiltinPlayer, registerBuiltinPlayerHandlers }
