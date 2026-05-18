// IPC handlers for user-related operations
const cookieManager = require('../../../cookieManager')

function registerUserHandlers(deps) {
  const { ipcMain, fetchApi, log } = deps

  ipcMain.handle('get-user-info', async () => {
    log('get-user-info called')
    try {
      const url = `https://api.bilibili.com/x/web-interface/nav?${Date.now()}`
      const result = await fetchApi(url)
      log('User info result code:', result.code)

      if (result.code === 0 && result.data) {
        const mid = result.data.mid || 0
        let viewCount = 0
        let following = 0
        let follower = 0
        let dynCount = 0

        if (mid > 0) {
          try {
            const cardResult = await fetchApi(`https://api.bilibili.com/x/web-interface/card?mid=${mid}&photo=true`)
            if (cardResult.code === 0 && cardResult.data?.card?.stat) {
              viewCount = cardResult.data.card.stat.like || 0
              log('Got view count:', viewCount)
            }
          } catch (e) {
            log('Error getting view count:', e.message)
          }

          try {
            const relationResult = await fetchApi(`https://api.bilibili.com/x/relation/stat?vmid=${mid}&web_location=bilibili-electron`)
            if (relationResult.code === 0 && relationResult.data) {
              following = relationResult.data.following || 0
              follower = relationResult.data.follower || 0
              log('Got relation stats - following:', following, 'follower:', follower)
            }
          } catch (e) {
            log('Error getting relation stats:', e.message)
          }

          try {
            const dynResult = await fetchApi(`https://api.bilibili.com/x/dynamic/feed/space/dyn_num?uid_str=${mid}&web_location=bilibili-electron`)
            if (dynResult.code === 0 && dynResult.data) {
              dynCount = dynResult.data.num || 0
              log('Got dyn count:', dynCount)
            }
          } catch (e) {
            log('Error getting dyn count:', e.message)
          }
        }

        return {
          success: true,
          data: {
            isLogin: result.data.isLogin,
            uname: result.data.uname || '未登录',
            face: result.data.face || '',
            mid: mid,
            level: result.data.level_info?.current_level || 0,
            coins: result.data.coins || 0,
            bCoins: result.data.bcoins || 0,
            vipStatus: result.data.vip?.status || 0,
            vipType: result.data.vip?.type || 0,
            following: following,
            follower: follower,
            viewCount: viewCount,
            dynCount: dynCount
          }
        }
      } else {
        return { success: false, error: '获取用户信息失败' }
      }
    } catch (error) {
      log('Error getting user info:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-user-followings', async (event, mid) => {
    log('get-user-followings called, mid:', mid)
    try {
      const url = `https://api.bilibili.com/x/relation/followings?vmid=${mid}&pn=1&ps=20&order=desc`
      const result = await fetchApi(url)
      log('Followings result code:', result.code)

      if (result.code === 0 && result.data) {
        const list = result.data.list || []
        return {
          success: true,
          data: list.map(item => ({
            mid: item.mid,
            uname: item.uname,
            face: item.face
          }))
        }
      } else {
        return { success: false, error: '获取关注列表失败' }
      }
    } catch (error) {
      log('Error getting followings:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-following-groups', async (event, mid) => {
    log('get-following-groups called, mid:', mid)
    try {
      const url = `https://api.bilibili.com/x/relation/tags?vmid=${mid}`
      const result = await fetchApi(url)
      log('Following groups result code:', result.code)

      if (result.code === 0 && result.data) {
        return {
          success: true,
          data: result.data
        }
      } else {
        return { success: false, error: '获取关注分组失败' }
      }
    } catch (error) {
      log('Error getting following groups:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-following-list', async (event, params) => {
    const { mid, tagid = -1, pn = 1, ps = 20, order = 'desc', order_type } = params || {}
    log('get-following-list called, params:', params)
    try {
      let url
      if (tagid !== -1) {
        url = `https://api.bilibili.com/x/relation/tag?tagid=${tagid}&mid=${mid}&pn=${pn}&ps=${ps}`
        if (order_type !== undefined) {
          url += `&order_type=${order_type}`
        }
      } else {
        url = `https://api.bilibili.com/x/relation/followings?vmid=${mid}&pn=${pn}&ps=${ps}&order=${order}`
      }
      const result = await fetchApi(url)
      log('Following list result code:', result.code)

      if (result.code === 0 && result.data) {
        let data = result.data
        if (tagid !== -1 && data.list === undefined) {
          if (Array.isArray(data)) {
            data = { list: data }
          } else if (data.followings !== undefined) {
            data = { list: data.followings }
          }
        }
        return {
          success: true,
          data: data
        }
      } else {
        return { success: false, error: '获取关注列表失败' }
      }
    } catch (error) {
      log('Error getting following list:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-bangumi-follow', async (event, type = 1, pageNum = 1) => {
    log('get-bangumi-follow called, type:', type, 'page:', pageNum)
    try {
      const vmid = cookieManager.getSavedCookies().DedeUserID || 320634848
      const url = `https://api.bilibili.com/x/space/bangumi/follow/list?vmid=${vmid}&type=${type}&pn=${pageNum}&ps=24&platform=web&follow_status=0`
      const result = await fetchApi(url)
      log('Bangumi follow result code:', result.code)
      log('Bangumi follow result data:', result.data ? 'exists' : 'null')
      log('Bangumi follow result data.list:', result.data?.list ? 'exists, length: ' + result.data.list.length : 'null or undefined')

      if (result.code === 0 && result.data && result.data.list) {
        log('Success: returning bangumi list with', result.data.list.length, 'items')
        return {
          success: true,
          data: result.data.list.map(item => ({
            season_id: item.season_id || 0,
            media_id: item.media_id || 0,
            title: item.title || '',
            cover: item.cover || '',
            total_count: item.total_count || 0,
            is_finish: item.is_finish || 0,
            is_started: item.is_started || 0,
            badge: item.badge || '',
            stat: item.stat || null,
            new_ep: item.new_ep || null,
            season_status: item.season_status || 0,
            url: item.url || '',
            short_url: item.short_url || ''
          })),
          hasMore: result.data.list.length >= 24
        }
      } else {
        log('Failed: bangumi list not available')
        return { success: false, error: '获取追番失败' }
      }
    } catch (error) {
      log('Error getting bangumi follow:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerUserHandlers }
