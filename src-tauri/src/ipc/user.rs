// user 模块：对应 Electron 版 src/main/ipc/user.js
// 通道：get-user-info / get-user-followings / get-up-followings /
//       get-following-groups / get-following-list / get-bangumi-follow
use serde_json::{json, Value};

use crate::api::{fetch_api, wrap_err, wrap_ok};

fn code_of(v: &Value) -> i64 {
    v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1)
}

/// get-user-info：用户信息 + 播放量/关注数/粉丝数/动态数聚合
pub async fn get_user_info(_args: &[Value]) -> Value {
    let url = format!("https://api.bilibili.com/x/web-interface/nav?{}", crate::api::now_millis_js());
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };

    if code_of(&result) != 0 {
        return wrap_err("获取用户信息失败");
    }
    let data = match result.get("data") {
        Some(d) => d.clone(),
        None => return wrap_err("获取用户信息失败"),
    };

    let mid = data.get("mid").and_then(|m| m.as_u64()).unwrap_or(0);
    let mut view_count = 0u64;
    let mut following = 0u64;
    let mut follower = 0u64;
    let mut dyn_count = 0u64;

    if mid > 0 {
        // 播放量（取 like 字段，与 Electron 版一致）
        if let Ok(card) = fetch_api(&format!("https://api.bilibili.com/x/web-interface/card?mid={}&photo=true", mid)).await {
            if code_of(&card) == 0 {
                view_count = card
                    .pointer("/data/card/stat/like")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
            }
        }
        // 关注/粉丝
        if let Ok(rel) = fetch_api(&format!("https://api.bilibili.com/x/relation/stat?vmid={}&web_location=bilibili-electron", mid)).await {
            if code_of(&rel) == 0 {
                following = rel.pointer("/data/following").and_then(|v| v.as_u64()).unwrap_or(0);
                follower = rel.pointer("/data/follower").and_then(|v| v.as_u64()).unwrap_or(0);
            }
        }
        // 动态数
        if let Ok(dyn_res) = fetch_api(&format!("https://api.bilibili.com/x/dynamic/feed/space/dyn_num?uid_str={}&web_location=bilibili-electron", mid)).await {
            if code_of(&dyn_res) == 0 {
                dyn_count = dyn_res.pointer("/data/num").and_then(|v| v.as_u64()).unwrap_or(0);
            }
        }
    }

    wrap_ok(json!({
        "isLogin": data.get("isLogin").and_then(|v| v.as_bool()).unwrap_or(false),
        "uname": data.get("uname").and_then(|v| v.as_str()).unwrap_or("未登录"),
        "face": data.get("face").and_then(|v| v.as_str()).unwrap_or(""),
        "mid": mid,
        "level": data.pointer("/level_info/current_level").and_then(|v| v.as_u64()).unwrap_or(0),
        "coins": data.get("coins").and_then(|v| v.as_u64()).unwrap_or(0),
        "bCoins": data.get("bcoins").and_then(|v| v.as_u64()).unwrap_or(0),
        "vipStatus": data.pointer("/vip/status").and_then(|v| v.as_u64()).unwrap_or(0),
        "vipType": data.pointer("/vip/type").and_then(|v| v.as_u64()).unwrap_or(0),
        "following": following,
        "follower": follower,
        "viewCount": view_count,
        "dynCount": dyn_count
    }))
}

fn map_following_basic(list: &[Value]) -> Vec<Value> {
    list.iter()
        .map(|item| {
            json!({
                "mid": item.get("mid").cloned().unwrap_or(Value::Null),
                "uname": item.get("uname").cloned().unwrap_or(Value::Null),
                "face": item.get("face").cloned().unwrap_or(Value::Null)
            })
        })
        .collect()
}

/// get-user-followings
pub async fn get_user_followings(args: &[Value]) -> Value {
    let mid = args.first().cloned().unwrap_or(Value::Null);
    let url = format!(
        "https://api.bilibili.com/x/relation/followings?vmid={}&pn=1&ps=20&order=desc",
        mid
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        if let Some(list) = result.pointer("/data/list").and_then(|l| l.as_array()) {
            return wrap_ok(json!(map_following_basic(list)));
        }
    }
    wrap_err("获取关注列表失败")
}

/// get-up-followings
pub async fn get_up_followings(args: &[Value]) -> Value {
    let mid = args.first().cloned().unwrap_or(Value::Null);
    let url = format!(
        "https://api.bilibili.com/x/relation/followings?vmid={}&ps=30&pn=1&order=desc&web_location=bilibili-electron",
        mid
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        if let Some(list) = result.pointer("/data/list").and_then(|l| l.as_array()) {
            let mapped: Vec<Value> = list
                .iter()
                .map(|item| {
                    json!({
                        "mid": item.get("mid").cloned().unwrap_or(Value::Null),
                        "uname": item.get("uname").cloned().unwrap_or(Value::Null),
                        "face": item.get("face").cloned().unwrap_or(Value::Null),
                        "sign": item.get("sign").and_then(|v| v.as_str()).unwrap_or("")
                    })
                })
                .collect();
            return wrap_ok(json!(mapped));
        }
    }
    wrap_err("获取UP主关注列表失败")
}

