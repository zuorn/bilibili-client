## 方案1：通过命令行参数添加HTTP头（最简单）

MPV支持通过命令行参数设置HTTP请求头：

```
mpv --http-header-fields="User-Agent: Mozilla/5.0...
\nReferer: https://www.bilibili.com/" "视频URL"
```

- ✅ 不需要修改太多代码
- ✅ 直接利用MPV的功能
- ❌ 某些复杂的请求头可能不支持

## 方案2：创建本地代理服务（推荐）

在Electron中启动一个简单的HTTP代理服务器：

1. Electron启动本地代理 （比如 <http://localhost:8888> ）
2. MPV播放代理URL ： <http://localhost:8888/proxy?url=真实视频URL>
3. 代理处理请求 ：添加完整的浏览器请求头，转发视频数据

- ✅ 完全控制请求头
- ✅ 可以处理CORS、Referer等所有问题
- ✅ 可以添加缓存、重试等功能
- ❌ 需要写代理服务代码

## 方案3：先下载再播放（最简单但最慢）

1. Electron先下载整个视频到临时文件
2. 让MPV播放本地文件

- ✅ 最简单，完全绕过防盗链
- ❌ 需要等待下载完成
- ❌ 大视频占用磁盘空间

## 方案4：修改MPV的网络配置

通过MPV的配置文件或脚本，让MPv使用正确的网络设置：

```
mpv --user-agent="Mozilla/5.0..." --referrer="https://
www.bilibili.com/" "视频URL"
```

