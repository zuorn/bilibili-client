// 应用入口和所有事件监听器初始化

document.addEventListener('DOMContentLoaded', async () => {
  await loadDefaultShortcuts()
  loadShortcuts()
  initEventListeners()
  if (typeof initViewAllButtons === 'function') initViewAllButtons()
  if (typeof initPopularTabs === 'function') initPopularTabs()
  if (typeof initRankingFilters === 'function') initRankingFilters()
  checkLoginStatus()
  navigateToPage('home')
})

function initEventListeners() {
  document.getElementById('minBtn')?.addEventListener('click', () => ipcRenderer.invoke('minimize-window'))
  document.getElementById('maxBtn')?.addEventListener('click', () => ipcRenderer.invoke('maximize-window'))
  document.getElementById('closeBtn')?.addEventListener('click', () => ipcRenderer.invoke('close-window'))

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault()
      const page = link.dataset.page
      const subtab = link.dataset.subtab
      
      if (page === 'dynamic' && subtab) {
        // 如果是动态页面的子tab，调用switchDynamicTab
        if (typeof switchDynamicTab === 'function') {
          switchDynamicTab(subtab)
        }
      } else if (page) {
        navigateToPage(page)
      }
    })
  })

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page
      if (page) navigateToPage(page)
    })
  })

  ipcRenderer.on('navigate-to-up', (event, mid) => {
    if (typeof navigateToUP === 'function') navigateToUP(mid)
  })

  document.getElementById('sidebarUserAvatar').addEventListener('click', () => {
    if (currentUser?.isLogin && currentUser?.mid) {
      navigateToUP(currentUser.mid, true)
    } else {
      openLoginModal()
    }
  })
  document.getElementById('sidebarBackBtn').addEventListener('click', goBack)

  document.getElementById('myFollowingCount')?.addEventListener('click', () => {
    navigateToPage('following')
  })
  document.getElementById('followingCount')?.addEventListener('click', () => {
    if (pageStates.up?.mid) {
      pageStates.following.targetMid = pageStates.up.mid
      navigateToPage('following')
    }
  })
  const searchInputClearBtn = document.getElementById('searchInputClearBtn')

  function showSearchClearButton(show) {
    if (searchInputClearBtn) {
      searchInputClearBtn.style.display = show ? 'flex' : 'none'
    }
  }

  document.getElementById('searchBtn').addEventListener('click', e => {
    e.stopPropagation()
    e.preventDefault()

    const searchInput = document.getElementById('searchInput')
    const header = document.querySelector('.header')

    if (header) {
      header.classList.remove('search-focused')
      header.dataset.historyLoaded = ''
    }

    if (searchInput) {
      searchInput.blur()
      document.activeElement?.blur?.()
    }

    setTimeout(() => {
      const input = document.getElementById('searchInput')
      if (input) {
        input.blur()
      }
      document.activeElement?.blur?.()
    }, 0)

    handleSearch()
  })

  if (searchInputClearBtn) {
    searchInputClearBtn.addEventListener('click', e => {
      e.stopPropagation()
      e.preventDefault()
      const searchInput = document.getElementById('searchInput')
      if (searchInput) {
        searchInput.value = ''
        showSearchClearButton(false)
      }
    })
  }
  document.getElementById('searchInput').addEventListener('keydown', handleSearchOnEnter)

  const searchInput = document.getElementById('searchInput')
  if (searchInput) {
    searchInput.addEventListener('focus', e => {
      e.stopPropagation()
      handleSearchFocus()
    })

    searchInput.addEventListener('blur', e => {
      e.stopPropagation()
      handleSearchBlur()
    })

    searchInput.addEventListener('click', e => {
      e.stopPropagation()
      const target = e.target
      const searchBtn = document.getElementById('searchBtn')
      if (searchBtn && !searchBtn.contains(target)) {
        handleSearchFocus()
      }
    })
  }

  document.getElementById('clearHistoryBtn').addEventListener('click', clearSearchHistory)

  const searchDropdown = document.getElementById('searchDropdown')
  if (searchDropdown) {
    searchDropdown.addEventListener('click', e => {
      const target = e.target
      const isHistoryTag = target.closest('.history-tag')
      const isHotItem = target.closest('.hot-item')
      const isClearBtn = target.closest('.clear-history-btn')
      if (isHistoryTag || isHotItem || isClearBtn) {
        return
      }
      e.stopPropagation()
      const searchInput = document.getElementById('searchInput')
      if (searchInput) {
        searchInput.focus()
      }
    })
  }

  document.getElementById('loginCloseBtn').addEventListener('click', () => {
    stopLoginPoll()
    document.getElementById('loginModal').style.display = 'none'
  })

  document.querySelectorAll('.login-form-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.login-form-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const tabId = tab.id
      document.querySelector('.pwd-login')?.classList.toggle('active', tabId === 'pwdTab')
      document.querySelector('.sms-login')?.classList.toggle('active', tabId === 'smsTab')
    })
  })

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.up-tab')
    if (tab) {
      const tabName = tab.dataset.tab
      if (tabName) switchUpTab(tabName)
    }
  })

  document.querySelectorAll('.my-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.my-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const tabName = tab.dataset.tab
      if (tabName === 'history') {
        document.getElementById('history-content').style.display = 'block'
        document.getElementById('favorites-content').style.display = 'none'
        document.getElementById('bangumi-content')?.style.setProperty('display', 'none')
        document.getElementById('drama-content')?.style.setProperty('display', 'none')
        document.getElementById('toview-content').style.display = 'none'
        document.getElementById('historySearchInput').placeholder = '搜索你的历史记录'
        if (currentUser?.isLogin) loadHistory()
      } else if (tabName === 'favorites') {
        document.getElementById('history-content').style.display = 'none'
        document.getElementById('favorites-content').style.display = 'block'
        document.getElementById('bangumi-content')?.style.setProperty('display', 'none')
        document.getElementById('drama-content')?.style.setProperty('display', 'none')
        document.getElementById('toview-content').style.display = 'none'
        document.getElementById('historySearchInput').placeholder = '搜索你的收藏内容'
        if (currentUser?.isLogin) {
          document.querySelector('.no-login-area')?.style.setProperty('display', 'none')
          document.querySelector('.favorites-sub-tabs')?.style.setProperty('display', 'flex')
          document.querySelectorAll('.favorites-sub-content').forEach(c => c.style.display = 'none')
          document.getElementById('favorites-default-content').style.display = 'block'
          document.querySelectorAll('.favorites-sub-tab').forEach(t => t.classList.remove('active'))
          document.querySelector('.favorites-sub-tab[data-subtab="default"]')?.classList.add('active')
          
          // 显示清空失效内容按钮，隐藏其他按钮
          const clearBtn = document.getElementById('clearExpiredContentBtn')
          const addBtn = document.getElementById('addFavoriteFolderBtn')
          const sortBtn = document.getElementById('sortFavoriteFolderBtn')
          if (clearBtn) {
            clearBtn.style.display = 'flex'
            clearBtn.style.visibility = 'visible'
          }
          if (addBtn) {
            addBtn.style.display = 'none'
            addBtn.style.visibility = 'hidden'
          }
          if (sortBtn) {
            sortBtn.style.display = 'none'
            sortBtn.style.visibility = 'hidden'
          }
          
          loadFavoritesDefault()
        }
      } else if (tabName === 'bangumi') {
        document.getElementById('history-content').style.display = 'none'
        document.getElementById('favorites-content').style.display = 'none'
        document.getElementById('drama-content')?.style.setProperty('display', 'none')
        document.getElementById('toview-content')?.style.setProperty('display', 'none')
        const bangumiContent = document.getElementById('bangumi-content')
        if (bangumiContent) {
          bangumiContent.style.display = 'block'
        }
        loadBangumi(1)
      } else if (tabName === 'drama') {
        document.getElementById('history-content').style.display = 'none'
        document.getElementById('favorites-content').style.display = 'none'
        document.getElementById('bangumi-content')?.style.setProperty('display', 'none')
        document.getElementById('toview-content').style.display = 'none'
        const dramaContent = document.getElementById('drama-content')
        if (dramaContent) {
          dramaContent.style.display = 'block'
        }
        loadDrama()
      } else if (tabName === 'later') {
        document.getElementById('history-content').style.display = 'none'
        document.getElementById('favorites-content').style.display = 'none'
        document.getElementById('bangumi-content')?.style.setProperty('display', 'none')
        document.getElementById('drama-content')?.style.setProperty('display', 'none')
        document.getElementById('toview-content').style.display = 'block'
        document.getElementById('historySearchInput').placeholder = '搜索你的稍后再看'
        if (currentUser?.isLogin) {
          document.getElementById('toviewGrid').style.display = 'grid'
          pageStates.my.toviewPageNum = 1
          pageStates.my.hasMoreToview = true
          pageStates.my.isToviewLoading = false
          loadToview()
        }
      } else if (tabName === 'favorites') {
        document.getElementById('historySearchInput').placeholder = '搜索你的收藏内容'
      } else if (tabName === 'history') {
        document.getElementById('historySearchInput').placeholder = '搜索你的历史记录'
      }
    })
  })

  document.querySelectorAll('.favorites-sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.favorites-sub-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const subTabName = tab.dataset.subtab
      document.querySelectorAll('.favorites-sub-content').forEach(c => c.style.display = 'none')
      
      // 控制排序按钮显示
      const sortBtn = document.getElementById('sortFavoriteFolderBtn')
      console.log('Sub-tab clicked:', subTabName, 'Sort button:', sortBtn)
      if (sortBtn) {
        if (subTabName === 'created') {
          sortBtn.style.display = 'flex'
          sortBtn.style.visibility = 'visible'
        } else {
          sortBtn.style.display = 'none'
          sortBtn.style.visibility = 'hidden'
        }
      }

      // 控制新建收藏夹按钮显示
      const addBtn = document.getElementById('addFavoriteFolderBtn')
      if (addBtn) {
        if (subTabName === 'created') {
          addBtn.style.display = 'flex'
          addBtn.style.visibility = 'visible'
        } else {
          addBtn.style.display = 'none'
          addBtn.style.visibility = 'hidden'
        }
      }

      // 控制清空失效内容按钮显示（只在默认收藏夹显示）
      const clearBtn = document.getElementById('clearExpiredContentBtn')
      if (clearBtn) {
        if (subTabName === 'default') {
          clearBtn.style.display = 'flex'
          clearBtn.style.visibility = 'visible'
        } else {
          clearBtn.style.display = 'none'
          clearBtn.style.visibility = 'hidden'
        }
      }
      
      if (subTabName === 'default') {
        document.getElementById('favorites-default-content').style.display = 'block'
        loadFavoritesDefault()
      } else if (subTabName === 'created') {
        document.getElementById('favorites-created-content').style.display = 'block'
        loadFavoritesCreated()
      } else if (subTabName === 'collections') {
        document.getElementById('favorites-collections-content').style.display = 'block'
        loadFavoritesCollections()
      }
    })
  })

  const historySearchInput = document.getElementById('historySearchInput')
  const historySearchBtn = document.getElementById('historySearchBtn')
  const searchClearBtn = document.getElementById('searchClearBtn')

  function getCurrentTab() {
    const activeTab = document.querySelector('.my-tab.active')
    return activeTab ? activeTab.dataset.tab : 'history'
  }

  function showClearButton(show) {
    if (searchClearBtn) {
      searchClearBtn.style.display = show ? 'flex' : 'none'
    }
  }

  function reloadCurrentTab() {
    const currentTab = getCurrentTab()
    if (currentTab === 'history') {
      pageStates.my.historyCursor = null
      pageStates.my.hasMoreHistory = true
      pageStates.my.isHistoryLoading = false
      loadHistory()
    } else if (currentTab === 'favorites') {
      pageStates.my.favoritesPageNum = 1
      pageStates.my.hasMoreFavorites = true
      pageStates.my.isFavoritesLoading = false
      loadFavorites()
    } else if (currentTab === 'later') {
      pageStates.my.toviewPageNum = 1
      pageStates.my.hasMoreToview = true
      pageStates.my.isToviewLoading = false
      loadToview()
    }
  }

  function performSearch(keyword) {
    const currentTab = getCurrentTab()
    if (currentTab === 'history') {
      searchHistory(keyword)
    } else if (currentTab === 'favorites') {
      searchFavorites(keyword)
    } else if (currentTab === 'later') {
      searchToview(keyword)
    }
    if (keyword) {
      showClearButton(true)
    }
  }

  if (historySearchBtn) {
    historySearchBtn.addEventListener('click', () => {
      const keyword = historySearchInput.value.trim()
      if (keyword) {
        performSearch(keyword)
      }
    })
  }

  if (historySearchInput) {
    historySearchInput.addEventListener('keyup', (e) => {
      const keyword = historySearchInput.value.trim()
      showClearButton(keyword.length > 0)
      if (e.key === 'Enter') {
        if (keyword) {
          performSearch(keyword)
        }
      }
    })

    historySearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        historySearchInput.value = ''
        showClearButton(false)
        reloadCurrentTab()
        historySearchInput.blur()
      }
    })
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      historySearchInput.value = ''
      showClearButton(false)
      reloadCurrentTab()
    })
  }

  document.getElementById('myLoginBtn')?.addEventListener('click', openLoginModal)
  document.getElementById('myLoginBtn2')?.addEventListener('click', openLoginModal)
  document.getElementById('dynamicLoginBtn')?.addEventListener('click', openLoginModal)
  document.getElementById('mySpaceBtn')?.addEventListener('click', () => {
    if (currentUser?.isLogin && currentUser?.mid) {
      navigateToUP(currentUser.mid, true)
    }
  })
  document.getElementById('settingsLogoutBtn')?.addEventListener('click', handleLogout)

  document.querySelector('.content')?.addEventListener('scroll', handleScroll)

  initTheme()
  document.getElementById('themeSelect')?.addEventListener('change', handleThemeChange)
  document.getElementById('sidebarThemeBtn')?.addEventListener('click', toggleTheme)
  document.getElementById('settingsAvatar')?.addEventListener('click', () => {
    if (currentUser?.isLogin) {
      navigateToPage('my')
    } else {
      openLoginModal()
    }
  })
  document.getElementById('openShortcutSettingsBtn')?.addEventListener('click', openShortcutSettings)
  document.getElementById('openDevToolsBtn')?.addEventListener('click', () => {
    ipcRenderer.invoke('open-dev-tools')
  })
  document.getElementById('reloadWindowBtn')?.addEventListener('click', () => {
    ipcRenderer.invoke('reload-window')
  })
  document.getElementById('mpvPathBtn')?.addEventListener('click', selectMpvPath)
  initMpvPath()
  initDanmakuToggle()
  initBuiltinPlayerToggle()
  initAppVersion()   // 动态设置关于页面的版本号

  // 底部操作按钮事件
  const refreshBtn = document.getElementById('refreshBtn')
  const backTopBtn = document.getElementById('backTopBtn')

  refreshBtn?.addEventListener('click', () => {
    const content = document.querySelector('.content') || document.documentElement
    content.scrollTo({ top: 0, behavior: 'smooth' })

    if (currentPage === 'home') {
      pageStates.home.pageNum = 1
      pageStates.home.hasMore = true
      pageStates.home.videos = []
      const videoGrid = document.getElementById('videoGrid')
      if (videoGrid) videoGrid.innerHTML = ''
      fetchVideos(1, false)
    } else if (currentPage === 'popular') {
      pageStates.popular.pageNum = 1
      pageStates.popular.hasMore = true
      pageStates.popular.videos = []
      pageStates.popular.currentTab = 'comprehensive'
      const popularGrid = document.getElementById('popularGrid')
      if (popularGrid) popularGrid.innerHTML = ''
      // 重置tab状态
      const tabsContainer = document.getElementById('popularTabs')
      if (tabsContainer) {
        const tabs = tabsContainer.querySelectorAll('.page-tab')
        tabs.forEach((t, index) => {
          t.classList.remove('active')
          if (index === 0) t.classList.add('active')
        })
      }
      fetchPopularVideosByTab('comprehensive', 1, false)
    } else if (currentPage === 'dynamic') {
      if (typeof selectAllDynamic === 'function') {
        selectAllDynamic()
      }
    } else {
      loadPageContent(currentPage)
    }
  })

  backTopBtn?.addEventListener('click', () => {
    const content = document.querySelector('.content')
    if (content) {
      content.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })

  // UP page follow button
  document.querySelector('.up-actions .follow-btn')?.addEventListener('click', () => {
    if (typeof toggleFollow !== 'function') return
    const btn = document.querySelector('.up-actions .follow-btn')
    const following = btn?.classList.contains('followed')
    if (!following) {
      toggleFollow()
    }
  })

  // 右键视频卡片：在新窗口打开（不关闭已有播放窗口），左键行为不变
  document.addEventListener('contextmenu', (e) => {
    const videoCard = e.target.closest('.video-card')
    if (!videoCard) return
    const bvid = videoCard.dataset.bvid
    if (!bvid) return
    e.preventDefault()
    const titleEl = videoCard.querySelector('.video-title, .dynamic-video-title, .up-dynamic-video-title')
    const title = titleEl?.textContent?.trim() || ''
    if (typeof playVideoInNewWindow === 'function') {
      playVideoInNewWindow(bvid, videoCard.dataset.cid || '', title)
    }
  })
}
