// 追番全部页面相关函数

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
    console.log('Bangumi condition API result:', JSON.stringify(result, null, 2))

    if (result.success && result.data) {
      console.log('Bangumi condition API response data:', JSON.stringify(result.data, null, 2))
      // main.js返回的是 { success: true, data: apiResult }
      // apiResult的结构是 { code: 0, data: { filter: [...] }, message: "success" }
      // 所以实际路径是 result.data.data.filter
      const filterData = result.data.data?.filter || result.data.filter || result.data.result?.filters || []
      console.log('filterData set to:', JSON.stringify(filterData, null, 2))
      console.log('filterData length:', filterData.length)
      renderFilters(filterData)
    } else {
      console.error('Bangumi condition API failed:', result.error)
    }
  } catch (error) {
    console.error('加载筛选条件失败:', error)
  }
}

// 渲染筛选条件
function renderFilters(filterData) {
  console.log('renderFilters called with:', JSON.stringify(filterData, null, 2))

  const filtersMap = {}
  const labelsMap = {}
  if (Array.isArray(filterData)) {
    filterData.forEach(item => {
      filtersMap[item.field] = item.values || []
      labelsMap[item.field] = item.name || ''
    })
  }

  console.log('filtersMap:', JSON.stringify(filtersMap, null, 2))
  console.log('labelsMap:', JSON.stringify(labelsMap, null, 2))

  // 渲染地区
  renderFilterOptions('filter-area', 'area-options', filtersMap.area || [], 'area', labelsMap.area || '地区')

  // 渲染风格
  renderFilterOptions('filter-style', 'style-options', filtersMap.style_id || [], 'style_id', labelsMap.style_id || '风格')

  // 渲染版本类型
  renderFilterOptions('filter-version', 'version-options', filtersMap.season_version || [], 'season_version', labelsMap.season_version || '版本类型')

  // 渲染付费类型
  renderFilterOptions('filter-pay', 'pay-options', filtersMap.season_status || [], 'season_status', labelsMap.season_status || '付费类型')

  // 渲染配音类型
  console.log('spoken_language_type data:', JSON.stringify(filtersMap.spoken_language_type, null, 2))
  renderFilterOptions('filter-audio', 'audio-options', filtersMap.spoken_language_type || [], 'spoken_language_type', labelsMap.spoken_language_type || '配音类型')

  // 渲染版权类型
  renderFilterOptions('filter-copyright', 'copyright-options', filtersMap.copyright || [], 'copyright', labelsMap.copyright || '版权类型')

  // 渲染完结状态
  renderFilterOptions('filter-status', 'status-options', filtersMap.is_finish || [], 'is_finish', labelsMap.is_finish || '完结状态')

  // 渲染年份
  renderYearOptions('filter-year', filtersMap.year || [], labelsMap.year || '年份')

  // 渲染季度
  renderQuarterOptions('filter-quarter', labelsMap.season_month || '季度')

  // 渲染排序
  renderSortOptions()

  // 初始化更多筛选按钮
  initMoreFilterButton()
}

// 初始化更多筛选按钮
function initMoreFilterButton() {
  const moreFilterBtn = document.getElementById('moreFilterBtn')
  const filterExpandable = document.getElementById('filterExpandable')

  if (!moreFilterBtn || !filterExpandable) return

  // 如果已经初始化过，直接重置状态并返回
  if (moreFilterButtonInitialized) {
    // 重置为收缩状态
    filterExpandable.style.display = 'none'
    moreFilterBtn.classList.remove('expanded')
    moreFilterBtn.querySelector('.more-filter-text').textContent = '更多筛选'
    return
  }

  // 添加点击事件
  moreFilterBtn.addEventListener('click', () => {
    const isExpanded = filterExpandable.style.display !== 'none'

    if (isExpanded) {
      // 收缩
      filterExpandable.style.display = 'none'
      moreFilterBtn.classList.remove('expanded')
      moreFilterBtn.querySelector('.more-filter-text').textContent = '更多筛选'
    } else {
      // 展开
      filterExpandable.style.display = 'block'
      moreFilterBtn.classList.add('expanded')
      moreFilterBtn.querySelector('.more-filter-text').textContent = '收起筛选'
    }
  })

  // 标记已初始化
  moreFilterButtonInitialized = true
}

