// scripts/sync-version.js — 版本号同步工具
//
// 根目录 VERSION 文件是版本号的唯一源头（与 tauri-build.js / tauri-dev.js /
// publish-oss-tauri.js / publish-github-tauri.js / CI build.yml 一致）。
// 本模块把 VERSION 同步到：
//   1. package.json 的 version 字段
//   2. src-tauri/Cargo.toml 的 [package] version（crate 元数据）
//   3. src-tauri/Cargo.lock 中 bilibili-client 条目（保持与 Cargo.toml 一致，避免构建时 cargo 改写 lock）
// 供 tauri-build.js / tauri-dev.js 在启动时自动调用（用户只需改 VERSION），
// 也可手动执行：node scripts/sync-version.js
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const VERSION_FILE = path.join(ROOT, 'VERSION')
const PKG_FILE = path.join(ROOT, 'package.json')
const CARGO_TOML_FILE = path.join(ROOT, 'src-tauri', 'Cargo.toml')
const CARGO_LOCK_FILE = path.join(ROOT, 'src-tauri', 'Cargo.lock')

// 读取版本号唯一源头 VERSION；缺失或为空返回 null
function readAppVersion() {
  if (!fs.existsSync(VERSION_FILE)) return null
  const v = fs.readFileSync(VERSION_FILE, 'utf8').trim()
  return v || null
}

// 同步 Cargo.toml 的 [package] version 与 Cargo.lock 中本 crate 的版本
// 说明：^version 行首锚定只命中 [package] 段自身，依赖的 version 写在 { version = "..." } 里不会误伤
function syncCargoFiles(version, log) {
  if (fs.existsSync(CARGO_TOML_FILE)) {
    const raw = fs.readFileSync(CARGO_TOML_FILE, 'utf8')
    const updated = raw.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
    if (updated !== raw) {
      fs.writeFileSync(CARGO_TOML_FILE, updated, 'utf8')
      log(`src-tauri/Cargo.toml version -> ${version}`)
    }
  }
  if (fs.existsSync(CARGO_LOCK_FILE)) {
    const raw = fs.readFileSync(CARGO_LOCK_FILE, 'utf8')
    const re = /(\[\[package\]\]\r?\nname = "bilibili-client"\r?\nversion = )"[^"]*"/
    const updated = raw.replace(re, `$1"${version}"`)
    if (updated !== raw) {
      fs.writeFileSync(CARGO_LOCK_FILE, updated, 'utf8')
      log(`src-tauri/Cargo.lock bilibili-client version -> ${version}`)
    }
  }
}

// 把 VERSION 同步到 package.json / Cargo.toml / Cargo.lock；
// 返回当前版本号（VERSION 缺失时返回 null）。log 仅在发生实际写入时调用
function syncPackageVersion(log = () => {}) {
  const version = readAppVersion()
  if (!version) return null
  syncCargoFiles(version, log)
  const pkgRaw = fs.readFileSync(PKG_FILE, 'utf8')
  const pkg = JSON.parse(pkgRaw)
  if (pkg.version !== version) {
    const old = pkg.version
    pkg.version = version
    // 保持原文件尾部换行风格
    const tail = pkgRaw.endsWith('\n') ? '\n' : ''
    fs.writeFileSync(PKG_FILE, JSON.stringify(pkg, null, 2) + tail, 'utf8')
    log(`package.json 版本 ${old} -> ${version}`)
  }
  return version
}

module.exports = { readAppVersion, syncPackageVersion }

if (require.main === module) {
  const version = syncPackageVersion((m) => console.log('[sync-version]', m))
  if (version) {
    console.log('[sync-version] 当前版本:', version)
  } else {
    console.warn('[sync-version] 未找到 VERSION 文件或内容为空，跳过同步')
    process.exit(1)
  }
}
