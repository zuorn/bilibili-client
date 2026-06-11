const https = require('https')
const zlib = require('zlib')
const crypto = require('crypto')
const { URL } = require('url')
const cookieManager = require('./cookieManager')
const { log } = require('./log')

let _mainWindow = null

// ==================== WBI 签名 ====================
const MIXIN_KEY_ENC_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]

let wbiKeysCache = null
let wbiKeysFetchTime = 0

function getMixKey(imgKey, subKey) {
  const raw = imgKey + subKey
  let mixKey = ''
  for (const pos of MIXIN_KEY_ENC_TAB) {
    if (pos < raw.length) {
      mixKey += raw[pos]
    }
  }
  return mixKey.substring(0, 32)
}

async function fetchWbiKeys() {
  if (wbiKeysCache && wbiKeysCache.imgKey && Date.now() - wbiKeysFetchTime < 3600000) {
    log('WBI keys from cache:', wbiKeysCache.imgKey.substring(0, 16) + '...', wbiKeysCache.subKey.substring(0, 16) + '...')
    return wbiKeysCache
  }
  log('Fetching fresh WBI keys from nav...')
  return new Promise((resolve) => {
    const url = 'https://api.bilibili.com/x/web-interface/nav'
    const urlObj = new URL(url)
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/'
    }
    const savedCookies = cookieManager.getSavedCookies()
    if (Object.keys(savedCookies).length > 0) {
      headers['Cookie'] = cookieManager.getCookieString()
    }
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      rejectUnauthorized: false
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          log('Nav response code:', parsed.code, 'has wbi_img:', !!(parsed.data && parsed.data.wbi_img))
          if (parsed.code === 0 && parsed.data && parsed.data.wbi_img) {
            const wbi = parsed.data.wbi_img
            log('wbi_img raw keys:', Object.keys(wbi))
            let imgKey, subKey
            // 新格式：从 img_url / sub_url 中提取文件名（去掉扩展名）
            if (wbi.img_url && wbi.sub_url) {
              imgKey = wbi.img_url.split('/').pop().split('.')[0]
              subKey = wbi.sub_url.split('/').pop().split('.')[0]
            } else if (wbi.img_key && wbi.sub_key) {
              // 旧格式：直接使用
              imgKey = wbi.img_key
              subKey = wbi.sub_key
            }
            if (imgKey && subKey) {
              wbiKeysCache = { imgKey, subKey }
              wbiKeysFetchTime = Date.now()
              log('WBI keys updated:', imgKey.substring(0, 16) + '...', subKey.substring(0, 16) + '...')
            } else {
              log('WBI keys extraction failed - imgKey:', imgKey, 'subKey:', subKey)
            }
          } else {
            log('WBI keys not found in nav response')
          }
          resolve(wbiKeysCache)
        } catch (e) {
          log('Nav response parse error:', e.message)
          resolve(wbiKeysCache)
        }
      })
    })
    req.on('error', (e) => { log('Nav request error:', e.message); resolve(wbiKeysCache) })
    req.setTimeout(10000, () => { req.destroy(); log('Nav request timeout'); resolve(wbiKeysCache) })
    req.end()
  })
}

