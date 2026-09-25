// dynamics 模块：对应 Electron 版 src/main/ipc/dynamics.js
// 通道：get-dynamic-nav / get-dynamic-portal / get-all-dynamics /
//       get-user-dynamics / add-to-watchlater / unfollow-up-from-dynamic
//
// ⚠️ 注意：综合动态(get-user-dynamics)与 UP主页动态(fetch-up-dynamics，见 up.rs)
// 是两套独立实现，禁止合并（项目规范）。
use serde_json::{json, Map, Value};

use crate::api::{fetch_api, fetch_api_post, wrap_err, wrap_ok};
use crate::cookie_store;

const DYNAMIC_FEATURES: &str = "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete";

fn code_of(v: &Value) -> i64 {
    v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1)
}

// ==================== 动态文本解析 ====================

fn rich_nodes_to_text(nodes: &[Value]) -> String {
    nodes
        .iter()
        .map(|n| {
            let ntype = n.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let text = n
                .get("text")
                .and_then(|t| t.as_str())
                .or_else(|| n.get("orig_text").and_then(|t| t.as_str()))
                .unwrap_or("");
            match ntype {
                "RICH_TEXT_NODE_TYPE_EMOJI" => {
                    let icon = n.pointer("/emoji/icon_url").and_then(|v| v.as_str()).unwrap_or("");
                    if icon.is_empty() {
                        return text.to_string();
                    }
                    format!(
                        "<img class=\"dynamic-emoji\" src=\"{}\" alt=\"{}\" title=\"{}\">",
                        icon, text, text
                    )
                }
                "RICH_TEXT_NODE_TYPE_TOPIC" => {
                    let topic_id = n.get("rid_str").and_then(|v| v.as_str()).unwrap_or("");
                    format!(
                        "<span class=\"dynamic-topic\" data-topic-id=\"{}\" data-topic-name=\"{}\">{}</span>",
                        topic_id, text, text
                    )
                }
                "RICH_TEXT_NODE_TYPE_AT" => {
                    let uid = n.pointer("/data/uid").map(uid_to_string).unwrap_or_default();
                    format!(
                        "<span class=\"dynamic-at\" data-uid=\"{}\">@{}</span>",
                        uid, text
                    )
                }
                "RICH_TEXT_NODE_TYPE_LINK" => {
                    let link_url = n.pointer("/data/url").and_then(|v| v.as_str()).unwrap_or("");
                    // 视频链接（包含 bvid=）转换为可点击 span
                    if let Some(pos) = link_url.find("bvid=") {
                        let rest = &link_url[pos + 5..];
                        let bvid: String = rest
                            .split(|c| c == '&')
                            .next()
                            .unwrap_or("")
                            .to_string();
                        if !bvid.is_empty() {
                            return format!(
                                "<span class=\"dynamic-video-link\" data-bvid=\"{}\">{}</span>",
                                bvid, text
                            );
                        }
                    }
                    format!(
                        "<a class=\"dynamic-link\" href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\">{}</a>",
                        link_url, text
                    )
                }
                _ => text.to_string(),
            }
        })
        .collect()
}

fn uid_to_string(v: &Value) -> String {
    match v {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => String::new(),
    }
}

/// 对应 extractDynamicText(desc, summary)
fn extract_dynamic_text(desc: Option<&Value>, summary: Option<&Value>) -> String {    if let Some(desc) = desc {
        if let Some(nodes) = desc
            .pointer("/rich_text_nodes")
            .and_then(|n| n.as_array())
        {
            if !nodes.is_empty() {
                return rich_nodes_to_text(nodes);
            }
        }
        if let Some(t) = desc.get("text").and_then(|t| t.as_str()) {
            if !t.is_empty() {
                return t.to_string();
            }
        }
        if let Value::String(s) = desc {
            if !s.is_empty() {
                return s.clone();
            }
        }
    }
    let Some(summary) = summary else {
        return String::new();
    };
    if let Some(t) = summary.get("text").and_then(|t| t.as_str()) {
        return t.to_string();
    }
    if let Some(nodes) = summary
        .get("rich_text_nodes")
        .and_then(|n| n.as_array())
    {
        if !nodes.is_empty() {
            return rich_nodes_to_text(nodes);
        }
    }
    String::new()
}

