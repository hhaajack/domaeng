# Domaeng 操作功能说明

这份文档从用户视角解释 Domaeng 的常见操作。它不是 API 手册。

## Runtime 操作

| 操作 | 含义 |
| --- | --- |
| Start | 启动本地 bridge 流程，让 Web App 可以通过配置的 relay 访问 Codex。macOS 上使用 launchd-backed service 路径。 |
| Stop | 停止 macOS bridge service。bridge 重新启动前，Web App 会失去 live connection。 |
| Restart | 使用保存或当前配置重新启动 bridge service。 |
| Refresh | 从 CLI 重新读取状态 snapshot。不会重置 trust 或 pairing state。 |
| Status | 显示 bridge、daemon、connection、relay 和 pairing 状态。不要公开发布原始 JSON status。 |

## 配对和信任

| 操作 | 含义 |
| --- | --- |
| Pair | 一个浏览器和一台 Mac 之间的首次信任 bootstrap。使用 QR 或短配对码。 |
| Renew Pairing | 请求 bridge 生成新的短时 QR/配对码，不主动清除 trusted devices。 |
| Reset Pairing | 清除本地 pairing state，用于重新开始或从头信任新的 client。 |
| Trusted Reconnect | 首次配对成功后，浏览器可以通过配置的 relay 找到当前 live Mac session，不必每次重新扫码。 |
| Disable Trusted Device | 保留 trusted device 记录，但阻止它重连。 |
| Enable Trusted Device | 允许已禁用 trusted device 重新连接。 |
| Remove Trusted Device | 撤销这个浏览器/设备的 trusted reconnect 权限。 |

配对码和 QR payload 有时效，但在有效期内仍然敏感。把它们当成 bearer-style access material 处理。

## Web App 操作

| 操作 | 含义 |
| --- | --- |
| Start a run | 把 prompt 发送给 Mac-hosted Codex runtime。 |
| Steer a run | 在同一个 thread 里继续给当前工作补充方向。 |
| Stop a run | 请求 Codex interrupt 当前 active turn。恢复路径下，bridge 可能会先从 thread state 解析 active turn 再 interrupt。 |
| Resume a thread | 继续已有 thread，而不是新建一个。 |
| Queue a follow-up | 当前 turn 还在运行时，把下一条 prompt 排队。 |
| Attach an image | 通过已配对 Web App 把图片附件发送给本地 runtime。 |
| Browser notifications | turn 完成或需要处理时，让浏览器通知你。push 是可选项，除非你配置了自托管 push，否则默认关闭。 |

## Git 和 Workspace 操作

git 和 workspace 动作都是本地动作。配对浏览器请求 bridge 在 Mac 上执行。

| 操作 | 含义 |
| --- | --- |
| Git status | 查看 Mac 本地 repository 状态。 |
| Commit | 用选中的改动创建本地 git commit。 |
| Push | 从 Mac 本地 checkout push，使用 Mac 上可用的凭据。 |
| Pull | pull 到 Mac 本地 checkout。 |
| Branch switch | 在本地 checkout 切换分支。 |
| Patch preview/revert | 通过 bridge 检查或应用本地文件改动。 |

relay 不执行 git 命令，也不应该接收 repository credentials。

## 连接操作

| 操作 | 含义 |
| --- | --- |
| Local LAN Relay | 使用同一局域网可达的 relay URL。简单，但可能受路由器、Wi-Fi isolation、IP 变化影响。 |
| Tailscale Relay | 使用 Tailscale 私有网络可达的 relay 路径。跨设备通常比普通 LAN 更稳定。 |
| Custom Relay Override | 把 bridge 指向你控制的 relay endpoint，例如私有反向代理或 VPS relay。 |
| Self-hosted Relay | 自己运行 relay。Codex 仍然在 Mac 上运行，relay 仍然只是传输层。 |

## 日志和诊断

bridge 能启动但 Web App 无法配对或重连时，可以看日志。

常用检查：

- `domaeng status`
- `domaeng status --json`，仅用于本地 machine-readable 诊断
- 菜单栏 companion 打开的 stdout/stderr 日志
- 本地或自托管 relay 的 `/health` endpoint

不要在公开 issue 中贴 live relay session ID、QR payload、配对码、原始 JSON status、私有 relay hostname 或 credentials。

## 我该用哪个操作

- QR/配对码过期：用 `Renew Pairing`。
- 想丢弃本地 trust 并重新配对：用 `Reset Pairing`。
- 想关掉 bridge service：用 `Stop`。
- UI 看起来状态旧了：用 `Refresh`。
- 另一台设备通过普通 Wi-Fi 连不上 Mac：用 `Tailscale Relay`。
- 明确想自己运维 relay endpoint：用 `Self-hosted Relay`。
