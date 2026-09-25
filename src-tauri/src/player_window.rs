// 内置播放器窗口管理：对应 Electron 版 src/main/player/builtin.js
// 职责：第二 WebviewWindow（label="player"）的创建/尺寸计算/状态恢复/关闭保存、
//       play-video-data 与 prefetch-data 事件、30 秒定时进度上报、
//       播放器窗口控制通道（minimize-player-window 等 16 个）、fullscreen-changed 推送。
// CDN 请求头注入（Referer/UA）见 handle_player_webview（with_webview，Step C）。
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use crate::cookie_store;
use crate::ipc::history::report_play_history;
use crate::ipc::player::{fetch_best_play_url, get_video_info, stop_video};
use crate::state;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

// 日志宏：同时输出到 stderr 和日志文件（带时间戳，便于对齐用户操作时序）
macro_rules! plog {
    ($($arg:tt)*) => {{
        let msg = format!($($arg)*);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let secs = now.as_secs() % 86400;
        let line = format!("[{:02}:{:02}:{:02}.{:03}] {}", secs / 3600, (secs % 3600) / 60, secs % 60, now.subsec_millis(), msg);
        eprintln!("{}", line);
        crate::log_to_file(&line);
    }};
}

// ==================== 播放器窗口运行时状态 ====================

pub struct PlayerUiState {
    pub video_aspect: f64,
    pub landscape: Option<(f64, f64)>,
    pub portrait: Option<(f64, f64)>,
    pub base: Option<(f64, f64)>,
}

impl Default for PlayerUiState {
    fn default() -> Self {
        Self {
            video_aspect: 16.0 / 9.0,
            landscape: None,
            portrait: None,
            base: None,
        }
    }
}

static UI: Lazy<Mutex<PlayerUiState>> = Lazy::new(|| Mutex::new(PlayerUiState::default()));
static LAST_FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// 播放器窗口是否处于"已关闭"状态（移到屏外保活）。
/// 关闭后页面可能仍持有键盘焦点，WASD/±= 等快捷键会继续触发窗口操控 IPC，
/// 把屏外窗口重新拉回屏幕，因此关闭期间需要拦截这些请求。
static PLAYER_HIDDEN: AtomicBool = AtomicBool::new(false);
/// 播放器页面就绪计数：页面注册完 play-video-data 等监听后通过 "player-ready" 通道上报。
/// open_builtin_player 在发送事件前等待此信号，避免页面未加载完导致事件丢失。
static PLAYER_READY_COUNT: AtomicU64 = AtomicU64::new(0);
/// 打开播放器的代际计数：连续快速点击时，只有最新一次调用的后台加载任务允许下发数据，
/// 过期任务在各检查点直接退出，避免旧视频数据覆盖新请求。
static OPEN_GEN: AtomicU64 = AtomicU64::new(0);
/// 已成功注册 CDN 请求头注入的窗口 label 集合（with_webview 异步执行，可能因
/// CoreWebView2 未就绪而静默跳过，open_builtin_player 据此重试）。
static CDN_ATTACHED_LABELS: Lazy<Mutex<std::collections::HashSet<String>>> =
    Lazy::new(|| Mutex::new(std::collections::HashSet::new()));

pub fn cdn_injection_attached(label: &str) -> bool {
    CDN_ATTACHED_LABELS.lock().unwrap().contains(label)
}

pub fn mark_player_ready() {
    PLAYER_READY_COUNT.fetch_add(1, Ordering::SeqCst);
    plog!("[播放器窗口] 收到 player-ready 信号（页面监听已注册）");
}

/// 等待播放器页面就绪（计数 >= expected），最长 timeout。返回是否在超时前就绪。
async fn wait_player_ready(expected: u64, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if PLAYER_READY_COUNT.load(Ordering::SeqCst) >= expected {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn ui() -> std::sync::MutexGuard<'static, PlayerUiState> {
    UI.lock().unwrap()
}

// ==================== 显示器工作区（逻辑坐标） ====================

fn monitor_workarea_logical(m: &tauri::Monitor) -> (f64, f64, f64, f64) {
    let s = m.scale_factor();
    let p = m.position();
    let sz = m.size();
    (
        p.x as f64 / s,
        p.y as f64 / s,
        sz.width as f64 / s,
        sz.height as f64 / s,
    )
}

fn primary_workarea(app: &AppHandle) -> (f64, f64, f64, f64) {
    if let Ok(Some(m)) = app.primary_monitor() {
        return monitor_workarea_logical(&m);
    }
    (0.0, 0.0, 1920.0, 1080.0)
}

/// 中心点所在显示器的工作区（对应 getDisplayNearestPoint）
fn nearest_workarea(app: &AppHandle, x: f64, y: f64) -> (f64, f64, f64, f64) {
    let monitors = app.available_monitors().unwrap_or_default();
    let mut best: Option<((f64, f64, f64, f64), f64)> = None;
    for m in &monitors {
        let wa = monitor_workarea_logical(m);
        let cx = wa.0 + wa.2 / 2.0;
        let cy = wa.1 + wa.3 / 2.0;
        let dist = (cx - x).hypot(cy - y);
        let contains = x >= wa.0 && x < wa.0 + wa.2 && y >= wa.1 && y < wa.1 + wa.3;
        let d = if contains { 0.0 } else { dist };
        if best.map(|(_, bd)| d < bd).unwrap_or(true) {
            best = Some((wa, d));
        }
    }
    best.map(|(wa, _)| wa).unwrap_or_else(|| primary_workarea(app))
}

/// 窗口 bounds 是否至少部分在某个显示器内（对应 isBoundsOnScreen）
fn is_bounds_on_screen(app: &AppHandle, b: &Value) -> bool {
    let (Some(bx), Some(by), Some(bw), Some(bh)) = (
        b.get("x").and_then(|v| v.as_f64()),
        b.get("y").and_then(|v| v.as_f64()),
        b.get("width").and_then(|v| v.as_f64()),
        b.get("height").and_then(|v| v.as_f64()),
    ) else {
        return false;
    };
    let monitors = app.available_monitors().unwrap_or_default();
    monitors.iter().any(|m| {
        let (wx, wy, ww, wh) = monitor_workarea_logical(m);
        bx < wx + ww && bx + bw > wx && by < wy + wh && by + bh > wy
    })
}

/// 确保窗口坐标在指定 workArea 内（对应 clampToWorkArea）
fn clamp_to_workarea(x: f64, y: f64, width: f64, height: f64, wa: (f64, f64, f64, f64)) -> (f64, f64) {
    (
        wa.0.max((wa.0 + wa.2 - width).min(x)),
        wa.1.max((wa.1 + wa.3 - height).min(y)),
    )
}

// ==================== 播放器窗口状态持久化 ====================

fn player_state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("player-window-state.json"))
}

fn save_player_window_state(window: &WebviewWindow) {
    let app = window.app_handle();
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let is_maximized = window.is_maximized().unwrap_or(false);
    let bounds = match (window.outer_size(), window.outer_position()) {
        (Ok(size), Ok(pos)) => json!({
            "x": pos.x as f64 / scale,
            "y": pos.y as f64 / scale,
            "width": size.width as f64 / scale,
            "height": size.height as f64 / scale
        }),
        _ => Value::Null,
    };
    let data = json!({
        "fullscreen": fullscreen,
        "isMaximized": is_maximized,
        "bounds": bounds
    });
    if let Some(path) = player_state_path(app) {
        if let Ok(s) = serde_json::to_string_pretty(&data) {
            let _ = std::fs::write(path, s);
        }
    }
}

