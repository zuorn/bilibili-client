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

function createDynamicVideoCard(dynamic, options = {}) {
  const card = document.createElement('div')
  card.className = 'video-card'

  const thumbnail = dynamic.thumbnail || dynamic.pic || ''
  const title = dynamic.title || dynamic.desc || '暂无标题'
  const duration = dynamic.duration || ''
  const bvid = dynamic.bvid || ''
  const cid = dynamic.cid || ''

  card.dataset.bvid = bvid
  card.dataset.cid = cid

  let durationHtml = duration ? '<div class="video-duration">' + duration + '</div>' : ''
  const coverSrc = optimizeCoverUrl(thumbnail, COVER_WIDTH, COVER_HEIGHT)

  card.innerHTML = '<div class="video-thumbnail"><img src="" alt="' + title + '" data-src="' + coverSrc + '">' + durationHtml + '</div>'

  const img = card.querySelector('.video-thumbnail img')
  setupLazyImage(img, options.eager)

  card.addEventListener('click', () => {
    if (bvid) playVideo(bvid, '', title)
  })

  return card
}

function createDynamicVideoInfo(dynamic, onAuthorClick) {
  const info = document.createElement('div')
  info.className = 'video-info'

  const bvid = dynamic.bvid || ''
  const cid = dynamic.cid || ''
  const title = dynamic.title || dynamic.desc || '暂无标题'
  const author = dynamic.authorName || dynamic.author || '未知'
  const authorMid = dynamic.authorMid || ''
  const pubTs = dynamic.pubTs || dynamic.time || 0
  const pubTime = dynamic.pubTime || ''
  const videoDate = pubTime || formatDynamicTime(pubTs)

  info.innerHTML = '<h3 class="video-title">' + title + '</h3><div class="video-footer"><div class="video-author-row"><svg class="up-icon up-clickable" data-mid="' + authorMid + '" viewBox="0 0 40 28" fill="none"><rect x="2" y="2" width="36" height="24" rx="6" ry="6" stroke="currentColor" stroke-width="1.5" fill="none"/><text x="20" y="20" text-anchor="middle" font-size="13" font-weight="bold" fill="currentColor" font-family="inherit">U P</text></svg><span class="video-author-name up-clickable" data-mid="' + authorMid + '">' + author + '</span>' + (videoDate ? '<span class="video-publish-date up-clickable" data-mid="' + authorMid + '">' + videoDate + '</span>' : '') + '</div><span class="video-play">' + (dynamic.view || dynamic.play || '') + '</span></div>'

  const upClickableElements = info.querySelectorAll('.up-clickable')
  upClickableElements.forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      if (authorMid && onAuthorClick) onAuthorClick(authorMid)
    })
  })

  const titleEl = info.querySelector('.video-title')
  if (titleEl) {
    titleEl.addEventListener('click', e => {
      e.stopPropagation()
      if (bvid) playVideo(bvid, cid, title)
    })
  }

  return info
}

