// UP主页面模块

// 动态卡片图片懒加载 Observer，替代 preloadVisibleImages 的滚动轮询
const dynamicImageObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target
      if (img.dataset.src) {
        img.src = img.dataset.src
        img.removeAttribute('data-src')
      }
      dynamicImageObserver.unobserve(img)
    }
  })
}, { rootMargin: '800px' })

function observeDynamicImages(container) {
  container.querySelectorAll('img[data-src]').forEach(img => {
    dynamicImageObserver.observe(img)
  })
}

function switchUpTab(tabName) {
  pageStates.up.currentTab = tabName

  // 切换 tab 时滚动到顶部
  const content = document.querySelector('.content')
  if (content) content.scrollTop = 0

  document.querySelectorAll('.up-tab').forEach(t => t.classList.remove('active'))
  const targetTab = document.querySelector(`.up-tab[data-tab="${tabName}"]`)
  if (targetTab) targetTab.classList.add('active')

  document.querySelectorAll('.up-tab-content').forEach(c => c.classList.remove('active'))

  const contentMap = {
    dynamics: 'upDynamicsTab',
    videos: 'upVideosTab',
    'collections-series': 'upCollectionsSeriesTab'
  }
  const contentId = contentMap[tabName]
  if (contentId) {
    const el = document.getElementById(contentId)
    if (el) el.classList.add('active')
  }

  if (tabName === 'dynamics' && pageStates.up.mid) {
    const list = document.getElementById('upDynamicsList')
    if (list && list.children.length === 0) {
      pageStates.up.dynamicOffset = ''
      pageStates.up.hasMoreDynamics = true
      loadUpDynamics(pageStates.up.mid, '')
    }
  }
}

function updateFollowButton() {
  const btn = document.querySelector('.up-actions .follow-btn')
  if (!btn) return
  const status = pageStates.up.relationStatus || 0
  const following = (status === 1 || status === 3 || status === 6)
  if (following) {
    btn.textContent = '已关注'
    btn.classList.add('followed')
  } else {
    btn.textContent = '+ 关注'
    btn.classList.remove('followed')
    hideFollowDropdown()
  }
}

function showFollowDropdown() {
  const dropdown = document.getElementById('followDropdown')
  const btn = document.querySelector('.up-actions .follow-btn')
  if (dropdown && btn) {
    const btnRect = btn.getBoundingClientRect()
    dropdown.style.left = `${btnRect.left}px`
    dropdown.style.top = `${btnRect.bottom + 8}px`
    dropdown.style.display = 'flex'
  }
}

function hideFollowDropdown() {
  const dropdown = document.getElementById('followDropdown')
  if (dropdown) {
    dropdown.style.display = 'none'
  }
}

function initFollowDropdown() {
  const btn = document.querySelector('.up-actions .follow-btn')
  const dropdown = document.getElementById('followDropdown')

  if (btn) {
    btn.removeEventListener('mouseenter', handleFollowBtnMouseEnter)
    btn.removeEventListener('mouseleave', handleFollowBtnMouseLeave)
    btn.addEventListener('mouseenter', handleFollowBtnMouseEnter)
    btn.addEventListener('mouseleave', handleFollowBtnMouseLeave)
  }

  if (dropdown) {
    dropdown.removeEventListener('mouseenter', handleDropdownMouseEnter)
    dropdown.removeEventListener('mouseleave', handleDropdownMouseLeave)
    dropdown.removeEventListener('click', handleDropdownItemClick)
    dropdown.addEventListener('mouseenter', handleDropdownMouseEnter)
    dropdown.addEventListener('mouseleave', handleDropdownMouseLeave)
    dropdown.addEventListener('click', handleDropdownItemClick)
  }
}

let dropdownTimer = null

function handleFollowBtnMouseEnter() {
  const btn = document.querySelector('.up-actions .follow-btn')
  if (btn && btn.classList.contains('followed')) {
    if (dropdownTimer) {
      clearTimeout(dropdownTimer)
      dropdownTimer = null
    }
    showFollowDropdown()
  }
}

function handleFollowBtnMouseLeave() {
  dropdownTimer = setTimeout(() => {
    hideFollowDropdown()
    dropdownTimer = null
  }, 200)
}

function handleDropdownMouseEnter() {
  if (dropdownTimer) {
    clearTimeout(dropdownTimer)
    dropdownTimer = null
  }
}

