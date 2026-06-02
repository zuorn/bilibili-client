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

  const rankBadge = options.showRank && video.rank ? `
    <span class="video-rank badge-${video.rank <= 3 ? video.rank : 'default'}">${video.rank}</span>
  ` : ''

  const coverSrc = video.pic ? optimizeCoverUrl(video.pic, COVER_WIDTH, COVER_HEIGHT) : ''

  const showAddToView = options.showAddToView !== false
  const showFavoritesMore = !!options.showFavoritesMore

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="" alt="${video.title}" data-src="${coverSrc}">
      <span class="video-duration">${video.duration}</span>
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
    <div class="video-info">
      <div class="video-title-row">
        <h3 class="video-title">${video.title}</h3>
        ${showFavoritesMore ? `
        <div class="favorites-more-wrapper">
          <button class="favorites-more-btn" title="更多操作" data-bvid="${video.bvid}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="4" r="1.5"></circle>
              <circle cx="12" cy="12" r="1.5"></circle>
              <circle cx="12" cy="20" r="1.5"></circle>
            </svg>
          </button>
        </div>
        ` : ''}
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
        <span class="video-play">${video.play}</span>
      </div>
    </div>
    ${showFavoritesMore ? `
    <div class="favorites-dropdown" data-bvid="${video.bvid}">
      <div class="favorites-dropdown-item favorites-select-folder-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
        </svg>
        <span>选择收藏夹</span>
      </div>
      <div class="favorites-dropdown-divider"></div>
      <div class="favorites-dropdown-item favorites-unfavorite-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3,6 5,6 21,6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
        </svg>
        <span>取消收藏</span>
      </div>
    </div>
    ` : ''}
  `

  const img = card.querySelector('img')

  if (options.eager) {
    loadCoverImage(img)
  } else {
    coverObserver.observe(img)
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.favorites-more-btn') || e.target.closest('.favorites-dropdown')) {
      return
    }
    if (video.bvid) playVideo(video.bvid, video.cid, video.title)
  })

  const upClickableElements = card.querySelectorAll('.up-clickable')
  upClickableElements.forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      const mid = el.dataset.mid || video.owner?.mid || video.mid
      if (mid && onAuthorClick) onAuthorClick(mid)
    })
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

  if (showFavoritesMore) {
    const moreBtn = card.querySelector('.favorites-more-btn')
    const dropdown = card.querySelector('.favorites-dropdown')
    
    // 在移动 dropdown 之前先获取按钮引用
    const unfavoriteBtn = dropdown?.querySelector('.favorites-unfavorite-btn')
    const selectFolderBtn = dropdown?.querySelector('.favorites-select-folder-btn')

    if (dropdown && dropdown.parentElement !== document.body) {
      document.body.appendChild(dropdown)
    }

    moreBtn.addEventListener('click', e => {
      e.stopPropagation()
      e.preventDefault()
      if (dropdown.style.display === 'block' && activeFavoritesDropdown === dropdown) {
        closeFavoritesDropdown()
      } else {
        openFavoritesDropdown(dropdown, moreBtn)
      }
    })

    dropdown.addEventListener('click', e => e.stopPropagation())

    if (unfavoriteBtn) {
      unfavoriteBtn.addEventListener('click', async e => {
        e.stopPropagation()
        closeFavoritesDropdown()
        console.log('[VideoCard] 取消收藏按钮被点击，video:', video.bvid, 'has onUnfavorite:', !!options.onUnfavorite)
        if (options.onUnfavorite) {
          console.log('[VideoCard] 调用 onUnfavorite')
          options.onUnfavorite(video, card)
        } else {
          console.log('[VideoCard] onUnfavorite 未定义')
        }
      })
    } else {
      console.log('[VideoCard] 未找到取消收藏按钮')
    }

    if (selectFolderBtn) {
      selectFolderBtn.addEventListener('click', e => {
        e.stopPropagation()
        closeFavoritesDropdown()
        if (options.onSelectFolder) {
          options.onSelectFolder(video, card)
        }
      })
    }
  }

  return card
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
    container.appendChild(createVideoCard(video, onAuthorClick, { ...options, eager }))
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
    container.appendChild(createVideoCard(video, onAuthorClick, options))
  })
}

function showEmptyMessage(containerId, message) {
  const container = document.getElementById(containerId)
  if (container) container.innerHTML = `<div style="padding: 40px; text-align: center; color: #999; max-width: 80%; margin: 0 auto;">${message}</div>`
}
