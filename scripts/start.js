// 跨平台 UTF-8 编码启动脚本
// npm start 会先设置终端编码再启动 Electron，解决 Windows / Ubuntu 中文乱码问题

const { spawn, execSync } = require('child_process')
const os = require('os')

function setupEncoding() {
  // 系统级 locale 环境变量
  process.env.LANG = 'en_US.UTF-8'
  process.env.LC_ALL = 'en_US.UTF-8'
  process.env.LC_CTYPE = 'en_US.UTF-8'

  if (process.platform === 'win32') {
    // Windows: 设置控制台代码页为 UTF-8 (65001)
    // 必须使用 PowerShell 直接调用 Win32 API 才能保证生效
    try {
      // 方法1: 用 PowerShell 直接调 SetConsoleOutputCP
      execSync(
        'powershell -NoProfile -NonInteractive -Command "$api=Add-Type -Name WCP -Namespace C -MemberDefinition \'[DllImport(\\\"kernel32.dll\\\")]public static extern bool SetConsoleOutputCP(uint cp);\' -PassThru; $api::SetConsoleOutputCP(65001)"',
        { stdio: 'pipe', timeout: 5000 }
      )
    } catch (_) {
      // 方法2: 退而求其次
      try {
        execSync('chcp 65001', { stdio: 'pipe', timeout: 5000 })
      } catch (__) {}
    }
  }
}

// 提前设置编码
setupEncoding()

// 启动 Electron
const electron = spawn(
  /^win/.test(process.platform) ? 'electron.cmd' : 'electron',
  ['.'],
  {
    stdio: 'inherit',
    shell: true,
    env: process.env
  }
)

electron.on('exit', (code) => process.exit(code || 0))
electron.on('error', (err) => {
  console.error('Failed to start Electron:', err.message)
  process.exit(1)
})
