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
    fetchPopularVideosByTab('comprehensive', 1, false)
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

// 持续滚动状态（用于 e / d 长按时连续滚动）
let activeScrollDirection = null
let scrollRafId = null
let scrollLastFrameTime = 0
let scrollHoldStartTime = 0

// 每滚动 1 秒移动的距离（像素）= 视口高度的 N 倍
const SCROLL_SPEED_VH_PER_SEC = 0.9
// 加速持续时间（秒）：在此时间内速度从 1x 线性增加到 MAX
const SCROLL_ACCEL_DURATION = 2.0
const SCROLL_MAX_SPEED_MULT = 1.8

function scrollHalfPage(direction, smooth = true) {
  const content = document.querySelector('.content') || document.documentElement
  const currentTop = content.scrollTop
  const viewHeight = content.clientHeight || window.innerHeight
  const halfPage = Math.floor(viewHeight / 2)

  if (direction === 'up') {
    if (smooth) {
      content.scrollTo({ top: Math.max(0, currentTop - halfPage), behavior: 'smooth' })
    } else {
      content.scrollTop = Math.max(0, currentTop - halfPage)
    }
  } else {
    if (smooth) {
      content.scrollTo({ top: currentTop + halfPage, behavior: 'smooth' })
    } else {
      content.scrollTop = currentTop + halfPage
    }
  }
}

function startContinuousScroll(direction) {
  const isSameDir = activeScrollDirection === direction && scrollRafId !== null
  if (isSameDir) return

  stopContinuousScroll()
  activeScrollDirection = direction
  scrollHoldStartTime = performance.now()
  scrollLastFrameTime = performance.now()

  const content = document.querySelector('.content') || document.documentElement
  const baseSpeed = (content.clientHeight || window.innerHeight) * SCROLL_SPEED_VH_PER_SEC

  function tick(now) {
    const dt = (now - scrollLastFrameTime) / 1000
    if (dt <= 0) {
      scrollRafId = requestAnimationFrame(tick)
      return
    }
    scrollLastFrameTime = now

    const delta = baseSpeed * dt

    if (activeScrollDirection === 'up') {
      content.scrollTop = Math.max(0, content.scrollTop - delta)
    } else if (activeScrollDirection === 'down') {
      content.scrollTop = content.scrollTop + delta
    }

    if (activeScrollDirection) {
      scrollRafId = requestAnimationFrame(tick)
    }
  }

  scrollRafId = requestAnimationFrame(tick)
}

function stopContinuousScroll() {
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  activeScrollDirection = null
  scrollHoldStartTime = 0
}

// 判断按键是否是"滚动"类快捷键（仅支持单键组合启用连续滚动）
// 返回 'up' / 'down' / null
function getScrollDirectionFromKey(e) {
  const scrollUpShortcut = userShortcuts && userShortcuts.scrollUp
  const scrollDownShortcut = userShortcuts && userShortcuts.scrollDown
  const k = (e.key || '').toLowerCase()

  const singleKeyMatch = (cfg) => cfg && cfg.keys && cfg.keys.some(ks => {
    if (!Array.isArray(ks) || ks.length !== 1) return false
    return normalizeKey(ks[0]) === k
  })

  if (singleKeyMatch(scrollUpShortcut)) return 'up'
  if (singleKeyMatch(scrollDownShortcut)) return 'down'
  // 回退：未载入配置时按默认 e / d 识别
  if (!scrollUpShortcut && !scrollDownShortcut) {
    if (k === 'e') return 'up'
    if (k === 'd') return 'down'
  }
  return null
}

function navigateToPage(page) {
  if (currentPage === 'search' && page !== 'search') {
    const searchInput = document.getElementById('searchInput')
    const searchInputClearBtn = document.getElementById('searchInputClearBtn')
    if (searchInput) searchInput.value = ''
    if (searchInputClearBtn) searchInputClearBtn.style.display = 'none'
  }

  pageHistory.push(currentPage)
  if (pageHistory.length > 50) pageHistory.shift()

  currentPage = page

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active')
    if (item.dataset.page === page) item.classList.add('active')
  })

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active')
    if (link.dataset.page === page) {
      // 动态页面默认激活综合tab
      if (page === 'dynamic') {
        if (link.dataset.subtab === 'dynamics') {
          link.classList.add('active')
        }
      } else {
        link.classList.add('active')
      }
    }
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
    if (typeof handleDynamicScroll !== 'undefined') {
      content.removeEventListener('scroll', handleDynamicScroll)
    }
    if (page === 'dynamic' && typeof handleDynamicScroll !== 'undefined') {
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

  if (page === 'my' || page === 'up' || page === 'settings') {
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

  // 已回到首页，不允许继续返回
  if (pageHistory.length === 0) return

  const prevPage = pageHistory.pop()
  navigateToPage(prevPage)
}

function updateBackButton() {
  const backBtn = document.getElementById('sidebarBackBtn')
  if (backBtn) {
    if (pageHistory.length > 0) {
      backBtn.classList.remove('disabled')
      backBtn.title = '返回上一页'
    } else {
      backBtn.classList.add('disabled')
      backBtn.title = '已回到首页'
    }
  }
}
