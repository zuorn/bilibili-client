// feeds 模块：对应 Electron 版 src/main/ipc/feeds.js
// 通道：test-ipc / fetch-videos / search-videos / fetch-popular-videos /
//       fetch-popular-videos-v2 / fetch-hot-search
use serde_json::{json, Value};

use crate::api::{
    build_recommend_url, fetch_api, fetch_with_retry, fetch_wbi_keys, get_mix_key, sign_params,
    wrap_err, wrap_ok,
};

fn args_u64(args: &[Value], idx: usize, default: u64) -> u64 {
    args.get(idx)
        .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)))
        .unwrap_or(default)
}

fn args_str(args: &[Value], idx: usize, default: &str) -> String {
    args.get(idx)
        .and_then(|v| v.as_str())
        .unwrap_or(default)
        .to_string()
}

/// test-ipc
pub async fn test_ipc() -> Value {
    json!({ "success": true, "message": "IPC works!", "data": [1, 2, 3] })
}

/// fetch-videos：首页推荐
pub async fn fetch_videos(args: &[Value]) -> Value {
    let page = args_u64(args, 0, 1);
    let url = build_recommend_url(page);
    match fetch_with_retry(&url).await {
        Ok(data) => {
            let code = data.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            if code == 0 {
                wrap_ok(data)
            } else {
                wrap_err("获取推荐视频失败")
            }
        }
        Err(e) => wrap_err(&e),
    }
}

/// search-videos：全站搜索（WBI 签名）
pub async fn search_videos(args: &[Value]) -> Value {
    let keyword = args_str(args, 0, "");
    let page = args_u64(args, 1, 1);
    let search_type = args_str(args, 2, "all");
    let order = args_str(args, 3, "totalrank");

    // 根据搜索类型确定 page_size、search_type、ad_resource
    let (page_size, st, ad_resource): (u64, Option<&str>, &str) = match search_type.as_str() {
        "video" => (42, Some("video"), "5654"),
        "media_bangumi" => (12, Some("media_bangumi"), "5646"),
        "media_ft" => (12, Some("media_ft"), "5646"),
        "bili_user" => (36, Some("bili_user"), "5646"),
        _ => (42, None, "5646"),
    };

    let mut params: Vec<(String, String)> = vec![
        ("keyword".into(), keyword),
        ("page".into(), page.to_string()),
        ("page_size".into(), page_size.to_string()),
        ("platform".into(), "pc".into()),
        ("highlight".into(), "1".into()),
        ("single_column".into(), "0".into()),
        ("from_source".into(), "web_search".into()),
        ("from_spmid".into(), "333.337".into()),
        ("source_tag".into(), "3".into()),
        ("web_location".into(), "1430654".into()),
        ("ad_resource".into(), ad_resource.into()),
        ("__refresh__".into(), "true".into()),
        ("_extra".into(), "".into()),
        ("context".into(), "".into()),
        ("pubtime_begin_s".into(), "0".into()),
        ("pubtime_end_s".into(), "0".into()),
        ("category_id".into(), "".into()),
        ("gaia_vtoken".into(), "".into()),
    ];

    if let Some(st) = st {
        params.push(("search_type".into(), st.to_string()));
    }
    match search_type.as_str() {
        "all" => {
            params.push(("duration".into(), "".into()));
            params.push(("web_roll_page".into(), "1".into()));
            params.push((
                "order".into(),
                if order == "totalrank" { "".into() } else { order.clone() },
            ));
        }
        "video" => {
            params.push(("dynamic_offset".into(), "0".into()));
            params.push(("web_roll_page".into(), "1".into()));
            params.push((
                "order".into(),
                if order == "totalrank" { "".into() } else { order.clone() },
            ));
        }
        "media_bangumi" | "media_ft" => {
            params.push(("duration".into(), "".into()));
            params.push(("order".into(), "".into()));
        }
        "bili_user" => {
            params.push(("order_sort".into(), "0".into()));
            params.push(("user_type".into(), "0".into()));
            params.push(("dynamic_offset".into(), "0".into()));
        }
        _ => {}
    }

    let base_url = if st.is_some() {
        "https://api.bilibili.com/x/web-interface/wbi/search/type"
    } else {
        "https://api.bilibili.com/x/web-interface/wbi/search/all/v2"
    };

    let build_query = |params: &[(String, String)]| -> String {
        params
            .iter()
            .map(|(k, v)| format!("{}={}", crate::api::enc(k), crate::api::enc(v)))
            .collect::<Vec<_>>()
            .join("&")
    };

    // WBI 签名
    match fetch_wbi_keys().await {
        Some((img_key, sub_key)) => {
            let mix_key = get_mix_key(&img_key, &sub_key);
            let (w_rid, wts) = sign_params(&params, &mix_key);
            let mut all = params.clone();
            all.push(("w_rid".into(), w_rid));
            all.push(("wts".into(), wts.to_string()));
            let endpoint = format!("{}?{}", base_url, build_query(&all));
            match fetch_with_retry(&endpoint).await {
                Ok(data) => {
                    let code = data.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
                    if code == 0 {
                        wrap_ok(data)
                    } else {
                        wrap_err(
                            data.get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("搜索失败"),
                        )
                    }
                }
                Err(e) => wrap_err(&e),
            }
        }
        None => {
            // WBI keys 获取失败：不带签名直接请求作为后备
            let endpoint = format!("{}?{}", base_url, build_query(&params));
            match fetch_with_retry(&endpoint).await {
                Ok(data) => {
                    let code = data.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
                    if code == 0 {
                        wrap_ok(data)
                    } else {
                        wrap_err("搜索失败")
                    }
                }
                Err(e) => wrap_err(&e),
            }
        }
    }
}

