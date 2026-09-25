// favorites 模块：对应 Electron 版 src/main/ipc/favorites.js
// 通道：get-favorites-list / get-favorites-created / get-favorites /
//       get-favorites-collected / get-favorites-collected-detail / get-toview /
//       get-favorites-folders / unfavorite-video / add-to-favorites /
//       add-favorite-folder / delete-favorites-folder / sort-favorites /
//       clean-favorites-expired / edit-favorites-folder
use serde_json::{json, Value};

use crate::api::{
    fetch_api, fetch_api_post, fetch_wbi_keys, get_mix_key, sign_params, wrap_err, wrap_ok,
};
use crate::cookie_store;

fn code_of(v: &Value) -> i64 {
    v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1)
}

fn msg_of(v: &Value, default: &str) -> String {
    v.get("message")
        .and_then(|m| m.as_str())
        .unwrap_or(default)
        .to_string()
}

fn arg_u64(args: &[Value], idx: usize, default: u64) -> u64 {
    args.get(idx)
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                .or_else(|| v.as_f64().map(|f| f as u64))
        })
        .unwrap_or(default)
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

/// 收藏夹对象映射（get-favorites-list / get-favorites-created 共用）
fn map_folder(item: &Value) -> Value {
    json!({
        "id": item.get("id").cloned().unwrap_or(json!("")),
        "mid": item.get("mid").cloned().unwrap_or(json!("")),
        "name": item.get("title").and_then(|v| v.as_str())
            .or_else(|| item.get("name").and_then(|v| v.as_str())).unwrap_or(""),
        "cover": item.get("cover").and_then(|v| v.as_str()).unwrap_or(""),
        "media_count": item.get("media_count").and_then(|v| v.as_u64()).unwrap_or(0),
        "attr": item.get("attr").and_then(|v| v.as_u64()).unwrap_or(0),
        "fid": item.get("fid").cloned().unwrap_or(json!("")),
        "type": item.get("type").and_then(|v| v.as_u64()).unwrap_or(0),
        "upper": item.get("upper").cloned().unwrap_or(Value::Null),
        "ctime": item.get("ctime").and_then(|v| v.as_u64()).unwrap_or(0),
        "mtime": item.get("mtime").and_then(|v| v.as_u64()).unwrap_or(0)
    })
}

fn media_list_of(result: &Value) -> Vec<Value> {
    result
        .pointer("/data/medias")
        .or_else(|| result.pointer("/data/list"))
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default()
}

/// get-favorites-list
pub async fn get_favorites_list(_args: &[Value]) -> Value {
    let url = "https://api.bilibili.com/x/v3/fav/folder/list?up_mid=&platform=web&web_location=333.1387";
    let result = match fetch_api(url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        if let Some(list) = result.pointer("/data/list").and_then(|l| l.as_array()) {
            return json!({
                "success": true,
                "data": list.iter().map(map_folder).collect::<Vec<_>>(),
                "hasMore": result.pointer("/data/has_more").and_then(|h| h.as_bool()).unwrap_or(false),
                "total": result.pointer("/data/total").and_then(|t| t.as_u64())
                    .unwrap_or(list.len() as u64)
            });
        }
    }
    wrap_err(&msg_of(&result, "获取收藏夹列表失败"))
}

