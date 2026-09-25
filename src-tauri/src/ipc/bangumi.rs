// bangumi 模块：对应 Electron 版 src/main/ipc/bangumi.js
// 通道：fetch-media / fetch-bangumi-data / fetch-bangumi-condition /
//       get-season-episodes / fetch-bangumi-result
use serde_json::{json, Value};

use crate::api::{
    build_recommend_url, fetch_api, fetch_api_with_headers, fetch_with_retry, wrap_err,
};
use crate::cookie_store;

fn code_of(v: &Value) -> i64 {
    v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1)
}

const CLIENT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.17.5 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 build/1001017006";

/// 官方客户端风格的请求头（bangumi/media 共用）
pub fn client_headers() -> Value {
    json!({
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.bilibili.com/client",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "User-Agent": CLIENT_UA,
        "Origin": "https://www.bilibili.com",
        "sec-ch-ua": "\"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"108\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "x-app-version": "1.17.6"
    })
}

/// sec_ck 引导：缺失且有 SESSDATA 时，请求推荐接口触发下发并回收
pub async fn bootstrap_sec_ck() {
    let has_sec_ck = cookie_store::get("sec_ck").map(|v| !v.is_empty()).unwrap_or(false);
    let has_sessdata = cookie_store::get("SESSDATA").map(|v| !v.is_empty()).unwrap_or(false);
    if !has_sec_ck && has_sessdata {
        let _ = fetch_api(&build_recommend_url(1)).await;
    }
}

/// fetch-media：影视/番剧索引列表（seasonType 复用）
pub async fn fetch_media(args: &[Value]) -> Value {
    let season_type = args
        .first()
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(2);
    let page = args
        .get(1)
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(1);
    let endpoint = format!(
        "https://api.bilibili.com/pgc/season/index/result?season_type={}&type=1&free=1&pagesize=30&page={}&order=2",
        season_type, page
    );
    match fetch_with_retry(&endpoint).await {
        Ok(data) => wrap_ok_data(data),
        Err(e) => wrap_err(&e),
    }
}

fn wrap_ok_data(data: Value) -> Value {
    json!({ "success": true, "data": data })
}

/// fetch-bangumi-data：追番 tab 数据
pub async fn fetch_bangumi_data(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(json!({}));
    let is_refresh = params.get("is_refresh").and_then(|v| v.as_i64()).unwrap_or(0);
    let cursor = params.get("cursor").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let mut url = format!("https://api.bilibili.com/pgc/page/pc/bangumi/tab?is_refresh={}", is_refresh);
    if !cursor.is_empty() {
        url.push_str(&format!("&cursor={}", cursor));
    }

    bootstrap_sec_ck().await;

    match fetch_api_with_headers(&url, client_headers().as_object().unwrap()).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok_data(result)
            } else {
                wrap_err("获取追番数据失败")
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// fetch-bangumi-condition：筛选条件
pub async fn fetch_bangumi_condition(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(json!({}));
    let index_type = params.get("index_type").and_then(|v| v.as_i64()).unwrap_or(1);
    let type_ = params.get("type").and_then(|v| v.as_i64()).unwrap_or(2);
    let url = format!(
        "https://api.bilibili.com/pgc/page/index/condition?index_type={}&type={}",
        index_type, type_
    );
    match fetch_api_with_headers(&url, &serde_json::Map::new()).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok_data(result)
            } else {
                wrap_err("获取筛选条件失败")
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// get-season-episodes：剧集列表
pub async fn get_season_episodes(args: &[Value]) -> Value {
    let season_id = args
        .first()
        .map(|v| match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    let url = format!("https://api.bilibili.com/pgc/view/web/season?season_id={}", season_id);
    match fetch_api_with_headers(&url, &serde_json::Map::new()).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                if let Some(episodes) = result.pointer("/result/episodes").and_then(|e| e.as_array()) {
                    let mapped: Vec<Value> = episodes
                        .iter()
                        .map(|ep| {
                            json!({
                                "aid": ep.get("aid").cloned().unwrap_or(Value::Null),
                                "cid": ep.get("cid").cloned().unwrap_or(Value::Null),
                                "bvid": ep.get("bvid").cloned().unwrap_or(Value::Null),
                                "id": ep.get("id").cloned().unwrap_or(Value::Null),
                                "title": ep.get("share_copy").and_then(|v| v.as_str())
                                    .or_else(|| ep.get("long_title").and_then(|v| v.as_str()))
                                    .or_else(|| ep.get("title").and_then(|v| v.as_str()))
                                    .unwrap_or(""),
                                "cover": ep.get("cover").and_then(|v| v.as_str()).unwrap_or("")
                            })
                        })
                        .collect();
                    return json!({
                        "success": true,
                        "data": mapped,
                        "seasonTitle": result.pointer("/result/title").and_then(|t| t.as_str()).unwrap_or("")
                    });
                }
            }
            wrap_err(&result.get("message").and_then(|m| m.as_str()).unwrap_or("获取剧集列表失败"))
        }
        Err(e) => wrap_err(&e),
    }
}

/// fetch-bangumi-result：追番筛选结果
pub async fn fetch_bangumi_result(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(json!({}));
    let get = |k: &str| params.get(k).cloned().unwrap_or(json!(-1));
    let type_ = params.get("type").and_then(|v| v.as_i64()).unwrap_or(2);
    let order = params.get("order").and_then(|v| v.as_i64()).unwrap_or(3);
    let index_type = params.get("index_type").and_then(|v| v.as_i64()).unwrap_or(1);
    let page = params.get("page").and_then(|v| v.as_u64()).unwrap_or(1);

    let mut url = format!(
        "https://api.bilibili.com/pgc/page/index/result?type={}&order={}&index_type={}&page={}",
        type_, order, index_type, page
    );
    let not_neg1 = |v: &Value| -> bool { v.to_string().replace('"', "") != "-1" };
    for key in ["area", "style_id", "season_version", "season_status", "spoken_language_type", "copyright", "is_finish"] {
        let v = get(key);
        if not_neg1(&v) {
            url.push_str(&format!("&{}={}", key, v.to_string().replace('"', "")));
        }
    }
    let year = get("year");
    if not_neg1(&year) {
        url.push_str(&format!("&year={}", crate::api::enc(&year.to_string().replace('"', ""))));
    }
    for key in ["season_month", "pub_date"] {
        let v = get(key);
        if not_neg1(&v) {
            url.push_str(&format!("&{}={}", key, v.to_string().replace('"', "")));
        }
    }

    match fetch_api_with_headers(&url, &serde_json::Map::new()).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok_data(result)
            } else {
                wrap_err("获取追番数据失败")
            }
        }
        Err(e) => wrap_err(&e),
    }
}
