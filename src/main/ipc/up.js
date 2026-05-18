function registerUpHandlers(deps) {
  const { ipcMain, fetchApi, log } = deps

  // Helper functions
  function fetchUpInfo(mid) {
    return fetchApi(`https://api.bilibili.com/x/web-interface/card?mid=${mid}&photo=true`)
  }

  function fetchUpVideos(mid, offset = '') {
    let url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}&type=video`
    if (offset) {
      url += `&offset=${offset}`
    }
    return fetchApi(url)
  }

  ipcMain.handle('fetch-up-info', async (event, mid) => {
    console.log('Fetching UP info for mid:', mid)
    try {
      const data = await fetchUpInfo(mid)
      console.log('UP info result code:', data.code)
      return { success: true, data }
    } catch (error) {
      console.error('Fetch UP info error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('fetch-up-videos', async (event, mid, offset = '') => {
    console.log('Fetching UP videos for mid:', mid, 'offset:', offset)
    try {
      const data = await fetchUpVideos(mid, offset)
      console.log('UP videos result code:', data.code)
      return { success: true, data }
    } catch (error) {
      console.error('Fetch UP videos error:', error.message)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerUpHandlers }
