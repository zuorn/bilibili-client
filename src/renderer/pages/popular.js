// 热门视频模块

async function fetchPopularVideos(page = 1, append = false) {
  const state = pageStates.popular
  if (state.loading) return
  state.loading = true

  try {
    console.log('Fetching popular videos via IPC, page:', page)

    const result = await ipcRenderer.invoke('fetch-popular-videos-v2', page)
    console.log('Popular videos result:', result.success, result.error || '')

    let items = []

    if (result.success && result.data && result.data.code === 0) {
      items = result.data.data?.list || (Array.isArray(result.data.data) ? result.data.data : []) || []
    }

    if (items.length > 0) {
      state.hasMore = items.length >= 20
      const newVideos = items.map(item => mapVideoItem(item, { showPlaySuffix: true }))

      if (append) {
        state.videos = [...state.videos, ...newVideos]
        appendVideos(newVideos, 'popularGrid', navigateToUP)
      } else {
        state.videos = newVideos
        renderVideos(newVideos, 'popularGrid', navigateToUP)
      }
    } else if (!append) {
      showEmptyMessage('popularGrid', '暂无视频')
    }
  } catch (error) {
    console.error('获取热门视频失败:', error)
    if (!append) showEmptyMessage('popularGrid', '获取视频失败')
  }

  state.loading = false
}
