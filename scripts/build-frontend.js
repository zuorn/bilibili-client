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

  const total = countFiles(OUT)
  const expected = countFiles(SRC) + 1 + (fs.existsSync(icon) ? 1 : 0)
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
