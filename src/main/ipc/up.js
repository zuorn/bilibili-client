// Helper function to extract dynamic text content
function extractDynamicText(desc, summary) {
  if (desc?.rich_text_nodes?.length) {
    return desc.rich_text_nodes.map(n => {
      if (n.type === 'RICH_TEXT_NODE_TYPE_EMOJI' && n.emoji?.icon_url) {
        return `<img class="dynamic-emoji" src="${n.emoji.icon_url}" alt="${n.text || n.orig_text || ''}" title="${n.text || n.orig_text || ''}">`
      }
      if (n.type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
        const topicName = n.text || n.orig_text || ''
        const topicId = n.rid_str || ''
        return `<span class="dynamic-topic" data-topic-id="${topicId}" data-topic-name="${topicName}">${topicName}</span>`
      }
      if (n.type === 'RICH_TEXT_NODE_TYPE_AT' && n.data?.uid) {
        // @提及用户
        const userName = n.text || n.orig_text || ''
        const uid = n.data.uid || ''
        return `<span class="dynamic-at" data-uid="${uid}">@${userName}</span>`
      }
      if (n.type === 'RICH_TEXT_NODE_TYPE_LINK') {
        // 链接
        const linkText = n.text || n.orig_text || ''
        const linkUrl = n.data?.url || ''
        // 检查是否是视频链接（包含bvid）
        const bvidMatch = linkUrl.match(/bvid=([^&]+)/)
        if (bvidMatch) {
          const bvid = bvidMatch[1]
          return `<span class="dynamic-video-link" data-bvid="${bvid}">${linkText}</span>`
        }
        return `<a class="dynamic-link" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`
      }
      return n.text || n.orig_text || ''
    }).join('')
  }
  if (desc?.text) return desc.text
  if (typeof desc === 'string' && desc) return desc
  if (!summary) return ''
  if (typeof summary === 'string') return summary
  if (summary.text) return summary.text
  if (summary.rich_text_nodes?.length) {
    return summary.rich_text_nodes.map(n => {
      if (n.type === 'RICH_TEXT_NODE_TYPE_EMOJI' && n.emoji?.icon_url) {
        return `<img class="dynamic-emoji" src="${n.emoji.icon_url}" alt="${n.text || n.orig_text || ''}" title="${n.text || n.orig_text || ''}">`
      }
      if (n.type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
        const topicName = n.text || n.orig_text || ''
        const topicId = n.rid_str || ''
        return `<span class="dynamic-topic" data-topic-id="${topicId}" data-topic-name="${topicName}">${topicName}</span>`
      }
      if (n.type === 'RICH_TEXT_NODE_TYPE_AT' && n.data?.uid) {
        // @提及用户
        const userName = n.text || n.orig_text || ''
        const uid = n.data.uid || ''
        return `<span class="dynamic-at" data-uid="${uid}">@${userName}</span>`
      }
      if (n.type === 'RICH_TEXT_NODE_TYPE_LINK') {
        // 链接
        const linkText = n.text || n.orig_text || ''
        const linkUrl = n.data?.url || ''
        // 检查是否是视频链接（包含bvid）
        const bvidMatch = linkUrl.match(/bvid=([^&]+)/)
        if (bvidMatch) {
          const bvid = bvidMatch[1]
          return `<span class="dynamic-video-link" data-bvid="${bvid}">${linkText}</span>`
        }
        return `<a class="dynamic-link" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`
      }
      return n.text || n.orig_text || ''
    }).join('')
  }
  return ''
}

