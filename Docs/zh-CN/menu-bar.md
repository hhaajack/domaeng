# macOS 菜单栏控制中心

macOS 菜单栏 companion 是显示在 macOS status/menu bar 里的 Domaeng 小控制中心。

它是可选项。你完全可以只用 CLI 和 Web App 使用 Domaeng。

当前打包状态：公开仓库还没有发布签名好的 `.app`、`.dmg` 或 `.zip`。菜单栏 companion 目前只能从源码构建。

## 它能做什么

companion 是对本地 `domaeng` CLI 的图形化包装。它可以：

- 启动和停止 macOS bridge service
- 显示 daemon 和 bridge 连接状态
- 显示或刷新配对 QR/配对码
- 在 Local Relay 和 Tailscale Relay 之间切换
- 管理 trusted browser devices
- 打开 stdout/stderr 日志帮助排障
- 在 `Codex.app` 中重新打开最近活跃的 thread

它不替代 Codex，也不运行托管服务。bridge 和 Codex runtime 仍然在你的 Mac 本地运行。

## 需要什么

- macOS
- 全局 `domaeng` CLI 已安装，并且 companion 的 shell 环境能找到它
- 如果从源码构建，需要 Xcode 16+

先安装 CLI：

```sh
npm install -g domaeng@latest
```

## 从 Xcode 构建运行

从仓库根目录：

```sh
cd CodexMobile
open CodexMobile.xcodeproj
```

然后：

1. 选择 `DomaengMenuBar` scheme。
2. 用 Cmd+R build and run。
3. 从 macOS 状态栏/菜单栏打开 Domaeng 图标。
4. 点 Start 启动本地 relay 和 bridge service。

历史 iOS client 不是当前源码树的主要路径。当前 companion 源码在 `CodexMobile/DomaengMenuBar/`。

## 命令行源码构建

从仓库根目录：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild -project CodexMobile/CodexMobile.xcodeproj \
  -scheme DomaengMenuBar \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath .build/xcode-derived \
  CODE_SIGNING_ALLOWED=NO build
```

如果希望 companion 使用当前 Web App 资源，先构建 web client：

```sh
cd web
npm install
npm run build
```

在签名 app release 出来之前，普通用户优先使用 npm CLI 路径会更简单。

## 小弹窗里的控制

状态栏/菜单栏小弹窗会显示：

- `Service`：launchd-backed bridge service 是否 loaded。
- `Connection`：bridge 连接状态。
- `Relay`：当前 relay 看起来是 local 还是 remote。
- `Start`：启动本地 relay/bridge 流程。
- `Stop`：停止 bridge service。
- `Refresh`：重新从 CLI 读取状态。
- `Control Center`：打开完整控制窗口。
- `Quit App`：只退出 companion app，不一定停止 bridge service。

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

companion 可以打开本地 Domaeng state/log 文件夹，以及后台服务使用的 stdout/stderr 日志。

如果日志包含 live pairing 信息、私有 hostname 或不想公开的本地路径，不要原样贴到公开 issue。
