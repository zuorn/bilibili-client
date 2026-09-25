# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 常用命令

```bash
# 前端资源收集：src/ + index.html → app-dist/（tauri dev / build 的 frontendDist）
node scripts/build-frontend.js

npm run tauri:dev              # 开发：启动 Tauri 应用（加载 app-dist/）
npm run tauri:build            # 构建 Windows NSIS 安装包 + 更新器签名文件
npm run tauri:build:nsis       # 同上，显式指定仅 NSIS bundle
npm run publish:oss:tauri      # 发布安装包/签名/latest.json 到阿里云 OSS
npm run publish:oss:tauri:dry  # 发布演练（只校验不上传）
```

构建时更新器签名私钥由 `scripts/tauri-build.js` 自动注入：从根目录 `env.json`（已加入 `.gitignore`，含 `tauri.signingPrivateKey` 与 `oss` 配置，不提交）读取后设置 `TAURI_SIGNING_PRIVATE_KEY` 再执行 `tauri build`。已导出的同名环境变量优先。

构建产物位于 `src-tauri/target/release/bundle/nsis/`（安装包 exe + `.sig` 更新签名）。

暂无测试套件（`npm test` 为占位命令）。迁移回归辅助脚本：

```bash
node .workbuddy/scripts/check-ipc-coverage.js     # 渲染层 IPC 调用 vs Rust dispatch 覆盖率
node .workbuddy/scripts/check-electron-parity.js  # Electron ipcMain 通道 vs Rust 通道对照
```

## 项目架构

这是一个 Bilibili（中国视频平台）的 **Tauri 2** 桌面客户端。渲染进程是一个**原生 JS 单页应用** — 无框架、无打包工具，所有脚本通过 `index.html` 中的 `<script>` 标签按特定依赖顺序加载；后端为 `src-tauri/` 下的 **Rust** 实现。

本项目由 Electron 迁移而来（迁移进行中）。**Electron 遗留代码（`main.js`、`src/main/` 及 package.json 中 `start`/`build:win` 等脚本）暂时保留**，待回归确认后删除，不要在这些文件上继续开发新功能。

### Rust 后端（`src-tauri/src/`）

IPC 采用**单一命令 + 统一分发**模式：渲染层所有调用都进入 Rust 侧唯一的 `ipc` 命令，按 `channel` 字符串分发到各业务模块。通道名与 Electron 版 1:1，便于对照移植。

| 模块 | 职责 |
| --- | --- |
| `main.rs` | Tauri 入口。定义 `#[tauri::command] async fn ipc(channel, args)` 统一入口，窗口控制逻辑（缩放/最大化等）、文件日志初始化。 |
| `ipc/mod.rs` | 分发中枢：`dispatch()` 将 channel 路由到 `ipc/*.js` 各模块或独立命令。新增业务通道在这里注册。 |
| `ipc/feeds.rs` / `user.rs` / `dynamics.rs` / `favorites.rs` / `history.rs` / `bangumi.rs` / `media.rs` / `up.rs` / `login.rs` / `player.rs` | 按业务域组织的通道处理函数（对应 Electron 版 `src/main/ipc/*.js`）。`player.rs` 同时包含 MPV 子进程管理（tokio::process）。 |
| `api.rs` | Bilibili API 调用基础层：reqwest（gzip/brotli）、WBI 签名（MD5）、Cookie 注入。 |
| `cookie_store.rs` | Cookie 持久化与同步（对应 Electron 版 `cookieManager.js`）。 |
| `player_window.rs` | 内置播放器：第二 WebviewWindow 加载 `player.html`、播放器窗口控制通道、视频流 CDN 请求头注入（Windows 下走 WebView2 COM）。 |
| `tray.rs` | 系统托盘。 |
| `updater.rs` | 自动更新（tauri-plugin-updater），多渠道（OSS generic + GitHub Releases）取最高版本。 |
| `window_state.rs` | 主窗口位置/尺寸持久化。 |
| `state.rs` | 全局共享状态。 |

### 渲染进程（`index.html` + `src/renderer/`）

HTML 文件是应用外壳：包含 header、sidebar、各页面的容器（`div.page-content`）、以及各种模态框。脚本加载顺序至关重要，因为后续脚本依赖前面脚本设置的全局变量。

