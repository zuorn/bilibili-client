// IPC handlers and utilities for history-related operations
const cookieManager = require('../cookieManager')
const https = require('https')
const { URL } = require('url')

// 格式化时间为 MM:SS 或 HH:MM:SS
function formatProgressTime(seconds) {
  const secs = Math.floor(seconds)
  const hours = Math.floor(secs / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${mins}:${s.toString().padStart(2, '0')}`
}

// 上报播放历史
async function reportPlayHistory(aid, cid, progress) {
  const savedCookies = cookieManager.getSavedCookies()
  if (!savedCookies.SESSDATA || !savedCookies.bili_jct) {
    return false
  }

  const formattedProgress = formatProgressTime(progress)

  return new Promise((resolve) => {
    const data = `aid=${aid}&cid=${cid}&progress=${Math.floor(progress)}&platform=pc&csrf=${savedCookies.bili_jct}`
    const options = {
      hostname: 'api.bilibili.com',
      port: 443,
      path: '/x/v2/history/report',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieManager.getCookieString(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      rejectUnauthorized: false
    }

    const req = https.request(options, (res) => {
      let responseData = ''
      res.on('data', (chunk) => {
        responseData += chunk
      })
      res.on('end', () => {
        try {
          const result = JSON.parse(responseData)
          resolve(result.code === 0)
        } catch (e) {
          resolve(false)
        }
      })
    })

    req.on('error', () => {
      resolve(false)
    })

    req.write(data)
    req.end()
  })
}

function formatHistoryTime(timestamp) {
  if (!timestamp) return '刚刚'

  const now = Date.now() / 1000
  const diff = now - timestamp

  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 604800) return `${Math.floor(diff / 86400)}天前`

  const date = new Date(timestamp * 1000)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function registerHistoryHandlers(deps) {
  const { ipcMain, log } = deps

  ipcMain.handle('get-history', async (event, cursor = null) => {
    log('get-history called, cursor:', cursor)
    try {
      let url = `https://api.bilibili.com/x/web-interface/history/cursor?type=all&ps=20`

      if (cursor && cursor.max && cursor.view_at) {
        url += `&max=${cursor.max}&view_at=${cursor.view_at}&business=${cursor.business || 'archive'}`
        log('Using cursor params: max=' + cursor.max + ', view_at=' + cursor.view_at + ', business=' + cursor.business)
      } else {
        url += '&max=0&view_at=0&business=archive'
        log('Using initial params: max=0, view_at=0, business=archive')
      }

      const result = await deps.fetchApi(url)
      log('History result code:', result.code)

      if (result.code === 0 && result.data) {
        const list = result.data.list || []
        const cursorData = result.data.cursor || {}
        const hasMore = !(cursorData.max == 0 && cursorData.view_at == 0)

        log('History list length:', list.length)
        log('Cursor data:', JSON.stringify(cursorData))
        log('Has more:', hasMore)

        if (list.length > 0) {
          log('First item uri:', list[0].uri)
          log('First item bvid:', list[0].bvid)
          log('First item history:', JSON.stringify(list[0].history))
        }

        return {
          success: true,
          data: list.map(item => {
            let bvid = ''
            if (item.bvid) {
              bvid = item.bvid
            } else if (item.history?.bvid) {
              bvid = item.history.bvid
            } else if (item.uri) {
              const match = item.uri.match(/BV[\w]+/)
              if (match) bvid = match[0]
            }

            return {
              bvid: bvid,
              title: item.title || item.long_title || '',
              pic: item.cover || '',
              duration: item.duration || 0,
              author: item.author_name || '',
              authorMid: item.author_mid || '',
              authorFace: item.author_face || '',
              viewAt: item.view_at || 0,
              progress: item.progress || 0,
              isFinish: item.is_finish || false,
              historyTime: formatHistoryTime(item.view_at)
            }
          }),
          nextCursor: {
            max: cursorData.max || 0,
            view_at: cursorData.view_at || 0,
            business: cursorData.business || 'archive'
          },
          hasMore: hasMore
        }
      } else {
        return { success: false, error: '获取历史记录失败' }
      }
    } catch (error) {
      log('Error getting history:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('delete-history', async (event, bvid) => {
    log('delete-history called, bvid:', bvid)
    try {
      if (!bvid) {
        return { success: false, error: '缺少视频ID' }
      }

      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''
      if (!csrf) {
        return { success: false, error: '缺少 bili_jct，无法删除历史记录' }
      }

      return new Promise((resolve) => {
        const params = new URLSearchParams({ bvid, csrf })
        const data = params.toString()
        const path = '/x/v2/history/delete'
        log('Delete history path:', path, 'body:', data)
        const options = {
          hostname: 'api.bilibili.com',
          port: 443,
          path: path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(data),
            'Cookie': cookieManager.getCookieString(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.bilibili.com/',
            'Origin': 'https://www.bilibili.com',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
          },
          rejectUnauthorized: false
        }

        const req = https.request(options, (res) => {
          let body = ''
          log('Delete history response status:', res.statusCode)
          res.on('data', (chunk) => { body += chunk })
          res.on('end', () => {
            log('Delete history response:', body)
            try {
              const result = JSON.parse(body)
              if (result.code === 0) {
                resolve({ success: true, data: result.data })
              } else {
                resolve({ success: false, error: result.message || '删除失败' })
              }
            } catch (e) {
              log('Error parsing response:', e.message)
              resolve({ success: false, error: '响应解析失败' })
            }
          })
        })

        req.on('error', (e) => {
          log('Delete history request error:', e.message)
          resolve({ success: false, error: e.message })
        })

        req.write(data)
        req.end()
      })
    } catch (error) {
      log('Error deleting history:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('search-history', async (event, keyword) => {
    log('search-history called, keyword:', keyword)
    try {
      const url = `https://api.bilibili.com/x/web-interface/history/search?pn=1&keyword=${encodeURIComponent(keyword)}&business=all&add_time_start=0&add_time_end=0&arc_max_duration=0&arc_min_duration=0&device_type=0&web_location=333.1391`
      log('History search API URL:', url)
      const result = await deps.fetchApi(url)
      log('History search result code:', result.code)

      if (result.code === 0 && result.data && result.data.list) {
        const list = result.data.list || []
        log('History search list count:', list.length)

        return {
          success: true,
          data: list.map(item => {
            let bvid = item.bvid || ''
            if (!bvid && item.uri) {
              const match = item.uri.match(/BV[\w]+/)
              if (match) bvid = match[0]
            }

            return {
              bvid: bvid,
              title: item.title || item.long_title || '',
              pic: item.cover || '',
              duration: item.duration || 0,
              author: item.author_name || '',
              authorMid: item.author_mid || '',
              authorFace: item.author_face || '',
              viewAt: item.view_at || 0,
              progress: item.progress || 0,
              isFinish: item.is_finish || false,
              historyTime: formatHistoryTime(item.view_at)
            }
          }),
          hasMore: result.data.page?.has_more || false,
          nextPage: result.data.page?.pn ? result.data.page.pn + 1 : null
        }
      } else {
        log('History search API error:', result.message || 'Unknown error')
        return { success: false, error: result.message || '搜索历史记录失败' }
      }
    } catch (error) {
      log('Error searching history:', error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('report-play-progress', async (event, progress) => {
    if (deps.state && deps.state.currentVideoInfo) {
      deps.state.currentVideoInfo.lastReportProgress = progress
    }
  })

  ipcMain.handle('report-final-progress', async (event, progress) => {
    const formattedProgress = formatProgressTime(progress)
    log(`[播放器关闭] 收到最终播放进度: ${formattedProgress} (${Math.floor(progress)}秒)`)
    if (deps.state && deps.state.currentVideoInfo && deps.state.currentVideoInfo.aid && deps.state.currentVideoInfo.cid) {
      deps.state.currentVideoInfo.lastReportProgress = progress
      await reportPlayHistory(deps.state.currentVideoInfo.aid, deps.state.currentVideoInfo.cid, progress)
    }
  })

  // 根据 bvid 查询播放进度
  ipcMain.handle('get-video-progress', async (event, bvid) => {
    try {
      const url = 'https://api.bilibili.com/x/web-interface/history/cursor?type=all&ps=50&max=0&view_at=0&business=archive'
      const result = await deps.fetchApi(url)

      if (result.code === 0 && result.data) {
        const list = result.data.list || []
        for (const item of list) {
          let itemBvid = ''
          if (item.bvid) {
            itemBvid = item.bvid
          } else if (item.history?.bvid) {
            itemBvid = item.history.bvid
          } else if (item.uri) {
            const match = item.uri.match(/BV[\w]+/)
            if (match) itemBvid = match[0]
          }
          if (itemBvid === bvid) {
            return { success: true, progress: item.progress || 0, cid: item.history?.cid || '' }
          }
        }
      }
      return { success: false, progress: 0, cid: '' }
    } catch (error) {
      log('get-video-progress error:', error.message)
      return { success: false, progress: 0, cid: '' }
    }
  })

  ipcMain.handle('add-to-view', async (event, bvid) => {
    log('add-to-view called, bvid:', bvid)
    try {
      if (!bvid) {
        return { success: false, error: '缺少视频ID' }
      }

      const savedCookies = cookieManager.getSavedCookies()
      const csrf = savedCookies.bili_jct || ''
      if (!csrf) {
        return { success: false, error: '缺少 bili_jct，无法添加稍后再看' }
      }

      return new Promise((resolve) => {
        const params = new URLSearchParams({ bvid, csrf })
        const data = params.toString()
        const path = '/x/v2/history/toview/add'
        log('Add to view path:', path, 'body:', data)
        const options = {
          hostname: 'api.bilibili.com',
          port: 443,
          path: path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(data),
            'Cookie': cookieManager.getCookieString(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.bilibili.com/',
            'Origin': 'https://www.bilibili.com',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
          },
          rejectUnauthorized: false
        }

        const req = https.request(options, (res) => {
          let body = ''
          log('Add to view response status:', res.statusCode)
          res.on('data', (chunk) => { body += chunk })
          res.on('end', () => {
            log('Add to view response:', body)
            try {
              const result = JSON.parse(body)
              if (result.code === 0) {
                resolve({ success: true, data: result.data })
              } else {
                resolve({ success: false, error: result.message || '添加失败' })
              }
            } catch (e) {
              log('Error parsing response:', e.message)
              resolve({ success: false, error: '响应解析失败' })
            }
          })
        })

        req.on('error', (e) => {
          log('Add to view request error:', e.message)
          resolve({ success: false, error: e.message })
        })

        req.write(data)
        req.end()
      })
    } catch (error) {
      log('Error adding to view:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { formatProgressTime, reportPlayHistory, registerHistoryHandlers }
