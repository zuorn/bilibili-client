// 共享应用状态：对应 Electron 版 main.js 的 sharedState
// currentVideoInfo 用 JSON 对象存储（字段与 Electron 版一致，便于各模块按需读写）
use once_cell::sync::Lazy;
use serde_json::Value;
use std::sync::Mutex;

pub struct SharedState {
    /// 当前播放视频信息（aid/cid/bvid/title/lastReportProgress/finalProgressReported 等）
    pub current_video_info: Mutex<Option<Value>>,
    /// 是否正在退出（托盘逻辑，Phase 4 使用）
    pub is_quitting: Mutex<bool>,
}

pub static STATE: Lazy<SharedState> = Lazy::new(|| SharedState {
    current_video_info: Mutex::new(None),
    is_quitting: Mutex::new(false),
});

/// 读取当前播放视频信息
pub fn current_video_info() -> Option<Value> {
    STATE.current_video_info.lock().unwrap().clone()
}

/// 设置当前播放视频信息
pub fn set_current_video_info(info: Value) {
    *STATE.current_video_info.lock().unwrap() = Some(info);
}

/// 更新当前播放视频信息的部分字段
pub fn patch_current_video_info(patch: Value) {
    let mut guard = STATE.current_video_info.lock().unwrap();
    match guard.as_mut() {
        Some(info) => {
            if let (Some(obj), Some(patch_obj)) = (info.as_object_mut(), patch.as_object()) {
                for (k, v) in patch_obj {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        None => *guard = Some(patch),
    }
}
