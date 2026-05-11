const { ipcRenderer } = require('electron')

const homeBtn = document.getElementById('homeBtn')
const loginBtn = document.getElementById('loginBtn')
const logoutBtn = document.getElementById('logoutBtn')
const loginModal = document.getElementById('loginModal')
const loginCloseBtn = document.getElementById('loginCloseBtn')
const loginArea = document.getElementById('loginArea')
const videoGrid = document.getElementById('videoGrid')
const noLoginArea = document.querySelector('.no-login-area')
const devToolsBtn = document.getElementById('devToolsBtn')

const pwdTab = document.getElementById('pwdTab')
const smsTab = document.getElementById('smsTab')

const QR_LOADING_HTML =
  '<div class="qr-loading" aria-live="polite"><span class="qr-loading-spinner" aria-hidden="true"></span><span class="qr-loading-text">加载中</span></div>'

let currentQCode = null
let pollInterval = null
let qrStatusElement = null
let currentUser = null
let currentTab = 'history'
let currentVideos = []
let currentHistoryCursor = null
let isHistoryLoading = false
let hasMoreHistory = true

const historyTab = document.querySelector('.breadcrumb-item[data-tab="history"]')
if (historyTab) {
  historyTab.classList.add('active')
}

homeBtn.addEventListener('click', () => {
  ipcRenderer.send('go-home')
})

loginBtn.addEventListener('click', () => {
  loginModal.style.display = 'flex'
  initQRLogin()
})

logoutBtn.addEventListener('click', async () => {
  try {
    await ipcRenderer.invoke('logout')
    currentUser = null
    updateLoginUI({ isLogin: false })
  } catch (error) {
    console.error('退出登录失败:', error)
  }
})

loginCloseBtn.addEventListener('click', () => {
  stopLoginPoll()
  loginModal.style.display = 'none'
})

loginArea.addEventListener('click', () => {
  if (!currentUser || !currentUser.isLogin) {
    loginModal.style.display = 'flex'
    initQRLogin()
  }
})

pwdTab.addEventListener('click', () => {
  pwdTab.classList.add('active')
  smsTab.classList.remove('active')
  document.querySelector('.pwd-login').classList.add('active')
  document.querySelector('.sms-login').classList.remove('active')
})

smsTab.addEventListener('click', () => {
  smsTab.classList.add('active')
  pwdTab.classList.remove('active')
  document.querySelector('.sms-login').classList.add('active')
  document.querySelector('.pwd-login').classList.remove('active')
})

document.querySelectorAll('.sidebar-item').forEach(item => {
  item.addEventListener('click', (e) => {
    const page = item.dataset.page
    if (page) {
      if (page === 'home') {
        ipcRenderer.send('go-home')
      } else if (page === 'popular') {
        ipcRenderer.send('open-popular')
      } else if (page === 'anime') {
        ipcRenderer.send('open-anime')
      } else if (page === 'media') {
        ipcRenderer.send('open-media')
      } else if (page === 'dynamic') {
        ipcRenderer.send('open-dynamic')
      } else if (page === 'my') {
        // Already on my page
      }
    }
  })
})

document.querySelectorAll('.breadcrumb-item').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.breadcrumb-item').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    const tabName = tab.dataset.tab
    currentTab = tabName
    if (tabName === 'history') {
      currentHistoryCursor = null
      hasMoreHistory = true
    }
    loadTabContent(tabName)
  })
})

function fixImageUrl(url) {
  if (!url) return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"></svg>'
  if (url.startsWith('//')) return 'https:' + url
  return url
}

function formatPlayCount(count) {
  if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿'
  if (count >= 10000) return (count / 10000).toFixed(1) + '万'
  return count.toString()
}

