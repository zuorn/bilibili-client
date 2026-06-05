// 快速访问键功能 (类似 Surfingkeys 的 f 键)

// 生成字母组合
function generateAccesskeyLabels(count) {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const labels = []

  if (count <= letters.length) {
    for (let i = 0; i < count; i++) {
      labels.push(letters[i])
    }
  } else {
    // 生成双字母组合
    for (let i = 0; i < letters.length; i++) {
      for (let j = 0; j < letters.length && labels.length < count; j++) {
        labels.push(letters[i] + letters[j])
      }
    }
  }

  return labels
}

// 检查元素是否可见
function isElementVisible(el) {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  if (rect.top < 0 && rect.bottom < 0) return false
  if (rect.left < 0 && rect.right < 0) return false

  // 检查元素及其祖先是否被隐藏
  let current = el
  while (current) {
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false
    }
    current = current.parentElement
  }

  return true
}

// 获取可点击元素
function getClickableElements() {
  const selectors = [
    'button:not([disabled])',
    'a[href]:not([disabled])',
    '[role="button"]:not([disabled])',
    '#sidebarUserAvatar',
    '.sidebar-item',
    '.video-card',
    '.up-clickable',
    '.hot-item',
    '.history-tag',
    '.my-tab',
    '.bottom-action-btn',
    '.nav-link',
    '.bangumi-card',
    '.bangumi-all-card',
    '.collections-series-card',
    '.my-anime-card',
    '.following-card',
    '.following-item',
    '.waterfall-item',
    '.filter-options span',
    '.view-all',
    '.page-tab',
    '.filter-tag',
    '.favorites-sub-tab',
    '.dynamic-all-btn'
  ]

  const elements = []
  const seen = new Set()

  // 处理所有元素，使用元素本身作为唯一标识
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach(el => {
      // 使用元素对象本身作为 key，确保每个元素只出现一次
      if (seen.has(el)) return

      // 跳过 video-card 内部的子元素（如 button、a 等），只保留 video-card 本身的标签
      if (!el.classList.contains('video-card') && el.closest('.video-card')) {
        return
      }

      // 对于 up-clickable，如果它所在的 video-item-wrapper 内部有 video-card
      // 只在 up 名称上显示一个标签，跳过 up 图标和发布时间
      if (el.classList.contains('up-clickable')) {
        const wrapper = el.closest('.video-item-wrapper')
        if (wrapper && wrapper.querySelector('.video-card')) {
          // 只保留 video-author-name（up名称），跳过 up-icon 和 video-publish-date
          if (!el.classList.contains('video-author-name')) {
            return
          }
        }
      }

      // 所有元素都必须通过基本可见性检查（会过滤 display:none 祖先的情况）
      if (!isElementVisible(el)) return

      // 非 nav-link 元素额外检查：完全在视口上方的不显示
      const isNavLink = el.classList.contains('nav-link')
      if (!isNavLink) {
        const rect = el.getBoundingClientRect()
        if (rect.top < -50) return
      }

      seen.add(el)
      elements.push(el)
    })
  }

  // 按位置排序（从上到下，从左到右）
  return elements.sort((a, b) => {
    const rectA = a.getBoundingClientRect()
    const rectB = b.getBoundingClientRect()
    const rowDiff = rectA.top - rectB.top
    if (Math.abs(rowDiff) > 50) return rowDiff
    return rectA.left - rectB.left
  })
}