function handleDropdownMouseLeave() {
  hideFollowDropdown()
}

function handleDropdownItemClick(e) {
  const target = e.target.closest('.dropdown-item')
  if (target) {
    const action = target.dataset.action
    if (action === 'set-group') {
      hideFollowDropdown()
      showToast('设置分组功能开发中')
    } else if (action === 'unfollow') {
      hideFollowDropdown()
      toggleFollow()
    }
  }
}

async function toggleFollow() {
  const mid = pageStates.up.mid
  if (!mid) return
  const status = pageStates.up.relationStatus || 0
  const following = (status === 1 || status === 3 || status === 6)
  const act = following ? 2 : 1

  const btn = document.querySelector('.up-actions .follow-btn')
  if (btn) btn.disabled = true

  try {
    const result = await ipcRenderer.invoke('modify-up-relation', mid, act)
    if (result.success) {
      pageStates.up.relationStatus = (act === 1) ? 1 : 0
      updateFollowButton()
    } else {
      showToast(following ? '取消关注失败' : '关注失败')
    }
  } catch (error) {
    console.error('toggleFollow error:', error)
    showToast('操作失败')
  }

  if (btn) btn.disabled = false
}

async function navigateToUP(mid, isSelf = false) {
  pageStates.up.mid = mid
  pageStates.up.offset = ''
  pageStates.up.hasMore = true
  pageStates.up.loading = false
  pageStates.up.scrollLocked = false
  pageStates.up.name = ''
  pageStates.up.currentTab = 'dynamics'
  pageStates.up.dynamicOffset = ''
  pageStates.up.hasMoreDynamics = true
  pageStates.up.dynamicLoading = false
  pageStates.up.relationStatus = 0
  pageStates.up.isSelf = isSelf

  pageHistory.push(currentPage)
  if (pageHistory.length > 50) pageHistory.shift()

  currentPage = 'up'

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active')
    if (item.dataset.page === 'up') item.classList.add('active')
  })

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active')
  })

  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'))
  document.getElementById('page-up')?.classList.add('active')

  updateNavLinks('up')
  initFollowDropdown()
  updateBackButton()

  const content = document.querySelector('.content')
  if (content) {
    content.removeEventListener('scroll', throttledHandleScroll)
    content.removeEventListener('scroll', handleDynamicScroll)
    content.addEventListener('scroll', throttledHandleScroll)
  }

  resetUpProfileUI()
  console.log('Calling fetchUpInfo...')
  await fetchUpInfo(mid)
  console.log('fetchUpInfo completed')
  loadUpVideos(mid, '')
  loadUpDynamics(mid, '')
}

function resetUpProfileUI() {
  const upAvatar = document.getElementById('upAvatar')
  const upName = document.getElementById('upName')
  const upSign = document.getElementById('upSign')
  const upLevel = document.getElementById('upLevel')
  const upVip = document.getElementById('upVip')
  const followingCount = document.getElementById('followingCount')
  const fanCount = document.getElementById('fanCount')
  const viewCount = document.getElementById('viewCount')
  const upVideoGrid = document.getElementById('upVideoGrid')
  const loadingMore = document.getElementById('upLoadingMore')
  const noMore = document.getElementById('upNoMore')
  const upDynamicsList = document.getElementById('upDynamicsList')
  const dynLoadingMore = document.getElementById('upDynamicsLoadingMore')
  const dynNoMore = document.getElementById('upDynamicsNoMore')

  if (upAvatar) upAvatar.src = ''
  if (upName) upName.textContent = ''
  if (upSign) upSign.textContent = ''
  if (upLevel) { upLevel.textContent = ''; upLevel.style.display = 'none' }
  if (upVip) upVip.style.display = 'none'
  if (followingCount) followingCount.textContent = '0'
  if (fanCount) fanCount.textContent = '0'
  if (viewCount) viewCount.textContent = '0'
  if (upVideoGrid) upVideoGrid.innerHTML = ''
  if (loadingMore) loadingMore.style.display = 'none'
  if (noMore) noMore.style.display = 'none'
  if (upDynamicsList) upDynamicsList.innerHTML = ''
  if (dynLoadingMore) dynLoadingMore.style.display = 'none'
  if (dynNoMore) dynNoMore.style.display = 'none'

  const upActions = document.querySelector('.up-actions')
  if (upActions) {
    upActions.style.display = pageStates.up.isSelf ? 'none' : 'flex'
  }

  // Reset follow button
  pageStates.up.relationStatus = 0
  updateFollowButton()

  // Reset tabs to dynamics active
  document.querySelectorAll('.up-tab').forEach(t => t.classList.remove('active'))
  const dynTab = document.querySelector('.up-tab[data-tab="dynamics"]')
  if (dynTab) dynTab.classList.add('active')
  document.querySelectorAll('.up-tab-content').forEach(c => c.classList.remove('active'))
  const dynContent = document.getElementById('upDynamicsTab')
  if (dynContent) dynContent.classList.add('active')
}

