const { ipcRenderer } = require('electron')

let currentUser = null
let currentPage = 'home'
let pageHistory = []

let defaultShortcuts = {
  focusSearch: { keys: [['ctrl', 'f'], ['ctrl', 'l']], label: '聚焦搜索框' },
  clearSearch: { keys: [['escape']], label: '取消搜索聚焦' },
  goBack: { keys: [['alt', 'arrowleft'], ['alt', 'arrowright']], label: '返回上一页' },
  openSettings: { keys: [['ctrl', 'shift', 's']], label: '打开设置' },
  openShortcutSettings: { keys: [['ctrl', 'shift', ',']], label: '打开快捷键设置' },
  closeWindow: { keys: [['ctrl', 'shift', 'q']], label: '关闭窗口/弹出框' },
  refresh: { keys: [['r']], label: '刷新当前页' },
  goTop: { keys: [['g', 'g']], label: '回到顶部' },
  scrollDown: { keys: [['d']], label: '向下翻半页' },
  scrollUp: { keys: [['e']], label: '向上翻半页' }
}

let userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
let currentRecording = { id: null, index: null }
let shortcutsEnabled = true
let pendingGoTop = false

function parseConf(content) {
  const config = {}
  const lines = content.split('\n')
  let currentSection = ''
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1)
      continue
    }
    
    const [key, value] = trimmed.split('=', 2)
    if (key && value !== undefined) {
      config[key.trim()] = value.trim()
    }
  }
  
  return config
}

function convertConfToShortcuts(conf) {
  const shortcuts = {}
  const keys = Object.keys(conf)
  
  for (const key of keys) {
    if (key.endsWith('.label')) {
      const id = key.replace('.label', '')
      const label = conf[key]
      const keysStr = conf[id + '.keys'] || ''
      
      const keyCombinations = keysStr.split(',').map(k => {
        return k.trim().split('+').map(k2 => k2.trim())
      }).filter(k => k.length > 0 && k[0] !== '')
      
      shortcuts[id] = {
        label: label,
        keys: keyCombinations
      }
    }
  }
  
  return shortcuts
}

async function loadDefaultShortcuts() {
  try {
    const response = await fetch('./src/config/defaultShortcuts.conf')
    if (response.ok) {
      const content = await response.text()
      const conf = parseConf(content)
      const config = convertConfToShortcuts(conf)
      defaultShortcuts = config
      console.log('默认快捷键配置加载成功:', defaultShortcuts)
      if (!userShortcuts.focusSearch || !userShortcuts.clearSearch || !userShortcuts.goBack) {
        userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
      }
    } else {
      console.error('加载默认快捷键配置失败，状态码:', response.status)
    }
  } catch (e) {
    console.error('加载默认快捷键配置失败:', e)
  }
}

let pageStates = {
  home: { pageNum: 1, videos: [], loading: false, hasMore: true },
  popular: { pageNum: 1, videos: [], loading: false, hasMore: true },

  media: { pageNum: 1, loading: false, hasMore: true },
  search: { keyword: '', pageNum: 1, loading: false, hasMore: true },
  up: { mid: null, name: '', offset: '', loading: false, hasMore: true },
  my: { historyCursor: null, hasMoreHistory: true, isHistoryLoading: false, tabsOriginalOffset: null, favoritesPageNum: 1, hasMoreFavorites: true, isFavoritesLoading: false, toviewPageNum: 1, hasMoreToview: true, isToviewLoading: false },
  bangumi: { cursor: '', loading: false, hasMore: true, data: null }
}

let currentQCode = null
let pollInterval = null
let qrStatusElement = null

const QR_LOADING_HTML =
  '<div class="qr-loading" aria-live="polite"><span class="qr-loading-spinner" aria-hidden="true"></span><span class="qr-loading-text">加载中</span></div>'

document.addEventListener('DOMContentLoaded', async () => {
  await loadDefaultShortcuts()
  loadShortcuts()
  initEventListeners()
  checkLoginStatus()
  loadPageContent('home')
})

