# 菜单栏控制

`DomaengMenuBar.app` 是可选的 macOS 原生控制面板，给不想一直用 Terminal 的用户查看和控制后台服务。

它刻意保持很薄：

- 不内嵌 WebView
- 不打包 Web App assets
- 不运行第二份 Web App
- 从 `domaeng status --json` 读取状态
- 控制的仍然是 `domaeng up` 使用的 launchd-backed bridge 和本地 relay

## 安装和打开

发布到 npm 的包可以附带预构建 app。打包时，`prepack` 会在发现 `macos/DomaengMenuBar/build/DomaengMenuBar.app` 后把它复制到 `bundled/menubar/`。

在用户机器上，安装只会把这份预构建 app 复制到用户目录：

```sh
domaeng menubar install
domaeng menubar open
```

`domaeng menubar install` 也会通过 `~/Library/LaunchAgents/com.domaeng.menubar.plist` 开启登录自启。它不会碰 `/Applications`，不需要 sudo，也不会在用户电脑上尝试 Xcode 构建。如果当前包没有附带预构建 app，命令会明确提示。

用下面的命令切换自启偏好：

```sh
domaeng menubar login on
domaeng menubar login off
```

## 它显示什么

- bridge 和 relay 状态
- relay 在 `/app/` 提供的 Web App URL
- pairing code 和 QR
- Start、Stop、Restart、Renew Pairing、Open Web App 和复制按钮

`domaeng up` 仍然照常启动 bridge 和配对流程。如果包里附带了预构建 `DomaengMenuBar.app`，并且用户没有关闭 open-at-login，`domaeng up` 会把它安装到 `~/Applications`、开启登录 LaunchAgent，并自动打开。若包里没有预构建 app，`domaeng up` 会继续只显示 Terminal 输出。

## 源码构建

维护者可以从源码构建预制 app bundle：

```sh
./macos/DomaengMenuBar/scripts/build-app.sh
```

输出路径是 `macos/DomaengMenuBar/build/DomaengMenuBar.app`。npm 打包时如果发现这个 bundle，就会复制进去。这个 app bundle 不应该包含 `web/dist` 或任何 Web App 副本。
