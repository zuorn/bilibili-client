# Bilibili Client Code Wiki

---

## 1. 项目概述

### 1.1 项目简介

这是一个基于 **Electron** 开发的哔哩哔哩桌面客户端，提供视频浏览、播放、追番、收藏等核心功能。

### 1.2 技术栈

| 分类 | 技术 | 版本 |
|------|------|------|
| 框架 | Electron | ^41.4.0 |
| HTTP客户端 | axios | ^1.15.2 |
| 构建工具 | electron-builder | ^26.8.1 |
| 视频播放器 | mpv (外部) / 内置播放器 | - |
| 弹幕处理 | xml2js | ^0.6.2 |
| 图标 | SVG | - |

### 1.3 项目结构

```
bilibili-client/
├── src/
│   ├── main/                    # 主进程代码
│   │   ├── ipc/                 # IPC处理器（进程间通信）
│   │   ├── player/              # 播放器模块
│   │   ├── api.js               # API请求封装
│   │   ├── cookieManager.js     # Cookie管理
│   │   ├── log.js               # 日志模块
│   │   ├── page-nav.js          # 页面导航
│   │   ├── updater.js           # 自动更新
│   │   └── window.js            # 窗口管理
│   ├── renderer/                # 渲染进程代码
│   │   ├── components/          # UI组件
│   │   ├── core/                # 核心逻辑
│   │   ├── features/            # 功能特性
│   │   ├── pages/               # 页面实现
│   │   └── renderer.js          # 渲染进程入口
│   ├── style/                   # 样式文件
│   ├── utils/                   # 工具函数
│   └── config/                  # 配置文件
├── index.html                   # 主HTML入口
├── main.js                      # Electron主入口
└── package.json                 # 项目配置
```

---

## 2. 架构设计

