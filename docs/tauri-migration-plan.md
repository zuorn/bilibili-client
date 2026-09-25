# bilibili-client 迁移 Tauri v2 详细计划

> 目标：将 Electron 桌面客户端迁移至 Tauri v2，**功能和页面完全不变**。
> 文档基于对代码库的实际盘点（2026-09），所有结论均来自对源码的扫描。

---

## 一、现状盘点（迁移工作量来源）

### 1.1 技术栈现状

| 项 | 现状 |
| --- | --- |
| UI 层 | 原生 JS 单页应用，无框架、无打包器，`index.html` 按固定顺序 `<script>` 加载 |
| 主进程 | `main.js` + `src/main/`（CommonJS，模块间传 `deps` 对象） |
| IPC | 渲染层 `ipcRenderer.invoke` 调用 **67 个唯一通道**，主进程 `ipcMain.handle` 注册 **110+ 个处理器**（10 个业务模块 + 窗口 + 页面导航） |
| 推送事件 | 主进程 → 渲染层 `webContents.send`（页面导航、播放器数据、更新状态、下载进度等） |
| Node 依赖（运行时） | `ali-oss`(仅发布脚本)、`axios`、`electron-updater`、`ffmpeg-static`、`js-yaml`、`node-mpv`、`xml2js` |
| 渲染层 Node 耦合 | 仅 2 处 `require('electron')`（`renderer.js`、`core/state.js`，用于拿 `ipcRenderer`） |
| 特殊设置 | `nodeIntegration: true, contextIsolation: false, webviewTag: true(实际未使用 <webview>)`、无框窗口、`backgroundThrottling: false`、GPU 白名单绕过开关（Anime4K WebGL 依赖） |

### 1.2 Electron 专有 API → Tauri 对应方案

| Electron 用法 | 使用位置 | Tauri v2 方案 | 难度 |
| --- | --- | --- | --- |
| `BrowserWindow(frame:false)` | `window.js` | `tauri.conf.json` 中 `"decorations": false` | 低 |
| 窗口控制 IPC（min/max/close/devtools/reload/zoom/move） | `window.js` | `#[tauri::command]` + `window.minimize()/maximize()/...` | 低 |
| 窗口位置/大小持久化 + 多显示器校验 | `window.js` | Rust 读写 `main-window-state.json`，`available_monitors()` | 低 |
| `ipcMain.handle` / `ipcRenderer.invoke` | 全部 ipc 模块 | `#[tauri::command]`，通道名 1:1 映射 | 中（量大） |
| `webContents.send` 推送 | page-nav、播放器、更新 | `app.emit()`，shim 中映射为 `ipcRenderer.on` | 低 |
| `session.cookies` + `cookies.json` 双向同步 | `cookieManager.js`、`login.js` | **Rust 侧自管 cookie 存储**（`reqwest_cookie_store`），`cookies.json` 保持原格式，作为唯一事实来源，不再依赖 WebView cookie | 中 |
| `onBeforeSendHeaders` 注入 UA/Referer/Origin（bilivideo 等域名） | `window.js`、`builtin.js` | `WebviewWindowBuilder::on_web_resource_request()`（WebView2 的 WebResourceRequested 可拦截 webview 发出的所有 HTTP(S) 请求并改写头） | 中 |
| `screen` / 多显示器 | `builtin.js`、`window.js` | `window.current_monitor()` / `available_monitors()` | 低 |
| 第二个 `BrowserWindow`（内置播放器，拖拽移动/位置同步/全屏/旋转/跨屏） | `player/builtin.js` + `src/pages/player.html` | 第二个 `WebviewWindow`，所有窗口操作命令 1:1 移植 | 高 |
| `node-mpv`（Unix socket / 命名管道 JSON IPC） | `player/mpv.js` | Rust `tokio` + Windows 命名管道 / Unix socket，JSON 消息协议照搬 | 中高 |
| `ffmpeg-static`（DASH 音视频合并下载） | `player/builtin.js` | **sidecar 外部二进制**（`externalBin`），随安装包分发 | 低 |
| `xml2ass` 弹幕转换（xml2js 解析 + ASS 生成） | `src/utils/xml2ass.js` | 纯计算逻辑，移植为 Rust（`quick-xml`），或初期以 sidecar Node 脚本过渡 | 中 |
| `electron-updater` + `update.yml` 配置 | `updater.js` | `tauri-plugin-updater`（GitHub Releases / generic JSON），迁移更新源配置 | 中 |
| `Tray` + 右键菜单 + 关闭最小化到托盘 | `main.js` | Tauri `tray-icon` feature + `WindowEvent::CloseRequested` 拦截 | 低 |
| `dialog.showErrorBox` / `select-mpv-path` 文件选择 | `main.js`、`ipc/player.js` | `tauri-plugin-dialog` | 低 |
| `clipboard`（登录复制） | `ipc/login.js` | `tauri-plugin-clipboard-manager` | 低 |
| `nodeIntegration` 渲染层直用 `ipcRenderer` | 渲染层全部脚本 | **IPC 兼容 shim**（见架构方案），渲染层其余代码零改动 | 中 |
| GPU 命令行开关 `ignore-gpu-blacklist` 等 | `main.js` | 无对应项；WebView2 默认启用 GPU，Anime4K WebGL 需实测验证 | 验证项 |
| `backgroundThrottling: false` | `window.js` | 无直接开关；悬停预览/后台计时器需实测，必要时用 Rust 侧定时器兜底 | 验证项 |
| `app.getPath('userData')` | 多处 | `app.path().app_data_dir()` | 低 |
| `ali-oss` 发布脚本、`electron-builder` 打包 | `scripts/`、`package.json build` | `tauri build`（NSIS/DMG/AppImage），`publish:oss` 脚本改为上传 tauri 产物 | 低 |

