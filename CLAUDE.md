# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Dev: launch Electron app (sets UTF-8 codepage)
npm run build:win      # Build Windows NSIS installer
npm run build:mac      # Build macOS DMG
npm run build:linux    # Build Linux AppImage
npm run clean          # Remove dist/
```

No test suite exists yet (`npm test` is a stub).

## Architecture

This is an **Electron** desktop client for Bilibili (Chinese video platform). The renderer is a **vanilla JS single-page app** — no framework, no bundler. All scripts are loaded via `<script>` tags in `index.html` in a specific dependency order.

### Main process (`main.js` + `src/main/`)

`main.js` is the wiring hub: it creates the `sharedState` object, then passes it (or slices of it) to every module during registration. Modules follow a pattern of receiving a `deps` object rather than importing each other directly.

| Module | Role |
|---|---|
| `src/main/api.js` | All Bilibili API calls. Handles WBI signing (key fetch/cache, MD5 param signing), gzip/brotli decompression, cookie injection. Exports `fetchApi`, `fetchWithRetry`, `fetchApiWithHeaders`, `buildRecommendUrl`. |
| `src/main/window.js` | Creates the frameless `BrowserWindow`, registers window control IPC handlers (min/max/close/devtools). Injects CDN request headers via `onBeforeSendHeaders`. Syncs cookies after page load. |
| `src/main/cookieManager.js` | Persists cookies to `cookies.json` in the user data dir. Syncs between `savedCookies` object and Electron session cookies. Handles `Set-Cookie` parsing, control-character filtering, SESSDATA encoding. |
| `src/main/log.js` | Colored console output (chalk, dev only) + plain-text file logging (always). Log file set to `<userData>/debug.log`. |
| `src/main/updater.js` | `electron-updater` integration. Reads `src/config/update.yml` for source config (GitHub Releases or generic HTTP). |
| `src/main/page-nav.js` | IPC handlers for cross-page navigation (send events to renderer to switch pages). |
| `src/main/player/mpv.js` | External MPV player via IPC socket. Finds mpv binary, manages socket connection, sends/receives JSON commands. |
| `src/main/player/builtin.js` | Built-in HTML5 player: opens a second `BrowserWindow` loading `src/pages/player.html`. Prefetches DASH video URLs, copies cookies, handles zoom/position/fullscreen/drag-to-move, video download with ffmpeg merge. |
| `src/main/ipc/*.js` | IPC handlers organized by domain (feeds, bangumi, media, up, user, history, favorites, dynamics, login, player). Each exports a `register*Handlers(deps)` function. |

### Renderer process (`index.html` + `src/renderer/`)

The HTML file is the shell: header, sidebar, page containers (each `div.page-content`), modals. Script loading order is critical because later scripts depend on globals set by earlier ones.

**Loading order:**
1. `core/state.js` — all global mutable state (currentPage, pageStates, userShortcuts, accesskey state, etc.)
2. `core/utils.js` — shared helpers (image URL fixing, cover optimization, video data mapping, toast)
3. `core/navigation.js` — page switching, back button, scroll helpers
4. `components/video-card.js` — `createVideoCard()`, `renderVideos()`, `appendVideos()` with lazy-loaded cover images via IntersectionObserver
5. `components/login.js` — QR code login flow
6. `components/access-keys.js` — Vim-style link hints (press `f` to label clickable elements)
7. `features/playback.js` — `playVideo()` entry point for starting video playback
8. `features/video-preview.js` — hover-to-preview on video cards
9. `features/scroll-handler.js` — infinite scroll + back-to-top button visibility
10. `features/shortcuts.js` — keyboard shortcut binding, recording UI, `applyShortcuts()`
11. `features/page-loader.js` — `loadPageContent()` dispatcher that routes to the right page init
12. `features/update-checker.js` — update button in the header
13. `pages/*.js` — page-specific data fetching and rendering
14. `core/event-listeners.js` — `DOMContentLoaded` entry point, wires all click/keydown/IPC listeners

**Communication pattern:** Renderer calls `ipcRenderer.invoke('channel', ...args)` → main process handler returns a result. Main process can push events via `mainWindow.webContents.send('channel', data)` → renderer listens with `ipcRenderer.on('channel', handler)`.

### WBI signing

Many Bilibili API endpoints require WBI signing. The flow:
1. `fetchWbiKeys()` gets `img_key` + `sub_key` from the nav API (cached 1 hour)
2. `getMixKey()` shuffles them via `MIXIN_KEY_ENC_TAB` to produce a 32-char mix key
3. `signParams()` adds `wts` (Unix timestamp) to params, sorts alphabetically, MD5-hashes `query + mixKey` → `w_rid`

### Cookie flow

Browser cookies are managed by Electron's `session.cookies`. On startup, saved cookies from `cookies.json` are loaded and synced into the session. During API calls, cookies are injected into HTTPS request headers via `cookieManager.getCookieString()`. Session cookie changes are exported back to the JSON file automatically.

### Player architecture

Two playback modes, selected in settings:
- **Built-in player** (default): Opens a separate `BrowserWindow` loading `src/pages/player.html`. Prefetches DASH video URLs before the window finishes loading. Supports Anime4K WebGL shader upscaling. Audio/video are played as separate `<video>` elements synchronized manually.
- **MPV player**: Spawns `mpv.exe` with `--input-ipc-server` for a Unix socket. Commands and property queries are JSON messages over the socket.

### Auto-update

Configured via `src/config/update.yml`. Default source is GitHub Releases (`zuorn/bilibili-client`). The updater checks on startup (3s delay) and shows a button in the header when an update is available.
