// Bilibili Client — Tauri 主入口
// 对应 Electron 版 main.js + window.js（窗口部分）
//
// 迁移进度：
//   Phase 1（本次）：窗口骨架、窗口控制命令、窗口状态持久化、IPC 分发入口
//   Phase 2：API 层 + 业务 IPC（ipc/mod.rs 分发填充）
//   Phase 3：播放器（第二窗口 / mpv / ffmpeg sidecar / 弹幕）
//   Phase 4：托盘、关闭最小化到托盘、自动更新
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod cookie_store;
mod dashmux;
mod ipc;
mod player_window;
mod state;
mod tray;
#[allow(dead_code)]
mod updater;
mod window_state;

use serde_json::Value;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow, WindowEvent};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

// 全局日志文件
static LOG_FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);

fn init_log_file() {
    let log_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("player_window_debug.log");
    match OpenOptions::new().create(true).write(true).truncate(true).open(&log_path) {
        Ok(file) => {
            if let Ok(mut guard) = LOG_FILE.lock() {
                *guard = Some(file);
            }
            eprintln!("[日志] 日志文件已初始化: {:?}", log_path);
        }
        Err(e) => {
            eprintln!("[日志] 无法创建日志文件: {}", e);
        }
    }
}

fn log_to_file(msg: &str) {
    if let Ok(mut guard) = LOG_FILE.lock() {
        if let Some(ref mut file) = *guard {
            let _ = writeln!(file, "{}", msg);
            let _ = file.flush();
        }
    }
}

// ==================== IPC 统一分发入口 ====================

/// 渲染层所有 ipcRenderer.invoke/send 的统一入口（通道名与 Electron 版 1:1）。
/// app/window 由 Tauri 注入：window 为发起调用的窗口。
#[tauri::command]
async fn ipc(
    app: AppHandle,
    window: WebviewWindow,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    ipc::dispatch(&app, &window, channel, args).await
}

/// 获取当前窗口所在显示器工作区（逻辑坐标）
fn work_area_logical(window: &WebviewWindow) -> (f64, f64, f64, f64) {
    if let Ok(Some(m)) = window.current_monitor() {
        let s = m.scale_factor();
        let p = m.position();
        let sz = m.size();
        return (
            p.x as f64 / s,
            p.y as f64 / s,
            sz.width as f64 / s,
            sz.height as f64 / s,
        );
    }
    (0.0, 0.0, 1920.0, 1080.0)
}

// ==================== 窗口控制逻辑 ====================
// 对应 Electron window.js 的 registerWindowHandlers（由 ipc::system 在 dispatch 中调用）

/// 对应 'zoom-main-window'：以中心为锚点按 1.1 倍缩放窗口，限制在最小/工作区范围内
pub fn zoom_window(window: &WebviewWindow, delta: f64) {
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = window.outer_size().unwrap_or_default();
    let pos = window.outer_position().unwrap_or_default();
    let cur_w = size.width as f64 / scale;
    let cur_h = size.height as f64 / scale;
    let cur_x = pos.x as f64 / scale;
    let cur_y = pos.y as f64 / scale;
    if cur_w <= 0.0 || cur_h <= 0.0 {
        return;
    }

    let (wa_x, wa_y, wa_w, wa_h) = work_area_logical(&window);

    let zoom = if delta > 0.0 { 1.1 } else { 1.0 / 1.1 };
    let min_w = 800.0;
    let min_h = 600.0;
    let max_w = (wa_w * 0.98).floor();
    let max_h = (wa_h * 0.96).floor();

    let mut new_w = (cur_w * zoom).round();
    let mut new_h = (cur_h * zoom).round();

    if new_w < min_w || new_h < min_h {
        if delta < 0.0 {
            return; // 不小于最小尺寸
        }
        new_w = min_w;
        new_h = min_h;
    }
    if new_w > max_w {
        new_w = max_w;
        new_h = (max_w * cur_h / cur_w).round();
    }
    if new_h > max_h {
        new_h = max_h;
        new_w = (max_h * cur_w / cur_h).round();
    }

    // 中心锚点
    let cx = cur_x + cur_w / 2.0;
    let cy = cur_y + cur_h / 2.0;
    let mut new_x = (cx - new_w / 2.0).round();
    let mut new_y = (cy - new_h / 2.0).round();

    // 限制在当前显示器内
    new_x = new_x.max(wa_x).min(wa_x + wa_w - new_w);
    new_y = new_y.max(wa_y).min(wa_y + wa_h - new_h);

    let _ = window.set_size(LogicalSize::new(new_w, new_h));
    let _ = window.set_position(LogicalPosition::new(new_x, new_y));
}

