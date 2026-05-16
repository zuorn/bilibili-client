// 强制设置 UTF-8 编码
process.env.LANG = 'zh_CN.UTF-8'
process.stdout.write('\u001b[3J\u001b[H\u001b[2J')

const { app, BrowserWindow, ipcMain, Menu, session, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const https = require('https')
const crypto = require('crypto')
const zlib = require('zlib')
const { URL } = require('url')
const net = require('net')
const chalk = require('chalk').default || require('chalk')
chalk.level = 3
const { getDanmakuXml, getCidByBvid } = require('./src/utils/getDanmaku')
const xml2ass = require('./src/utils/xml2ass')
const cookieManager = require('./cookieManager')

let mainWindow
let mpvProcess = null
let loginPollInterval = null
let mpvSocket = null
let mpvSocketPath = null
let currentVideoInfo = null
let reportTimer = null
let cachedMpvPath = null
let cachedCookieString = null
let playerWindow = null
let playerVideoAspect = 16/9

let logFile = ''

function log(...args) {
  const timestamp = chalk.gray(new Date().toISOString())
  let message = ''
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (typeof arg === 'object') {
      message += ' ' + chalk.yellow(JSON.stringify(arg))
    } else if (typeof arg === 'number') {
      message += ' ' + chalk.cyan(arg.toString())
    } else if (arg === 'error' || arg === 'Error' || arg?.toString?.().includes('Error')) {
      message += ' ' + chalk.red(arg)
    } else if (arg?.toString?.().includes('成功') || arg?.toString?.().includes('success') || arg?.toString?.().includes('Success')) {
      message += ' ' + chalk.green(arg)
    } else if (arg?.toString?.().includes('失败') || arg?.toString?.().includes('failed') || arg?.toString?.().includes('Failed')) {
      message += ' ' + chalk.red(arg)
    } else if (typeof arg === 'string') {
      if (arg.startsWith('[') && arg.endsWith(']')) {
        message += ' ' + chalk.blue(arg)
      } else {
        message += ' ' + chalk.white(arg)
      }
    } else {
      message += ' ' + chalk.white(arg?.toString?.() || '')
    }
  }
  
  // 使用 process.stdout.write 确保 UTF-8 输出
  process.stdout.write((timestamp + message + '\n').replace(/\u001b\[0m/g, ''))
  
  if (!app.isPackaged && logFile) {
    const plainMsg = new Date().toISOString() + ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')
    fs.appendFileSync(logFile, plainMsg + '\n', { encoding: 'utf8' })
  }
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

// 获取视频信息（aid, cid）
async function getVideoInfo(bvid) {
  try {
    const result = await fetchApi(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
    if (result && result.code === 0 && result.data) {
      return {
        aid: result.data.aid,
        cid: result.data.cid,
        duration: result.data.duration,
        title: result.data.title,
        dimension: result.data.dimension || null
      }
    }
  } catch (error) {
    log('获取视频信息失败:', error)
  }
  return null
}

// 格式化时间为 MM:SS 或 HH:MM:SS
function formatProgressTime(seconds) {
  const secs = Math.floor(seconds)
  const hours = Math.floor(secs / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${mins}:${s.toString().padStart(2, '0')}`
}

// 上报播放历史
async function reportPlayHistory(aid, cid, progress) {
  const savedCookies = cookieManager.getSavedCookies()
  if (!savedCookies.SESSDATA || !savedCookies.bili_jct) {
    log('缺少 SESSDATA 或 bili_jct，无法上报播放历史')
    return false
  }

  const formattedProgress = formatProgressTime(progress)
  log(`[历史上报] aid=${aid}, cid=${cid}, 进度=${formattedProgress} (${Math.floor(progress)}秒)`)

  return new Promise((resolve) => {
    const data = `aid=${aid}&cid=${cid}&progress=${Math.floor(progress)}&platform=pc&csrf=${savedCookies.bili_jct}`
    const options = {
      hostname: 'api.bilibili.com',
      port: 443,
      path: '/x/v2/history/report',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieManager.getCookieString(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      rejectUnauthorized: false
    }

    const req = https.request(options, (res) => {
      let responseData = ''
      res.on('data', (chunk) => {
        responseData += chunk
      })
      res.on('end', () => {
        try {
          const result = JSON.parse(responseData)
          log(`[历史上报] 结果: code=${result.code}, 进度=${formattedProgress}`)
          resolve(result.code === 0)
        } catch (e) {
          log('解析上报响应失败:', e)
          resolve(false)
        }
      })
    })

    req.on('error', (error) => {
      log('上报播放历史失败:', error)
      resolve(false)
    })

    req.write(data)
    req.end()
  })
}

// 连接 mpv IPC socket
function connectToMpvSocket() {
  if (!mpvSocketPath || mpvSocket) return

  try {
    mpvSocket = net.createConnection(mpvSocketPath, () => {
      log('已连接到 mpv socket')
    })

    mpvSocket.on('data', (data) => {
      handleMpvSocketData(data.toString())
    })

    mpvSocket.on('error', (err) => {
      log('MPV socket error:', err.message)
      mpvSocket = null
    })

    mpvSocket.on('close', () => {
      log('MPV socket closed')
      mpvSocket = null
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
  if (!mpvSocket) return
  try {
    const cmd = JSON.stringify({ command: args }) + '\n'
    mpvSocket.write(cmd)
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
  if (reportTimer) {
    clearInterval(reportTimer)
    reportTimer = null
  }
}

// 获取 mpv 播放时间
function getMpvPlaybackTime() {
  return new Promise((resolve) => {
    if (!mpvSocket) {
      resolve(null)
      return
    }

    let responseData = ''
    const timeout = setTimeout(() => {
      mpvSocket.removeListener('data', dataHandler)
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
            mpvSocket.removeListener('data', dataHandler)
            resolve(msg.data)
            return
          }
          if (msg.command && msg.command[0] === 'get_property' && msg.command[1] === 'playback-time') {
            clearTimeout(timeout)
            mpvSocket.removeListener('data', dataHandler)
            resolve(msg.data)
            return
          }
        } catch (e) {}
      }
    }

    mpvSocket.on('data', dataHandler)
    sendMpvCommand('get_property', 'playback-time')
  })
}

// 清理 mpv socket
function cleanupMpvSocket() {
  stopReportTimer()
  currentVideoInfo = null
  if (mpvSocket) {
    try {
      mpvSocket.destroy()
    } catch (e) {}
    mpvSocket = null
  }
  if (mpvSocketPath && fs.existsSync(mpvSocketPath)) {
    try {
      fs.unlinkSync(mpvSocketPath)
    } catch (e) {}
    mpvSocketPath = null
  }
}

Menu.setApplicationMenu(null)

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.ico')
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

  mainWindow.loadFile('index.html')

  mainWindow.webContents.once('did-finish-load', async () => {
    await cookieManager.syncCookiesToSession(mainWindow.webContents.session)
    try {
      // 启动时尝试从 userData/import_cookie_string.txt 或系统剪贴板导入 cookie
      if (typeof tryImportCookiesOnStartup === 'function') {
        await tryImportCookiesOnStartup()
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
    stopVideo()
    mainWindow = null
  })
}

function stopVideo() {
  if (mpvProcess) {
    mpvProcess.kill()
    mpvProcess = null
  }
  cleanupMpvSocket()
}

function fetchApi(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    log('Fetching URL:', url)
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/client',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Origin': 'https://www.bilibili.com',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'TE': 'Trailers'
    }
    
    const savedCookies = cookieManager.getSavedCookies()
    if (Object.keys(savedCookies).length > 0) {
      headers['Cookie'] = cookieManager.getCookieString()
      log('Adding cookies:', Object.keys(savedCookies))
      if (savedCookies['SESSDATA']) {
        const sessdataParts = savedCookies['SESSDATA'].split(',')
        log('SESSDATA expire timestamp:', sessdataParts[1] || 'N/A')
        log('SESSDATA first 20 chars:', savedCookies['SESSDATA'].substring(0, 20))
      }
    }
    
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers,
      rejectUnauthorized: false
    }

    const req = https.request(options, (res) => {
      log('Response Status:', res.statusCode)
      
      // 解析 Set-Cookie 响应头
      if (res.headers['set-cookie']) {
        cookieManager.parseSetCookieHeaders(res.headers['set-cookie'])
      }
      
      let data = ''
      const encoding = res.headers['content-encoding']
      
      if (encoding === 'gzip' || encoding === 'br') {
        const zlib = require('zlib')
        let decompressor
        
        if (encoding === 'br') {
          decompressor = zlib.createBrotliDecompress()
        } else {
          decompressor = zlib.createGunzip()
        }
        
        const chunks = []
        res.pipe(decompressor)
        decompressor.on('data', (chunk) => { chunks.push(chunk) })
        decompressor.on('end', () => {
          let dataStr = ''
          try {
            const buffer = Buffer.concat(chunks)
            dataStr = buffer.toString('utf8')
            const parsed = JSON.parse(dataStr)
            log('Response code:', parsed.code)
            resolve(parsed)
          } catch (e) {
            log('Parse error, raw response:', dataStr.substring(0, 200))
            reject(e)
          }
        })
        decompressor.on('error', (err) => {
          log('Decompression error:', err.message)
          reject(err)
        })
      } else {
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            log('Response code:', parsed.code)
            resolve(parsed)
          } catch (e) {
            log('Parse error, raw response:', data.substring(0, 200))
            reject(e)
          }
        })
      }
    })

    req.on('error', (err) => {
      log('Request error:', err.message)
      reject(err)
    })
    req.setTimeout(15000, () => {
      log('Request timeout')
      req.destroy()
      reject(new Error('请求超时'))
    })
    req.end()
  })
}

function fetchBilibiliApi(page = 1) {
  return fetchApi(`https://api.bilibili.com/x/web-interface/ranking/v2?type=all&ps=20&pn=${page}`)
}

function searchBilibili(keyword, page = 1) {
  return fetchApi(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}`)
}

function fetchUpInfo(mid) {
  return fetchApi(`https://api.bilibili.com/x/web-interface/card?mid=${mid}&photo=true`)
}

function fetchUpVideos(mid, offset = '') {
  let url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}&type=video`
  if (offset) {
    url += `&offset=${offset}`
  }
  return fetchApi(url)
}

ipcMain.handle('test-ipc', async () => {
  console.log('Test IPC called')
  return { success: true, message: 'IPC works!', data: [1, 2, 3] }
})

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const data = await fetchApi(url)
      if (data.code === 0) {
        return { success: true, data }
      }
      if (data.code === -352 && i < retries - 1) {
        log(`API返回-352，第${i + 1}次重试...`)
        await new Promise(r => setTimeout(r, delay * (i + 1)))
        continue
      }
      return { success: true, data }
    } catch (error) {
      if (i === retries - 1) throw error
      log(`请求失败，第${i + 1}次重试...`)
      await new Promise(r => setTimeout(r, delay * (i + 1)))
    }
  }
  throw new Error('重试次数用尽')
}

// 追番接口测试

async function fetchApiWithHeaders(url, customHeaders = {}) {
  return new Promise(async (resolve, reject) => {
    const urlObj = new URL(url)
    log('Fetching URL with custom headers:', url)
    
    const headers = {
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/client',
      ...customHeaders
    }

    // 优先直接使用 session 中的 cookies 来构建 Cookie 头，避免依赖可能被污染的 savedCookies
    try {
      if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
        const sessionCookies = await mainWindow.webContents.session.cookies.get({ domain: '.bilibili.com' })
        if (sessionCookies && sessionCookies.length > 0) {
          const cookiePairs = sessionCookies
            .filter(c => c && c.name && c.value)
            .map(c => {
              const v = c.name === 'SESSDATA' ? encodeURIComponent(cookieManager.safeDecode(c.value)) : c.value
              return `${c.name}=${v}`
            })
          const cookieString = cookiePairs.join('; ')
          headers['Cookie'] = cookieString
          log('使用 session cookies 构建 Cookie:', cookieString.substring(0, 100) + '...')
        }
      }
    } catch (e) {
      log('从 session 构建 Cookie 失败，回退到 savedCookies:', e.message)
      const savedCookies = cookieManager.getSavedCookies()
      if (Object.keys(savedCookies).length > 0) {
        const cookieString = cookieManager.getCookieString()
        headers['Cookie'] = cookieString
        log('实际发送的Cookie (fallback):', cookieString.substring(0, 100) + '...')
      }
    }

    log('实际发送的完整请求头:', JSON.stringify(headers))

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers,
      rejectUnauthorized: false
    }

    const req = https.request(options, (res) => {
      log('Response Status:', res.statusCode)
      
      // 解析 Set-Cookie 响应头
      if (res.headers['set-cookie']) {
        cookieManager.parseSetCookieHeaders(res.headers['set-cookie'])
      }
      
      let data = ''
      const encoding = res.headers['content-encoding']
      
      if (encoding === 'gzip' || encoding === 'br') {
        const zlib = require('zlib')
        let decompressor
        
        if (encoding === 'br') {
          decompressor = zlib.createBrotliDecompress()
        } else {
          decompressor = zlib.createGunzip()
        }
        
        const chunks = []
        res.pipe(decompressor)
        decompressor.on('data', (chunk) => { chunks.push(chunk) })
        decompressor.on('end', () => {
          let dataStr = ''
          try {
            const buffer = Buffer.concat(chunks)
            dataStr = buffer.toString('utf8')
            const parsed = JSON.parse(dataStr)
            log('Response code:', parsed.code)
            resolve(parsed)
          } catch (e) {
            log('Parse error, raw response:', dataStr.substring(0, 200))
            reject(e)
          }
        })
        decompressor.on('error', (err) => {
          log('Decompression error:', err.message)
          reject(err)
        })
      } else {
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            log('Response code:', parsed.code)
            resolve(parsed)
          } catch (e) {
            log('Parse error, raw response:', data.substring(0, 200))
            reject(e)
          }
        })
      }
    })

    req.on('error', (err) => {
      log('Request error:', err.message)
      reject(err)
    })
    req.setTimeout(15000, () => {
      log('Request timeout')
      req.destroy()
      reject(new Error('请求超时'))
    })
    req.end()
  })
}

const API_ENDPOINTS = [
  'https://api.bilibili.com/x/web-interface/ranking/v2?type=all&ps=20&pn=',
  'https://api.bilibili.com/x/web-interface/ranking?rid=0&ps=20&pn=',
  'https://app.bilibili.com/x/v2/search/trending/ranking?refresh=0',
  'https://app.bilibili.com/x/v2/search/trending/all',
  'https://api.bilibili.com/x/feed/index?idx=0&type=0&pull=0&ps=20&pn='
]

const RECOMMEND_API = 'https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd'

function buildRecommendUrl(page = 1) {
  const timestamp = Math.floor(Date.now() / 1000)
  const wts = 1746216000
  const w_rid = 'abcdef123456'
  const ps = 30
  const fresh_idx = page
  const fresh_type = 4
  const timezone_offset = -480
  return `${RECOMMEND_API}?ps=${ps}&fresh_idx=${fresh_idx}&fresh_type=${fresh_type}&timezone_offset=${timezone_offset}&wts=${wts}&w_rid=${w_rid}`
}

ipcMain.handle('fetch-videos', async (event, page = 1) => {
  log('fetch-videos called, page:', page)
  try {
    const url = buildRecommendUrl(page)
    log('Using recommend API:', url)
    const result = await fetchWithRetry(url)
    if (result.success && result.data.code === 0) {
      log('Recommend API success, code:', result.data.code)
      return { success: true, data: result.data }
    }
    return { success: false, error: '获取推荐视频失败' }
  } catch (error) {
    log('Recommend API failed:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('search-videos', async (event, keyword, page = 1) => {
  log('search-videos called, keyword:', keyword, 'page:', page)
  const searchEndpoints = [
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}&ps=20`,
    `https://api.bilibili.com/x/web-interface/search/all?keyword=${encodeURIComponent(keyword)}&page=${page}&ps=20`
  ]
  for (const endpoint of searchEndpoints) {
    try {
      log('Trying search endpoint:', endpoint.substring(0, 80) + '...')
      const result = await fetchWithRetry(endpoint)
      if (result.success && result.data.code === 0) {
        log('Search API成功, code:', result.data.code)
        return { success: true, data: result.data }
      }
    } catch (error) {
      log('Search endpoint失败:', error.message)
    }
  }
  log('所有搜索API都失败')
  return { success: false, error: '搜索失败' }
})

ipcMain.handle('fetch-popular-videos', async (event, ...args) => {
  // 兼容旧版本调用方式（只传 page）
  let tab = 'comprehensive'
  let page = 1
  let rid = 0
  
  if (args.length === 1 && typeof args[0] === 'number') {
    // 旧版本调用：只传 page
    page = args[0]
    log('fetch-popular-videos called (legacy mode), page:', page)
  } else {
    // 新版本调用
    tab = args[0] || 'comprehensive'
    page = args[1] || 1
    rid = args[2] || 0
    log('fetch-popular-videos called, tab:', tab, 'page:', page, 'rid:', rid)
  }
  
  try {
    let result = null
    let endpoint = ''
    
    if (tab === 'comprehensive' || tab === 'ranking' || typeof tab === 'number') {
      // 使用用户指定的可用接口
      const currentRid = typeof tab === 'number' ? 0 : rid
      endpoint = `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${currentRid}&type=all&ps=30&pn=${page}`
      log('Using ranking/v2 endpoint:', endpoint)
      result = await fetchWithRetry(endpoint)
    } else if (tab === 'weekly') {
      endpoint = `https://api.bilibili.com/x/web-interface/popular/series/list?ps=30&pn=${page}`
      log('Using weekly endpoint:', endpoint)
      result = await fetchWithRetry(endpoint)
    } else if (tab === 'precious') {
      endpoint = `https://api.bilibili.com/x/web-interface/popular/precious`
      log('Using precious endpoint:', endpoint)
      result = await fetchWithRetry(endpoint)
    }
    
    if (result && result.success) {
      log('API成功, raw data:', JSON.stringify(result.data).substring(0, 500))
      return { success: true, data: result.data }
    }
    log('API失败, result:', result)
    return { success: false, error: '获取视频失败' }
  } catch (error) {
    log('fetch-popular-videos error:', error.message)
    return { success: false, error: error.message }
  }
})



ipcMain.handle('fetch-popular-videos-v2', async (event, page = 1) => {
  log('fetch-popular-videos-v2 called, page:', page)
  try {
    const endpoint = `https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all&ps=30&pn=${page}`
    log('Using ranking/v2 endpoint:', endpoint)
    const result = await fetchApi(endpoint)
    log('Popular API result code:', result.code)
    if (result.code === 0) {
      log('Popular API success, items:', result.data?.list?.length || 0)
      return { success: true, data: result }
    }
    log('Popular API failed:', result)
    return { success: false, data: result, error: result.message || '获取热门视频失败' }
  } catch (error) {
    log('fetch-popular-videos-v2 error:', error.message)
    return { success: false, error: error.message }
  }
})



ipcMain.handle('fetch-hot-search', async (event) => {
  log('fetch-hot-search called')
  try {
    const endpoint = 'https://api.bilibili.com/x/web-interface/wbi/search/square?limit=10&platform=web&web_location=333.1365&w_rid=33c27013429cc439349b6d7f3523bbb8&wts=1777972362'
    log('Using hot search endpoint:', endpoint)
    const result = await fetchWithRetry(endpoint)
    
    if (result && result.success && result.data) {
      const apiData = result.data
      if (apiData.code === 0 && apiData.data && apiData.data.trending && apiData.data.trending.list) {
        const hotList = apiData.data.trending.list.map(item => ({
          keyword: item.keyword || item.show_name || '',
          title: item.show_name || item.keyword || '',
          tag: getHotTagFromData(item)
        }))
        log('Hot search API成功, items count:', hotList.length)
        return { success: true, data: { list: hotList } }
      } else if (apiData.trending && apiData.trending.list) {
        const hotList = apiData.trending.list.map(item => ({
          keyword: item.keyword || item.show_name || '',
          title: item.show_name || item.keyword || '',
          tag: getHotTagFromData(item)
        }))
        log('Hot search API成功(备用格式), items count:', hotList.length)
        return { success: true, data: { list: hotList } }
      }
    }
    
    log('热搜API返回数据格式不正确')
    return { success: false, error: '数据格式不正确' }
    
  } catch (error) {
    log('Hot search API错误:', error.message)
    return { success: false, error: error.message }
  }
})

function getHotTagFromData(item) {
  const showName = item.show_name || ''
  if (showName.includes('新') || showName.includes('回归')) return '新'
  if (showName.includes('独家')) return '独家'
  if (showName.includes('番') || showName.includes('动画')) return 'bangumi'
  if (showName.includes('视频') || showName.includes('直播')) return 'video'
  return ''
}

function getMockHotSearchData() {
  return [
    { keyword: 'COA', title: 'MRC vs TE COA9冠军争夺战', tag: '新' },
    { keyword: '烽火联赛春季赛', title: '烽火联赛春季赛季后赛', tag: '新' },
    { keyword: '打雷霆詹姆斯还有奇迹吗', title: '打雷霆詹姆斯还有奇迹吗', tag: '' },
    { keyword: '纪录片', title: '3000+纪录片限免倒计时3天', tag: '新' },
    { keyword: 'UP主优化DeepSeek V4', title: 'UP主优化DeepSeek V4', tag: '' },
    { keyword: '浏阳烟花厂爆炸', title: '浏阳烟花厂爆炸事故已致26死', tag: '' },
    { keyword: '新华社记者直击浏阳爆炸事故现场', title: '新华社记者直击浏阳爆炸事故现场', tag: '' },
    { keyword: '非人哉第三季', title: '非人哉第三季回归', tag: 'bangumi' },
    { keyword: '司雯嘉谈王心凌俞灏明争议', title: '司雯嘉谈王心凌俞灏明争议', tag: '' },
    { keyword: '寒战1994隐喻全拆解', title: '寒战1994隐喻全拆解', tag: '' }
  ]
}

ipcMain.handle('fetch-media', async (event, seasonType = 2, page = 1) => {
  log('fetch-media called, seasonType:', seasonType, 'page:', page)
  try {
    const endpoint = `https://api.bilibili.com/pgc/season/index/result?season_type=${seasonType}&type=1&free=1&pagesize=30&page=${page}&order=2`
    log('Using media endpoint:', endpoint)
    const result = await fetchWithRetry(endpoint)
    if (result && result.success) {
      log('Media API成功, raw data:', JSON.stringify(result.data).substring(0, 500))
      return { success: true, data: result.data }
    }
    log('Media API失败, result:', result)
    return { success: false, error: '获取影视失败' }
  } catch (error) {
    log('Media API错误:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-bangumi-data', async (event, params) => {
  const { is_refresh = 0, cursor = '' } = params || {}
  log('fetch-bangumi-data called, is_refresh:', is_refresh, 'cursor:', cursor)
  
  try {
    let url = `https://api.bilibili.com/pgc/page/pc/bangumi/tab?is_refresh=${is_refresh}`
    if (cursor) {
      url += `&cursor=${cursor}`
    }
    log('Using bangumi endpoint:', url)
    
    const savedCookies = cookieManager.getSavedCookies()
    log('请求前的savedCookies状态:', JSON.stringify(savedCookies))
    log('savedCookies包含的key:', Object.keys(savedCookies))
    if (savedCookies.SESSDATA) {
      log('SESSDATA存在, 前20字符:', savedCookies.SESSDATA.substring(0, 20))
    } else {
      log('SESSDATA不存在!')
    }

    // 如果没有 sec_ck，先请求推荐接口触发下发，然后直接从 session 读取最新的 sec_ck（避免 savedCookies 未及时更新的竞态）
    let secCkValue = savedCookies.sec_ck || ''
    if ((!secCkValue || secCkValue === '') && savedCookies.SESSDATA) {
      log('sec_ck不存在或为空，先请求推荐接口触发下发...')
      try {
        const recommendUrl = buildRecommendUrl(1)
        log('请求推荐接口:', recommendUrl)
        await fetchApi(recommendUrl)
        log('推荐接口请求完成，等待 session 更新...')
        // 从 session 直接读取 sec_ck（若有跨域或异步下发，session 会包含正确值）
        if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
          secCkValue = await cookieManager.getCookieFromSession(mainWindow.webContents.session, 'sec_ck') || ''
          if (secCkValue) {
            log('从 session 成功读取到 sec_ck:', secCkValue.substring(0, 20) + '...')
            // 更新内存 savedCookies 以便后续使用
            const sc = cookieManager.getSavedCookies()
            sc.sec_ck = secCkValue
            cookieManager.setSavedCookies(sc)
          } else {
            log('推荐接口未返回 sec_ck（session 中未找到）')
          }
        } else {
          log('无法访问 mainWindow.session，跳过直接读取 sec_ck')
        }
      } catch (e) {
        log('请求推荐接口失败:', e.message)
        // 继续尝试请求追番接口，不中断流程
      }
    }

    // 优先使用主进程 session 中的 cookies 和更接近官方客户端的请求头
    try {
      const sessionCookies = mainWindow && mainWindow.webContents && mainWindow.webContents.session
        ? await mainWindow.webContents.session.cookies.get({ domain: '.bilibili.com' })
        : []

      const sessionMap = {}
      for (const c of sessionCookies) {
        if (c.value === undefined || c.value === null || c.value === '') continue
        sessionMap[c.name] = c.value
      }

      // 合并到 savedCookies（session 优先覆盖）
      const merged = Object.assign({}, cookieManager.getSavedCookies() || {}, sessionMap)
      cookieManager.setSavedCookies(merged)
      cookieManager.saveCookies()
      log('Merged session cookies for bangumi request:', Object.keys(merged))

      const bangumiHeaders = {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.bilibili.com/client',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.17.5 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 build/1001017006',
        'Origin': 'https://www.bilibili.com',
        'sec-ch-ua': '"Not?A_Brand";v="8", "Chromium";v="108"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'x-app-version': '1.17.6'
      }

      const result = await fetchApiWithHeaders(url, bangumiHeaders)
      
      if (result && result.code === 0) {
        log('Bangumi API成功')

        return { success: true, data: result }
      }

      log('Bangumi API失败, result:', result)
      log('savedCookies状态:', JSON.stringify(merged))
      return { success: false, error: '获取追番数据失败' }
    } catch (error) {
      log('Bangumi API错误:', error.message)
      log('错误时的savedCookies状态:', JSON.stringify(cookieManager.getSavedCookies()))
      return { success: false, error: error.message }
    }
  } catch (error) {
    log('fetch-bangumi-data 总错误:', error.message)
    return { success: false, error: error.message }
  }
})

// 影视页面接口
ipcMain.handle('fetch-media-data', async (event, params) => {
  const { is_refresh = 0, cursor = '' } = params || {}
  log('fetch-media-data called, is_refresh:', is_refresh, 'cursor:', cursor)
  
  try {
    let url = `https://api.bilibili.com/pgc/page/pc/cinema/tab?is_refresh=${is_refresh}`
    if (cursor) {
      url += `&cursor=${cursor}`
    }
    log('Using cinema endpoint:', url)
    
    const savedCookies = cookieManager.getSavedCookies()
    log('请求前的savedCookies状态:', JSON.stringify(savedCookies))
    log('savedCookies包含的key:', Object.keys(savedCookies))
    if (savedCookies.SESSDATA) {
      log('SESSDATA存在, 前20字符:', savedCookies.SESSDATA.substring(0, 20))
    } else {
      log('SESSDATA不存在!')
    }

    // 如果没有 sec_ck，先请求推荐接口触发下发，然后直接从 session 读取最新的 sec_ck
    let secCkValue = savedCookies.sec_ck || ''
    if ((!secCkValue || secCkValue === '') && savedCookies.SESSDATA) {
      log('sec_ck不存在或为空，先请求推荐接口触发下发...')
      try {
        const recommendUrl = buildRecommendUrl(1)
        log('请求推荐接口:', recommendUrl)
        await fetchApi(recommendUrl)
        log('推荐接口请求完成，等待 session 更新...')
        // 从 session 直接读取 sec_ck
        if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
          secCkValue = await cookieManager.getCookieFromSession(mainWindow.webContents.session, 'sec_ck') || ''
          if (secCkValue) {
            log('从 session 成功读取到 sec_ck:', secCkValue.substring(0, 20) + '...')
            // 更新内存 savedCookies 以便后续使用
            const sc = cookieManager.getSavedCookies()
            sc.sec_ck = secCkValue
            cookieManager.setSavedCookies(sc)
          } else {
            log('推荐接口未返回 sec_ck（session 中未找到）')
          }
        } else {
          log('无法访问 mainWindow.session，跳过直接读取 sec_ck')
        }
      } catch (e) {
        log('请求推荐接口失败:', e.message)
        // 继续尝试请求影视接口，不中断流程
      }
    }

    // 优先使用主进程 session 中的 cookies 和更接近官方客户端的请求头
    try {
      const sessionCookies = mainWindow && mainWindow.webContents && mainWindow.webContents.session
        ? await mainWindow.webContents.session.cookies.get({ domain: '.bilibili.com' })
        : []

      const sessionMap = {}
      for (const c of sessionCookies) {
        if (c.value === undefined || c.value === null || c.value === '') continue
        sessionMap[c.name] = c.value
      }

      // 合并到 savedCookies（session 优先覆盖）
      const merged = Object.assign({}, cookieManager.getSavedCookies() || {}, sessionMap)
      cookieManager.setSavedCookies(merged)
      cookieManager.saveCookies()
      log('Merged session cookies for media request:', Object.keys(merged))

      const mediaHeaders = {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.bilibili.com/client',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.17.5 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 build/1001017006',
        'Origin': 'https://www.bilibili.com',
        'sec-ch-ua': '"Not?A_Brand";v="8", "Chromium";v="108"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'x-app-version': '1.17.6'
      }

      const result = await fetchApiWithHeaders(url, mediaHeaders)
      
      if (result && result.code === 0) {
        log('Cinema API成功')

        return { success: true, data: result }
      }

      log('Cinema API失败, result:', result)
      log('savedCookies状态:', JSON.stringify(merged))
      return { success: false, error: '获取影视数据失败' }
    } catch (error) {
      log('Cinema API错误:', error.message)
      log('错误时的savedCookies状态:', JSON.stringify(cookieManager.getSavedCookies()))
      return { success: false, error: error.message }
    }
  } catch (error) {
    log('fetch-media-data 总错误:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-bangumi-condition', async (event, params) => {
  const { index_type = 1, type = 2 } = params || {}
  log('fetch-bangumi-condition called, index_type:', index_type, 'type:', type)
  
  try {
    const url = `https://api.bilibili.com/pgc/page/index/condition?index_type=${index_type}&type=${type}`
    log('Using bangumi condition endpoint:', url)
    
    const result = await fetchApiWithHeaders(url)
    log('Bangumi condition API raw result:', JSON.stringify(result, null, 2))
    
    if (result && result.code === 0) {
      log('Bangumi condition API成功, result.data keys:', Object.keys(result.data || {}))
      log('Bangumi condition API result.data:', JSON.stringify(result.data, null, 2))
      return { success: true, data: result }
    }
    
    log('Bangumi condition API失败, result:', result)
    return { success: false, error: '获取筛选条件失败' }
  } catch (error) {
    log('fetch-bangumi-condition error:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-bangumi-result', async (event, params) => {
  const { 
    area = -1, 
    style_id = -1, 
    season_version = -1, 
    season_status = -1,
    spoken_language_type = -1,
    copyright = -1,
    is_finish = -1,
    year = -1,
    season_month = -1,
    type = 2,
    order = 3,
    index_type = 1,
    pub_date = -1,
    page = 1
  } = params || {}
  
  log('fetch-bangumi-result called, params:', params)
  
  try {
    let url = `https://api.bilibili.com/pgc/page/index/result?type=${type}&order=${order}&index_type=${index_type}&page=${page}`
    
    // 使用 String(value) !== '-1' 来处理字符串和数字类型的值
    if (String(area) !== '-1') url += `&area=${area}`
    if (String(style_id) !== '-1') url += `&style_id=${style_id}`
    if (String(season_version) !== '-1') url += `&season_version=${season_version}`
    if (String(season_status) !== '-1') url += `&season_status=${season_status}`
    if (String(spoken_language_type) !== '-1') url += `&spoken_language_type=${spoken_language_type}`
    if (String(copyright) !== '-1') url += `&copyright=${copyright}`
    if (String(is_finish) !== '-1') url += `&is_finish=${is_finish}`
    // 年份参数需要 URL 编码，因为值包含特殊字符如 [2025,2026)
    if (String(year) !== '-1') url += `&year=${encodeURIComponent(year)}`
    if (String(season_month) !== '-1') url += `&season_month=${season_month}`
    if (String(pub_date) !== '-1') url += `&pub_date=${pub_date}`
    
    log('Using bangumi result endpoint:', url)
    
    const result = await fetchApiWithHeaders(url)
    
    if (result && result.code === 0) {
      log('Bangumi result API成功')
      return { success: true, data: result }
    }
    
    log('Bangumi result API失败, result:', result)
    return { success: false, error: '获取追番数据失败' }
  } catch (error) {
    log('fetch-bangumi-result error:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-media-condition', async (event, params) => {
  const { index_type = 2, type = 2 } = params || {}
  log('fetch-media-condition called, index_type:', index_type, 'type:', type)
  
  try {
    const url = `https://api.bilibili.com/pgc/page/index/condition?index_type=${index_type}&type=${type}`
    log('Using media condition endpoint:', url)
    
    const result = await fetchApiWithHeaders(url)
    log('Media condition API raw result:', JSON.stringify(result, null, 2))
    
    if (result && result.code === 0) {
      log('Media condition API成功, result.data keys:', Object.keys(result.data || {}))
      return { success: true, data: result }
    }
    
    log('Media condition API失败, result:', result)
    return { success: false, error: '获取筛选条件失败' }
  } catch (error) {
    log('fetch-media-condition error:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-media-result', async (event, params) => {
  const { 
    area = -1, 
    style_id = -1, 
    release_date = -1, 
    season_status = -1,
    type = 2,
    order = 8,
    index_type = 2,
    page = 1
  } = params || {}
  
  log('fetch-media-result called, params:', params)
  
  try {
    let url = `https://api.bilibili.com/pgc/page/index/result?type=${type}&order=${order}&index_type=${index_type}&page=${page}`
    
    if (String(area) !== '-1') url += `&area=${area}`
    if (String(style_id) !== '-1') url += `&style_id=${style_id}`
    if (String(release_date) !== '-1') url += `&release_date=${release_date}`
    if (String(season_status) !== '-1') url += `&season_status=${season_status}`
    
    log('Using media result endpoint:', url)
    
    const result = await fetchApiWithHeaders(url)
    
    if (result && result.code === 0) {
      log('Media result API成功')
      return { success: true, data: result }
    }
    
    log('Media result API失败, result:', result)
    return { success: false, error: '获取影视数据失败' }
  } catch (error) {
    log('fetch-media-result error:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-up-info', async (event, mid) => {
  console.log('Fetching UP info for mid:', mid)
  try {
    const data = await fetchUpInfo(mid)
    console.log('UP info result code:', data.code)
    return { success: true, data }
  } catch (error) {
    console.error('Fetch UP info error:', error)
    return { success: false, error: error.message }
  }
})

// IPC: 直接读取 session 中的 sec_ck（如存在）
ipcMain.handle('get-sec-ck', async () => {
  try {
    if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
      const val = await cookieManager.getCookieFromSession(mainWindow.webContents.session, 'sec_ck')
      return { success: true, sec_ck: val }
    }
    return { success: false, error: 'mainWindow session not available' }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// IPC: 导出 session 中所有 .bilibili.com cookies 的完整信息（用于调试 sec_ck）
ipcMain.handle('dump-session-cookies', async () => {
  try {
    if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
      const list = await mainWindow.webContents.session.cookies.get({ domain: '.bilibili.com' })
      // 返回完整条目
      return { success: true, cookies: list }
    }
    return { success: false, error: 'mainWindow session not available' }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// IPC: 使用指定 Cookie 字符串重放追番请求并保存响应（用于对比）
ipcMain.handle('replay-bangumi-with-cookies', async (event, cookieString, params = {}) => {
  const { is_refresh = 0, cursor = '' } = params || {}
  try {
    const url = `https://api.bilibili.com/pgc/page/pc/bangumi/tab?is_refresh=${is_refresh}${cursor ? `&cursor=${cursor}` : ''}`
    log('Replaying bangumi with provided cookies, url:', url)

    const headers = {
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.bilibili.com/client',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.17.5 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 build/1001017006',
      'Origin': 'https://www.bilibili.com',
      'x-app-version': '1.17.6',
      'Cookie': cookieString
    }

    // 发请求并保存响应
    const result = await fetchApiWithHeaders(url, headers)

    const testDir = path.join(__dirname, 'test')
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true })
    const ts = Date.now()
    const filename = `bangumi_replay_provided_${ts}.json`
    const filePath = path.join(testDir, filename)
    try {
      fs.writeFileSync(filePath, JSON.stringify({ requestHeaders: headers, response: result }, null, 2), 'utf8')
      log('Replay (provided cookies) result saved to:', filePath)
    } catch (e) {
      log('Failed to save replay result:', e.message)
    }

    return { success: true, file: filePath, data: result }
  } catch (error) {
    log('Replay bangumi with cookies failed:', error.message)
    return { success: false, error: error.message }
  }
})

// IPC: 导入外部 Cookie 字符串，保存为 savedCookies 并写入 session
// helper: 从文本解析 cookie 并写入 savedCookies + session
async function importCookieStringFromText(cookieString) {
  if (!cookieString || typeof cookieString !== 'string') {
    throw new Error('cookieString 必须是非空字符串')
  }

  const parts = cookieString.split(';')
  const parsed = {}
  for (let p of parts) {
    p = p.trim()
    if (!p) continue
    const idx = p.indexOf('=')
    if (idx === -1) continue
    const name = p.substring(0, idx).trim()
    let value = p.substring(idx + 1).trim()
    try { value = decodeURIComponent(value) } catch (e) {}
    if (value === '' || value === undefined || value === null) continue
    parsed[name] = value
  }

  if (Object.keys(parsed).length === 0) {
    throw new Error('未解析到有效的 cookie')
  }

  // 合并并保存
  const current = cookieManager.getSavedCookies() || {}
  const merged = Object.assign({}, current, parsed)
  cookieManager.setSavedCookies(merged)
  cookieManager.saveCookies()

  // 写入 session
  if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
    for (const [name, value] of Object.entries(parsed)) {
      try {
        await mainWindow.webContents.session.cookies.set({
          url: 'https://www.bilibili.com',
          name: name,
          value: String(value),
          domain: '.bilibili.com',
          path: '/',
          secure: true,
          httpOnly: false
        })
        log(`Imported cookie to session: ${name}`)
      } catch (e) {
        log('Failed to set cookie in session:', name, e.message)
      }
    }
  }

  log('Imported cookies keys:', Object.keys(parsed))
  return { success: true, keys: Object.keys(parsed) }
}

// startup helper: 从 userData/import_cookie_string.txt 或系统剪贴板尝试导入
async function tryImportCookiesOnStartup() {
  try {
    const userDataPath = app.getPath('userData')
    const importFile = path.join(userDataPath, 'import_cookie_string.txt')
    let cookieString = null

    if (fs.existsSync(importFile)) {
      cookieString = fs.readFileSync(importFile, 'utf8').trim()
      if (cookieString) log('Found import file at', importFile)
    }

    if (!cookieString) {
      try {
        const { clipboard } = require('electron')
        const clip = clipboard.readText().trim()
        if (clip && (clip.includes('SESSDATA=') || clip.includes('sec_ck=') || clip.includes('bili_jct='))) {
          cookieString = clip
          log('Found cookie string in clipboard')
        }
      } catch (e) {
        // ignore clipboard errors
      }
    }

    if (!cookieString) {
      log('No importable cookie string found in clipboard or import file')
      return { success: false, reason: 'no-cookie' }
    }

    // 调用上面的导入函数
    const res = await importCookieStringFromText(cookieString)
    log('Startup import result keys:', res.keys)
    return res
  } catch (e) {
    log('tryImportCookiesOnStartup error:', e.message)
    return { success: false, error: e.message }
  }
}

ipcMain.handle('import-cookie-string', async (event, cookieString) => {
  try {
    const res = await importCookieStringFromText(cookieString)
    return res
  } catch (e) {
    log('import-cookie-string error:', e.message)
    return { success: false, error: e.message }
  }
})

ipcMain.handle('fetch-up-videos', async (event, mid, offset = '') => {
  console.log('Fetching UP videos for mid:', mid, 'offset:', offset)
  try {
    const data = await fetchUpVideos(mid, offset)
    console.log('UP videos result code:', data.code)
    return { success: true, data }
  } catch (error) {
    console.error('Fetch UP videos error:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.on('open-up-profile', (event, mid) => {
  console.log('Opening UP profile for mid:', mid)
  mainWindow.loadFile('src/pages/up-profile.html').then(() => {
    mainWindow.webContents.send('up-profile-mid', mid)
  })
})

ipcMain.on('go-home', () => {
  mainWindow.loadFile('index.html')
})

ipcMain.on('open-dynamic', () => {
  log('Opening dynamic page')
  mainWindow.loadFile('src/pages/dynamic.html')
})

ipcMain.on('open-my', () => {
  mainWindow.loadFile('src/pages/my.html')
})

ipcMain.on('open-popular', () => {
  mainWindow.loadFile('src/pages/popular.html')
})

ipcMain.on('open-anime', () => {
  mainWindow.loadFile('src/pages/anime.html')
})

ipcMain.on('open-media', () => {
  mainWindow.loadFile('src/pages/media.html')
})

ipcMain.handle('play-video', async (event, bvid, cid, title, mpvPath, showDanmaku = true, useBuiltin = false, progress = null) => {
  const startTime = Date.now()
  log(`[启动计时] 开始播放视频, 时间: ${new Date().toLocaleTimeString()}`)
  log(`[启动计时] 弹幕显示设置: ${showDanmaku}`)
  log(`[启动计时] 使用内置播放器: ${useBuiltin}`)
  log(`[启动计时] 播放进度: ${progress}`)

  log('play-video called with bvid:', bvid, 'cid:', cid, 'title:', title, 'mpvPath:', mpvPath, 'showDanmaku:', showDanmaku, 'useBuiltin:', useBuiltin, 'progress:', progress)
  stopVideo()

  if (useBuiltin) {
    let videoDimension = null
    if (!cid) {
      try {
        const videoInfo = await getVideoInfo(bvid)
        if (videoInfo) {
          videoDimension = videoInfo.dimension
          log('Got dimension for builtin player:', videoDimension)
        }
      } catch (error) {
        log('Failed to get video dimension:', error.message)
      }
    } else {
      try {
        const videoInfo = await getVideoInfo(bvid)
        if (videoInfo) {
          videoDimension = videoInfo.dimension
          log('Got dimension for builtin player:', videoDimension)
        }
      } catch (error) {
        log('Failed to get video dimension:', error.message)
      }
    }
    return await openBuiltinPlayer(bvid, cid, title, videoDimension, progress)
  }

  try {
    const videoUrl = `https://www.bilibili.com/video/${bvid}`
    const videoTitle = title || '哔哩哔哩视频'
    const mpvExecutable = findMpvExecutable(mpvPath)
    log(`[启动计时] 步骤1: 获取mpv可执行文件, 耗时: ${Date.now() - startTime}ms`)
    
    let targetCid = cid
    
    if (!cid) {
      try {
        const videoInfo = await getVideoInfo(bvid)
        if (videoInfo) {
          targetCid = videoInfo.cid
        }
      } catch (error) {
        log('Failed to get cid from bvid:', error.message)
      }
    }
    log(`[启动计时] 步骤2: 获取视频CID, 耗时: ${Date.now() - startTime}ms`)
    
    currentVideoInfo = {
      bvid: bvid,
      aid: null,
      cid: targetCid || null,
      duration: null,
      title: title,
      startTime: Date.now(),
      lastReportProgress: 0
    }
    
    const escapedTitle = videoTitle.replace(/(["\\])/g, '\\$1').replace(/`/g, '\\`')
    const mpvArgs = [
      '--hwdec=auto',
      '--volume=80',
      '--border=no',
      `--title="${escapedTitle}"`,
      '--sub-auto=fuzzy',
      '--sub-ass-override=yes'
    ]
    const savedCookies = cookieManager.getSavedCookies()
    if (savedCookies.SESSDATA) {
      const minimalCookie = `SESSDATA=${savedCookies.SESSDATA}; DedeUserID=${savedCookies.DedeUserID}; bili_jct=${savedCookies.bili_jct}`
      mpvArgs.push(`--http-header-fields="Cookie: ${minimalCookie}"`)
    }
    log(`[启动计时] 步骤3: 准备mpv参数, 耗时: ${Date.now() - startTime}ms`)

    let danmakuAssPath = null
    
    if (targetCid && showDanmaku) {
      try {
        log('Fetching danmaku for cid:', targetCid)
        const xml = await getDanmakuXml(targetCid)
        log('Danmaku XML length:', xml.length)
        log(`[启动计时] 步骤4a: 获取弹幕XML, 耗时: ${Date.now() - startTime}ms`)
        
        const ass = await xml2ass(xml)
        log('Danmaku ASS length:', ass.length)
        log(`[启动计时] 步骤4b: 转换ASS字幕, 耗时: ${Date.now() - startTime}ms`)
        
        if (ass.length > 0) {
          const lines = ass.split('\n')
          log('ASS lines count:', lines.length)
          if (lines.length > 25) {
            log('First 5 dialogue lines:')
            for (let i = 21; i < Math.min(26, lines.length); i++) {
              log(`Line ${i}: ${lines[i]}`)
            }
          }
        }
        
        danmakuAssPath = path.join(app.getPath('temp'), `danmaku_${targetCid}.ass`)
        fs.writeFileSync(danmakuAssPath, ass, 'utf8')
        log('Danmaku ASS saved to:', danmakuAssPath)
        log(`[启动计时] 步骤4c: 写入ASS文件, 耗时: ${Date.now() - startTime}ms`)
        
        mpvArgs.push(`--sub-file=${danmakuAssPath}`)
      } catch (error) {
        log('Failed to fetch danmaku:', error.message)
      }
    } else if (!showDanmaku) {
      log('[启动计时] 步骤4: 弹幕已禁用, 跳过弹幕获取')
    } else {
      log('[启动计时] 步骤4: 无CID, 跳过弹幕获取')
    }

    mpvArgs.push(videoUrl)

    log('Starting mpv with command:', mpvExecutable, mpvArgs.join(' '))
    
    const mpvDir = path.dirname(mpvExecutable)
    mpvProcess = spawn(mpvExecutable, mpvArgs, { 
      shell: true,
      cwd: mpvDir,
      windowsHide: true
    })
    
    const totalTime = Date.now() - startTime
    log(`[启动计时] 步骤5: 启动mpv完成, 耗时: ${totalTime}ms`)
    log(`[启动计时] 视频启动总耗时: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}秒)`)
    log('========================================')

    if (!cid) {
      getVideoInfo(bvid).then(videoInfo => {
        if (videoInfo && currentVideoInfo) {
          currentVideoInfo.aid = videoInfo.aid
          currentVideoInfo.cid = videoInfo.cid
          currentVideoInfo.duration = videoInfo.duration
          log(`[初始上报] MPV开始播放, aid=${videoInfo.aid}, cid=${videoInfo.cid}, 初始进度=0:10`)
          reportPlayHistory(videoInfo.aid, videoInfo.cid, 10)
        }
      })
    } else if (currentVideoInfo && currentVideoInfo.cid) {
      log(`[初始上报] MPV开始播放, aid=${currentVideoInfo.aid}, cid=${currentVideoInfo.cid}, 初始进度=0:10`)
      reportPlayHistory(currentVideoInfo.aid, currentVideoInfo.cid, 10)
    }

    mpvProcess.on('error', (err) => {
      log('MPV Error:', err.message)
      mpvProcess = null
      cleanupMpvSocket()
      if (danmakuAssPath && fs.existsSync(danmakuAssPath)) {
        fs.unlinkSync(danmakuAssPath)
      }
    })
    mpvProcess.on('close', (code) => {
      log(`[MPV关闭] 代码: ${code}`)
      if (currentVideoInfo && currentVideoInfo.aid && currentVideoInfo.cid) {
        const elapsedSeconds = Math.floor((Date.now() - currentVideoInfo.startTime) / 1000)
        const estimatedProgress = Math.min(elapsedSeconds, currentVideoInfo.duration || 300)
        const formattedProgress = formatProgressTime(estimatedProgress)
        log(`[MPV关闭] 上报最终进度: ${formattedProgress} (${Math.floor(estimatedProgress)}秒)`)
        reportPlayHistory(currentVideoInfo.aid, currentVideoInfo.cid, estimatedProgress)
      }
      cleanupMpvSocket()
      mpvProcess = null
      if (danmakuAssPath && fs.existsSync(danmakuAssPath)) {
        fs.unlinkSync(danmakuAssPath)
        log('Cleaned up danmaku ASS file:', danmakuAssPath)
      }
    })
    startReportTimer()
    return { success: true, hasDanmaku: !!danmakuAssPath }
  } catch (error) {
    log('Failed to start MPV:', error.message)
    return { success: false, error: error.message }
  }
})

async function openBuiltinPlayer(bvid, cid, title, dimension, progress = null) {
  log('Opening builtin player for:', bvid, title, 'dimension:', dimension, 'progress:', progress)

  if (playerWindow) {
    playerWindow.close()
    playerWindow = null
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

  // 计算窗口大小
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

    const maxWindowWidth = Math.floor(workArea.width * 0.9)
    const maxWindowHeight = Math.floor(workArea.height * 0.9)
    const minWindowWidth = 480
    const minWindowHeight = Math.max(270, Math.round(minWindowWidth * videoH / videoW))

    const videoAspect = videoW / videoH

    let calculatedWidth = Math.floor(maxWindowHeight * videoAspect)
    let calculatedHeight = maxWindowHeight

    if (calculatedWidth > maxWindowWidth) {
      calculatedWidth = maxWindowWidth
      calculatedHeight = Math.floor(maxWindowWidth / videoAspect)
    }

    windowWidth = Math.min(maxWindowWidth, Math.max(minWindowWidth, calculatedWidth))
    windowHeight = Math.min(maxWindowHeight, Math.max(minWindowHeight, calculatedHeight))

    log(`Calculated window size: ${windowWidth}x${windowHeight}, video: ${videoW}x${videoH}, aspect: ${videoAspect.toFixed(2)}`)
    playerVideoAspect = videoAspect
  }

  playerWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    frame: false,
    menuBarVisible: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      sandbox: false,
      partition: 'persist:main' // 使用与主窗口相同的partition
    }
  })

  const screen = require('electron').screen
  const primaryDisplay = screen.getPrimaryDisplay()
  const workArea = primaryDisplay.workArea
  const x = Math.floor((workArea.width - windowWidth) / 2)
  const y = Math.floor((workArea.height - windowHeight) / 2)
  playerWindow.setPosition(Math.max(0, x), Math.max(0, y))
  const session = playerWindow.webContents.session
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

  playerWindow.loadFile('src/pages/player.html')

  // 复制主窗口的cookie到播放器窗口
  const copyCookies = async () => {
    try {
      const mainCookies = await mainWindow.webContents.session.cookies.get({})
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

  playerWindow.webContents.on('did-finish-load', async () => {
    await copyCookies()
    playerWindow.webContents.send('play-video-data', {
      bvid: bvid,
      cid: finalCid,
      title: title || '哔哩哔哩视频',
      cookies: cookieManager.getSavedCookies(),
      progress: progress
    })
  })

  // 设置当前播放视频信息用于历史上报
  currentVideoInfo = {
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
    if (currentVideoInfo && currentVideoInfo.aid && currentVideoInfo.cid) {
      const elapsedSeconds = Math.floor((Date.now() - currentVideoInfo.startTime) / 1000)
      const estimatedProgress = Math.min(elapsedSeconds, currentVideoInfo.duration || 300)
      const formattedProgress = formatProgressTime(estimatedProgress)
      log(`[播放器窗口关闭] 上报最终进度: ${formattedProgress} (${Math.floor(estimatedProgress)}秒)`)
      reportPlayHistory(currentVideoInfo.aid, currentVideoInfo.cid, estimatedProgress)
    }
    cleanupMpvSocket()
    playerWindow = null
  })

  return { success: true, hasDanmaku: false, playerOpened: true }
}

ipcMain.handle('minimize-player-window', async () => {
  if (playerWindow) {
    playerWindow.minimize()
  }
})

ipcMain.handle('maximize-player-window', async () => {
  if (playerWindow) {
    if (playerWindow.isMaximized()) {
      playerWindow.unmaximize()
    } else {
      playerWindow.maximize()
    }
  }
})

ipcMain.handle('open-player-dev-tools', async () => {
  if (playerWindow) {
    playerWindow.webContents.openDevTools()
  }
})

ipcMain.handle('get-window-position', async () => {
  if (playerWindow) {
    const pos = playerWindow.getPosition()
    return { x: pos[0], y: pos[1] }
  }
  return { x: 0, y: 0 }
})

ipcMain.handle('report-play-progress', async (event, progress) => {
  // 简化处理，只更新最后上报进度，不实际上报（保留兼容性）
  if (currentVideoInfo) {
    currentVideoInfo.lastReportProgress = progress
  }
})

ipcMain.handle('report-final-progress', async (event, progress) => {
  const formattedProgress = formatProgressTime(progress)
  log(`[播放器关闭] 收到最终播放进度: ${formattedProgress} (${Math.floor(progress)}秒)`)
  if (currentVideoInfo && currentVideoInfo.aid && currentVideoInfo.cid) {
    currentVideoInfo.lastReportProgress = progress
    await reportPlayHistory(currentVideoInfo.aid, currentVideoInfo.cid, progress)
  }
})

ipcMain.handle('set-window-position', async (event, x, y) => {
  if (playerWindow) {
    playerWindow.setPosition(x, y)
  }
})

ipcMain.handle('set-window-position-direct', async (event, x, y) => {
  if (playerWindow) {
    playerWindow.setPosition(Math.round(x), Math.round(y), false)
  }
})

ipcMain.handle('is-window-maximized', async () => {
  if (playerWindow) {
    return playerWindow.isMaximized()
  }
  return false
})

ipcMain.handle('zoom-player-window', async (event, delta) => {
  if (playerWindow) {
    if (playerWindow.isFullScreen()) {
      if (delta > 0) {
        return
      } else {
        playerWindow.setFullScreen(false)
        return
      }
    }

    const currentBounds = playerWindow.getBounds()
    const { screen } = require('electron')
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea

    const baseMinWidth = 320
    const baseMinHeight = Math.round(baseMinWidth / playerVideoAspect)
    const minWidth = Math.max(baseMinWidth, Math.round(workArea.height * playerVideoAspect * 0.15))
    const minHeight = Math.max(180, Math.round(minWidth / playerVideoAspect))
    const maxWidth = Math.floor(workArea.width * 0.95)
    const maxHeight = Math.floor(workArea.height * 0.95)

    const scaleFactor = delta > 0 ? 1.2 : 0.8

    let newWidth, newHeight
    if (playerVideoAspect < 1) {
      newHeight = Math.round(currentBounds.height * scaleFactor)
      newWidth = Math.round(newHeight * playerVideoAspect)
    } else {
      newWidth = Math.round(currentBounds.width * scaleFactor)
      newHeight = Math.round(newWidth / playerVideoAspect)
    }

    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
    newHeight = Math.round(newWidth / playerVideoAspect)
    newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight))
    newWidth = Math.round(newHeight * playerVideoAspect)

    if (delta < 0) {
      const currentDim = playerVideoAspect < 1 ? currentBounds.height : currentBounds.width
      const minDim = playerVideoAspect < 1 ? minHeight : minWidth
      if (currentDim <= minDim) {
        return
      }
    }

    if (delta > 0) {
      const nextWidth = Math.round(newWidth * scaleFactor)
      const nextHeight = Math.round(nextWidth / playerVideoAspect)
      if (nextWidth >= maxWidth || nextHeight >= maxHeight) {
        playerWindow.setFullScreen(true)
        return
      }
    }

    const widthDelta = newWidth - currentBounds.width
    const heightDelta = newHeight - currentBounds.height
    playerWindow.setBounds({
      x: Math.max(0, Math.min(workArea.width - newWidth, currentBounds.x - widthDelta / 2)),
      y: Math.max(0, Math.min(workArea.height - newHeight, currentBounds.y - heightDelta / 2)),
      width: newWidth,
      height: newHeight
    }, true)
  }
})

ipcMain.handle('toggle-fullscreen', async () => {
  if (playerWindow) {
    if (playerWindow.isFullScreen()) {
      playerWindow.setFullScreen(false)
    } else {
      playerWindow.setFullScreen(true)
    }
  }
})

ipcMain.handle('resize-player-window', async (event, width, height) => {
  if (playerWindow && width && height) {
    const { screen } = require('electron')
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea

    const maxWindowWidth = Math.floor(workArea.width * 0.9)
    const maxWindowHeight = Math.floor(workArea.height * 0.9)
    const minWindowWidth = 480
    const minWindowHeight = Math.max(270, Math.round(minWindowWidth / playerVideoAspect))

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

    const currentBounds = playerWindow.getBounds()
    const widthDelta = newWidth - currentBounds.width
    const heightDelta = newHeight - currentBounds.height

    playerWindow.setBounds({
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
  if (playerWindow) {
    playerWindow.setPosition(Math.round(x), Math.round(y), false)
  }
})

ipcMain.handle('move-to-next-display', async () => {
  if (playerWindow) {
    const { screen } = require('electron')
    const displays = screen.getAllDisplays()
    
    if (displays.length <= 1) {
      return false
    }
    
    const currentBounds = playerWindow.getBounds()
    const currentDisplay = screen.getDisplayMatching(currentBounds)
    
    let nextDisplayIndex = displays.findIndex(d => d.id === currentDisplay.id) + 1
    if (nextDisplayIndex >= displays.length) {
      nextDisplayIndex = 0
    }
    
    const nextDisplay = displays[nextDisplayIndex]
    const newX = nextDisplay.workArea.x + (nextDisplay.workArea.width - currentBounds.width) / 2
    const newY = nextDisplay.workArea.y + (nextDisplay.workArea.height - currentBounds.height) / 2
    
    playerWindow.setBounds({
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
  if (playerWindow && !playerWindow.isFullScreen()) {
    const currentBounds = playerWindow.getBounds()
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
    
    playerWindow.setPosition(newX, newY)
  }
})

ipcMain.handle('get-video-url', async (event, bvid, cid) => {
  const cookieString = cookieManager.getCookieString()

  const qualityLevels = [
    { qn: 125, name: 'HDR1080P60', fnval: 16 },
    { qn: 120, name: '4K', fnval: 16 },
    { qn: 116, name: '1080P60', fnval: 16 },
    { qn: 112, name: '1080P+', fnval: 16 },
    { qn: 80, name: '1080P', fnval: 16 },
    { qn: 74, name: '720P60', fnval: 16 },
    { qn: 64, name: '720P', fnval: 16 },
    { qn: 32, name: '480P', fnval: 16 },
    { qn: 16, name: '360P', fnval: 16 }
  ]

  for (const level of qualityLevels) {
    try {
      const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${level.qn}&fnval=${level.fnval}`
      log(`=== 尝试清晰度: ${level.name} (qn=${level.qn}) ===`)

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://www.bilibili.com/video/${bvid}`,
          'Cookie': cookieString
        }
      })

      const data = await response.json()

      if (data.code !== 0) {
        log(`❌ ${level.name} 获取失败: ${data.message}`)
        continue
      }

      const dash = data.data?.dash
      if (dash && dash.video && dash.video.length > 0 && dash.audio && dash.audio.length > 0) {
        dash.video.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
        const bestVideo = dash.video[0]
        const videoUrl = bestVideo.baseUrl || bestVideo.url
        dash.audio.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
        const audioUrl = dash.audio[0].baseUrl || dash.audio[0].url
        log(`✅ 成功获取 - 使用 ${level.name} (DASH格式)`)
        log(`   ├─ 视频URL: ${videoUrl?.substring(0, 80)}...`)
        log(`   ├─ 音频URL: ${audioUrl?.substring(0, 80)}...`)
        log(`   └─ 视频码率: ${(bestVideo.bandwidth / 1000).toFixed(0)} kbps`)
        return {
          success: true,
          url: videoUrl,
          audioUrl: audioUrl,
          quality: level.name + ' (DASH)',
          isCombined: false
        }
      }

      const durl = data.data?.durl || []
      if (durl.length > 0) {
        log(`✅ 成功获取 - 使用 ${level.name} (durl格式 - 音视频合并)`)
        log(`   └─ 视频URL: ${durl[0].url?.substring(0, 80)}...`)
        return {
          success: true,
          url: durl[0].url,
          quality: level.name + ' (durl)',
          backupUrl: durl[0].backup_url?.[0],
          isCombined: true
        }
      }
      log(`⚠️ ${level.name} 无可用资源，尝试下一个...`)
    } catch (error) {
      log(`Quality ${level.name} error: ${error.message}, trying lower...`)
    }
  }

  return { success: false, error: '所有清晰度均获取失败' }
})

ipcMain.handle('get-video-info', async (event, bvid) => {
  try {
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
    log('Getting video info from:', url)
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `https://www.bilibili.com/video/${bvid}`
      }
    })
    
    const data = await response.json()
    log('Video info response:', data.code)
    
    if (data.code !== 0) {
      throw new Error(data.message || '获取视频信息失败')
    }
    
    return { success: true, data: data.data }
  } catch (error) {
    log('Error getting video info:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-danmaku', async (event, cid) => {
  try {
    const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`
    log('Getting danmaku from:', url)

    const axios = require('axios')
    const zlib = require('zlib')
    const { promisify } = require('util')
    const gunzip = promisify(zlib.gunzip)

    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive'
      },
      timeout: 10000
    })

    let xmlData
    try {
      xmlData = (await gunzip(res.data)).toString('utf8')
      log('Gunzip succeeded, length:', xmlData.length)
    } catch (e) {
      log('Gunzip failed, using raw, error:', e.message)
      xmlData = Buffer.from(res.data).toString('utf8')
    }

    if (xmlData.includes('<html') || xmlData.includes('<!DOCTYPE')) {
      log('WARNING: Received HTML instead of XML')
    }

    log('Danmaku loaded, length:', xmlData.length)

    return { success: true, data: xmlData }
  } catch (error) {
    log('Error getting danmaku:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-login-info', async () => {
  try {
    const url = 'https://api.bilibili.com/x/web-interface/nav'
    log('Getting login info from:', url)
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
        'Cookie': cookieManager.getCookieString()
      }
    })
    
    const data = await response.json()
    log('Login info result:', data.code)
    
    if (data.code === 0 && data.data && data.data.isLogin) {
      return { 
        success: true, 
        isLogin: true,
        uname: data.data.uname || '',
        face: data.data.face || '',
        mid: data.data.mid || ''
      }
    } else {
      return { success: true, isLogin: false }
    }
  } catch (error) {
    log('Error getting login info:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('select-mpv-path', async (event) => {
  log('select-mpv-path called')
  
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择MPV可执行文件',
      properties: ['openFile'],
      filters: [
        { name: '可执行文件', extensions: ['exe', 'com'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      log('MPV path selected:', selectedPath)
      return { success: true, path: selectedPath }
    }
    
    return { success: false }
  } catch (error) {
    log('Error selecting MPV path:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('navigate-up', async (event, mid) => {
  log('navigate-up called with mid:', mid)
  mainWindow.webContents.send('navigate-to-up', mid)
  return { success: true }
})

ipcMain.handle('navigate-dynamic', async () => {
  log('navigate-dynamic called')
  mainWindow.webContents.send('navigate-to-page', 'dynamic')
  return { success: true }
})

ipcMain.handle('navigate-my', async () => {
  log('navigate-my called')
  mainWindow.webContents.send('navigate-to-page', 'my')
  return { success: true }
})

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

ipcMain.on('stop-video', () => {
  stopVideo()
})

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData')
  logFile = path.join(__dirname, 'debug.log')
  cookieManager.loadCookies(path.join(userDataPath, 'cookies.json'))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

ipcMain.handle('get-login-qrcode', async () => {
  log('get-login-qrcode called')
  
  if (loginPollInterval) {
    clearInterval(loginPollInterval)
    loginPollInterval = null
  }
  
  const localKey = generateRandomString(32)
  const timestamp = Date.now()
  
  try {
    const url = `https://passport.bilibili.com/x/passport-login/web/qrcode/generate?local_key=${localKey}&source=main_mini&_timestamp=${timestamp}&rnd=${timestamp}`
    log('Fetching QR code from:', url)
    
    const result = await fetchApi(url)
    log('QR code result:', result)
    
    if (result.code === 0 && result.data) {
      const qrUrl = result.data.url
      const qcode = result.data.qrcode_key
      
      log('QR code generated, qcode:', qcode)
      
      return {
        success: true,
        data: {
          url: qrUrl,
          qcode: qcode,
          localKey: localKey
        }
      }
    } else {
      log('Failed to generate QR code, code:', result.code, 'message:', result.message)
      return { success: false, error: result.message || '获取二维码失败' }
    }
  } catch (error) {
    log('Error generating QR code:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('poll-login-status', async (event, qcode) => {
  log('poll-login-status called, qcode:', qcode)
  
  try {
    // 使用更完整的 URL 参数，匹配官方客户端
    const url = `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qcode}&source=main_electron_pc&web_location=0.0&x-bili-locale-json=%7B%22c_locale%22:%7B%22language%22:%22zh%22,%22region%22:%22CN%22%7D,%22always_translate%22:true%7D&b_ret=MQAAAABJRU5ErkJggg%3D%3DAFzCgAsMxYTaIooF%2BB%2FwGUsPWmkr%2B6%2BQAAAABJRU5ErkJggg%3D%3D&rnd=${Date.now()}`
    
    // 使用 fetchApiWithHeaders 来获取更详细的响应信息
    const result = await fetchApiWithHeaders(url)
    
    log('Poll result code:', result.code)
    
    if (result.code === 0) {
      const data = result.data
      log('Login status raw data:', JSON.stringify(data))
      
      if (data.code !== undefined && data.code !== 0) {
        log('API error code:', data.code, 'message:', data.message)
        
        if (data.code === 86038) {
          return {
            success: true,
            data: {
              status: 'expired',
              message: data.message || '二维码已失效'
            }
          }
        }
        return {
          success: false,
          error: data.message || '登录失败'
        }
      }
      
      if (data.status === 1 || data.url === '') {
        // 轮询后检查是否已经获取到 sec_ck 和 sid
        const cookiesAfter = cookieManager.getSavedCookies()
        log('等待扫码阶段 - 当前 cookies:', Object.keys(cookiesAfter))
        log('等待扫码阶段 - sec_ck:', cookiesAfter.sec_ck ? '存在' : '不存在')
        log('等待扫码阶段 - sid:', cookiesAfter.sid ? '存在' : '不存在')
        
        log('等待扫码或已扫码等待确认...')
        return {
          success: true,
          data: {
            status: 'scanned',
            message: '扫码成功，请在手机上确认登录'
          }
        }
      }
      
      if (data.url && data.url !== '') {
        // 登录成功前再次检查 cookies
        const cookiesBefore = cookieManager.getSavedCookies()
        log('登录成功前 - sec_ck:', cookiesBefore.sec_ck ? '存在' : '不存在')
        log('登录成功前 - sid:', cookiesBefore.sid ? '存在' : '不存在')
        
        log('登录成功！')
        
        if (loginPollInterval) {
          clearInterval(loginPollInterval)
          loginPollInterval = null
        }
        
        const url = new URL(data.url)
        const params = url.searchParams
        
        const savedCookies = cookieManager.getSavedCookies()
        
        if (params.has('DedeUserID')) {
          savedCookies.DedeUserID = params.get('DedeUserID')
        }
        if (params.has('SESSDATA')) {
          savedCookies.SESSDATA = params.get('SESSDATA')
        }
        if (params.has('bili_jct')) {
          savedCookies.bili_jct = params.get('bili_jct')
        }
        if (params.has('DedeUserID__ckMd5')) {
          savedCookies['DedeUserID__ckMd5'] = params.get('DedeUserID__ckMd5')
        }
        
        // 在读取 session cookies 之前，先请求 crossDomain URL 触发服务端下发包括 sec_ck 的 Set-Cookie
        try {
          log('尝试请求 crossDomain URL 以触发 Set-Cookie:', data.url)
          // 使用带有近似官方客户端 UA 的请求头
          const crossHeaders = {
            'Referer': 'https://www.bilibili.com/client',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.17.5 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 build/1001017006'
          }
          await fetchApiWithHeaders(data.url, crossHeaders)
          log('crossDomain 请求完成，开始从 session 读取 cookies')
        } catch (e) {
          log('请求 crossDomain 触发 Set-Cookie 失败:', e.message)
        }

        // 从 session 中导出 cookies（采用 cookieManager 的导出逻辑，能正确解码 SESSDATA）
        try {
          log('正在通过 cookieManager.exportCookiesFromSession 导出 session cookies...')
          await cookieManager.exportCookiesFromSession(mainWindow.webContents.session)
          // 获取导出后的 savedCookies
          const exported = cookieManager.getSavedCookies()
          // 合并本地 savedCookies（避免覆盖已有其他字段）
          savedCookies = { ...savedCookies, ...exported }
          log('从 session 导出并合并 cookies 完成')
        } catch (e) {
          log('从 session 导出 cookies 失败:', e.message)
        }

        // 保存并同步（exportCookiesFromSession 已经保存到文件，但保持调用以确保 session 一致性）
        cookieManager.setSavedCookies(savedCookies)
        cookieManager.saveCookies()
        cookieManager.syncCookiesToSession(mainWindow.webContents.session)
        
        log('最终保存的 cookies:', Object.keys(savedCookies))
        log('当前所有 cookies 详情:')
        for (const [key, value] of Object.entries(savedCookies)) {
          if (value && value.length > 0) {
            log(`  ${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`)
          }
        }
        log('sec_ck 状态:', savedCookies.sec_ck ? `存在 (${savedCookies.sec_ck.substring(0, 20)}...)` : '不存在')
        log('sid 状态:', savedCookies.sid ? `存在 (${savedCookies.sid.substring(0, 20)}...)` : '不存在')
        
        // 打印即将用于请求的 Cookie 字符串
        const cookieString = cookieManager.getCookieString()
        log('即将用于请求的 Cookie 字符串:', cookieString.substring(0, 200) + '...')
        
        return {
          success: true,
          data: {
            status: 'success',
            url: data.url,
            cookies: cookieManager.getSavedCookies(),
            refresh_token: data.refresh_token,
            message: '登录成功'
          }
        }
      }
      
      return {
        success: true,
        data: {
          status: 'waiting',
          message: '等待扫码...'
        }
      }
    } else {
      log('Poll failed, code:', result.code, 'message:', result.message)
      return { success: false, error: result.message || '查询状态失败' }
    }
  } catch (error) {
    log('Error polling login status:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('stop-login-poll', async () => {
  if (loginPollInterval) {
    clearInterval(loginPollInterval)
    loginPollInterval = null
    log('Login poll stopped')
  }
  return { success: true }
})

ipcMain.handle('get-cookies', async () => {
  return {
    success: true,
    cookies: cookieManager.getSavedCookies()
  }
})

ipcMain.handle('get-user-info', async () => {
  log('get-user-info called')
  try {
    const url = `https://api.bilibili.com/x/web-interface/nav?${Date.now()}`
    const result = await fetchApi(url)
    log('User info result code:', result.code)
    
    if (result.code === 0 && result.data) {
      const mid = result.data.mid || 0
      let viewCount = 0
      let following = 0
      let follower = 0
      let dynCount = 0
      
      if (mid > 0) {
        try {
          const cardResult = await fetchApi(`https://api.bilibili.com/x/web-interface/card?mid=${mid}&photo=true`)
          if (cardResult.code === 0 && cardResult.data?.card?.stat) {
            viewCount = cardResult.data.card.stat.like || 0
            log('Got view count:', viewCount)
          }
        } catch (e) {
          log('Error getting view count:', e.message)
        }
        
        try {
          const relationResult = await fetchApi(`https://api.bilibili.com/x/relation/stat?vmid=${mid}&web_location=bilibili-electron`)
          if (relationResult.code === 0 && relationResult.data) {
            following = relationResult.data.following || 0
            follower = relationResult.data.follower || 0
            log('Got relation stats - following:', following, 'follower:', follower)
          }
        } catch (e) {
          log('Error getting relation stats:', e.message)
        }
        
        try {
          const dynResult = await fetchApi(`https://api.bilibili.com/x/dynamic/feed/space/dyn_num?uid_str=${mid}&web_location=bilibili-electron`)
          if (dynResult.code === 0 && dynResult.data) {
            dynCount = dynResult.data.num || 0
            log('Got dyn count:', dynCount)
          }
        } catch (e) {
          log('Error getting dyn count:', e.message)
        }
      }
      
      return {
        success: true,
        data: {
          isLogin: result.data.isLogin,
          uname: result.data.uname || '未登录',
          face: result.data.face || '',
          mid: mid,
          level: result.data.level_info?.current_level || 0,
          coins: result.data.coins || 0,
          bCoins: result.data.bcoins || 0,
          vipStatus: result.data.vip?.status || 0,
          vipType: result.data.vip?.type || 0,
          following: following,
          follower: follower,
          viewCount: viewCount,
          dynCount: dynCount
        }
      }
    } else {
      return { success: false, error: '获取用户信息失败' }
    }
  } catch (error) {
    log('Error getting user info:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-user-followings', async (event, mid) => {
  log('get-user-followings called, mid:', mid)
  try {
    const url = `https://api.bilibili.com/x/relation/followings?vmid=${mid}&pn=1&ps=20&order=desc`
    const result = await fetchApi(url)
    log('Followings result code:', result.code)
    
    if (result.code === 0 && result.data) {
      const list = result.data.list || []
      return {
        success: true,
        data: list.map(item => ({
          mid: item.mid,
          uname: item.uname,
          face: item.face
        }))
      }
    } else {
      return { success: false, error: '获取关注列表失败' }
    }
  } catch (error) {
    log('Error getting followings:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-history', async (event, cursor = null) => {
  log('get-history called, cursor:', cursor)
  try {
    let url = `https://api.bilibili.com/x/web-interface/history/cursor?type=all&ps=20`
    
    if (cursor && cursor.max && cursor.view_at) {
      url += `&max=${cursor.max}&view_at=${cursor.view_at}&business=${cursor.business || 'archive'}`
      log('Using cursor params: max=' + cursor.max + ', view_at=' + cursor.view_at + ', business=' + cursor.business)
    } else {
      url += '&max=0&view_at=0&business=archive'
      log('Using initial params: max=0, view_at=0, business=archive')
    }
    
    const result = await fetchApi(url)
    log('History result code:', result.code)

    if (result.code === 0 && result.data) {
      const list = result.data.list || []
      const cursorData = result.data.cursor || {}
      const hasMore = !(cursorData.max == 0 && cursorData.view_at == 0)
      
      log('History list length:', list.length)
      log('Cursor data:', JSON.stringify(cursorData))
      log('Has more:', hasMore)
      
      if (list.length > 0) {
        log('First item uri:', list[0].uri)
        log('First item bvid:', list[0].bvid)
        log('First item history:', JSON.stringify(list[0].history))
      }

      return {
        success: true,
        data: list.map(item => {
          let bvid = ''
          if (item.bvid) {
            bvid = item.bvid
          } else if (item.history?.bvid) {
            bvid = item.history.bvid
          } else if (item.uri) {
            const match = item.uri.match(/BV[\w]+/)
            if (match) bvid = match[0]
          }

          return {
            bvid: bvid,
            title: item.title || item.long_title || '',
            pic: item.cover || '',
            duration: item.duration || 0,
            author: item.author_name || '',
            authorMid: item.author_mid || '',
            authorFace: item.author_face || '',
            viewAt: item.view_at || 0,
            progress: item.progress || 0,
            isFinish: item.is_finish || false,
            historyTime: formatHistoryTime(item.view_at)
          }
        }),
        nextCursor: {
          max: cursorData.max || 0,
          view_at: cursorData.view_at || 0,
          business: cursorData.business || 'archive'
        },
        hasMore: hasMore
      }
    } else {
      return { success: false, error: '获取历史记录失败' }
    }
  } catch (error) {
    log('Error getting history:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-history', async (event, bvid) => {
  log('delete-history called, bvid:', bvid)
  try {
    if (!bvid) {
      return { success: false, error: '缺少视频ID' }
    }

    const savedCookies = cookieManager.getSavedCookies()
    const csrf = savedCookies.bili_jct || ''
    if (!csrf) {
      return { success: false, error: '缺少 bili_jct，无法删除历史记录' }
    }

    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        bvid,
        csrf,
        csrf_token: csrf
      })
      const data = params.toString()
      const options = {
        hostname: 'api.bilibili.com',
        port: 443,
        path: '/x/v2/history/delete',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
          'Cookie': cookieManager.getCookieString(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
          'Origin': 'https://www.bilibili.com',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        },
        rejectUnauthorized: false
      }

      const req = https.request(options, (res) => {
        let body = ''
        log('Delete history response status:', res.statusCode)
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          log('Delete history response:', body)
          try {
            const result = JSON.parse(body)
            if (result.code === 0) {
              resolve({ success: true, data: result.data })
            } else {
              resolve({ success: false, error: result.message || '删除失败' })
            }
          } catch (e) {
            log('Error parsing response:', e.message)
            resolve({ success: false, error: '响应解析失败' })
          }
        })
      })

      req.on('error', (e) => {
        log('Delete history request error:', e.message)
        resolve({ success: false, error: e.message })
      })

      req.write(data)
      req.end()
    })
  } catch (error) {
    log('Error deleting history:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('search-history', async (event, keyword) => {
  log('search-history called, keyword:', keyword)
  try {
    const url = `https://api.bilibili.com/x/web-interface/history/search?pn=1&keyword=${encodeURIComponent(keyword)}&business=all&add_time_start=0&add_time_end=0&arc_max_duration=0&arc_min_duration=0&device_type=0&web_location=333.1391`
    log('History search API URL:', url)
    const result = await fetchApi(url)
    log('History search result code:', result.code)

    if (result.code === 0 && result.data && result.data.list) {
      const list = result.data.list || []
      log('History search list count:', list.length)

      return {
        success: true,
        data: list.map(item => {
          let bvid = item.bvid || ''
          if (!bvid && item.uri) {
            const match = item.uri.match(/BV[\w]+/)
            if (match) bvid = match[0]
          }

          return {
            bvid: bvid,
            title: item.title || item.long_title || '',
            pic: item.cover || '',
            duration: item.duration || 0,
            author: item.author_name || '',
            authorMid: item.author_mid || '',
            authorFace: item.author_face || '',
            viewAt: item.view_at || 0,
            progress: item.progress || 0,
            isFinish: item.is_finish || false,
            historyTime: formatHistoryTime(item.view_at)
          }
        }),
        hasMore: result.data.page?.has_more || false,
        nextPage: result.data.page?.pn ? result.data.page.pn + 1 : null
      }
    } else {
      log('History search API error:', result.message || 'Unknown error')
      return { success: false, error: result.message || '搜索历史记录失败' }
    }
  } catch (error) {
    log('Error searching history:', error.message)
    return { success: false, error: error.message }
  }
})

function formatHistoryTime(timestamp) {
  if (!timestamp) return '刚刚'
  
  const now = Date.now() / 1000
  const diff = now - timestamp
  
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 604800) return `${Math.floor(diff / 86400)}天前`
  
  const date = new Date(timestamp * 1000)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

ipcMain.handle('get-favorites', async (event, mediaId = 166434448, pageNum = 1, pageSize = 36, keyword = '') => {
  log('get-favorites called, mediaId:', mediaId, 'pageNum:', pageNum, 'pageSize:', pageSize, 'keyword:', keyword)
  try {
    const url = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${pageNum}&ps=${pageSize}&keyword=${encodeURIComponent(keyword)}&order=mtime&type=0&tid=0&platform=web&web_location=333.1387`
    log('Favorites API URL:', url)
    const result = await fetchApi(url)
    log('Favorites result code:', result.code)

    if (result.code === 0 && result.data && result.data.medias) {
      const medias = result.data.medias || []
      log('Favorites medias count:', medias.length)

      if (medias.length > 0) {
        log('First favorite title:', medias[0].title)
        log('First favorite bvid:', medias[0].bvid || medias[0].bv_id)
        log('First favorite upper:', JSON.stringify(medias[0].upper))
        log('First favorite cnt_info:', JSON.stringify(medias[0].cnt_info))
      }

      return {
        success: true,
        data: medias.map(item => ({
          bvid: item.bvid || item.bv_id || '',
          title: item.title || '',
          pic: item.cover || '',
          duration: item.duration || 0,
          upper: item.upper || null,
          cnt_info: item.cnt_info || null,
          page: item.page || 1,
          intro: item.intro || '',
          ctime: item.ctime || 0,
          pubtime: item.pubtime || 0,
          fav_time: item.fav_time || 0,
          media_id: item.id || mediaId
        })),
        hasMore: result.data.has_more || false,
        nextPage: result.data.has_more ? pageNum + 1 : null,
        mediaInfo: result.data.info || null
      }
    } else {
      log('Favorites API error:', result.message || 'Unknown error')
      return { success: false, error: result.message || '获取收藏失败' }
    }
  } catch (error) {
    log('Error getting favorites:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-toview', async (event, pageNum = 1, pageSize = 20) => {
  log('get-toview called, pageNum:', pageNum, 'pageSize:', pageSize)
  try {
    const url = `https://api.bilibili.com/x/v2/history/toview/web?pn=${pageNum}&ps=${pageSize}&viewed=0&key=&asc=false&need_split=true&web_location=333.881&w_rid=6c58fd1f8eb22fe808f98d244cc81cfd&wts=1777995347`
    log('ToView API URL:', url)
    const result = await fetchApi(url)
    log('ToView result code:', result.code)

    if (result.code === 0 && result.data) {
      const items = result.data.list || result.data || []
      log('ToView items count:', items.length)

      if (items.length > 0) {
        log('First toview title:', items[0].title)
        log('First toview bvid:', items[0].bvid)
      }

      return {
        success: true,
        data: items.map(item => ({
          bvid: item.bvid || '',
          title: item.title || '',
          pic: item.pic || item.cover || '',
          duration: item.duration || item.length || 0,
          upper: item.owner || item.upper || null,
          cnt_info: item.stat || item.cnt_info || null,
          progress: item.progress || 0,
          view_at: item.view_at || 0,
          part: item.part || ''
        })),
        hasMore: result.data.has_more || (items.length >= pageSize),
        nextPage: result.data.has_more ? pageNum + 1 : null,
        total: result.data.total || items.length
      }
    } else {
      log('ToView API error:', result.message || 'Unknown error')
      return { success: false, error: result.message || '获取稍后再看失败' }
    }
  } catch (error) {
    log('Error getting toview:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-bangumi-follow', async (event, type = 1, pageNum = 1) => {
  log('get-bangumi-follow called, type:', type, 'page:', pageNum)
  try {
    const vmid = cookieManager.getSavedCookies().DedeUserID || 320634848
    const url = `https://api.bilibili.com/x/space/bangumi/follow/list?vmid=${vmid}&type=${type}&pn=${pageNum}&ps=24&platform=web&follow_status=0`
    const result = await fetchApi(url)
    log('Bangumi follow result code:', result.code)
    log('Bangumi follow result data:', result.data ? 'exists' : 'null')
    log('Bangumi follow result data.list:', result.data?.list ? 'exists, length: ' + result.data.list.length : 'null or undefined')
    
    if (result.code === 0 && result.data && result.data.list) {
      log('Success: returning bangumi list with', result.data.list.length, 'items')
      return {
        success: true,
        data: result.data.list.map(item => ({
          season_id: item.season_id || 0,
          media_id: item.media_id || 0,
          title: item.title || '',
          cover: item.cover || '',
          total_count: item.total_count || 0,
          is_finish: item.is_finish || 0,
          is_started: item.is_started || 0,
          badge: item.badge || '',
          stat: item.stat || null,
          new_ep: item.new_ep || null,
          season_status: item.season_status || 0,
          url: item.url || '',
          short_url: item.short_url || ''
        })),
        hasMore: result.data.list.length >= 24
      }
    } else {
      log('Failed: bangumi list not available')
      return { success: false, error: '获取追番失败' }
    }
  } catch (error) {
    log('Error getting bangumi follow:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-dynamic-nav', async () => {
  log('get-dynamic-nav called')
  try {
    const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/nav?wts=1746216000&w_rid=abcdef1234567890abcdef12345678'
    log('Using dynamic nav API:', url)
    const result = await fetchApi(url)
    log('Dynamic nav result code:', result.code)
    log('Dynamic nav result data keys:', result.data ? Object.keys(result.data) : 'no data')
    log('Dynamic nav result full data:', JSON.stringify(result))

    if (result.code === 0 && result.data) {
      return {
        success: true,
        data: result.data
      }
    } else {
      log('Dynamic nav API error:', result.message)
      return { success: false, error: result.message || '获取动态导航失败' }
    }
  } catch (error) {
    log('Error getting dynamic nav:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-dynamic-portal', async () => {
  log('get-dynamic-portal called')
  try {
    const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/portal'
    log('Using dynamic portal API:', url)
    const result = await fetchApi(url)
    log('Dynamic portal result code:', result.code)
    log('Dynamic portal result data keys:', result.data ? Object.keys(result.data) : 'no data')

    if (result.code === 0 && result.data) {
      return {
        success: true,
        data: result.data
      }
    } else {
      log('Dynamic portal API error:', result.message)
      return { success: false, error: result.message || '获取动态门户失败' }
    }
  } catch (error) {
    log('Error getting dynamic portal:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('logout', async () => {
  log('logout called')
  cookieManager.clearCookies()
  return { success: true, message: '退出登录成功' }
})

ipcMain.handle('open-dev-tools', () => {
  mainWindow.webContents.openDevTools({ mode: 'detach' })
  return { success: true }
})

ipcMain.handle('reload-window', () => {
  mainWindow.webContents.reload()
  return { success: true }
})

ipcMain.handle('get-all-dynamics', async (event, offset = '') => {
  log('get-all-dynamics called, offset:', offset)
  try {
    const timezoneOffset = -480
    const features = 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete,onlyfansQaCard,commentsNewVersion,avatarAutoTheme,sunflowerStyle,cardsEnhance,eva3CardOpus,eva3CardVideo,eva3CardComment,eva3CardVote,eva3CardUser'
    let url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?timezone_offset=${timezoneOffset}&type=video&platform=web&features=${features}&web_location=333.1365`
    if (offset) {
      url += `&offset=${offset}`
    }
    log('Using dynamic feed API:', url)
    const result = await fetchApi(url)

    if (result.code === 0 && result.data) {
      const items = result.data.items || []
      const hasMore = result.data.has_more || false
      const nextOffset = result.data.next_offset || ''

      log('Dynamics API success, items count:', items.length)
      log('Next offset:', nextOffset)
      log('Has more:', hasMore)
      if (items.length > 0) {
        log('First item modules:', JSON.stringify(items[0].modules))
        log('Last item id:', items[items.length - 1].id)
      }

      const dynamics = items.map(item => {
        const modules = item.modules || {}
        const dynamicModule = modules.module_dynamic || {}
        const authorModule = modules.module_author || {}
        const majorModule = dynamicModule.major || {}

        let title = ''
        let thumbnail = ''
        let duration = ''
        let bvid = ''
        let aid = 0

        if (majorModule.archive) {
          title = majorModule.archive.title || ''
          bvid = majorModule.archive.bvid || ''
          aid = majorModule.archive.aid || 0
          duration = majorModule.archive.duration_text || ''
          thumbnail = majorModule.archive.cover || ''
        } else if (majorModule.opus) {
          title = majorModule.opus.title || ''
          thumbnail = majorModule.opus.cover || ''
          const pics = majorModule.opus.pics || []
          if (!thumbnail && pics.length > 0) {
            thumbnail = pics[0].url
          }
        } else if (majorModule.draw) {
          const desc = dynamicModule.desc || {}
          title = desc.text || ''
          const pics = majorModule.draw.items || []
          if (pics.length > 0) {
            thumbnail = pics[0].src || ''
          }
        }

        const desc = dynamicModule.desc || {}
        const authorName = authorModule.name || ''
        const authorFace = authorModule.face || ''
        const authorMid = authorModule.mid || 0
        const pubTs = authorModule.pub_ts || 0
        const pubTime = authorModule.pub_time || ''

        return {
          id: item.id_str || item.dynamic_id_str || '',
          bvid: bvid,
          aid: aid,
          title: title,
          thumbnail: thumbnail,
          duration: duration,
          authorName: authorName,
          authorFace: authorFace,
          authorMid: authorMid,
          desc: desc.text || '',
          pubTs: pubTs,
          pubTime: pubTime,
          type: item.type || ''
        }
      })

      let actualNextOffset = nextOffset
      if (!actualNextOffset && items.length > 0) {
        const lastItem = items[items.length - 1]
        actualNextOffset = lastItem.id_str || lastItem.dynamic_id_str || ''
        log('Using last item id as next offset:', actualNextOffset)
      }

      return {
        success: true,
        data: {
          items: dynamics,
          has_more: hasMore,
          next_offset: actualNextOffset
        }
      }
    } else {
      log('Dynamics API error, code:', result.code, 'message:', result.message)
      return { success: false, error: result.message || '获取动态失败' }
    }
  } catch (error) {
    log('Error getting dynamics:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-user-dynamics', async (event, upMid = null, offset = '') => {
  log('get-user-dynamics called, upMid:', upMid, 'offset:', offset)
  try {
    let url
    if (upMid) {
      url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=' + upMid + '&type=video'
      if (offset) url += '&offset=' + offset
    } else {
      const timezoneOffset = -480
      const features = 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete,onlyfansQaCard,commentsNewVersion,avatarAutoTheme,sunflowerStyle,cardsEnhance,eva3CardOpus,eva3CardVideo,eva3CardComment,eva3CardVote,eva3CardUser'
      url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?timezone_offset=${timezoneOffset}&type=video&platform=web&features=${features}&web_location=333.1365`
      if (offset) {
        url += `&offset=${offset}`
      }
    }
    log('Using dynamic API URL:', url)
    const result = await fetchApi(url)

    if (result.code === 0 && result.data) {
      const items = result.data.items || []
      const hasMore = result.data.has_more || false
      const nextOffset = result.data.next_offset || ''

      log('Dynamics API success, items count:', items.length)
      log('Next offset:', nextOffset)
      log('Has more:', hasMore)
      if (items.length > 0) {
        log('First item modules:', JSON.stringify(items[0].modules))
        log('Last item id:', items[items.length - 1].id)
      }

      const dynamics = items.map(item => {
        const modules = item.modules || {}
        const dynamicModule = modules.module_dynamic || {}
        const authorModule = modules.module_author || {}
        const majorModule = dynamicModule.major || {}

        let title = ''
        let thumbnail = ''
        let duration = ''
        let bvid = ''
        let aid = 0

        if (majorModule.archive) {
          title = majorModule.archive.title || ''
          bvid = majorModule.archive.bvid || ''
          aid = majorModule.archive.aid || 0
          duration = majorModule.archive.duration_text || ''
          thumbnail = majorModule.archive.cover || ''
        } else if (majorModule.opus) {
          title = majorModule.opus.title || ''
          thumbnail = majorModule.opus.cover || ''
          const pics = majorModule.opus.pics || []
          if (!thumbnail && pics.length > 0) {
            thumbnail = pics[0].url
          }
        } else if (majorModule.draw) {
          const desc = dynamicModule.desc || {}
          title = desc.text || ''
          const pics = majorModule.draw.items || []
          if (pics.length > 0) {
            thumbnail = pics[0].src || ''
          }
        }

        const desc = dynamicModule.desc || {}
        const authorName = authorModule.name || ''
        const authorFace = authorModule.face || ''
        const authorMid = authorModule.mid || 0
        const pubTs = authorModule.pub_ts || 0
        const pubTime = authorModule.pub_time || ''

        return {
          id: item.id_str || item.dynamic_id_str || '',
          bvid: bvid,
          aid: aid,
          title: title,
          thumbnail: thumbnail,
          duration: duration,
          authorName: authorName,
          authorFace: authorFace,
          authorMid: authorMid,
          desc: desc.text || '',
          pubTs: pubTs,
          pubTime: pubTime,
          type: item.type || ''
        }
      })

      let actualNextOffset = nextOffset
      if (!actualNextOffset && items.length > 0) {
        const lastItem = items[items.length - 1]
        actualNextOffset = lastItem.id_str || lastItem.dynamic_id_str || ''
        log('Using last item id as next offset:', actualNextOffset)
      }

      return {
        success: true,
        data: {
          items: dynamics,
          has_more: hasMore,
          next_offset: actualNextOffset
        }
      }
    } else {
      log('Dynamics API error, code:', result.code, 'message:', result.message)
      return { success: false, error: result.message || '获取动态失败' }
    }
  } catch (error) {
    log('Error getting dynamics:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-danmaku-xml', async (event, cid) => {
  log('get-danmaku-xml called with cid:', cid)
  try {
    const xml = await getDanmakuXml(cid)
    return { success: true, data: xml }
  } catch (error) {
    log('Error getting danmaku XML:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-cid-by-bvid', async (event, bvid) => {
  log('get-cid-by-bvid called with bvid:', bvid)
  try {
    const cid = await getCidByBvid(bvid)
    return { success: true, data: cid }
  } catch (error) {
    log('Error getting cid:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('xml-to-ass', async (event, xml) => {
  log('xml-to-ass called')
  try {
    const ass = await xml2ass(xml)
    return { success: true, data: ass }
  } catch (error) {
    log('Error converting XML to ASS:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-danmaku-ass', async (event, cid, bvid = null) => {
  log('fetch-danmaku-ass called with cid:', cid, 'bvid:', bvid)
  try {
    let targetCid = cid
    
    if (!cid && bvid) {
      log('No cid provided, getting cid from bvid:', bvid)
      targetCid = await getCidByBvid(bvid)
      log('Got cid:', targetCid)
    }
    
    if (!targetCid) {
      throw new Error('缺少cid参数且无法从bvid获取')
    }
    
    const xml = await getDanmakuXml(targetCid)
    const ass = await xml2ass(xml)
    
    return { success: true, data: ass, cid: targetCid }
  } catch (error) {
    log('Error fetching danmaku ASS:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('save-ass-file', async (event, assContent, fileName) => {
  log('save-ass-file called')
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存弹幕字幕',
      defaultPath: fileName || 'danmaku.ass',
      filters: [
        { name: 'ASS字幕文件', extensions: ['ass'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, assContent, 'utf8')
      log('ASS file saved to:', result.filePath)
      return { success: true, path: result.filePath }
    }
    
    return { success: false }
  } catch (error) {
    log('Error saving ASS file:', error.message)
    return { success: false, error: error.message }
  }
})