async function fetchUpInfo(mid) {
  let hasFollowingStatus = false
  try {
    const result = await ipcRenderer.invoke('fetch-up-info', mid)

    if (result.success && result.data?.data) {
      const data = result.data.data
      const card = data.card
      
      // Check if there is a following field directly in the data
      if (data.following !== undefined) {
        pageStates.up.relationStatus = data.following ? 1 : 0
        updateFollowButton()
        hasFollowingStatus = true
      }

      if (card) {
        const upNameValue = card.name || card.uname || '未知'
        pageStates.up.name = upNameValue
        pageStates.up.mid = mid

        const upAvatar = document.getElementById('upAvatar')
        const upName = document.getElementById('upName')
        const upSign = document.getElementById('upSign')
        const upLevel = document.getElementById('upLevel')
        const upVip = document.getElementById('upVip')
        const followingCount = document.getElementById('followingCount')
        const fanCount = document.getElementById('fanCount')
        const viewCount = document.getElementById('viewCount')

        if (upAvatar) {
          upAvatar.src = fixImageUrl(card.face) || 'https://i0.hdslb.com/bfs/archive/placeholder.png'
          upAvatar.onerror = function() {
            this.src = 'https://i0.hdslb.com/bfs/archive/placeholder.png'
          }
        }

        if (upName) {
          upName.textContent = upNameValue
        }

        if (upSign) upSign.textContent = card.sign || '这个人很懒，什么都没有写'
        if (followingCount) followingCount.textContent = formatPlayCount(card.friend || 0)
        if (fanCount) fanCount.textContent = formatPlayCount(card.fans || 0)
        if (viewCount) viewCount.textContent = formatPlayCount(card.likes || 0)

        if (upLevel) {
          const level = card.level || 0
          upLevel.textContent = 'Lv' + level
          upLevel.style.display = level > 0 ? 'inline-block' : 'none'
        }

        if (upVip) {
          if (card.vip && card.vip.type === 2) {
            upVip.innerHTML = `<svg viewBox="0 0 32 32" class="vip-icon">
              <circle cx="16" cy="16" r="14" fill="#fb7299" />
              <text x="16" y="22" text-anchor="middle" fill="white" font-size="10" font-weight="bold">大会员</text>
            </svg>`
            upVip.style.display = 'inline-block'
          } else {
            upVip.style.display = 'none'
          }
        }

        const upActions = document.querySelector('.up-actions')
        if (upActions) {
          upActions.style.display = pageStates.up.isSelf ? 'none' : 'flex'
        }
      }
    }
  } catch (error) {
    console.error('获取UP主信息失败:', error)
  }
  
  // Only fetch relation if we didn't get following status from the main API
  if (!hasFollowingStatus) {
    await fetchUpRelation(mid)
  }
}

async function fetchUpRelation(mid) {
  try {
    const result = await ipcRenderer.invoke('fetch-up-relation', mid)
    if (result.success) {
      const attr = result.attribute
      // attribute: 0=none, 1=following, 2=followed, 3=mutual, 6=special
      const following = (attr === 1 || attr === 3 || attr === 6)
      pageStates.up.relationStatus = following ? attr : 0
    }
  } catch (error) {
    console.error('获取关注状态失败:', error)
  }
  updateFollowButton()
}

