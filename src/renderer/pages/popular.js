// 热门视频模块 - 确保函数名唯一，避免覆盖
async function fetchPopularVideosByTab(tab = 'comprehensive', page = 1, append = false, rid = 0) {
  const state = pageStates.popular
  if (state.loading) return
  state.loading = true

  try {
    console.log('Fetching popular videos via IPC, tab:', tab, 'page:', page, 'rid:', rid)

    const result = await ipcRenderer.invoke('fetch-popular-videos', tab, page, rid)
    console.log('Popular videos result:', result.success, result.error || '')

    let items = []

    if (result.success && result.data && result.data.code === 0) {
      const data = result.data.data
      if (tab === 'precious') {
        // 入站必刷数据格式：{ list: [...] }
        items = data?.list || []
      } else if (tab === 'weekly') {
        // 每周必看数据格式：直接是数组或嵌套结构
        items = Array.isArray(data) ? data : (data?.list || data?.result || [])
      } else {
        // 综合热门、排行榜数据格式
        items = data?.list || (Array.isArray(data) ? data : []) || []
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
        // 清空容器再渲染
        const container = document.getElementById('popularGrid')
        if (container) container.innerHTML = ''
        renderVideos(newVideos, 'popularGrid', navigateToUP, { showRank })
      }
    } else if (!append) {
      showEmptyMessage('popularGrid', '暂无视频')
    }
  } catch (error) {
    console.error('获取热门视频失败:', error)
    if (!append) showEmptyMessage('popularGrid', '获取视频失败')
  } finally {
    state.loading = false
  }
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
      
      // 使用正确的函数名
      fetchPopularVideosByTab(tabType, 1, false, state.currentRid)
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
      
      // 使用正确的函数名
      fetchPopularVideosByTab('ranking', 1, false, rid)
    })
  })
}
