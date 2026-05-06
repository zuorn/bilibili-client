# Bilibili Client

一个基于 Electron + MPV 开发的哔哩哔哩桌面客户端，提供简洁优雅的界面和流畅的视频播放体验。

## 功能特性

### 核心功能

- 🎬 **视频推荐** - 个性化推荐内容，发现更多精彩视频
- 🔥 **热门视频** - 实时热门榜单，了解最新趋势
- 📺 **追番** - 番剧索引，追番更便捷
- 🎥 **影视** - 影视内容专区
- 📱 **动态** - 关注UP主动态，不错过任何更新
- 👤 **个人中心** - 历史记录、我的收藏

### 特色功能

- 🔐 **扫码登录** - 支持哔哩哔哩APP扫码登录
- 🎨 **主题切换** - 支持浅色/暗色/跟随系统主题
- 🎭 **UP主主页** - 查看UP主信息和投稿视频
- 🔍 **搜索功能** - 快速搜索感兴趣的内容
- 🎥 **MPV播放** - 使用MPV播放器播放视频，支持硬件加速
- 📊 **播放历史同步** - 自动上报播放进度到哔哩哔哩

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **Node.js** - 后端运行环境
- **Axios** - HTTP 请求库
- **node-mpv** - MPV 播放器控制
- **electron-builder** - 应用打包工具

## 项目结构

```
electron-s/
├── main.js                 # 主进程文件
├── index.html              # 主页面
├── icon.png                # 应用图标
├── package.json            # 项目配置
├── src/
│   ├── pages/              # 页面文件
│   │   ├── anime.html      # 追番页
│   │   ├── dynamic.html    # 动态页
│   │   ├── media.html      # 影视页
│   │   ├── my.html         # 个人中心页
│   │   ├── popular.html    # 热门页
│   │   └── up-profile.html # UP主主页
│   ├── renderer/           # 渲染进程脚本
│   │   ├── renderer.js     # 主渲染进程
│   │   ├── layout.js       # 布局控制
│   │   └── ...             # 其他页面渲染脚本
│   └── style/
│       └── style.css       # 样式文件
└── dist/                   # 打包输出目录
```

## 安装与运行

### 前置要求

- **Node.js** >= 14.0.0
- **npm** >= 6.0.0
- **MPV播放器**（用于视频播放）

#### 安装 MPV 播放器

**Windows:**

1. 下载 MPV: [https://mpv.io/installation/](https://mpv.io/installation/)
2. 将 mpv.exe 所在目录添加到系统 PATH，或在设置中指定路径

**macOS:**

```bash
brew install mpv
```

**Linux:**

```bash
sudo apt install mpv  # Debian/Ubuntu
sudo dnf install mpv  # Fedora
```

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm start
```

## 使用说明

### 登录账号

1. 点击左侧边栏底部的用户头像
2. 使用哔哩哔哩手机APP扫描二维码登录
3. 登录后可访问历史记录、收藏等功能

### 播放视频

1. 点击视频卡片即可播放
2. 视频将通过 MPV 播放器打开
3. 播放进度会自动同步到哔哩哔哩

### 设置 MPV 路径

如果系统无法自动找到 MPV 播放器：

1. 进入设置页面（点击左侧边栏设置图标）
2. 在"MPV路径"设置项中指定 mpv.exe 的完整路径
3. 点击"浏览"按钮选择可执行文件

## 打包应用

| 命令                    | 说明              |
| :---------------------- | :---------------- |
| `npm start`           | 启动开发模式      |
| `npm run build`       | 打包当前系统版本  |
| `npm run build:win`   | 打包 Windows 版本 |
| `npm run build:mac`   | 打包 macOS 版本   |
| `npm run build:linux` | 打包 Linux 版本   |
| `npm run clean`       | 清理打包产物      |

打包后的应用位于 `dist/` 目录下。

## 开发相关

### 主要 API 接口

应用通过哔哩哔哩 Web API 获取数据，主要接口包括：

- 视频推荐：`/x/web-interface/wbi/index/top/feed/rcmd`
- 热门视频：`/x/web-interface/ranking/v2`
- 番剧索引：`/pgc/season/index/result`
- 动态获取：`/x/polymer/web-dynamic/v1/feed/all`
- 用户信息：`/x/web-interface/nav`
- 历史记录：`/x/web-interface/history/cursor`
- 收藏夹：`/x/v3/fav/resource/list`

### IPC 通信

主进程与渲染进程通过 Electron IPC 进行通信，主要通道包括：

- `fetch-videos` - 获取推荐视频
- `search-videos` - 搜索视频
- `play-video` - 播放视频
- `get-user-info` - 获取用户信息
- `get-history` - 获取历史记录
- 更多详见 [main.js](main.js)

## 注意事项

1. **日志文件** - 调试日志位于应用数据目录的 `debug.log` 文件中
2. **网络要求** - 需要稳定的网络连接访问哔哩哔哩 API
3. **MPV 播放器** - 必须安装 MPV 播放器才能播放视频
4. **API 限制** - 部分接口可能需要登录才能访问

## 许可证

ISC

## 免责声明

本项目仅供学习和研究使用，不得用于商业用途。本项目与哔哩哔哩官方无关，使用本项目所产生的一切后果由使用者自行承担。

## 致谢

- 感谢哔哩哔哩提供的优质内容平台
- 感谢 Electron 社区的支持
- 感谢 MPV 播放器项目

---

**开发者**: zuorn
**版本**: 1.0.0
**最后更新**: 2026-05-03
