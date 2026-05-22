function formatDynamicViews(num) {
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + '万'
  }
  return num?.toString() || '0'
}

function formatDynamicTime(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() * 1000 - timestamp
  const minutes = Math.floor(diff / 60000000)
  const hours = Math.floor(diff / 36000000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 60) {
    return minutes + '分钟前'
  } else if (hours < 24) {
    return hours + '小时前'
  } else {
    return days + '天前'
  }
}

async function fetchFollowings(mid) {
  console.log('=== fetchFollowings START ===')
  try {
    const result = await ipcRenderer.invoke('get-dynamic-portal')

    if (result.success && result.data) {
      const portalData = result.data
      let followings = []

      console.log('Portal data keys:', Object.keys(portalData))

      if (portalData.up_list && Array.isArray(portalData.up_list)) {
        console.log('Found up_list array, length:', portalData.up_list.length)

        followings = portalData.up_list.map(item => ({
          mid: item.mid || '',
          name: item.uname || item.name || '',
          face: item.face || '',
          official: item.official_verify || null,
          vip: item.vip || null,
          has_update: item.has_update || false
        }))

        console.log('Parsed followings count:', followings.length)
      } else {
        console.log('No up_list found in portal data')
      }

      followingListData = followings
      console.log('=== fetchFollowings END ===')
      return followings
    } else {
      console.log('fetchFollowings failed:', result.error)
    }
  } catch (error) {
    console.error('fetchFollowings error:', error)
  }
  console.log('=== fetchFollowings END (error) ===')
  return []
}

async function fetchDynamics(upMid = null, offset = '') {
  try {
    const result = await ipcRenderer.invoke('get-user-dynamics', upMid, offset)
    if (result.success && result.data) {
      return {
        items: result.data.items || [],
        has_more: result.data.has_more,
        next_offset: result.data.next_offset
      }
    }
  } catch (error) {
    console.error('获取动态失败:', error)
  }
  return { items: [], has_more: false, next_offset: '' }
}

function renderFollowingList(followings) {
  const followingList = document.getElementById('followingList')
  if (!followingList) return

  followingList.innerHTML = ''

  if (followings.length === 0) {
    followingList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无数据</div>'
    return
  }

  followings.forEach(up => {
    const item = document.createElement('div')
    item.className = 'following-item' + (currentUpId === up.mid ? ' active' : '')
    item.dataset.upId = up.mid

    const avatarContent = up.face
      ? `<img src="${fixImageUrl(up.face)}" alt="${up.name}">`
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'

    let officialBadge = ''
    if (up.official) {
      const verifyType = up.official.type === 1 ? 'official' : 'official-personal'
      officialBadge = `<span class="official-badge ${verifyType}">${up.official.desc || '官方'}</span>`
    }

    let vipBadge = ''
    if (up.vip && up.vip.type === 2) {
      vipBadge = '<span class="vip-badge">大会员</span>'
    }

    let updateDot = ''
    if (up.has_update) {
      updateDot = '<span class="update-dot"></span>'
    }

    item.innerHTML = `${updateDot}<div class="following-avatar"><div class="avatar-wrap">${avatarContent}</div></div><div class="following-info"><div class="following-name">${up.name}${officialBadge}${vipBadge}</div></div>`

    item.addEventListener('click', () => selectDynamicUp(up.mid, up.name))
    followingList.appendChild(item)
  })
}

function createDynamicVideoCard(dynamic, onAuthorClick, options = {}) {
  const card = document.createElement('div')
  card.className = 'video-card'

  const thumbnail = dynamic.thumbnail || dynamic.pic || ''
  const title = dynamic.title || dynamic.desc || '暂无标题'
  const author = dynamic.authorName || dynamic.author || '未知'
  const authorMid = dynamic.authorMid || ''
  const duration = dynamic.duration || ''
  const pubTs = dynamic.pubTs || dynamic.time || 0
  const pubTime = dynamic.pubTime || ''
  const bvid = dynamic.bvid || ''
  const cid = dynamic.cid || ''

  card.dataset.bvid = bvid
  card.dataset.cid = cid

  let durationHtml = duration ? '<div class="video-duration">' + duration + '</div>' : ''
  const videoDate = pubTime || formatDynamicTime(pubTs)
  const coverSrc = optimizeCoverUrl(thumbnail, COVER_WIDTH, COVER_HEIGHT)

  card.innerHTML = '<div class="video-thumbnail"><img src="" alt="' + title + '" data-src="' + coverSrc + '">' + durationHtml + '</div><div class="video-info"><div class="video-title">' + title + '</div><div class="video-meta"><span class="video-author" data-mid="' + authorMid + '">' + author + '</span><span class="video-date">' + videoDate + '</span></div></div>'

  const img = card.querySelector('.video-thumbnail img')
  setupLazyImage(img, options.eager)

  if (bvid) {
    card.addEventListener('click', () => {
      playVideo(bvid, '', title)
    })
  }

  const authorSpan = card.querySelector('.video-author')
  authorSpan.addEventListener('click', e => {
    e.stopPropagation()
    if (authorMid && onAuthorClick) onAuthorClick(authorMid)
  })

  return card
}

