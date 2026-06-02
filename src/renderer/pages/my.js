const DEFAULT_FAVORITES_ID = 166434448
const DEFAULT_FAVORITES_NAME = '默认收藏夹'

function formatHistoryTime(timestamp) {
  if (!timestamp) return ''
  const now = new Date()
  const historyDate = new Date(timestamp * 1000)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart - 24 * 60 * 60 * 1000)
  const hours = historyDate.getHours().toString().padStart(2, '0')
  const minutes = historyDate.getMinutes().toString().padStart(2, '0')

  if (historyDate >= todayStart) {
    return `今天 ${hours}:${minutes}`
  } else if (historyDate >= yesterdayStart) {
    return `昨天 ${hours}:${minutes}`
  } else {
    const month = (historyDate.getMonth() + 1).toString()
    const day = historyDate.getDate().toString()
    return `${month}月${day}日`
  }
}

let currentFavoritesDetailTitle = ''

async function handleFavoritesUnfavorite(video, card, mediaId, mediaName, containerId) {
  console.log('[Favorites] handleFavoritesUnfavorite called:', { video, mediaId, mediaName, containerId })
  
  if (!video || (!video.aid && !video.bvid)) {
    console.log('[Favorites] 视频信息缺失:', video)
    showToast('视频信息缺失')
    return
  }
  if (mediaId === undefined || mediaId === null || mediaId === '') {
    console.log('[Favorites] 收藏夹信息缺失:', mediaId)
    showToast('收藏夹信息缺失')
    return
  }

  const ok = await showConfirmDialog({
    title: '取消收藏',
    message: `确定要取消收藏 "${video.title}" 吗？`,
    confirmText: '取消收藏',
    cancelText: '再想想'
  })
  console.log('[Favorites] 用户确认结果:', ok)
  if (!ok) return

  const resourceId = video.aid || video.bvid
  console.log('[Favorites] 调用 unfavorite-video API:', { resources: `${resourceId}:2`, media_id: mediaId, aid: video.aid, bvid: video.bvid })
  try {
    const result = await ipcRenderer.invoke('unfavorite-video', {
      resources: `${resourceId}:2`,
      media_id: mediaId
    })
    console.log('[Favorites] API 返回结果:', result)

    if (result && result.success) {
      console.log('[Favorites] 取消收藏成功')
      showToast('已取消收藏')

      if (card) {
        const wrapper = card.closest('.video-item-wrapper')
        const targetElement = wrapper || card
        const dropdown = document.querySelector('.favorites-dropdown[style*="display: block"]')
        
        targetElement.style.transition = 'opacity 0.25s, transform 0.25s'
        targetElement.style.opacity = '0'
        targetElement.style.transform = 'scale(0.95)'
        
        setTimeout(() => {
          if (dropdown && dropdown.parentNode) dropdown.parentNode.removeChild(dropdown)
          if (targetElement.parentNode) targetElement.parentNode.removeChild(targetElement)
          checkFavoritesContainerEmpty(containerId)
          console.log('[Favorites] 卡片已移除')
        }, 250)
      }
    } else {
      console.log('[Favorites] 取消收藏失败:', result?.error)
      showToast(result?.error || '取消收藏失败')
    }
  } catch (error) {
    console.error('[Favorites] 取消收藏异常:', error)
    showToast(error?.message || '取消收藏失败')
  }
}

function showConfirmDialog({ title = '提示', message = '', confirmText = '确定', cancelText = '取消' }) {
  return new Promise(resolve => {
    let overlay = document.getElementById('favoritesConfirmOverlay')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = 'favoritesConfirmOverlay'
      overlay.className = 'favorites-confirm-overlay'
      document.body.appendChild(overlay)
    }

    overlay.innerHTML = `
      <div class="favorites-confirm-dialog" role="dialog" aria-modal="true">
        <div class="favorites-confirm-title">${escapeHtml(title)}</div>
        <div class="favorites-confirm-message">${escapeHtml(message)}</div>
        <div class="favorites-confirm-actions">
          <button class="favorites-confirm-btn favorites-confirm-cancel">${escapeHtml(cancelText)}</button>
          <button class="favorites-confirm-btn favorites-confirm-ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `

    const onKey = e => {
      if (e.key === 'Escape') close(false)
    }
    const cleanup = () => {
      overlay.innerHTML = ''
      overlay.style.display = 'none'
      document.removeEventListener('keydown', onKey, true)
    }
    const close = result => {
      cleanup()
      resolve(result)
    }

    overlay.querySelector('.favorites-confirm-cancel').onclick = () => close(false)
    overlay.querySelector('.favorites-confirm-ok').onclick = () => close(true)
    overlay.onclick = e => {
      if (e.target === overlay) close(false)
    }
    document.addEventListener('keydown', onKey, true)

    overlay.style.display = 'flex'
    setTimeout(() => overlay.querySelector('.favorites-confirm-ok').focus(), 0)
  })
}

function handleFavoritesSelectFolder(video, mediaName) {
  showToast(`当前收藏夹：${mediaName || DEFAULT_FAVORITES_NAME}`)
}

function checkFavoritesContainerEmpty(containerId) {
  const container = document.getElementById(containerId)
  if (!container) return
  const remaining = container.querySelectorAll('.video-item-wrapper')
  if (remaining.length === 0) {
    let msg = '暂无收藏内容'
    if (containerId === 'favoritesDetailList' || containerId === 'favoritesCollectionDetailList') {
      msg = '该收藏夹暂无内容'
    }
    showEmptyMessage(containerId, msg)
  }
}

