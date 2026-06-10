# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 常用命令

```bash
npm start              # 开发：启动 Electron 应用（设置 UTF-8 编码）
npm run build:win      # 构建 Windows NSIS 安装包
npm run build:mac      # 构建 macOS DMG 安装包
npm run build:linux    # 构建 Linux AppImage 安装包
npm run clean          # 清空 dist/ 目录
```

暂无测试套件（`npm test` 为占位命令）。

## 项目架构

这是一个 Bilibili（中国视频平台）的 **Electron** 桌面客户端。渲染进程是一个**原生 JS 单页应用** — 无框架、无打包工具。所有脚本通过 `index.html` 中的 `<script>` 标签按特定依赖顺序加载。

### 主进程（`main.js` + `src/main/`）

`main.js` 是接线中枢：创建 `sharedState` 对象，然后在注册时将整个对象（或其子集）传递给各个模块。模块之间通过接收 `deps` 对象的方式互相通信，而非直接 import。

| 模块                           | 职责                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/api.js`            | 所有 Bilibili API 调用。处理 WBI 签名（密钥获取/缓存、MD5 参数签名）、gzip/brotli 解压、Cookie 注入。导出 `fetchApi`、`fetchWithRetry`、`fetchApiWithHeaders`、`buildRecommendUrl`。 |
| `src/main/window.js`         | 创建无框 `BrowserWindow`，注册窗口控制 IPC 处理函数（最小化/最大化/关闭/开发者工具）。通过 `onBeforeSendHeaders` 注入 CDN 请求头。页面加载后同步 Cookie。                                |
| `src/main/cookieManager.js`  | 将 Cookie 持久化到用户数据目录下的 `cookies.json`。在 `savedCookies` 对象和 Electron session cookie 之间同步。处理 `Set-Cookie` 解析、控制字符过滤、SESSDATA 编码。                    |
| `src/main/log.js`            | 彩色控制台输出（chalk，仅开发环境）+ 纯文本文件日志（始终启用）。日志文件路径为 `<userData>/debug.log`。                                                                                   |
| `src/main/updater.js`        | `electron-updater` 集成。从 `src/config/update.yml` 读取更新源配置（GitHub Releases 或通用 HTTP）。                                                                                      |
| `src/main/page-nav.js`       | 跨页面导航的 IPC 处理函数（向渲染进程发送事件以切换页面）。                                                                                                                                  |
| `src/main/player/mpv.js`     | 通过 IPC 套接字使用外部 MPV 播放器。查找 mpv 可执行文件、管理套接字连接、收发 JSON 命令。                                                                                                    |
| `src/main/player/builtin.js` | 内置 HTML5 播放器：打开第二个 `BrowserWindow` 加载 `src/pages/player.html`。预取 DASH 视频 URL、复制 Cookie、处理缩放/位置/全屏/拖拽移动、通过 ffmpeg 合并下载的视频。                   |
| `src/main/ipc/*.js`          | 按业务域组织的 IPC 处理函数（feeds、bangumi、media、up、user、history、favorites、dynamics、login、player）。每个文件导出一个 `register*Handlers(deps)` 函数。                             |

### 渲染进程（`index.html` + `src/renderer/`）

HTML 文件是应用外壳：包含 header、sidebar、各页面的容器（`div.page-content`）、以及各种模态框。脚本加载顺序至关重要，因为后续脚本依赖前面脚本设置的全局变量。

**加载顺序：**

1. `core/state.js` — 所有全局可变状态（currentPage、pageStates、userShortcuts、accesskey 状态等）
2. `core/utils.js` — 共享辅助函数（图片 URL 修复、封面优化、视频数据映射、toast 提示）
3. `core/navigation.js` — 页面切换、返回按钮、滚动辅助
4. `components/video-card.js` — `createVideoCard()`、`renderVideos()`、`appendVideos()`，通过 IntersectionObserver 实现封面图片懒加载
5. `components/login.js` — 二维码登录流程
6. `components/access-keys.js` — Vim 风格快捷键提示（按 `f` 为可点击元素添加标签）
7. `features/playback.js` — `playVideo()` 入口，用于启动视频播放
8. `features/video-preview.js` — 鼠标悬停预览视频卡片
9. `features/scroll-handler.js` — 无限滚动 + 回到顶部按钮显示控制
10. `features/shortcuts.js` — 键盘快捷键绑定、录制界面、`applyShortcuts()`
11. `features/page-loader.js` — `loadPageContent()` 调度器，路由到对应的页面初始化函数
12. `features/update-checker.js` — header 中的更新按钮
13. `pages/*.js` — 各页面的数据获取和渲染
14. `core/event-listeners.js` — `DOMContentLoaded` 入口，绑定所有 click/keydown/IPC 事件监听

**通信模式：** 渲染进程调用 `ipcRenderer.invoke('channel', ...args)` → 主进程处理函数返回结果。主进程可通过 `mainWindow.webContents.send('channel', data)` 推送事件 → 渲染进程通过 `ipcRenderer.on('channel', handler)` 监听。

### ⚠️ 重要：动态页面 vs UP主页动态 — 两套独立系统

项目中存在**两套独立的动态页面实现**，它们看起来相似但**并非同一套代码**。两者绝不可交叉修改。

| 维度                     | 综合动态页面                                                                       | UP主页面动态页                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **用户界面名称**   | 综合/动态（动态信息流）                                                            | UP主页 → 动态 tab                                                                |
| **功能说明**       | 独立页面，展示所有已关注 UP 主的聚合动态流                                         | UP 主个人主页内的一个 tab，展示该 UP 主的动态                                     |
| **渲染代码**       | `src/renderer/pages/dynamic.js`                                                  | `src/renderer/pages/up.js`                                                      |
| **样式文件**       | `src/style/pages/dynamic.css`                                                    | `src/style/pages/up-profile.css`                                                |
| **CSS 类名前缀**   | `.dynamic-card`、`.dynamic-header`、`.dynamic-video-card` 等                 | `.up-dynamic-card`、`.up-dynamic-header`、`.up-dynamic-video-card` 等       |
| **DOM 容器 ID**    | `dynamicDynamicsList`、`dynamicDynamicsTab`、`dynamicVideosTab`              | `upDynamicsList`、`upDynamicsTab`                                             |
| **入口初始化函数** | `initDynamicPage()`                                                              | `initUpPage()` → `switchUpTab('dynamics')`                                   |
| **核心加载函数**   | `loadDynamicContent(upId, offset)`                                               | `loadUpDynamics(mid, offset)`                                                   |
| **滚动处理函数**   | `handleDynamicScroll()`                                                          | `throttledHandleScroll`（UP 页面通用滚动处理）                                  |
| **HTML 布局位置**  | `index.html` 第 437-470 行（侧边栏 + 内容区域）                                  | `index.html` 第 688-710 行（`#page-up` 内的 tab + 列表）                      |
| **页面状态管理**   | 全局变量（`currentUpId`、`dynamicContentOffset`、`isDynamicContentLoading`） | `pageStates.up.*`（`dynamicOffset`、`hasMoreDynamics`、`dynamicLoading`） |
| **IPC 通道**       | `get-user-dynamics`                                                              | `fetch-up-dynamics`                                                             |

**🔥 全局命名冲突（已修复）**

`timeAgo` 和 `formatCount` 这两个完全相同的工具函数已提取到 `src/renderer/core/utils.js`，并从两个页面文件中删除。`up.js` 中的冲突函数已重命名为带 `Up` 前缀的版本，确保与 `dynamic.js` 完全隔离：

| 旧名称（冲突）           | dynamic.js（保留原名）                        | up.js（已重命名）                                  |
| ------------------------ | --------------------------------------------- | -------------------------------------------------- |
| `createDynamicCard`    | `createDynamicCard(d)` → `.dynamic-card` | `createUpDynamicCard(d)` → `.up-dynamic-card` |
| `openImagePreview`     | `openImagePreview()` 无参                   | `openUpImagePreview(images, index)` 有参         |
| `closeImagePreview`    | `closeImagePreview()`                       | `closeUpImagePreview()`                          |
| `downloadCurrentImage` | `downloadCurrentImage()`                    | `downloadUpCurrentImage()`                       |

**⚠️ 注意**：如果未来需要在某一方新增函数，**禁止**使用对方已有的函数名。两个页面的函数应始终保持不同的命名前缀。

**必须遵守的规则：**

1. 当用户说"空间页面的时候" 是指 "up主页面"，up主页面和空间页面是同一个页面，只是叫法不同。
2. **当用户说"修改综合页面" / "修改动态页面" / "dynamic"** → **只**编辑 `src/renderer/pages/dynamic.js` 和 `src/style/pages/dynamic.css`。**绝对不要碰** `src/renderer/pages/up.js` 或 `src/style/pages/up-profile.css`。
3. **当用户说"修改UP主页面动态" / "修改UP页面的动态" / "up-dynamic"** → **只**编辑 `src/renderer/pages/up.js` 和 `src/style/pages/up-profile.css`。**绝对不要碰** `src/renderer/pages/dynamic.js` 或 `src/style/pages/dynamic.css`。
4. **当需要共享工具函数时** → 将其提取到 `src/renderer/core/utils.js`，并从两个文件中删除重复定义。**不要**新增第三份拷贝。
5. **在做出任何修改前**，始终通过检查代码中使用的 CSS 类名前缀来确认你正在编辑正确的文件：

   - `dynamic-*` 前缀 → 属于 `dynamic.js` / `dynamic.css`（综合动态页面）
   - `up-dynamic-*` 前缀 → 属于 `up.js` / `up-profile.css`（UP主页动态）

### WBI 签名

许多 Bilibili API 接口需要 WBI 签名。流程如下：

1. `fetchWbiKeys()` 从导航 API 获取 `img_key` + `sub_key`（缓存 1 小时）
2. `getMixKey()` 通过 `MIXIN_KEY_ENC_TAB` 混淆密钥，生成 32 字符的 mix key
3. `signParams()` 向参数中添加 `wts`（Unix 时间戳），按字母排序，对 `query + mixKey` 进行 MD5 哈希 → `w_rid`

### Cookie 流程

浏览器 Cookie 由 Electron 的 `session.cookies` 管理。启动时，从 `cookies.json` 加载已保存的 Cookie 并同步到 session 中。在 API 调用期间，通过 `cookieManager.getCookieString()` 将 Cookie 注入 HTTPS 请求头。Session cookie 的变更会自动导出回 JSON 文件。

### 播放器架构

两种播放模式，可在设置中选择：

- **内置播放器**（默认）：打开一个独立的 `BrowserWindow` 加载 `src/pages/player.html`。在窗口加载完成前预取 DASH 视频 URL。支持 Anime4K WebGL 着色器画质增强。音频和视频以两个独立的 `<video>` 元素播放，手动同步。
- **MPV 播放器**：通过 `--input-ipc-server` 参数启动 `mpv.exe`，使用 Unix 套接字通信。命令和属性查询通过套接字发送 JSON 消息。

### 自动更新

通过 `src/config/update.yml` 配置。默认更新源为 GitHub Releases（`zuorn/bilibili-client`）。启动时延迟 3 秒检查更新，有可用更新时在 header 中显示更新按钮。
