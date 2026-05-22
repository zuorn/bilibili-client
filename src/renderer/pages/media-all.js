// 影视全部页面相关函数

// 导航到影视全部页面
function navigateToMediaAll() {
  pageHistory.push(currentPage)
  if (pageHistory.length > 50) pageHistory.shift()

  currentPage = 'media-all'

  document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'))
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'))
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'))

  document.getElementById('page-media-all')?.classList.add('active')
  updateNavLinks('media-all')
  updateBackButton()

  const content = document.querySelector('.content')
  if (content) {
    content.removeEventListener('scroll', handleScroll)
    content.removeEventListener('scroll', handleDynamicScroll)
    content.addEventListener('scroll', handleScroll)
  }

  // 重置状态
  mediaAllState.page = 1
  mediaAllState.hasMore = true
  mediaAllState.currentFilters.area = -1
  mediaAllState.currentFilters.style_id = -1
  mediaAllState.currentFilters.release_date = -1
  mediaAllState.currentFilters.season_status = -1

  // 加载筛选条件和数据
  loadMediaAllFilters()
  loadMediaAllData()
}

// 加载影视全部筛选条件数据
async function loadMediaAllFilters() {
  try {
    const result = await ipcRenderer.invoke('fetch-media-condition', { index_type: 2, type: 2 })
    console.log('Media condition API result:', JSON.stringify(result, null, 2))

    if (result.success && result.data) {
      const filterData = result.data.data?.filter || result.data.filter || result.data.result?.filters || []
      console.log('Media filterData set to:', JSON.stringify(filterData, null, 2))
      renderMediaFilters(filterData)
    } else {
      console.error('Media condition API failed:', result.error)
    }
  } catch (error) {
    console.error('加载影视筛选条件失败:', error)
  }
}

// 渲染影视筛选条件
function renderMediaFilters(filterData) {
  console.log('renderMediaFilters called with:', JSON.stringify(filterData, null, 2))

  const filtersMap = {}
  const labelsMap = {}
  if (Array.isArray(filterData)) {
    filterData.forEach(item => {
      filtersMap[item.field] = item.values || []
      labelsMap[item.field] = item.name || ''
    })
  }

  console.log('Media filtersMap:', JSON.stringify(filtersMap, null, 2))
  console.log('Media labelsMap:', JSON.stringify(labelsMap, null, 2))

  // 渲染排序
  renderMediaSortOptions()

  // 渲染地区
  renderMediaFilterOptions('filter-media-area', 'media-area-options', filtersMap.area || [], 'area', labelsMap.area || '地区')

  // 渲染风格
  renderMediaFilterOptions('filter-media-style', 'media-style-options', filtersMap.style_id || [], 'style_id', labelsMap.style_id || '风格')

  // 渲染上映时间
  renderMediaFilterOptions('filter-media-release', 'media-release-options', filtersMap.release_date || [], 'release_date', labelsMap.release_date || '上映时间')

  // 渲染付费状态
  renderMediaFilterOptions('filter-media-status', 'media-status-options', filtersMap.season_status || [], 'season_status', labelsMap.season_status || '付费状态')
}

// 渲染排序选项
function renderMediaSortOptions() {
  const container = document.getElementById('media-sort-options')
  const filterRow = document.getElementById('filter-media-sort')
  if (!container) return

  if (filterRow) {
    const labelEl = filterRow.querySelector('.filter-label')
    if (labelEl) labelEl.textContent = '综合排序'
  }

  let html = ''
  mediaSortOptions.forEach(opt => {
    const isActive = mediaAllState.currentFilters.order === opt.value
    html += `<span class="filter-option ${isActive ? 'active' : ''}" data-order="${opt.value}">${opt.label}</span>`
  })

  container.innerHTML = html

  container.querySelectorAll('.filter-option').forEach(el => {
    el.addEventListener('click', () => {
      mediaAllState.currentFilters.order = parseInt(el.dataset.order)
      mediaAllState.page = 1
      mediaAllState.hasMore = true

      container.querySelectorAll('.filter-option').forEach(opt => opt.classList.remove('active'))
      el.classList.add('active')

      loadMediaAllData()
    })
  })
}

// 渲染影视筛选选项
function renderMediaFilterOptions(filterRowId, containerId, options, filterKey, label) {
  const container = document.getElementById(containerId)
  const filterRow = document.getElementById(filterRowId)
  console.log(`renderMediaFilterOptions called: filterRowId=${filterRowId}, containerId=${containerId}, options.length=${options?.length}, filterKey=${filterKey}, label=${label}`)

  if (!container) {
    console.log(`renderMediaFilterOptions: skipping render for ${containerId} - container does not exist`)
    return
  }

  if (filterRow) {
    const labelEl = filterRow.querySelector('.filter-label')
    if (labelEl) labelEl.textContent = label
  }

  const allLabel = `全部${label}`

  let html = `<span class="filter-option ${mediaAllState.currentFilters[filterKey] === -1 ? 'active' : ''}" data-key="${filterKey}" data-value="-1">${allLabel}</span>`

  if (options && options.length > 0) {
    options.forEach(opt => {
      if (opt.keyword === '-1') return
      const value = opt.keyword
      const isActive = mediaAllState.currentFilters[filterKey] === value ||
                      mediaAllState.currentFilters[filterKey] === parseInt(value)
      html += `<span class="filter-option ${isActive ? 'active' : ''}" data-key="${filterKey}" data-value="${value}">${opt.name}</span>`
    })
  }

  container.innerHTML = html
  console.log(`renderMediaFilterOptions: rendered ${options?.length || 0} options for ${containerId}`)

  container.querySelectorAll('.filter-option').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key
      const value = el.dataset.value
      mediaAllState.currentFilters[key] = value === '-1' ? -1 : value
      mediaAllState.page = 1
      mediaAllState.hasMore = true

      container.querySelectorAll('.filter-option').forEach(opt => opt.classList.remove('active'))
      el.classList.add('active')

      loadMediaAllData()
    })
  })
}

