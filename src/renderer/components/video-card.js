// 视频卡片模块

const COVER_WIDTH = 672
const COVER_HEIGHT = 378
const EAGER_COUNT = 6

const coverObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target
      loadCoverImage(img)
      coverObserver.unobserve(img)
    }
  })
}, { rootMargin: '200px' })

function loadCoverImage(img) {
  const src = img.dataset.src
  if (!src) {
    img.classList.add('load-error')
    return
  }
  img.src = src
  img.onload = () => img.classList.add('loaded')
  img.onerror = () => {
    img.classList.add('load-error')
    img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect fill="%23f0f0f0" width="16" height="9"/><text x="8" y="5.5" text-anchor="middle" fill="%23bbb" font-size="1.2">!</text></svg>')
  }
}

// Shared helper for custom card creators that don't use createVideoCard.
// img: the <img> element (should have data-src set, src empty)
// eager: if true, load immediately; otherwise use IntersectionObserver
function setupLazyImage(img, eager) {
  if (eager) {
    loadCoverImage(img)
  } else {
    coverObserver.observe(img)
  }
}

let activeFavoritesDropdown = null

function closeFavoritesDropdown() {
  if (activeFavoritesDropdown) {
    activeFavoritesDropdown.style.display = 'none'
    activeFavoritesDropdown = null
  }
  document.removeEventListener('click', onFavoritesDropdownDocClick, true)
  window.removeEventListener('resize', closeFavoritesDropdown, true)
  window.removeEventListener('scroll', closeFavoritesDropdown, true)
}

function onFavoritesDropdownDocClick(e) {
  if (activeFavoritesDropdown && !activeFavoritesDropdown.contains(e.target)) {
    const trigger = activeFavoritesDropdown._triggerBtn
    if (trigger && trigger.contains(e.target)) return
    closeFavoritesDropdown()
  }
}

function openFavoritesDropdown(dropdown, triggerBtn) {
  closeFavoritesDropdown()
  activeFavoritesDropdown = dropdown
  dropdown._triggerBtn = triggerBtn

  const rect = triggerBtn.getBoundingClientRect()
  dropdown.style.visibility = 'hidden'
  dropdown.style.display = 'block'
  const ddRect = dropdown.getBoundingClientRect()

  // 向下展开，定位在按钮下方
  const top = rect.bottom + 6
  const left = rect.right - ddRect.width
  // 确保菜单不会超出视口底部
  const maxTop = window.innerHeight - ddRect.height - 8
  dropdown.style.top = `${Math.max(8, Math.min(top, maxTop))}px`
  dropdown.style.left = `${Math.max(8, left)}px`
  dropdown.style.visibility = 'visible'

  setTimeout(() => {
    document.addEventListener('click', onFavoritesDropdownDocClick, true)
    window.addEventListener('resize', closeFavoritesDropdown, true)
    window.addEventListener('scroll', closeFavoritesDropdown, true)
  }, 0)
}

