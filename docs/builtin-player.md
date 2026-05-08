内置播放器技术文档
================================

## 概述

内置播放器是基于 Electron 和 HTML5 Video API 实现的视频播放组件，提供了完整的视频播放功能，包括播放控制、窗口管理、键盘快捷键等特性。

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     主进程 (main.js)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Player Window Manager                              │   │
│  │  - 创建播放器窗口                                   │   │
│  │  - 窗口位置/大小管理                                │   │
│  │  - 多显示器支持                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  IPC Handlers                                      │   │
│  │  - zoom-player-window                              │   │
│  │  - move-player-window                              │   │
│  │  - get-video-url                                   │   │
│  │  - get-login-info                                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ IPC Communication
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   渲染进程 (player.html)                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Video Player Core                                 │   │
│  │  - HTML5 Video Element                             │   │
│  │  - DASH/DURL格式支持                               │   │
│  │  - 音视频同步                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UI Components                                     │   │
│  │  - Control Bar (播放控制栏)                         │   │
│  │  - Title Bar (标题栏)                              │   │
│  │  - Danmaku Renderer (弹幕渲染)                     │   │
│  │  - Volume Control (音量控制)                       │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Event System                                      │   │
│  │  - Keyboard Shortcuts (键盘快捷键)                  │   │
│  │  - Mouse Events (鼠标事件)                         │   │
│  │  - Window Drag (窗口拖动)                          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 核心功能

### 1. 视频播放

#### 1.1 格式支持

| 格式 | 说明 | 实现方式 |
|------|------|----------|
| DASH | 动态自适应流媒体 | 分离音视频流，同步播放 |
| DURL | 音视频合并流 | 直接设置到 video 元素 |

#### 1.2 清晰度选择

系统自动从高到低尝试以下清晰度级别：

1. HDR1080P60 (qn=125)
2. 4K (qn=120)
3. 1080P60 (qn=116)
4. 1080P+ (qn=112)
5. 1080P (qn=80)
6. 720P60 (qn=74)
7. 720P (qn=64)
8. 480P (qn=32)
9. 360P (qn=16)

#### 1.3 核心实现

视频加载流程：

```javascript
async function loadVideo(bvid, cid) {
  const result = await ipcRenderer.invoke('get-video-url', bvid, cid)
  
  if (result.isCombined) {
    videoPlayer.src = result.url
  } else {
    videoPlayer.src = result.url
    const audioElement = document.createElement('audio')
    audioElement.src = result.audioUrl
    
    videoPlayer.addEventListener('play', () => audioElement.play())
    videoPlayer.addEventListener('pause', () => audioElement.pause())
    videoPlayer.addEventListener('seeked', () => {
      audioElement.currentTime = videoPlayer.currentTime
    })
  }
}
```

### 2. 窗口管理

#### 2.1 窗口操作 API

| IPC 方法 | 参数 | 说明 |
|----------|------|------|
| minimize-player-window | 无 | 最小化窗口 |
| maximize-player-window | 无 | 最大化/还原窗口 |
| zoom-player-window | delta: number | 缩放窗口 (1=放大, -1=缩小) |
| move-player-window | direction: string | 移动窗口 |
| move-to-next-display | 无 | 移动到下一个显示器 |
| get-window-position | 无 | 获取窗口位置 |
| set-window-position-smooth | x, y: number | 设置窗口位置 |

#### 2.2 缩放逻辑

缩放限制：最小宽高为 640x360，放大超出屏幕自动全屏。

#### 2.3 窗口拖动

拖动功能仅在视频区域的中间 60% 区域生效，排除顶部 20%（标题栏触发区）和底部 20%（控制栏触发区）。

### 3. 控制栏与标题栏

#### 3.1 自动隐藏机制

- **控制栏**: 鼠标移至窗口底部 20% 区域时显示
- **标题栏**: 鼠标移至窗口顶部 20% 区域时显示

#### 3.2 透明度设置

使用 75% 透明度背景。

### 4. 键盘快捷键

#### 4.1 快捷键列表

| 快捷键 | 功能 |
|--------|------|
| Q | 关闭播放器 |
| F / Enter | 全屏/退出全屏 |
| = | 放大窗口 |
| - | 缩小窗口 |
| Space | 播放/暂停 |
| ArrowLeft | 快退 5 秒 |
| ArrowRight | 快进 5 秒 |
| ArrowUp | 音量 +10% |
| ArrowDown | 音量 -10% |
| M | 静音/取消静音 |
| Ctrl + Tab | 切换到下一个显示器 |
| W/A/S/D | 移动窗口位置 |

#### 4.2 缩放防抖

实现了 200ms 的防抖机制避免频繁缩放。

### 5. 弹幕系统

#### 5.1 弹幕加载

弹幕通过 Bilibili API 获取，格式为 XML。

#### 5.2 弹幕渲染

弹幕以动画形式从右向左滚动，随机位置分布，15秒后自动清理。

### 6. 音量控制

音量调整时显示垂直音量条，包含百分比显示和图标，静音时自动切换图标。

## 文件结构

```
src/
├── pages/
│   └── player.html      # 播放器主页面
└── utils/
    └── getDanmaku.js    # 弹幕获取工具
```

## 登录状态共享

播放器窗口通过以下方式共享登录状态：

1. 使用相同的 session partition
2. 复制主窗口的 cookies 到播放器窗口
3. 通过 API 验证登录状态并显示用户信息

## 技术栈

- Electron: 窗口管理和 IPC 通信
- HTML5 Video: 视频播放核心
- CSS3: 动画和样式
- JavaScript: 业务逻辑实现

## 注意事项

1. 播放器窗口使用 frame: false，需要自定义窗口控制按钮
2. DASH 格式需要单独处理音频流同步
3. 弹幕渲染需要注意性能优化，避免过多弹幕影响性能
