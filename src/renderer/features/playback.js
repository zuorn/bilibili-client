// 播放模块

let playerOpening = false

function getMpvPath() {
  return localStorage.getItem('mpvPath') || ''
}

function useBuiltinPlayer() {
  return localStorage.getItem('useBuiltinPlayer') === 'true'
}

async function playVideo(bvid, cid, title, progress, episodeData = null) {
  if (playerOpening) {
    console.log('Player is already opening, ignoring duplicate click')
    return
  }

  const useBuiltin = useBuiltinPlayer()
  const mpvPath = getMpvPath()

  // Neither player is configured — tell the user to set one up
  if (!useBuiltin && !mpvPath) {
    showToast('请先在设置中开启内置播放器或配置 MPV 路径')
    return
  }

  // 未传进度时，从播放历史中查找上次观看进度
  if ((progress === null || progress === undefined) && useBuiltin) {
    try {
      const histResult = await ipcRenderer.invoke('get-video-progress', bvid)
      if (histResult.success && histResult.progress > 0) {
        progress = histResult.progress
      }
    } catch (e) {
      // 查找失败不影响播放，从头开始
    }
  }

  playerOpening = true
  try {
    const showDanmaku = localStorage.getItem('showDanmaku') !== 'false'
    const result = await ipcRenderer.invoke('play-video', bvid, cid, title, mpvPath, showDanmaku, useBuiltin, progress, episodeData)
    if (!result.success) {
      showToast(result.error || '播放失败')
    }
  } finally {
    // Hold the guard for at least 3 seconds to prevent rapid re-clicks
    // from triggering a second window before the first one loads.
    setTimeout(() => { playerOpening = false }, 3000)
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