function initEventListeners() {
  document.getElementById('minBtn')?.addEventListener('click', () => ipcRenderer.invoke('minimize-window'))
  document.getElementById('maxBtn')?.addEventListener('click', () => ipcRenderer.invoke('maximize-window'))
  document.getElementById('closeBtn')?.addEventListener('click', () => ipcRenderer.invoke('close-window'))

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault()
      const page = link.dataset.page
      if (page) navigateToPage(page)
    })
  })

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page
      if (page) navigateToPage(page)
    })
  })

  document.getElementById('sidebarUserAvatar').addEventListener('click', () => navigateToPage('my'))
  document.getElementById('sidebarBackBtn').addEventListener('click', goBack)
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

  document.querySelectorAll('.my-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.my-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const tabName = tab.dataset.tab
      if (tabName === 'history') {
        document.getElementById('history-content').style.display = 'block'
        document.getElementById('favorites-content').style.display = 'none'
        document.getElementById('bangumi-content')?.style.setProperty('display', 'none')
        document.getElementById('toview-content').style.display = 'none'
        document.getElementById('historySearchInput').placeholder = '搜索你的历史记录'
        if (currentUser?.isLogin) loadHistory()
      } else if (tabName === 'favorites') {
        document.getElementById('history-content').style.display = 'none'
        document.getElementById('favorites-content').style.display = 'block'
        document.getElementById('bangumi-content')?.style.setProperty('display', 'none')
        document.getElementById('toview-content').style.display = 'none'
        document.getElementById('historySearchInput').placeholder = '搜索你的收藏内容'
        if (currentUser?.isLogin) {
          document.getElementById('favoritesGrid').style.display = 'grid'
          pageStates.my.favoritesPageNum = 1
          pageStates.my.hasMoreFavorites = true
          pageStates.my.isFavoritesLoading = false
          loadFavorites()
        }
      } else if (tabName === 'bangumi') {
        console.log('bangumi tab clicked')
        document.getElementById('history-content').style.display = 'none'
        document.getElementById('favorites-content').style.display = 'none'
        document.getElementById('toview-content')?.style.setProperty('display', 'none')
        const bangumiContent = document.getElementById('bangumi-content')
        console.log('bangumi-content element:', bangumiContent)
        if (bangumiContent) {
          bangumiContent.style.display = 'block'
          console.log('bangumi-content display set to block')
        }
        loadBangumi(1)
      } else if (tabName === 'drama') {
        console.log('drama tab clicked')
        document.getElementById('history-content').style.display = 'none'
        document.getElementById('favorites-content').style.display = 'none'
        document.getElementById('toview-content')?.style.setProperty('display', 'none')
        const bangumiContent = document.getElementById('bangumi-content')
        console.log('bangumi-content element:', bangumiContent)
        if (bangumiContent) {
          bangumiContent.style.display = 'block'
          console.log('bangumi-content display set to block')
        }
        loadBangumi(3)
      } else if (tabName === 'later') {
        document.getElementById('history-content').style.display = 'none'
        document.getElementById('favorites-content').style.display = 'none'
        document.getElementById('bangumi-content')?.style.setProperty('display', 'none')
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
    console.log('Reloading tab:', currentTab)

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
    console.log('Searching in tab:', currentTab, 'keyword:', keyword)

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
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout)
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

  // 底部操作按钮事件
  const refreshBtn = document.getElementById('refreshBtn')
  const backTopBtn = document.getElementById('backTopBtn')

  refreshBtn?.addEventListener('click', () => {
    console.log('Refresh button clicked, current page:', currentPage)
    
    // 滚动到顶部
    const content = document.querySelector('.content') || document.documentElement
    content.scrollTo({ top: 0, behavior: 'smooth' })
    
    // 根据当前页面执行刷新
    if (currentPage === 'home') {
      // 推荐页面刷新
      pageStates.home.pageNum = 1
      pageStates.home.hasMore = true
      pageStates.home.videos = []
      const videoGrid = document.getElementById('videoGrid')
      if (videoGrid) videoGrid.innerHTML = ''
      fetchVideos(1, false)
    } else if (currentPage === 'popular') {
      // 热门页面刷新
      pageStates.popular.pageNum = 1
      pageStates.popular.hasMore = true
      pageStates.popular.videos = []
      const popularGrid = document.getElementById('popularGrid')
      if (popularGrid) popularGrid.innerHTML = ''
      fetchPopularVideos(1, false)
    } else if (currentPage === 'dynamic') {
      // 动态页面刷新
      if (typeof selectAllDynamic === 'function') {
        selectAllDynamic()
      }
    } else if (currentPage === 'my') {
      // 我的页面刷新
      if (currentUser && currentUser.isLogin) {
        if (typeof currentHistoryCursor !== 'undefined') currentHistoryCursor = null
        if (typeof hasMoreHistory !== 'undefined') hasMoreHistory = true
        if (typeof loadTabContent === 'function') {
          loadTabContent('history')
        }
      }
    } else {
      // 其他页面使用通用刷新
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
}

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
  } else if (currentPage === 'my') {
    if (currentUser && currentUser.isLogin) {
      if (typeof currentHistoryCursor !== 'undefined') currentHistoryCursor = null
      if (typeof hasMoreHistory !== 'undefined') hasMoreHistory = true
      if (typeof loadTabContent === 'function') {
        loadTabContent('history')
      }
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

function fixImageUrl(url) {
  if (!url) return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"></svg>'
  return url.startsWith('//') ? 'https:' + url : url
}

function formatPlayCount(count) {
  if (!count) return '0'
  if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿'
  if (count >= 10000) return (count / 10000).toFixed(1) + '万'
  return count.toString()
}

function formatDuration(duration) {
  if (!duration) return ''
  if (typeof duration === 'string') {
    if (duration.includes(':')) return duration
    if (duration.toLowerCase() === 'nan') return ''
    duration = parseInt(duration, 10)
  }
  if (isNaN(duration) || duration < 0) return ''
  return `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`
}

function mapVideoItem(item, options = {}) {
  const { showPlaySuffix = false, authorFallback = '未知UP主' } = options
  return {
    bvid: item.bvid || '',
    title: (item.title || '').replace(/<[^>]+>/g, ''),
    pic: fixImageUrl(item.pic || item.picture || ''),
    play: formatPlayCount(item.stat?.view || item.play || item.view || 0) + (showPlaySuffix ? '播放' : ''),
    duration: formatDuration(item.duration || item.length || 0),
    author: item.owner?.name || item.author || item.uname || authorFallback,
    owner: item.owner?.mid ? item.owner : { mid: item.mid || item.author_mid || item.owner?.id || '', name: item.author || item.uname || authorFallback }
  }
}

function createVideoCard(video, onAuthorClick) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = video.bvid
  card.dataset.cid = video.cid || ''

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="${video.pic}" alt="${video.title}" loading="lazy">
      <span class="video-duration">${video.duration}</span>
    </div>
    <div class="video-info">
      <h3 class="video-title">${video.title}</h3>
      <div class="video-meta">
        <span class="video-play">${video.play}</span>
        <span class="video-author" data-mid="${video.owner?.mid || ''}">${video.author}</span>
      </div>
    </div>
  `

  card.addEventListener('click', () => {
    if (video.bvid) playVideo(video.bvid, video.cid, video.title)
  })

  const authorSpan = card.querySelector('.video-author')
  authorSpan.addEventListener('click', e => {
    e.stopPropagation()
    const mid = video.owner?.mid || video.mid
    if (mid && onAuthorClick) onAuthorClick(mid)
  })

  return card
}

function renderVideos(videos, containerId, onAuthorClick) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''
  videos.filter(v => v.bvid || v.title).forEach(video => container.appendChild(createVideoCard(video, onAuthorClick)))
}

function appendVideos(videos, containerId, onAuthorClick) {
  const container = document.getElementById(containerId)
  if (!container) return
  videos.filter(v => v.bvid || v.title).forEach(video => container.appendChild(createVideoCard(video, onAuthorClick)))
}

function showEmptyMessage(containerId, message) {
  const container = document.getElementById(containerId)
  if (container) container.innerHTML = `<div style="padding: 40px; text-align: center; color: #999; max-width: 80%; margin: 0 auto;">${message}</div>`
}

async function fetchVideos(page = 1, append = false) {
  const state = pageStates.home
  if (state.loading) return
  state.loading = true

  const loadingEl = document.getElementById('homeLoadingMore')
  const noMoreEl = document.getElementById('homeNoMore')
  
  if (append && loadingEl) {
    loadingEl.style.display = 'block'
  }
  if (noMoreEl) {
    noMoreEl.style.display = 'none'
  }

  try {
    console.log('Fetching recommend videos via IPC, page:', page)
    const result = await ipcRenderer.invoke('fetch-videos', page)
    console.log('Fetch videos result:', result.success, result.error || '')
    
    let items = []
    if (result.success && result.data) {
      const data = result.data
      items = data?.data?.item || data?.data?.list || data?.data?.result || data?.item || data?.list || data?.result || (Array.isArray(data) ? data : []) || []
      console.log('Number of items:', items.length)
      if (items.length > 0) {
        console.log('First item:', JSON.stringify(items[0], null, 2))
      }
    }

    if (items.length > 0) {
      state.hasMore = items.length >= 30
      const newVideos = items.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || item.picture || ''),
        play: formatPlayCount(item.stat?.view || item.play || item.view || 0),
        duration: formatDuration(item.duration || item.length || 0),
        author: item.owner?.name || item.author || item.uname || '未知UP主',
        owner: item.owner?.mid ? item.owner : { mid: item.mid || item.author_mid || 0, name: item.author || item.uname || '未知UP主' }
      }))

      if (append) {
        pageStates.home.videos = [...pageStates.home.videos, ...newVideos]
        appendVideos(newVideos, 'videoGrid', navigateToUP)
      } else {
        pageStates.home.videos = newVideos
        renderVideos(newVideos, 'videoGrid', navigateToUP)
      }
      
      // 显示没有更多内容提示
      if (!state.hasMore && noMoreEl) {
        noMoreEl.style.display = 'block'
      } else {
        noMoreEl.style.display = 'none'
      }
    } else if (!append) {
      showEmptyMessage('videoGrid', '获取视频失败，请稍后重试')
    }
  } catch (error) {
    console.error('获取视频失败:', error)
    if (!append) showEmptyMessage('videoGrid', '获取视频失败，请稍后重试')
  }

  if (loadingEl) {
    loadingEl.style.display = 'none'
  }
  state.loading = false
}

async function fetchPopularVideos(page = 1, append = false) {
  const state = pageStates.popular
  if (state.loading) return
  state.loading = true

  try {
    console.log('Fetching popular videos via IPC, page:', page)

    const result = await ipcRenderer.invoke('fetch-popular-videos-v2', page)
    console.log('Popular videos result:', result.success, result.error || '')
    
    let items = []

    if (result.success && result.data && result.data.code === 0) {
      items = result.data.data?.list || (Array.isArray(result.data.data) ? result.data.data : []) || []
    }

    if (items.length > 0) {
      state.hasMore = items.length >= 20
      const newVideos = items.map(item => mapVideoItem(item, { showPlaySuffix: true }))

      if (append) {
        state.videos = [...state.videos, ...newVideos]
        appendVideos(newVideos, 'popularGrid', navigateToUP)
      } else {
        state.videos = newVideos
        renderVideos(newVideos, 'popularGrid', navigateToUP)
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

function handleSearchFocus() {
  const header = document.querySelector('.header')
  
  if (!header) return
  
  // 强制添加类，立即生效
  header.classList.add('search-focused')
  
  // 检查是否已经加载过数据
  if (!header.dataset.historyLoaded) {
    loadSearchHistory()
    loadHotSearch()
    header.dataset.historyLoaded = 'true'
  }
}

function handleSearchBlur() {
  setTimeout(() => {
    const header = document.querySelector('.header')
    const searchInput = document.getElementById('searchInput')
    const searchDropdown = document.getElementById('searchDropdown')
    
    const isSearchInputFocused = searchInput && document.activeElement === searchInput
    const isDropdownFocused = searchDropdown && searchDropdown.contains(document.activeElement)
    
    if (header && !isSearchInputFocused && !isDropdownFocused) {
      header.classList.remove('search-focused')
    }
  }, 300)
}

function getSearchHistory() {
  const history = localStorage.getItem('searchHistory')
  return history ? JSON.parse(history) : []
}

function saveSearchHistory(keyword) {
  let history = getSearchHistory()
  const index = history.indexOf(keyword)
  if (index > -1) {
    history.splice(index, 1)
  }
  history.unshift(keyword)
  if (history.length > 10) {
    history = history.slice(0, 10)
  }
  localStorage.setItem('searchHistory', JSON.stringify(history))
}

function loadSearchHistory() {
  const history = getSearchHistory()
  const container = document.getElementById('historyTags')
  if (!container) return
  
  if (history.length === 0) {
    container.innerHTML = '<span style="color: #999; font-size: 13px;">暂无搜索历史</span>'
    return
  }
  
  container.innerHTML = history.map(keyword => 
    `<span class="history-tag" data-keyword="${encodeURIComponent(keyword)}">
      ${keyword}
      <span class="history-tag-close">×</span>
    </span>`
  ).join('')
  
  container.querySelectorAll('.history-tag').forEach(tag => {
    tag.addEventListener('click', (e) => {
      const target = e.target
      if (target.classList.contains('history-tag-close')) {
        e.stopPropagation()
        const keyword = decodeURIComponent(tag.dataset.keyword)
        removeSearchHistory(keyword)
        return
      }
      const keyword = decodeURIComponent(tag.dataset.keyword)
      document.getElementById('searchInput').value = keyword
      handleSearch()
    })
  })
}

function removeSearchHistory(keyword) {
  let history = getSearchHistory()
  const index = history.indexOf(keyword)
  if (index > -1) {
    history.splice(index, 1)
    localStorage.setItem('searchHistory', JSON.stringify(history))
    loadSearchHistory()
  }
}

function clearSearchHistory() {
  localStorage.removeItem('searchHistory')
  loadSearchHistory()
}

async function loadHotSearch() {
  const container = document.getElementById('hotList')
  if (!container) return
  
  try {
    const result = await ipcRenderer.invoke('fetch-hot-search')
    if (result.success && result.data) {
      const hotList = result.data.list || result.data || []
      container.innerHTML = hotList.slice(0, 10).map((item, index) => {
        const tagClass = item.tag ? getHotTagClass(item.tag) : ''
        return `
          <div class="hot-item" data-keyword="${encodeURIComponent(item.keyword || item.title)}">
            <span class="hot-rank ${index < 3 ? 'top3' : ''}">${index + 1}</span>
            <span class="hot-title">${item.keyword || item.title}</span>
            ${item.tag ? `<span class="hot-tag ${tagClass}">${item.tag}</span>` : ''}
          </div>
        `
      }).join('')
      
      container.querySelectorAll('.hot-item').forEach(item => {
        item.addEventListener('click', () => {
          const keyword = decodeURIComponent(item.dataset.keyword)
          document.getElementById('searchInput').value = keyword
          handleSearch()
        })
      })
    } else {
      container.innerHTML = '<span style="color: #999; font-size: 13px; padding: 8px;">获取热搜失败</span>'
    }
  } catch (error) {
    console.error('获取热搜失败:', error)
    container.innerHTML = '<span style="color: #999; font-size: 13px; padding: 8px;">获取热搜失败</span>'
  }
}

function getHotTagClass(tag) {
  if (tag.includes('新')) return 'new'
  if (tag.includes('独家')) return 'exclusive'
  if (tag.includes('番')) return 'bangumi'
  if (tag.includes('视频')) return 'video'
  return ''
}

function handleSearchOnEnter(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    handleSearch()
  }
}

async function handleSearch() {
  const keyword = document.getElementById('searchInput').value.trim()
  if (!keyword) return

  const searchInputClearBtn = document.getElementById('searchInputClearBtn')
  if (searchInputClearBtn) {
    searchInputClearBtn.style.display = 'flex'
  }
  saveSearchHistory(keyword)
  
  pageStates.search.keyword = keyword
  pageStates.search.pageNum = 1
  pageStates.search.hasMore = true

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

  navigateToPage('search')
  showEmptyMessage('searchGrid', '搜索中...')
  await searchVideos(keyword, 1, false)
}

async function searchVideos(keyword, page = 1, append = false) {
  const state = pageStates.search
  if (state.loading) return
  state.loading = true

  try {
    const result = await ipcRenderer.invoke('search-videos', keyword, page)
    let items = []

    if (result.success && result.data && result.data.code === 0) {
      const data = result.data.data || {}
      if (Array.isArray(data.result)) {
        items = data.result
      } else if (Array.isArray(data.video)) {
        items = data.video
      } else if (data.result && typeof data.result === 'object' && Array.isArray(data.result.video)) {
        items = data.result.video
      } else if (data.result && typeof data.result === 'object') {
        const resultObj = data.result
        for (const key of Object.keys(resultObj)) {
          if (Array.isArray(resultObj[key])) {
            items = resultObj[key]
            break
          }
        }
      }
    }

    if (items.length > 0) {
      state.hasMore = items.length >= 20
      const newVideos = items.map(item => mapVideoItem(item))

      if (append) appendVideos(newVideos, 'searchGrid', navigateToUP)
      else renderVideos(newVideos, 'searchGrid', navigateToUP)
    } else if (!append) {
      showEmptyMessage('searchGrid', '未找到相关视频')
    }
  } catch (error) {
    console.error('搜索失败:', error)
    if (!append) showEmptyMessage('searchGrid', '搜索失败，请重试')
  }

  state.loading = false
}

async function navigateToUP(mid) {
  pageStates.up.mid = mid
  pageStates.up.offset = ''
  pageStates.up.hasMore = true
  pageStates.up.loading = false
  pageStates.up.scrollLocked = false
  pageStates.up.name = ''

  pageHistory.push(currentPage)
  if (pageHistory.length > 50) pageHistory.shift()

  currentPage = 'up'

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active')
    if (item.dataset.page === 'up') item.classList.add('active')
  })

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active')
  })

  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'))
  document.getElementById('page-up')?.classList.add('active')

  updateNavLinks('up')
  updateBackButton()

  const content = document.querySelector('.content')
  if (content) {
    content.removeEventListener('scroll', handleScroll)
    content.removeEventListener('scroll', handleDynamicScroll)
    content.addEventListener('scroll', handleScroll)
  }

  resetUpProfileUI()
  await fetchUpInfo(mid)
  loadUpVideos(mid, '')
}

function resetUpProfileUI() {
  const upAvatar = document.getElementById('upAvatar')
  const upName = document.getElementById('upName')
  const upSign = document.getElementById('upSign')
  const upLevel = document.getElementById('upLevel')
  const upVip = document.getElementById('upVip')
  const followingCount = document.getElementById('followingCount')
  const fanCount = document.getElementById('fanCount')
  const viewCount = document.getElementById('viewCount')
  const upVideoGrid = document.getElementById('upVideoGrid')
  const loadingMore = document.getElementById('upLoadingMore')
  const noMore = document.getElementById('upNoMore')

  if (upAvatar) upAvatar.src = ''
  if (upName) upName.textContent = ''
  if (upSign) upSign.textContent = ''
  if (upLevel) { upLevel.textContent = ''; upLevel.style.display = 'none' }
  if (upVip) upVip.style.display = 'none'
  if (followingCount) followingCount.textContent = '0'
  if (fanCount) fanCount.textContent = '0'
  if (viewCount) viewCount.textContent = '0'
  if (upVideoGrid) upVideoGrid.innerHTML = ''
  if (loadingMore) loadingMore.style.display = 'none'
  if (noMore) noMore.style.display = 'none'
}

async function fetchUpInfo(mid) {
  try {
    const result = await ipcRenderer.invoke('fetch-up-info', mid)
    console.log('fetchUpInfo result:', result)

    if (result.success && result.data?.data?.card) {
      const card = result.data.data.card
      console.log('UP card data:', card)

      const upNameValue = card.name || card.uname || '未知'
      pageStates.up.name = upNameValue
      pageStates.up.mid = mid

      const upAvatar = document.getElementById('upAvatar')
      const upName = document.getElementById('upName')
      const upSign = document.getElementById('upSign')
      const upLevel = document.getElementById('upLevel')
      const upVip = document.getElementById('upVip')
      const followingCount = document.getElementById('followingCount')
      const fanCount = document.getElementById('fanCount')
      const viewCount = document.getElementById('viewCount')

      console.log('DOM elements - upName:', upName, 'upSign:', upSign)

      if (upAvatar) {
        upAvatar.src = fixImageUrl(card.face) || 'https://i0.hdslb.com/bfs/archive/placeholder.png'
        upAvatar.onerror = function() {
          this.src = 'https://i0.hdslb.com/bfs/archive/placeholder.png'
        }
      } else {
        console.error('upAvatar element not found')
      }

      if (upName) {
        upName.textContent = upNameValue
        console.log('Set upName to:', upNameValue)
      } else {
        console.error('upName element not found')
      }

      if (upSign) upSign.textContent = card.sign || '这个人很懒，什么都没有写'
      if (followingCount) followingCount.textContent = formatPlayCount(card.friend || 0)
      if (fanCount) fanCount.textContent = formatPlayCount(card.fans || 0)
      if (viewCount) viewCount.textContent = formatPlayCount(card.likes || 0)

      if (upLevel) {
        const level = card.level || 0
        upLevel.textContent = 'Lv' + level
        upLevel.style.display = level > 0 ? 'inline-block' : 'none'
      }

      if (upVip) {
        if (card.vip && card.vip.type === 2) {
          upVip.innerHTML = `<svg viewBox="0 0 32 32" class="vip-icon">
            <circle cx="16" cy="16" r="14" fill="#fb7299"/>
            <text x="16" y="22" text-anchor="middle" fill="white" font-size="10" font-weight="bold">大会员</text>
          </svg>`
          upVip.style.display = 'inline-block'
        } else {
          upVip.style.display = 'none'
        }
      }
    } else {
      console.error('fetchUpInfo failed - result:', result)
    }
  } catch (error) {
    console.error('获取UP主信息失败:', error)
  }
}

async function loadUpVideos(mid, offset = '') {
  console.log('loadUpVideos called with mid:', mid, 'offset:', offset)
  if (pageStates.up.loading) {
    console.log('Already loading, skipping...')
    return
  }

  pageStates.up.loading = true
  const loadingMore = document.getElementById('upLoadingMore')
  const noMore = document.getElementById('upNoMore')
  if (loadingMore) loadingMore.style.display = 'block'
  if (noMore) noMore.style.display = 'none'

  try {
    const result = await ipcRenderer.invoke('fetch-up-videos', mid, offset)
    console.log('fetch-up-videos result:', result)

    if (result.success && result.data?.data) {
      const items = result.data.data.items || []
      console.log('Items received:', items.length)
      
      if (items.length > 0) {
        const newVideos = items.map(item => {
          const modules = item.modules || {}
          const dynamicModule = modules.module_dynamic || {}
          const majorModule = dynamicModule.major || {}
          
          let bvid = ''
          let title = ''
          let pic = ''
          let duration = ''
          let play = ''
          
          if (majorModule.archive) {
            bvid = majorModule.archive.bvid || ''
            title = majorModule.archive.title || ''
            pic = majorModule.archive.cover || ''
            duration = majorModule.archive.duration_text || ''
            
            const stat = majorModule.archive.stat || {}
            play = formatPlayCount(stat.view || 0) + '播放'
          }
          
          return {
            bvid: bvid,
            title: title,
            pic: fixImageUrl(pic),
            play: play,
            duration: duration,
            author: pageStates.up.name || '未知',
            mid: mid,
            owner: { mid: mid, name: pageStates.up.name || '未知' }
          }
        }).filter(v => v.bvid)

        console.log('New videos to append:', newVideos.length)
        appendVideos(newVideos, 'upVideoGrid', navigateToUP)
        pageStates.up.hasMore = result.data.data.has_more || false
        pageStates.up.offset = result.data.data.offset || ''

        console.log('pageStates.up.hasMore:', pageStates.up.hasMore, 'pageStates.up.offset:', pageStates.up.offset)

        if (!pageStates.up.hasMore) {
          if (loadingMore) loadingMore.style.display = 'none'
          if (noMore) noMore.style.display = 'block'
        } else {
          if (loadingMore) loadingMore.style.display = 'none'
        }
      } else {
        if (loadingMore) loadingMore.style.display = 'none'
        if (noMore) noMore.style.display = 'block'
      }
    }
  } catch (error) {
    console.error('加载UP主视频失败:', error)
    if (loadingMore) loadingMore.style.display = 'none'
    if (noMore) noMore.style.display = 'block'
  }

  pageStates.up.loading = false
  pageStates.up.scrollLocked = false
}

function getMpvPath() {
  return localStorage.getItem('mpvPath') || ''
}

function useBuiltinPlayer() {
  return localStorage.getItem('useBuiltinPlayer') === 'true'
}

function playVideo(bvid, cid, title, progress) {
  const mpvPath = getMpvPath()
  const showDanmaku = localStorage.getItem('showDanmaku') !== 'false'
  const useBuiltin = useBuiltinPlayer()
  ipcRenderer.invoke('play-video', bvid, cid, title, mpvPath, showDanmaku, useBuiltin, progress)
}

async function checkLoginStatus() {
  try {
    const result = await ipcRenderer.invoke('get-user-info')
    console.log('checkLoginStatus result:', result)
    
    if (result.success && result.data) {
      currentUser = result.data
      console.log('Current user:', currentUser)
      console.log('isLogin value:', currentUser.isLogin, 'type:', typeof currentUser.isLogin)
      
      updateUserAvatar(currentUser)
      updateMyPageUI(currentUser)
      updateSettingsAvatar()
      updateSettingsUserName()
      
      const isLoggedIn = currentUser.isLogin === true || currentUser.isLogin === 1
      console.log('isLoggedIn:', isLoggedIn)
      
      if (!isLoggedIn) {
        console.log('用户未登录，打开登录窗口')
        setTimeout(() => {
          openLoginModal()
        }, 500)
      }
    } else if (!result.success) {
      console.log('获取用户信息失败，尝试打开登录窗口:', result.error)
      setTimeout(() => {
        openLoginModal()
      }, 500)
    }
  } catch (error) {
    console.error('检查登录状态失败:', error)
    setTimeout(() => {
      openLoginModal()
    }, 500)
  }
}

function updateUserAvatar(user) {
  const avatar = document.getElementById('sidebarUserAvatar')
  if (!avatar) return

  if (user.isLogin && user.face) {
    avatar.innerHTML = `<img src="${user.face}" alt="用户头像" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`
  }
}

function updateMyPageUI(user) {
  const loginText = document.querySelector('.my-login-text')
  const myAvatar = document.querySelector('.my-avatar')
  const myCoins = document.querySelector('.my-coins')
  const logoutBtn = document.getElementById('logoutBtn')
  if (!loginText) return

  if (user.isLogin) {
    loginText.textContent = user.uname || '用户'
    if (myAvatar && user.face) myAvatar.innerHTML = `<img src="${user.face}" alt="头像" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`
    if (myCoins) myCoins.innerHTML = `<span>B币: ${user.bCoins || 0}</span><span class="separator">|</span><span>硬币: ${user.coins || 0}</span>`
    if (logoutBtn) logoutBtn.style.display = 'block'
    document.querySelectorAll('.no-login-area').forEach(area => area.style.display = 'none')
    document.getElementById('historyGrid').style.display = 'grid'
    document.getElementById('favoritesGrid').style.display = 'grid'
    document.getElementById('toviewGrid').style.display = 'grid'
  } else {
    loginText.textContent = '点击登录'
    if (myAvatar) myAvatar.innerHTML = `<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="#f5f5f5"/><circle cx="24" cy="20" r="8" fill="#e0e0e0"/><circle cx="20" cy="18" r="1.5" fill="#999"/><circle cx="28" cy="18" r="1.5" fill="#999"/><path d="M20 26 Q24 30 28 26" stroke="#999" stroke-width="2" fill="none"/></svg>`
    if (myCoins) myCoins.innerHTML = `<span>B币: -</span><span class="separator">|</span><span>硬币: -</span>`
    if (logoutBtn) logoutBtn.style.display = 'none'
    document.querySelectorAll('.no-login-area').forEach(area => area.style.display = 'flex')
    document.getElementById('historyGrid').style.display = 'none'
    document.getElementById('favoritesGrid').style.display = 'none'
    document.getElementById('toviewGrid').style.display = 'none'
  }
}

function openLoginModal() {
  document.getElementById('loginModal').style.display = 'flex'
  initQRLogin()
}

async function handleLogout() {
  try {
    await ipcRenderer.invoke('logout')
    await ipcRenderer.invoke('reload-window')
  } catch (error) {
    console.error('退出登录失败:', error)
  }
}

function mountQrCodeWhenLoaded(qrCodeElement, loginUrl) {
  const src = `https://api.qrserver.com/v1/create-qr-code?size=200x200&data=${encodeURIComponent(loginUrl)}`
  const img = new Image()
  img.alt = '扫码登录'
  img.style.width = '200px'
  img.style.height = '200px'
  img.style.objectFit = 'contain'
  img.onload = () => {
    if (!qrCodeElement || !qrCodeElement.isConnected) return
    qrCodeElement.innerHTML = ''
    qrCodeElement.appendChild(img)
  }
  img.onerror = () => {
    if (!qrCodeElement || !qrCodeElement.isConnected) return
    qrCodeElement.innerHTML =
      '<div class="qr-loading qr-loading--fail"><span class="qr-loading-text">二维码加载失败</span></div>'
  }
  img.src = src
}

async function initQRLogin() {
  stopLoginPoll()

  const qrCodeElement = document.getElementById('qrCode') || document.querySelector('.qr-code')
  qrStatusElement = document.getElementById('qrStatus') || document.querySelector('.qr-status')

  if (qrCodeElement) {
    qrCodeElement.innerHTML = QR_LOADING_HTML
  }

  if (qrStatusElement) {
    qrStatusElement.textContent = ''
    qrStatusElement.style.color = '#9499a0'
  }

  try {
    const result = await ipcRenderer.invoke('get-login-qrcode')

    if (result.success && result.data && result.data.url) {
      currentQCode = result.data.qcode
      if (qrStatusElement) {
        qrStatusElement.textContent = ''
      }
      startLoginPoll()
      if (qrCodeElement) {
        mountQrCodeWhenLoaded(qrCodeElement, result.data.url)
      }
    } else {
      if (qrCodeElement) {
        qrCodeElement.innerHTML = '<div class="qr-loading qr-loading--fail"><span class="qr-loading-text">获取二维码失败</span></div>'
      }
      if (qrStatusElement) {
        qrStatusElement.textContent = '获取失败，请关闭重试'
        qrStatusElement.style.color = '#f57070'
      }
    }
  } catch (error) {
    console.error('初始化登录失败:', error)
    if (qrCodeElement) {
      qrCodeElement.innerHTML = '<div class="qr-loading qr-loading--fail"><span class="qr-loading-text">获取二维码失败</span></div>'
    }
    if (qrStatusElement) {
      qrStatusElement.textContent = '网络错误，请检查网络连接'
      qrStatusElement.style.color = '#f57070'
    }
  }
}

async function startLoginPoll() {
  if (!currentQCode) return

  pollInterval = setInterval(async () => {
    try {
      const result = await ipcRenderer.invoke('poll-login-status', currentQCode)
      if (result.success && result.data) {
        const status = result.data.status
        if (status === 'scanned' && qrStatusElement) {
          qrStatusElement.textContent = '扫码成功！请在手机上确认登录'
          qrStatusElement.style.color = '#00a1d6'
        } else if (status === 'success') {
          if (qrStatusElement) {
            qrStatusElement.textContent = '登录成功！'
            qrStatusElement.style.color = '#00a1d6'
          }
          stopLoginPoll()
          setTimeout(async () => {
            document.getElementById('loginModal').style.display = 'none'
            await checkLoginStatus()
          }, 1000)
        } else if (status === 'expired') {
          stopLoginPoll()
          setTimeout(() => initQRLogin(), 2000)
        }
      }
    } catch (error) {
      console.error('轮询错误:', error)
    }
  }, 2000)
}

function stopLoginPoll() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  currentQCode = null
  ipcRenderer.invoke('stop-login-poll')
}

function formatHistoryTime(timestamp) {
  if (!timestamp) return ''
  const now = new Date()
  const historyDate = new Date(timestamp * 1000)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart - 24 * 60 * 60 * 1000)
  
  const hours = historyDate.getHours().toString().padStart(2, '0')
  const minutes = historyDate.getMinutes().toString().padStart(2, '0')
  
  if (historyDate >= todayStart) {
    return `今天 ${hours}:${minutes}`
  } else if (historyDate >= yesterdayStart) {
    return `昨天 ${hours}:${minutes}`
  } else {
    const month = (historyDate.getMonth() + 1).toString()
    const day = historyDate.getDate().toString()
    return `${month}月${day}日`
  }
}

function createHistoryCard(video, onAuthorClick) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = video.bvid
  card.dataset.cid = video.cid || ''

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="${video.pic}" alt="${video.title}" loading="lazy">
      ${video.progress !== undefined && video.progress !== null && video.durationSeconds ? `
        <span class="video-progress">${formatDuration(video.progress)} / ${video.duration}</span>
      ` : ''}
      ${video.progress === undefined || video.progress === null ? `
        <span class="video-duration">${video.duration}</span>
      ` : ''}
    </div>
    <div class="video-info">
      <h3 class="video-title">${video.title}</h3>
      <div class="video-meta">
        <span class="video-play">${video.historyTime || ''}</span>
        <span class="video-author" data-mid="${video.owner?.mid || ''}">${video.author}</span>
      </div>
    </div>
  `

  card.addEventListener('click', () => {
    if (video.bvid) playVideo(video.bvid, video.cid, video.title, video.progress)
  })

  const authorSpan = card.querySelector('.video-author')
  authorSpan.addEventListener('click', e => {
    e.stopPropagation()
    const mid = video.owner?.mid || video.mid
    if (mid && onAuthorClick) onAuthorClick(mid)
  })

  return card
}

function renderHistoryVideos(videos, containerId) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''
  videos.filter(v => v.bvid || v.title).forEach(video => container.appendChild(createHistoryCard(video, navigateToUP)))
}

function appendHistoryVideos(videos, containerId) {
  const container = document.getElementById(containerId)
  if (!container) return
  videos.filter(v => v.bvid || v.title).forEach(video => container.appendChild(createHistoryCard(video, navigateToUP)))
}

async function loadHistory(append = false) {
  const state = pageStates.my
  
  if (state.isHistoryLoading) return
  if (!append) {
    state.historyCursor = null
    state.hasMoreHistory = true
  }
  if (!state.hasMoreHistory && append) {
    return
  }

  state.isHistoryLoading = true
  
  try {
    const result = await ipcRenderer.invoke('get-history', state.historyCursor)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        duration: formatDuration(item.duration || 0),
        durationSeconds: item.duration || 0,
        progress: item.progress || null,
        author: item.author || '未知UP主',
        mid: item.authorMid || '',
        owner: item.authorMid ? { mid: item.authorMid, name: item.author || '未知UP主' } : null,
        historyTime: formatHistoryTime(item.viewAt)
      }))

      if (videos.length > 0) {
        if (append) {
          appendHistoryVideos(videos, 'historyGrid')
        } else {
          renderHistoryVideos(videos, 'historyGrid')
        }
        state.hasMoreHistory = result.hasMore
        state.historyCursor = result.nextCursor
      } else if (!append) {
        showEmptyMessage('historyGrid', '暂无观看记录')
      }
    }
  } catch (error) {
    console.error('加载历史记录失败:', error)
    if (!append) showEmptyMessage('historyGrid', '加载历史记录失败')
  } finally {
    state.isHistoryLoading = false
  }
}

async function searchHistory(keyword) {
  try {
    const result = await ipcRenderer.invoke('search-history', keyword)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: '观看过',
        duration: formatDuration(item.duration || 0),
        author: item.author || '未知UP主',
        mid: item.authorMid || '',
        owner: item.authorMid ? { mid: item.authorMid, name: item.author || '未知UP主' } : null
      }))

      if (videos.length > 0) {
        renderVideos(videos, 'historyGrid', navigateToUP)
      } else {
        showEmptyMessage('historyGrid', `未找到包含 "${keyword}" 的历史记录`)
      }
    } else {
      showEmptyMessage('historyGrid', `未找到包含 "${keyword}" 的历史记录`)
    }
  } catch (error) {
    console.error('搜索历史记录失败:', error)
    showEmptyMessage('historyGrid', '搜索失败')
  }
}

async function loadBangumi(type = 1) {
  try {
    const result = await ipcRenderer.invoke('get-bangumi-follow', type, 1)
    
    const content = document.getElementById('bangumi-content')
    const container = document.getElementById('bangumiGrid')
    
    if (!content || !container) {
      console.error('bangumi elements not found')
      return
    }
    
    content.style.display = 'block'
    container.innerHTML = ''
    container.className = 'my-anime-grid'
    container.style.display = 'grid'
    
    if (!result.success || !result.data || result.data.length === 0) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无追番内容</div>'
      return
    }
    
    result.data.forEach(item => {
      const card = document.createElement('div')
      card.className = 'my-anime-card'
      
      const coverUrl = item.cover?.startsWith('//') ? 'https:' + item.cover : (item.cover || '')
      
      card.innerHTML = `
        <div class="my-anime-cover">
          <img src="${coverUrl}" alt="${item.title}" loading="lazy">
          ${item.badge ? `<span style="position: absolute; top: 8px; left: 8px; background: #fb7299; color: #fff; font-size: 12px; padding: 2px 8px; border-radius: 4px; z-index: 1;">${item.badge}</span>` : ''}
          ${item.new_ep?.index ? `<span style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); color: #fff; font-size: 12px; padding: 2px 6px; border-radius: 3px; z-index: 1;">第${item.new_ep.index}话</span>` : ''}
        </div>
        <div class="my-anime-info">
          <h3 class="my-anime-title">${item.title}</h3>
          <div class="my-anime-history">
            <span>${item.is_finish ? '已完结' : '连载中'}</span>
            ${item.stat?.follow ? `<span>${item.stat.follow.toLocaleString()}人追番</span>` : ''}
          </div>
        </div>
      `
      
      card.addEventListener('click', () => {
        if (item.url) {
          window.open(item.url, '_blank')
        }
      })
      
      container.appendChild(card)
    })
  } catch (error) {
    console.error('加载追番失败:', error)
    const container = document.getElementById('bangumiGrid')
    if (container) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">加载失败</div>'
    }
  }
}

async function loadFavorites(append = false) {
  const state = pageStates.my
  if (state.isFavoritesLoading) return
  if (!append) {
    state.favoritesPageNum = 1
    state.hasMoreFavorites = true
  }
  if (!state.hasMoreFavorites && append) {
    return
  }

  state.isFavoritesLoading = true

  try {
    const result = await ipcRenderer.invoke('get-favorites', 166434448, state.favoritesPageNum, 36)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' }
      }))

      if (videos.length > 0) {
        if (append) {
          appendVideos(videos, 'favoritesGrid', navigateToUP)
        } else {
          renderVideos(videos, 'favoritesGrid', navigateToUP)
        }
        state.hasMoreFavorites = result.hasMore || false
        state.favoritesPageNum++
      } else if (!append) {
        showEmptyMessage('favoritesGrid', '暂无收藏内容')
      }
    }
  } catch (error) {
    console.error('加载收藏失败:', error)
    if (!append) {
      showEmptyMessage('favoritesGrid', '加载收藏失败')
    }
  } finally {
    state.isFavoritesLoading = false
  }
}

async function loadToview(append = false) {
  const state = pageStates.my
  if (state.isToviewLoading) return
  if (!append) {
    state.toviewPageNum = 1
    state.hasMoreToview = true
  }
  if (!state.hasMoreToview && append) {
    return
  }

  state.isToviewLoading = true

  try {
    const result = await ipcRenderer.invoke('get-toview', state.toviewPageNum, 20)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: formatPlayCount(item.cnt_info?.view || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        progress: item.progress || 0
      }))

      if (videos.length > 0) {
        if (append) {
          appendVideos(videos, 'toviewGrid', navigateToUP)
        } else {
          renderVideos(videos, 'toviewGrid', navigateToUP)
        }
        state.hasMoreToview = result.hasMore || false
        state.toviewPageNum++
      } else if (!append) {
        showEmptyMessage('toviewGrid', '暂无稍后再看内容')
      }
    }
  } catch (error) {
    console.error('加载稍后再看失败:', error)
    if (!append) {
      showEmptyMessage('toviewGrid', '加载稍后再看失败')
    }
  } finally {
    state.isToviewLoading = false
  }
}

async function searchFavorites(keyword) {
  try {
    const result = await ipcRenderer.invoke('get-favorites', 166434448, 1, 36, keyword)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' }
      }))

      if (videos.length > 0) {
        renderVideos(videos, 'favoritesGrid', navigateToUP)
      } else {
        showEmptyMessage('favoritesGrid', `未找到包含 "${keyword}" 的收藏内容`)
      }
    } else {
      showEmptyMessage('favoritesGrid', `未找到包含 "${keyword}" 的收藏内容`)
    }
  } catch (error) {
    console.error('搜索收藏失败:', error)
    showEmptyMessage('favoritesGrid', '搜索失败')
  }
}

async function searchToview(keyword) {
  try {
    const result = await ipcRenderer.invoke('get-toview', 1, 20)
    if (result.success && result.data) {
      const filteredData = result.data.filter(item => {
        const title = (item.title || '').toLowerCase()
        const author = (item.author || item.upper?.name || '').toLowerCase()
        const kw = keyword.toLowerCase()
        return title.includes(kw) || author.includes(kw)
      })

      const videos = filteredData.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: formatPlayCount(item.cnt_info?.view || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        progress: item.progress || 0
      }))

      if (videos.length > 0) {
        renderVideos(videos, 'toviewGrid', navigateToUP)
      } else {
        showEmptyMessage('toviewGrid', `未找到包含 "${keyword}" 的稍后再看内容`)
      }
    } else {
      showEmptyMessage('toviewGrid', `未找到包含 "${keyword}" 的稍后再看内容`)
    }
  } catch (error) {
    console.error('搜索稍后再看失败:', error)
    showEmptyMessage('toviewGrid', '搜索失败')
  }
}

function handleScroll() {
  const content = document.querySelector('.content')
  if (!content) return

  const { scrollTop, scrollHeight, clientHeight } = content

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
        console.log('触发加载更多猜你喜欢')
        loadMoreGuessItems()
      }
    }
  } else if (currentPage === 'bangumi-all') {
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      if (!bangumiAllState.loading && bangumiAllState.hasMore) {
        console.log('触发加载更多追番全部')
        loadBangumiAllData(true)
      }
    }
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

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'system'
  const themeSelect = document.getElementById('themeSelect')
  if (themeSelect) {
    themeSelect.value = savedTheme
  }
  applyTheme(savedTheme)
  updateSettingsAvatar()
  updateSettingsUserName()
}

function applyTheme(theme) {
  document.body.classList.remove('dark-theme')
  
  let isDark = false
  if (theme === 'dark') {
    isDark = true
  } else if (theme === 'system') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  
  if (isDark) {
    document.body.classList.add('dark-theme')
  }
  updateSidebarThemeIcon(isDark)
}

function handleThemeChange(event) {
  const theme = event.target.value
  localStorage.setItem('theme', theme)
  applyTheme(theme)
}

function toggleTheme() {
  const themeSelect = document.getElementById('themeSelect')
  const currentTheme = localStorage.getItem('theme') || 'system'
  const isCurrentlyDark = document.body.classList.contains('dark-theme')
  
  let newTheme
  if (currentTheme === 'light') {
    newTheme = 'dark'
  } else if (currentTheme === 'dark') {
    newTheme = 'system'
  } else {
    newTheme = isCurrentlyDark ? 'light' : 'dark'
  }
  
  if (themeSelect) {
    themeSelect.value = newTheme
  }
  localStorage.setItem('theme', newTheme)
  applyTheme(newTheme)
}

function initMpvPath() {
  const mpvPathInput = document.getElementById('mpvPathInput')
  if (!mpvPathInput) return
  
  const savedPath = localStorage.getItem('mpvPath')
  if (savedPath) {
    mpvPathInput.value = savedPath
  }
  
  mpvPathInput.addEventListener('change', () => {
    localStorage.setItem('mpvPath', mpvPathInput.value)
  })
}

function initDanmakuToggle() {
  const danmakuToggle = document.getElementById('danmakuToggle')
  if (!danmakuToggle) return
  
  const savedSetting = localStorage.getItem('showDanmaku')
  if (savedSetting !== null) {
    danmakuToggle.checked = savedSetting === 'true'
  } else {
    danmakuToggle.checked = true
  }
  
  danmakuToggle.addEventListener('change', () => {
    localStorage.setItem('showDanmaku', danmakuToggle.checked)
    log('弹幕显示设置已更改:', danmakuToggle.checked)
  })
}

function initBuiltinPlayerToggle() {
  const builtinPlayerToggle = document.getElementById('useBuiltinPlayer')
  if (!builtinPlayerToggle) return
  
  const savedSetting = localStorage.getItem('useBuiltinPlayer')
  if (savedSetting !== null) {
    builtinPlayerToggle.checked = savedSetting === 'true'
  } else {
    builtinPlayerToggle.checked = true
  }
  
  builtinPlayerToggle.addEventListener('change', () => {
    localStorage.setItem('useBuiltinPlayer', builtinPlayerToggle.checked)
    log('内置播放器设置已更改:', builtinPlayerToggle.checked)
  })
}

function initNativePlayerToggle() {
  const nativePlayerToggle = document.getElementById('nativePlayerToggle')
  if (!nativePlayerToggle) return
  
  const savedSetting = localStorage.getItem('useNativePlayer')
  if (savedSetting !== null) {
    nativePlayerToggle.checked = savedSetting === 'true'
  } else {
    nativePlayerToggle.checked = false
  }
  
  nativePlayerToggle.addEventListener('change', () => {
    localStorage.setItem('useNativePlayer', nativePlayerToggle.checked)
    log('内置播放器设置已更改:', nativePlayerToggle.checked)
  })
}

async function selectMpvPath() {
  const result = await ipcRenderer.invoke('select-mpv-path')
  if (result.success && result.path) {
    const mpvPathInput = document.getElementById('mpvPathInput')
    if (mpvPathInput) {
      mpvPathInput.value = result.path
      localStorage.setItem('mpvPath', result.path)
    }
  }
}

function updateSidebarThemeIcon(isDark) {
  const sidebarBtn = document.getElementById('sidebarThemeBtn')
  if (!sidebarBtn) return
  const lightIcon = sidebarBtn.querySelector('.theme-icon-light')
  const darkIcon = sidebarBtn.querySelector('.theme-icon-dark')
  if (lightIcon) lightIcon.style.display = isDark ? 'none' : 'block'
  if (darkIcon) darkIcon.style.display = isDark ? 'block' : 'none'
}

function updateSettingsAvatar() {
  const settingsAvatar = document.getElementById('settingsAvatar')
  if (!settingsAvatar) return

  if (currentUser?.isLogin && currentUser.face) {
    settingsAvatar.innerHTML = `<img src="${currentUser.face}" alt="头像" style="width: 100%; height: 100%; object-fit: cover;">`
  } else {
    settingsAvatar.innerHTML = `<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="#fb7299"/><circle cx="24" cy="20" r="8" fill="white"/><circle cx="20" cy="18" r="1.5" fill="#fb7299"/><circle cx="28" cy="18" r="1.5" fill="#fb7299"/><path d="M20 26 Q24 30 28 26" stroke="#fb7299" stroke-width="2" fill="none"/></svg>`
  }
}

function updateSettingsUserName() {
  const userName = document.getElementById('settingsUserName')
  const userLevel = document.getElementById('settingsUserLevel')
  if (!userName) return
  
  if (currentUser?.isLogin) {
    userName.textContent = currentUser.uname || '用户'
    if (userLevel) {
      userLevel.textContent = currentUser.level ? `Lv${currentUser.level}` : ''
      userLevel.style.display = currentUser.level ? 'inline-block' : 'none'
    }
  } else {
    userName.textContent = '未登录'
    if (userLevel) {
      userLevel.textContent = ''
      userLevel.style.display = 'none'
    }
  }
}


let currentUpId = null
let currentDynamicOffset = ''
let dynamicHasMore = true
let isDynamicLoading = false
let followingListData = []

function formatDynamicViews(num) {
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + '万'
  }
  return num?.toString() || '0'
}

function formatDynamicTime(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() * 1000 - timestamp
  const minutes = Math.floor(diff / 60000000)
  const hours = Math.floor(diff / 36000000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 60) {
    return minutes + '分钟前'
  } else if (hours < 24) {
    return hours + '小时前'
  } else {
    return days + '天前'
  }
}

function fixImageUrl(url) {
  if (!url) return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"></svg>'
  return url.startsWith('//') ? 'https:' + url : url
}

async function fetchFollowings(mid) {
  console.log('=== fetchFollowings START ===')
  try {
    const result = await ipcRenderer.invoke('get-dynamic-portal')
    
    if (result.success && result.data) {
      const portalData = result.data
      let followings = []
      
      console.log('Portal data keys:', Object.keys(portalData))
      
      if (portalData.up_list && Array.isArray(portalData.up_list)) {
        console.log('Found up_list array, length:', portalData.up_list.length)
        
        followings = portalData.up_list.map(item => ({
          mid: item.mid || '',
          name: item.uname || item.name || '',
          face: item.face || '',
          official: item.official_verify || null,
          vip: item.vip || null,
          has_update: item.has_update || false
        }))
        
        console.log('Parsed followings count:', followings.length)
      } else {
        console.log('No up_list found in portal data')
      }
      
      followingListData = followings
      console.log('=== fetchFollowings END ===')
      return followings
    } else {
      console.log('fetchFollowings failed:', result.error)
    }
  } catch (error) {
    console.error('fetchFollowings error:', error)
  }
  console.log('=== fetchFollowings END (error) ===')
  return []
}

async function fetchDynamics(upMid = null, offset = '') {
  try {
    const result = await ipcRenderer.invoke('get-user-dynamics', upMid, offset)
    if (result.success && result.data) {
      return {
        items: result.data.items || [],
        has_more: result.data.has_more,
        next_offset: result.data.next_offset
      }
    }
  } catch (error) {
    console.error('获取动态失败:', error)
  }
  return { items: [], has_more: false, next_offset: '' }
}

function renderFollowingList(followings) {
  const followingList = document.getElementById('followingList')
  if (!followingList) return

  followingList.innerHTML = ''
  
  if (followings.length === 0) {
    followingList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无数据</div>'
    return
  }
  
  followings.forEach(up => {
    const item = document.createElement('div')
    item.className = 'following-item' + (currentUpId === up.mid ? ' active' : '')
    item.dataset.upId = up.mid

    const avatarContent = up.face
      ? `<img src="${fixImageUrl(up.face)}" alt="${up.name}">`
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
    
    let officialBadge = ''
    if (up.official) {
      const verifyType = up.official.type === 1 ? 'official' : 'official-personal'
      officialBadge = `<span class="official-badge ${verifyType}">${up.official.desc || '官方'}</span>`
    }
    
    let vipBadge = ''
    if (up.vip && up.vip.type === 2) {
      vipBadge = '<span class="vip-badge">大会员</span>'
    }
    
    let updateDot = ''
    if (up.has_update) {
      updateDot = '<span class="update-dot"></span>'
    }

    item.innerHTML = `${updateDot}<div class="following-avatar"><div class="avatar-wrap">${avatarContent}</div></div><div class="following-info"><div class="following-name">${up.name}${officialBadge}${vipBadge}</div></div>`

    item.addEventListener('click', () => selectDynamicUp(up.mid, up.name))
    followingList.appendChild(item)
  })
}

function createDynamicVideoCard(dynamic) {
  const card = document.createElement('div')
  card.className = 'video-card'

  const thumbnail = dynamic.thumbnail || dynamic.pic || ''
  const title = dynamic.title || dynamic.desc || '暂无标题'
  const author = dynamic.authorName || dynamic.author || '未知'
  const duration = dynamic.duration || ''
  const pubTs = dynamic.pubTs || dynamic.time || 0
  const pubTime = dynamic.pubTime || ''
  const bvid = dynamic.bvid || ''

  let durationHtml = duration ? '<div class="video-duration">' + duration + '</div>' : ''
  const videoDate = pubTime || formatDynamicTime(pubTs)

  card.innerHTML = '<div class="video-thumbnail"><img src="' + fixImageUrl(thumbnail) + '" alt="' + title + '" loading="lazy">' + durationHtml + '</div><div class="video-info"><div class="video-title">' + title + '</div><div class="video-meta"><span class="video-author">' + author + '</span><span class="video-date">' + videoDate + '</span></div></div>'

  if (bvid) {
    card.addEventListener('click', () => {
      playVideo(bvid, '', title)
    })
  }

  return card
}

function renderDynamicVideos(dynamics) {
  const videoContainer = document.getElementById('videoContainer')
  if (!videoContainer) return

  dynamics.forEach(dynamic => {
    if (dynamic.bvid || dynamic.thumbnail) {
      videoContainer.appendChild(createDynamicVideoCard(dynamic))
    }
  })
}

async function loadDynamicVideos(upId = null, offset = '') {
  if (isDynamicLoading) return

  isDynamicLoading = true
  const loadingMore = document.getElementById('loadingMore')
  const noMore = document.getElementById('noMore')
  if (loadingMore) loadingMore.style.display = 'block'
  if (noMore) noMore.style.display = 'none'

  try {
    const result = await fetchDynamics(upId, offset)

    if (result.items.length > 0) {
      renderDynamicVideos(result.items)
      dynamicHasMore = result.has_more
      currentDynamicOffset = result.next_offset

      if (!dynamicHasMore) {
        if (loadingMore) loadingMore.style.display = 'none'
        if (noMore) noMore.style.display = 'block'
      } else {
        if (loadingMore) loadingMore.style.display = 'none'
      }
    } else {
      if (loadingMore) loadingMore.style.display = 'none'
      if (noMore) noMore.style.display = 'block'
    }
  } catch (error) {
    console.error('加载动态失败:', error)
    if (loadingMore) loadingMore.style.display = 'none'
    if (noMore) noMore.style.display = 'block'
  }

  isDynamicLoading = false
}

function selectDynamicUp(upId, upName) {
  currentUpId = upId
  currentDynamicOffset = ''
  dynamicHasMore = true

  document.querySelectorAll('.following-item').forEach(item => {
    item.classList.remove('active')
  })
  document.querySelector('.following-item[data-up-id="' + upId + '"]')?.classList.add('active')

  const allDynamicBtn = document.getElementById('allDynamicBtn')
  if (allDynamicBtn) allDynamicBtn.classList.remove('active')

  const dynamicTitle = document.getElementById('dynamicTitle')
  if (dynamicTitle) dynamicTitle.textContent = upName

  const videoContainer = document.getElementById('videoContainer')
  if (videoContainer) videoContainer.innerHTML = ''
  const loadingMore = document.getElementById('loadingMore')
  if (loadingMore) loadingMore.style.display = 'none'
  const noMore = document.getElementById('noMore')
  if (noMore) noMore.style.display = 'none'

  loadDynamicVideos(upId, '')
}

function selectAllDynamic() {
  currentUpId = null
  currentDynamicOffset = ''
  dynamicHasMore = true

  document.querySelectorAll('.following-item').forEach(item => {
    item.classList.remove('active')
  })
  const allDynamicBtn = document.getElementById('allDynamicBtn')
  if (allDynamicBtn) allDynamicBtn.classList.add('active')

  const dynamicTitle = document.getElementById('dynamicTitle')
  if (dynamicTitle) dynamicTitle.textContent = '全部动态'

  const videoContainer = document.getElementById('videoContainer')
  if (videoContainer) videoContainer.innerHTML = ''
  const loadingMore = document.getElementById('loadingMore')
  if (loadingMore) loadingMore.style.display = 'none'
  const noMore = document.getElementById('noMore')
  if (noMore) noMore.style.display = 'none'

  loadDynamicVideos(null, '')
}

function handleDynamicScroll() {
  const content = document.querySelector('.content')
  if (!content) return

  const { scrollTop, scrollHeight, clientHeight } = content

  const noMore = document.getElementById('noMore')

  if (scrollTop + clientHeight >= scrollHeight - 200 && !isDynamicLoading && dynamicHasMore) {
    loadDynamicVideos(currentUpId, currentDynamicOffset)
  }
}

async function initDynamicPage() {
  const videoContainer = document.getElementById('videoContainer')
  const followingList = document.getElementById('followingList')
  
  if (!currentUser?.isLogin) {
    if (videoContainer) {
      videoContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">请先登录查看动态</div>'
    }
  } else {
    selectAllDynamic()
  }

  const followings = await fetchFollowings(currentUser?.mid)
  if (followings.length > 0) {
    renderFollowingList(followings)
  } else if (followingList) {
    followingList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无数据</div>'
  }

  const allDynamicBtn = document.getElementById('allDynamicBtn')
  if (allDynamicBtn) {
    allDynamicBtn.addEventListener('click', selectAllDynamic)
  }
}

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
    media: () => { console.log('Media page - to be implemented') },
    my: () => { if (currentUser?.isLogin) loadHistory() },
    dynamic: () => initDynamicPage()
  }
  actions[page]?.()
}

// 追番页面相关函数
async function loadBangumiPage() {
  console.log('Loading bangumi page')
  const state = pageStates.bangumi
  state.loading = true
  state.hasMore = true
  state.cursor = ''
  
  const loadingEl = document.getElementById('bangumi-loading-more')
  const noMoreEl = document.getElementById('bangumi-no-more')
  if (loadingEl) loadingEl.style.display = 'none'
  if (noMoreEl) noMoreEl.style.display = 'none'

  try {
    const result = await ipcRenderer.invoke('fetch-bangumi-data', { is_refresh: 0 })
    console.log('Bangumi API result:', result)

    if (result.success && result.data && result.data.data && result.data.data.modules) {
      state.data = result.data.data
      state.cursor = result.data.data.next_cursor || ''
      state.hasMore = result.data.data.has_next === 1
      renderBangumiSections(result.data.data)
    } else {
      showEmptyMessage('bangumi-following', '获取追番数据失败')
    }
  } catch (error) {
    console.error('加载追番页面失败:', error)
    showEmptyMessage('bangumi-following', '加载失败，请稍后重试')
  }
  
  state.loading = false
}

function renderBangumiSections(data) {
  console.log('Rendering bangumi sections')
  
  const modules = data.modules || []
  
  // 渲染我的追番
  const followingSection = modules.find(m => m.headers?.[0]?.title?.includes('追番')) ||
                          modules.find(m => m.attr?.follow === 1) ||
                          modules[0]
  if (followingSection) {
    renderFollowingSection(followingSection)
  }
  
  // 渲染番剧推荐
  const animeRecommend = modules.find(m => m.headers?.[0]?.title?.includes('番剧推荐')) ||
                         modules[1]
  if (animeRecommend) {
    renderAnimeRecommend(animeRecommend)
  }
  
  // 渲染国创推荐
  const chineseRecommend = modules.find(m => m.headers?.[0]?.title?.includes('国创')) ||
                           modules[2]
  if (chineseRecommend) {
    renderChineseRecommend(chineseRecommend)
  }
  
  // 渲染猜你喜欢（瀑布流）
  const guessSection = modules.find(m => m.headers?.[0]?.title?.includes('猜你')) ||
                       modules[3]
  if (guessSection) {
    renderGuessSection(guessSection)
  }
}

function renderFollowingSection(section) {
  const titleEl = document.querySelector('#bangumi-following .section-title')
  const listEl = document.getElementById('following-list')
  const viewAllEl = document.querySelector('#bangumi-following .view-all')
  
  if (titleEl) titleEl.textContent = '我的追番'
  if (!listEl) return
  
  if (viewAllEl) {
    viewAllEl.style.cursor = 'pointer'
    viewAllEl.onclick = () => {
      navigateToPage('my')
      setTimeout(() => {
        const bangumiTab = document.querySelector('.my-tab[data-tab="bangumi"]')
        if (bangumiTab) {
          bangumiTab.click()
        }
      }, 100)
    }
  }
  
  const items = section.items || []
  listEl.innerHTML = ''
  
  items.forEach(item => {
    const card = createFollowingCard(item)
    listEl.appendChild(card)
  })
}

function renderAnimeRecommend(section) {
  const titleEl = document.querySelector('#bangumi-recommend .section-title')
  const gridEl = document.getElementById('recommend-grid')
  
  if (titleEl) titleEl.textContent = '番剧推荐'
  if (!gridEl) return
  
  const items = section.items || []
  gridEl.innerHTML = ''
  
  items.forEach(item => {
    const card = createBangumiCard(item)
    gridEl.appendChild(card)
  })
}

function renderChineseRecommend(section) {
  const titleEl = document.querySelector('#bangumi-chinese .section-title')
  const gridEl = document.getElementById('chinese-grid')
  
  if (titleEl) titleEl.textContent = '国创推荐'
  if (!gridEl) return
  
  const items = section.items || []
  gridEl.innerHTML = ''
  
  items.forEach(item => {
    const card = createBangumiCard(item)
    gridEl.appendChild(card)
  })
}

function renderGuessSection(section) {
  const titleEl = document.querySelector('#bangumi-guess .section-title')
  const waterfallEl = document.getElementById('guess-waterfall')
  
  if (titleEl) titleEl.textContent = '猜你喜欢'
  if (!waterfallEl) return
  
  const items = section.items || []
  
  items.forEach(item => {
    const card = createWaterfallCard(item)
    waterfallEl.appendChild(card)
  })
}

function createFollowingCard(item) {
  const card = document.createElement('div')
  card.className = 'following-card'
  
  const coverUrl = fixImageUrl(item.cover || item.pic || '')
  const title = item.title || item.name || ''
  const badgeText = item.badge_info?.text || ''
  const isMember = badgeText === '会员'
  const isProduct = badgeText === '出品'
  const badgeClass = isMember ? 'following-badge member' : isProduct ? 'following-badge product' : 'following-badge'
  const newEp = item.new_ep?.index_show || ''
  const totalEp = item.episode?.total || item.total || ''
  const status = item.desc || ''
  const seasonType = item.season_type || ''
  
  let bottomBadge = ''
  if (totalEp) {
    bottomBadge = `<span class="following-total">全${totalEp}话</span>`
  }
  
  let watchingStatus = ''
  if (item.progress && item.progress.last_ep_index) {
    watchingStatus = `看到第${item.progress.last_ep_index}话`
  } else if (item.progress && item.progress.is_finish) {
    watchingStatus = '看到全片'
  } else if (status) {
    watchingStatus = status
  }
  
  card.innerHTML = `
    <div class="following-cover">
      <img src="${coverUrl}" alt="${title}" loading="lazy">
      ${badgeText ? `<span class="${badgeClass}">${badgeText}</span>` : ''}
      ${bottomBadge}
      ${newEp ? `<span class="following-new-ep">${newEp}</span>` : ''}
    </div>
    <div class="following-info">
      <h3 class="following-title">${title}</h3>
      <div class="following-status">${watchingStatus}</div>
    </div>
  `
  
  card.addEventListener('click', () => {
    if (item.url || item.link) {
      const url = item.url || item.link
      if (url.includes('bilibili.com')) {
        window.open(url, '_blank')
      }
    }
  })
  
  return card
}

function createBangumiCard(item) {
  const card = document.createElement('div')
  card.className = 'bangumi-card'
  
  const coverUrl = fixImageUrl(item.cover || item.pic || '')
  const title = item.title || item.name || ''
  const badgeText = item.badge_info?.text || ''
  const isMember = badgeText === '会员'
  const isProduct = badgeText === '出品'
  const badgeClass = isMember ? 'following-badge member' : isProduct ? 'following-badge product' : 'following-badge'
  const newEp = item.new_ep?.index_show || ''
  const totalEp = item.episode?.total || item.total || ''
  const desc = item.desc || ''
  
  let bottomBadge = ''
  if (totalEp) {
    bottomBadge = `<span class="following-total">全${totalEp}话</span>`
  }
  
  card.innerHTML = `
    <div class="bangumi-cover">
      <img src="${coverUrl}" alt="${title}" loading="lazy">
      ${badgeText ? `<span class="${badgeClass}">${badgeText}</span>` : ''}
      ${bottomBadge}
      ${newEp ? `<span class="following-new-ep">${newEp}</span>` : ''}
    </div>
    <div class="bangumi-info">
      <h3 class="following-title">${title}</h3>
      <div class="following-status">${desc}</div>
    </div>
  `
  
  card.addEventListener('click', () => {
    if (item.url || item.link) {
      const url = item.url || item.link
      if (url.includes('bilibili.com')) {
        window.open(url, '_blank')
      }
    }
  })
  
  return card
}

function createWaterfallCard(item) {
  const card = document.createElement('div')
  card.className = 'waterfall-item'
  
  const coverUrl = fixImageUrl(item.cover || item.pic || '')
  const title = item.title || item.name || ''
  const badgeText = item.badge_info?.text || ''
  const isMember = badgeText === '会员'
  const isProduct = badgeText === '出品'
  const badgeClass = isMember ? 'following-badge member' : isProduct ? 'following-badge product' : 'following-badge'
  const newEp = item.new_ep?.index_show || ''
  const desc = item.desc || ''
  
  card.innerHTML = `
    <div class="following-cover">
      <img src="${coverUrl}" alt="${title}" loading="lazy">
      ${badgeText ? `<span class="${badgeClass}">${badgeText}</span>` : ''}
      ${newEp ? `<span class="following-new-ep">${newEp}</span>` : ''}
    </div>
    <div class="following-info">
      <h3 class="following-title">${title}</h3>
      <div class="following-status">${desc}</div>
    </div>
  `
  
  card.addEventListener('click', () => {
    if (item.url || item.link) {
      window.open(item.url || item.link, '_blank')
    }
  })
  
  return card
}

async function loadMoreGuessItems() {
  const state = pageStates.bangumi
  if (state.loading || !state.hasMore || !state.cursor) return

  state.loading = true
  const loadingEl = document.getElementById('bangumi-loading-more')
  const noMoreEl = document.getElementById('bangumi-no-more')

  if (loadingEl) loadingEl.style.display = 'block'
  if (noMoreEl) noMoreEl.style.display = 'none'

  try {
    const result = await ipcRenderer.invoke('fetch-bangumi-data', { is_refresh: 1, cursor: state.cursor })

    if (result.success && result.data && result.data.data && result.data.data.modules) {
      const apiData = result.data.data
      const modules = apiData.modules || []

      const guessModule = modules[0]

      if (guessModule && guessModule.items && guessModule.items.length > 0) {
        const waterfallEl = document.getElementById('guess-waterfall')
        guessModule.items.forEach(item => {
          const card = createWaterfallCard(item)
          waterfallEl.appendChild(card)
        })

        state.cursor = apiData.next_cursor || ''
        state.hasMore = apiData.has_next === 1
      } else {
        state.hasMore = false
      }
    } else {
      state.hasMore = false
    }
  } catch (error) {
    console.error('加载更多猜你喜欢失败:', error)
    state.hasMore = false
  }

  state.loading = false
  if (loadingEl) loadingEl.style.display = 'none'
  if (noMoreEl && !state.hasMore) noMoreEl.style.display = 'block'
}

function loadShortcuts() {
  try {
    const saved = localStorage.getItem('userShortcuts')
    if (saved) {
      const loaded = JSON.parse(saved)
      for (const [id, shortcut] of Object.entries(defaultShortcuts)) {
        if (!loaded[id] || !loaded[id].keys || !Array.isArray(loaded[id].keys) || loaded[id].keys.length === 0) {
          loaded[id] = JSON.parse(JSON.stringify(shortcut))
        } else {
          if (!Array.isArray(loaded[id].keys[0])) {
            loaded[id].keys = [loaded[id].keys]
          }
        }
      }
      userShortcuts = loaded
    }
  } catch (e) {
    console.error('加载快捷键配置失败:', e)
    userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
  }
}

function saveShortcuts() {
  try {
    localStorage.setItem('userShortcuts', JSON.stringify(userShortcuts))
  } catch (e) {
    console.error('保存快捷键配置失败:', e)
  }
}

function openShortcutSettings() {
  shortcutsEnabled = false
  const modal = document.getElementById('shortcutModal')
  const list = document.getElementById('shortcutList')
  if (!modal || !list) return

  list.innerHTML = ''
  for (const [id, shortcut] of Object.entries(userShortcuts)) {
    const item = document.createElement('div')
    item.className = 'shortcut-item'
    
    const keys = shortcut.keys || []
    let keyButtonsHtml = ''
    
    for (let i = 0; i < 3; i++) {
      if (i < keys.length) {
        keyButtonsHtml += `<div class="shortcut-key-wrapper" data-id="${id}" data-index="${i}">
          <button class="shortcut-key" data-id="${id}" data-index="${i}">${keys[i].map(k => `<kbd>${k}</kbd>`).join(' + ')}</button>
          <button class="shortcut-key-remove" data-id="${id}" data-index="${i}">×</button>
        </div>`
      } else {
        keyButtonsHtml += `<button class="shortcut-key shortcut-add-btn" data-id="${id}" data-index="${i}" ${keys.length >= 3 ? 'disabled' : ''}>${keys.length >= 3 ? '' : '+'}</button>`
      }
    }
    
    item.innerHTML = `
      <span class="shortcut-item-label">${shortcut.label}</span>
      <div class="shortcut-actions">
        <div class="shortcut-key-slots">
          ${keyButtonsHtml}
        </div>
        <button class="shortcut-clear-btn" data-id="${id}" ${keys.length === 0 ? 'style="display: none"' : ''}>清除</button>
      </div>
    `
    list.appendChild(item)
  }

  list.querySelectorAll('.shortcut-key:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const index = parseInt(btn.dataset.index)
      startRecording(id, index)
    })
  })

  list.querySelectorAll('.shortcut-key-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const index = parseInt(btn.dataset.index)
      removeShortcutKey(id, index)
    })
  })

  list.querySelectorAll('.shortcut-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => clearShortcut(btn.dataset.id))
  })

  document.getElementById('shortcutCloseBtn')?.addEventListener('click', closeShortcutSettings)
  document.getElementById('shortcutResetBtn')?.addEventListener('click', async () => await resetShortcuts())
  document.getElementById('shortcutSaveBtn')?.addEventListener('click', () => {
    saveShortcuts()
    closeShortcutSettings()
  })

  modal.style.display = 'flex'
}

function closeShortcutSettings() {
  shortcutsEnabled = true
  const modal = document.getElementById('shortcutModal')
  if (modal) {
    modal.style.display = 'none'
    stopRecording()
  }
}

function formatShortcutKeys(keyCombinations) {
  if (!keyCombinations || keyCombinations.length === 0) {
    return '<span style="color: #999; font-style: italic;">点击绑定</span>'
  }
  return keyCombinations.map(keys => keys.map(k => `<kbd>${k}</kbd>`).join(' + ')).join(' / ')
}

function startRecording(id, index) {
  stopRecording()
  currentRecording = { id, index }
  const btn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${index}"]`)
  if (btn) {
    btn.classList.add('recording')
    btn.innerHTML = '按下快捷键...'
  }
  document.addEventListener('keydown', handleShortcutKeydown)
}