**加载顺序：**

0. `core/ipc-shim.js` — **Tauri 兼容层，必须最先加载**：伪造 `window.ipcRenderer`，把所有 `invoke`/`on` 转发到 `tauri.core.invoke('ipc', { channel, args })` 与 `tauri.event.listen`。检测到 Electron 环境时自动跳过（双栈兼容）。
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

**通信模式：** 渲染进程调用 `ipcRenderer.invoke('channel', ...args)`（由 ipc-shim 转发）→ Rust `ipc::dispatch` 分发处理并返回结果。Rust 侧通过 `app.emit(channel, payload)` 推送事件 → ipc-shim 将其映射回 `ipcRenderer.on('channel', handler)` 回调。

**修改渲染层的原则：** 渲染层代码与 Electron 时期保持零差异运行。修改渲染层时**不要直接调用 Tauri API**，统一走 `ipcRenderer`（由 shim 保证双栈兼容）；需要新后端能力时在 Rust 侧新增 channel 并在 `ipc/mod.rs` 注册。

### ⚠️ 重要：动态页面 vs UP主页动态 — 两套独立系统

项目中存在**两套独立的动态页面实现**，它们看起来相似但**并非同一套代码**。两者绝不可交叉修改。

| 维度 | 综合动态页面 | UP主页面动态页 |
| --- | --- | --- |
| **用户界面名称** | 综合/动态（动态信息流） | UP主页 → 动态 tab |
| **功能说明** | 独立页面，展示所有已关注 UP 主的聚合动态流 | UP 主个人主页内的一个 tab，展示该 UP 主的动态 |
| **渲染代码** | `src/renderer/pages/dynamic.js` | `src/renderer/pages/up.js` |
| **样式文件** | `src/style/pages/dynamic.css` | `src/style/pages/up-profile.css` |
| **CSS 类名前缀** | `.dynamic-card`、`.dynamic-header`、`.dynamic-video-card` 等 | `.up-dynamic-card`、`.up-dynamic-header`、`.up-dynamic-video-card` 等 |
| **DOM 容器 ID** | `dynamicDynamicsList`、`dynamicDynamicsTab`、`dynamicVideosTab` | `upDynamicsList`、`upDynamicsTab` |
| **入口初始化函数** | `initDynamicPage()` | `initUpPage()` → `switchUpTab('dynamics')` |
| **核心加载函数** | `loadDynamicContent(upId, offset)` | `loadUpDynamics(mid, offset)` |
| **滚动处理函数** | `handleDynamicScroll()` | `throttledHandleScroll`（UP 页面通用滚动处理） |
| **后端通道** | `get-user-dynamics`（`ipc/dynamics.rs`） | `fetch-up-dynamics`（`ipc/up.rs`） |

**🔥 全局命名冲突（已修复）**

`timeAgo` 和 `formatCount` 这两个完全相同的工具函数已提取到 `src/renderer/core/utils.js`，并从两个页面文件中删除。`up.js` 中的冲突函数已重命名为带 `Up` 前缀的版本，确保与 `dynamic.js` 完全隔离：

| 旧名称（冲突） | dynamic.js（保留原名） | up.js（已重命名） |
| --- | --- | --- |
| `createDynamicCard` | `createDynamicCard(d)` → `.dynamic-card` | `createUpDynamicCard(d)` → `.up-dynamic-card` |
| `openImagePreview` | `openImagePreview()` 无参 | `openUpImagePreview(images, index)` 有参 |
| `closeImagePreview` | `closeImagePreview()` | `closeUpImagePreview()` |
| `downloadCurrentImage` | `downloadCurrentImage()` | `downloadUpCurrentImage()` |

**⚠️ 注意**：如果未来需要在某一方新增函数，**禁止**使用对方已有的函数名。两个页面的函数应始终保持不同的命名前缀。

**必须遵守的规则：**

