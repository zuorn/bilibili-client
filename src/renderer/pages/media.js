// 影视页面相关函数

async function loadMediaPage() {
  console.log('Loading media page')
  const state = pageStates.media
  state.loading = true
  state.hasMore = true
  state.cursor = ''

  const loadingEl = document.getElementById('media-loading-more')
  const noMoreEl = document.getElementById('media-no-more')
  if (loadingEl) loadingEl.style.display = 'none'
  if (noMoreEl) noMoreEl.style.display = 'none'

  try {
    const result = await ipcRenderer.invoke('fetch-media-data', { is_refresh: 0 })
    console.log('Media API result:', result)

    if (result.success && result.data && result.data.data && result.data.data.modules) {
      state.data = result.data.data
      state.cursor = result.data.data.next_cursor || ''
      state.hasMore = result.data.data.has_next === 1
      renderMediaSections(result.data.data)
    } else {
      showEmptyMessage('media-following', '获取影视数据失败')
    }
  } catch (error) {
    console.error('加载影视页面失败:', error)
    showEmptyMessage('media-following', '加载失败，请稍后重试')
  }

  state.loading = false
}

function renderMediaSections(data) {
  console.log('Rendering media sections')

  const modules = data.modules || []

  // 渲染我的追剧（只在找到明确的追剧模块时才显示）
  const followingSection = modules.find(m => m.headers?.[0]?.title?.includes('追剧')) ||
                          modules.find(m => m.attr?.follow === 1)
  if (followingSection) {
    renderMediaFollowingSection(followingSection)
  } else {
    // 如果没有追剧内容，隐藏"我的追剧"区域
    const followingEl = document.getElementById('media-following')
    if (followingEl) followingEl.style.display = 'none'
  }

  // 渲染正在热播
  const hotSection = modules.find(m => m.headers?.[0]?.title?.includes('正在热播')) ||
                     modules.find(m => m.headers?.[0]?.title?.includes('影视推荐')) ||
                     modules[1]
  if (hotSection) {
    renderMediaHot(hotSection)
  }

  // 渲染电影热播
  const movieSection = modules.find(m => m.headers?.[0]?.title?.includes('电影热播')) ||
                       modules.find(m => m.headers?.[0]?.title?.includes('电影')) ||
                       modules[2]
  if (movieSection) {
    renderMovieHot(movieSection)
  }

  // 渲染电视剧热播
  const tvSection = modules.find(m => m.headers?.[0]?.title?.includes('电视剧热播')) ||
                     modules.find(m => m.headers?.[0]?.title?.includes('电视剧')) ||
                     modules[3]
  if (tvSection) {
    renderTvHot(tvSection)
  }

  // 渲染纪录片热播
  const documentarySection = modules.find(m => m.headers?.[0]?.title?.includes('纪录片热播')) ||
                            modules.find(m => m.headers?.[0]?.title?.includes('纪录片')) ||
                            modules[4]
  if (documentarySection) {
    renderDocumentaryHot(documentarySection)
  }

  // 渲染综艺热播
  const varietySection = modules.find(m => m.headers?.[0]?.title?.includes('综艺热播')) ||
                         modules.find(m => m.headers?.[0]?.title?.includes('综艺')) ||
                         modules[5]
  if (varietySection) {
    renderVarietyHot(varietySection)
  }

  // 渲染猜你喜欢（瀑布流）
  const guessSection = modules.find(m => m.headers?.[0]?.title?.includes('猜你')) ||
                       modules[6]
  if (guessSection) {
    renderMediaGuessSection(guessSection)
  }
}