// 渲染普通筛选选项
function renderFilterOptions(filterRowId, containerId, options, filterKey, label) {
  const container = document.getElementById(containerId)
  const filterRow = document.getElementById(filterRowId)
  console.log(`renderFilterOptions called: filterRowId=${filterRowId}, containerId=${containerId}, options.length=${options?.length}, filterKey=${filterKey}, label=${label}`)

  if (!container) {
    console.log(`renderFilterOptions: skipping render for ${containerId} - container does not exist`)
    return
  }

  // 更新筛选条件标签
  if (filterRow) {
    const labelEl = filterRow.querySelector('.filter-label')
    if (labelEl) {
      labelEl.textContent = label
    }
  }

  // "全部"选项的标签：在label前加"全部"
  const allLabel = `全部${label}`

  let html = `<span class="filter-option ${bangumiAllState.currentFilters[filterKey] === -1 ? 'active' : ''}" data-key="${filterKey}" data-value="-1">${allLabel}</span>`

  if (options && options.length > 0) {
    options.forEach(opt => {
      // 使用 keyword 代替 id，并且跳过 keyword 为 -1 的选项（已经有"全部"选项）
      if (opt.keyword === '-1') return
      const value = opt.keyword
      const isActive = bangumiAllState.currentFilters[filterKey] === value ||
                      bangumiAllState.currentFilters[filterKey] === parseInt(value)
      html += `<span class="filter-option ${isActive ? 'active' : ''}" data-key="${filterKey}" data-value="${value}">${opt.name}</span>`
    })
  }

  container.innerHTML = html
  console.log(`renderFilterOptions: rendered ${options?.length || 0} options for ${containerId}`)

  // 添加点击事件
  container.querySelectorAll('.filter-option').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key
      const value = el.dataset.value
      // 对于数值类型的筛选条件，转换为整数
      bangumiAllState.currentFilters[key] = value === '-1' ? -1 : value
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
function renderYearOptions(filterRowId, years, label) {
  const container = document.getElementById('year-options')
  const filterRow = document.getElementById(filterRowId)
  if (!container) return

  // 更新筛选条件标签
  if (filterRow) {
    const labelEl = filterRow.querySelector('.filter-label')
    if (labelEl) {
      labelEl.textContent = label
    }
  }

  // "全部"选项的标签：在label前加"全部"
  const allLabel = `全部${label}`

  let html = `<span class="filter-option ${bangumiAllState.currentFilters.year === -1 ? 'active' : ''}" data-key="year" data-value="-1">${allLabel}</span>`

  if (years && years.length > 0) {
    // 过滤掉 keyword 为 -1 的选项，然后按名称排序（最新的在前）
    const filteredYears = years.filter(y => y.keyword !== '-1')
    const sortedYears = [...filteredYears].sort((a, b) => {
      // 尝试提取年份数字进行排序
      const yearA = parseInt(a.name) || 0
      const yearB = parseInt(b.name) || 0
      return yearB - yearA
    })

    sortedYears.forEach(year => {
      const value = year.keyword
      const isActive = bangumiAllState.currentFilters.year === value ||
                      bangumiAllState.currentFilters.year === parseInt(value)
      html += `<span class="filter-option ${isActive ? 'active' : ''}" data-key="year" data-value="${value}">${year.name}</span>`
    })
  }

  container.innerHTML = html
  console.log(`renderYearOptions: rendered ${years?.length || 0} years`)

  // 添加点击事件
  container.querySelectorAll('.filter-option').forEach(el => {
    el.addEventListener('click', () => {
      const value = el.dataset.value
      bangumiAllState.currentFilters.year = value === '-1' ? -1 : value
      bangumiAllState.page = 1
      bangumiAllState.hasMore = true

      container.querySelectorAll('.filter-option').forEach(opt => opt.classList.remove('active'))
      el.classList.add('active')

      loadBangumiAllData()
    })
  })
}

// 渲染季度选项
function renderQuarterOptions(filterRowId, label) {
  const container = document.getElementById('quarter-options')
  const filterRow = document.getElementById(filterRowId)
  if (!container) return

  // 更新筛选条件标签
  if (filterRow) {
    const labelEl = filterRow.querySelector('.filter-label')
    if (labelEl) {
      labelEl.textContent = label
    }
  }

  // "全部"选项的标签：在label前加"全部"
  const allLabel = `全部${label}`

  const quarters = [
    { value: -1, label: allLabel },
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
        <img src="${coverUrl}" alt="${item.title}" loading="lazy">
        ${badges.length > 0 ? `<div class="badges-container">${badgesHtml}</div>` : ''}
        ${item.index_show ? `<span style="position: absolute; bottom: 8px; left: 8px; right: auto; background: rgba(0,0,0,0.7); color: #fff; font-size: 12px; padding: 2px 6px; border-radius: 3px;">${item.index_show}</span>` : ''}
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

// 初始化查看全部按钮（从主初始化函数调用）
function initViewAllButtons() {
  initBangumiViewAllButtons()
  initMediaViewAllButtons()
}
