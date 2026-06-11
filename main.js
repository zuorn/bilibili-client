// 强制设置 UTF-8 编码
process.env.LANG = 'zh_CN.UTF-8'
process.stdout.write('[3J[H[2J')

const { app, BrowserWindow, ipcMain, screen, dialog, Menu, Tray } = require('electron')
const path = require('path')

// 优先设置日志模块（使用缓冲区机制，等 app 准备好后再写入文件）
const { log, setLogFile } = require('./src/main/log')

log('应用启动开始')

// 全局错误处理 —— 打包后无控制台，必须弹窗告知用户
process.on('uncaughtException', (error) => {
  try {
    log('未捕获的异常:', error)
    dialog.showErrorBox('应用启动失败', error.stack || error.message)
  } catch (_) {}
  app.quit()
})
process.on('unhandledRejection', (reason) => {
  try {
    log('未处理的 Promise 拒绝:', reason)
    dialog.showErrorBox('应用启动失败', reason?.stack || reason?.message || String(reason))
  } catch (_) {}
  app.quit()
})

// 绕过 Chromium GPU 黑名单，确保 WebGL 可用（Anime4K 依赖）
app.commandLine.appendSwitch('ignore-gpu-blacklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

const cookieManager = require('./src/main/cookieManager')

// API 核心模块
const api = require('./src/main/api')

// 窗口管理模块
const windowModule = require('./src/main/window')

// 播放器模块
const mpv = require('./src/main/player/mpv')
const { openBuiltinPlayer, registerBuiltinPlayerHandlers } = require('./src/main/player/builtin')

// IPC 处理器
const { registerFeedsHandlers } = require('./src/main/ipc/feeds')
const { registerBangumiHandlers } = require('./src/main/ipc/bangumi')
const { registerMediaHandlers } = require('./src/main/ipc/media')
const { registerUpHandlers } = require('./src/main/ipc/up')
const { registerUserHandlers } = require('./src/main/ipc/user')
const { registerHistoryHandlers, formatProgressTime, reportPlayHistory } = require('./src/main/ipc/history')
const { registerFavoritesHandlers } = require('./src/main/ipc/favorites')
const { registerDynamicsHandlers } = require('./src/main/ipc/dynamics')
const { registerLoginHandlers, tryImportCookiesOnStartup } = require('./src/main/ipc/login')
const { registerPlayerHandlers, getVideoInfo } = require('./src/main/ipc/player')
const { registerPageNavHandlers } = require('./src/main/page-nav')
const { registerUpdaterHandlers, checkForUpdates } = require('./src/main/updater')

// 弹幕工具
const { getDanmakuXml, getCidByBvid } = require('./src/utils/getDanmaku')
const xml2ass = require('./src/utils/xml2ass')

// ==================== 共享状态 ====================
const sharedState = {
  mainWindow: null,
  mpvProcess: null,
  mpvSocket: null,
  mpvSocketPath: null,
  currentVideoInfo: null,
  reportTimer: null,
  playerWindow: null,
  playerVideoAspect: 16/9,
  tray: null
}

// 初始化 MPV 模块（传入共享状态）
mpv.init({ state: sharedState, log })

// ==================== 注册所有 IPC 处理器 ====================
function registerAllHandlers() {
  const mw = sharedState.mainWindow

  // 窗口控制（使用 window.js 内部的 mainWindow 变量）
  windowModule.registerWindowHandlers({ ipcMain })

  // 通用 API 依赖
  const { fetchApi, fetchWithRetry, fetchApiWithHeaders, buildRecommendUrl } = api

  // 基础 API 处理器
  const { fetchWbiKeys, getMixKey, signParams, fetchApiPost } = api
  const apiDeps = { ipcMain, fetchApi, fetchApiPost, log, cookieManager, fetchWbiKeys, getMixKey, signParams }
  registerUpHandlers(apiDeps)
  registerUserHandlers(apiDeps)
  registerFavoritesHandlers(apiDeps)
  registerDynamicsHandlers(apiDeps)

  // 带更多依赖的处理器
  registerFeedsHandlers({ ipcMain, fetchWithRetry, buildRecommendUrl, fetchApi, log, fetchWbiKeys, getMixKey, signParams })
  registerBangumiHandlers({ ipcMain, fetchApiWithHeaders, fetchApi, buildRecommendUrl, log, cookieManager, mainWindow: mw, fetchWithRetry })
  registerMediaHandlers({ ipcMain, fetchApiWithHeaders, fetchApi, buildRecommendUrl, log, cookieManager, mainWindow: mw })
  registerHistoryHandlers({ ipcMain, fetchApi, log, cookieManager, state: sharedState })

  // 需要 mainWindow 引用的处理器
  registerLoginHandlers({ ipcMain, fetchApiWithHeaders, fetchApi, log, app, mainWindow: mw })
  registerPageNavHandlers({ ipcMain, log, mainWindow: mw })

  // 播放器相关处理器
  registerPlayerHandlers({
    ipcMain, log, fetchApi, fetchApiPost, app, screen, dialog,
    state: sharedState,
    getDanmakuXml, xml2ass, formatProgressTime, reportPlayHistory,
    openBuiltinPlayer,
    startReportTimer: mpv.startReportTimer,
    cleanupMpvSocket: mpv.cleanupMpvSocket,
    stopVideo: mpv.stopVideo,
    findMpvExecutable: mpv.findMpvExecutable,
    cookieManager,
    getVideoInfo,
    fetchWbiKeys,
    getMixKey,
    signParams,
    mainWindow: mw
  })
  registerBuiltinPlayerHandlers({ ipcMain, log, state: sharedState })

  // 自动更新
  registerUpdaterHandlers({ ipcMain, log, mainWindow: mw })

  // 获取应用版本号
  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })
}

