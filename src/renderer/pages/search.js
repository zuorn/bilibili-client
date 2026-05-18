// 搜索模块

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