function signParams(params, mixKey) {
  const wts = Math.floor(Date.now() / 1000)
  const allParams = { ...params, wts }
  const sortedKeys = Object.keys(allParams).sort()
  const query = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(allParams[k]))}`).join('&')
  const signStr = query + mixKey
  const w_rid = crypto.createHash('md5').update(signStr, 'utf8').digest('hex')
  log('WBI sign params:', JSON.stringify(allParams))
  log('WBI sign query:', query)
  log('WBI sign mixKey:', mixKey)
  log('WBI sign string:', signStr.substring(0, 200) + '...')
  log('WBI w_rid:', w_rid, 'wts:', wts)
  return { w_rid, wts }
}

function setMainWindow(mw) {
  _mainWindow = mw
}

async function fetchApi(url) {
  const urlObj = new URL(url)
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

  // 优先从 session 获取最新的 Cookie，确保登录后使用正确的会话
  let cookieString = ''
  try {
    if (_mainWindow && _mainWindow.webContents && _mainWindow.webContents.session) {
      const sessionCookies = await _mainWindow.webContents.session.cookies.get({ domain: '.bilibili.com' })
      if (sessionCookies && sessionCookies.length > 0) {
        // 调试：查看 session 中的关键 Cookie
        const sessdataCookie = sessionCookies.find(c => c.name === 'SESSDATA')
        const dedeUserCookie = sessionCookies.find(c => c.name === 'DedeUserID')
        log('fetchApi: session 中的 SESSDATA:', sessdataCookie ? sessdataCookie.value.substring(0, 20) + '...' : '不存在')
        log('fetchApi: session 中的 DedeUserID:', dedeUserCookie ? dedeUserCookie.value : '不存在')
        
        cookieString = sessionCookies
          .filter(c => c && c.name && c.value)
          .map(c => `${c.name}=${encodeURIComponent(typeof c.value === 'string' ? c.value : String(c.value || ''))}`)
          .join('; ')
        log('fetchApi: 使用 session 中的 Cookie')
      }
    }
  } catch (e) {
    log('fetchApi: 从 session 获取 Cookie 失败:', e.message)
  }
  
  // 如果从 session 获取失败，使用保存的 Cookie
  if (!cookieString) {
    const savedCookies = cookieManager.getSavedCookies()
    log('fetchApi: 使用保存的 Cookie')
    log('fetchApi: savedCookies 中的 SESSDATA:', savedCookies.SESSDATA ? savedCookies.SESSDATA.substring(0, 20) + '...' : '不存在')
    log('fetchApi: savedCookies 中的 DedeUserID:', savedCookies.DedeUserID || '不存在')
    if (Object.keys(savedCookies).length > 0) {
      cookieString = cookieManager.getCookieString()
    }
  }
  
  if (cookieString) {
    headers['Cookie'] = cookieString
    // 调试：查看最终使用的 Cookie 中的关键信息
    const sessdataMatch = cookieString.match(/SESSDATA=([^;]+)/)
    const dedeUserMatch = cookieString.match(/DedeUserID=([^;]+)/)
    log('fetchApi: 最终使用的 SESSDATA:', sessdataMatch ? sessdataMatch[1].substring(0, 20) + '...' : '不存在')
    log('fetchApi: 最终使用的 DedeUserID:', dedeUserMatch ? dedeUserMatch[1] : '不存在')
  }
  
  return new Promise((resolve, reject) => {

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers,
      rejectUnauthorized: false
    }

    const req = https.request(options, (res) => {
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
            resolve(parsed)
          } catch (e) {
            reject(e)
          }
        })
        decompressor.on('error', (err) => {
          reject(err)
        })
      } else {
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            resolve(parsed)
          } catch (e) {
            reject(e)
          }
        })
      }
    })

    req.on('error', (err) => {
      reject(err)
    })
    req.setTimeout(15000, () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
    req.end()
  })
}

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const data = await fetchApi(url)
      if (data.code === 0) {
        return { success: true, data }
      }
      if (data.code === -352 && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay * (i + 1)))
        continue
      }
      return { success: true, data }
    } catch (error) {
      if (i === retries - 1) throw error
      await new Promise(r => setTimeout(r, delay * (i + 1)))
    }
  }
  throw new Error('重试次数用尽')
}

async function fetchApiWithHeaders(url, customHeaders = {}) {
  return new Promise(async (resolve, reject) => {
    const urlObj = new URL(url)

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
      if (_mainWindow && _mainWindow.webContents && _mainWindow.webContents.session) {
        const sessionCookies = await _mainWindow.webContents.session.cookies.get({ domain: '.bilibili.com' })
        if (sessionCookies && sessionCookies.length > 0) {
          const cookiePairs = sessionCookies
            .filter(c => c && c.name && c.value)
            .map(c => {
              const cleanValue = typeof c.value === 'string' ? c.value : String(c.value || '')
              return `${c.name}=${encodeURIComponent(cleanValue)}`
            })
          const cookieString = cookiePairs.join('; ')
          headers['Cookie'] = cookieString
        }
      }
    } catch (e) {
      const savedCookies = cookieManager.getSavedCookies()
      if (Object.keys(savedCookies).length > 0) {
        const cookieString = cookieManager.getCookieString()
        headers['Cookie'] = cookieString
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
            resolve(parsed)
          } catch (e) {
            reject(e)
          }
        })
        decompressor.on('error', (err) => {
          reject(err)
        })
      } else {
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            resolve(parsed)
          } catch (e) {
            reject(e)
          }
        })
      }
    })

    req.on('error', (err) => {
      reject(err)
    })
    req.setTimeout(15000, () => {
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

function fetchApiPost(url, bodyParams) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const body = Object.entries(bodyParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/client',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Origin': 'https://www.bilibili.com',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'TE': 'Trailers'
    }

    const savedCookies = cookieManager.getSavedCookies()
    if (Object.keys(savedCookies).length > 0) {
      headers['Cookie'] = cookieManager.getCookieString()
    }

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers,
      rejectUnauthorized: false
    }

    const req = https.request(options, (res) => {
      if (res.headers['set-cookie']) {
        cookieManager.parseSetCookieHeaders(res.headers['set-cookie'])
      }

      let data = ''
      const encoding = res.headers['content-encoding']

      if (encoding === 'gzip' || encoding === 'br') {
        let decompressor = encoding === 'br' ? zlib.createBrotliDecompress() : zlib.createGunzip()
        const chunks = []
        res.pipe(decompressor)
        decompressor.on('data', (chunk) => { chunks.push(chunk) })
        decompressor.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks)
            resolve(JSON.parse(buffer.toString('utf8')))
          } catch (e) { reject(e) }
        })
        decompressor.on('error', (err) => { reject(err) })
      } else {
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
        })
      }
    })

    req.on('error', (err) => { reject(err) })
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('请求超时')) })
    req.write(body)
    req.end()
  })
}

module.exports = {
  buildRecommendUrl,
  fetchApi,
  fetchApiPost,
  fetchWithRetry,
  fetchApiWithHeaders,
  API_ENDPOINTS,
  RECOMMEND_API,
  setMainWindow,
  fetchWbiKeys,
  getMixKey,
  signParams
}
