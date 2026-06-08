// IPC handlers for dynamics-related operations

const DYNAMIC_FEATURES = 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete'

function extractDynamicText(desc, summary) {
  if (desc?.rich_text_nodes?.length) {
    return desc.rich_text_nodes.map(n => {
      if (n.type === 'RICH_TEXT_NODE_TYPE_EMOJI' && n.emoji?.icon_url) {
        // 将emoji转换为图片标签
        return `<img class="dynamic-emoji" src="${n.emoji.icon_url}" alt="${n.text || n.orig_text || ''}" title="${n.text || n.orig_text || ''}">`
      }
      if (n.type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
        // 将话题标签转换为可点击的链接
        const topicName = n.text || n.orig_text || ''
        const topicId = n.rid_str || ''
        return `<span class="dynamic-topic" data-topic-id="${topicId}" data-topic-name="${topicName}">${topicName}</span>`
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
        // 将emoji转换为图片标签
        return `<img class="dynamic-emoji" src="${n.emoji.icon_url}" alt="${n.text || n.orig_text || ''}" title="${n.text || n.orig_text || ''}">`
      }
      if (n.type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
        // 将话题标签转换为可点击的链接
        const topicName = n.text || n.orig_text || ''
        const topicId = n.rid_str || ''
        return `<span class="dynamic-topic" data-topic-id="${topicId}" data-topic-name="${topicName}">${topicName}</span>`
      }
      return n.text || n.orig_text || ''
    }).join('')
  }
  return ''
}

function mapPicItems(pics) {
  return (pics || []).map(pic => ({
    src: pic.src || pic.url || '',
    width: pic.width || 0,
    height: pic.height || 0
  })).filter(p => p.src)
}