> 结论：**渲染层（页面、样式、交互逻辑）可以 100% 保留**，改动集中在主进程 → Rust 后端的整体重写 + 一个薄的 IPC 兼容层。

---

## 二、总体架构方案

### 2.1 核心策略：IPC 兼容层（shim）

不重写渲染层。新增 `src/renderer/core/ipc-shim.js`（在 `index.html` 和 `player.html` 中**第一个**加载），用 Tauri API 伪造一个 `window.ipcRenderer`：

```js
// 伪代码示意
const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

window.ipcRenderer = {
  invoke: (channel, ...args) => invoke('ipc', { channel, args }),  // 单入口分发
  on: (channel, handler) => listen(channel, (e) => handler({ }, e.payload)),
  send: (channel, ...args) => invoke('ipc_send', { channel, args })
}
```

- **invoke 侧**：后端提供单一 Rust 命令 `ipc(channel, args)` 内部按通道名分发到各模块函数（内部再按模块拆分组织），渲染层调用代码一行不改。
- **on/send 侧**：主进程推送改用 `app.emit(channel, payload)`，事件名与原 IPC 通道一致。
- 删除 `renderer.js`、`core/state.js` 里 2 处 `require('electron')`，统一走 shim。
- Electron 的 invoke 结果就是普通 JSON，与 Tauri 序列化模型一致，返回值无需转换；注意少数返回 `undefined` 的通道需改为返回 `null`。

### 2.2 目录结构（新增/改动）

```
src-tauri/
  Cargo.toml
  tauri.conf.json          # 无框窗口、图标、打包(NSIS/DMG/AppImage)、updater
  icons/
  binaries/ffmpeg*         # sidecar
  src/
    main.rs                # 入口：窗口/托盘/生命周期（对应 main.js）
    api.rs                 # fetchApi/WBI 签名(MD5)/gzip/brotli/UA头（对应 src/main/api.js）
    cookie_store.rs        # cookies.json 读写 + 请求注入（对应 cookieManager.js）
    log.rs
    updater.rs             # tauri-plugin-updater + update.yml 解析
    tray.rs
    ipc/
      mod.rs               # ipc(channel, args) 统一分发入口
      feeds.rs bangumi.rs media.rs up.rs user.rs
      history.rs favorites.rs dynamics.rs login.rs player.rs
    player/
      builtin.rs           # 第二窗口管理 + 下载合并
      mpv.rs               # 命名管道/Unix socket JSON 协议
    window_state.rs
src/renderer/core/ipc-shim.js   # 新增，index.html/player.html 首位加载
src/main/...(原 Electron 代码)  # 迁移完成前保留，便于 A/B 对照；验收后移除
```

### 2.3 Cookie 与请求头方案（本项目最关键的技术点）

现状：所有 B 站 API 请求在主进程用 Node https/axios 手动注入 Cookie 头，浏览器侧还有 session cookie 同步。

Tauri 方案：
1. **API 请求全部走 Rust**（`reqwest`，开启 `gzip`/`brotli`/`cookies` feature），cookie 由 `reqwest_cookie_store` 管理，并持久化为与现在**完全相同格式**的 `cookies.json`（保证用户升级后登录态无缝保留，路径用同一个 `app_data_dir`）。
2. **WebView 内的资源请求**（`<img>` 封面、`<video>` 播放流）通过 `on_web_resource_request` 拦截，对 `bilivideo.com/bilivideo.cn/bilibili.com/hdslb.com` 注入与现在完全相同的 UA/Referer/Origin 三个头。
3. 弹幕/下载等 Rust 侧流式请求同理加头。

### 2.4 依赖清单（Rust crates）