function stopRecording() {
  if (currentRecording.id) {
    const btn = document.querySelector(`.shortcut-key[data-id="${currentRecording.id}"][data-index="${currentRecording.index}"]`)
    if (btn) {
      btn.classList.remove('recording')
      const keys = userShortcuts[currentRecording.id]?.keys || []
      if (currentRecording.index < keys.length) {
        btn.innerHTML = keys[currentRecording.index].map(k => `<kbd>${k}</kbd>`).join(' + ')
      } else {
        btn.innerHTML = '+'
      }
    }
    currentRecording = { id: null, index: null }
  }
  document.removeEventListener('keydown', handleShortcutKeydown)
}

function handleShortcutKeydown(e) {
  if (!currentRecording.id) return

  e.preventDefault()
  e.stopPropagation()

  const keys = []
  const hasModifier = e.ctrlKey || e.shiftKey || e.altKey || e.metaKey
  
  if (e.ctrlKey) keys.push('ctrl')
  if (e.shiftKey) keys.push('shift')
  if (e.altKey) keys.push('alt')
  if (e.metaKey) keys.push('meta')

  const code = e.code
  let nonModifierKey = null
  
  console.log('Keyboard event code:', code, 'ctrlKey:', e.ctrlKey, 'shiftKey:', e.shiftKey, 'altKey:', e.altKey)
  
  const codeMap = {
    'KeyA': 'a', 'KeyB': 'b', 'KeyC': 'c', 'KeyD': 'd', 'KeyE': 'e', 'KeyF': 'f',
    'KeyG': 'g', 'KeyH': 'h', 'KeyI': 'i', 'KeyJ': 'j', 'KeyK': 'k', 'KeyL': 'l',
    'KeyM': 'm', 'KeyN': 'n', 'KeyO': 'o', 'KeyP': 'p', 'KeyQ': 'q', 'KeyR': 'r',
    'KeyS': 's', 'KeyT': 't', 'KeyU': 'u', 'KeyV': 'v', 'KeyW': 'w', 'KeyX': 'x',
    'KeyY': 'y', 'KeyZ': 'z',
    'Digit0': '0', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4',
    'Digit5': '5', 'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9',
    'Numpad0': '0', 'Numpad1': '1', 'Numpad2': '2', 'Numpad3': '3', 'Numpad4': '4',
    'Numpad5': '5', 'Numpad6': '6', 'Numpad7': '7', 'Numpad8': '8', 'Numpad9': '9',
    'Comma': ',',
    'Period': '.',
    'Slash': '/',
    'Backslash': '\\',
    'Semicolon': ';',
    'Quote': '\'',
    'BracketLeft': '[',
    'BracketRight': ']',
    'Equal': '=',
    'Minus': '-',
    'Backquote': '`',
    'ArrowUp': 'arrowup',
    'ArrowDown': 'arrowdown',
    'ArrowLeft': 'arrowleft',
    'ArrowRight': 'arrowright',
    'Enter': 'enter',
    'Tab': 'tab',
    'Space': ' ',
    'Backspace': 'backspace',
    'Delete': 'delete',
    'Escape': 'escape',
    'Home': 'home',
    'End': 'end',
    'PageUp': 'pageup',
    'PageDown': 'pagedown',
    'CapsLock': 'capslock',
    'NumLock': 'numlock',
    'ScrollLock': 'scrolllock',
    'Insert': 'insert',
    'F1': 'f1', 'F2': 'f2', 'F3': 'f3', 'F4': 'f4', 'F5': 'f5',
    'F6': 'f6', 'F7': 'f7', 'F8': 'f8', 'F9': 'f9', 'F10': 'f10',
    'F11': 'f11', 'F12': 'f12'
  }
  
  const ignoreCodes = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']
  
  if (!ignoreCodes.includes(code)) {
    if (codeMap[code]) {
      nonModifierKey = codeMap[code]
    } else if (code.startsWith('Numpad')) {
      nonModifierKey = code.replace('Numpad', '')
      if (nonModifierKey === 'Add') nonModifierKey = '+'
      else if (nonModifierKey === 'Subtract') nonModifierKey = '-'
      else if (nonModifierKey === 'Multiply') nonModifierKey = '*'
      else if (nonModifierKey === 'Divide') nonModifierKey = '/'
      else if (nonModifierKey === 'Decimal') nonModifierKey = '.'
    } else {
      nonModifierKey = code.toLowerCase()
    }
    keys.push(nonModifierKey)
  }

  console.log('Detected keys:', keys, 'nonModifierKey:', nonModifierKey, 'hasModifier:', hasModifier)

  if (nonModifierKey) {
    const id = currentRecording.id
    const index = currentRecording.index
    
    if (!userShortcuts[id].keys) {
      userShortcuts[id].keys = []
    }
    
    const keysString = JSON.stringify(keys)
    const exists = userShortcuts[id].keys.some(k => JSON.stringify(k) === keysString)
    
    if (!exists) {
      userShortcuts[id].keys[index] = keys
    }
    
    const btn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${index}"]`)
    if (btn) {
      btn.classList.remove('recording')
      btn.innerHTML = keys.map(k => `<kbd>${k}</kbd>`).join(' + ')
    }
    
    const nextIndex = index + 1
    if (nextIndex < 3 && userShortcuts[id].keys.length <= nextIndex) {
      const nextBtn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${nextIndex}"]`)
      if (nextBtn) {
        nextBtn.classList.remove('disabled')
        nextBtn.removeAttribute('disabled')
        nextBtn.innerHTML = '+'
      }
    }
    
    currentRecording = { id: null, index: null }
    document.removeEventListener('keydown', handleShortcutKeydown)
  }
}

