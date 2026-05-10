# Domaeng 中文说明

![Domaeng web app preview banner](assets/domaeng-banner.png)

[English README](README.md)

Domaeng 是一个 local-first 的 Codex 远控工具：Codex 仍然运行在你的 Mac 上，另一台设备通过配对后的 Web App 连接到本地 bridge。它包含四个主要部分：

- `phodex-bridge/`: 本地 Node.js bridge，负责连接 Codex、relay、git/workspace 操作
- `web/`: React + Vite Web App，手机或浏览器端的主要控制界面
- `relay/`: 可自托管 WebSocket relay，负责转发加密会话和可选通知
- `CodexMobile/`: macOS 菜单栏 companion 的 Xcode 项目和共享资源

> 项目还很早期，可能会有 bug。当前源码发布模型以本地运行和自托管为主，不内置公共生产 relay。

## 架构

<p align="center">
  <img src="assets/architecture.zh-CN.svg" alt="Domaeng 本地优先架构图" width="720" />
</p>

## 能做什么

- 通过 QR 或配对码完成一次性配对
- 后续通过 trusted Mac 自动重连
- 在 Web App 里发起、排队、调整正在运行的 Codex turn
- 查看 Codex 的实时输出和历史线程
- 调整模型、reasoning effort、Fast/Standard、Auto-review 等运行设置
- 发送图片附件
- 从 Web App 触发 git status、commit、push、pull、branch switch 等操作
- 使用本地 bridge 和自托管 relay，避免把 Codex runtime 放到托管服务里

## 快速开始

安装 bridge：

```sh
npm install -g domaeng@latest
```

启动：

```sh
domaeng up
```

第一次连接时，打开 relay 提供的 Web App，一般是 `/app/`，然后扫描终端里的 QR 或输入配对码。配对后，浏览器会记住这个 Mac；之后只要本地 bridge 和 relay 可达，就可以自动重连。

## 从源码本地运行

```sh
git clone https://github.com/hhaajack/domaeng.git
cd domaeng
./run-local-domaeng.sh
```

这个脚本会启动本地 relay，并把 bridge 指向类似 `ws://<your-host>:9000/relay` 的地址。跨设备使用时，推荐 Tailscale 或其他稳定的私有网络；同一 Wi-Fi 下的 LAN `ws://192.168.x.x` 更适合临时测试。

常用选项：

```sh
./run-local-domaeng.sh --hostname <lan-hostname-or-ip>
./run-local-domaeng.sh --bind-host 127.0.0.1 --port 9100
./run-local-domaeng.sh --relay-url https://<random>.trycloudflare.com
```

如果要通过临时 Cloudflare Tunnel 暴露本地 relay：

```sh
cloudflared tunnel --url http://127.0.0.1:9000
./run-local-domaeng.sh --relay-url https://<random>.trycloudflare.com
```

## 构建 Web App

```sh
cd web
npm install
npm run build
```

构建产物在 `web/dist`，relay 会在 `/app/` 下提供这个 Web App。

## macOS 菜单栏 companion

macOS 上的后台 bridge 使用 `launchd`。菜单栏 app 的 Start 动作会调用全局 `domaeng` CLI，并在源码 checkout 场景下自动启动本地 relay service 和 bridge daemon。

如果你从源码给本机安装，建议先构建 Web App，再从 `phodex-bridge` 安装 CLI：

```sh
cd web
npm install
npm run build
cd ..
npm install -g ./phodex-bridge
domaeng --version
```

如果 npm 用户缓存权限坏了，不要改 repo 文件，使用临时 cache：

```sh
npm --cache /private/tmp/domaeng-npm-cache install -g ./phodex-bridge
```

## 配置

常见环境变量：

- `DOMAENG_RELAY`: 指定自托管 relay，例如 `ws://localhost:9000/relay`
- `DOMAENG_CODEX_ENDPOINT`: 指向已有的 `codex app-server`
- `DOMAENG_REFRESH_ENABLED`: 启用 Codex.app 桌面刷新 workaround
- `DOMAENG_DESKTOP_SHARED_RUNTIME`: 让 Codex.app 使用共享本地 runtime
- `DOMAENG_PUSH_SERVICE_URL`: 只在你明确部署并启用自托管 push service 时设置

源码 checkout 默认不携带公共 hosted relay。公开仓库和 fork 应该自行配置 relay。

## 安全边界

- QR 和配对码包含短期有效的 live session 信息，不要公开粘贴
- 不要把完整 `domaeng status --json` 输出发到公共 issue 或 README，因为其中可能包含实时配对数据
- relay 只负责转发，配对后的应用消息走端到端加密
- 真实部署域名、APNs/Web Push 凭据、私有 relay 地址应放在本地环境或私有配置里

## 常用命令

```sh
domaeng up              # 启动 bridge，macOS 上走后台服务
domaeng start           # 启动 macOS bridge service
domaeng stop            # 停止 macOS bridge service
domaeng restart         # 重启 service
domaeng status          # 查看状态
domaeng reset-pairing   # 清除本地配对状态
domaeng resume          # 打开最近活跃线程
domaeng watch [thread]  # 观察本地 rollout 更新
```

## 适用状态

当前 macOS 后台 daemon 和 trusted reconnect 体验最完整。Linux/Windows 也可以跑核心 bridge 和自托管 relay，但需要你自己管理前台进程或系统服务。