function renderDynamicVideos(dynamics, onAuthorClick) {
  const videoContainer = document.getElementById('videoContainer')
  if (!videoContainer) return

  dynamics.forEach((dynamic, index) => {
    if (dynamic.bvid || dynamic.thumbnail) {
      const eager = index < EAGER_COUNT
      videoContainer.appendChild(createDynamicVideoCard(dynamic, onAuthorClick, { eager }))
    }
  })
}

async function loadDynamicVideos(upId = null, offset = '') {
  if (isDynamicLoading) return

  isDynamicLoading = true
  const loadingMore = document.getElementById('loadingMore')
  const noMore = document.getElementById('noMore')
  if (loadingMore) loadingMore.style.display = 'block'
  if (noMore) noMore.style.display = 'none'

  try {
    const result = await fetchDynamics(upId, offset)

    if (result.items.length > 0) {
      renderDynamicVideos(result.items, navigateToUP)
      dynamicHasMore = result.has_more
      currentDynamicOffset = result.next_offset

      if (!dynamicHasMore) {
        if (loadingMore) loadingMore.style.display = 'none'
        if (noMore) noMore.style.display = 'block'
      } else {
        if (loadingMore) loadingMore.style.display = 'none'
      }
    } else {
      if (loadingMore) loadingMore.style.display = 'none'
      if (noMore) noMore.style.display = 'block'
    }
  } catch (error) {
    console.error('加载动态失败:', error)
    if (loadingMore) loadingMore.style.display = 'none'
    if (noMore) noMore.style.display = 'block'
  }

  isDynamicLoading = false
}

function selectDynamicUp(upId, upName) {
  currentUpId = upId
  currentDynamicOffset = ''
  dynamicHasMore = true

  document.querySelectorAll('.following-item').forEach(item => {
    item.classList.remove('active')
  })
  document.querySelector('.following-item[data-up-id="' + upId + '"]')?.classList.add('active')

  const allDynamicBtn = document.getElementById('allDynamicBtn')
  if (allDynamicBtn) allDynamicBtn.classList.remove('active')

  const dynamicTitle = document.getElementById('dynamicTitle')
  if (dynamicTitle) dynamicTitle.textContent = upName

  const videoContainer = document.getElementById('videoContainer')
  if (videoContainer) videoContainer.innerHTML = ''
  const loadingMore = document.getElementById('loadingMore')
  if (loadingMore) loadingMore.style.display = 'none'
  const noMore = document.getElementById('noMore')
  if (noMore) noMore.style.display = 'none'

  loadDynamicVideos(upId, '')
}

function selectAllDynamic() {
  currentUpId = null
  currentDynamicOffset = ''
  dynamicHasMore = true

  document.querySelectorAll('.following-item').forEach(item => {
    item.classList.remove('active')
  })
  const allDynamicBtn = document.getElementById('allDynamicBtn')
  if (allDynamicBtn) allDynamicBtn.classList.add('active')

  const dynamicTitle = document.getElementById('dynamicTitle')
  if (dynamicTitle) dynamicTitle.textContent = '全部动态'

  const videoContainer = document.getElementById('videoContainer')
  if (videoContainer) videoContainer.innerHTML = ''
  const loadingMore = document.getElementById('loadingMore')
  if (loadingMore) loadingMore.style.display = 'none'
  const noMore = document.getElementById('noMore')
  if (noMore) noMore.style.display = 'none'

  loadDynamicVideos(null, '')
}

function handleDynamicScroll() {
  const content = document.querySelector('.content')
  if (!content) return

  const { scrollTop, scrollHeight, clientHeight } = content

  const noMore = document.getElementById('noMore')

  if (scrollTop + clientHeight >= scrollHeight - 200 && !isDynamicLoading && dynamicHasMore) {
    loadDynamicVideos(currentUpId, currentDynamicOffset)
  }
}

async function initDynamicPage() {
  const videoContainer = document.getElementById('videoContainer')
  const followingList = document.getElementById('followingList')

  if (!currentUser?.isLogin) {
    if (videoContainer) {
      videoContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">请先登录查看动态</div>'
    }
  } else {
    selectAllDynamic()
  }

  const followings = await fetchFollowings(currentUser?.mid)
  if (followings.length > 0) {
    renderFollowingList(followings)
  } else if (followingList) {
    followingList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无数据</div>'
  }

  const allDynamicBtn = document.getElementById('allDynamicBtn')
  if (allDynamicBtn) {
    allDynamicBtn.addEventListener('click', selectAllDynamic)
  }
}
