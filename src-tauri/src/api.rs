// API 核心模块：对应 Electron 版 src/main/api.js
// 职责：Bilibili API 请求（自动 gzip/brotli 解压由 reqwest 处理）、WBI 签名、
//       Cookie 注入与 Set-Cookie 回收。
use percent_encoding::percent_decode_str;
use serde_json::{json, Map, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::cookie_store;

pub const UA_120: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
pub const UA_114: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

// 预留：Electron 版多端点回退列表，当前 Rust 实现使用 RECOMMEND_API
#[allow(dead_code)]
pub const API_ENDPOINTS: &[&str] = &[
    "https://api.bilibili.com/x/web-interface/ranking/v2?type=all&ps=20&pn=",
    "https://api.bilibili.com/x/web-interface/ranking?rid=0&ps=20&pn=",
    "https://app.bilibili.com/x/v2/search/trending/ranking?refresh=0",
    "https://app.bilibili.com/x/v2/search/trending/all",
    "https://api.bilibili.com/x/feed/index?idx=0&type=0&pull=0&ps=20&pn=",
];

pub const RECOMMEND_API: &str = "https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd";

// ==================== HTTP Client ====================

fn client() -> &'static reqwest::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // 对应 Electron 版 rejectUnauthorized: false
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build reqwest client")
    })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 对应 JS Date.now()（用于 URL 防缓存参数）
pub fn now_millis_js() -> u64 {
    now_millis()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 回收 Set-Cookie 响应头到 cookie 存储
fn harvest_set_cookies(resp: &reqwest::Response) {
    let headers: Vec<String> = resp
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
        .collect();
    if !headers.is_empty() {
        cookie_store::parse_set_cookie_headers(&headers);
    }
}

// ==================== WBI 签名 ====================

pub const MIXIN_KEY_ENC_TAB: &[usize] = &[
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22,
    25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

static WBI_CACHE: std::sync::Mutex<Option<(String, String, u64)>> =
    std::sync::Mutex::new(None);

pub fn get_mix_key(img_key: &str, sub_key: &str) -> String {
    let raw: String = format!("{}{}", img_key, sub_key);
    let mut mix = String::new();
    for &pos in MIXIN_KEY_ENC_TAB {
        if pos < raw.len() {
            mix.push(raw.as_bytes()[pos] as char);
        }
    }
    mix.chars().take(32).collect()
}

/// 从导航 API 获取 WBI 密钥（缓存 1 小时）
pub async fn fetch_wbi_keys() -> Option<(String, String)> {
    {
        let cache = WBI_CACHE.lock().unwrap();
        if let Some((img, sub, t)) = cache.as_ref() {
            if now_millis() - t < 3_600_000 {
                return Some((img.clone(), sub.clone()));
            }
        }
    }

    let url = "https://api.bilibili.com/x/web-interface/nav";
    let mut req = client()
        .get(url)
        .header("User-Agent", UA_120)
        .header("Referer", "https://www.bilibili.com/")
        .timeout(Duration::from_secs(10));
    let cookie = cookie_store::get_cookie_string();
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }

    match req.send().await {
        Ok(resp) => {
            harvest_set_cookies(&resp);
            match resp.json::<Value>().await {
                Ok(parsed) => {
                    let wbi = parsed.pointer("/data/wbi_img");
                    let (img_key, sub_key) = extract_wbi_keys(wbi);
                    if let (Some(ik), Some(sk)) = (img_key, sub_key) {
                        *WBI_CACHE.lock().unwrap() = Some((ik.clone(), sk.clone(), now_millis()));
                        eprintln!(
                            "[wbi] keys updated: {}... {}...",
                            &ik[..ik.len().min(16)],
                            &sk[..sk.len().min(16)]
                        );
                        return Some((ik, sk));
                    }
                    eprintln!("[wbi] keys not found in nav response");
                    None
                }
                Err(e) => {
                    eprintln!("[wbi] nav parse error: {}", e);
                    None
                }
            }
        }
        Err(e) => {
            eprintln!("[wbi] nav request error: {}", e);
            None
        }
    }
}

/// 提取 img_key/sub_key：优先新格式（img_url/sub_url 文件名），兼容旧格式
fn extract_wbi_keys(wbi: Option<&Value>) -> (Option<String>, Option<String>) {
    let Some(wbi) = wbi else { return (None, None) };
    let file_key = |url: Option<&str>| -> Option<String> {
        url.and_then(|u| u.split('/').next_back())
            .map(|f| f.split('.').next().unwrap_or("").to_string())
            .filter(|s| !s.is_empty())
    };
    let img = file_key(wbi.get("img_url").and_then(|v| v.as_str()))
        .or_else(|| wbi.get("img_key").and_then(|v| v.as_str()).map(String::from));
    let sub = file_key(wbi.get("sub_url").and_then(|v| v.as_str()))
        .or_else(|| wbi.get("sub_key").and_then(|v| v.as_str()).map(String::from));
    (img, sub)
}

/// 对应 signParams：参数 + wts 排序拼接，MD5(query + mixKey) -> w_rid
pub fn sign_params(params: &[(String, String)], mix_key: &str) -> (String, u64) {
    let wts = now_secs();
    let mut all: Vec<(String, String)> = params.to_vec();
    all.push(("wts".to_string(), wts.to_string()));
    all.sort_by(|a, b| a.0.cmp(&b.0));
    let query = all
        .iter()
        .map(|(k, v)| format!("{}={}", cookie_store::encode_uri_component(k), cookie_store::encode_uri_component(v)))
        .collect::<Vec<_>>()
        .join("&");
    let sign_str = format!("{}{}", query, mix_key);
    let w_rid = md5_hex(sign_str.as_bytes());
    (w_rid, wts)
}

pub fn md5_hex(data: &[u8]) -> String {
    use md5::{Digest, Md5};
    let mut hasher = Md5::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

// ==================== 请求入口 ====================

/// 通用请求头（对应 fetchApi 的 headers）
fn base_headers(ua: &str) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let mut h = HeaderMap::new();
    let pairs = [
        ("User-Agent", ua),
        ("Referer", "https://www.bilibili.com/client"),
        ("Accept", "application/json, text/plain, */*"),
        ("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8"),
        ("Origin", "https://www.bilibili.com"),
        ("Cache-Control", "no-cache"),
        ("Pragma", "no-cache"),
    ];
    for (k, v) in pairs {
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            h.insert(name, val);
        }
    }
    h
}