fn load_player_window_state(app: &AppHandle) -> Option<Value> {
    let path = player_state_path(app)?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

// ==================== 定时进度上报（30 秒） ====================

fn start_builtin_report_timer(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.tick().await; // setInterval 语义：首次在 30s 后
        loop {
            interval.tick().await;
            if app.get_webview_window("player").is_none() {
                return; // 播放器窗口已关闭
            }
            let Some(info) = state::current_video_info() else {
                continue;
            };
            let aid = info.get("aid").and_then(|v| v.as_u64()).unwrap_or(0);
            let cid = info.get("cid").and_then(|v| v.as_u64()).unwrap_or(0);
            let last = info
                .get("lastReportProgress")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            if aid != 0 && cid != 0 && last > 0.0 {
                report_play_history(&aid.to_string(), &cid.to_string(), last).await;
            }
        }
    });
}

/// 播放器窗口关闭时的最终进度上报（对应 'closed' 事件）
async fn final_report_on_closed() {
    let Some(info) = state::current_video_info() else {
        return;
    };
    let aid = info.get("aid").and_then(|v| v.as_u64()).unwrap_or(0);
    let cid = info.get("cid").and_then(|v| v.as_u64()).unwrap_or(0);
    if aid == 0 || cid == 0 {
        return;
    }
    let final_reported = info
        .get("finalProgressReported")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if final_reported {
        return; // 渲染进程已上报
    }
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
        let elapsed = (crate::api::now_millis_js() as f64 - start) / 1000.0;
        elapsed.min(if duration > 0.0 { duration } else { 300.0 })
    };
    report_play_history(&aid.to_string(), &cid.to_string(), progress).await;
}

// ==================== 打开内置播放器 ====================

/// 对应 openBuiltinPlayer。args 与 play-video 一致：
/// (bvid, cid, title, mpvPath, showDanmaku, useBuiltin, progress, episodeData)
pub async fn open_builtin_player(app: &AppHandle, args: &[Value]) -> Value {
    plog!("[播放器窗口] open_builtin_player 被调用");
    let bvid = args
        .first()
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let final_cid = args.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let title = args.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let progress = args.get(6).cloned().unwrap_or(Value::Null);
    let episode_data = args.get(7).cloned().unwrap_or(Value::Null);
    plog!("[播放器窗口] 参数: bvid={}, cid={}, title={}", bvid, final_cid, title);

    stop_video();
    // 复用模式：不销毁重建窗口，仅停止旧播放并推送新数据

    // 重置上一个视频的运行时状态
    *UI.lock().unwrap() = PlayerUiState::default();

    // ===== 第一阶段：立即显示窗口（速度优先，不做任何网络请求）=====
    // 视频信息解析与播放数据下发全部放到第二阶段后台执行

    // 恢复上次窗口状态（位置/大小/全屏）
    let saved = load_player_window_state(app);
    let saved_bounds = saved
        .as_ref()
        .and_then(|s| s.get("bounds").cloned())
        .filter(|b| b.is_object());
    let restore_fullscreen = saved
        .as_ref()
        .and_then(|s| s.get("fullscreen").and_then(|f| f.as_bool()))
        .unwrap_or(false);

    // 初始尺寸：优先沿用上次窗口大小，否则默认 1280x720
    let mut window_width = 1280.0f64;
    let mut window_height = 720.0f64;
    if let Some(sb) = &saved_bounds {
        let sw = sb.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let sh = sb.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if sw >= 480.0 && sh >= 270.0 {
            window_width = sw;
            window_height = sh;
        }
    }

    // 所有分支均会在使用前赋值，无需初始化
    let pos_x: f64;
    let pos_y: f64;
    let wa = primary_workarea(app);
    if let Some(sb) = &saved_bounds {
        let (sx, sy, sw, sh) = (
            sb.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0),
            sb.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0),
            sb.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0),
            sb.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0),
        );
        if is_bounds_on_screen(app, sb) && !restore_fullscreen {
            // 非全屏：恢复上次位置（中心不变），按当前视频比例调整窗口
            let center_x = (sx + sw / 2.0).round();
            let center_y = (sy + sh / 2.0).round();
            let restore_x = center_x - window_width / 2.0;
            let restore_y = center_y - window_height / 2.0;
            let wa_near = nearest_workarea(app, center_x, center_y);
            let (cx, cy) = clamp_to_workarea(restore_x, restore_y, window_width, window_height, wa_near);
            pos_x = cx;
            pos_y = cy;
        } else if restore_fullscreen {
            // 全屏：先把窗口移到上次所在屏幕中央，页面加载完成后全屏
            let center_x = sx + (sw - window_width) / 2.0;
            let center_y = sy + (sh - window_height) / 2.0;
            let wa_saved = (sx, sy, sw.max(window_width), sh.max(window_height));
            let (cx, cy) = clamp_to_workarea(center_x, center_y, window_width, window_height, wa_saved);
            pos_x = cx;
            pos_y = cy;
        } else {
            let x = (wa.0 + (wa.2 - window_width) / 2.0).floor();
            let y = (wa.1 + (wa.3 - window_height) / 2.0).floor();
            pos_x = x;
            pos_y = y;
        }
    } else {
        let x = (wa.0 + (wa.2 - window_width) / 2.0).floor();
        let y = (wa.1 + (wa.3 - window_height) / 2.0).floor();
        pos_x = x;
        pos_y = y;
    }

    // 获取或动态创建播放器窗口
    let window = match ensure_player_window(app) {
        Some(win) => {
            plog!("[播放器窗口] 获取窗口成功");
            let current_url = win.url().map(|u| u.to_string()).unwrap_or_default();
            plog!("[播放器窗口] 窗口当前 URL: {}", current_url);
            let is_visible = win.is_visible().unwrap_or(false);
            plog!("[播放器窗口] 窗口当前是否可见: {}", is_visible);
            win
        }
        None => {
            plog!("[播放器窗口] 窗口创建失败");
            return json!({ "success": false, "error": "播放器窗口创建失败" });
        }
    };
    plog!("[播放器窗口] 准备显示窗口");
    if !cdn_injection_attached("player") {
        plog!("[播放器窗口] CDN 注入未就绪，重新附加");
        attach_cdn_header_injection(&window);
    }

    LAST_FULLSCREEN.store(window.is_fullscreen().unwrap_or(false), Ordering::SeqCst);
    let _ = window.set_size(LogicalSize::new(window_width, window_height));
    let _ = window.set_position(LogicalPosition::new(pos_x, pos_y));
    // 立即显示窗口（速度优先）：页面在窗口关闭时已重置为加载遮罩状态，
    // 不会闪现上一个视频的画面；新视频数据在后台继续加载
    if restore_fullscreen {
        let _ = window.set_fullscreen(true);
    }
    PLAYER_HIDDEN.store(false, Ordering::SeqCst);
    let _ = window.set_skip_taskbar(false);
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    // Windows 前台锁定（SetForegroundWindow 可能静默失败，窗口藏在主窗口后面）：
    // 多次补聚焦 + 短暂置顶，确保播放器一定出现在最前
    let focus_win = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = focus_win.set_focus();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = focus_win.set_always_on_top(true);
        let _ = focus_win.set_focus();
        tokio::time::sleep(Duration::from_millis(200)).await;
        let _ = focus_win.set_always_on_top(false);
        let _ = focus_win.set_focus();
    });
    plog!(
        "[播放器窗口] 已执行 show+set_focus（可见: {:?}，最小化: {:?}）",
        window.is_visible(),
        window.is_minimized()
    );

    // ===== 第二阶段：后台解析视频信息并下发播放数据（不阻塞窗口显示）=====
    let gen = OPEN_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app_bg = app.clone();
    let window_bg = window.clone();
    let bvid_bg = bvid.clone();
    let title_bg = title.clone();
    tauri::async_runtime::spawn(async move {
        open_builtin_player_load(
            app_bg,
            window_bg,
            bvid_bg,
            final_cid,
            title_bg,
            progress,
            episode_data,
            gen,
            pos_x,
            pos_y,
            window_width,
            window_height,
            restore_fullscreen,
        )
        .await;
    });

    json!({ "success": true, "hasDanmaku": false, "playerOpened": true })
}

