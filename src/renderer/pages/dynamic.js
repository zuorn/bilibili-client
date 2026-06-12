const dynamicPageImageObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target
      if (img.dataset.src) {
        img.src = img.dataset.src
        img.removeAttribute('data-src')
      }
      dynamicPageImageObserver.unobserve(img)
    }
  })
}, { rootMargin: '800px' })

function observeDynamicPageImages(container) {
  container.querySelectorAll('img[data-src]').forEach(img => {
    dynamicPageImageObserver.observe(img)
  })
}

function getDynamicDisplayText(d) {
  if (typeof d.desc === 'string' && d.desc) return d.desc
  if (d.desc?.text) return d.desc.text
  if (d.desc?.rich_text_nodes?.length) {
    return d.desc.rich_text_nodes.map(n => n.text || n.orig_text || '').join('')
  }
  if (typeof d.opusSummary === 'string') return d.opusSummary
  if (d.opusSummary?.text) return d.opusSummary.text
  if (d.opusSummary?.rich_text_nodes?.length) {
    return d.opusSummary.rich_text_nodes.map(n => n.text || n.orig_text || '').join('')
  }
  return ''
}

// 生成带展开/收起功能的文本HTML
function createExpandableText(text, maxLength = 500) {
  if (!text) return ''
  
  // 移除开头的空白字符（解决第一行缩进问题）
  let processedText = text.replace(/^[\s\n]+/, '')
  // 将换行符转换为<br>标签
  processedText = processedText.replace(/\n/g, '<br>')
  
  // 计算文本长度（只计算纯文本内容，不计算HTML标签）
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = processedText
  const plainText = tempDiv.textContent || tempDiv.innerText || ''
  
  let charCount = 0
  for (let i = 0; i < plainText.length; i++) {
    charCount += /[\u4e00-\u9fa5]/.test(plainText[i]) ? 2 : 1
  }
  
  // 如果文本长度未超过限制，直接返回
  if (charCount <= maxLength) {
    return processedText
  }
  
  // 需要截取，保留HTML标签的同时截取文本
  let truncatedHtml = ''
  let currentLength = 0
  let i = 0
  
  while (i < processedText.length && currentLength < maxLength) {
    // 检查是否遇到HTML标签
    if (processedText[i] === '<') {
      // 找到标签结束位置
      const tagEnd = processedText.indexOf('>', i)
      if (tagEnd !== -1) {
        // 将整个标签添加到结果中
        truncatedHtml += processedText.substring(i, tagEnd + 1)
        i = tagEnd + 1
        continue
      }
    }
    
    const char = processedText[i]
    // 跳过<br>标签已处理的换行符
    if (char === '<') {
      i++
      continue
    }
    
    const charLen = /[\u4e00-\u9fa5]/.test(char) ? 2 : 1
    if (currentLength + charLen <= maxLength) {
      truncatedHtml += char
      currentLength += charLen
    } else {
      break
    }
    i++
  }
  
  // 生成带展开收起按钮的HTML
  return `
    <span class="dynamic-desc-text">${truncatedHtml}...</span>
    <span class="dynamic-desc-full" style="display: none;">${processedText}</span>
    <span class="dynamic-desc-expand-btn" data-expanded="false">展开全部</span>
  `
}

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

      // Bilibili API 返回的 up 列表在 items 字段中
      const upList = portalData.items || portalData.up_list || []
      
      if (Array.isArray(upList) && upList.length > 0) {
        console.log('Found up list array, length:', upList.length)

        followings = upList.map(item => ({
          mid: item.mid || '',
          name: item.uname || item.name || '',
          face: item.face || '',
          official: item.official_verify || null,
          vip: item.vip || null,
          has_update: item.has_update || false
        }))

        console.log('Parsed followings count:', followings.length)
      } else {
        console.log('No up list found in portal data, keys:', Object.keys(portalData))
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

async function fetchDynamics(upMid = null, offset = '', type = '') {
  console.log('=== fetchDynamics called ===', { upMid, offset, type })
  try {
    const result = await ipcRenderer.invoke('get-user-dynamics', upMid, offset, type)
    console.log('fetchDynamics result:', result)
    if (result.success && result.data) {
      const items = result.data.items || []
      console.log('fetchDynamics items count:', items.length)
      return {
        items: items,
        has_more: result.data.has_more,
        next_offset: result.data.next_offset
      }
    } else {
      console.log('fetchDynamics failed:', result.error)
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
    if (dynamic.bvid) {
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
    const isFirstLoad = (offset === '')
    const allItems = []
    let currentOffset = offset
    let hasMore = true
    let batchCount = 0
    const maxBatches = isFirstLoad ? 2 : 1  // 首次加载连续请求2批

    while (batchCount < maxBatches && hasMore) {
      const result = await fetchDynamics(upId, currentOffset, 'video')
      batchCount++

      if (result.items && result.items.length > 0) {
        allItems.push(...result.items)
      }

      hasMore = result.has_more
      currentOffset = result.next_offset || ''

      // 首次加载时：如果已有40+条且还有更多，就再要一批
      // 如果没有更多了，停止循环
      if (!hasMore) break
      if (isFirstLoad && allItems.length >= 60) break
      if (!isFirstLoad) break
    }

    dynamicHasMore = hasMore
    currentDynamicOffset = currentOffset

    if (allItems.length > 0) {
      renderDynamicVideos(allItems, navigateToUP)

      // 首次加载后，如果还有更多数据，检测是否需要继续填充
      if (isFirstLoad && hasMore) {
        setTimeout(() => {
          const content = document.querySelector('.content')
          if (content && !isDynamicLoading) {
            if (content.scrollHeight <= content.clientHeight * 1.5) {
              loadDynamicVideos(upId, currentDynamicOffset)
            }
          }
        }, 100)
      }

      if (!hasMore) {
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
  } finally {
    isDynamicLoading = false
  }
}

function createDynamicCard(d) {
  const card = document.createElement('div')
  card.className = 'dynamic-card'
  card.dataset.dynamicId = d.id || ''
  card.dataset.authorMid = d.authorMid || ''
  card.dataset.bvid = d.bvid || ''

  let headerHtml = '<div class="dynamic-header">'
  if (d.authorFace) {
    headerHtml += `<img class="dynamic-avatar dynamic-author-click" data-mid="${d.authorMid}" src="${optimizeCoverUrl(d.authorFace, 48, 48)}" alt="" onerror="this.style.display='none'">`
  }
  headerHtml += '<div class="dynamic-author-info">'
  headerHtml += `<span class="dynamic-author dynamic-author-click" data-mid="${d.authorMid}">${escapeHtml(d.authorName)}</span>`
  headerHtml += `<span class="dynamic-time">${d.pubTime || timeAgo(d.pubTs)}</span>`
  headerHtml += '</div>'
  headerHtml += '<div class="dynamic-more-btn" data-dynamic-id="' + (d.id || '') + '" data-author-mid="' + (d.authorMid || '') + '" data-bvid="' + (d.bvid || '') + '">'
  headerHtml += '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>'
  headerHtml += '</div>'
  headerHtml += '</div>'

  let bodyHtml = ''
  const desc = getDynamicDisplayText(d)

  if (desc) {
    bodyHtml += `<div class="dynamic-desc">${createExpandableText(desc)}</div>`
  }

  if (d.bvid) {
    bodyHtml += `<div class="dynamic-video-card video-card" data-bvid="${d.bvid}" data-cid="${d.cid || ''}">`
    bodyHtml += `<div class="dynamic-video-info"><div class="dynamic-video-title">${escapeHtml(d.title || '')}</div></div>`
    if (d.cover) {
      bodyHtml += `<div class="dynamic-video-cover-wrap video-thumbnail"><img class="dynamic-video-cover" data-src="${optimizeCoverUrl(d.cover, 672, 378)}" alt="" loading="lazy" decoding="async">`
      bodyHtml += `<div class="dynamic-video-stats"><span class="dynamic-video-duration">${d.duration || ''}</span><span class="dynamic-video-play">${formatCount(d.play)}播放</span><span class="dynamic-video-danmaku">${formatCount(d.danmaku)}弹幕</span></div>`
      bodyHtml += `</div>`
    }
    bodyHtml += '</div>'
  }

  if (d.drawItems && d.drawItems.length > 0) {
    const count = d.drawItems.length
    const drawItemsStr = JSON.stringify(d.drawItems.map(p => fixImageUrl(p.src)))
    bodyHtml += `<div class="dynamic-images" data-images='${drawItemsStr}'>`
    d.drawItems.slice(0, 9).forEach((pic, index) => {
      // 检测长图（高度是宽度的2倍以上）
      const isLongImage = pic.height && pic.width && pic.height / pic.width >= 2
      const longClass = isLongImage ? 'dynamic-image-long' : ''
      bodyHtml += `<div class="dynamic-image-item ${longClass}" data-index="${index}"><img data-src="${optimizeCoverUrl(pic.src, 300, 300)}" alt="" loading="lazy" decoding="async"></div>`
    })
    if (count > 9) {
      bodyHtml += `<div class="dynamic-image-more">+${count - 9}</div>`
    }
    bodyHtml += '</div>'
  }

  if (d.articleId) {
    bodyHtml += '<div class="dynamic-article-card">'
    if (d.cover) {
      bodyHtml += `<div class="dynamic-article-cover"><img data-src="${optimizeCoverUrl(d.cover, 200, 140)}" alt="" loading="lazy" decoding="async"></div>`
    }
    bodyHtml += `<div class="dynamic-article-info"><div class="dynamic-article-title">${escapeHtml(d.title || '')}</div>`
    bodyHtml += `<div class="dynamic-article-desc">${escapeHtml(d.articleDesc || '')}</div></div>`
    bodyHtml += '</div>'
  }

  // 直播推荐动态
  if (d.liveRoomId) {
    bodyHtml += `<div class="dynamic-live-card" data-room-id="${d.liveRoomId}" data-live-link="${d.liveLink || ''}">`
    bodyHtml += '<div class="dynamic-live-badge">直播中</div>'
    if (d.liveCover) {
      bodyHtml += `<div class="dynamic-live-cover"><img data-src="${optimizeCoverUrl(d.liveCover, 672, 378)}" alt="" loading="lazy" decoding="async">`
      bodyHtml += `<div class="dynamic-live-stats"><span class="dynamic-live-online">${formatCount(d.liveOnline)}观看</span><span class="dynamic-live-area">${escapeHtml(d.liveArea || '')}</span></div>`
      bodyHtml += '</div>'
    }
    bodyHtml += `<div class="dynamic-live-info"><div class="dynamic-live-title">${escapeHtml(d.liveTitle || '')}</div></div>`
    bodyHtml += '</div>'
  }

  if (d.orig && d.orig.id) {
    bodyHtml += '<div class="dynamic-forward">'
    bodyHtml += `<div class="dynamic-forward-header"><span class="dynamic-forward-author" data-mid="${d.orig.authorMid || 0}">@${escapeHtml(d.orig.authorName || '')}</span></div>`
    bodyHtml += `<div class="dynamic-forward-desc">${escapeHtmlWithEmoji(d.orig.desc || '')}</div>`
    if (d.orig.bvid) {
      bodyHtml += `<div class="dynamic-forward-video video-card" data-bvid="${d.orig.bvid}" data-cid="${d.orig.cid || ''}" data-title="${escapeHtml(d.orig.title || '')}">`
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
        // 检测长图（高度是宽度的2倍以上）
        const isLongImage = pic.height && pic.width && pic.height / pic.width >= 2
        const longClass = isLongImage ? 'dynamic-image-long' : ''
        bodyHtml += `<div class="dynamic-image-item ${longClass}" data-index="${index}"><img data-src="${optimizeCoverUrl(pic.src, 300, 300)}" alt="" loading="lazy" decoding="async"></div>`
      })
      bodyHtml += '</div>'
    }
    bodyHtml += '</div>'
  }

  if (d.cover && !d.bvid && !(d.drawItems && d.drawItems.length > 0) && !d.liveRoomId) {
    bodyHtml += `<div class="dynamic-cover-img"><img data-src="${optimizeCoverUrl(d.cover, 500, 300)}" alt="" loading="lazy" decoding="async"></div>`
  }

  let footerHtml = '<div class="dynamic-footer">'
  footerHtml += `<span class="dynamic-stat"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>转发</span>`
  footerHtml += `<span class="dynamic-stat"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>${formatCount(d.comment) || ''}</span>`
  footerHtml += `<span class="dynamic-stat"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>${formatCount(d.like) || ''}</span>`
  footerHtml += '</div>'

  card.innerHTML = headerHtml + bodyHtml + footerHtml

  // 点击头像和作者名称跳转到UP主页面
  card.querySelectorAll('.dynamic-author-click').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const mid = el.dataset.mid
      if (mid) navigateToUP(mid)
    })
  })

  // 点击话题标签进行搜索
  card.querySelectorAll('.dynamic-topic').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const topicName = el.dataset.topicName
      if (topicName) {
        // 跳转到搜索页面，搜索话题
        window.location.hash = `#/search/${encodeURIComponent(topicName)}`
      }
    })
  })

  // 转发作者名称点击事件
  card.querySelectorAll('.dynamic-forward-author').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const mid = el.dataset.mid
      if (mid) navigateToUP(mid)
    })
  })

  // 转发视频点击事件
  card.querySelectorAll('.dynamic-forward-video.video-card').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const bvid = el.dataset.bvid
      const cid = el.dataset.cid || ''
      const title = el.dataset.title || ''
      if (bvid) {
        playVideo(bvid, cid, title)
      }
    })
  })

  // 展开/收起按钮点击事件
  card.querySelectorAll('.dynamic-desc-expand-btn').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const isExpanded = el.dataset.expanded === 'true'
      // 获取兄弟元素：.dynamic-desc-full（完整文本）是按钮的前一个元素
      const descFull = el.previousElementSibling
      // .dynamic-desc-text（截断文本）是完整文本的前一个元素
      const descText = descFull?.previousElementSibling
      
      if (isExpanded) {
        // 收起：显示截断文本，隐藏完整文本
        descFull.style.display = 'none'
        descText.style.display = 'inline'
        el.textContent = '展开全部'
        el.dataset.expanded = 'false'
      } else {
        // 展开：隐藏截断文本，显示完整文本
        descText.style.display = 'none'
        descFull.style.display = 'inline'
        el.textContent = '收起'
        el.dataset.expanded = 'true'
      }
    })
  })

  // @提及用户点击事件
  card.querySelectorAll('.dynamic-at').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const uid = el.dataset.uid
      if (uid) navigateToUP(uid)
    })
  })

  // 视频链接点击事件
  card.querySelectorAll('.dynamic-video-link').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const bvid = el.dataset.bvid
      if (bvid) playVideo(bvid, '', '')
    })
  })

  if (d.bvid) {
    card.style.cursor = 'pointer'
    card.addEventListener('click', () => {
      playVideo(d.bvid, d.cid || '', d.title || '')
    })
  }

  // 更多按钮点击事件
  const moreBtn = card.querySelector('.dynamic-more-btn')
  if (moreBtn) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      showDynamicMoreMenu(moreBtn, d)
    })
  }

  return card
}