function createVideoCard(video, onAuthorClick, options = {}) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = video.bvid
  card.dataset.cid = video.cid || ''

  // 用户卡片使用独立的布局
  const isUserCard = !video.bvid && video.mid && video.isUser
  if (isUserCard) {
    card.className = 'video-card user-card'
    card.dataset.mid = video.mid

    const coverSrc = video.pic ? optimizeCoverUrl(video.pic, 200, 200) : ''
    const fansText = formatPlayCount(video.fans || 0)
    const videoText = formatPlayCount(video.videoCount || 0)

    card.innerHTML = `
      <div class="user-card-avatar">
        <img src="" alt="${video.title}" data-src="${coverSrc}">
      </div>
      <div class="user-card-name">${video.title}</div>
      ${video.author ? `<div class="user-card-sign">${video.author}</div>` : ''}
      <div class="user-card-stats">
        <span class="user-card-fans">${fansText} 粉丝</span>
        <span class="user-card-videos">${videoText} 视频</span>
      </div>
    `

    const img = card.querySelector('img')
    if (options.eager) {
      loadCoverImage(img)
    } else {
      coverObserver.observe(img)
    }

    card.addEventListener('click', () => {
      if (video.mid) navigateToUP(video.mid)
    })
    return card
  }

  const rankBadge = options.showRank && video.rank ? `
    <span class="video-rank badge-${video.rank <= 3 ? video.rank : 'default'}">${video.rank}</span>
  ` : ''

  const coverSrc = video.pic ? optimizeCoverUrl(video.pic, COVER_WIDTH, COVER_HEIGHT) : ''

  const showAddToView = options.showAddToView !== false

  const playCount = video.play || video.view || ''

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="" alt="${video.title}" data-src="${coverSrc}">
      <span class="video-duration">${video.duration}</span>
      ${playCount ? `<span class="video-play-count">${playCount}</span>` : ''}
      ${showAddToView ? `
      <button class="add-to-view-btn" title="添加到稍后再看">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12,6 12,12 16,14"></polyline>
        </svg>
      </button>
      ` : ''}
      ${rankBadge}
    </div>
  `

  const img = card.querySelector('img')

  if (options.eager) {
    loadCoverImage(img)
  } else {
    coverObserver.observe(img)
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.add-to-view-btn')) {
      return
    }
    if (video.bvid) playVideo(video.bvid, video.cid, video.title)
  })

  if (showAddToView) {
    const addToViewBtn = card.querySelector('.add-to-view-btn')
    if (addToViewBtn) {
      addToViewBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (video.bvid) {
          const result = await ipcRenderer.invoke('add-to-view', video.bvid)
          if (result.success) {
            addToViewBtn.classList.add('added')
            addToViewBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20,6 9,17 4,12"></polyline>
              </svg>
            `
            setTimeout(() => {
              addToViewBtn.classList.remove('added')
              addToViewBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12,6 12,12 16,14"></polyline>
                </svg>
              `
            }, 2000)
          }
        }
      })
    }
  }

  return card
}

function createVideoInfo(video, onAuthorClick, options = {}) {
  const info = document.createElement('div')
  info.className = 'video-info'

  const showFavoritesMore = options.showFavoritesMore

  const favoritesMoreBtn = showFavoritesMore ? `
    <div class="favorites-more-wrapper">
      <button class="favorites-more-btn" title="更多操作">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="12" cy="4" r="3"/>
          <circle cx="12" cy="12" r="3"/>
          <circle cx="12" cy="20" r="3"/>
        </svg>
      </button>
    </div>
  ` : ''

  info.innerHTML = `
    <div class="video-title-row">
      <h3 class="video-title">${video.title}</h3>
      ${favoritesMoreBtn}
    </div>
    <div class="video-footer">
      <div class="video-author-row">
        <svg class="up-icon up-clickable" data-mid="${video.owner?.mid || video.mid || ''}" viewBox="0 0 40 28" fill="none">
          <rect x="2" y="2" width="36" height="24" rx="6" ry="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <text x="20" y="20" text-anchor="middle" font-size="13" font-weight="bold" fill="currentColor" font-family="inherit">U P</text>
        </svg>
        ${video.author ? `<span class="video-author-name up-clickable" data-mid="${video.owner?.mid || video.mid || ''}">${video.author}</span>` : ''}
        ${video.publish_date ? `<span class="video-publish-date up-clickable" data-mid="${video.owner?.mid || video.mid || ''}">${video.publish_date}</span>` : ''}
      </div>
    </div>
  `

  const upClickableElements = info.querySelectorAll('.up-clickable')
  upClickableElements.forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      const mid = el.dataset.mid || video.owner?.mid || video.mid
      if (mid && onAuthorClick) onAuthorClick(mid)
    })
  })

  const titleEl = info.querySelector('.video-title')
  if (titleEl) {
    titleEl.addEventListener('click', e => {
      e.stopPropagation()
      if (video.bvid) playVideo(video.bvid, video.cid, video.title)
    })
  }

  if (showFavoritesMore) {
    const moreBtn = info.querySelector('.favorites-more-btn')
    const dropdown = createFavoritesDropdown(video, options)
    document.body.appendChild(dropdown)

    moreBtn.addEventListener('click', e => {
      e.stopPropagation()
      if (dropdown.style.display === 'block') {
        closeFavoritesDropdown()
      } else {
        openFavoritesDropdown(dropdown, moreBtn)
      }
    })
  }

  return info
}

function createFavoritesDropdown(video, options) {
  const dropdown = document.createElement('div')
  dropdown.className = 'favorites-dropdown'
  dropdown.style.display = 'none'

  const onUnfavorite = options.onUnfavorite
  const onSelectFolder = options.onSelectFolder

  dropdown.innerHTML = `
    <div class="favorites-dropdown-item select-folder-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      <span>选择收藏夹</span>
    </div>
    <div class="favorites-dropdown-divider"></div>
    <div class="favorites-dropdown-item unfavorite-btn" style="color: #ff5e5e;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18"></path>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>取消收藏</span>
    </div>
  `

  const unfavoriteBtn = dropdown.querySelector('.unfavorite-btn')
  const selectFolderBtn = dropdown.querySelector('.select-folder-btn')

  unfavoriteBtn.addEventListener('click', e => {
    e.stopPropagation()
    closeFavoritesDropdown()
    if (onUnfavorite) {
      const card = document.querySelector(`.video-card[data-bvid="${video.bvid}"]`)
      onUnfavorite(video, card)
    }
  })

  selectFolderBtn.addEventListener('click', e => {
    e.stopPropagation()
    closeFavoritesDropdown()
    if (onSelectFolder) {
      const card = document.querySelector(`.video-card[data-bvid="${video.bvid}"]`)
      onSelectFolder(video, card)
    }
  })

  return dropdown
}

function renderVideos(videos, containerId, onAuthorClick, options = {}) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''
  videos.filter(v => v.bvid || v.title).forEach((video, index) => {
    if (options.showRank && !video.rank) {
      video.rank = index + 1
    }
    const eager = index < EAGER_COUNT
    const card = createVideoCard(video, onAuthorClick, { ...options, eager })
    const info = createVideoInfo(video, onAuthorClick, options)
    const wrapper = document.createElement('div')
    wrapper.className = 'video-item-wrapper'
    wrapper.appendChild(card)
    wrapper.appendChild(info)
    container.appendChild(wrapper)
  })
}

function appendVideos(videos, containerId, onAuthorClick, options = {}) {
  const container = document.getElementById(containerId)
  if (!container) return
  const startRank = options.showRank ? document.querySelectorAll('.video-card').length + 1 : null
  videos.filter(v => v.bvid || v.title).forEach((video, index) => {
    if (options.showRank && !video.rank) {
      video.rank = startRank + index
    }
    const card = createVideoCard(video, onAuthorClick, options)
    const info = createVideoInfo(video, onAuthorClick, options)
    const wrapper = document.createElement('div')
    wrapper.className = 'video-item-wrapper'
    wrapper.appendChild(card)
    wrapper.appendChild(info)
    container.appendChild(wrapper)
  })
}

function showEmptyMessage(containerId, message) {
  const container = document.getElementById(containerId)
  if (container) container.innerHTML = `<div style="padding: 40px; text-align: center; color: #999; max-width: 80%; margin: 0 auto;">${message}</div>`
}
