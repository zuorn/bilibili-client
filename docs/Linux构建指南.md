# Linux 构建指南

## 问题说明

在 Windows 上直接运行 `npm run build:linux` 会失败，因为 AppImage 构建需要 Linux 工具 `mksquashfs`。

## 解决方案

在 Ubuntu（WSL 或真实 Ubuntu 环境）中构建：

### 1. 准备图标文件

在 Windows 上先生成 icon.png（已在项目中准备好）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-linux-icon.ps1
```

### 2. 在 Ubuntu 中构建

```bash
# 进入项目目录（WSL 中）
cd /mnt/d/code/bilibili-client

# 或在真实 Ubuntu 中
cd ~/bilibili-client

# 安装依赖
npm install

# 构建 Linux 版本
npm run build:linux
```

### 3. 构建产物

构建产物位于 `dist/` 目录：
- Linux: `Bilibili Client-0.0.6.AppImage`

## Windows 构建不受影响

原有的 Windows 构建命令保持不变：

```bash
npm run build:win
```