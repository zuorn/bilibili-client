const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const cookieManager = require('../../cookieManager')
const { log } = require('./log')

let mainWindow = null

function createWindow(mainWindowRef) {
  Menu.setApplicationMenu(null)

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
      partition: 'persist:main'
    }
  }
  if (fs.existsSync(iconPath)) {
    options.icon = iconPath
  }

  mainWindow = new BrowserWindow(options)

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

  mainWindow.on('closed', () => {
    if (mainWindowRef && typeof mainWindowRef.stopVideo === 'function') {
      mainWindowRef.stopVideo()
    }
    mainWindow = null
  })
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
}

module.exports = { createWindow, registerWindowHandlers }
