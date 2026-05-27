const chalk = require('chalk').default || require('chalk')
chalk.level = 3
const fs = require('fs')
const { app } = require('electron')

let logFile = ''
let logBuffer = [] // 暂存早期日志，等 logFile 设置后写入

function log(...args) {
  const timestamp = chalk.gray(new Date().toISOString())
  let message = ''

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (typeof arg === 'object') {
      message += ' ' + chalk.yellow(JSON.stringify(arg))
    } else if (typeof arg === 'number') {
      message += ' ' + chalk.cyan(arg.toString())
    } else if (arg === 'error' || arg === 'Error' || arg?.toString?.().includes('Error')) {
      message += ' ' + chalk.red(arg)
    } else if (arg?.toString?.().includes('成功') || arg?.toString?.().includes('success') || arg?.toString?.().includes('Success')) {
      message += ' ' + chalk.green(arg)
    } else if (arg?.toString?.().includes('失败') || arg?.toString?.().includes('failed') || arg?.toString?.().includes('Failed')) {
      message += ' ' + chalk.red(arg)
    } else if (typeof arg === 'string') {
      if (arg.startsWith('[') && arg.endsWith(']')) {
        message += ' ' + chalk.blue(arg)
      } else {
        message += ' ' + chalk.white(arg)
      }
    } else {
      message += ' ' + chalk.white(arg?.toString?.() || '')
    }
  }

  // 控制台输出（仅开发模式）
  if (!app.isPackaged) {
    process.stdout.write((timestamp + message + '\n').replace(/\x1b\[0m/g, ''))
  }

  // 构建纯文本日志消息
  const plainMsg = new Date().toISOString() + ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')

  // 如果 logFile 已设置，直接写入；否则暂存到缓冲区
  if (logFile) {
    try {
      fs.appendFileSync(logFile, plainMsg + '\n', { encoding: 'utf8' })
    } catch (e) {
      // 如果写入失败，仍然输出到控制台
      if (!app.isPackaged) {
        process.stdout.write(chalk.red(`[日志写入错误] ${e.message}\n`))
      }
    }
  } else {
    logBuffer.push(plainMsg)
  }
}

function setLogFile(path) {
  logFile = path
  if (logFile) {
    try {
      // 确保目录存在
      const dir = require('path').dirname(logFile)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      fs.writeFileSync(logFile, '', { encoding: 'utf8' })
      
      // 将暂存的日志写入文件
      if (logBuffer.length > 0) {
        fs.appendFileSync(logFile, logBuffer.join('\n') + '\n', { encoding: 'utf8' })
        logBuffer = [] // 清空缓冲区
      }
      
      // 输出日志文件位置信息（仅开发模式）
      if (!app.isPackaged) {
        process.stdout.write(chalk.green(`[日志系统] 日志文件已设置: ${logFile}\n`))
      }
    } catch (e) {
      if (!app.isPackaged) {
        process.stdout.write(chalk.red(`[日志系统错误] ${e.message}\n`))
      }
    }
  }
}

module.exports = { log, setLogFile }
