// 共享工具函数

function parseConf(content) {
  const config = {}
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      continue
    }

    const [key, value] = trimmed.split('=', 2)
    if (key && value !== undefined) {
      config[key.trim()] = value.trim()
    }
  }

  return config
}

function convertConfToShortcuts(conf) {
  const shortcuts = {}
  const keys = Object.keys(conf)

  for (const key of keys) {
    if (key.endsWith('.label')) {
      const id = key.replace('.label', '')
      const label = conf[key]
      const keysStr = conf[id + '.keys'] || ''

      const keyCombinations = keysStr.split(',').map(k => {
        return k.trim().split('+').map(k2 => k2.trim())
      }).filter(k => k.length > 0 && k[0] !== '')

      shortcuts[id] = {
        label: label,
        keys: keyCombinations
      }
    }
  }

  return shortcuts
}

async function loadDefaultShortcuts() {
  try {
    const response = await fetch('./src/config/defaultShortcuts.conf')
    if (response.ok) {
      const content = await response.text()
      const conf = parseConf(content)
      const config = convertConfToShortcuts(conf)
      defaultShortcuts = config
      console.log('默认快捷键配置加载成功:', defaultShortcuts)
      if (!userShortcuts.focusSearch || !userShortcuts.clearSearch || !userShortcuts.goBack) {
        userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
      }
    } else {
      console.error('加载默认快捷键配置失败，状态码:', response.status)
    }
  } catch (e) {
    console.error('加载默认快捷键配置失败:', e)
  }
}

function fixImageUrl(url) {
  if (!url) return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"></svg>'
  return url.startsWith('//') ? 'https:' + url : url
}

// Bilibili CDN supports appending @widthw_heighth to resize images.
// Original covers are ~1920x1080 (~200-400KB); resized to 672x378 is ~15-30KB.
function optimizeCoverUrl(url, width, height) {
  if (!url) return fixImageUrl(url)
  if (url.startsWith('data:')) return url
  const full = fixImageUrl(url)
  if (full.includes('@')) return full
  return full + '@' + width + 'w_' + height + 'h'
}

function formatPlayCount(count) {
  if (!count) return '0'
  if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿'
  if (count >= 10000) return (count / 10000).toFixed(1) + '万'
  return count.toString()
}

function formatDuration(duration) {
  if (!duration) return ''
  if (typeof duration === 'string') {
    if (duration.includes(':')) return duration
    if (duration.toLowerCase() === 'nan') return ''
    duration = parseInt(duration, 10)
  }
  if (isNaN(duration) || duration < 0) return ''
  return `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`
}

function mapVideoItem(item, options = {}) {
  const { showPlaySuffix = false, authorFallback = '未知UP主' } = options
  return {
    bvid: item.bvid || '',
    title: (item.title || '').replace(/<[^>]+>/g, ''),
    pic: optimizeCoverUrl(item.pic || item.picture || '', 672, 378),
    play: formatPlayCount(item.stat?.view || item.play || item.view || 0) + (showPlaySuffix ? '播放' : ''),
    duration: formatDuration(item.duration || item.length || 0),
    cid: item.cid || '',
    author: item.owner?.name || item.author || item.uname || authorFallback,
    owner: item.owner?.mid ? item.owner : { mid: item.mid || item.author_mid || item.owner?.id || '', name: item.author || item.uname || authorFallback }
  }
}

function showToast(message, duration = 3000) {
  let container = document.querySelector('.toast-container')
  if (!container) {
    container = document.createElement('div')
    container.className = 'toast-container'
    document.body.appendChild(container)
  }

  const toast = document.createElement('div')
  toast.className = 'toast-item'
  toast.textContent = message
  container.appendChild(toast)

  setTimeout(() => {
    if (toast.parentNode) toast.remove()
  }, duration)
}

function escapeHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}