// 显示动态更多菜单
function showDynamicMoreMenu(button, dynamic) {
  // 移除已有的菜单
  const existingMenu = document.getElementById('dynamicMoreMenu')
  if (existingMenu) existingMenu.remove()

  const rect = button.getBoundingClientRect()
  const menu = document.createElement('div')
  menu.id = 'dynamicMoreMenu'
  menu.className = 'dynamic-more-menu'
  menu.style.left = rect.left + 'px'
  menu.style.top = (rect.bottom + 4) + 'px'

  const items = []

  // 稍后再看（仅当有视频时）
  if (dynamic.bvid) {
    items.push({
      label: '稍后再看',
      action: () => addDynamicToWatchlater(dynamic.bvid, dynamic)
    })
  }

  // 取消关注
  items.push({
    label: '取消关注',
    action: () => unfollowUpFromDynamic(dynamic.authorMid, dynamic.authorName)
  })

  // 复制动态地址
  items.push({
    label: '复制动态地址',
    action: () => copyDynamicUrl(dynamic)
  })

  items.forEach(item => {
    const menuItem = document.createElement('div')
    menuItem.className = 'dynamic-more-menu-item'
    menuItem.textContent = item.label
    menuItem.addEventListener('click', (e) => {
      e.stopPropagation()
      item.action()
      menu.remove()
    })
    menu.appendChild(menuItem)
  })

  document.body.appendChild(menu)

  // 点击其他区域关闭菜单
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== button) {
        menu.remove()
        document.removeEventListener('click', closeHandler)
      }
    }
    document.addEventListener('click', closeHandler)
  }, 10)
}