/// get-following-groups
pub async fn get_following_groups(args: &[Value]) -> Value {
    let mid = args.first().cloned().unwrap_or(Value::Null);
    let url = format!("https://api.bilibili.com/x/relation/tags?vmid={}", mid);
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        if let Some(data) = result.get("data") {
            return wrap_ok(data.clone());
        }
    }
    wrap_err("获取关注分组失败")
}

/// get-following-list：params 对象 {mid, tagid, pn, ps, order, order_type}
pub async fn get_following_list(args: &[Value]) -> Value {
    let params = args.first().cloned().unwrap_or(Value::Null);
    let get = |k: &str| params.get(k).cloned().unwrap_or(Value::Null);

    let mid = get("mid");
    let tagid = get("tagid")
        .as_i64()
        .or_else(|| get("tagid").as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(-1);
    let pn = get("pn").as_u64().unwrap_or(1);
    let ps = get("ps").as_u64().unwrap_or(20);
    let order = get("order").as_str().unwrap_or("desc").to_string();
    let order_type = get("order_type");

    let url = if tagid != -1 {
        let mut u = format!(
            "https://api.bilibili.com/x/relation/tag?tagid={}&mid={}&pn={}&ps={}",
            tagid, mid, pn, ps
        );
        if !order_type.is_null() {
            u.push_str(&format!("&order_type={}", order_type));
        }
        u
    } else {
        format!(
            "https://api.bilibili.com/x/relation/followings?vmid={}&pn={}&ps={}&order={}",
            mid, pn, ps, order
        )
    };

    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };
    if code_of(&result) == 0 {
        if let Some(data) = result.get("data") {
            let mut data = data.clone();
            if tagid != -1 && data.get("list").is_none() {
                if data.is_array() {
                    data = json!({ "list": data });
                } else if data.get("followings").is_some() {
                    data = json!({ "list": data.get("followings").cloned().unwrap_or(Value::Null) });
                }
            }
            return wrap_ok(data);
        }
    }
    wrap_err("获取关注列表失败")
}

/// get-bangumi-follow：追番列表
pub async fn get_bangumi_follow(args: &[Value]) -> Value {
    let type_ = args.first().and_then(|v| v.as_i64()).unwrap_or(1);
    let page_num = args.get(1).and_then(|v| v.as_u64()).unwrap_or(1);
    let vmid = crate::cookie_store::get("DedeUserID").unwrap_or_else(|| "320634848".to_string());
    let url = format!(
        "https://api.bilibili.com/x/space/bangumi/follow/list?vmid={}&type={}&pn={}&ps=24&platform=web&follow_status=0",
        vmid, type_, page_num
    );
    let result = match fetch_api(&url).await {
        Ok(r) => r,
        Err(e) => return wrap_err(&e),
    };

    if code_of(&result) == 0 {
        if let Some(list) = result.pointer("/data/list").and_then(|l| l.as_array()) {
            let mapped: Vec<Value> = list
                .iter()
                .map(|item| {
                    json!({
                        "season_id": item.get("season_id").and_then(|v| v.as_u64()).unwrap_or(0),
                        "media_id": item.get("media_id").and_then(|v| v.as_u64()).unwrap_or(0),
                        "title": item.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "cover": item.get("cover").and_then(|v| v.as_str()).unwrap_or(""),
                        "total_count": item.get("total_count").and_then(|v| v.as_u64()).unwrap_or(0),
                        "is_finish": item.get("is_finish").and_then(|v| v.as_u64()).unwrap_or(0),
                        "is_started": item.get("is_started").and_then(|v| v.as_u64()).unwrap_or(0),
                        "badge": item.get("badge").and_then(|v| v.as_str()).unwrap_or(""),
                        "stat": item.get("stat").cloned().unwrap_or(Value::Null),
                        "new_ep": item.get("new_ep").cloned().unwrap_or(Value::Null),
                        "season_status": item.get("season_status").and_then(|v| v.as_u64()).unwrap_or(0),
                        "url": item.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        "short_url": item.get("short_url").and_then(|v| v.as_str()).unwrap_or("")
                    })
                })
                .collect();
            return json!({
                "success": true,
                "data": mapped,
                "hasMore": list.len() >= 24
            });
        }
    }
    wrap_err("获取追番失败")
}