/// 第二阶段：解析视频信息、预取播放地址并下发 play-video-data。
/// 全部在后台执行，窗口显示（第一阶段）不等待本函数；
/// 代际计数 gen 用于丢弃被更新播放请求 supersede 的过期任务。
/// pos/size 参数为阶段一设置的初始窗口几何，用于按视频比例调整时保持中心不变。
#[allow(clippy::too_many_arguments)]
async fn open_builtin_player_load(
    app: AppHandle,
    window: WebviewWindow,
    bvid: String,
    mut final_cid: String,
    title: String,
    progress: Value,
    episode_data: Value,
    gen: u64,
    pos_x: f64,
    pos_y: f64,
    window_width: f64,
    window_height: f64,
    restore_fullscreen: bool,
) {
    let video_title = if title.is_empty() {
        "哔哩哔哩视频".to_string()
    } else {
        title.clone()
    };

    // 获取视频信息（cid/dimension/aid/duration）。
    // 快速连点两个视频时，B 站接口可能对第二次请求限流，失败后稍候重试一次
    let first_video_info = match get_video_info(&bvid).await {
        Some(info) => info,
        None => {
            plog!("[播放器窗口] get_video_info 失败（返回 None），400ms 后重试一次");
            tokio::time::sleep(Duration::from_millis(400)).await;
            get_video_info(&bvid).await.unwrap_or(Value::Null)
        }
    };
    if OPEN_GEN.load(Ordering::SeqCst) != gen {
        return; // 已有更新的播放请求，丢弃本次
    }
    let video_aid = first_video_info.get("aid").cloned().unwrap_or(Value::Null);
    let video_duration = first_video_info.get("duration").cloned().unwrap_or(Value::Null);
    if first_video_info.is_object() && final_cid.is_empty() {
        if let Some(c) = first_video_info.get("cid").and_then(|c| c.as_i64()) {
            final_cid = c.to_string();
        }
    }
    // 按视频比例调整窗口大小（保持窗口中心不变）。
    // 全屏恢复时不调整，避免破坏全屏状态
    if let Some(dim) = first_video_info.get("dimension") {
        let dw = dim.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let dh = dim.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if dw > 0.0 && dh > 0.0 && !restore_fullscreen {
            let mut video_w = dw;
            let mut video_h = dh;
            let rotate = dim.get("rotate").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if rotate == 90.0 || rotate == 270.0 {
                std::mem::swap(&mut video_w, &mut video_h);
            }
            let video_aspect = video_w / video_h;
            ui().video_aspect = video_aspect;

            // 与当前窗口比例差异明显时才调整，避免同比例视频反复抖动
            let cur_aspect = window_width / window_height;
            if ((video_aspect - cur_aspect) / video_aspect).abs() > 0.03 {
                let wa = primary_workarea(&app);
                let default_height = (wa.3 * 0.7).floor();
                let default_width = (default_height * video_aspect).floor();
                let (mut new_w, mut new_h) = if default_width > wa.2 * 0.85 {
                    let w = (wa.2 * 0.85).floor();
                    (w, (w / video_aspect).floor())
                } else {
                    (default_width, default_height)
                };
                new_w = new_w.max(480.0);
                new_h = new_h.max(270.0);
                // 以阶段一设置的窗口中心为锚点缩放，并夹回工作区
                let center_x = pos_x + window_width / 2.0;
                let center_y = pos_y + window_height / 2.0;
                let wa_near = nearest_workarea(&app, center_x, center_y);
                let (nx, ny) = clamp_to_workarea(
                    center_x - new_w / 2.0,
                    center_y - new_h / 2.0,
                    new_w,
                    new_h,
                    wa_near,
                );
                let _ = window.set_size(LogicalSize::new(new_w, new_h));
                let _ = window.set_position(LogicalPosition::new(nx, ny));
                plog!(
                    "[播放器窗口] 按视频比例调整窗口: {}x{}（比例 {:.2}，原 {}x{}）",
                    new_w,
                    new_h,
                    video_aspect,
                    window_width,
                    window_height
                );
            }
        }
    }

    // 预取播放地址（限时 2 秒，超时则由页面自行请求）
    let (tx, mut rx) = tokio::sync::oneshot::channel::<Option<Value>>();
    {
        let bvid_pre = bvid.clone();
        let cid_pre = final_cid.clone();
        tauri::async_runtime::spawn(async move {
            if cid_pre.is_empty() {
                let _ = tx.send(None);
                return;
            }
            let cookie_string = cookie_store::get_cookie_string();
            let r = fetch_best_play_url(&bvid_pre, &cid_pre, &cookie_string).await;
            let _ = tx.send(if r.get("success").and_then(|s| s.as_bool()) == Some(true) {
                Some(r)
            } else {
                None
            });
        });
    }
    let play_url = match tokio::time::timeout(Duration::from_secs(2), &mut rx).await {
        Ok(Ok(data)) => data,
        _ => None,
    };
    let has_prefetch = play_url.is_some();

    // 上次观看进度（网络查询）：与预取并行执行，限时 1.5 秒；查不到则从 0 开始播放。
    // 注意：进度查询绝不能阻塞窗口显示（阶段一已完成），只影响起播位置。
    let progress_handle = if progress.is_null() {
        let bvid_p = bvid.clone();
        Some(tauri::async_runtime::spawn(async move {
            match tokio::time::timeout(
                Duration::from_millis(1500),
                crate::ipc::history::get_video_progress(&[json!(bvid_p)]),
            )
            .await
            {
                Ok(v) => v
                    .get("progress")
                    .and_then(|p| p.as_f64())
                    .filter(|p| *p > 0.0)
                    .map(|p| json!(p)),
                Err(_) => None,
            }
        }))
    } else {
        None
    };
    let progress = match progress_handle {
        Some(h) => match h.await {
            Ok(Some(p)) => p,
            _ => progress,
        },
        None => progress,
    };

    if OPEN_GEN.load(Ordering::SeqCst) != gen {
        return;
    }

    // 等待播放器页面就绪握手（页面注册完监听后上报 player-ready）。
    // 页面不 reload，预创建时加载一次即长期存活，因此等待计数 >= 1 即可。
    plog!("[播放器窗口] 等待页面就绪信号（player-ready，最长 15 秒）...");
    let ready = wait_player_ready(1, Duration::from_secs(15)).await;
    plog!("[播放器窗口] 页面就绪信号: {}", if ready { "已收到" } else { "超时（仍然发送事件）" });
    if OPEN_GEN.load(Ordering::SeqCst) != gen {
        return;
    }

    plog!("[播放器窗口] 发送 play-video-data 事件，bvid={}, cid={}, title={}", bvid, final_cid, video_title);
    let emit_result = app.emit_to(
        "player",
        "play-video-data",
        json!({
            "bvid": bvid.clone(),
            "cid": if final_cid.is_empty() { Value::Null } else { json!(final_cid.clone()) },
            "title": video_title.clone(),
            "cookies": cookie_store::get_all_json(),
            "progress": progress,
            "episodeData": episode_data,
            "preFetchVideoUrl": play_url,
            "preFetchVideoInfo": first_video_info
        }),
    );
    plog!("[播放器窗口] emit_to 结果: {:?}", emit_result);

    // 预加载未就绪：后台等待完成后补发 prefetch-data（对应 Electron 补发逻辑）
    if !has_prefetch {
        let app_prefetch = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(Some(pu)) = rx.await {
                let _ = app_prefetch.emit_to(
                    "player",
                    "prefetch-data",
                    json!({
                        "preFetchVideoUrl": pu
                    }),
                );
            }
        });
    }

    if OPEN_GEN.load(Ordering::SeqCst) != gen {
        return;
    }

    // 设置当前播放视频信息用于历史上报
    state::set_current_video_info(json!({
        "bvid": bvid.clone(),
        "aid": video_aid,
        "cid": if final_cid.is_empty() { Value::Null } else { json!(final_cid.clone()) },
        "duration": video_duration,
        "title": title,
        "startTime": crate::api::now_millis_js(),
        "lastReportProgress": 0
    }));

    // 初始上报一次播放历史（进度 10 秒）
    let aid = state::current_video_info()
        .and_then(|i| i.get("aid").and_then(|v| v.as_u64()))
        .unwrap_or(0);
    if aid != 0 && !final_cid.is_empty() {
        report_play_history(&aid.to_string(), &final_cid, 10.0).await;
    }

    start_builtin_report_timer(app.clone());
}