// 添加到稍后再看
async function addDynamicToWatchlater(bvid, dynamic) {
  try {
    const result = await ipcRenderer.invoke('add-to-watchlater', bvid)
    if (result.success) {
      showToast('已添加到稍后再看')
    } else {
      showToast('添加失败：' + (result.data?.message || '未知错误'))
    }
  } catch (error) {
    console.error('Error adding to watchlater:', error)
    showToast('添加失败')
  }
}

// 取消关注 UP 主
async function unfollowUpFromDynamic(mid, authorName) {
  if (!confirm(`确定取消关注 ${escapeHtml(authorName || '该 UP 主')}？`)) return
  try {
    const result = await ipcRenderer.invoke('unfollow-up-from-dynamic', mid)
    if (result.success) {
      showToast('已取消关注')
    } else {
      showToast('取消关注失败：' + (result.data?.message || '未知错误'))
    }
  } catch (error) {
    console.error('Error unfollowing:', error)
    showToast('取消关注失败')
  }
}

// 复制动态地址
function copyDynamicUrl(dynamic) {
  const url = `https://t.bilibili.com/${dynamic.id || ''}`
  navigator.clipboard.writeText(url).then(() => {
    showToast('已复制动态地址')
  }).catch(() => {
    // 备用方案
    const textarea = document.createElement('textarea')
    textarea.value = url
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    showToast('已复制动态地址')
  })
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
    const isFirstLoad = (offset === '')
    const allItems = []
    let currentOffset = offset
    let hasMore = true
    let batchCount = 0
    const maxBatches = isFirstLoad ? 1 : 1

    while (batchCount < maxBatches && hasMore) {
      const result = await fetchDynamics(upId, currentOffset)
      batchCount++

      if (result.items && result.items.length > 0) {
        allItems.push(...result.items)
      }

      hasMore = result.has_more || false
      currentOffset = result.next_offset || ''

      if (!hasMore) break
      if (isFirstLoad && allItems.length >= 40) break
      if (!isFirstLoad) break
    }

    dynamicContentHasMore = hasMore
    dynamicContentOffset = currentOffset

    const list = document.getElementById('dynamicDynamicsList')
    if (!list) return

    if (allItems.length > 0) {
      allItems.forEach((d, index) => {
        const card = createDynamicCard(d)
        list.appendChild(card)
        if (index < 15) {
          card.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.dataset.src
            img.removeAttribute('data-src')
          })
        } else {
          observeDynamicPageImages(card)
        }
      })

      // 首次加载后检测是否需要继续填充
      if (isFirstLoad && hasMore) {
        setTimeout(() => {
          const content = document.querySelector('.content')
          if (content && !isDynamicContentLoading) {
            if (content.scrollHeight <= content.clientHeight * 1.5) {
              loadDynamicContent(upId, dynamicContentOffset)
            }
          }
        }, 100)
      }

      if (!hasMore) {
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
  } finally {
    isDynamicContentLoading = false
  }
}

