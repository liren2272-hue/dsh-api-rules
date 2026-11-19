# 同济统一身份认证 —— 供 api-rules 插件自动拨号使用

## 你要做的只有一步

打开同目录下的 **`tongji-vpn.env`**，在 `password=` 后面填你的同济统一身份认证密码，保存。

```
username=你的学工号          ← 学工号，填这里
authgroup=default_method_localdb
password=                 ← 只填这一行
```

填完告诉我一声，我跑一次验证。之后每次外网调用同济 API，插件会自动拨号（会弹一次系统 UAC，点「是」即可）。

## 已经装好了什么

| 组件 | 状态 |
| --- | --- |
| openconnect v9.12 | 已装在 `C:\Program Files\OpenConnect\` |
| wintun 驱动 | 随安装器一起装好（`C:\Program Files\OpenConnect\wintun.dll`） |
| 协议 | `--protocol=array`（Array Networks AG，已实测打通到 `_AN_msgID` 阶段） |
| 插件接线 | `lib/tongji-vpn.mjs` + `lib/rules/tongji.mjs` 的 `throttle` 钩子 |

## 安全说明（请读一遍）

1. **密码是明文存在 `tongji-vpn.env` 里**。这是你自己填的文件，插件只读不传，也不写第二份。
2. 密码**不会进命令行参数**（argv 在进程列表里全机可见），是通过 stdin 喂给 openconnect 的。
3. 提权脚本（`%TEMP%\tongji-vpn\start-openconnect.ps1`）里**不含密码**，它每次自己去读这个 env 文件。
4. 用完之后想清理：删掉 `tongji-vpn.env` 就行，插件会退回「只提示不通、不自动拨号」。

## 为什么会弹 UAC

openconnect 要建一块 TUN 虚拟网卡，Windows 上创建网卡必须提权
（源码证据：`wintun.c` 里 `WintunCreateAdapter` 失败返回 `ERROR_ACCESS_DENIED` → 映射成 `-EPERM`）。
没有权限更小的做法，MotionPro 自己也是装驱动 + 服务。

**但只有真的需要拨号时才会弹**：插件先做一次 TCP 探测（能否连上 `10.67.0.251:443`），
在校园网里本来就通，就直接跳过，不会打扰你。

## 命令行工具

在插件目录里跑（Windows 上 Git Bash 的裸 `node` 可能不在 PATH，用 DSH 自带的）：

```bash
cd "C:/Users/15940/Documents/dsh-plugins/dsh-api-rules"
NODE=/c/Users/15940/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe

"$NODE" tongji-vpn-cli.mjs status      # 是否在内网 / 配置是否齐 / openconnect 是否就位
"$NODE" tongji-vpn-cli.mjs connect     # 手动拨号（弹一次 UAC）
"$NODE" tongji-vpn-cli.mjs disconnect  # 断开
```

`status` 的输出（外网、密码未填时的样子；填好后 `passwordFilled` 变 true）：

```
configExists      true
username          你的学工号
passwordFilled    false          ← 填了就变 true
openconnect       C:/Program Files/OpenConnect/openconnect.exe
tunnelReachable   {"ok":false,"reason":"timeout"}
intranet          {"ok":false,"reason":"network_blocked","status":403}
verdict           不在内网
```

`tunnelReachable` 是判断「是否真在内网」的硬指标：它只是 TCP 连
`10.67.0.251/252:443`，外网这两个地址直接连不通，跟 API key 有没有效无关。
`intranet` 才是带 key 打一次 `/v1/models`，用来区分「网络不通」和「key 不对」。
两种 403 千万别混：`当前网络环境不支持` = 没进内网；`API密钥不存在` = **链路已通**，只是 key 错。

## 排障接口（直接在浏览器里看）

`http://127.0.0.1:<GUI端口>/api/api-rules/tongji-vpn`（端口以每轮运行时给的 GUI
地址为准，本轮实测是 `37366`），回一份只读 JSON：

```json
{
  "state": "down",
  "configPath": "...\\tongji-vpn.env",
  "lastResult": null,
  "tunnel": { "ok": false, "reason": "timeout" },
  "intranet": { "ok": false, "reason": "network_blocked", "status": 403 }
}
```

