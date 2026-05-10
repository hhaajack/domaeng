# Domaeng 中文说明

![Domaeng web app preview banner](assets/domaeng-banner.png)

[English README](README.md)

Domaeng 是一个 local-first 的 Codex 远控工具：你的 Mac 是 host，Codex runtime、git 操作、workspace 读写和线程历史都留在 Mac 上；Web App 是任意设备上的遥控器，通过配对后的安全会话连接到 Mac bridge。

## 产品定位

- **Mac-hosted runtime**：真正运行 Codex 的地方是你的 Mac，不是公共云端服务
- **任意设备 Web 端**：手机、平板、另一台电脑、同一台 Mac 的浏览器，或者安装成 PWA 后都可以使用
- **本地优先连接**：relay 可以本地运行，也可以自托管；它只是传输层，不接管 Codex runtime
- **一次配对，后续重连**：通过 QR 或配对码信任这台 Mac，之后 bridge 可达时 Web App 可以自动重连

## 下载 / 安装

目前 GitHub 项目页还没有提供已签名的 Release build，例如 `.app`、`.dmg` 或 `.zip`。当前推荐的用户安装路径是：

```sh
npm install -g domaeng@latest
domaeng up
```

这一步安装在负责 host Codex 的 Mac 上。随后 Domaeng 会在 `/app/` 提供 Web App；任意能访问你的 relay 或私有网络的设备，都可以用浏览器打开这个地址，再通过 QR 或配对码完成配对。

- Mac host 端安装 `domaeng` bridge CLI
- 手机、平板、另一台电脑使用浏览器或 PWA，不需要单独下载移动 App
- macOS 菜单栏 companion 目前在源码里，可以本地构建，但还没有作为签名包发布到 GitHub Releases
- 如果要从源码完整构建，可以继续看下面的本地构建说明

它包含四个主要部分：

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
- 在任意能访问 relay 或私有网络的设备上使用 Web App
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

构建产物在 `web/dist`，relay 会在 `/app/` 下提供这个 Web App。Web 端只是控制界面；Codex runtime 和 workspace 权限仍然在 Mac bridge 这一侧。

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