function renderDynamicVideos(dynamics, onAuthorClick) {
  const videoContainer = document.getElementById('videoContainer')
  if (!videoContainer) return

  dynamics.forEach((dynamic, index) => {
    if (dynamic.bvid || dynamic.thumbnail) {
      const eager = index < EAGER_COUNT
      const card = createDynamicVideoCard(dynamic, { eager })
      const info = createDynamicVideoInfo(dynamic, onAuthorClick)
      const wrapper = document.createElement('div')
      wrapper.className = 'video-item-wrapper'
      wrapper.appendChild(card)
      wrapper.appendChild(info)
      videoContainer.appendChild(wrapper)
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

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前'
  return Math.floor(diff / 86400) + '天前'
}

function formatCount(num) {
  if (!num) return ''
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return num.toString()
}

function createDynamicCard(d) {
  const card = document.createElement('div')
  card.className = 'dynamic-card'
  
  console.log('=== 创建动态卡片 ===')
  console.log('卡片数据:', d)
  console.log('作者:', d.authorName)
  console.log('类型:', d.type)
  console.log('标题:', d.title)

  let headerHtml = '<div class="dynamic-header">'
  if (d.authorFace) {
    headerHtml += `<img class="dynamic-avatar" src="${optimizeCoverUrl(d.authorFace, 48, 48)}" alt="" onerror="this.style.display='none'">`
  }
  headerHtml += `<span class="dynamic-author">${escapeHtml(d.authorName)}</span>`
  headerHtml += `<span class="dynamic-time">${d.pubTime || timeAgo(d.pubTs)}</span>`
  headerHtml += '</div>'

  let bodyHtml = ''
  const desc = d.desc

  if (desc) {
    bodyHtml += `<div class="dynamic-desc">${escapeHtml(desc)}</div>`
  }

  const type = d.type

  if (type === 'DYNAMIC_TYPE_AV' && d.bvid) {
    bodyHtml += `<div class="dynamic-video-card video-card" data-bvid="${d.bvid}" data-cid="${d.cid || ''}">`
    bodyHtml += `<div class="dynamic-video-info"><div class="dynamic-video-title">${escapeHtml(d.title || '')}</div></div>`
    if (d.cover) {
      bodyHtml += `<div class="dynamic-video-cover-wrap video-thumbnail"><img class="dynamic-video-cover" data-src="${optimizeCoverUrl(d.cover, 672, 378)}" alt="" loading="lazy" decoding="async">`
      bodyHtml += `<div class="dynamic-video-stats"><span class="dynamic-video-duration">${d.duration || ''}</span><span class="dynamic-video-play">${formatCount(d.play)}播放</span><span class="dynamic-video-danmaku">${formatCount(d.danmaku)}弹幕</span></div>`
      bodyHtml += `</div>`
    }
    bodyHtml += '</div>'
  }

  if (type === 'DYNAMIC_TYPE_DRAW' && d.drawItems && d.drawItems.length > 0) {
    const count = d.drawItems.length
    const drawItemsStr = JSON.stringify(d.drawItems.map(p => fixImageUrl(p.src)))
    bodyHtml += `<div class="dynamic-images" data-images='${drawItemsStr}'>`
    d.drawItems.slice(0, 9).forEach((pic, index) => {
      bodyHtml += `<div class="dynamic-image-item" data-index="${index}"><img data-src="${optimizeCoverUrl(pic.src, 300, 300)}" alt="" loading="lazy" decoding="async"></div>`
    })
    if (count > 9) {
      bodyHtml += `<div class="dynamic-image-more">+${count - 9}</div>`
    }
    bodyHtml += '</div>'
  }

  if (type === 'DYNAMIC_TYPE_ARTICLE' && d.articleId) {
    bodyHtml += '<div class="dynamic-article-card">'
    if (d.cover) {
      bodyHtml += `<div class="dynamic-article-cover"><img data-src="${optimizeCoverUrl(d.cover, 200, 140)}" alt="" loading="lazy" decoding="async"></div>`
    }
    bodyHtml += `<div class="dynamic-article-info"><div class="dynamic-article-title">${escapeHtml(d.title || '')}</div>`
    bodyHtml += `<div class="dynamic-article-desc">${escapeHtml(d.articleDesc || '')}</div></div>`
    bodyHtml += '</div>'
  }

  if (d.orig && d.orig.id) {
    bodyHtml += '<div class="dynamic-forward">'
    bodyHtml += `<div class="dynamic-forward-header"><span>@${escapeHtml(d.orig.authorName || '')}</span></div>`
    bodyHtml += `<div class="dynamic-forward-desc">${escapeHtml(d.orig.desc || '')}</div>`
    if (d.orig.bvid) {
      bodyHtml += `<div class="dynamic-forward-video video-card" data-bvid="${d.orig.bvid}" data-cid="${d.orig.cid || ''}">`
      bodyHtml += `<div class="dynamic-video-info"><div class="dynamic-video-title">${escapeHtml(d.orig.title || '')}</div></div>`
      if (d.orig.cover) {
        bodyHtml += `<div class="dynamic-forward-cover video-thumbnail"><img class="dynamic-video-cover" data-src="${optimizeCoverUrl(d.orig.cover, 672, 378)}" alt="" loading="lazy" decoding="async">`
        bodyHtml += `<div class="dynamic-video-stats"><span class="dynamic-video-duration">${d.orig.duration || ''}</span><span class="dynamic-video-play">${formatCount(d.orig.play)}播放</span><span class="dynamic-video-danmaku">${formatCount(d.orig.danmaku)}弹幕</span></div>`
        bodyHtml += `</div>`
      }
      bodyHtml += '</div>'
    }
    if (d.orig.drawItems && d.orig.drawItems.length > 0) {
      const origDrawItemsStr = JSON.stringify(d.orig.drawItems.map(p => fixImageUrl(p.src)))
      bodyHtml += `<div class="dynamic-images" data-images='${origDrawItemsStr}'>`
      d.orig.drawItems.slice(0, 9).forEach((pic, index) => {
        bodyHtml += `<div class="dynamic-image-item" data-index="${index}"><img data-src="${optimizeCoverUrl(pic.src, 300, 300)}" alt="" loading="lazy" decoding="async"></div>`
      })
      bodyHtml += '</div>'
    }
    bodyHtml += '</div>'
  }

  if ((type === 'DYNAMIC_TYPE_WORD' || type === 'DYNAMIC_TYPE_OPUS') && d.cover) {
    bodyHtml += `<div class="dynamic-cover-img"><img data-src="${optimizeCoverUrl(d.cover, 500, 300)}" alt="" loading="lazy" decoding="async"></div>`
  }

  let footerHtml = '<div class="dynamic-footer">'
  footerHtml += `<span class="dynamic-stat"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${formatCount(d.like) || ''}</span>`
  footerHtml += `<span class="dynamic-stat"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${formatCount(d.comment) || ''}</span>`
  footerHtml += `<span class="dynamic-stat"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>${formatCount(d.forward_count) || ''}</span>`
  footerHtml += '</div>'

  card.innerHTML = headerHtml + bodyHtml + footerHtml

  if (d.bvid) {
    card.style.cursor = 'pointer'
    card.addEventListener('click', () => {
      playVideo(d.bvid, d.cid || '', d.title || '')
    })
  }

  return card
}

let isDynamicContentLoading = false
let dynamicContentOffset = ''
let dynamicContentHasMore = true

async function loadDynamicContent(upId = null, offset = '') {
  if (isDynamicContentLoading) return

  isDynamicContentLoading = true
  const loadingMore = document.getElementById('dynamicDynamicsLoadingMore')
  const noMore = document.getElementById('dynamicDynamicsNoMore')
  if (loadingMore) loadingMore.style.display = 'block'
  if (noMore) noMore.style.display = 'none'

  try {
    const result = await fetchDynamics(upId, offset)
    console.log('=== 动态内容加载结果 ===')
    console.log('fetchDynamics result:', result)
    console.log('result.items:', result.items)
    console.log('result.items length:', result.items?.length || 0)

    if (result.items && result.items.length > 0) {
      const items = result.items
      console.log('Dynamics items received:', items.length)

      const list = document.getElementById('dynamicDynamicsList')
      if (!list) return

      items.forEach((d, index) => {
        const card = createDynamicCard(d)
        list.appendChild(card)
        if (index < 10) {
          card.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.dataset.src
            img.removeAttribute('data-src')
          })
        }
      })

      dynamicContentHasMore = result.has_more || false
      dynamicContentOffset = result.next_offset || ''

      if (!dynamicContentHasMore) {
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
    console.error('加载动态内容失败:', error)
    if (loadingMore) loadingMore.style.display = 'none'
  }

  isDynamicContentLoading = false
}

function switchDynamicTab(tabName) {
  const content = document.querySelector('.content')
  if (content) content.scrollTop = 0

  // 更新顶部导航栏的nav-link状态
  document.querySelectorAll('.nav-link[data-page="dynamic"]').forEach(t => t.classList.remove('active'))
  const targetTab = document.querySelector(`.nav-link[data-page="dynamic"][data-subtab="${tabName}"]`)
  if (targetTab) targetTab.classList.add('active')

  document.querySelectorAll('.dynamic-tab-content').forEach(c => c.classList.remove('active'))

  const contentMap = {
    dynamics: 'dynamicDynamicsTab',
    videos: 'dynamicVideosTab'
  }
  const contentId = contentMap[tabName]
  if (contentId) {
    const el = document.getElementById(contentId)
    if (el) el.classList.add('active')
  }

  if (tabName === 'dynamics') {
    const list = document.getElementById('dynamicDynamicsList')
    if (list && list.children.length === 0) {
      dynamicContentOffset = ''
      dynamicContentHasMore = true
      loadDynamicContent(currentUpId, '')
    }
  }
}

function selectDynamicUp(upId, upName) {
  currentUpId = upId
  currentDynamicOffset = ''
  dynamicHasMore = true
  dynamicContentOffset = ''
  dynamicContentHasMore = true

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

  const dynamicsList = document.getElementById('dynamicDynamicsList')
  if (dynamicsList) dynamicsList.innerHTML = ''
  const dynLoadingMore = document.getElementById('dynamicDynamicsLoadingMore')
  if (dynLoadingMore) dynLoadingMore.style.display = 'none'
  const dynNoMore = document.getElementById('dynamicDynamicsNoMore')
  if (dynNoMore) dynNoMore.style.display = 'none'

  loadDynamicVideos(upId, '')
  loadDynamicContent(upId, '')
}

function selectAllDynamic() {
  currentUpId = null
  currentDynamicOffset = ''
  dynamicHasMore = true
  dynamicContentOffset = ''
  dynamicContentHasMore = true

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

  const dynamicsList = document.getElementById('dynamicDynamicsList')
  if (dynamicsList) dynamicsList.innerHTML = ''
  const dynLoadingMore = document.getElementById('dynamicDynamicsLoadingMore')
  if (dynLoadingMore) dynLoadingMore.style.display = 'none'
  const dynNoMore = document.getElementById('dynamicDynamicsNoMore')
  if (dynNoMore) dynNoMore.style.display = 'none'

  loadDynamicVideos(null, '')
  loadDynamicContent(null, '')
}

function handleDynamicScroll() {
  const content = document.querySelector('.content')
  if (!content) return

  const { scrollTop, scrollHeight, clientHeight } = content

  const activeTab = document.querySelector('.dynamic-tab.active')?.dataset.tab

  if (activeTab === 'videos') {
    const noMore = document.getElementById('noMore')
    if (scrollTop + clientHeight >= scrollHeight - 200 && !isDynamicLoading && dynamicHasMore) {
      loadDynamicVideos(currentUpId, currentDynamicOffset)
    }
  } else if (activeTab === 'dynamics') {
    const noMore = document.getElementById('dynamicDynamicsNoMore')
    if (scrollTop + clientHeight >= scrollHeight - 200 && !isDynamicContentLoading && dynamicContentHasMore) {
      loadDynamicContent(currentUpId, dynamicContentOffset)
    }
  }
}

async function initDynamicPage() {
  const videoContainer = document.getElementById('videoContainer')
  const followingList = document.getElementById('followingList')

  if (!currentUser?.isLogin) {
    if (videoContainer) {
      videoContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">请先登录查看动态</div>'
    }
    const dynamicsList = document.getElementById('dynamicDynamicsList')
    if (dynamicsList) {
      dynamicsList.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">请先登录查看动态</div>'
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

  document.querySelectorAll('.dynamic-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchDynamicTab(tab.dataset.tab)
    })
  })

  initImagePreview()
}

// 图片预览功能
let currentImageList = []
let currentImageIndex = 0

function initImagePreview() {
  // 点击图片网格中的图片
  document.addEventListener('click', (e) => {
    const imageItem = e.target.closest('.dynamic-image-item')
    if (imageItem) {
      const imagesContainer = imageItem.closest('.dynamic-images')
      if (imagesContainer) {
        const imagesData = imagesContainer.dataset.images
        if (imagesData) {
          currentImageList = JSON.parse(imagesData)
          currentImageIndex = parseInt(imageItem.dataset.index) || 0
          openImagePreview()
        }
      }
    }
  })

  // 关闭按钮
  const closeBtn = document.getElementById('imagePreviewClose')
  if (closeBtn) {
    closeBtn.addEventListener('click', closeImagePreview)
  }

  // 遮罩层点击关闭
  const overlay = document.getElementById('imagePreviewOverlay')
  if (overlay) {
    overlay.addEventListener('click', closeImagePreview)
  }

  // 上一张按钮
  const prevBtn = document.getElementById('imagePreviewPrev')
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentImageIndex > 0) {
        currentImageIndex--
        updateImagePreview()
      }
    })
  }

  // 下一张按钮
  const nextBtn = document.getElementById('imagePreviewNext')
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentImageIndex < currentImageList.length - 1) {
        currentImageIndex++
        updateImagePreview()
      }
    })
  }

  // 下载按钮
  const downloadBtn = document.getElementById('imagePreviewDownload')
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadCurrentImage)
  }

  // 缩略图点击
  const thumbnailsContainer = document.getElementById('imagePreviewThumbnails')
  if (thumbnailsContainer) {
    thumbnailsContainer.addEventListener('click', (e) => {
      const thumbnailItem = e.target.closest('.thumbnail-item')
      if (thumbnailItem) {
        currentImageIndex = parseInt(thumbnailItem.dataset.index) || 0
        updateImagePreview()
      }
    })
  }

  // 键盘事件
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('imagePreviewModal')
    if (modal && modal.style.display !== 'none') {
      if (e.key === 'Escape') {
        closeImagePreview()
      } else if (e.key === 'ArrowLeft') {
        if (currentImageIndex > 0) {
          currentImageIndex--
          updateImagePreview()
        }
      } else if (e.key === 'ArrowRight') {
        if (currentImageIndex < currentImageList.length - 1) {
          currentImageIndex++
          updateImagePreview()
        }
      }
    }
  })
}

