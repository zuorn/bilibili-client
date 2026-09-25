// media 模块：对应 Electron 版 src/main/ipc/media.js
// 通道：fetch-media-data / fetch-media-condition / fetch-media-result
use serde_json::{json, Value};

use crate::api::{fetch_api_with_headers, wrap_err};
use crate::ipc::bangumi::{bootstrap_sec_ck, client_headers};

fn code_of(v: &Value) -> i64 {
    v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1)
}

fn wrap_ok_data(data: Value) -> Value {
    json!({ "success": true, "data": data })
}

/// fetch-media-data：影视 tab 数据
pub async fn fetch_media_data(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(json!({}));
    let is_refresh = params.get("is_refresh").and_then(|v| v.as_i64()).unwrap_or(0);
    let cursor = params.get("cursor").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let mut url = format!("https://api.bilibili.com/pgc/page/pc/cinema/tab?is_refresh={}", is_refresh);
    if !cursor.is_empty() {
        url.push_str(&format!("&cursor={}", cursor));
    }

    bootstrap_sec_ck().await;

    match fetch_api_with_headers(&url, client_headers().as_object().unwrap()).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok_data(result)
            } else {
                wrap_err("获取影视数据失败")
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// fetch-media-condition：影视筛选条件
pub async fn fetch_media_condition(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(json!({}));
    let index_type = params.get("index_type").and_then(|v| v.as_i64()).unwrap_or(2);
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

/// fetch-media-result：影视筛选结果
pub async fn fetch_media_result(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(json!({}));
    let get = |k: &str| params.get(k).cloned().unwrap_or(json!(-1));
    let type_ = params.get("type").and_then(|v| v.as_i64()).unwrap_or(2);
    let order = params.get("order").and_then(|v| v.as_i64()).unwrap_or(8);
    let index_type = params.get("index_type").and_then(|v| v.as_i64()).unwrap_or(2);
    let page = params.get("page").and_then(|v| v.as_u64()).unwrap_or(1);

    let mut url = format!(
        "https://api.bilibili.com/pgc/page/index/result?type={}&order={}&index_type={}&page={}",
        type_, order, index_type, page
    );
    let not_neg1 = |v: &Value| -> bool { v.to_string().replace('"', "") != "-1" };
    for key in ["area", "style_id", "release_date", "season_status"] {
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
                wrap_err("获取影视数据失败")
            }
        }
        Err(e) => wrap_err(&e),
    }
}