// ==================== 播放器窗口动态创建 ====================

/// 启动时预创建播放器窗口（隐藏）。
/// 必须在 setup 阶段调用（延迟 2 秒），此时 asset handler 已就绪，页面能正常加载。
/// 从 IPC 异步上下文创建窗口会导致页面停留在 about:blank。
pub fn precreate_player_window(app: &AppHandle) {
    if app.get_webview_window("player").is_some() {
        return;
    }

    plog!("[播放器窗口] 预创建窗口（隐藏）...");

    let data_dir = {
        let local_app_data = tauri::path::BaseDirectory::LocalData;
        app.path().resolve("com.example.bilibili-client/player-dyn", local_app_data).ok()
    };

    let mut builder = WebviewWindowBuilder::new(
        app,
        "player",
        WebviewUrl::App("src/pages/player.html?v=2".into()),
    )
    .title("哔哩哔哩视频")
    .inner_size(1280.0, 720.0)
    .minimizable(true)
    .maximizable(true)
    .closable(true)
    .decorations(false)
    .visible(false);

    if let Some(ref dir) = data_dir {
        builder = builder.data_directory(dir.clone());
    }

    match builder.build() {
        Ok(win) => {
            plog!("[播放器窗口] 预创建成功");
            attach_cdn_header_injection(&win);
            let _ = win.set_position(LogicalPosition::new(30000, 30000));
        }
        Err(e) => {
            plog!("[播放器窗口] 预创建失败: {}", e);
        }
    }
}

/// 创建新的播放器窗口。
/// 返回 Some(window) 表示窗口就绪，None 表示创建失败。
pub fn ensure_player_window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(win) = app.get_webview_window("player") {
        return Some(win);
    }

    plog!("[播放器窗口] 窗口不存在，创建新窗口...");

    let data_dir = {
        let local_app_data = tauri::path::BaseDirectory::LocalData;
        app.path().resolve("com.example.bilibili-client/player-dyn", local_app_data).ok()
    };

    let mut builder = WebviewWindowBuilder::new(
        app,
        "player",
        WebviewUrl::App("src/pages/player.html?v=2".into()),
    )
    .title("哔哩哔哩视频")
    .inner_size(1280.0, 720.0)
    .minimizable(true)
    .maximizable(true)
    .closable(true)
    .decorations(false)
    // 不立即显示：open_builtin_player 会在页面确认切换到新视频后统一 show，
    // 避免新窗口带着空白/旧内容闪现
    .visible(false);

    if let Some(ref dir) = data_dir {
        builder = builder.data_directory(dir.clone());
    }

    match builder.build() {
        Ok(win) => {
            plog!("[播放器窗口] 创建成功");
            attach_cdn_header_injection(&win);
            Some(win)
        }
        Err(e) => {
            plog!("[播放器窗口] 创建失败: {}", e);
            None
        }
    }
}

// ==================== 窗口事件（main.rs on_window_event 调用） ====================

pub fn handle_player_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "player" {
        return;
    }
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            plog!("[播放器窗口] CloseRequested — 移到屏外（不销毁，保持 WebView 存活）");
            api.prevent_close();
            // 先保存窗口状态（此时坐标还是用户可见位置），再移到屏外
            if let Some(ww) = window.app_handle().get_webview_window("player") {
                save_player_window_state(&ww);
                // 窗口只是移到屏外，页面音视频会继续播放：通知前端暂停
                let _ = window.app_handle().emit_to("player", "player-pause", Value::Null);
                // 同步通知前端重置界面（清画面/进度/弹幕、显示加载遮罩），
                // 这样下次点击视频立即显示窗口时不会闪现上一个视频
                let _ = window.app_handle().emit_to("player", "player-hidden", Value::Null);
                // 从任务栏移除，避免悬停任务栏时出现"已关闭"的播放器缩略图
                let _ = ww.set_skip_taskbar(true);
            }
            let _ = window.set_position(LogicalPosition::new(30000, 30000));
            PLAYER_HIDDEN.store(true, Ordering::SeqCst);
            // 把键盘焦点交还主窗口，避免残留焦点让 WASD/±= 继续作用于屏外播放器
            if let Some(main) = window.app_handle().get_webview_window("main") {
                let _ = main.set_focus();
            }
            stop_video();
            *UI.lock().unwrap() = PlayerUiState::default();
            tauri::async_runtime::spawn(async move {
                final_report_on_closed().await;
            });
        }
        tauri::WindowEvent::Destroyed => {
            plog!("[播放器窗口] Destroyed — 窗口已销毁");
            *UI.lock().unwrap() = PlayerUiState::default();
            tauri::async_runtime::spawn(async move {
                final_report_on_closed().await;
            });
        }
        tauri::WindowEvent::Resized(_) => {
            let fs = window.is_fullscreen().unwrap_or(false);
            if fs != LAST_FULLSCREEN.swap(fs, Ordering::SeqCst) {
                let _ = window
                    .app_handle()
                    .emit_to("player", "fullscreen-changed", fs);
                if let Some(ww) = window.app_handle().get_webview_window("player") {
                    save_player_window_state(&ww);
                }
            }
        }
        _ => {}
    }
}

