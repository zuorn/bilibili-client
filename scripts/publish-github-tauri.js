// scripts/publish-github-tauri.js — 发布 Tauri 构建产物到 GitHub Releases（供 tauri-plugin-updater 检查）
//
// 背景：updater.rs 的 GITHUB_FEED 指向
//   https://github.com/zuorn/bilibili-client/releases/latest/download/latest.json
// 该 URL 会取「最新非 draft、非 prerelease」Release 里名为 latest.json 的资产。
// Release 必须附带：各平台安装包 + 对应 .sig + latest.json（tauri updater 格式，签名内嵌）。
//
// 支持的多平台产物（脚本自动扫描存在的部分，按 tauri.conf.json 版本号过滤）：
//   Windows : */bundle/nsis/*_x64-setup.exe(.sig)                → windows-x86_64
//   macOS   : */bundle/macos/*_{aarch64|x64}.app.tar.gz(.sig)    → darwin-aarch64 / darwin-x86_64
//   Linux   : */bundle/appimage/*_amd64.AppImage(.sig)           → linux-x86_64
//
// 用法：
//   node scripts/publish-github-tauri.js                 # 创建 Release 并上传
//   node scripts/publish-github-tauri.js --dry-run       # 只生成本地 latest.json，不执行 gh 命令
//   node scripts/publish-github-tauri.js --notes "更新说明"
//   node scripts/publish-github-tauri.js --draft         # 以 draft 发布（客户端不会检测到，需手动 publish）
//
// 依赖：gh CLI（已登录，且仓库远端为 zuorn/bilibili-client）
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const TARGET_DIR = path.join(PROJECT_ROOT, 'src-tauri', 'target')
const TAURI_CONF = path.join(PROJECT_ROOT, 'src-tauri', 'tauri.conf.json')

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const DRAFT = argv.includes('--draft')
const notesIdx = argv.indexOf('--notes')
const NOTES = notesIdx >= 0 ? (argv[notesIdx + 1] || '') : ''