function renderMediaFollowingSection(section) {
  const titleEl = document.querySelector('#media-following .section-title')
  const listEl = document.getElementById('media-following-list')
  const viewAllEl = document.querySelector('#media-following .view-all')

  if (titleEl) titleEl.textContent = '我的追剧'
  if (!listEl) return

  if (viewAllEl) {
    viewAllEl.style.cursor = 'pointer'
    viewAllEl.onclick = () => {
      navigateToPage('my')
      setTimeout(() => {
        const dramaTab = document.querySelector('.my-tab[data-tab="drama"]')
        if (dramaTab) {
          dramaTab.click()
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

function renderMediaHot(section) {
  const titleEl = document.querySelector('#media-hot .section-title')
  const gridEl = document.getElementById('media-hot-grid')

  if (titleEl) titleEl.textContent = '正在热播'
  if (!gridEl) return

  const items = section.items || []
  gridEl.innerHTML = ''

  items.forEach(item => {
    const card = createBangumiCard(item)
    gridEl.appendChild(card)
  })
}

function renderMovieHot(section) {
  const titleEl = document.querySelector('#media-movie .section-title')
  const gridEl = document.getElementById('movie-grid')

  if (titleEl) titleEl.textContent = '电影热播'
  if (!gridEl) return

  const items = section.items || []
  gridEl.innerHTML = ''

  items.forEach(item => {
    const card = createBangumiCard(item)
    gridEl.appendChild(card)
  })
}

function renderTvHot(section) {
  const titleEl = document.querySelector('#media-tv .section-title')
  const gridEl = document.getElementById('tv-grid')

  if (titleEl) titleEl.textContent = '电视剧热播'
  if (!gridEl) return

  const items = section.items || []
  gridEl.innerHTML = ''

  items.forEach(item => {
    const card = createBangumiCard(item)
    gridEl.appendChild(card)
  })
}

function renderDocumentaryHot(section) {
  const titleEl = document.querySelector('#media-documentary .section-title')
  const gridEl = document.getElementById('documentary-grid')

  if (titleEl) titleEl.textContent = '纪录片热播'
  if (!gridEl) return

  const items = section.items || []
  gridEl.innerHTML = ''

  items.forEach(item => {
    const card = createBangumiCard(item)
    gridEl.appendChild(card)
  })
}

function renderVarietyHot(section) {
  const titleEl = document.querySelector('#media-variety .section-title')
  const gridEl = document.getElementById('variety-grid')

  if (titleEl) titleEl.textContent = '综艺热播'
  if (!gridEl) return

  const items = section.items || []
  gridEl.innerHTML = ''

  items.forEach(item => {
    const card = createBangumiCard(item)
    gridEl.appendChild(card)
  })
}

function renderMediaGuessSection(section) {
  const titleEl = document.querySelector('#media-guess .section-title')
  const waterfallEl = document.getElementById('media-guess-waterfall')

  if (titleEl) titleEl.textContent = '猜你喜欢'
  if (!waterfallEl) return

  const items = section.items || []

  items.forEach(item => {
    const card = createWaterfallCard(item)
    waterfallEl.appendChild(card)
  })
}

async function loadMoreMediaGuessItems() {
  const state = pageStates.media
  if (state.loading || !state.hasMore || !state.cursor) return

  state.loading = true
  const loadingEl = document.getElementById('media-loading-more')
  const noMoreEl = document.getElementById('media-no-more')

  if (loadingEl) loadingEl.style.display = 'block'
  if (noMoreEl) noMoreEl.style.display = 'none'

  try {
    const result = await ipcRenderer.invoke('fetch-media-data', { is_refresh: 1, cursor: state.cursor })

    if (result.success && result.data && result.data.data && result.data.data.modules) {
      const apiData = result.data.data
      const modules = apiData.modules || []

      const guessModule = modules[0]

      if (guessModule && guessModule.items && guessModule.items.length > 0) {
        const waterfallEl = document.getElementById('media-guess-waterfall')
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
    console.error('加载更多影视猜你喜欢失败:', error)
    state.hasMore = false
  }

  state.loading = false
  if (loadingEl) loadingEl.style.display = 'none'
  if (noMoreEl && !state.hasMore) noMoreEl.style.display = 'block'
}
