# 设置控制台编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# 设置环境变量
$env:LANG = "zh_CN.UTF-8"
$env:NODE_ENV = "development"

# 启动 Electron
.\node_modules\.bin\electron.cmd .