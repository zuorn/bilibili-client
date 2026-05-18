function handleScroll() {
  const content = document.querySelector('.content')
  if (!content) return

  const { scrollTop, scrollHeight, clientHeight } = content

  const backTopBtn = document.getElementById('backTopBtn')
  if (backTopBtn) {
    if (scrollTop > 300) {
      backTopBtn.classList.remove('hidden')
    } else {
      backTopBtn.classList.add('hidden')
    }
  }

  if (currentPage === 'my') {
    const myTabs = document.querySelector('.my-tabs')
    const state = pageStates.my

    if (myTabs) {
      if (state.tabsOriginalOffset === null) {
        state.tabsOriginalOffset = myTabs.offsetTop
        state.tabsHeight = myTabs.offsetHeight
      }

      const tabsOffsetTop = state.tabsOriginalOffset

      if (scrollTop >= tabsOffsetTop - 64) {
        if (!myTabs.classList.contains('sticky')) {
          myTabs.classList.add('sticky')

          const placeholder = document.createElement('div')
          placeholder.className = 'my-tabs-placeholder'
          placeholder.style.height = state.tabsHeight + 'px'
          myTabs.parentNode.insertBefore(placeholder, myTabs.nextSibling)
        }
      } else {
        if (myTabs.classList.contains('sticky')) {
          myTabs.classList.remove('sticky')

          const placeholder = document.querySelector('.my-tabs-placeholder')
          if (placeholder) {
            placeholder.remove()
          }
        }
      }
    }

    const historyTab = document.querySelector('.my-tab.active[data-tab="history"]')
    if (historyTab && scrollTop + clientHeight >= scrollHeight - 300) {
      if (!state.isHistoryLoading && state.hasMoreHistory) {
        console.log('触发加载更多历史记录')
        loadHistory(true)
      }
    }

    const favoritesTab = document.querySelector('.my-tab.active[data-tab="favorites"]')
    if (favoritesTab && scrollTop + clientHeight >= scrollHeight - 300) {
      if (!state.isFavoritesLoading && state.hasMoreFavorites) {
        console.log('触发加载更多收藏')
        loadFavorites(true)
      }
    }

    const toviewTab = document.querySelector('.my-tab.active[data-tab="later"]')
    if (toviewTab && scrollTop + clientHeight >= scrollHeight - 300) {
      if (!state.isToviewLoading && state.hasMoreToview) {
        console.log('触发加载更多稍后再看')
        loadToview(true)
      }
    }

  } else if (currentPage === 'up') {
    const nearBottom = scrollTop + clientHeight >= scrollHeight - 2
    if (nearBottom && !pageStates.up.loading && !pageStates.up.scrollLocked && pageStates.up.hasMore) {
      pageStates.up.scrollLocked = true
      loadUpVideos(pageStates.up.mid, pageStates.up.offset)
    }
  } else if (currentPage === 'bangumi') {
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      const state = pageStates.bangumi
      if (!state.loading && state.hasMore && state.cursor) {
        console.log('触发加载更多追番猜你喜欢')
        loadMoreGuessItems()
      }
    }
  } else if (currentPage === 'media') {
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      const state = pageStates.media
      if (!state.loading && state.hasMore && state.cursor) {
        console.log('触发加载更多影视猜你喜欢')
        loadMoreMediaGuessItems()
      }
    }
  } else if (currentPage === 'bangumi-all') {
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      if (!bangumiAllState.loading && bangumiAllState.hasMore) {
        console.log('触发加载更多追番全部')
        loadBangumiAllData(true)
      }
    }
  } else if (currentPage === 'media-all') {
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      if (!mediaAllState.loading && mediaAllState.hasMore) {
        console.log('触发加载更多影视全部')
        loadMediaAllData(true)
      }
    }
  } else if (currentPage === 'following') {
    // 关注页面使用分组展示，不需要滚动加载
  } else {
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      const states = {
        home: { state: pageStates.home, action: p => fetchVideos(p, true) },
        popular: { state: pageStates.popular, action: p => fetchPopularVideos(p, true) },
        search: { state: pageStates.search, action: p => searchVideos(pageStates.search.keyword, p, true) }
      }

      const current = states[currentPage]
      if (current && !current.state.loading && current.state.hasMore) {
        console.log(`Scroll triggered: loading page ${current.state.pageNum + 1}`)
        current.state.pageNum++
        current.action(current.state.pageNum)
      }
    }
  }
}
