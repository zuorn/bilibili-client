// 更新检查模块（渲染进程）
(function() {
  'use strict'

  var updateBtn = null
  var currentStatus = 'checking'

  function createUpdateButton() {
    updateBtn = document.createElement('button')
    updateBtn.id = 'updateBtn'
    updateBtn.className = 'update-btn'
    updateBtn.style.display = 'none'
    updateBtn.textContent = '更新'

    updateBtn.addEventListener('click', function() {
      switch (currentStatus) {
        case 'available':
          // 发现新版本，点击后手动触发下载（以防自动下载未触发）
          ipcRenderer.invoke('download-update')
          break
        case 'downloading':
          // 正在下载中，给出提示
          if (window.showToast) {
            window.showToast('正在下载更新，请稍候...', 'info')
          }
          break
        case 'downloaded':
          ipcRenderer.invoke('install-update')
          break
        case 'error':
          ipcRenderer.invoke('check-for-update')
          break
      }
    })

    // 插入到搜索栏左边
    var headerRight = document.querySelector('.header-right')
    var searchBox = document.querySelector('.search-box')
    if (headerRight && searchBox) {
      headerRight.insertBefore(updateBtn, searchBox)
    }
  }

  function setStatus(status, data) {
    currentStatus = status
    if (!updateBtn) return

    switch (status) {
      case 'checking':
      case 'up-to-date':
        updateBtn.style.display = 'none'
        break

      case 'available':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-available'
        updateBtn.textContent = '更新'
        updateBtn.title = '发现新版本 ' + (data.version || '')
        // 自动开始下载
        ipcRenderer.invoke('download-update')
        break

      case 'downloading':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-downloading'
        var pct = data.percent != null ? data.percent.toFixed(0) + '%' : ''
        updateBtn.textContent = pct || '更新'
        updateBtn.title = '正在下载更新...'
        break

      case 'downloaded':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-downloaded'
        updateBtn.textContent = '更新'
        updateBtn.title = '更新已下载 — 点击安装并重启'
        break

      case 'error':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-error'
        updateBtn.textContent = '更新'
        updateBtn.title = (data.message || '更新失败') + ' — 点击重试'
        break
    }
  }

  // 监听主进程发来的更新状态
  ipcRenderer.on('update-status', function(event, data) {
    setStatus(data.status, data)
  })

  // 初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUpdateButton)
  } else {
    createUpdateButton()
  }
})()