// ==================== 播放器窗口控制通道 ====================

fn get_player_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("player")
}

fn window_bounds_logical(w: &WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let scale = w.scale_factor().ok()?;
    let size = w.outer_size().ok()?;
    let pos = w.outer_position().ok()?;
    Some((
        pos.x as f64 / scale,
        pos.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ))
}

fn set_bounds_logical(w: &WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    let _ = w.set_size(tauri::LogicalSize::new(width, height));
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
}

/// 播放器窗口所在显示器的工作区（对应 getPlayerWorkArea）
fn player_workarea(w: &WebviewWindow) -> (f64, f64, f64, f64) {
    if let Ok(Some(m)) = w.current_monitor() {
        return monitor_workarea_logical(&m);
    }
    (0.0, 0.0, 1920.0, 1080.0)
}

/// 竖屏基准尺寸派生（zoom/resize 共用）
fn derive_portrait(workarea: (f64, f64, f64, f64), new_w: f64, new_h: f64) -> (f64, f64) {
    let current_aspect = ui().video_aspect;
    let portrait_aspect = 1.0 / current_aspect;
    let reference = new_w.min(new_h);
    let mut pw = 480.0f64.max(reference);
    let mut ph = (pw / portrait_aspect).round();
    let mxw = (workarea.2 * 0.95).floor();
    let mxh = (workarea.3 * 0.95).floor();
    if pw > mxw {
        pw = mxw;
        ph = (pw / portrait_aspect).round();
    }
    if ph > mxh {
        ph = mxh;
        pw = (ph * portrait_aspect).round();
    }
    (pw, ph)
}

