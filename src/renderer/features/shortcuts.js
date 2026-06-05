// 快捷键相关函数

function loadShortcuts() {
  try {
    const saved = localStorage.getItem('userShortcuts')
    if (saved) {
      const loaded = JSON.parse(saved)
      // 遍历 defaultShortcuts，确保所有默认快捷键都被处理
      for (const [id, shortcut] of Object.entries(defaultShortcuts)) {
        if (!loaded[id] || !loaded[id].keys || !Array.isArray(loaded[id].keys) || loaded[id].keys.length === 0) {
          loaded[id] = JSON.parse(JSON.stringify(shortcut))
        } else {
          if (!Array.isArray(loaded[id].keys[0])) {
            loaded[id].keys = [loaded[id].keys]
          }
        }
      }
      // 添加 defaultShortcuts 中存在但 loaded 中不存在的快捷键
      for (const [id, shortcut] of Object.entries(defaultShortcuts)) {
        if (!loaded[id]) {
          loaded[id] = JSON.parse(JSON.stringify(shortcut))
        }
      }
      userShortcuts = loaded
    } else {
      // 如果没有保存的配置，直接使用默认配置
      userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
    }
  } catch (e) {
    console.error('加载快捷键配置失败:', e)
    userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
  }
}

function saveShortcuts() {
  try {
    localStorage.setItem('userShortcuts', JSON.stringify(userShortcuts))
  } catch (e) {
    console.error('保存快捷键配置失败:', e)
  }
}

function openShortcutSettings() {
  shortcutsEnabled = false
  const modal = document.getElementById('shortcutModal')
  const list = document.getElementById('shortcutList')
  if (!modal || !list) return

  list.innerHTML = ''
  for (const [id, shortcut] of Object.entries(userShortcuts)) {
    const item = document.createElement('div')
    item.className = 'shortcut-item'

    const keys = shortcut.keys || []
    let keyButtonsHtml = ''

    for (let i = 0; i < 3; i++) {
      if (i < keys.length) {
        keyButtonsHtml += `<div class="shortcut-key-wrapper" data-id="${id}" data-index="${i}">
          <button class="shortcut-key" data-id="${id}" data-index="${i}">${keys[i].map(k => `<kbd>${k}</kbd>`).join(' + ')}</button>
          <button class="shortcut-key-remove" data-id="${id}" data-index="${i}">×</button>
        </div>`
      } else {
        keyButtonsHtml += `<button class="shortcut-key shortcut-add-btn" data-id="${id}" data-index="${i}" ${keys.length >= 3 ? 'disabled' : ''}>${keys.length >= 3 ? '' : '+'}</button>`
      }
    }

    item.innerHTML = `
      <span class="shortcut-item-label">${shortcut.label}</span>
      <div class="shortcut-actions">
        <div class="shortcut-key-slots">
          ${keyButtonsHtml}
        </div>
        <button class="shortcut-clear-btn" data-id="${id}" ${keys.length === 0 ? 'style="display: none"' : ''}>清除</button>
      </div>
    `
    list.appendChild(item)
  }

  list.querySelectorAll('.shortcut-key:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const index = parseInt(btn.dataset.index)
      startRecording(id, index)
    })
  })

  list.querySelectorAll('.shortcut-key-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const index = parseInt(btn.dataset.index)
      removeShortcutKey(id, index)
    })
  })

  list.querySelectorAll('.shortcut-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => clearShortcut(btn.dataset.id))
  })

  document.getElementById('shortcutCloseBtn')?.addEventListener('click', closeShortcutSettings)
  document.getElementById('shortcutResetBtn')?.addEventListener('click', async () => await resetShortcuts())
  document.getElementById('shortcutSaveBtn')?.addEventListener('click', () => {
    saveShortcuts()
    closeShortcutSettings()
  })

  modal.style.display = 'flex'
}

function closeShortcutSettings() {
  shortcutsEnabled = true
  const modal = document.getElementById('shortcutModal')
  if (modal) {
    modal.style.display = 'none'
    stopRecording()
  }
}

