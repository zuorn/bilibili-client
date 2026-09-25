// scripts/tauri-build.js — tauri build 包装：自动注入更新器签名私钥
//
// 背景：tauri.conf.json 配置了 createUpdaterArtifacts + updater 公钥，
// 构建时必须提供 TAURI_SIGNING_PRIVATE_KEY，否则报错：
//   "A public key has been found, but no private key."
//
// 私钥从根目录 env.json 读取（已加入 .gitignore，不会提交）：
//   {
//     "tauri": {
//       "signingPrivateKey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
//       "signingPrivateKeyPassword": ""
//     },
//     "oss": { ... }
//   }
// 已导出的同名环境变量优先于 env.json。
//
// 用法（与 tauri build 参数一致，原样透传）：
//   npm run tauri:build            # 等价 tauri build
//   npm run tauri:build:nsis       # 等价 tauri build --bundles nsis
//   node scripts/tauri-build.js --bundles nsis
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, 'env.json')

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

function main() {
  const envJson = loadEnvJson()

  let privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY || ''
  let password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || ''

  if (!privateKey) {
    const tauri = envJson && envJson.tauri
    if (tauri && tauri.signingPrivateKey) {
      privateKey = tauri.signingPrivateKey.replace(/\r?\n/g, '\n').trim()
      if (typeof tauri.signingPrivateKeyPassword === 'string') {
        password = tauri.signingPrivateKeyPassword
      }
      console.log('[tauri-build] 已从 env.json 注入更新器签名私钥')
    }
  }

  if (!privateKey) {
    console.error('[tauri-build] 缺少更新器签名私钥：')
    console.error('[tauri-build] 请在根目录 env.json 中配置 tauri.signingPrivateKey，')
    console.error('[tauri-build] 或设置环境变量 TAURI_SIGNING_PRIVATE_KEY')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  console.log(`[tauri-build] tauri build ${args.join(' ')}`)

  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(cmd, ['tauri', 'build', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    },
    cwd: ROOT,
  })

  process.exit(result.status == null ? 1 : result.status)
}

main()
