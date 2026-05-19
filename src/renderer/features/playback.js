// 播放模块

function getMpvPath() {
  return localStorage.getItem('mpvPath') || ''
}

function useBuiltinPlayer() {
  return localStorage.getItem('useBuiltinPlayer') === 'true'
}

function playVideo(bvid, cid, title, progress, episodeData = null) {
  const mpvPath = getMpvPath()
  const showDanmaku = localStorage.getItem('showDanmaku') !== 'false'
  const useBuiltin = useBuiltinPlayer()
  ipcRenderer.invoke('play-video', bvid, cid, title, mpvPath, showDanmaku, useBuiltin, progress, episodeData)
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
