// scripts/publish-oss-tauri.js — 上传 Tauri 构建产物到 OSS（含 latest.json 生成）
//
// 与 Electron 版 publish-oss.js 的区别：
//   - 产物目录：src-tauri/target/release/bundle/nsis/
//   - 元数据由 electron-builder 的 latest.yml 改为 tauri-plugin-updater 的 latest.json
//   - 同时上传 *.exe.sig（签名随 latest.json 内嵌，.sig 单独留档便于排查）
//
// 用法：
//   node scripts/publish-oss-tauri.js              # 生成 latest.json 并上传
//   node scripts/publish-oss-tauri.js --dry-run    # 只生成本地 latest.json，不上传
//   node scripts/publish-oss-tauri.js --notes "修复若干问题"
const path = require('path')
const fs = require('fs')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const BUNDLE_DIR = path.join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const CONFIG_PATH = path.join(PROJECT_ROOT, 'oss-config.json') // 旧配置，向后兼容
const ENV_PATH = path.join(PROJECT_ROOT, 'env.json') // 推荐配置位置
const TAURI_CONF = path.join(PROJECT_ROOT, 'src-tauri', 'tauri.conf.json')

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const notesIdx = argv.indexOf('--notes')
const NOTES = notesIdx >= 0 ? (argv[notesIdx + 1] || '') : ''

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// 文件名安全化：OSS URL 中避免空格（updater 直接使用该 URL 下载）
function safeName(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '-')
}

async function main() {
  if (!fs.existsSync(TAURI_CONF)) {
    console.error('[OSS] 未找到 tauri.conf.json:', TAURI_CONF)
    process.exit(1)
  }
  if (!fs.existsSync(BUNDLE_DIR)) {
    console.error('[OSS] 打包目录不存在:', BUNDLE_DIR)
    console.error('[OSS] 请先执行 npm run tauri:build')
    process.exit(1)
  }

  const conf = readJson(TAURI_CONF)
  // 版本号唯一源头：根目录 VERSION 文件；回退 tauri.conf.json 的 version
  const versionFile = path.join(PROJECT_ROOT, 'VERSION')
  const version =
    (fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf8').trim()) || conf.version

  // 1. 定位产物（按 tauri.conf.json 的 version 精确匹配，避免选到旧版本残留）
  const files = fs.readdirSync(BUNDLE_DIR)
  const setupExe = files.find((f) => f === `Bilibili Client_${version}_x64-setup.exe`)
    || files.find((f) => f.endsWith(`_${version}_x64-setup.exe`))
  if (!setupExe) {
    console.error(`[OSS] 未在打包目录找到版本 ${version} 的 *_x64-setup.exe:`)
    console.error('[OSS] ' + files.filter((f) => f.endsWith('.exe')).join(', '))
    process.exit(1)
  }
  const sigFile = `${setupExe}.sig`
  if (!files.includes(sigFile)) {
    console.error('[OSS] 未找到签名文件:', sigFile)
    console.error('[OSS] 请确认 tauri.conf.json 中 bundle.createUpdaterArtifacts = true，')
    console.error('[OSS] 且构建时设置了 TAURI_SIGNING_PRIVATE_KEY 环境变量')
    process.exit(1)
  }

  const exePath = path.join(BUNDLE_DIR, setupExe)
  const signature = fs.readFileSync(path.join(BUNDLE_DIR, sigFile), 'utf8').trim()
  const exeSize = (fs.statSync(exePath).size / 1024 / 1024).toFixed(2)

  // 2. 读取 OSS 配置：优先 env.json 的 oss 字段，其次旧版 oss-config.json（dry-run 时允许缺失）
  let config = null
  if (fs.existsSync(ENV_PATH)) {
    try {
      const envJson = JSON.parse(fs.readFileSync(ENV_PATH, 'utf8'))
      if (envJson.oss && envJson.oss.accessKeyId) config = envJson.oss
    } catch (err) {
      console.error('[OSS] env.json 解析失败:', err.message)
    }
  }
  if (!config && fs.existsSync(CONFIG_PATH)) {
    config = readJson(CONFIG_PATH)
  }
  if (!config && !DRY_RUN) {
    console.error('[OSS] 未找到 OSS 配置（env.json 的 oss 字段或 oss-config.json）')
    process.exit(1)
  }
  if (!config) {
    console.error('[OSS] 未找到 OSS 配置，--dry-run 模式将只生成本地 latest.json')
  }

  const prefix = ((config && config.prefix) || 'doc/bl/bl').replace(/\/$/, '')
  const bucket = (config && config.bucket) || 'talktime'
  const region = (config && config.region) || 'oss-cn-shanghai'
  const publicBase = `https://${bucket}.${region}.aliyuncs.com`
  const remoteExeName = safeName(setupExe)
  const remoteExeUrl = `${publicBase}/${prefix}/${remoteExeName}`

  // 3. 生成 latest.json（tauri-plugin-updater 格式）
  const latest = {
    version,
    notes: NOTES,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms: {
      'windows-x86_64': {
        signature,
        url: remoteExeUrl,
      },
    },
  }
  const latestPath = path.join(BUNDLE_DIR, 'latest.json')
  fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2), 'utf8')

  console.log(`[OSS] 版本: ${version}`)
  console.log(`[OSS] 安装包: ${setupExe} (${exeSize} MB)`)
  console.log(`[OSS] 上传目标: ${publicBase}/${prefix}/`)
  console.log(`[OSS] 已生成本地清单: ${latestPath}`)
  console.log('')
  console.log(JSON.stringify(latest, null, 2))
  console.log('')

  if (DRY_RUN) {
    console.log('[OSS] --dry-run 模式：跳过上传')
    return
  }

  const { region: _r, accessKeyId, accessKeySecret } = config
  if (!accessKeyId || !accessKeySecret || accessKeyId === 'your-access-key-id') {
    console.error('[OSS] 请在 env.json 的 oss 字段中填入真实的 AccessKeyId / AccessKeySecret')
    process.exit(1)
  }

  // 4. 上传
  const OSS = require('ali-oss')
  const client = new OSS({ region, accessKeyId, accessKeySecret, bucket })

  const uploads = [
    { local: exePath, key: `${prefix}/${remoteExeName}`, label: `${remoteExeName} (${exeSize} MB)` },
    { local: path.join(BUNDLE_DIR, sigFile), key: `${prefix}/${remoteExeName}.sig`, label: `${remoteExeName}.sig` },
    { local: latestPath, key: `${prefix}/latest.json`, label: 'latest.json' },
  ]

  console.log('[OSS] 开始上传...')
  for (const item of uploads) {
    console.log(`  -> ${item.label}`)
    await client.put(item.key, item.local, {
      // latest.json 不能缓存，否则客户端检查更新拿到旧清单
      headers: item.key.endsWith('latest.json')
        ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
        : undefined,
    })
    console.log(`     完成: ${publicBase}/${item.key}`)
  }
  console.log('\n[OSS] 全部完成 ✓')
}

main().catch((err) => {
  console.error('[OSS] 发布失败:', err.message)
  process.exit(1)
})
