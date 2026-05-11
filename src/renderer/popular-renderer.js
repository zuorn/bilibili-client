const { ipcRenderer } = require('electron')

const homeBtn = document.getElementById('homeBtn')
const videoGrid = document.getElementById('videoGrid')
const pageTabs = document.querySelectorAll('.page-tab')
const rankingTabs = document.querySelectorAll('.ranking-tab')
const rankingTabsContainer = document.getElementById('rankingTabs')

let currentTab = 'comprehensive'
let currentRid = 0
let currentPage = 1
let isLoading = false
let hasMoreData = true

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
        // Already on popular page
      } else if (page === 'anime') {
        ipcRenderer.send('open-anime')
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
      // Already on popular page
    } else if (text === '追番') {
      ipcRenderer.send('open-anime')
    } else if (text === '影视') {
      ipcRenderer.send('open-media')
    }
  })
})

pageTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    pageTabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    currentTab = tab.dataset.tab
    if (currentTab === 'ranking') {
      rankingTabsContainer.style.display = 'flex'
      currentRid = 0
      rankingTabs.forEach(t => t.classList.remove('active'))
      rankingTabs[0].classList.add('active')
    } else {
      rankingTabsContainer.style.display = 'none'
    }
    currentPage = 1
    hasMoreData = true
    fetchPopularVideos(currentTab, currentPage, false)
  })
})

rankingTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    rankingTabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    currentRid = parseInt(tab.dataset.rid)
    currentPage = 1
    hasMoreData = true
    fetchPopularVideos('ranking', currentPage, false)
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

function formatPlayCount(count) {
  if (!count) return '0'
  if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿'
  if (count >= 10000) return (count / 10000).toFixed(1) + '万'
  return count.toString()
}

function formatDuration(duration) {
  if (!duration) return ''
  
  if (typeof duration === 'string') {
    if (duration.includes(':')) {
      return duration
    }
    if (duration.toLowerCase() === 'nan') {
      return ''
    }
    duration = parseInt(duration, 10)
  }
  
  if (isNaN(duration) || duration < 0) return ''
  
  const mins = Math.floor(duration / 60)
  const secs = duration % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = now - date
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days === 2) return '前天'
  if (days < 7) return days + '天前'
  if (days < 30) return Math.floor(days / 7) + '周前'
  if (days < 365) return Math.floor(days / 30) + '个月前'
  return Math.floor(days / 365) + '年前'
}

function createVideoCard(video) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = video.bvid

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="${video.pic}" alt="${video.title}" loading="lazy">
      <span class="video-duration">${video.duration}</span>
    </div>
    <div class="video-info">
      <h3 class="video-title">${video.title}</h3>
      <div class="video-meta">
        <span class="video-play">${video.play}播放</span>
        <span class="video-author">${video.author}</span>
      </div>
    </div>
  `

  card.addEventListener('click', () => {
    if (video.bvid) {
      const mpvPath = localStorage.getItem('mpvPath') || ''
      ipcRenderer.invoke('play-video', video.bvid, video.cid, video.title, mpvPath)
    }
  })

  return card
}

function renderVideos(videos, append = false) {
  if (!append) {
    videoGrid.innerHTML = ''
  }
  videos.forEach(video => {
    videoGrid.appendChild(createVideoCard(video))
  })
}

function extractVideoList(resultData) {
  let items = []
  console.log('extractVideoList called with:', resultData)
  
  if (resultData && resultData.code === 0) {
    if (resultData.data) {
      // 检查多种可能的数据结构
      if (resultData.data.list && Array.isArray(resultData.data.list)) {
        items = resultData.data.list
      } else if (Array.isArray(resultData.data)) {
        items = resultData.data
      } else if (resultData.data.item && Array.isArray(resultData.data.item)) {
        items = resultData.data.item
      } else if (resultData.data.media_list && Array.isArray(resultData.data.media_list)) {
        items = resultData.data.media_list
      } else if (resultData.data.list_series && Array.isArray(resultData.data.list_series) && resultData.data.list_series.length > 0) {
        items = resultData.data.list_series[0].list || []
      } else if (resultData.data.result && Array.isArray(resultData.data.result)) {
        items = resultData.data.result
      } else {
        console.log('No known data structure found in resultData.data:', Object.keys(resultData.data))
      }
    }
  }
  
  console.log('Extracted', items.length, 'items')
  return items
}

async function fetchPopularVideos(tab = 'comprehensive', page = 1, append = false) {
  if (isLoading) return
  isLoading = true

  console.log('fetchPopularVideos called via IPC, tab:', tab, 'page:', page, 'append:', append, 'currentRid:', currentRid)

  try {
    const result = await ipcRenderer.invoke('fetch-popular-videos', tab, page, currentRid)
    console.log('fetchPopularVideos result:', result.success, result.error || '')
    
    let items = []
    if (result.success && result.data) {
      const data = result.data
      if (data && data.code === 0) {
        items = extractVideoList(data)
      }
      console.log('Number of items:', items.length)
      if (items.length > 0) {
        console.log('First item:', JSON.stringify(items[0], null, 2))
      }
    }

    if (items.length > 0) {
      hasMoreData = items.length >= 30

      const newVideos = items.map(item => ({
        bvid: item.bvid || '',
        title: item.title || '无标题',
        pic: fixImageUrl(item.pic || ''),
        play: formatPlayCount(item.stat?.view || item.play || item.view || 0),
        duration: formatDuration(item.duration || item.length || 0),
        author: item.owner?.name || item.author || item.uname || '未知UP主',
        pubdate: formatDate(item.pubdate || item.ctime || 0),
        cid: item.cid || '',
        owner: item.owner?.mid ? item.owner : { mid: item.mid, name: item.author || item.uname || '未知UP主' }
      })).filter(v => v.bvid || v.title)

      console.log('New videos ready:', newVideos.length)

      if (newVideos.length > 0) {
        renderVideos(newVideos, append)
      }
    } else {
      if (!append) {
        videoGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无视频</div>'
      }
    }
  } catch (error) {
    console.error('获取热门视频失败:', error)
    if (!append) {
      videoGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">获取视频失败</div>'
    }
  }

  isLoading = false
}

fetchPopularVideos('comprehensive', 1)

const content = document.querySelector('.content')

content?.addEventListener('scroll', () => {
  const scrollHeight = content.scrollHeight
  const scrollTop = content.scrollTop
  const clientHeight = content.clientHeight
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10

  if (isAtBottom && !isLoading && hasMoreData) {
    currentPage++
    fetchPopularVideos(currentTab, currentPage, true)
  }
})

const minBtn = document.getElementById('minBtn')
const maxBtn = document.getElementById('maxBtn')
const closeBtn = document.getElementById('closeBtn')
const refreshBtn = document.getElementById('refreshBtn')
const backTopBtn = document.getElementById('backTopBtn')

minBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('minimize-window')
})

maxBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('maximize-window')
})

closeBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('close-window')
})

refreshBtn?.addEventListener('click', () => {
  currentPage = 1
  hasMoreData = true
  fetchPopularVideos(currentTab, currentPage, false)
  // 刷新后滚动到顶部
  const content = document.querySelector('.content') || document.documentElement
  content.scrollTo({ top: 0, behavior: 'smooth' })
})

backTopBtn?.addEventListener('click', () => {
  const content = document.querySelector('.content')
  if (content) {
    content.scrollTo({ top: 0, behavior: 'smooth' })
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
})