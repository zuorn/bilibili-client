const fs = require('fs')

let savedCookies = {}
let cookieFile = ''

// 默认需要补充的 cookie（按需可改）
const defaultCookies = {
  bili_ticket_expires: '1779008783'
}

function safeDecode(value, maxIterations = 5) {
  if (typeof value !== 'string') return value
  let prev = value
  try {
    for (let i = 0; i < maxIterations; i++) {
      const dec = decodeURIComponent(prev)
      if (dec === prev) break
      prev = dec
    }
  } catch (e) {
    // 如果解码失败，返回当前值
  }
  return prev
}

function log(...args) {
  console.log(new Date().toISOString(), ...args)
}

function loadCookies(filePath) {
  cookieFile = filePath
  try {
    if (fs.existsSync(cookieFile)) {
      const data = fs.readFileSync(cookieFile, 'utf8')
      savedCookies = JSON.parse(data)
      log('Loaded cookies from file:', Object.keys(savedCookies))
      // 清理包含控制字符的 cookie 值，防止污染 HTTP 请求头
      const cleaned = {}
      for (const [key, value] of Object.entries(savedCookies)) {
        if (typeof value !== 'string' || !/[\x00-\x08\x0A-\x1F\x7F]/.test(value)) {
          cleaned[key] = value
        } else {
          log(`Dropped cookie with control chars on load: ${key}`)
        }
      }
      savedCookies = cleaned
      // 如果文件中已有 SESSDATA，尝试恢复原始未编码形式
      if (savedCookies && savedCookies.SESSDATA) {
        savedCookies.SESSDATA = safeDecode(savedCookies.SESSDATA)
      }
    }
    // 确保存在必需的默认 cookie
    for (const [k, v] of Object.entries(defaultCookies)) {
      if (!savedCookies[k]) {
        savedCookies[k] = v
        log(`Added default cookie: ${k}=${v}`)
      }
    }
    // 保存可能新增的默认 cookie
    saveCookies()

    log('Cookies loaded:', Object.keys(savedCookies))
  } catch (error) {
    log('Failed to load cookies:', error.message)
  }
}

function saveCookies() {
  try {
    fs.writeFileSync(cookieFile, JSON.stringify(savedCookies), 'utf8')
    log('Saved cookies to file')
  } catch (error) {
    log('Failed to save cookies:', error.message)
  }
}

async function syncCookiesToSession(session) {
  if (!session) return

  try {
    log('Starting to sync cookies, savedCookies keys:', Object.keys(savedCookies))

    for (const [name, value] of Object.entries(savedCookies)) {
      try {
          // 跳过空字符串或 undefined/null 的 cookie，避免覆盖 session 中服务器下发的有效 cookie（如 sec_ck）
          if (value === undefined || value === null || value === '') {
            log(`Skip syncing empty cookie to session: ${name}`)
            continue
          }
            // 对于 SESSDATA：写入 session 时使用原始未编码值，避免 session 中再被二次编码
            const valueToSet = name === 'SESSDATA' ? safeDecode(value) : value

          await session.cookies.set({
            url: 'https://www.bilibili.com',
            name: name,
            value: valueToSet,
            domain: '.bilibili.com',
            path: '/',
            secure: true,
            httpOnly: false
          })
        log(`Cookie synced: ${name}`)
      } catch (e) {
        log('Failed to sync cookie to session:', name, e.message)
      }
    }

    const cookiesAfter = await session.cookies.get({ domain: '.bilibili.com' })
    log('Session cookies after sync:', cookiesAfter.map(c => c.name))
    log('Synced cookies to session done')
  } catch (error) {
    log('Failed to sync cookies to session:', error.message)
  }
}

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

function parseSetCookieHeaders(setCookieHeaders) {
  if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) {
    return {}
  }

  const parsed = {}
  for (const cookieStr of setCookieHeaders) {
    const match = cookieStr.match(/^([^=]+)=([^;]+)/)
    if (match) {
      const name = match[1].trim()
      let value = match[2].trim()
      // 过滤包含控制字符的值，防止保存后污染后续 HTTP 请求头
      if (/[\x00-\x08\x0A-\x1F\x7F]/.test(value)) {
        log(`Parse skip cookie with control chars: ${name}`)
        continue
      }
      if (name === 'SESSDATA') {
        value = safeDecode(value)
      }
      savedCookies[name] = value
      log(`Parsed Set-Cookie: ${name}=${value.substring(0, Math.min(20, value.length))}...`)
      parsed[name] = value
    }
  }
  return parsed
}

function getSavedCookies() {
  return savedCookies
}

function setSavedCookies(cookies) {
  savedCookies = cookies
}

function getCookieString() {
  if (Object.keys(savedCookies).length > 0) {
    return Object.entries(savedCookies)
      .map(([key, value]) => {
        const safeValue = typeof value === 'string' ? value : String(value || '')
        const v = encodeURIComponent(safeValue)
        return `${key}=${v}`
      })
      .join('; ')
  }
  return ''
}

async function exportCookiesFromSession(session) {
  if (!session) return {}
  try {
    const cookies = await session.cookies.get({ domain: '.bilibili.com' })
    for (const c of cookies) {
      if (c.value === undefined || c.value === null || c.value === '') {
        log(`Export skip empty cookie from session: ${c.name}`)
        continue
      }
      const rawValue = typeof c.value === 'string' ? c.value : String(c.value)
      // 过滤包含控制字符（换行等）的值，防止污染后续 HTTP 请求头
      if (/[\x00-\x08\x0A-\x1F\x7F]/.test(rawValue)) {
        log(`Export skip cookie with control chars: ${c.name}`)
        continue
      }
      if (c.name === 'SESSDATA') {
        savedCookies[c.name] = safeDecode(rawValue)
      } else {
        savedCookies[c.name] = rawValue
      }
      log(`Exported cookie from session: ${c.name}`)
    }
    saveCookies()
    log('Exported cookies saved to file')
    return savedCookies
  } catch (error) {
    log('Failed to export cookies from session:', error.message)
    throw error
  }
}

async function getCookieFromSession(session, name) {
  if (!session || !name) return null
  try {
    const list = await session.cookies.get({ domain: '.bilibili.com', name })
    if (list && list.length > 0) return list[0].value
    return null
  } catch (e) {
    log('getCookieFromSession error:', e.message)
    return null
  }
}

module.exports = {
  savedCookies,
  loadCookies,
  saveCookies,
  syncCookiesToSession,
  clearCookies,
  parseSetCookieHeaders,
  getSavedCookies,
  setSavedCookies,
  exportCookiesFromSession,
  getCookieFromSession,
  getCookieString,
  safeDecode
}
