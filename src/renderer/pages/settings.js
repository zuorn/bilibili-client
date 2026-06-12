function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'system'
  const themeSelect = document.getElementById('themeSelect')
  if (themeSelect) {
    themeSelect.value = savedTheme
  }
  applyTheme(savedTheme)
  updateSettingsAvatar()
  updateSettingsUserName()
}

function applyTheme(theme) {
  document.body.classList.remove('dark-theme')

  let isDark = false
  if (theme === 'dark') {
    isDark = true
  } else if (theme === 'system') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  if (isDark) {
    document.body.classList.add('dark-theme')
  }
  updateSidebarThemeIcon(isDark)
}

function handleThemeChange(event) {
  const theme = event.target.value
  localStorage.setItem('theme', theme)
  applyTheme(theme)
}

function toggleTheme() {
  const themeSelect = document.getElementById('themeSelect')
  const currentTheme = localStorage.getItem('theme') || 'system'
  const isCurrentlyDark = document.body.classList.contains('dark-theme')

  let newTheme
  if (currentTheme === 'light') {
    newTheme = 'dark'
  } else if (currentTheme === 'dark') {
    newTheme = 'system'
  } else {
    newTheme = isCurrentlyDark ? 'light' : 'dark'
  }

  if (themeSelect) {
    themeSelect.value = newTheme
  }
  localStorage.setItem('theme', newTheme)
  applyTheme(newTheme)
}

function initMpvPath() {
  const mpvPathInput = document.getElementById('mpvPathInput')
  if (!mpvPathInput) return

  const savedPath = localStorage.getItem('mpvPath')
  if (savedPath) {
    mpvPathInput.value = savedPath
  }

  mpvPathInput.addEventListener('change', () => {
    localStorage.setItem('mpvPath', mpvPathInput.value)
  })
}

function initDanmakuToggle() {
  const danmakuToggle = document.getElementById('danmakuToggle')
  if (!danmakuToggle) return

  const savedSetting = localStorage.getItem('showDanmaku')
  if (savedSetting !== null) {
    danmakuToggle.checked = savedSetting === 'true'
  } else {
    danmakuToggle.checked = true
  }

  danmakuToggle.addEventListener('change', () => {
    localStorage.setItem('showDanmaku', danmakuToggle.checked)
    console.log('弹幕显示设置已更改:', danmakuToggle.checked)
  })
}

function initBuiltinPlayerToggle() {
  const builtinPlayerToggle = document.getElementById('useBuiltinPlayer')
  if (!builtinPlayerToggle) return

  const savedSetting = localStorage.getItem('useBuiltinPlayer')
  if (savedSetting !== null) {
    builtinPlayerToggle.checked = savedSetting === 'true'
  } else {
    builtinPlayerToggle.checked = true
  }

  builtinPlayerToggle.addEventListener('change', () => {
    localStorage.setItem('useBuiltinPlayer', builtinPlayerToggle.checked)
    console.log('内置播放器设置已更改:', builtinPlayerToggle.checked)
  })
}

function initNativePlayerToggle() {
  const nativePlayerToggle = document.getElementById('nativePlayerToggle')
  if (!nativePlayerToggle) return

  const savedSetting = localStorage.getItem('useNativePlayer')
  if (savedSetting !== null) {
    nativePlayerToggle.checked = savedSetting === 'true'
  } else {
    nativePlayerToggle.checked = false
  }

  nativePlayerToggle.addEventListener('change', () => {
    localStorage.setItem('useNativePlayer', nativePlayerToggle.checked)
    console.log('内置播放器设置已更改:', nativePlayerToggle.checked)
  })
}

async function selectMpvPath() {
  const result = await ipcRenderer.invoke('select-mpv-path')
  if (result.success && result.path) {
    const mpvPathInput = document.getElementById('mpvPathInput')
    if (mpvPathInput) {
      mpvPathInput.value = result.path
      localStorage.setItem('mpvPath', result.path)
    }
  }
}

function updateSidebarThemeIcon(isDark) {
  const sidebarBtn = document.getElementById('sidebarThemeBtn')
  if (!sidebarBtn) return
  const lightIcon = sidebarBtn.querySelector('.theme-icon-light')
  const darkIcon = sidebarBtn.querySelector('.theme-icon-dark')
  if (lightIcon) lightIcon.style.display = isDark ? 'none' : 'block'
  if (darkIcon) darkIcon.style.display = isDark ? 'block' : 'none'
}

function updateSettingsAvatar() {
  const settingsAvatar = document.getElementById('settingsAvatar')
  if (!settingsAvatar) return

  if (currentUser?.isLogin && currentUser.face) {
    settingsAvatar.innerHTML = `<img src="${currentUser.face}" alt="头像" style="width: 100%; height: 100%; object-fit: cover;">`
  } else {
    settingsAvatar.innerHTML = `<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="#fb7299"/><circle cx="24" cy="20" r="8" fill="white"/><circle cx="20" cy="18" r="1.5" fill="#fb7299"/><circle cx="28" cy="18" r="1.5" fill="#fb7299"/><path d="M20 26 Q24 30 28 26" stroke="#fb7299" stroke-width="2" fill="none"/></svg>`
  }
}

function updateSettingsUserName() {
  const userName = document.getElementById('settingsUserName')
  const userLevel = document.getElementById('settingsUserLevel')
  if (!userName) return

  if (currentUser?.isLogin) {
    userName.textContent = currentUser.uname || '用户'
    if (userLevel) {
      userLevel.textContent = currentUser.level ? `Lv${currentUser.level}` : ''
      userLevel.style.display = currentUser.level ? 'inline-block' : 'none'
    }
  } else {
    userName.textContent = '未登录'
    if (userLevel) {
      userLevel.textContent = ''
      userLevel.style.display = 'none'
    }
  }
}

// 从主进程获取应用版本号并显示在"关于"部分
async function initAppVersion() {
  const versionEl = document.getElementById('appVersion')
  if (!versionEl) return
  try {
    const version = await ipcRenderer.invoke('get-app-version')
    versionEl.textContent = 'V' + (version || '1.0.0')
  } catch (err) {
    versionEl.textContent = 'V1.0.0'
  }
}
