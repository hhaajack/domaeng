# Domaeng 新手入门

这份文档只负责帮你第一次跑通 Domaeng。高级配置可以之后再看。

Domaeng 是 local-first：

- Codex 运行在你的 Mac 上。
- git 和 workspace 操作也在你的 Mac 上执行。
- 浏览器只是遥控器。
- relay 只负责配对、重连和加密控制流量的传输。

## 你需要什么

- 一台负责运行 Codex 和 Domaeng 的 Mac。
- Node.js 18 或更新版本。
- Codex CLI 已安装，并且在 shell 的 `PATH` 里。
- 一个能访问 relay 或私有网络的浏览器。

不需要单独下载移动端 App。浏览器就是客户端。

## 最短路径

在负责运行 Codex 的 Mac 上安装 bridge CLI：

```sh
npm install -g domaeng@latest
domaeng up
```

`domaeng up` 会启动本地 bridge 流程，并在需要配对时打印 Web App URL、QR 或配对码。

打开打印出来的 Web App URL，通常是 `/app/` 路径，然后扫码或输入配对码。

## 第一次配对

1. 保持 `domaeng up` 运行，直到它打印配对信息。
2. 在你想使用的浏览器里打开打印出来的 Web App URL。
3. 扫 QR，或输入配对码。
4. 在 Web App 里创建或打开一个 thread。
5. 发送一个很小的测试 prompt，确认 Codex 能实时返回内容。

第一次配对成功后，浏览器会为当前 Web origin 保存这台 trusted Mac。之后只要 bridge 通过同一个 relay 可达，就可以尝试免扫码重连。

## 成功时应该看到什么

你应该能看到：

- Web App 已连接到这台 Mac
- Mac-hosted Codex runtime 的输出在浏览器里实时显示
- 可以从浏览器停止或继续一个 run
- 本地 git/workspace 操作作用在 Mac 上的 checkout

这些都正常，就说明基础路径跑通了。

## 从源码运行

如果你是 clone 仓库而不是安装 npm 包：

```sh
git clone https://github.com/hhaajack/domaeng.git
cd domaeng
./run-local-domaeng.sh
```

这个 launcher 会启动本地 relay，把 bridge 指向它，并打印配对信息。

如果经常跨设备使用，建议优先用 Tailscale 这类稳定私有网络，而不是只依赖普通 LAN。详见 [Tailscale 使用说明](tailscale.md)。

## 接下来读什么

- 另一台设备连不上 Mac：看 [Tailscale 使用说明](tailscale.md)。
- 想从 macOS 状态栏/菜单栏控制：看 [菜单栏控制](menu-bar.md)。
- 想理解每个按钮：看 [操作功能说明](operations.md)。
- 想自己运行 relay 或反向代理：看 [Self-hosting Domaeng](../self-hosting.md)。
- 想查命令、环境变量、安全说明：看 [Advanced reference](../reference.md)。

## 常见首次运行问题

### 浏览器打不开 Web App

确认那个 URL 对当前设备是可达的。能在 Mac 上打开的 URL，不一定能在手机或另一台电脑上打开。跨设备时可以使用 LAN 地址、Tailscale 地址，或你自己可达的 relay endpoint。

### QR 或配对码没有出现、过期了

运行：

```sh
domaeng renew-pairing
```

在 macOS 上，也可以停止后重新启动：

```sh
domaeng stop
domaeng up
```

### 菜单栏控制提示 CLI missing

先安装全局 CLI：

```sh
npm install -g domaeng@latest
```

然后在菜单栏控制里点 Retry。

### 需要反馈 bug

不要把 QR、配对码，或原始 `domaeng status --json` 输出公开发到 issue 里。它们可能包含 live pairing 或类似 bearer token 的信息。