/// get-favorites-created：我创建的收藏夹（WBI 签名，过滤默认收藏夹）
pub async fn get_favorites_created(_args: &[Value]) -> Value {
    let up_mid = match cookie_store::get("DedeUserID") {
        Some(v) if !v.is_empty() => v,
        _ => return wrap_err("用户未登录"),
    };

    let params = vec![
        ("up_mid".to_string(), up_mid.clone()),
        ("ps".to_string(), "200".to_string()),
        ("pn".to_string(), "1".to_string()),
        ("platform".to_string(), "pc".to_string()),
        ("web_location".to_string(), "bilibili-electron".to_string()),
    ];
    let Some((img, sub)) = fetch_wbi_keys().await else {
        return wrap_err("WBI签名不可用");
    };
    let mix = get_mix_key(&img, &sub);
    let (w_rid, wts) = sign_params(&params, &mix);

    let url = format!(
        "https://api.bilibili.com/x/v3/fav/folder/created/list?up_mid={}&ps=200&pn=1&platform=pc&web_location=bilibili-electron&w_rid={}&wts={}",
        up_mid, w_rid, wts
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        let folders: Vec<Value> = result
            .pointer("/data/list")
            .or_else(|| result.get("data"))
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        // 过滤 fid 为 0 与名称为"默认收藏夹"的文件夹
        let filtered: Vec<&Value> = folders
            .iter()
            .filter(|item| {
                let fid = item.get("fid").cloned().unwrap_or_else(|| item.get("id").cloned().unwrap_or(json!(0)));
                let fid_str = match &fid {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => "0".to_string(),
                };
                let title = item.get("title").and_then(|v| v.as_str())
                    .or_else(|| item.get("name").and_then(|v| v.as_str()))
                    .unwrap_or("");
                fid_str != "0" && title != "默认收藏夹"
            })
            .collect();
        return json!({
            "success": true,
            "data": filtered.iter().map(|i| map_folder(i)).collect::<Vec<_>>(),
            "hasMore": result.pointer("/data/has_more").and_then(|h| h.as_bool()).unwrap_or(false),
            "total": result.pointer("/data/total").and_then(|t| t.as_u64())
                .unwrap_or(filtered.len() as u64)
        });
    }
    wrap_err(&msg_of(&result, "获取我创建的收藏夹失败"))
}

/// get-favorites：收藏夹内容
pub async fn get_favorites(args: &[Value]) -> Value {
    let media_id_raw = args.first().cloned().unwrap_or(Value::Null);
    // mediaId 为 null/undefined 时报错（0 合法）
    if media_id_raw.is_null() {
        return wrap_err("缺少收藏夹ID");
    }
    let media_id = arg_str(args, 0, "");
    let page_num = arg_u64(args, 1, 1);
    let page_size = arg_u64(args, 2, 36);
    let keyword = arg_str(args, 3, "");

    let url = format!(
        "https://api.bilibili.com/x/v3/fav/resource/list?media_id={}&pn={}&ps={}&keyword={}&order=mtime&type=0&tid=0&platform=web&web_location=333.1387",
        media_id,
        page_num,
        page_size,
        crate::api::enc(&keyword)
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        let medias = media_list_of(&result);
        let has_more = result.pointer("/data/has_more").and_then(|h| h.as_bool()).unwrap_or(false);
        let data: Vec<Value> = medias
            .iter()
            .map(|item| {
                // item.id 是收藏条目内部ID；aid 必须取 resource.aid / item.aid
                let resource = item.get("resource").filter(|r| !r.is_null()).unwrap_or(item);
                json!({
                    "id": item.get("id").cloned().unwrap_or(json!(0)),
                    "aid": resource.get("aid").map(|v| v.clone()).unwrap_or_else(|| item.get("aid").cloned().unwrap_or(json!(0))),
                    "bvid": resource.get("bvid").and_then(|v| v.as_str())
                        .or_else(|| resource.get("bv_id").and_then(|v| v.as_str())).unwrap_or(""),
                    "title": item.get("title").and_then(|v| v.as_str())
                        .or_else(|| resource.get("title").and_then(|v| v.as_str())).unwrap_or(""),
                    "pic": item.get("cover").and_then(|v| v.as_str())
                        .or_else(|| resource.get("cover").and_then(|v| v.as_str())).unwrap_or(""),
                    "duration": item.get("duration").cloned()
                        .or_else(|| resource.get("duration").cloned()).unwrap_or(json!(0)),
                    "upper": item.get("upper").cloned().unwrap_or_else(|| resource.get("upper").cloned().unwrap_or(Value::Null)),
                    "cnt_info": item.get("cnt_info").cloned().unwrap_or_else(|| resource.get("cnt_info").cloned().unwrap_or(Value::Null)),
                    "page": item.get("page").cloned().unwrap_or_else(|| resource.get("page").cloned().unwrap_or(json!(1))),
                    "intro": item.get("intro").and_then(|v| v.as_str())
                        .or_else(|| resource.get("intro").and_then(|v| v.as_str())).unwrap_or(""),
                    "ctime": item.get("ctime").cloned().unwrap_or_else(|| resource.get("ctime").cloned().unwrap_or(json!(0))),
                    "pubtime": item.get("pubtime").cloned().unwrap_or_else(|| resource.get("pubtime").cloned().unwrap_or(json!(0))),
                    "fav_time": item.get("fav_time").cloned().unwrap_or(json!(0)),
                    "media_id": media_id_raw
                })
            })
            .collect();
        return json!({
            "success": true,
            "data": data,
            "hasMore": has_more,
            "nextPage": if has_more { json!(page_num + 1) } else { Value::Null },
            "mediaInfo": result.pointer("/data/info").cloned().unwrap_or(Value::Null)
        });
    }
    wrap_err(&msg_of(&result, "获取收藏失败"))
}

