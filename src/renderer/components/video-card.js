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

function createVideoCard(video, onAuthorClick, options = {}) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = video.bvid
  card.dataset.cid = video.cid || ''

  const rankBadge = options.showRank && video.rank ? `
    <span class="video-rank badge-${video.rank <= 3 ? video.rank : 'default'}">${video.rank}</span>
  ` : ''

  const coverSrc = video.pic ? optimizeCoverUrl(video.pic, COVER_WIDTH, COVER_HEIGHT) : ''

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="" alt="${video.title}" data-src="${coverSrc}">
      <span class="video-duration">${video.duration}</span>
      ${rankBadge}
    </div>
    <div class="video-info">
      <h3 class="video-title">${video.title}</h3>
      <div class="video-meta">
        <span class="video-play">${video.play}</span>
        <span class="video-author" data-mid="${video.owner?.mid || ''}">${video.author}</span>
      </div>
    </div>
  `

  const img = card.querySelector('img')

  if (options.eager) {
    loadCoverImage(img)
  } else {
    coverObserver.observe(img)
  }

  card.addEventListener('click', () => {
    if (video.bvid) playVideo(video.bvid, video.cid, video.title)
  })

  const authorSpan = card.querySelector('.video-author')
  authorSpan.addEventListener('click', e => {
    e.stopPropagation()
    const mid = video.owner?.mid || video.mid
    if (mid && onAuthorClick) onAuthorClick(mid)
  })

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
