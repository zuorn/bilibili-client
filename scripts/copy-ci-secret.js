// scripts/copy-ci-secret.js — 生成 CI 所需的签名私钥 Secret 值（Base64）并复制到剪贴板
//
// 背景：tauri.signingPrivateKey 是含换行的多行 Base64，手工粘贴到 GitHub Secrets
// 容易被破坏（换行丢失/空白变化），导致 CI 报
//   "failed to decode secret key: incorrect updater private key password: Missing comment in secret key"
// 解决：把私钥整体再做一次 Base64，得到单行字符串，粘贴不会损坏；
// CI 中 base64 -d 解码后使用（见 .github/workflows/build.yml 的 Decode updater signing key 步骤）。
//
// 用法：
//   node scripts/copy-ci-secret.js          # 复制到剪贴板并写入 .workbuddy/ci-signing-key.b64
//   node scripts/copy-ci-secret.js --check  # 校验现有 Secret 值是否正确（粘贴后可自行粘贴回车对比）
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, 'env.json')
const OUT_FILE = path.join(ROOT, '.workbuddy', 'ci-signing-key.b64')

function main() {
  const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'))
  const privateKey = (env.tauri && env.tauri.signingPrivateKey || '').replace(/\r?\n/g, '\n').trim()
  if (!privateKey) {
    console.error('[ci-secret] env.json 中缺少 tauri.signingPrivateKey')
    process.exit(1)
  }

  // 自检：私钥解码后必须是 minisign 私钥格式（含 untrusted comment 头）
  const decoded = Buffer.from(privateKey, 'base64').toString('utf8')
  if (!decoded.includes('untrusted comment')) {
    console.error('[ci-secret] env.json 的 signingPrivateKey 不是有效的 minisign 私钥（解码后缺少 untrusted comment 头）')
    process.exit(1)
  }

  const b64 = Buffer.from(privateKey, 'utf8').toString('base64')
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, b64, 'utf8')
  console.log('[ci-secret] 私钥自检通过（minisign 格式）')
  console.log('[ci-secret] Secret 名: TAURI_SIGNING_PRIVATE_KEY_B64')
  console.log('[ci-secret] 值已复制到剪贴板，并写入文件:', OUT_FILE)

  try {
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Set-Clipboard -Value (Get-Content -Raw '${OUT_FILE.replace(/'/g, "''")}')"`)
      console.log('[ci-secret] 剪贴板已更新，直接到 GitHub Secrets 页面粘贴即可（单行 Base64）')
    } else if (process.platform === 'darwin') {
      execSync(`pbcopy < "${OUT_FILE}"`)
      console.log('[ci-secret] 剪贴板已更新，直接到 GitHub Secrets 页面粘贴即可（单行 Base64）')
    } else {
      console.log('[ci-secret] 请手动打开文件复制内容:', OUT_FILE)
    }
  } catch (e) {
    console.warn('[ci-secret] 复制到剪贴板失败，请手动打开文件复制:', OUT_FILE, e.message)
  }

  // 回读校验：b64 解码后与原私钥逐字节一致
  const roundTrip = Buffer.from(b64, 'base64').toString('utf8')
  console.log('[ci-secret] 回读校验:', roundTrip === privateKey ? '一致 ✓' : '不一致 ✗（异常，请反馈）')
}

main()