/// 对应 mapPicItems
fn map_pic_items(pics: Option<&Value>) -> Vec<Value> {
    let Some(arr) = pics.and_then(|p| p.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|pic| {
            let src = pic
                .get("src")
                .and_then(|s| s.as_str())
                .or_else(|| pic.get("url").and_then(|s| s.as_str()))
                .unwrap_or("");
            if src.is_empty() {
                return None;
            }
            Some(json!({
                "src": src,
                "width": pic.get("width").and_then(|w| w.as_u64()).unwrap_or(0),
                "height": pic.get("height").and_then(|h| h.as_u64()).unwrap_or(0)
            }))
        })
        .collect()
}

/// modules 可能是数组（按 module_type 分类）或对象，统一为对象
fn normalize_modules(item: &Value) -> Map<String, Value> {
    let modules = item.get("modules").cloned().unwrap_or(json!({}));
    let mut map = Map::new();
    if let Some(arr) = modules.as_array() {
        for m in arr {
            let mt = m.get("module_type").and_then(|t| t.as_str()).unwrap_or("");
            match mt {
                "MODULE_TYPE_AUTHOR" => {
                    map.insert("module_author".into(), m.get("module_author").cloned().unwrap_or(json!({})));
                }
                "MODULE_TYPE_DYNAMIC" => {
                    map.insert("module_dynamic".into(), m.get("module_dynamic").cloned().unwrap_or(json!({})));
                }
                "MODULE_TYPE_STAT" => {
                    map.insert("module_stat".into(), m.get("module_stat").cloned().unwrap_or(json!({})));
                }
                "MODULE_TYPE_DESC" => {
                    map.insert("module_desc".into(), m.get("module_desc").cloned().unwrap_or(json!({})));
                }
                _ => {}
            }
        }
    } else if let Some(obj) = modules.as_object() {
        map = obj.clone();
    }
    map
}

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

