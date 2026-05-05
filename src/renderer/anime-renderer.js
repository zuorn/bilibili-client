const { ipcRenderer } = require('electron')

const homeBtn = document.getElementById('homeBtn')
const animeGrid = document.getElementById('animeGrid')

let currentPage = 1
let isLoading = false
let hasMoreData = true
let allAnime = []

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

function fixImageUrl(url) {
  if (!url) return 'https://i0.hdslb.com/bfs/archive/placeholder.png'
  if (url.startsWith('//')) return 'https:' + url
  if (url.includes('hdslb.com') && !url.includes('@')) {
    return url + '@320w_200h.webp'
  }
  return url
}

function extractAnimeList(resultData) {
  let items = []
  console.log('extractAnimeList called with:', resultData)
  
  if (resultData && resultData.code === 0) {
    if (resultData.data) {
      if (resultData.data.list && Array.isArray(resultData.data.list)) {
        items = resultData.data.list
      } else if (Array.isArray(resultData.data)) {
        items = resultData.data
      } else if (resultData.data.result && Array.isArray(resultData.data.result)) {
        items = resultData.data.result
      } else {
        console.log('No known data structure found in resultData.data:', Object.keys(resultData.data))
      }
    }
  }
  
  console.log('Extracted', items.length, 'anime items')
  return items
}

function createAnimeCard(anime) {
  const card = document.createElement('div')
  card.className = 'video-card'

  console.log('Creating anime card with:', anime)

  const title = anime.title || anime.season_title || anime.new_ep?.index_show || ''
  const cover = anime.cover || anime.horizontal_pic || ''

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="${fixImageUrl(cover)}" alt="${title}" loading="lazy">
      <span class="video-duration">${anime.evaluate || (anime.score ? anime.score + '分' : '番剧')}</span>
    </div>
    <div class="video-info">
      <h3 class="video-title">${title}</h3>
      <div class="video-meta">
        <span class="video-play">${anime.pub_info || anime.follow || anime.order || ''}</span>
        <span class="video-author">${anime.evaluate || (anime.areas?.[0]?.name) || '暂无简介'}</span>
      </div>
    </div>
  `

  card.addEventListener('click', () => {
    const seasonId = anime.season_id || anime.ss_id || anime.media_id
    if (seasonId) {
      ipcRenderer.invoke('open-anime-detail', seasonId)
    }
  })

  return card
}

function renderAnime(animes, append = false) {
  if (!append) {
    animeGrid.innerHTML = ''
  }
  animes.forEach(anime => {
    animeGrid.appendChild(createAnimeCard(anime))
  })

  if (!hasMoreData) {
    const endDiv = document.createElement('div')
    endDiv.textContent = '— 到底了 —'
    endDiv.style.cssText = 'text-align: center; padding: 20px; color: #999; grid-column: 1 / -1; width: 100%;'
    animeGrid.appendChild(endDiv)
  }
}

async function fetchAnime(page = 1, append = false) {
  if (isLoading) return
  isLoading = true

  console.log('fetchAnime called, page:', page, 'append:', append)

  try {
    const result = await ipcRenderer.invoke('fetch-anime', page)
    console.log('fetchAnime result:', result)
    
    let items = []

    if (result.success && result.data) {
      items = extractAnimeList(result.data)
    }

    console.log('Items to render:', items.length)

    if (items.length > 0) {
      hasMoreData = items.length >= 30

      if (append) {
        allAnime = [...allAnime, ...items]
      } else {
        allAnime = items
      }

      renderAnime(items, append)
    } else {
      hasMoreData = false
      if (!append) {
        animeGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无番剧</div>'
      }
    }
  } catch (error) {
    console.error('获取番剧失败:', error)
    if (!append) {
      animeGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">获取番剧失败</div>'
    }
  }

  isLoading = false
}

fetchAnime(1)

const content = document.querySelector('.content')

content?.addEventListener('scroll', () => {
  const scrollHeight = content.scrollHeight
  const scrollTop = content.scrollTop
  const clientHeight = content.clientHeight
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10

  if (isAtBottom && !isLoading && hasMoreData) {
    currentPage++
    fetchAnime(currentPage, true)
  }
})

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