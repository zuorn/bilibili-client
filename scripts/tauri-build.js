// scripts/tauri-build.js — tauri build 包装：注入更新器签名私钥、公钥与版本号
//
// 背景：tauri.conf.json 不再硬编码 updater 公钥与版本号，构建时必须提供：
//   1. TAURI_SIGNING_PRIVATE_KEY（签名私钥，env.json tauri.signingPrivateKey）
//   2. updater 公钥（env.json tauri.updaterPubkey）
//   3. 版本号（根目录 VERSION 文件 = 唯一版本号源头）
//
// 两者均从根目录 env.json 读取（已加入 .gitignore，不会提交）：
//   {
//     "tauri": {
//       "signingPrivateKey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
//       "signingPrivateKeyPassword": "",
//       "updaterPubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6..."
//     },
//     "oss": { ... }
//   }
// 已导出的同名环境变量（TAURI_SIGNING_PRIVATE_KEY / TAURI_UPDATER_PUBKEY）优先于 env.json。
//
// 公钥注入方式：把 tauri.release.conf.json + 用户显式传入的 --config 合并后，
// 附加 plugins.updater.pubkey，写入 src-tauri/target/tauri.injected.conf.json
// （target 目录已被 gitignore），并作为唯一 --config 传给 tauri build。
//
// 用法（与 tauri build 参数一致，原样透传）：
//   npm run tauri:build            # 等价 tauri build（按当前平台自动选择 bundles）
//   npm run tauri:build:nsis       # 等价 tauri build --bundles nsis
//   node scripts/tauri-build.js --bundles app,dmg
//
// 平台默认 bundles（未显式传 --bundles 时）：
//   windows → nsis ；macos → app,dmg（app.tar.gz 供 updater，dmg 供分发）
//   linux  → appimage（AppImage 供 updater）
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { syncPackageVersion } = require('./sync-version')

const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, 'env.json')
const VERSION_FILE = path.join(ROOT, 'VERSION')
const INJECTED_CONFIG = path.join(ROOT, 'src-tauri', 'target', 'tauri.injected.conf.json')

// 读取版本号唯一源头 VERSION；缺失时返回 null（回退 Cargo.toml 的 crate 版本）
function readAppVersion() {
  if (fs.existsSync(VERSION_FILE)) {
    const v = fs.readFileSync(VERSION_FILE, 'utf8').trim()
    if (v) return v
  }
  return null
}

const PLATFORM_BUNDLES = {
  win32: 'nsis',
  darwin: 'app,dmg',
  linux: 'appimage',
}
// Release 专属配置：去掉 WebView2 的 --enable-logging=stderr / --v=1 / --log-level=0，
// 否则安装版启动时 WebView2 会强制弹出控制台窗口（开发模式 tauri dev 不受影响，
// 仍使用 tauri.conf.json 中的完整调试参数，日志照常输出到 stderr 与 player_window_debug.log）
const RELEASE_CONFIG = path.join(ROOT, 'src-tauri', 'tauri.release.conf.json')

function loadEnvJson() {
  if (!fs.existsSync(ENV_FILE)) {
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'))
  } catch (err) {
    console.error('[tauri-build] env.json 解析失败:', err.message)
    process.exit(1)
  }
}

// 解析 args 中的 --config <path>（可多次），并从 args 中移除
function extractConfigPaths(args) {
  const paths = []
  const rest = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' || args[i] === '-c') {
      const p = args[i + 1]
      if (!p) {
        console.error('[tauri-build] --config 缺少路径参数')
        process.exit(1)
      }
      paths.push(p)
      i++
    } else {
      rest.push(args[i])
    }
  }
  return { paths, rest }
}