function getFavoritesCardOptions(mediaId, mediaName, containerId) {
  return {
    showFavoritesMore: true,
    onUnfavorite: (video, card) => handleFavoritesUnfavorite(video, card, mediaId, mediaName, containerId),
    onSelectFolder: (video, card) => handleFavoritesSelectFolder(video, mediaName)
  }
}

function createHistoryCard(video, options = {}) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = video.bvid
  card.dataset.cid = video.cid || ''

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="" alt="${video.title}" data-src="${video.pic}">
      ${video.progress !== undefined && video.progress !== null && video.durationSeconds ? `
        <span class="video-progress">${formatDuration(video.progress)} / ${video.duration}</span>
      ` : ''}
      ${video.progress === undefined || video.progress === null ? `
        <span class="video-duration">${video.duration}</span>
      ` : ''}
    </div>
  `

  card.addEventListener('click', () => {
    if (video.bvid) playVideo(video.bvid, video.cid, video.title, video.progress)
  })

  const img = card.querySelector('.video-thumbnail img')
  setupLazyImage(img, options.eager)

  return card
}

function createHistoryVideoInfo(video, onAuthorClick) {
  const info = document.createElement('div')
  info.className = 'video-info'

  info.innerHTML = `
    <div class="video-title-row">
      <h3 class="video-title">${video.title}</h3>
      <div class="history-more-wrapper">
        <button class="history-more-btn" title="更多操作">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <circle cx="12" cy="4" r="3"/>
            <circle cx="12" cy="12" r="3"/>
            <circle cx="12" cy="20" r="3"/>
          </svg>
        </button>
        <div class="history-dropdown">
          <div class="dropdown-item delete-history-btn">删除记录</div>
        </div>
      </div>
    </div>
    <div class="video-footer">
      <div class="video-author-row">
        <svg class="up-icon up-clickable" data-mid="${video.owner?.mid || video.mid || ''}" viewBox="0 0 40 28" fill="none">
          <rect x="2" y="2" width="36" height="24" rx="6" ry="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <text x="20" y="20" text-anchor="middle" font-size="13" font-weight="bold" fill="currentColor" font-family="inherit">U P</text>
        </svg>
        <span class="video-author-name up-clickable" data-mid="${video.owner?.mid || video.mid || ''}">${video.author}</span>
      </div>
      <span class="video-play">${video.historyTime || ''}</span>
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

  const moreBtn = info.querySelector('.history-more-btn')
  const dropdown = info.querySelector('.history-dropdown')

  moreBtn.addEventListener('click', e => {
    e.stopPropagation()
    document.querySelectorAll('.history-dropdown').forEach(d => {
      if (d !== dropdown) {
        d.style.display = 'none'
      }
    })
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'
  })

  const deleteBtn = info.querySelector('.delete-history-btn')
  deleteBtn.addEventListener('click', async e => {
    e.stopPropagation()
    dropdown.style.display = 'none'

    const result = await ipcRenderer.invoke('delete-history', { kid: video.kid, business: video.business, oid: video.oid, bvid: video.bvid })
    if (result.success) {
      const wrapper = info.parentElement
      if (wrapper) wrapper.remove()
      const historyGrid = document.getElementById('historyGrid')
      if (historyGrid && historyGrid.children.length === 0) {
        showEmptyMessage('historyGrid', '暂无观看记录')
      }
    } else {
      console.error('删除历史记录失败:', result.error)
    }
  })

  document.addEventListener('click', e => {
    if (!info.contains(e.target)) {
      dropdown.style.display = 'none'
    }
  })

  return info
}

function renderHistoryVideos(videos, containerId) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''
  videos.filter(v => v.bvid || v.title).forEach((video, index) => {
    const card = createHistoryCard(video, { eager: index < EAGER_COUNT })
    const info = createHistoryVideoInfo(video, navigateToUP)
    const wrapper = document.createElement('div')
    wrapper.className = 'video-item-wrapper'
    wrapper.appendChild(card)
    wrapper.appendChild(info)
    container.appendChild(wrapper)
  })
}

function appendHistoryVideos(videos, containerId) {
  const container = document.getElementById(containerId)
  if (!container) return
  videos.filter(v => v.bvid || v.title).forEach(video => {
    const card = createHistoryCard(video)
    const info = createHistoryVideoInfo(video, navigateToUP)
    const wrapper = document.createElement('div')
    wrapper.className = 'video-item-wrapper'
    wrapper.appendChild(card)
    wrapper.appendChild(info)
    container.appendChild(wrapper)
  })
}

async function loadHistory(append = false) {
  const state = pageStates.my

  if (state.isHistoryLoading) return
  if (!append) {
    state.historyCursor = null
    state.hasMoreHistory = true
  }
  if (!state.hasMoreHistory && append) {
    return
  }

  state.isHistoryLoading = true

  try {
    const result = await ipcRenderer.invoke('get-history', state.historyCursor)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        kid: item.kid || '',
        business: item.business || 'archive',
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        duration: formatDuration(item.duration || 0),
        durationSeconds: item.duration || 0,
        progress: item.progress || null,
        author: item.author || '未知UP主',
        mid: item.authorMid || '',
        owner: item.authorMid ? { mid: item.authorMid, name: item.author || '未知UP主' } : null,
        historyTime: formatHistoryTime(item.viewAt)
      }))

      if (videos.length > 0) {
        if (append) {
          appendHistoryVideos(videos, 'historyGrid')
        } else {
          renderHistoryVideos(videos, 'historyGrid')
        }
        state.hasMoreHistory = result.hasMore
        state.historyCursor = result.nextCursor
      } else if (!append) {
        showEmptyMessage('historyGrid', '暂无观看记录')
      }
    }
  } catch (error) {
    console.error('加载历史记录失败:', error)
    if (!append) showEmptyMessage('historyGrid', '加载历史记录失败')
  } finally {
    state.isHistoryLoading = false
  }
}

