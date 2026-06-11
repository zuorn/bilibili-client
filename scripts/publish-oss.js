// scripts/publish-oss.js — 上传构建产物到 OSS
const path = require('path')
const fs = require('fs')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(PROJECT_ROOT, 'dist')
const CONFIG_PATH = path.join(PROJECT_ROOT, 'oss-config.json')
const PKG_PATH = path.join(PROJECT_ROOT, 'package.json')

// 允许上传的文件名模式（electron-builder 生成的产物）
const ALLOWED_PATTERNS = [
  /^latest\.yml$/,
  /^Bilibili-Client-Setup-.+\.exe$/,
  /^Bilibili-Client-Setup-.+\.exe\.blockmap$/
]

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

async function main() {
  // 1. 读取配置
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[OSS] 未找到配置文件:', CONFIG_PATH)
    console.error('[OSS] 请在项目根目录创建 oss-config.json，包含 region、accessKeyId、accessKeySecret、bucket、prefix')
    process.exit(1)
  }
  const config = readJson(CONFIG_PATH)
  const { region, accessKeyId, accessKeySecret, bucket, prefix } = config
  if (!region || !accessKeyId || !accessKeySecret || !bucket || prefix === undefined) {
    console.error('[OSS] 配置文件缺少必要字段（region / accessKeyId / accessKeySecret / bucket / prefix）')
    process.exit(1)
  }
  if (accessKeyId === 'your-access-key-id') {
    console.error('[OSS] 请先在 oss-config.json 中填入真实的 AccessKeyId 和 AccessKeySecret')
    process.exit(1)
  }

  const pkg = readJson(PKG_PATH)
  console.log(`[OSS] 版本: ${pkg.version}`)
  console.log(`[OSS] Bucket: ${bucket}, Region: ${region}, Prefix: ${prefix}`)

  // 2. 扫描 dist 目录，找出要上传的文件
  if (!fs.existsSync(DIST_DIR)) {
    console.error('[OSS] dist 目录不存在，请先执行 npm run build:win')
    process.exit(1)
  }
  const allFiles = fs.readdirSync(DIST_DIR).filter(name => {
    const stat = fs.statSync(path.join(DIST_DIR, name))
    return stat.isFile()
  })
  const uploadFiles = allFiles.filter(name =>
    ALLOWED_PATTERNS.some(p => p.test(name))
  )
  if (uploadFiles.length === 0) {
    console.error('[OSS] 在 dist 目录中未找到可上传的产物（latest.yml / *.exe / *.blockmap）')
    console.error('[OSS] dist 目录现有文件:', allFiles.join(', '))
    process.exit(1)
  }
  console.log(`[OSS] 待上传文件 (${uploadFiles.length} 个):`)
  uploadFiles.forEach(f => {
    const size = (fs.statSync(path.join(DIST_DIR, f)).size / 1024 / 1024).toFixed(2)
    console.log(`  - ${f}  (${size} MB)`)
  })

  // 3. 连接 OSS 并上传新文件
  const OSS = require('ali-oss')
  const client = new OSS({ region, accessKeyId, accessKeySecret, bucket })

  const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/'

  console.log('\n[OSS] 开始上传新文件...')
  for (const file of uploadFiles) {
    const localPath = path.join(DIST_DIR, file)
    const objectKey = normalizedPrefix + file
    const sizeMB = (fs.statSync(localPath).size / 1024 / 1024).toFixed(2)
    console.log(`  -> 上传: ${file} (${sizeMB} MB)`)
    await client.put(objectKey, localPath)
    console.log(`     完成: https://${bucket}.${region}.aliyuncs.com/${objectKey}`)
  }

  console.log('\n[OSS] 全部完成 ✓')
}

main().catch(err => {
  console.error('[OSS] 发布失败:', err.message)
  process.exit(1)
})