async function loadUpVideos(mid, offset = '') {
  console.log('loadUpVideos called with mid:', mid, 'offset:', offset)
  if (pageStates.up.loading) {
    console.log('Already loading, skipping...')
    return
  }

  pageStates.up.loading = true
  const loadingMore = document.getElementById('upLoadingMore')
  const noMore = document.getElementById('upNoMore')
  if (loadingMore) loadingMore.style.display = 'block'
  if (noMore) noMore.style.display = 'none'

  try {
    const result = await ipcRenderer.invoke('fetch-up-videos', mid, offset)
    console.log('fetch-up-videos result:', result)

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
          let play = ''

          if (majorModule.archive) {
            bvid = majorModule.archive.bvid || ''
            title = majorModule.archive.title || ''
            pic = majorModule.archive.cover || ''
            duration = majorModule.archive.duration_text || ''

            const stat = majorModule.archive.stat || {}
            play = formatPlayCount(stat.view || 0) + '播放'
          }

          const cid = majorModule.archive?.cid || ''

          return {
            bvid: bvid,
            cid: cid,
            title: title,
            pic: fixImageUrl(pic),
            play: play,
            duration: duration,
            author: pageStates.up.name || '未知',
            mid: mid,
            owner: { mid: mid, name: pageStates.up.name || '未知' }
          }
        }).filter(v => v.bvid)

        console.log('New videos to append:', newVideos.length)
        appendVideos(newVideos, 'upVideoGrid', navigateToUP)
        pageStates.up.hasMore = result.data.data.has_more || false
        pageStates.up.offset = result.data.data.offset || ''

        console.log('pageStates.up.hasMore:', pageStates.up.hasMore, 'pageStates.up.offset:', pageStates.up.offset)

        if (!pageStates.up.hasMore) {
          if (loadingMore) loadingMore.style.display = 'none'
          if (noMore) noMore.style.display = 'block'
        } else {
          if (loadingMore) loadingMore.style.display = 'none'
        }
      } else {
        if (loadingMore) loadingMore.style.display = 'none'
        if (noMore) noMore.style.display = 'block'
      }
    }
  } catch (error) {
    console.error('加载UP主视频失败:', error)
    if (loadingMore) loadingMore.style.display = 'none'
    if (noMore) noMore.style.display = 'block'
  }

  pageStates.up.loading = false
  pageStates.up.scrollLocked = false
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
  card.className = 'up-dynamic-card'

  // Header: avatar + name + time
  let headerHtml = '<div class="up-dynamic-header">'
  if (d.authorFace) {
    headerHtml += `<img class="up-dynamic-avatar" src="${optimizeCoverUrl(d.authorFace, 48, 48)}" alt="" onerror="this.style.display='none'">`
  }
  headerHtml += `<span class="up-dynamic-author">${escapeHtml(d.authorName)}</span>`
  headerHtml += `<span class="up-dynamic-time">${d.pubTime || timeAgo(d.pubTs)}</span>`
  headerHtml += '</div>'

  // Body
  let bodyHtml = ''
  const desc = d.desc

  // Text content
  if (desc) {
    bodyHtml += `<div class="up-dynamic-desc">${escapeHtml(desc)}</div>`
  }

  const type = d.type

  // Video card
  if (type === 'DYNAMIC_TYPE_AV' && d.bvid) {
    bodyHtml += `<div class="up-dynamic-video-card video-card" data-bvid="${d.bvid}" data-cid="${d.cid || ''}">`
    bodyHtml += `<div class="up-dynamic-video-info"><div class="up-dynamic-video-title">${escapeHtml(d.title || '')}</div>`
    bodyHtml += `<div class="up-dynamic-video-stats"><span>${formatCount(d.play)}播放</span><span>${formatCount(d.danmaku)}弹幕</span></div></div>`
    if (d.cover) {
      bodyHtml += `<div class="up-dynamic-video-cover-wrap video-thumbnail"><img class="up-dynamic-video-cover" data-src="${optimizeCoverUrl(d.cover, 672, 378)}" alt="" loading="lazy" decoding="async"><span class="up-dynamic-video-duration">${d.duration || ''}</span></div>`
    }
    bodyHtml += '</div>'
  }

  // Image grid
  if (type === 'DYNAMIC_TYPE_DRAW' && d.drawItems && d.drawItems.length > 0) {
    const count = d.drawItems.length
    const drawItemsStr = JSON.stringify(d.drawItems.map(p => fixImageUrl(p.src)))
    bodyHtml += `<div class="up-dynamic-images" data-images='${drawItemsStr}'>`
    d.drawItems.slice(0, 9).forEach((pic, index) => {
      bodyHtml += `<div class="up-dynamic-image-item" data-index="${index}"><img data-src="${optimizeCoverUrl(pic.src, 300, 300)}" alt="" loading="lazy" decoding="async"></div>`
    })
    if (count > 9) {
      bodyHtml += `<div class="up-dynamic-image-more">+${count - 9}</div>`
    }
    bodyHtml += '</div>'
  }

  // Article card
  if (type === 'DYNAMIC_TYPE_ARTICLE' && d.articleId) {
    bodyHtml += '<div class="up-dynamic-article-card">'
    if (d.cover) {
      bodyHtml += `<div class="up-dynamic-article-cover"><img data-src="${optimizeCoverUrl(d.cover, 200, 140)}" alt="" loading="lazy" decoding="async"></div>`
    }
    bodyHtml += `<div class="up-dynamic-article-info"><div class="up-dynamic-article-title">${escapeHtml(d.title || '')}</div>`
    bodyHtml += `<div class="up-dynamic-article-desc">${escapeHtml(d.articleDesc || '')}</div></div>`
    bodyHtml += '</div>'
  }

  // Forward content
  if (d.orig && d.orig.id) {
    bodyHtml += '<div class="up-dynamic-forward">'
    bodyHtml += `<div class="up-dynamic-forward-header"><span>@${escapeHtml(d.orig.authorName || '')}</span></div>`
    bodyHtml += `<div class="up-dynamic-forward-desc">${escapeHtml(d.orig.desc || '')}</div>`
    if (d.orig.bvid) {
      bodyHtml += `<div class="up-dynamic-forward-video video-card" data-bvid="${d.orig.bvid}" data-cid="${d.orig.cid || ''}">`
      if (d.orig.cover) {
        bodyHtml += `<div class="up-dynamic-forward-cover video-thumbnail"><img class="up-dynamic-video-cover" data-src="${optimizeCoverUrl(d.orig.cover, 672, 378)}" alt="" loading="lazy" decoding="async"><span class="up-dynamic-video-duration">${d.orig.duration || ''}</span></div>`
      }
      bodyHtml += `<div class="up-dynamic-video-info"><div class="up-dynamic-video-title">${escapeHtml(d.orig.title || '')}</div>`
      bodyHtml += `<div class="up-dynamic-video-stats"><span>${formatCount(d.orig.play)}播放</span><span>${formatCount(d.orig.danmaku)}弹幕</span></div></div>`
      bodyHtml += '</div>'
    }
    if (d.orig.drawItems && d.orig.drawItems.length > 0) {
      const origDrawItemsStr = JSON.stringify(d.orig.drawItems.map(p => fixImageUrl(p.src)))
      bodyHtml += `<div class="up-dynamic-images" data-images='${origDrawItemsStr}'>`
      d.orig.drawItems.slice(0, 9).forEach((pic, index) => {
        bodyHtml += `<div class="up-dynamic-image-item" data-index="${index}"><img data-src="${optimizeCoverUrl(pic.src, 300, 300)}" alt="" loading="lazy" decoding="async"></div>`
      })
      bodyHtml += '</div>'
    }
    bodyHtml += '</div>'
  }

  // Opus / general post with cover
  if ((type === 'DYNAMIC_TYPE_WORD' || type === 'DYNAMIC_TYPE_OPUS') && d.cover) {
    bodyHtml += `<div class="up-dynamic-cover-img"><img data-src="${optimizeCoverUrl(d.cover, 500, 300)}" alt="" loading="lazy" decoding="async"></div>`
  }

  // Footer with stats
  let footerHtml = '<div class="up-dynamic-footer">'
  footerHtml += `<span class="up-dynamic-stat"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${formatCount(d.like) || ''}</span>`
  footerHtml += `<span class="up-dynamic-stat"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${formatCount(d.comment) || ''}</span>`
  footerHtml += `<span class="up-dynamic-stat"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>${formatCount(d.forward_count) || ''}</span>`
  footerHtml += '</div>'

  card.innerHTML = headerHtml + bodyHtml + footerHtml

  // Click to play video
  if (d.bvid) {
    card.style.cursor = 'pointer'
    card.addEventListener('click', () => {
      playVideo(d.bvid, d.cid || '', d.title || '')
    })
  }

  return card
}

