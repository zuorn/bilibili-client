## TODO

## 客户端

- [ ] up主页面（空间页面）
  - [ ] 向下滚动两个滚动条的问题
- [ ] 我的页面
  - [ ] 我的信息
    - [ ] 关注、粉丝、获赞数等
  - [ ] 历史记录页面
    - [x] 向下滚动无法加载更多内容
    - [ ] 点击已经播放过的视频，从上次播放的时间开始播放
  - [ ] 我的收藏
    - [x] 默认收藏夹
    - [ ] 我创建的收藏夹
    - [ ] 我收藏与订阅
  - [ ] 我的追番
  - [ ] 我的追剧
  - [x] 稍后再看
- [ ] 设置页面
  - [x] 快捷键绑定
  - [ ] 整体规划快捷键
  - [ ] 手柄支持 （优先级低）
- [ ] 动态页面
  - [ ] 左侧点击右更新用户后，小红点没有取消
- [ ] 追番页面
- [ ] 影视页面
- [x] 其他
  - [x] 主题切换
  - [x] 快捷键设置
  - [x] 搜索框聚焦后移动顶部栏中间，显示搜索历史和热搜
  - [ ] 大会员视频非会员账号点击后没有任何提示
  - [x] 下拉搜索框没有适配深色主题
  - [x] 深色模式下顶部栏的顶部菜单颜色太浅看不清，调整和左边栏一致
  - [ ] 弹幕乱码（<https://www.bilibili.com/video/BV1dBRiBeEyG>）

<br />

默认设置内置播放器

<br />

\*\*核心磨砂毛玻璃效果 \*\*

&#x20;

- 填充色：浅灰白色（色值参考`#F5F5F7`），不透明度调至 80%-90%，实现半通透基底。
- 背景模糊：Figma 开启「背景模糊（Backdrop Blur）」，数值 20-30px；PS 用「高斯模糊 + 图层蒙版」实现，还原 MacOS 原生磨砂质感，可额外加 5px 以内的图层模糊弱化边缘。

```CSS
  /* 微信侧边栏容器 */
.wechat-sidebar {
  /* 尺寸与固定定位 */
  width: 64px;
  height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 999;

  /* 圆角设置 */
  border-top-left-radius: 20px;
  border-bottom-left-radius: 20px;
  /* 全圆角可替换为 border-radius: 16px; */

  /* 核心毛玻璃背景 */
  background-color: rgba(245, 245, 247, 0.85);
  -webkit-backdrop-filter: blur(24px);
  backdrop-filter: blur(24px);

  /* 边框描边 */
  border-right: 1px solid rgba(229, 229, 231, 0.6);

  /* 层级阴影 */
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.05);

  /* 图标垂直布局 */
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0;
  gap: 32px;
}
```

### 原生 Mica Alt 材质实现

```JavaScript
// main.js 主进程代码
const { app, BrowserWindow, nativeTheme, ipcMain } = require('electron')
const path = require('path')

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // 1. 核心：指定Win11系统材质，文件管理器用的是micaAlt（更浅的通透磨砂）
    backgroundMaterial: 'micaAlt',
    // 2. 隐藏原生标题栏，保留系统窗口控制按钮（最小化/最大化/关闭）
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: 'transparent', // 标题栏背景透明，让Mica材质完全透出
      symbolColor: '#000000', // 按钮图标颜色，浅色模式用黑，深色模式用白
      height: 48 // 标题栏高度，和Win11系统默认一致
    },
    // 3. 必须开启窗口透明，否则材质无法透出
    transparent: true,
    // 窗口基础配置
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true // 安全配置，Electron推荐开启
    }
  })

  // 加载渲染进程页面
  mainWindow.loadFile('index.html')

  // 监听系统主题变化，自动适配按钮颜色
  nativeTheme.on('updated', () => {
    mainWindow.setTitleBarOverlay({
      color: 'transparent',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
      height: 48
    })
  })

  // 暴露动态修改材质的方法（可选）
  ipcMain.handle('set-background-material', (event, material) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setBackgroundMaterial(material)
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

<br />

| 材质值     | <br />                                    |
| :------ | :---------------------------------------- |
| <br />  | 效果说明                                      |
| micaAlt | 推荐，Win11   文件管理器同款，透明度更高、磨砂更浅             |
| mica    | Win11   标准窗口默认材质，磨砂感稍强                    |
| acrylic | 亚克力材质，模糊更强、透明度更高，类似   Win10 Fluent Design |
| tabbed  | 多标签专用   Mica，适合带标签栏的窗口                    |

**系统版本限制**：Mica 材质仅支持 Windows 11 22H2 及以上版本，Win10 会自动降级为普通不透明背景。

&#x20;

- **窗口透明必填**：无论哪种方案，都必须设置 `transparent: true`，否则毛玻璃效果无法透出。
- **窗口拖动问题**：自定义标题栏必须给可拖动区域加 `-webkit-app-region: drag;`，按钮等可点击元素必须加 `-webkit-app-region: no-drag;`，否则无法点击。
- **性能优先**：原生 Mica 材质是系统 GPU 渲染，性能远优于 CSS `backdrop-filter`，优先使用原生方案。
- **Electron 版本**：低于 15.0.0 的版本不支持 `backgroundMaterial`，请升级到最新 LTS 版本。

## 播放器

- [x] MPV播放器
- [ ] 实现点击打开mpv播放器播放视频

* [x] 实现播放器弹幕支持

## bug

- [ ] bug:我的页面tab遮挡搜索下拉框