fn insert_draw_items(obj: &mut Map<String, Value>, items: Vec<Value>) {
    let has_draw = obj
        .get("drawItems")
        .and_then(|d| d.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    if !has_draw && !items.is_empty() {
        let thumb = items
            .first()
            .and_then(|i| i.get("src"))
            .cloned()
            .unwrap_or(Value::Null);
        obj.insert("drawItems".into(), Value::Array(items));
        set_if_empty(obj, "thumbnail", thumb.clone());
        set_if_empty(obj, "cover", thumb);
    }
}

/// 对应 parseDynamicItem：动态卡片数据归一化
pub fn parse_dynamic_item(item: &Value) -> Value {
    let modules = normalize_modules(item);
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
    let dyn_stat = dynamic_module.get("stat").cloned().unwrap_or(json!({}));

    let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");

    let mut r = Map::new();
    r.insert(
        "id".into(),
        json!(item.get("id_str").and_then(|v| v.as_str())
            .or_else(|| item.get("dynamic_id_str").and_then(|v| v.as_str()))
            .unwrap_or("")),
    );
    r.insert("type".into(), json!(item_type));
    // 作者信息可能在 user 对象里，也可能直接在 authorModule 里
    r.insert(
        "authorName".into(),
        json!(author_module.pointer("/user/name").and_then(|v| v.as_str())
            .or_else(|| author_module.get("name").and_then(|v| v.as_str()))
            .unwrap_or("")),
    );
    r.insert(
        "authorFace".into(),
        json!(author_module.pointer("/user/face").and_then(|v| v.as_str())
            .or_else(|| author_module.get("face").and_then(|v| v.as_str()))
            .unwrap_or("")),
    );
    r.insert(
        "authorMid".into(),
        json!(author_module.pointer("/user/mid").map(val_u64)
            .or_else(|| Some(as_u64_or0(author_module.get("mid"))))
            .unwrap_or(0)),
    );
    r.insert("pubTs".into(), json!(as_u64_or0(author_module.get("pub_ts"))));
    r.insert(
        "pubTime".into(),
        json!(author_module.get("pub_text").and_then(|v| v.as_str())
            .or_else(|| author_module.get("pub_time").and_then(|v| v.as_str()))
            .unwrap_or("")),
    );
    r.insert("desc".into(), json!(extract_dynamic_text(Some(&desc), None)));
    // like/comment/forward：statModule.xxx?.count ?? dynStat.xxx ?? 0
    r.insert(
        "like".into(),
        json!(stat_module.pointer("/like/count").map(val_u64)
            .or_else(|| Some(as_u64_or0(dyn_stat.get("like"))))
            .unwrap_or(0)),
    );
    r.insert(
        "comment".into(),
        json!(stat_module.pointer("/comment/count").map(val_u64)
            .or_else(|| Some(as_u64_or0(dyn_stat.get("comment"))))
            .unwrap_or(0)),
    );
    r.insert(
        "forward_count".into(),
        json!(stat_module.pointer("/forward/count").map(val_u64)
            .or_else(|| Some(as_u64_or0(dyn_stat.get("forward"))))
            .unwrap_or(0)),
    );
    r.insert("bvid".into(), json!(""));
    r.insert("aid".into(), json!(0));
    r.insert("cid".into(), json!(0));
    r.insert("title".into(), json!(""));
    r.insert("thumbnail".into(), json!(""));
    r.insert("cover".into(), json!(""));
    r.insert("duration".into(), json!(""));
    r.insert("play".into(), json!(0));
    r.insert("danmaku".into(), json!(0));
    r.insert("drawItems".into(), json!([]));

    // 直播推荐动态
    if let Some(live) = dynamic_module
        .pointer("/dyn_live_rcmd/card_info/live_play_info")
    {
        r.insert("liveRoomId".into(), json!(live.get("room_id").map(val_u64).unwrap_or(0)));
        r.insert("liveTitle".into(), json!(live.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("liveCover".into(), json!(live.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("liveOnline".into(), json!(live.get("online").map(val_u64).unwrap_or(0)));
        r.insert("liveArea".into(), json!(live.get("area_name").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("liveLink".into(), json!(live.get("link").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("liveUid".into(), json!(live.get("uid").map(val_u64).unwrap_or(0)));
        let cover = live.get("cover").and_then(|v| v.as_str()).unwrap_or("");
        let title = live.get("title").and_then(|v| v.as_str()).unwrap_or("");
        if r.get("cover").and_then(|c| c.as_str()).unwrap_or("").is_empty() {
            r.insert("cover".into(), json!(cover));
            r.insert("thumbnail".into(), json!(cover));
        }
        if r.get("title").and_then(|t| t.as_str()).unwrap_or("").is_empty() {
            r.insert("title".into(), json!(title));
        }
    }

    // dyn_archive 字段
    let dyn_archive = dynamic_module.get("dyn_archive").cloned().unwrap_or(json!({}));
    if let Some(bvid) = dyn_archive.get("bvid").and_then(|v| v.as_str()) {
        if !bvid.is_empty() {
            r.insert("bvid".into(), json!(bvid));
            r.insert("aid".into(), json!(as_u64_or0(dyn_archive.get("aid"))));
            r.insert("cid".into(), json!(as_u64_or0(dyn_archive.get("cid"))));
            r.insert("title".into(), json!(dyn_archive.get("title").and_then(|v| v.as_str()).unwrap_or("")));
            let cover = dyn_archive.get("cover").and_then(|v| v.as_str()).unwrap_or("");
            r.insert("cover".into(), json!(cover));
            r.insert("thumbnail".into(), json!(cover));
            r.insert("duration".into(), json!(dyn_archive.get("duration_text").and_then(|v| v.as_str()).unwrap_or("")));
            r.insert("play".into(), json!(dyn_archive.pointer("/stat/play").map(val_u64).unwrap_or(0)));
            r.insert("danmaku".into(), json!(dyn_archive.pointer("/stat/danmaku").map(val_u64).unwrap_or(0)));
        }
    }

    // major.archive
    if let Some(archive) = major_module.get("archive") {
        set_if_empty(&mut r, "bvid", json!(archive.get("bvid").and_then(|v| v.as_str()).unwrap_or("")));
        set_if_empty(&mut r, "aid", json!(as_u64_or0(archive.get("aid"))));
        set_if_empty(&mut r, "cid", json!(as_u64_or0(archive.get("cid"))));
        set_if_empty(&mut r, "title", json!(archive.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        let cover = archive.get("cover").and_then(|v| v.as_str()).unwrap_or("");
        set_if_empty(&mut r, "cover", json!(cover));
        set_if_empty(&mut r, "thumbnail", json!(cover));
        set_if_empty(&mut r, "duration", json!(archive.get("duration_text").and_then(|v| v.as_str()).unwrap_or("")));
        set_if_empty(&mut r, "play", json!(archive.pointer("/stat/view").map(val_u64).unwrap_or(0)));
        set_if_empty(&mut r, "danmaku", json!(archive.pointer("/stat/danmaku").map(val_u64).unwrap_or(0)));
    }

    // major.draw
    if let Some(items) = major_module.pointer("/draw/items").and_then(|i| i.as_array()) {
        insert_draw_items(&mut r, map_pic_items(Some(&Value::Array(items.clone()))));
    }
    // dyn_draw
    if let Some(items) = dynamic_module.pointer("/dyn_draw/items").and_then(|i| i.as_array()) {
        insert_draw_items(&mut r, map_pic_items(Some(&Value::Array(items.clone()))));
    }
    // major.pics
    if let Some(pics) = major_module.get("pics") {
        insert_draw_items(&mut r, map_pic_items(Some(pics)));
    }
    // dynArchive.pics
    if let Some(pics) = dyn_archive.get("pics") {
        insert_draw_items(&mut r, map_pic_items(Some(pics)));
    }

    // major.opus
    if let Some(opus) = major_module.get("opus") {
        set_if_empty(&mut r, "title", json!(opus.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        set_if_empty(&mut r, "cover", json!(opus.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
        let opus_text = extract_dynamic_text(None, opus.get("summary"));
        r.insert("opusSummary".into(), json!(opus_text));
        if !opus_text.is_empty()
            && r.get("desc").and_then(|d| d.as_str()).unwrap_or("").is_empty()
        {
            r.insert("desc".into(), json!(opus_text));
        }
        let pics = opus.get("pics").cloned().unwrap_or(json!([]));
        let pics_arr = pics.as_array().cloned().unwrap_or_default();
        let first_pic_url = pics_arr
            .first()
            .map(|p| {
                p.get("url")
                    .and_then(|u| u.as_str())
                    .or_else(|| p.get("src").and_then(|u| u.as_str()))
                    .unwrap_or("")
                    .to_string()
            })
            .unwrap_or_default();
        if r.get("cover").and_then(|c| c.as_str()).unwrap_or("").is_empty() && !first_pic_url.is_empty() {
            r.insert("cover".into(), json!(first_pic_url));
        }
        let has_draw = r
            .get("drawItems")
            .and_then(|d| d.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(true);
        if has_draw && !pics_arr.is_empty() {
            insert_draw_items(&mut r, map_pic_items(Some(&pics)));
        } else {
            let cover_now = r.get("cover").cloned().unwrap_or(json!(""));
            set_if_empty(&mut r, "thumbnail", cover_now);
        }
    }

    // major.article
    if let Some(article) = major_module.get("article") {
        set_if_empty(&mut r, "title", json!(article.get("title").and_then(|v| v.as_str()).unwrap_or("")));
        let first_cover = article
            .get("covers")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.as_str())
            .unwrap_or("");
        set_if_empty(&mut r, "cover", json!(first_cover));
        let cover_now = r.get("cover").cloned().unwrap_or(json!(""));
        set_if_empty(&mut r, "thumbnail", cover_now);
        r.insert("articleDesc".into(), json!(article.get("desc").and_then(|v| v.as_str()).unwrap_or("")));
        r.insert("articleId".into(), json!(article.get("id").map(val_u64).unwrap_or(0)));
    }

    // 转发动态：item.orig / dynamicModule.orig / dyn_forward.item
    let orig_data = item
        .get("orig")
        .cloned()
        .or_else(|| dynamic_module.get("orig").cloned())
        .or_else(|| dynamic_module.pointer("/dyn_forward/item").cloned());
    if let Some(orig) = orig_data {
        if !orig.is_null() {
            let orig_modules = normalize_modules(&orig);
            let orig_dynamic = orig_modules.get("module_dynamic").cloned().unwrap_or(json!({}));
            let orig_author = orig_modules.get("module_author").cloned().unwrap_or(json!({}));
            let orig_major = orig_dynamic.get("major").cloned().unwrap_or(json!({}));
            let orig_desc = orig_dynamic.get("desc").cloned().unwrap_or(json!({}));

            let mut o = Map::new();
            o.insert("id".into(), json!(orig.get("id_str").and_then(|v| v.as_str()).unwrap_or("")));
            o.insert("type".into(), json!(orig.get("type").and_then(|v| v.as_str()).unwrap_or("")));
            o.insert(
                "authorName".into(),
                json!(orig_author.pointer("/user/name").and_then(|v| v.as_str())
                    .or_else(|| orig_author.get("name").and_then(|v| v.as_str()))
                    .unwrap_or("")),
            );
            o.insert(
                "authorFace".into(),
                json!(orig_author.pointer("/user/face").and_then(|v| v.as_str())
                    .or_else(|| orig_author.get("face").and_then(|v| v.as_str()))
                    .unwrap_or("")),
            );
            o.insert(
                "authorMid".into(),
                json!(orig_author.pointer("/user/mid").map(val_u64)
                    .or_else(|| Some(as_u64_or0(orig_author.get("mid"))))
                    .unwrap_or(0)),
            );
            o.insert("desc".into(), json!(extract_dynamic_text(Some(&orig_desc), None)));
            o.insert("bvid".into(), json!(""));
            o.insert("cid".into(), json!(0));
            o.insert("title".into(), json!(""));
            o.insert("cover".into(), json!(""));
            o.insert("duration".into(), json!(""));
            o.insert("play".into(), json!(0));
            o.insert("danmaku".into(), json!(0));

            if let Some(archive) = orig_major.get("archive") {
                o.insert("bvid".into(), json!(archive.get("bvid").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("cid".into(), json!(as_u64_or0(archive.get("cid"))));
                o.insert("title".into(), json!(archive.get("title").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("cover".into(), json!(archive.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("duration".into(), json!(archive.get("duration_text").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("play".into(), json!(archive.pointer("/stat/view").map(val_u64).unwrap_or(0)));
                o.insert("danmaku".into(), json!(archive.pointer("/stat/danmaku").map(val_u64).unwrap_or(0)));
            }
            // orig 的 dyn_archive
            let orig_dyn_archive = orig_dynamic.get("dyn_archive").cloned().unwrap_or(json!({}));
            if !orig_dyn_archive
                .get("bvid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .is_empty()
                && o.get("bvid").and_then(|b| b.as_str()).unwrap_or("").is_empty()
            {
                o.insert("bvid".into(), json!(orig_dyn_archive.get("bvid").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("cid".into(), json!(as_u64_or0(orig_dyn_archive.get("cid"))));
                o.insert("title".into(), json!(orig_dyn_archive.get("title").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("cover".into(), json!(orig_dyn_archive.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("duration".into(), json!(orig_dyn_archive.get("duration_text").and_then(|v| v.as_str()).unwrap_or("")));
                o.insert("play".into(), json!(orig_dyn_archive.pointer("/stat/play").map(val_u64).unwrap_or(0)));
                o.insert("danmaku".into(), json!(orig_dyn_archive.pointer("/stat/danmaku").map(val_u64).unwrap_or(0)));
            }
            if let Some(items) = orig_major.pointer("/draw/items").and_then(|i| i.as_array()) {
                o.insert("drawItems".into(), json!(map_pic_items(Some(&Value::Array(items.clone())))));
            }
            if let Some(items) = orig_dynamic.pointer("/dyn_draw/items").and_then(|i| i.as_array()) {
                let has = o.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
                if !has {
                    o.insert("drawItems".into(), json!(map_pic_items(Some(&Value::Array(items.clone())))));
                }
            }
            if let Some(pics) = orig_major.get("pics") {
                let has = o.get("drawItems").and_then(|d| d.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
                if !has {
                    o.insert("drawItems".into(), json!(map_pic_items(Some(pics))));
                }
            }
            if let Some(article) = orig_major.get("article") {
                set_if_empty(&mut o, "title", json!(article.get("title").and_then(|v| v.as_str()).unwrap_or("")));
                let first_cover = article
                    .get("covers")
                    .and_then(|c| c.as_array())
                    .and_then(|c| c.first())
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                set_if_empty(&mut o, "cover", json!(first_cover));
            }
            if let Some(opus) = orig_major.get("opus") {
                set_if_empty(&mut o, "title", json!(opus.get("title").and_then(|v| v.as_str()).unwrap_or("")));
                set_if_empty(&mut o, "cover", json!(opus.get("cover").and_then(|v| v.as_str()).unwrap_or("")));
                let opus_text = extract_dynamic_text(None, opus.get("summary"));
                if !opus_text.is_empty()
                    && o.get("desc").and_then(|d| d.as_str()).unwrap_or("").is_empty()
                {
                    o.insert("desc".into(), json!(opus_text));
                }
                let pics = opus.get("pics").cloned().unwrap_or(json!([]));
                let has_draw = o.get("drawItems").and_then(|d| d.as_array()).map(|a| a.is_empty()).unwrap_or(true);
                if has_draw && pics.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                    o.insert("drawItems".into(), json!(map_pic_items(Some(&pics))));
                }
                if o.get("cover").and_then(|c| c.as_str()).unwrap_or("").is_empty() {
                    let first = pics
                        .as_array()
                        .and_then(|a| a.first())
                        .map(|p| {
                            p.get("url")
                                .and_then(|u| u.as_str())
                                .or_else(|| p.get("src").and_then(|u| u.as_str()))
                                .unwrap_or("")
                                .to_string()
                        })
                        .unwrap_or_default();
                    if !first.is_empty() {
                        o.insert("cover".into(), json!(first));
                    }
                }
            }
            r.insert("orig".into(), Value::Object(o));
        }
    }

    // 纯文本动态 majorModule.text
    if let Some(text) = major_module.get("text") {
        if r.get("desc").and_then(|d| d.as_str()).unwrap_or("").is_empty() {
            r.insert("desc".into(), json!(extract_dynamic_text(Some(text), None)));
        }
    }

    Value::Object(r)
}

/// 供 up.rs 复用的公开包装（两个动态页面各自独立解析，但文本提取逻辑相同）
pub fn extract_dynamic_text_pub(desc: Option<&Value>, summary: Option<&Value>) -> String {
    extract_dynamic_text(desc, summary)
}

/// 供 up.rs 复用的 modules 归一化
pub fn normalize_modules_pub(item: &Value) -> Map<String, Value> {
    normalize_modules(item)
}

// ==================== 通道处理函数 ====================

/// get-dynamic-nav
pub async fn get_dynamic_nav(_args: &[Value]) -> Value {
    let url = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/nav?wts=1746216000&w_rid=abcdef1234567890abcdef12345678";
    let result = match fetch_api(url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        if let Some(data) = result.get("data") {
            return wrap_ok(data.clone());
        }
    }
    wrap_err(
        result
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("获取动态导航失败"),
    )
}

/// get-dynamic-portal：关注列表 + 更新标记合并
pub async fn get_dynamic_portal(_args: &[Value]) -> Value {
    let vmid = match cookie_store::get("DedeUserID") {
        Some(v) if !v.is_empty() => v,
        _ => return wrap_err("未登录"),
    };

    // 关注列表（全量分页，最多 20 页）
    let mut all_followings: Vec<Value> = Vec::new();
    let (mut pn, ps) = (1u64, 50u64);
    let mut has_more = true;
    while has_more && pn <= 20 {
        let url = format!(
            "https://api.bilibili.com/x/relation/followings?vmid={}&pn={}&ps={}&order=desc",
            vmid, pn, ps
        );
        let result = match fetch_api(&url).await {
            Ok(r) => r,
            Err(_) => break,
        };
        if code_of(&result) == 0 {
            let list = result
                .pointer("/data/list")
                .and_then(|l| l.as_array())
                .cloned()
                .unwrap_or_default();
            has_more = list.len() as u64 == ps;
            all_followings.extend(list);
            pn += 1;
        } else {
            has_more = false;
        }
    }

    // 动态门户 uplist（has_update 标记）
    let uplist: Vec<Value> = match fetch_api("https://api.bilibili.com/x/polymer/web-dynamic/v1/uplist").await {
        Ok(r) if code_of(&r) == 0 => r
            .pointer("/data/items")
            .or_else(|| r.pointer("/data/up_list"))
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    let mut update_map: Map<String, Value> = Map::new();
    for item in &uplist {
        if let Some(mid) = item.get("mid") {
            update_map.insert(
                uid_to_string(mid),
                json!(item.get("has_update").and_then(|v| v.as_bool()).unwrap_or(false)),
            );
        }
    }

    let mut merged: Vec<Value> = all_followings
        .iter()
        .map(|item| {
            let mid = item.get("mid").cloned().unwrap_or(Value::Null);
            json!({
                "mid": mid,
                "uname": item.get("uname").cloned().unwrap_or(Value::Null),
                "face": item.get("face").cloned().unwrap_or(Value::Null),
                "official_verify": item.get("official_verify").cloned().unwrap_or(Value::Null),
                "vip": item.get("vip").cloned().unwrap_or(Value::Null),
                "has_update": update_map.get(&uid_to_string(&mid)).and_then(|v| v.as_bool()).unwrap_or(false)
            })
        })
        .collect();
    // 有更新的排在前面（稳定排序，与 JS sort 语义一致）
    merged.sort_by_key(|v| {
        !v.get("has_update")
            .and_then(|h| h.as_bool())
            .unwrap_or(false)
    });

    wrap_ok(json!({ "items": merged }))
}

/// 动态 feed 通用响应处理（all 与 space 共用解析逻辑）
async fn fetch_dynamics_feed(url: &str) -> Value {
    let result = match fetch_api(url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        let items = result
            .pointer("/data/items")
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default();
        let has_more = result.pointer("/data/has_more").and_then(|h| h.as_bool()).unwrap_or(false);
        let next_offset = result
            .pointer("/data/next_offset")
            .and_then(|o| o.as_str())
            .unwrap_or("")
            .to_string();

        let dynamics: Vec<Value> = items.iter().map(parse_dynamic_item).collect();

        let mut actual_next_offset = next_offset;
        if actual_next_offset.is_empty() {
            if let Some(last) = items.last() {
                actual_next_offset = last
                    .get("id_str")
                    .and_then(|v| v.as_str())
                    .or_else(|| last.get("dynamic_id_str").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
            }
        }

        return wrap_ok(json!({
            "items": dynamics,
            "has_more": has_more,
            "next_offset": actual_next_offset
        }));
    }
    wrap_err(
        result
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("获取动态失败"),
    )
}

/// get-all-dynamics
pub async fn get_all_dynamics(args: &[Value]) -> Value {
    let offset = args
        .first()
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let url = format!(
        "https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/all?page=1&update_baseline=&offset={}&host_mid=0&timezone_offset=-480&build=11706&platform=web&device=win&mobi_app=pc_electron&features={}&ps=100",
        offset, DYNAMIC_FEATURES
    );
    fetch_dynamics_feed(&url).await
}

/// get-user-dynamics（综合动态页面）
pub async fn get_user_dynamics(args: &[Value]) -> Value {
    let up_mid = args.first().map(uid_to_string).unwrap_or_default();
    let offset = args
        .get(1)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let type_ = args
        .get(2)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let url = if !up_mid.is_empty() && up_mid != "null" && up_mid != "0" {
        let mut u = format!(
            "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid={}&timezone_offset=-480&platform=web&features={}&ps=100",
            up_mid, DYNAMIC_FEATURES
        );
        if !type_.is_empty() {
            u.push_str(&format!("&type={}", type_));
        }
        if !offset.is_empty() {
            u.push_str(&format!("&offset={}", offset));
        }
        u
    } else {
        format!(
            "https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/all?page=1&update_baseline=&offset={}&host_mid=0&timezone_offset=-480&build=11706&platform=web&device=win&mobi_app=pc_electron&features={}&ps=100",
            offset, DYNAMIC_FEATURES
        )
    };
    fetch_dynamics_feed(&url).await
}

/// add-to-watchlater：加入稍后再看
pub async fn add_to_watchlater(args: &[Value]) -> Value {
    let bvid = args.first().and_then(|v| v.as_str()).unwrap_or("");
    let csrf = cookie_store::get("bili_jct").unwrap_or_default();
    let body = vec![
        ("bvid".to_string(), bvid.to_string()),
        ("csrf".to_string(), csrf),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v2/history/toview/add", &body).await {
        Ok(result) => json!({
            "success": code_of(&result) == 0,
            "data": result
        }),
        Err(e) => wrap_err(&e),
    }
}

/// unfollow-up-from-dynamic：取消关注
pub async fn unfollow_up_from_dynamic(args: &[Value]) -> Value {
    let mid = args.first().map(uid_to_string).unwrap_or_default();
    let csrf = cookie_store::get("bili_jct").unwrap_or_default();
    let body = vec![
        ("fmid".to_string(), mid),
        ("act".to_string(), "2".to_string()),
        ("csrf".to_string(), csrf),
    ];
    match fetch_api_post("https://api.bilibili.com/x/relation/modify", &body).await {
        Ok(result) => json!({
            "success": code_of(&result) == 0,
            "data": result
        }),
        Err(e) => wrap_err(&e),
    }
}
