// Tauri 生产构建前端资源收集脚本
// 将运行所需的静态资源复制到 app-dist/，作为 tauri.conf.json 的 frontendDist。
// 渲染层是无打包器的原生 JS，直接按原始目录结构复制即可。
//
// 说明：本脚本由 tauri build 的 beforeBuildCommand 通过 cmd /S /C 子进程调用。
// 曾出现"构建长时间停在 Running beforeBuildCommand"的现象，故此处：
//   1. 每一步都写入 .workbuddy/build-frontend-trace.log（文件级追踪，不受 stdout 管道影响）
//   2. 使用 fs.cpSync 批量复制，减少文件句柄
//   3. 结束时显式 process.exit()，确保子进程一定返回
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'app-dist')
const SRC = path.join(ROOT, 'src')
const TRACE = path.join(ROOT, '.workbuddy', 'build-frontend-trace.log')

function trace(msg) {
  try {
    fs.appendFileSync(
      TRACE,
      `${new Date().toISOString()}\tpid=${process.pid}\t${msg}\n`
    )
  } catch (_) {
    /* 追踪失败不影响主流程 */
  }
}

function countFiles(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name))
    else n += 1
  }
  return n
}

function fail(message) {
  trace(`FAIL: ${message}`)
  console.error(`[build-frontend] 失败: ${message}`)
  process.exit(1)
}

// 递归 minify 目录下所有 .js/.css（esbuild transformSync，单文件安全：
// 顶层作用域不 mangle，仅压缩空白/局部改名，语义不变）。
// 仅在 FRONTEND_MINIFY=1（tauri-build.js 注入）时执行，dev 保持可读源码。
function minifyAssets(dir) {
  const stats = { files: 0, before: 0, after: 0 }
  if (process.env.FRONTEND_MINIFY !== '1') {
    trace('minify skipped (FRONTEND_MINIFY!=1, dev mode)')
    return stats
  }
  let esbuild = null
  try {
    esbuild = require('esbuild')
  } catch (_) {
    trace('WARN: esbuild 未安装，跳过 minify')
    console.warn('[build-frontend] esbuild 未安装，跳过 minify')
    return stats
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = minifyAssets(p)
      stats.files += sub.files
      stats.before += sub.before
      stats.after += sub.after
      continue
    }
    const ext = path.extname(entry.name).toLowerCase()
    if (ext !== '.js' && ext !== '.css') continue
    try {
      const code = fs.readFileSync(p, 'utf8')
      const beforeBytes = Buffer.byteLength(code)
      const result = esbuild.transformSync(code, {
        loader: ext === '.css' ? 'css' : 'js',
        minify: true,
        charset: 'utf8',
        legalComments: 'none',
        target: 'es2020',
        // 生产环境移除 console.* 与 debugger（dev 不 minify 不受影响）。
        // 已确认项目内没有 console 作为值传递的用法（then(console.x) 等）。
        drop: ['console', 'debugger'],
      })
      fs.writeFileSync(p, result.code)
      stats.files += 1
      stats.before += beforeBytes
      stats.after += Buffer.byteLength(result.code)
    } catch (e) {
      // 单个文件失败保留原样（不影响运行），仅记录
      trace(`WARN: minify 失败 ${entry.name}: ${e && e.message}`)
    }
  }
  return stats
}

// step6.5: 主窗口脚本打包 —— index.html 的 26 个 <script src="src/..."> 按
// 原顺序拼接为 app-dist/app.js，并重写 index.html 引用单文件。
// 说明：
//   - 26 个脚本均为顶层全局函数/变量声明，无 import/export、无内联脚本混排，
//     顺序拼接与逐个执行语义等价（每个后续文件前加 ';' 防止 ASI 拼接歧义）
//   - 仅处理以 src/ 开头的标签；dev（tauri-dev.js 直出 src/）不受影响
//   - 拼接源文件读取的是 app-dist 内（已经过 step6 minify），产物天然是压缩版
function bundleMainScripts() {
  const htmlPath = path.join(OUT, 'index.html')
  const html = fs.readFileSync(htmlPath, 'utf8')
  // 注意：/g 正则的 lastIndex 有状态，exec 循环与 replace 各用独立实例
  const tagRe = /<script src="(src\/[^"]+)"><\/script>/g
  const parts = []
  let m
  while ((m = tagRe.exec(html)) !== null) {
    const rel = m[1]
    const abs = path.join(OUT, rel)
    if (!fs.existsSync(abs)) fail(`打包失败：脚本不存在 ${rel}`)
    parts.push(fs.readFileSync(abs, 'utf8'))
  }
  if (parts.length === 0) {
    trace('WARN: bundle 未匹配到任何 <script src="src/..."> 标签，跳过')
    return { files: 0, before: 0, after: 0 }
  }
  const before = Buffer.byteLength(html)
  const bundle =
    '/* bilibili-client 主窗口脚本包：由 scripts/build-frontend.js 按加载顺序拼接，勿手改 */\n' +
    parts.join('\n;\n') + '\n'
  fs.writeFileSync(path.join(OUT, 'app.js'), bundle)
  const newHtml = html
    .replace(/<script src="src\/[^"]+"><\/script>\n?/g, '')
    .replace('</body>', '  <script src="app.js"></script>\n</body>')
  fs.writeFileSync(htmlPath, newHtml)
  trace(`step6.5 bundle ok, scripts=${parts.length}, bytes=${Buffer.byteLength(bundle)}`)
  return { files: parts.length, before, after: Buffer.byteLength(bundle) }
}

