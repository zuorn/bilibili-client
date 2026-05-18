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
    const popularGrid = document.getElementById('popularGrid')
    if (popularGrid) popularGrid.innerHTML = ''
    fetchPopularVideos(1, false)
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

  updateNavLinks(page)
  updateBackButton()

  // 切换滚动监听器
  const content = document.querySelector('.content')
  if (content) {
    content.removeEventListener('scroll', handleScroll)
    content.removeEventListener('scroll', handleDynamicScroll)
    if (page === 'dynamic') {
      content.addEventListener('scroll', handleDynamicScroll)
    } else {
      content.addEventListener('scroll', handleScroll)
    }
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
