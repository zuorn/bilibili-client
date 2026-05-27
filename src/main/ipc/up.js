function registerUpHandlers(deps) {
  const { ipcMain, fetchApi, log, fetchWbiKeys, getMixKey, signParams } = deps

  // Helper functions
  function fetchUpInfo(mid) {
    return fetchApi(`https://api.bilibili.com/x/web-interface/card?mid=${mid}&photo=true`)
  }

  function fetchUpVideos(mid, offset = '') {
    let url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}&type=video`
    if (offset) {
      url += `&offset=${offset}`
    }
    return fetchApi(url)
  }

  ipcMain.handle('fetch-up-info', async (event, mid) => {
    console.log('Fetching UP info for mid:', mid)
    try {
      const data = await fetchUpInfo(mid)
      console.log('UP info result code:', data.code)
      return { success: true, data }
    } catch (error) {
      console.error('Fetch UP info error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('fetch-up-videos', async (event, mid, offset = '') => {
    console.log('Fetching UP videos for mid:', mid, 'offset:', offset)
    try {
      const data = await fetchUpVideos(mid, offset)
      console.log('UP videos result code:', data.code)
      return { success: true, data }
    } catch (error) {
      console.error('Fetch UP videos error:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('fetch-up-dynamics', async (event, mid, offset = '') => {
    log('fetch-up-dynamics called, mid:', mid, 'offset:', offset)
    try {
      // 使用更简单正确的API端点
      let url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}&timezone_offset=-480&platform=web`
      if (offset) {
        url += `&offset=${offset}`
      }
      
      log('Using UP dynamics API:', url)
      const result = await fetchApi(url)
      log('UP dynamics result code:', result.code)

      if (result.code === 0 && result.data) {
        const items = result.data.items || []
        const hasMore = result.data.has_more || false
        const nextOffset = result.data.offset || ''

        log('UP dynamics items count:', items.length, 'hasMore:', hasMore, 'nextOffset:', nextOffset)

        const dynamics = items.map(item => {
          const modules = item.modules || {}
          const dynamicModule = modules.module_dynamic || {}
          const authorModule = modules.module_author || {}
          const majorModule = dynamicModule.major || {}
          const desc = dynamicModule.desc || {}
          const stat = dynamicModule.stat || {}

          const resultItem = {
            id: item.id_str || '',
            type: item.type || '',
            authorName: authorModule.name || '',
            authorFace: authorModule.face || '',
            authorMid: authorModule.mid || 0,
            pubTs: authorModule.pub_ts || 0,
            pubTime: authorModule.pub_time || '',
            desc: desc.text || '',
            view: stat.view || 0,
            like: stat.like || 0,
            forward_count: stat.forward || 0,
            comment: stat.comment || 0
          }

          // Video content
          if (majorModule.archive) {
            const archive = majorModule.archive
            resultItem.bvid = archive.bvid || ''
            resultItem.aid = archive.aid || 0
            resultItem.cid = archive.cid || 0
            resultItem.title = archive.title || ''
            resultItem.cover = archive.cover || ''
            resultItem.duration = archive.duration_text || ''
            resultItem.play = archive.stat?.view || 0
            resultItem.danmaku = archive.stat?.danmaku || 0
          }

          // Image/draw content
          if (majorModule.draw) {
            const drawItems = majorModule.draw.items || []
            resultItem.drawItems = drawItems.map(d => ({
              src: d.src || '',
              width: d.width || 0,
              height: d.height || 0
            }))
          }

          // Opus (general post)
          if (majorModule.opus) {
            const opus = majorModule.opus
            resultItem.title = resultItem.title || opus.title || ''
            resultItem.cover = resultItem.cover || opus.cover || ''
            const pics = opus.pics || []
            if (!resultItem.cover && pics.length > 0) {
              resultItem.cover = pics[0].url || ''
            }
            resultItem.opusSummary = opus.summary || ''
          }

          // Article
          if (majorModule.article) {
            const article = majorModule.article
            resultItem.title = resultItem.title || article.title || ''
            resultItem.cover = resultItem.cover || article.covers?.[0] || ''
            resultItem.articleDesc = article.desc || ''
            resultItem.articleId = article.id || 0
          }

          // Forward content (orig)
          if (item.orig) {
            const origModules = item.orig.modules || {}
            const origDynamicModule = origModules.module_dynamic || {}
            const origAuthorModule = origModules.module_author || {}
            const origMajor = origDynamicModule.major || {}
            const origDesc = origDynamicModule.desc || {}

            resultItem.orig = {
              id: item.orig.id_str || '',
              type: item.orig.type || '',
              authorName: origAuthorModule.name || '',
              authorFace: origAuthorModule.face || '',
              desc: origDesc.text || ''
            }

            if (origMajor.archive) {
              resultItem.orig.bvid = origMajor.archive.bvid || ''
              resultItem.orig.title = origMajor.archive.title || ''
              resultItem.orig.cover = origMajor.archive.cover || ''
              resultItem.orig.duration = origMajor.archive.duration_text || ''
            }
            if (origMajor.draw) {
              resultItem.orig.drawItems = (origMajor.draw.items || []).map(d => ({
                src: d.src || '', width: d.width || 0, height: d.height || 0
              }))
            }
            if (origMajor.article) {
              resultItem.orig.title = resultItem.orig.title || origMajor.article.title || ''
              resultItem.orig.cover = resultItem.orig.cover || origMajor.article.covers?.[0] || ''
            }
            if (origMajor.opus) {
              resultItem.orig.title = resultItem.orig.title || origMajor.opus.title || ''
              resultItem.orig.cover = resultItem.orig.cover || origMajor.opus.cover || ''
            }
          }

          return resultItem
        })

        log('Processed dynamics:', dynamics.length)
        return {
          success: true,
          data: { items: dynamics, has_more: hasMore, offset: nextOffset }
        }
      } else {
        log('UP dynamics API failed:', result.message)
        return { success: false, error: result.message || '获取动态失败' }
      }
    } catch (error) {
      log('Error fetching UP dynamics:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerUpHandlers }
