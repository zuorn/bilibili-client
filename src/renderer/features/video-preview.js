// 视频卡片悬停预览模块
(function() {
  'use strict'

  var HOVER_DELAY = 400
  var previewVideo = null
  var previewContainer = null
  var currentCard = null
  var hoverTimer = null
  var preloadBvid = null
  var preloadCancel = false
  var urlCache = {}

  function createPreviewElements() {
    previewContainer = document.createElement('div')
    previewContainer.className = 'video-preview-overlay'

    previewVideo = document.createElement('video')
    previewVideo.className = 'video-preview-player'
    previewVideo.muted = true
    previewVideo.loop = true
    previewVideo.playsInline = true
    previewVideo.setAttribute('playsinline', '')
    previewVideo.preload = 'auto'

    previewVideo.addEventListener('canplay', onVideoReady)
    previewVideo.addEventListener('error', onVideoError)

    previewContainer.appendChild(previewVideo)
  }

  function attachToCard(card) {
    var thumbnail = card.querySelector('.video-thumbnail')
    if (!thumbnail) return

    if (previewContainer.parentElement && previewContainer.parentElement !== thumbnail) {
      previewContainer.remove()
    }
    if (!previewContainer.parentElement) {
      thumbnail.appendChild(previewContainer)
    }
    card.classList.add('preview-active')
  }

  function detachFromCard(card) {
    if (!card) return
    card.classList.remove('preview-active')

    if (previewVideo) {
      previewVideo.pause()
      previewVideo.removeAttribute('src')
    }
    if (previewContainer && previewContainer.parentElement) {
      previewContainer.remove()
    }
  }

  function cancelPreload() {
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
    preloadBvid = null
    preloadCancel = true
  }

  function hidePreview() {
    cancelPreload()
    var card = currentCard
    currentCard = null
    if (card) {
      detachFromCard(card)
    }
  }

  function onVideoReady() {
    if (!currentCard || preloadCancel) return
    previewVideo.play().catch(function() {})
    if (!currentCard.classList.contains('preview-active')) {
      attachToCard(currentCard)
    }
  }

  function onVideoError() {
    var card = currentCard
    if (card) {
      currentCard = null
      detachFromCard(card)
    }
  }

  async function fetchPreviewUrl(bvid, cid) {
    if (urlCache[bvid]) return urlCache[bvid]

    try {
      var result = await ipcRenderer.invoke('get-video-preview-url', bvid, cid || '')
      if (result.success && result.url) {
        urlCache[bvid] = result.url
        return result.url
      }
    } catch (err) {
      console.warn('获取预览URL失败:', err.message)
    }
    return null
  }

  // 立即获取 URL 并开始预加载（不挂载浮层，不显示任何变化）
  function startPreload(card, bvid, cid) {
    preloadCancel = false
    preloadBvid = bvid

    fetchPreviewUrl(bvid, cid).then(function(url) {
      if (preloadCancel || preloadBvid !== bvid || currentCard !== card) return
      if (!url) return

      previewVideo.src = url
      // 视频在后台缓冲，封面图保持不变
    })
  }

  // 延迟到期后检查视频是否已就绪
  function showPreview(card, bvid) {
    if (preloadCancel || preloadBvid !== bvid || currentCard !== card) return

    if (previewVideo.readyState >= 3) {
      previewVideo.play().catch(function() {})
      attachToCard(card)
    }
    // 还没缓冲好就继续等 canplay 事件
  }

  function onMouseOver(e) {
    if (!e.target.closest) return
    var card = e.target.closest('.video-card')
    if (!card || card === currentCard) return

    hidePreview()
    currentCard = card
    var bvid = card.dataset.bvid
    if (!bvid) return

    var cid = card.dataset.cid || ''
    startPreload(card, bvid, cid)

    hoverTimer = setTimeout(function() {
      if (currentCard !== card) return
      showPreview(card, bvid)
    }, HOVER_DELAY)
  }

  function onMouseOut(e) {
    if (!currentCard) return
    var relatedTarget = e.relatedTarget || e.toElement
    if (!relatedTarget) {
      hidePreview()
      return
    }
    if (!currentCard.contains(relatedTarget)) {
      hidePreview()
    }
  }

  function init() {
    createPreviewElements()
    document.addEventListener('mouseover', onMouseOver, true)
    document.addEventListener('mouseout', onMouseOut, true)
    document.addEventListener('click', function(e) {
      var card = e.target.closest('.video-card')
      if (card && currentCard) hidePreview()
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