function clearShortcut(id) {
  userShortcuts[id].keys = []
  for (let i = 0; i < 3; i++) {
    const btn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${i}"]`)
    if (btn) {
      btn.classList.remove('recording')
      btn.innerHTML = '+'
      btn.classList.remove('disabled')
      btn.removeAttribute('disabled')
    }
  }
}

function removeShortcutKey(id, index) {
  if (!userShortcuts[id] || !userShortcuts[id].keys) return
  
  const wrapper = document.querySelector(`.shortcut-key-wrapper[data-id="${id}"][data-index="${index}"]`)
  if (!wrapper) return
  
  const actionsContainer = wrapper.closest('.shortcut-actions')
  if (!actionsContainer) return
  
  userShortcuts[id].keys.splice(index, 1)
  
  const keys = userShortcuts[id].keys || []
  const slotsContainer = actionsContainer.querySelector('.shortcut-key-slots')
  
  let newSlotsHtml = ''
  for (let i = 0; i < 3; i++) {
    if (i < keys.length) {
      newSlotsHtml += `<div class="shortcut-key-wrapper" data-id="${id}" data-index="${i}">
        <button class="shortcut-key" data-id="${id}" data-index="${i}">${keys[i].map(k => `<kbd>${k}</kbd>`).join(' + ')}</button>
        <button class="shortcut-key-remove" data-id="${id}" data-index="${i}">×</button>
      </div>`
    } else {
      newSlotsHtml += `<button class="shortcut-key shortcut-add-btn" data-id="${id}" data-index="${i}" ${keys.length >= 3 ? 'disabled' : ''}>${keys.length >= 3 ? '' : '+'}</button>`
    }
  }
  
  slotsContainer.innerHTML = newSlotsHtml
  
  slotsContainer.querySelectorAll('.shortcut-key:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const btnId = btn.dataset.id
      const btnIndex = parseInt(btn.dataset.index)
      startRecording(btnId, btnIndex)
    })
  })
  
  slotsContainer.querySelectorAll('.shortcut-key-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const btnId = btn.dataset.id
      const btnIndex = parseInt(btn.dataset.index)
      removeShortcutKey(btnId, btnIndex)
    })
  })
  
  const clearBtn = actionsContainer.querySelector('.shortcut-clear-btn')
  if (clearBtn) {
    clearBtn.style.display = keys.length === 0 ? 'none' : 'inline-block'
  }
}

