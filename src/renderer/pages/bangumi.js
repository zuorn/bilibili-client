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
  const badgeText = item.badge_info?.text || item.badge || ''
  const isMember = badgeText === '会员' || badgeText === '大会员'
  const isProduct = badgeText === '出品'
  const isDub = badgeText === '独播' || badgeText === '独家'
  let colorStyle = ''
  if (isMember) colorStyle = 'background: #FB7299;'
  else if (isProduct) colorStyle = 'background: #5CB85C;'
  else if (isDub) colorStyle = 'background: #56B0FF;'
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
      ${badgeText ? `<span class="following-badge" style="${colorStyle} position: absolute; top: 8px; right: 8px;">${badgeText}</span>` : ''}
      ${bottomBadge}
      ${newEp ? `<span class="following-new-ep" style="position: absolute; bottom: 8px; left: 8px; right: auto;">${newEp}</span>` : ''}
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
  const badgeText = item.badge_info?.text || item.badge || ''
  const isMember = badgeText === '会员' || badgeText === '大会员'
  const isProduct = badgeText === '出品'
  const isDub = badgeText === '独播' || badgeText === '独家'
  let colorStyle = ''
  if (isMember) colorStyle = 'background: #FB7299;'
  else if (isProduct) colorStyle = 'background: #5CB85C;'
  else if (isDub) colorStyle = 'background: #56B0FF;'
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
      ${badgeText ? `<span class="following-badge" style="${colorStyle} position: absolute; top: 8px; right: 8px;">${badgeText}</span>` : ''}
      ${bottomBadge}
      ${newEp ? `<span class="following-new-ep" style="position: absolute; bottom: 8px; left: 8px; right: auto;">${newEp}</span>` : ''}
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
