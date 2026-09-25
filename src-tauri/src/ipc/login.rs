// login 模块：对应 Electron 版 src/main/ipc/login.js
// 通道：get-login-qrcode / poll-login-status / stop-login-poll / get-login-info /
//       import-cookie-string / logout / get-cookies / get-sec-ck /
//       dump-session-cookies / replay-bangumi-with-cookies
//
// Tauri 适配：无 Electron session，cookie 统一由 cookie_store 管理；
// session 读写步骤替换为直接操作 cookie_store，行为对齐。
use serde_json::{json, Value};
use std::fs;

use crate::api::{fetch_api, fetch_api_with_headers, UA_120};
use crate::cookie_store;

fn code_of(v: &Value) -> i64 {
    v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1)
}

/// 32 位随机字符串（对应 generateRandomString）
pub fn generate_random_string(length: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    // 简单可用的随机源（安全性要求低，仅作 local_key）
    let mut seed = crate::api::now_millis_js() as u64 ^ std::process::id() as u64;
    (0..length)
        .map(|_| {
            // xorshift
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            CHARS[(seed % CHARS.len() as u64) as usize] as char
        })
        .collect()
}

/// 从文本解析 cookie 并合并进 cookie 存储
pub fn import_cookie_string_from_text(cookie_string: &str) -> Result<Value, String> {
    if cookie_string.is_empty() {
        return Err("cookieString 必须是非空字符串".to_string());
    }
    let mut parsed = serde_json::Map::new();
    for part in cookie_string.split(';') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        let Some(idx) = p.find('=') else { continue };
        let name = p[..idx].trim().to_string();
        let raw_value = p[idx + 1..].trim().to_string();
        // try decodeURIComponent（失败保持原值）
        let value = percent_encoding::percent_decode_str(&raw_value)
            .decode_utf8()
            .map(|s| s.to_string())
            .unwrap_or(raw_value);
        if value.is_empty() {
            continue;
        }
        // 控制字符过滤
        if value
            .chars()
            .any(|c| matches!(c as u32, 0x00..=0x08 | 0x0A..=0x1F | 0x7F))
        {
            continue;
        }
        parsed.insert(name, json!(value));
    }
    if parsed.is_empty() {
        return Err("未解析到有效的 cookie".to_string());
    }
    // 合并保存
    let mut current = cookie_store::get_all();
    for (k, v) in &parsed {
        current.insert(k.clone(), v.as_str().unwrap_or_default().to_string());
    }
    cookie_store::set_all(current);
    Ok(json!({ "success": true, "keys": parsed.keys().collect::<Vec<_>>() }))
}

