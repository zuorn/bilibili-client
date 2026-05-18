// ==================== 关注页面相关函数 ====================

function initFollowingPage() {
  console.log('initFollowingPage called')
  if (!currentUser?.isLogin) {
    openLoginModal()
    return
  }

  followingState.mid = currentUser.mid
  followingState.loading = false
  followingState.groups = []
  followingState.groupData = {}

  const sectionListEl = document.getElementById('followingSectionList')
  if (sectionListEl) {
    sectionListEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">加载中...</div>'
  }
  loadFollowingGroups()
}

async function loadFollowingGroups() {
  console.log('loadFollowingGroups called')
  try {
    const result = await ipcRenderer.invoke('get-following-groups', followingState.mid)
    if (result.success) {
      followingState.groups = result.data || []
      followingState.groupData = {}
      renderFollowingSections()
      loadAllGroupDataParallel()
    }
  } catch (error) {
    console.error('加载关注分组失败:', error)
    const sectionListEl = document.getElementById('followingSectionList')
    if (sectionListEl) {
      sectionListEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">加载失败，请稍后重试</div>'
    }
  }
}

function loadAllGroupDataParallel() {
  console.log('loadAllGroupDataParallel called')
  followingState.loading = true

  const sortedGroups = [...followingState.groups].sort((a, b) => {
    if (a.is_default === 1 && b.is_default !== 1) return 1
    if (a.is_default !== 1 && b.is_default === 1) return -1
    return 0
  })

  sortedGroups.forEach(group => {
    loadSingleGroupData(group)
  })
}

async function loadSingleGroupData(group) {
  try {
    const maxPs = 50
    const total = group.count || 0
    let allUsers = []

    let pn = 1
    while (allUsers.length < total) {
      const params = {
        mid: followingState.mid,
        tagid: group.tagid,
        pn: pn,
        ps: maxPs
      }

      if (group.tagid === 0) {
        params.order_type = followingState.orderType
      }

      const result = await ipcRenderer.invoke('get-following-list', params)

      if (result.success && result.data) {
        const users = result.data.list || []
        if (users.length === 0) break
        allUsers = allUsers.concat(users)
        if (users.length < maxPs) break
      } else {
        break
      }
      pn++
    }

    followingState.groupData[group.tagid] = allUsers
  } catch (error) {
    console.error(`加载分组 ${group.name} 数据失败:`, error)
    followingState.groupData[group.tagid] = []
  }

  updateSingleGroupSection(group)
}

function updateSingleGroupSection(group) {
  const sectionId = `followingSection-${group.tagid}`
  const sectionEl = document.getElementById(sectionId)
  if (!sectionEl) return

  const contentEl = sectionEl.querySelector('.following-section-content')
  const users = followingState.groupData[group.tagid] || []

  if (contentEl && users.length > 0) {
    let html = '<div class="following-users-grid">'
    users.forEach(user => {
      html += createFollowingUserCard(user)
    })
    html += '</div>'
    contentEl.innerHTML = html
  } else if (contentEl) {
    contentEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无关注用户</div>'
  }

  checkAllGroupsLoaded()
}

function checkAllGroupsLoaded() {
  const loadedCount = Object.keys(followingState.groupData).length
  if (loadedCount >= followingState.groups.length) {
    followingState.loading = false
  }
}

function renderFollowingSections() {
  const sectionListEl = document.getElementById('followingSectionList')
  if (!sectionListEl) return

  // 按分组类型排序：特别关注 > 默认分组 > 其他分组
  const sortedGroups = [...followingState.groups].sort((a, b) => {
    if (a.is_default === 1 && b.is_default !== 1) return 1
    if (a.is_default !== 1 && b.is_default === 1) return -1
    return 0
  })

  let html = ''

  sortedGroups.forEach((group, index) => {
    const users = followingState.groupData[group.tagid] || []
    const isDefault = group.is_default === 1
    const sectionId = `followingSection-${group.tagid}`
    const hasData = users.length > 0 || Object.keys(followingState.groupData).includes(String(group.tagid))

    const isDefaultGroup = group.tagid === 0
    const sortBtn = isDefaultGroup ? `
          <button class="following-section-sort-btn" onclick="event.stopPropagation(); toggleDefaultGroupSort('${sectionId}', ${group.tagid})">
            ${followingState.orderType === 'attention' ? '最近访问' : '最近关注'}
          </button>
        ` : ''

    html += `
      <div class="following-section" id="${sectionId}">
        <div class="following-section-header" onclick="toggleFollowingSection('${sectionId}')">
          <svg class="following-section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span class="following-section-title">${group.name}</span> <span class="following-section-count">${group.count}</span>
          ${sortBtn}
        </div>
        <div class="following-section-content">
    `

    if (hasData) {
      if (users.length > 0) {
        html += `<div class="following-users-grid">`
        users.forEach(user => {
          html += createFollowingUserCard(user)
        })
        html += `</div>`
      } else {
        html += `<div style="padding: 20px; text-align: center; color: #999;">暂无关注用户</div>`
      }
    } else {
      html += `<div style="padding: 20px; text-align: center; color: #999;">加载中...</div>`
    }

    html += `
        </div>
      </div>
    `
  })

  sectionListEl.innerHTML = html
}

function toggleFollowingSection(sectionId) {
  const sectionEl = document.getElementById(sectionId)
  if (!sectionEl) return

  const contentEl = sectionEl.querySelector('.following-section-content')
  const iconEl = sectionEl.querySelector('.following-section-icon')

  if (contentEl && iconEl) {
    contentEl.classList.toggle('collapsed')
    iconEl.classList.toggle('rotated')
  }
}

function toggleDefaultGroupSort(sectionId, tagid) {
  followingState.orderType = followingState.orderType === 'attention' ? '' : 'attention'

  const targetGroup = followingState.groups.find(g => g.tagid === tagid)
  if (targetGroup) {
    followingState.groupData[tagid] = []
    loadSingleGroupData(targetGroup)
  }

  renderFollowingSections()
}

function createFollowingUserCard(user) {
  const avatarUrl = fixImageUrl(user.face)
  const sign = user.sign || '这个人很神秘，什么都没有写~'
  const verifyIcon = user.vip_type === 2 ? `
    <svg class="user-verify-icon" viewBox="0 0 24 24" fill="none" stroke="#fb7299" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ` : ''

  return `
    <div class="following-user-card" data-mid="${user.mid}" onclick="navigateToUP(${user.mid})">
      <div class="user-card-inner">
        <div class="user-avatar-wrapper">
          <img class="user-avatar" src="${avatarUrl}" alt="${user.uname}" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><rect fill=%22%23ddd%22 width=%2280%22 height=%2280%22/></svg>'">
          ${verifyIcon}
        </div>
        <div class="user-info">
          <div class="user-name">${user.uname}</div>
          <div class="user-sign">${sign}</div>
          <button class="user-follow-btn">已关注</button>
        </div>
      </div>
    </div>
  `
}