// 加载影视全部数据
async function loadMediaAllData(append = false) {
  if (mediaAllState.loading) return
  mediaAllState.loading = true

  const loadingEl = document.getElementById('media-all-loading')
  const noMoreEl = document.getElementById('media-all-no-more')
  const gridEl = document.getElementById('media-all-grid')

  if (loadingEl) loadingEl.style.display = 'block'
  if (noMoreEl) noMoreEl.style.display = 'none'

  try {
    const params = { ...mediaAllState.currentFilters, page: mediaAllState.page }
    const result = await ipcRenderer.invoke('fetch-media-result', params)

    if (result.success && result.data && result.data.data) {
      const data = result.data.data
      mediaAllState.total = data.total || 0

      if (data.list && data.list.length > 0) {
        if (append) {
          appendMediaAllCards(data.list)
        } else {
          renderMediaAllCards(data.list)
        }

        mediaAllState.hasMore = data.has_more === 1 || data.list.length >= 20
        mediaAllState.page++
      } else if (!append) {
        gridEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无数据</div>'
        mediaAllState.hasMore = false
      }
    } else if (!append) {
      gridEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">获取数据失败</div>'
    }
  } catch (error) {
    console.error('加载影视数据失败:', error)
    if (!append) {
      gridEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">加载失败</div>'
    }
  }

  mediaAllState.loading = false
  if (loadingEl) loadingEl.style.display = 'none'
  if (noMoreEl && !mediaAllState.hasMore) noMoreEl.style.display = 'block'
}

// 渲染影视全部卡片
function renderMediaAllCards(items) {
  const gridEl = document.getElementById('media-all-grid')
  if (!gridEl) return

  gridEl.innerHTML = items.map(item => createMediaAllCard(item)).join('')

  gridEl.querySelectorAll('.bangumi-all-card').forEach((card, index) => {
    card.addEventListener('click', () => {
      playBangumi(items[index])
    })
    const img = card.querySelector('.bangumi-all-cover img')
    setupLazyImage(img, index < EAGER_COUNT)
  })
}

// 添加影视全部卡片
function appendMediaAllCards(items) {
  const gridEl = document.getElementById('media-all-grid')
  if (!gridEl) return

  items.forEach(item => {
    const card = document.createElement('div')
    card.innerHTML = createMediaAllCard(item)
    gridEl.appendChild(card)

    card.addEventListener('click', () => {
      playBangumi(item)
    })
    const img = card.querySelector('.bangumi-all-cover img')
    setupLazyImage(img, false)
  })
}

// 创建影视全部卡片HTML
function createMediaAllCard(item) {
  const coverUrl = optimizeCoverUrl(item.cover || '', 672, 378)

  let badges = []

  const badgeText = item.badge_info?.text || item.badge || ''
  if (badgeText) {
    const isMember = badgeText === '会员' || badgeText === '大会员'
    const isProduct = badgeText === '出品'
    const isDub = badgeText === '独播' || badgeText === '独家'
    let colorClass = ''
    if (isMember) colorClass = 'red'
    else if (isProduct) colorClass = 'green'
    else if (isDub) colorClass = 'blue'
    badges.push({ text: badgeText, class: colorClass })
  }

  if (item.is_pay === 1 && badgeText !== '会员' && badgeText !== '大会员') {
    badges.push({ text: '大会员', class: 'red' })
  } else if (item.is_free === 1) {
    badges.push({ text: '免费', class: 'green' })
  }

  const badgesHtml = badges.map(b =>
    `<span class="bangumi-all-badge ${b.class}">${b.text}</span>`
  ).join('')

  return `
    <div class="bangumi-all-card">
      <div class="bangumi-all-cover">
        <img src="" alt="${item.title}" data-src="${coverUrl}">
        ${badges.length > 0 ? `<div class="badges-container">${badgesHtml}</div>` : ''}
        ${item.index_show ? `<span style="position: absolute; bottom: 8px; left: 8px; right: auto; background: rgba(0,0,0,0.7); color: #fff; font-size: 12px; padding: 2px 6px; border-radius: 3px;">${item.index_show}</span>` : ''}
      </div>
      <div class="bangumi-all-info">
        <h3 class="bangumi-all-title">${item.title}</h3>
        <p class="bangumi-all-desc">${item.subtitle || ''}</p>
        <div class="bangumi-all-stat">${item.stat?.follow ? formatPlayCount(item.stat.follow) + '人追剧' : ''}</div>
      </div>
    </div>
  `
}

// 初始化影视页面的查看全部按钮事件
function initMediaViewAllButtons() {
  const mediaHotViewAll = document.getElementById('view-all-media')

  mediaHotViewAll?.addEventListener('click', () => navigateToMediaAll())
}