async function loadUpDynamics(mid, offset = '') {
  if (pageStates.up.dynamicLoading) return

  pageStates.up.dynamicLoading = true
  const loadingMore = document.getElementById('upDynamicsLoadingMore')
  const noMore = document.getElementById('upDynamicsNoMore')
  if (loadingMore) loadingMore.style.display = 'block'
  if (noMore) noMore.style.display = 'none'

  try {
    const result = await ipcRenderer.invoke('fetch-up-dynamics', mid, offset)
    console.log('fetch-up-dynamics result:', result)

    if (result.success && result.data) {
      const items = result.data.items || []
      console.log('Dynamics items received:', items.length)

      const list = document.getElementById('upDynamicsList')
      if (!list) return

      if (items.length > 0) {
        items.forEach((d, index) => {
          const card = createDynamicCard(d)
          list.appendChild(card)
          // 仅首屏预加载图片，后续批次由 IntersectionObserver 按需加载
          if (!offset) {
            preloadDynamicImages(d)
          }
          // 前 10 张卡片立即加载图片，其余交给 IntersectionObserver
          if (index < 10) {
            card.querySelectorAll('img[data-src]').forEach(img => {
              img.src = img.dataset.src
              img.removeAttribute('data-src')
            })
          } else {
            observeDynamicImages(card)
          }
        })

        pageStates.up.hasMoreDynamics = result.data.has_more || false
        pageStates.up.dynamicOffset = result.data.offset || ''

        if (!pageStates.up.hasMoreDynamics) {
          if (loadingMore) loadingMore.style.display = 'none'
          if (noMore) noMore.style.display = 'block'
        } else {
          if (loadingMore) loadingMore.style.display = 'none'
        }
      } else {
        if (loadingMore) loadingMore.style.display = 'none'
        if (noMore) noMore.style.display = 'block'
      }
    } else {
      if (loadingMore) loadingMore.style.display = 'none'
      if (noMore) noMore.style.display = 'block'
    }
  } catch (error) {
    console.error('加载UP主动态失败:', error)
    if (loadingMore) loadingMore.style.display = 'none'
  }

  pageStates.up.dynamicLoading = false
}

