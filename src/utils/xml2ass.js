const xml2js = require('xml2js');

function log(...args) {
  console.log('[xml2ass]', ...args);
}

const ASS_HEADER = `[Script Info]
Title: Bilibili Danmaku
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Scroll,Microsoft YaHei,28,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,0,0,0,1
Style: Top,Microsoft YaHei,28,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,8,0,0,0,1
Style: Bottom,Microsoft YaHei,28,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const COLOR_PALETTE = [
  0xFFFFFF, // 0: 白色
  0xFF0000, // 1: 红色
  0xFF7F00, // 2: 橙色
  0xFFFF00, // 3: 黄色
  0x00FF00, // 4: 绿色
  0x00FFFF, // 5: 青色
  0x0000FF, // 6: 蓝色
  0x7F00FF, // 7: 紫色
  0xFF00FF, // 8: 粉色
  0xFF0000, // 9: 红色
  0x00FF00, // 10: 绿色
  0x0000FF, // 11: 蓝色
  0xFFFF00, // 12: 黄色
  0xFF00FF, // 13: 品红
  0x00FFFF, // 14: 青色
  0x808080, // 15: 灰色
  0xFF69B4, // 16: 粉红
  0x00CED1, // 17: 暗青色
  0xFFD700, // 18: 金色
  0x9370DB, // 19: 梅红
  0x3CB371, // 20: 海洋绿
  0xFF4500, // 21: 橙红
  0xDC143C, // 22: 深红
  0x4169E1, // 23: 皇家蓝
  0x9932CC, // 24: 暗紫
  0x20B2AA, // 25: 浅海洋绿
  0xFF6347, // 26: 番茄红
  0x32CD32, // 27: 酸橙绿
  0xFFDAB9, // 28: 桃色
  0xBA55D3, // 29: 中紫
  0x48D1CC, // 30: 绿松石
  0xFF8C00, // 31: 深橙
];

function resolveColor(colorValue) {
  if (colorValue >= COLOR_PALETTE.length) {
    if (colorValue >= 0x10000) {
      return colorValue;
    }
    return COLOR_PALETTE[0];
  }
  return COLOR_PALETTE[colorValue];
}

function rgbToBgr(rgb) {
  const r = (rgb >> 16) & 0xFF;
  const g = (rgb >> 8) & 0xFF;
  const b = rgb & 0xFF;
  return ((b << 16) | (g << 8) | r) >>> 0;
}

function estimateTextWidth(text, fontSize) {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    if (char > 0x7F) {
      width += fontSize;
    } else {
      width += fontSize * 0.6;
    }
  }
  return width;
}

function getTrackYPosition(type, danmakuIndex, fontSize) {
  const lineHeight = fontSize + 10;
  const scaledFontSize = fontSize * 1.1;
  if (type === 1) { // 滚动弹幕
    const maxLines = Math.floor((1080 - 200) / scaledFontSize);
    const lineIndex = danmakuIndex % maxLines;
    return 100 + lineIndex * lineHeight;
  } else if (type === 5) { // 顶部弹幕
    const maxLines = Math.floor((1080 / 3) / scaledFontSize);
    const lineIndex = danmakuIndex % maxLines;
    return 50 + lineIndex * lineHeight;
  } else if (type === 4) { // 底部弹幕
    const maxLines = Math.floor((1080 / 3) / scaledFontSize);
    const lineIndex = danmakuIndex % maxLines;
    return 1080 - 100 - lineIndex * lineHeight;
  }
  return 100;
}

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

async function xml2ass(xml) {
  log('Starting xml2ass conversion...');
  log('XML length:', xml.length);
  
  if (xml.length < 50) {
    log('Raw XML:', xml);
  }

  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(xml);
  let danmakus = result.i.d;

  log('Result structure:', Object.keys(result));
  log('i structure:', result.i ? Object.keys(result.i) : 'no i');

  let ass = ASS_HEADER;

  if (!Array.isArray(danmakus)) {
    danmakus = [danmakus];
    log('Single danmaku converted to array');
  }

  log('Total danmakus:', danmakus.length);
  
  let colorStats = { default: 0, colored: 0 };
  let typeStats = { 1: 0, 4: 0, 5: 0, other: 0 };
  let scrollIndex = 0;
  let topIndex = 0;
  let bottomIndex = 0;

  danmakus.forEach((dan, index) => {
    if (!dan || !dan.$ || !dan.$.p) {
      log(`Invalid danmaku at ${index}:`, dan);
      return;
    }

    const p = dan.$.p.split(',');
    const time = parseFloat(p[0]);
    const type = parseInt(p[1]);
    const fontSize = parseInt(p[2]) || 25;
    const rawColor = parseInt(p[3]);
    let color;
    
    // 检查颜色值是索引还是RGB值
    if (rawColor <= 0xFFFFFF && rawColor >= 0) {
      // 可能是RGB值
      color = rawColor;
    } else {
      // 否则作为调色板索引
      color = resolveColor(rawColor);
    }
    
    const text = dan._;

    if (index < 5) {
      log(`Danmaku ${index}: p=${JSON.stringify(p)}, text="${text?.substring(0, 15)}", rawColor=${rawColor}, color=${color}`);
    }

    if (typeStats[type] !== undefined) {
      typeStats[type]++;
    } else {
      typeStats.other++;
    }

    let pool = parseInt(p[5]) || 0;

    let isScroll = type === 1;
    let isTop = type === 5;
    let isBottom = type === 4;
    
    if (!isScroll && !isTop && !isBottom) {
      isScroll = true;
    }

    let danmakuIndex;
    if (isScroll) {
      danmakuIndex = scrollIndex++;
    } else if (isTop) {
      danmakuIndex = topIndex++;
    } else {
      danmakuIndex = bottomIndex++;
    }

    if (index < 20) {
      log(`Danmaku ${index}: type=${type}, isScroll=${isScroll}, isTop=${isTop}, isBottom=${isBottom}, text="${(text || '').substring(0, 15)}..."`);
    }

    const scrollDuration = isScroll ? 12 : 8;
    const start = formatTime(time);
    const end = formatTime(time + scrollDuration);

    let style = 'Scroll';
    if (isTop) style = 'Top';
    if (isBottom) style = 'Bottom';

    const textWidth = estimateTextWidth(text, fontSize);
    const yPos = allocateTrack(type, danmakuIndex, fontSize);

    let dialogueText = '';
    dialogueText += `{\\fs${fontSize}}`;
    if (color === 16777215) {
      colorStats.default++;
    } else {
      colorStats.colored++;
      const bgr = rgbToBgr(color);
      const assColor = `&H${bgr.toString(16).padStart(8, '0')}&`;
      dialogueText += `{\\c${assColor}}`;
    }
    
    const escapedText = (text || '').replace(/\r/g, '').replace(/\n/g, '\\N').replace(/\\/g, '\\\\');
    dialogueText += escapedText;

    if (isScroll) {
      const screenWidth = 1920;
      const padding = 50;
      const startX = screenWidth + padding;
      const endX = -textWidth - padding;
      
      const pixelsPerSecond = (screenWidth + textWidth + padding * 2) / 12;
      const actualDuration = Math.max(8, (screenWidth + textWidth + padding * 2) / pixelsPerSecond);
      const endTime = time + actualDuration;
      
      const startTimeStr = formatTime(time);
      const endTimeStr = formatTime(endTime);
      
      ass += `Dialogue: 0,${startTimeStr},${endTimeStr},${style},,0,0,0,,{\\move(${startX},${yPos},${endX},${yPos})}${dialogueText}\n`;
    } else {
      ass += `Dialogue: 0,${start},${end},${style},,0,0,0,,{\\pos(960,${yPos})}${dialogueText}\n`;
    }

    if (index < 10) {
      const bgr = rgbToBgr(color);
      log(`Generated danmaku ${index}: RGB=${color.toString(16).padStart(6, '0')}, BGR=${bgr.toString(16).padStart(6, '0')}, Type=${type}, Start=${start}, Text="${escapedText.substring(0, 10)}..."`);
    }
  });

  log('Type stats:', typeStats);
  log('Color stats:', colorStats);
  log('ASS file generated, length:', ass.length);
  return ass;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(2);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.padStart(5, '0')}`;
}

module.exports = xml2ass;