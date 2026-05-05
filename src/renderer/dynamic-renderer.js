const { ipcRenderer } = require('electron')

const homeBtn = document.getElementById('homeBtn')
const followingList = document.getElementById('followingList')
const videoContainer = document.getElementById('videoContainer')
const dynamicTitle = document.getElementById('dynamicTitle')
const allDynamicBtn = document.getElementById('allDynamicBtn')
const loadingMore = document.getElementById('loadingMore')
const noMore = document.getElementById('noMore')

let currentUpId = null
let currentOffset = ''
let nextOffset = ''
let dynamicHasMore = true
let isDynamicLoading = false

function fixImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('//')) {
    return 'https:' + url
  }
  return url
}

function formatDynamicTime(timestamp) {
  if (!timestamp) return ''
  const now = Date.now()
  const diff = now - timestamp * 1000
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (minutes < 60) {
    return minutes + '分钟前'
  } else if (hours < 24) {
    return hours + '小时前'
  } else if (days < 30) {
    return days + '天前'
  } else if (months < 12) {
    return months + '个月前'
  } else {
    return years + '年前'
  }
}

async function fetchFollowings() {
  try {
    const result = await ipcRenderer.invoke('get-dynamic-portal')
    
    if (result.success && result.data) {
      const portalData = result.data
      let followings = []
      
      if (portalData.up_list && Array.isArray(portalData.up_list)) {
        followings = portalData.up_list.map(item => ({
          mid: item.mid || '',
          uname: item.uname || item.name || '',
          face: item.face || '',
          official_verify: item.official_verify || null,
          vip: item.vip || null,
          has_update: item.has_update || false
        }))
      }
      
      return followings
    }
  } catch (error) {
    console.error('fetchFollowings error:', error)
  }
  return []
}

async function renderFollowingList() {
  try {
    const followings = await fetchFollowings()
    followingList.innerHTML = ''
    
    if (followings.length === 0) {
      followingList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无数据</div>'
      return
    }
    
    followings.forEach(up => {
      const item = document.createElement('div')
      item.className = 'following-item' + (currentUpId === up.mid ? ' active' : '')
      item.dataset.upId = up.mid

      let officialBadge = ''
      if (up.official_verify) {
        const verifyType = up.official_verify.type === 0 ? 'official' : 'official-personal'
        officialBadge = `<span class="official-badge ${verifyType}">${up.official_verify.desc || '官方'}</span>`
      }

      let vipBadge = ''
      if (up.vip && up.vip.vipType === 2) {
        vipBadge = '<span class="vip-badge">大会员</span>'
      }
      
      let updateDot = ''
      if (up.has_update) {
        updateDot = '<span class="update-dot"></span>'
      }

      item.innerHTML = `
        ${updateDot}
        <div class="following-avatar">
          <div class="avatar-wrap">
            <img src="${fixImageUrl(up.face)}" alt="${up.uname}">
          </div>
        </div>
        <div class="following-info">
          <div class="following-name">${up.uname}${officialBadge}${vipBadge}</div>
        </div>
      `

      item.addEventListener('click', () => selectDynamicUp(up.mid, up.uname))
      followingList.appendChild(item)
    })

    const followingCount = document.querySelector('.following-count')
    if (followingCount) {
      followingCount.textContent = followings.length
    }
  } catch (error) {
    console.error('加载关注列表失败:', error)
    followingList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">加载失败</div>'
  }
}

function createDynamicVideoCard(dynamic) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = dynamic.bvid || ''

  const thumbnail = dynamic.thumbnail || dynamic.pic || ''
  const title = dynamic.title || dynamic.desc || '暂无标题'
  const author = dynamic.authorName || dynamic.author || '未知'
  const duration = dynamic.duration || ''
  const pubTime = dynamic.pub_time || ''

  let thumbnailHtml = ''
  if (thumbnail) {
    thumbnailHtml = `<div class="video-thumbnail"><img src="${fixImageUrl(thumbnail)}" alt="${title}" loading="lazy">${duration ? '<span class="video-duration">' + duration + '</span>' : ''}</div>`
  }

  card.innerHTML = thumbnailHtml + `<div class="video-info"><h3 class="video-title">${title}</h3><div class="video-meta"><span class="video-author">${author}</span><span class="video-date">${pubTime}</span></div></div>`

  if (dynamic.bvid) {
    card.addEventListener('click', () => {
      const mpvPath = localStorage.getItem('mpvPath') || ''
      ipcRenderer.invoke('play-video', dynamic.bvid, '', title, mpvPath)
    })
  }

  return card
}