function formatDuration(duration) {
  if (!duration) return ''
  
  if (typeof duration === 'string') {
    if (duration.includes(':')) {
      return duration
    }
    if (duration.toLowerCase() === 'nan') {
      return ''
    }
    duration = parseInt(duration, 10)
  }
  
  if (isNaN(duration) || duration < 0) return ''
  
  const mins = Math.floor(duration / 60)
  const secs = duration % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function showError(message) {
  if (videoGrid) videoGrid.innerHTML = `<div style="padding: 40px; text-align: center; color: #999;">${message}</div>`
}

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

function formatProgress(current, total) {
  if (!total || total <= 0) return ''
  
  function formatSeconds(secs) {
    if (isNaN(secs) || secs < 0) return ''
    const mins = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${mins}:${s.toString().padStart(2, '0')}`
  }
  
  const currentStr = formatSeconds(current)
  const totalStr = formatSeconds(total)
  return `${currentStr}/${totalStr}`
}

function createVideoCard(video) {
  const card = document.createElement('div')
  card.className = 'my-anime-card'
  card.dataset.bvid = video.bvid
  card.dataset.cid = video.cid || ''

  card.innerHTML = `
    <div class="my-anime-cover">
      <img src="${video.pic}" alt="${video.title}" loading="lazy">
      ${video.progress !== undefined && video.progress !== null && video.durationSeconds ? `
        <div class="my-anime-progress">
          <div class="my-anime-progress-bar" style="width: ${Math.min(100, (video.progress / video.durationSeconds) * 100)}%"></div>
        </div>
      ` : ''}
    </div>
    <div class="my-anime-info">
      <h3 class="my-anime-title">${video.title}</h3>
      <div class="my-anime-history">
        <span class="my-anime-history-time">${video.historyTime || ''}</span>
        ${video.progress !== undefined && video.progress !== null ? `
          <span class="my-anime-history-progress">${formatProgress(video.progress, video.durationSeconds)}</span>
        ` : ''}
      </div>
    </div>
  `

  card.addEventListener('click', () => {
    if (video.bvid) {
      playVideo(video.bvid, video.cid, video.title)
    }
  })

  return card
}

function renderVideos(videos) {
  if (!videoGrid) return
  videoGrid.innerHTML = ''
  videos.forEach(video => {
    videoGrid.appendChild(createVideoCard(video))
  })

  if (!hasMoreHistory && videos.length > 0) {
    const endDiv = document.createElement('div')
    endDiv.textContent = '— 到底了 —'
    endDiv.style.cssText = 'text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;'
    videoGrid.appendChild(endDiv)
  }
}

function handleHistoryScroll() {
  if (currentTab !== 'history' || isHistoryLoading || !hasMoreHistory) {
    return
  }

  const scrollElement = document.querySelector('.content') || document.documentElement
  const scrollTop = scrollElement.scrollTop
  const scrollHeight = scrollElement.scrollHeight
  const clientHeight = scrollElement.clientHeight

  if (scrollTop + clientHeight >= scrollHeight - 300) {
    loadHistory(true)
  }
}

const tabsContainer = document.querySelector('.my-tabs-container')

if (tabsContainer) {
  tabsContainer.style.position = 'fixed'
  tabsContainer.style.top = '64px'
  tabsContainer.style.left = '80px'
  tabsContainer.style.right = '0'
  tabsContainer.style.zIndex = '50'
  tabsContainer.style.backgroundColor = '#f4f4f4'
  tabsContainer.style.paddingTop = '8px'
  tabsContainer.style.paddingBottom = '8px'
}

const contentElement = document.querySelector('.content')
if (contentElement) {
  contentElement.addEventListener('scroll', handleHistoryScroll)
}

function getMpvPath() {
  return localStorage.getItem('mpvPath') || ''
}

function playVideo(bvid, cid, title) {
  const mpvPath = getMpvPath()
  ipcRenderer.invoke('play-video', bvid, cid, title, mpvPath)
}

function navigateToUP(mid) {
  ipcRenderer.send('open-up', mid)
}

async function checkLoginStatus() {
  console.log('checkLoginStatus called')
  try {
    const result = await ipcRenderer.invoke('get-user-info')
    console.log('get-user-info result:', result)

    if (result.success && result.data) {
      currentUser = result.data
      console.log('Current user:', currentUser)
      updateLoginUI(currentUser)

      if (currentUser.isLogin) {
        loadTabContent(currentTab)
        loadUserFollowings(currentUser.mid)
      }
    }
  } catch (error) {
    console.error('检查登录状态失败:', error)
  }
}

function updateLoginUI(user) {
  const loginText = document.querySelector('.my-login-text')
  const myAvatar = document.querySelector('.my-avatar')
  const myCoins = document.querySelector('.my-coins')
  const myEditBtn = document.querySelector('.my-edit-btn')

  if (user.isLogin) {
    loginText.textContent = user.uname || '用户'

    if (user.face) {
      myAvatar.innerHTML = `<img src="${user.face}" alt="头像" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`
    }

    myCoins.innerHTML = `
      <span>B币: ${user.bCoins || 0}</span>
      <span class="separator">|</span>
      <span>硬币: ${user.coins || 0}</span>
    `

    const statValues = document.querySelectorAll('.my-stat-item .stat-value')
    if (statValues[0]) statValues[0].textContent = user.dynamic || '0'
    if (statValues[1]) statValues[1].textContent = user.following || '0'
    if (statValues[2]) statValues[2].textContent = formatPlayCount(user.follower || 0)

    const walletValues = document.querySelectorAll('.wallet-value')
    if (walletValues[0]) walletValues[0].textContent = user.bCoins || 0
    if (walletValues[1]) walletValues[1].textContent = user.coins || 0

    const vipValue = document.querySelector('.wallet-card:last-child .wallet-value')
    if (vipValue) {
      if (user.vipStatus === 1) {
        vipValue.textContent = user.vipType === 2 ? '年度大会员' : '大会员'
        vipValue.style.color = '#fb7299'
      } else {
        vipValue.textContent = '未开通'
        vipValue.style.color = '#18191c'
      }
    }

    if (myEditBtn) {
      myEditBtn.style.display = 'block'
    }

    logoutBtn.style.display = 'block'

    noLoginArea.style.display = 'none'
    videoGrid.style.display = 'grid'
  } else {
    loginText.textContent = '点击登录'
    myAvatar.innerHTML = `
      <svg viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="20" fill="#f5f5f5"/>
        <circle cx="24" cy="20" r="8" fill="#e0e0e0"/>
        <circle cx="20" cy="18" r="1.5" fill="#999"/>
        <circle cx="28" cy="18" r="1.5" fill="#999"/>
        <path d="M20 26 Q24 30 28 26" stroke="#999" stroke-width="2" fill="none"/>
      </svg>
    `
    myCoins.innerHTML = `
      <span>B币: -</span>
      <span class="separator">|</span>
      <span>硬币: -</span>
    `

    const statValues = document.querySelectorAll('.my-stat-item .stat-value')
    statValues.forEach(val => val.textContent = '0')

    noLoginArea.style.display = 'flex'
    videoGrid.style.display = 'none'

    if (myEditBtn) {
      myEditBtn.style.display = 'none'
    }

    logoutBtn.style.display = 'none'
  }
}

async function loadTabContent(tabName) {
  if (!currentUser || !currentUser.isLogin) {
    showError('请先登录')
    return
  }

  switch (tabName) {
    case 'history':
      loadHistory()
      break
    case 'favorites':
      loadFavorites()
      break
    case 'offline':
      if (videoGrid) {
        videoGrid.innerHTML = `<div style="padding: 80px 40px; text-align: center; color: #999;">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px;">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7.5 20.5 2 22l1.5-5.5L17 3.5z"></path>
          </svg>
          <div style="font-size: 16px; margin-bottom: 8px;">离线缓存</div>
          <div style="font-size: 14px;">暂未实现此功能</div>
        </div>`
      }
      break
    case 'watchlater':
      if (videoGrid) {
        videoGrid.innerHTML = `<div style="padding: 80px 40px; text-align: center; color: #999;">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px;">
            <path d="M19 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2z"></path>
            <path d="M19 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2z"></path>
            <polyline points="16 14 12 10 8 14"></polyline>
            <line x1="12" y1="10" x2="12" y2="20"></line>
          </svg>
          <div style="font-size: 16px; margin-bottom: 8px;">稍后再看</div>
          <div style="font-size: 14px;">暂未实现此功能</div>
        </div>`
      }
      break
  }
}

async function loadHistory(append = false) {
  console.log('=== loadHistory called: append=' + append + ' ===')
  console.log('currentHistoryCursor:', currentHistoryCursor)
  console.log('isHistoryLoading:', isHistoryLoading)
  console.log('hasMoreHistory:', hasMoreHistory)
  
  if (isHistoryLoading) return
  if (!append) {
    currentHistoryCursor = null
    hasMoreHistory = true
  }
  if (!hasMoreHistory && append) {
    console.log('No more history, skipping...')
    return
  }

  isHistoryLoading = true
  try {
    console.log('Invoking get-history with cursor:', currentHistoryCursor)
    const result = await ipcRenderer.invoke('get-history', currentHistoryCursor)
    console.log('get-history result:', JSON.stringify(result))
    
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: '观看过',
        duration: formatDuration(item.duration || 0),
        durationSeconds: item.duration || 0,
        author: item.author || '未知UP主',
        mid: item.authorMid || '',
        owner: item.authorMid ? { mid: item.authorMid, name: item.author || '未知UP主' } : null,
        progress: item.progress,
        historyTime: formatHistoryTime(item.viewAt)
      })).filter(v => v.bvid || v.title)

      console.log('Parsed videos count:', videos.length)

      if (videos.length > 0) {
        if (append) {
          currentVideos = [...currentVideos, ...videos]
          appendVideos(videos)
        } else {
          currentVideos = videos
          renderVideos(currentVideos)
        }

        hasMoreHistory = result.hasMore
        currentHistoryCursor = result.nextCursor
        console.log('Updated cursor:', currentHistoryCursor)
        console.log('Updated hasMoreHistory:', hasMoreHistory)
      } else {
        console.log('No videos returned')
        if (!append) {
          showError('暂无观看记录')
        }
        hasMoreHistory = false
      }
    } else {
      console.log('Result not successful or no data:', result)
      if (!append) {
        showError('获取历史记录失败')
      }
    }
  } catch (error) {
    console.error('加载历史记录失败:', error)
    if (!append) {
      showError('加载历史记录失败')
    }
  } finally {
    isHistoryLoading = false
  }
}

function appendVideos(videos) {
  if (!videoGrid) return
  videos.forEach(video => {
    videoGrid.appendChild(createVideoCard(video))
  })

  if (!hasMoreHistory && videos.length > 0) {
    const endDiv = document.createElement('div')
    endDiv.textContent = '— 到底了 —'
    endDiv.style.cssText = 'text-align: center; padding: 20px; color: #999; grid-column: 1 / -1;'
    videoGrid.appendChild(endDiv)
  }
}

async function loadFavorites() {
  try {
    const result = await ipcRenderer.invoke('get-favorites', 166434448, 1, 36)
    if (result.success && result.data) {
      const videos = result.data.map(item => ({
        bvid: item.bvid || '',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        pic: fixImageUrl(item.pic || ''),
        play: formatPlayCount(item.cnt_info?.play || item.play || 0),
        duration: formatDuration(item.duration || 0),
        author: item.upper?.name || item.author || '未知UP主',
        owner: item.upper?.mid ? { mid: item.upper.mid, name: item.upper.name || item.author || '未知UP主' } : { mid: item.mid || '', name: item.author || '未知UP主' }
      })).filter(v => v.bvid || v.title)

      if (videos.length > 0) {
        currentVideos = videos
        renderVideos(currentVideos)
      } else {
        showError('暂无收藏内容')
      }
    } else {
      showError('获取收藏失败')
    }
  } catch (error) {
    console.error('加载收藏失败:', error)
    showError('加载收藏失败')
  }
}

async function loadUserFollowings(mid) {
  // 暂时不需要显示关注列表
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

  const qrCodeElement = document.querySelector('.qr-code')
  qrStatusElement = document.querySelector('.qr-status')

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
      const qrUrl = result.data.url

      if (qrStatusElement) {
        qrStatusElement.textContent = ''
      }

      startLoginPoll()
      if (qrCodeElement) {
        mountQrCodeWhenLoaded(qrCodeElement, qrUrl)
      }
    } else {
      if (qrCodeElement) {
        qrCodeElement.innerHTML =
          '<div class="qr-loading qr-loading--fail"><span class="qr-loading-text">获取二维码失败</span></div>'
      }
      if (qrStatusElement) {
        qrStatusElement.textContent = result.error || '请重试'
        qrStatusElement.style.color = '#ff0000'
      }
    }
  } catch (error) {
    console.error('初始化登录失败:', error)
    if (qrCodeElement) {
      qrCodeElement.innerHTML =
        '<div class="qr-loading qr-loading--fail"><span class="qr-loading-text">网络错误</span></div>'
    }
    if (qrStatusElement) {
      qrStatusElement.textContent = '网络错误，请重试'
      qrStatusElement.style.color = '#ff0000'
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

        if (status === 'scanned') {
          if (qrStatusElement) {
            qrStatusElement.textContent = '扫码成功！请在手机上确认登录'
            qrStatusElement.style.color = '#00a1d6'
          }
        } else if (status === 'success') {
          if (qrStatusElement) {
            qrStatusElement.textContent = '登录成功！正在加载用户信息...'
            qrStatusElement.style.color = '#00a1d6'
          }
          stopLoginPoll()
          setTimeout(async () => {
            loginModal.style.display = 'none'
            await checkLoginStatus()
          }, 1000)
        } else if (status === 'expired') {
          if (qrStatusElement) {
            qrStatusElement.textContent = '二维码已过期，请重新获取'
            qrStatusElement.style.color = '#ff0000'
          }
          stopLoginPoll()
          setTimeout(() => {
            initQRLogin()
          }, 2000)
        } else if (status === 'cancelled') {
          if (qrStatusElement) {
            qrStatusElement.textContent = '扫码已取消'
            qrStatusElement.style.color = '#ff0000'
          }
          stopLoginPoll()
        }
      } else {
        console.error('轮询失败:', result.error)
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

checkLoginStatus()

const minBtn = document.getElementById('minBtn')
const maxBtn = document.getElementById('maxBtn')
const closeBtn = document.getElementById('closeBtn')

minBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('minimize-window')
})

maxBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('maximize-window')
})

closeBtn?.addEventListener('click', () => {
  ipcRenderer.invoke('close-window')
})

devToolsBtn?.addEventListener('click', async () => {
  try {
    await ipcRenderer.invoke('open-dev-tools')
  } catch (error) {
    console.error('打开开发者工具失败:', error)
  }
})

const refreshBtn = document.getElementById('refreshBtn')
const backTopBtn = document.getElementById('backTopBtn')

refreshBtn?.addEventListener('click', () => {
  if (currentUser && currentUser.isLogin) {
    currentHistoryCursor = null
    hasMoreHistory = true
    loadTabContent(currentTab)
    // 刷新后滚动到顶部
    const content = document.querySelector('.content') || document.documentElement
    content.scrollTo({ top: 0, behavior: 'smooth' })
  }
})

backTopBtn?.addEventListener('click', () => {
  const content = document.querySelector('.content')
  if (content) {
    content.scrollTo({ top: 0, behavior: 'smooth' })
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
})
