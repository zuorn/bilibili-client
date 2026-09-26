// scripts/publish-github-tauri.js — 发布 Tauri 构建产物到 GitHub Releases（tauri-plugin-updater 格式）
//
// 背景：updater.rs 的 GITHUB_FEED 指向
//   https://github.com/<owner>/<repo>/releases/latest/download/latest.json
// 该 URL 取「最新非 draft、非 prerelease」Release 里名为 latest.json 的资产。
// Release 必须附带：各平台安装包 + 对应 .sig + latest.json（签名内嵌）。
//
// 产物识别（按 VERSION / tauri.conf.json 的版本号过滤，递归扫描）：
//   Windows : *_x64-setup.exe(.sig)                → windows-x86_64
//   macOS   : *_{aarch64|x64}.app.tar.gz(.sig)     → darwin-aarch64 / darwin-x86_64
//   Linux   : *_amd64.AppImage(.sig)               → linux-x86_64
//
// 扫描根目录：
//   默认     本地 src-tauri/target/**/bundle（含交叉构建 triple 目录）
//   --dir X  指定目录（CI 中传 actions/download-artifact 的下载目录）
//
// 上传方式：gh CLI，顺序执行、--clobber 幂等覆盖 —— 重复运行/重跑 job 均安全，
// 规避 tauri-action 并发更新同一 Release 资产时的 404 竞态。
//
// 用法：
//   node scripts/publish-github-tauri.js                     # 本地产物 → Release
//   node scripts/publish-github-tauri.js --dry-run           # 只生成本地 latest.json
//   node scripts/publish-github-tauri.js --dir ci-artifacts  # CI：扫描下载的产物目录
//   可选：--notes "说明"  --draft
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const TARGET_DIR = path.join(PROJECT_ROOT, 'src-tauri', 'target')
const TAURI_CONF = path.join(PROJECT_ROOT, 'src-tauri', 'tauri.conf.json')
const VERSION_FILE = path.join(PROJECT_ROOT, 'VERSION')

const argv = process.argv.slice(2)
function argValue(name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const DRY_RUN = argv.includes('--dry-run')
const DRAFT = argv.includes('--draft')
const SCAN_DIR = argValue('--dir')
const NOTES = argValue('--notes') || ''
const TARGET_SHA = process.env.GITHUB_SHA || ''

// 文件名安全化：GitHub 资产名不允许空格（会被规范化成点，导致 URL 失配）
function safeName(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '-')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// 版本号唯一源头：根目录 VERSION 文件；回退 tauri.conf.json 的 version
function readAppVersion() {
  if (fs.existsSync(VERSION_FILE)) {
    const v = fs.readFileSync(VERSION_FILE, 'utf8').trim()
    if (v) return v
  }
  return readJson(TAURI_CONF).version
}

// 从 git remote 解析 owner/repo，失败则回退默认值（与 updater.rs 保持一致）
function detectRepo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    }).trim()
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/)
    if (m) return `${m[1]}/${m[2]}`
  } catch (_) {}
  return 'zuorn/bilibili-client'
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
}

// 递归收集目录下所有文件
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// 按文件名分类更新器产物（返回 platformKey 或 null）
function classify(name, version) {
  if (name.endsWith('.sig')) return null
  if (name.endsWith('-setup.exe') && name.includes(`_${version}_`)) return 'windows-x86_64'
  if (name.endsWith('.app.tar.gz') && name.includes(`_${version}_`)) {
    return name.includes('aarch64') ? 'darwin-aarch64' : 'darwin-x86_64'
  }
  if (name.endsWith('.AppImage') && name.includes(`_${version}_`)) return 'linux-x86_64'
  return null
}

// 扫描根目录列表，收集 { platformKey, artifact, sig, dir } 与 dmg（仅分发用）
function findArtifacts(version, roots) {
  const out = []
  const dmgAssets = []
  const seen = new Set() // 同一平台只取第一个候选
  const dmgSeen = new Set()
  for (const root of roots) {
    for (const file of walk(root)) {
      const name = path.basename(file)
      // dmg 仅用于手动下载分发，不进 latest.json
      if (name.endsWith('.dmg') && name.includes(`_${version}_`) && !dmgSeen.has(name)) {
        dmgSeen.add(name)
        dmgAssets.push(file)
        continue
      }
      const key = classify(name, version)
      if (!key || seen.has(key)) continue
      const sig = `${file}.sig`
      if (!fs.existsSync(sig)) {
        console.error(`[GitHub] 缺少签名文件: ${sig}`)
        console.error('[GitHub] 请确认 createUpdaterArtifacts = true 且设置了 TAURI_SIGNING_PRIVATE_KEY')
        process.exit(1)
      }
      seen.add(key)
      out.push({ platformKey: key, artifact: file, sig, dir: path.dirname(file) })
    }
  }
  return { artifacts: out, dmgAssets }
}

