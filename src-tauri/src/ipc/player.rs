// player 模块：对应 Electron 版 src/main/ipc/player.js（+ player/mpv.js 的进程管理）
// 通道（20 个）：play-video / play-video-new-window / get-video-url /
//   get-video-preview-url / get-video-info / get-relation-stat / get-related-videos /
//   get-danmaku / get-video-snapshot / select-mpv-path / stop-video /
//   get-danmaku-xml / get-cid-by-bvid / xml-to-ass / fetch-danmaku-ass /
//   save-ass-file / get-comments / like-archive / post-comment / delete-comment
//
// Phase 3 进度：
//   [x] 全部纯 API 通道 + fetchBestPlayUrl（9 档清晰度并行 + DASH 编解码优先级）
//   [x] xml2ass 弹幕转 ASS（对应 src/utils/xml2ass.js，逐行移植）
//   [x] MPV 播放路径（spawn + 弹幕字幕 + 最终进度上报）
//   [ ] 内置播放器第二 WebviewWindow（openBuiltinPlayer + 窗口控制命令 +
//       download-video + CDN 请求头注入）：useBuiltin / 未找到 MPV 时暂返回错误
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;

use crate::api::{fetch_api, fetch_wbi_keys, get_mix_key, now_millis_js, sign_params, enc, UA_120};
use crate::cookie_store;
use crate::ipc::history::report_play_history;
use crate::state;

// ==================== MPV 进程管理（对应 player/mpv.js 精简版） ====================

static MPV_CHILD: Lazy<Mutex<Option<tokio::process::Child>>> = Lazy::new(|| Mutex::new(None));

/// 对应 stopVideo：结束 MPV 进程（Electron 版同时清理 socket，但该流程实际未启用）
pub fn stop_video() {
    if let Ok(mut guard) = MPV_CHILD.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.start_kill();
        }
    }
}

fn player_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // 对应 Electron fetch / https.request 的 rejectUnauthorized: false
            .danger_accept_invalid_certs(true)
            .build()
            .expect("failed to build reqwest client")
    })
}

/// 共享 client（player_window 模块的下载功能复用）
pub fn shared_client() -> &'static reqwest::Client {
    player_client()
}

// ==================== 参数辅助 ====================

