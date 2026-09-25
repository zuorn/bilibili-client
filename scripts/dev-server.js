// Tauri 开发用静态服务器：serve 项目根目录，供 tauri devUrl 加载
// 用法：node scripts/dev-server.js  （tauri.conf.json 的 beforeDevCommand 自动调用）
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PORT = process.env.DEV_SERVER_PORT || 5173

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.conf': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'

  // 请求日志（诊断用）：WebView2 是否成功请求到页面
  try {
    fs.appendFileSync(
      path.join(ROOT, '.workbuddy', 'dev-server-requests.log'),
      new Date().toISOString() + ' ' + req.method + ' ' + urlPath + '\n'
    )
  } catch (_) {}

  // 防目录穿越
  const filePath = path.normalize(path.join(ROOT, urlPath))
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      return res.end('Not Found: ' + urlPath)
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      // 禁用缓存，保证 dev 热加载即时生效
      'Cache-Control': 'no-store'
    })
    res.end(data)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-server] serving ${ROOT} at http://127.0.0.1:${PORT}`)
})
