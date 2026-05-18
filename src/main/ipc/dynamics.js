// IPC handlers for dynamics-related operations

function registerDynamicsHandlers(deps) {
  const { ipcMain, fetchApi, log } = deps

  ipcMain.handle('get-dynamic-nav', async () => {
    log('get-dynamic-nav called')
    try {
      const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/nav?wts=1746216000&w_rid=abcdef1234567890abcdef12345678'
      log('Using dynamic nav API:', url)
      const result = await fetchApi(url)
      log('Dynamic nav result code:', result.code)
      log('Dynamic nav result data keys:', result.data ? Object.keys(result.data) : 'no data')
      log('Dynamic nav result full data:', JSON.stringify(result))

      if (result.code === 0 && result.data) {
        return {
          success: true,
          data: result.data
        }
      } else {
        log('Dynamic nav API error:', result.message)
        return { success: false, error: result.message || '获取动态导航失败' }
      }
    } catch (error) {
      log('Error getting dynamic nav:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-dynamic-portal', async () => {
    log('get-dynamic-portal called')
    try {
      const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/portal'
      log('Using dynamic portal API:', url)
      const result = await fetchApi(url)
      log('Dynamic portal result code:', result.code)
      log('Dynamic portal result data keys:', result.data ? Object.keys(result.data) : 'no data')

      if (result.code === 0 && result.data) {
        return {
          success: true,
          data: result.data
        }
      } else {
        log('Dynamic portal API error:', result.message)
        return { success: false, error: result.message || '获取动态门户失败' }
      }
    } catch (error) {
      log('Error getting dynamic portal:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-all-dynamics', async (event, offset = '') => {
    log('get-all-dynamics called, offset:', offset)
    try {
      const timezoneOffset = -480
      const features = 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete,onlyfansQaCard,commentsNewVersion,avatarAutoTheme,sunflowerStyle,cardsEnhance,eva3CardOpus,eva3CardVideo,eva3CardComment,eva3CardVote,eva3CardUser'
      let url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?timezone_offset=${timezoneOffset}&type=video&platform=web&features=${features}&web_location=333.1365`
      if (offset) {
        url += `&offset=${offset}`
      }
      log('Using dynamic feed API:', url)
      const result = await fetchApi(url)

      if (result.code === 0 && result.data) {
        const items = result.data.items || []
        const hasMore = result.data.has_more || false
        const nextOffset = result.data.next_offset || ''

        log('Dynamics API success, items count:', items.length)
        log('Next offset:', nextOffset)
        log('Has more:', hasMore)
        if (items.length > 0) {
          log('First item modules:', JSON.stringify(items[0].modules))
          log('Last item id:', items[items.length - 1].id)
        }

        const dynamics = items.map(item => {
          const modules = item.modules || {}
          const dynamicModule = modules.module_dynamic || {}
          const authorModule = modules.module_author || {}
          const majorModule = dynamicModule.major || {}

          let title = ''
          let thumbnail = ''
          let duration = ''
          let bvid = ''
          let aid = 0

          if (majorModule.archive) {
            title = majorModule.archive.title || ''
            bvid = majorModule.archive.bvid || ''
            aid = majorModule.archive.aid || 0
            duration = majorModule.archive.duration_text || ''
            thumbnail = majorModule.archive.cover || ''
          } else if (majorModule.opus) {
            title = majorModule.opus.title || ''
            thumbnail = majorModule.opus.cover || ''
            const pics = majorModule.opus.pics || []
            if (!thumbnail && pics.length > 0) {
              thumbnail = pics[0].url
            }
          } else if (majorModule.draw) {
            const desc = dynamicModule.desc || {}
            title = desc.text || ''
            const pics = majorModule.draw.items || []
            if (pics.length > 0) {
              thumbnail = pics[0].src || ''
            }
          }

          const desc = dynamicModule.desc || {}
          const authorName = authorModule.name || ''
          const authorFace = authorModule.face || ''
          const authorMid = authorModule.mid || 0
          const pubTs = authorModule.pub_ts || 0
          const pubTime = authorModule.pub_time || ''

          return {
            id: item.id_str || item.dynamic_id_str || '',
            bvid: bvid,
            aid: aid,
            title: title,
            thumbnail: thumbnail,
            duration: duration,
            authorName: authorName,
            authorFace: authorFace,
            authorMid: authorMid,
            desc: desc.text || '',
            pubTs: pubTs,
            pubTime: pubTime,
            type: item.type || ''
          }
        })

        let actualNextOffset = nextOffset
        if (!actualNextOffset && items.length > 0) {
          const lastItem = items[items.length - 1]
          actualNextOffset = lastItem.id_str || lastItem.dynamic_id_str || ''
          log('Using last item id as next offset:', actualNextOffset)
        }

        return {
          success: true,
          data: {
            items: dynamics,
            has_more: hasMore,
            next_offset: actualNextOffset
          }
        }
      } else {
        log('Dynamics API error, code:', result.code, 'message:', result.message)
        return { success: false, error: result.message || '获取动态失败' }
      }
    } catch (error) {
      log('Error getting dynamics:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-user-dynamics', async (event, upMid = null, offset = '') => {
    log('get-user-dynamics called, upMid:', upMid, 'offset:', offset)
    try {
      let url
      if (upMid) {
        url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=' + upMid + '&type=video'
        if (offset) url += '&offset=' + offset
      } else {
        const timezoneOffset = -480
        const features = 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete,onlyfansQaCard,commentsNewVersion,avatarAutoTheme,sunflowerStyle,cardsEnhance,eva3CardOpus,eva3CardVideo,eva3CardComment,eva3CardVote,eva3CardUser'
        url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?timezone_offset=${timezoneOffset}&type=video&platform=web&features=${features}&web_location=333.1365`
        if (offset) {
          url += `&offset=${offset}`
        }
      }
      log('Using dynamic API URL:', url)
      const result = await fetchApi(url)

      if (result.code === 0 && result.data) {
        const items = result.data.items || []
        const hasMore = result.data.has_more || false
        const nextOffset = result.data.next_offset || ''

        log('Dynamics API success, items count:', items.length)
        log('Next offset:', nextOffset)
        log('Has more:', hasMore)
        if (items.length > 0) {
          log('First item modules:', JSON.stringify(items[0].modules))
          log('Last item id:', items[items.length - 1].id)
        }

        const dynamics = items.map(item => {
          const modules = item.modules || {}
          const dynamicModule = modules.module_dynamic || {}
          const authorModule = modules.module_author || {}
          const majorModule = dynamicModule.major || {}

          let title = ''
          let thumbnail = ''
          let duration = ''
          let bvid = ''
          let aid = 0

          if (majorModule.archive) {
            title = majorModule.archive.title || ''
            bvid = majorModule.archive.bvid || ''
            aid = majorModule.archive.aid || 0
            duration = majorModule.archive.duration_text || ''
            thumbnail = majorModule.archive.cover || ''
          } else if (majorModule.opus) {
            title = majorModule.opus.title || ''
            thumbnail = majorModule.opus.cover || ''
            const pics = majorModule.opus.pics || []
            if (!thumbnail && pics.length > 0) {
              thumbnail = pics[0].url
            }
          } else if (majorModule.draw) {
            const desc = dynamicModule.desc || {}
            title = desc.text || ''
            const pics = majorModule.draw.items || []
            if (pics.length > 0) {
              thumbnail = pics[0].src || ''
            }
          }

          const desc = dynamicModule.desc || {}
          const authorName = authorModule.name || ''
          const authorFace = authorModule.face || ''
          const authorMid = authorModule.mid || 0
          const pubTs = authorModule.pub_ts || 0
          const pubTime = authorModule.pub_time || ''

          return {
            id: item.id_str || item.dynamic_id_str || '',
            bvid: bvid,
            aid: aid,
            title: title,
            thumbnail: thumbnail,
            duration: duration,
            authorName: authorName,
            authorFace: authorFace,
            authorMid: authorMid,
            desc: desc.text || '',
            pubTs: pubTs,
            pubTime: pubTime,
            type: item.type || ''
          }
        })

        let actualNextOffset = nextOffset
        if (!actualNextOffset && items.length > 0) {
          const lastItem = items[items.length - 1]
          actualNextOffset = lastItem.id_str || lastItem.dynamic_id_str || ''
          log('Using last item id as next offset:', actualNextOffset)
        }

        return {
          success: true,
          data: {
            items: dynamics,
            has_more: hasMore,
            next_offset: actualNextOffset
          }
        }
      } else {
        log('Dynamics API error, code:', result.code, 'message:', result.message)
        return { success: false, error: result.message || '获取动态失败' }
      }
    } catch (error) {
      log('Error getting dynamics:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerDynamicsHandlers }
