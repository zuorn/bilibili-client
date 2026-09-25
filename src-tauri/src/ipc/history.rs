// history 模块：对应 Electron 版 src/main/ipc/history.js
// 通道：get-history / delete-history / search-history / report-play-progress /
//       report-final-progress / get-video-progress / add-to-view / clear-history
// 同时导出 format_progress_time / report_play_history 供播放器模块复用。
use serde_json::{json, Value};

use crate::api::{fetch_api, fetch_api_post, UA_120};
use crate::cookie_store;
use crate::state;

fn code_of(v: &Value) -> i64 {
    v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1)
}

// ==================== 共用工具（导出给 player 模块） ====================

/// 格式化时间为 MM:SS 或 HH:MM:SS
#[allow(dead_code)]
pub fn format_progress_time(seconds: f64) -> String {
    let secs = seconds.floor() as i64;
    let hours = secs / 3600;
    let mins = (secs % 3600) / 60;
    let s = secs % 60;
    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, mins, s)
    } else {
        format!("{}:{:02}", mins, s)
    }
}

/// 上报播放历史（对应 reportPlayHistory）
pub async fn report_play_history(aid: &str, cid: &str, progress: f64) -> bool {
    let Some(sessdata) = cookie_store::get("SESSDATA") else {
        return false;
    };
    let Some(bili_jct) = cookie_store::get("bili_jct") else {
        return false;
    };
    if sessdata.is_empty() || bili_jct.is_empty() {
        return false;
    }

    let body = vec![
        ("aid".to_string(), aid.to_string()),
        ("cid".to_string(), cid.to_string()),
        ("progress".to_string(), format!("{}", progress.floor() as i64)),
        ("platform".to_string(), "pc".to_string()),
        ("csrf".to_string(), bili_jct),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v2/history/report", &body).await {
        Ok(result) => code_of(&result) == 0,
        Err(_) => false,
    }
}

/// UA 常量重导出（player 模块使用）
#[allow(dead_code)]
pub fn ua_120() -> &'static str {
    UA_120
}

fn format_history_time(timestamp: u64) -> String {
    if timestamp == 0 {
        return "刚刚".to_string();
    }
    let now = crate::api::now_millis_js() as f64 / 1000.0;
    let diff = now - timestamp as f64;
    if diff < 60.0 {
        return "刚刚".to_string();
    }
    if diff < 3600.0 {
        return format!("{}分钟前", (diff / 60.0).floor());
    }
    if diff < 86400.0 {
        return format!("{}小时前", (diff / 3600.0).floor());
    }
    if diff < 604800.0 {
        return format!("{}天前", (diff / 86400.0).floor());
    }
    // 日期格式：M月D日（本地时区）
    let secs = timestamp as i64;
    match chrono::DateTime::from_timestamp(secs, 0) {
        Some(dt) => {
            let local = dt.with_timezone(&chrono::Local);
            format!("{}月{}日", local.month(), local.day())
        }
        None => String::new(),
    }
}

use chrono::Datelike;

/// 从 item 提取 bvid：bvid / history.bvid / uri 中 BV 号
fn extract_bvid(item: &Value) -> String {
    if let Some(b) = item.get("bvid").and_then(|v| v.as_str()) {
        if !b.is_empty() {
            return b.to_string();
        }
    }
    if let Some(b) = item.pointer("/history/bvid").and_then(|v| v.as_str()) {
        if !b.is_empty() {
            return b.to_string();
        }
    }
    if let Some(uri) = item.get("uri").and_then(|v| v.as_str()) {
        if let Some(pos) = uri.find("BV") {
            let rest = &uri[pos..];
            let bvid: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric())
                .collect();
            return bvid;
        }
    }
    String::new()
}

