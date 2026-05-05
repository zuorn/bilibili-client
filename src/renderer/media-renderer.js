const { ipcRenderer } = require('electron')

const homeBtn = document.getElementById('homeBtn')
const mediaGrid = document.getElementById('mediaGrid')
const pageTabs = document.querySelectorAll('.page-tab')

let currentSeasonType = 2
let currentPage = 1
let isLoading = false
let hasMoreData = true
let allMedia = []

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
        ipcRenderer.send('open-anime')
      } else if (page === 'media') {
        // Already on media page
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
      ipcRenderer.send('open-anime')
    } else if (text === '影视') {
      // Already on media page
    }
  })
})

// 标签切换事件
pageTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    pageTabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    currentSeasonType = parseInt(tab.dataset.seasonType)
    currentPage = 1
    allMedia = []
    hasMoreData = true
    fetchMedia(currentSeasonType, currentPage, false)
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

function extractMediaList(resultData) {
  let items = []
  console.log('extractMediaList called with:', resultData)
  
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
  
  console.log('Extracted', items.length, 'media items')
  return items
}

function createMediaCard(media) {
  const card = document.createElement('div')
  card.className = 'video-card'
  
  console.log('Creating media card with:', media)
  
  // 解析不同格式的数据
  const title = media.title || media.season_title || media.new_ep?.index_show || ''
  const cover = media.cover || media.horizontal_pic || ''
  const score = media.score || ''
  const indexShow = media.index_show || media.new_ep?.index_show || ''
  
  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="${fixImageUrl(cover)}" alt="${title}" loading="lazy">
      <span class="video-duration">${score || indexShow || '影视'}</span>
    </div>
    <div class="video-info">
      <h3 class="video-title">${title}</h3>
      <div class="video-meta">
        <span class="video-play">${score ? score + '分' : (media.order || '')}</span>
        <span class="video-author">${media.areas?.[0]?.name || media.area || ''}</span>
      </div>
    </div>
  `

  card.addEventListener('click', () => {
    const seasonId = media.season_id || media.ss_id || media.media_id
    if (seasonId) {
      ipcRenderer.invoke('open-media-detail', seasonId)
    }
  })

  return card
}

function renderMedia(mediaList, append = false) {
  if (!append) {
    mediaGrid.innerHTML = ''
  }
  mediaList.forEach(media => {
    mediaGrid.appendChild(createMediaCard(media))
  })
}

async function fetchMedia(seasonType = 2, page = 1, append = false) {
  if (isLoading) return
  isLoading = true

  console.log('fetchMedia called, seasonType:', seasonType, 'page:', page, 'append:', append)

  try {
    const result = await ipcRenderer.invoke('fetch-media', seasonType, page)
    console.log('fetchMedia result:', result)
    
    let items = []

    if (result.success && result.data) {
      items = extractMediaList(result.data)
    }

    console.log('Items to render:', items.length)

    if (items.length > 0) {
      hasMoreData = items.length >= 30

      if (append) {
        allMedia = [...allMedia, ...items]
      } else {
        allMedia = items
      }

      renderMedia(items, append)
    } else {
      if (!append) {
        mediaGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无影视</div>'
      }
    }
  } catch (error) {
    console.error('获取影视失败:', error)
    if (!append) {
      mediaGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">获取影视失败</div>'
    }
  }

  isLoading = false
}

fetchMedia(2, 1, false)

const content = document.querySelector('.content')

content?.addEventListener('scroll', () => {
  const scrollHeight = content.scrollHeight
  const scrollTop = content.scrollTop
  const clientHeight = content.clientHeight
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10

  if (isAtBottom && !isLoading && hasMoreData) {
    currentPage++
    fetchMedia(currentSeasonType, currentPage, true)
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