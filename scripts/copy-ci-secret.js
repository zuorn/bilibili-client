// scripts/copy-ci-secret.js — 复制 CI 所需的签名私钥到剪贴板（GitHub Secret: TAURI_SIGNING_PRIVATE_KEY）
//
// 用途：env.json 的 tauri.signingPrivateKey（单行 Base64）就是 tauri 需要的私钥形态
// （本地构建签名成功即为证明）。本脚本校验格式后整体复制到剪贴板，直接粘贴到
// GitHub Secrets 即可，避免从文件手动复制时漏字符。
//
// 注意：不要粘贴其他形态（如密钥文件原文、或对它再编码的 Base64），
// 否则 CI 会在签名时报 "Missing comment in secret key"。
//
// 用法：
//   node scripts/copy-ci-secret.js
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, 'env.json')

function main() {
  const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'))
  const privateKey = ((env.tauri && env.tauri.signingPrivateKey) || '').replace(/\s+/g, '')
  if (!privateKey) {
    console.error('[ci-secret] env.json 中缺少 tauri.signingPrivateKey')
    process.exit(1)
  }

  // 自检：与 tauri 解码方式一致 —— base64 解码一次后应出现 minisign 私钥头
  const decoded = Buffer.from(privateKey, 'base64').toString('utf8')
  if (!decoded.includes('untrusted comment')) {
    console.error('[ci-secret] env.json 的 signingPrivateKey 不是有效的 tauri 私钥（base64 解码后缺少 untrusted comment 头）')
    process.exit(1)
  }
  console.log('[ci-secret] 私钥自检通过（base64 解码含 untrusted comment 头）')
  console.log('[ci-secret] Secret 名: TAURI_SIGNING_PRIVATE_KEY（粘贴此单行 Base64 值）')

  const tmpFile = path.join(ROOT, '.workbuddy', 'ci-signing-key.txt')
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true })
  fs.writeFileSync(tmpFile, privateKey, 'utf8')

  try {
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Set-Clipboard -Value (Get-Content -Raw '${tmpFile.replace(/'/g, "''")}')"`)
      console.log('[ci-secret] 剪贴板已更新（单行 Base64），直接到 GitHub Secrets 页面粘贴即可')
    } else if (process.platform === 'darwin') {
      execSync(`pbcopy < "${tmpFile}"`)
      console.log('[ci-secret] 剪贴板已更新，直接到 GitHub Secrets 页面粘贴即可')
    } else {
      console.log('[ci-secret] 请手动打开文件复制全部内容（单行）:', tmpFile)
    }
  } catch (e) {
    console.warn('[ci-secret] 复制到剪贴板失败，请手动打开文件复制:', tmpFile, e.message)
  }
}

main()