async function resetShortcuts() {
  await loadDefaultShortcuts()
  userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
  const list = document.getElementById('shortcutList')
  if (list) {
    for (const [id, shortcut] of Object.entries(userShortcuts)) {
      const keys = shortcut.keys || []
      for (let i = 0; i < 3; i++) {
        const btn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${i}"]`)
        if (btn) {
          btn.classList.remove('recording')
          if (i < keys.length) {
            btn.innerHTML = keys[i].map(k => `<kbd>${k}</kbd>`).join(' + ')
            btn.classList.remove('disabled')
            btn.removeAttribute('disabled')
          } else {
            btn.innerHTML = keys.length < 3 ? '+' : ''
            if (keys.length < 3) {
              btn.classList.remove('disabled')
              btn.removeAttribute('disabled')
            } else {
              btn.classList.add('disabled')
              btn.setAttribute('disabled', 'disabled')
            }
          }
        }
      }
    }
  }
}

function applyShortcuts(e) {
  if (!shortcutsEnabled) return

  const searchInput = document.getElementById('searchInput')
  const isSearchFocused = searchInput && document.activeElement === searchInput
  const header = document.querySelector('.header')
  const isSearchDropdownOpen = header && header.classList.contains('search-focused')

  const clearShortcutConfig = userShortcuts.clearSearch
  const backShortcut = userShortcuts.goBack

  const clearMatch = clearShortcutConfig && matchAnyShortcut(e, clearShortcutConfig.keys)
  const backMatch = backShortcut && matchAnyShortcut(e, backShortcut.keys)

  if (clearMatch && isSearchDropdownOpen) {
    e.preventDefault()
    if (searchInput) {
      searchInput.value = ''
      searchInput.blur()
    }
    if (header) {
      header.classList.remove('search-focused')
    }
    return
  }

  const shortcut = userShortcuts.focusSearch
  if (shortcut && matchAnyShortcut(e, shortcut.keys)) {
    e.preventDefault()
    if (searchInput) {
      searchInput.focus()
      searchInput.select()
    }
  }

  if (backMatch && !isSearchDropdownOpen) {
    e.preventDefault()
    goBack()
  }

  const devtoolsShortcut = userShortcuts.openDevTools
  if (devtoolsShortcut && devtoolsShortcut.keys && matchAnyShortcut(e, devtoolsShortcut.keys)) {
    e.preventDefault()
    ipcRenderer.invoke('open-dev-tools')
  }

  const settingsShortcut = userShortcuts.openSettings
  if (settingsShortcut && settingsShortcut.keys && matchAnyShortcut(e, settingsShortcut.keys)) {
    e.preventDefault()
    navigateToPage('settings')
  }

  const shortcutSettingsShortcut = userShortcuts.openShortcutSettings
  if (shortcutSettingsShortcut && shortcutSettingsShortcut.keys && matchAnyShortcut(e, shortcutSettingsShortcut.keys)) {
    e.preventDefault()
    openShortcutSettings()
  }

  const refreshShortcut = userShortcuts.refresh
  if (refreshShortcut && refreshShortcut.keys && matchAnyShortcut(e, refreshShortcut.keys)) {
    e.preventDefault()
    refreshCurrentPage()
  }

  if (e.key.toLowerCase() === 'g' && !pendingGoTop) {
    pendingGoTop = true
    setTimeout(() => { pendingGoTop = false }, 500)
  } else if (e.key.toLowerCase() === 'g' && pendingGoTop) {
    pendingGoTop = false
    const goTopShortcut = userShortcuts.goTop
    if (goTopShortcut && goTopShortcut.keys) {
      e.preventDefault()
      scrollToTop()
    }
  }

  const scrollDownShortcut = userShortcuts.scrollDown
  if (scrollDownShortcut && scrollDownShortcut.keys && matchAnyShortcut(e, scrollDownShortcut.keys)) {
    e.preventDefault()
    scrollHalfPage('down')
  }

  const scrollUpShortcut = userShortcuts.scrollUp
  if (scrollUpShortcut && scrollUpShortcut.keys && matchAnyShortcut(e, scrollUpShortcut.keys)) {
    e.preventDefault()
    scrollHalfPage('up')
  }
}