// Image preview functionality
let imagePreviewModal = null
let currentImageIndex = 0
let imageList = []

// 图片预加载管理
const imagePreloader = {
  queue: [],
  loading: false,
  maxConcurrent: 3,
  currentLoading: 0,
  maxQueue: 30,

  add(url) {
    if (!url || this.queue.includes(url) || this.queue.length >= this.maxQueue) return
    this.queue.push(url)
    this.process()
  },
  
  process() {
    if (this.loading || this.currentLoading >= this.maxConcurrent) return
    if (this.queue.length === 0) return
    
    this.loading = true
    const url = this.queue.shift()
    this.currentLoading++
    
    const img = new Image()
    img.onload = img.onerror = () => {
      this.currentLoading--
      this.loading = false
      this.process()
    }
    img.src = fixImageUrl(url)
  },
  
  addMultiple(urls) {
    urls.forEach(url => this.add(url))
  }
}

function preloadDynamicImages(d) {
  // 预加载图片类动态的图片（使用 CDN 裁剪尺寸，与 DOM 中 data-src 保持一致）
  if (d.drawItems && d.drawItems.length > 0) {
    const urls = d.drawItems.slice(0, 9).map(p => optimizeCoverUrl(p.src, 300, 300))
    imagePreloader.addMultiple(urls)
  }

  // 预加载转发内容中的图片
  if (d.orig && d.orig.drawItems && d.orig.drawItems.length > 0) {
    const urls = d.orig.drawItems.slice(0, 9).map(p => optimizeCoverUrl(p.src, 300, 300))
    imagePreloader.addMultiple(urls)
  }

  // 预加载封面图
  if (d.cover) {
    imagePreloader.add(optimizeCoverUrl(d.cover, 672, 378))
  }
  if (d.orig && d.orig.cover) {
    imagePreloader.add(optimizeCoverUrl(d.orig.cover, 672, 378))
  }
}

