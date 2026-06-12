const { autoUpdater } = require('electron-updater')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

let _mainWindow = null
let _log = null
let _updateDownloaded = false
let _config = null
let _checking = false
let _bestUpdateInfo = null
let _currentFeedURL = null

function loadConfig() {
  if (_config) return _config
  const configPath = path.join(__dirname, '..', 'config', 'update.yml')
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    _config = yaml.load(raw)
    _log && _log('[更新] 配置加载成功')
  } catch (err) {
    _log && _log('[更新] 配置加载失败:', err.message)
    _config = {}
  }
  return _config
}

function sendToRenderer(channel, data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(channel, data)
  }
}

function compareVersions(v1, v2) {
  const parts1 = v1.replace(/^v/i, '').split('.').map(Number)
  const parts2 = v2.replace(/^v/i, '').split('.').map(Number)
  const length = Math.max(parts1.length, parts2.length)
  
  for (let i = 0; i < length; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  return 0
}

function getCurrentVersion() {
  try {
    const pkgPath = path.join(__dirname, '../../package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return pkg.version || '0.0.0'
  } catch (err) {
    return '0.0.0'
  }
}

async function checkFeedURL(provider, config) {
  return new Promise((resolve) => {
    const backupFeedURL = _currentFeedURL
    
    try {
      if (provider === 'generic') {
        const { url, channel } = config || {}
        if (!url) {
          _log && _log('[更新] Generic URL 未配置，跳过')
          resolve(null)
          return
        }
        const feedUrl = channel ? url.replace(/\/$/, '') + '/' + channel : url
        autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
        _currentFeedURL = feedUrl
        _log && _log('[更新] 检查 Generic 渠道:', feedUrl)
      } else if (provider === 'github') {
        const { owner, repo } = config || {}
        if (!owner || !repo) {
          _log && _log('[更新] GitHub owner/repo 未配置，跳过')
          resolve(null)
          return
        }
        autoUpdater.setFeedURL({ provider: 'github', owner, repo })
        _currentFeedURL = `${owner}/${repo}`
        _log && _log('[更新] 检查 GitHub 渠道:', `${owner}/${repo}`)
      } else {
        resolve(null)
        return
      }

      autoUpdater.checkForUpdates().then((result) => {
        if (result && result.updateInfo) {
          resolve({
            provider,
            version: result.updateInfo.version,
            releaseDate: result.updateInfo.releaseDate,
            releaseNotes: result.updateInfo.releaseNotes
          })
        } else {
          resolve(null)
        }
      }).catch((err) => {
        _log && _log(`[更新] ${provider} 渠道检查失败:`, err.message)
        resolve(null)
      })
    } catch (err) {
      _log && _log(`[更新] ${provider} 渠道检查异常:`, err.message)
      resolve(null)
    }
  })
}

function setupUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

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
    _log && _log('[更新] 下载完成，等待安装')
    sendToRenderer('update-status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    _log && _log('[更新] 错误:', err.message)
    sendToRenderer('update-status', { status: 'error', message: err.message })
    _checking = false
  })

  autoUpdater.on('install-progress', (progress) => {
    _log && _log('[更新] 安装进度:', progress.percent + '%')
    sendToRenderer('update-status', {
      status: 'installing',
      percent: progress.percent,
      message: '正在安装...',
      detail: `已完成 ${progress.percent.toFixed(0)}%`
    })
  })
}

async function checkForUpdates() {
  const config = loadConfig()
  if (!_log) return
  if (_checking) return

  _checking = true
  _bestUpdateInfo = null
  _log && _log('[更新] 开始多渠道检查...')
  sendToRenderer('update-status', { status: 'checking' })

  const currentVersion = getCurrentVersion()
  _log && _log('[更新] 当前版本:', currentVersion)

  const updateInfos = []

  if (config.generic && config.generic.url) {
    const genericResult = await checkFeedURL('generic', config.generic)
    if (genericResult) {
      updateInfos.push(genericResult)
    }
  }

  if (config.github && config.github.owner && config.github.repo) {
    const githubResult = await checkFeedURL('github', config.github)
    if (githubResult) {
      updateInfos.push(githubResult)
    }
  }

  if (updateInfos.length === 0) {
    _log && _log('[更新] 所有渠道检查失败或未配置')
    sendToRenderer('update-status', { status: 'up-to-date' })
    _checking = false
    return
  }

  let bestUpdate = null
  for (const info of updateInfos) {
    _log && _log(`[更新] 渠道 ${info.provider} 版本: ${info.version}`)
    const compare = compareVersions(info.version, currentVersion)
    if (compare > 0) {
      if (!bestUpdate || compareVersions(info.version, bestUpdate.version) > 0) {
        bestUpdate = info
      }
    }
  }

  if (bestUpdate) {
    _log && _log(`[更新] 发现新版本: ${bestUpdate.version} (来自 ${bestUpdate.provider})`)
    _bestUpdateInfo = bestUpdate
    sendToRenderer('update-status', {
      status: 'available',
      version: bestUpdate.version,
      releaseDate: bestUpdate.releaseDate,
      releaseNotes: bestUpdate.releaseNotes
    })
  } else {
    _log && _log('[更新] 已是最新版本')
    sendToRenderer('update-status', { status: 'up-to-date' })
  }

  _checking = false
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
      sendToRenderer('update-status', {
        status: 'installing',
        percent: 0,
        message: '准备安装...',
        detail: '正在准备安装文件...'
      })

      setTimeout(() => {
        sendToRenderer('update-status', {
          status: 'installing',
          percent: 10,
          message: '正在安装...',
          detail: '正在提取文件...'
        })
      }, 500)

      setTimeout(() => {
        sendToRenderer('update-status', {
          status: 'installing',
          percent: 30,
          message: '正在安装...',
          detail: '正在复制文件...'
        })
      }, 1000)

      setTimeout(() => {
        sendToRenderer('update-status', {
          status: 'installing',
          percent: 60,
          message: '正在安装...',
          detail: '正在更新组件...'
        })
      }, 1500)

      setTimeout(() => {
        sendToRenderer('update-status', {
          status: 'installing',
          percent: 80,
          message: '正在安装...',
          detail: '正在配置应用...'
        })
      }, 2000)

      setTimeout(() => {
        sendToRenderer('update-status', {
          status: 'installing',
          percent: 95,
          message: '正在安装...',
          detail: '正在完成安装...'
        })
      }, 2500)

      setTimeout(() => {
        sendToRenderer('update-status', { status: 'update-complete' })
        setTimeout(() => {
          autoUpdater.quitAndInstall(true, true)
        }, 500)
      }, 3000)

      return { success: true }
    }
    return { success: false, error: '更新未下载' }
  })
}

module.exports = { registerUpdaterHandlers, checkForUpdates }