// IPC handlers for video playback and player operations
const cookieManager = require('../cookieManager')
const path = require('path')
const fs = require('fs')

// Module-level deps reference, set by registerPlayerHandlers
let _deps = null

// 获取视频信息（aid, cid） - standalone helper
async function getVideoInfo(bvid) {
  if (!_deps) return null
  const { fetchApi, log } = _deps
  try {
    const result = await fetchApi(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
    if (result && result.code === 0 && result.data) {
      return {
        aid: result.data.aid,
        cid: result.data.cid,
        duration: result.data.duration,
        title: result.data.title,
        dimension: result.data.dimension || null
      }
    }
  } catch (error) {
    log('获取视频信息失败:', error)
  }
  return null
}

// 获取最佳播放URL（并行尝试所有清晰度，返回最高可用者）
// 用于 MPV 直接播放和内置播放器 get-video-url
async function fetchBestPlayUrl(bvid, cid, cookieString, log) {
  const qualityLevels = [
    { qn: 125, name: 'HDR1080P60' },
    { qn: 120, name: '4K' },
    { qn: 116, name: '1080P60' },
    { qn: 112, name: '1080P+' },
    { qn: 80, name: '1080P' },
    { qn: 74, name: '720P60' },
    { qn: 64, name: '720P' },
    { qn: 32, name: '480P' },
    { qn: 16, name: '360P' }
  ]

  const results = await Promise.allSettled(
    qualityLevels.map(level => (async () => {
      const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${level.qn}&fnval=16`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://www.bilibili.com/video/${bvid}`,
            'Cookie': cookieString
          },
          signal: controller.signal
        })
        clearTimeout(timeout)
        const data = await response.json()
        if (data.code === 0) return { qn: level.qn, name: level.name, data }
        return null
      } catch (err) {
        clearTimeout(timeout)
        return null
      }
    })())
  )

  const successful = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .sort((a, b) => b.qn - a.qn)

  for (const r of successful) {
    const dash = r.data.data?.dash
    if (dash && dash.video && dash.video.length > 0) {
      const sorted = [...dash.video].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
      const avc = sorted.filter(v => (v.codecid || v.codec_id) === 7)
      const av1 = sorted.filter(v => (v.codecid || v.codec_id) === 13)
      const hevc = sorted.filter(v => (v.codecid || v.codec_id) === 12)
      const bestVideo = avc[0] || av1[0] || hevc[0]
      if (!bestVideo) continue
      const videoUrl = bestVideo.baseUrl || bestVideo.url
      let audioUrl = null
      if (dash.audio && dash.audio.length > 0) {
        dash.audio.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
        audioUrl = dash.audio[0].baseUrl || dash.audio[0].url
      }
      if (videoUrl) {
        const codecLabel = (bestVideo.codecid || bestVideo.codec_id) === 13 ? 'AV1' : ''
        log(`✅ 并行获取 - 使用 ${r.name}${codecLabel ? ' ' + codecLabel : ''} (DASH)`)
        return { success: true, url: videoUrl, audioUrl, quality: r.name + ' (DASH)', isCombined: false }
      }
    }

    const durl = r.data.data?.durl || []
    if (durl.length > 0) {
      log(`✅ 并行获取 - 使用 ${r.name} (durl)`)
      return { success: true, url: durl[0].url, quality: r.name + ' (durl)', backupUrl: durl[0].backup_url?.[0], isCombined: true }
    }
  }

  return { success: false, error: '所有清晰度均获取失败' }
}