function activateDynamicTab(tabName) {
  document.querySelectorAll('.nav-link[data-page="dynamic"]').forEach(t => t.classList.remove('active'))
  const targetTab = document.querySelector(`.nav-link[data-page="dynamic"][data-subtab="${tabName}"]`)
  if (targetTab) targetTab.classList.add('active')

  document.querySelectorAll('.dynamic-tab-content').forEach(c => c.classList.remove('active'))
  const contentMap = {
    dynamics: 'dynamicDynamicsTab',
    videos: 'dynamicVideosTab'
  }
  const el = document.getElementById(contentMap[tabName])
  if (el) el.classList.add('active')
}

function switchDynamicTab(tabName) {
  const content = document.querySelector('.content')
  if (content) content.scrollTop = 0

  activateDynamicTab(tabName)

  if (tabName === 'dynamics') {
    const list = document.getElementById('dynamicDynamicsList')
    if (list && list.children.length === 0) {
      dynamicContentOffset = ''
      dynamicContentHasMore = true
      loadDynamicContent(currentUpId, '')
    }
  } else if (tabName === 'videos') {
    const container = document.getElementById('videoContainer')
    if (container && container.children.length === 0) {
      currentDynamicOffset = ''
      dynamicHasMore = true
      loadDynamicVideos(currentUpId, '')
    }
  }
}

