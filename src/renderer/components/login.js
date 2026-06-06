async function checkLoginStatus() {
  const result = await fetchUserInfoWithRetry()

  if (result && result.success && result.data) {
    currentUser = result.data
    console.log('Current user:', currentUser)
    console.log('isLogin value:', currentUser.isLogin, 'type:', typeof currentUser.isLogin)
    console.log('mid value:', currentUser.mid, 'type:', typeof currentUser.mid)

    updateUserAvatar(currentUser)
    updateMyPageUI(currentUser)
    updateSettingsAvatar()
    updateSettingsUserName()

    const isLoggedIn = currentUser.isLogin === true || currentUser.isLogin === 1 || currentUser.mid > 0
    console.log('isLoggedIn:', isLoggedIn)

    if (!isLoggedIn) {
      console.log('用户未登录，打开登录窗口')
      setTimeout(() => {
        openLoginModal()
      }, 500)
    }
    return
  }

  // API 失败，用本地 cookie 判断登录状态
  const hasCookies = await checkLoginFromCookies()
  if (hasCookies) {
    console.log('API 不可达，但本地存在登录 cookie，假定已登录')
    currentUser = { isLogin: true, uname: '', face: '', mid: 0, level: 0, coins: 0, bCoins: 0 }
    updateSettingsAvatar()
    updateSettingsUserName()
    updateMyPageUI(currentUser)
    scheduleRecheck()
  }
}

async function checkLoginFromCookies() {
  try {
    const result = await ipcRenderer.invoke('get-cookies')
    if (result.success && result.cookies) {
      const hasSESSDATA = !!(result.cookies.SESSDATA && result.cookies.SESSDATA.length > 0)
      const hasDedeUserID = !!(result.cookies.DedeUserID && result.cookies.DedeUserID.length > 0)
      console.log('Cookie check - SESSDATA:', hasSESSDATA, 'DedeUserID:', hasDedeUserID)
      return hasSESSDATA || hasDedeUserID
    }
  } catch (e) {
    console.error('Cookie check failed:', e)
  }
  return false
}

function scheduleRecheck() {
  setTimeout(async () => {
    console.log('延迟重新检查登录状态...')
    const result = await fetchUserInfoWithRetry()
    if (result && result.success && result.data) {
      currentUser = result.data
      updateUserAvatar(currentUser)
      updateMyPageUI(currentUser)
      updateSettingsAvatar()
      updateSettingsUserName()
      console.log('延迟重检成功，用户信息已更新')
    }
  }, 10000)
}

async function fetchUserInfoWithRetry() {
  try {
    const result = await ipcRenderer.invoke('get-user-info')
    console.log('checkLoginStatus result:', result)

    if (result.success && result.data) {
      return result
    }

    console.log('首次获取用户信息失败，2秒后重试:', result.error)
    await new Promise(r => setTimeout(r, 2000))

    const retryResult = await ipcRenderer.invoke('get-user-info')
    console.log('checkLoginStatus retry result:', retryResult)

    if (retryResult.success && retryResult.data) {
      return retryResult
    }

    console.log('重试获取用户信息仍然失败:', retryResult.error)
    return null
  } catch (error) {
    console.log('首次获取用户信息异常，2秒后重试:', error)
    await new Promise(r => setTimeout(r, 2000))

    try {
      const retryResult = await ipcRenderer.invoke('get-user-info')
      console.log('checkLoginStatus retry result:', retryResult)

      if (retryResult.success && retryResult.data) {
        return retryResult
      }

      console.log('重试获取用户信息仍然失败:', retryResult.error)
      return null
    } catch (retryError) {
      console.error('重试获取用户信息仍然异常:', retryError)
      return null
    }
  }
}

function updateUserAvatar(user) {
  const avatar = document.getElementById('sidebarUserAvatar')
  if (!avatar) return

  if (user.isLogin && user.face) {
    avatar.innerHTML = `<img src="${user.face}" alt="用户头像" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`
  }
}

function updateMyPageUI(user) {
  const loginText = document.querySelector('.my-login-text')
  const myAvatar = document.querySelector('.my-avatar')
  const myCoins = document.querySelector('.my-coins')
  const mySpaceBtn = document.getElementById('mySpaceBtn')
  const myUserLevel = document.getElementById('myUserLevel')
  const myRightContent = document.getElementById('myRightContent')
  const myDynCount = document.getElementById('myDynCount')
  const myFollowingCount = document.getElementById('myFollowingCount')
  const myFanCount = document.getElementById('myFanCount')
  if (!loginText) return

  if (user.isLogin) {
    loginText.textContent = user.uname || '用户'
    if (myAvatar && user.face) myAvatar.innerHTML = `<img src="${user.face}" alt="头像" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`
    if (myCoins) myCoins.innerHTML = `<span>B币: ${user.bCoins || 0}</span><span class="separator">|</span><span>硬币: ${user.coins || 0}</span>`
    if (myUserLevel) {
      myUserLevel.textContent = user.level ? `Lv${user.level}` : ''
      myUserLevel.style.display = user.level ? 'inline-block' : 'none'
    }
    if (myRightContent) myRightContent.style.display = 'flex'
    if (myDynCount) myDynCount.textContent = formatPlayCount(user.dynCount || 0)
    if (myFollowingCount) myFollowingCount.textContent = formatPlayCount(user.following || 0)
    if (myFanCount) myFanCount.textContent = formatPlayCount(user.follower || 0)
    if (mySpaceBtn) mySpaceBtn.style.display = 'block'
    document.querySelectorAll('.no-login-area').forEach(area => area.style.display = 'none')
    document.getElementById('historyGrid').style.display = 'grid'
    document.getElementById('favoritesGrid').style.display = 'grid'
    document.getElementById('toviewGrid').style.display = 'grid'
  } else {
    loginText.textContent = '点击登录'
    if (myAvatar) myAvatar.innerHTML = `<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="#f5f5f5"/><circle cx="24" cy="20" r="8" fill="#e0e0e0"/><circle cx="20" cy="18" r="1.5" fill="#999"/><circle cx="28" cy="18" r="1.5" fill="#999"/><path d="M20 26 Q24 30 28 26" stroke="#999" stroke-width="2" fill="none"/></svg>`
    if (myCoins) myCoins.innerHTML = `<span>B币: -</span><span class="separator">|</span><span>硬币: -</span>`
    if (myUserLevel) {
      myUserLevel.textContent = ''
      myUserLevel.style.display = 'none'
    }
    if (myRightContent) myRightContent.style.display = 'none'
    document.querySelectorAll('.no-login-area').forEach(area => area.style.display = 'flex')
    document.getElementById('historyGrid').style.display = 'none'
    document.getElementById('favoritesGrid').style.display = 'none'
    document.getElementById('toviewGrid').style.display = 'none'
  }
}

