// IPC handlers for dynamics-related operations

function parseDynamicItem(item) {
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
      }
    })
    modules = moduleMap
  }

  const dynamicModule = modules.module_dynamic || {}
  const authorModule = modules.module_author || {}
  const majorModule = dynamicModule.major || {}
  const desc = dynamicModule.desc || {}
  const statModule = modules.module_stat || {}
  const dynStat = dynamicModule.stat || {}

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
    desc: desc.text || '',
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

  const dynArchive = dynamicModule.dyn_archive || {}
  
  // 添加调试日志
  if (dynArchive.dynamic_type === 2 || dynArchive.type === 2 || item.type === 2) {
    console.log('[DEBUG] Image dynamic item:', JSON.stringify({
      type: item.type,
      dynArchive: {
        type: dynArchive.type,
        dynamic_type: dynArchive.dynamic_type,
        hasDraw: !!majorModule.draw,
        drawItems: majorModule.draw?.items?.length || 0,
        hasPics: !!majorModule.pics,
        picsLength: majorModule.pics?.length || 0
      }
    }, null, 2))
  }
  
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
    resultItem.drawItems = majorModule.draw.items.map(pic => ({
      src: pic.src || '',
      width: pic.width || 0,
      height: pic.height || 0
    }))
    if (!resultItem.thumbnail) {
      resultItem.thumbnail = resultItem.drawItems[0].src
      resultItem.cover = resultItem.thumbnail
    }
  }
  
  // 支持 dynArchive.pics 字段（图片动态可能存储在这里）
  if (dynArchive.pics?.length && !resultItem.drawItems.length) {
    resultItem.drawItems = dynArchive.pics.map(pic => ({
      src: pic.src || pic.url || '',
      width: pic.width || 0,
      height: pic.height || 0
    }))
    if (!resultItem.thumbnail && resultItem.drawItems.length > 0) {
      resultItem.thumbnail = resultItem.drawItems[0].src
      resultItem.cover = resultItem.thumbnail
    }
  }

  if (majorModule.opus) {
    const opus = majorModule.opus
    resultItem.title = resultItem.title || opus.title || ''
    resultItem.cover = resultItem.cover || opus.cover || ''
    const pics = opus.pics || []
    if (!resultItem.cover && pics.length > 0) {
      resultItem.cover = pics[0].url || ''
    }
    resultItem.thumbnail = resultItem.thumbnail || resultItem.cover
    resultItem.opusSummary = opus.summary || ''
  }

  if (majorModule.article) {
    const article = majorModule.article
    resultItem.title = resultItem.title || article.title || ''
    resultItem.cover = resultItem.cover || article.covers?.[0] || ''
    resultItem.thumbnail = resultItem.thumbnail || resultItem.cover
    resultItem.articleDesc = article.desc || ''
    resultItem.articleId = article.id || 0
  }

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
      id: item.orig.id_str || '',
      type: item.orig.type || '',
      // 作者信息可能在 user 对象里，也可能直接在 origAuthorModule 里
      authorName: origAuthorModule.user?.name || origAuthorModule.name || '',
      authorFace: origAuthorModule.user?.face || origAuthorModule.face || '',
      desc: origDesc.text || ''
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
      resultItem.orig.drawItems = origMajor.draw.items.map(d => ({
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
      const url = `https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/all?page=1&update_baseline=&offset=${offset}&host_mid=0&timezone_offset=${timezoneOffset}&build=11706&platform=web&device=win&mobi_app=pc_electron`
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

        const dynamics = items.map(parseDynamicItem)

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
        url = `https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/all?page=1&update_baseline=&offset=${offset}&host_mid=0&timezone_offset=${timezoneOffset}&build=11706&platform=web&device=win&mobi_app=pc_electron`
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

        const dynamics = items.map(parseDynamicItem)

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
