// 自动更新：对应 Electron 版 src/main/updater.js（electron-updater → tauri-plugin-updater）
// 多渠道：generic（OSS）+ GitHub Releases，取版本号最高的更新
// 通道：check-for-update / download-update / install-update；事件：update-status
//
// 注意：签名公钥（tauri.conf.json plugins.updater.pubkey）需在 Phase 5 打包前生成；
// 未配置时检查会返回错误，渲染层显示"检查失败"（与 Electron 版未配置 feed 行为类似）。
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

// 对应 src/config/update.yml：
//   generic.url = https://talktime.oss-cn-shanghai.aliyuncs.com/doc/bl/bl
//   github.owner/repo = zuorn/bilibili-client
const GENERIC_FEED: &str =
    "https://talktime.oss-cn-shanghai.aliyuncs.com/doc/bl/bl/latest.json";
const GITHUB_FEED: &str =
    "https://github.com/zuorn/bilibili-client/releases/latest/download/latest.json";

static PENDING_UPDATE: Lazy<Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>> =
    Lazy::new(|| Mutex::new(None));

fn send_status(app: &AppHandle, payload: Value) {
    let _ = app.emit_to("main", "update-status", payload);
}

/// 多渠道检查，返回版本最高的可用更新
async fn check_best(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    send_status(app, json!({ "status": "checking" }));
    let mut best: Option<tauri_plugin_updater::Update> = None;
    for feed in [GENERIC_FEED, GITHUB_FEED] {
        let Ok(endpoint) = feed.parse() else {
            continue;
        };
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .and_then(|b| b.build());
        let Ok(updater) = updater else {
            continue;
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let newer = best
                    .as_ref()
                    .map(|b| update.version > b.version)
                    .unwrap_or(true);
                if newer {
                    best = Some(update);
                }
            }
            Ok(None) => {}
            Err(e) => {
                eprintln!("[更新] {} 检查失败: {}", feed, e);
            }
        }
    }
    Ok(best)
}

/// check-for-update 通道
pub async fn check_for_update(app: &AppHandle) -> Value {
    match check_best(app).await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let release_date = update.date.clone().map(|d| d.to_string());
            let release_notes = update.body.clone().unwrap_or_default();
            *PENDING_UPDATE.lock().unwrap() = Some((update, Vec::new()));
            send_status(
                app,
                json!({
                    "status": "available",
                    "version": version,
                    "releaseDate": release_date,
                    "releaseNotes": release_notes
                }),
            );
            json!({ "success": true, "version": version })
        }
        Ok(None) => {
            send_status(app, json!({ "status": "up-to-date" }));
            json!({ "success": true, "version": Value::Null })
        }
        Err(e) => {
            send_status(app, json!({ "status": "error", "message": e }));
            json!({ "success": false, "error": "检查更新失败" })
        }
    }
}

/// download-update 通道：下载进度通过 update-status 推送
pub async fn download_update(app: &AppHandle) -> Value {
    let Some((update, _prev_bytes)) = PENDING_UPDATE.lock().unwrap().take() else {
        return json!({ "success": false, "error": "未找到可用更新" });
    };
    let app2 = app.clone();
    let mut last_downloaded: u64 = 0;
    let result = update
        .download(
            move |chunk, total| {
                if let Some(total) = total {
                    last_downloaded += chunk as u64;
                    let percent = (last_downloaded as f64 / total as f64 * 100.0).min(100.0);
                    // 节流：每 2% 推送一次
                    if (percent as u64) % 2 == 0 || percent >= 100.0 {
                        send_status(
                            &app2,
                            json!({
                                "status": "downloading",
                                "percent": percent,
                                "transferred": last_downloaded,
                                "total": total
                            }),
                        );
                    }
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            send_status(app, json!({ "status": "downloaded" }));
            // 存回 pending（含安装字节），供 install-update 使用
            *PENDING_UPDATE.lock().unwrap() = Some((update, bytes));
            json!({ "success": true })
        }
        Err(e) => {
            send_status(app, json!({ "status": "error", "message": e.to_string() }));
            json!({ "success": false, "error": e.to_string() })
        }
    }
}

/// install-update 通道：退出并安装
pub async fn install_update(app: &AppHandle) -> Value {
    let Some((update, bytes)) = PENDING_UPDATE.lock().unwrap().take() else {
        return json!({ "success": false, "error": "更新未下载" });
    };
    send_status(
        app,
        json!({
            "status": "installing",
            "percent": 100,
            "message": "正在安装...",
            "detail": "应用即将重启并安装更新"
        }),
    );
    match update.install(bytes) {
        Ok(()) => {
            // install 在 Windows 上会退出应用
            send_status(app, json!({ "status": "update-complete" }));
            json!({ "success": true })
        }
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

/// 启动后自动检查更新（对应 main.js：延迟 3 秒 checkForUpdates()）
pub fn schedule_auto_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        check_for_update(&app).await;
    });
}
