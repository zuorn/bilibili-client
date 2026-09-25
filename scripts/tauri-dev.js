// scripts/tauri-dev.js — tauri dev 包装：注入更新器公钥（与 tauri-build.js 同源的 env.json）
//
// 背景：tauri.conf.json 不再硬编码 plugins.updater.pubkey，公钥统一存放在 env.json
// （tauri.updaterPubkey）。dev 模式下应用启动 3 秒会自动检查更新，缺少公钥会导致
// 「检查失败」。本脚本把公钥写入 src-tauri/target/tauri.dev-injected.conf.json
// （target 已 gitignore）并通过 --config 传入。
//
// 说明：dev 配置不含 tauri.release.conf.json（保留 WebView2 调试日志参数）。
//
// 用法（与 tauri dev 参数一致，原样透传）：
//   npm run tauri:dev
//   node scripts/tauri-dev.js --release
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, 'env.json')
const INJECTED_CONFIG = path.join(ROOT, 'src-tauri', 'target', 'tauri.dev-injected.conf.json')

function main() {
  let pubkey = (process.env.TAURI_UPDATER_PUBKEY || '').trim()
  if (!pubkey && fs.existsSync(ENV_FILE)) {
    try {
      const envJson = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'))
      pubkey = ((envJson.tauri && envJson.tauri.updaterPubkey) || '').trim()
    } catch (err) {
      console.error('[tauri-dev] env.json 解析失败:', err.message)
      process.exit(1)
    }
  }
  if (!pubkey) {
    console.error('[tauri-dev] 缺少更新器公钥：请在 env.json 配置 tauri.updaterPubkey，')
    console.error('[tauri-dev] 或设置环境变量 TAURI_UPDATER_PUBKEY')
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(INJECTED_CONFIG), { recursive: true })
  const conf = { plugins: { updater: { pubkey } } }
  // 版本号引用根目录 VERSION（tauri.conf.json 不再写死版本）
  const versionFile = path.join(ROOT, 'VERSION')
  if (fs.existsSync(versionFile)) {
    const version = fs.readFileSync(versionFile, 'utf8').trim()
    if (version) {
      conf.version = version
      console.log('[tauri-dev] 已引用 VERSION 文件版本:', version)
    }
  }
  fs.writeFileSync(INJECTED_CONFIG, JSON.stringify(conf, null, 2), 'utf8')
  console.log('[tauri-dev] 已注入更新器公钥 ->', INJECTED_CONFIG)

  const args = process.argv.slice(2)
  console.log(`[tauri-dev] tauri dev --config ${INJECTED_CONFIG} ${args.join(' ')}`)

  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(cmd, ['tauri', 'dev', '--config', INJECTED_CONFIG, ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: ROOT,
  })

  process.exit(result.status == null ? 1 : result.status)
}

main()
