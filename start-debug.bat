@echo off
chcp 65001 >nul
set LANG=zh_CN.UTF-8
set NODE_ENV=development
node_modules\.bin\electron.cmd .