`tauri 2`（features: tray-icon）、`tauri-plugin-updater`、`tauri-plugin-dialog`、`tauri-plugin-clipboard-manager`、`tauri-plugin-process`、`reqwest`（gzip/brotli/cookies/stream）、`reqwest_cookie_store`、`serde`/`serde_json`、`tokio`（full）、`md-5`、`quick-xml`、`dirs`、`chrono`。

前端 dev 依赖：`@tauri-apps/cli`。渲染层仍为零依赖原生 JS（保持现状，不引入打包器）。

---

## 三、分阶段实施计划

### Phase 0：准备与基线（0.5 天）

- [ ] 安装 Rust 工具链 + `@tauri-apps/cli`，确认 `cargo tauri dev/build` 可跑通。
- [ ] 建立功能基线清单（用当前 Electron 版本逐项勾验，作为后续验收对照）：
  首页/搜索/热门/番剧/影视/收藏/历史/动态(综合)/UP主页(含动态tab)/我的、二维码登录、Cookie 导入、两种播放器、弹幕开关、下载合并、悬停预览、快捷键/访问键、缩放、窗口拖动、暗色主题、托盘、自动更新检查。
- [ ] 盘点并固化全部 IPC 通道 → Rust 命令的映射表（可用脚本从 `ipcMain.handle` / `ipcRenderer.invoke` 自动生成初稿，放 `docs/ipc-channel-map.md`）。

### Phase 1：骨架可运行（1 天）

- [ ] `cargo tauri init`，`tauri.conf.json`：`decorations: false`、窗口 1700×1000 / min 800×600、图标（icon.ico/png）。
- [ ] 前端静态资源加载：dev 用静态服务器 serve 项目根；生产用 `frontendDist` 指向打包资源。
- [ ] 编写并接入 `ipc-shim.js`（`index.html`、`player.html` 第一位加载），删除 2 处 `require('electron')`。
- [ ] Rust 侧实现窗口控制命令（min/max/close/devtools/reload/zoom/move）、窗口状态持久化（恢复位置/大小/最大化 + 多屏校验）。
- [ ] **验收**：无框窗口正常显示整页 UI，最小化/最大化/关闭/缩放/方向移动可用，位置记忆正常。

### Phase 2：API 层与核心 IPC 移植（3~4 天）

- [ ] `api.rs`：WBI 签名（img_key/sub_key 获取、1h 缓存、MIXIN_KEY_ENC_TAB 混淆、wts + MD5 → w_rid）、UA/Referer 头、gzip/brotli 解压、`fetchApi/fetchApiPost/fetchWithRetry/fetchApiWithHeaders/buildRecommendUrl`。
- [ ] `cookie_store.rs`：加载/保存 `cookies.json`（原格式）、`getCookieString`、cookie 导出导入命令（`import-cookie-string`/`get-cookies`/`dump-session-cookies` 等）。
- [ ] `ipc/mod.rs` 统一分发入口 + 逐模块移植（每个模块移植后立即在真实页面回归）：
  1. `feeds.rs`（首页/搜索/热搜）→ `user.rs`（用户信息/关注）→ `dynamics.rs`（综合动态）
  2. `favorites.rs`（收藏夹 12 个通道）→ `history.rs`（历史 8 个通道）
  3. `bangumi.rs` / `media.rs` / `up.rs`（注意：UP 动态 `fetch-up-dynamics` 与综合动态 `get-user-dynamics` 是两套独立实现，Rust 侧同样分开两个函数，禁止合并）
  4. `login.rs`（二维码生成/轮询/停止、退出登录）
- [ ] **验收**：登录后所有页面数据加载、翻页、无限滚动、搜索、收藏操作与 Electron 版一致；升级安装后旧 `cookies.json` 登录态有效。

### Phase 3：播放器（4~5 天，最大风险区）

- [ ] **内置播放器**：第二个 `WebviewWindow` 加载 `src/pages/player.html`（同 shim）；移植全部 20+ 窗口命令——位置获取/设置、拖拽边界、平滑移动、缩放、全屏、旋转、跨屏移动、最大化判断；DASH URL 预取与 `play-video-data`/`prefetch-data` 推送。
- [ ] **下载合并**：ffmpeg 以 sidecar 打包（`externalBin`），DASH 下载 + 合并 + `download-progress` 推送 + 失败回退 durl。
- [ ] **MPV 播放器**：`player/mpv.rs`——mpv 路径查找、`--input-ipc-server` 启动、Windows 命名管道/Unix socket 的 JSON 消息收发、播放进度上报定时器、停止清理。
- [ ] **弹幕**：`xml2ass` 移植 Rust（`quick-xml`）；`get-danmaku-xml`/`fetch-danmaku-ass`/`save-ass-file` 命令；MPV 模式弹幕加载。**备选方案**：初期将原 JS 通过 Node sidecar 跑通功能，后续再 Rust 化。
- [ ] **视频截图**（`get-video-snapshot`）移植。
- [ ] **验收**：两种播放器全流程（含切集、进度记忆、弹幕、Anime4K 开关）、下载合并、多显示器拖拽、旋转、全屏与 Electron 版一致；**重点验证 WebView2 下 Anime4K WebGL 着色器可用**。

