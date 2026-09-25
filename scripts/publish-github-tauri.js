// scripts/publish-github-tauri.js — 发布 Tauri 构建产物到 GitHub Releases（供 tauri-plugin-updater 检查）
//
// 背景：updater.rs 的 GITHUB_FEED 指向
//   https://github.com/zuorn/bilibili-client/releases/latest/download/latest.json
// 该 URL 会取「最新非 draft、非 prerelease」Release 里名为 latest.json 的资产。
// 因此 Release 必须附带：安装包 exe、exe.sig、latest.json（tauri updater 格式，签名内嵌）。
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
const BUNDLE_DIR = path.join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
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
  return execFileSync('gh', args, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
}

async function main() {
  if (!fs.existsSync(TAURI_CONF)) {
    console.error('[GitHub] 未找到 tauri.conf.json:', TAURI_CONF)
    process.exit(1)
  }
  if (!fs.existsSync(BUNDLE_DIR)) {
    console.error('[GitHub] 打包目录不存在:', BUNDLE_DIR)
    console.error('[GitHub] 请先执行 npm run tauri:build')
    process.exit(1)
  }

  const conf = readJson(TAURI_CONF)
  const version = conf.version
  const repo = detectRepo()
  const tag = `v${version}`

  // 1. 定位产物（按 tauri.conf.json 的 version 精确匹配）
  const files = fs.readdirSync(BUNDLE_DIR)
  const setupExe = files.find((f) => f === `Bilibili Client_${version}_x64-setup.exe`)
    || files.find((f) => f.endsWith(`_${version}_x64-setup.exe`))
  if (!setupExe) {
    console.error(`[GitHub] 未在打包目录找到版本 ${version} 的 *_x64-setup.exe:`)
    console.error('[GitHub] ' + files.filter((f) => f.endsWith('.exe')).join(', '))
    process.exit(1)
  }
  const sigFile = `${setupExe}.sig`
  if (!files.includes(sigFile)) {
    console.error('[GitHub] 未找到签名文件:', sigFile)
    console.error('[GitHub] 请确认 tauri.conf.json 中 bundle.createUpdaterArtifacts = true，')
    console.error('[GitHub] 且构建时设置了 TAURI_SIGNING_PRIVATE_KEY 环境变量')
    process.exit(1)
  }

  const exePath = path.join(BUNDLE_DIR, setupExe)
  const signature = fs.readFileSync(path.join(BUNDLE_DIR, sigFile), 'utf8').trim()
  const exeSize = (fs.statSync(exePath).size / 1024 / 1024).toFixed(2)

  // 2. 重命名资产（去掉空格），保证下载 URL 稳定
  const assetName = safeName(setupExe)
  const assetPath = path.join(BUNDLE_DIR, assetName)
  if (assetPath !== exePath) fs.copyFileSync(exePath, assetPath)
  const assetSigPath = path.join(BUNDLE_DIR, `${assetName}.sig`)
  fs.writeFileSync(assetSigPath, signature, 'utf8')

  // 3. 生成 latest.json（tauri-plugin-updater 格式，URL 指向 GitHub Release 资产）
  const latest = {
    version,
    notes: NOTES,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms: {
      'windows-x86_64': {
        signature,
        url: `https://github.com/${repo}/releases/download/${tag}/${assetName}`,
      },
    },
  }
  const latestPath = path.join(BUNDLE_DIR, 'latest.json')
  fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2), 'utf8')

  console.log(`[GitHub] 仓库: ${repo}`)
  console.log(`[GitHub] 版本: ${version}（tag: ${tag}${DRAFT ? ', draft' : ''}）`)
  console.log(`[GitHub] 安装包: ${assetName} (${exeSize} MB)`)
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
    gh(['release', 'upload', tag, '--repo', repo, '--clobber', assetPath, assetSigPath, latestPath])
  } else {
    gh([
      'release', 'create', tag,
      '--repo', repo,
      '--title', `Bilibili Client ${tag}`,
      '--notes', NOTES || `## Bilibili Client ${tag}\n\n### Downloads\n- Windows: \`${assetName}\``,
      DRAFT ? '--draft' : '--latest',
      assetPath, assetSigPath, latestPath,
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
