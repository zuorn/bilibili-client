// system 模块：窗口控制 / 应用版本 / 页面导航
// 对应 Electron 版 src/main/window.js + src/main/page-nav.js + main.js 的 get-app-version
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::state;

/// 页面导航：对应 Electron loadFile（dev 与生产均为根相对路径）
fn navigate(window: &WebviewWindow, path: &str) {
    let _ = window.eval(&format!("window.location.href = '{}'", path));
}

/// 主窗口控制 / 导航类通道。返回 None 表示不是本模块处理的通道。
pub async fn dispatch_system_channel(
    app: &AppHandle,
    window: &WebviewWindow,
    channel: &str,
    args: &[Value],
) -> Option<Value> {
    match channel {
        // ---- 应用版本 ----
        "get-app-version" => Some(json!(app.package_info().version.to_string())),

        // ---- 窗口控制（对应 window.js，作用于调用方窗口）----
        "minimize-window" => {
            let _ = window.minimize();
            Some(json!({ "success": true }))
        }
        "maximize-window" => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
            Some(json!({ "success": true }))
        }
        // Phase 4 接入托盘后改为：isQuitting 为 false 时 hide() 到托盘
        "close-window" => {
            let _ = window.close();
            Some(json!({ "success": true }))
        }
        "open-dev-tools" => {
            // devtools 仅 debug 构建可用（release 未启用 devtools feature）
            #[cfg(debug_assertions)]
            window.open_devtools();
            let _ = &window;
            Some(json!({ "success": true }))
        }
        "reload-window" => {
            let _ = window.eval("window.location.reload()");
            Some(json!({ "success": true }))
        }
        "zoom-main-window" => {
            let delta = args
                .first()
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            crate::zoom_window(window, delta);
            Some(json!({ "success": true }))
        }
        "move-main-window" => {
            let direction = args
                .first()
                .and_then(|v| v.as_str())
                .unwrap_or("");
            crate::move_window(window, direction);
            Some(json!({ "success": true }))
        }

        // ---- 页面导航（对应 page-nav.js）----
        "go-home" => {
            navigate(window, "/index.html");
            Some(Value::Null)
        }
        "open-dynamic" => {
            navigate(window, "/src/pages/dynamic.html");
            Some(Value::Null)
        }
        "open-my" => {
            navigate(window, "/src/pages/my.html");
            Some(Value::Null)
        }
        "open-popular" => {
            navigate(window, "/src/pages/popular.html");
            Some(Value::Null)
        }
        "open-anime" => {
            navigate(window, "/src/pages/anime.html");
            Some(Value::Null)
        }
        "open-media" => {
            navigate(window, "/src/pages/media.html");
            Some(Value::Null)
        }
        "open-up-profile" | "navigate-up" => {
            // 主窗口发 navigate-to-up 事件并前置显示
            let mid = args.first().cloned().unwrap_or(Value::Null);
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.emit_to("main", "navigate-to-up", mid);
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
            Some(json!({ "success": true }))
        }
        "navigate-dynamic" => {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.emit_to("main", "navigate-to-page", json!("dynamic"));
            }
            Some(json!({ "success": true }))
        }
        "navigate-my" => {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.emit_to("main", "navigate-to-page", json!("my"));
            }
            Some(json!({ "success": true }))
        }

        // ---- 播放进度（history.js 的 ipcMain.on，播放器关闭前同步进度）----
        "beforeunload-progress" => {
            if let Some(progress) = args.first() {
                state::patch_current_video_info(json!({ "lastReportProgress": progress.clone() }));
            }
            Some(Value::Null)
        }

        _ => None,
    }
}
