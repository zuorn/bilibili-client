// 导航相关函数

function refreshCurrentPage() {
  console.log('Refreshing current page:', currentPage)

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
    fetchPopularVideos('comprehensive', 1, false)
  } else if (currentPage === 'dynamic') {
    if (typeof selectAllDynamic === 'function') {
      selectAllDynamic()
    }
  } else {
    loadPageContent(currentPage)
  }
}

function scrollToTop() {
  const content = document.querySelector('.content') || document.documentElement
  content.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollHalfPage(direction) {
  const content = document.querySelector('.content') || document.documentElement
  const currentTop = content.scrollTop
  const viewHeight = content.clientHeight || window.innerHeight
  const halfPage = Math.floor(viewHeight / 2)

  if (direction === 'up') {
    content.scrollTo({ top: Math.max(0, currentTop - halfPage), behavior: 'smooth' })
  } else {
    content.scrollTo({ top: currentTop + halfPage, behavior: 'smooth' })
  }
}

function navigateToPage(page) {
  console.log('navigateToPage called with:', page)
  pageHistory.push(currentPage)
  if (pageHistory.length > 50) pageHistory.shift()

  currentPage = page

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active')
    if (item.dataset.page === page) item.classList.add('active')
  })

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active')
    if (link.dataset.page === page) link.classList.add('active')
  })

  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'))
  document.getElementById(`page-${page}`)?.classList.add('active')

  // 导航到设置或我的页面时刷新登录状态 UI
  if (page === 'settings' || page === 'my') {
    if (typeof updateSettingsAvatar === 'function') updateSettingsAvatar()
    if (typeof updateSettingsUserName === 'function') updateSettingsUserName()
  }

  updateNavLinks(page)
  updateBackButton()

  const content = document.querySelector('.content')
  if (content) {
    content.removeEventListener('scroll', throttledHandleScroll)
    content.removeEventListener('scroll', handleDynamicScroll)
    if (page === 'dynamic') {
      content.addEventListener('scroll', handleDynamicScroll)
    } else {
      content.addEventListener('scroll', throttledHandleScroll)
    }
    
    content.scrollTo({ top: 0, behavior: 'smooth' })
  }

  loadPageContent(page)
}

function updateNavLinks(page) {
  const navLinks = document.querySelector('.nav-links')
  const homeLinks = document.querySelector('.home-links')
  const dynamicLinks = document.querySelector('.dynamic-links')

  if (page === 'my') {
    navLinks.style.display = 'none'
  } else if (page === 'dynamic') {
    navLinks.style.display = 'flex'
    if (homeLinks) homeLinks.style.display = 'none'
    if (dynamicLinks) dynamicLinks.style.display = 'flex'
  } else if (page === 'bangumi-all') {
    navLinks.style.display = 'flex'
    if (homeLinks) homeLinks.style.display = 'flex'
    if (dynamicLinks) dynamicLinks.style.display = 'none'
  } else {
    navLinks.style.display = 'flex'
    if (homeLinks) homeLinks.style.display = 'flex'
    if (dynamicLinks) dynamicLinks.style.display = 'none'
  }
}

function goBack() {
  const upCollectionsSeriesGrid = document.getElementById('upCollectionsSeriesGrid')
  if (upCollectionsSeriesGrid && upCollectionsSeriesGrid.classList.contains('season-detail-mode')) {
    if (typeof backToCollectionsList === 'function') {
      backToCollectionsList()
      return
    }
  }
  
  const favoritesCreatedList = document.getElementById('favoritesCreatedList')
  if (favoritesCreatedList && favoritesCreatedList.classList.contains('season-detail-mode')) {
    if (typeof backToFavoritesCreated === 'function') {
      backToFavoritesCreated()
      return
    }
  }

  const favoritesCollectionsGrid = document.getElementById('favoritesCollectionsGrid')
  if (favoritesCollectionsGrid && favoritesCollectionsGrid.classList.contains('season-detail-mode')) {
    if (typeof backToFavoritesCollections === 'function') {
      backToFavoritesCollections()
      return
    }
  }

  if (pageHistory.length > 0) {
    const prevPage = pageHistory.pop()
    navigateToPage(prevPage)
  }
}

function updateBackButton() {
  const backBtn = document.getElementById('sidebarBackBtn')
  if (backBtn) {
    backBtn.style.display = pageHistory.length > 0 ? 'flex' : 'none'
  }
}