### Phase 4：系统集成（1~2 天）

- [ ] 托盘：图标 + 右键菜单（显示窗口/退出）+ 点击显示；关闭按钮 → 隐藏到托盘（`CloseRequested` 拦截 + `isQuitting` 等价逻辑）。
- [ ] 自动更新：`tauri-plugin-updater`，迁移 `update.yml` 语义（GitHub Releases 源 + 通用 HTTP 源）；保留"启动 3 秒后检查 + header 更新按钮 + `update-status` 推送"交互。
- [ ] 文件对话框（选择 mpv 路径）、剪贴板（登录复制）、版本号命令、`dialog.showErrorBox` 等价错误上报。
- [ ] **验收**：托盘行为、更新检查流程与现版一致。

### Phase 5：打包与发布（1~2 天）

- [ ] `tauri.conf.json` bundle：Windows NSIS（可选安装目录、桌面/开始菜单快捷方式、安装后运行、LICENSE 许可页——对应现 `installer.nsh` 需求逐项核对）、macOS DMG、Linux AppImage。
- [ ] ffmpeg sidecar 三平台打包；确认 NSIS 产物体积与功能。
- [ ] updater 产物（`latest.json`）生成流程；改造 `scripts/publish-oss.js` 与 CI（GitHub Actions：Rust 缓存 + 三平台构建）。
- [ ] 清理：移除 `electron`、`electron-builder`、`node-mpv` 等依赖与 `src/main` 旧代码；更新 `package.json` scripts 与 `CLAUDE.md`/README。
- [ ] **验收**：三平台安装包安装→登录→播放全流程；从旧版升级覆盖安装登录态保留。

### Phase 6：整体回归与切换（1 天）

- [ ] 按 Phase 0 基线清单全量回归；重点回归**两套动态页面**（`dynamic-*` 与 `up-dynamic-*` 命名边界不被破坏）、快捷键录制、访问键、暗色主题。
- [ ] 性能对比：启动耗时、内存占用、包体积（预期包体积大幅缩小、内存明显降低——这也是迁移的主要收益）。
- [ ] 旧 Electron 代码归档删除，合并主干，发版。

**总量估算：约 11~15 个工作日**（单人；其中 Phase 3 弹性最大）。

---

## 四、风险与对策

| # | 风险 | 等级 | 对策 |
| --- | --- | --- | --- |
| 1 | `<video>` 播放 bilivideo CDN 流缺 Referer 导致 403 | 高 | `on_web_resource_request` 拦截注入；先在 dev 用播放器页单独验证 |
| 2 | WebView2 与 Chromium 行为差异（CSS/字体/动画/`backgroundThrottling`） | 中 | 渲染层是标准 Web API，预期兼容；逐页回归；预览节流用 Rust 定时器兜底 |
| 3 | Anime4K WebGL 在 WebView2 不可用 | 中 | Phase 3 首日验证；WebView2 支持 ANGLE/WebGL2，预期可行；不行则降级说明 |
| 4 | MPV Windows 命名管道 JSON 协议移植细节多 | 中 | 协议照搬 `node-mpv`（Content-Length 帧 + JSON）；优先支持 Windows 主平台 |
| 5 | `xml2ass` 移植工作量被低估 | 中 | 保留 Node sidecar 备选路径，先通后优 |
| 6 | invoke 返回 `undefined` / 特殊序列化差异 | 低 | Rust 命令统一返回 `serde_json::Value`，`undefined` → `null` |
| 7 | Linux（webkitgtk）视频编解码受限 | 中 | 主平台为 Windows；Linux 版文档标注需系统解码器（gstreamer plugins） |
| 8 | 用户升级后 `cookies.json` 不兼容 | 低 | 保持文件路径与格式不变，Phase 2 验收覆盖 |

---

## 五、原则与边界

1. **页面与交互零改动**：`src/renderer/**`、`src/style/**`、`index.html`（除 shim 引入）、`src/pages/player.html`（除 shim 引入）不动；CSS 类名、DOM、加载顺序全部保持。
2. **IPC 通道名零改动**：Rust 侧通道/事件名与现在 1:1 相同，shim 只做转发不做改名。
3. **两套动态页面边界**继续有效：Rust 侧 `get-user-dynamics` 与 `fetch-up-dynamics` 独立实现。
4. **迁移期间 Electron 版本保持可用**，任一 Phase 完成即可 A/B 对照；全部验收通过后再删除旧代码。
