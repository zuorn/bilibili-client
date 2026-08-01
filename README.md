# Bilibili Client

> 一个基于 Electron 开发的哔哩哔哩桌面客户端，原生 JS 渲染进程、无框架、无打包工具。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#下载安装)
[![Electron](https://img.shields.io/badge/Electron-41-47848F.svg)](https://www.electronjs.org/)

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
- **MPV 播放器** —— 通过 IPC 套接字接入外部 MPV，享受完整的 MPV 播放能力
- **DASH 流播放** —— 预取音视频分离的 DASH 流，独立同步播放
- **弹幕集成** —— 支持 B 站弹幕加载与 ASS 字幕转换
- **视频合并下载** —— 调用 ffmpeg 合并下载的音视频流

### 个性化与效率

- **Vim 风格快捷键** —— 按 `f` 为页面上所有可点击元素生成访问标签，纯键盘操作
- **自定义快捷键** —— 内置快捷键录制界面，支持个性化绑定
- **视频悬停预览** —— 鼠标悬停视频卡片即可预览动态内容
- **二维码登录** —— 扫码登录，Cookie 持久化免重复登录
- **深色主题** —— 内置深色模式适配
- **自动更新** —— 启动时自动检查新版本，支持 GitHub Releases 与 OSS 双源更新

---

## 下载安装

### 方式一：直接下载安装包（推荐）

前往 [Releases 页面](https://github.com/zuorn/bilibili-client/releases) 下载对应平台的安装包：

| 平台 | 安装包格式 |
| ---- | ---------- |
| Windows | `Bilibili-Client-Setup-x.x.x.exe`（NSIS 安装程序） |
| macOS | `Bilibili-Client-x.x.x.dmg` |
| Linux | `Bilibili-Client-x.x.x.AppImage` |

### 方式二：从源码构建

```bash
# 克隆仓库
git clone https://github.com/zuorn/bilibili-client.git
cd bilibili-client

# 安装依赖
npm install

# 构建当前平台安装包
npm run build:win      # Windows NSIS
npm run build:mac      # macOS DMG
npm run build:linux    # Linux AppImage
```

构建产物位于 `dist/` 目录下。

---

## 项目架构

本项目是一个 **Bilibili Electron 桌面客户端**。渲染进程是一个**原生 JS 单页应用**——无框架、无打包工具，所有脚本通过 `index.html` 中的 `<script>` 标签按依赖顺序加载。

### 目录结构

```
bilibili-client/
├── main.js                    # 主进程入口：接线中枢，创建 sharedState 并注入各模块
├── index.html                 # 渲染进程应用外壳
├── src/
│   ├── main/                  # 主进程模块
│   │   ├── api.js             # Bilibili API 调用、WBI 签名、Cookie 注入
│   │   ├── window.js          # 无框窗口创建与控制
│   │   ├── cookieManager.js   # Cookie 持久化与同步
│   │   ├── log.js             # 彩色控制台 + 文件日志
│   │   ├── updater.js         # 自动更新集成
│   │   ├── page-nav.js        # 跨页面导航 IPC
│   │   ├── player/            # 播放器实现（内置 / MPV）
│   │   └── ipc/               # 按业务域组织的 IPC 处理函数
│   ├── renderer/              # 渲染进程
│   │   ├── core/              # 全局状态、工具函数、导航、事件监听
│   │   ├── components/        # 视频卡片、登录、快捷键提示
│   │   ├── features/          # 播放、预览、滚动、快捷键、页面加载
│   │   └── pages/             # 各页面数据获取与渲染
│   ├── style/                 # 全局样式 + 按页面/组件组织的 CSS
│   ├── pages/player.html      # 内置播放器窗口
│   └── config/                # 默认快捷键、更新源配置
├── scripts/                   # 构建、启动、发布脚本
├── install/                   # NSIS 安装脚本
└── docs/                      # 开发文档与变更记录
```

### 通信模式

```
渲染进程                          主进程
ipcRenderer.invoke(channel) ──►  ipcMain.handle(channel)
                                 ↓
                                 业务模块处理
                                 ↓
mainWindow.webContents.send() ◄── 推送事件
ipcRenderer.on(channel)     ──►  渲染进程监听
```

模块之间通过 `deps` 对象依赖注入互相通信，而非直接 `import`。

> 更详细的架构说明、模块职责、WBI 签名流程、Cookie 流程、播放器架构等内容，请参阅 [CLAUDE.md](./CLAUDE.md)。

---

## 开发指南

### 环境要求

- [Node.js](https://nodejs.org/)（建议 LTS 版本）
- npm 或其他包管理器
- Windows / macOS / Linux 任一开发环境

### 常用命令

```bash
npm start              # 启动开发模式（设置 UTF-8 编码）
npm run build:win      # 构建 Windows NSIS 安装包
npm run build:mac      # 构建 macOS DMG 安装包
npm run build:linux    # 构建 Linux AppImage 安装包
npm run clean          # 清空 dist/ 目录
npm run publish:oss    # 发布构建产物到阿里云 OSS
```

### 开发提示

- 项目暂无测试套件（`npm test` 为占位命令）
- 渲染进程脚本加载顺序至关重要，详见 [CLAUDE.md](./CLAUDE.md) 中的加载顺序列表
- 综合动态页面（`dynamic.js`）与 UP 主页面动态（`up.js`）是两套独立实现，修改时务必确认目标文件
- 详细变更记录见 [docs/](./docs) 目录

---

## 技术栈

| 层 | 技术 |
| -- | ---- |
| 应用框架 | [Electron 41](https://www.electronjs.org/) |
| 渲染进程 | 原生 JavaScript（无框架、无打包工具） |
| 样式 | 原生 CSS（按页面/组件模块化组织） |
| 播放器 | HTML5 Video + [Anime4K](https://github.com/bloc97/Anime4K) WebGL 着色器 / [MPV](https://mpv.io/) |
| 视频处理 | [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) |
| 自动更新 | [electron-updater](https://www.electronjs.org/docs/latest/tutorial/updates) |
| 日志 | [chalk](https://github.com/chalk/chalk)（控制台）+ 文件日志 |
| HTTP | [axios](https://axios-http.com/) |
| 对象存储 | [ali-oss](https://www.npmjs.com/package/ali-oss)（用于发布） |

---

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

Copyright (c) 2026 Zuorn