function selectDynamicUp(upId, upName) {
  currentUpId = upId
  currentDynamicOffset = ''
  dynamicHasMore = true
  dynamicContentOffset = ''
  dynamicContentHasMore = true
  isDynamicLoading = false
  isDynamicContentLoading = false

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

  const content = document.querySelector('.content')
  if (content) content.scrollTop = 0

  loadDynamicVideos(upId, '')
  loadDynamicContent(upId, '')
}

function selectAllDynamic() {
  currentUpId = null
  currentDynamicOffset = ''
  dynamicHasMore = true
  dynamicContentOffset = ''
  dynamicContentHasMore = true
  isDynamicLoading = false
  isDynamicContentLoading = false

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

  const content = document.querySelector('.content')
  if (content) content.scrollTop = 0

  loadDynamicVideos(null, '')
  loadDynamicContent(null, '')
}

function handleDynamicScroll() {
  const content = document.querySelector('.content')
  if (!content) return

  const { scrollTop, scrollHeight, clientHeight } = content

  // 获取当前激活的 dynamic tab（通过 nav-link 获取）
  const activeNavLink = document.querySelector('.nav-link[data-page="dynamic"].active')
  const activeTab = activeNavLink?.dataset.subtab

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

// 滚动时显示滚动条，停止滚动后延时隐藏
function initDynamicSidebarScroll(sidebar) {
  if (!sidebar) return
  let scrollTimer
  sidebar.addEventListener('scroll', () => {
    sidebar.classList.add('is-scrolling')
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => {
      sidebar.classList.remove('is-scrolling')
    }, 600)
  })
}

