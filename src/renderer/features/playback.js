// 播放模块
// 说明：不再做渲染层防抖。窗口复用 + Rust 侧 OPEN_GEN 代际计数保证：
// 连续快速点击只会重开同一个窗口并播放最后一次点击的视频，无副作用。
// 任何前置检查/等待都可能"吞掉"点击，这里必须直接穿透到 play-video。

function getMpvPath() {
  return localStorage.getItem('mpvPath') || ''
}

function useBuiltinPlayer() {
  const saved = localStorage.getItem('useBuiltinPlayer')
  return saved === null || saved === 'true'
}

async function playVideo(bvid, cid, title, progress, episodeData = null) {
  console.log('[playback] playVideo called:', { bvid, cid, title, progress, episodeData })

  const useBuiltin = useBuiltinPlayer()
  const mpvPath = getMpvPath()
  console.log('[playback] useBuiltin:', useBuiltin, 'mpvPath:', mpvPath)

  // Neither player is configured — tell the user to set one up
  if (!useBuiltin && !mpvPath) {
    showToast('请先在设置中开启内置播放器或配置 MPV 路径')
    return
  }

  // 未传进度时由 Rust 侧后台查询历史进度（网络请求），不阻塞窗口打开。
  // 这里绝对不要 await 任何网络请求——否则请求慢时窗口迟迟不开，点击像"失灵"。

  try {
    const showDanmaku = localStorage.getItem('showDanmaku') !== 'false'
    console.log('[playback] 调用 play-video IPC...')
    const result = await ipcRenderer.invoke('play-video', bvid, cid, title, mpvPath, showDanmaku, useBuiltin, progress, episodeData)
    console.log('[playback] play-video 结果:', result)
    if (!result.success) {
      showToast(result.error || '播放失败')
    }
  } catch (err) {
    console.error('[playback] play-video 异常:', err)
  }
}

// 右键在新窗口打开视频（不关闭已有播放窗口）
async function playVideoInNewWindow(bvid, cid, title) {
  const useBuiltin = useBuiltinPlayer()
  const mpvPath = getMpvPath()

  if (!useBuiltin && !mpvPath) {
    showToast('请先在设置中开启内置播放器或配置 MPV 路径')
    return
  }

  const showDanmaku = localStorage.getItem('showDanmaku') !== 'false'
  const result = await ipcRenderer.invoke('play-video-new-window', bvid, cid, title, mpvPath, showDanmaku, useBuiltin, null, null)
  if (!result.success) {
    showToast(result.error || '播放失败')
  }
}

function extractSeasonId(item) {
  if (item.season_id) return item.season_id
  const url = item.url || item.link || ''
  const match = url.match(/md(\d+)/)
  if (match) return parseInt(match[1])
  const ssMatch = url.match(/ss(\d+)/)
  return ssMatch ? parseInt(ssMatch[1]) : null
}

async function playBangumi(item) {
  const seasonId = extractSeasonId(item)
  if (!seasonId) {
    const url = item.url || item.link
    if (url) window.open(url, '_blank')
    return
  }

  const title = item.title || item.name || ''

  try {
    const result = await ipcRenderer.invoke('get-season-episodes', seasonId)
    if (result.success && result.data && result.data.length > 0) {
      const episodes = result.data
      let episodeIndex = 0
      if (item.progress && item.progress.last_ep_index) {
        episodeIndex = Math.max(0, Math.min(item.progress.last_ep_index - 1, episodes.length - 1))
      }
      const episode = episodes[episodeIndex]
      const fullTitle = result.seasonTitle ? `${result.seasonTitle} - ${episode.title}` : `${title} - ${episode.title}`
      const episodeData = {
        seasonId: seasonId,
        seasonTitle: result.seasonTitle || title,
        episodes: episodes,
        currentIndex: episodeIndex
      }
      playVideo(episode.bvid, episode.cid, fullTitle, null, episodeData)
    } else {
      const url = item.url || item.link
      if (url) window.open(url, '_blank')
    }
  } catch (error) {
    console.error('播放番剧/影视失败:', error)
    const url = item.url || item.link
    if (url) window.open(url, '_blank')
  }
}
