// scripts/build-win.js — 交互式 Windows 构建脚本
// 流程：确认版本号 → 写入 package.json → 清理 → 构建 → 选择是否上传（箭头键或 y/n 都支持）

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const readline = require('readline')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const PKG_PATH = path.join(PROJECT_ROOT, 'package.json')

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

// ============ 普通文本输入（支持预填默认值） ============
function ask(question, defaultValue) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    const prompt = defaultValue
      ? question + ' [' + defaultValue + ']: '
      : question + ': '
    rl.question(prompt, (answer) => {
      rl.close()
      resolve((answer || '').trim() || defaultValue || '')
    })
    // 预填到输入行，用户可直接修改
    if (defaultValue) {
      rl.write(defaultValue)
    }
  })
}

// ============ 箭头键 / y/n 二选一菜单 ============
// options 示例: [{ label: '不上传', value: 'no' }, { label: '上传', value: 'yes' }]
// defaultIndex: 默认选中项索引（第 0 项为默认）
// 返回值: 被选中项的 value
function choose(question, options, defaultIndex) {
  return new Promise((resolve) => {
    let selected = defaultIndex || 0
    const isTTY = process.stdin.isTTY

    // 主 readline 接口：负责接收 line 事件（回车确认），保证任何环境都能继续
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    // ---------- 渲染（仅 TTY 下会做动态重绘） ----------
    function render() {
      if (!isTTY) {
        // 非 TTY：直接显示提示文本，不用动态重绘
        const hint = options
          .map((o, i) => (i === selected ? '[' + o.label + ']' : o.label))
          .join(' / ')
        process.stdout.write(
          question + ' （↑ ↓ / ← → 切换，回车确认；或输入 y/n 后回车）\n' +
          '  ' + hint + ' : '
        )
        return
      }
      // TTY 下：清行 + 重绘选中菜单
      const lines = options.length + 1
      if (!render._first) {
        // 把光标移回菜单首行并清掉旧内容
        process.stdout.write('\x1b[' + lines + 'A\x1b[0J')
      }
      render._first = false
      process.stdout.write(question + ' （↑ ↓ / ← → 切换，回车确认）\n')
      for (let i = 0; i < options.length; i++) {
        if (i === selected) {
          // 选中项用 > 和反色标注
          process.stdout.write('  > \x1b[7m ' + options[i].label + ' \x1b[0m\n')
        } else {
          process.stdout.write('    ' + options[i].label + '\n')
        }
      }
    }
    render._first = true
    render()

    // ---------- 回车后的解析 ----------
    function handleLine(input) {
      const trimmed = (input || '').trim().toLowerCase()
      // 空输入 → 使用当前选中项
      if (trimmed === '') {
        cleanup()
        resolve(options[selected].value)
        return
      }
      // 输入 y / yes → 上传；输入 n / no → 不上传
      if (trimmed === 'y' || trimmed === 'yes') {
        const idx = options.findIndex(o => o.value === 'yes')
        cleanup()
        resolve(options[idx >= 0 ? idx : selected].value)
        return
      }
      if (trimmed === 'n' || trimmed === 'no') {
        const idx = options.findIndex(o => o.value === 'no')
        cleanup()
        resolve(options[idx >= 0 ? idx : selected].value)
        return
      }
      // 其他输入：提示重新输入（非 TTY 下尤其需要）
      if (!isTTY) {
        process.stdout.write('  请输入 y 或 n 后回车（或直接回车使用默认）\n  : ')
      }
    }
    rl.on('line', handleLine)
    rl.on('close', () => {
      // 用户按 Ctrl+D 时也返回默认项
      resolve(options[selected].value)
    })

    // ---------- TTY 下额外监听方向键 ----------
    let keypressHandler = null
    if (isTTY) {
      readline.emitKeypressEvents(process.stdin)
      try { process.stdin.setRawMode(true) } catch (e) {}

      keypressHandler = (str, key) => {
        if (!key) return
        // Ctrl+C 正常退出
        if (key.ctrl && key.name === 'c') {
          cleanup()
          process.stdout.write('\n')
          process.exit(0)
        }
        // 回车：由 readline 的 line 事件统一处理
        if (key.name === 'return' || key.name === 'enter') {
          // 触发 readline 的 line 事件
          rl.write('\n')
          return
        }
        // 方向键：切换选中项并重绘
        if (key.name === 'right' || key.name === 'down') {
          selected = (selected + 1) % options.length
          render()
          return
        }
        if (key.name === 'left' || key.name === 'up') {
          selected = (selected - 1 + options.length) % options.length
          render()
          return
        }
      }
      process.stdin.on('keypress', keypressHandler)
    }

    function cleanup() {
      if (keypressHandler) {
        process.stdin.removeListener('keypress', keypressHandler)
      }
      try {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
      } catch (e) {}
      rl.removeAllListeners()
      rl.close()
      // 立即暂停 stdin，避免它继续保持事件循环
      try { process.stdin.pause() } catch (e) {}
    }
  })
}

// ============ 执行外部命令 ============
function run(cmd, opts) {
  console.log('\n> ' + cmd + '\n')
  execSync(cmd, { stdio: 'inherit', cwd: PROJECT_ROOT, ...(opts || {}) })
}

// ============ 主流程 ============
async function main() {
  console.log('========================================')
  console.log('  Bilibili Client Windows 构建')
  console.log('========================================')
  console.log('')

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'))
  const currentVersion = pkg.version
  console.log('当前版本号: ' + currentVersion)
  console.log('')

  const version = await ask('请输入版本号（回车使用当前值）', currentVersion)
  if (!SEMVER_RE.test(version)) {
    console.error('\n[错误] 版本号格式不正确，应为 x.y.z 格式（例如 1.0.0、0.0.3）')
    console.error('       你输入的是: ' + version)
    process.exit(1)
  }

  if (version !== currentVersion) {
    pkg.version = version
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')
    console.log('\n✓ 已将版本号写入 package.json: ' + version)
  } else {
    console.log('\n✓ 使用当前版本号: ' + version)
  }

  console.log('\n--- 第 1 步: 清理 dist 目录')
  run('npm run clean')

  console.log('\n--- 第 2 步: 构建 Windows 安装包')
  run('npx electron-builder --win')

  console.log('\n--- 第 3 步: 是否上传到 OSS')
  const answer = await choose(
    '是否需要上传到 OSS？',
    [
      { label: '不上传', value: 'no' },
      { label: '上传', value: 'yes' }
    ],
    0 // 默认选中「不上传」
  )
  const shouldUpload = (answer === 'yes')

  if (shouldUpload) {
    console.log('\n开始上传到 OSS...')
    run('node scripts/publish-oss.js')
    console.log('\n✓ 上传完成')
  } else {
    console.log('\n已跳过上传。之后如需上传可执行: npm run publish:oss')
  }

  console.log('\n--- 第 4 步: 清理临时构建文件')
  run('npm run clean:dist')

  console.log('\n========================================')
  console.log('  完成！版本: v' + version)
  console.log('========================================')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n[错误] 构建失败:', err.message)
  process.exit(1)
})