// 文件名安全化：GitHub 资产名不允许空格（会被替换成点，导致 URL 失配）
function safeName(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '-')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// 版本号唯一源头：根目录 VERSION 文件；回退 tauri.conf.json 的 version
function readAppVersion() {
  const versionFile = path.join(PROJECT_ROOT, 'VERSION')
  if (fs.existsSync(versionFile)) {
    const v = fs.readFileSync(versionFile, 'utf8').trim()
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

// 扫描目录中匹配版本的文件（忽略 .sig），返回绝对路径或 null
function findInDir(dir, predicate) {
  if (!fs.existsSync(dir)) return null
  const hit = fs.readdirSync(dir).find(predicate)
  return hit ? path.join(dir, hit) : null
}

// 各目录候选：原生构建 target/release + 交叉构建 target/<triple>
function bundleDirs(kind) {
  const triples = { nsis: 'x86_64-pc-windows-msvc', appimage: 'x86_64-unknown-linux-gnu' }
  const dirs = [path.join(TARGET_DIR, 'release', 'bundle', kind)]
  if (triples[kind]) {
    dirs.push(path.join(TARGET_DIR, triples[kind], 'release', 'bundle', kind))
  }
  if (kind === 'macos') {
    dirs.push(path.join(TARGET_DIR, 'aarch64-apple-darwin', 'release', 'bundle', 'macos'))
    dirs.push(path.join(TARGET_DIR, 'x86_64-apple-darwin', 'release', 'bundle', 'macos'))
  }
  return dirs
}

function findArtifacts(version) {
  const out = []

  // Windows
  for (const dir of bundleDirs('nsis')) {
    const exe = findInDir(dir, (f) => f.endsWith('-setup.exe') && f.includes(`_${version}_`))
    if (!exe) continue
    const sig = `${exe}.sig`
    if (!fs.existsSync(sig)) {
      console.error(`[GitHub] 缺少 Windows 签名文件: ${sig}`)
      console.error('[GitHub] 请确认 createUpdaterArtifacts = true 且设置了 TAURI_SIGNING_PRIVATE_KEY')
      process.exit(1)
    }
    out.push({ platformKey: 'windows-x86_64', artifact: exe, sig, dir })
  }

  // macOS（app.tar.gz 为 updater 产物，dmg 仅分发）
  for (const dir of bundleDirs('macos')) {
    const tarGz = findInDir(dir, (f) => f.endsWith('.app.tar.gz') && f.includes(`_${version}_`))
    if (!tarGz) continue
    const sig = `${tarGz}.sig`
    if (!fs.existsSync(sig)) {
      console.error(`[GitHub] 缺少 macOS 签名文件: ${sig}`)
      console.error('[GitHub] 请确认 createUpdaterArtifacts = true 且设置了 TAURI_SIGNING_PRIVATE_KEY')
      process.exit(1)
    }
    const platformKey = path.basename(tarGz).includes('aarch64') ? 'darwin-aarch64' : 'darwin-x86_64'
    out.push({ platformKey, artifact: tarGz, sig, dir })
  }

  // Linux
  for (const dir of bundleDirs('appimage')) {
    const img = findInDir(dir, (f) => f.endsWith('.AppImage') && f.includes(`_${version}_`))
    if (!img) continue
    const sig = `${img}.sig`
    if (!fs.existsSync(sig)) {
      console.error(`[GitHub] 缺少 Linux 签名文件: ${sig}`)
      console.error('[GitHub] 请确认 createUpdaterArtifacts = true 且设置了 TAURI_SIGNING_PRIVATE_KEY')
      process.exit(1)
    }
    out.push({ platformKey: 'linux-x86_64', artifact: img, sig, dir })
  }

  return out
}

async function main() {
  if (!fs.existsSync(TAURI_CONF)) {
    console.error('[GitHub] 未找到 tauri.conf.json:', TAURI_CONF)
    process.exit(1)
  }

  const conf = readJson(TAURI_CONF)
  const version = readAppVersion()
  const repo = detectRepo()
  const tag = `v${version}`

  // 1. 定位产物（按 tauri.conf.json 的 version 精确匹配）
  const artifacts = findArtifacts(version)
  if (artifacts.length === 0) {
    console.error(`[GitHub] 未找到版本 ${version} 的任何更新器产物`)
    console.error('[GitHub] 请先执行 npm run tauri:build（按当前平台）或对应平台构建')
    process.exit(1)
  }

  // 2. 准备资产：重命名去掉空格，读取签名
  const assets = []
  const platforms = {}
  for (const item of artifacts) {
    const baseName = path.basename(item.artifact)
    const assetName = safeName(baseName)
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

  // 3. 生成 latest.json（tauri-plugin-updater 格式）
  const latest = {
    version,
    notes: NOTES,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms,
  }
  const latestPath = path.join(TARGET_DIR, 'release', 'bundle', 'latest.json')
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

  // 4. 创建 Release 并上传资产（已存在则仅覆盖上传资产）
  const existing = gh(['release', 'view', tag, '--repo', repo, '--json', 'id', '-q', '.id'], { capture: true })
  if (existing && existing.trim()) {
    console.log(`[GitHub] Release ${tag} 已存在，仅覆盖上传资产`)
    gh(['release', 'upload', tag, '--repo', repo, '--clobber', ...assets])
  } else {
    const downloads = assets
      .filter((a) => !a.endsWith('.sig') && !a.endsWith('.json'))
      .map((a) => `- \`${path.basename(a)}\``)
      .join('\n')
    gh([
      'release', 'create', tag,
      '--repo', repo,
      '--title', `Bilibili Client ${tag}`,
      '--notes', NOTES || `## Bilibili Client ${tag}\n\n### Downloads\n${downloads}`,
      DRAFT ? '--draft' : '--latest',
      ...assets,
    ])
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
