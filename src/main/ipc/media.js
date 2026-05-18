function registerMediaHandlers(deps) {
  const { ipcMain, fetchApiWithHeaders, fetchApi, buildRecommendUrl, cookieManager, mainWindow, log } = deps

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
}

module.exports = { registerMediaHandlers }
