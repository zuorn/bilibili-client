// Page navigation IPC handlers

function registerPageNavHandlers(deps) {
  const { ipcMain, log, mainWindow } = deps

  ipcMain.on('open-up-profile', (event, mid) => {
    log('Opening UP profile for mid:', mid)
    mainWindow.webContents.send('navigate-to-up', mid)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  ipcMain.on('go-home', () => {
    mainWindow.loadFile('index.html')
  })

  ipcMain.on('open-dynamic', () => {
    log('Opening dynamic page')
    mainWindow.loadFile('src/pages/dynamic.html')
  })

  ipcMain.on('open-my', () => {
    mainWindow.loadFile('src/pages/my.html')
  })

  ipcMain.on('open-popular', () => {
    mainWindow.loadFile('src/pages/popular.html')
  })

  ipcMain.on('open-anime', () => {
    mainWindow.loadFile('src/pages/anime.html')
  })

  ipcMain.on('open-media', () => {
    mainWindow.loadFile('src/pages/media.html')
  })

  ipcMain.handle('navigate-up', async (event, mid) => {
    log('navigate-up called with mid:', mid)
    mainWindow.webContents.send('navigate-to-up', mid)
    return { success: true }
  })

  ipcMain.handle('navigate-dynamic', async () => {
    log('navigate-dynamic called')
    mainWindow.webContents.send('navigate-to-page', 'dynamic')
    return { success: true }
  })

  ipcMain.handle('navigate-my', async () => {
    log('navigate-my called')
    mainWindow.webContents.send('navigate-to-page', 'my')
    return { success: true }
  })
}

module.exports = { registerPageNavHandlers }