/// 启动时导入：userData/import_cookie_string.txt 或剪贴板（剪贴板部分由前端/Phase 4 接入）
pub fn try_import_cookies_on_startup(app: &tauri::AppHandle) -> Value {
    use tauri::Manager;
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let Ok(data_dir) = app.path().app_data_dir() else {
        return json!({ "success": false, "reason": "no-cookie" });
    };
    let import_file = data_dir.join("import_cookie_string.txt");
    let mut cookie_string: Option<String> = fs::read_to_string(&import_file)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if cookie_string.is_none() {
        // 对应 Electron 版：从系统剪贴板读取 cookie 字符串
        if let Ok(clip) = app.clipboard().read_text() {
            let clip = clip.trim();
            if clip.contains("SESSDATA=") || clip.contains("sec_ck=") || clip.contains("bili_jct=")
            {
                cookie_string = Some(clip.to_string());
            }
        }
    }

    let Some(cookie_string) = cookie_string else {
        return json!({ "success": false, "reason": "no-cookie" });
    };

    match import_cookie_string_from_text(&cookie_string) {
        Ok(res) => res,
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// get-login-qrcode
pub async fn get_login_qrcode(_args: &[Value]) -> Value {
    let local_key = generate_random_string(32);
    let timestamp = crate::api::now_millis_js();
    let url = format!(
        "https://passport.bilibili.com/x/passport-login/web/qrcode/generate?local_key={}&source=main_mini&_timestamp={}&rnd={}",
        local_key, timestamp, timestamp
    );
    match fetch_api(&url).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                let qr_url = result.pointer("/data/url").and_then(|v| v.as_str()).unwrap_or("");
                let qcode = result.pointer("/data/qrcode_key").map(|v| v.to_string().replace('"', "")).unwrap_or_default();
                json!({
                    "success": true,
                    "data": { "url": qr_url, "qcode": qcode, "localKey": local_key }
                })
            } else {
                json!({
                    "success": false,
                    "error": result.get("message").and_then(|m| m.as_str()).unwrap_or("获取二维码失败")
                })
            }
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// poll-login-status：轮询扫码状态并落盘 cookie
pub async fn poll_login_status(args: &[Value]) -> Value {
    let qcode = args.first().map(|v| match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }).unwrap_or_default();

    let url = format!(
        "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key={}&source=main_electron_pc&web_location=0.0&x-bili-locale-json=%7B%22c_locale%22:%7B%22language%22:%22zh%22,%22region%22:%22CN%22%7D,%22always_translate%22:true%7D&b_ret=MQAAAABJRU5ErkJggg%3D%3DAFzCgAsMxYTaIooF%2BB%2FwGUsPWmkr%2B6%2BQAAAABJRU5ErkJggg%3D%3D&rnd={}",
        qcode,
        crate::api::now_millis_js()
    );

    let result = match fetch_api_with_headers(&url, &serde_json::Map::new()).await {
        Ok(r) => r,
        Err(e) => return json!({ "success": false, "error": e }),
    };

    if code_of(&result) != 0 {
        return json!({
            "success": false,
            "error": result.get("message").and_then(|m| m.as_str()).unwrap_or("查询状态失败")
        });
    }

    let data = result.get("data").cloned().unwrap_or(json!({}));

    // 内层 API 错误码
    if let Some(inner_code) = data.get("code").and_then(|c| c.as_i64()) {
        if inner_code != 0 {
            if inner_code == 86038 {
                return json!({
                    "success": true,
                    "data": {
                        "status": "expired",
                        "message": data.get("message").and_then(|m| m.as_str()).unwrap_or("二维码已失效")
                    }
                });
            }
            return json!({
                "success": false,
                "error": data.get("message").and_then(|m| m.as_str()).unwrap_or("登录失败")
            });
        }
    }

    let status = data.get("status").and_then(|s| s.as_i64()).unwrap_or(-1);
    let cross_url = data.get("url").and_then(|u| u.as_str()).unwrap_or("");

    // 等待扫码或已扫码待确认（与 Electron 版一致：status===1 或 url 为空都算已扫码）
    if status == 1 || cross_url.is_empty() {
        return json!({
            "success": true,
            "data": { "status": "scanned", "message": "扫码成功，请在手机上确认登录" }
        });
    }

    // 登录成功：从 crossDomain URL 参数提取 cookie
    if !cross_url.is_empty() {
        let query = cross_url.split('?').nth(1).unwrap_or("");
        let mut params_map = serde_json::Map::new();
        for pair in query.split('&') {
            let mut it = pair.splitn(2, '=');
            let k = it.next().unwrap_or("");
            let v = it.next().unwrap_or("");
            if !k.is_empty() {
                params_map.insert(k.to_string(), json!(crate::api::dec(v)));
            }
        }

        let mut merged = cookie_store::get_all();
        for key in ["DedeUserID", "SESSDATA", "bili_jct", "DedeUserID__ckMd5"] {
            if let Some(v) = params_map.get(key).and_then(|v| v.as_str()) {
                merged.insert(key.to_string(), v.to_string());
            }
        }
        cookie_store::set_all(merged);

        // 请求 crossDomain URL 触发服务端下发 sec_ck 等 Set-Cookie（由 harvest 回收）
        let cross_headers = json!({
            "Referer": "https://www.bilibili.com/client",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.17.5 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 build/1001017006"
        });
        let _ = fetch_api_with_headers(cross_url, cross_headers.as_object().unwrap()).await;

        return json!({
            "success": true,
            "data": {
                "status": "success",
                "url": cross_url,
                "cookies": cookie_store::get_all_json(),
                "refresh_token": data.get("refresh_token").cloned().unwrap_or(Value::Null),
                "message": "登录成功"
            }
        });
    }

    json!({
        "success": true,
        "data": { "status": "waiting", "message": "等待扫码..." }
    })
}

/// stop-login-poll（Tauri 下轮询由前端驱动，保留接口）
pub async fn stop_login_poll(_args: &[Value]) -> Value {
    json!({ "success": true })
}

/// get-login-info：登录状态
pub async fn get_login_info(_args: &[Value]) -> Value {
    let cookie = cookie_store::get_cookie_string();
    let mut custom = serde_json::Map::new();
    custom.insert("User-Agent".into(), json!(UA_120));
    custom.insert("Referer".into(), json!("https://www.bilibili.com/"));
    if !cookie.is_empty() {
        custom.insert("Cookie".into(), json!(cookie));
    }
    match fetch_api_with_headers("https://api.bilibili.com/x/web-interface/nav", &custom).await {
        Ok(data) => {
            if code_of(&data) == 0 && data.pointer("/data/isLogin").and_then(|v| v.as_bool()).unwrap_or(false) {
                json!({
                    "success": true,
                    "isLogin": true,
                    "uname": data.pointer("/data/uname").and_then(|v| v.as_str()).unwrap_or(""),
                    "face": data.pointer("/data/face").and_then(|v| v.as_str()).unwrap_or(""),
                    "mid": data.pointer("/data/mid").cloned().unwrap_or(json!(""))
                })
            } else {
                json!({ "success": true, "isLogin": false })
            }
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// import-cookie-string
pub async fn import_cookie_string(args: &[Value]) -> Value {
    let cookie_string = args.first().and_then(|v| v.as_str()).unwrap_or("");
    match import_cookie_string_from_text(cookie_string) {
        Ok(res) => res,
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// logout：清空 cookie
pub async fn logout(_args: &[Value]) -> Value {
    cookie_store::clear();
    json!({ "success": true, "message": "退出登录成功" })
}

/// get-cookies
pub async fn get_cookies(_args: &[Value]) -> Value {
    json!({ "success": true, "cookies": cookie_store::get_all_json() })
}

/// get-sec-ck
pub async fn get_sec_ck(_args: &[Value]) -> Value {
    json!({ "success": true, "sec_ck": cookie_store::get("sec_ck") })
}

/// dump-session-cookies：Tauri 下导出 cookie 存储全量
pub async fn dump_session_cookies(_args: &[Value]) -> Value {
    let all = cookie_store::get_all_json();
    let list: Vec<Value> = all
        .as_object()
        .map(|obj| {
            obj.iter()
                .map(|(k, v)| json!({ "name": k, "value": v.as_str().unwrap_or(""), "domain": ".bilibili.com" }))
                .collect()
        })
        .unwrap_or_default();
    json!({ "success": true, "cookies": list })
}

/// replay-bangumi-with-cookies：调试用，重放追番请求并保存响应
pub async fn replay_bangumi_with_cookies(args: &[Value]) -> Value {
    let cookie_string = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
    let params = args.get(1).cloned().unwrap_or(json!({}));
    let is_refresh = params.get("is_refresh").and_then(|v| v.as_i64()).unwrap_or(0);
    let cursor = params.get("cursor").and_then(|v| v.as_str()).unwrap_or("");

    let url = format!(
        "https://api.bilibili.com/pgc/page/pc/bangumi/tab?is_refresh={}{}",
        is_refresh,
        if cursor.is_empty() { String::new() } else { format!("&cursor={}", cursor) }
    );
    let headers = json!({
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.bilibili.com/client",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.17.5 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 build/1001017006",
        "Origin": "https://www.bilibili.com",
        "x-app-version": "1.17.6",
        "Cookie": cookie_string
    });
    match fetch_api_with_headers(&url, headers.as_object().unwrap()).await {
        Ok(result) => {
            // 保存到 app_data_dir/test（Electron 版保存在应用目录旁 test/）
            let mut save_path = String::new();
            if let Some(dir) = cookie_store::data_dir() {
                let save_dir = dir.join("test");
                let _ = fs::create_dir_all(&save_dir);
                let file = save_dir.join(format!("bangumi_replay_provided_{}.json", crate::api::now_millis_js()));
                if let Ok(json_str) = serde_json::to_string_pretty(&json!({
                    "requestHeaders": headers,
                    "response": result
                })) {
                    if fs::write(&file, json_str).is_ok() {
                        save_path = file.to_string_lossy().to_string();
                    }
                }
            }
            json!({ "success": true, "file": save_path, "data": result })
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}
