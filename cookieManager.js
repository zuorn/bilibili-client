const fs = require('fs')

let savedCookies = {}
let cookieFile = ''

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
    }
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
        await session.cookies.set({
          url: 'https://www.bilibili.com',
          name: name,
          value: value,
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
      const value = match[2].trim()
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
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
  }
  return ''
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
  getCookieString
}