// ==================== 创建系统托盘 ====================
function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico')
  sharedState.tray = new Tray(iconPath)
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (sharedState.mainWindow) {
          sharedState.mainWindow.show()
        }
      }
    },
    {
      type: 'separator'
    },
    {
      label: '退出应用',
      click: () => {
        mpv.stopVideo()
        app.quit()
      }
    }
  ])
  
  sharedState.tray.setContextMenu(contextMenu)
  sharedState.tray.setToolTip('Bilibili Client')

  // 点击托盘显示窗口
  sharedState.tray.on('click', () => {
    if (sharedState.mainWindow) {
      sharedState.mainWindow.show()
    }
  })
}

// ==================== 应用生命周期 ====================
app.whenReady().then(async () => {
  log('app.whenReady() 触发')
  const userDataPath = app.getPath('userData')
  
  // 调试时将日志文件放在项目根目录
  const logFilePath = path.join(__dirname, 'debug.log')
  
  // 明确记录日志文件位置
  console.log('日志文件位置:', logFilePath)
  log('日志文件位置:', logFilePath)
  
  setLogFile(logFilePath)
  cookieManager.loadCookies(path.join(userDataPath, 'cookies.json'))

  // 设置 onReady 回调（在窗口创建完成后执行 cookie 导入）
  sharedState.onReady = async () => {
    await tryImportCookiesOnStartup()
  }
  sharedState.stopVideo = () => mpv.stopVideo()

  // 创建主窗口
  windowModule.createWindow(sharedState)

  // 设置 API 模块的主窗口引用（用于 session cookie 访问）
  api.setMainWindow(sharedState.mainWindow)

  // 注册所有 IPC 处理器（窗口创建后注册，确保 mainWindow 引用有效）
  registerAllHandlers()

  // 创建系统托盘
  createTray()

  // 启动后自动检查更新（延迟 3 秒，等首页加载完成）
  setTimeout(() => checkForUpdates(), 3000)

  // 监听主窗口关闭事件，最小化到托盘
  sharedState.mainWindow.on('close', (event) => {
    event.preventDefault()
    sharedState.mainWindow.hide()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowModule.createWindow(sharedState)
      api.setMainWindow(sharedState.mainWindow)
    }
  })
}).catch((error) => {
  try {
    log('应用启动失败:', error)
    dialog.showErrorBox('应用启动失败', error.stack || error.message)
  } catch (_) {
    console.error('Startup error:', error)
  }
  app.quit()
})

// Q 键关闭窗口的快捷键已由渲染进程的 shortcuts.js 统一处理，
// 避免主进程全局监听与访问键 (access-keys) 等功能冲突

app.on('window-all-closed', () => {
  // 保持应用运行，等待用户从托盘退出
})

app.on('before-quit', () => {
  if (sharedState.tray) {
    sharedState.tray.destroy()
    sharedState.tray = null
  }
})
