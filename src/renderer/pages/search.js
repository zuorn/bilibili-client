// 搜索模块

// 将用户搜索结果映射为卡片可用的格式
function mapUserItem(item) {
  return {
    bvid: '',
    title: (item.uname || '').replace(/<[^>]+>/g, '') || '未知用户',
    pic: optimizeCoverUrl(item.upic || '', 200, 200),
    duration: '',
    cid: '',
    author: (item.usign || '').replace(/<[^>]+>/g, '') || '',
    owner: { mid: item.mid || '', name: item.uname || '' },
    mid: item.mid,
    fans: item.fans || 0,
    videoCount: item.videos || 0,
    isUser: true
  }
}

// 初始化搜索筛选器
function initSearchFilters() {
  const filterContainer = document.getElementById('page-search')
  if (!filterContainer) return

  // 分类标签点击事件
  const tabs = filterContainer.querySelectorAll('.search-filter-tab')
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      setSearchType(tab.dataset.type)
    })
  })

  // 排序选项点击事件
  const sortItems = filterContainer.querySelectorAll('.search-sort-item')
  sortItems.forEach(item => {
    item.addEventListener('click', () => {
      setSearchOrder(item.dataset.order)
    })
  })
}

// 设置搜索类型
function setSearchType(type) {
  const state = pageStates.search
  if (state.searchType === type) return

  state.searchType = type

  // 更新分类标签UI状态
  document.querySelectorAll('.search-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.type === type)
  })

  // 综合和视频支持排序，番剧/影视/用户不支持
  const sortSupported = type === 'all' || type === 'video'
  const sortRow = document.getElementById('searchSortRow')
  if (sortRow) {
    sortRow.classList.toggle('hidden', !sortSupported)
  }

  // 切换到不支持排序的标签时，重置排序为默认
  if (!sortSupported && state.order !== 'totalrank') {
    state.order = 'totalrank'
    document.querySelectorAll('.search-sort-item').forEach(item => {
      item.classList.toggle('active', item.dataset.order === 'totalrank')
    })
  }

  // 如果有搜索关键词，重新搜索
  if (state.keyword) {
    state.pageNum = 1
    state.hasMore = true
    state.loading = false  // 重置 loading，避免被拦截
    showEmptyMessage('searchGrid', '搜索中...')
    searchVideos(state.keyword, 1, false)
  }
}

// 设置排序方式
function setSearchOrder(order) {
  const state = pageStates.search
  if (state.order === order) return

  state.order = order

  // 更新UI状态
  document.querySelectorAll('.search-sort-item').forEach(item => {
    item.classList.toggle('active', item.dataset.order === order)
  })

  // 如果有搜索关键词，重新搜索
  if (state.keyword) {
    state.pageNum = 1
    state.hasMore = true
    state.loading = false  // 重置 loading，避免被拦截
    showEmptyMessage('searchGrid', '搜索中...')
    searchVideos(state.keyword, 1, false)
  }
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

  // 重置搜索状态，避免 loading 卡住
  pageStates.search.keyword = keyword
  pageStates.search.pageNum = 1
  pageStates.search.hasMore = true
  pageStates.search.loading = false

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
    console.log('[搜索] type=%s, order=%s, page=%d', state.searchType, state.order, page)
    const result = await ipcRenderer.invoke('search-videos', keyword, page, state.searchType, state.order)
    let items = []

    if (result.success && result.data && result.data.code === 0) {
      const data = result.data.data || {}

      if (state.searchType === 'all') {
        // 综合搜索 v2：data.result 是分类对象数组，需提取视频类数据
        // 结构: [{ result_type: "video", data: [video1, ...] }, { result_type: "live", data: [...] }, ...]
        const resultGroups = Array.isArray(data.result) ? data.result : []
        for (const group of resultGroups) {
          if (group.result_type === 'video' && Array.isArray(group.data)) {
            items = group.data
            break
          }
        }
        // 如果没找到 video 类型，取第一个有 data 数组的分组
        if (items.length === 0) {
          for (const group of resultGroups) {
            if (Array.isArray(group.data) && group.data.length > 0) {
              items = group.data
              break
            }
          }
        }
      } else {
        // 分类搜索：data.result 直接是结果数组
        if (Array.isArray(data.result)) {
          items = data.result
        }
      }
    }

    if (items.length > 0) {
      const pageSizeMap = { all: 42, video: 42, media_bangumi: 12, media_ft: 12, bili_user: 36 }
      const pageSize = pageSizeMap[state.searchType] || 20
      state.hasMore = items.length >= pageSize
      // 用户搜索用专用映射函数，其他类型用通用视频映射
      const mapper = state.searchType === 'bili_user' ? mapUserItem : mapVideoItem
      const newVideos = items.map(item => mapper(item))

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

// 初始化搜索页面
function initSearchPage() {
  initSearchFilters()
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSearchPage)
} else {
  initSearchPage()
}
