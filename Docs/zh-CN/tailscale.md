# 搭配 Tailscale 使用 Domaeng

Tailscale 是可选项。它适合手机、平板或第二台电脑无法稳定通过同一个 Wi-Fi 访问 Mac 的情况。

在 Domaeng 里，Tailscale 应该被理解成通往你自己 Mac 或 relay 的私有网络路径。它不是 Domaeng 必须依赖的托管服务。

## 什么时候需要它

适合使用 Tailscale 的情况：

- 手机不在 Mac 同一个 Wi-Fi
- `.local` 域名或 LAN IP 经常不可用
- 想给 relay 一个稳定的私有地址
- 希望家里、办公室、外出网络切换后还能连得上

如果你只在同一台 Mac 上用浏览器，或者 LAN 已经很稳定，可以先不使用 Tailscale。

## 心智模型

整体仍然是 local-first：

```text
浏览器设备 -> Tailscale 私有网络路径 -> 你的 Mac relay/bridge -> 本地 Codex
```

Codex 仍然运行在 Mac 上。git 凭据和 workspace 文件也仍然留在 Mac 上。Tailscale 只是帮助浏览器访问 relay 路径。

## 基础设置

1. 在负责 host Domaeng 的 Mac 上安装 Tailscale。
2. 在手机、平板或另一台浏览器设备上安装 Tailscale。
3. 两台设备登录同一个 tailnet。
4. 确认浏览器设备能访问 Mac 的 Tailscale 地址。
5. 用浏览器设备可达的 relay URL 启动 Domaeng。
6. 通过同一个可达路径打开 `/app/`，完成一次配对。

实际 URL 取决于你如何暴露本地 relay：

- Tailscale Serve 或私有反向代理可以提供 HTTPS/WSS 地址，常见形态是 `https://your-mac.your-tailnet.ts.net/app/` 对应 Web App，`wss://your-mac.your-tailnet.ts.net/relay` 对应 relay。
- 直接使用 tailnet/LAN 地址也可以用于本地测试，只要浏览器设备能访问 relay。

真实 hostname 应该保存在你自己的本地配置里。不要把个人 tailnet 名称或私有地址提交到公开仓库。

## 搭配菜单栏控制中心

macOS 菜单栏 companion 的 Connection 区域可以辅助这个流程：

- `Tailscale Web`：根据检测到或保存的 Tailscale 地址生成 Web App URL。
- `Tailscale Relay`：生成对应 relay URL。
- `Use Tailscale Relay`：把 bridge 切换到这个 relay 路径。
- `Save Tailscale Address`：自动检测不够时，手动保存一个稳定 Tailscale host。
- `Auto Detect`：清除手动 host，重新尝试本机检测。

切换 relay 后，用显示出来的 QR 或配对码在 Web App 里信任这台 Mac。

## 搭配 CLI

如果直接使用已安装的 CLI，把 bridge 指向可达的 relay URL：

```sh
DOMAENG_RELAY="wss://your-mac.your-tailnet.ts.net/relay" domaeng up
```

如果从源码运行，并且本地 relay 前面有一个可达的 HTTPS endpoint：

```sh
./run-local-domaeng.sh --relay-url https://your-mac.your-tailnet.ts.net
```

launcher 会在需要时把 HTTP(S) relay base 转成 WebSocket relay 路径。

## 排障

### Web App 在 Mac 上能打开，手机打不开

手机访问不到那个 hostname 或端口。改用 Mac 的 Tailscale 地址、Tailscale Serve HTTPS 地址，或其他私有反向代理路径。

### 配对成功过一次，但之后不能重连

检查 bridge 是否还在使用同一个可达 relay 路径。trusted reconnect 需要浏览器通过配置的 relay 找到当前 live bridge session。

### 菜单栏里 Tailscale 地址为空

在 `Tailscale Address` 里手动粘贴 Mac 的 Tailscale host，保存后再点 `Use Tailscale Relay`。

### 应该改用公网 VPS 吗

只有当你明确想自己运维互联网可达 relay 时，才需要公网 VPS。很多个人场景用 Tailscale 更简单，因为 relay 通过私有网络可达即可。
