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

function createHistoryCard(video, onAuthorClick) {
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.bvid = video.bvid
  card.dataset.cid = video.cid || ''

  card.innerHTML = `
    <div class="video-thumbnail">
      <img src="${video.pic}" alt="${video.title}" loading="lazy">
      ${video.progress !== undefined && video.progress !== null && video.durationSeconds ? `
        <span class="video-progress">${formatDuration(video.progress)} / ${video.duration}</span>
      ` : ''}
      ${video.progress === undefined || video.progress === null ? `
        <span class="video-duration">${video.duration}</span>
      ` : ''}
    </div>
    <div class="video-info">
      <div class="video-title-row">
        <h3 class="video-title">${video.title}</h3>
        <div class="history-more-wrapper">
          <button class="history-more-btn" title="更多操作">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="4" r="1.5"/>
              <circle cx="12" cy="12" r="1.5"/>
              <circle cx="12" cy="20" r="1.5"/>
            </svg>
          </button>
          <div class="history-dropdown">
            <div class="dropdown-item delete-history-btn">删除记录</div>
          </div>
        </div>
      </div>
      <div class="video-meta">
        <span class="video-play">${video.historyTime || ''}</span>
        <span class="video-author" data-mid="${video.owner?.mid || ''}">${video.author}</span>
      </div>
    </div>
  `

  card.addEventListener('click', () => {
    if (video.bvid) playVideo(video.bvid, video.cid, video.title, video.progress)
  })

  const authorSpan = card.querySelector('.video-author')
  authorSpan.addEventListener('click', e => {
    e.stopPropagation()
    const mid = video.owner?.mid || video.mid
    if (mid && onAuthorClick) onAuthorClick(mid)
  })

  const moreBtn = card.querySelector('.history-more-btn')
  const dropdown = card.querySelector('.history-dropdown')

  moreBtn.addEventListener('click', e => {
    e.stopPropagation()
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'
  })

  const deleteBtn = card.querySelector('.delete-history-btn')
  deleteBtn.addEventListener('click', async e => {
    e.stopPropagation()
    dropdown.style.display = 'none'

    const result = await ipcRenderer.invoke('delete-history', video.bvid)
    if (result.success) {
      card.remove()
      const historyGrid = document.getElementById('historyGrid')
      if (historyGrid && historyGrid.children.length === 0) {
        showEmptyMessage('historyGrid', '暂无观看记录')
      }
    } else {
      console.error('删除历史记录失败:', result.error)
    }
  })

  document.addEventListener('click', e => {
    if (!card.contains(e.target)) {
      dropdown.style.display = 'none'
    }
  })

  return card
}

function renderHistoryVideos(videos, containerId) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''
  videos.filter(v => v.bvid || v.title).forEach(video => container.appendChild(createHistoryCard(video, navigateToUP)))
}

function appendHistoryVideos(videos, containerId) {
  const container = document.getElementById(containerId)
  if (!container) return
  videos.filter(v => v.bvid || v.title).forEach(video => container.appendChild(createHistoryCard(video, navigateToUP)))
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
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
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
        pic: fixImageUrl(item.pic || ''),
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

    result.data.forEach(item => {
      const card = document.createElement('div')
      card.className = 'my-anime-card'

      const coverUrl = item.cover?.startsWith('//') ? 'https:' + item.cover : (item.cover || '')

      card.innerHTML = `
        <div class="my-anime-cover">
          <img src="${coverUrl}" alt="${item.title}" loading="lazy">
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

    result.data.forEach(item => {
      const card = document.createElement('div')
      card.className = 'my-anime-card'

      const coverUrl = item.cover?.startsWith('//') ? 'https:' + item.cover : (item.cover || '')

      card.innerHTML = `
        <div class="my-anime-cover">
          <img src="${coverUrl}" alt="${item.title}" loading="lazy">
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
    const result = await ipcRenderer.invoke('get-favorites', 166434448, state.favoritesPageNum, 36)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' }
      }))

      if (videos.length > 0) {
        if (append) {
          appendVideos(videos, 'favoritesGrid', navigateToUP)
        } else {
          renderVideos(videos, 'favoritesGrid', navigateToUP)
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
        pic: fixImageUrl(item.pic || ''),
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
    const result = await ipcRenderer.invoke('get-favorites', 166434448, 1, 36, keyword)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        cid: item.cid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' }
      }))

      if (videos.length > 0) {
        renderVideos(videos, 'favoritesGrid', navigateToUP)
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
        pic: fixImageUrl(item.pic || ''),
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