function formatShortcutKeys(keyCombinations) {
  if (!keyCombinations || keyCombinations.length === 0) {
    return '<span style="color: #999; font-style: italic;">点击绑定</span>'
  }
  return keyCombinations.map(keys => keys.map(k => `<kbd>${k}</kbd>`).join(' + ')).join(' / ')
}

function startRecording(id, index) {
  stopRecording()
  currentRecording = { id, index }
  const btn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${index}"]`)
  if (btn) {
    btn.classList.add('recording')
    btn.innerHTML = '按下快捷键...'
  }
  document.addEventListener('keydown', handleShortcutKeydown)
}

function stopRecording() {
  if (currentRecording.id) {
    const btn = document.querySelector(`.shortcut-key[data-id="${currentRecording.id}"][data-index="${currentRecording.index}"]`)
    if (btn) {
      btn.classList.remove('recording')
      const keys = userShortcuts[currentRecording.id]?.keys || []
      if (currentRecording.index < keys.length) {
        btn.innerHTML = keys[currentRecording.index].map(k => `<kbd>${k}</kbd>`).join(' + ')
      } else {
        btn.innerHTML = '+'
      }
    }
    currentRecording = { id: null, index: null }
  }
  document.removeEventListener('keydown', handleShortcutKeydown)
}

function handleShortcutKeydown(e) {
  if (!currentRecording.id) return

  e.preventDefault()
  e.stopPropagation()

  const keys = []
  const hasModifier = e.ctrlKey || e.shiftKey || e.altKey || e.metaKey

  if (e.ctrlKey) keys.push('ctrl')
  if (e.shiftKey) keys.push('shift')
  if (e.altKey) keys.push('alt')
  if (e.metaKey) keys.push('meta')

  const code = e.code
  let nonModifierKey = null

  console.log('Keyboard event code:', code, 'ctrlKey:', e.ctrlKey, 'shiftKey:', e.shiftKey, 'altKey:', e.altKey)

  const codeMap = {
    'KeyA': 'a', 'KeyB': 'b', 'KeyC': 'c', 'KeyD': 'd', 'KeyE': 'e', 'KeyF': 'f',
    'KeyG': 'g', 'KeyH': 'h', 'KeyI': 'i', 'KeyJ': 'j', 'KeyK': 'k', 'KeyL': 'l',
    'KeyM': 'm', 'KeyN': 'n', 'KeyO': 'o', 'KeyP': 'p', 'KeyQ': 'q', 'KeyR': 'r',
    'KeyS': 's', 'KeyT': 't', 'KeyU': 'u', 'KeyV': 'v', 'KeyW': 'w', 'KeyX': 'x',
    'KeyY': 'y', 'KeyZ': 'z',
    'Digit0': '0', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4',
    'Digit5': '5', 'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9',
    'Numpad0': '0', 'Numpad1': '1', 'Numpad2': '2', 'Numpad3': '3', 'Numpad4': '4',
    'Numpad5': '5', 'Numpad6': '6', 'Numpad7': '7', 'Numpad8': '8', 'Numpad9': '9',
    'Comma': ',',
    'Period': '.',
    'Slash': '/',
    'Backslash': '\\',
    'Semicolon': ';',
    'Quote': '\'',
    'BracketLeft': '[',
    'BracketRight': ']',
    'Equal': '=',
    'Minus': '-',
    'Backquote': '`',
    'ArrowUp': 'arrowup',
    'ArrowDown': 'arrowdown',
    'ArrowLeft': 'arrowleft',
    'ArrowRight': 'arrowright',
    'Enter': 'enter',
    'Tab': 'tab',
    'Space': ' ',
    'Backspace': 'backspace',
    'Delete': 'delete',
    'Escape': 'escape',
    'Home': 'home',
    'End': 'end',
    'PageUp': 'pageup',
    'PageDown': 'pagedown',
    'CapsLock': 'capslock',
    'NumLock': 'numlock',
    'ScrollLock': 'scrolllock',
    'Insert': 'insert',
    'F1': 'f1', 'F2': 'f2', 'F3': 'f3', 'F4': 'f4', 'F5': 'f5',
    'F6': 'f6', 'F7': 'f7', 'F8': 'f8', 'F9': 'f9', 'F10': 'f10',
    'F11': 'f11', 'F12': 'f12'
  }

  const ignoreCodes = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']

  if (!ignoreCodes.includes(code)) {
    if (codeMap[code]) {
      nonModifierKey = codeMap[code]
    } else if (code.startsWith('Numpad')) {
      nonModifierKey = code.replace('Numpad', '')
      if (nonModifierKey === 'Add') nonModifierKey = '+'
      else if (nonModifierKey === 'Subtract') nonModifierKey = '-'
      else if (nonModifierKey === 'Multiply') nonModifierKey = '*'
      else if (nonModifierKey === 'Divide') nonModifierKey = '/'
      else if (nonModifierKey === 'Decimal') nonModifierKey = '.'
    } else {
      nonModifierKey = code.toLowerCase()
    }
    keys.push(nonModifierKey)
  }

  console.log('Detected keys:', keys, 'nonModifierKey:', nonModifierKey, 'hasModifier:', hasModifier)

  if (nonModifierKey) {
    const id = currentRecording.id
    const index = currentRecording.index

    if (!userShortcuts[id].keys) {
      userShortcuts[id].keys = []
    }

    const keysString = JSON.stringify(keys)
    const exists = userShortcuts[id].keys.some(k => JSON.stringify(k) === keysString)

    if (!exists) {
      userShortcuts[id].keys[index] = keys
    }

    const btn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${index}"]`)
    if (btn) {
      btn.classList.remove('recording')
      btn.innerHTML = keys.map(k => `<kbd>${k}</kbd>`).join(' + ')
    }

    const nextIndex = index + 1
    if (nextIndex < 3 && userShortcuts[id].keys.length <= nextIndex) {
      const nextBtn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${nextIndex}"]`)
      if (nextBtn) {
        nextBtn.classList.remove('disabled')
        nextBtn.removeAttribute('disabled')
        nextBtn.innerHTML = '+'
      }
    }

    currentRecording = { id: null, index: null }
    document.removeEventListener('keydown', handleShortcutKeydown)
  }
}