// step6.6: 清理已打包进 app.js 的冗余脚本。
// 运行时仅两处引用 src/renderer 下 js：index.html（已改引 app.js）与
// player.html（引用 ../renderer/core/ipc-shim.js）。故除 ipc-shim.js 外
// 的 renderer js 均可安全删除，避免旧文件残留在安装包里浪费体积。
function pruneBundledScripts() {
  const rendererDir = path.join(OUT, 'src', 'renderer')
  if (!fs.existsSync(rendererDir)) return { removed: 0, bytes: 0 }
  const keep = new Set([path.join(rendererDir, 'core', 'ipc-shim.js')])
  let removed = 0
  let bytes = 0
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (p.endsWith('.js') && !keep.has(p)) {
        bytes += fs.statSync(p).size
        fs.unlinkSync(p)
        removed++
      }
    }
  }
  walk(rendererDir)
  return { removed, bytes }
}

trace(`START node=${process.version} cwd=${process.cwd()} out=${OUT}`)

try {
  if (!fs.existsSync(SRC)) fail(`源目录不存在: ${SRC}`)
  trace(`step1 exists ok, srcFiles=${countFiles(SRC)}`)

  // 不再 rmSync 整目录：系统批量删除保护（>50 文件需确认）会拦截导致构建卡死。
  // 改为覆盖式复制（mkdir + cpSync force 覆盖同名文件），旧文件残留不影响运行。
  fs.mkdirSync(OUT, { recursive: true })
  trace('step2 mkdir ok')

  fs.cpSync(SRC, path.join(OUT, 'src'), { recursive: true, force: true })
  trace(`step3 cpSync ok, outSrcFiles=${countFiles(path.join(OUT, 'src'))}`)

  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'))
  trace('step4 index ok')

  const icon = path.join(ROOT, 'icon.png')
  if (fs.existsSync(icon)) {
    fs.copyFileSync(icon, path.join(OUT, 'icon.png'))
  }
  trace('step5 icon ok')

  // step6: esbuild minify js/css（减小安装包体积；esbuild 缺失时降级为仅复制）
  const stats = minifyAssets(path.join(OUT, 'src'))
  trace(`step6 minify done, files=${stats.files} before=${stats.before}B after=${stats.after}B`)
  console.log(
    `[build-frontend] minified ${stats.files} js/css files: ` +
      `${(stats.before / 1024).toFixed(0)}KB -> ${(stats.after / 1024).toFixed(0)}KB`
  )

  // step6.5: 主窗口 26 个脚本拼接为单文件（减少请求与解析开销）
  const bundleStats = bundleMainScripts()
  console.log(
    `[build-frontend] bundled ${bundleStats.files} scripts into app.js: ` +
      `${(bundleStats.after / 1024).toFixed(0)}KB`
  )

  // step6.6: 删除已打包进 app.js 的冗余单文件脚本（player.html 引用的 ipc-shim.js 保留）
  const pruneStats = pruneBundledScripts()
  trace(`step6.6 prune ok, removed=${pruneStats.removed}, bytes=${pruneStats.bytes}`)
  if (pruneStats.removed > 0) {
    console.log(
      `[build-frontend] pruned ${pruneStats.removed} redundant scripts: ` +
        `-${(pruneStats.bytes / 1024).toFixed(0)}KB`
    )
  }

  const total = countFiles(OUT)
  // step6.6 prune 会删除已打包进 app.js 的脚本，校验基线需相应扣除
  const expected =
    countFiles(SRC) + 1 + (fs.existsSync(icon) ? 1 : 0) - pruneStats.removed
  // 覆盖式复制可能残留旧文件，因此校验 >= 而非 ===
  if (total < expected) {
    fail(`资源数量不足: 实际 ${total}，期望至少 ${expected}`)
  }
  trace(`DONE total=${total}`)
  console.log(`[build-frontend] copied ${total} assets to ${OUT}`)
} catch (e) {
  fail(e && e.message ? e.message : String(e))
}

// 显式退出，避免子进程 stdio 句柄未释放导致 tauri build 停等
trace('EXIT 0')
process.exit(0)