fn arg_str(args: &[Value], idx: usize, default: &str) -> String {
    match args.get(idx) {
        None => default.to_string(),
        Some(Value::Null) => default.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

fn arg_bool(args: &[Value], idx: usize, default: bool) -> bool {
    args.get(idx).and_then(|v| v.as_bool()).unwrap_or(default)
}

/// 对应 JS 真值判断（0/''/null 视为假）
fn arg_truthy(args: &[Value], idx: usize) -> bool {
    match args.get(idx) {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        Some(_) => true,
    }
}

// ==================== 视频信息（WBI view/detail） ====================

/// 构建 view/detail 的签名 query（getVideoInfo 与 get-video-info 通道共用）
async fn build_view_detail_query(bvid: &str) -> Option<String> {
    let keys = fetch_wbi_keys().await?;
    let mix_key = get_mix_key(&keys.0, &keys.1);
    let params: Vec<(String, String)> = vec![
        ("bvid".to_string(), bvid.to_string()),
        ("need_operation_card".to_string(), "1".to_string()),
        ("web_rm_repeat".to_string(), "1".to_string()),
        ("need_elec".to_string(), "1".to_string()),
        ("out_referer".to_string(), String::new()),
        ("platform".to_string(), "pc".to_string()),
        ("web_location".to_string(), "bilibili-electron".to_string()),
    ];
    let (w_rid, wts) = sign_params(&params, &mix_key);
    // JS: Object.entries({...params, w_rid, wts}) —— 插入顺序，不排序
    let mut all = params;
    all.push(("w_rid".to_string(), w_rid));
    all.push(("wts".to_string(), wts.to_string()));
    Some(
        all.iter()
            .map(|(k, v)| format!("{}={}", enc(k), enc(v)))
            .collect::<Vec<_>>()
            .join("&"),
    )
}

/// 对应 getVideoInfo 独立助手（fetchApi 带 cookie），返回扁平化字段
pub async fn get_video_info(bvid: &str) -> Option<Value> {
    let query = build_view_detail_query(bvid).await?;
    let url = format!(
        "https://api.bilibili.com/x/web-interface/wbi/view/detail?{}",
        query
    );
    let result = fetch_api(&url).await.ok()?;
    if result.get("code").and_then(|c| c.as_i64()) != Some(0) {
        return None;
    }
    let v = result.pointer("/data/View")?;
    Some(json!({
        "aid": v.get("aid").cloned().unwrap_or(Value::Null),
        "cid": v.get("cid").cloned().unwrap_or(Value::Null),
        "duration": v.get("duration").cloned().unwrap_or(Value::Null),
        "title": v.get("title").cloned().unwrap_or(Value::Null),
        "dimension": v.get("dimension").cloned().unwrap_or(Value::Null),
        "owner": v.get("owner").cloned().unwrap_or(Value::Null),
        "stat": v.get("stat").cloned().unwrap_or(Value::Null),
        "desc": v.get("desc").cloned().unwrap_or(json!("")),
        "pic": v.get("pic").cloned().unwrap_or(json!("")),
        "pubdate": v.get("pubdate").cloned().unwrap_or(json!(0)),
        "bvid": v.get("bvid").cloned().unwrap_or(Value::Null),
        "ugc_season": v.get("ugc_season").cloned().unwrap_or(Value::Null),
        "related": result.pointer("/data/Related").cloned().unwrap_or(json!([])),
    }))
}

// ==================== fetchBestPlayUrl（并行清晰度） ====================

fn bandwidth_of(v: &Value) -> f64 {
    v.get("bandwidth").and_then(|b| b.as_f64()).unwrap_or(0.0)
}

/// 对应 (v.codecid || v.codec_id)：codecid 为 0/缺失时回退 codec_id
fn codec_id_of(v: &Value) -> i64 {
    for key in ["codecid", "codec_id"] {
        if let Some(c) = v.get(key) {
            if let Some(n) = c.as_i64() {
                if n != 0 {
                    return n;
                }
            } else if let Some(s) = c.as_str() {
                if let Ok(n) = s.parse::<i64>() {
                    if n != 0 {
                        return n;
                    }
                }
            }
        }
    }
    0
}

fn first_str(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// 对应 fetchBestPlayUrl：并行请求 9 档清晰度，DASH 优先 AVC(7)→AV1(13)→HEVC(12)，
/// 否则 durl 合并流
pub async fn fetch_best_play_url(bvid: &str, cid: &str, cookie_string: &str) -> Value {
    let quality_levels: [(u64, &str); 9] = [
        (125, "HDR1080P60"),
        (120, "4K"),
        (116, "1080P60"),
        (112, "1080P+"),
        (80, "1080P"),
        (74, "720P60"),
        (64, "720P"),
        (32, "480P"),
        (16, "360P"),
    ];

    let mut handles = Vec::new();
    for (qn, name) in quality_levels {
        let bvid = bvid.to_string();
        let cid = cid.to_string();
        let cookie = cookie_string.to_string();
        handles.push(tokio::spawn(async move {
            let url = format!(
                "https://api.bilibili.com/x/player/playurl?bvid={}&cid={}&qn={}&fnval=16",
                bvid, cid, qn
            );
            let req = player_client()
                .get(&url)
                .header("User-Agent", UA_120)
                .header("Referer", format!("https://www.bilibili.com/video/{}", bvid));
            let req = if cookie.is_empty() {
                req
            } else {
                req.header("Cookie", &cookie)
            };
            // 对应 AbortController 8000ms
            match tokio::time::timeout(Duration::from_secs(8), req.send()).await {
                Ok(Ok(resp)) => match resp.json::<Value>().await {
                    Ok(data) if data.get("code").and_then(|c| c.as_i64()) == Some(0) => {
                        Some((qn, name.to_string(), data))
                    }
                    _ => None,
                },
                _ => None,
            }
        }));
    }

    let mut successful: Vec<(u64, String, Value)> = Vec::new();
    for h in handles {
        if let Ok(Some(v)) = h.await {
            successful.push(v);
        }
    }
    successful.sort_by(|a, b| b.0.cmp(&a.0));

    for (_qn, name, data) in &successful {
        let dash = data.pointer("/data/dash");
        if let Some(dash) = dash {
            let videos = dash
                .get("video")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if !videos.is_empty() {
                let mut sorted = videos;
                sorted.sort_by(|a, b| {
                    bandwidth_of(b)
                        .partial_cmp(&bandwidth_of(a))
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                let pick = |want: i64| {
                    sorted
                        .iter()
                        .find(|v| codec_id_of(v) == want)
                        .cloned()
                };
                let best_video = pick(7).or_else(|| pick(13)).or_else(|| pick(12));
                if let Some(best_video) = best_video {
                    if let Some(video_url) = first_str(&best_video, &["baseUrl", "url"]) {
                        let mut audio_url: Option<String> = None;
                        let audios = dash
                            .get("audio")
                            .and_then(|a| a.as_array())
                            .cloned()
                            .unwrap_or_default();
                        if !audios.is_empty() {
                            let mut sorted_audio = audios;
                            sorted_audio.sort_by(|a, b| {
                                bandwidth_of(b)
                                    .partial_cmp(&bandwidth_of(a))
                                    .unwrap_or(std::cmp::Ordering::Equal)
                            });
                            audio_url = first_str(&sorted_audio[0], &["baseUrl", "url"]);
                        }
                        let codec_label = if codec_id_of(&best_video) == 13 {
                            " AV1"
                        } else {
                            ""
                        };
                        eprintln!(
                            "✅ 并行获取 - 使用 {}{} (DASH)",
                            name, codec_label
                        );
                        return json!({
                            "success": true,
                            "url": video_url,
                            "audioUrl": audio_url,
                            "quality": format!("{} (DASH)", name),
                            "isCombined": false
                        });
                    }
                }
                // bestVideo 为空 → continue 到下一档
                continue;
            }
        }

        let durl = data
            .pointer("/data/durl")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        if !durl.is_empty() {
            eprintln!("✅ 并行获取 - 使用 {} (durl)", name);
            let backup = durl[0]
                .get("backup_url")
                .and_then(|b| b.as_array())
                .and_then(|a| a.first())
                .and_then(|u| u.as_str())
                .map(String::from);
            return json!({
                "success": true,
                "url": durl[0].get("url").cloned().unwrap_or(Value::Null),
                "quality": format!("{} (durl)", name),
                "backupUrl": backup,
                "isCombined": true
            });
        }
    }

    json!({ "success": false, "error": "所有清晰度均获取失败" })
}

/// 探测多档清晰度（download-video 使用）：返回 (qn, data) 按 qn 降序
pub async fn probe_playurl(
    bvid: &str,
    cid: &str,
    cookie_string: &str,
    levels: &[u64],
    use_durl: bool,
) -> Vec<(u64, Value)> {
    let mut handles = Vec::new();
    for &qn in levels {
        let bvid = bvid.to_string();
        let cid = cid.to_string();
        let cookie = cookie_string.to_string();
        handles.push(tokio::spawn(async move {
            let fnval = if use_durl { 1 } else { 16 };
            let extra = if use_durl { "&fnver=0&fourk=0" } else { "" };
            let url = format!(
                "https://api.bilibili.com/x/player/playurl?bvid={}&cid={}&qn={}&fnval={}{}",
                bvid, cid, qn, fnval, extra
            );
            let req = player_client()
                .get(&url)
                .header("User-Agent", UA_120)
                .header("Referer", format!("https://www.bilibili.com/video/{}", bvid));
            let req = if cookie.is_empty() {
                req
            } else {
                req.header("Cookie", &cookie)
            };
            match tokio::time::timeout(Duration::from_secs(8), req.send()).await {
                Ok(Ok(resp)) => match resp.json::<Value>().await {
                    Ok(data) if data.get("code").and_then(|c| c.as_i64()) == Some(0) => {
                        Some((qn, data))
                    }
                    _ => None,
                },
                _ => None,
            }
        }));
    }
    let mut out: Vec<(u64, Value)> = Vec::new();
    for h in handles {
        if let Ok(Some(v)) = h.await {
            out.push(v);
        }
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

// ==================== 弹幕 XML 获取 ====================

/// 对应 getDanmakuXml：reqwest gzip feature 自动解压（替代 axios + zlib.gunzip）
pub async fn get_danmaku_xml(cid: &str) -> Result<String, String> {
    let url = format!("https://api.bilibili.com/x/v1/dm/list.so?oid={}", cid);
    let resp = player_client()
        .get(&url)
        .header("User-Agent", UA_120)
        .header("Referer", "https://www.bilibili.com/")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// 对应 getCidByBvid
pub async fn get_cid_by_bvid(bvid: &str) -> Result<u64, String> {
    let url = format!(
        "https://api.bilibili.com/x/player/pagelist?bvid={}&jsonp=jsonp",
        bvid
    );
    let resp = player_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    if data.get("code").and_then(|c| c.as_i64()) == Some(0) {
        if let Some(cid) = data
            .pointer("/data/0/cid")
            .and_then(|c| c.as_u64())
        {
            return Ok(cid);
        }
    }
    Err("Failed to get cid".to_string())
}

// ==================== xml2ass（逐行移植 src/utils/xml2ass.js） ====================

const ASS_HEADER: &str = "[Script Info]
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
";

const COLOR_PALETTE: [u32; 32] = [
    0xFFFFFF, 0xFF0000, 0xFF7F00, 0xFFFF00, 0x00FF00, 0x00FFFF, 0x0000FF, 0x7F00FF, 0xFF00FF,
    0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, 0x808080, 0xFF69B4, 0x00CED1,
    0xFFD700, 0x9370DB, 0x3CB371, 0xFF4500, 0xDC143C, 0x4169E1, 0x9932CC, 0x20B2AA, 0xFF6347,
    0x32CD32, 0xFFDAB9, 0xBA55D3, 0x48D1CC, 0xFF8C00,
];

fn resolve_color(color_value: i64) -> u32 {
    if color_value < 0 || color_value as usize >= COLOR_PALETTE.len() {
        if color_value >= 0x10000 {
            return color_value as u32;
        }
        return COLOR_PALETTE[0];
    }
    COLOR_PALETTE[color_value as usize]
}

fn rgb_to_bgr(rgb: u32) -> u32 {
    let r = (rgb >> 16) & 0xFF;
    let g = (rgb >> 8) & 0xFF;
    let b = rgb & 0xFF;
    (b << 16) | (g << 8) | r
}

/// 对应 estimateTextWidth：JS charCodeAt 按 UTF-16 码元计数
fn estimate_text_width(text: &str, font_size: i64) -> f64 {
    let fs = font_size as f64;
    let mut width = 0.0;
    for u in text.encode_utf16() {
        if u > 0x7F {
            width += fs;
        } else {
            width += fs * 0.6;
        }
    }
    width
}

/// 对应 allocateTrack（type 参数在原实现中未使用，保持一致）
fn allocate_track(_dtype: i64, danmaku_index: u64, font_size: i64) -> f64 {
    let line_height = font_size as f64 + 10.0;
    let screen_height = 1080.0;
    let margin = 50.0;
    let usable_height = screen_height - margin * 2.0;
    let max_lines = (usable_height / line_height).floor().max(1.0) as u64;
    let start_y = margin;
    let line_index = danmaku_index % max_lines;
    let y_pos = start_y + line_index as f64 * line_height;
    y_pos.min(screen_height - margin)
}

/// 对应 formatTime：h:mm:ss.ss，秒部分 padStart(5,'0')
fn format_ass_time(seconds: f64) -> String {
    let h = (seconds / 3600.0).floor() as i64;
    let m = ((seconds % 3600.0) / 60.0).floor() as i64;
    let s = seconds % 60.0;
    let s_str = format!("{:.2}", s);
    let s_padded = if s_str.len() < 5 {
        format!("{}{}", "0".repeat(5 - s_str.len()), s_str)
    } else {
        s_str
    };
    format!("{:02}:{:02}:{}", h, m, s_padded)
}

/// 单遍 XML 实体解码（对应 xml2js 的实体还原，避免二次解码）
fn xml_decode(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '&' {
            let mut j = i + 1;
            let mut end = None;
            while j < chars.len() && j - i <= 12 {
                if chars[j] == ';' {
                    end = Some(j);
                    break;
                }
                j += 1;
            }
            if let Some(e) = end {
                let name: String = chars[i + 1..e].iter().collect();
                let decoded = match name.as_str() {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    _ => {
                        if let Some(num) = name.strip_prefix('#') {
                            let code = if let Some(hex) =
                                num.strip_prefix('x').or_else(|| num.strip_prefix('X'))
                            {
                                u32::from_str_radix(hex, 16).ok()
                            } else {
                                num.parse::<u32>().ok()
                            };
                            code.and_then(char::from_u32)
                        } else {
                            None
                        }
                    }
                };
                if let Some(c) = decoded {
                    out.push(c);
                    i = e + 1;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// 对应 xml2ass：解析 <d p="time,type,size,color,...">text</d> 并生成 ASS
pub fn xml2ass(xml: &str) -> String {
    let mut ass = String::from(ASS_HEADER);
    let mut scroll_index: u64 = 0;
    let mut top_index: u64 = 0;
    let mut bottom_index: u64 = 0;

    let mut pos = 0usize;
    while let Some(rel) = xml[pos..].find("<d ") {
        let tag_start = pos + rel;
        let Some(gt_rel) = xml[tag_start..].find('>') else {
            break;
        };
        let gt = tag_start + gt_rel;
        let tag = &xml[tag_start..gt];

        // 提取 p="..." 属性
        let p_attr = {
            let key = "p=\"";
            match tag.find(key) {
                Some(ps) => {
                    let vs = ps + key.len();
                    match tag[vs..].find('"') {
                        Some(ve) => tag[vs..vs + ve].to_string(),
                        None => String::new(),
                    }
                }
                None => String::new(),
            }
        };

        // 弹幕文本：标签结束到 </d>
        let rest = &xml[gt + 1..];
        let Some(text_end) = rest.find("</d>") else {
            break;
        };
        let text_raw = &rest[..text_end];
        pos = gt + 1 + text_end + 4;

        if p_attr.is_empty() {
            continue; // 对应 JS: invalid danmaku → return
        }

        let p_parts: Vec<&str> = p_attr.split(',').collect();
        let time = p_parts
            .first()
            .and_then(|s| s.trim().parse::<f64>().ok())
            .unwrap_or(0.0);
        let dtype = p_parts
            .get(1)
            .and_then(|s| s.trim().parse::<i64>().ok())
            .unwrap_or(0);
        // JS parseInt：截断小数；无效时 || 25
        let font_size = p_parts
            .get(2)
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map(|f| f as i64)
            .unwrap_or(25);
        let raw_color = p_parts
            .get(3)
            .and_then(|s| s.trim().parse::<i64>().ok())
            .unwrap_or(0);
        // 颜色：<= 0xFFFFFF 且 >= 0 视为 RGB，否则按调色板索引
        let color: u32 = if raw_color <= 0xFFFFFF && raw_color >= 0 {
            raw_color as u32
        } else {
            resolve_color(raw_color)
        };
        let text = xml_decode(text_raw);

        let mut is_scroll = dtype == 1;
        let is_top = dtype == 5;
        let is_bottom = dtype == 4;
        if !is_scroll && !is_top && !is_bottom {
            is_scroll = true;
        }

        let danmaku_index = if is_scroll {
            let i = scroll_index;
            scroll_index += 1;
            i
        } else if is_top {
            let i = top_index;
            top_index += 1;
            i
        } else {
            let i = bottom_index;
            bottom_index += 1;
            i
        };

        let scroll_duration = if is_scroll { 12.0 } else { 8.0 };
        let style = if is_top {
            "Top"
        } else if is_bottom {
            "Bottom"
        } else {
            "Scroll"
        };

        let text_width = estimate_text_width(&text, font_size);
        let y_pos = allocate_track(dtype, danmaku_index, font_size);

        let mut dialogue_text = format!("{{\\fs{}}}", font_size);
        if color != 16777215 {
            let bgr = rgb_to_bgr(color);
            dialogue_text += &format!("{{\\c&H{:08x}&}}", bgr);
        }

        // 与 JS 保持相同的替换顺序（先删 \r、\n→\N、再转义反斜杠）
        let mut escaped = text.replace('\r', "");
        escaped = escaped.replace('\n', "\\N");
        escaped = escaped.replace('\\', "\\\\");
        dialogue_text += &escaped;

        if is_scroll {
            let screen_width = 1920.0;
            let padding = 50.0;
            let start_x = screen_width + padding;
            let end_x = -text_width - padding;
            let pixels_per_second = (screen_width + text_width + padding * 2.0) / 12.0;
            let actual_duration =
                ((screen_width + text_width + padding * 2.0) / pixels_per_second).max(8.0);
            let end_time = time + actual_duration;
            ass += &format!(
                "Dialogue: 0,{},{},{},,0,0,0,,{{\\move({},{},{},{})}}{}\n",
                format_ass_time(time),
                format_ass_time(end_time),
                style,
                start_x,
                y_pos,
                end_x,
                y_pos,
                dialogue_text
            );
        } else {
            ass += &format!(
                "Dialogue: 0,{},{},{},,0,0,0,,{{\\pos(960,{})}}{}\n",
                format_ass_time(time),
                format_ass_time(time + scroll_duration),
                style,
                y_pos,
                dialogue_text
            );
        }
    }

    ass
}

// ==================== WBI 签名 POST（like / 评论） ====================

/// 对应 like-archive / post-comment / delete-comment 的公共流程：
/// WBI 签名 + 按键名字母序构建 body + 原始字符串 POST（保证与签名顺序一致）
async fn wbi_signed_post(url: &str, params: Vec<(String, String)>) -> Result<Value, String> {
    let keys = fetch_wbi_keys().await.ok_or("获取WBI密钥失败")?;
    let mix_key = get_mix_key(&keys.0, &keys.1);
    let (w_rid, wts) = sign_params(&params, &mix_key);
    let mut all = params;
    all.push(("w_rid".to_string(), w_rid));
    all.push(("wts".to_string(), wts.to_string()));
    all.sort_by(|a, b| a.0.cmp(&b.0));
    let body = all
        .iter()
        .map(|(k, v)| format!("{}={}", enc(k), enc(v)))
        .collect::<Vec<_>>()
        .join("&");

    let mut req = player_client()
        .post(url)
        .header("User-Agent", UA_120)
        .header("Referer", "https://www.bilibili.com/client")
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Origin", "https://www.bilibili.com")
        .body(body)
        .timeout(Duration::from_secs(15));
    let cookie = cookie_store::get_cookie_string();
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

fn bili_jct() -> String {
    cookie_store::get("bili_jct").unwrap_or_default()
}

// ==================== IPC 通道实现 ====================

/// play-video：MPV 播放路径；useBuiltin 或未找到 MPV 时回退内置播放器窗口
pub async fn play_video(app: &tauri::AppHandle, args: &[Value]) -> Value {
    let bvid = arg_str(args, 0, "");
    let mut cid = arg_str(args, 1, "");
    let title = arg_str(args, 2, "");
    let mpv_path = arg_str(args, 3, "");
    let show_danmaku = arg_bool(args, 4, true);
    let use_builtin = arg_bool(args, 5, false);
    let _progress = args.get(6).cloned().unwrap_or(Value::Null);
    let _episode_data = args.get(7).cloned().unwrap_or(Value::Null);

    stop_video();

    if use_builtin {
        return crate::player_window::open_builtin_player(app, args).await;
    }

    let video_title = if title.is_empty() {
        "哔哩哔哩视频".to_string()
    } else {
        title.clone()
    };

    let Some(mpv_exe) = find_mpv_executable(&mpv_path) else {
        // 未找到 MPV：回退到内置播放器（对应 Electron 版 fallback）
        return crate::player_window::open_builtin_player(app, args).await;
    };

    let mut video_info: Option<Value> = None;
    if cid.is_empty() {
        video_info = get_video_info(&bvid).await;
        if let Some(ref vi) = video_info {
            if let Some(c) = vi.get("cid").and_then(|c| c.as_i64()) {
                cid = c.to_string();
            }
        }
    }

    state::set_current_video_info(json!({
        "bvid": bvid,
        "aid": video_info.as_ref().and_then(|v| v.get("aid").cloned()).unwrap_or(Value::Null),
        "cid": if cid.is_empty() { Value::Null } else { json!(cid) },
        "duration": video_info.as_ref().and_then(|v| v.get("duration").cloned()).unwrap_or(Value::Null),
        "title": title,
        "startTime": now_millis_js(),
        "lastReportProgress": 0
    }));

    // 对应 escapedTitle：转义 " \ `
    let mut escaped_title = String::new();
    for ch in video_title.chars() {
        match ch {
            '"' | '\\' | '`' => {
                escaped_title.push('\\');
                escaped_title.push(ch);
            }
            _ => escaped_title.push(ch),
        }
    }

    // 合并 HTTP 请求头为单个 --http-header-fields（B 站 CDN 必须带 Referer）
    let mut header_fields = vec![
        "Referer: https://www.bilibili.com/".to_string(),
        "Origin: https://www.bilibili.com".to_string(),
        format!("User-Agent: {}", UA_120),
    ];
    let sessdata = cookie_store::get("SESSDATA").unwrap_or_default();
    if !sessdata.is_empty() {
        let dede = cookie_store::get("DedeUserID").unwrap_or_default();
        let jct = bili_jct();
        let cookie_str = format!(
            "SESSDATA={}; DedeUserID={}; bili_jct={}",
            sessdata, dede, jct
        )
        .replace(',', "\\,");
        header_fields.push(format!("Cookie: {}", cookie_str));
    }

    // 并行获取最佳清晰度直链和弹幕
    let cookie_string = cookie_store::get_cookie_string();
    let play_url_task = async {
        if cid.is_empty() {
            Value::Null
        } else {
            fetch_best_play_url(&bvid, &cid, &cookie_string).await
        }
    };
    let danmaku_task = async {
        if cid.is_empty() || !show_danmaku {
            return None;
        }
        match get_danmaku_xml(&cid).await {
            Ok(xml) => {
                let ass = xml2ass(&xml);
                if !ass.is_empty() {
                    let ass_path = std::env::temp_dir().join(format!("danmaku_{}.ass", cid));
                    if std::fs::write(&ass_path, ass.as_bytes()).is_ok() {
                        return Some(ass_path.to_string_lossy().to_string());
                    }
                }
                None
            }
            Err(_) => None,
        }
    };
    let (play_url_result, danmaku_ass_path) = tokio::join!(play_url_task, danmaku_task);

    let mut mpv_args: Vec<String> = vec![
        "--hwdec=auto".to_string(),
        "--volume=80".to_string(),
        "--border=no".to_string(),
        format!("--title={}", escaped_title),
        "--sub-auto=fuzzy".to_string(),
        "--sub-ass-override=yes".to_string(),
        format!("--http-header-fields={}", header_fields.join(",")),
    ];

    if play_url_result.get("success").and_then(|s| s.as_bool()) == Some(true) {
        if let Some(url) = play_url_result.get("url").and_then(|u| u.as_str()) {
            mpv_args.push(url.to_string());
        }
        if let Some(audio) = play_url_result.get("audioUrl").and_then(|u| u.as_str()) {
            if !audio.is_empty() {
                mpv_args.push(format!("--audio-file={}", audio));
            }
        }
    } else {
        mpv_args.push(format!("https://www.bilibili.com/video/{}", bvid));
    }

    if let Some(p) = &danmaku_ass_path {
        mpv_args.push(format!("--sub-file={}", p));
    }

    let mpv_dir = std::path::Path::new(&mpv_exe)
        .parent()
        .map(|p| p.to_path_buf());
    let mut command = tokio::process::Command::new(&mpv_exe);
    command.args(&mpv_args);
    if let Some(dir) = mpv_dir {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    {
        // 对应 windowsHide: true
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    match command.spawn() {
        Ok(child) => {
            *MPV_CHILD.lock().unwrap() = Some(child);

            // 监控 MPV 退出并上报最终进度（对应 'close' 事件）
            let danmaku_path_clone = danmaku_ass_path.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    enum Poll {
                        Running,
                        Gone,
                        Exited,
                    }
                    let poll = match MPV_CHILD.lock() {
                        Ok(mut g) => match g.as_mut() {
                            Some(c) => match c.try_wait() {
                                Ok(Some(_status)) => {
                                    *g = None;
                                    Poll::Exited
                                }
                                _ => Poll::Running,
                            },
                            None => Poll::Gone, // 被 stop-video 移除，不上报
                        },
                        Err(_) => Poll::Gone,
                    };
                    match poll {
                        Poll::Running => continue,
                        Poll::Gone => return,
                        Poll::Exited => {
                            if let Some(info) = state::current_video_info() {
                                let aid = info.get("aid").and_then(|v| v.as_u64()).unwrap_or(0);
                                let cid = info.get("cid").and_then(|v| v.as_u64()).unwrap_or(0);
                                if aid != 0 && cid != 0 {
                                    let last = info
                                        .get("lastReportProgress")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);
                                    let duration = info
                                        .get("duration")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(300.0);
                                    let start = info
                                        .get("startTime")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);
                                    let progress = if last > 0.0 {
                                        last
                                    } else {
                                        let elapsed = (now_millis_js() as f64 - start) / 1000.0;
                                        elapsed.min(if duration > 0.0 { duration } else { 300.0 })
                                    };
                                    report_play_history(&aid.to_string(), &cid.to_string(), progress)
                                        .await;
                                }
                            }
                            if let Some(p) = danmaku_path_clone {
                                let _ = std::fs::remove_file(p);
                            }
                            return;
                        }
                    }
                }
            });

            // 初始上报：异步补全视频信息或立即上报（进度 10 秒）
            if video_info.is_none() && !cid.is_empty() {
                let bvid2 = bvid.clone();
                let cid2 = cid.clone();
                tokio::spawn(async move {
                    if let Some(info) = get_video_info(&bvid2).await {
                        state::patch_current_video_info(json!({
                            "aid": info.get("aid").cloned().unwrap_or(Value::Null),
                            "duration": info.get("duration").cloned().unwrap_or(Value::Null),
                        }));
                        let aid = info.get("aid").and_then(|v| v.as_u64()).unwrap_or(0);
                        if aid != 0 {
                            report_play_history(&aid.to_string(), &cid2, 10.0).await;
                        }
                    }
                });
            } else if let Some(info) = state::current_video_info() {
                let aid = info.get("aid").and_then(|v| v.as_u64()).unwrap_or(0);
                let cid = info.get("cid").and_then(|v| v.as_u64()).unwrap_or(0);
                if aid != 0 && cid != 0 {
                    report_play_history(&aid.to_string(), &cid.to_string(), 10.0).await;
                }
            }

            json!({ "success": true, "hasDanmaku": danmaku_ass_path.is_some() })
        }
        Err(e) => {
            eprintln!("Failed to start MPV: {}", e);
            json!({ "success": false, "error": e.to_string() })
        }
    }
}

/// 查找 mpv 可执行文件（对应 findMpvExecutable）
fn find_mpv_executable(user_path: &str) -> Option<String> {
    let trimmed = user_path.trim();
    if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
        return Some(trimmed.to_string());
    }
    #[cfg(windows)]
    {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let candidates = [
            "C:\\Program Files\\mpv\\mpv.exe".to_string(),
            "C:\\Program Files\\mpvnet\\mpvnet.exe".to_string(),
            "C:\\Program Files (x86)\\mpv\\mpv.exe".to_string(),
            "C:\\Program Files (x86)\\mpvnet\\mpvnet.exe".to_string(),
            format!("{}\\Programs\\mpv\\mpv.exe", local),
            format!("{}\\Programs\\mpvnet\\mpvnet.exe", local),
            "mpv.exe".to_string(),
            "mpvnet.exe".to_string(),
        ];
        for p in candidates {
            if std::path::Path::new(&p).exists() {
                return Some(p);
            }
        }
    }
    None
}

/// play-video-new-window：右键新窗口播放（不关闭已有窗口）
pub async fn play_video_new_window(app: &tauri::AppHandle, args: &[Value]) -> Value {
    let bvid = arg_str(args, 0, "");
    let mpv_path = arg_str(args, 3, "");
    let use_builtin = arg_bool(args, 5, false);

    if use_builtin {
        return crate::player_window::open_builtin_player(app, args).await;
    }

    match find_mpv_executable(&mpv_path) {
        None => crate::player_window::open_builtin_player(app, args).await,
        Some(exe) => {
            let mut cmd = tokio::process::Command::new(&exe);
            cmd.arg(format!("https://www.bilibili.com/video/{}", bvid));
            #[cfg(windows)]
            {
                cmd.creation_flags(0x0800_0000);
            }
            match cmd.spawn() {
                // kill_on_drop 默认 false，drop 不会终止进程（对应 detached + unref）
                Ok(child) => {
                    drop(child);
                    json!({ "success": true })
                }
                Err(e) => json!({ "success": false, "error": e.to_string() }),
            }
        }
    }
}

pub async fn get_video_url(args: &[Value]) -> Value {
    let bvid = arg_str(args, 0, "");
    let cid = arg_str(args, 1, "");
    let cookie_string = cookie_store::get_cookie_string();
    fetch_best_play_url(&bvid, &cid, &cookie_string).await
}

/// get-video-preview-url：低清晰度预览（360P/480P html5 模式）
pub async fn get_video_preview_url(args: &[Value]) -> Value {
    let bvid = arg_str(args, 0, "");
    let mut target_cid = arg_str(args, 1, "");
    let cookie_string = cookie_store::get_cookie_string();

    if target_cid.is_empty() {
        match get_video_info(&bvid).await {
            Some(vi) => match vi.get("cid").and_then(|c| c.as_i64()) {
                Some(c) => target_cid = c.to_string(),
                None => return json!({ "success": false, "error": "无法获取视频CID" }),
            },
            None => return json!({ "success": false, "error": "无法获取视频CID" }),
        }
    }

    let preview_levels: [(u64, &str); 2] = [(16, "360P"), (32, "480P")];
    for (qn, name) in preview_levels {
        let url = format!(
            "https://api.bilibili.com/x/player/playurl?bvid={}&cid={}&qn={}&fnval=1&fnver=0&fourk=0&platform=html5",
            bvid, target_cid, qn
        );
        let req = player_client()
            .get(&url)
            .header("User-Agent", UA_120)
            .header("Referer", format!("https://www.bilibili.com/video/{}", bvid));
        let req = if cookie_string.is_empty() {
            req
        } else {
            req.header("Cookie", &cookie_string)
        };
        if let Ok(Ok(resp)) = tokio::time::timeout(Duration::from_secs(5), req.send()).await {
            if let Ok(data) = resp.json::<Value>().await {
                if data.get("code").and_then(|c| c.as_i64()) != Some(0) {
                    continue;
                }
                // 优先 durl（合并音视频）
                if let Some(u) = data.pointer("/data/durl/0/url").and_then(|u| u.as_str()) {
                    if !u.is_empty() {
                        return json!({
                            "success": true, "url": u, "quality": name, "cid": target_cid
                        });
                    }
                }
                // 兜底 DASH 视频流（预览静音播放）
                if let Some(videos) = data.pointer("/data/dash/video").and_then(|v| v.as_array()) {
                    let mut sorted: Vec<&Value> = videos.iter().collect();
                    sorted.sort_by(|a, b| {
                        bandwidth_of(b)
                            .partial_cmp(&bandwidth_of(a))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    });
                    if let Some(v0) = sorted.first() {
                        if let Some(vu) = first_str(v0, &["baseUrl", "base_url", "url"]) {
                            return json!({
                                "success": true, "url": vu,
                                "quality": format!("{} DASH", name), "cid": target_cid
                            });
                        }
                    }
                }
            }
        }
    }

    json!({ "success": false, "error": "无法获取预览视频流" })
}

/// get-video-info 通道：不带 cookie 的原始 fetch，返回 View + Related
pub async fn get_video_info_channel(args: &[Value]) -> Value {
    let bvid = arg_str(args, 0, "");
    let Some(query) = build_view_detail_query(&bvid).await else {
        return json!({ "success": false, "error": "获取WBI密钥失败" });
    };
    let url = format!(
        "https://api.bilibili.com/x/web-interface/wbi/view/detail?{}",
        query
    );
    match player_client()
        .get(&url)
        .header("User-Agent", UA_120)
        .header("Referer", format!("https://www.bilibili.com/video/{}", bvid))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => {
                if data.get("code").and_then(|c| c.as_i64()) != Some(0) {
                    let msg = data
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("获取视频信息失败");
                    return json!({ "success": false, "error": msg });
                }
                json!({
                    "success": true,
                    "data": data.pointer("/data/View").cloned().unwrap_or(Value::Null),
                    "related": data.pointer("/data/Related").cloned().unwrap_or(json!([]))
                })
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        },
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

pub async fn get_relation_stat(args: &[Value]) -> Value {
    let vmid = arg_str(args, 0, "");
    let url = format!(
        "https://api.bilibili.com/x/relation/stat?vmid={}&web_location=bilibili-electron",
        vmid
    );
    match player_client()
        .get(&url)
        .header("User-Agent", UA_120)
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => {
                if data.get("code").and_then(|c| c.as_i64()) == Some(0) {
                    json!({ "success": true, "data": data.get("data").cloned().unwrap_or(Value::Null) })
                } else {
                    let msg = data
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("获取关注信息失败");
                    json!({ "success": false, "error": msg })
                }
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        },
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

pub async fn get_related_videos(args: &[Value]) -> Value {
    let bvid = arg_str(args, 0, "");
    let url = format!(
        "https://api.bilibili.com/x/web-interface/archive/related?bvid={}",
        bvid
    );
    match player_client()
        .get(&url)
        .header("User-Agent", UA_120)
        .header("Referer", format!("https://www.bilibili.com/video/{}", bvid))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => {
                if data.get("code").and_then(|c| c.as_i64()) == Some(0) {
                    json!({ "success": true, "data": data.get("data").cloned().unwrap_or(Value::Null) })
                } else {
                    let msg = data
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("获取相关视频失败");
                    json!({ "success": false, "error": msg })
                }
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        },
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

/// get-danmaku：弹幕 XML（reqwest 自动解压 gzip）
pub async fn get_danmaku(args: &[Value]) -> Value {
    let cid = arg_str(args, 0, "");
    match get_danmaku_xml(&cid).await {
        Ok(xml) => json!({ "success": true, "data": xml }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// get-video-snapshot：进度条预览缩略图
pub async fn get_video_snapshot(args: &[Value]) -> Value {
    let bvid = arg_str(args, 0, "");
    let cid = arg_str(args, 1, "");
    let mut url = format!(
        "http://api.bilibili.com/x/player/videoshot?bvid={}&index=1",
        bvid
    );
    if !cid.is_empty() {
        url += &format!("&cid={}", cid);
    }
    match player_client()
        .get(&url)
        .header("User-Agent", UA_120)
        .header("Referer", format!("https://www.bilibili.com/video/{}", bvid))
        .timeout(Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => {
                if data.get("code").and_then(|c| c.as_i64()) == Some(0)
                    && data.get("data").map(|d| !d.is_null()).unwrap_or(false)
                {
                    let d = data.get("data").unwrap();
                    json!({
                        "success": true,
                        "data": {
                            "img_x_len": d.get("img_x_len").cloned().unwrap_or(json!(10)),
                            "img_y_len": d.get("img_y_len").cloned().unwrap_or(json!(10)),
                            "img_x_size": d.get("img_x_size").cloned().unwrap_or(json!(160)),
                            "img_y_size": d.get("img_y_size").cloned().unwrap_or(json!(90)),
                            "images": d.get("image").cloned().unwrap_or(json!([])),
                            "indexes": d.get("index").cloned().unwrap_or(json!([]))
                        }
                    })
                } else {
                    let msg = data
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("获取快照失败");
                    json!({ "success": false, "error": msg })
                }
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        },
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

/// select-mpv-path：系统文件对话框选择 MPV 可执行文件（tauri-plugin-dialog）
pub async fn select_mpv_path(app: &tauri::AppHandle, _args: &[Value]) -> Value {
    use tauri_plugin_dialog::DialogExt;
    let file = app
        .dialog()
        .file()
        .set_title("选择MPV可执行文件")
        .add_filter("可执行文件", &["exe", "com"])
        .add_filter("所有文件", &["*"])
        .blocking_pick_file();
    match file {
        Some(f) => match f.into_path() {
            Ok(path) => json!({ "success": true, "path": path.to_string_lossy() }),
            Err(_) => json!({ "success": false }),
        },
        None => json!({ "success": false }),
    }
}

pub async fn stop_video_channel(_args: &[Value]) -> Value {
    stop_video();
    Value::Null
}

pub async fn get_danmaku_xml_channel(args: &[Value]) -> Value {
    let cid = arg_str(args, 0, "");
    match get_danmaku_xml(&cid).await {
        Ok(xml) => json!({ "success": true, "data": xml }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

pub async fn get_cid_by_bvid_channel(args: &[Value]) -> Value {
    let bvid = arg_str(args, 0, "");
    match get_cid_by_bvid(&bvid).await {
        Ok(cid) => json!({ "success": true, "data": cid }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

pub async fn xml_to_ass(args: &[Value]) -> Value {
    let xml = arg_str(args, 0, "");
    json!({ "success": true, "data": xml2ass(&xml) })
}

/// fetch-danmaku-ass：cid 或 bvid → xml → ASS
pub async fn fetch_danmaku_ass(args: &[Value]) -> Value {
    let cid = arg_str(args, 0, "");
    let bvid = arg_str(args, 1, "");

    let target_cid = if cid.is_empty() && !bvid.is_empty() {
        match get_cid_by_bvid(&bvid).await {
            Ok(c) => c.to_string(),
            Err(e) => return json!({ "success": false, "error": e }),
        }
    } else {
        cid
    };

    if target_cid.is_empty() {
        return json!({ "success": false, "error": "缺少cid参数且无法从bvid获取" });
    }

    match get_danmaku_xml(&target_cid).await {
        Ok(xml) => json!({
            "success": true,
            "data": xml2ass(&xml),
            "cid": target_cid
        }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// save-ass-file：保存弹幕字幕（系统保存对话框）
pub async fn save_ass_file(app: &tauri::AppHandle, args: &[Value]) -> Value {
    use tauri_plugin_dialog::DialogExt;
    let ass_content = arg_str(args, 0, "");
    let file_name = arg_str(args, 1, "");
    let default_name = if file_name.is_empty() {
        "danmaku.ass".to_string()
    } else {
        file_name
    };
    let file = app
        .dialog()
        .file()
        .set_title("保存弹幕字幕")
        .set_file_name(&default_name)
        .add_filter("ASS字幕文件", &["ass"])
        .add_filter("所有文件", &["*"])
        .blocking_save_file();
    match file {
        Some(f) => match f.into_path() {
            Ok(path) => match std::fs::write(&path, ass_content.as_bytes()) {
                Ok(()) => json!({ "success": true, "path": path.to_string_lossy() }),
                Err(e) => json!({ "success": false, "error": e.to_string() }),
            },
            Err(_) => json!({ "success": false }),
        },
        None => json!({ "success": false }),
    }
}

/// get-comments：WBI 签名评论列表
pub async fn get_comments(args: &[Value]) -> Value {
    let oid = arg_str(args, 0, "");
    let mode = args.get(1).and_then(|v| v.as_i64()).unwrap_or(3);
    let pagination_str = arg_str(args, 2, "");
    if oid.is_empty() {
        return json!({ "success": false, "error": "缺少视频ID" });
    }
    let Some(keys) = fetch_wbi_keys().await else {
        return json!({ "success": false, "error": "获取WBI密钥失败" });
    };
    let mix_key = get_mix_key(&keys.0, &keys.1);
    let params: Vec<(String, String)> = vec![
        ("oid".to_string(), oid),
        ("type".to_string(), "1".to_string()),
        ("mode".to_string(), mode.to_string()),
        ("pagination_str".to_string(), pagination_str),
        ("plat".to_string(), "1".to_string()),
        ("seek_rpid".to_string(), String::new()),
        ("web_location".to_string(), "1315875".to_string()),
    ];
    let (w_rid, wts) = sign_params(&params, &mix_key);
    let mut all = params;
    all.push(("w_rid".to_string(), w_rid));
    all.push(("wts".to_string(), wts.to_string()));
    let query = all
        .iter()
        .map(|(k, v)| format!("{}={}", enc(k), enc(v)))
        .collect::<Vec<_>>()
        .join("&");
    let url = format!("https://api.bilibili.com/x/v2/reply/wbi/main?{}", query);

    match fetch_api(&url).await {
        Ok(data) => {
            if data.get("code").and_then(|c| c.as_i64()) != Some(0) {
                let msg = data
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("获取评论失败");
                return json!({ "success": false, "error": msg });
            }
            json!({ "success": true, "data": data.get("data").cloned().unwrap_or(Value::Null) })
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// like-archive：点赞（WBI 签名 + 字母序 body）
pub async fn like_archive(args: &[Value]) -> Value {
    let aid = arg_str(args, 0, "");
    let like = arg_str(args, 1, "");
    if aid.is_empty() {
        return json!({ "success": false, "error": "缺少视频ID" });
    }
    let params = vec![
        ("aid".to_string(), aid),
        ("like".to_string(), like),
        ("eab_x".to_string(), "2".to_string()),
        ("ramval".to_string(), "0".to_string()),
        ("referer".to_string(), String::new()),
        ("source".to_string(), "pc_client_normal".to_string()),
        ("spmid".to_string(), "main.play-detail.0.0.pv".to_string()),
        ("from_spmid".to_string(), String::new()),
        (
            "statistics".to_string(),
            "{\"appId\":112,\"platform\":4}".to_string(),
        ),
        ("ga".to_string(), "1".to_string()),
        ("csrf".to_string(), bili_jct()),
    ];
    match wbi_signed_post("https://api.bilibili.com/x/web-interface/archive/like", params).await {
        Ok(result) => {
            if result.get("code").and_then(|c| c.as_i64()) == Some(0) {
                json!({ "success": true, "data": result.get("data").cloned().unwrap_or(Value::Null) })
            } else {
                let msg = result
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("点赞失败");
                json!({ "success": false, "error": msg })
            }
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// post-comment：发表评论（回复时带 root/parent）
pub async fn post_comment(args: &[Value]) -> Value {
    let oid = arg_str(args, 0, "");
    let message = arg_str(args, 1, "");
    if oid.is_empty() {
        return json!({ "success": false, "error": "缺少视频ID" });
    }
    if message.trim().is_empty() {
        return json!({ "success": false, "error": "评论内容不能为空" });
    }

    let mut params = vec![
        ("oid".to_string(), oid),
        ("type".to_string(), "1".to_string()),
        ("message".to_string(), message.trim().to_string()),
        ("plat".to_string(), "1".to_string()),
        ("csrf".to_string(), bili_jct()),
    ];
    if arg_truthy(args, 2) {
        params.push(("root".to_string(), arg_str(args, 2, "")));
    }
    if arg_truthy(args, 3) {
        params.push(("parent".to_string(), arg_str(args, 3, "")));
    }

    match wbi_signed_post("https://api.bilibili.com/x/v2/reply/add", params).await {
        Ok(result) => {
            if result.get("code").and_then(|c| c.as_i64()) == Some(0) {
                json!({
                    "success": true,
                    "data": result.get("data").cloned().unwrap_or(Value::Null),
                    "reply": result.pointer("/data/reply").cloned().unwrap_or(Value::Null)
                })
            } else {
                let msg = result
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("评论发送失败");
                json!({ "success": false, "error": msg })
            }
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// delete-comment：删除评论
pub async fn delete_comment(args: &[Value]) -> Value {
    let oid = arg_str(args, 0, "");
    let rpid = arg_str(args, 1, "");
    if oid.is_empty() || rpid.is_empty() {
        return json!({ "success": false, "error": "缺少必要参数" });
    }
    let params = vec![
        ("oid".to_string(), oid),
        ("type".to_string(), "1".to_string()),
        ("rpid".to_string(), rpid),
        ("csrf".to_string(), bili_jct()),
    ];
    match wbi_signed_post("https://api.bilibili.com/x/v2/reply/del", params).await {
        Ok(result) => {
            if result.get("code").and_then(|c| c.as_i64()) == Some(0) {
                json!({ "success": true })
            } else {
                let msg = result
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("删除评论失败");
                json!({ "success": false, "error": msg })
            }
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}
