# Bilibili Client

> 一个基于 Tauri 2 开发的哔哩哔哩桌面客户端，原生 JS 渲染层、无框架、无打包工具，后端为 Rust。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#下载安装)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://v2.tauri.app/)

---

## 目录

- [功能特性](#功能特性)
- [下载安装](#下载安装)
- [项目架构](#项目架构)
- [开发指南](#开发指南)
- [技术栈](#技术栈)
- [许可证](#许可证)

---

## 功能特性

### 内容浏览

- **首页推荐** —— 个性化视频推荐流，无限滚动加载
- **热门排行** —— 多 Tab 切换的热门视频榜单
- **综合动态** —— 关注 UP 主的聚合动态信息流
- **追番 / 影视** —— 完整的追番与影视库管理
- **UP 主空间** —— 查看 UP 主主页、视频、动态与关注列表
- **搜索** —— 内置搜索下拉框，快速检索视频与 UP 主

### 播放体验

- **内置播放器** —— 基于 HTML5 的独立窗口播放器，支持 Anime4K WebGL 画质增强着色器
- **MPV 播放器** —— 接入外部 MPV，享受完整的 MPV 播放能力
- **DASH 流播放** —— 预取音视频分离的 DASH 流，独立同步播放
- **弹幕集成** —— 支持 B 站弹幕加载与 ASS 字幕转换
- **视频合并下载** —— 调用 ffmpeg 合并下载的音视频流

### 个性化与效率

- **Vim 风格快捷键** —— 按 `f` 为页面上所有可点击元素生成访问标签，纯键盘操作
- **自定义快捷键** —— 内置快捷键录制界面，支持个性化绑定
- **视频悬停预览** —— 鼠标悬停视频卡片即可预览动态内容
- **二维码登录** —— 扫码登录，Cookie 持久化免重复登录
- **深色主题** —— 内置深色模式适配
- **自动更新** —— 启动时自动检查新版本，支持 OSS 与 GitHub Releases 双源更新

---

## 下载安装

### 方式一：直接下载安装包（推荐）

前往 [Releases 页面](https://github.com/zuorn/bilibili-client/releases) 下载对应平台的安装包：

| 平台 | 安装包格式 |
| ---- | ---------- |
| Windows | `Bilibili Client_x.x.x_x64-setup.exe`（NSIS 安装程序，当前主要构建目标） |
| macOS | 适配中 |
| Linux | 适配中 |

### 方式二：从源码构建

环境要求：Node.js（LTS）、[Rust 工具链](https://www.rust-lang.org/tools/install)（Windows 需 MSVC 与 WebView2 运行时）。

```bash
# 克隆仓库
git clone https://github.com/zuorn/bilibili-client.git
cd bilibili-client

# 安装依赖
npm install

# 收集前端资源到 app-dist/（tauri 的 frontendDist）
node scripts/build-frontend.js

# 构建当前平台安装包
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/` 目录下。

---

## 项目架构

本项目是一个 **Bilibili Tauri 2 桌面客户端**。渲染层是**原生 JS 单页应用**——无框架、无打包工具，所有脚本通过 `index.html` 中的 `<script>` 标签按依赖顺序加载；后端为 Rust，通过统一的 `ipc` 命令按通道名分发处理。

### 目录结构

```
bilibili-client/
├── index.html                 # 渲染层应用外壳
├── src/
│   ├── renderer/              # 渲染层（原生 JS，无打包工具）
│   │   ├── core/              # ipc-shim 兼容层、全局状态、工具函数、导航、事件监听
│   │   ├── components/        # 视频卡片、登录、快捷键提示
│   │   ├── features/          # 播放、预览、滚动、快捷键、页面加载
│   │   └── pages/             # 各页面数据获取与渲染
│   ├── style/                 # 全局样式 + 按页面/组件组织的 CSS
│   ├── pages/player.html      # 内置播放器窗口
│   └── config/                # 默认快捷键等配置
├── src-tauri/                 # Tauri 2 / Rust 后端
│   ├── tauri.conf.json        # 应用配置（窗口、打包、更新器）
│   └── src/
│       ├── main.rs            # 入口 + ipc 统一命令
│       ├── ipc/               # 按业务域组织的通道模块（feeds/user/dynamics/...）
│       ├── api.rs             # Bilibili API、WBI 签名、Cookie 注入
│       ├── cookie_store.rs    # Cookie 持久化与同步
│       ├── player_window.rs   # 内置播放器第二窗口与请求头注入
│       ├── updater.rs         # 自动更新（多渠道取最高版本）
│       └── tray.rs / window_state.rs / state.rs
├── scripts/                   # 前端资源收集、开发服务器、发布脚本
├── app-dist/                  # 构建产物前端资源（frontendDist，由脚本生成）
└── docs/                      # 开发文档与变更记录
```

### 通信模式

渲染层通过 `ipc-shim.js` 兼容层以 `ipcRenderer` 的原有 API 与 Rust 后端通信，通道名与旧版一一对应：

```
渲染层（原生 JS）
ipcRenderer.invoke(channel, ...args)        ← ipc-shim.js 转发
        │  tauri.core.invoke('ipc', { channel, args })
        ▼
Rust 统一入口命令 ipc()  →  ipc::dispatch(channel)
        │  按通道名分发到业务模块
        ▼
返回结果 ◄──────────────────────────────────
推送事件：app.emit(channel, payload) → shim 映射回 ipcRenderer.on 回调
```

> 更详细的架构说明、模块职责、WBI 签名流程、Cookie 流程、播放器架构及迁移踩坑记录，请参阅 [CLAUDE.md](./CLAUDE.md)。

---

## 开发指南

### 环境要求

- [Node.js](https://nodejs.org/)（建议 LTS 版本）
- [Rust](https://www.rust-lang.org/tools/install)（Windows 需 MSVC 工具链与 WebView2 运行时）
- Windows / macOS / Linux 任一开发环境

### 常用命令

```bash
node scripts/build-frontend.js   # 收集前端资源 src/ → app-dist/（dev 与 build 前执行）
npm run tauri:dev                # 启动开发模式
npm run tauri:build              # 构建 Windows NSIS 安装包 + 更新签名
npm run publish:oss:tauri        # 发布安装包/签名/latest.json 到阿里云 OSS
npm run publish:oss:tauri:dry    # 发布演练（不上传）
```

### 开发提示

- 项目暂无测试套件（`npm test` 为占位命令）
- 渲染层脚本加载顺序至关重要（`ipc-shim.js` 必须最先加载），详见 [CLAUDE.md](./CLAUDE.md) 中的加载顺序列表
- 综合动态页面（`dynamic.js`）与 UP 主页面动态（`up.js`）是两套独立实现，修改时务必确认目标文件
- 项目正从 Electron 迁移到 Tauri，Electron 遗留代码暂时保留；详细变更记录见 [docs/](./docs) 目录

---

## 技术栈

| 层 | 技术 |
| -- | ---- |
| 应用框架 | [Tauri 2](https://v2.tauri.app/)（Rust 后端 + 系统 WebView） |
| 渲染层 | 原生 JavaScript（无框架、无打包工具） |
| 样式 | 原生 CSS（按页面/组件模块化组织） |
| 播放器 | HTML5 Video + [Anime4K](https://github.com/bloc97/Anime4K) WebGL 着色器 / [MPV](https://mpv.io/) |
| 视频处理 | [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static)（随安装包捆绑） |
| HTTP | [reqwest](https://github.com/seanmonstar/reqwest)（gzip/brotli）+ [tokio](https://tokio.rs/) |
| 自动更新 | [tauri-plugin-updater](https://v2.tauri.app/plugin/updater/)（minisign 签名） |
| 发布 | [ali-oss](https://www.npmjs.com/package/ali-oss)（安装包上传阿里云 OSS） |

---

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

Copyright (c) 2026 Zuorn
