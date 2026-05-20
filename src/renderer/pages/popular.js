// 热门视频模块

async function fetchPopularVideos(tab = 'comprehensive', page = 1, append = false, rid = 0) {
  const state = pageStates.popular
  if (state.loading) return
  state.loading = true

  try {
    console.log('Fetching popular videos via IPC, tab:', tab, 'page:', page, 'rid:', rid)

    const result = await ipcRenderer.invoke('fetch-popular-videos', tab, page, rid)
    console.log('Popular videos result:', result.success, result.error || '')

    let items = []

    if (result.success && result.data && result.data.code === 0) {
      if (tab === 'precious' || tab === 'weekly') {
        // 入站必刷、每周必看数据格式
        items = result.data.data?.list || []
      } else {
        // 其他tab数据格式
        items = result.data.data?.list || (Array.isArray(result.data.data) ? result.data.data : []) || []
      }
    }

    if (items.length > 0) {
      state.hasMore = items.length >= 20
      const newVideos = items.map(item => mapVideoItem(item, { showPlaySuffix: true }))
      const showRank = tab === 'ranking'

      if (append) {
        state.videos = [...state.videos, ...newVideos]
        appendVideos(newVideos, 'popularGrid', navigateToUP, { showRank })
      } else {
        state.videos = newVideos
        renderVideos(newVideos, 'popularGrid', navigateToUP, { showRank })
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

function initPopularTabs() {
  const tabsContainer = document.getElementById('popularTabs')
  const filtersContainer = document.getElementById('rankingFilters')
  if (!tabsContainer) return

  const tabs = tabsContainer.querySelectorAll('.page-tab')
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // 移除所有active状态
      tabs.forEach(t => t.classList.remove('active'))
      // 添加当前active状态
      tab.classList.add('active')

      const tabType = tab.getAttribute('data-tab')
      
      // 显示/隐藏排行榜筛选项
      if (filtersContainer) {
        filtersContainer.style.display = tabType === 'ranking' ? 'flex' : 'none'
      }
      
      // 重置状态并加载新tab数据
      const state = pageStates.popular
      state.pageNum = 1
      state.videos = []
      state.hasMore = true
      state.currentTab = tabType
      state.currentRid = tabType === 'ranking' ? 0 : 0
      
      fetchPopularVideos(tabType, 1, false, state.currentRid)
    })
  })
}

function initRankingFilters() {
  const filtersContainer = document.getElementById('rankingFilters')
  if (!filtersContainer) return

  const filterTags = filtersContainer.querySelectorAll('.filter-tag')
  filterTags.forEach(tag => {
    tag.addEventListener('click', () => {
      // 移除所有active状态
      filterTags.forEach(t => t.classList.remove('active'))
      // 添加当前active状态
      tag.classList.add('active')

      const rid = parseInt(tag.getAttribute('data-rid'))
      
      // 重置状态并加载新分类数据
      const state = pageStates.popular
      state.pageNum = 1
      state.videos = []
      state.hasMore = true
      state.currentRid = rid
      
      fetchPopularVideos('ranking', 1, false, rid)
    })
  })
}