// 显示访问键标签
function showAccesskeyLabels() {
  // 如果已经开启，先关闭
  if (accesskeyEnabled) {
    hideAccesskeyLabels()
    return
  }

  accesskeyEnabled = true
  accesskeyInput = ''

  const elements = getClickableElements()
  accesskeyElements = elements

  const labels = generateAccesskeyLabels(elements.length)

  // 创建遮罩层
  let overlay = document.getElementById('accesskeyOverlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'accesskeyOverlay'
    overlay.className = 'accesskey-overlay'
    document.body.appendChild(overlay)
  }
  overlay.classList.add('active')

  // 创建标签
  let navLinkRow = 0
  let navLinkCol = 0
  const navLinkStartX = 80
  const navLinkStartY = 45
  const navLinkSpacingX = 100
  const navLinkSpacingY = 40

  // 获取顶部栏高度（假设顶部栏有.header类）
  const header = document.querySelector('.header')
  const headerHeight = header ? header.offsetHeight : 50

  elements.forEach((el, index) => {
    const rect = el.getBoundingClientRect()

    // 检查元素是否在顶部栏内部（子元素）
    const isInHeader = header && header.contains(el)

    // 跳过被顶部栏遮挡的元素（元素底部在顶部栏下方且不在顶部栏内部）
    if (!isInHeader && rect.bottom <= headerHeight) {
      return
    }

    const label = document.createElement('span')
    label.className = 'accesskey-label'
    const key = labels[index].toUpperCase()
    // 初始时直接显示字母，不加遮罩
    label.textContent = key
    label.dataset.accesskey = labels[index]
    label.dataset.index = index

    // 检查是否是导航链接且位置无效（被隐藏）
    const isNavLink = el.classList.contains('nav-link')
    const isHidden = rect.width === 0 || rect.height === 0 || rect.top < -50

    let labelX, labelY

    if (isNavLink && isHidden) {
      // 如果是被隐藏的导航链接，计算一个合适的位置显示标签
      labelX = navLinkStartX + navLinkCol * navLinkSpacingX
      labelY = navLinkStartY + navLinkRow * navLinkSpacingY

      navLinkCol++
      if (navLinkCol > 5) {
        navLinkCol = 0
        navLinkRow++
      }
    } else {
      // 正常定位在元素左上角
      labelX = rect.left + 8
      // 如果是顶部栏内部的元素，直接显示在元素位置；否则确保不被顶部栏遮挡
      labelY = isInHeader ? rect.top + 8 : Math.max(rect.top + 8, headerHeight + 8)
    }

    label.style.left = labelX + 'px'
    label.style.top = labelY + 'px'

    document.body.appendChild(label)
    accesskeyLabels.push(label)
  })
}

// 隐藏访问键标签
function hideAccesskeyLabels() {
  accesskeyEnabled = false
  accesskeyInput = ''

  // 移除遮罩层
  const overlay = document.getElementById('accesskeyOverlay')
  if (overlay) {
    overlay.classList.remove('active')
  }

  // 移除所有标签
  accesskeyLabels.forEach(label => {
    document.body.removeChild(label)
  })
  accesskeyLabels = []
  accesskeyElements = []
}

// 更新高亮状态
function updateAccesskeyHighlight() {
  accesskeyLabels.forEach(label => {
    const key = label.dataset.accesskey.toLowerCase()
    const input = accesskeyInput.toLowerCase()

    if (key.startsWith(input)) {
      label.classList.remove('hidden')
      // 更新标签显示：已输入的字母变淡
      const fullKey = key.toUpperCase()
      if (input.length > 0 && input.length < key.length) {
        const matchedPart = fullKey.substring(0, input.length)
        const remainingPart = fullKey.substring(input.length)
        label.innerHTML = `<span class="matched-char">${matchedPart}</span>${remainingPart}`
      } else {
        label.innerHTML = `<span class="matched-char" style="opacity:1">${fullKey}</span>`
      }
    } else {
      label.classList.add('hidden')
    }
  })
}

// 处理访问键输入
function handleAccesskeyInput(key) {
  if (!accesskeyEnabled) return

  accesskeyInput += key.toLowerCase()

  // 更新高亮
  updateAccesskeyHighlight()

  // 检查是否匹配
  const matchedLabels = accesskeyLabels.filter(label =>
    label.dataset.accesskey === accesskeyInput.toLowerCase()
  )

  if (matchedLabels.length === 1) {
    const index = parseInt(matchedLabels[0].dataset.index)
    const element = accesskeyElements[index]

    // 模拟点击
    element.click()

    // 隐藏标签
    hideAccesskeyLabels()
  } else if (accesskeyLabels.every(label => !label.dataset.accesskey.startsWith(accesskeyInput.toLowerCase()))) {
    // 没有匹配，重置输入
    accesskeyInput = key.toLowerCase()
    updateAccesskeyHighlight()
  }
}

// 监听键盘事件
document.addEventListener('keydown', e => {
  // 如果在输入框中，不处理
  const activeElement = document.activeElement
  if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
    return
  }

  // 按下 f 键开启访问键
  if (e.key === 'f' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
    e.preventDefault()
    e.stopImmediatePropagation()
    showAccesskeyLabels()
    return
  }

  // 如果访问键已开启，阻止事件传播到其他监听器
  if (accesskeyEnabled) {
    e.preventDefault()
    e.stopImmediatePropagation()

    // 按 Escape 关闭；按 q 键仅在未输入时关闭（已输入时当作普通字母处理，支持含 q 的标签如 AQ）
    if (e.key === 'Escape' || (e.key === 'q' && accesskeyInput === '')) {
      hideAccesskeyLabels()
      return
    }

    // 按退格键删除最后一个字符
    if (e.key === 'Backspace') {
      accesskeyInput = accesskeyInput.slice(0, -1)
      updateAccesskeyHighlight()
      return
    }

    // 处理字母键（q 键在已输入时作为普通字母处理）
    if (/^[a-zA-Z]$/.test(e.key)) {
      handleAccesskeyInput(e.key)
    }
  }
})
