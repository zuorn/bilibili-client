const { ipcRenderer } = require('electron')

const upAvatar = document.getElementById('upAvatar')
const upName = document.getElementById('upName')
const upSign = document.getElementById('upSign')
const followingCount = document.getElementById('followingCount')
const fanCount = document.getElementById('fanCount')
const viewCount = document.getElementById('viewCount')
const upVideoGrid = document.getElementById('upVideoGrid')
const content = document.querySelector('.up-profile-container') || document.body

let currentMid = null
let currentUpVideos = []
let currentUpPage = 1
let isUpLoading = false
let hasMoreUpVideos = true
let loadingMoreEl = null

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search)
  return params.get(name)
}

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
  if (!duration) return '00:00'
  
  if (typeof duration === 'string') {
    if (duration.includes(':')) {
      return duration
    }
    if (duration.toLowerCase() === 'nan') {
      return '00:00'
    }
    duration = parseInt(duration, 10)
  }
  
  if (isNaN(duration) || duration < 0) return '00:00'
  
  const m = Math.floor(duration / 60)
  const s = duration % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = (now - date) / 1000

  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前'
  if (diff < 604800) return Math.floor(diff / 86400) + '天前'

  return `${date.getMonth() + 1}-${date.getDate()}`
}

async function fetchUpInfo(mid) {
  try {
    const result = await ipcRenderer.invoke('fetch-up-info', mid)
    console.log('fetchUpInfo result:', result)

    if (result.success && result.data?.data?.card) {
      const card = result.data.data.card
      console.log('UP card data:', card)

      if (upAvatar) {
        upAvatar.src = fixImageUrl(card.face) || 'https://i0.hdslb.com/bfs/archive/placeholder.png'
        upAvatar.onerror = function() {
          this.src = 'https://i0.hdslb.com/bfs/archive/placeholder.png'
        }
      }
      if (upName) {
        upName.textContent = card.uname || '未知'
        console.log('Set upName to:', card.uname)
      } else {
        console.error('upName element not found')
      }
      if (upSign) upSign.textContent = card.sign || '这个人很懒，什么都没有写'
      if (followingCount) followingCount.textContent = formatPlayCount(card.friend || 0)
      if (fanCount) fanCount.textContent = formatPlayCount(card.fans || 0)
      if (viewCount) viewCount.textContent = formatPlayCount(card.likes || 0)
    } else {
      console.error('fetchUpInfo failed - result:', result)
      if (upName) upName.textContent = '未知UP主'
      if (upSign) upSign.textContent = '获取信息失败'
    }
  } catch (error) {
    console.error('获取UP主信息失败:', error)
    if (upName) upName.textContent = '未知UP主'
    if (upSign) upSign.textContent = '获取信息失败'
  }
}

async function fetchUpVideos(mid, offset = '', append = false) {
  if (isUpLoading) return
  isUpLoading = true

  if (append) {
    showLoadingMore()
  }

  try {
    const result = await ipcRenderer.invoke('fetch-up-videos', mid, offset)

    console.log('fetchUpVideos result:', result)

    if (result.success && result.data?.data) {
      const items = result.data.data.items || []

      console.log('Items received:', items.length)

      if (items.length > 0) {
        const newVideos = items.map(item => {
          const modules = item.modules || {}
          const dynamicModule = modules.module_dynamic || {}
          const majorModule = dynamicModule.major || {}

          let bvid = ''
          let title = ''
          let pic = ''
          let duration = ''
          let play = 0

          if (majorModule.archive) {
            bvid = majorModule.archive.bvid || ''
            title = majorModule.archive.title || ''
            pic = majorModule.archive.cover || ''
            duration = majorModule.archive.duration_text || ''

            const stat = majorModule.archive.stat || {}
            play = stat.view || 0
          }

          return {
            bvid: bvid,
            title: title,
            pic: fixImageUrl(pic),
            play: formatPlayCount(play),
            duration: duration,
            author: item.author?.name || '未知',
            pubdate: formatDate(item.pub_ts || 0),
            mid: mid
          }
        }).filter(v => v.bvid)

        console.log('New videos parsed:', newVideos.length)

        if (append) {
          currentUpVideos = [...currentUpVideos, ...newVideos]
          appendUpVideos(newVideos)
        } else {
          currentUpVideos = newVideos
          renderUpVideos(currentUpVideos)
        }

        hasMoreUpVideos = result.data.data.has_more || false
        currentUpPage = result.data.data.next_offset || ''

        if (!hasMoreUpVideos) {
          if (!append && currentUpVideos.length > 0) {
            const endDiv = document.createElement('div')
            endDiv.textContent = '— 到底了 —'
            endDiv.style.cssText = 'text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;'
            upVideoGrid.appendChild(endDiv)
          }
        }
      } else {
        hasMoreUpVideos = false
        if (!append) {
          upVideoGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">暂无视频</div>'
        }
      }
    } else {
      console.error('fetchUpVideos failed:', result)
      if (!append) {
        upVideoGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">获取视频失败</div>'
      }
    }
  } catch (error) {
    console.error('获取UP主视频失败:', error)
    if (!append) {
      upVideoGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">获取视频失败</div>'
    }
  } finally {
    isUpLoading = false
    hideLoadingMore()
  }
}