/// kid：顶层 kid 优先，否则 history.oid
fn extract_kid(item: &Value) -> String {
    let top = item.get("kid").filter(|k| !k.is_null());
    match top {
        Some(k) if !k.to_string().is_empty() && k.as_str() != Some("") => match k {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        },
        _ => item
            .pointer("/history/oid")
            .map(|v| match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default(),
    }
}

fn map_history_item(item: &Value) -> Value {
    let view_at = item.get("view_at").and_then(|v| v.as_u64()).unwrap_or(0);
    json!({
        "kid": extract_kid(item),
        "business": item.pointer("/history/business").and_then(|v| v.as_str()).unwrap_or("archive"),
        "oid": item.pointer("/history/oid").cloned().unwrap_or(json!("")),
        "bvid": extract_bvid(item),
        "title": item.get("title").and_then(|v| v.as_str())
            .or_else(|| item.get("long_title").and_then(|v| v.as_str())).unwrap_or(""),
        "pic": item.get("cover").and_then(|v| v.as_str()).unwrap_or(""),
        "duration": item.get("duration").cloned().unwrap_or(json!(0)),
        "author": item.get("author_name").and_then(|v| v.as_str()).unwrap_or(""),
        "authorMid": item.get("author_mid").cloned().unwrap_or(json!("")),
        "authorFace": item.get("author_face").and_then(|v| v.as_str()).unwrap_or(""),
        "viewAt": view_at,
        "progress": item.get("progress").cloned().unwrap_or(json!(0)),
        "isFinish": item.get("is_finish").and_then(|v| v.as_bool()).unwrap_or(false),
        "historyTime": format_history_time(view_at)
    })
}

// ==================== 通道处理函数 ====================

/// get-history：历史记录（游标分页）
pub async fn get_history(args: &[Value]) -> Value {
    let cursor = args.first().cloned().unwrap_or(Value::Null);
    let mut url = "https://api.bilibili.com/x/web-interface/history/cursor?type=all&ps=20".to_string();

    let max = cursor.get("max").cloned().unwrap_or(Value::Null);
    let view_at = cursor.get("view_at").cloned().unwrap_or(Value::Null);
    let zero_like = |v: &Value| -> bool {
        matches!(v, Value::Null)
            || v.as_f64().map(|f| f == 0.0).unwrap_or(false)
            || v.as_str().map(|s| s == "0" || s.is_empty()).unwrap_or(false)
    };
    if !max.is_null() && !view_at.is_null() && !zero_like(&max) && !zero_like(&view_at) {
        let business = cursor.get("business").and_then(|b| b.as_str()).unwrap_or("archive");
        url.push_str(&format!(
            "&max={}&view_at={}&business={}",
            json_num(&max),
            json_num(&view_at),
            business
        ));
    } else {
        url.push_str("&max=0&view_at=0&business=archive");
    }

    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return json!({"success": false, "error": e}),
    };
    if code_of(&result) == 0 {
        let list = result.pointer("/data/list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
        let cursor_data = result.pointer("/data/cursor").cloned().unwrap_or(json!({}));
        let c_max = cursor_data.get("max").map(|v| v.as_f64().unwrap_or(0.0)).unwrap_or(0.0);
        let c_view_at = cursor_data.get("view_at").map(|v| v.as_f64().unwrap_or(0.0)).unwrap_or(0.0);
        let has_more = !(c_max == 0.0 && c_view_at == 0.0);

        return json!({
            "success": true,
            "data": list.iter().map(map_history_item).collect::<Vec<_>>(),
            "nextCursor": {
                "max": cursor_data.get("max").cloned().unwrap_or(json!(0)),
                "view_at": cursor_data.get("view_at").cloned().unwrap_or(json!(0)),
                "business": cursor_data.get("business").cloned().unwrap_or(json!("archive"))
            },
            "hasMore": has_more
        });
    }
    json!({"success": false, "error": "获取历史记录失败"})
}

fn json_num(v: &Value) -> String {
    match v {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// delete-history：删除单条历史
pub async fn delete_history(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(json!({}));
    let kid = params.get("kid").cloned().unwrap_or(Value::Null);
    let business = params.get("business").and_then(|v| v.as_str()).unwrap_or("archive").to_string();
    let oid = params.get("oid").cloned().unwrap_or(Value::Null);

    // kid 格式：{business}_{id}
    let final_kid = if !kid.is_null() {
        let kid_str = json_num(&kid);
        if kid_str.contains('_') {
            kid_str
        } else {
            format!("{}_{}", business, kid_str)
        }
    } else if !oid.is_null() {
        format!("{}_{}", business, json_num(&oid))
    } else {
        String::new()
    };
    if final_kid.is_empty() {
        return json!({"success": false, "error": "缺少历史记录标识，无法删除"});
    }
    let csrf = cookie_store::get("bili_jct").unwrap_or_default();
    if csrf.is_empty() {
        return json!({"success": false, "error": "缺少 bili_jct，无法删除历史记录"});
    }

    let body = vec![
        ("kid".to_string(), final_kid),
        ("csrf".to_string(), csrf),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v2/history/delete", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                json!({"success": true, "data": result.get("data").cloned().unwrap_or(Value::Null)})
            } else {
                json!({"success": false, "error": result.get("message").and_then(|m| m.as_str()).unwrap_or("删除失败")})
            }
        }
        Err(e) => json!({"success": false, "error": e}),
    }
}

/// search-history：搜索历史
pub async fn search_history(args: &[Value]) -> Value {
    let keyword = args.first().and_then(|v| v.as_str()).unwrap_or("");
    let url = format!(
        "https://api.bilibili.com/x/web-interface/history/search?pn=1&keyword={}&business=all&add_time_start=0&add_time_end=0&arc_max_duration=0&arc_min_duration=0&device_type=0&web_location=333.1391",
        crate::api::enc(keyword)
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return json!({"success": false, "error": e}),
    };
    if code_of(&result) == 0 {
        let list = result.pointer("/data/list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
        let data: Vec<Value> = list.iter().map(|item| {
            let mut obj = map_history_item(item);
            // search-history 版本没有 business 字段
            if let Some(o) = obj.as_object_mut() {
                o.remove("business");
            }
            obj
        }).collect();
        let has_more = result.pointer("/data/page/has_more").and_then(|h| h.as_bool()).unwrap_or(false);
        let pn = result.pointer("/data/page/pn").and_then(|p| p.as_u64()).unwrap_or(0);
        return json!({
            "success": true,
            "data": data,
            "hasMore": has_more,
            "nextPage": if pn > 0 { json!(pn + 1) } else { Value::Null }
        });
    }
    json!({"success": false, "error": result.get("message").and_then(|m| m.as_str()).unwrap_or("搜索历史记录失败")})
}

/// report-play-progress：记录进度到内存状态
pub async fn report_play_progress(args: &[Value]) -> Value {
    if let Some(progress) = args.first() {
        state::patch_current_video_info(json!({ "lastReportProgress": progress.clone() }));
    }
    Value::Null
}

/// report-final-progress：最终进度上报历史
pub async fn report_final_progress(args: &[Value]) -> Value {
    if let Some(progress) = args.first().and_then(|p| p.as_f64()) {
        state::patch_current_video_info(json!({
            "lastReportProgress": progress,
            "finalProgressReported": true
        }));
        if let Some(info) = state::current_video_info() {
            let aid = info.get("aid").map(|a| json_num(a)).unwrap_or_default();
            let cid = info.get("cid").map(|a| json_num(a)).unwrap_or_default();
            if !aid.is_empty() && !cid.is_empty() && aid != "0" && cid != "0" {
                report_play_history(&aid, &cid, progress).await;
            }
        }
    }
    Value::Null
}

/// get-video-progress：按 bvid 查询播放进度
pub async fn get_video_progress(args: &[Value]) -> Value {
    let bvid = args.first().and_then(|v| v.as_str()).unwrap_or("");
    let url = "https://api.bilibili.com/x/web-interface/history/cursor?type=all&ps=50&max=0&view_at=0&business=archive";
    let result = match fetch_api(url).await {
        Ok(r) => r,
        Err(_) => return json!({"success": false, "progress": 0, "cid": ""}),
    };
    if code_of(&result) == 0 {
        let list = result.pointer("/data/list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
        for item in &list {
            if extract_bvid(item) == bvid {
                return json!({
                    "success": true,
                    "progress": item.get("progress").cloned().unwrap_or(json!(0)),
                    "cid": item.pointer("/history/cid").cloned().unwrap_or(json!(""))
                });
            }
        }
    }
    json!({"success": false, "progress": 0, "cid": ""})
}

/// add-to-view：加入稍后再看
pub async fn add_to_view(args: &[Value]) -> Value {
    let bvid = args.first().and_then(|v| v.as_str()).unwrap_or("");
    if bvid.is_empty() {
        return json!({"success": false, "error": "缺少视频ID"});
    }
    let csrf = cookie_store::get("bili_jct").unwrap_or_default();
    if csrf.is_empty() {
        return json!({"success": false, "error": "缺少 bili_jct，无法添加稍后再看"});
    }
    let body = vec![
        ("bvid".to_string(), bvid.to_string()),
        ("csrf".to_string(), csrf),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v2/history/toview/add", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                json!({"success": true, "data": result.get("data").cloned().unwrap_or(Value::Null)})
            } else {
                json!({"success": false, "error": result.get("message").and_then(|m| m.as_str()).unwrap_or("添加失败")})
            }
        }
        Err(e) => json!({"success": false, "error": e}),
    }
}

/// clear-history：清空历史
pub async fn clear_history(_args: &[Value]) -> Value {
    let csrf = cookie_store::get("bili_jct").unwrap_or_default();
    if csrf.is_empty() {
        return json!({"success": false, "error": "缺少 bili_jct，无法清空历史记录"});
    }
    let body = vec![("csrf".to_string(), csrf)];
    match fetch_api_post("https://api.bilibili.com/x/v2/history/clear", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                json!({"success": true, "data": result.get("data").cloned().unwrap_or(Value::Null)})
            } else {
                json!({"success": false, "error": result.get("message").and_then(|m| m.as_str()).unwrap_or("清空历史记录失败")})
            }
        }
        Err(e) => json!({"success": false, "error": e}),
    }
}
