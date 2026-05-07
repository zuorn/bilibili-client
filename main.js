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

let mainWindow
let mpvProcess = null
let loginPollInterval = null
let savedCookies = {}
let mpvSocket = null
let mpvSocketPath = null
let currentVideoInfo = null
let reportTimer = null
let cachedMpvPath = null
let cachedCookieString = null

let logFile = ''
let cookieFile = ''

// 加载保存的Cookie
function loadCookies() {
  try {
    if (fs.existsSync(cookieFile)) {
      const data = fs.readFileSync(cookieFile, 'utf8')
      savedCookies = JSON.parse(data)
      log('Loaded cookies:', Object.keys(savedCookies))
    }
  } catch (error) {
    log('Failed to load cookies:', error.message)
  }
}

// 保存Cookie到文件
function saveCookies() {
  try {
    fs.writeFileSync(cookieFile, JSON.stringify(savedCookies), 'utf8')
    log('Saved cookies to file')
  } catch (error) {
    log('Failed to save cookies:', error.message)
  }
}

// 清除Cookie
function clearCookies() {
  savedCookies = {}
  try {
    if (fs.existsSync(cookieFile)) {
      fs.unlinkSync(cookieFile)
    }
    log('Cleared cookies')
  } catch (error) {
    log('Failed to clear cookies:', error.message)
  }
}
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
  
  console.log(timestamp + message)
  
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
        title: result.data.title
      }
    }
  } catch (error) {
    log('获取视频信息失败:', error)
  }
  return null
}