async function initDynamicPage() {
  const videoContainer = document.getElementById('videoContainer')
  const followingList = document.getElementById('followingList')

  activateDynamicTab('dynamics')

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

  // 滚动时才显示滚动条
  initDynamicSidebarScroll(followingList)

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

  // 注意：nav-link 的点击事件已在 event-listeners.js 中统一处理
  // 这里不需要重复绑定 .dynamic-tab 的事件

  initImagePreview()
}

// 图片预览功能
let dynamicPreviewImages = []
let dynamicPreviewIndex = 0
let imagePreviewInited = false
let dynamicPreviewScale = 1
let dynamicPreviewTranslateX = 0
let dynamicPreviewTranslateY = 0

function initImagePreview() {
  if (imagePreviewInited) return
  imagePreviewInited = true

  // 点击图片网格中的图片
  document.addEventListener('click', (e) => {
    const imageItem = e.target.closest('.dynamic-image-item')
    if (imageItem) {
      const imagesContainer = imageItem.closest('.dynamic-images')
      if (imagesContainer) {
        const imagesData = imagesContainer.dataset.images
        if (imagesData) {
          dynamicPreviewImages = JSON.parse(imagesData)
          dynamicPreviewIndex = parseInt(imageItem.dataset.index) || 0
          openImagePreview()
        }
      }
    }
  })

  // 上一张按钮
  const prevBtn = document.getElementById('imagePreviewPrev')
  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (dynamicPreviewIndex > 0) {
        dynamicPreviewIndex--
        resetDynamicPreviewZoom()
        updateImagePreview()
      }
    })
  }

  // 下一张按钮
  const nextBtn = document.getElementById('imagePreviewNext')
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (dynamicPreviewIndex < dynamicPreviewImages.length - 1) {
        dynamicPreviewIndex++
        resetDynamicPreviewZoom()
        updateImagePreview()
      }
    })
  }

  // 下载按钮
  const downloadBtn = document.getElementById('imagePreviewDownload')
  if (downloadBtn) {
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      downloadCurrentImage()
    })
  }

  // 关闭按钮
  const closeBtn = document.getElementById('imagePreviewClose')
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      closeImagePreview()
    })
  }

  // 遮罩层点击关闭
  const overlay = document.getElementById('imagePreviewOverlay')
  if (overlay) {
    overlay.addEventListener('click', closeImagePreview)
  }

  // 图片区域点击关闭（点击非按钮区域关闭，未缩放时才关闭）
  const mainArea = document.getElementById('imagePreviewMain')
  if (mainArea) {
    mainArea.addEventListener('click', (e) => {
      if (dynamicPreviewScale === 1) {
        closeImagePreview()
      }
    })
  }

  // 滚轮缩放
  const modal = document.getElementById('imagePreviewModal')
  if (modal) {
    modal.addEventListener('wheel', (e) => {
      e.preventDefault()
      const img = document.getElementById('imagePreviewImg')
      if (!img) return
      
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      let newScale = dynamicPreviewScale * delta
      newScale = Math.max(0.5, Math.min(5, newScale))
      
      // 以鼠标位置为中心进行缩放
      const rect = img.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const mouseX = e.clientX
      const mouseY = e.clientY
      
      const scaleRatio = newScale / dynamicPreviewScale
      dynamicPreviewTranslateX = mouseX - centerX + (dynamicPreviewTranslateX - (mouseX - centerX)) * scaleRatio
      dynamicPreviewTranslateY = mouseY - centerY + (dynamicPreviewTranslateY - (mouseY - centerY)) * scaleRatio
      
      dynamicPreviewScale = newScale
      applyDynamicPreviewTransform()
    }, { passive: false })
  }

  // 双击图片重置缩放
  const previewImg = document.getElementById('imagePreviewImg')
  if (previewImg) {
    previewImg.addEventListener('dblclick', () => {
      resetDynamicPreviewZoom()
    })
  }

  // 拖拽移动放大后的图片
  let isDragging = false
  let dragStartX = 0
  let dragStartY = 0
  let dragStartTranslateX = 0
  let dragStartTranslateY = 0

  if (previewImg) {
    previewImg.addEventListener('mousedown', (e) => {
      if (dynamicPreviewScale > 1) {
        isDragging = true
        dragStartX = e.clientX
        dragStartY = e.clientY
        dragStartTranslateX = dynamicPreviewTranslateX
        dragStartTranslateY = dynamicPreviewTranslateY
        previewImg.style.cursor = 'grabbing'
        e.preventDefault()
      }
    })
  }

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      dynamicPreviewTranslateX = dragStartTranslateX + (e.clientX - dragStartX)
      dynamicPreviewTranslateY = dragStartTranslateY + (e.clientY - dragStartY)
      applyDynamicPreviewTransform()
    }
  })

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false
      const imgEl = document.getElementById('imagePreviewImg')
      if (imgEl) {
        imgEl.style.cursor = dynamicPreviewScale > 1 ? 'grab' : 'default'
      }
    }
  })

  // 缩略图点击
  const thumbnailsContainer = document.getElementById('imagePreviewThumbnails')
  if (thumbnailsContainer) {
    thumbnailsContainer.addEventListener('click', (e) => {
      const thumbnailItem = e.target.closest('.thumbnail-item')
      if (thumbnailItem) {
        dynamicPreviewIndex = parseInt(thumbnailItem.dataset.index) || 0
        resetDynamicPreviewZoom()
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
        if (dynamicPreviewIndex > 0) {
          dynamicPreviewIndex--
          resetDynamicPreviewZoom()
          updateImagePreview()
        }
      } else if (e.key === 'ArrowRight') {
        if (dynamicPreviewIndex < dynamicPreviewImages.length - 1) {
          dynamicPreviewIndex++
          resetDynamicPreviewZoom()
          updateImagePreview()
        }
      }
    }
  })
}