function clearShortcut(id) {
  userShortcuts[id].keys = []
  for (let i = 0; i < 3; i++) {
    const btn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${i}"]`)
    if (btn) {
      btn.classList.remove('recording')
      btn.innerHTML = '+'
      btn.classList.remove('disabled')
      btn.removeAttribute('disabled')
    }
  }
}

function removeShortcutKey(id, index) {
  if (!userShortcuts[id] || !userShortcuts[id].keys) return

  const wrapper = document.querySelector(`.shortcut-key-wrapper[data-id="${id}"][data-index="${index}"]`)
  if (!wrapper) return

  const actionsContainer = wrapper.closest('.shortcut-actions')
  if (!actionsContainer) return

  userShortcuts[id].keys.splice(index, 1)

  const keys = userShortcuts[id].keys || []
  const slotsContainer = actionsContainer.querySelector('.shortcut-key-slots')

  let newSlotsHtml = ''
  for (let i = 0; i < 3; i++) {
    if (i < keys.length) {
      newSlotsHtml += `<div class="shortcut-key-wrapper" data-id="${id}" data-index="${i}">
        <button class="shortcut-key" data-id="${id}" data-index="${i}">${keys[i].map(k => `<kbd>${k}</kbd>`).join(' + ')}</button>
        <button class="shortcut-key-remove" data-id="${id}" data-index="${i}">×</button>
      </div>`
    } else {
      newSlotsHtml += `<button class="shortcut-key shortcut-add-btn" data-id="${id}" data-index="${i}" ${keys.length >= 3 ? 'disabled' : ''}>${keys.length >= 3 ? '' : '+'}</button>`
    }
  }

  slotsContainer.innerHTML = newSlotsHtml

  slotsContainer.querySelectorAll('.shortcut-key:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const btnId = btn.dataset.id
      const btnIndex = parseInt(btn.dataset.index)
      startRecording(btnId, btnIndex)
    })
  })

  slotsContainer.querySelectorAll('.shortcut-key-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const btnId = btn.dataset.id
      const btnIndex = parseInt(btn.dataset.index)
      removeShortcutKey(btnId, btnIndex)
    })
  })

  const clearBtn = actionsContainer.querySelector('.shortcut-clear-btn')
  if (clearBtn) {
    clearBtn.style.display = keys.length === 0 ? 'none' : 'inline-block'
  }
}