async function searchHistory(keyword) {
  try {
    const result = await ipcRenderer.invoke('search-history', keyword)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        play: '观看过',
        duration: formatDuration(item.duration || 0),
        author: item.author || '未知UP主',
        mid: item.authorMid || '',
        owner: item.authorMid ? { mid: item.authorMid, name: item.author || '未知UP主' } : null
      }))

      if (videos.length > 0) {
        renderVideos(videos, 'historyGrid', navigateToUP)
      } else {
        showEmptyMessage('historyGrid', `未找到包含 "${keyword}" 的历史记录`)
      }
    } else {
      showEmptyMessage('historyGrid', `未找到包含 "${keyword}" 的历史记录`)
    }
  } catch (error) {
    console.error('搜索历史记录失败:', error)
    showEmptyMessage('historyGrid', '搜索失败')
  }
}

async function loadBangumi(type = 1) {
  try {
    const result = await ipcRenderer.invoke('get-bangumi-follow', type, 1)

    const content = document.getElementById('bangumi-content')
    const container = document.getElementById('bangumiGrid')

    if (!content || !container) {
      console.error('bangumi elements not found')
      return
    }

    content.style.display = 'block'
    container.innerHTML = ''
    container.className = 'my-anime-grid'
    container.style.display = 'grid'

    if (!result.success || !result.data || result.data.length === 0) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无追番内容</div>'
      return
    }

    result.data.forEach((item, index) => {
      const card = document.createElement('div')
      card.className = 'my-anime-card'

      const coverUrl = optimizeCoverUrl(item.cover || '', 672, 378)

      card.innerHTML = `
        <div class="my-anime-cover">
          <img src="" alt="${item.title}" data-src="${coverUrl}">
          ${item.badge ? `<span style="position: absolute; top: 8px; left: 8px; background: #fb7299; color: #fff; font-size: 12px; padding: 2px 8px; border-radius: 4px; z-index: 1;">${item.badge}</span>` : ''}
          ${item.new_ep?.index ? `<span style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); color: #fff; font-size: 12px; padding: 2px 6px; border-radius: 3px; z-index: 1;">第${item.new_ep.index}话</span>` : ''}
        </div>
        <div class="my-anime-info">
          <h3 class="my-anime-title">${item.title}</h3>
          <div class="my-anime-history">
            <span>${item.is_finish ? '已完结' : '连载中'}</span>
            ${item.stat?.follow ? `<span>${item.stat.follow.toLocaleString()}人追番</span>` : ''}
          </div>
        </div>
      `

      const img = card.querySelector('.my-anime-cover img')
      setupLazyImage(img, index < EAGER_COUNT)

      card.addEventListener('click', () => {
        playBangumi(item)
      })

      container.appendChild(card)
    })
  } catch (error) {
    console.error('加载追番失败:', error)
    const container = document.getElementById('bangumiGrid')
    if (container) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">加载失败</div>'
    }
  }
}

async function loadDrama() {
  try {
    const result = await ipcRenderer.invoke('get-bangumi-follow', 2, 1)

    const content = document.getElementById('drama-content')
    const container = document.getElementById('dramaGrid')

    if (!content || !container) {
      console.error('drama elements not found')
      return
    }

    content.style.display = 'block'
    container.innerHTML = ''
    container.className = 'my-anime-grid'
    container.style.display = 'grid'

    if (!result.success || !result.data || result.data.length === 0) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无追剧内容</div>'
      return
    }

    result.data.forEach((item, index) => {
      const card = document.createElement('div')
      card.className = 'my-anime-card'

      const coverUrl = optimizeCoverUrl(item.cover || '', 672, 378)

      card.innerHTML = `
        <div class="my-anime-cover">
          <img src="" alt="${item.title}" data-src="${coverUrl}">
          ${item.badge ? `<span style="position: absolute; top: 8px; left: 8px; background: #fb7299; color: #fff; font-size: 12px; padding: 2px 8px; border-radius: 4px; z-index: 1;">${item.badge}</span>` : ''}
          ${item.new_ep?.index ? `<span style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); color: #fff; font-size: 12px; padding: 2px 6px; border-radius: 3px; z-index: 1;">第${item.new_ep.index}集</span>` : ''}
        </div>
        <div class="my-anime-info">
          <h3 class="my-anime-title">${item.title}</h3>
          <div class="my-anime-history">
            <span>${item.is_finish ? '已完结' : '连载中'}</span>
            ${item.stat?.follow ? `<span>${item.stat.follow.toLocaleString()}人追剧</span>` : ''}
          </div>
        </div>
      `

      const img = card.querySelector('.my-anime-cover img')
      setupLazyImage(img, index < EAGER_COUNT)

      card.addEventListener('click', () => {
        playBangumi(item)
      })

      container.appendChild(card)
    })
  } catch (error) {
    console.error('加载追剧失败:', error)
    const container = document.getElementById('dramaGrid')
    if (container) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">加载失败</div>'
    }
  }
}

function formatPublishTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = now - date
  const oneDay = 24 * 60 * 60 * 1000
  
  if (diff < oneDay && date.getDate() === now.getDate()) {
    return '今天'
  } else if (diff < 2 * oneDay) {
    return '昨天'
  } else if (diff < 7 * oneDay) {
    return `${Math.floor(diff / oneDay)}天前`
  } else if (diff < 30 * oneDay) {
    return `${Math.floor(diff / (7 * oneDay))}周前`
  } else if (diff < 365 * oneDay) {
    return `${Math.floor(diff / (30 * oneDay))}个月前`
  } else {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}

async function loadFavorites(append = false) {
  const state = pageStates.my
  if (state.isFavoritesLoading) return
  if (!append) {
    state.favoritesPageNum = 1
    state.hasMoreFavorites = true
  }
  if (!state.hasMoreFavorites && append) {
    return
  }

  state.isFavoritesLoading = true

  try {
    const result = await ipcRenderer.invoke('get-favorites', DEFAULT_FAVORITES_ID, state.favoritesPageNum, 36)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        aid: item.aid || 0,
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        pubtime: item.pubtime || 0,
        fav_time: item.fav_time || 0,
        publish_date: formatPublishTime(item.pubtime || item.ctime || 0)
      }))

      if (videos.length > 0) {
        if (append) {
          appendVideos(videos, 'favoritesGrid', navigateToUP, getFavoritesCardOptions(DEFAULT_FAVORITES_ID, DEFAULT_FAVORITES_NAME, 'favoritesGrid'))
        } else {
          renderVideos(videos, 'favoritesGrid', navigateToUP, getFavoritesCardOptions(DEFAULT_FAVORITES_ID, DEFAULT_FAVORITES_NAME, 'favoritesGrid'))
        }
        state.hasMoreFavorites = result.hasMore || false
        state.favoritesPageNum++
      } else if (!append) {
        showEmptyMessage('favoritesGrid', '暂无收藏内容')
      }
    }
  } catch (error) {
    console.error('加载收藏失败:', error)
    if (!append) {
      showEmptyMessage('favoritesGrid', '加载收藏失败')
    }
  } finally {
    state.isFavoritesLoading = false
  }
}

async function loadToview(append = false) {
  const state = pageStates.my
  if (state.isToviewLoading) return
  if (!append) {
    state.toviewPageNum = 1
    state.hasMoreToview = true
  }
  if (!state.hasMoreToview && append) {
    return
  }

  state.isToviewLoading = true

  try {
    const result = await ipcRenderer.invoke('get-toview', state.toviewPageNum, 20)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        play: formatPlayCount(item.cnt_info?.view || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        progress: item.progress || 0
      }))

      if (videos.length > 0) {
        if (append) {
          appendVideos(videos, 'toviewGrid', navigateToUP)
        } else {
          renderVideos(videos, 'toviewGrid', navigateToUP)
        }
        state.hasMoreToview = result.hasMore || false
        state.toviewPageNum++
      } else if (!append) {
        showEmptyMessage('toviewGrid', '暂无稍后再看内容')
      }
    }
  } catch (error) {
    console.error('加载稍后再看失败:', error)
    if (!append) {
      showEmptyMessage('toviewGrid', '加载稍后再看失败')
    }
  } finally {
    state.isToviewLoading = false
  }
}

async function searchFavorites(keyword) {
  try {
    const result = await ipcRenderer.invoke('get-favorites', DEFAULT_FAVORITES_ID, 1, 36, keyword)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        aid: item.aid || 0,
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        pubtime: item.pubtime || 0,
        fav_time: item.fav_time || 0,
        publish_date: formatPublishTime(item.pubtime || item.ctime || 0)
      }))

      if (videos.length > 0) {
        renderVideos(videos, 'favoritesGrid', navigateToUP, getFavoritesCardOptions(DEFAULT_FAVORITES_ID, DEFAULT_FAVORITES_NAME, 'favoritesGrid'))
      } else {
        showEmptyMessage('favoritesGrid', `未找到包含 "${keyword}" 的收藏内容`)
      }
    } else {
      showEmptyMessage('favoritesGrid', `未找到包含 "${keyword}" 的收藏内容`)
    }
  } catch (error) {
    console.error('搜索收藏失败:', error)
    showEmptyMessage('favoritesGrid', '搜索失败')
  }
}

async function searchToview(keyword) {
  try {
    const result = await ipcRenderer.invoke('get-toview', 1, 20)
    if (result.success && result.data) {
      const filteredData = result.data.filter(item => {
        const title = (item.title || '').toLowerCase()
        const author = (item.author || item.upper?.name || '').toLowerCase()
        const kw = keyword.toLowerCase()
        return title.includes(kw) || author.includes(kw)
      })

      const videos = filteredData.map(item => ({
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        play: formatPlayCount(item.cnt_info?.view || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        progress: item.progress || 0
      }))

      if (videos.length > 0) {
        renderVideos(videos, 'toviewGrid', navigateToUP)
      } else {
        showEmptyMessage('toviewGrid', `未找到包含 "${keyword}" 的稍后再看内容`)
      }
    } else {
      showEmptyMessage('toviewGrid', `未找到包含 "${keyword}" 的稍后再看内容`)
    }
  } catch (error) {
    console.error('搜索稍后再看失败:', error)
    showEmptyMessage('toviewGrid', '搜索失败')
  }
}

async function loadFavoritesDefault(append = false) {
  const state = pageStates.my
  if (state.isFavoritesDefaultLoading) return
  if (!append) {
    state.favoritesDefaultPageNum = 1
    state.hasMoreFavoritesDefault = true
  }
  if (!state.hasMoreFavoritesDefault && append) {
    return
  }

  state.isFavoritesDefaultLoading = true

  try {
    const pageSize = 36
    const result = await ipcRenderer.invoke('get-favorites', DEFAULT_FAVORITES_ID, state.favoritesDefaultPageNum, pageSize)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        aid: item.aid || 0,
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        pubtime: item.pubtime || 0,
        fav_time: item.fav_time || 0,
        publish_date: formatPublishTime(item.pubtime || item.ctime || 0)
      }))

      if (videos.length > 0) {
        if (append) {
          appendVideos(videos, 'favoritesDefaultGrid', navigateToUP, getFavoritesCardOptions(DEFAULT_FAVORITES_ID, DEFAULT_FAVORITES_NAME, 'favoritesDefaultGrid'))
        } else {
          renderVideos(videos, 'favoritesDefaultGrid', navigateToUP, getFavoritesCardOptions(DEFAULT_FAVORITES_ID, DEFAULT_FAVORITES_NAME, 'favoritesDefaultGrid'))
        }
        state.hasMoreFavoritesDefault = result.hasMore || (videos.length === pageSize)
        state.favoritesDefaultPageNum++
      } else if (!append) {
        showEmptyMessage('favoritesDefaultGrid', '暂无收藏内容')
      } else {
        state.hasMoreFavoritesDefault = false
      }
    }
  } catch (error) {
    console.error('加载默认收藏夹失败:', error)
    if (!append) {
      showEmptyMessage('favoritesDefaultGrid', '加载默认收藏夹失败')
    }
  } finally {
    state.isFavoritesDefaultLoading = false
  }
}

async function loadFavoritesCreated() {
  try {
    const result = await ipcRenderer.invoke('get-favorites-created')
    if (result.success && result.data) {
      const container = document.getElementById('favoritesCreatedList')
      if (!container) return

      const createdFavorites = result.data

      const formatDate = (timestamp) => {
        if (!timestamp) return ''
        const date = new Date(timestamp * 1000)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }

      if (createdFavorites.length > 0) {
        container.innerHTML = `
          <div class="collections-series-grid">
            ${createdFavorites.map(fav => {
              const privacy = fav.attr === 0 ? '公开' : '私密'
              const dateStr = formatDate(fav.ctime)
              return `
                <div class="collections-series-item-wrapper">
                  <div class="collections-series-card" data-media-id="${fav.id}">
                    <div class="collections-series-cover">
                      <img src="${optimizeCoverUrl(fav.cover || '', 672, 378)}" alt="${fav.name}">
                      <div class="collections-series-stack">
                        <div class="collections-series-stack-item"></div>
                        <div class="collections-series-stack-item"></div>
                        <div class="collections-series-stack-item"></div>
                      </div>
                      <div class="collections-series-meta">
                        <span>${fav.media_count}个内容</span>
                        <span>·</span>
                        <span>${privacy}</span>
                      </div>
                    </div>
                  </div>
                  <div class="collections-series-info" data-media-id="${fav.id}">
                    <div class="collections-series-title-row">
                      <h3 class="collections-series-title">${fav.name}</h3>
                      <div class="collections-more-wrapper">
                        <button class="collections-more-btn" title="更多操作">
                          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <circle cx="12" cy="4" r="3"/>
                            <circle cx="12" cy="12" r="3"/>
                            <circle cx="12" cy="20" r="3"/>
                          </svg>
                        </button>
                        <div class="collections-dropdown">
                          <div class="dropdown-item edit-favorites-btn" data-media-id="${fav.id}">编辑信息</div>
                          <div class="dropdown-item delete-favorites-btn" data-media-id="${fav.id}">删除收藏夹</div>
                        </div>
                      </div>
                    </div>
                    ${dateStr ? `<p class="collections-series-date">创建于${dateStr}</p>` : ''}
                  </div>
                </div>
              `
            }).join('')}
          </div>
        `

        container.querySelectorAll('.collections-series-card').forEach(item => {
          item.addEventListener('click', () => {
            const mediaId = item.dataset.mediaId
            const title = item.querySelector('.collections-series-title')?.textContent || ''
            const cover = item.querySelector('.collections-series-cover img')?.src || ''
            const count = parseInt(item.querySelector('.collections-series-badge span')?.textContent || '0')
            showFavoritesDetail(mediaId, title, cover, count)
          })
        })

        container.querySelectorAll('.collections-more-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation()
            const dropdown = btn.nextElementSibling
            container.querySelectorAll('.collections-dropdown').forEach(d => {
              if (d !== dropdown) {
                d.style.display = 'none'
              }
            })
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'
          })
        })

        document.addEventListener('click', e => {
          if (!e.target.closest('.collections-more-wrapper')) {
            container.querySelectorAll('.collections-dropdown').forEach(dropdown => {
              dropdown.style.display = 'none'
            })
          }
        })

        container.querySelectorAll('.edit-favorites-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation()
            const mediaId = btn.dataset.mediaId
            showToast(`编辑收藏夹: ${mediaId}`)
          })
        })

        container.querySelectorAll('.delete-favorites-btn').forEach(btn => {
          btn.addEventListener('click', async e => {
            e.stopPropagation()
            const mediaId = btn.dataset.mediaId
            const ok = await showConfirmDialog({
              title: '删除收藏夹',
              message: '确定要删除这个收藏夹吗？'
            })
            if (ok) {
              showToast(`删除收藏夹: ${mediaId}`)
            }
          })
        })
      } else {
        container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无创建的收藏夹</div>'
      }
    }
  } catch (error) {
    console.error('加载我创建的收藏夹失败:', error)
    const container = document.getElementById('favoritesCreatedList')
    if (container) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">加载失败</div>'
    }
  }
}

async function loadFavoritesCollections(append = false) {
  const state = pageStates.my
  if (state.isCollectionsLoading) return
  if (!append) {
    state.collectionsPageNum = 1
    state.hasMoreCollections = true
  }
  if (!state.hasMoreCollections && append) {
    return
  }

  state.isCollectionsLoading = true

  try {
    console.log('loadFavoritesCollections called, currentUser:', currentUser)
    const userMid = currentUser?.mid ?? ''
    console.log('loadFavoritesCollections userMid:', userMid)
    if (!userMid) {
      console.error('userMid is empty, currentUser:', currentUser)
      showEmptyMessage('favoritesCollectionsGrid', '无法获取用户信息，请重新登录')
      return
    }
    const result = await ipcRenderer.invoke('get-favorites-collected', userMid, state.collectionsPageNum, 20)
    if (result.success && result.data) {
      const container = document.getElementById('favoritesCollectionsGrid')
      if (!container) return

      const favorites = result.data.map(item => ({
        id: item.id || '',
        mid: item.mid || '',
        name: item.name || '',
        cover: item.cover || '',
        media_count: item.media_count || item.count || 0,
        upper: item.upper || null
      }))

      if (favorites.length > 0) {
        if (append) {
          appendFavoritesCollectionItems(favorites, container)
        } else {
          renderFavoritesCollectionItems(favorites, container)
        }
        state.hasMoreCollections = result.hasMore || (favorites.length === 20)
        state.collectionsPageNum++
      } else if (!append) {
        showEmptyMessage('favoritesCollectionsGrid', '暂无收藏与订阅内容')
      } else {
        state.hasMoreCollections = false
      }
    }
  } catch (error) {
    console.error('加载我的收藏与订阅失败:', error)
    if (!append) {
      showEmptyMessage('favoritesCollectionsGrid', '加载失败')
    }
  } finally {
    state.isCollectionsLoading = false
  }
}

function renderFavoritesCollectionItems(favorites, container) {
  container.innerHTML = `
    <div class="collections-series-grid">
      ${favorites.map(fav => `
        <div class="collections-series-card" data-media-id="${fav.id}" data-up-mid="${fav.mid}">
          <div class="collections-series-cover">
            <img src="${optimizeCoverUrl(fav.cover || '', 672, 378)}" alt="${fav.name}">
            <div class="collections-series-stack">
              <div class="collections-series-stack-item"></div>
              <div class="collections-series-stack-item"></div>
              <div class="collections-series-stack-item"></div>
            </div>
            <div class="collections-series-meta" style="position: absolute; bottom: 8px; left: 8px; display: flex; align-items: center; gap: 4px; color: #fff; font-size: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
              <span>${fav.media_count}个内容</span>
              <span>·</span>
              <span>${fav.attr === 0 ? '公开' : '私密'}</span>
            </div>
          </div>
          <div class="collections-series-info">
            <h3 class="collections-series-title">${fav.name}</h3>
            ${fav.upper ? `<p class="collections-series-date" style="font-size: 12px; color: #999; margin-top: 4px;">${fav.upper.name || '未知'}</p>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `
  attachFavoritesCollectionListeners()
}

function appendFavoritesCollectionItems(favorites, container) {
  const grid = container.querySelector('.collections-series-grid')
  if (!grid) {
    renderFavoritesCollectionItems(favorites, container)
    return
  }
  const html = favorites.map(fav => `
    <div class="collections-series-card" data-media-id="${fav.id}" data-up-mid="${fav.mid}">
      <div class="collections-series-cover">
        <img src="${optimizeCoverUrl(fav.cover || '', 672, 378)}" alt="${fav.name}">
        <div class="collections-series-stack">
          <div class="collections-series-stack-item"></div>
          <div class="collections-series-stack-item"></div>
          <div class="collections-series-stack-item"></div>
        </div>
        <div class="collections-series-meta" style="position: absolute; bottom: 8px; left: 8px; display: flex; align-items: center; gap: 4px; color: #fff; font-size: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
          <span>${fav.media_count}个内容</span>
          <span>·</span>
          <span>${fav.attr === 0 ? '公开' : '私密'}</span>
        </div>
      </div>
      <div class="collections-series-info">
        <h3 class="collections-series-title">${fav.name}</h3>
        ${fav.upper ? `<p class="collections-series-date" style="font-size: 12px; color: #999; margin-top: 4px;">${fav.upper.name || '未知'}</p>` : ''}
      </div>
    </div>
  `).join('')
  grid.insertAdjacentHTML('beforeend', html)
  attachFavoritesCollectionListeners()
}

function attachFavoritesCollectionListeners() {
  document.querySelectorAll('#favoritesCollectionsGrid .collections-series-card').forEach(item => {
    item.addEventListener('click', () => {
      const mediaId = item.dataset.mediaId
      const title = item.querySelector('.collections-series-title')?.textContent || ''
      const cover = item.querySelector('.collections-series-cover img')?.src || ''
      const metaText = item.querySelector('.collections-series-meta')?.textContent || ''
      const countMatch = metaText.match(/(\d+)个内容/)
      const totalCount = countMatch ? parseInt(countMatch[1]) : 0
      showFavoritesCollectionDetail(mediaId, title, cover, totalCount)
    })
  })
}

let hiddenElementsForFavoritesDetail = []
let hiddenElementsForCollectionsDetail = []

function showFavoritesCollectionDetail(mediaId, title, cover, totalCount) {
  const favoritesCollectionsGrid = document.getElementById('favoritesCollectionsGrid')
  const favoritesCollectionsContent = document.getElementById('favorites-collections-content')
  const favoritesSubTabs = document.querySelector('.favorites-sub-tabs')
  const favoritesDefaultContent = document.getElementById('favorites-default-content')
  const favoritesCreatedContent = document.getElementById('favorites-created-content')
  const myHeader = document.querySelector('.my-header')
  const myTabs = document.querySelector('.my-tabs')

  hiddenElementsForCollectionsDetail = []

  if (myHeader) {
    hiddenElementsForCollectionsDetail.push({
      element: myHeader,
      display: myHeader.style.display
    })
    myHeader.style.display = 'none'
  }

  if (myTabs) {
    hiddenElementsForCollectionsDetail.push({
      element: myTabs,
      display: myTabs.style.display
    })
    myTabs.style.display = 'none'
  }

  if (favoritesSubTabs) {
    hiddenElementsForCollectionsDetail.push({
      element: favoritesSubTabs,
      display: favoritesSubTabs.style.display
    })
    favoritesSubTabs.style.display = 'none'
  }

  if (favoritesDefaultContent) {
    hiddenElementsForCollectionsDetail.push({
      element: favoritesDefaultContent,
      display: favoritesDefaultContent.style.display
    })
    favoritesDefaultContent.style.display = 'none'
  }

  if (favoritesCreatedContent) {
    hiddenElementsForCollectionsDetail.push({
      element: favoritesCreatedContent,
      display: favoritesCreatedContent.style.display
    })
    favoritesCreatedContent.style.display = 'none'
  }

  if (favoritesCollectionsContent) favoritesCollectionsContent.style.display = 'block'

  if (favoritesCollectionsGrid) {
    favoritesCollectionsGrid.classList.add('season-detail-mode')
    favoritesCollectionsGrid.innerHTML = `
      <div class="season-detail-header">
        <div class="season-detail-card">
          <div class="season-detail-cover">
            <img src="${cover}" alt="${title}">
          </div>
          <div class="season-detail-info">
            <h2 class="season-detail-title">${title}</h2>
            <p class="season-detail-meta">收藏夹 · ${totalCount}个视频</p>
            <button class="play-all-btn" onclick="playFavoritesCollectionAll(${mediaId})">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              播放全部
            </button>
          </div>
        </div>
      </div>
      <div id="favoritesCollectionDetailList" class="video-grid"></div>
      <div class="loading-more" id="favoritesCollectionDetailLoadingMore" style="display: none;">
        <span>加载中...</span>
      </div>
      <div id="favoritesCollectionDetailNoMore" class="no-more" style="display: none;">
        <span>没有更多了</span>
      </div>
    `
  }

  currentFavoritesDetailTitle = title
  loadFavoritesCollectionDetailVideos(mediaId)
}

function showFavoritesDetail(mediaId, title, cover, totalCount) {
  const favoritesCreatedList = document.getElementById('favoritesCreatedList')
  const favoritesCreatedContent = document.getElementById('favorites-created-content')
  const favoritesSubTabs = document.querySelector('.favorites-sub-tabs')
  const favoritesDefaultContent = document.getElementById('favorites-default-content')
  const favoritesCollectionsContent = document.getElementById('favorites-collections-content')
  const myHeader = document.querySelector('.my-header')
  const myTabs = document.querySelector('.my-tabs')
  
  hiddenElementsForFavoritesDetail = []
  
  if (myHeader) {
    hiddenElementsForFavoritesDetail.push({
      element: myHeader,
      display: myHeader.style.display
    })
    myHeader.style.display = 'none'
  }
  
  if (myTabs) {
    hiddenElementsForFavoritesDetail.push({
      element: myTabs,
      display: myTabs.style.display
    })
    myTabs.style.display = 'none'
  }
  
  if (favoritesSubTabs) {
    hiddenElementsForFavoritesDetail.push({
      element: favoritesSubTabs,
      display: favoritesSubTabs.style.display
    })
    favoritesSubTabs.style.display = 'none'
  }
  
  if (favoritesDefaultContent) {
    hiddenElementsForFavoritesDetail.push({
      element: favoritesDefaultContent,
      display: favoritesDefaultContent.style.display
    })
    favoritesDefaultContent.style.display = 'none'
  }
  
  if (favoritesCollectionsContent) {
    hiddenElementsForFavoritesDetail.push({
      element: favoritesCollectionsContent,
      display: favoritesCollectionsContent.style.display
    })
    favoritesCollectionsContent.style.display = 'none'
  }
  
  if (favoritesCreatedContent) favoritesCreatedContent.style.display = 'block'

  if (favoritesCreatedList) {
    favoritesCreatedList.classList.add('season-detail-mode')
    favoritesCreatedList.innerHTML = `
      <div class="season-detail-header">
        <div class="season-detail-card">
          <div class="season-detail-cover">
            <img src="${cover}" alt="${title}">
          </div>
          <div class="season-detail-info">
            <h2 class="season-detail-title">${title}</h2>
            <p class="season-detail-meta">收藏夹 · ${totalCount}个视频</p>
            <button class="play-all-btn" onclick="playFavoritesAll(${mediaId})">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              播放全部
            </button>
          </div>
        </div>
      </div>
      <div id="favoritesDetailList" class="video-grid"></div>
      <div class="loading-more" id="favoritesDetailLoadingMore" style="display: none;">
        <span>加载中...</span>
      </div>
      <div id="favoritesDetailNoMore" class="no-more" style="display: none;">
        <span>没有更多了</span>
      </div>
    `
  }

  currentFavoritesDetailTitle = title
  loadFavoritesDetailVideos(mediaId)
}

function backToFavoritesCreated() {
  const favoritesCreatedList = document.getElementById('favoritesCreatedList')
  if (favoritesCreatedList) {
    favoritesCreatedList.classList.remove('season-detail-mode')
  }
  
  hiddenElementsForFavoritesDetail.forEach(item => {
    item.element.style.display = item.display
  })
  hiddenElementsForFavoritesDetail = []
  
  document.querySelectorAll('.favorites-sub-content').forEach(c => c.style.display = 'none')
  const favoritesCreatedContent = document.getElementById('favorites-created-content')
  if (favoritesCreatedContent) favoritesCreatedContent.style.display = 'block'
  
  document.querySelectorAll('.favorites-sub-tab').forEach(t => t.classList.remove('active'))
  document.querySelector('.favorites-sub-tab[data-subtab="created"]')?.classList.add('active')
  
  loadFavoritesCreated()
}

function backToFavoritesCollections() {
  const favoritesCollectionsGrid = document.getElementById('favoritesCollectionsGrid')
  if (favoritesCollectionsGrid) {
    favoritesCollectionsGrid.classList.remove('season-detail-mode')
  }

  hiddenElementsForCollectionsDetail.forEach(item => {
    item.element.style.display = item.display
  })
  hiddenElementsForCollectionsDetail = []

  document.querySelectorAll('.favorites-sub-content').forEach(c => c.style.display = 'none')
  const favoritesCollectionsContent = document.getElementById('favorites-collections-content')
  if (favoritesCollectionsContent) favoritesCollectionsContent.style.display = 'block'

  document.querySelectorAll('.favorites-sub-tab').forEach(t => t.classList.remove('active'))
  document.querySelector('.favorites-sub-tab[data-subtab="collections"]')?.classList.add('active')

  loadFavoritesCollections()
}

function playFavoritesAll(mediaId) {
  loadFavoritesDetailVideos(mediaId, 1, 36, true)
}

function playFavoritesCollectionAll(mediaId) {
  loadFavoritesCollectionDetailVideos(mediaId, 1, 36, true)
}

async function loadFavoritesDetailVideos(mediaId, pageNum = 1, pageSize = 36, playAll = false) {
  const container = document.getElementById('favoritesDetailList')
  if (!container) return
  
  try {
    const result = await ipcRenderer.invoke('get-favorites', mediaId, pageNum, pageSize)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        aid: item.aid || 0,
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        pubtime: item.pubtime || 0,
        fav_time: item.fav_time || 0,
        publish_date: formatPublishTime(item.pubtime || item.ctime || 0)
      }))
      
      const cardOptions = getFavoritesCardOptions(mediaId, currentFavoritesDetailTitle || '收藏夹', 'favoritesDetailList')
      if (videos.length > 0) {
        if (pageNum === 1) {
          renderVideos(videos, 'favoritesDetailList', navigateToUP, cardOptions)
        } else {
          appendVideos(videos, 'favoritesDetailList', navigateToUP, cardOptions)
        }
      } else if (pageNum === 1) {
        showEmptyMessage('favoritesDetailList', '该收藏夹暂无内容')
      }
    }
  } catch (error) {
    console.error('加载收藏夹内容失败:', error)
    showEmptyMessage('favoritesDetailList', '加载失败')
  }
}

async function loadFavoritesCollectionDetailVideos(seasonId, pageNum = 1, pageSize = 36, playAll = false) {
  const container = document.getElementById('favoritesCollectionDetailList')
  if (!container) return

  try {
    const result = await ipcRenderer.invoke('get-favorites-collected-detail', seasonId, pageNum, pageSize)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        aid: item.aid || 0,
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: optimizeCoverUrl(item.pic || '', 672, 378),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' },
        pubtime: item.pubtime || 0,
        publish_date: formatPublishTime(item.pubtime || item.ctime || 0)
      }))

      const cardOptions = getFavoritesCardOptions(seasonId, currentFavoritesDetailTitle || '收藏合集', 'favoritesCollectionDetailList')
      if (videos.length > 0) {
        if (pageNum === 1) {
          renderVideos(videos, 'favoritesCollectionDetailList', navigateToUP, cardOptions)
        } else {
          appendVideos(videos, 'favoritesCollectionDetailList', navigateToUP, cardOptions)
        }
      } else if (pageNum === 1) {
        showEmptyMessage('favoritesCollectionDetailList', '该收藏夹暂无内容')
      }
    }
  } catch (error) {
    console.error('加载收藏合集内容失败:', error)
    showEmptyMessage('favoritesCollectionDetailList', '加载失败')
  }
}

