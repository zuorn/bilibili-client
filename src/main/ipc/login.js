// IPC handlers and utilities for login/cookie operations
const cookieManager = require('../cookieManager')
const path = require('path')
const fs = require('fs')
const { URL } = require('url')

let loginPollInterval = null
let _depsRef = null

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

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
    if (/[\x00-\x08\x0A-\x1F\x7F]/.test(value)) continue
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
  const mainWindow = _depsRef ? _depsRef.mainWindow : null
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
      } catch (e) {
        // ignore per-cookie failures
      }
    }
  }

  return { success: true, keys: Object.keys(parsed) }
}

// startup helper: 从 userData/import_cookie_string.txt 或系统剪贴板尝试导入
async function tryImportCookiesOnStartup() {
  try {
    const userDataPath = require('electron').app.getPath('userData')
    const importFile = path.join(userDataPath, 'import_cookie_string.txt')
    let cookieString = null

    if (fs.existsSync(importFile)) {
      cookieString = fs.readFileSync(importFile, 'utf8').trim()
    }

    if (!cookieString) {
      try {
        const { clipboard } = require('electron')
        const clip = clipboard.readText().trim()
        if (clip && (clip.includes('SESSDATA=') || clip.includes('sec_ck=') || clip.includes('bili_jct='))) {
          cookieString = clip
        }
      } catch (e) {
        // ignore clipboard errors
      }
    }

    if (!cookieString) {
      return { success: false, reason: 'no-cookie' }
    }

    const res = await importCookieStringFromText(cookieString)
    return res
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function registerLoginHandlers(deps) {
  _depsRef = deps
  const { ipcMain, fetchApi, fetchApiWithHeaders, log, app } = deps

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
      const url = `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qcode}&source=main_electron_pc&web_location=0.0&x-bili-locale-json=%7B%22c_locale%22:%7B%22language%22:%22zh%22,%22region%22:%22CN%22%7D,%22always_translate%22:true%7D&b_ret=MQAAAABJRU5ErkJggg%3D%3DAFzCgAsMxYTaIooF%2BB%2FwGUsPWmkr%2B6%2BQAAAABJRU5ErkJggg%3D%3D&rnd=${Date.now()}`

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
          const cookiesBefore = cookieManager.getSavedCookies()
          log('登录成功前 - sec_ck:', cookiesBefore.sec_ck ? '存在' : '不存在')
          log('登录成功前 - sid:', cookiesBefore.sid ? '存在' : '不存在')

          log('登录成功！')

          if (loginPollInterval) {
            clearInterval(loginPollInterval)
            loginPollInterval = null
          }

          const urlObj = new URL(data.url)
          const params = urlObj.searchParams

          let savedCookies = cookieManager.getSavedCookies()

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
            const crossHeaders = {
              'Referer': 'https://www.bilibili.com/client',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.17.5 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 build/1001017006'
            }
            await fetchApiWithHeaders(data.url, crossHeaders)
            log('crossDomain 请求完成，开始从 session 读取 cookies')
          } catch (e) {
            log('请求 crossDomain 触发 Set-Cookie 失败:', e.message)
          }

          // 保存当前所有 cookie（包括 crossDomain 请求下发的 sec_ck 等），防止被 exportCookiesFromSession 中的旧 session 值覆盖
          const preExportCookies = { ...savedCookies }

          // 从 session 中导出 cookies
          try {
            log('正在通过 cookieManager.exportCookiesFromSession 导出 session cookies...')
            await cookieManager.exportCookiesFromSession(deps.mainWindow.webContents.session)
            savedCookies = cookieManager.getSavedCookies()

            // 用登录流程中获取的 cookie 覆盖旧的 session 值（preExportCookies 包含 URL 参数 + crossDomain Set-Cookie）
            Object.assign(savedCookies, preExportCookies)

            log('从 session 导出并合并 cookies 完成')
          } catch (e) {
            log('从 session 导出 cookies 失败:', e.message)
          }

          cookieManager.setSavedCookies(savedCookies)
          cookieManager.saveCookies()
          cookieManager.syncCookiesToSession(deps.mainWindow.webContents.session)

          log('最终保存的 cookies:', Object.keys(savedCookies))
          log('当前所有 cookies 详情:')
          for (const [key, value] of Object.entries(savedCookies)) {
            if (value && value.length > 0) {
              log(`  ${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`)
            }
          }
          log('sec_ck 状态:', savedCookies.sec_ck ? `存在 (${savedCookies.sec_ck.substring(0, 20)}...)` : '不存在')
          log('sid 状态:', savedCookies.sid ? `存在 (${savedCookies.sid.substring(0, 20)}...)` : '不存在')

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

  ipcMain.handle('import-cookie-string', async (event, cookieString) => {
    try {
      const res = await importCookieStringFromText(cookieString)
      return res
    } catch (e) {
      log('import-cookie-string error:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('logout', async () => {
    log('logout called')
    cookieManager.clearCookies()
    return { success: true, message: '退出登录成功' }
  })

  ipcMain.handle('get-cookies', async () => {
    return {
      success: true,
      cookies: cookieManager.getSavedCookies()
    }
  })

  ipcMain.handle('get-sec-ck', async () => {
    try {
      if (deps.mainWindow && deps.mainWindow.webContents && deps.mainWindow.webContents.session) {
        const val = await cookieManager.getCookieFromSession(deps.mainWindow.webContents.session, 'sec_ck')
        return { success: true, sec_ck: val }
      }
      return { success: false, error: 'mainWindow session not available' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 导出 session 中所有 .bilibili.com cookies 的完整信息（用于调试 sec_ck）
  ipcMain.handle('dump-session-cookies', async () => {
    try {
      if (deps.mainWindow && deps.mainWindow.webContents && deps.mainWindow.webContents.session) {
        const list = await deps.mainWindow.webContents.session.cookies.get({ domain: '.bilibili.com' })
        return { success: true, cookies: list }
      }
      return { success: false, error: 'mainWindow session not available' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 使用指定 Cookie 字符串重放追番请求并保存响应（用于对比）
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

      const result = await fetchApiWithHeaders(url, headers)

      const saveDir = path.join(path.dirname(app.getAppPath()), 'test')
      if (!fs.existsSync(saveDir)) {
        try { fs.mkdirSync(saveDir, { recursive: true }) } catch (e) {}
      }
      const savePath = path.join(saveDir, `bangumi_replay_provided_${Date.now()}.json`)
      try {
        fs.writeFileSync(savePath, JSON.stringify({ requestHeaders: headers, response: result }, null, 2), 'utf8')
        log('Replay (provided cookies) result saved to:', savePath)
      } catch (e) {
        log('Failed to save replay result:', e.message)
      }

      return { success: true, file: savePath, data: result }
    } catch (error) {
      log('Replay bangumi with cookies failed:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { tryImportCookiesOnStartup, registerLoginHandlers, importCookieStringFromText, generateRandomString }