1. 当用户说"空间页面的时候" 是指 "up主页面"，up主页面和空间页面是同一个页面，只是叫法不同。
2. **当用户说"修改综合页面" / "修改动态页面" / "dynamic"** → **只**编辑 `src/renderer/pages/dynamic.js` 和 `src/style/pages/dynamic.css`。**绝对不要碰** `src/renderer/pages/up.js` 或 `src/style/pages/up-profile.css`。
3. **当用户说"修改UP主页面动态" / "修改UP页面的动态" / "up-dynamic"** → **只**编辑 `src/renderer/pages/up.js` 和 `src/style/pages/up-profile.css`。**绝对不要碰** `src/renderer/pages/dynamic.js` 或 `src/style/pages/dynamic.css`。
4. **当需要共享工具函数时** → 将其提取到 `src/renderer/core/utils.js`，并从两个文件中删除重复定义。**不要**新增第三份拷贝。
5. **在做出任何修改前**，始终通过检查代码中使用的 CSS 类名前缀来确认你正在编辑正确的文件：
   - `dynamic-*` 前缀 → 属于 `dynamic.js` / `dynamic.css`（综合动态页面）
   - `up-dynamic-*` 前缀 → 属于 `up.js` / `up-profile.css`（UP主页动态）

### WBI 签名（`src-tauri/src/api.rs`）

许多 Bilibili API 接口需要 WBI 签名。流程如下：

1. 从导航 API 获取 `img_key` + `sub_key`（缓存 1 小时）
2. 通过 `MIXIN_KEY_ENC_TAB` 混淆密钥，生成 32 字符的 mix key
3. 向参数中添加 `wts`（Unix 时间戳），按字母排序，对 `query + mixKey` 进行 MD5 哈希 → `w_rid`

### Cookie 流程

登录 Cookie 由 Rust 侧 `cookie_store.rs` 管理：持久化到用户数据目录，API 请求时注入 Cookie 头，并与 WebView 的 Cookie 存储（`document.cookie` / WebView2 CookieManager）双向同步。

### 播放器架构

两种播放模式，可在设置中选择：

- **内置播放器**（默认）：`player_window.rs` 打开一个独立的 WebviewWindow 加载 `src/pages/player.html`，页面通过 `player-ready` 通道握手。预取 DASH 视频 URL。支持 Anime4K WebGL 着色器画质增强。音频和视频以两个独立的 `<video>` 元素播放，手动同步。视频流请求头通过 WebView2 COM 注入（仅 Windows）。
- **MPV 播放器**：`ipc/player.rs` 以 tokio 子进程方式启动 `mpv`，未找到 MPV 或选择内置时自动回退。

### 自动更新

通过 `src-tauri/tauri.conf.json` 的 `plugins.updater` 配置（公钥 + 更新源 endpoint）。`updater.rs` 支持 OSS generic 源与 GitHub Releases 多渠道，取最高版本。更新签名使用 minisign（构建时需 `TAURI_SIGNING_PRIVATE_KEY`），发布产物随 `publish:oss:tauri` 上传 `latest.json`。

## Tauri 迁移注意事项（踩坑记录）

1. **页面协议是 `http://tauri.localhost`**：B 站图片 CDN（i0.hdslb.com）对非白名单 Referer 返回 403（无 Referer 则 200）。`index.html` / `player.html` 的 `<head>` 中必须有 `<meta name="referrer" content="no-referrer">`，不要删除。
2. **CDN 请求头注入**：Tauri 的 `on_web_resource_request` 只对 `tauri://` 协议生效，不能用于劫持对 B 站 CDN 的请求。Windows 下通过 WebView2 COM（`webview2-com` + `windows` crate）注入，与 wry 使用的 WebView2 版本保持一致。
3. **beforeBuildCommand 子进程必须显式 `process.exit()`**：否则 `tauri build` 会无限停在 "Running beforeBuildCommand"（无 cargo 进程是判据）。`scripts/build-frontend.js` 已内置文件级 trace（`.workbuddy/build-frontend-trace.log`）。
4. **app-dist/ 是构建产物目录**：由 `build-frontend.js` 从 `src/` 复制生成（覆盖式复制，不做清理）。修改渲染层文件后需重新执行该脚本才能在 dev/生产中生效。
5. **新增 IPC 通道**：在 Rust 对应模块实现处理函数 → 在 `ipc/mod.rs` 的 `dispatch` 中注册 → 跑 `check-ipc-coverage.js` 确认渲染层调用全部覆盖。
