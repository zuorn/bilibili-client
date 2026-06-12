(function() {
  'use strict'

  var updateBtn = null
  var currentStatus = 'checking'
  var updateWindow = null

  function createUpdateButton() {
    updateBtn = document.createElement('button')
    updateBtn.id = 'updateBtn'
    updateBtn.className = 'update-btn'
    updateBtn.style.display = 'none'
    updateBtn.textContent = '更新'

    updateBtn.addEventListener('click', function() {
      switch (currentStatus) {
        case 'available':
          ipcRenderer.invoke('download-update')
          break
        case 'downloading':
          if (window.showToast) {
            window.showToast('正在下载更新，请稍候...', 'info')
          }
          break
        case 'downloaded':
          createUpdateProgressWindow()
          ipcRenderer.invoke('install-update')
          break
        case 'error':
          ipcRenderer.invoke('check-for-update')
          break
      }
    })

    var headerRight = document.querySelector('.header-right')
    var searchBox = document.querySelector('.search-box')
    if (headerRight && searchBox) {
      headerRight.insertBefore(updateBtn, searchBox)
    }
  }

  function createUpdateProgressWindow() {
    if (updateWindow && !updateWindow.closed) {
      updateWindow.focus()
      return
    }

    updateWindow = window.open('', '_blank', 'width=400,height=200,top=200,left=200,toolbar=no,menubar=no,scrollbars=no,resizable=no')
    if (!updateWindow) {
      if (window.showToast) {
        window.showToast('无法打开更新窗口，请检查弹窗设置', 'error')
      }
      return
    }

    updateWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>正在更新</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            text-align: center;
            width: 100%;
            max-width: 320px;
          }
          .icon {
            width: 64px;
            height: 64px;
            margin: 0 auto 20px;
            background: #00a1d6;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 28px;
          }
          .title {
            font-size: 18px;
            color: #333;
            margin-bottom: 8px;
          }
          .progress-text {
            font-size: 14px;
            color: #666;
            margin-bottom: 16px;
          }
          .progress-bar {
            width: 100%;
            height: 8px;
            background: #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
          }
          .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00a1d6, #00b5e5);
            border-radius: 4px;
            transition: width 0.3s ease;
          }
          .status {
            font-size: 12px;
            color: #999;
            margin-top: 12px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">⟳</div>
          <div class="title">正在更新</div>
          <div class="progress-text">准备安装...</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: 0%"></div>
          </div>
          <div class="status">等待安装程序启动...</div>
        </div>
        <script>
          window.addEventListener('message', function(e) {
            var data = e.data
            if (data.type === 'update-progress') {
              var progress = document.querySelector('.progress-fill')
              var text = document.querySelector('.progress-text')
              var status = document.querySelector('.status')
              if (progress) progress.style.width = data.percent + '%'
              if (text) text.textContent = data.message
              if (status) status.textContent = data.detail
            } else if (data.type === 'update-complete') {
              document.querySelector('.icon').textContent = '✓'
              document.querySelector('.icon').style.background = '#1e8e3e'
              document.querySelector('.title').textContent = '更新完成'
              document.querySelector('.progress-text').textContent = '即将重新启动...'
              document.querySelector('.status').textContent = '正在准备启动应用...'
            }
          })
        </script>
      </body>
      </html>
    `)
    updateWindow.document.close()
  }

  function closeUpdateWindow() {
    if (updateWindow && !updateWindow.closed) {
      updateWindow.close()
      updateWindow = null
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
        ipcRenderer.invoke('download-update')
        break

      case 'downloading':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-downloading'
        var pct = data.percent != null ? data.percent.toFixed(0) : ''
        updateBtn.textContent = pct ? '更新：' + pct + '%' : '更新'
        updateBtn.title = '正在下载更新...'
        break

      case 'downloaded':
        updateBtn.style.display = 'flex'
        updateBtn.className = 'update-btn update-downloaded'
        updateBtn.textContent = '更新'
        updateBtn.title = '更新已下载 — 点击安装'
        break

      case 'error':
        updateBtn.style.display = 'none'
        break
    }
  }

  ipcRenderer.on('update-status', function(event, data) {
    setStatus(data.status, data)

    if (updateWindow && !updateWindow.closed) {
      if (data.status === 'installing') {
        updateWindow.postMessage({
          type: 'update-progress',
          percent: data.percent || 0,
          message: data.message || '正在安装...',
          detail: data.detail || ''
        }, '*')
      } else if (data.status === 'update-complete') {
        updateWindow.postMessage({ type: 'update-complete' }, '*')
        setTimeout(closeUpdateWindow, 2000)
      }
    }
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUpdateButton)
  } else {
    createUpdateButton()
  }
})()