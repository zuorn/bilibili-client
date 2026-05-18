// MPV player management module
// All state is managed internally, with access via shared deps.state object
const net = require('net')
const fs = require('fs')
const path = require('path')

// Internal module-level state
let state = null
let log = null
let cachedMpvPath = null

function init(deps) {
  state = deps.state
  log = deps.log
}

// 查找 mpv 可执行文件
function findMpvExecutable(userPath) {
  const cacheKey = userPath || 'default'
  if (cachedMpvPath && cachedMpvPath.key === cacheKey) {
    return cachedMpvPath.path
  }

  let result = null

  if (userPath && userPath.trim()) {
    const trimmed = userPath.trim()
    if (fs.existsSync(trimmed)) {
      result = trimmed
    }
  }

  if (!result && process.platform === 'win32') {
    const commonPaths = [
      'C:\\Program Files\\mpv\\mpv.exe',
      'C:\\Program Files\\mpvnet\\mpvnet.exe',
      'C:\\Program Files (x86)\\mpv\\mpv.exe',
      'C:\\Program Files (x86)\\mpvnet\\mpvnet.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs\\mpv\\mpv.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs\\mpvnet\\mpvnet.exe'),
      'mpv.exe',
      'mpvnet.exe'
    ]

    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        result = p
        break
      }
    }
  }

  if (!result) {
    result = 'mpv'
  }

  cachedMpvPath = { key: cacheKey, path: result }
  return result
}

// 连接 mpv IPC socket
function connectToMpvSocket() {
  if (!state.mpvSocketPath || state.mpvSocket) return

  try {
    state.mpvSocket = net.createConnection(state.mpvSocketPath, () => {
      log('已连接到 mpv socket')
    })

    state.mpvSocket.on('data', (data) => {
      handleMpvSocketData(data.toString())
    })

    state.mpvSocket.on('error', (err) => {
      log('MPV socket error:', err.message)
      state.mpvSocket = null
    })

    state.mpvSocket.on('close', () => {
      log('MPV socket closed')
      state.mpvSocket = null
    })
  } catch (error) {
    log('连接 mpv socket 失败:', error.message)
    setTimeout(() => connectToMpvSocket(), 2000)
  }
}

// 处理 mpv socket 数据
function handleMpvSocketData(data) {
  try {
    const lines = data.split('\n')
    for (const line of lines) {
      if (!line.trim() || !line.startsWith('{')) continue
      try {
        const msg = JSON.parse(line)
        if (msg.event === 'property-change' && msg.name === 'playback-time') {
          log('播放时间变化:', msg.data)
        }
      } catch (e) {}
    }
  } catch (error) {}
}

// 向 mpv socket 发送命令
function sendMpvCommand(...args) {
  if (!state.mpvSocket) return
  try {
    const cmd = JSON.stringify({ command: args }) + '\n'
    state.mpvSocket.write(cmd)
  } catch (error) {
    log('发送 mpv 命令失败:', error.message)
  }
}

// 获取 mpv 属性
function getMpvProperty(property) {
  sendMpvCommand('get_property', property)
}

// 获取当前播放进度
function getCurrentProgress() {
  sendMpvCommand('get_property', 'playback-time')
}

// 启动定时上报（空实现，关闭时统一上报）
function startReportTimer() {
  // 移除频繁上报，只在关闭时上报
}

// 停止定时上报
function stopReportTimer() {
  if (state.reportTimer) {
    clearInterval(state.reportTimer)
    state.reportTimer = null
  }
}

// 获取 mpv 播放时间
function getMpvPlaybackTime() {
  return new Promise((resolve) => {
    if (!state.mpvSocket) {
      resolve(null)
      return
    }

    let responseData = ''
    const timeout = setTimeout(() => {
      if (state.mpvSocket) {
        state.mpvSocket.removeListener('data', dataHandler)
      }
      resolve(null)
    }, 1000)

    const dataHandler = (data) => {
      responseData += data.toString()
      const lines = responseData.split('\n')
      for (const line of lines) {
        if (!line.trim() || !line.startsWith('{')) continue
        try {
          const msg = JSON.parse(line)
          if (msg.event === 'property-change' && msg.name === 'playback-time') {
            clearTimeout(timeout)
            if (state.mpvSocket) {
              state.mpvSocket.removeListener('data', dataHandler)
            }
            resolve(msg.data)
            return
          }
          if (msg.command && msg.command[0] === 'get_property' && msg.command[1] === 'playback-time') {
            clearTimeout(timeout)
            if (state.mpvSocket) {
              state.mpvSocket.removeListener('data', dataHandler)
            }
            resolve(msg.data)
            return
          }
        } catch (e) {}
      }
    }

    if (state.mpvSocket) {
      state.mpvSocket.on('data', dataHandler)
    }
    sendMpvCommand('get_property', 'playback-time')
  })
}

// 清理 mpv socket
function cleanupMpvSocket() {
  stopReportTimer()
  state.currentVideoInfo = null
  if (state.mpvSocket) {
    try {
      state.mpvSocket.destroy()
    } catch (e) {}
    state.mpvSocket = null
  }
  if (state.mpvSocketPath && fs.existsSync(state.mpvSocketPath)) {
    try {
      fs.unlinkSync(state.mpvSocketPath)
    } catch (e) {}
    state.mpvSocketPath = null
  }
}

// 停止视频播放
function stopVideo() {
  if (state.mpvProcess) {
    state.mpvProcess.kill()
    state.mpvProcess = null
  }
  cleanupMpvSocket()
}

module.exports = {
  init,
  findMpvExecutable,
  connectToMpvSocket,
  handleMpvSocketData,
  sendMpvCommand,
  getMpvProperty,
  getCurrentProgress,
  startReportTimer,
  stopReportTimer,
  getMpvPlaybackTime,
  cleanupMpvSocket,
  stopVideo
}
