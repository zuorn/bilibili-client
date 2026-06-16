const chalk = require('chalk').default || require('chalk')
chalk.level = 0
const fs = require('fs')
const { app } = require('electron')

if (process.stdout.setEncoding) {
  process.stdout.setEncoding('utf8')
}

let logFile = ''
let logBuffer = []

function log(...args) {
  let message = ''

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (typeof arg === 'object') {
      message += ' ' + JSON.stringify(arg)
    } else if (typeof arg === 'number') {
      message += ' ' + arg.toString()
    } else {
      message += ' ' + (arg?.toString?.() || '')
    }
  }

  if (!app.isPackaged) {
    const output = new Date().toISOString() + message + '\n'
    // 直接写入字符串，让 Node.js 的 stdout 编码设置生效
    process.stdout.write(output)
  }

  const plainMsg = new Date().toISOString() + ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')

  if (logFile) {
    try {
      fs.appendFileSync(logFile, plainMsg + '\n', { encoding: 'utf8' })
    } catch (e) {
      if (!app.isPackaged) {
        process.stdout.write('[日志写入错误] ' + e.message + '\n')
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
      const dir = require('path').dirname(logFile)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      fs.writeFileSync(logFile, '', { encoding: 'utf8' })
      
      if (logBuffer.length > 0) {
        fs.appendFileSync(logFile, logBuffer.join('\n') + '\n', { encoding: 'utf8' })
        logBuffer = []
      }
      
      if (!app.isPackaged) {
        process.stdout.write('[日志系统] 日志文件已设置: ' + logFile + '\n')
      }
    } catch (e) {
      if (!app.isPackaged) {
        process.stdout.write('[日志系统错误] ' + e.message + '\n')
      }
    }
  }
}

module.exports = { log, setLogFile }