function openImagePreview() {
  const modal = document.getElementById('imagePreviewModal')
  if (modal) {
    resetDynamicPreviewZoom()
    modal.style.display = 'flex'
    renderThumbnails()
    updateImagePreview()
  }
}

function closeImagePreview() {
  const modal = document.getElementById('imagePreviewModal')
  if (modal) {
    modal.style.display = 'none'
    resetDynamicPreviewZoom()
  }
}

function resetDynamicPreviewZoom() {
  dynamicPreviewScale = 1
  dynamicPreviewTranslateX = 0
  dynamicPreviewTranslateY = 0
  applyDynamicPreviewTransform()
}

function applyDynamicPreviewTransform() {
  const img = document.getElementById('imagePreviewImg')
  if (img) {
    img.style.transform = `translate(${dynamicPreviewTranslateX}px, ${dynamicPreviewTranslateY}px) scale(${dynamicPreviewScale})`
    img.style.cursor = dynamicPreviewScale > 1 ? 'grab' : 'default'
  }
}

function renderThumbnails() {
  const thumbnailsContainer = document.getElementById('imagePreviewThumbnails')
  if (thumbnailsContainer) {
    thumbnailsContainer.innerHTML = dynamicPreviewImages.map((src, index) => {
      // 缩略图使用小尺寸压缩
      const thumbSrc = optimizePreviewUrl(src, 100, 100)
      return `<div class="thumbnail-item ${index === dynamicPreviewIndex ? 'active' : ''}" data-index="${index}">
        <img src="${thumbSrc}" alt="">
      </div>`
    }).join('')
  }
}

