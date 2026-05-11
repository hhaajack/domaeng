# 菜单栏控制

菜单栏控制是显示在 macOS 状态栏/菜单栏里的 Domaeng 小控制中心。

它是可选项。你完全可以只用 CLI 和 Web App 使用 Domaeng。

当前打包状态：npm 包可以附带一个可选的 `DomaengMenuBar.app`，但它是未签名/adhoc 签名 app，没有经过 Apple notarization。第一次打开时，macOS 可能会拦截它。这是当前预期行为。

如果你不需要菜单栏控制，可以直接跳过本页。普通路径只需要 `domaeng up`，然后使用 CLI + Web App。

## 从 npm 安装

先安装普通 CLI：

```sh
npm install -g domaeng@latest
```

然后检查这版 npm 包里是否带了可选的菜单栏 app：

```sh
domaeng menubar status
```

如果显示已经 bundled，可以安装并打开：

```sh
domaeng menubar install
domaeng menubar open
```

默认会复制到 `~/Applications/DomaengMenuBar.app`。

因为这个 app 未签名/adhoc 签名，macOS 可能提示“无法打开，因为无法验证开发者”。如果出现这个提示，打开 **系统设置 -> 隐私与安全性**，允许刚刚被拦截的 app，然后再打开一次。也可以在 Finder 里按住 Control 点 app，选择 **打开**。

这个警告只和 Apple 签名/notarization 有关，不表示 Domaeng 使用了托管服务。除非你自己显式配置远程 relay，否则 bridge、relay 和 Codex runtime 仍然在本机运行。

## 它能做什么

菜单栏控制是对本地 `domaeng` CLI 的图形化包装。它可以：

- 启动和停止 macOS bridge service
- 显示 daemon 和 bridge 连接状态
- 显示或刷新配对 QR/配对码
- 在 Local Relay 和 Tailscale Relay 之间切换
- 管理 trusted browser devices
- 打开 stdout/stderr 日志帮助排障
- 在 `Codex.app` 中重新打开最近活跃的 thread

它不替代 Codex，也不运行托管服务。bridge 和 Codex runtime 仍然在你的 Mac 本地运行。

## 源码设置 prompt

如果 npm 包暂时没有附带 app，或者你正在从源码 checkout 开发，在这个仓库里打开 Codex，然后粘贴这段：

```text
请从这个本地仓库设置 Domaeng 的 macOS 菜单栏控制。

请保持 local-first，不要引入 hosted-service 假设，也不要写死任何 relay 域名。

在修改或运行任何东西之前，先检查当前 README、Docs/menu-bar.md、package scripts 和 CONTRIBUTING.md，按这个仓库当前的方式来做。

不要运行 Xcode tests。不要修改无关文件。不要提交或打印 QR payload、配对码、live relay session ID、私有 hostname，或原始 `domaeng status --json` 输出。

如果需要，请安装或更新本地 `domaeng` CLI，构建 Web App assets，只构建 `DomaengMenuBar` 这个 macOS app target，把它安装到本机，把匹配的 Web App assets 复制进 app bundle，打开 app，并验证 Start、Stop、Refresh、pairing 和 relay switching 是否正常。

如果某一步需要权限，因为它会写入仓库外部、需要网络访问，或会触碰 `/Applications`，请先解释命令并向我确认。
```

这段 prompt 把复杂构建细节交给 Codex，同时保留最重要的安全规则。

维护者需要的源码构建细节放在 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 如何使用

1. 打开 macOS 状态栏/菜单栏里的 Domaeng 图标。
2. 点 `Start` 启动本地 relay 和 bridge。
3. 打开控制里显示的 Web App URL，或扫码/输入配对码。
4. 状态看起来不新时点 `Refresh`。
5. 想关闭 bridge service 时点 `Stop`。

## 小弹窗里的控制

状态栏/菜单栏小弹窗会显示：

- `Service`：launchd-backed bridge service 是否 loaded。
- `Connection`：bridge 连接状态。
- `Relay`：当前 relay 看起来是 local 还是 remote。
- `Start`：启动本地 relay/bridge 流程。
- `Stop`：停止 bridge service。
- `Refresh`：重新从 CLI 读取状态。
- `Control Center`：打开完整控制窗口。
- `Quit App`：只退出菜单栏 app，不一定停止 bridge service。

## Control Center

完整控制窗口按区域组织本地操作。

### Service

- `Daemon`：launchd service 是否 loaded。
- `Connection`：bridge runtime 连接状态。
- `PID`：可用时显示进程 ID。
- `Start`：用当前 relay 设置启动 bridge。
- `Stop`：停止 bridge service。
- `Resume Thread`：在 `Codex.app` 里重新打开最近活跃的 thread。
- `Refresh`：重新读取状态 snapshot。

### Connection

- `Tailscale Web`：根据 Tailscale host 生成的 Web App URL。
- `Local LAN Web`：根据 Mac 本地地址生成的 Web App URL。
- `Tailscale Relay`：根据 Tailscale host 生成的 relay URL。
- `Local LAN Relay`：根据 Mac 本地地址生成的 relay URL。
- `Use Tailscale Relay`：把 bridge 切到 Tailscale relay URL。
- `Use Local Relay`：切回 local LAN relay URL。
- `Save Tailscale Address`：保存手动输入的 Tailscale host。
- `Auto Detect`：清除手动 host，使用自动检测信息。
- `Save Relay Override`：保存自定义 relay URL。
- `Use Defaults`：清除 relay override。

### Pairing

- bridge 发布 pairing session 时会显示 QR/配对码。
- `Renew Pairing`：请求 daemon 生成新的 QR/配对码。
- `Reset Pairing`：清除保存的 pairing state，并开始新的信任流程。

不要公开分享 live QR 或配对码。

### Trusted Devices

Trusted devices 是已经针对当前 Web origin 完成第一次 pairing handshake 的浏览器。

- `Disable`：保留记录，但阻止它 trusted reconnect。
- `Enable`：允许已禁用设备再次重连。
- `Remove`：撤销这个 trusted device。

### Logs

菜单栏控制可以打开本地 Domaeng state/log 文件夹，以及后台服务使用的 stdout/stderr 日志。

如果日志包含 live pairing 信息、私有 hostname 或不想公开的本地路径，不要原样贴到公开 issue。
