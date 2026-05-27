let scrollThrottleTimer = null
let scrollAnimationFrame = null

function throttle(func, limit = 100) {
  return function() {
    if (!scrollThrottleTimer) {
      func.apply(this, arguments)
      scrollThrottleTimer = setTimeout(() => {
        scrollThrottleTimer = null
      }, limit)
    }
  }
}

function handleScroll() {
  if (scrollAnimationFrame) {
    cancelAnimationFrame(scrollAnimationFrame)
  }
  
  scrollAnimationFrame = requestAnimationFrame(() => {
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
      handleMyPageScroll(scrollTop, scrollHeight, clientHeight)
    } else if (currentPage === 'up') {
      handleUpPageScroll(scrollTop, scrollHeight, clientHeight)
    } else if (currentPage === 'bangumi') {
      handleBangumiScroll(scrollTop, scrollHeight, clientHeight)
    } else if (currentPage === 'media') {
      handleMediaScroll(scrollTop, scrollHeight, clientHeight)
    } else if (currentPage === 'bangumi-all') {
      handleBangumiAllScroll(scrollTop, scrollHeight, clientHeight)
    } else if (currentPage === 'media-all') {
      handleMediaAllScroll(scrollTop, scrollHeight, clientHeight)
    } else {
      handleOtherPageScroll(scrollTop, scrollHeight, clientHeight)
    }
  })
}

function handleMyPageScroll(scrollTop, scrollHeight, clientHeight) {
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

  const nearBottom = scrollTop + clientHeight >= scrollHeight - 300

  if (nearBottom) {
    if (!state.isHistoryLoading && state.hasMoreHistory) {
      const historyTab = document.querySelector('.my-tab.active[data-tab="history"]')
      if (historyTab) {
        console.log('触发加载更多历史记录')
        loadHistory(true)
      }
    }

    if (!state.isFavoritesLoading && state.hasMoreFavorites) {
      const favoritesTab = document.querySelector('.my-tab.active[data-tab="favorites"]')
      if (favoritesTab) {
        console.log('触发加载更多收藏')
        loadFavorites(true)
      }
    }

    if (!state.isToviewLoading && state.hasMoreToview) {
      const toviewTab = document.querySelector('.my-tab.active[data-tab="later"]')
      if (toviewTab) {
        console.log('触发加载更多稍后再看')
        loadToview(true)
      }
    }
  }
}

function handleUpPageScroll(scrollTop, scrollHeight, clientHeight) {
  const upTabsWrapper = document.querySelector('.up-tabs-wrapper')
  const state = pageStates.up

  if (upTabsWrapper) {
    if (state.tabsOriginalOffset === null || state.tabsOriginalOffset === undefined) {
      state.tabsOriginalOffset = upTabsWrapper.offsetTop
      state.tabsHeight = upTabsWrapper.offsetHeight
    }

    if (scrollTop >= state.tabsOriginalOffset - 64) {
      if (!upTabsWrapper.classList.contains('sticky')) {
        upTabsWrapper.classList.add('sticky')

        let placeholder = document.querySelector('.up-tabs-placeholder')
        if (!placeholder) {
          placeholder = document.createElement('div')
          placeholder.className = 'up-tabs-placeholder'
          upTabsWrapper.parentNode.insertBefore(placeholder, upTabsWrapper.nextSibling)
        }
        placeholder.style.height = state.tabsHeight + 'px'
        placeholder.classList.add('show')
      }
    } else {
      if (upTabsWrapper.classList.contains('sticky')) {
        upTabsWrapper.classList.remove('sticky')
        const placeholder = document.querySelector('.up-tabs-placeholder')
        if (placeholder) {
          placeholder.classList.remove('show')
          placeholder.remove()
        }
      }
    }
  }

  const nearBottom = scrollTop + clientHeight >= scrollHeight - 300

  if (nearBottom) {
    if (pageStates.up.currentTab === 'videos') {
      if (!pageStates.up.loading && !pageStates.up.scrollLocked && pageStates.up.hasMore) {
        pageStates.up.scrollLocked = true
        loadUpVideos(pageStates.up.mid, pageStates.up.offset)
      }
    } else if (pageStates.up.currentTab === 'dynamics') {
      if (!pageStates.up.dynamicLoading && pageStates.up.hasMoreDynamics) {
        loadUpDynamics(pageStates.up.mid, pageStates.up.dynamicOffset)
      }
    }
  }
  
  // 预加载视口内的图片
  if (pageStates.up.currentTab === 'dynamics') {
    preloadVisibleImages(scrollTop, clientHeight)
  }
}

function preloadVisibleImages(scrollTop, clientHeight) {
  const viewportBottom = scrollTop + clientHeight + 500 // 额外预加载500px范围内的图片
  const cards = document.querySelectorAll('.up-dynamic-card')
  
  cards.forEach(card => {
    const rect = card.getBoundingClientRect()
    const cardTop = rect.top + scrollTop
    
    if (cardTop < viewportBottom && cardTop + rect.height > scrollTop) {
      // 图片在视口范围内或即将进入视口
      const images = card.querySelectorAll('img[loading="lazy"]')
      images.forEach(img => {
        if (img.dataset.src && !img.src) {
          img.src = img.dataset.src
          img.removeAttribute('data-src')
        }
      })
    }
  })
}

function handleBangumiScroll(scrollTop, scrollHeight, clientHeight) {
  const nearBottom = scrollTop + clientHeight >= scrollHeight - 300
  if (nearBottom) {
    const state = pageStates.bangumi
    if (!state.loading && state.hasMore && state.cursor) {
      console.log('触发加载更多追番猜你喜欢')
      loadMoreGuessItems()
    }
  }
}

function handleMediaScroll(scrollTop, scrollHeight, clientHeight) {
  const nearBottom = scrollTop + clientHeight >= scrollHeight - 300
  if (nearBottom) {
    const state = pageStates.media
    if (!state.loading && state.hasMore && state.cursor) {
      console.log('触发加载更多影视猜你喜欢')
      loadMoreMediaGuessItems()
    }
  }
}

function handleBangumiAllScroll(scrollTop, scrollHeight, clientHeight) {
  const nearBottom = scrollTop + clientHeight >= scrollHeight - 300
  if (nearBottom) {
    if (!bangumiAllState.loading && bangumiAllState.hasMore) {
      console.log('触发加载更多追番全部')
      loadBangumiAllData(true)
    }
  }
}

function handleMediaAllScroll(scrollTop, scrollHeight, clientHeight) {
  const nearBottom = scrollTop + clientHeight >= scrollHeight - 300
  if (nearBottom) {
    if (!mediaAllState.loading && mediaAllState.hasMore) {
      console.log('触发加载更多影视全部')
      loadMediaAllData(true)
    }
  }
}

function handleOtherPageScroll(scrollTop, scrollHeight, clientHeight) {
  const nearBottom = scrollTop + clientHeight >= scrollHeight - 300
  if (nearBottom) {
    const states = {
      home: { state: pageStates.home, action: p => fetchVideos(p, true) },
      popular: { state: pageStates.popular, action: p => fetchPopularVideos(pageStates.popular.currentTab, p, true, pageStates.popular.currentRid) },
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

const throttledHandleScroll = throttle(handleScroll, 100)