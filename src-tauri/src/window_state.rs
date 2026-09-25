// 窗口状态持久化：对应 Electron 版 window.js 的 save/loadMainWindowState
// 文件：<app_data_dir>/main-window-state.json（与 Electron 版路径/格式一致，升级无缝）
use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowState {
    #[serde(rename = "isMaximized")]
    pub is_maximized: bool,
    /// 逻辑坐标（DIP），非最大化时保存
    pub bounds: Option<WindowBounds>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn state_file_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("main-window-state.json"))
}

pub fn load(app: &tauri::AppHandle) -> Option<WindowState> {
    let path = state_file_path(app)?;
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn save(app: &tauri::AppHandle, state: &WindowState) {
    if let Some(path) = state_file_path(app) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = fs::write(path, json);
        }
    }
}

/// 检查 bounds 是否落在任意显示器的工作区内（逻辑坐标，对应 isBoundsOnAnyScreen）
/// 注意：调用方需先将显示器物理坐标除以 scale_factor 换算为逻辑坐标
#[allow(dead_code)]
pub fn is_bounds_on_any_screen(
    bounds: WindowBounds,
    monitors: &[tauri::Monitor],
) -> bool {
    monitors.iter().any(|m| {
        let s = m.scale_factor();
        let wa_x = m.position().x as f64 / s;
        let wa_y = m.position().y as f64 / s;
        let wa_w = m.size().width as f64 / s;
        let wa_h = m.size().height as f64 / s;
        bounds.x < wa_x + wa_w
            && bounds.x + bounds.width > wa_x
            && bounds.y < wa_y + wa_h
            && bounds.y + bounds.height > wa_y
    })
}
