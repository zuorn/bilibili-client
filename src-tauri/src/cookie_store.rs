// Cookie 存储管理：对应 Electron 版 src/main/cookieManager.js
// 设计要点：
// 1. 文件路径与格式与 Electron 版完全一致（<app_data_dir>/cookies.json，扁平 name->value JSON），
//    老用户升级后登录态无缝保留。
// 2. Tauri 下不再依赖 WebView session，cookie 由本模块作为唯一事实来源。
// 3. 行为对齐：SESSDATA 迭代解码、控制字符过滤、默认 cookie 补充、值编码规则。
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static COOKIES: OnceLock<Mutex<BTreeMap<String, String>>> = OnceLock::new();
static COOKIE_FILE: OnceLock<PathBuf> = OnceLock::new();

// 默认需要补充的 cookie（与 Electron 版一致）
const DEFAULT_COOKIES: &[(&str, &str)] = &[("bili_ticket_expires", "1779008783")];

fn cookies() -> &'static Mutex<BTreeMap<String, String>> {
    COOKIES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn has_control_chars(s: &str) -> bool {
    s.chars()
        .any(|c| matches!(c as u32, 0x00..=0x08 | 0x0A..=0x1F | 0x7F))
}

/// 对应 cookieManager.safeDecode：最多迭代解码 5 次 URL 编码
pub fn safe_decode(value: &str) -> String {
    let mut prev = value.to_string();
    for _ in 0..5 {
        let dec = percent_decode_str(&prev);
        match dec.decode_utf8() {
            Ok(s) => {
                if s == prev {
                    break;
                }
                prev = s.to_string();
            }
            Err(_) => break,
        }
    }
    prev
}

use percent_encoding::percent_decode_str;

/// JS encodeURIComponent 等价实现（不编码 A-Za-z0-9 - _ . ! ~ * ' ( )）
pub fn encode_uri_component(s: &str) -> String {
    const JS_SAFE: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'_')
        .remove(b'.')
        .remove(b'!')
        .remove(b'~')
        .remove(b'*')
        .remove(b'\'')
        .remove(b'(')
        .remove(b')');
    percent_encoding::utf8_percent_encode(s, JS_SAFE).to_string()
}

/// 启动时调用：加载 cookies.json（路径同 Electron 版），补充默认 cookie 并回写
pub fn load(file: PathBuf) {
    let _ = COOKIE_FILE.set(file.clone());
    let mut map = cookies().lock().unwrap();

    if file.exists() {
        if let Ok(data) = fs::read_to_string(&file) {
            if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&data) {
                for (k, v) in obj {
                    let value = match v {
                        Value::String(s) => s,
                        other => other.to_string(),
                    };
                    // 清理包含控制字符的 cookie 值，防止污染 HTTP 请求头
                    if has_control_chars(&value) {
                        eprintln!("[cookie] dropped cookie with control chars on load: {}", k);
                        continue;
                    }
                    map.insert(k, value);
                }
            }
        }
    }

    // SESSDATA 恢复原始未编码形式
    if let Some(sessdata) = map.get("SESSDATA").cloned() {
        map.insert("SESSDATA".into(), safe_decode(&sessdata));
    }

    // 补充默认 cookie
    for (k, v) in DEFAULT_COOKIES {
        map.entry(k.to_string()).or_insert_with(|| v.to_string());
    }

    save_locked(&file, &map);
    eprintln!("[cookie] loaded cookies: {:?}", map.keys().collect::<Vec<_>>());
}

fn save_locked(file: &PathBuf, map: &BTreeMap<String, String>) {
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    // Electron 版用 JSON.stringify(savedCookies)（无空格），保持一致
    if let Ok(json) = serde_json::to_string(map) {
        let _ = fs::write(file, json);
    }
}

pub fn save() {
    if let Some(file) = COOKIE_FILE.get() {
        let map = cookies().lock().unwrap();
        save_locked(file, &map);
    }
}

/// 对应 getCookieString：name=encodeURIComponent(value) 拼接
pub fn get_cookie_string() -> String {
    let map = cookies().lock().unwrap();
    map.iter()
        .map(|(k, v)| format!("{}={}", k, encode_uri_component(v)))
        .collect::<Vec<_>>()
        .join("; ")
}

// 预留工具函数（对应 Electron 版 cookieManager），当前模块内部未调用
#[allow(dead_code)]
pub fn is_empty() -> bool {
    cookies().lock().unwrap().is_empty()
}

pub fn get(name: &str) -> Option<String> {
    cookies().lock().unwrap().get(name).cloned()
}

#[allow(dead_code)]
pub fn set(name: &str, value: &str) {
    cookies().lock().unwrap().insert(name.to_string(), value.to_string());
    save();
}

/// 对应 parseSetCookieHeaders：从 Set-Cookie 响应头提取 name=value
pub fn parse_set_cookie_headers(headers: &[String]) -> BTreeMap<String, String> {
    let mut parsed = BTreeMap::new();
    for cookie_str in headers {
        // 取第一段 name=value（忽略 path/expires 等属性）
        let first = cookie_str.split(';').next().unwrap_or("");
        if let Some(eq) = first.find('=') {
            let name = first[..eq].trim().to_string();
            let mut value = first[eq + 1..].trim().to_string();
            if name.is_empty() {
                continue;
            }
            if has_control_chars(&value) {
                eprintln!("[cookie] skip cookie with control chars: {}", name);
                continue;
            }
            if name == "SESSDATA" {
                value = safe_decode(&value);
            }
            parsed.insert(name.clone(), value.clone());
            cookies().lock().unwrap().insert(name, value);
        }
    }
    if !parsed.is_empty() {
        save();
    }
    parsed
}

/// 对应 setSavedCookies：整体替换（login 流程使用）
pub fn set_all(map: BTreeMap<String, String>) {
    *cookies().lock().unwrap() = map;
    save();
}

pub fn get_all() -> BTreeMap<String, String> {
    cookies().lock().unwrap().clone()
}

/// 对应 clearCookies（logout 使用）
pub fn clear() {
    cookies().lock().unwrap().clear();
    if let Some(file) = COOKIE_FILE.get() {
        let _ = fs::remove_file(file);
    }
}

/// cookie 存储 JSON 视图
pub fn get_all_json() -> Value {
    let map = cookies().lock().unwrap();
    Value::Object(
        map.iter()
            .map(|(k, v)| (k.clone(), Value::String(v.clone())))
            .collect(),
    )
}

/// app_data_dir（由 load 时记录的 cookie 文件推得）
pub fn data_dir() -> Option<PathBuf> {
    COOKIE_FILE.get().and_then(|f| f.parent().map(|p| p.to_path_buf()))
}