/// 对应 'move-main-window'：方向键每次移动 50 逻辑像素，限制在工作区内
pub fn move_window(window: &WebviewWindow, direction: &str) {
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = window.outer_size().unwrap_or_default();
    let pos = window.outer_position().unwrap_or_default();
    let w = size.width as f64 / scale;
    let h = size.height as f64 / scale;
    let mut x = pos.x as f64 / scale;
    let mut y = pos.y as f64 / scale;

    let step = 50.0;
    match direction {
        "up" => y -= step,
        "down" => y += step,
        "left" => x -= step,
        "right" => x += step,
        _ => {}
    }

    let (wa_x, wa_y, wa_w, wa_h) = work_area_logical(&window);
    x = x.max(wa_x).min(wa_x + wa_w - w);
    y = y.max(wa_y).min(wa_y + wa_h - h);

    let _ = window.set_position(LogicalPosition::new(x, y));
}

// ==================== 窗口状态持久化 ====================

/// 启动时恢复上次窗口位置/大小/最大化（对应 Electron createWindow 内逻辑）
fn restore_window_state(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(state) = window_state::load(app) else {
        return;
    };

    let monitors = app.available_monitors().unwrap_or_default();
    // 保存的是逻辑坐标，显示器工作区也换算为逻辑坐标比较
    let on_screen = state
        .bounds
        .filter(|b| {
            monitors.iter().any(|m| {
                let s = m.scale_factor();
                let wa_x = m.position().x as f64 / s;
                let wa_y = m.position().y as f64 / s;
                let wa_w = m.size().width as f64 / s;
                let wa_h = m.size().height as f64 / s;
                b.x < wa_x + wa_w
                    && b.x + b.width > wa_x
                    && b.y < wa_y + wa_h
                    && b.y + b.height > wa_y
            })
        })
        .is_some();

    if let Some(b) = state.bounds {
        if on_screen {
            let _ = window.set_position(LogicalPosition::new(b.x, b.y));
            let _ = window.set_size(LogicalSize::new(b.width, b.height));
        }
    }
    if state.is_maximized {
        let _ = window.maximize();
    }
}

/// 关闭/退出前保存窗口状态
fn save_window_state(window: &tauri::Window) {
    let app = window.app_handle();
    let is_maximized = window.is_maximized().unwrap_or(false);
    let bounds = if is_maximized {
        None
    } else {
        match (
            window.scale_factor(),
            window.outer_size(),
            window.outer_position(),
        ) {
            (Ok(scale), Ok(size), Ok(pos)) => Some(window_state::WindowBounds {
                x: pos.x as f64 / scale,
                y: pos.y as f64 / scale,
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
            }),
            _ => None,
        }
    };
    window_state::save(
        app,
        &window_state::WindowState {
            is_maximized,
            bounds,
        },
    );
}

// ==================== 应用入口 ====================

fn main() {
    init_log_file();
    log_to_file("=== 应用启动 ===");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![ipc])
        .setup(|app| {
            restore_window_state(app.handle());

            // 诊断：列出所有窗口
            let webview_windows = app.webview_windows();
            crate::log_to_file(&format!("[启动] 存在的窗口数量: {}", webview_windows.len()));
            for (label, window) in webview_windows {
                let url = window.url().map(|u| u.to_string()).unwrap_or_default();
                crate::log_to_file(&format!("[启动] 窗口: label={}, url={}", label, url));
            }

            // 主窗口 CDN 请求头注入
            if let Some(main_window) = app.get_webview_window("main") {
                player_window::attach_cdn_header_injection(&main_window);
            }

            // 加载 cookies.json（路径与 Electron 版一致，登录态无缝迁移）
            if let Some(dir) = app.path().app_data_dir().ok() {
                cookie_store::load(dir.join("cookies.json"));
            }
            // 启动时尝试从 import_cookie_string.txt / 剪贴板导入 cookie（对应 tryImportCookiesOnStartup）
            let _ = ipc::login::try_import_cookies_on_startup(app.handle());
            // 系统托盘（对应 createTray）
            if let Err(e) = tray::create_tray(app.handle()) {
                eprintln!("[托盘] 创建失败: {}", e);
            }

            // 预创建播放器窗口（隐藏，2秒后）。
            // 必须在 setup 阶段创建——从 IPC 异步上下文创建窗口时页面无法加载（about:blank）。
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                player_window::precreate_player_window(&app_handle);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 播放器窗口：关闭保存状态 / 销毁最终上报 / 全屏变化推送
            player_window::handle_player_window_event(window, event);
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "main" {
                        // 对应 Electron：未退出时隐藏到托盘
                        if !tray::is_quitting() {
                            api.prevent_close();
                            let _ = window.hide();
                            return;
                        }
                        save_window_state(window);
                    }
                }
                // Phase 4：加入 move/resize 防抖保存（当前仅关闭时保存）
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
