// IPC handlers for favorites-related operations

function registerFavoritesHandlers(deps) {
  const { ipcMain, fetchApi, log, cookieManager, fetchWbiKeys, getMixKey, signParams } = deps

  ipcMain.handle('get-favorites-list', async (event) => {
    log('get-favorites-list called')
    try {
      const url = 'https://api.bilibili.com/x/v3/fav/folder/list?up_mid=&platform=web&web_location=333.1387'
      log('Favorites list API URL:', url)
      const result = await fetchApi(url)
      log('Favorites list result code:', result.code)

      if (result.code === 0 && result.data && result.data.list) {
        const folders = result.data.list || []
        log('Favorites folders count:', folders.length)

        return {
          success: true,
          data: folders.map(item => ({
            id: item.id || '',
            mid: item.mid || '',
            name: item.title || item.name || '',
            cover: item.cover || '',
            media_count: item.media_count || 0,
            attr: item.attr || 0,
            fid: item.fid || '',
            type: item.type || 0,
            upper: item.upper || null,
            ctime: item.ctime || 0,
            mtime: item.mtime || 0
          })),
          hasMore: result.data.has_more || false,
          total: result.data.total || folders.length
        }
      } else {
        log('Favorites list API error:', result.message || 'Unknown error')
        return { success: false, error: result.message || '获取收藏夹列表失败' }
      }
    } catch (error) {
      log('Error getting favorites list:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-favorites-created', async (event) => {
    log('get-favorites-created called')
    try {
      const savedCookies = cookieManager.getSavedCookies()
      const upMid = savedCookies.DedeUserID || ''
      
      if (!upMid) {
        log('User mid not found')
        return { success: false, error: '用户未登录' }
      }

      const params = {
        up_mid: upMid,
        ps: 200,
        pn: 1,
        platform: 'pc',
        web_location: 'bilibili-electron'
      }

      const keys = await fetchWbiKeys()
      if (!keys || !keys.imgKey) {
        log('WBI keys not available')
        return { success: false, error: 'WBI签名不可用' }
      }

      const mixKey = getMixKey(keys.imgKey, keys.subKey)
      const signed = signParams(params, mixKey)

      const url = `https://api.bilibili.com/x/v3/fav/folder/created/list?up_mid=${upMid}&ps=200&pn=1&platform=pc&web_location=bilibili-electron&w_rid=${signed.w_rid}&wts=${signed.wts}`
      log('Favorites created API URL:', url)
      const result = await fetchApi(url)
      log('Favorites created result code:', result.code)

      if (result.code === 0 && result.data) {
        let folders = result.data.list || result.data || []
        log('Favorites created folders count:', folders.length)
        if (folders.length > 0) {
          log('Favorites created first folder:', JSON.stringify(folders[0]))
        }

        folders = folders.filter(item => {
          const fid = item.fid || item.id || 0
          const title = item.title || item.name || ''
          return fid !== 0 && fid !== '0' && title !== '默认收藏夹'
        })
        log('Favorites created after filter count:', folders.length)

        return {
          success: true,
          data: folders.map(item => ({
            id: item.id || '',
            mid: item.mid || '',
            name: item.title || item.name || '',
            cover: item.cover || '',
            media_count: item.media_count || 0,
            attr: item.attr || 0,
            fid: item.fid || '',
            type: item.type || 0,
            upper: item.upper || null,
            ctime: item.ctime || 0,
            mtime: item.mtime || 0
          })),
          hasMore: result.data.has_more || false,
          total: result.data.total || folders.length
        }
      } else {
        log('Favorites created API error:', result.message || 'Unknown error')
        return { success: false, error: result.message || '获取我创建的收藏夹失败' }
      }
    } catch (error) {
      log('Error getting favorites created:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-favorites', async (event, mediaId = 166434448, pageNum = 1, pageSize = 36, keyword = '') => {
    log('get-favorites called, mediaId:', mediaId, 'pageNum:', pageNum, 'pageSize:', pageSize, 'keyword:', keyword)
    try {
      const url = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${pageNum}&ps=${pageSize}&keyword=${encodeURIComponent(keyword)}&order=mtime&type=0&tid=0&platform=web&web_location=333.1387`
      log('Favorites API URL:', url)
      const result = await fetchApi(url)
      log('Favorites result code:', result.code)

      if (result.code === 0 && result.data) {
        const medias = result.data.medias || result.data.list || []
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

  ipcMain.handle('get-favorites-collected', async (event, upMid = '', pageNum = 1, pageSize = 20) => {
    log('get-favorites-collected called, upMid:', upMid, 'pageNum:', pageNum, 'pageSize:', pageSize)
    try {
      const url = `https://api.bilibili.com/x/v3/fav/folder/collected/list?up_mid=${upMid}&ps=${pageSize}&pn=${pageNum}&platform=web&web_location=333.1387`
      log('Favorites collected API URL:', url)
      const result = await fetchApi(url)
      log('Favorites collected result code:', result.code)

      if (result.code === 0 && result.data) {
        const list = result.data.list || []
        log('Favorites collected count:', list.length)

        if (list.length > 0) {
          log('First collected favorite:', list[0].name)
        }

        return {
          success: true,
          data: list.map(item => ({
            id: item.id || '',
            mid: item.mid || '',
            name: item.title || item.name || '',
            cover: item.cover || '',
            media_count: item.media_count || 0,
            attr: item.attr || 0,
            fid: item.fid || '',
            upper: item.upper || null,
            ctime: item.ctime || 0,
            mtime: item.mtime || 0,
            sub_time: item.sub_time || 0,
            count: item.count || item.media_count || 0
          })),
          hasMore: result.data.has_more || (list.length >= pageSize),
          nextPage: result.data.has_more ? pageNum + 1 : null,
          total: result.data.total || list.length
        }
      } else {
        log('Favorites collected API error:', result.message || 'Unknown error')
        return { success: false, error: result.message || '获取收藏与订阅失败' }
      }
    } catch (error) {
      log('Error getting favorites collected:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-favorites-collected-detail', async (event, seasonId = '', pageNum = 1, pageSize = 36) => {
    log('get-favorites-collected-detail called, seasonId:', seasonId, 'pageNum:', pageNum, 'pageSize:', pageSize)
    try {
      const params = {
        season_id: seasonId,
        ps: pageSize,
        pn: pageNum,
        platform: 'web',
        web_location: 'bilibili-electron'
      }

      const keys = await fetchWbiKeys()
      if (!keys || !keys.imgKey) {
        log('WBI keys not available')
        return { success: false, error: 'WBI签名不可用' }
      }

      const mixKey = getMixKey(keys.imgKey, keys.subKey)
      const signed = signParams(params, mixKey)

      const url = `https://api.bilibili.com/x/space/fav/season/list?season_id=${seasonId}&ps=${pageSize}&pn=${pageNum}&platform=web&web_location=bilibili-electron&w_rid=${signed.w_rid}&wts=${signed.wts}`
      log('Favorites collected detail API URL:', url)
      const result = await fetchApi(url)
      log('Favorites collected detail result code:', result.code)

      if (result.code === 0 && result.data) {
        const medias = result.data.medias || result.data.archives || result.data.list || []
        log('Favorites collected detail medias count:', medias.length)

        if (medias.length > 0) {
          log('First media title:', medias[0].title)
          log('First media bvid:', medias[0].bvid || medias[0].bv_id)
        }

        return {
          success: true,
          data: medias.map(item => ({
            bvid: item.bvid || item.bv_id || '',
            title: item.title || '',
            pic: item.cover || item.pic || '',
            duration: item.duration || 0,
            upper: item.upper || null,
            cnt_info: item.cnt_info || null,
            page: item.page || 1,
            intro: item.intro || '',
            ctime: item.ctime || 0,
            pubtime: item.pubtime || 0,
            media_id: item.id || seasonId
          })),
          hasMore: result.data.has_more || false,
          nextPage: result.data.has_more ? pageNum + 1 : null,
          seasonInfo: result.data.info || result.data.season || null
        }
      } else {
        log('Favorites collected detail API error:', result.message || 'Unknown error')
        return { success: false, error: result.message || '获取收藏合集详情失败' }
      }
    } catch (error) {
      log('Error getting favorites collected detail:', error.message)
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
}

module.exports = { registerFavoritesHandlers }
