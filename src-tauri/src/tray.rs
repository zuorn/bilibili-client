// 系统托盘：对应 Electron 版 main.js 的 createTray
// 行为：icon 图标 + 右键菜单（显示窗口/退出应用）+ 左键点击显示主窗口
// 关闭按钮 → 隐藏到托盘（isQuitting 为 false 时），见 main.rs CloseRequested 拦截
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// 退出应用（托盘菜单"退出应用"）：置 isQuitting → 停止 MPV → 退出
pub fn quit_app(app: &AppHandle) {
    *crate::state::STATE.is_quitting.lock().unwrap() = true;
    crate::ipc::player::stop_video();
    app.exit(0);
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../../icon.png"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Bilibili Client")
        .menu(&menu)
        // Electron 版：左键点击显示窗口，右键弹出菜单
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn is_quitting() -> bool {
    *crate::state::STATE.is_quitting.lock().unwrap()
}
