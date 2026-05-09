const { ipcRenderer } = require('electron')

let bangumiTabData = null
let guessLikeCursor = 0
let guessLikeItems = []
let isLoadingMoreGuessLike = false
let hasMoreGuessLike = true

const homeBtn = document.getElementById('homeBtn')

homeBtn.addEventListener('click', () => {
  ipcRenderer.send('go-home')
})

document.querySelectorAll('.sidebar-item').forEach(item => {
  item.addEventListener('click', (e) => {
    const page = item.dataset.page
    if (page) {
      if (page === 'home') {
        ipcRenderer.send('go-home')
      } else if (page === 'popular') {
        ipcRenderer.send('open-popular')
      } else if (page === 'anime') {
      } else if (page === 'media') {
        ipcRenderer.send('open-media')
      }
    }
  })
})

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault()
    const text = link.textContent.trim()
    if (text === '推荐') {
      ipcRenderer.send('go-home')
    } else if (text === '热门') {
      ipcRenderer.send('open-popular')
    } else if (text === '追番') {
    } else if (text === '影视') {
      ipcRenderer.send('open-media')
    }
  })
})

function fixImageUrl(url) {
  if (!url) return 'https://i0.hdslb.com/bfs/archive/placeholder.png'
  if (url.startsWith('//')) return 'https:' + url
  if (url.includes('hdslb.com') && !url.includes('@')) {
    return url + '@320w_200h.webp'
  }
  return url
}

async function loadAnimePage() {
  try {
    guessLikeCursor = 0
    guessLikeItems = []
    hasMoreGuessLike = true

    const result = await ipcRenderer.invoke('fetch-bangumi-tab', 0, 1)
    if (!result.success) {
      console.error('获取追番数据失败:', result.error)
      return
    }

    bangumiTabData = result.data

    const data = bangumiTabData.data || bangumiTabData
    const modules = data.modules || []

    const followingModule = modules.find(m => m.title && (m.title.includes('追') || m.title.includes('我的追番')))
    const bangumiRecommendModule = modules.find(m => m.title && m.title.includes('番剧推荐'))
    const guochuangRecommendModule = modules.find(m => m.title && m.title.includes('国创推荐'))
    const guessLikeModule = modules.find(m => m.title && m.title.includes('猜你喜欢'))

    if (followingModule) {
      renderFollowingCarousel(followingModule.items || [])
    } else {
      renderFollowingCarousel([])
    }

    if (bangumiRecommendModule) {
      renderAnimeGrid(bangumiRecommendModule.items || [], 'bangumiGrid')
    } else {
      renderAnimeGrid([], 'bangumiGrid')
    }

    if (guochuangRecommendModule) {
      renderAnimeGrid(guochuangRecommendModule.items || [], 'guochuangGrid')
    } else {
      renderAnimeGrid([], 'guochuangGrid')
    }

    if (guessLikeModule) {
      guessLikeItems = guessLikeModule.items || []
      guessLikeCursor = data.cursor || 0
      hasMoreGuessLike = data.has_more !== false
      renderGuessLikeGrid(guessLikeItems)
    } else {
      guessLikeItems = []
      renderGuessLikeGrid([])
    }

    const refreshBtn = document.getElementById('refreshLike')
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        refreshBtn.classList.add('refreshing')
        guessLikeCursor = 0
        guessLikeItems = []
        const refreshResult = await ipcRenderer.invoke('fetch-bangumi-tab', 0, 1)
        if (refreshResult.success) {
          const refreshData = refreshResult.data.data || refreshResult.data
          const refreshModules = refreshData.modules || []
          const refreshGuessLikeModule = refreshModules.find(m => m.title && m.title.includes('猜你喜欢'))
          if (refreshGuessLikeModule) {
            guessLikeItems = refreshGuessLikeModule.items || []
            guessLikeCursor = refreshData.cursor || 0
            hasMoreGuessLike = refreshData.has_more !== false
          } else {
            guessLikeItems = []
          }
          renderGuessLikeGrid(guessLikeItems)
        }
        setTimeout(() => refreshBtn.classList.remove('refreshing'), 500)
      }
    }

    setupGuessLikeScrollListener()

  } catch (error) {
    console.error('加载追番页面失败:', error)
  }
}

function setupGuessLikeScrollListener() {
  const guessYouLikeSection = document.getElementById('guessYouLikeSection')
  if (!guessYouLikeSection) return

  const observer = new IntersectionObserver(async (entries) => {
    const entry = entries[0]
    if (entry.isIntersecting && !isLoadingMoreGuessLike && hasMoreGuessLike) {
      await loadMoreGuessLike()
    }
  }, { threshold: 0.1 })

  observer.observe(guessYouLikeSection)
}

async function loadMoreGuessLike() {
  if (isLoadingMoreGuessLike || !hasMoreGuessLike) return

  isLoadingMoreGuessLike = true
  console.log('Loading more guess like, cursor:', guessLikeCursor)

  try {
    const result = await ipcRenderer.invoke('fetch-bangumi-tab', guessLikeCursor, 0)
    if (result.success) {
      const data = result.data.data || result.data
      const newItems = data.items || []
      if (newItems.length > 0) {
        guessLikeItems = [...guessLikeItems, ...newItems]
        guessLikeCursor = data.cursor || guessLikeCursor + newItems.length
        hasMoreGuessLike = data.has_more !== false
        renderGuessLikeGrid(guessLikeItems)
      } else {
        hasMoreGuessLike = false
      }
    }
  } catch (error) {
    console.error('加载更多猜你喜欢失败:', error)
  } finally {
    isLoadingMoreGuessLike = false
  }
}

