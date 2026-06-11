// IPC handlers for favorites-related operations

function registerFavoritesHandlers(deps) {
  const { ipcMain, fetchApi, fetchApiPost, log, cookieManager, fetchWbiKeys, getMixKey, signParams } = deps

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

  ipcMain.handle('get-favorites', async (event, mediaId = null, pageNum = 1, pageSize = 36, keyword = '') => {
    log('get-favorites called, mediaId:', mediaId, 'type:', typeof mediaId, 'pageNum:', pageNum, 'pageSize:', pageSize, 'keyword:', keyword)
    try {
      if (!mediaId && mediaId !== 0) {
        log('get-favorites error: mediaId is required')
        return { success: false, error: '缺少收藏夹ID' }
      }
      log('get-favorites: mediaId is valid, proceeding...')
      const url = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${pageNum}&ps=${pageSize}&keyword=${encodeURIComponent(keyword)}&order=mtime&type=0&tid=0&platform=web&web_location=333.1387`
      log('Favorites API URL:', url)
      const result = await fetchApi(url)
      log('Favorites result code:', result.code)

      if (result.code === 0 && result.data) {
        const medias = result.data.medias || result.data.list || []
        log('Favorites medias count:', medias.length)

        if (medias.length > 0) {
          log('First favorite title:', medias[0].title)
          log('First favorite id (raw):', medias[0].id, 'type:', typeof medias[0].id)
          log('First favorite aid (raw):', medias[0].aid, 'type:', typeof medias[0].aid)
          log('First favorite bvid:', medias[0].bvid || medias[0].bv_id)
          log('First favorite upper:', JSON.stringify(medias[0].upper))
          log('First favorite cnt_info:', JSON.stringify(medias[0].cnt_info))
          if (medias[0].resource) {
            log('First favorite resource.id:', medias[0].resource.id, 'resource.aid:', medias[0].resource.aid)
          } else {
            log('First favorite has NO resource field')
          }
        }

        // 验证映射：打印第一个 item 的 aid/id 对照
        if (medias.length > 0) {
          const f = medias[0]
          const fres = f.resource || f
          log('=== get-favorites mapping: fav_entry_id=', f.id, 'video_aid=', fres.aid || f.aid || '(none)', 'bvid=', fres.bvid || f.bv_id || '')
        }

        return {
          success: true,
          data: medias.map(item => {
            // item.id 是收藏条目的内部ID（用于取消收藏等操作），不是视频AV号
            // 视频的真实信息在 item.resource 或 item 本身中
            // aid（视频AV号）优先从 resource.aid 或 item.aid 取，不能取 item.id（那是收藏条目ID）
            const resource = item.resource || item
            const videoAid = resource.aid || item.aid || 0
            const favEntryId = item.id || 0
            return {
              id: favEntryId,           // 收藏条目ID（取消收藏/批量删除时需要）
              aid: videoAid,            // 视频AV号（添加到收藏夹时需要）
              bvid: resource.bvid || resource.bv_id || '',
              title: item.title || resource.title || '',
              pic: item.cover || resource.cover || '',
              duration: item.duration || resource.duration || 0,
              upper: item.upper || resource.upper || null,
              cnt_info: item.cnt_info || resource.cnt_info || null,
              page: item.page || resource.page || 1,
              intro: item.intro || resource.intro || '',
              ctime: item.ctime || resource.ctime || 0,
              pubtime: item.pubtime || resource.pubtime || 0,
              fav_time: item.fav_time || 0,
              media_id: mediaId
            }
          }),
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
            aid: item.id || 0,
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

  // 获取用户创建的收藏夹列表（包含默认收藏夹）
  ipcMain.handle('get-favorites-folders', async (event, rid, upMid) => {
    log('get-favorites-folders called, rid:', rid, 'upMid:', upMid)
    try {
      const savedCookies = cookieManager.getSavedCookies()
      const userId = upMid || savedCookies.DedeUserID || ''
      
      if (!userId) {
        log('User mid not found')
        return { success: false, error: '用户未登录' }
      }

      const params = {
        type: 2,
        rid: rid || '',
        up_mid: userId,
        web_location: 'bilibili-electron'
      }

      const keys = await fetchWbiKeys()
      if (!keys || !keys.imgKey) {
        log('WBI keys not available')
        return { success: false, error: 'WBI签名不可用' }
      }

      const mixKey = getMixKey(keys.imgKey, keys.subKey)
      const signed = signParams(params, mixKey)

      const url = `https://api.bilibili.com/x/v3/fav/folder/created/list-all?type=2&rid=${encodeURIComponent(rid || '')}&up_mid=${userId}&web_location=bilibili-electron&w_rid=${signed.w_rid}&wts=${signed.wts}`
      log('Favorites folders API URL:', url)
      const result = await fetchApi(url)
      log('Favorites folders result code:', result.code)

      if (result.code === 0 && result.data) {
        let folders = result.data.list || result.data || []
        log('Favorites folders count:', folders.length)

        // 日志：查看所有文件夹的名称和 ID，便于排查默认收藏夹
        // 关键调试：同时打印 id 和 fid，排查截断问题
        log('=== RAW API folder fields (first 3) ===')
        folders.slice(0, 3).forEach((f, i) => {
          log(`  Folder[${i}] RAW: id=${f.id}(type=${typeof f.id}), fid=${f.fid}(type=${typeof f.fid}), name="${f.title || f.name}", keys=${Object.keys(f).slice(0,8).join(',')}`)
        })
        folders.forEach((f, i) => {
          log(`  Folder[${i}]: id=${f.id || f.fid}, fid=${f.fid}, name="${f.title || f.name}"`)
        })

        // 检测默认收藏夹：名称为"默认收藏夹"的即为默认
        let hasDefault = false
        folders = folders.map(item => {
          const name = item.title || item.name || ''
          if (name === '默认收藏夹') {
            hasDefault = true
          }
          return {
            ...item,
            is_default: name === '默认收藏夹'
          }
        })

        // API 没有返回默认收藏夹时，手动添加一个
        if (!hasDefault) {
          const defaultFolder = {
            id: 0,
            fid: 0,
            title: '默认收藏夹',
            name: '默认收藏夹',
            cover: '',
            media_count: 0,
            attr: 0,
            type: 2,
            mid: userId,
            ctime: 0,
            mtime: 0,
            is_default: true
          }
          folders.unshift(defaultFolder)
        }

        // 默认收藏夹置顶
        const defaultIdx = folders.findIndex(f => f.is_default)
        if (defaultIdx > 0) {
          const defaultItem = folders.splice(defaultIdx, 1)[0]
          folders.unshift(defaultItem)
        }

        // 验证最终返回给前端的 fid 值
        const mappedFolders = folders.map(item => ({
          id: item.id || item.fid || '',
          fid: item.fid || item.id || '',
          mid: item.mid || '',
          name: item.title || item.name || '',
          cover: item.cover || '',
          media_count: item.media_count || 0,
          attr: item.attr || 0,
          type: item.type || 2,
          ctime: item.ctime || 0,
          mtime: item.mtime || 0,
          is_default: item.is_default || false
        }))
        log('=== Mapped folders to send to renderer (first 3) ===')
        mappedFolders.slice(0, 3).forEach((m, i) => {
          log(`  Mapped[${i}]: id=${m.id}, fid=${m.fid}(type=${typeof m.fid}), name="${m.name}", is_default=${m.is_default}`)
        })

        return {
          success: true,
          data: mappedFolders
        }
      } else {
        log('Favorites folders API error:', result.message || 'Unknown error')
        return { success: false, error: result.message || '获取收藏夹列表失败' }
      }
    } catch (error) {
      log('Error getting favorites folders:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 取消收藏（批量移除收藏夹中的资源）
  ipcMain.handle('unfavorite-video', async (event, params) => {
    log('unfavorite-video called, params:', params)
    try {
      const { resources, media_id } = params || {}

      if (!resources) {
        return { success: false, error: '缺少资源ID' }
      }
      if (!media_id && media_id !== 0) {
        return { success: false, error: '缺少收藏夹ID' }
      }

      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''

      if (!csrf) {
        return { success: false, error: '缺少CSRF Token' }
      }

      // WBI 签名参数
      const signParamsInput = {
        resources: String(resources),
        media_id: String(media_id)
      }

      const keys = await fetchWbiKeys()
      if (!keys || !keys.imgKey) {
        log('WBI keys not available')
        return { success: false, error: 'WBI签名不可用' }
      }

      const mixKey = getMixKey(keys.imgKey, keys.subKey)
      const signed = signParams(signParamsInput, mixKey)

      const bodyParams = {
        ...signParamsInput,
        csrf: csrf,
        platform: 'pc',
        web_location: 'bilibili-electron',
        w_rid: signed.w_rid,
        wts: signed.wts
      }

      log('Unfavorite API params:', bodyParams)
      const result = await fetchApiPost('https://api.bilibili.com/x/v3/fav/resource/batch-del', bodyParams)
      log('Unfavorite result code:', result.code, 'message:', result.message)

      if (result.code === 0) {
        return { success: true, data: result.data }
      } else {
        return { success: false, error: result.message || '取消收藏失败' }
      }
    } catch (error) {
      log('Error unfavoriting video:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 完成收藏操作
  ipcMain.handle('add-to-favorites', async (event, params) => {
    log('add-to-favorites called, params:', params)
    try {
      const { rid, type, add_media_ids } = params
      
      if (!rid) {
        return { success: false, error: '缺少视频ID' }
      }

      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''
      
      if (!csrf) {
        return { success: false, error: '缺少CSRF Token' }
      }

      // 构造 WBI 签名参数（不包含 csrf）
      // add_media_ids 是必填参数，必须包含在签名和 body 中
      let addMediaIdsStr = ''
      if (add_media_ids) {
        const ids = Array.isArray(add_media_ids) ? add_media_ids : [add_media_ids]
        const validIds = ids.filter(id => id >= 0)
        if (validIds.length > 0) {
          addMediaIdsStr = validIds.join(',')
        }
      }

      const signParamsInput = {
        rid: rid,
        type: type || 2,
        add_media_ids: addMediaIdsStr
      }

      const keys = await fetchWbiKeys()
      if (!keys || !keys.imgKey) {
        log('WBI keys not available')
        return { success: false, error: 'WBI签名不可用' }
      }

      const mixKey = getMixKey(keys.imgKey, keys.subKey)
      const signed = signParams(signParamsInput, mixKey)

      // POST body：WBI 签名参数 + csrf + w_rid/wts
      const bodyParams = {
        ...signParamsInput,
        csrf: csrf,
        platform: 'pc',
        web_location: 'bilibili-electron',
        w_rid: signed.w_rid,
        wts: signed.wts
      }

      log('Favorites deal API params:', bodyParams)
      const result = await fetchApiPost('https://api.bilibili.com/x/v3/fav/resource/deal', bodyParams)
      log('Favorites deal result code:', result.code, 'message:', result.message)

      if (result.code === 0) {
        return { success: true, data: result.data }
      } else {
        return { success: false, error: result.message || '收藏失败' }
      }
    } catch (error) {
      log('Error adding to favorites:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('add-favorite-folder', async (event, { title, isPublic = true }) => {
    log('add-favorite-folder called, title:', title, 'isPublic:', isPublic)
    try {
      if (!title || title.trim() === '') {
        return { success: false, error: '收藏夹名称不能为空' }
      }

      const trimmedTitle = title.trim()
      if (trimmedTitle.length > 20) {
        return { success: false, error: '收藏夹名称不能超过20字' }
      }

      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''

      if (!csrf) {
        return { success: false, error: '缺少CSRF Token' }
      }

      // privacy: 0 = 公开, 1 = 私密
      const privacy = isPublic ? 0 : 1

      const bodyParams = {
        title: trimmedTitle,
        public: isPublic,
        privacy: privacy,
        csrf: csrf
      }

      log('Add favorite folder API params:', bodyParams)
      const result = await fetchApiPost('https://api.bilibili.com/x/v3/fav/folder/add', bodyParams)
      log('Add favorite folder result code:', result.code, 'message:', result.message)

      if (result.code === 0) {
        return { success: true, data: result.data }
      } else {
        return { success: false, error: result.message || '创建收藏夹失败' }
      }
    } catch (error) {
      log('Error adding favorite folder:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 删除收藏夹
  ipcMain.handle('delete-favorites-folder', async (event, mediaIds) => {
    log('delete-favorites-folder called, mediaIds:', mediaIds)
    try {
      if (!mediaIds) {
        return { success: false, error: '缺少收藏夹ID' }
      }

      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''

      if (!csrf) {
        return { success: false, error: '缺少CSRF Token' }
      }

      const bodyParams = {
        media_ids: String(mediaIds),
        csrf: csrf,
        platform: 'web',
        jsonp: 'jsonp'
      }

      log('Delete favorites folder API params:', bodyParams)
      const result = await fetchApiPost('https://api.bilibili.com/x/v3/fav/folder/del', bodyParams)
      log('Delete favorites folder result code:', result.code, 'message:', result.message)

      if (result.code === 0) {
        return { success: true, data: result.data }
      } else {
        return { success: false, error: result.message || '删除收藏夹失败' }
      }
    } catch (error) {
      log('Error deleting favorites folder:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 收藏夹排序
  ipcMain.handle('sort-favorites', async (event, sortIds) => {
    log('sort-favorites called, sortIds:', sortIds)
    try {
      if (!sortIds || sortIds.trim() === '') {
        return { success: false, error: '缺少排序ID列表' }
      }

      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''

      if (!csrf) {
        return { success: false, error: '缺少CSRF Token' }
      }

      const bodyParams = {
        sort: sortIds,
        csrf: csrf
      }

      log('Sort favorites API params:', bodyParams)
      const result = await fetchApiPost('https://api.bilibili.com/x/v3/fav/folder/sort', bodyParams)
      log('Sort favorites result code:', result.code, 'message:', result.message)

      if (result.code === 0) {
        return { success: true, data: result.data }
      } else {
        return { success: false, error: result.message || '排序失败' }
      }
    } catch (error) {
      log('Error sorting favorites:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 清空失效内容
  ipcMain.handle('clean-favorites-expired', async (event, mediaId = null) => {
    log('clean-favorites-expired called, mediaId:', mediaId)
    try {
      if (!mediaId && mediaId !== 0) {
        log('clean-favorites-expired error: mediaId is required')
        return { success: false, error: '缺少收藏夹ID' }
      }
      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''

      if (!csrf) {
        return { success: false, error: '缺少CSRF Token' }
      }

      const bodyParams = {
        media_id: mediaId,
        platform: 'web',
        csrf: csrf
      }

      log('Clean favorites expired API params:', bodyParams)
      const result = await fetchApiPost('https://api.bilibili.com/x/v3/fav/resource/clean', bodyParams)
      log('Clean favorites expired result code:', result.code, 'message:', result.message)

      if (result.code === 0) {
        return { success: true, data: result.data }
      } else {
        return { success: false, error: result.message || '清空失效内容失败' }
      }
    } catch (error) {
      log('Error cleaning favorites expired:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 编辑收藏夹
  ipcMain.handle('edit-favorites-folder', async (event, { mediaId, title, isPublic = true }) => {
    log('edit-favorites-folder called, mediaId:', mediaId, 'title:', title, 'isPublic:', isPublic)
    try {
      if (!mediaId) {
        return { success: false, error: '缺少收藏夹ID' }
      }

      if (!title || title.trim() === '') {
        return { success: false, error: '收藏夹名称不能为空' }
      }

      const trimmedTitle = title.trim()
      if (trimmedTitle.length > 20) {
        return { success: false, error: '收藏夹名称不能超过20字' }
      }

      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''

      if (!csrf) {
        return { success: false, error: '缺少CSRF Token' }
      }

      // privacy: 0 = 公开, 1 = 私密
      const privacy = isPublic ? 0 : 1

      const bodyParams = {
        title: trimmedTitle,
        public: isPublic,
        media_id: mediaId,
        privacy: privacy,
        csrf: csrf,
        platform: 'web',
        jsonp: 'jsonp'
      }

      log('Edit favorites folder API params:', bodyParams)
      const result = await fetchApiPost('https://api.bilibili.com/x/v3/fav/folder/edit', bodyParams)
      log('Edit favorites folder result code:', result.code, 'message:', result.message)

      if (result.code === 0) {
        return { success: true, data: result.data }
      } else {
        return { success: false, error: result.message || '编辑收藏夹失败' }
      }
    } catch (error) {
      log('Error editing favorites folder:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerFavoritesHandlers }
