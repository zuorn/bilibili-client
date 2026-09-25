// CDP 诊断脚本：连接 WebView2 远程调试端口，检查页面渲染状态
// 用法：node scripts/cdp-inspect.mjs [port] [输出目录]
// 输出：每个 page target 的 title/url/DOM 摘要/console 错误/截图
import fs from 'node:fs'
import path from 'node:path'

const PORT = process.argv[2] || '9223'
const OUTDIR = process.argv[3] || path.join(process.cwd(), '.workbuddy', 'cdp-out')
fs.mkdirSync(OUTDIR, { recursive: true })

const report = []

async function main() {
  // 1. 拿 targets
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  if (!res.ok) {
    console.error(`[cdp] /json 请求失败: ${res.status}`)
    process.exit(1)
  }
  const targets = await res.json()
  const pages = targets.filter((t) => t.type === 'page')
  report.push(`targets=${targets.length} pages=${pages.length}`)
  for (const t of targets) {
    report.push(`  [${t.type}] ${t.url} title=${JSON.stringify(t.title)}`)
  }

  // 2. 逐个检查 page
  for (const t of pages) {
    const name = (t.url.replace(/[^a-z0-9]/gi, '_').slice(-40) || 'page') + `.json`
    const ws = new WebSocket(t.webSocketDebuggerUrl)
    const logs = []
    let id = 0
    const pending = new Map()

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const mid = ++id
        pending.set(mid, { resolve, reject })
        ws.send(JSON.stringify({ id: mid, method, params }))
      })

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
      } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown' || msg.method === 'Log.entryAdded') {
        logs.push(msg)
      }
    }
    ws.onerror = (e) => report.push(`WS error ${t.url}: ${e.message || 'unknown'}`)

    await new Promise((r) => (ws.onopen = r))

    await send('Runtime.enable')
    await send('Log.enable').catch(() => {})
    await send('Page.enable')

    // 等日志积累
    await new Promise((r) => setTimeout(r, 2500))

    const evalJs = async (expr) => {
      try {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
        return r?.result?.value
      } catch (e) {
        return `EVAL_ERR: ${e.message}`
      }
    }

    const info = {}
    info.url = await evalJs('location.href')
    info.title = await evalJs('document.title')
    info.readyState = await evalJs('document.readyState')
    info.bodyTextLen = await evalJs('(document.body ? document.body.innerText.length : -1)')
    info.bodyTextHead = await evalJs('(document.body ? document.body.innerText.slice(0, 300) : "NO BODY")')
    info.cardCandidates = await evalJs(`(() => {
      const sels = ['.video-card', '.video-card-item', '[class*="video-card"]', '[class*="card"]', '.feed-item', '[class*="feed"]']
      return sels.map(s => s + '=' + document.querySelectorAll(s).length).join(', ')
    })()`)
    info.imgStats = await evalJs(`(() => {
      const imgs = [...document.images]
      return 'total=' + imgs.length + ' broken=' + imgs.filter(i => i.complete && i.naturalWidth === 0).length
    })()`)
    info.recentErrors = await evalJs(`window.__errLog ? JSON.stringify(window.__errLog.slice(-5)) : 'no hook'`)

    // 截图
    const shot = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (shot?.data) {
      const png = path.join(OUTDIR, (t.url.replace(/[^a-z0-9]/gi, '_').slice(-40) || 'page') + '.png')
      fs.writeFileSync(png, Buffer.from(shot.data, 'base64'))
      info.screenshot = png
    }

    fs.writeFileSync(path.join(OUTDIR, name), JSON.stringify({ target: t.url, info, consoleLogs: logs.slice(-30) }, null, 2))
    report.push(`PAGE ${t.url}: readyState=${info.readyState} bodyTextLen=${info.bodyTextLen} cards=[${info.cardCandidates}] imgs=[${info.imgStats}] shot=${info.screenshot ? 'yes' : 'no'}`)
    ws.close()
  }

  console.log(report.join('\n'))
  fs.writeFileSync(path.join(OUTDIR, '_report.txt'), report.join('\n'))
}

main().catch((e) => {
  console.error('[cdp] failed:', e.message)
  process.exit(1)
})