/// fetch-popular-videos：热门（comprehensive/ranking/weekly/precious 四种 tab）
pub async fn fetch_popular(args: &[Value]) -> Value {
    // 兼容旧版本调用方式（只传 page 数字）
    let legacy = args.len() == 1 && args[0].is_number();
    let tab = if legacy {
        "comprehensive".to_string()
    } else {
        args_str(args, 0, "comprehensive")
    };
    let page = if legacy {
        args_u64(args, 0, 1)
    } else {
        args_u64(args, 1, 1)
    };
    let rid = if legacy { 0 } else { args_u64(args, 2, 0) };

    let endpoint = match tab.as_str() {
        "ranking" => format!(
            "https://api.bilibili.com/x/web-interface/ranking/v2?rid={}&type=all&ps=30&pn={}&web_location=bilibili-electron",
            rid, page
        ),
        "weekly" => {
            // 先获取最新期数
            let mut latest_number: u64 = 375;
            if let Ok(list_data) =
                fetch_with_retry("https://api.bilibili.com/x/web-interface/popular/series/list")
                    .await
            {
                if let Some(number) = list_data
                    .pointer("/data/list/0/number")
                    .and_then(|n| n.as_u64())
                {
                    latest_number = number;
                }
            }
            // 每周必看需要 WBI 签名
            let Some((img_key, sub_key)) = fetch_wbi_keys().await else {
                return wrap_err("WBI keys 获取失败");
            };
            let mix_key = get_mix_key(&img_key, &sub_key);
            let params = vec![
                ("number".to_string(), latest_number.to_string()),
                ("web_location".to_string(), "bilibili-electron".to_string()),
            ];
            let (w_rid, wts) = sign_params(&params, &mix_key);
            format!(
                "https://api.bilibili.com/x/web-interface/popular/series/one?number={}&web_location=bilibili-electron&w_rid={}&wts={}",
                latest_number, w_rid, wts
            )
        }
        "precious" => "https://api.bilibili.com/x/web-interface/popular/precious".to_string(),
        _ => format!(
            "https://api.bilibili.com/x/web-interface/popular?ps=40&pn={}&web_location=bilibili-electron",
            page
        ),
    };

    match fetch_with_retry(&endpoint).await {
        Ok(data) => wrap_ok(data),
        Err(e) => wrap_err(&e),
    }
}

/// fetch-popular-videos-v2：排行榜
pub async fn fetch_popular_v2(args: &[Value]) -> Value {
    let page = args_u64(args, 0, 1);
    let endpoint = format!(
        "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all&ps=30&pn={}",
        page
    );
    match fetch_api(&endpoint).await {
        Ok(data) => {
            let code = data.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            if code == 0 {
                wrap_ok(data)
            } else {
                json!({
                    "success": false,
                    "data": data,
                    "error": data.get("message").and_then(|m| m.as_str()).unwrap_or("获取热门视频失败")
                })
            }
        }
        Err(e) => wrap_err(&e),
    }
}

fn hot_tag_from_data(item: &Value) -> String {
    let show_name = item
        .get("show_name")
        .and_then(|s| s.as_str())
        .unwrap_or("");
    if show_name.contains('新') || show_name.contains("回归") {
        return "新".into();
    }
    if show_name.contains("独家") {
        return "独家".into();
    }
    if show_name.contains('番') || show_name.contains("动画") {
        return "bangumi".into();
    }
    if show_name.contains("视频") || show_name.contains("直播") {
        return "video".into();
    }
    String::new()
}

fn map_hot_list(list: &[Value]) -> Vec<Value> {
    list.iter()
        .map(|item| {
            let keyword = item
                .get("keyword")
                .and_then(|k| k.as_str())
                .or_else(|| item.get("show_name").and_then(|k| k.as_str()))
                .unwrap_or("");
            let title = item
                .get("show_name")
                .and_then(|k| k.as_str())
                .or_else(|| item.get("keyword").and_then(|k| k.as_str()))
                .unwrap_or("");
            json!({ "keyword": keyword, "title": title, "tag": hot_tag_from_data(item) })
        })
        .collect()
}

/// fetch-hot-search：热搜榜
pub async fn fetch_hot_search(_args: &[Value]) -> Value {
    // 与 Electron 版一致：使用固定签名的 square 接口
    let endpoint = "https://api.bilibili.com/x/web-interface/wbi/search/square?limit=10&platform=web&web_location=333.1365&w_rid=33c27013429cc439349b6d7f3523bbb8&wts=1777972362";
    match fetch_with_retry(endpoint).await {
        Ok(api_data) => {
            let code = api_data.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            if code == 0 {
                if let Some(list) = api_data.pointer("/data/trending/list").and_then(|l| l.as_array()) {
                    return wrap_ok(json!({ "list": map_hot_list(list) }));
                }
            }
            if let Some(list) = api_data.pointer("/trending/list").and_then(|l| l.as_array()) {
                return wrap_ok(json!({ "list": map_hot_list(list) }));
            }
            wrap_err("数据格式不正确")
        }
        Err(e) => wrap_err(&e),
    }
}