function normalizeKey(key) {
  const keyMap = {
    'comma': ',',
    'period': '.',
    'slash': '/',
    'backslash': '\\',
    'semicolon': ';',
    'quote': '\'',
    'bracketleft': '[',
    'bracketright': ']',
    'equal': '=',
    'minus': '-',
    'backquote': '`'
  }
  return keyMap[key.toLowerCase()] || key.toLowerCase()
}

function isKeyMatch(e, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return false
  const pressedKeys = []
  if (e.ctrlKey) pressedKeys.push('ctrl')
  if (e.shiftKey) pressedKeys.push('shift')
  if (e.altKey) pressedKeys.push('alt')
  if (e.metaKey) pressedKeys.push('meta')
  const key = e.key.toLowerCase()
  if (key !== 'control' && key !== 'shift' && key !== 'alt' && key !== 'meta') {
    pressedKeys.push(normalizeKey(key))
  }
  if (pressedKeys.length !== keys.length) return false
  return keys.every(k => pressedKeys.includes(normalizeKey(k)))
}

function matchAnyShortcut(e, keyCombinations) {
  if (!keyCombinations || keyCombinations.length === 0) return false
  return keyCombinations.some(keys => isKeyMatch(e, keys))
}

// 追番全部页面相关状态
let bangumiAllState = {
  filterData: null,
  currentFilters: {
    area: -1,
    style_id: -1,
    season_version: -1,
    season_status: -1,
    spoken_language_type: -1,
    copyright: -1,
    is_finish: -1,
    year: -1,
    season_month: -1,
    type: 2,
    order: 3,
    index_type: 1,
    pub_date: -1,
    page: 1
  },
  loading: false,
  hasMore: true,
  total: 0
}