function optimizePreviewUrl(url, width, height) {
  if (!url) return url
  // 如果已经有 @ 参数，先移除再添加新的
  const baseUrl = url.split('@')[0]
  return baseUrl + '@' + width + 'w_' + height + 'h_1e_1c.webp'
}

function updateImagePreview() {
  const img = document.getElementById('imagePreviewImg')
  const counter = document.getElementById('imagePreviewCounter')

  if (img && dynamicPreviewImages[dynamicPreviewIndex]) {
    // 预览时使用原图（移除可能存在的压缩参数），保证图片清晰度
    const originalSrc = dynamicPreviewImages[dynamicPreviewIndex]
    img.src = originalSrc.split('@')[0]
  }

  if (counter) {
    counter.textContent = `${dynamicPreviewIndex + 1} / ${dynamicPreviewImages.length}`
  }

  // 更新缩略图高亮，不重新渲染整个缩略图列表
  const thumbnailsContainer = document.getElementById('imagePreviewThumbnails')
  if (thumbnailsContainer) {
    const items = thumbnailsContainer.querySelectorAll('.thumbnail-item')
    items.forEach((item, index) => {
      if (index === dynamicPreviewIndex) {
        item.classList.add('active')
      } else {
        item.classList.remove('active')
      }
    })
  }
}

async function downloadCurrentImage() {
  if (!dynamicPreviewImages[dynamicPreviewIndex]) return

  try {
    // 下载时使用原图（移除 CDN 压缩参数）
    const originalUrl = dynamicPreviewImages[dynamicPreviewIndex].split('@')[0]
    const response = await fetch(originalUrl)
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `image_${dynamicPreviewIndex + 1}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('下载图片失败:', error)
    showToast('下载失败')
  }
}