// 合并多个配置文件并注入 pubkey 与版本号，写入 INJECTED_CONFIG，返回其路径
function writeInjectedConfig(configPaths, pubkey) {
  let merged = {}
  for (const p of configPaths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(ROOT, p)
    if (!fs.existsSync(abs)) {
      console.error('[tauri-build] --config 文件不存在:', abs)
      process.exit(1)
    }
    const c = JSON.parse(fs.readFileSync(abs, 'utf8'))
    merged = {
      ...merged,
      ...c,
      plugins: { ...(merged.plugins || {}), ...(c.plugins || {}) },
    }
  }
  merged.plugins = {
    ...(merged.plugins || {}),
    updater: { ...(merged.plugins.updater || {}), pubkey },
  }
  // 版本号引用根目录 VERSION（tauri.conf.json 不再写死版本）
  const version = readAppVersion()
  if (version) {
    merged.version = version
    console.log('[tauri-build] 已引用 VERSION 文件版本:', version)
  } else {
    console.warn('[tauri-build] 未找到 VERSION 文件，版本回退 Cargo.toml 的 crate 版本')
  }
  fs.mkdirSync(path.dirname(INJECTED_CONFIG), { recursive: true })
  fs.writeFileSync(INJECTED_CONFIG, JSON.stringify(merged, null, 2), 'utf8')
  return INJECTED_CONFIG
}

function main() {
  const envJson = loadEnvJson()
  const tauriEnv = (envJson && envJson.tauri) || {}

  // ---- 版本号同步：VERSION -> package.json（VERSION 为唯一源头）----
  const syncedVersion = syncPackageVersion((m) => console.log('[tauri-build]', m))
  if (syncedVersion) {
    console.log('[tauri-build] 已同步 VERSION 版本到 package.json:', syncedVersion)
  } else {
    console.warn('[tauri-build] 未找到 VERSION 文件，跳过 package.json 版本同步')
  }

  // ---- 签名私钥 ----
  let privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY || ''
  let password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || ''

  if (!privateKey && tauriEnv.signingPrivateKey) {
    privateKey = tauriEnv.signingPrivateKey.replace(/\r?\n/g, '\n').trim()
    if (typeof tauriEnv.signingPrivateKeyPassword === 'string') {
      password = tauriEnv.signingPrivateKeyPassword
    }
    console.log('[tauri-build] 已从 env.json 注入更新器签名私钥')
  }

  if (!privateKey) {
    console.error('[tauri-build] 缺少更新器签名私钥：')
    console.error('[tauri-build] 请在根目录 env.json 中配置 tauri.signingPrivateKey，')
    console.error('[tauri-build] 或设置环境变量 TAURI_SIGNING_PRIVATE_KEY')
    process.exit(1)
  }

  // ---- 更新器公钥（env.json → 合并配置 → --config 传给 tauri build）----
  const pubkey = (process.env.TAURI_UPDATER_PUBKEY || tauriEnv.updaterPubkey || '').trim()
  if (!pubkey) {
    console.error('[tauri-build] 缺少更新器公钥：')
    console.error('[tauri-build] 请在根目录 env.json 中配置 tauri.updaterPubkey，')
    console.error('[tauri-build] 或设置环境变量 TAURI_UPDATER_PUBKEY')
    process.exit(1)
  }

  let args = process.argv.slice(2)
  // 未显式指定 --bundles 时，按当前平台注入默认值
  const hasBundles = args.some((a) => a === '--bundles' || a === '-b')
  if (!hasBundles && PLATFORM_BUNDLES[process.platform]) {
    args = [...args, '--bundles', PLATFORM_BUNDLES[process.platform]]
    console.log(`[tauri-build] 未指定 --bundles，按平台使用: ${PLATFORM_BUNDLES[process.platform]}`)
  }

  // 合并 release 配置 + 用户显式 --config + 公钥，生成单一注入配置
  const { paths: userConfigPaths, rest } = extractConfigPaths(args)
  args = rest
  const injectedPath = writeInjectedConfig([RELEASE_CONFIG, ...userConfigPaths], pubkey)
  args.push('--config', injectedPath)
  console.log('[tauri-build] 已注入更新器公钥 ->', injectedPath)

  console.log(`[tauri-build] tauri build ${args.join(' ')}`)

  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(cmd, ['tauri', 'build', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
      // 通知 build-frontend.js 对 js/css 执行 esbuild minify（仅生产构建，dev 不压缩便于调试）
      FRONTEND_MINIFY: '1',
    },
    cwd: ROOT,
  })

  process.exit(result.status == null ? 1 : result.status)
}

main()
