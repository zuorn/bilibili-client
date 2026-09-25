// ipc-shim.js — Tauri 迁移兼容层
// 作用：伪造 window.ipcRenderer 与 window.require('electron')，
// 使渲染层（src/renderer/**、src/pages/player.html）在 Tauri 下零改动运行。
// 必须在 index.html / player.html 中第一个加载（早于 state.js 与所有内联脚本）。
(function () {
  'use strict'

  // ---------- Tauri API 获取 ----------
  function getTauri() {
    return window.__TAURI__ || null
  }

  // ---------- 环境检测：仅在 Tauri 下激活，Electron 不干预 ----------
  var tauri = getTauri()
  if (!tauri) {
    // Electron 环境：不伪造任何全局变量，保留原生 ipcRenderer 和 require
    console.log('[ipc-shim] skipped (Electron environment detected)')
    return
  }

  console.log('[ipc-shim] initialized, tauri: true')

  var listeners = {} // channel -> [handler]

  var ipcRenderer = {
    /**
     * 请求-响应：对应 Electron ipcRenderer.invoke(channel, ...args)
     * Rust 侧统一入口命令 `ipc`，按 channel 分发到各模块处理函数。
     */
    invoke: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1)
      var tauri = getTauri()
      if (!tauri) {
        return Promise.resolve(null)
      }
      return tauri.core.invoke('ipc', { channel: channel, args: args }).catch(function (err) {
        // 与 Electron 行为对齐：invoke 失败时 reject，调用方各自 try/catch。
        // 但保持错误为 Error 实例，避免渲染层拿到字符串后 .message 为 undefined。
        if (err instanceof Error) throw err
        var e = new Error(typeof err === 'string' ? err : JSON.stringify(err))
        // Tauri 错误格式通常为 "channel 名::错误信息"
        var parts = typeof err === 'string' ? err.split('::') : []
        if (parts.length > 1) {
          e.channel = parts[0]
          e.message = parts.slice(1).join('::')
        }
        throw e
      })
    },

    /**
     * 订阅主进程推送：对应 Electron ipcRenderer.on(channel, (event, data) => {})
     * Rust 侧用 app.emit(channel, payload) 推送，事件名与原 IPC 通道一致。
     * 返回取消订阅函数（部分代码用 ipcRenderer.removeListener 语义）。
     */
    on: function (channel, handler) {
      listeners[channel] = listeners[channel] || []
      listeners[channel].push(handler)
      var tauri = getTauri()
      if (tauri && tauri.event && tauri.event.listen) {
        var unlisten = null
        tauri.event.listen(channel, function (e) {
          handler({ sender: null, channel: channel }, e.payload)
        }).then(function (fn) { unlisten = fn })
        // 保存 tauri 侧退订，供 off/removeListener 使用
        handler.__tauriUnlisten = function () { if (unlisten) unlisten() }
      }
      return function () { ipcRenderer.removeListener(channel, handler) }
    },

    once: function (channel, handler) {
      var wrapped = function (event, data) {
        ipcRenderer.removeListener(channel, wrapped)
        handler(event, data)
      }
      return ipcRenderer.on(channel, wrapped)
    },

    removeListener: function (channel, handler) {
      var arr = listeners[channel]
      if (!arr) return
      var i = arr.indexOf(handler)
      if (i !== -1) arr.splice(i, 1)
      if (handler && typeof handler.__tauriUnlisten === 'function') {
        try { handler.__tauriUnlisten() } catch (_) {}
      }
    },

    removeAllListeners: function (channel) {
      var arr = listeners[channel]
      if (!arr) return
      arr.forEach(function (h) {
        if (h && typeof h.__tauriUnlisten === 'function') {
          try { h.__tauriUnlisten() } catch (_) {}
        }
      })
      delete listeners[channel]
    },

    /**
     * 单向消息：对应 Electron ipcRenderer.send(channel, ...args)
     * 走同一 Rust 分发入口（处理函数自行忽略返回值）。
     */
    send: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1)
      var tauri = getTauri()
      if (!tauri) return
      tauri.core.invoke('ipc', { channel: channel, args: args }).catch(function (err) {
        console.warn('[ipc-shim] send(' + channel + ') failed:', err)
      })
    },

    sendSync: function (channel) {
      // 项目内未使用 sendSync，提供兜底避免崩溃
      console.warn('[ipc-shim] sendSync is not supported, channel:', channel)
      return null
    }
  }

  window.ipcRenderer = ipcRenderer

  // 伪造 require('electron')，覆盖 state.js / player.html 内联脚本的用法。
  window.require = function (moduleName) {
    if (moduleName === 'electron') {
      return { ipcRenderer: ipcRenderer }
    }
    throw new Error('[ipc-shim] require("' + moduleName + '") is not available under Tauri')
  }

  // WebView2 中脚本调用 window.close() 会绕过 Tauri 的 CloseRequested 事件，
  // 直接把页面内容清空（留下空白窗口，事件监听全部失效）。
  // 统一改走 close-window 通道，由 Rust 侧决定行为（主窗口隐藏到托盘 / 播放器窗口移到屏外）。
  window.close = function () {
    ipcRenderer.invoke('close-window').catch(function (err) {
      console.warn('[ipc-shim] window.close() via close-window failed:', err)
    })
  }

})()
