function registerBangumiHandlers(deps) {
  const { ipcMain, fetchApiWithHeaders, fetchApi, buildRecommendUrl, cookieManager, mainWindow, fetchWithRetry, log } = deps

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
}

module.exports = { registerBangumiHandlers }