/// 注入 Cookie 头（存储内有 cookie 时）
fn with_cookie(mut req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    let cookie = cookie_store::get_cookie_string();
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    req
}

/// 对应 fetchApi：GET 并解析 JSON
pub async fn fetch_api(url: &str) -> Result<Value, String> {
    let resp = with_cookie(client().get(url).headers(base_headers(UA_120)))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    harvest_set_cookies(&resp);
    resp.json::<Value>()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))
}

/// 对应 fetchApiWithHeaders：GET + 自定义头
pub async fn fetch_api_with_headers(
    url: &str,
    custom: &Map<String, Value>,
) -> Result<Value, String> {
    let mut headers = base_headers(UA_114);
    // fetchApiWithHeaders 的默认 Accept 是 */*
    if let Ok(v) = reqwest::header::HeaderValue::from_str("*/*") {
        headers.insert(reqwest::header::ACCEPT, v);
    }
    for (k, v) in custom {
        let s = match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        if let (Ok(name), Ok(val)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            reqwest::header::HeaderValue::from_str(&s),
        ) {
            headers.insert(name, val);
        }
    }
    let resp = with_cookie(client().get(url).headers(headers))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    harvest_set_cookies(&resp);
    resp.json::<Value>()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))
}

/// 对应 fetchApiPost：application/x-www-form-urlencoded POST
pub async fn fetch_api_post(url: &str, body: &[(String, String)]) -> Result<Value, String> {
    let form: Vec<(String, String)> = body
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let mut headers = base_headers(UA_120);
    if let Ok(v) = reqwest::header::HeaderValue::from_str("application/x-www-form-urlencoded") {
        headers.insert(reqwest::header::CONTENT_TYPE, v);
    }
    let resp = with_cookie(client().post(url).headers(headers).form(&form))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    harvest_set_cookies(&resp);
    resp.json::<Value>()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))
}

/// 对应 fetchWithRetry：code -352 时重试（最多 3 次，退避递增）
pub async fn fetch_with_retry(url: &str) -> Result<Value, String> {
    let retries = 3;
    let delay = 1000u64;
    let mut last_err = String::new();
    for i in 0..retries {
        match fetch_api(url).await {
            Ok(data) => {
                let code = data.get("code").and_then(|c| c.as_i64()).unwrap_or(-999);
                if code == 0 {
                    return Ok(data);
                }
                if code == -352 && i < retries - 1 {
                    tokio::time::sleep(Duration::from_millis(delay * (i as u64 + 1))).await;
                    continue;
                }
                return Ok(data);
            }
            Err(e) => {
                last_err = e;
                if i == retries - 1 {
                    return Err(last_err);
                }
                tokio::time::sleep(Duration::from_millis(delay * (i as u64 + 1))).await;
            }
        }
    }
    Err(last_err)
}

// ==================== URL 构建 ====================

/// 对应 buildRecommendUrl（保持与 Electron 版逐字节一致）
pub fn build_recommend_url(page: u64) -> String {
    format!(
        "{}?ps=30&fresh_idx={}&fresh_type=4&timezone_offset=-480&wts=1746216000&w_rid=abcdef123456",
        RECOMMEND_API, page
    )
}

/// 将 JSON 结果包装为 {success, data} / {success, error}（渲染层契约）
pub fn wrap_ok(data: Value) -> Value {
    json!({ "success": true, "data": data })
}

pub fn wrap_err(err: &str) -> Value {
    json!({ "success": false, "error": err })
}

/// URL 编码（encodeURIComponent 语义）
pub fn enc(s: &str) -> String {
    cookie_store::encode_uri_component(s)
}

/// percent_decode 便捷引用
pub fn dec(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().to_string()
}