function renderUpVideos(videos) {
  upVideoGrid.innerHTML = ''
  videos.forEach(video => {
    const card = createUpVideoCard(video)
    upVideoGrid.appendChild(card)
  })

  if (!hasMoreUpVideos && videos.length > 0) {
    const endDiv = document.createElement('div')
    endDiv.textContent = '— 到底了 —'
    endDiv.style.cssText = 'text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;'
    upVideoGrid.appendChild(endDiv)
  }
}

function createUpVideoCard(video) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.innerHTML = `
    <div class="video-thumbnail" data-bvid="${video.bvid}" data-title="${video.title}">
      <img src="${video.pic}" alt="${video.title}" onerror="this.src='https://i0.hdslb.com/bfs/archive/placeholder.png'">
      <div class="video-duration">${video.duration}</div>
    </div>
    <div class="video-info">
      <h3 class="video-title">${video.title}</h3>
      <div class="video-meta">
        <span class="video-play">${video.play}播放</span>
        <span class="video-date">${video.pubdate}</span>
      </div>
    </div>
  `

  const thumbnail = card.querySelector('.video-thumbnail')
  const title = card.querySelector('.video-title')

  thumbnail.addEventListener('click', () => playVideo(video.bvid, video.title))
  title.addEventListener('click', () => playVideo(video.bvid, video.title))

  const img = card.querySelector('.video-thumbnail img')
  img.onload = function() {
    this.classList.add('loaded')
  }
  if (img.complete) {
    img.classList.add('loaded')
  }

  return card
}

function appendUpVideos(videos) {
  videos.forEach(video => {
    const card = createUpVideoCard(video)
    upVideoGrid.appendChild(card)
  })

  if (!hasMoreUpVideos && videos.length > 0) {
    const endDiv = document.createElement('div')
    endDiv.textContent = '— 到底了 —'
    endDiv.style.cssText = 'text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;'
    upVideoGrid.appendChild(endDiv)
  }
}

function showLoadingMore() {
  if (!loadingMoreEl) {
    loadingMoreEl = document.createElement('div')
    loadingMoreEl.className = 'loading-more'
    loadingMoreEl.innerHTML = '<span>加载中...</span>'
    loadingMoreEl.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 20px; color: #9499a0;'
  }
  upVideoGrid.appendChild(loadingMoreEl)
}

function hideLoadingMore() {
  if (loadingMoreEl && loadingMoreEl.parentNode) {
    loadingMoreEl.parentNode.removeChild(loadingMoreEl)
  }
}

function getMpvPath() {
  return localStorage.getItem('mpvPath') || ''
}

function playVideo(bvid, title) {
  console.log('Playing:', bvid, title)
  const mpvPath = getMpvPath()
  try {
    ipcRenderer.invoke('play-video', bvid, '', title, mpvPath)
  } catch (error) {
    console.error('播放失败:', error)
    alert('播放失败')
  }
}

function handleUpScroll() {
  if (isUpLoading || !hasMoreUpVideos) return

  const scrollTop = content.scrollTop || window.scrollY
  const scrollHeight = (content.scrollHeight || document.body.scrollHeight) - (content.clientHeight || window.innerHeight)

  if (scrollHeight - scrollTop < 300) {
    fetchUpVideos(currentMid, currentUpPage, true)
  }
}

content?.addEventListener('scroll', handleUpScroll)
window?.addEventListener('scroll', handleUpScroll)

window.addEventListener('up-profile-loaded', (event) => {
  currentMid = event.mid
  if (currentMid) {
    currentUpPage = ''
    fetchUpInfo(currentMid)
    fetchUpVideos(currentMid, '', false)
  }
})

ipcRenderer.on('up-profile-mid', (event, mid) => {
  currentMid = mid
  if (currentMid) {
    currentUpPage = ''
    fetchUpInfo(currentMid)
    fetchUpVideos(currentMid, '', false)
  }
})

currentMid = getQueryParam('mid')
if (currentMid) {
  currentUpPage = ''
  fetchUpInfo(currentMid)
  fetchUpVideos(currentMid, '', false)
}

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