function createImagePreviewModal() {
  imagePreviewModal = document.createElement('div')
  imagePreviewModal.className = 'image-preview-modal'
  imagePreviewModal.style.display = 'none'
  imagePreviewModal.innerHTML = `
    <div class="image-preview-overlay" onclick="closeImagePreview()"></div>
    <div class="image-preview-content">
      <div class="image-preview-header" onclick="event.stopPropagation()">
        <button class="image-preview-download" onclick="downloadCurrentImage()" title="下载">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button class="image-preview-close" onclick="closeImagePreview()" title="关闭">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <button class="image-preview-prev" onclick="event.stopPropagation(); prevImage()" title="上一张">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="image-preview-main" onclick="closeImagePreview()">
        <img id="previewMainImage" src="" alt="">
      </div>
      <button class="image-preview-next" onclick="event.stopPropagation(); nextImage()" title="下一张">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      <div class="image-preview-thumbnails" onclick="event.stopPropagation()">
        <div id="thumbnailsContainer" class="thumbnails-container"></div>
      </div>
      <div class="image-preview-counter" id="imageCounter"></div>
    </div>
  `
  document.body.appendChild(imagePreviewModal)

  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (!imagePreviewModal || imagePreviewModal.style.display !== 'flex') return
    
    if (e.key === 'ArrowLeft') {
      prevImage()
    } else if (e.key === 'ArrowRight') {
      nextImage()
    } else if (e.key === 'Escape') {
      closeImagePreview()
    }
  })
}

function openImagePreview(images, index) {
  if (!imagePreviewModal) {
    createImagePreviewModal()
  }
  
  imageList = images
  currentImageIndex = index
  
  updatePreviewImage()
  updateThumbnails()
  updateCounter()
  
  imagePreviewModal.style.display = 'flex'
  document.body.style.overflow = 'hidden'
}

function closeImagePreview() {
  if (imagePreviewModal) {
    imagePreviewModal.style.display = 'none'
    document.body.style.overflow = ''
  }
}

function updatePreviewImage() {
  const img = document.getElementById('previewMainImage')
  if (img && imageList[currentImageIndex]) {
    img.src = imageList[currentImageIndex]
  }
}

function updateThumbnails() {
  const container = document.getElementById('thumbnailsContainer')
  if (!container) return
  
  container.innerHTML = ''
  imageList.forEach((src, index) => {
    const thumbnail = document.createElement('div')
    thumbnail.className = `thumbnail-item ${index === currentImageIndex ? 'active' : ''}`
    thumbnail.innerHTML = `<img src="${src}" alt="">`
    thumbnail.addEventListener('click', () => {
      currentImageIndex = index
      updatePreviewImage()
      updateThumbnails()
      updateCounter()
    })
    container.appendChild(thumbnail)
  })
  
  scrollToActiveThumbnail()
}

function scrollToActiveThumbnail() {
  const container = document.getElementById('thumbnailsContainer')
  if (!container) return
  
  const activeThumbnail = container.querySelector('.thumbnail-item.active')
  if (!activeThumbnail) return
  
  const containerRect = container.getBoundingClientRect()
  const thumbnailRect = activeThumbnail.getBoundingClientRect()
  
  const scrollLeft = activeThumbnail.offsetLeft - containerRect.width / 2 + thumbnailRect.width / 2
  
  container.scrollTo({
    left: Math.max(0, scrollLeft),
    behavior: 'smooth'
  })
}

function updateCounter() {
  const counter = document.getElementById('imageCounter')
  if (counter) {
    counter.textContent = `${currentImageIndex + 1} / ${imageList.length}`
  }
}

function prevImage() {
  if (currentImageIndex > 0) {
    currentImageIndex--
    updatePreviewImage()
    updateThumbnails()
    updateCounter()
  }
}

function nextImage() {
  if (currentImageIndex < imageList.length - 1) {
    currentImageIndex++
    updatePreviewImage()
    updateThumbnails()
    updateCounter()
  }
}

function downloadCurrentImage() {
  if (imageList[currentImageIndex]) {
    const link = document.createElement('a')
    link.href = imageList[currentImageIndex]
    link.download = `image_${currentImageIndex + 1}.jpg`
    link.click()
  }
}

// Initialize image preview click handlers
function initImagePreviewHandlers() {
  document.addEventListener('click', function(e) {
    const imageItem = e.target.closest('.up-dynamic-image-item')
    if (imageItem) {
      const imagesContainer = imageItem.closest('.up-dynamic-images')
      if (imagesContainer) {
        const images = JSON.parse(imagesContainer.dataset.images || '[]')
        const index = parseInt(imageItem.dataset.index || '0')
        if (images.length > 0) {
          openImagePreview(images, index)
        }
      }
    }
  })
}

// Initialize on page load
function initUpPage() {
  initImagePreviewHandlers()
  initFollowDropdown()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUpPage)
} else {
  initUpPage()
}