async function resetShortcuts() {
  await loadDefaultShortcuts()
  userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
  const list = document.getElementById('shortcutList')
  if (list) {
    for (const [id, shortcut] of Object.entries(userShortcuts)) {
      const keys = shortcut.keys || []
      for (let i = 0; i < 3; i++) {
        const btn = document.querySelector(`.shortcut-key[data-id="${id}"][data-index="${i}"]`)
        if (btn) {
          btn.classList.remove('recording')
          if (i < keys.length) {
            btn.innerHTML = keys[i].map(k => `<kbd>${k}</kbd>`).join(' + ')
            btn.classList.remove('disabled')
            btn.removeAttribute('disabled')
          } else {
            btn.innerHTML = keys.length < 3 ? '+' : ''
            if (keys.length < 3) {
              btn.classList.remove('disabled')
              btn.removeAttribute('disabled')
            } else {
              btn.classList.add('disabled')
              btn.setAttribute('disabled', 'disabled')
            }
          }
        }
      }
    }
  }
}

function applyShortcuts(e) {
  if (!shortcutsEnabled) return

  // 如果访问键标签正在显示，不处理任何快捷键（让 access-keys.js 处理）
  if (typeof accesskeyEnabled !== 'undefined' && accesskeyEnabled) return

  const searchInput = document.getElementById('searchInput')
  const isSearchFocused = searchInput && document.activeElement === searchInput
  const header = document.querySelector('.header')
  const isSearchDropdownOpen = header && header.classList.contains('search-focused')

  const clearShortcutConfig = userShortcuts.clearSearch
  const backShortcut = userShortcuts.goBack

  const clearMatch = clearShortcutConfig && matchAnyShortcut(e, clearShortcutConfig.keys)
  const backMatch = backShortcut && matchAnyShortcut(e, backShortcut.keys)

  if (clearMatch && isSearchDropdownOpen) {
    e.preventDefault()
    if (searchInput) {
      searchInput.value = ''
      searchInput.blur()
    }
    if (header) {
      header.classList.remove('search-focused')
    }
    return
  }

  const shortcut = userShortcuts.focusSearch
  if (shortcut && matchAnyShortcut(e, shortcut.keys)) {
    e.preventDefault()
    if (searchInput) {
      searchInput.focus()
      searchInput.select()
    }
  }

  // 返回上一页时，排除搜索下拉框打开和访问键标签显示的情况
  if (backMatch && !isSearchDropdownOpen) {
    e.preventDefault()
    goBack()
  }

  const devtoolsShortcut = userShortcuts.openDevTools
  if (devtoolsShortcut && devtoolsShortcut.keys && matchAnyShortcut(e, devtoolsShortcut.keys)) {
    e.preventDefault()
    ipcRenderer.invoke('open-dev-tools')
  }

  const settingsShortcut = userShortcuts.openSettings
  if (settingsShortcut && settingsShortcut.keys && matchAnyShortcut(e, settingsShortcut.keys)) {
    e.preventDefault()
    navigateToPage('settings')
  }

  const shortcutSettingsShortcut = userShortcuts.openShortcutSettings
  if (shortcutSettingsShortcut && shortcutSettingsShortcut.keys && matchAnyShortcut(e, shortcutSettingsShortcut.keys)) {
    e.preventDefault()
    openShortcutSettings()
  }

  const refreshShortcut = userShortcuts.refresh
  if (refreshShortcut && refreshShortcut.keys && matchAnyShortcut(e, refreshShortcut.keys)) {
    e.preventDefault()
    refreshCurrentPage()
  }

  if (e.key.toLowerCase() === 'g' && !pendingGoTop) {
    pendingGoTop = true
    setTimeout(() => { pendingGoTop = false }, 500)
  } else if (e.key.toLowerCase() === 'g' && pendingGoTop) {
    pendingGoTop = false
    const goTopShortcut = userShortcuts.goTop
    if (goTopShortcut && goTopShortcut.keys) {
      e.preventDefault()
      scrollToTop()
    }
  }

  const scrollDownShortcut = userShortcuts.scrollDown
  if (scrollDownShortcut && scrollDownShortcut.keys && matchAnyShortcut(e, scrollDownShortcut.keys)) {
    e.preventDefault()
    scrollHalfPage('down')
  }

  const scrollUpShortcut = userShortcuts.scrollUp
  if (scrollUpShortcut && scrollUpShortcut.keys && matchAnyShortcut(e, scrollUpShortcut.keys)) {
    e.preventDefault()
    scrollHalfPage('up')
  }

  const triggerActionShortcut = userShortcuts.triggerAction
  if (triggerActionShortcut && triggerActionShortcut.keys && matchAnyShortcut(e, triggerActionShortcut.keys)) {
    e.preventDefault()
    handleTriggerAction()
  }
}