// 上报播放历史
async function reportPlayHistory(aid, cid, progress) {
  if (!savedCookies.SESSDATA || !savedCookies.bili_jct) {
    log('缺少 SESSDATA 或 bili_jct，无法上报播放历史')
    return false
  }

  return new Promise((resolve) => {
    const data = `aid=${aid}&cid=${cid}&progress=${Math.floor(progress)}&platform=pc&csrf=${savedCookies.bili_jct}`
    const options = {
      hostname: 'api.bilibili.com',
      port: 443,
      path: '/x/v2/history/report',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': Object.entries(savedCookies).map(([k, v]) => `${k}=${v}`).join('; '),
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
          log('播放历史上报结果:', result)
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

// 启动定时上报
function startReportTimer() {
  stopReportTimer()
  reportTimer = setInterval(() => {
    if (currentVideoInfo && currentVideoInfo.aid && currentVideoInfo.cid) {
      reportEstimatedProgress()
    }
  }, 30000)
}

// 停止定时上报
function stopReportTimer() {
  if (reportTimer) {
    clearInterval(reportTimer)
    reportTimer = null
  }
}

// 上报估算的进度
async function reportEstimatedProgress() {
  if (!currentVideoInfo || !currentVideoInfo.aid || !currentVideoInfo.cid) return

  try {
    // 估算播放时间
    const elapsedSeconds = Math.floor((Date.now() - currentVideoInfo.startTime) / 1000)
    let estimatedProgress = Math.min(elapsedSeconds, currentVideoInfo.duration || 300)
    
    // 确保进度递增（至少比上次上报的多）
    if (estimatedProgress <= currentVideoInfo.lastReportProgress) {
      estimatedProgress = currentVideoInfo.lastReportProgress + 1
    }
    currentVideoInfo.lastReportProgress = estimatedProgress
    
    await reportPlayHistory(currentVideoInfo.aid, currentVideoInfo.cid, estimatedProgress)
  } catch (error) {
    log('上报估算进度失败:', error)
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
      sandbox: false
    }
  }
  if (fs.existsSync(iconPath)) {
    options.icon = iconPath
  }
  
  mainWindow = new BrowserWindow(options)

  mainWindow.loadFile('index.html')

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
      'Referer': 'https://www.bilibili.com/',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Origin': 'https://www.bilibili.com',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'TE': 'Trailers'
    }
    
    if (Object.keys(savedCookies).length > 0) {
      const cookieString = Object.entries(savedCookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ')
      headers['Cookie'] = cookieString
      log('Adding cookies:', Object.keys(savedCookies))
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

ipcMain.handle('fetch-anime', async (event, page = 1) => {
  log('fetch-anime called, page:', page)
  try {
    const endpoint = `https://api.bilibili.com/pgc/season/index/result?season_type=1&type=1&free=1&pagesize=30&page=${page}&order=2`
    log('Using anime endpoint:', endpoint)
    const result = await fetchWithRetry(endpoint)
    if (result && result.success) {
      log('Anime API成功, raw data:', JSON.stringify(result.data).substring(0, 500))
      return { success: true, data: result.data }
    }
    log('Anime API失败, result:', result)
    return { success: false, error: '获取番剧失败' }
  } catch (error) {
    log('Anime API错误:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-following-anime', async (event) => {
  log('fetch-following-anime called')
  try {
    const navUrl = `https://api.bilibili.com/x/web-interface/nav?${Date.now()}`
    const navResult = await fetchApi(navUrl)

    if (navResult.code !== 0 || !navResult.data?.mid) {
      log('获取用户信息失败')
      return { success: false, error: '获取用户信息失败' }
    }

    const mid = navResult.data.mid
    const timestamp = Math.floor(Date.now() / 1000)
    const w_rid = generateWRid()
    const endpoint = `https://api.bilibili.com/x/space/bangumi/follow/list?vmid=${mid}&type=1&pn=1&ps=10&playform=web&follow_status=0&web_location=333.1387&w_rid=${w_rid}&wts=${timestamp}`
    log('Using following anime endpoint:', endpoint)
    const result = await fetchApi(endpoint)
    log('Following anime API result code:', result.code)
    if (result.code === 0 && result.data && result.data.list) {
      log('Following anime list length:', result.data.list.length)
    }
    return { success: true, data: result }
  } catch (error) {
    log('Following anime API错误:', error.message)
    return { success: false, error: error.message }
  }
})

function generateWRid() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function generateWRid() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

ipcMain.handle('fetch-anime-recommend', async (event, seasonType = 1) => {
  log('fetch-anime-recommend called, seasonType:', seasonType)
  try {
    const endpoint = `https://api.bilibili.com/pgc/season/index/result?season_type=${seasonType}&type=1&page=1&pagesize=20&order=0&sort=0`
    log('Using anime recommend endpoint:', endpoint)
    const result = await fetchWithRetry(endpoint)
    if (result && result.success) {
      log('Anime recommend API成功, code:', result.data.code)
      log('Anime recommend API data:', JSON.stringify(result.data).substring(0, 1000))
      return { success: true, data: result.data }
    }
    log('Anime recommend API失败, result:', result)
    return { success: false, error: '获取推荐失败' }
  } catch (error) {
    log('Anime recommend API错误:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fetch-guess-like', async (event) => {
  log('fetch-guess-like called')
  try {
    const endpoint = 'https://api.bilibili.com/pgc/page/web/v3?name=anime'
    log('Using guess like endpoint:', endpoint)
    const result = await fetchWithRetry(endpoint)
    if (result && result.success) {
      log('Guess like API成功, code:', result.data.code)
      log('Guess like API data:', JSON.stringify(result.data).substring(0, 1500))
      return { success: true, data: result.data }
    }
    log('Guess like API失败, result:', result)
    return { success: false, error: '获取猜你喜欢失败' }
  } catch (error) {
    log('Guess like API错误:', error.message)
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

ipcMain.on('open-my', (event, tab) => {
  mainWindow.loadFile('src/pages/my.html').then(() => {
    if (tab) {
      mainWindow.webContents.send('my-page-tab', tab)
    }
  })
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

ipcMain.handle('play-video', async (event, bvid, cid, title, mpvPath, showDanmaku = true) => {
  const startTime = Date.now()
  log(`[启动计时] 开始播放视频, 时间: ${new Date().toLocaleTimeString()}`)
  log(`[启动计时] 弹幕显示设置: ${showDanmaku}`)
  
  log('play-video called with bvid:', bvid, 'cid:', cid, 'title:', title, 'mpvPath:', mpvPath, 'showDanmaku:', showDanmaku)
  stopVideo()

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
    
    const mpvArgs = [
      '--hwdec=auto',
      '--volume=80',
      '--border=no',
      `--title=${videoTitle}`,
      '--sub-auto=fuzzy',
      '--sub-ass-override=yes'
    ]

    if (savedCookies.SESSDATA) {
      const minimalCookie = `SESSDATA=${savedCookies.SESSDATA}; DedeUserID=${savedCookies.DedeUserID}; bili_jct=${savedCookies.bili_jct}`
      mpvArgs.push(`--http-header-fields=Cookie: ${minimalCookie}`)
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
    mpvProcess = spawn(mpvExecutable, mpvArgs)
    
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
          reportPlayHistory(videoInfo.aid, videoInfo.cid, 10)
        }
      })
    } else if (currentVideoInfo && currentVideoInfo.cid) {
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
      log('MPV closed with code:', code)
      if (currentVideoInfo && currentVideoInfo.aid && currentVideoInfo.cid) {
        const elapsedSeconds = Math.floor((Date.now() - currentVideoInfo.startTime) / 1000)
        const estimatedProgress = Math.min(elapsedSeconds, currentVideoInfo.duration || 300)
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
  cookieFile = path.join(userDataPath, 'cookies.json')
  loadCookies() // 启动时加载Cookie
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
    const url = `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qcode}&source=main_mini&rnd=${Date.now()}`
    const result = await fetchApi(url)
    
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
        log('登录成功！')
        
        if (loginPollInterval) {
          clearInterval(loginPollInterval)
          loginPollInterval = null
        }
        
        const url = new URL(data.url)
        const params = url.searchParams
        
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
        
        log('Saved cookies:', Object.keys(savedCookies))
        saveCookies() // 保存Cookie到文件
        
        return {
          success: true,
          data: {
            status: 'success',
            url: data.url,
            cookies: savedCookies,
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

ipcMain.handle('get-user-info', async () => {
  log('get-user-info called')
  try {
    const url = `https://api.bilibili.com/x/web-interface/nav?${Date.now()}`
    const result = await fetchApi(url)
    log('User info result code:', result.code)
    
    if (result.code === 0 && result.data) {
      return {
        success: true,
        data: {
          isLogin: result.data.isLogin,
          uname: result.data.uname || '未登录',
          face: result.data.face || '',
          mid: result.data.mid || 0,
          level: result.data.level_info?.current_level || 0,
          coins: result.data.coins || 0,
          bCoins: result.data.bcoins || 0,
          vipStatus: result.data.vip?.status || 0,
          vipType: result.data.vip?.type || 0,
          following: result.data.following || 0,
          follower: result.data.follower || 0
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
    const vmid = savedCookies.DedeUserID || 320634848
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
  clearCookies()
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
