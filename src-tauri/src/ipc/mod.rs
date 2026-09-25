// IPC 统一分发入口：对应 Electron 的 ipcMain.handle 全部通道
// 渲染层 shim（src/renderer/core/ipc-shim.js）把 ipcRenderer.invoke/send 全部
// 转发到这里，按 channel 名分发到各模块处理函数。通道名与 Electron 版 1:1。
//
// 模块移植进度：
//   [x] feeds（test-ipc / fetch-videos / search-videos / fetch-popular-videos(-v2) / fetch-hot-search）
//   [x] user（get-user-info / get-user-followings / get-up-followings /
//            get-following-groups / get-following-list / get-bangumi-follow）
//   [x] dynamics（get-dynamic-nav / get-dynamic-portal / get-all-dynamics /
//                 get-user-dynamics / add-to-watchlater / unfollow-up-from-dynamic）
//   [x] favorites（14 个通道）
//   [x] history（8 个通道）
//   [x] bangumi（5 个通道）/ media（3 个通道）/ up（7 个通道）/ login（10 个通道）
//   [x] player（20 个通道：play-video / 弹幕 / 评论 / 点赞等；内置播放器第二窗口待移植）
//   [ ] player 窗口控制类通道（minimize-player-window 等，随内置播放器第二窗口移植）
//   [ ] window 控制类与页面导航类通道见 main.rs 独立命令
use serde_json::Value;
use tauri::{AppHandle, WebviewWindow};

pub mod bangumi;
pub mod dynamics;
pub mod favorites;
pub mod feeds;
pub mod history;
pub mod login;
pub mod media;
pub mod player;
pub mod system;
pub mod up;
pub mod user;

