const { app, BrowserWindow, ipcMain, Menu, screen: electronScreen } = require('electron')
const path = require('path')
const fs = require('fs')
const cookieManager = require('./cookieManager')
const { log } = require('./log')

let mainWindow = null

function getMainWindowStatePath() {
  return path.join(app.getPath('userData'), 'main-window-state.json')
}

function saveMainWindowState() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const bounds = mainWindow.getBounds()
    const data = {
      isMaximized: mainWindow.isMaximized(),
      bounds: mainWindow.isMaximized() ? null : bounds
    }
    fs.writeFileSync(getMainWindowStatePath(), JSON.stringify(data, null, 2))
  } catch (e) {
    log('Save main window state error:', e.message)
  }
}

function loadMainWindowState() {
  try {
    const filePath = getMainWindowStatePath()
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return data
    }
  } catch (e) {
    log('Load main window state error:', e.message)
  }
  return null
}

function isBoundsOnAnyScreen(bounds) {
  try {
    const displays = electronScreen.getAllDisplays()
    return displays.some(d => {
      const { x, y, width, height } = d.workArea
      return bounds.x < x + width && bounds.x + bounds.width > x &&
             bounds.y < y + height && bounds.y + bounds.height > y
    })
  } catch (e) {
    return false
  }
}

function createWindow(mainWindowRef) {
  Menu.setApplicationMenu(null)

  const savedState = loadMainWindowState()

  const iconPath = path.join(__dirname, '../../icon.ico')
  const options = {
    width: 1700,
    height: 1000,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    menuBarVisible: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      sandbox: false,
      partition: 'persist:main',
      backgroundThrottling: false
    }
  }
  if (fs.existsSync(iconPath)) {
    options.icon = iconPath
  }

  // 恢复上次的窗口位置和大小
  if (savedState && savedState.bounds && isBoundsOnAnyScreen(savedState.bounds)) {
    options.x = savedState.bounds.x
    options.y = savedState.bounds.y
    options.width = savedState.bounds.width
    options.height = savedState.bounds.height
  }

  mainWindow = new BrowserWindow(options)

  // 恢复最大化状态
  if (savedState && savedState.isMaximized) {
    mainWindow.maximize()
  }

  if (mainWindowRef) {
    mainWindowRef.mainWindow = mainWindow
  }

  mainWindow.loadFile('index.html')

  // 拦截视频CDN请求，添加必要的请求头
  const session = mainWindow.webContents.session
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url
    if (url.includes('bilivideo.com') ||
        url.includes('bilivideo.cn') ||
        url.includes('bilibili.com') ||
        url.includes('hdslb.com')) {
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      details.requestHeaders['Referer'] = 'https://www.bilibili.com/'
      details.requestHeaders['Origin'] = 'https://www.bilibili.com'
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  mainWindow.webContents.once('did-finish-load', async () => {
    await cookieManager.syncCookiesToSession(mainWindow.webContents.session)
    try {
      if (mainWindowRef && typeof mainWindowRef.onReady === 'function') {
        await mainWindowRef.onReady()
      }
    } catch (e) {
      log('Startup cookie import failed:', e.message)
    }
  })

  // 监听 session cookies 变化，导出并持久化到 cookie 文件
  try {
    const sess = mainWindow.webContents.session
    if (sess && sess.cookies && typeof sess.cookies.on === 'function') {
      sess.cookies.on('changed', async (event, cookie, cause, removed) => {
        try {
          await cookieManager.exportCookiesFromSession(sess)
          log('Session cookies exported on change:', cookie.name)
        } catch (e) {
          log('Export cookies error:', e.message)
        }
      })
    }
  } catch (e) {
    log('Failed to attach cookie change listener:', e.message)
  }

  mainWindow.on('close', () => {
    saveMainWindowState()
  })

  mainWindow.on('closed', () => {
    if (mainWindowRef && typeof mainWindowRef.stopVideo === 'function') {
      mainWindowRef.stopVideo()
    }
    mainWindow = null
  })

  // 移动/调整大小后实时保存状态（防抖）
  let saveStateTimer = null
  const scheduleSave = () => {
    clearTimeout(saveStateTimer)
    saveStateTimer = setTimeout(() => saveMainWindowState(), 1000)
  }
  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('maximize', scheduleSave)
  mainWindow.on('unmaximize', scheduleSave)
}

function registerWindowHandlers(deps) {
  const { ipcMain } = deps

  ipcMain.handle('minimize-window', () => {
    mainWindow.minimize()
    return { success: true }
  })

  ipcMain.handle('maximize-window', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
    return { success: true }
  })

  ipcMain.handle('close-window', () => {
    mainWindow.close()
    return { success: true }
  })

  ipcMain.handle('open-dev-tools', () => {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    return { success: true }
  })

  ipcMain.handle('reload-window', () => {
    mainWindow.webContents.reload()
    return { success: true }
  })

  ipcMain.handle('zoom-main-window', (event, delta) => {
    if (!mainWindow || mainWindow.isMaximized()) return

    const currentBounds = mainWindow.getBounds()
    const display = electronScreen.getDisplayMatching(currentBounds)
    const wa = display.workArea

    const scale = delta > 0 ? 1.1 : 1 / 1.1
    const minW = 800; const minH = 600
    const maxW = Math.floor(wa.width * 0.98)
    const maxH = Math.floor(wa.height * 0.96)

    let newWidth = Math.round(currentBounds.width * scale)
    let newHeight = Math.round(currentBounds.height * scale)

    if (newWidth < minW || newHeight < minH) {
      if (delta < 0) return // won't shrink below minimum
      newWidth = minW; newHeight = minH
    }
    if (newWidth > maxW) { newWidth = maxW; newHeight = Math.round(maxW * currentBounds.height / currentBounds.width) }
    if (newHeight > maxH) { newHeight = maxH; newWidth = Math.round(maxH * currentBounds.width / currentBounds.height) }

    // Center-anchored
    const cx = currentBounds.x + currentBounds.width / 2
    const cy = currentBounds.y + currentBounds.height / 2
    let newX = Math.round(cx - newWidth / 2)
    let newY = Math.round(cy - newHeight / 2)

    // Clamp to current display
    newX = Math.max(wa.x, Math.min(wa.x + wa.width - newWidth, newX))
    newY = Math.max(wa.y, Math.min(wa.y + wa.height - newHeight, newY))

    mainWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight }, true)
  })

  ipcMain.handle('move-main-window', (event, direction) => {
    if (!mainWindow || mainWindow.isMaximized()) return

    const step = 50
    const pos = mainWindow.getPosition()
    let x = pos[0]; let y = pos[1]
    switch (direction) {
      case 'up': y -= step; break
      case 'down': y += step; break
      case 'left': x -= step; break
      case 'right': x += step; break
    }

    const bounds = mainWindow.getBounds()
    const display = electronScreen.getDisplayMatching(bounds)
    const wa = display.workArea
    x = Math.max(wa.x, Math.min(wa.x + wa.width - bounds.width, x))
    y = Math.max(wa.y, Math.min(wa.y + wa.height - bounds.height, y))

    mainWindow.setPosition(x, y, false)
  })
}

module.exports = { createWindow, registerWindowHandlers }
