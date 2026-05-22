// 更新检查模块（渲染进程）
(function() {
  'use strict'

  var updateBtn = null
  var updateTooltip = null
  var currentStatus = 'checking'

  function createUpdateButton() {
    updateBtn = document.createElement('button')
    updateBtn.id = 'updateBtn'
    updateBtn.className = 'update-btn'
    updateBtn.style.display = 'none'
    updateBtn.title = '检查更新'
    updateBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'

    updateBtn.addEventListener('click', function() {
      if (currentStatus === 'available') {
        ipcRenderer.invoke('download-update')
      } else if (currentStatus === 'downloaded') {
        ipcRenderer.invoke('install-update')
      } else if (currentStatus === 'error' || currentStatus === 'up-to-date') {
        ipcRenderer.invoke('check-for-update')
      }
    })

    // 插入到 header-right 中，window-controls 之前
    var headerRight = document.querySelector('.header-right')
    var windowControls = document.querySelector('.window-controls')
    if (headerRight && windowControls) {
      headerRight.insertBefore(updateBtn, windowControls)
    }
  }

  function setStatus(status, data) {
    currentStatus = status

    if (!updateBtn) return

    switch (status) {
      case 'checking':
        updateBtn.style.display = 'none'
        break

      case 'available':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-available'
        updateBtn.title = '发现新版本 ' + (data.version || '') + ' — 点击下载'
        break

      case 'downloading':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-downloading'
        var pct = data.percent != null ? data.percent.toFixed(0) + '%' : ''
        updateBtn.title = '正在下载 ' + pct
        break

      case 'downloaded':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-downloaded'
        updateBtn.title = '更新已下载 — 点击安装并重启'
        break

      case 'error':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-error'
        updateBtn.title = '更新失败: ' + (data.message || '') + ' — 点击重试'
        break

      case 'up-to-date':
        updateBtn.style.display = 'none'
        break

      default:
        updateBtn.style.display = 'none'
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
