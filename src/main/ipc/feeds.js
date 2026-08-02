// getHotTagFromData helper function used by the hot search handler
function getHotTagFromData(item) {
  const showName = item.show_name || ''
  if (showName.includes('新') || showName.includes('回归')) return '新'
  if (showName.includes('独家')) return '独家'
  if (showName.includes('番') || showName.includes('动画')) return 'bangumi'
  if (showName.includes('视频') || showName.includes('直播')) return 'video'
  return ''
}

function registerFeedsHandlers(deps) {
  const { ipcMain, fetchWithRetry, buildRecommendUrl, fetchApi, log, fetchWbiKeys, getMixKey, signParams } = deps

  ipcMain.handle('test-ipc', async () => {
    console.log('Test IPC called')
    return { success: true, message: 'IPC works!', data: [1, 2, 3] }
  })

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

  ipcMain.handle('search-videos', async (event, keyword, page = 1, searchType = 'all', order = 'totalrank') => {
    log('search-videos called, keyword:', keyword, 'page:', page, 'type:', searchType, 'order:', order)

    try {
      // 根据搜索类型确定 page_size、search_type、ad_resource
      const typeConfig = {
        'all':            { pageSize: 42, searchType: null,     adResource: '5646' },
        'video':          { pageSize: 42, searchType: 'video',  adResource: '5654' },
        'media_bangumi':  { pageSize: 12, searchType: 'media_bangumi', adResource: '5646' },
        'media_ft':       { pageSize: 12, searchType: 'media_ft',      adResource: '5646' },
        'bili_user':      { pageSize: 36, searchType: 'bili_user',     adResource: '5646' }
      }
      const config = typeConfig[searchType] || typeConfig['all']

      // 构建请求参数（参与 WBI 签名），对齐真实 Bilibili 搜索接口参数
      const params = {
        keyword: keyword,
        page: page,
        page_size: config.pageSize,
        platform: 'pc',
        highlight: 1,
        single_column: 0,
        from_source: 'web_search',
        from_spmid: '333.337',
        source_tag: 3,
        web_location: '1430654',
        ad_resource: config.adResource,
        __refresh__: 'true',
        _extra: '',
        context: '',
        pubtime_begin_s: 0,
        pubtime_end_s: 0,
        category_id: '',
        gaia_vtoken: ''
      }

      if (config.searchType) {
        params.search_type = config.searchType
      }

      // 综合搜索特有参数
      if (searchType === 'all') {
        params.duration = ''
        params.web_roll_page = 1
      }

      // 视频搜索支持排序参数
      if (searchType === 'video') {
        params.dynamic_offset = 0
        params.web_roll_page = 1
      }

      // 视频和综合搜索始终发送 order 参数（综合排序为空字符串，与 B站接口对齐）
      if (searchType === 'all' || searchType === 'video') {
        params.order = (order && order !== 'totalrank') ? order : ''
      }

      // 番剧搜索
      if (searchType === 'media_bangumi') {
        params.duration = ''
        params.order = ''
      }

      // 影视搜索
      if (searchType === 'media_ft') {
        params.duration = ''
        params.order = ''
      }

      // 用户搜索需要额外参数
      if (searchType === 'bili_user') {
        params.order_sort = 0
        params.user_type = 0
        params.dynamic_offset = 0
      }

      // WBI 签名
      const keys = await fetchWbiKeys()
      if (!keys || !keys.imgKey) {
        log('WBI keys 获取失败，尝试不带签名请求')
        // 不带签名直接请求作为后备
        const baseUrl = config.searchType
          ? 'https://api.bilibili.com/x/web-interface/wbi/search/type'
          : 'https://api.bilibili.com/x/web-interface/wbi/search/all/v2'
        const queryString = Object.keys(params)
          .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
          .join('&')
        const endpoint = `${baseUrl}?${queryString}`
        const result = await fetchWithRetry(endpoint)
        if (result.success && result.data.code === 0) {
          return { success: true, data: result.data }
        }
        return { success: false, error: '搜索失败' }
      }

      const mixKey = getMixKey(keys.imgKey, keys.subKey)
      const signed = signParams(params, mixKey)

      // 拼接最终 URL（签名参数 w_rid 和 wts 附加到末尾）
      const allParams = { ...params, w_rid: signed.w_rid, wts: signed.wts }
      const queryString = Object.keys(allParams)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(allParams[k]))}`)
        .join('&')

      const baseUrl = config.searchType
        ? 'https://api.bilibili.com/x/web-interface/wbi/search/type'
        : 'https://api.bilibili.com/x/web-interface/wbi/search/all/v2'
      const endpoint = `${baseUrl}?${queryString}`

      log('Using search endpoint:', endpoint.substring(0, 120) + '...')
      const result = await fetchWithRetry(endpoint)
      if (result.success && result.data.code === 0) {
        log('Search API成功, code:', result.data.code)
        return { success: true, data: result.data }
      }

      log('Search API失败, code:', result.data?.code, 'message:', result.data?.message)
      return { success: false, error: result.data?.message || '搜索失败' }
    } catch (error) {
      log('Search API错误:', error.message)
      return { success: false, error: error.message }
    }
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

      if (tab === 'comprehensive' || typeof tab === 'number') {
        // 综合热门接口
        endpoint = `https://api.bilibili.com/x/web-interface/popular?ps=40&pn=${page}&web_location=bilibili-electron`
        log('Using popular endpoint:', endpoint)
        result = await fetchWithRetry(endpoint)
      } else if (tab === 'ranking') {
        // 排行榜接口
        endpoint = `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all&ps=30&pn=${page}&web_location=bilibili-electron`
        log('Using ranking/v2 endpoint:', endpoint)
        result = await fetchWithRetry(endpoint)
      } else if (tab === 'weekly') {
        // 先获取最新期数
        let latestNumber = 375
        try {
          const listEndpoint = 'https://api.bilibili.com/x/web-interface/popular/series/list'
          const listResult = await fetchWithRetry(listEndpoint)
          if (listResult && listResult.success && listResult.data?.code === 0) {
            const seriesList = listResult.data?.data?.list || []
            if (seriesList.length > 0) {
              latestNumber = seriesList[0].number
            }
          }
        } catch (e) {
          log('获取每周必看期数列表失败，使用默认值:', e.message)
        }

        // 每周必看接口需要 WBI 签名
        const params = { number: latestNumber, web_location: 'bilibili-electron' }
        const keys = await fetchWbiKeys()
        const mixKey = getMixKey(keys.imgKey, keys.subKey)
        const signed = signParams(params, mixKey)
        endpoint = `https://api.bilibili.com/x/web-interface/popular/series/one?number=${latestNumber}&web_location=bilibili-electron&w_rid=${signed.w_rid}&wts=${signed.wts}`
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
}

module.exports = { registerFeedsHandlers }