function parseDynamicItem(item, log) {
  // 处理 modules 可能是数组或对象的情况
  let modules = item.modules || {}

  // 如果 modules 是数组，转换为对象格式
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
  const statModule = modules.module_stat || {}
  const dynStat = dynamicModule.stat || {}

  // 输出动态类型用于调试
  if (log) log('[动态解析] 动态类型:', item.type, '模块类型:', dynamicModule.type)

  // 输出转发动态的文字内容
  if (item.type === 'DYNAMIC_TYPE_FORWARD' && log) {
    log('[转发动态] 文字内容:', extractDynamicText(desc))
    log('[转发动态] desc对象:', JSON.stringify(desc))
  }

  // 输出直播推荐动态的完整数据结构
  if (item.type === 'DYNAMIC_TYPE_LIVE_RCMD' && log) {
    log('[直播推荐动态] 完整数据:', JSON.stringify(dynamicModule))
  }

  const resultItem = {
    id: item.id_str || item.dynamic_id_str || '',
    type: item.type || '',
    // 作者信息可能在 user 对象里，也可能直接在 authorModule 里
    authorName: authorModule.user?.name || authorModule.name || '',
    authorFace: authorModule.user?.face || authorModule.face || '',
    authorMid: authorModule.user?.mid || authorModule.mid || 0,
    // pub_ts 可能是数字或字符串
    pubTs: parseInt(authorModule.pub_ts) || 0,
    // pub_time 可能是 pub_text 或 pub_time
    pubTime: authorModule.pub_text || authorModule.pub_time || '',
    desc: extractDynamicText(desc),
    like: statModule.like?.count ?? dynStat.like ?? 0,
    comment: statModule.comment?.count ?? dynStat.comment ?? 0,
    forward_count: statModule.forward?.count ?? dynStat.forward ?? 0,
    bvid: '',
    aid: 0,
    cid: 0,
    title: '',
    thumbnail: '',
    cover: '',
    duration: '',
    play: 0,
    danmaku: 0,
    drawItems: []
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
    // 设置封面和标题用于显示
    if (!resultItem.cover) {
      resultItem.cover = liveRcmd.cover || ''
      resultItem.thumbnail = liveRcmd.cover || ''
    }
    if (!resultItem.title) {
      resultItem.title = liveRcmd.title || ''
    }
  }

  const dynArchive = dynamicModule.dyn_archive || {}

  if (dynArchive.bvid) {
    resultItem.bvid = dynArchive.bvid || ''
    resultItem.aid = dynArchive.aid || 0
    resultItem.cid = dynArchive.cid || 0
    resultItem.title = dynArchive.title || ''
    resultItem.cover = dynArchive.cover || ''
    resultItem.thumbnail = dynArchive.cover || ''
    resultItem.duration = dynArchive.duration_text || ''
    resultItem.play = dynArchive.stat?.play || 0
    resultItem.danmaku = dynArchive.stat?.danmaku || 0
  }

  if (majorModule.archive) {
    const archive = majorModule.archive
    resultItem.bvid = resultItem.bvid || archive.bvid || ''
    resultItem.aid = resultItem.aid || archive.aid || 0
    resultItem.cid = resultItem.cid || archive.cid || 0
    resultItem.title = resultItem.title || archive.title || ''
    resultItem.cover = resultItem.cover || archive.cover || ''
    resultItem.thumbnail = resultItem.thumbnail || archive.cover || ''
    resultItem.duration = resultItem.duration || archive.duration_text || ''
    resultItem.play = resultItem.play || archive.stat?.view || 0
    resultItem.danmaku = resultItem.danmaku || archive.stat?.danmaku || 0
  }

  if (majorModule.draw?.items?.length) {
    resultItem.drawItems = mapPicItems(majorModule.draw.items)
    if (!resultItem.thumbnail && resultItem.drawItems.length > 0) {
      resultItem.thumbnail = resultItem.drawItems[0].src
      resultItem.cover = resultItem.thumbnail
    }
  }

  // 支持 dyn_draw 字段（图片动态的主要存储位置）
  if (dynamicModule.dyn_draw?.items?.length && !resultItem.drawItems.length) {
    console.log('[动态解析] 检测到 dyn_draw 字段，图片数量:', dynamicModule.dyn_draw.items.length)
    console.log('[动态解析] 图片详情:', JSON.stringify(dynamicModule.dyn_draw.items.map(item => ({
      width: item.width,
      height: item.height,
      src: item.src
    }))))
    resultItem.drawItems = mapPicItems(dynamicModule.dyn_draw.items)
    if (!resultItem.thumbnail && resultItem.drawItems.length > 0) {
      resultItem.thumbnail = resultItem.drawItems[0].src
      resultItem.cover = resultItem.thumbnail
    }
  }

  if (majorModule.pics?.length && !resultItem.drawItems.length) {
    resultItem.drawItems = mapPicItems(majorModule.pics)
    if (!resultItem.thumbnail && resultItem.drawItems.length > 0) {
      resultItem.thumbnail = resultItem.drawItems[0].src
      resultItem.cover = resultItem.thumbnail
    }
  }

  // 支持 dynArchive.pics 字段（图片动态可能存储在这里）
  if (dynArchive.pics?.length && !resultItem.drawItems.length) {
    resultItem.drawItems = mapPicItems(dynArchive.pics)
    if (!resultItem.thumbnail && resultItem.drawItems.length > 0) {
      resultItem.thumbnail = resultItem.drawItems[0].src
      resultItem.cover = resultItem.thumbnail
    }
  }

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
    if (!resultItem.drawItems.length && pics.length > 0) {
      resultItem.drawItems = mapPicItems(pics)
      if (!resultItem.thumbnail && resultItem.drawItems.length > 0) {
        resultItem.thumbnail = resultItem.drawItems[0].src
        resultItem.cover = resultItem.thumbnail
      }
    } else {
      resultItem.thumbnail = resultItem.thumbnail || resultItem.cover
    }
  }

  if (majorModule.article) {
    const article = majorModule.article
    resultItem.title = resultItem.title || article.title || ''
    resultItem.cover = resultItem.cover || article.covers?.[0] || ''
    resultItem.thumbnail = resultItem.thumbnail || resultItem.cover
    resultItem.articleDesc = article.desc || ''
    resultItem.articleId = article.id || 0
  }

  // 处理转发动态 - 支持 item.orig、dynamicModule.orig 和 dynamicModule.dyn_forward.item 三种数据结构
  const origData = item.orig || dynamicModule.orig || dynamicModule.dyn_forward?.item
  if (origData) {
    // 处理 orig.modules 可能是数组或对象的情况
    let origModules = origData.modules || {}
    if (Array.isArray(origModules)) {
      const moduleMap = {}
      origModules.forEach(m => {
        if (m.module_type === 'MODULE_TYPE_AUTHOR') {
          moduleMap.module_author = m.module_author || {}
        } else if (m.module_type === 'MODULE_TYPE_DYNAMIC') {
          moduleMap.module_dynamic = m.module_dynamic || {}
        } else if (m.module_type === 'MODULE_TYPE_STAT') {
          moduleMap.module_stat = m.module_stat || {}
        }
      })
      origModules = moduleMap
    }

    const origDynamicModule = origModules.module_dynamic || {}
    const origAuthorModule = origModules.module_author || {}
    const origMajor = origDynamicModule.major || {}
    const origDesc = origDynamicModule.desc || {}

    resultItem.orig = {
      id: origData.id_str || '',
      type: origData.type || '',
      // 作者信息可能在 user 对象里，也可能直接在 origAuthorModule 里
      authorName: origAuthorModule.user?.name || origAuthorModule.name || '',
      authorFace: origAuthorModule.user?.face || origAuthorModule.face || '',
      desc: extractDynamicText(origDesc)
    }

    if (origMajor.archive) {
      resultItem.orig.bvid = origMajor.archive.bvid || ''
      resultItem.orig.cid = origMajor.archive.cid || 0
      resultItem.orig.title = origMajor.archive.title || ''
      resultItem.orig.cover = origMajor.archive.cover || ''
      resultItem.orig.duration = origMajor.archive.duration_text || ''
      resultItem.orig.play = origMajor.archive.stat?.view || 0
      resultItem.orig.danmaku = origMajor.archive.stat?.danmaku || 0
    }
    if (origMajor.draw?.items?.length) {
      resultItem.orig.drawItems = mapPicItems(origMajor.draw.items)
    }
    // 支持 orig 的 dyn_draw 字段
    if (origDynamicModule.dyn_draw?.items?.length && !resultItem.orig.drawItems?.length) {
      resultItem.orig.drawItems = mapPicItems(origDynamicModule.dyn_draw.items)
    }
    if (origMajor.pics?.length && !resultItem.orig.drawItems?.length) {
      resultItem.orig.drawItems = mapPicItems(origMajor.pics)
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
        resultItem.orig.drawItems = mapPicItems(origPics)
      }
      if (!resultItem.orig.cover && origPics.length > 0) {
        resultItem.orig.cover = origPics[0].url || origPics[0].src || ''
      }
    }
  }

  // 支持 majorModule.text 字段（纯文本动态）
  if (majorModule.text && !resultItem.desc) {
    resultItem.desc = extractDynamicText(majorModule.text)
  }

  return resultItem
}

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
      const url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/uplist'
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
      const url = `https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/all?page=1&update_baseline=&offset=${offset}&host_mid=0&timezone_offset=${timezoneOffset}&build=11706&platform=web&device=win&mobi_app=pc_electron&features=${DYNAMIC_FEATURES}`
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

        const dynamics = items.map(item => parseDynamicItem(item, log))

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

  ipcMain.handle('get-user-dynamics', async (event, upMid = null, offset = '', type = '') => {
    log('get-user-dynamics called, upMid:', upMid, 'offset:', offset, 'type:', type)
    try {
      let url
      if (upMid) {
        url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${upMid}&timezone_offset=-480&platform=web&features=${DYNAMIC_FEATURES}`
        if (type) url += `&type=${type}`
        if (offset) url += `&offset=${offset}`
      } else {
        const timezoneOffset = -480
        url = `https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/all?page=1&update_baseline=&offset=${offset}&host_mid=0&timezone_offset=${timezoneOffset}&build=11706&platform=web&device=win&mobi_app=pc_electron&features=${DYNAMIC_FEATURES}`
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

        const dynamics = items.map(item => parseDynamicItem(item, log))

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
