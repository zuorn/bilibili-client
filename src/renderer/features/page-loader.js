function loadPageContent(page) {
  console.log('loadPageContent called with page:', page)
  const actions = {
    home: () => { pageStates.home.pageNum = 1; pageStates.home.hasMore = true; fetchVideos(1, false) },
    popular: () => { pageStates.popular.pageNum = 1; pageStates.popular.hasMore = true; fetchPopularVideos(1, false) },
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
    dynamic: () => initDynamicPage(),
    following: () => initFollowingPage()
  }
  actions[page]?.()
}
