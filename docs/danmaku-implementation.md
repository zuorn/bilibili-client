# Electron集成B站弹幕文档

## 概述

本文档描述了如何在 Electron应用中集成 B 站弹幕功能。通过获取 B 站弹幕 XML 数据，转换为 ASS 字幕格式，并使用 mpv 播放器原生加载显示，实现弹幕的滚动、固定位置显示、颜色和字体大小等功能。

## 流程

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────────┐
│  B站弹幕API  │ ──> │  获取XML数据  │ ──> │ XML转ASS     │ ──> │ mpv播放器  │
│             │     │  (getDanmaku)│     │ (xml2ass.js)│     │ 加载字幕   │
└─────────────┘     └──────────────┘     └─────────────┘     └────────────┘
```

## 核心模块

### 1. getDanmaku.js - 弹幕获取

负责从 B 站 API 获取弹幕 XML 数据。

**主要功能：**

- `getDanmakuXml(cid)` - 根据视频 cid 获取弹幕 XML
- `getCidByBvid(bvid)` - 根据视频 BV 号获取 cid

**API 接口：**

```javascript
// 弹幕XML接口
const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;

// CID获取接口
const url = `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}&jsonp=jsonp`;
```

**数据格式（XML）：**

```xml
<d p="时间,类型,字号,颜色,发送者ID,弹幕池,弹幕ID,时间戳">
  弹幕内容
</d>
```

**参数说明：**

| 索引    | 字段    | 说明                     |
| ----- | ----- | ---------------------- |
| p\[0] | 时间    | 弹幕出现时间（秒）              |
| p\[1] | 类型    | 1=滚动弹幕, 4=底部弹幕, 5=顶部弹幕 |
| p\[2] | 字号    | 字体大小                   |
| p\[3] | 颜色    | 颜色值（RGB或调色板索引）         |
| p\[4] | 发送者ID | 用户ID                   |
| p\[5] | 弹幕池   | 0=普通弹幕                 |
| p\[6] | 弹幕ID  | 唯一标识                   |
| p\[7] | 时间戳   | 发送时间                   |

**特性：**

- 支持 gzip 解压：B 站 API 返回的数据经过 gzip 压缩，需要解压
- 自动重试：解压失败时使用原始数据

```javascript
async function getDanmakuXml(cid) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });

  let xmlData;
  try {
    xmlData = await gunzip(res.data);  // gzip 解压
    xmlData = xmlData.toString('utf8');
  } catch (e) {
    xmlData = res.data.toString('utf8');  // 原始数据
  }

  return xmlData;
}
```

### 2. xml2ass.js - XML 转 ASS 字幕

将 B 站弹幕 XML 转换为 ASS 字幕格式。

**ASS 字幕格式简介：**

ASS (Advanced SubStation Alpha) 是一种高级字幕格式，支持丰富的样式和动画效果。

**ASS 文件结构：**

```
[Script Info]          # 脚本信息
[V4+ Styles]          # 样式定义
[Events]              # 事件/字幕条目
```

**样式定义示例：**

```ass
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, ...
Style: Scroll,Microsoft YaHei,28,&H00FFFFFF,...
Style: Top,Microsoft YaHei,28,&H00FFFFFF,...
Style: Bottom,Microsoft YaHei,28,&H00FFFFFF,...
```

**关键转换逻辑：**

#### 2.1 颜色处理

B 站弹幕颜色使用 RGB 格式，ASS 需要 BGR 格式。

```javascript
function rgbToBgr(rgb) {
  const r = (rgb >> 16) & 0xFF;
  const g = (rgb >> 8) & 0xFF;
  const b = rgb & 0xFF;
  return ((b << 16) | (g << 8) | r) >>> 0;
}
```

**调色板映射：**

B 站弹幕颜色使用调色板索引（0-31），需要映射为 RGB 值：

```javascript
const COLOR_PALETTE = [
  0xFFFFFF, // 0: 白色
  0xFF0000, // 1: 红色
  0xFF7F00, // 2: 橙色
  0xFFFF00, // 3: 黄色
  // ... 共32种颜色
];

function resolveColor(colorValue) {
  if (colorValue >= COLOR_PALETTE.length) {
    if (colorValue >= 0x10000) {
      return colorValue;  // 直接是RGB值
    }
    return COLOR_PALETTE[0];  // 默认白色
  }
  return COLOR_PALETTE[colorValue];
}
```

#### 2.2 弹幕类型处理

| B站类型 | ASS样式  | 显示效果       |
| ---- | ------ | ---------- |
| 1    | Scroll | 滚动弹幕（从右到左） |
| 4    | Bottom | 底部固定弹幕     |
| 5    | Top    | 顶部固定弹幕     |

```javascript
let isScroll = type === 1;
let isTop = type === 5;
let isBottom = type === 4;