function openLoginModal() {
  document.getElementById('loginModal').style.display = 'flex'
  initQRLogin()
}

async function handleLogout() {
  try {
    await ipcRenderer.invoke('logout')
    await ipcRenderer.invoke('reload-window')
  } catch (error) {
    console.error('退出登录失败:', error)
  }
}

function mountQrCodeWhenLoaded(qrCodeElement, loginUrl) {
  const src = `https://api.qrserver.com/v1/create-qr-code?size=200x200&data=${encodeURIComponent(loginUrl)}`
  const img = new Image()
  img.alt = '扫码登录'
  img.style.width = '200px'
  img.style.height = '200px'
  img.style.objectFit = 'contain'
  img.onload = () => {
    if (!qrCodeElement || !qrCodeElement.isConnected) return
    qrCodeElement.innerHTML = ''
    qrCodeElement.appendChild(img)
  }
  img.onerror = () => {
    if (!qrCodeElement || !qrCodeElement.isConnected) return
    qrCodeElement.innerHTML =
      '<div class="qr-loading qr-loading--fail"><span class="qr-loading-text">二维码加载失败</span></div>'
  }
  img.src = src
}

async function initQRLogin() {
  stopLoginPoll()

  const qrCodeElement = document.getElementById('qrCode') || document.querySelector('.qr-code')
  qrStatusElement = document.getElementById('qrStatus') || document.querySelector('.qr-status')

  if (qrCodeElement) {
    qrCodeElement.innerHTML = QR_LOADING_HTML
  }

  if (qrStatusElement) {
    qrStatusElement.textContent = ''
    qrStatusElement.style.color = '#9499a0'
  }

  try {
    const result = await ipcRenderer.invoke('get-login-qrcode')

    if (result.success && result.data && result.data.url) {
      currentQCode = result.data.qcode
      if (qrStatusElement) {
        qrStatusElement.textContent = ''
      }
      startLoginPoll()
      if (qrCodeElement) {
        mountQrCodeWhenLoaded(qrCodeElement, result.data.url)
      }
    } else {
      if (qrCodeElement) {
        qrCodeElement.innerHTML = '<div class="qr-loading qr-loading--fail"><span class="qr-loading-text">获取二维码失败</span></div>'
      }
      if (qrStatusElement) {
        qrStatusElement.textContent = '获取失败，请关闭重试'
        qrStatusElement.style.color = '#f57070'
      }
    }
  } catch (error) {
    console.error('初始化登录失败:', error)
    if (qrCodeElement) {
      qrCodeElement.innerHTML = '<div class="qr-loading qr-loading--fail"><span class="qr-loading-text">获取二维码失败</span></div>'
    }
    if (qrStatusElement) {
      qrStatusElement.textContent = '网络错误，请检查网络连接'
      qrStatusElement.style.color = '#f57070'
    }
  }
}

async function startLoginPoll() {
  if (!currentQCode) return

  pollInterval = setInterval(async () => {
    try {
      const result = await ipcRenderer.invoke('poll-login-status', currentQCode)
      if (result.success && result.data) {
        const status = result.data.status
        if (status === 'scanned' && qrStatusElement) {
          qrStatusElement.textContent = '扫码成功！请在手机上确认登录'
          qrStatusElement.style.color = '#00a1d6'
        } else if (status === 'success') {
          if (qrStatusElement) {
            qrStatusElement.textContent = '登录成功！'
            qrStatusElement.style.color = '#00a1d6'
          }
          stopLoginPoll()
          setTimeout(async () => {
            document.getElementById('loginModal').style.display = 'none'
            await checkLoginStatus()
          }, 1000)
        } else if (status === 'expired') {
          stopLoginPoll()
          setTimeout(() => initQRLogin(), 2000)
        }
      }
    } catch (error) {
      console.error('轮询错误:', error)
    }
  }, 2000)
}

function stopLoginPoll() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  currentQCode = null
  ipcRenderer.invoke('stop-login-poll')
}
