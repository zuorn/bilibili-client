const chalk = require('chalk').default || require('chalk')
chalk.level = 3
const fs = require('fs')
const { app } = require('electron')

let logFile = ''

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

  // 使用 process.stdout.write 确保 UTF-8 输出
  process.stdout.write((timestamp + message + '\n').replace(/\[0m/g, ''))

  if (!app.isPackaged && logFile) {
    const plainMsg = new Date().toISOString() + ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')
    fs.appendFileSync(logFile, plainMsg + '\n', { encoding: 'utf8' })
  }
}

function setLogFile(path) {
  logFile = path
  // 每次设置日志文件时清空日志，实现重启时清空日志
  if (logFile) {
    fs.writeFileSync(logFile, '', { encoding: 'utf8' })
  }
}

module.exports = { log, setLogFile }