function renderFollowingCarousel(list) {
  const container = document.getElementById('followingCarousel')
  if (!container) return

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-carousel">
        <p>暂无追番内容</p>
        <p class="empty-hint">快去追番吧~</p>
      </div>
    `
    return
  }

  container.innerHTML = ''
  const scrollContainer = document.createElement('div')
  scrollContainer.className = 'carousel-scroll'

  list.forEach(anime => {
    const card = document.createElement('div')
    card.className = 'following-card'
    const title = anime.title || anime.season_title || ''
    const cover = anime.cover || ''
    const progress = anime.progress || ''
    const total = anime.total_count || anime.new_ep?.index_show || ''
    const badge = anime.is_finish ? '完结' : '连载'

    card.innerHTML = `
      <div class="following-cover">
        <img src="${fixImageUrl(cover)}" alt="${title}" loading="lazy">
        ${badge ? `<span class="badge ${badge === '完结' ? 'badge-new' : 'badge-update'}">${badge}</span>` : ''}
        <div class="cover-mask"></div>
      </div>
      <div class="following-info">
        <h4 class="following-title">${title}</h4>
        <p class="following-progress">${progress ? `看到第${progress}话` : '尚未观看'}</p>
        <span class="following-total">${total}</span>
      </div>
    `
    card.addEventListener('click', () => {
      const seasonId = anime.season_id || anime.ss_id || anime.media_id
      if (seasonId) {
        ipcRenderer.invoke('open-anime-detail', seasonId)
      }
    })
    scrollContainer.appendChild(card)
  })

  container.appendChild(scrollContainer)
}

function renderAnimeGrid(list, containerId) {
  const container = document.getElementById(containerId)
  if (!container) return

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-grid">暂无内容</div>`
    return
  }

  container.innerHTML = ''
  list.forEach(anime => {
    const card = document.createElement('div')
    card.className = 'anime-card'
    const title = anime.title || anime.season_title || ''
    const cover = anime.cover || anime.horizontal_pic || ''
    const score = anime.score || ''
    const episode = anime.new_ep?.index_show || anime.pub_info || ''
    const badge = anime.is_finish ? '完结' : '连载'

    card.innerHTML = `
      <div class="anime-cover">
        <img src="${fixImageUrl(cover)}" alt="${title}" loading="lazy">
        <span class="anime-badge">${badge}</span>
        ${score ? `<span class="anime-score">${score}</span>` : ''}
      </div>
      <div class="anime-info">
        <h4 class="anime-title">${title}</h4>
        <p class="anime-episode">${episode}</p>
      </div>
    `
    card.addEventListener('click', () => {
      const seasonId = anime.season_id || anime.ss_id || anime.media_id
      if (seasonId) {
        ipcRenderer.invoke('open-anime-detail', seasonId)
      }
    })
    container.appendChild(card)
  })
}

function renderGuessLikeGrid(list) {
  const container = document.getElementById('likeGrid')
  if (!container) return

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-grid">暂无内容</div>`
    return
  }

  container.innerHTML = ''
  container.className = 'anime-waterfall-grid'

  list.forEach(anime => {
    const card = document.createElement('div')
    card.className = 'anime-card waterfall-item'
    const title = anime.title || anime.season_title || ''
    const cover = anime.cover || anime.horizontal_pic || ''
    const score = anime.score || ''
    const episode = anime.new_ep?.index_show || anime.pub_info || ''
    const badge = anime.is_finish ? '完结' : '连载'

    card.innerHTML = `
      <div class="anime-cover">
        <img src="${fixImageUrl(cover)}" alt="${title}" loading="lazy">
        <span class="anime-badge">${badge}</span>
        ${score ? `<span class="anime-score">${score}</span>` : ''}
      </div>
      <div class="anime-info">
        <h4 class="anime-title">${title}</h4>
        <p class="anime-episode">${episode}</p>
      </div>
    `
    card.addEventListener('click', () => {
      const seasonId = anime.season_id || anime.ss_id || anime.media_id
      if (seasonId) {
        ipcRenderer.invoke('open-anime-detail', seasonId)
      }
    })
    container.appendChild(card)
  })

  if (isLoadingMoreGuessLike) {
    const loadingMore = document.createElement('div')
    loadingMore.className = 'loading-more'
    loadingMore.id = 'guessLikeLoadingMore'
    loadingMore.innerHTML = '<span>加载更多...</span>'
    container.appendChild(loadingMore)
  } else if (!hasMoreGuessLike && list.length > 0) {
    const noMore = document.createElement('div')
    noMore.className = 'no-more'
    noMore.innerHTML = '<span>没有更多内容了</span>'
    container.appendChild(noMore)
  }
}

loadAnimePage()

const minBtn = document.getElementById('minBtn')
const maxBtn = document.getElementById('maxBtn')
const closeBtn = document.getElementById('closeBtn')

minBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('minimize-window')
})

maxBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('maximize-window')
})

closeBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('close-window')
})