if (!isScroll && !isTop && !isBottom) {
  isScroll = true;  // 未知类型默认为滚动
}
```

#### 2.3 滚动弹幕移动效果

使用 ASS 的 `\move` 标签实现从右到左的滚动效果：

```javascript
if (isScroll) {
  const screenWidth = 1920;
  const padding = 50;
  const startX = screenWidth + padding;      // 起点：屏幕右边缘外
  const endX = -textWidth - padding;         // 终点：屏幕左边缘外

  const pixelsPerSecond = (screenWidth + textWidth + padding * 2) / 12;
  const actualDuration = Math.max(8, ...);
  const endTime = time + actualDuration;

  ass += `Dialogue: 0,${startTime},${endTime},${style},,0,0,0,,{\\move(${startX},${yPos},${endX},${yPos})}${dialogueText}\n`;
}
```

**移动参数：**

- `startX, yPos` - 起始位置
- `endX, yPos` - 结束位置
- 滚动时间：12秒（可调整）

#### 2.4 固定弹幕定位

使用 `\pos` 标签固定弹幕位置：

```javascript
} else {
  ass += `Dialogue: 0,${start},${end},${style},,0,0,0,,{\\pos(960,${yPos})}${dialogueText}\n`;
}
```

- x=960 - 屏幕水平居中
- y=yPos - 根据轨道分配计算

#### 2.5 轨道分配算法

为避免弹幕过于密集，采用简单的取模轮询分配：

```javascript
function allocateTrack(type, danmakuIndex, fontSize) {
  const lineHeight = fontSize + 10;
  const screenHeight = 1080;
  const margin = 50;
  const usableHeight = screenHeight - margin * 2;

  const maxLines = Math.floor(usableHeight / lineHeight);
  const startY = margin;

  const lineIndex = danmakuIndex % maxLines;
  const yPos = startY + lineIndex * lineHeight;

  return Math.min(yPos, screenHeight - margin);
}
```

**计算示例：**

当 `fontSize=25`, `lineHeight=35` 时：

- `maxLines = Math.floor(980 / 35) = 28`
- Y坐标范围：50 \~ 995（屏幕范围内）

#### 2.6 文字宽度估算

ASS 需要计算字幕宽度以确定滚动时间：

```javascript
function estimateTextWidth(text, fontSize) {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    if (char > 0x7F) {
      width += fontSize;           // 中文字符
    } else {
      width += fontSize * 0.6;     // 英文字符
    }
  }
  return width;
}
```

#### 2.7 时间格式化

ASS 使用 `hh:mm:ss.xx` 格式：

```javascript
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(2);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.padStart(5, '0')}`;
}
```

### 3. main.js - 播放器集成

在 Electron 的 main 进程中集成弹幕加载逻辑。

**执行流程：**

```
1. 获取视频信息（CID）
   ↓
2. 调用 getDanmakuXml(cid) 获取弹幕XML
   ↓
3. 调用 xml2ass(xml) 转换为ASS格式
   ↓
4. 写入临时文件
   ↓
5. 启动mpv并加载字幕
```

**代码示例：**

```javascript
ipcMain.handle('play-video', async (event, bvid, cid, title, mpvPath) => {
  const startTime = Date.now();

  // 1. 获取视频CID
  let targetCid = cid;
  if (!cid) {
    const videoInfo = await getVideoInfo(bvid);
    targetCid = videoInfo.cid;
  }

  // 2. 获取弹幕XML
  const xml = await getDanmakuXml(targetCid);

  // 3. 转换为ASS
  const ass = await xml2ass(xml);

  // 4. 写入临时文件
  const danmakuAssPath = path.join(app.getPath('temp'), `danmaku_${targetCid}.ass`);
  fs.writeFileSync(danmakuAssPath, ass, 'utf8');

  // 5. 启动mpv并加载字幕
  const mpvArgs = [
    '--hwdec=auto',
    '--volume=80',
    '--border=no',
    `--title=${videoTitle}`,
    '--sub-auto=fuzzy',
    '--sub-ass-override=yes',
    `--sub-file=${danmakuAssPath}`  // 加载弹幕字幕
  ];

  mpvProcess = spawn(mpvExecutable, mpvArgs, { shell: true });

  log(`视频启动总耗时: ${Date.now() - startTime}ms`);
});
```

## 性能分析

### 启动时间分解

| 步骤      | 典型耗时             | 说明         |
| ------- | ---------------- | ---------- |
| 获取mpv路径 | \~5ms            | 文件系统查找     |
| 获取视频CID | \~200ms          | 网络请求       |
| 获取弹幕XML | \~500-1500ms     | 网络请求（主要耗时） |
| XML转ASS | \~50-500ms       | CPU计算      |
| 写入ASS文件 | \~10-100ms       | 磁盘IO       |
| **总计**  | **\~800-2100ms** | <br />     |

### 性能优化建议

1. **弹幕缓存**：将已转换的ASS文件缓存到本地，避免重复转换
2. **异步加载**：先启动视频，再异步加载弹幕
3. **分页请求**：对大量弹幕使用分页接口（seg.so）
4. **超时处理**：设置合理的网络超时时间

## 已知问题与限制

1. **弹幕重叠**：高密度弹幕可能产生视觉重叠
2. **网络依赖**：完全依赖B站API获取弹幕
3. **ASS格式限制**：mpv对ASS的支持有限，部分特效可能不显示

## 文件结构

```
electron-s/
├── main.js                    # Electron主进程
├── src/
│   └── utils/
│       ├── getDanmaku.js      # 弹幕获取模块
│       └── xml2ass.js         # XML转ASS模块
└── docs/
    └── danmaku-implementation.md  # 本文档
```

## 依赖清单

```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "xml2js": "^0.6.2"
  }
}
```

## 参考资料

- [ASS字幕格式文档](https://www.nikkansh.com/vf/ass-specs.pdf)
- [B站弹幕API研究](https://github.com/SocialSisterYi/bilibili-API-collect)
- [mpv播放器字幕支持](https://mpv.io/manual/master/)

