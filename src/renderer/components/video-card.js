// 视频卡片模块

function createVideoCard(video, onAuthorClick) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = video.bvid
  card.dataset.cid = video.cid || ''

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="${video.pic}" alt="${video.title}" loading="lazy">
      <span class="video-duration">${video.duration}</span>
    </div>
    <div class="video-info">
      <h3 class="video-title">${video.title}</h3>
      <div class="video-meta">
        <span class="video-play">${video.play}</span>
        <span class="video-author" data-mid="${video.owner?.mid || ''}">${video.author}</span>
      </div>
    </div>
  `

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

function renderVideos(videos, containerId, onAuthorClick) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''
  videos.filter(v => v.bvid || v.title).forEach(video => container.appendChild(createVideoCard(video, onAuthorClick)))
}

function appendVideos(videos, containerId, onAuthorClick) {
  const container = document.getElementById(containerId)
  if (!container) return
  videos.filter(v => v.bvid || v.title).forEach(video => container.appendChild(createVideoCard(video, onAuthorClick)))
}

function showEmptyMessage(containerId, message) {
  const container = document.getElementById(containerId)
  if (container) container.innerHTML = `<div style="padding: 40px; text-align: center; color: #999; max-width: 80%; margin: 0 auto;">${message}</div>`
}