pub async fn dispatch(
    app: &AppHandle,
    window: &WebviewWindow,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let a = args.as_slice();

    // ---- 窗口控制 / 页面导航 / 版本（system）----
    if let Some(v) = system::dispatch_system_channel(app, window, &channel, a).await {
        return Ok(v);
    }

    // ---- 播放器窗口控制（minimize-player-window / download-video 等）----
    if let Some(v) = crate::player_window::dispatch_player_window_channel(app, &channel, a).await {
        return Ok(v);
    }

    match channel.as_str() {
        // ---- [临时诊断] 由主窗口 eval 的脚本回传渲染层状态 ----
        "diag-report" => {
            eprintln!(
                "[渲染层诊断] {}",
                a.first().map(|v| v.to_string()).unwrap_or_default()
            );
            Ok(Value::Null)
        }

        // ---- feeds（首页 / 搜索 / 热门 / 热搜）----
        "test-ipc" => Ok(feeds::test_ipc().await),
        "fetch-videos" => Ok(feeds::fetch_videos(a).await),
        "search-videos" => Ok(feeds::search_videos(a).await),
        "fetch-popular-videos" => Ok(feeds::fetch_popular(a).await),
        "fetch-popular-videos-v2" => Ok(feeds::fetch_popular_v2(a).await),
        "fetch-hot-search" => Ok(feeds::fetch_hot_search(a).await),

        // ---- user（用户信息 / 关注 / 追番）----
        "get-user-info" => Ok(user::get_user_info(a).await),
        "get-user-followings" => Ok(user::get_user_followings(a).await),
        "get-up-followings" => Ok(user::get_up_followings(a).await),
        "get-following-groups" => Ok(user::get_following_groups(a).await),
        "get-following-list" => Ok(user::get_following_list(a).await),
        "get-bangumi-follow" => Ok(user::get_bangumi_follow(a).await),

        // ---- dynamics（综合动态）----
        "get-dynamic-nav" => Ok(dynamics::get_dynamic_nav(a).await),
        "get-dynamic-portal" => Ok(dynamics::get_dynamic_portal(a).await),
        "get-all-dynamics" => Ok(dynamics::get_all_dynamics(a).await),
        "get-user-dynamics" => Ok(dynamics::get_user_dynamics(a).await),
        "add-to-watchlater" => Ok(dynamics::add_to_watchlater(a).await),
        "unfollow-up-from-dynamic" => Ok(dynamics::unfollow_up_from_dynamic(a).await),

        // ---- up（UP 主页，与综合动态独立实现）----
        "fetch-up-info" => Ok(up::fetch_up_info(a).await),
        "fetch-up-relation" => Ok(up::fetch_up_relation(a).await),
        "fetch-up-videos" => Ok(up::fetch_up_videos(a).await),
        "fetch-up-dynamics" => Ok(up::fetch_up_dynamics(a).await),
        "modify-up-relation" => Ok(up::modify_up_relation(a).await),
        "fetch-up-collections-series" => Ok(up::fetch_up_collections_series(a).await),
        "fetch-season-archives" => Ok(up::fetch_season_archives(a).await),

        // ---- favorites（收藏 14 通道）----
        "get-favorites-list" => Ok(favorites::get_favorites_list(a).await),
        "get-favorites-created" => Ok(favorites::get_favorites_created(a).await),
        "get-favorites" => Ok(favorites::get_favorites(a).await),
        "get-favorites-collected" => Ok(favorites::get_favorites_collected(a).await),
        "get-favorites-collected-detail" => Ok(favorites::get_favorites_collected_detail(a).await),
        "get-toview" => Ok(favorites::get_toview(a).await),
        "get-favorites-folders" => Ok(favorites::get_favorites_folders(a).await),
        "unfavorite-video" => Ok(favorites::unfavorite_video(a).await),
        "add-to-favorites" => Ok(favorites::add_to_favorites(a).await),
        "add-favorite-folder" => Ok(favorites::add_favorite_folder(a).await),
        "delete-favorites-folder" => Ok(favorites::delete_favorites_folder(a).await),
        "sort-favorites" => Ok(favorites::sort_favorites(a).await),
        "clean-favorites-expired" => Ok(favorites::clean_favorites_expired(a).await),
        "edit-favorites-folder" => Ok(favorites::edit_favorites_folder(a).await),

        // ---- history（历史 8 通道）----
        "get-history" => Ok(history::get_history(a).await),
        "delete-history" => Ok(history::delete_history(a).await),
        "search-history" => Ok(history::search_history(a).await),
        "report-play-progress" => Ok(history::report_play_progress(a).await),
        "report-final-progress" => Ok(history::report_final_progress(a).await),
        "get-video-progress" => Ok(history::get_video_progress(a).await),
        "add-to-view" => Ok(history::add_to_view(a).await),
        "clear-history" => Ok(history::clear_history(a).await),

        // ---- bangumi / media（番剧 / 影视）----
        "fetch-media" => Ok(bangumi::fetch_media(a).await),
        "fetch-bangumi-data" => Ok(bangumi::fetch_bangumi_data(a).await),
        "fetch-bangumi-condition" => Ok(bangumi::fetch_bangumi_condition(a).await),
        "get-season-episodes" => Ok(bangumi::get_season_episodes(a).await),
        "fetch-bangumi-result" => Ok(bangumi::fetch_bangumi_result(a).await),
        "fetch-media-data" => Ok(media::fetch_media_data(a).await),
        "fetch-media-condition" => Ok(media::fetch_media_condition(a).await),
        "fetch-media-result" => Ok(media::fetch_media_result(a).await),

        // ---- login（登录 / Cookie 10 通道）----
        "get-login-qrcode" => Ok(login::get_login_qrcode(a).await),
        "poll-login-status" => Ok(login::poll_login_status(a).await),
        "stop-login-poll" => Ok(login::stop_login_poll(a).await),
        "get-login-info" => Ok(login::get_login_info(a).await),
        "import-cookie-string" => Ok(login::import_cookie_string(a).await),
        "logout" => Ok(login::logout(a).await),
        "get-cookies" => Ok(login::get_cookies(a).await),
        "get-sec-ck" => Ok(login::get_sec_ck(a).await),
        "dump-session-cookies" => Ok(login::dump_session_cookies(a).await),
        "replay-bangumi-with-cookies" => Ok(login::replay_bangumi_with_cookies(a).await),

        // ---- player（播放器 20 通道）----
        "play-video" => Ok(player::play_video(app, a).await),
        "play-video-new-window" => Ok(player::play_video_new_window(app, a).await),
        // 播放器页面就绪握手：页面注册完事件监听后上报，open_builtin_player 等待此信号
        "player-ready" => {
            crate::player_window::mark_player_ready();
            Ok(Value::Null)
        }
        // 页面确认已应用新视频数据（重置旧视频画面/进度/弹幕），open_builtin_player 收到后才显示窗口
        "player-data-applied" => {
            crate::player_window::mark_player_data_applied();
            Ok(Value::Null)
        }
        "get-video-url" => Ok(player::get_video_url(a).await),
        "get-video-preview-url" => Ok(player::get_video_preview_url(a).await),
        "get-video-info" => Ok(player::get_video_info_channel(a).await),
        "get-relation-stat" => Ok(player::get_relation_stat(a).await),
        "get-related-videos" => Ok(player::get_related_videos(a).await),
        "get-danmaku" => Ok(player::get_danmaku(a).await),
        "get-video-snapshot" => Ok(player::get_video_snapshot(a).await),
        "select-mpv-path" => Ok(player::select_mpv_path(app, a).await),
        "stop-video" => Ok(player::stop_video_channel(a).await),
        "get-danmaku-xml" => Ok(player::get_danmaku_xml_channel(a).await),
        "get-cid-by-bvid" => Ok(player::get_cid_by_bvid_channel(a).await),
        "xml-to-ass" => Ok(player::xml_to_ass(a).await),
        "fetch-danmaku-ass" => Ok(player::fetch_danmaku_ass(a).await),
        "save-ass-file" => Ok(player::save_ass_file(app, a).await),
        "get-comments" => Ok(player::get_comments(a).await),
        "like-archive" => Ok(player::like_archive(a).await),
        "post-comment" => Ok(player::post_comment(a).await),
        "delete-comment" => Ok(player::delete_comment(a).await),

        // ---- 更新（updater.js 对应）----
        "check-for-update" => Ok(crate::updater::check_for_update(app).await),
        "download-update" => Ok(crate::updater::download_update(app).await),
        "install-update" => Ok(crate::updater::install_update(app).await),

        // ---- 尚未移植的通道（player 窗口控制类，随内置播放器第二窗口移植）：返回 null，保证页面不崩 ----
        _ => {
            #[cfg(debug_assertions)]
            eprintln!("[ipc] unhandled channel: {}", channel);
            Ok(Value::Null)
        }
    }
}