function registerUpHandlers(deps) {
  const { ipcMain, fetchApi, fetchApiPost, log, cookieManager, fetchWbiKeys, getMixKey, signParams } = deps

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

  async function fetchUpCollectionsSeries(mid, pageNum = 1, pageSize = 20) {
    const params = {
      mid,
      page_num: pageNum,
      page_size: pageSize,
      web_location: 'bilibili-electron'
    }
    
    const keys = await fetchWbiKeys()
    if (!keys || !keys.imgKey) {
      log('WBI keys not available for collections series')
      throw new Error('WBI keys not available')
    }
    
    const mixKey = getMixKey(keys.imgKey, keys.subKey)
    const signed = signParams(params, mixKey)
    
    const url = `https://api.bilibili.com/x/space/seasons/series/list?mid=${mid}&page_num=${pageNum}&page_size=${pageSize}&web_location=bilibili-electron&w_rid=${signed.w_rid}&wts=${signed.wts}`
    return fetchApi(url)
  }

  async function fetchSeasonArchives(mid, seasonId, pageNum = 1, pageSize = 20) {
    const params = {
      mid,
      season_id: seasonId,
      sort_reverse: false,
      page_num: pageNum,
      page_size: pageSize,
      web_location: 'bilibili-electron'
    }
    
    const keys = await fetchWbiKeys()
    if (!keys || !keys.imgKey) {
      log('WBI keys not available for season archives')
      throw new Error('WBI keys not available')
    }
    
    const mixKey = getMixKey(keys.imgKey, keys.subKey)
    const signed = signParams(params, mixKey)
    
    const url = `https://api.bilibili.com/x/space/seasons/archives/list?mid=${mid}&season_id=${seasonId}&sort_reverse=false&page_num=${pageNum}&page_size=${pageSize}&web_location=bilibili-electron&w_rid=${signed.w_rid}&wts=${signed.wts}`
    return fetchApi(url)
  }

  ipcMain.handle('fetch-up-info', async (event, mid) => {
    log('Fetching UP info for mid:', mid)
    try {
      const data = await fetchUpInfo(mid)
      log('UP info result code:', data.code)
      return { success: true, data }
    } catch (error) {
      log('Fetch UP info error:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('fetch-up-relation', async (event, mid) => {
    log('Fetching UP relation for mid:', mid)
    try {
      const data = await fetchApi(`https://api.bilibili.com/x/web-interface/relation?mid=${mid}`)
      log('UP relation result:', JSON.stringify(data))
      log('UP relation result code:', data.code)
      if (data.code === 0 && data.data && data.data.relation) {
        const attribute = data.data.relation.attribute
        log('UP relation attribute:', attribute)
        return { success: true, attribute: attribute }
      }
      log('UP relation data:', data.data)
      return { success: false, error: data.message || '获取关注状态失败' }
    } catch (error) {
      log('Fetch UP relation error:', error.message)
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
          // 处理 modules 可能是数组或对象的情况
          let modules = item.modules || {}
          if (Array.isArray(modules)) {
            const moduleMap = {}
            modules.forEach(m => {
              if (m.module_type === 'MODULE_TYPE_AUTHOR') {
                moduleMap.module_author = m.module_author || {}
              } else if (m.module_type === 'MODULE_TYPE_DYNAMIC') {
                moduleMap.module_dynamic = m.module_dynamic || {}
              } else if (m.module_type === 'MODULE_TYPE_STAT') {
                moduleMap.module_stat = m.module_stat || {}
              } else if (m.module_type === 'MODULE_TYPE_DESC') {
                moduleMap.module_desc = m.module_desc || {}
              }
            })
            modules = moduleMap
          }
          const dynamicModule = modules.module_dynamic || {}
          const authorModule = modules.module_author || {}
          const majorModule = dynamicModule.major || {}
          const desc = modules.module_desc || dynamicModule.desc || {}
          const stat = dynamicModule.stat || {}

          const resultItem = {
            id: item.id_str || '',
            type: item.type || '',
            authorName: authorModule.name || '',
            authorFace: authorModule.face || '',
            authorMid: authorModule.mid || 0,
            pubTs: authorModule.pub_ts || 0,
            pubTime: authorModule.pub_time || '',
            desc: extractDynamicText(desc),
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

          // 支持 dyn_draw 字段（图片动态的主要存储位置）
          const dynDraw = dynamicModule.dyn_draw
          if (dynDraw?.items?.length && !resultItem.drawItems?.length) {
            resultItem.drawItems = dynDraw.items.map(d => ({
              src: d.src || '',
              width: d.width || 0,
              height: d.height || 0
            }))
          }

          // 支持 majorModule.pics 字段
          if (majorModule.pics?.length && !resultItem.drawItems?.length) {
            resultItem.drawItems = majorModule.pics.map(d => ({
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
            const opusText = extractDynamicText(null, opus.summary)
            resultItem.opusSummary = opusText
            if (opusText && !resultItem.desc) {
              resultItem.desc = opusText
            }
            const pics = opus.pics || []
            if (!resultItem.cover && pics.length > 0) {
              resultItem.cover = pics[0].url || pics[0].src || ''
            }
            if (!resultItem.drawItems?.length && pics.length > 0) {
              resultItem.drawItems = pics.map(d => ({
                src: d.url || d.src || '',
                width: d.width || 0,
                height: d.height || 0
              }))
            }
          }

          // 处理直播推荐动态
          const liveRcmd = dynamicModule.dyn_live_rcmd?.card_info?.live_play_info
          if (liveRcmd) {
            resultItem.liveRoomId = liveRcmd.room_id || 0
            resultItem.liveTitle = liveRcmd.title || ''
            resultItem.liveCover = liveRcmd.cover || ''
            resultItem.liveOnline = liveRcmd.online || 0
            resultItem.liveArea = liveRcmd.area_name || ''
            resultItem.liveLink = liveRcmd.link || ''
            resultItem.liveUid = liveRcmd.uid || 0
            if (!resultItem.cover) {
              resultItem.cover = liveRcmd.cover || ''
            }
            if (!resultItem.title) {
              resultItem.title = liveRcmd.title || ''
            }
          }

          // 处理 dyn_archive 字段
          const dynArchive = dynamicModule.dyn_archive || {}
          if (dynArchive.bvid) {
            resultItem.bvid = dynArchive.bvid || ''
            resultItem.aid = dynArchive.aid || 0
            resultItem.cid = dynArchive.cid || 0
            resultItem.title = dynArchive.title || ''
            resultItem.cover = dynArchive.cover || ''
            resultItem.duration = dynArchive.duration_text || ''
            resultItem.play = dynArchive.stat?.play || 0
            resultItem.danmaku = dynArchive.stat?.danmaku || 0
            if (dynArchive.pics?.length && !resultItem.drawItems?.length) {
              resultItem.drawItems = dynArchive.pics.map(d => ({
                src: d.src || '',
                width: d.width || 0,
                height: d.height || 0
              }))
            }
          }

          // 支持 majorModule.text 字段（纯文本动态）
          if (majorModule.text && !resultItem.desc) {
            resultItem.desc = extractDynamicText(majorModule.text)
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
            // 处理 orig.modules 可能是数组或对象的情况
            let origModules = item.orig.modules || {}
            if (Array.isArray(origModules)) {
              const moduleMap = {}
              origModules.forEach(m => {
                if (m.module_type === 'MODULE_TYPE_AUTHOR') {
                  moduleMap.module_author = m.module_author || {}
                } else if (m.module_type === 'MODULE_TYPE_DYNAMIC') {
                  moduleMap.module_dynamic = m.module_dynamic || {}
                }
              })
              origModules = moduleMap
            }

            const origDynamicModule = origModules.module_dynamic || {}
            const origAuthorModule = origModules.module_author || {}
            const origMajor = origDynamicModule.major || {}
            const origDesc = origDynamicModule.desc || {}

            resultItem.orig = {
              id: item.orig.id_str || '',
              type: item.orig.type || '',
              // 作者信息可能在 user 对象里，也可能直接在 origAuthorModule 里
              authorName: origAuthorModule.user?.name || origAuthorModule.name || '',
              authorFace: origAuthorModule.user?.face || origAuthorModule.face || '',
              desc: extractDynamicText(origDesc)
            }

            if (origMajor.archive) {
              resultItem.orig.bvid = origMajor.archive.bvid || ''
              resultItem.orig.title = origMajor.archive.title || ''
              resultItem.orig.cover = origMajor.archive.cover || ''
              resultItem.orig.duration = origMajor.archive.duration_text || ''
              resultItem.orig.play = origMajor.archive.stat?.view || 0
              resultItem.orig.danmaku = origMajor.archive.stat?.danmaku || 0
            }
            if (origMajor.draw?.items?.length) {
              resultItem.orig.drawItems = origMajor.draw.items.map(d => ({
                src: d.src || '', width: d.width || 0, height: d.height || 0
              }))
            }
            // 支持 orig 的 dyn_draw 字段
            if (origDynamicModule.dyn_draw?.items?.length && !resultItem.orig.drawItems?.length) {
              resultItem.orig.drawItems = origDynamicModule.dyn_draw.items.map(d => ({
                src: d.src || '', width: d.width || 0, height: d.height || 0
              }))
            }
            if (origMajor.pics?.length && !resultItem.orig.drawItems?.length) {
              resultItem.orig.drawItems = origMajor.pics.map(d => ({
                src: d.src || '', width: d.width || 0, height: d.height || 0
              }))
            }
            if (origMajor.article) {
              resultItem.orig.title = resultItem.orig.title || origMajor.article.title || ''
              resultItem.orig.cover = resultItem.orig.cover || origMajor.article.covers?.[0] || ''
            }
            if (origMajor.opus) {
              const origOpus = origMajor.opus
              resultItem.orig.title = resultItem.orig.title || origOpus.title || ''
              resultItem.orig.cover = resultItem.orig.cover || origOpus.cover || ''
              const origOpusText = extractDynamicText(null, origOpus.summary)
              if (origOpusText && !resultItem.orig.desc) {
                resultItem.orig.desc = origOpusText
              }
              const origPics = origOpus.pics || []
              if (!resultItem.orig.drawItems?.length && origPics.length > 0) {
                resultItem.orig.drawItems = origPics.map(d => ({
                  src: d.url || d.src || '', width: d.width || 0, height: d.height || 0
                }))
              }
            }
            // 支持 orig 的 majorModule.text 字段
            if (origMajor.text && !resultItem.orig.desc) {
              resultItem.orig.desc = extractDynamicText(origMajor.text)
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

  ipcMain.handle('modify-up-relation', async (event, mid, act) => {
    log('Modifying UP relation, mid:', mid, 'act:', act)
    try {
      const keys = await fetchWbiKeys()
      if (!keys || !keys.imgKey) {
        return { success: false, error: 'WBI keys not available' }
      }
      const mixKey = getMixKey(keys.imgKey, keys.subKey)

      const params = {
        act,
        fid: mid,
        re_src: 11,
        statistics: '{"appId":112,"platform":4}'
      }

      const signed = signParams(params, mixKey)
      const bodyParams = {
        ...params,
        w_rid: signed.w_rid,
        wts: signed.wts,
        csrf: cookieManager.getSavedCookies().bili_jct || ''
      }

      const result = await fetchApiPost('https://api.bilibili.com/x/relation/modify', bodyParams)
      log('relation.modify result code:', result.code, 'message:', result.message)
      const ok = result.code === 0 || result.code === 22014
      return { success: ok, data: result, already: result.code === 22014 }
    } catch (error) {
      log('Error modifying UP relation:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('fetch-up-collections-series', async (event, mid, pageNum = 1, pageSize = 20) => {
    log('Fetching UP collections and series for mid:', mid, 'page:', pageNum)
    try {
      const data = await fetchUpCollectionsSeries(mid, pageNum, pageSize)
      log('UP collections series result code:', data.code)
      log('UP collections series result data:', JSON.stringify(data.data))
      if (data.code === 0 && data.data) {
        const listData = data.data.items_lists || {}
        const seasonList = listData.seasons_list || []
        const seriesList = listData.series_list || []
        const allItems = [...seasonList, ...seriesList]
        return { 
          success: true, 
          data: {
            list: allItems,
            page: listData.page || {},
            total: seasonList.length + seriesList.length
          }
        }
      }
      return { success: false, error: data.message || '获取合集和系列失败' }
    } catch (error) {
      log('Error fetching UP collections series:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('fetch-season-archives', async (event, mid, seasonId, pageNum = 1, pageSize = 20) => {
    log('Fetching season archives for mid:', mid, 'seasonId:', seasonId, 'page:', pageNum)
    try {
      const data = await fetchSeasonArchives(mid, seasonId, pageNum, pageSize)
      log('Season archives result code:', data.code)
      if (data.code === 0 && data.data) {
        return { 
          success: true, 
          data: {
            list: data.data.archives || [],
            page: data.data.page || {},
            seasonInfo: data.data.meta || {}
          }
        }
      }
      return { success: false, error: data.message || '获取合集内容失败' }
    } catch (error) {
      log('Error fetching season archives:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerUpHandlers }
