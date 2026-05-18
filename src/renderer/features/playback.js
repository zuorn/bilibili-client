// 播放模块

function getMpvPath() {
  return localStorage.getItem('mpvPath') || ''
}

function useBuiltinPlayer() {
  return localStorage.getItem('useBuiltinPlayer') === 'true'
}

function playVideo(bvid, cid, title, progress) {
  const mpvPath = getMpvPath()
  const showDanmaku = localStorage.getItem('showDanmaku') !== 'false'
  const useBuiltin = useBuiltinPlayer()
  ipcRenderer.invoke('play-video', bvid, cid, title, mpvPath, showDanmaku, useBuiltin, progress)
}