function registerPlayerHandlers(deps) {
  _deps = deps
  const { ipcMain, log, fetchApi, app, dialog, state } = deps

  ipcMain.handle('play-video', async (event, bvid, cid, title, mpvPath, showDanmaku = true, useBuiltin = false, progress = null, episodeData = null) => {
    const { getDanmakuXml, xml2ass, formatProgressTime, reportPlayHistory, openBuiltinPlayer, startReportTimer, cleanupMpvSocket, stopVideo, findMpvExecutable } = deps

    const startTime = Date.now()
    log(`[启动计时] 开始播放视频, 时间: ${new Date().toLocaleTimeString()}`)
    log(`[启动计时] 弹幕显示设置: ${showDanmaku}`)
    log(`[启动计时] 使用内置播放器: ${useBuiltin}`)
    log(`[启动计时] 播放进度: ${progress}`)

    log('play-video called with bvid:', bvid, 'cid:', cid, 'title:', title, 'mpvPath:', mpvPath, 'showDanmaku:', showDanmaku, 'useBuiltin:', useBuiltin, 'progress:', progress)
    stopVideo()

    if (useBuiltin) {
      let videoDimension = null
      if (!cid) {
        try {
          const videoInfo = await getVideoInfo(bvid)
          if (videoInfo) {
            videoDimension = videoInfo.dimension
            log('Got dimension for builtin player:', videoDimension)
          }
        } catch (error) {
          log('Failed to get video dimension:', error.message)
        }
      } else {
        try {
          const videoInfo = await getVideoInfo(bvid)
          if (videoInfo) {
            videoDimension = videoInfo.dimension
            log('Got dimension for builtin player:', videoDimension)
          }
        } catch (error) {
          log('Failed to get video dimension:', error.message)
        }
      }
      return await openBuiltinPlayer(bvid, cid, title, videoDimension, progress, deps, episodeData)
    }

    try {
      const pageUrl = `https://www.bilibili.com/video/${bvid}`
      const videoTitle = title || '哔哩哔哩视频'
      const mpvExecutable = findMpvExecutable(mpvPath)
      if (!mpvExecutable) {
        return { success: false, error: '未找到 MPV 播放器，请在设置中配置 MPV 路径或开启内置播放器' }
      }
      log(`[启动计时] 步骤1: 获取mpv可执行文件, 耗时: ${Date.now() - startTime}ms`)

      let targetCid = cid
      let videoInfo = null

      if (!cid) {
        try {
          videoInfo = await getVideoInfo(bvid)
          if (videoInfo) {
            targetCid = videoInfo.cid
          }
        } catch (error) {
          log('Failed to get cid from bvid:', error.message)
        }
      }
      log(`[启动计时] 步骤2: 获取视频CID, 耗时: ${Date.now() - startTime}ms`)

      state.currentVideoInfo = {
        bvid: bvid,
        aid: videoInfo ? videoInfo.aid : null,
        cid: targetCid || null,
        duration: videoInfo ? videoInfo.duration : null,
        title: title,
        startTime: Date.now(),
        lastReportProgress: 0
      }

      const escapedTitle = videoTitle.replace(/(["\\])/g, '\\$1').replace(/`/g, '\\`')
      const mpvArgs = [
        '--hwdec=auto',
        '--volume=80',
        '--border=no',
        `--title="${escapedTitle}"`,
        '--sub-auto=fuzzy',
        '--sub-ass-override=yes'
      ]

      // 合并所有 HTTP 请求头为一个 --http-header-fields（多次设置会互相覆盖）
      // B站 CDN 必须带 Referer 否则返回 403
      const headerFields = [
        `Referer: https://www.bilibili.com/`,
        `Origin: https://www.bilibili.com`,
        `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
      ]
      const savedCookies = cookieManager.getSavedCookies()
      if (savedCookies.SESSDATA) {
        const cookieStr = `SESSDATA=${savedCookies.SESSDATA}; DedeUserID=${savedCookies.DedeUserID}; bili_jct=${savedCookies.bili_jct}`
        // mpv key-value list 用逗号分隔，Cookie 值中的逗号需转义
        headerFields.push(`Cookie: ${cookieStr.replace(/,/g, '\\,')}`)
      }
      mpvArgs.push(`--http-header-fields=${headerFields.join(',')}`)
      log(`[启动计时] 步骤3: 准备mpv参数, 耗时: ${Date.now() - startTime}ms`)

      // 并行获取最佳清晰度直链和弹幕，大幅减少等待时间
      const cookieString = cookieManager.getCookieString()
      let danmakuAssPath = null

      const [playUrlResult, danmakuResult] = await Promise.all([
        targetCid ? fetchBestPlayUrl(bvid, targetCid, cookieString, log) : Promise.resolve(null),
        (targetCid && showDanmaku) ? (async () => {
          try {
            log('Fetching danmaku for cid:', targetCid)
            const xml = await getDanmakuXml(targetCid)
            log(`[启动计时] 步骤4a: 获取弹幕XML(${xml.length}字节), 耗时: ${Date.now() - startTime}ms`)

            const ass = await xml2ass(xml)
            log(`[启动计时] 步骤4b: 转换ASS字幕(${ass.length}字节), 耗时: ${Date.now() - startTime}ms`)

            if (ass.length > 0) {
              const assPath = path.join(app.getPath('temp'), `danmaku_${targetCid}.ass`)
              fs.writeFileSync(assPath, ass, 'utf8')
              log(`[启动计时] 步骤4c: 写入ASS文件, 耗时: ${Date.now() - startTime}ms`)
              return { assPath }
            }
            return null
          } catch (error) {
            log('Failed to fetch danmaku:', error.message)
            return null
          }
        })() : Promise.resolve(null)
      ])

      // 使用直接视频 URL（跳过 MPV/yt-dlp 解析 B 站页面，大幅提升启动速度）
      // URL 必须加引号，避免 cmd.exe 将 & 解释为命令分隔符
      if (playUrlResult && playUrlResult.success) {
        log(`[启动计时] 使用直接视频URL: ${playUrlResult.quality}`)
        mpvArgs.push(`"${playUrlResult.url}"`)
        if (playUrlResult.audioUrl) {
          mpvArgs.push(`--audio-file="${playUrlResult.audioUrl}"`)
        }
      } else {
        log('[启动计时] 回退到页面URL')
        mpvArgs.push(`"${pageUrl}"`)
      }

      // 添加弹幕字幕（已并行准备好）
      if (danmakuResult && danmakuResult.assPath) {
        danmakuAssPath = danmakuResult.assPath
        mpvArgs.push(`--sub-file=${danmakuAssPath}`)
      } else if (!showDanmaku) {
        log('[启动计时] 步骤4: 弹幕已禁用, 跳过弹幕获取')
      } else if (!targetCid) {
        log('[启动计时] 步骤4: 无CID, 跳过弹幕获取')
      }

      log('Starting mpv with command:', mpvExecutable, mpvArgs.join(' '))

      const { spawn } = require('child_process')
      const mpvDir = path.dirname(mpvExecutable)
      state.mpvProcess = spawn(mpvExecutable, mpvArgs, {
        shell: true,
        cwd: mpvDir,
        windowsHide: true
      })

      const totalTime = Date.now() - startTime
      log(`[启动计时] 步骤5: 启动mpv完成, 耗时: ${totalTime}ms`)
      log(`[启动计时] 视频启动总耗时: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}秒)`)
      log('========================================')

      // 异步获取完整视频信息用于历史上报
      if (!videoInfo && targetCid) {
        getVideoInfo(bvid).then(info => {
          if (info && state.currentVideoInfo) {
            state.currentVideoInfo.aid = info.aid
            state.currentVideoInfo.duration = info.duration
            log(`[初始上报] MPV开始播放, aid=${info.aid}, cid=${targetCid}, 初始进度=0:10`)
            reportPlayHistory(info.aid, targetCid, 10)
          }
        })
      } else if (state.currentVideoInfo && state.currentVideoInfo.cid) {
        const aid = state.currentVideoInfo.aid
        const cidForReport = state.currentVideoInfo.cid
        log(`[初始上报] MPV开始播放, aid=${aid}, cid=${cidForReport}, 初始进度=0:10`)
        reportPlayHistory(aid, cidForReport, 10)
      }

      state.mpvProcess.on('error', (err) => {
        log('MPV Error:', err.message)
        state.mpvProcess = null
        cleanupMpvSocket()
        if (danmakuAssPath && fs.existsSync(danmakuAssPath)) {
          fs.unlinkSync(danmakuAssPath)
        }
      })
      state.mpvProcess.on('close', (code) => {
        log(`[MPV关闭] 代码: ${code}`)
        if (state.currentVideoInfo && state.currentVideoInfo.aid && state.currentVideoInfo.cid) {
          const elapsedSeconds = Math.floor((Date.now() - state.currentVideoInfo.startTime) / 1000)
          const estimatedProgress = Math.min(elapsedSeconds, state.currentVideoInfo.duration || 300)
          const formattedProgress = formatProgressTime(estimatedProgress)
          log(`[MPV关闭] 上报最终进度: ${formattedProgress} (${Math.floor(estimatedProgress)}秒)`)
          reportPlayHistory(state.currentVideoInfo.aid, state.currentVideoInfo.cid, estimatedProgress)
        }
        cleanupMpvSocket()
        state.mpvProcess = null
        if (danmakuAssPath && fs.existsSync(danmakuAssPath)) {
          fs.unlinkSync(danmakuAssPath)
          log('Cleaned up danmaku ASS file:', danmakuAssPath)
        }
      })
      startReportTimer()
      return { success: true, hasDanmaku: !!danmakuAssPath }
    } catch (error) {
      log('Failed to start MPV:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-video-url', async (event, bvid, cid) => {
    const cookieString = cookieManager.getCookieString()
    return await fetchBestPlayUrl(bvid, cid, cookieString, log)
  })

  // 获取视频预览URL（低清晰度，用于悬停预览）
  ipcMain.handle('get-video-preview-url', async (event, bvid, cid) => {
    const cookieString = cookieManager.getCookieString()

    let targetCid = cid
    if (!targetCid) {
      try {
        const videoInfo = await getVideoInfo(bvid)
        if (videoInfo && videoInfo.cid) {
          targetCid = videoInfo.cid
        } else {
          return { success: false, error: '无法获取视频CID' }
        }
      } catch (error) {
        return { success: false, error: error.message }
      }
    }

    // 低清晰度优先，360P 体积更小缓冲更快
    const previewLevels = [
      { qn: 16, name: '360P', fnval: 1 },
      { qn: 32, name: '480P', fnval: 1 }
    ]

    for (const level of previewLevels) {
      try {
        const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${targetCid}&qn=${level.qn}&fnval=${level.fnval}&fnver=0&fourk=0&platform=html5`
        log(`[预览] 尝试获取 ${level.name} 视频流...`)

        const controller = new AbortController()
        const timeout = setTimeout(function() { controller.abort() }, 5000)

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://www.bilibili.com/video/${bvid}`,
            'Cookie': cookieString
          },
          signal: controller.signal
        })
        clearTimeout(timeout)

        const data = await response.json()
        if (data.code !== 0) {
          log(`[预览] ${level.name} 获取失败: ${data.message}`)
          continue
        }

        // 优先使用 durl（合并音视频）
        const durl = data.data?.durl
        if (durl && durl.length > 0) {
          log(`[预览] 使用 ${level.name} durl 格式`)
          return { success: true, url: durl[0].url, quality: level.name, cid: targetCid }
        }

        // 兜底使用 DASH 视频流（预览静音播放，无需音频）
        const dash = data.data?.dash
        if (dash && dash.video && dash.video.length > 0) {
          dash.video.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
          const videoUrl = dash.video[0].baseUrl || dash.video[0].base_url || dash.video[0].url
          if (videoUrl) {
            log(`[预览] 使用 ${level.name} DASH 格式（仅视频）`)
            return { success: true, url: videoUrl, quality: level.name + ' DASH', cid: targetCid }
          }
        }
      } catch (error) {
        log(`[预览] ${level.name} 请求异常: ${error.message}`)
      }
    }

    return { success: false, error: '无法获取预览视频流' }
  })

  ipcMain.handle('get-video-info', async (event, bvid) => {
    try {
      const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
      log('Getting video info from:', url)

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://www.bilibili.com/video/${bvid}`
        }
      })

      const data = await response.json()
      log('Video info response:', data.code)

      if (data.code !== 0) {
        throw new Error(data.message || '获取视频信息失败')
      }

      return { success: true, data: data.data }
    } catch (error) {
      log('Error getting video info:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-danmaku', async (event, cid) => {
    try {
      const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`
      log('Getting danmaku from:', url)

      const axios = require('axios')
      const zlib = require('zlib')
      const { promisify } = require('util')
      const gunzip = promisify(zlib.gunzip)

      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Connection': 'keep-alive'
        },
        timeout: 10000
      })

      let xmlData
      try {
        xmlData = (await gunzip(res.data)).toString('utf8')
        log('Gunzip succeeded, length:', xmlData.length)
      } catch (e) {
        log('Gunzip failed, using raw, error:', e.message)
        xmlData = Buffer.from(res.data).toString('utf8')
      }

      if (xmlData.includes('<html') || xmlData.includes('<!DOCTYPE')) {
        log('WARNING: Received HTML instead of XML')
      }

      log('Danmaku loaded, length:', xmlData.length)

      return { success: true, data: xmlData }
    } catch (error) {
      log('Error getting danmaku:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('select-mpv-path', async () => {
    log('select-mpv-path called')

    try {
      const result = await dialog.showOpenDialog(deps.mainWindow || undefined, {
        title: '选择MPV可执行文件',
        properties: ['openFile'],
        filters: [
          { name: '可执行文件', extensions: ['exe', 'com'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]
        log('MPV path selected:', selectedPath)
        return { success: true, path: selectedPath }
      }

      return { success: false }
    } catch (error) {
      log('Error selecting MPV path:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.on('stop-video', () => {
    const { stopVideo } = deps
    stopVideo()
  })

  ipcMain.handle('get-danmaku-xml', async (event, cid) => {
    const { getDanmakuXml } = deps
    log('get-danmaku-xml called with cid:', cid)
    try {
      const xml = await getDanmakuXml(cid)
      return { success: true, data: xml }
    } catch (error) {
      log('Error getting danmaku XML:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-cid-by-bvid', async (event, bvid) => {
    const { getCidByBvid } = deps
    log('get-cid-by-bvid called with bvid:', bvid)
    try {
      const cid = await getCidByBvid(bvid)
      return { success: true, data: cid }
    } catch (error) {
      log('Error getting cid:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('xml-to-ass', async (event, xml) => {
    const { xml2ass } = deps
    log('xml-to-ass called')
    try {
      const ass = await xml2ass(xml)
      return { success: true, data: ass }
    } catch (error) {
      log('Error converting XML to ASS:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('fetch-danmaku-ass', async (event, cid, bvid = null) => {
    const { getDanmakuXml, getCidByBvid, xml2ass } = deps
    log('fetch-danmaku-ass called with cid:', cid, 'bvid:', bvid)
    try {
      let targetCid = cid

      if (!cid && bvid) {
        log('No cid provided, getting cid from bvid:', bvid)
        targetCid = await getCidByBvid(bvid)
        log('Got cid:', targetCid)
      }

      if (!targetCid) {
        throw new Error('缺少cid参数且无法从bvid获取')
      }

      const xml = await getDanmakuXml(targetCid)
      const ass = await xml2ass(xml)

      return { success: true, data: ass, cid: targetCid }
    } catch (error) {
      log('Error fetching danmaku ASS:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('save-ass-file', async (event, assContent, fileName) => {
    log('save-ass-file called')
    try {
      const result = await dialog.showSaveDialog(deps.mainWindow || undefined, {
        title: '保存弹幕字幕',
        defaultPath: fileName || 'danmaku.ass',
        filters: [
          { name: 'ASS字幕文件', extensions: ['ass'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, assContent, 'utf8')
        log('ASS file saved to:', result.filePath)
        return { success: true, path: result.filePath }
      }

      return { success: false }
    } catch (error) {
      log('Error saving ASS file:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { getVideoInfo, registerPlayerHandlers }