/// get-favorites-collected：收藏与订阅
pub async fn get_favorites_collected(args: &[Value]) -> Value {
    let up_mid = arg_str(args, 0, "");
    let page_num = arg_u64(args, 1, 1);
    let page_size = arg_u64(args, 2, 20);

    let url = format!(
        "https://api.bilibili.com/x/v3/fav/folder/collected/list?up_mid={}&ps={}&pn={}&platform=web&web_location=333.1387",
        up_mid, page_size, page_num
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        let list = result.pointer("/data/list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
        let data: Vec<Value> = list
            .iter()
            .map(|item| {
                json!({
                    "id": item.get("id").cloned().unwrap_or(json!("")),
                    "mid": item.get("mid").cloned().unwrap_or(json!("")),
                    "name": item.get("title").and_then(|v| v.as_str())
                        .or_else(|| item.get("name").and_then(|v| v.as_str())).unwrap_or(""),
                    "cover": item.get("cover").and_then(|v| v.as_str()).unwrap_or(""),
                    "media_count": item.get("media_count").and_then(|v| v.as_u64()).unwrap_or(0),
                    "attr": item.get("attr").and_then(|v| v.as_u64()).unwrap_or(0),
                    "fid": item.get("fid").cloned().unwrap_or(json!("")),
                    "upper": item.get("upper").cloned().unwrap_or(Value::Null),
                    "ctime": item.get("ctime").and_then(|v| v.as_u64()).unwrap_or(0),
                    "mtime": item.get("mtime").and_then(|v| v.as_u64()).unwrap_or(0),
                    "sub_time": item.get("sub_time").and_then(|v| v.as_u64()).unwrap_or(0),
                    "count": item.get("count").and_then(|v| v.as_u64())
                        .or_else(|| item.get("media_count").and_then(|v| v.as_u64())).unwrap_or(0)
                })
            })
            .collect();
        let has_more = result.pointer("/data/has_more").and_then(|h| h.as_bool())
            .unwrap_or(list.len() as u64 >= page_size);
        return json!({
            "success": true,
            "data": data,
            "hasMore": has_more,
            "nextPage": if result.pointer("/data/has_more").and_then(|h| h.as_bool()).unwrap_or(false) { json!(page_num + 1) } else { Value::Null },
            "total": result.pointer("/data/total").and_then(|t| t.as_u64()).unwrap_or(list.len() as u64)
        });
    }
    wrap_err(&msg_of(&result, "获取收藏与订阅失败"))
}

/// get-favorites-collected-detail：收藏合集详情（WBI 签名）
pub async fn get_favorites_collected_detail(args: &[Value]) -> Value {
    let season_id = arg_str(args, 0, "");
    let page_num = arg_u64(args, 1, 1);
    let page_size = arg_u64(args, 2, 36);

    let params = vec![
        ("season_id".to_string(), season_id.clone()),
        ("ps".to_string(), page_size.to_string()),
        ("pn".to_string(), page_num.to_string()),
        ("platform".to_string(), "web".to_string()),
        ("web_location".to_string(), "bilibili-electron".to_string()),
    ];
    let Some((img, sub)) = fetch_wbi_keys().await else {
        return wrap_err("WBI签名不可用");
    };
    let mix = get_mix_key(&img, &sub);
    let (w_rid, wts) = sign_params(&params, &mix);

    let url = format!(
        "https://api.bilibili.com/x/space/fav/season/list?season_id={}&ps={}&pn={}&platform=web&web_location=bilibili-electron&w_rid={}&wts={}",
        season_id, page_size, page_num, w_rid, wts
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        let medias = result.pointer("/data/medias")
            .or_else(|| result.pointer("/data/archives"))
            .or_else(|| result.pointer("/data/list"))
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        let has_more = result.pointer("/data/has_more").and_then(|h| h.as_bool()).unwrap_or(false);
        let data: Vec<Value> = medias
            .iter()
            .map(|item| {
                json!({
                    "aid": item.get("id").cloned().unwrap_or(json!(0)),
                    "bvid": item.get("bvid").and_then(|v| v.as_str())
                        .or_else(|| item.get("bv_id").and_then(|v| v.as_str())).unwrap_or(""),
                    "title": item.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                    "pic": item.get("cover").and_then(|v| v.as_str())
                        .or_else(|| item.get("pic").and_then(|v| v.as_str())).unwrap_or(""),
                    "duration": item.get("duration").cloned().unwrap_or(json!(0)),
                    "upper": item.get("upper").cloned().unwrap_or(Value::Null),
                    "cnt_info": item.get("cnt_info").cloned().unwrap_or(Value::Null),
                    "page": item.get("page").cloned().unwrap_or(json!(1)),
                    "intro": item.get("intro").and_then(|v| v.as_str()).unwrap_or(""),
                    "ctime": item.get("ctime").cloned().unwrap_or(json!(0)),
                    "pubtime": item.get("pubtime").cloned().unwrap_or(json!(0)),
                    "media_id": item.get("id").cloned().unwrap_or(json!(season_id))
                })
            })
            .collect();
        return json!({
            "success": true,
            "data": data,
            "hasMore": has_more,
            "nextPage": if has_more { json!(page_num + 1) } else { Value::Null },
            "seasonInfo": result.pointer("/data/info").cloned()
                .or_else(|| result.pointer("/data/season").cloned()).unwrap_or(Value::Null)
        });
    }
    wrap_err(&msg_of(&result, "获取收藏合集详情失败"))
}

/// get-toview：稍后再看
pub async fn get_toview(args: &[Value]) -> Value {
    let page_num = arg_u64(args, 0, 1);
    let page_size = arg_u64(args, 1, 20);
    let url = format!(
        "https://api.bilibili.com/x/v2/history/toview/web?pn={}&ps={}&viewed=0&key=&asc=false&need_split=true&web_location=333.881&w_rid=6c58fd1f8eb22fe808f98d244cc81cfd&wts=1777995347",
        page_num, page_size
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        let items = result.pointer("/data/list").cloned()
            .or_else(|| result.get("data").cloned())
            .and_then(|d| d.as_array().cloned())
            .unwrap_or_default();
        let has_more_flag = result.pointer("/data/has_more").and_then(|h| h.as_bool()).unwrap_or(false);
        let data: Vec<Value> = items
            .iter()
            .map(|item| {
                json!({
                    "bvid": item.get("bvid").and_then(|v| v.as_str()).unwrap_or(""),
                    "title": item.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                    "pic": item.get("pic").and_then(|v| v.as_str())
                        .or_else(|| item.get("cover").and_then(|v| v.as_str())).unwrap_or(""),
                    "duration": item.get("duration").cloned()
                        .or_else(|| item.get("length").cloned()).unwrap_or(json!(0)),
                    "upper": item.get("owner").cloned()
                        .or_else(|| item.get("upper").cloned()).unwrap_or(Value::Null),
                    "cnt_info": item.get("stat").cloned()
                        .or_else(|| item.get("cnt_info").cloned()).unwrap_or(Value::Null),
                    "progress": item.get("progress").cloned().unwrap_or(json!(0)),
                    "view_at": item.get("view_at").cloned().unwrap_or(json!(0)),
                    "part": item.get("part").and_then(|v| v.as_str()).unwrap_or("")
                })
            })
            .collect();
        return json!({
            "success": true,
            "data": data,
            "hasMore": has_more_flag || items.len() as u64 >= page_size,
            "nextPage": if has_more_flag { json!(page_num + 1) } else { Value::Null },
            "total": result.pointer("/data/total").and_then(|t| t.as_u64()).unwrap_or(items.len() as u64)
        });
    }
    wrap_err(&msg_of(&result, "获取稍后再看失败"))
}

/// get-favorites-folders：收藏夹列表（含默认收藏夹补齐与置顶）
pub async fn get_favorites_folders(args: &[Value]) -> Value {
    let rid = arg_str(args, 0, "");
    let up_mid_arg = arg_str(args, 1, "");
    let user_id = if !up_mid_arg.is_empty() {
        up_mid_arg
    } else {
        match cookie_store::get("DedeUserID") {
            Some(v) if !v.is_empty() => v,
            _ => return wrap_err("用户未登录"),
        }
    };

    let params = vec![
        ("type".to_string(), "2".to_string()),
        ("rid".to_string(), rid.clone()),
        ("up_mid".to_string(), user_id.clone()),
        ("web_location".to_string(), "bilibili-electron".to_string()),
    ];
    let Some((img, sub)) = fetch_wbi_keys().await else {
        return wrap_err("WBI签名不可用");
    };
    let mix = get_mix_key(&img, &sub);
    let (w_rid, wts) = sign_params(&params, &mix);

    let url = format!(
        "https://api.bilibili.com/x/v3/fav/folder/created/list-all?type=2&rid={}&up_mid={}&web_location=bilibili-electron&w_rid={}&wts={}",
        crate::api::enc(&rid), user_id, w_rid, wts
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        let mut folders: Vec<Value> = result.pointer("/data/list").cloned()
            .or_else(|| result.get("data").cloned())
            .and_then(|d| d.as_array().cloned())
            .unwrap_or_default();

        // 标记默认收藏夹；无则手动补一个并置顶
        let mut has_default = false;
        for item in folders.iter_mut() {
            let name = item.get("title").and_then(|v| v.as_str())
                .or_else(|| item.get("name").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            let is_default = name == "默认收藏夹";
            if is_default {
                has_default = true;
            }
            if let Some(obj) = item.as_object_mut() {
                obj.insert("is_default".into(), json!(is_default));
            }
        }
        if !has_default {
            folders.insert(
                0,
                json!({
                    "id": 0, "fid": 0, "title": "默认收藏夹", "name": "默认收藏夹",
                    "cover": "", "media_count": 0, "attr": 0, "type": 2,
                    "mid": user_id, "ctime": 0, "mtime": 0, "is_default": true
                }),
            );
        } else {
            // 默认收藏夹置顶
            if let Some(idx) = folders.iter().position(|f| {
                f.get("is_default").and_then(|d| d.as_bool()).unwrap_or(false)
            }) {
                if idx > 0 {
                    let item = folders.remove(idx);
                    folders.insert(0, item);
                }
            }
        }

        let mapped: Vec<Value> = folders
            .iter()
            .map(|item| {
                json!({
                    "id": item.get("id").cloned()
                        .or_else(|| item.get("fid").cloned()).unwrap_or(json!("")),
                    "fid": item.get("fid").cloned()
                        .or_else(|| item.get("id").cloned()).unwrap_or(json!("")),
                    "mid": item.get("mid").cloned().unwrap_or(json!("")),
                    "name": item.get("title").and_then(|v| v.as_str())
                        .or_else(|| item.get("name").and_then(|v| v.as_str())).unwrap_or(""),
                    "cover": item.get("cover").and_then(|v| v.as_str()).unwrap_or(""),
                    "media_count": item.get("media_count").and_then(|v| v.as_u64()).unwrap_or(0),
                    "attr": item.get("attr").and_then(|v| v.as_u64()).unwrap_or(0),
                    "type": item.get("type").and_then(|v| v.as_u64()).unwrap_or(2),
                    "ctime": item.get("ctime").and_then(|v| v.as_u64()).unwrap_or(0),
                    "mtime": item.get("mtime").and_then(|v| v.as_u64()).unwrap_or(0),
                    "is_default": item.get("is_default").and_then(|v| v.as_bool()).unwrap_or(false)
                })
            })
            .collect();
        return wrap_ok(json!(mapped));
    }
    wrap_err(&msg_of(&result, "获取收藏夹列表失败"))
}

/// unfavorite-video：批量取消收藏（WBI 签名 POST）
pub async fn unfavorite_video(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(Value::Null);
    let resources = params.get("resources").cloned().unwrap_or(Value::Null);
    let media_id = params.get("media_id").cloned().unwrap_or(Value::Null);

    if resources.is_null() {
        return wrap_err("缺少资源ID");
    }
    if media_id.is_null() {
        return wrap_err("缺少收藏夹ID");
    }
    let csrf = cookie_store::get("bili_jct").unwrap_or_default();
    if csrf.is_empty() {
        return wrap_err("缺少CSRF Token");
    }

    let resources_str = match &resources {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let media_id_str = match &media_id {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    let sign_input = vec![
        ("resources".to_string(), resources_str.clone()),
        ("media_id".to_string(), media_id_str.clone()),
    ];
    let Some((img, sub)) = fetch_wbi_keys().await else {
        return wrap_err("WBI签名不可用");
    };
    let mix = get_mix_key(&img, &sub);
    let (w_rid, wts) = sign_params(&sign_input, &mix);

    let body = vec![
        ("resources".to_string(), resources_str),
        ("media_id".to_string(), media_id_str),
        ("csrf".to_string(), csrf),
        ("platform".to_string(), "pc".to_string()),
        ("web_location".to_string(), "bilibili-electron".to_string()),
        ("w_rid".to_string(), w_rid),
        ("wts".to_string(), wts.to_string()),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v3/fav/resource/batch-del", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok(result.get("data").cloned().unwrap_or(Value::Null))
            } else {
                wrap_err(&msg_of(&result, "取消收藏失败"))
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// add-to-favorites：收藏操作（WBI 签名 POST；bvid 需先换 aid）
pub async fn add_to_favorites(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(Value::Null);
    let rid = params.get("rid").cloned().unwrap_or(Value::Null);
    let type_ = params.get("type").and_then(|v| v.as_u64()).unwrap_or(2);
    let add_media_ids = params.get("add_media_ids").cloned().unwrap_or(Value::Null);

    if rid.is_null() {
        return wrap_err("缺少视频ID");
    }
    let csrf = cookie_store::get("bili_jct").unwrap_or_default();
    if csrf.is_empty() {
        return wrap_err("缺少CSRF Token");
    }

    // add_media_ids：数组或单值，过滤负数后逗号拼接
    let ids: Vec<String> = match &add_media_ids {
        Value::Array(arr) => arr.iter().map(|v| v.to_string()).collect(),
        Value::Null => Vec::new(),
        other => vec![other.to_string()],
    };
    let valid_ids: Vec<String> = ids
        .iter()
        .filter(|id| id.parse::<i64>().map(|n| n >= 0).unwrap_or(false))
        .cloned()
        .collect();
    let add_media_ids_str = valid_ids.join(",");
    if add_media_ids_str.is_empty() {
        return wrap_err("缺少收藏夹ID");
    }

    // rid 为 bvid 字符串时先换 aid
    let mut resource_id = match &rid {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if resource_id.starts_with("BV") {
        match fetch_api(&format!("https://api.bilibili.com/x/web-interface/view?bvid={}", resource_id)).await {
            Ok(video_info) => {
                if code_of(&video_info) == 0 {
                    if let Some(aid) = video_info.pointer("/data/aid") {
                        resource_id = aid.to_string().replace(".0", "");
                    } else {
                        return wrap_err("无法获取视频信息");
                    }
                } else {
                    return wrap_err("无法获取视频信息");
                }
            }
            Err(e) => return wrap_err(&format!("获取视频信息失败: {}", e)),
        }
    }

    let sign_input = vec![
        ("rid".to_string(), resource_id.clone()),
        ("type".to_string(), type_.to_string()),
        ("add_media_ids".to_string(), add_media_ids_str),
    ];
    let Some((img, sub)) = fetch_wbi_keys().await else {
        return wrap_err("WBI签名不可用");
    };
    let mix = get_mix_key(&img, &sub);
    let (w_rid, wts) = sign_params(&sign_input, &mix);

    let mut body = sign_input.clone();
    body.push(("csrf".to_string(), csrf));
    body.push(("platform".to_string(), "pc".to_string()));
    body.push(("web_location".to_string(), "bilibili-electron".to_string()));
    body.push(("w_rid".to_string(), w_rid));
    body.push(("wts".to_string(), wts.to_string()));

    match fetch_api_post("https://api.bilibili.com/x/v3/fav/resource/deal", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok(result.get("data").cloned().unwrap_or(Value::Null))
            } else {
                wrap_err(&msg_of(&result, "收藏失败"))
            }
        }
        Err(e) => wrap_err(&format!("请求错误: {}", e)),
    }
}

fn require_csrf() -> Result<String, Value> {
    let csrf = cookie_store::get("bili_jct").unwrap_or_default();
    if csrf.is_empty() {
        return Err(wrap_err("缺少CSRF Token"));
    }
    Ok(csrf)
}

/// add-favorite-folder：创建收藏夹
pub async fn add_favorite_folder(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(Value::Null);
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let is_public = params.get("isPublic").and_then(|v| v.as_bool()).unwrap_or(true);

    let trimmed = title.trim().to_string();
    if trimmed.is_empty() {
        return wrap_err("收藏夹名称不能为空");
    }
    if trimmed.chars().count() > 20 {
        return wrap_err("收藏夹名称不能超过20字");
    }
    let csrf = match require_csrf() {
        Ok(c) => c,
        Err(e) => return e,
    };
    let privacy = if is_public { 0 } else { 1 };

    let body = vec![
        ("title".to_string(), trimmed),
        ("public".to_string(), is_public.to_string()),
        ("privacy".to_string(), privacy.to_string()),
        ("csrf".to_string(), csrf),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v3/fav/folder/add", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok(result.get("data").cloned().unwrap_or(Value::Null))
            } else {
                wrap_err(&msg_of(&result, "创建收藏夹失败"))
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// delete-favorites-folder：删除收藏夹
pub async fn delete_favorites_folder(args: &[Value]) -> Value {
    let media_ids = args.first().cloned().unwrap_or(Value::Null);
    if media_ids.is_null() {
        return wrap_err("缺少收藏夹ID");
    }
    let csrf = match require_csrf() {
        Ok(c) => c,
        Err(e) => return e,
    };
    let ids_str = match &media_ids {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let body = vec![
        ("media_ids".to_string(), ids_str),
        ("csrf".to_string(), csrf),
        ("platform".to_string(), "web".to_string()),
        ("jsonp".to_string(), "jsonp".to_string()),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v3/fav/folder/del", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok(result.get("data").cloned().unwrap_or(Value::Null))
            } else {
                wrap_err(&msg_of(&result, "删除收藏夹失败"))
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// sort-favorites：收藏夹排序
pub async fn sort_favorites(args: &[Value]) -> Value {
    let sort_ids = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
    if sort_ids.trim().is_empty() {
        return wrap_err("缺少排序ID列表");
    }
    let csrf = match require_csrf() {
        Ok(c) => c,
        Err(e) => return e,
    };
    let body = vec![
        ("sort".to_string(), sort_ids),
        ("csrf".to_string(), csrf),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v3/fav/folder/sort", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok(result.get("data").cloned().unwrap_or(Value::Null))
            } else {
                wrap_err(&msg_of(&result, "排序失败"))
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// clean-favorites-expired：清空失效内容
pub async fn clean_favorites_expired(args: &[Value]) -> Value {
    let media_id = args.first().cloned().unwrap_or(Value::Null);
    if media_id.is_null() {
        return wrap_err("缺少收藏夹ID");
    }
    let csrf = match require_csrf() {
        Ok(c) => c,
        Err(e) => return e,
    };
    let body = vec![
        ("media_id".to_string(), media_id.to_string()),
        ("platform".to_string(), "web".to_string()),
        ("csrf".to_string(), csrf),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v3/fav/resource/clean", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok(result.get("data").cloned().unwrap_or(Value::Null))
            } else {
                wrap_err(&msg_of(&result, "清空失效内容失败"))
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// edit-favorites-folder：编辑收藏夹
pub async fn edit_favorites_folder(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(Value::Null);
    let media_id = params.get("mediaId").cloned().unwrap_or(Value::Null);
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let is_public = params.get("isPublic").and_then(|v| v.as_bool()).unwrap_or(true);

    if media_id.is_null() {
        return wrap_err("缺少收藏夹ID");
    }
    let trimmed = title.trim().to_string();
    if trimmed.is_empty() {
        return wrap_err("收藏夹名称不能为空");
    }
    if trimmed.chars().count() > 20 {
        return wrap_err("收藏夹名称不能超过20字");
    }
    let csrf = match require_csrf() {
        Ok(c) => c,
        Err(e) => return e,
    };
    let privacy = if is_public { 0 } else { 1 };

    let body = vec![
        ("title".to_string(), trimmed),
        ("public".to_string(), is_public.to_string()),
        ("media_id".to_string(), media_id.to_string()),
        ("privacy".to_string(), privacy.to_string()),
        ("csrf".to_string(), csrf),
        ("platform".to_string(), "web".to_string()),
        ("jsonp".to_string(), "jsonp".to_string()),
    ];
    match fetch_api_post("https://api.bilibili.com/x/v3/fav/folder/edit", &body).await {
        Ok(result) => {
            if code_of(&result) == 0 {
                wrap_ok(result.get("data").cloned().unwrap_or(Value::Null))
            } else {
                wrap_err(&msg_of(&result, "编辑收藏夹失败"))
            }
        }
        Err(e) => wrap_err(&e),
    }
}
