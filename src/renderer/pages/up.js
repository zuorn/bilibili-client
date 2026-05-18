// UP主页面模块

async function navigateToUP(mid) {
  pageStates.up.mid = mid
  pageStates.up.offset = ''
  pageStates.up.hasMore = true
  pageStates.up.loading = false
  pageStates.up.scrollLocked = false
  pageStates.up.name = ''

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
  updateBackButton()

  const content = document.querySelector('.content')
  if (content) {
    content.removeEventListener('scroll', handleScroll)
    content.removeEventListener('scroll', handleDynamicScroll)
    content.addEventListener('scroll', handleScroll)
  }

  resetUpProfileUI()
  await fetchUpInfo(mid)
  loadUpVideos(mid, '')
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
}

async function fetchUpInfo(mid) {
  try {
    const result = await ipcRenderer.invoke('fetch-up-info', mid)
    console.log('fetchUpInfo result:', result)

    if (result.success && result.data?.data?.card) {
      const card = result.data.data.card
      console.log('UP card data:', card)

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

      console.log('DOM elements - upName:', upName, 'upSign:', upSign)

      if (upAvatar) {
        upAvatar.src = fixImageUrl(card.face) || 'https://i0.hdslb.com/bfs/archive/placeholder.png'
        upAvatar.onerror = function() {
          this.src = 'https://i0.hdslb.com/bfs/archive/placeholder.png'
        }
      } else {
        console.error('upAvatar element not found')
      }

      if (upName) {
        upName.textContent = upNameValue
        console.log('Set upName to:', upNameValue)
      } else {
        console.error('upName element not found')
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
            <circle cx="16" cy="16" r="14" fill="#fb7299"/>
            <text x="16" y="22" text-anchor="middle" fill="white" font-size="10" font-weight="bold">大会员</text>
          </svg>`
          upVip.style.display = 'inline-block'
        } else {
          upVip.style.display = 'none'
        }
      }
    } else {
      console.error('fetchUpInfo failed - result:', result)
    }
  } catch (error) {
    console.error('获取UP主信息失败:', error)
  }
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

          return {
            bvid: bvid,
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