`lastResult` 会告诉你上一次自动拨号卡在哪：`missing_password` / `bad_credential`（密码错）/
`openconnect_missing` / `tunnel_not_ready_timeout` / `openconnect_exited`。

这个接口**不会拨号**——拨号要提权、要弹 UAC，绝不能由网页请求触发，否则点一下页面就弹窗。
真拨号只有两条路：请求路径上 `throttle` 自动处理，或你手动跑 `connect`。

## 排障对照表

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `missing_password` | env 文件 password 空着 | 填上 |
| `bad_credential` | 网关返回 `_AN_msgID=215` | 密码错了，改 env 文件 |
| `openconnect_missing` | 没装 | 重装 openconnect |
| `tunnel_not_ready_timeout` | 拨号成功但内网地址连不通 | 看 `%TEMP%\tongji-vpn\openconnect.log` |
| `openconnect_exited` | 进程启动即退出 | 同上，日志里有原因 |
| 一直弹 UAC | 上一次授权被拒 | 点「是」，或手动跑 `connect` |

## 对网络的影响：只走同济，不再全局代理

一开始拨号后是**全局**的——所有网站、所有 DNS 都从校园网出口走。原因在 openconnect
自带的 `C:\Program Files\OpenConnect\vpnc-script-win.js`：同济 AG 不推
`CISCO_SPLIT_INC`，脚本就落进兜底分支，给隧道加一条 `0.0.0.0/0` metric 1 的默认
路由（InterfaceMetric 5 压过 WLAN 的 55），顺手把系统 DNS 也改成校园 DNS。

现在改成**分流**了。新增的 `lib/vpnc-script-split.js` 不改官方脚本，而是先改写
进程环境变量（`CISCO_SPLIT_INC=1` + `10.67.0.0/16`、清空 `INTERNAL_IP4_DNS` /
`INTERNAL_IP6_DNS`）再转调官方脚本，于是官方脚本走 split-include 分支：不加默认
路由、不设 DNS、只加一条 `10.67.0.0/16` 的路由。另外脚本会把
`agi.tongji.edu.cn` 钉到 `10.67.0.251`（见下）。

实测效果：

| 项目 | 改造前（全局） | 改造后（分流） |
| --- | --- | --- |
| 默认路由 | 隧道 `0.0.0.0/0` metric 1 胜出 | 只剩 WLAN 一条 |
| 隧道路由 | 只有默认路由 | 多一条 `10.67.0.0/16` |
| 隧道接口 DNS | 校园 DNS | 空 |
| 系统 DNS | 被改成校园 DNS | 保持 DHCP 下发值不变 |
| 普通网站 | 走校园网出口 | 走本地宽带 |
| 同济 API | 通 | 通（实测 200） |

### 为什么还要改 hosts

同济的「内网」是**服务端看请求从哪个 IP 进来**判的。实测公网 IP
`202.120.188.251/252` 即使从隧道里发也是 21 秒超时，只有 `10.67.0.251` 通；而 DSH
运行时 `undici` 加载不了，没法在应用层单独改 DNS。所以只能写 hosts：

```
# >>> dsh-api-rules tongji-vpn split BEGIN >>>
10.67.0.251 agi.tongji.edu.cn
# <<< dsh-api-rules tongji-vpn split END <<<
```

- 拨号成功时自动写入，**第一次写入前**会备份原文件为 `hosts.dsh-tongji.bak`。
- 断开时自动删掉这个标记块。
- 如果你自己已经在 hosts 里手写过 `agi.tongji.edu.cn`，脚本会跳过不动你的。

## 已知限制

1. 插件断开走的是 `taskkill /F`，包装脚本的 disconnect 分支来不及跑，**hosts 里的
   托管块可能残留**。影响不大：每次同济请求前插件都会先探隧道 + `ensureUp()`，
   隧道起来了这个 IP 就是通的；下次拨号也会重写同一行。真要清掉，删掉上面那个
   标记块（连同两行注释）即可。
2. `lib/vpnc-script-split.js` 必须**永久保持纯 ASCII**。`cscript` 是按系统 ANSI
   代码页（CP936）读 `.js` 的，UTF-8 的中文注释会被按 GBK 解码，而 GBK 尾字节可能
   含 `0x5C`（反斜杠），会转义掉字符串的结束引号，报
   `Unterminated string constant`，而且报的行号是漂移的。