function renderDynamicVideos(dynamics) {
  console.log('renderDynamicVideos called with', dynamics.length, 'dynamics')
  console.log('videoContainer:', videoContainer)
  console.log('videoContainer children before:', videoContainer.children.length)

  dynamics.forEach((dynamic, index) => {
    console.log('Creating card', index, ':', { bvid: dynamic.bvid, title: dynamic.title, thumbnail: dynamic.thumbnail ? 'exists' : 'missing' })
    const card = createDynamicVideoCard(dynamic)
    videoContainer.appendChild(card)
    console.log('Card', index, 'added, total children:', videoContainer.children.length)
  })

  console.log('videoContainer children after:', videoContainer.children.length)
}

async function loadDynamicVideos(upId = null, offset = '') {
  if (isDynamicLoading) return

  isDynamicLoading = true
  loadingMore.style.display = 'block'
  noMore.style.display = 'none'

  console.log('Loading dynamic videos, upId:', upId, 'offset:', offset || '(first page)')

  try {
    const result = await ipcRenderer.invoke('get-user-dynamics', upId, offset)
    console.log('Fetch dynamics result:', result)
    if (result.success && result.data) {
      console.log('Number of items:', result.data.items.length)
      if (result.data.items.length > 0) {
        console.log('First item:', JSON.stringify(result.data.items[0], null, 2))
      }

      if (result.data.items.length > 0) {
        console.log('Rendering', result.data.items.length, 'items')
        if (offset === '') {
          videoContainer.innerHTML = ''
        }
        renderDynamicVideos(result.data.items)
        dynamicHasMore = result.data.has_more
        nextOffset = result.data.next_offset || ''

        if (!dynamicHasMore) {
          loadingMore.style.display = 'none'
          noMore.style.display = 'block'
        } else {
          loadingMore.style.display = 'none'
        }
      } else {
        console.log('No items to render')
        loadingMore.style.display = 'none'
        noMore.style.display = 'block'
        dynamicHasMore = false
      }
    } else {
      console.error('Fetch dynamics failed:', result.error)
      loadingMore.style.display = 'none'
      noMore.style.display = 'block'
    }
  } catch (error) {
    console.error('加载动态失败:', error)
    loadingMore.style.display = 'none'
    noMore.style.display = 'block'
  }

  isDynamicLoading = false
}

function selectDynamicUp(upId, upName) {
  currentUpId = upId
  currentOffset = ''
  nextOffset = ''
  dynamicHasMore = true

  document.querySelectorAll('.following-item').forEach(item => {
    item.classList.remove('active')
  })
  document.querySelector('.following-item[data-up-id="' + upId + '"]')?.classList.add('active')

  allDynamicBtn.classList.remove('active')

  dynamicTitle.textContent = upName

  videoContainer.innerHTML = ''
  loadingMore.style.display = 'none'
  noMore.style.display = 'none'

  loadDynamicVideos(upId, '')
}

function selectAllDynamic() {
  currentUpId = null
  currentOffset = ''
  nextOffset = ''
  dynamicHasMore = true

  document.querySelectorAll('.following-item').forEach(item => {
    item.classList.remove('active')
  })
  allDynamicBtn.classList.add('active')

  dynamicTitle.textContent = '全部动态'

  videoContainer.innerHTML = ''
  loadingMore.style.display = 'none'
  noMore.style.display = 'none'

  loadDynamicVideos(null, '')
}

function handleScroll() {
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop
  const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight
  const clientHeight = document.documentElement.clientHeight || document.body.clientHeight

  if (scrollTop + clientHeight >= scrollHeight - 200 && !isDynamicLoading && dynamicHasMore) {
    loadDynamicVideos(currentUpId, nextOffset)
  }
}

homeBtn.addEventListener('click', () => {
  ipcRenderer.send('go-home')
})

allDynamicBtn.addEventListener('click', selectAllDynamic)

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
        ipcRenderer.send('open-media')
      } else if (page === 'dynamic') {
        // Already on dynamic page
      } else if (page === 'my') {
        ipcRenderer.send('open-my')
      }
    }
  })
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

window.addEventListener('scroll', handleScroll)

console.log('Initializing dynamic page...')

renderFollowingList()
selectAllDynamic()

console.log('Dynamic page initialized')
