// 首页模块

async function fetchVideos(page = 1, append = false) {
  const state = pageStates.home
  if (state.loading) return
  state.loading = true

  const loadingEl = document.getElementById('homeLoadingMore')
  const noMoreEl = document.getElementById('homeNoMore')

  if (append && loadingEl) {
    loadingEl.style.display = 'block'
  }
  if (noMoreEl) {
    noMoreEl.style.display = 'none'
  }

  try {
    console.log('Fetching recommend videos via IPC, page:', page)
    const result = await ipcRenderer.invoke('fetch-videos', page)
    console.log('Fetch videos result:', result.success, result.error || '')

    let items = []
    if (result.success && result.data) {
      const data = result.data
      items = data?.data?.item || data?.data?.list || data?.data?.result || data?.item || data?.list || data?.result || (Array.isArray(data) ? data : []) || []
      console.log('Number of items:', items.length)
      if (items.length > 0) {
        console.log('First item:', JSON.stringify(items[0], null, 2))
      }
    }

    if (items.length > 0) {
      state.hasMore = items.length >= 30
      const newVideos = items.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || item.picture || ''),
        play: formatPlayCount(item.stat?.view || item.play || item.view || 0),
        duration: formatDuration(item.duration || item.length || 0),
        author: item.owner?.name || item.author || item.uname || '未知UP主',
        owner: item.owner?.mid ? item.owner : { mid: item.mid || item.author_mid || 0, name: item.author || item.uname || '未知UP主' }
      }))

      if (append) {
        pageStates.home.videos = [...pageStates.home.videos, ...newVideos]
        appendVideos(newVideos, 'videoGrid', navigateToUP)
      } else {
        pageStates.home.videos = newVideos
        renderVideos(newVideos, 'videoGrid', navigateToUP)
      }

      // 显示没有更多内容提示
      if (!state.hasMore && noMoreEl) {
        noMoreEl.style.display = 'block'
      } else {
        noMoreEl.style.display = 'none'
      }
    } else if (!append) {
      showEmptyMessage('videoGrid', '获取视频失败，请稍后重试')
    }
  } catch (error) {
    console.error('获取视频失败:', error)
    if (!append) showEmptyMessage('videoGrid', '获取视频失败，请稍后重试')
  }

  if (loadingEl) {
    loadingEl.style.display = 'none'
  }
  state.loading = false
}
