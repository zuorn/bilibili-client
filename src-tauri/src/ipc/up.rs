// up 模块：对应 Electron 版 src/main/ipc/up.js
// 通道：fetch-up-info / fetch-up-relation / fetch-up-videos / fetch-up-dynamics /
//       modify-up-relation / fetch-up-collections-series / fetch-season-archives
//
// ⚠️ UP主页动态（fetch-up-dynamics）与综合动态（get-user-dynamics）是两套独立实现，
// 数据结构差异点：authorFace 取 authorModule.face、nextOffset 取 data.offset、
// 多 view 字段、orig.id 回退逻辑不同。禁止与 dynamics.rs 合并（项目规范）。
use serde_json::{json, Map, Value};

use crate::api::{fetch_api, fetch_api_post, fetch_wbi_keys, get_mix_key, sign_params, wrap_err, wrap_ok};
use crate::cookie_store;
use crate::ipc::dynamics::{extract_dynamic_text_pub, normalize_modules_pub};

fn code_of(v: &Value) -> i64 {
    v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1)
}

const UP_DYNAMIC_FEATURES: &str = "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete";

fn val_u64(v: &Value) -> u64 {
    as_u64_or0(Some(v))
}

fn as_u64_or0(v: Option<&Value>) -> u64 {
    v.and_then(|x| {
        x.as_u64()
            .or_else(|| x.as_str().and_then(|s| s.parse().ok()))
            .or_else(|| x.as_f64().map(|f| f as u64))
    })
    .unwrap_or(0)
}

fn arg_u64(args: &[Value], idx: usize, _default: u64) -> u64 {
    as_u64_or0(args.get(idx))
}

fn arg_str(args: &[Value], idx: usize, default: &str) -> String {
    args.get(idx)
        .map(|v| match v {
            Value::String(s) => s.clone(),
            Value::Null => default.to_string(),
            other => other.to_string(),
        })
        .unwrap_or_else(|| default.to_string())
}

fn map_pic(d: &Value, use_url_first: bool) -> Value {
    let src = if use_url_first {
        d.get("url").and_then(|s| s.as_str())
            .or_else(|| d.get("src").and_then(|s| s.as_str()))
    } else {
        d.get("src").and_then(|s| s.as_str())
    };
    json!({
        "src": src.unwrap_or(""),
        "width": d.get("width").and_then(|w| w.as_u64()).unwrap_or(0),
        "height": d.get("height").and_then(|h| h.as_u64()).unwrap_or(0)
    })
}

fn draw_items(pics: Option<&Value>, use_url_first: bool) -> Vec<Value> {
    pics.and_then(|p| p.as_array())
        .map(|arr| arr.iter().map(|d| map_pic(d, use_url_first)).collect())
        .unwrap_or_default()
}

fn set_if_empty(obj: &mut Map<String, Value>, key: &str, value: Value) {
    let empty = match obj.get(key) {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.is_empty(),
        Some(Value::Number(n)) => n.as_u64() == Some(0),
        _ => false,
    };
    if empty {
        obj.insert(key.into(), value);
    }
}