function openImagePreview() {
  const modal = document.getElementById('imagePreviewModal')
  if (modal) {
    modal.style.display = 'flex'
    updateImagePreview()
  }
}

function closeImagePreview() {
  const modal = document.getElementById('imagePreviewModal')
  if (modal) {
    modal.style.display = 'none'
  }
}

function updateImagePreview() {
  const img = document.getElementById('imagePreviewImg')
  const counter = document.getElementById('imagePreviewCounter')
  const thumbnailsContainer = document.getElementById('imagePreviewThumbnails')

  if (img && currentImageList[currentImageIndex]) {
    img.src = currentImageList[currentImageIndex]
  }

  if (counter) {
    counter.textContent = `${currentImageIndex + 1} / ${currentImageList.length}`
  }

  if (thumbnailsContainer) {
    thumbnailsContainer.innerHTML = currentImageList.map((src, index) => {
      return `<div class="thumbnail-item ${index === currentImageIndex ? 'active' : ''}" data-index="${index}">
        <img src="${src}" alt="">
      </div>`
    }).join('')
  }
}

async function downloadCurrentImage() {
  if (!currentImageList[currentImageIndex]) return

  try {
    const response = await fetch(currentImageList[currentImageIndex])
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `image_${currentImageIndex + 1}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('下载图片失败:', error)
    showToast('下载失败')
  }
}