// 排序选项（固定）
const sortOptions = [
  { value: 3, label: '最多追番' },
  { value: 2, label: '最多播放' },
  { value: 5, label: '最近更新' },
  { value: 4, label: '最高评分' }
]

// 导航到追番全部页面
function navigateToBangumiAll(type = 'bangumi') {
  pageHistory.push(currentPage)
  if (pageHistory.length > 50) pageHistory.shift()
  
  currentPage = 'bangumi-all'

  document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'))
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'))
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'))
  
  document.getElementById('page-bangumi-all')?.classList.add('active')
  updateNavLinks('bangumi-all')
  updateBackButton()

  const content = document.querySelector('.content')
  if (content) {
    content.removeEventListener('scroll', handleScroll)
    content.removeEventListener('scroll', handleDynamicScroll)
    content.addEventListener('scroll', handleScroll)
  }

  // 重置状态
  bangumiAllState.page = 1
  bangumiAllState.hasMore = true
  
  // 根据类型设置地区筛选
  if (type === 'chinese') {
    bangumiAllState.currentFilters.area = 2
  } else {
    bangumiAllState.currentFilters.area = -1
  }
  
  // 加载筛选条件和数据
  loadBangumiAllFilters()
  loadBangumiAllData()
}

// 加载筛选条件数据
async function loadBangumiAllFilters() {
  try {
    const result = await ipcRenderer.invoke('fetch-bangumi-condition', { index_type: 4, type: 2 })
    
    if (result.success && result.data) {
      bangumiAllState.filterData = result.data.data
      renderFilters(bangumiAllState.filterData)
    }
  } catch (error) {
    console.error('加载筛选条件失败:', error)
  }
}

// 渲染筛选条件
function renderFilters(filterData) {
  // 渲染地区
  renderFilterOptions('area-options', filterData.area || [], 'area', '全部地区')
  
  // 渲染风格
  renderFilterOptions('style-options', filterData.style || [], 'style_id', '全部风格')
  
  // 渲染版本类型
  renderFilterOptions('version-options', filterData.season_version || [], 'season_version', '全部版本')
  
  // 渲染付费类型
  renderFilterOptions('pay-options', filterData.pay || [], 'pay', '全部类型')
  
  // 渲染配音类型
  renderFilterOptions('audio-options', filterData.language || [], 'spoken_language_type', '全部配音')
  
  // 渲染版权类型
  renderFilterOptions('copyright-options', filterData.copyright || [], 'copyright', '全部版权')
  
  // 渲染完结状态
  renderFilterOptions('status-options', filterData.is_finish || [], 'is_finish', '全部状态')
  
  // 渲染年份
  renderYearOptions(filterData.year || [])
  
  // 渲染季度
  renderQuarterOptions()
  
  // 渲染排序
  renderSortOptions()
}

// 渲染普通筛选选项
function renderFilterOptions(containerId, options, filterKey, allLabel) {
  const container = document.getElementById(containerId)
  if (!container || !options.length) return
  
  let html = `<span class="filter-option ${bangumiAllState.currentFilters[filterKey] === -1 ? 'active' : ''}" data-key="${filterKey}" data-value="-1">${allLabel}</span>`
  
  options.forEach(opt => {
    const isActive = bangumiAllState.currentFilters[filterKey] === opt.id
    html += `<span class="filter-option ${isActive ? 'active' : ''}" data-key="${filterKey}" data-value="${opt.id}">${opt.name}</span>`
  })
  
  container.innerHTML = html
  
  // 添加点击事件
  container.querySelectorAll('.filter-option').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key
      const value = parseInt(el.dataset.value)
      bangumiAllState.currentFilters[key] = value
      bangumiAllState.page = 1
      bangumiAllState.hasMore = true
      
      // 更新激活状态
      container.querySelectorAll('.filter-option').forEach(opt => opt.classList.remove('active'))
      el.classList.add('active')
      
      // 重新加载数据
      loadBangumiAllData()
    })
  })
}

// 渲染年份选项
function renderYearOptions(years) {
  const container = document.getElementById('year-options')
  if (!container) return
  
  let html = `<span class="filter-option ${bangumiAllState.currentFilters.year === -1 ? 'active' : ''}" data-key="year" data-value="-1">全部年份</span>`
  
  // 按年份排序，最新的在前
  const sortedYears = [...years].sort((a, b) => b.id - a.id)
  
  sortedYears.forEach(year => {
    const isActive = bangumiAllState.currentFilters.year === year.id
    html += `<span class="filter-option ${isActive ? 'active' : ''}" data-key="year" data-value="${year.id}">${year.id}</span>`
  })
  
  container.innerHTML = html
  
  // 添加点击事件
  container.querySelectorAll('.filter-option').forEach(el => {
    el.addEventListener('click', () => {
      bangumiAllState.currentFilters.year = parseInt(el.dataset.value)
      bangumiAllState.page = 1
      bangumiAllState.hasMore = true
      
      container.querySelectorAll('.filter-option').forEach(opt => opt.classList.remove('active'))
      el.classList.add('active')
      
      loadBangumiAllData()
    })
  })
}

// 渲染季度选项
function renderQuarterOptions() {
  const container = document.getElementById('quarter-options')
  if (!container) return
  
  const quarters = [
    { value: -1, label: '全部季度' },
    { value: 1, label: '1月' },
    { value: 4, label: '4月' },
    { value: 7, label: '7月' },
    { value: 10, label: '10月' }
  ]
  
  let html = ''
  quarters.forEach(q => {
    const isActive = bangumiAllState.currentFilters.season_month === q.value
    html += `<span class="filter-option ${isActive ? 'active' : ''}" data-key="season_month" data-value="${q.value}">${q.label}</span>`
  })
  
  container.innerHTML = html
  
  container.querySelectorAll('.filter-option').forEach(el => {
    el.addEventListener('click', () => {
      bangumiAllState.currentFilters.season_month = parseInt(el.dataset.value)
      bangumiAllState.page = 1
      bangumiAllState.hasMore = true
      
      container.querySelectorAll('.filter-option').forEach(opt => opt.classList.remove('active'))
      el.classList.add('active')
      
      loadBangumiAllData()
    })
  })
}

