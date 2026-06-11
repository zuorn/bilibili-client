// 自动更新模块（主进程）
const { autoUpdater } = require('electron-updater')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

let _mainWindow = null
let _log = null
let _updateDownloaded = false
let _config = null
let _checking = false

function loadConfig() {
  if (_config) return _config
  const configPath = path.join(__dirname, '..', 'config', 'update.yml')
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    _config = yaml.load(raw)
    _log && _log('[更新] 配置加载成功, 渠道:', _config.source)
  } catch (err) {
    _log && _log('[更新] 配置加载失败:', err.message)
    _config = { source: 'disabled' }
  }
  return _config
}

function setFeedURL() {
  const config = loadConfig()

  if (config.source === 'github') {
    const { owner, repo } = config.github || {}
    if (!owner || !repo) {
      _log('[更新] GitHub owner/repo 未配置')
      return false
    }
    autoUpdater.setFeedURL({ provider: 'github', owner, repo })
    _log('[更新] 使用 GitHub Releases:', `${owner}/${repo}`)
  } else if (config.source === 'generic') {
    const { url, channel } = config.generic || {}
    if (!url) {
      _log('[更新] Generic URL 未配置，跳过')
      return false
    }
    const feedUrl = channel ? url.replace(/\/$/, '') + '/' + channel : url
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
    _log('[更新] 使用 Generic HTTP:', feedUrl)
  } else {
    _log('[更新] 已禁用')
    return false
  }
  return true
}

function sendToRenderer(channel, data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(channel, data)
  }
}

function setupUpdater() {
  if (!setFeedURL()) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    _log('[更新] 正在检查...')
    sendToRenderer('update-status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    _log('[更新] 发现新版本:', info.version)
    sendToRenderer('update-status', {
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
    _checking = false
  })

  autoUpdater.on('update-not-available', () => {
    _log('[更新] 已是最新版本')
    sendToRenderer('update-status', { status: 'up-to-date' })
    _checking = false
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-status', {
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', () => {
    _updateDownloaded = true
    _log('[更新] 下载完成，等待安装')
    sendToRenderer('update-status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    _log('[更新] 错误:', err.message)
    sendToRenderer('update-status', { status: 'error', message: err.message })
    _checking = false
  })
}

function checkForUpdates() {
  const config = loadConfig()
  if (config.source === 'disabled') return
  if (!_log) return
  if (_checking) return

  _checking = true
  _log('[更新] 启动检查...')
  autoUpdater.checkForUpdates().catch(err => {
    _log('[更新] 检查失败:', err.message)
    _checking = false
  })
}

function registerUpdaterHandlers(deps) {
  const { ipcMain, log, mainWindow } = deps
  _mainWindow = mainWindow
  _log = log

  loadConfig()
  setupUpdater()

  ipcMain.handle('check-for-update', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, version: result?.updateInfo?.version }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('install-update', async () => {
    if (_updateDownloaded) {
      autoUpdater.quitAndInstall()
      return { success: true }
    }
    return { success: false, error: '更新未下载' }
  })
}

module.exports = { registerUpdaterHandlers, checkForUpdates }