/// 对应 up.js 内的动态 item 解析（与 dynamics.rs 的 parse_dynamic_item 独立）
fn parse_up_dynamic_item(item: &Value) -> Value {
    let modules = normalize_modules_pub(item);
    let dynamic_module = modules.get("module_dynamic").cloned().unwrap_or(json!({}));
    let author_module = modules.get("module_author").cloned().unwrap_or(json!({}));
    let major_module = dynamic_module.get("major").cloned().unwrap_or(json!({}));
    let desc = modules
        .get("module_desc")
        .filter(|d| !d.is_null())
        .or_else(|| dynamic_module.get("desc"))
        .cloned()
        .unwrap_or(json!({}));
    let stat_module = modules.get("module_stat").cloned().unwrap_or(json!({}));
    let stat = dynamic_module.get("stat").cloned().unwrap_or(json!({}));

    let mut r = Map::new();
    r.insert("id".into(), json!(item.get("id_str").and_then(|v| v.as_str()).unwrap_or("")));
    r.insert("type".into(), json!(item.get("type").and_then(|v| v.as_str()).unwrap_or("")));
    r.insert(
        "authorName".into(),
        json!(author_module.pointer("/user/name").and_then(|v| v.as_str())
            .or_else(|| author_module.get("name").and_then(|v| v.as_str())).unwrap_or("")),
    );
    // 注意：UP 动态的 authorFace 直接取 authorModule.face（与综合动态不同）
    r.insert("authorFace".into(), json!(author_module.get("face").and_then(|v| v.as_str()).unwrap_or("")));
    r.insert("authorMid".into(), json!(as_u64_or0(author_module.get("mid"))));
    r.insert("pubTs".into(), json!(as_u64_or0(author_module.get("pub_ts"))));
    r.insert("pubTime".into(), json!(author_module.get("pub_time").and_then(|v| v.as_str()).unwrap_or("")));
    r.insert("desc".into(), json!(extract_dynamic_text_pub(Some(&desc), None)));
    r.insert(
        "view".into(),
        json!(stat_module.pointer("/view/count").map(val_u64)
            .or_else(|| Some(as_u64_or0(stat.get("view")))).unwrap_or(0)),
    );
    r.insert(
        "like".into(),
        json!(stat_module.pointer("/like/count").map(val_u64)
            .or_else(|| Some(as_u64_or0(stat.get("like")))).unwrap_or(0)),
    );
    r.insert(
        "forward_count".into(),
        json!(stat_module.pointer("/forward/count").map(val_u64)
            .or_else(|| Some(as_u64_or0(stat.get("forward")))).unwrap_or(0)),
    );
    r.insert(
        "comment".into(),
        json!(stat_module.pointer("/comment/count").map(val_u64)
            .or_else(|| Some(as_u64_or0(stat.get("comment")))).unwrap_or(0)),
    );
    r.insert("play".into(), json!(0));
    r.insert("danmaku".into(), json!(0));

    // 视频内容 major.archive
    if let Some(archive) = major_module.get("archive") {
        r.insert("bvid".into(), json!(archive.get("bvid").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("aid".into(), json!(as_u64_or0(archive.get("aid"))));
        r.insert("cid".into(), json!(as_u64_or0(archive.get("cid"))));
        r.insert("title".into(), json!(archive.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("cover".into(), json!(archive.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("duration".into(), json!(archive.get("duration_text").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("play".into(), json!(archive.pointer("/stat/view").map(val_u64).unwrap_or(0)));
        r.insert("danmaku".into(), json!(archive.pointer("/stat/danmaku").map(val_u64).unwrap_or(0)));
    }

    // 图片内容 major.draw
    if let Some(items) = major_module.pointer("/draw/items").and_then(|i| i.as_array()) {
        r.insert("drawItems".into(), json!(items.iter().map(|d| map_pic(d, false)).collect::<Vec<_>>()));
    }
    // dyn_draw
    if let Some(items) = dynamic_module.pointer("/dyn_draw/items").and_then(|i| i.as_array()) {
        let has = r.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
        if !has {
            r.insert("drawItems".into(), json!(items.iter().map(|d| map_pic(d, false)).collect::<Vec<_>>()));
        }
    }
    // major.pics
    if let Some(pics) = major_module.get("pics") {
        let has = r.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
        if !has {
            r.insert("drawItems".into(), json!(draw_items(Some(pics), false)));
        }
    }

    // Opus
    if let Some(opus) = major_module.get("opus") {
        set_if_empty(&mut r, "title", json!(opus.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        set_if_empty(&mut r, "cover", json!(opus.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
        let opus_text = extract_dynamic_text_pub(None, opus.get("summary"));
        r.insert("opusSummary".into(), json!(opus_text));
        if !opus_text.is_empty() && r.get("desc").and_then(|d| d.as_str()).unwrap_or("").is_empty() {
            r.insert("desc".into(), json!(opus_text));
        }
        let pics = opus.get("pics").cloned().unwrap_or(json!([]));
        if r.get("cover").and_then(|c| c.as_str()).unwrap_or("").is_empty() {
            let first = pics.as_array().and_then(|a| a.first()).map(|p| {
                p.get("url").and_then(|u| u.as_str())
                    .or_else(|| p.get("src").and_then(|u| u.as_str()))
                    .unwrap_or("").to_string()
            }).unwrap_or_default();
            if !first.is_empty() {
                r.insert("cover".into(), json!(first));
            }
        }
        let has = r.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
        if !has && pics.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
            r.insert("drawItems".into(), json!(draw_items(Some(&pics), true)));
        }
    }

    // 直播推荐
    if let Some(live) = dynamic_module.pointer("/dyn_live_rcmd/card_info/live_play_info") {
        r.insert("liveRoomId".into(), json!(live.get("room_id").map(val_u64).unwrap_or(0)));
        r.insert("liveTitle".into(), json!(live.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("liveCover".into(), json!(live.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("liveOnline".into(), json!(live.get("online").map(val_u64).unwrap_or(0)));
        r.insert("liveArea".into(), json!(live.get("area_name").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("liveLink".into(), json!(live.get("link").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("liveUid".into(), json!(live.get("uid").map(val_u64).unwrap_or(0)));
        if r.get("cover").and_then(|c| c.as_str()).unwrap_or("").is_empty() {
            r.insert("cover".into(), json!(live.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
        }
        if r.get("title").and_then(|t| t.as_str()).unwrap_or("").is_empty() {
            r.insert("title".into(), json!(live.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        }
    }

    // dyn_archive
    let dyn_archive = dynamic_module.get("dyn_archive").cloned().unwrap_or(json!({}));
    if !dyn_archive.get("bvid").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        r.insert("bvid".into(), json!(dyn_archive.get("bvid").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("aid".into(), json!(as_u64_or0(dyn_archive.get("aid"))));
        r.insert("cid".into(), json!(as_u64_or0(dyn_archive.get("cid"))));
        r.insert("title".into(), json!(dyn_archive.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("cover".into(), json!(dyn_archive.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("duration".into(), json!(dyn_archive.get("duration_text").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("play".into(), json!(dyn_archive.pointer("/stat/play").map(val_u64).unwrap_or(0)));
        r.insert("danmaku".into(), json!(dyn_archive.pointer("/stat/danmaku").map(val_u64).unwrap_or(0)));
        let has = r.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
        if !has {
            r.insert("drawItems".into(), json!(draw_items(dyn_archive.get("pics"), false)));
        }
    }

    // 纯文本
    if let Some(text) = major_module.get("text") {
        if r.get("desc").and_then(|d| d.as_str()).unwrap_or("").is_empty() {
            r.insert("desc".into(), json!(extract_dynamic_text_pub(Some(text), None)));
        }
    }

    // Article
    if let Some(article) = major_module.get("article") {
        set_if_empty(&mut r, "title", json!(article.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        let first_cover = article.get("covers").and_then(|c| c.as_array())
            .and_then(|c| c.first()).and_then(|c| c.as_str()).unwrap_or("");
        set_if_empty(&mut r, "cover", json!(first_cover));
        r.insert("articleDesc".into(), json!(article.get("desc").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("articleId".into(), json!(article.get("id").map(val_u64).unwrap_or(0)));
    }

    // 转发内容 orig
    let orig_data = item.get("orig").cloned()
        .or_else(|| dynamic_module.get("orig").cloned())
        .or_else(|| dynamic_module.pointer("/dyn_forward/item").cloned());
    if let Some(orig) = orig_data {
        if !orig.is_null() {
            let orig_modules_raw = orig.get("modules").cloned().unwrap_or(json!({}));
            // orig 只处理 AUTHOR / DYNAMIC 两类（与 up.js 一致）
            let mut orig_modules: Map<String, Value> = Map::new();
            if let Some(arr) = orig_modules_raw.as_array() {
                for m in arr {
                    match m.get("module_type").and_then(|t| t.as_str()).unwrap_or("") {
                        "MODULE_TYPE_AUTHOR" => { orig_modules.insert("module_author".into(), m.get("module_author").cloned().unwrap_or(json!({}))); }
                        "MODULE_TYPE_DYNAMIC" => { orig_modules.insert("module_dynamic".into(), m.get("module_dynamic").cloned().unwrap_or(json!({}))); }
                        _ => {}
                    }
                }
            } else if let Some(obj) = orig_modules_raw.as_object() {
                orig_modules = obj.clone();
            }

            let orig_dynamic = orig_modules.get("module_dynamic").cloned().unwrap_or(json!({}));
            let orig_author = orig_modules.get("module_author").cloned().unwrap_or(json!({}));
            let orig_major = orig_dynamic.get("major").cloned().unwrap_or(json!({}));
            let orig_desc = orig_modules.get("module_desc").filter(|d| !d.is_null())
                .or_else(|| orig_dynamic.get("desc")).cloned().unwrap_or(json!({}));

            // orig id 回退逻辑（与综合动态不同）
            let orig_id = item.pointer("/orig/id_str")
                .or_else(|| item.pointer("/orig/id"))
                .or_else(|| orig.get("id_str"))
                .or_else(|| orig.get("id"))
                .map(|v| match v { Value::String(s) => s.clone(), other => other.to_string() })
                .unwrap_or_default();
            let orig_id = if !orig_id.is_empty() {
                orig_id
            } else if item.get("type").and_then(|t| t.as_str()) == Some("DYNAMIC_TYPE_FORWARD") {
                item.get("id_str").and_then(|v| v.as_str()).unwrap_or("").to_string()
            } else {
                format!("forward_{}", crate::api::now_millis_js())
            };

            let mut o = Map::new();
            o.insert("id".into(), json!(orig_id));
            o.insert("type".into(), json!(orig.get("type").and_then(|v| v.as_str()).unwrap_or("")));
            o.insert(
                "authorName".into(),
                json!(orig_author.pointer("/user/name").and_then(|v| v.as_str())
                    .or_else(|| orig_author.get("name").and_then(|v| v.as_str())).unwrap_or("")),
            );
            o.insert(
                "authorFace".into(),
                json!(orig_author.pointer("/user/face").and_then(|v| v.as_str())
                    .or_else(|| orig_author.get("face").and_then(|v| v.as_str())).unwrap_or("")),
            );
            o.insert("desc".into(), json!(extract_dynamic_text_pub(Some(&orig_desc), None)));

            if let Some(archive) = orig_major.get("archive") {
                o.insert("bvid".into(), json!(archive.get("bvid").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("title".into(), json!(archive.get("title").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("cover".into(), json!(archive.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("duration".into(), json!(archive.get("duration_text").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("play".into(), json!(archive.pointer("/stat/view").map(val_u64).unwrap_or(0)));
                o.insert("danmaku".into(), json!(archive.pointer("/stat/danmaku").map(val_u64).unwrap_or(0)));
            }
            if let Some(items) = orig_major.pointer("/draw/items").and_then(|i| i.as_array()) {
                o.insert("drawItems".into(), json!(items.iter().map(|d| map_pic(d, false)).collect::<Vec<_>>()));
            }
            if let Some(items) = orig_dynamic.pointer("/dyn_draw/items").and_then(|i| i.as_array()) {
                let has = o.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
                if !has {
                    o.insert("drawItems".into(), json!(items.iter().map(|d| map_pic(d, false)).collect::<Vec<_>>()));
                }
            }
            if let Some(pics) = orig_major.get("pics") {
                let has = o.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
                if !has {
                    o.insert("drawItems".into(), json!(draw_items(Some(pics), false)));
                }
            }
            if let Some(article) = orig_major.get("article") {
                set_if_empty(&mut o, "title", json!(article.get("title").and_then(|v| v.as_str()).unwrap_or("")));
                let first_cover = article.get("covers").and_then(|c| c.as_array())
                    .and_then(|c| c.first()).and_then(|c| c.as_str()).unwrap_or("");
                set_if_empty(&mut o, "cover", json!(first_cover));
            }
            if let Some(opus) = orig_major.get("opus") {
                set_if_empty(&mut o, "title", json!(opus.get("title").and_then(|v| v.as_str()).unwrap_or("")));
                set_if_empty(&mut o, "cover", json!(opus.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
                let opus_text = extract_dynamic_text_pub(None, opus.get("summary"));
                if !opus_text.is_empty() && o.get("desc").and_then(|d| d.as_str()).unwrap_or("").is_empty() {
                    o.insert("desc".into(), json!(opus_text));
                }
                let pics = opus.get("pics").cloned().unwrap_or(json!([]));
                let has = o.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
                if !has && pics.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                    o.insert("drawItems".into(), json!(draw_items(Some(&pics), true)));
                }
            }
            if let Some(text) = orig_major.get("text") {
                if o.get("desc").and_then(|d| d.as_str()).unwrap_or("").is_empty() {
                    o.insert("desc".into(), json!(extract_dynamic_text_pub(Some(text), None)));
                }
            }
            r.insert("orig".into(), Value::Object(o));
        }
    }

    Value::Object(r)
}

// ==================== 通道处理函数 ====================

/// fetch-up-info
pub async fn fetch_up_info(args: &[Value]) -> Value {
    let mid = arg_str(args, 0, "");
    match fetch_api(&format!("https://api.bilibili.com/x/web-interface/card?mid={}&photo=true", mid)).await {
        Ok(data) => wrap_ok(data),
        Err(e) => wrap_err(&e),
    }
}

/// fetch-up-relation
pub async fn fetch_up_relation(args: &[Value]) -> Value {
    let mid = arg_str(args, 0, "");
    match fetch_api(&format!("https://api.bilibili.com/x/web-interface/relation?mid={}", mid)).await {
        Ok(data) => {
            if code_of(&data) == 0 {
                if let Some(attr) = data.pointer("/data/relation/attribute") {
                    return json!({ "success": true, "attribute": attr.clone() });
                }
            }
            wrap_err(&data.get("message").and_then(|m| m.as_str()).unwrap_or("获取关注状态失败"))
        }
        Err(e) => wrap_err(&e),
    }
}

/// fetch-up-videos：UP 主视频投稿（type=video 的 space feed）
pub async fn fetch_up_videos(args: &[Value]) -> Value {
    let mid = arg_str(args, 0, "");
    let offset = arg_str(args, 1, "");
    let mut url = format!(
        "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid={}&type=video&ps=100",
        mid
    );
    if !offset.is_empty() {
        url.push_str(&format!("&offset={}", offset));
    }
    match fetch_api(&url).await {
        Ok(data) => wrap_ok(data),
        Err(e) => wrap_err(&e),
    }
}

/// fetch-up-dynamics：UP 主页动态 tab（独立实现）
pub async fn fetch_up_dynamics(args: &[Value]) -> Value {
    let mid = arg_str(args, 0, "");
    let offset = arg_str(args, 1, "");
    let mut url = format!(
        "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid={}&timezone_offset=-480&platform=web&features={}&ps=100",
        mid, UP_DYNAMIC_FEATURES
    );
    if !offset.is_empty() {
        url.push_str(&format!("&offset={}", offset));
    }

    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        let items = result.pointer("/data/items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
        let has_more = result.pointer("/data/has_more").and_then(|h| h.as_bool()).unwrap_or(false);
        // 注意：UP 动态的 nextOffset 取 data.offset（与综合动态的 next_offset 不同）
        let next_offset = result.pointer("/data/offset").and_then(|o| o.as_str()).unwrap_or("").to_string();
        let dynamics: Vec<Value> = items.iter().map(parse_up_dynamic_item).collect();
        return wrap_ok(json!({ "items": dynamics, "has_more": has_more, "offset": next_offset }));
    }
    wrap_err(&result.get("message").and_then(|m| m.as_str()).unwrap_or("获取动态失败"))
}

/// modify-up-relation：关注/取关（WBI 签名 POST）
pub async fn modify_up_relation(args: &[Value]) -> Value {
    let mid = arg_str(args, 0, "");
    let act = args.get(1).map(|v| v.to_string().replace('"', "")).unwrap_or_default();

    let Some((img, sub)) = fetch_wbi_keys().await else {
        return wrap_err("WBI keys not available");
    };
    let mix = get_mix_key(&img, &sub);
    let params = vec![
        ("act".to_string(), act.clone()),
        ("fid".to_string(), mid),
        ("re_src".to_string(), "11".to_string()),
        ("statistics".to_string(), "{\"appId\":112,\"platform\":4}".to_string()),
    ];
    let (w_rid, wts) = sign_params(&params, &mix);
    let mut body = params.clone();
    body.push(("w_rid".to_string(), w_rid));
    body.push(("wts".to_string(), wts.to_string()));
    body.push(("csrf".to_string(), cookie_store::get("bili_jct").unwrap_or_default()));

    match fetch_api_post("https://api.bilibili.com/x/relation/modify", &body).await {
        Ok(result) => {
            let code = code_of(&result);
            json!({
                "success": code == 0 || code == 22014,
                "data": result,
                "already": code == 22014
            })
        }
        Err(e) => wrap_err(&e),
    }
}

/// fetch-up-collections-series：合集与系列列表（WBI 签名）
pub async fn fetch_up_collections_series(args: &[Value]) -> Value {
    let mid = arg_str(args, 0, "");
    let page_num = arg_u64(args, 1, 1);
    let page_size = arg_u64(args, 2, 20);

    let Some((img, sub)) = fetch_wbi_keys().await else {
        return wrap_err("WBI keys not available");
    };
    let mix = get_mix_key(&img, &sub);
    let params = vec![
        ("mid".to_string(), mid.clone()),
        ("page_num".to_string(), page_num.to_string()),
        ("page_size".to_string(), page_size.to_string()),
        ("web_location".to_string(), "bilibili-electron".to_string()),
    ];
    let (w_rid, wts) = sign_params(&params, &mix);
    let url = format!(
        "https://api.bilibili.com/x/space/seasons/series/list?mid={}&page_num={}&page_size={}&web_location=bilibili-electron&w_rid={}&wts={}",
        mid, page_num, page_size, w_rid, wts
    );

    match fetch_api(&url).await {
        Ok(data) => {
            if code_of(&data) == 0 {
                let list_data = data.get("data").and_then(|d| d.get("items_lists")).cloned().unwrap_or(json!({}));
                let seasons = list_data.get("seasons_list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
                let series = list_data.get("series_list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
                let mut all = seasons.clone();
                all.extend(series.clone());
                return wrap_ok(json!({
                    "list": all,
                    "page": list_data.get("page").cloned().unwrap_or(json!({})),
                    "total": seasons.len() + series.len()
                }));
            }
            wrap_err(&data.get("message").and_then(|m| m.as_str()).unwrap_or("获取合集和系列失败"))
        }
        Err(e) => wrap_err(&e),
    }
}

/// fetch-season-archives：合集内容列表（WBI 签名）
pub async fn fetch_season_archives(args: &[Value]) -> Value {
    let mid = arg_str(args, 0, "");
    let season_id = arg_str(args, 1, "");
    let page_num = arg_u64(args, 2, 1);
    let page_size = arg_u64(args, 3, 20);

    let Some((img, sub)) = fetch_wbi_keys().await else {
        return wrap_err("WBI keys not available");
    };
    let mix = get_mix_key(&img, &sub);
    let params = vec![
        ("mid".to_string(), mid.clone()),
        ("season_id".to_string(), season_id.clone()),
        ("sort_reverse".to_string(), "false".to_string()),
        ("page_num".to_string(), page_num.to_string()),
        ("page_size".to_string(), page_size.to_string()),
        ("web_location".to_string(), "bilibili-electron".to_string()),
    ];
    let (w_rid, wts) = sign_params(&params, &mix);
    let url = format!(
        "https://api.bilibili.com/x/space/seasons/archives/list?mid={}&season_id={}&sort_reverse=false&page_num={}&page_size={}&web_location=bilibili-electron&w_rid={}&wts={}",
        mid, season_id, page_num, page_size, w_rid, wts
    );

    match fetch_api(&url).await {
        Ok(data) => {
            if code_of(&data) == 0 {
                return wrap_ok(json!({
                    "list": data.pointer("/data/archives").cloned().unwrap_or(json!([])),
                    "page": data.pointer("/data/page").cloned().unwrap_or(json!({})),
                    "seasonInfo": data.pointer("/data/meta").cloned().unwrap_or(json!({}))
                }));
            }
            wrap_err(&data.get("message").and_then(|m| m.as_str()).unwrap_or("获取合集内容失败"))
        }
        Err(e) => wrap_err(&e),
    }
}
