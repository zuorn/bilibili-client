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
  const { ipcMain, fetchWithRetry, buildRecommendUrl, fetchApi, log } = deps

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
}

module.exports = { registerFeedsHandlers }