/// 播放器窗口控制通道（对应 builtin.js registerBuiltinPlayerHandlers）。
/// 返回 None 表示不是本模块处理的通道。
pub async fn dispatch_player_window_channel(
    app: &AppHandle,
    channel: &str,
    args: &[Value],
) -> Option<Value> {
    // download-video 独立处理（含对话框/原生 remux 合并）
    match channel {
        "download-video" => return Some(download_video(app, args).await),
        _ => {}
    }

    let pw = get_player_window(app)?;
    // 窗口"已关闭"（屏外保活）期间，拦截所有会移动/缩放/显示窗口的请求，
    // 防止页面残留焦点下的 WASD、±=、g 等快捷键把窗口重新拉回屏幕。
    if PLAYER_HIDDEN.load(Ordering::SeqCst) {
        match channel {
            "minimize-player-window" | "maximize-player-window" | "move-window-bounds"
            | "set-window-position" | "set-window-position-direct" | "set-window-position-smooth"
            | "zoom-player-window" | "toggle-fullscreen" | "resize-player-window"
            | "rotate-player-window" | "move-to-next-display" | "move-player-window" => {
                return Some(Value::Null)
            }
            _ => {}
        }
    }
    let a = args;
    let result = match channel {
        "minimize-player-window" => {
            let _ = pw.minimize();
            Value::Null
        }
        "maximize-player-window" => {
            if pw.is_maximized().unwrap_or(false) {
                let _ = pw.unmaximize();
            } else {
                let _ = pw.maximize();
            }
            Value::Null
        }
        "open-player-dev-tools" => {
            // devtools 仅 debug 构建可用（release 未启用 devtools feature）
            #[cfg(debug_assertions)]
            pw.open_devtools();
            let _ = &pw;
            Value::Null
        }
        "get-window-position" => {
            let scale = pw.scale_factor().unwrap_or(1.0);
            match pw.outer_position() {
                Ok(pos) => json!({ "x": pos.x as f64 / scale, "y": pos.y as f64 / scale }),
                Err(_) => json!({ "x": 0, "y": 0 }),
            }
        }
        "get-window-bounds" => match window_bounds_logical(&pw) {
            Some((x, y, width, height)) => json!({ "x": x, "y": y, "width": width, "height": height }),
            None => Value::Null,
        },
        "move-window-bounds" => {
            let x = a.first().and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0);
            // 拖拽移动只改位置、不改尺寸：尺寸本就不变，反复 set_size 会触发
            // WebView 重排，竖屏视频（object-fit:contain）在重排瞬间会闪现黑边
            let _ = pw.set_position(tauri::LogicalPosition::new(x.round(), y.round()));
            Value::Null
        }
        "set-window-position" | "set-window-position-direct" | "set-window-position-smooth" => {
            let x = a.first().and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let _ = pw.set_position(tauri::LogicalPosition::new(x.round(), y.round()));
            Value::Null
        }
        "is-window-maximized" => json!(pw.is_maximized().unwrap_or(false)),
        "zoom-player-window" => {
            let delta = a.first().and_then(|v| v.as_f64()).unwrap_or(0.0);
            if pw.is_fullscreen().unwrap_or(false) {
                if delta < 0.0 {
                    let _ = pw.set_fullscreen(false);
                }
                Value::Null
            } else {
                let Some((cx0, cy0, cur_w, cur_h)) = window_bounds_logical(&pw) else {
                    return Some(Value::Null);
                };
                let workarea = player_workarea(&pw);
                let aspect = ui().video_aspect;
                let min_w = 320.0;
                let min_h = (min_w / aspect).round();
                let max_w = (workarea.2 * 0.98).floor();
                let max_h = (workarea.3 * 0.96).floor();

                // 已经接近最大 → 放大进入全屏
                let is_near_max = cur_w >= max_w - 10.0 && cur_h >= max_h - 10.0;
                if delta > 0.0 && is_near_max {
                    let _ = pw.set_fullscreen(true);
                    return Some(Value::Null);
                }

                let scale = if delta > 0.0 { 1.1 } else { 1.0 / 1.1 };
                let mut new_w = (cur_w * scale).round();
                let mut new_h = (new_w / aspect).round();
                if new_w < min_w || new_h < min_h {
                    if delta < 0.0 {
                        return Some(Value::Null);
                    }
                    new_w = min_w;
                    new_h = min_h;
                }
                if new_w > max_w {
                    new_w = max_w;
                    new_h = (max_w / aspect).round();
                }
                if new_h > max_h {
                    new_h = max_h;
                    new_w = (max_h * aspect).round();
                }
                let cx = cx0 + cur_w / 2.0;
                let cy = cy0 + cur_h / 2.0;
                let (nx, ny) = clamp_to_workarea(
                    (cx - new_w / 2.0).round(),
                    (cy - new_h / 2.0).round(),
                    new_w,
                    new_h,
                    workarea,
                );
                set_bounds_logical(&pw, nx, ny, new_w, new_h);
                ui().landscape = Some((new_w, new_h));
                let (pw2, ph2) = derive_portrait(workarea, new_w, new_h);
                ui().portrait = Some((pw2, ph2));
                Value::Null
            }
        }
        "toggle-fullscreen" => {
            let fs = pw.is_fullscreen().unwrap_or(false);
            let _ = pw.set_fullscreen(!fs);
            Value::Null
        }
        "resize-player-window" => {
            let width = a.first().and_then(|v| v.as_f64()).unwrap_or(0.0);
            let height = a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0);
            if width <= 0.0 || height <= 0.0 {
                return Some(json!({ "success": false }));
            }
            let workarea = player_workarea(&pw);
            let max_window_width = (workarea.2 * 0.9).floor();
            let max_window_height = (workarea.3 * 0.9).floor();
            let min_window_width = 480.0;
            let aspect_now = ui().video_aspect;
            let min_window_height = 270.0f64.max((min_window_width / aspect_now).round());

            let video_aspect = width / height;
            let mut new_w = width.round();
            let mut new_h = height.round();
            if new_w > max_window_width {
                new_w = max_window_width;
                new_h = (max_window_width / video_aspect).round();
            }
            if new_h > max_window_height {
                new_h = max_window_height;
                new_w = (max_window_height * video_aspect).round();
            }
            new_w = new_w.max(min_window_width);
            new_h = new_h.max(min_window_height);

            if let Some((bx, by, bw, bh)) = window_bounds_logical(&pw) {
                let width_delta = new_w - bw;
                let height_delta = new_h - bh;
                let (cx, cy) = clamp_to_workarea(
                    bx - width_delta / 2.0,
                    by - height_delta / 2.0,
                    new_w,
                    new_h,
                    workarea,
                );
                set_bounds_logical(&pw, cx, cy, new_w, new_h);
            }
            ui().base = Some((new_w, new_h));
            ui().landscape = Some((new_w, new_h));
            let (pw2, ph2) = derive_portrait(workarea, new_w, new_h);
            ui().portrait = Some((pw2, ph2));
            json!({ "success": true, "width": new_w, "height": new_h })
        }
        "rotate-player-window" => {
            if pw.is_fullscreen().unwrap_or(false) {
                return Some(json!({ "success": false, "reason": "no-window-or-fullscreen" }));
            }
            let workarea = player_workarea(&pw);
            let rotation = a.first().and_then(|v| v.as_f64()).unwrap_or(0.0);
            let rot = ((rotation as i64 % 360) + 360) % 360;
            let is_portrait = rot == 90 || rot == 270;
            let video_w = a
                .get(1)
                .and_then(|v| v.as_f64())
                .filter(|v| *v != 0.0)
                .unwrap_or(16.0);
            let video_h = a
                .get(2)
                .and_then(|v| v.as_f64())
                .filter(|v| *v != 0.0)
                .unwrap_or(9.0);

            let mut st = ui();
            if st.landscape.is_none() {
                if let Some((bx, by, bw, bh)) = window_bounds_logical(&pw) {
                    let _ = (bx, by);
                    st.landscape = Some((bw, bh));
                    let vh_over_vw = video_h / video_w;
                    let reference = bw.min(bh);
                    let mut pw3 = 480.0f64.max(reference);
                    let mut ph3 = (pw3 / vh_over_vw).round();
                    let max_w = (workarea.2 * 0.95).floor();
                    let max_h = (workarea.3 * 0.95).floor();
                    if pw3 > max_w {
                        pw3 = max_w;
                        ph3 = (pw3 / vh_over_vw).round();
                    }
                    if ph3 > max_h {
                        ph3 = max_h;
                        pw3 = (ph3 * vh_over_vw).round();
                    }
                    st.portrait = Some((pw3, ph3));
                }
            }
            let Some((bx, by, bw, bh)) = window_bounds_logical(&pw) else {
                return Some(json!({ "success": false, "reason": "no-window-or-fullscreen" }));
            };
            let _ = (bx, by);
            let target = if is_portrait {
                st.portrait.or(st.landscape)
            } else {
                st.landscape
            };
            let Some((new_w, new_h)) = target else {
                return Some(json!({ "success": false, "reason": "no-window-or-fullscreen" }));
            };
            let new_aspect = new_w / new_h;
            let cx = bx + bw / 2.0;
            let cy = by + bh / 2.0;
            let (nx, ny) = clamp_to_workarea(
                (cx - new_w / 2.0).round(),
                (cy - new_h / 2.0).round(),
                new_w,
                new_h,
                workarea,
            );
            st.video_aspect = new_aspect;
            drop(st);
            set_bounds_logical(&pw, nx, ny, new_w, new_h);
            json!({
                "success": true, "aspect": new_aspect,
                "width": new_w, "height": new_h, "isPortrait": is_portrait
            })
        }
        "move-to-next-display" => {
            let monitors = app.available_monitors().unwrap_or_default();
            if monitors.len() <= 1 {
                return Some(json!(false));
            }
            let Some((bx, by, bw, bh)) = window_bounds_logical(&pw) else {
                return Some(json!(false));
            };
            // 当前显示器：中心点所在
            let cx = bx + bw / 2.0;
            let cy = by + bh / 2.0;
            let mut current_idx = 0usize;
            for (i, m) in monitors.iter().enumerate() {
                let (wx, wy, ww, wh) = monitor_workarea_logical(m);
                if cx >= wx && cx < wx + ww && cy >= wy && cy < wy + wh {
                    current_idx = i;
                    break;
                }
            }
            let next_idx = (current_idx + 1) % monitors.len();
            let (nwx, nwy, nww, nwh) = monitor_workarea_logical(&monitors[next_idx]);
            let new_x = (nwx + (nww - bw) / 2.0).round();
            let new_y = (nwy + (nwh - bh) / 2.0).round();
            set_bounds_logical(&pw, new_x, new_y, bw, bh);
            json!(true)
        }
        "move-player-window" => {
            if pw.is_fullscreen().unwrap_or(false) {
                return Some(Value::Null);
            }
            let Some((bx, by, bw, bh)) = window_bounds_logical(&pw) else {
                return Some(Value::Null);
            };
            // 纯移动：只改位置、绝不重写尺寸。读取 outer_size 再 set_size
            // 会在非整数 DPI 缩放下反复取整，导致窗口每按一次键就变大一点。
            let direction = a.first().and_then(|v| v.as_str()).unwrap_or("");
            let step = 50.0;
            let (mut new_x, mut new_y) = (bx, by);
            match direction {
                "up" => new_y -= step,
                "down" => new_y += step,
                "left" => new_x -= step,
                "right" => new_x += step,
                _ => {}
            }
            let workarea = player_workarea(&pw);
            let (cx, cy) = clamp_to_workarea(new_x, new_y, bw, bh, workarea);
            let _ = pw.set_position(tauri::LogicalPosition::new(cx, cy));
            Value::Null
        }
        _ => return None,
    };
    Some(result)
}

// ==================== download-video（对应 builtin.js download-video 通道） ====================

const QN_NAMES: &[(u64, &str)] = &[
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

fn qn_name(qn: u64) -> String {
    QN_NAMES
        .iter()
        .find(|(q, _)| *q == qn)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| format!("qn={}", qn))
}