// 渲染排序选项
function renderSortOptions() {
  const container = document.getElementById('sort-options')
  if (!container) return
  
  let html = ''
  sortOptions.forEach(opt => {
    const isActive = bangumiAllState.currentFilters.order === opt.value
    html += `<span class="filter-option ${isActive ? 'active' : ''}" data-key="order" data-value="${opt.value}">${opt.label}</span>`
  })
  
  container.innerHTML = html
  
  container.querySelectorAll('.filter-option').forEach(el => {
    el.addEventListener('click', () => {
      bangumiAllState.currentFilters.order = parseInt(el.dataset.value)
      bangumiAllState.page = 1
      bangumiAllState.hasMore = true
      
      container.querySelectorAll('.filter-option').forEach(opt => opt.classList.remove('active'))
      el.classList.add('active')
      
      loadBangumiAllData()
    })
  })
}

// 加载追番全部页面数据
async function loadBangumiAllData(append = false) {
  if (bangumiAllState.loading) return
  bangumiAllState.loading = true
  
  const loadingEl = document.getElementById('bangumi-all-loading')
  const noMoreEl = document.getElementById('bangumi-all-no-more')
  const gridEl = document.getElementById('bangumi-all-grid')
  
  if (loadingEl) loadingEl.style.display = 'block'
  if (noMoreEl) noMoreEl.style.display = 'none'
  
  try {
    const params = { ...bangumiAllState.currentFilters, page: bangumiAllState.page }
    const result = await ipcRenderer.invoke('fetch-bangumi-result', params)
    
    if (result.success && result.data && result.data.data) {
      const data = result.data.data
      bangumiAllState.total = data.total || 0
      
      if (data.list && data.list.length > 0) {
        if (append) {
          appendBangumiAllCards(data.list)
        } else {
          renderBangumiAllCards(data.list)
        }
        
        bangumiAllState.hasMore = data.has_more === 1 || data.list.length >= 20
        bangumiAllState.page++
      } else if (!append) {
        gridEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无数据</div>'
        bangumiAllState.hasMore = false
      }
    } else if (!append) {
      gridEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">获取数据失败</div>'
    }
  } catch (error) {
    console.error('加载追番数据失败:', error)
    if (!append) {
      gridEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">加载失败</div>'
    }
  }
  
  bangumiAllState.loading = false
  if (loadingEl) loadingEl.style.display = 'none'
  if (noMoreEl && !bangumiAllState.hasMore) noMoreEl.style.display = 'block'
}

// 渲染追番全部卡片
function renderBangumiAllCards(items) {
  const gridEl = document.getElementById('bangumi-all-grid')
  if (!gridEl) return
  
  gridEl.innerHTML = items.map(item => createBangumiAllCard(item)).join('')
  
  // 添加点击事件
  gridEl.querySelectorAll('.bangumi-all-card').forEach((card, index) => {
    card.addEventListener('click', () => {
      const item = items[index]
      if (item.season_id) {
        window.open(`https://www.bilibili.com/bangumi/media/md${item.season_id}/`, '_blank')
      }
    })
  })
}

// 添加追番全部卡片
function appendBangumiAllCards(items) {
  const gridEl = document.getElementById('bangumi-all-grid')
  if (!gridEl) return
  
  items.forEach(item => {
    const card = document.createElement('div')
    card.innerHTML = createBangumiAllCard(item)
    gridEl.appendChild(card)
    
    card.addEventListener('click', () => {
      if (item.season_id) {
        window.open(`https://www.bilibili.com/bangumi/media/md${item.season_id}/`, '_blank')
      }
    })
  })
}

// 创建追番全部卡片HTML
function createBangumiAllCard(item) {
  const coverUrl = item.cover?.startsWith('//') ? 'https:' + item.cover : (item.cover || '')
  const badge = item.is_pay === 1 ? '大会员' : item.is_free === 1 ? '免费' : ''
  const badgeClass = item.is_pay === 1 ? '' : item.is_free === 1 ? 'green' : 'blue'
  
  return `
    <div class="bangumi-all-card">
      <div class="bangumi-all-cover">
        <img src="${coverUrl}" alt="${item.title}" loading="lazy">
        ${badge ? `<span class="bangumi-all-badge ${badgeClass}">${badge}</span>` : ''}
        ${item.index_show ? `<span style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); color: #fff; font-size: 12px; padding: 2px 6px; border-radius: 3px;">${item.index_show}</span>` : ''}
      </div>
      <div class="bangumi-all-info">
        <h3 class="bangumi-all-title">${item.title}</h3>
        <p class="bangumi-all-desc">${item.subtitle || ''}</p>
        <div class="bangumi-all-stat">${item.stat?.follow ? formatPlayCount(item.stat.follow) + '人追番' : ''}</div>
      </div>
    </div>
  `
}

// 初始化追番全部页面的查看全部按钮事件
function initBangumiViewAllButtons() {
  const bangumiViewAll = document.getElementById('view-all-bangumi')
  const chineseViewAll = document.getElementById('view-all-chinese')
  
  bangumiViewAll?.addEventListener('click', () => navigateToBangumiAll('bangumi'))
  chineseViewAll?.addEventListener('click', () => navigateToBangumiAll('chinese'))
}

// 在初始化时绑定事件
document.addEventListener('DOMContentLoaded', () => {
  initBangumiViewAllButtons()
})

document.addEventListener('keydown', e => {
  // 如果快速访问键模式已开启，不处理其他快捷键
  if (accesskeyEnabled) {
    return
  }

  const closeWindowShortcut = userShortcuts.closeWindow
  if (closeWindowShortcut && closeWindowShortcut.keys && matchAnyShortcut(e, closeWindowShortcut.keys)) {
    e.preventDefault()

    const modal = document.getElementById('shortcutModal')
    const isModalOpen = modal && modal.style.display === 'flex'

    if (isModalOpen) {
      closeShortcutSettings()
    } else {
      ipcRenderer.invoke('close-window')
    }
    return
  }

  applyShortcuts(e)
})

// 快速访问键功能 (类似 Surfingkeys 的 f 键)
let accesskeyEnabled = false
let accesskeyElements = []
let accesskeyLabels = []
let accesskeyInput = ''

// 生成字母组合
function generateAccesskeyLabels(count) {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const labels = []
  
  if (count <= letters.length) {
    for (let i = 0; i < count; i++) {
      labels.push(letters[i])
    }
  } else {
    // 生成双字母组合
    for (let i = 0; i < letters.length; i++) {
      for (let j = 0; j < letters.length && labels.length < count; j++) {
        labels.push(letters[i] + letters[j])
      }
    }
  }
  
  return labels
}

// 检查元素是否可见
function isElementVisible(el) {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  if (rect.top < 0 && rect.bottom < 0) return false
  if (rect.left < 0 && rect.right < 0) return false
  
  // 检查元素及其祖先是否被隐藏
  let current = el
  while (current) {
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false
    }
    current = current.parentElement
  }
  
  return true
}

// 获取可点击元素
function getClickableElements() {
  const selectors = [
    'button:not([disabled])',
    'a[href]:not([disabled])',
    '[role="button"]:not([disabled])',
    '#sidebarUserAvatar',
    '.sidebar-item',
    '.video-card',
    '.video-card a',
    '.hot-item',
    '.history-tag',
    '.my-tab',
    '.bottom-action-btn',
    '.nav-link'
  ]
  
  const elements = []
  const seen = new Set()
  
  // 处理所有元素，使用元素本身作为唯一标识
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach(el => {
      // 使用元素对象本身作为 key，确保每个元素只出现一次
      if (seen.has(el)) return
      
      // 对于可见元素，检查位置
      const isNavLink = el.classList.contains('nav-link')
      if (!isNavLink) {
        if (!isElementVisible(el)) return
        
        const rect = el.getBoundingClientRect()
        if (rect.top < -50) return // 完全在视口上方的不显示
      }
      
      seen.add(el)
      elements.push(el)
    })
  }
  
  // 按位置排序（从上到下，从左到右）
  return elements.sort((a, b) => {
    const rectA = a.getBoundingClientRect()
    const rectB = b.getBoundingClientRect()
    const rowDiff = rectA.top - rectB.top
    if (Math.abs(rowDiff) > 50) return rowDiff
    return rectA.left - rectB.left
  })
}

// 显示访问键标签
function showAccesskeyLabels() {
  // 如果已经开启，先关闭
  if (accesskeyEnabled) {
    hideAccesskeyLabels()
    return
  }

  accesskeyEnabled = true
  accesskeyInput = ''
  
  const elements = getClickableElements()
  accesskeyElements = elements
  
  const labels = generateAccesskeyLabels(elements.length)
  
  // 创建遮罩层
  let overlay = document.getElementById('accesskeyOverlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'accesskeyOverlay'
    overlay.className = 'accesskey-overlay'
    document.body.appendChild(overlay)
  }
  overlay.classList.add('active')
  
  // 创建标签
  let navLinkRow = 0
  let navLinkCol = 0
  const navLinkStartX = 80
  const navLinkStartY = 45
  const navLinkSpacingX = 100
  const navLinkSpacingY = 40
  
  // 获取顶部栏高度（假设顶部栏有.header类）
  const header = document.querySelector('.header')
  const headerHeight = header ? header.offsetHeight : 50
  
  elements.forEach((el, index) => {
    const rect = el.getBoundingClientRect()
    
    // 检查元素是否在顶部栏内部（子元素）
    const isInHeader = header && header.contains(el)
    
    // 跳过被顶部栏遮挡的元素（元素底部在顶部栏下方且不在顶部栏内部）
    if (!isInHeader && rect.bottom <= headerHeight) {
      return
    }
    
    const label = document.createElement('span')
    label.className = 'accesskey-label'
    const key = labels[index].toUpperCase()
    // 初始时直接显示字母，不加遮罩
    label.textContent = key
    label.dataset.accesskey = labels[index]
    label.dataset.index = index
    
    // 检查是否是导航链接且位置无效（被隐藏）
    const isNavLink = el.classList.contains('nav-link')
    const isHidden = rect.width === 0 || rect.height === 0 || rect.top < -50
    
    let labelX, labelY
    
    if (isNavLink && isHidden) {
      // 如果是被隐藏的导航链接，计算一个合适的位置显示标签
      labelX = navLinkStartX + navLinkCol * navLinkSpacingX
      labelY = navLinkStartY + navLinkRow * navLinkSpacingY
      
      navLinkCol++
      if (navLinkCol > 5) {
        navLinkCol = 0
        navLinkRow++
      }
    } else {
      // 正常定位在元素左上角
      labelX = rect.left + 8
      // 如果是顶部栏内部的元素，直接显示在元素位置；否则确保不被顶部栏遮挡
      labelY = isInHeader ? rect.top + 8 : Math.max(rect.top + 8, headerHeight + 8)
    }
    
    label.style.left = labelX + 'px'
    label.style.top = labelY + 'px'
    
    document.body.appendChild(label)
    accesskeyLabels.push(label)
  })
}

// 隐藏访问键标签
function hideAccesskeyLabels() {
  accesskeyEnabled = false
  accesskeyInput = ''
  
  // 移除遮罩层
  const overlay = document.getElementById('accesskeyOverlay')
  if (overlay) {
    overlay.classList.remove('active')
  }
  
  // 移除所有标签
  accesskeyLabels.forEach(label => {
    document.body.removeChild(label)
  })
  accesskeyLabels = []
  accesskeyElements = []
}

// 更新高亮状态
function updateAccesskeyHighlight() {
  accesskeyLabels.forEach(label => {
    const key = label.dataset.accesskey.toLowerCase()
    const input = accesskeyInput.toLowerCase()
    
    if (key.startsWith(input)) {
      label.classList.remove('hidden')
      // 更新标签显示：已输入的字母变淡
      const fullKey = key.toUpperCase()
      if (input.length > 0 && input.length < key.length) {
        const matchedPart = fullKey.substring(0, input.length)
        const remainingPart = fullKey.substring(input.length)
        label.innerHTML = `<span class="matched-char">${matchedPart}</span>${remainingPart}`
      } else {
        label.innerHTML = `<span class="matched-char" style="opacity:1">${fullKey}</span>`
      }
    } else {
      label.classList.add('hidden')
    }
  })
}

// 处理访问键输入
function handleAccesskeyInput(key) {
  if (!accesskeyEnabled) return
  
  accesskeyInput += key.toLowerCase()
  
  // 更新高亮
  updateAccesskeyHighlight()
  
  // 检查是否匹配
  const matchedLabels = accesskeyLabels.filter(label => 
    label.dataset.accesskey === accesskeyInput.toLowerCase()
  )
  
  if (matchedLabels.length === 1) {
    const index = parseInt(matchedLabels[0].dataset.index)
    const element = accesskeyElements[index]
    
    // 模拟点击
    element.click()
    
    // 隐藏标签
    hideAccesskeyLabels()
  } else if (accesskeyLabels.every(label => !label.dataset.accesskey.startsWith(accesskeyInput.toLowerCase()))) {
    // 没有匹配，重置输入
    accesskeyInput = key.toLowerCase()
    updateAccesskeyHighlight()
  }
}

// 监听键盘事件
document.addEventListener('keydown', e => {
  // 如果在输入框中，不处理
  const activeElement = document.activeElement
  if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
    return
  }
  
  // 按下 f 键开启访问键
  if (e.key === 'f' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
    e.preventDefault()
    showAccesskeyLabels()
    return
  }
  
  // 如果访问键已开启
  if (accesskeyEnabled) {
    e.preventDefault()
    
    // 按 Escape 关闭
    if (e.key === 'Escape') {
      hideAccesskeyLabels()
      return
    }
    
    // 按退格键删除最后一个字符
    if (e.key === 'Backspace') {
      accesskeyInput = accesskeyInput.slice(0, -1)
      updateAccesskeyHighlight()
      return
    }
    
    // 只处理字母键
    if (/^[a-zA-Z]$/.test(e.key)) {
      handleAccesskeyInput(e.key)
    }
  }
})