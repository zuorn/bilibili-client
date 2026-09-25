function loadPageContent(page) {
  // 缓存优先：home/popular 已有数据时直接渲染缓存，不重新请求。
  // 刷新（refreshCurrentPage）与 tab/分类切换仍会清空缓存重新拉取；
  // pageNum/hasMore 原样保留，滚动加载下一页不受影响。
  const actions = {
    home: () => {
      const state = pageStates.home
      if (!state.loading && state.videos && state.videos.length > 0) {
        renderVideos(state.videos, 'videoGrid', navigateToUP)
      } else {
        state.pageNum = 1
        state.hasMore = true
        fetchVideos(1, false)
      }
    },
    popular: () => {
      const state = pageStates.popular
      if (!state.loading && state.videos && state.videos.length > 0) {
        renderPopularFromCache()
      } else {
        state.pageNum = 1
        state.hasMore = true
        state.currentTab = 'comprehensive'
        fetchPopularVideosByTab('comprehensive', 1, false)
      }
    },
    bangumi: () => loadBangumiPage(),
    'bangumi-all': () => {
      bangumiAllState.page = 1
      bangumiAllState.hasMore = true
      loadBangumiAllFilters()
      loadBangumiAllData()
    },
    'media-all': () => {
      mediaAllState.page = 1
      mediaAllState.hasMore = true
      loadMediaAllFilters()
      loadMediaAllData()
    },
    media: () => loadMediaPage(),
    my: () => { if (currentUser?.isLogin) loadHistory() },
    dynamic: () => { if (typeof initDynamicPage === 'function') initDynamicPage() },
    following: () => { if (typeof initFollowingPage === 'function') initFollowingPage() },
    up: () => {
      if (typeof resetUpProfileUI === 'function' && pageStates.up.mid) {
        resetUpProfileUI()
      }
    },
    search: () => {
      // 确保搜索筛选器已初始化
      if (typeof initSearchFilters === 'function') {
        initSearchFilters()
      }
    }
  }
  actions[page]?.()
}