fn find_ffmpeg() -> Option<std::path::PathBuf> {
    // 1. 开发环境：node_modules/ffmpeg-static（仅 debug 构建使用）
    #[cfg(debug_assertions)]
    {
        let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|root| {
                root.join("node_modules")
                    .join("ffmpeg-static")
                    .join("ffmpeg.exe")
            });
        if let Some(p) = dev {
            if p.exists() {
                return Some(p);
            }
        }
    }
    // 2. PATH（release 下原生 remux 已覆盖绝大多数场景，此处仅作最后回退）
    if which_ffmpeg_on_path() {
        return Some(std::path::PathBuf::from("ffmpeg"));
    }
    None
}

#[cfg(windows)]
fn which_ffmpeg_on_path() -> bool {
    std::env::var("PATH")
        .map(|paths| {
            paths
                .split(';')
                .filter(|d| !d.is_empty())
                .any(|d| std::path::Path::new(d).join("ffmpeg.exe").exists())
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn which_ffmpeg_on_path() -> bool {
    false
}

/// 从 playurl 响应提取视频/音频 URL（对应 extractUrls）
fn extract_download_urls(data: &Value) -> Option<(String, Option<String>, bool)> {
    if let Some(v0) = data
        .pointer("/data/dash/video")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
    {
        let video_url = ["baseUrl", "url", "base_url"]
            .iter()
            .find_map(|k| v0.get(*k).and_then(|u| u.as_str()))
            .unwrap_or("")
            .to_string();
        let mut audio_url: Option<String> = None;
        if let Some(a0) = data
            .pointer("/data/dash/audio")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
        {
            audio_url = ["baseUrl", "url", "base_url"]
                .iter()
                .find_map(|k| a0.get(*k).and_then(|u| u.as_str()))
                .map(String::from);
        }
        if !video_url.is_empty() {
            return Some((video_url, audio_url, true));
        }
        return None;
    }
    if let Some(d0) = data
        .pointer("/data/durl")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
    {
        if let Some(u) = d0.get("url").and_then(|u| u.as_str()) {
            if !u.is_empty() {
                return Some((u.to_string(), None, false));
            }
        }
    }
    None
}

async fn download_file(
    url: &str,
    path: &std::path::Path,
    step: &str,
    send_progress: &(dyn Fn(&str, Option<f64>) + Send + Sync),
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let resp = player_client_get(url)
        .send()
        .await
        .map_err(|e| format!("CDN 请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("CDN 返回 {}", resp.status().as_u16()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;
    let mut resp = resp;
    let mut downloaded: u64 = 0;
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("写入文件失败: {}", e))?;
                downloaded += chunk.len() as u64;
                if total > 0 {
                    send_progress(step, Some(downloaded as f64 / total as f64 * 100.0));
                }
            }
            Ok(None) => break,
            Err(e) => return Err(format!("下载中断: {}", e)),
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

fn player_client_get(url: &str) -> reqwest::RequestBuilder {
    crate::ipc::player::shared_client()
        .get(url)
        .header("User-Agent", crate::api::UA_120)
        .header("Referer", "https://www.bilibili.com/")
        .header("Origin", "https://www.bilibili.com")
}

/// DASH 音视频合并：优先原生 remux（mp4 crate，无外部依赖），失败回退 ffmpeg on PATH
async fn merge_dash(
    video_temp: &std::path::Path,
    audio_temp: &std::path::Path,
    save_path: &std::path::Path,
) -> Result<(), String> {
    let (v, a, o) = (
        video_temp.to_path_buf(),
        audio_temp.to_path_buf(),
        save_path.to_path_buf(),
    );
    let native = tokio::task::spawn_blocking(move || crate::dashmux::remux_dash_to_mp4(&v, &a, &o))
        .await
        .map_err(|e| format!("remux 任务异常: {}", e))?;
    if native.is_ok() {
        return Ok(());
    }
    eprintln!("[下载] 原生 remux 失败，尝试回退 ffmpeg: {}", native.as_ref().unwrap_err());
    let Some(ffmpeg) = find_ffmpeg() else {
        return native;
    };
    let out = tokio::process::Command::new(&ffmpeg)
        .args([
            "-y",
            "-i",
        ])
        .arg(video_temp)
        .args(["-i"])
        .arg(audio_temp)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(save_path)
        .output()
        .await
        .map_err(|e| format!("ffmpeg 启动失败: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "ffmpeg exit {:?}: {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).chars().take(200).collect::<String>()
        ));
    }
    Ok(())
}

async fn download_video(app: &AppHandle, args: &[Value]) -> Value {
    use tauri_plugin_dialog::DialogExt;

    let bvid = args
        .first()
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let cid = args.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let title = args.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let app = app.clone();
    let app_for_progress = app.clone();
    let send_progress = move |step: &str, percent: Option<f64>| {
        let payload = match percent {
            Some(p) => json!({ "step": step, "percent": p }),
            None => json!({ "step": step }),
        };
        let _ = app_for_progress.emit_to("player", "download-progress", payload);
    };

    let cookie_string = cookie_store::get_cookie_string();

    // 1. 并行探测所有清晰度，找到最高可用者
    send_progress("正在获取最高画质下载地址...", None);
    let all_qualities: [u64; 8] = [125, 120, 116, 112, 80, 74, 64, 32];
    let results =
        crate::ipc::player::probe_playurl(&bvid, &cid, &cookie_string, &all_qualities, false).await;
    if results.is_empty() {
        return json!({ "success": false, "error": "无法获取视频下载地址，请确认已登录" });
    }
    let best_qn = results[0].0;
    let has_dash = results[0]
        .1
        .pointer("/data/dash/video")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    let quality_title = format!(
        "{} {}",
        qn_name(best_qn),
        if has_dash { "(DASH)" } else { "(durl)" }
    );
    eprintln!("[下载] 最高可用画质: {}", quality_title);

    // 2. 显示保存对话框
    let safe_title: String = title
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .take(100)
        .collect();
    let default_name = format!(
        "{}.mp4",
        if safe_title.is_empty() {
            "bilibili_video".to_string()
        } else {
            safe_title
        }
    );
    let save_file = app
        .dialog()
        .file()
        .set_title(format!("下载视频 — {}", quality_title))
        .set_file_name(&default_name)
        .add_filter("MP4 视频", &["mp4"])
        .add_filter("所有文件", &["*"])
        .blocking_save_file();
    let Some(save_file) = save_file else {
        return json!({ "success": false, "cancelled": true });
    };
    let save_path: std::path::PathBuf = match save_file.into_path() {
        Ok(p) => p,
        Err(_) => return json!({ "success": false, "error": "保存路径无效" }),
    };

    // 3. 用户确认后重新获取最新 URL（避免 CDN 链接过期）
    send_progress("正在获取最新下载链接...", None);
    let fresh = crate::ipc::player::probe_playurl(&bvid, &cid, &cookie_string, &[best_qn], false).await;
    let Some((video_url, audio_url, is_dash)) = fresh.first().and_then(|(_, d)| extract_download_urls(d))
    else {
        return json!({ "success": false, "error": "获取下载链接失败，请重试" });
    };
    let _ = is_dash;

    let temp_dir = std::env::temp_dir();
    let now = crate::api::now_millis_js();

    // 4. 下载：DASH（原生 remux 合并音视频）或 durl（已合并）
    if let Some(audio_url) = &audio_url {
        // DASH 合并模式
        let video_temp = temp_dir.join(format!("bili_video_{}.m4s", now));
        let audio_temp = temp_dir.join(format!("bili_audio_{}.m4s", now));
        send_progress("video", Some(0.0));
        let dl_video = download_file(&video_url, &video_temp, "video", &send_progress).await;
        let dl_audio = match dl_video {
            Ok(()) => {
                send_progress("audio", Some(0.0));
                download_file(audio_url, &audio_temp, "audio", &send_progress).await
            }
            Err(e) => Err(e),
        };
        if let Ok(()) = dl_audio {
            send_progress("merge", None);
            match merge_dash(&video_temp, &audio_temp, &save_path).await {
                Ok(()) => {
                    let _ = tokio::fs::remove_file(&video_temp).await;
                    let _ = tokio::fs::remove_file(&audio_temp).await;
                    let file_name = save_path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    return json!({ "success": true, "fileName": file_name, "quality": quality_title });
                }
                Err(merge_err) => {
                    eprintln!("[下载] 音视频合并失败（无可用方式），回退到 durl 合并流: {}", merge_err);
                    let _ = tokio::fs::remove_file(&save_path).await;
                    // 回退：durl 合并流 720P → 480P → 360P
                    for dqn in [64u64, 32, 16] {
                        send_progress(&format!("正在获取合并流 {}...", qn_name(dqn)), None);
                        let durl_results = crate::ipc::player::probe_playurl(
                            &bvid, &cid, &cookie_string, &[dqn], true,
                        )
                        .await;
                        if let Some((durl_url, None, false)) =
                            durl_results.first().and_then(|(_, d)| extract_download_urls(d))
                        {
                            send_progress("video", Some(0.0));
                            if download_file(&durl_url, &save_path, "video", &send_progress)
                                .await
                                .is_ok()
                            {
                                let durl_label = format!("{} (durl)", qn_name(dqn));
                                let file_name = save_path
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                return json!({
                                    "success": true, "fileName": file_name, "quality": durl_label
                                });
                            }
                        }
                    }
                    // durl 也失败：保存纯视频
                    eprintln!("[下载] durl 也失败，保存纯视频");
                    send_progress("video", Some(0.0));
                    if let Err(e) = download_file(&video_url, &save_path, "video", &send_progress).await {
                        return json!({ "success": false, "error": e });
                    }
                    let file_name = save_path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    return json!({
                        "success": true, "fileName": file_name,
                        "quality": format!("{} (无音频)", quality_title)
                    });
                }
            }
        } else if let Err(e) = dl_audio {
            let _ = tokio::fs::remove_file(&video_temp).await;
            let _ = tokio::fs::remove_file(&audio_temp).await;
            return json!({ "success": false, "error": e });
        } else {
            let _ = tokio::fs::remove_file(&video_temp).await;
            let _ = tokio::fs::remove_file(&audio_temp).await;
            return json!({ "success": false, "error": "视频下载失败" });
        }
    } else {
        // 非 DASH 或无独立音频：直接下载
        send_progress("video", Some(0.0));
        match download_file(&video_url, &save_path, "video", &send_progress).await {
            Ok(()) => {
                let file_name = save_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                json!({ "success": true, "fileName": file_name, "quality": quality_title })
            }
            Err(e) => json!({ "success": false, "error": e }),
        }
    }
}

// ==================== CDN 请求头注入（Windows WebView2 COM） ====================

/// 对应 Electron 版 session.webRequest.onBeforeSendHeaders：
/// 对 bilivideo / bilibili / hdslb / mountaintoys 域名强制注入
/// User-Agent / Referer（B 站 CDN 缺 Referer 返回 403）。
/// 注意：不能注入 Origin——CDN 会把请求的 Origin 原样作为
/// Access-Control-Allow-Origin 回显，改写后 WebView2 用内部真实 Origin
/// 做 CORS 校验会不匹配，导致媒体请求失败（media error 4）。
#[cfg(windows)]
pub fn attach_cdn_header_injection(window: &WebviewWindow) {
    use webview2_com::{
        take_pwstr,
        Microsoft::Web::WebView2::Win32::*,
        WebResourceRequestedEventHandler,
    };
    use windows::core::{w, HSTRING, PWSTR};

    const CDN_MATCH: &[&str] = &[
        "bilivideo.com",
        "bilivideo.cn",
        "bilibili.com",
        "mountaintoys.cn",
        "hdslb.com",
    ];

    let label = window.label().to_string();
    let result = window.with_webview(move |webview| unsafe {
        let controller = webview.controller();
        let Ok(core) = controller.CoreWebView2() else {
            plog!("[CDN注入] {} CoreWebView2 未就绪，注入跳过", label);
            return;
        };
        // 过滤器：仅注册 CDN 域名模式。glob 按整串匹配、不会隐式匹配端口，
        // 所以每个域要同时注册「默认端口」与「任意端口」两种模式
        //（mcdn 边缘节点走 *:4483 等非标端口，漏掉会 403 → media error 4）。
        // 注意：不能用 "*" + REQUEST_SOURCE_KINDS_ALL 拦截全部请求——
        // 那会把主文档导航也压进 UI 线程的 WebResourceRequested 同步 handler，
        // 造成页面永远无法完成加载（on_page_load Finished 不触发）的死锁。
        for domain in CDN_MATCH {
            for scheme in ["https", "http"] {
                for filter in [
                    format!("{}://*.{}/*", scheme, domain),
                    format!("{}://*.{}:*/*", scheme, domain),
                ] {
                    let filter = HSTRING::from(filter);
                    let r = core.AddWebResourceRequestedFilter(
                        &filter,
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    );
                    if let Err(e) = r {
                        plog!("[CDN注入] 添加过滤器失败: {:?}", e);
                    }
                }
            }
        }
        let mut token = i64::default();
        let log_budget = std::sync::atomic::AtomicU8::new(0);
        let label_inner = label.clone();
        let r = core.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let request = args.Request()?;
                let mut uri_ptr = PWSTR::null();
                request.Uri(&mut uri_ptr)?;
                let uri = take_pwstr(uri_ptr);
                if CDN_MATCH.iter().any(|d| uri.contains(d)) {
                    let headers = request.Headers()?;
                    let _ = headers.SetHeader(w!("User-Agent"), &HSTRING::from(crate::api::UA_120));
                    let _ = headers.SetHeader(w!("Referer"), w!("https://www.bilibili.com/"));
                    if log_budget.load(Ordering::SeqCst) < 3 {
                        log_budget.fetch_add(1, Ordering::SeqCst);
                        plog!(
                            "[CDN注入] 已改写请求头: {}",
                            uri.chars().take(80).collect::<String>()
                        );
                    }
                }
                Ok(())
            })),
            &mut token,
        );
        match r {
            Ok(_) => {
                CDN_ATTACHED_LABELS.lock().unwrap().insert(label_inner.clone());
                plog!("[CDN注入] {} 注册成功", label_inner);
            }
            Err(e) => plog!("[CDN注入] {} 注册失败: {:?}", label_inner, e),
        }
    });
    if let Err(e) = result {
        plog!("[播放器窗口] CDN 请求头注入失败: {}", e);
    }
}

#[cfg(not(windows))]
pub fn attach_cdn_header_injection(_window: &WebviewWindow) {}