### 2.1 进程架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 主进程                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │
│  │   API模块   │  │  Cookie管理 │  │     MPV播放器       │     │
│  │  (api.js)   │  │(cookieMana-)|  │    (mpv.js)        │     │
│  └──────┬──────┘  │   ger.js)   │  └─────────┬─────────┘     │
│         │         └──────┬──────┘             │                 │
│         │                │                    │                 │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌─────────▼─────────┐     │
│  │   IPC处理   │  │  窗口管理   │  │   内置播放器       │     │
│  │  (ipc/*.js) │  │ (window.js) │  │  (builtin.js)     │     │
│  └──────┬──────┘  └─────────────┘  └───────────────────┘     │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐      │
│  │                   IPC通道                            │      │
│  │  (ipcMain ↔ ipcRenderer)                            │      │
│  └─────────────────────────────────────────────────────┘      │
└───────────────────────────────────────┬───────────────────────┘
                                        │
┌───────────────────────────────────────▼───────────────────────┐
│                        Electron 渲染进程                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │
│  │   UI组件    │  │   页面路由   │  │    快捷键系统       │     │
│  │ (components)│  │(navigation) │  │  (shortcuts.js)    │     │
│  └──────┬──────┘  └──────┬──────┘  └─────────┬─────────┘     │
│         │                │                    │                 │
│         │                │                    │                 │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌─────────▼─────────┐     │
│  │   视频卡片  │  │   状态管理   │  │    播放器UI        │     │
│  │(video-card) │  │  (state.js) │  │   (player.html)   │     │
│  └─────────────┘  └─────────────┘  └───────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块职责

| 模块 | 职责 | 关键文件 |
|------|------|----------|
| **API层** | B站API请求封装、WBI签名、Cookie管理 | `src/main/api.js` |
| **IPC层** | 主进程与渲染进程通信 | `src/main/ipc/*.js` |
| **播放器层** | MPV/内置播放器管理、弹幕处理 | `src/main/player/*.js` |
| **UI层** | 页面渲染、组件展示 | `src/renderer/` |
| **工具层** | 弹幕解析、XML转ASS | `src/utils/` |

---

## 3. 核心模块详解

### 3.1 主进程入口 (`main.js`)

**职责**: 应用启动、模块初始化、事件监听

**核心流程**:

1. **错误处理** - 捕获未捕获异常并弹窗提示
2. **GPU设置** - 绕过Chrome GPU黑名单（支持Anime4K）
3. **模块初始化** - 日志、Cookie、API、播放器等
4. **IPC注册** - 注册所有进程间通信处理器
5. **窗口创建** - 创建主窗口和系统托盘
6. **生命周期管理** - 窗口关闭、应用退出等

**关键代码**:

```javascript
// 应用启动入口
app.whenReady().then(async () => {
  // 初始化日志
  setLogFile(logFilePath)
  
  // 加载Cookie
  cookieManager.loadCookies(path.join(userDataPath, 'cookies.json'))
  
  // 创建主窗口
  windowModule.createWindow(sharedState)
  
  // 注册IPC处理器
  registerAllHandlers()
  
  // 创建系统托盘
  createTray()
})
```

---

### 3.2 API模块 (`src/main/api.js`)

**职责**: B站API请求封装、WBI签名算法、Cookie管理

#### 3.2.1 WBI签名机制

WBI签名是B站API的安全认证机制，核心流程：

1. **获取WBI密钥** - 从 `/x/web-interface/nav` 获取 `img_key` 和 `sub_key`
2. **生成MixKey** - 通过固定置换表混合两个密钥
3. **生成签名参数** - 添加 `wts`（时间戳）和 `w_rid`（MD5签名）

**关键函数**:

| 函数 | 说明 | 参数 | 返回值 |
|------|------|------|--------|
| `fetchWbiKeys()` | 获取WBI密钥 | 无 | `{ imgKey, subKey }` |
| `getMixKey()` | 生成混合密钥 | `imgKey, subKey` | 32位字符串 |
| `signParams()` | 签名参数 | `params, mixKey` | `{ w_rid, wts }` |

**代码示例**:

```javascript
function getMixKey(imgKey, subKey) {
  const raw = imgKey + subKey
  let mixKey = ''
  for (const pos of MIXIN_KEY_ENC_TAB) {
    if (pos < raw.length) {
      mixKey += raw[pos]
    }
  }
  return mixKey.substring(0, 32)
}
```

#### 3.2.2 请求封装

| 方法 | 说明 | 特点 |
|------|------|------|
| `fetchApi()` | 基础GET请求 | 自动处理gzip/brotli解压 |
| `fetchApiPost()` | POST请求 | 支持表单编码 |
| `fetchApiWithHeaders()` | 自定义头请求 | 优先使用session cookies |
| `fetchWithRetry()` | 带重试的请求 | 自动重试失败请求 |

---

### 3.3 Cookie管理器 (`src/main/cookieManager.js`)

**职责**: Cookie的持久化、同步和导出

**核心功能**:

1. **Cookie存储** - JSON文件持久化到 `userData/cookies.json`
2. **Session同步** - 与Chromium session cookies双向同步
3. **登录状态** - 通过Cookie判断登录状态

---

### 3.4 IPC处理器模块 (`src/main/ipc/`)

**职责**: 定义主进程与渲染进程间的通信接口

#### IPC模块列表

| 文件 | 职责 | 主要方法 |
|------|------|----------|
| `feeds.js` | 视频流相关 | `fetch-videos`, `search-videos`, `fetch-hot-search` |
| `bangumi.js` | 追番相关 | `fetch-bangumi`, `bangumi-follow`, `bangumi-unfollow` |
| `media.js` | 影视相关 | `fetch-media`, `media-follow` |
| `up.js` | UP主相关 | `fetch-up-info`, `fetch-up-videos`, `follow-up` |
| `user.js` | 用户信息 | `get-user-info`, `get-relation-stat` |
| `history.js` | 播放历史 | `fetch-history`, `report-play-history` |
| `favorites.js` | 收藏夹 | `fetch-favorites`, `add-favorite`, `remove-favorite` |
| `dynamics.js` | 动态相关 | `fetch-dynamics`, `fetch-up-dynamics` |
| `login.js` | 登录相关 | `get-login-qrcode`, `poll-login-status`, `logout` |
| `player.js` | 播放器相关 | `play-video`, `get-video-url`, `get-danmaku` |

#### 通信模式

```javascript
// 渲染进程调用
const result = await ipcRenderer.invoke('fetch-videos', page)

// 主进程处理
ipcMain.handle('fetch-videos', async (event, page) => {
  const result = await fetchWithRetry(buildRecommendUrl(page))
  return { success: true, data: result.data }
})
```

---

### 3.5 播放器模块 (`src/main/player/`)

**职责**: 视频播放管理，支持MPV和内置播放器两种模式

#### 3.5.1 MPV播放器 (`mpv.js`)

**功能**:
- MPV可执行文件查找
- Socket通信控制
- 播放进度定时上报
- 弹幕渲染（XML→ASS转换）

**核心函数**:

| 函数 | 说明 |
|------|------|
| `findMpvExecutable()` | 查找系统中的MPV可执行文件 |
| `connectToMpvSocket()` | 连接MPV的IPC socket |
| `sendMpvCommand()` | 向MPV发送命令 |
| `startReportTimer()` | 启动播放进度定时上报 |
| `stopVideo()` | 停止播放并清理资源 |

#### 3.5.2 内置播放器 (`builtin.js`)

**功能**:
- Electron窗口播放
- DASH视频流解析
- 视频下载（支持ffmpeg合并）
- 窗口旋转、缩放、多显示器切换

**关键特性**:
- **并行预加载** - 与窗口加载并行获取视频URL和信息
- **编解码器选择** - 优先AVC，其次AV1，最后HEVC
- **窗口状态管理** - 横屏/竖屏基准尺寸维护

---

### 3.6 弹幕工具 (`src/utils/getDanmaku.js`)

**职责**: 弹幕获取和解析

| 函数 | 说明 | 参数 |
|------|------|------|
| `getDanmakuXml(cid)` | 获取弹幕XML数据 | `cid` - 视频分P ID |
| `getCidByBvid(bvid)` | 通过BV号获取CID | `bvid` - 视频BV号 |

---

### 3.7 渲染进程 (`src/renderer/renderer.js`)

**职责**: UI渲染、用户交互、页面导航

**核心功能**:

1. **页面路由** - 管理首页、热门、动态、追番等页面切换
2. **视频卡片** - 渲染视频列表和卡片组件
3. **快捷键系统** - 全局快捷键监听和处理
4. **登录状态** - 用户登录状态检测和UI更新
5. **搜索功能** - 关键词搜索和热搜展示

**页面列表**:

| 页面 | 路径 | 功能 |
|------|------|------|
| 首页 | `home` | 推荐视频流 |
| 热门 | `popular` | 热门排行榜 |
| 动态 | `dynamic` | 关注UP主动态 |
| 追番 | `bangumi` | 追番列表 |
| 影视 | `media` | 影视列表 |
| 我的 | `my` | 历史、收藏、稍后再看 |
| 搜索 | `search` | 搜索结果 |
| UP主 | `up` | UP主个人主页 |
| 设置 | `settings` | 应用设置 |

---

## 4. 数据流向

### 4.1 视频播放流程

```
用户点击视频卡片
        │
        ▼
渲染进程: playVideo(bvid, cid)
        │
        ▼
IPC调用: 'play-video'
        │
        ▼
主进程: 选择播放器(MPV/内置)
        │
        ├── MPV模式 ──────► 查找MPV → 获取视频URL → 获取弹幕XML
        │                          │                │
        │                          ▼                ▼
        │                     启动MPV进程      XML→ASS转换
        │                          │                │
        │                          ▼                ▼
        │                     加载ASS字幕文件
        │
        └── 内置模式 ─────► 创建播放器窗口 → 预加载视频URL
                                       │
                                       ▼
                              加载player.html
                                       │
                                       ▼
                              渲染视频和弹幕
```

### 4.2 登录流程

```
用户点击登录
        │
        ▼
IPC: 'get-login-qrcode'
        │
        ▼
获取二维码图片和qrcode_key
        │
        ▼
渲染二维码并轮询状态
        │
        ▼
IPC: 'poll-login-status'
        │
        ▼
用户扫码并确认
        │
        ▼
获取登录成功的Cookie
        │
        ▼
保存Cookie到文件和session
        │
        ▼
刷新用户信息UI
```

---

## 5. 配置与运行

### 5.1 配置文件

| 文件 | 说明 | 路径 |
|------|------|------|
| 快捷键配置 | 自定义快捷键 | `src/config/defaultShortcuts.conf` |
| 更新配置 | 自动更新配置 | `src/config/update.yml` |

### 5.2 启动命令

```bash
# 开发模式
npm start

# 构建Windows版本
npm run build:win

# 构建Mac版本
npm run build:mac

# 构建Linux版本
npm run build:linux
```

### 5.3 构建产物

```
dist/
├── win-unpacked/          # Windows便携版
├── mac/                   # Mac DMG镜像
├── linux-unpacked/        # Linux AppImage
└── *.exe                  # Windows安装包
```

---

## 6. 关键设计模式

### 6.1 依赖注入模式

主进程使用依赖注入管理跨模块依赖：

```javascript
// 在main.js中组合依赖
registerPlayerHandlers({
  ipcMain, log, fetchApi, 
  state: sharedState,
  getDanmakuXml, xml2ass,
  openBuiltinPlayer,
  // ...其他依赖
})
```

### 6.2 观察者模式

Cookie变化监听和同步：

```javascript
// 监听session cookies变化
sess.cookies.on('changed', async (event, cookie, cause, removed) => {
  await cookieManager.exportCookiesFromSession(sess)
})
```

### 6.3 策略模式

播放器选择策略：

```javascript
if (useBuiltin) {
  // 使用内置播放器
  return await openBuiltinPlayer(bvid, cid, title, ...)
} else {
  // 尝试MPV，失败回退到内置
  const mpvExecutable = findMpvExecutable(mpvPath)
  if (!mpvExecutable) {
    return await openBuiltinPlayer(bvid, cid, title, ...)
  }
  // 启动MPV...
}
```

---

## 7. 安全机制

### 7.1 Cookie管理

- Cookie持久化加密存储
- 敏感Cookie（如SESSDATA）仅在内存中临时使用
- 支持通过剪贴板或文件导入Cookie

### 7.2 请求安全

- 所有API请求带Referer和Origin头
- User-Agent模拟浏览器
- 自动重试机制防止请求泄露

### 7.3 错误处理

- 未捕获异常弹窗提示
- 网络请求超时处理
- API错误统一包装

---

## 8. 扩展开发指南

### 8.1 添加新的IPC处理

1. 在 `src/main/ipc/` 新建处理器文件
2. 实现 `registerXXXHandlers(deps)` 函数
3. 在 `main.js` 的 `registerAllHandlers()` 中注册

### 8.2 添加新页面

1. 在 `src/renderer/pages/` 新建页面脚本
2. 在 `index.html` 中添加页面容器
3. 在 `renderer.js` 中添加页面状态和加载逻辑

### 8.3 添加快捷键

1. 在 `src/config/defaultShortcuts.conf` 添加配置
2. 在 `renderer.js` 中添加快捷键处理函数

---

## 9. 故障排除

### 9.1 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| MPV无法启动 | 未安装MPV或路径错误 | 安装MPV或在设置中指定路径 |
| 视频无法播放 | Cookie过期或未登录 | 重新登录获取Cookie |
| 弹幕不显示 | CID获取失败 | 检查网络连接 |
| 窗口黑屏 | GPU加速问题 | 尝试禁用硬件加速 |

### 9.2 日志查看

日志文件位于：
- 开发模式：项目根目录 `debug.log`
- 生产模式：`%APPDATA%\bilibili-client\debug.log`

---

## 10. 版本历史

| 版本 | 日期 | 主要更新 |
|------|------|----------|
| v0.0.2 | 2026 | 新增内置播放器、弹幕支持、视频下载 |
| v0.0.1 | 2025 | 基础功能：视频浏览、登录、追番 |

---

**文档生成日期**: 2026年6月11日  
**项目版本**: v0.0.2