const { ipcRenderer } = require('electron')

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
        // Already on anime page
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
      // Already on anime page
    } else if (text === '影视') {
      ipcRenderer.send('open-media')
    }
  })
})

const viewAllFollowing = document.getElementById('viewAllFollowing')
if (viewAllFollowing) {
  viewAllFollowing.addEventListener('click', (e) => {
    e.preventDefault()
    ipcRenderer.send('open-my', 'bangumi')
  })
}

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
    const [followingResult, bangumiResult, guochuangResult, likeResult] = await Promise.all([
      ipcRenderer.invoke('fetch-following-anime'),
      ipcRenderer.invoke('fetch-anime-recommend', 1),
      ipcRenderer.invoke('fetch-anime-recommend', 4),
      ipcRenderer.invoke('fetch-guess-like')
    ])

    renderFollowingCarousel(followingResult)
    renderAnimeGrid(bangumiResult, 'bangumiGrid')
    renderAnimeGrid(guochuangResult, 'guochuangGrid')
    renderAnimeGrid(likeResult, 'likeGrid')
  } catch (error) {
    console.error('加载追番页面失败:', error)
  }
}

function renderFollowingCarousel(result) {
  const container = document.getElementById('followingCarousel')
  if (!container) return

  let list = []
  if (result && result.success && result.data && result.data.code === 0) {
    if (result.data.data && result.data.data.modules && Array.isArray(result.data.data.modules)) {
      const followingModule = result.data.data.modules.find(mod => mod.title && mod.title.includes('追'))
      if (followingModule && followingModule.items && Array.isArray(followingModule.items)) {
        list = followingModule.items
      }
    } else if (result.data.data && result.data.data.list && Array.isArray(result.data.data.list)) {
      list = result.data.data.list
    } else if (result.data.list && Array.isArray(result.data.list)) {
      list = result.data.list
    } else if (result.data.result && Array.isArray(result.data.result)) {
      list = result.data.result
    }
  }

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

function renderAnimeGrid(result, containerId) {
  const container = document.getElementById(containerId)
  if (!container) return

  let list = []
  if (result && result.success && result.data && result.data.code === 0) {
    if (result.data.data && result.data.data.list && Array.isArray(result.data.data.list)) {
      list = result.data.data.list.slice(0, 7)
    } else if (result.data.list && Array.isArray(result.data.list)) {
      list = result.data.list.slice(0, 7)
    } else if (result.data.result && Array.isArray(result.data.result)) {
      list = result.data.result.slice(0, 7)
    } else if (result.data.data && Array.isArray(result.data.data)) {
      list = result.data.data.slice(0, 7)
    }
  }

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