function main() {
  if (!fs.existsSync(TAURI_CONF)) {
    console.error('[GitHub] 未找到 tauri.conf.json:', TAURI_CONF)
    process.exit(1)
  }

  const version = readAppVersion()
  const repo = detectRepo()
  const tag = `v${version}`

  // 1. 定位产物
  const roots = SCAN_DIR
    ? [path.resolve(PROJECT_ROOT, SCAN_DIR)]
    : [
        path.join(TARGET_DIR, 'release', 'bundle'),
        path.join(TARGET_DIR, 'x86_64-pc-windows-msvc', 'release', 'bundle'),
        path.join(TARGET_DIR, 'aarch64-apple-darwin', 'release', 'bundle'),
        path.join(TARGET_DIR, 'x86_64-apple-darwin', 'release', 'bundle'),
        path.join(TARGET_DIR, 'x86_64-unknown-linux-gnu', 'release', 'bundle'),
      ]
  const { artifacts, dmgAssets } = findArtifacts(version, roots)
  if (artifacts.length === 0) {
    console.error(`[GitHub] 未找到版本 ${version} 的任何更新器产物（扫描: ${roots.join(', ')}）`)
    process.exit(1)
  }

  // 2. 准备资产：重命名去掉空格，读取签名
  const assets = []
  const platforms = {}
  for (const item of artifacts) {
    const assetName = safeName(path.basename(item.artifact))
    const assetPath = path.join(item.dir, assetName)
    if (assetPath !== item.artifact) fs.copyFileSync(item.artifact, assetPath)
    const assetSigPath = path.join(item.dir, `${assetName}.sig`)
    fs.writeFileSync(assetSigPath, fs.readFileSync(item.sig, 'utf8'), 'utf8')
    assets.push(assetPath, assetSigPath)
    platforms[item.platformKey] = {
      signature: fs.readFileSync(item.sig, 'utf8').trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${assetName}`,
    }
  }
  // dmg 仅分发，不进 latest.json
  for (const dmg of dmgAssets) {
    const assetName = safeName(path.basename(dmg))
    const assetPath = path.join(path.dirname(dmg), assetName)
    if (assetPath !== dmg) fs.copyFileSync(dmg, assetPath)
    assets.push(assetPath)
  }

  // 3. 生成 latest.json（tauri-plugin-updater 格式）
  const latest = {
    version,
    notes: NOTES,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms,
  }
  const latestPath = path.join(artifacts[0].dir, 'latest.json')
  fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2), 'utf8')
  assets.push(latestPath)

  console.log(`[GitHub] 仓库: ${repo}`)
  console.log(`[GitHub] 版本: ${version}（tag: ${tag}${DRAFT ? ', draft' : ''}）`)
  console.log('[GitHub] 更新器平台:')
  for (const item of artifacts) {
    const size = (fs.statSync(item.artifact).size / 1024 / 1024).toFixed(2)
    console.log(`  - ${item.platformKey}: ${safeName(path.basename(item.artifact))} (${size} MB)`)
  }
  console.log(`[GitHub] 已生成清单: ${latestPath}`)
  console.log(JSON.stringify(latest, null, 2))

  if (DRY_RUN) {
    console.log('[GitHub] --dry-run 模式：跳过发布')
    return
  }

  // 4. 创建（或复用）Release 并上传资产 —— 顺序执行，--clobber 幂等
  // 注意：gh release view 对不存在的 Release 会以非零退出码报 "release not found"，
  // execFileSync 会抛异常，这里必须捕获并视为「不存在」
  let existing = ''
  try {
    existing = gh(['release', 'view', tag, '--repo', repo, '--json', 'id', '-q', '.id'], { capture: true })
  } catch (_) {
    existing = ''
  }
  if (existing && existing.trim()) {
    console.log(`[GitHub] Release ${tag} 已存在，覆盖上传资产`)
    gh(['release', 'upload', tag, '--repo', repo, '--clobber', ...assets])
  } else {
    const createArgs = [
      'release', 'create', tag,
      '--repo', repo,
      '--title', `Bilibili Client ${tag}`,
      '--notes', NOTES || `## Bilibili Client ${tag}`,
    ]
    if (DRAFT) createArgs.push('--draft')
    else createArgs.push('--latest')
    // CI 中分支推送触发时 tag 尚不存在，钉到当前 commit
    if (TARGET_SHA) createArgs.push('--target', TARGET_SHA)
    createArgs.push(...assets)
    gh(createArgs)
  }
  console.log(`\n[GitHub] 发布完成 ✓ https://github.com/${repo}/releases/tag/${tag}`)
  console.log('[GitHub] 客户端 GitHub 源地址: https://github.com/' + repo + '/releases/latest/download/latest.json')
}

try {
  main()
} catch (err) {
  console.error('[GitHub] 发布失败:', err.message)
  process.exit(1)
}