function handleTriggerAction() {
  const focusedElement = document.activeElement
  if (focusedElement) {
    const videoCard = focusedElement.closest('.video-card')
    if (videoCard) {
      const bvid = videoCard.dataset.bvid
      if (bvid) {
        playVideo(bvid, videoCard.dataset.cid, videoCard.querySelector('.video-title')?.textContent)
        return
      }
    }
  }
  const selectedCard = document.querySelector('.video-card.selected')
  if (selectedCard) {
    const bvid = selectedCard.dataset.bvid
    if (bvid) {
      playVideo(bvid, selectedCard.dataset.cid, selectedCard.querySelector('.video-title')?.textContent)
    }
  }
}

function normalizeKey(key) {
  const keyMap = {
    'comma': ',',
    'period': '.',
    'slash': '/',
    'backslash': '\\',
    'semicolon': ';',
    'quote': '\'',
    'bracketleft': '[',
    'bracketright': ']',
    'equal': '=',
    'minus': '-',
    'backquote': '`'
  }
  return keyMap[key.toLowerCase()] || key.toLowerCase()
}

function isKeyMatch(e, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return false
  const pressedKeys = []
  if (e.ctrlKey) pressedKeys.push('ctrl')
  if (e.shiftKey) pressedKeys.push('shift')
  if (e.altKey) pressedKeys.push('alt')
  if (e.metaKey) pressedKeys.push('meta')
  const key = e.key.toLowerCase()
  if (key !== 'control' && key !== 'shift' && key !== 'alt' && key !== 'meta') {
    pressedKeys.push(normalizeKey(key))
  }
  if (pressedKeys.length !== keys.length) return false
  return keys.every(k => pressedKeys.includes(normalizeKey(k)))
}

function matchAnyShortcut(e, keyCombinations) {
  if (!keyCombinations || keyCombinations.length === 0) return false
  return keyCombinations.some(keys => isKeyMatch(e, keys))
}

document.addEventListener('keydown', e => {
  // 如果访问键标签正在显示，让 access-keys.js 处理键盘事件
  if (typeof accesskeyEnabled !== 'undefined' && accesskeyEnabled) return

  const closeWindowShortcut = userShortcuts.closeWindow
  if (closeWindowShortcut && closeWindowShortcut.keys && matchAnyShortcut(e, closeWindowShortcut.keys)) {
    e.preventDefault()
    const modal = document.getElementById('shortcutModal')
    const isModalOpen = modal && modal.style.display === 'flex'
    if (isModalOpen) {
      closeShortcutSettings()
    } else {
      ipcRenderer.invoke('close-window')
    }
    return
  }

  applyShortcuts(e)
})
