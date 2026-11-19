# 更新日志


## 1.0.56 — 2026-11-19

### 同济 nonstandard 端点下线 → 通用 media 通道 + Whisper ASR 工具

AIGC 模式不再调用 minimaxH3 生图专用工具，改走通用 media 网关；同时把同济
Whisper ASR 接入，暴露成独立 DSH 工具。所有媒体调用统一走 `/v1/{images,videos,audio}`
一套路由体系。

**删除**

- `lib/aigc-legacy/lib/aigc/tools.js`：删 `tongji_minimax_image` 工具（`createMinimaxImageTool`
  函数 + `createTools()` 返回条目 + 顶部 `generateMinimaxImage` import），原 405-475 行。
  被删位置留注释：「MiniMax-H3 生图已下线：改走通用 media 通道」。
- `lib/aigc-legacy/lib/aigc/minimax-image.js`：整文件删除（原 `POST /nonstandard/t2i/minimax-h3-image` 直连通道）。

**新增：通用生图通道（tongji 上游）**

- `lib/upstreams.mjs`：`normalizeUpstream` 新增 `sanitizeMedia(raw)` 私有函数（只接受
  `{images|videos|audio: string[]}`，去空/去重/上限 32），返回对象里加 `...(media ? { media } : {})`；
  `upstreamToRoute` 末尾追加 `route.media = upstream.media` 透传（`maskUpstream` 不回传媒体字段）。
- `~/.dsh/.api-rules/upstreams.json` 的 `tongji` 块新增
  `"media": { "images": ["MiniMax-H3-Image"] }`，让 `resolveMediaRoute` 能在
  `defineMediaTool('images')` 里命中 tongji 路由 → `POST /tongji/v1/images/generations`。

**新增：Whisper ASR 工具 + 网关透传**

- `lib/audio-tool.mjs`（新建）：`defineAudioTranscribeTool(deps)` → DSH 工具 `api_transcribe_audio`。
  参数 `{ file, model?, language?, output_path? }`；execute 用 Node 20 内置 `FormData` + `File`
  （按扩展名 `guessMime` 映射 mp3/wav/m4a/aac/ogg/opus/flac/webm/mp4）构造 multipart，
  POST `{origin}/tongji/v1/audio/transcriptions`，Bearer `api-rules-media`，`routeId` 写死 `'tongji'`。
  output schema `{ ok, routeId, model, file, text, output_path, bytes, duration_ms, error, detail }`；
  `output_path` 以 `.json` 结尾写 JSON `{model,file,text,language}`，否则写纯文本。
- `lib/proxy.mjs`：在 `/videos/generations` 分支后新增 `/audio/transcriptions` POST 分支 →
  `audioTranscribe(route, request, response)`（不复用 `media()`：端点非 `/{kind}/generations`；
  body 是 multipart 必须保留 Content-Type 边界；上游可能回 text/plain 或 JSON）。
  端点写死 `siteBase + '/nonstandard/asr/whisper'`（`siteBase = upstreamBase.replace(/\/v1\/?$/, '')`），
  超时 `route.mediaTimeoutMs ?? 600_000`；签名器路由直接 400；凭据优先级
  `override.authorization` → `passthroughAuth + apiKeyEnv`（`resolveEnvCredential`）→ `route.apiKey`；
  上游 2xx 且 Content-Type 含 `application/json` → `JSON.parse` 后 `writeJson` 原样回；
  否则包成 `{ text, model: 'Whisper', object: 'audio.transcription' }` 回写。
- `lib/index.mjs:64` 新增 `import { defineAudioTranscribeTool } from './audio-tool.mjs'`；
  `lib/index.mjs:1747` 在 disposers 数组里追加
  `toolCtx.tools.register(defineAudioTranscribeTool({ getOrigin: deps.getOrigin }))`。

**测试**

- `test/web-route-dispose.test.mjs`：`ROUTE_COUNT` 12 → 27（13 条主路由 + 14 条 AIGC 卡片路由），
  `ROUTE_PATHS` 补 `/api/dsh-api-rules/aigc/*` 14 条；`makeCtx` 仍只捕获 webServer dispose，
  但 `injectAigc(ctx)` 在 aigc-legacy/index.mjs::167 处也有一份独立的 `ctx.inject(['webServer'])`，
  因此 test1 / test3 的 HMR 模拟必须 `for (const dispose of disposers.splice(0)) dispose()`
  全摘后才能重跑 apply，否则 aigc 路由泄漏 → 第二遍撞 duplicate route。修完 3 条全过。
- 全量：pass 100 / fail 10（仅 `test/client-upstream-form.test.mjs` 卡片前端 bundle/source
  10 条遗留失败，与本次改动无关）。改动前基线 pass 75 / fail 32。
- `node --check` 5 个改动源文件全 OK（Node v24.21.0）。
- **端到端实测（Whisper ASR）**：隔离网关（端口 8799，`createProxy` + `tongji` 路由，`resolveEnvCredential`
  现场读 `~/.dsh/.credentials.yaml`）+ edge-tts 造 7.99s 中文 wav 打
  `/tongji/v1/audio/transcriptions` → 200 `application/json` 913ms，
  body `{"text":"这是一段用来测试与音识别的中文样本，内容是今天的天气晴朗，适合出门散步。","duration":"7.5"}`
  （「与音识别」是 Whisper 转写误差，原文是「语音识别」；探针脚本与 wav 已清理）。
- **端到端实测（Whisper ASR）**：起隔离网关（端口 8799，`createProxy` + `tongji` 路由 + 现场解析
  `~/.dsh/.credentials.yaml` 里的 TONGJI_API_KEY），用 edge-tts 造 7.99s 中文 wav 打
  `/tongji/v1/audio/transcriptions` → 200 `application/json` 913ms，返回
  `{"text":"这是一段用来测试与音识别的中文样本，内容是今天的天气晴朗，适合出门散步。","duration":"7.5"}`
  （「与音识别」是 Whisper 的转写误差，原文是「语音识别」——上游 ASR 本身的小偏差，非网关问题）。
  探针脚本已清理。

---

## 1.0.55 — 2026-11-19

### 密码 placeholder 微调

- 密码 input 配置过时 placeholder 改为 `••••••`（6 个 bullets），未配置时仍显示「统一身份认证密码」
- 与 apiKey 字段风格统一（apiKey 配置过时 placeholder 也是「留空则不改」/ `ph.saved` key，但 label 旁有 mask hint `••••`）
- 改动文件：`lib/client.js:1630`（+25 字节）
- 已验证：`node --check lib/client.js` → SYNTAX_OK

---

## 1.0.54 — 2026-11-19

### 同济账号面板（主卡片 tongji tab）

- 主面板 tongji tab（动态上游卡片）新增「同济工号」+「统一身份认证密码」两个输入框 + 独立「保存同济账号」按钮
- 保存按钮 POST `/api/api-rules/tongji-account` 增量更新 `tongji-vpn.env`（留空字段不改）
- 前端新增 state：`tjUsername` / `tjPassword` / `tjErr` / `tjBusy` / `tjSaved`（不与 upstream 保存混流）
- i18n：zh + en 各加 5 个 key（`up.tjUsernameLabel` / `up.tjUsernamePh` / `up.tjPasswordLabel` / `up.tjAccountDesc` / `up.tjSaveAccount` / `up.tjSaved` / `up.tjSaving` + `error.tjUsernameRequired`）
- 完整链路：填表单 → POST `/tongji-account` 写 env → throttle 钩子读凭据 → 403 时自动拨 VPN → AIGC IAM 登录（内网）/ 浏览器增强认证（外网）
- 改动文件：`lib/client.js`（+4388 字节）、`lib/index.mjs`（后端 `/tongji-account` 端点，b90 已落）
- 已验证：`node --check lib/client.js` → SYNTAX_OK；关键 key 全部可达（`tjUsername` 15 hits、`onSaveTongjiAccount` 2 hits、`up.tjUsernameLabel` 3 hits）
- 已知遗留：`test/web-route-dispose.test.mjs` 2 fail + `test/client-upstream-form.test.mjs` 8 fail（均为 1.0.53 前遗留，本次改动未引入新 fail）

---

## 1.0.53（2026-11-19）

### 整包搬迁：dsh-tongji-aigc 并入 dsh-api-rules

把原独立插件 `@local/dsh-tongji-aigc`（同济 AIGC 专区：图片 / 视频 / 3D / 音乐生成）
整包并入本插件，作为一个子系统挂载：

- **宿主侧子系统**：新增 `lib/aigc-legacy/index.mjs`，暴露 `injectAigc(ctx)`，由
  `lib/index.mjs` 的 `activate()` 末尾调用一次。内部复用同目录原有 `lib/` 结构
  （config / token / log / auto-login / browser-login / aigc/*），并跨模块 import
  `lib/rules/tongji.mjs` 的 `ensureTunnelForThirdParty()` —— **AIGC 每次端点请求前
  best-effort 续命 TongjiVpn 的 5 分钟 idle timer，避免 VPN 被先断**。
- **端点前缀改名**：原 `/api/tongji-aigc/*` 14 个端点全部挂到
  `/api/dsh-api-rules/aigc/*`（status / quota / token / relay / iam-captcha / iam-login /
  browser-login-start / browser-login-poll / browser-login-cancel / sso-url / login-start /
  auto-login / templates / generate）。
- **工具注册**：`ctx.inject(['tools'], ...)` 注册 9 个 AIGC 工具
  （create_image / create_video / create_music / create_3d / query_task / list_templates /
  login_token / logout_token / identity_status）。
- **客户端卡片合并**：`lib/aigc-legacy/lib/client/index.js` 的 React DOM 卡片以独立
  `window.__ModuleLoader__.load({ id: "@local/dsh-tongji-aigc", ... })` 块追加到
  `lib/client.js` 末尾，DSH 客户端按 id 加载 → 同一个 npm 包里挂两张设置卡
  （API 规则 + AIGC 专区），客户端 11 处 fetch 全部改成 `/api/dsh-api-rules/aigc/*`。
- **VPN 续命**：`lib/rules/tongji.mjs` 新增导出 `ensureTunnelForThirdParty({ signal })`，
  复用模块级 TongjiVpn 单例 + `armVpnIdleTimer()`，供 AIGC 端点（以及未来任何
  需要走同济内网的子系统）在每次请求前续命 idle timer。
- **归档**：原插件源目录 `dsh-tongji-aigc/` 已 `cp -a` 归档到
  `dsh-tongji-aigc.disabled/`（git 历史保留），软链与 `~/.dsh/profiles/desktop/cordis.patch.yml`
  的旧 AIGC entry 由**用户在 DSH 里手动卸载**（P4 高风险操作，插件不越权）。
- **认证隔离**：AIGC 用 `~/.dsh/.tongji-aigc/token.json`（JWT，登录回传），
  api-rules 用 `.credentials.yaml` 里的 `TONGJI_API_KEY`；两套凭据互不干扰。
- **职责正交**：AIGC 是异步任务型（生图 → 提交 → 轮询 → 落盘），不是 chat completion
  协议，不复用 `lib/proxy.mjs` 的 SSE 聚合层。
- **静态验收**：`node --check lib/index.mjs` OK；`node --check lib/aigc-legacy/index.mjs` OK；
  `node --check lib/client.js` OK；`import lib/aigc-legacy/lib/aigc/client.js` →
  `IMPORT_OK AigcClient, AigcError`；`import lib/aigc-legacy/index.mjs` → `IMPORT_OK injectAigc`；
  客户端 bundle 用 vm 模拟 `window` 加载 → 2 个 ModuleLoader id 都 factory 成功
  （`dsh-api-rules-client` + `dsh-tongji-aigc-client`）。
- **回归测试**：api-rules / accounts / gate / listen-retry / passthrough-discovery /
  tongji / tongji-vpn / tongji-vpn-route / launcher-dispose-wait / media-tool / reasoning
  共 13 份，**56/56 全绿**（含 tongji 内 81 项）。

## 1.0.52（2026-11-19）

### 改进：同济隧道加「内网直连分类判断」

用户反馈：本机在同济网下但开了 v2ray（sing-box TUN 接管默认路由），
能否让同济模型继续可用；并希望能分类处理——真在内网就直连，不在内网就拨 VPN。

实现：`lib/rules/tongji.mjs` 新增 `isIntranetOnLink()`，读系统路由表判断
`10.67.0.0/16` 是否为 **On-link**（物理网卡直连）：

- **真在同济内网**：DHCP 下发的路由是 `10.67.0.0/16 -> On-link -> <物理接口IP>`，
  直接放行不拨 VPN；若之前起过 VPN 也顺手关掉（撤 hosts/路由残留）。
- **不在内网**（外网或马甲裹异环境）：路由表里这条网关是隧道 IP 或根本没这条，
  继续走 VPN 拨号 + 5 分钟 idle 断开那套。

探测结果缓存 60 秒（`INTRANET_ROUTE_CACHE_MS`）；`netsh` 不可用/超时时安全降级为
“不在内网”，继续走 VPN 路径。实测：本机 VPN 在线时 `isIntranetOnLink()` 返回
`false`（路由网关是 `111.187.76.179`），会走 VPN 拨号。

- **v2ray 兼容**：sing-box TUN 配置 `D:/Tools/v2rayN-windows-64-desktop/binConfigs/configPre.json`
  的 `route.rules[8] {"outbound":"direct","ip_is_private":true}` 已把 10.0.0.0/8 判 direct，
  不劫持同济内网流量；本版不需要改 v2ray 配置。
- **测试**：18/18 全绿。


## 1.0.51（2026-11-19）

### 改进：同济隧道改为「完整懒加载 + 5 分钟空闲自动断开」

用户反馈「现在是全局的同济代理？」——已在上个版本改成 10.67.0.0/16 分流，
但隧道仍由用户手动/开机拨号后常驻。本版进一步改成按需起、用完关：

- **懒加载**：DSH 启动不拨号，第一个同济请求由 `lib/rules/tongji.mjs` 的 `throttle` 钩子
  探到内网不通时 `vpn.ensureUp()`，冷启动一次 UAC。
- **5 分钟空闲自动断开**：`vpnState.state === up` 时挂 `setTimeout(VPN_IDLE_DISCONNECT_MS = 5 * 60 * 1000)`，
  每次同济请求到来即重置；到点后 `TongjiVpn.stop("idle timeout")` 杀 openconnect、
  撤 `10.67.0.0/16` 分流路由、清 hosts 托管块，`timer.unref()` 不挡进程退出。
- **测试修正**：`test/tongji-vpn.test.mjs:92` 原用 `192.0.2.1:9` 当必然连不通目标，
  但隧道在线时该 TEST-NET 地址会被 `10.67.0.0/16` 分流路由兜住反而连得上，
  改为 `127.0.0.1:1`（loopback 冷端口，必定 ECONNREFUSED）。18/18 全绿。


## 1.0.50（2026-11-19）

### 改进：同济隧道从「全局代理」改为「分流代理」

用户反馈「现在是全局的同济代理？」——确认属实：官方脚本 `vpnc-script-win.js`
在同济 AG 不推 `CISCO_SPLIT_INC` 时走兜底分支，给隧道加了 `0.0.0.0/0` metric 1
的默认路由（InterfaceMetric 5 优于 WLAN 的 55），并把 DNS 指向校园 DNS，于是
全机流量都从校园网出口走。

修复：新增 `lib/vpnc-script-split.js`（纯 ASCII JScript，由 openconnect 通过
`--script=` 交给 `cscript.exe /e:JScript` 执行）。它不改官方脚本，而是**改写
进程环境变量**再转调官方脚本：置 `CISCO_SPLIT_INC=1` + `CISCO_SPLIT_INC_0_*`
（10.67.0.0/16）并清空 `INTERNAL_IP4_DNS` / `INTERNAL_IP6_DNS`，官方脚本便走
split-include 分支——不加默认路由、不设 DNS、只加一条 `10.67.0.0/16` 分流路由。
脚本另做两件事：把 `agi.tongji.edu.cn` 钉到 `10.67.0.251`（带托管标记块，首次
写入前备份为 `hosts.dsh-tongji.bak`，disconnect 时清理）；官方脚本返回后自查
路由，缺失则以 `0.0.0.0` 为网关兜底补一条。

为什么必须钉 hosts：同济的内网判定是服务端看请求从哪个 IP 进来，公网 IP
`202.120.188.251/252` 即使经隧道也是 21 秒超时，只有 `10.67.0.251` 通；而 DSH
运行时 `undici` 不可用（`MODULE_NOT_FOUND`），无法在应用层覆盖 DNS 解析。

`lib/tongji-vpn.mjs` 相应接线：导出 `SPLIT_SCRIPT_PATH`，提权拨号参数在
`--protocol=array` 之后插入 `--script=<路径>`（文件缺失时自动省略）。

验证（真实拨号，提权实测）：默认路由只剩 WLAN 一条（`100.79.255.254`），隧道的
`0.0.0.0/0` 消失；新增 `10.67.0.0/16 → 111.187.83.53`；隧道接口 DNS 为空，WLAN
DNS 保持 DHCP 下发值不变；`agi.tongji.edu.cn` 解析为 `10.67.0.251`；
`/v1/chat/completions` 返回 200（418ms）。`cscript` 编译通过、`node --check`
通过、`test/tongji*.test.mjs` 18 项全过。

### 注意

- `lib/vpnc-script-split.js` 必须永久保持**纯 ASCII**：`cscript` 按系统 ANSI
  代码页（CP936）读取 `.js`，UTF-8 中文注释会被按 GBK 解码，而 GBK 尾字节可含
  `0x5C`（反斜杠），会转义掉字符串的结束引号并报
  `Unterminated string constant`（行号还会漂移）。
- 插件 `stop()` 走 `taskkill /F`，包装脚本的 disconnect 分支不会执行，hosts
  托管块可能残留；因每次同济请求前都会 `probeTunnel` + `ensureUp()`，残留不影响
  使用，下次拨号会重写同一行。

## 1.0.49（2026-11-19）

### 修复：正常流式请求末尾被追加假「思考中断」错误帧

用户反馈与同济模型对话报「上游在思考阶段中断（未产生正文）…MotionPro VPN」。
实测复现：该错误帧的 `_streamAbort` 元数据是 `sawFinishReason: true` —— 上游其实
**正常结束**（有正文、有 finish_reason），错误帧是插件自己多发的。

根因：`lib/rules/tongji.mjs` 的 `streamAbortFrame()` 没有像 cline/minimax/qoder
那样做 meta 守卫，无条件返回错误帧。框架的 `finalizeNormalEnd` 在**正常结束**时
也会调用该钩子，于是每个正常流式请求末尾都被追加一条假错误帧，误导用户去查 VPN。

修复：`streamAbortFrame(meta)` 补齐与 cline/minimax 一致的守卫——
`sawFinishReason` / 未发任何东西 / 有正文 / 有工具调用一律返回 `undefined`；
只在「只发过思考、无正文无工具调用、且无 finish_reason」时才给错误帧。
错误文案同时去掉误导性的 MotionPro/VPN 提示，改为「请重试」。

验证：`test/tongji.test.mjs` 补 7 条守卫断言（81 项全过）；隔离实例加载修复后
代码，正常流式请求 4 帧、错误帧 0、`[DONE]` 正常收尾。

## 1.0.48（2026-11-19）

### 外网自动拨号：openconnect --protocol=array 接入同济 VPN

1.0.46 只解决了「能看懂为什么不通」。这次解决「不通就自己接通」。

协议判定（四条独立证据互证）：vpn.tongji.cn 是 **Array Networks AG SSL VPN**，
不是深信服 aTrust。证据链：MotionPro 日志 `server is AG_VPN_DEVICE`、
`/prx/000/http/<vhost>/<path>` 代理路径、`ANsession` cookie、`_AN_msgID` 错误码、
`an_login.js` 的 `_AN_aaa_method` 四项；OpenConnect 的 `array.c` 源码里
`array_obtain_cookie()` 逐个字段对得上。数据面走 L3（TUN 虚拟网卡），
不是 HTTP 反代——实测未登录 `/prx/000/https/agi.tongji.edu.cn/v1/models`
只回 301 跳转，拿不到内容，所以**必须建隧道**，不能靠反向代理偷懒。

新增 `lib/tongji-vpn.mjs`（414 行）：
- `probeTunnel()`：TCP 探测 `10.67.0.251/252:443`。这是判断「是否真在内网」的
  **硬判据**——外网这两个地址直接连不通（timeout），与 API key 是否有效无关，
  比打 HTTP 看 403 可靠。
- `probeIntranet()`：三种 403 必须分开。`当前网络环境不支持` = 没进内网；
  `API密钥不存在` / `API密钥不能为空` = **链路已通，是 key 的问题**。
  混在一起会让人对着「网络不通」去查 VPN，实际只是 key 过期。
- `class TongjiVpn`：`ensureUp()` 负责启动 openconnect（经 `Start-Process -Verb RunAs`
  提权，弹一次 UAC）、轮询 `probeTunnel` 直到通、超时/进程退出/凭据错误各自返回可读原因；
  `stop()` 只 `taskkill /IM openconnect.exe`，不误伤别的进程。

**凭据不进 argv**：openconnect 用 `--passwd-on-stdin`，提权脚本主体写进
`%TEMP%	ongji-vpn\start-openconnect.ps1`，里面**不含密码**，由它每次自己去读
`tongji-vpn.env`。原因是 argv 在进程列表里全机可见。

**stdin 字段顺序是坑**：`array.c` 的 `plain_auth_form()` 表单顺序是
method → uname → pwd，但 openconnect 的 stdin 读取顺序是
**密码在前、authgroup 在后**。反了会得到 `HTTP 400 内部错误`；
对了才是 `301 + Set-Cookie: _AN_msgID=215`（215 = 凭据错误，说明格式正确）。

接线在 `lib/rules/tongji.mjs` 的 `throttle` 钩子：throttle 是 proxy 里唯一
「请求发出前、且能 await 异步」的钩子（`normalizeRequest`/`backoffMs` 都是同步的）。
触发条件写成**先 TCP 探测再决定拨不拨**，在校园网里本来就通就直接跳过，
不会平白弹一次 UAC。拨号失败不阻塞请求，让 403 照常翻译成 503 的可读提示。

新增 `tongji-vpn.env` 凭据模板、`同济VPN-使用说明.md`、`test/tongji-vpn.test.mjs`（8 项）。

补充（同版本内，本轮自查补出的四处）：
- 新增只读路由 `GET /api/api-rules/tongji-vpn`，回传 `state` / `configPath` /
  `tunnel`（TCP 探测）/ `intranet`（HTTP 探测）四项，用于排障时不用翻日志。
  **不做任何拨号动作**——拨号要提权、要弹 UAC，不能由网页请求触发，
  否则用户点一下页面就弹窗，不知道发生了什么。
- `resolveVpnConfigPath()` 改用 `fileURLToPath` 拼插件根。原先用
  `new URL('../../', import.meta.url).pathname`，Windows 上会留前导斜杠、
  空格留成 `%20`，拼出来的路径「看着对但 `existsSync` 认不出」。
  已用「从 `C:\Windows` 作为 cwd 加载」实证通过。
- 内网探测加 30s 缓存（`tunnelCache`）：在校内时这个 TCP 探测是 throttle 的
  唯一开销，每个请求都重连一遍没意义；断开校园网最多晚 30s 才发现，够用。
- 外网 403 的提示语会跟着 VPN 状态变（`vpnAdvice()`）：没填密码说「填密码」、
  密码错（`_AN_msgID=215`）说「改密码」、没装 openconnect 说「去装」。
  以前不论哪种情况都是同一句「请先连接 MotionPro」，用户不知道下一步该做什么。
- 修一个真 bug：`/api/api-rules/tongji-vpn` 处理器里写了 `resolveEnvCredential(...)`，
  但那只是 `createProxy` 内部的闭包参数，在此作用域不存在 → 一调就 500
  `resolveEnvCredential is not defined`。`node --check` 与路由条数测试都查不出，
  只有真调一次才暴露。已改走 `live.credentials?.resolve?.()`。
- 新增 `test/tongji-vpn-route.test.mjs`（2 项）：不数路由条数，而是**真调用 handler**，
  并且 config 里必须放一条真 tongji 路由（否则 `route?.apiKeyEnv ? ... : undefined`
  会短路，bug 根本执行不到——第一版测试就是这么漏的，已用负向对照证实修好后能抓住）。
  同文件把 `test/web-route-dispose.test.mjs` 的 `ROUTE_COUNT` 从 11 更新到 12。

后续验证与加固（同版本内补记，lib/tongji-vpn.mjs 现为 490 行）：

- **真实拨号已成功**：填入统一身份认证密码后 connect 返回
  { ok: true, state: 'up', via: '10.67.0.251' }；网卡 vpn.tongji.cn / OpenConnect Tunnel 起来，
  agi.tongji.edu.cn 解析回内网地址，probeIntranet 200。array 协议与同济 Array AG 固件对得上，
  conf50/conf54 + L3 数据面均已验证。端到端 15 项全过（对话 / reasoning 双向镜像 / 工具调用 /
  12 并发零 429 / 非 chat 模型 400 / 流式 [DONE]）。
- **网关 DNS 死锁修复**：隧道建起来后内网 DNS 接管，vpn.tongji.cn 反而 getaddrinfo 失败，
  重拨永远卡在域名解析。做法：拨号前用 dns/promises.lookup 解析网关 IPv4 并落盘
  %TEMP%\tongji-vpn\gateway-ip.txt，openconnect 参数加 --resolve=vpn.tongji.cn:<ip>；
  DSH 重启后内存丢失仍能从落盘文件恢复。readGatewayIp/writeGatewayIp 用 IPV4_RE 严格校验——
  该值会拼进命令行，必须防注入。
- **隧道复用守卫**：ensureUp() 开头先 probeTunnel()，已通则直接返回 { reused: true }，
  不再起第二条 openconnect 去抢同一组路由（此前重复拨号会因 DNS + 双隧道失败）。
  probeTunnel 增加 hosts/port 覆盖参数便于测试。
- 测试：test/tongji-vpn.test.mjs 13 → 15 项（新增网关 IP 落盘往返 / 脏数据不采纳、隧道复用短路）。

## 1.0.46（2026-11-19）

### 接入同济 agi 平台：内网判定 + 并发上限两条硬规则

tongji 原本是 desktop patch 里的静态 provider，直连 `https://agi.tongji.edu.cn/v1`。
那样 DSH 核心完全绕过本插件，实测出来的两条上游限制一条都落不住。现在按
「API 链接导入」的思路改成**动态上游**（与 intern-ai 同构，存
`~/.dsh/.api-rules/upstreams.json`），请求必须经过 8788 代理。

上游实测（本机在同济内网，可复现）：
- **内网判定在服务端**：同一个有效 key，强制解析到公网 IP `202.120.188.251` →
  `403 {"message":"当前网络环境不支持"}`；解析到内网 IP `10.67.0.251` → 200。
  所以这条规则**插件侧无法伪造绕过**，只能做诊断与错误翻译。
- **并发上限 = 3**：12 并发长请求 → 9 个 200、3 个 429
  （`并发请求数已达套餐上限（3 个）`），**槽位随请求结束释放**，不是码道那种 60s TTL。
- 三种 403 文案可分野：`当前网络环境不支持`（外网）/ `API密钥不能为空` / `API密钥不存在`。
- 思考字段两套混用：DeepSeek/GLM/MiniMax/Kimi/MiMo 系发 `reasoning`，
  Qwen 系发 `reasoning_content`；GLM-5.3 是唯一不支持图片的 chat 模型。

改动：
- 新增规则包 `lib/rules/tongji.mjs`（`name: 'tongji'`）：403 三态分流
  （network_blocked→503、密钥问题→401、并发→429）、并发错误识别、
  `reasoning` ↔ `reasoning_content` 双向镜像、GLM-5.3 剥图、`developer`→`system`。
- 新增 `lib/gate.mjs` 的手工释放语义：`holdMs <= 0` 时闸门不再按 TTL 占位，
  而是 `acquire()` 返回 `release`、由 `proxy` 挂在 `response.on('close')` 上归还。
  **TTL 语义（码道 60s）完全不变**，只多一种释放模式。
- `lib/proxy.mjs` 两处通用修复：
  1. 闸门 acquire 成功后把 `release` 挂到响应收尾，失败/流式/非流式三条分支都会归还；
  2. 非 2xx 响应也走规则包的 `translateBusinessError`（此前只有 HTTP 200 里的业务错误
     会被翻译），并把翻译后的完整错误体随 `upstreamError` 抛出，保住 `type` 字段。
- `lib/proxy.mjs` 的 `collectJson` 补调 `normalizeDelta`（入参是 `choice.message`）：
  此前非流式响应完全不过规则包，导致「上游把思考放在 `message.reasoning`」的模型
  在非流式下 DSH 看不到思考内容。这是通用缺陷，不止 tongji。
- desktop patch 的 tongji 块改成 `baseURL: http://127.0.0.1:8788/tongji/v1`，
  并补齐缺失的 `contextWindow`/`maxTokens`，去掉 GLM-5.3 的 `image`。
- 新增测试 `test/tongji.test.mjs`（63 项）、`test/gate.test.mjs`（20 项）、
  `test/tongji-e2e.test.mjs`（17 项，含并发闸门与 collectJson 回归）。

- 非 chat 模型的 404 现在有可操作提示：`MiniMax-H3-Image` / `Whisper` /
  `Qwen3-Embedding` / `Qwen3-Reranker` 打对话接口时上游只回一句
  `{"detail":"Not Found"}`（**没有 `error` 字段**），此前用户只能看到
  `upstream 404: {"detail":"Not Found"}`。现在按模型名判定后回 400 +
  「这个模型不提供 /chat/completions，向量走 /v1/embeddings、重排走 /v1/rerank…」。
  为此 `translateBusinessError` / `statusForError` 增加可选的第二参 `ctx.model`，
  `proxy.mjs` 的 5 个调用点统一传入（此前钩子只能看到 chunk，拿不到模型名）。

- 鉴权错误的第三种 body 形状也要认：实测同济三种 403 的形状并不统一——
  外网 `{"error":{"code":403,"message":"当前网络环境不支持"}}`（有 `error` 包装）、
  错密钥 `{"code":403,"message":"API密钥不存在"}`、空密钥
  `{"code":403,"message":"API密钥不能为空"}`（**顶层直接 `{code,message}`，既无
  `error` 也无 `detail`**）。此前只认第一种，导致「密钥错了」被原样抛成
  `upstream 403`，用户看不出要改密钥。现在三种形状都识别：错密钥/空密钥 → 401、
  外网 → 503、并发 → 429，且只接管认得出的分类，其余保持原样不吞。

  依据是模型广场 `/models/hub` 的接口族定义（本地实测确认可用）：
  `/v1/chat/completions`、`/v1/responses`、`/v1/embeddings`、`/v1/rerank`、
  `/anthropic/v1/messages`（Anthropic 兼容，需 `x-api-key` + `anthropic-version`）、
  图像/语音走 `/svc/<route_path>`。这修正了先前「这些模型不可用」的误读：
  它们只是不提供**对话**接口。

## 1.0.45（2026-11-18）

### 动态上游卡片改成 CodeArts 式就地可编辑

现象：intern-ai 这类动态上游的卡片是只读的（只显示上游地址 + 凭据名 + 编辑/删除），
改地址或密钥得点「编辑」另开面板，和 CodeArts 卡片（AK/SK 就地输入框 + 已保存掩码 +
留空则不修改 + 底部保存）不一致。用户要求：新增 API 的窗口做成和 codearts 一样。

改动（按用户拍板：改成可就地编辑的卡片）：
- 动态上游卡片删掉只读的 arc-upInfo 展示区和单独的「编辑」入口，改为两个就地输入框：
  上游 API 地址（文本框，预填当前地址）+ API Key（密码框，占位「留空则不修改」）。
- API Key 输入框右侧沿用 CodeArts 的「已保存 ****XXXX」掩码（host 对动态上游多返回的
  akHint = 已存密钥尾号），已配置时占位显示「留空则不修改」，和 CodeArts 一致。
- 卡片底部常驻 保存 / 删除 两个按钮；聚焦任一输入框进入编辑态后，再出现 取消 / 清除。
  保存走既有的 POST /api/api-rules/upstreams（带 apiKeyKeep：密钥留空即保留原值），
  不新建端点；高级字段（rules / models / 并发 / 超时 / 透传鉴权 / 凭据环境变量）在保存时
  从已加载的上游明细读回透传，不会因就地编辑而丢失。
- 两处字段都接 onFocus 进编辑态；删掉无人调用的 modelsToText 死代码。
- 修一个会在线上让整张卡片崩掉的 TDZ bug：upDelete 的 useCallback 依赖里引用了
  尚未声明的 onDeleteUpstream（Cannot access before initialization），把 upDelete 块
  移到 onDeleteUpstream 之后。离线渲染 harness（假 React + 假 fetch 加载真实 bundle）
  双跑源码与 bundle，9 项断言全过。
- 顶部仍保留一行说明：地址仅作展示，实际请求仍经本插件代理，规则包节流继续生效。

## 1.0.44（2026-11-18）

### 面板收尾：去掉空框 + 动态上游卡片直接显示真实地址与凭据

现象：设置卡片里标签栏下方总挂着一个空的边框矩形（未展开「＋」时也在），
而 intern-ai 这类 OpenAI 协议动态上游的卡片只显示「还没配置管理面板地址」，
看不到真实上游地址和密钥，用户误以为 API 映射到了本地 127.0.0.1 端口。

改动（按用户拍板：保留 8788 代理，仅卡片展示真实地址；彻底去掉独立空框）：
- 服务端 accounts 为动态上游多返回 4 个字段：dynamicUpstream / upstreamUrl / apiKeyEnv /
  passthroughAuth。标记只加在 mergeUpstreamRoutes() 并入的动态路由上，静态路由不动。
- 客户端删掉常驻的 arc-addpanel 空框：添加表单改为只在点「＋」时挂载，边框随之消失；
  原「已添加上游」列表整块删除。
- 动态上游的卡片新增 arc-upInfo 区，直接显示上游 API 地址（如 
  https://discovery-api.intern-ai.org.cn/v1）与凭据名（如 INTERN_AI_API_KEY），
  并把两步确认删除按钮放进该卡片，不再需要展开添加框才能删。
- 附一行说明：地址仅作展示，实际请求仍经本插件 8788 代理，规则包节流（200/50 RPM、
  2M TPM、429 退避）继续生效——避免直连真实上游绕过节流。

验证：客户端双份（源码 + bundle）渲染测试 14/14；服务端 accounts 静态接线断言；
三份 node --check 全绿；全量测试 90 pass / 0 fail；两条负向对照（去掉 dynamic 分支 /
还原服务端补丁）均使对应断言变红，证明有效。HMR 重载后 accounts 实测 intern-ai 
dynamicUpstream=true、upstreamUrl=https://discovery-api.intern-ai.org.cn/v1、health ok=true、
models=11，其余 6 条路由保持绿；全程未重启 DSH。

## 1.0.43（2026-11-18）

### 修掉健康徽章假红：透传路由探测改用 DSH 真密钥

现象：把 intern-ai 动态加回后，设置卡片里它的健康徽章是红的（`HTTP 401`、models=0），
但用它发 chat 请求、自动拉模型清单都正常。

根因：`probePassthrough`（lib/index.mjs）探测透传路由时用 `route.apiKey`，而透传路由
的 apiKey 是占位符 `sk-passthrough-placeholder`，打上游 /v1/models 得 401。真密钥只在
DSH 凭据（`apiKeyEnv`）里，1.0.41 已让模型发现走真密钥，但健康探测这条路径漏了。

修复：`probePassthrough` 对 `passthroughAuth === true` 且带 `apiKeyEnv` 的路由，先经
`live.credentials.resolve(apiKeyEnv)` 取真密钥拼 Bearer 再探测；解析失败退回原值，
不影响其它路由。与 1.0.41 的模型发现同一条真密钥路径。

验证：新增 `test/probe-credential.test.mjs`（2 条：真密钥→health.ok=true 且上游确实收到
真密钥；占位符→HTTP 401 红；含静态锚点断言）。负向对照退回修复前版本 → 2 条全红，
恢复修复版 → 全绿。全量 `node --test` **85 pass / 0 fail**（83 基线 + 2）。
HMR 重载后实测：intern-ai 徽章 `ok=true models=11`（原 `false/HTTP 401/0`），其余路由
全不变；经 8788 代理发 chat HTTP 200。全程未重启 DSH、未手动 kill 用户进程。

## 1.0.42（2026-11-18）

### 面板：去掉「已添加上游」区块的干扰文字

按用户要求，把设置卡片里那三行字删掉：标题「已添加上游（点删除两次确认）」、说明
「填上游的 OpenAI 兼容地址与密钥...」、空提示「还没有动态上游...」。**只删文字**，
保留右上「＋」入口、添加表单，以及已添加上游的删除按钮（仍可两次点击确认）。
源码 `lib/client/index.js` 与宿主实际加载的 `lib/client.js` 双份镜像。

### 修掉「删一个上游把别的网关也带崩」的竞态

现象：删掉 intern-ai 后，minimax2api（8080）与 trae2api-hub（7870）两个网关变红、
`fetch failed`，而删除前后它们的配置块零差异。

根因链：删上游 -> `rebuildProxy()` -> `old.close()` -> `dispose()` 对所有插件拉起的网关
`child.kill()`（`killOnStop: true`）-> 但 `child.kill()` 只发信号、**不等进程真退出**，
`close()` 立刻返回 -> 新 proxy 立刻 `ensureUpstream()` 探测端口，此时旧进程还没退完、
端口还被占 -> 判定 `already_running` -> 不再拉起 -> 旧进程随后退出、端口空了却没人重拉
-> 两个网关永久消失。独立安装的 cline（3457）不带 launch，不受影响，所以只有这两个红。

修复（两层都要在）：
- `lib/launcher.mjs`：`dispose()` 改 async，kill 后 `await waitForChildExit(...)`
  等子进程真正退出（exit 事件 + exitCode/signalCode + 超时强杀兜底，不无限等）。
- `lib/proxy.mjs`：`close()` 先 `await launchReady` 收齐所有 `ensureUpstream` 的 dispose，
  再逐个 `await dispose()`，确保重建前端口一定释放。

验证：新增 `test/launcher-dispose-wait.test.mjs`（4 条：等待/已退/超时兜底 + 静态接线），
负向对照去掉 `await` 即变红；全量 `node --test` **83 pass / 0 fail**（79 基线 + 4）。
node --check 全绿。

注：本修复在插件代码里，需重载插件后生效；已经崩掉的两个网关重载后由 ensureUpstream
探测到空端口会自动重新拉起。全程未重启 DSH、未手动 kill 用户进程。


## 1.0.41（2026-11-18）

### 修掉「加回上游后模型选择器里一个模型都没有」

上一版修的是「模型窗口退化成 128000」。这一版修的是更前一步、更致命的一环：**模型根本发现不了**。

活体验证时发现 `GET /intern-ai/v1/models` 回的是 `_apiRulesFallback: true`——也就是说规则前置层
没拿到真密钥，用占位值 `sk-passthrough-placeholder` 打上游、被 401 挡回来，只能端出
`route.models` 里的旧清单。而 `planSync` 对 fallback 是**整条跳过**（这是防误删的正确设计），
于是「面板加回上游 → 宿主同步模型」这条路上，provider 块永远是空的、模型选择器里一个模型都没有。
更难受的是它**全程 200、没有任何报错**，只看接口状态根本发现不了。

两层根因，缺一层就复发：

1. `normalizeRoute`（`lib/proxy.mjs`）没把 `apiKeyEnv` 带下去。`upstreamToRoute` 明明产出了它，
   但过了 normalize 就丢了，proxy 侧根本不知道凭据名叫什么。
2. `listModels` 只用 `authHeaders(route, ...)`，对透传路由拿到的就是 `route.apiKey` 的占位值。

修法：

- `normalizeRoute` 保留 `apiKeyEnv`（空串归一成 `undefined`，不给普通路由凭空造值）。
- `createProxy` 新增可选 `resolveEnvCredential(ref)`，由 `lib/index.mjs` 注入
  `live.credentials?.resolve?.(ref)`（两处 createProxy 都注入了）。凭据只在宿主内存里用一次，
  **不落盘、不进卡片**。
- `listModels` 对 `passthroughAuth && apiKeyEnv` 的路由，先按引用名取真密钥再打上游
  `/v1/models`；取不到就保持原行为回落（读凭据失败绝不让 `/models` 报错）。

**新增 12 条回归（`test/passthrough-discovery.test.mjs`）**

本地起一个「只有真密钥才回清单、占位密钥一律 401」的假上游，复刻 intern-ai 的真实行为：

- `normalizeRoute` 保留 `apiKeyEnv`；没有时不凭空造。
- 透传路由的 `/v1/models` **不带** `_apiRulesFallback`、清单来自上游、旧声明模型不端出来、
  上游确实收到 `Bearer sk-real-intern-key`。
- 凭据缺失时仍回 200 且明确标 `_apiRulesFallback: true`（老行为不回退）。
- 普通路由仍用自己的 `apiKey`，不被凭据名劫持。

两条负向对照都验过（改坏 → 立刻红 → 改回）：
- 把 `listModels` 的 `discoveredAuthorization` 去掉 → 4 条红（含「上游收到的是真密钥」）；
- 把 `normalizeRoute` 的 `apiKeyEnv` 去掉 → 5 条红。

**真机复核**：修前活体 `/intern-ai/v1/models` 是 `fallback: true` + 10 条旧清单；
修后同一条请求 `fallback: undefined` + 上游真实 11 条。隔离环境完整复刻用户那条路径
（删掉 → 加回 → 同步）`ALL_CHECKS_PASS（21 项）`：provider 块 `created:true`、写的是
`apiKeyEnv: INTERN_AI_API_KEY`、11 个模型全部真实窗口、无一条 128000。

**验证**：`node --test 'test/*.test.mjs'` = **79 pass / 0 fail**（原 78 + 新增 12 条里并入的 1 个文件）。

## 1.0.40（2026-11-18）

### 「删掉再拿面板加回来」这条路，端到端钉死了

用户的原计划就是这条：把 intern-ai 从面板删掉，再用面板填表加回来，看能不能正确加载。
在隔离环境里真跑了一遍完整链路（复制真 profile 到临时目录，绝不碰线上文件），抓到并修掉一个
**看起来加回来了、实际窗口全错**的缺陷。

**修掉的缺陷：模型同步读不到 schema 2.x 的嵌套字段**

`normalizeModel`（`lib/sync-models.mjs`）原来只认扁平的 `context_length` / `context_window` /
`max_tokens`。而 intern-ai 的 `/v1/models` 是 schema 2.x 嵌套结构，上下文长度只在
`input_modalities[].supported_inputs.max_context_length.value`、输出上限只在
`output_modalities[].max_length.value`，扁平字段**一个都没有**。后果：

- 面板「拉取模型清单」是好的（那条路径有嵌套解析），能拉到 1048576；
- 但加回上游后宿主跑的 `syncModels` 走 `normalizeModel`，读不到 → 全部落默认值
  **128000 / 65536**，写进 profile 的 provider.models。
- 于是「删掉再加回」之后，模型选择器里每个模型都变成 128K 上下文，deepseek-v4.1-flash-1017
  这种 1M 上下文的模型被砍到 128K，长对话会莫名截断。

修法：`normalizeModel` 增加嵌套模态读取（新增 `nestedNumber(arr, pick)` 辅助，按「先 `.value`
再裸值」取值、跳过 `'text'`/`'image'` 这类字符串条目），`contextWindow` 与 `maxTokens` 都按
「扁平优先、嵌套兜底」取值。

**新增 11 条回归测试（`test/sync-model-normalize.test.mjs` 5 条 + `test/upstream-provider-cycle.test.mjs` 4 条 + `test/upstream-endpoint.test.mjs` 2 条）**

`upstream-provider-cycle.test.mjs` 把用户那条路径完整跑一遍（隔离 `DSH_HOME`，真 profile 只读复制）：

1. 删除：`deleteUpstream` 返回 true → 再删返回 false（幂等）；`removeProviderBlock` 摘掉 provider
   块；顶层条目数不变、邻居 provider（codearts / trae2api-hub）块数不变、无 `INTERN_AI_API_KEY` 残留。
2. 加回：`putUpstream` 返回 `id: 'intern-ai'`（**这就是 await 修复的哨兵**：漏 await 时它是 Promise，
   id 为 undefined）；`ensureProviderBlock` 写出的块里是 `apiKeyEnv: INTERN_AI_API_KEY`
   而**不是**占位的 `API_RULES_BEARER`。
3. 装配：`upstreamToRoute → normalizeRoute` 后 `passthroughAuth`、`rules:['intern-ai']`、
   10 条 models（含 `intern-decision-4b`）、`concurrency:2`、`sessionHoldMs:60000`、`timeoutMs:300000`
   全在；`RuleRegistry.get('intern-ai')` 能解析出包且 `throttle` 钩子在。
4. 同步：喂真机那 11 条嵌套清单，`syncModels` 写回 11 条，`deepseek` 是 1048576、`glm-5.3` 是
   1048576、`Atria-Dawn` 是 524288、`intern-s2` 是 262144，**没有任何模型退化成 128000**。

`upstream-endpoint.test.mjs` 打到 HTTP handler 这一层（`POST` / `GET` / `DELETE /api/api-rules/upstreams`），
因为 await 那个 bug **只在 handler 里**：库里调 `putUpstream` 是正常的，只有端点响应里的
`provider.created` 才看得出半成品。用例里 `port: 0` 让内核分配端口，绝不和线上 8788 抢。

三条负向对照都验过（改坏 → 测试立刻红 → 改回）：
- 去掉 `await` → 端点用例报「响应里的 upstream 必须是已落盘的对象，而不是 Promise」；
- 把 `apiKeyEnv` 硬编码回 `API_RULES_BEARER` → 加回用例报占位密钥；
- 把 `normalizeModel` 退回只读扁平字段 → 嵌套用例报「必须赢过 128000 默认值」。

**验证**：`node --test 'test/*.test.mjs'` = **78 pass / 0 fail**（原 67 + 新增 11）。
隔离环境完整链路模拟 `ALL_CHECKS_PASS（48 项）`，真机 `/v1/models` 复核 11 个模型的
上下文长度全部与上游一致。

**顺带查清：`intern-decision-4b` 不该手填进模型清单**

原先的交付文档让人「拉完手动补一条 `, intern-decision-4b:8192`」。真机一验是错的：

- 它**不在** `GET /v1/models` 的 11 条里；
- 直连 `POST /v1/chat/completions`（`model: intern-decision-4b`）回
  `404 model_not_available: intern-decision-4b does not support openai_chat protocol`
  —— 它走的是 SystemOne 协议，不是 OpenAI chat 协议。

所以手填进清单只会让模型选择器里多一个必然报错的条目。正确做法是**不填**：
`upstreams.json` 的 `route.models` 与 profile 的 `provider.models` 都只保留上游真能服务的
11 个；规则包 `intern-ai` 里仍保留它的 200 RPM 分桶（将来若经别的通道调用可命中）。
文档已同步改掉。

## 1.0.39（2026-11-18）

### 模型清单不用点按钮也会自己拉

1.0.38 加了「拉取模型清单」按钮，但用户的原话是「像 DSH 自带的模型选择器那样**自己**调出来」——
还得手点一下就不算自己调。这一版改成失焦即拉。

- `baseUrl` 输入框失焦时，若已是合法 `http(s)` 地址就自动拉一次模型清单。
- `DSH 凭据名` 填完失焦时再补拉一次（第一次可能因为还没凭据而匿名失败）。
- 自动拉取是**静默**的：地址没填完、凭据还没配好都不弹错，**自动拉取本身失败也不弹**
  （例如凭据未配导致上游 401——那不是用户操作的结果），只有手动点按钮才显示错误。
  用户仍可随时手动点按钮。
- 顺手把 `addField` 加了可选的 `onBlur` 参数（不影响其他 8 个字段）。

**验证**：`node --test 'test/*.test.mjs'` = **67 pass / 0 fail**。新增 3 条自动拉取用例
（失焦确实发出请求并回填清单；地址不完整时静默不报错；自动拉取失败静默、手动点按钮失败
才报错），同样对 bundle 与源码各跑一遍。

## 1.0.38（2026-11-18）

### 模型清单能自己拉出来了；顺手修掉「删除再加回」必然 401 的坑

上一版面板里的模型清单还得手抄——十几行 `id:maxTokens`，抄错一个就静默失效。这一版改成点按钮
从上游 `/v1/models` 自动拉。同时查出一个会让用户「删掉 intern-ai 再加回来」直接失败的真 bug。

**新端点 `POST /api/api-rules/upstreams/models`（`lib/index.mjs`）**

- 宿主代拉上游 `/v1/models`，返回 `{ ok, models:[{id, maxTokens?}], source, error }`。
- 鉴权优先级：**DSH 凭据名（`apiKeyEnv`）> 表单里粘的 `apiKey` > 匿名**。凭据走
  `ctx.credentials.resolve(ref)`（`credentials` 走 `ctx.inject` 注入，不进顶层 `inject`，
  否则会把整条插件推迟装载），密钥只在宿主侧内存里用一次，**卡片永远拿不到密钥**。
- 上游字段兼容 `data` / `models` / 裸数组三种形状。`maxTokens` 取值按优先级：
  ① 扁平 `maxTokens` / `max_tokens` / `max_output_tokens`；
  ② 嵌套 `output_modalities[].max_length.value`（输出上限）；
  ③ 扁平 `context_length` / `context_window` / `max_context_length`；
  ④ 嵌套 `input_modalities[].supported_inputs.max_context_length.value`（上下文长度）。
  intern-ai 走的是 schema 2.4 的嵌套结构（扁平字段**一个都没有**），实测 11 个模型的
  上下文长度全部解析正确（Agents-A1 / intern-s2 / qwen3.8-27b 262144，Sage 系 / Atria-Dawn
  524288，deepseek-v4.1-flash-1017 / glm-5.3 / kimi-k3.1-pro 1048576）。
- 15s 超时；HTTP 非 2xx、超时、连不上都回 `ok:false` + 人话 `error`，不会把异常抛成 500。

**修一个会让「删掉再加回」必然失败的真 bug（`lib/sync-models.mjs`）**

- `ensureProviderBlock` 原来把 provider 块的 `apiKeyEnv` **硬编码成 `API_RULES_BEARER`**（占位密钥）。
  intern-ai 的静态 provider 用的是 `INTERN_AI_API_KEY`。于是「从面板删掉 intern-ai 再加回来」后，
  写入 profile 的 provider 会改用占位密钥 → DSH 核心发 `Bearer sk-api-rules-local-placeholder` →
  透传到上游必然 **401**。
- 现在 `apiKeyEnv` 由上游记录携带（`upstreams.mjs` 校验必须是合法凭据名
  `/^[A-Za-z_][A-Za-z0-9_]*$/`，非法直接拒绝），`ensureProviderBlock` 只在合法时采用、
  否则退回占位值。`maskUpstream` 也回传 `apiKeyEnv`，面板能显示它。

**面板（`lib/client/index.js` + bundle `lib/client.js` 双份等价改动）**

- 新增「DSH 凭据名（透传时用）」输入，例如 `INTERN_AI_API_KEY`。
- 新增「拉取模型清单」按钮：点了用当前 `baseUrl` + 凭据名打新端点，把结果写成
  `id:maxTokens, id:maxTokens, …` 回填到模型清单框，并提示「已拉取 N 个模型」。
- **不用点按钮也会自己拉**（像 DSH 自带的模型选择器那样）：`baseUrl` 输入框失焦时若已是
  合法 http(s) 地址就自动拉一次；`DSH 凭据名` 填完失焦时再补拉一次（第一次可能因为还没
  凭据而匿名失败）。自动拉取是**静默**的——地址没填完、凭据还没配好都不弹错，只有手动
  点按钮才显示错误。用户仍可随时手动点。
- **拉取是「合并」不是「覆盖」**：上游 `/v1/models` 不一定把你在用的模型都列出来
  （intern-ai 上游就没有 `intern-decision-4b`，而它是 DSH 里在用的决策模型）。
  所以拉取时以「上游优先、缺 maxTokens 就沿用你原来填的值」合并，上游没列出的旧条目
  原样保留，并提示「已拉取 N 个模型，另保留上游未列出的：xxx」。
  实测：真机 11 个模型 + 现有 10 个模型（含 `intern-decision-4b`）→ 合并 12 个，
  `intern-decision-4b` 保留、`glm-5.3` 采用上游的 1048576。
- 模型清单解析加脏片段守卫：`" , , : ,"` 这类纯分隔符片段以前会被当成 id 为 `":"` 的
  假模型写进清单，现在只接受「有真 id」的条目。
- 新增 i18n zh/en 各 8 键（`up.apiKeyEnvLabel/apiKeyEnvPh/modelsFetch/modelsFetching/
  modelsFetched/modelsFetchedKept/modelsEmpty/error.upModels`）与 `.arc-fetchRow` /
  `.arc-fetchHint` 样式。

**验证**

- `node --check` 全过（`lib/index.mjs`、`lib/upstreams.mjs`、`lib/sync-models.mjs`、
  `lib/client/index.js`、`lib/client.js`）。
- `node --test 'test/*.test.mjs'` = **65 pass / 0 fail**。其中新增的
  `test/client-upstream-form.test.mjs` 是**真渲染测试**：用假 React 把卡片组件跑起来，
  打开「＋」面板、断言 9 个字段 + 透传勾选框 + 拉取按钮都在，再点按钮验证
  「合并而非覆盖」的最终文本与提示文案，并验证 `baseUrl` 失焦会自动拉取、地址不完整时
  静默不报错。同一套断言对 `lib/client.js`（宿主实际加载的 bundle）与
  `lib/client/index.js`（可读源码）各跑一遍，防止两份手工维护的副本走偏。
  另跑了**负向对照**：把 bundle 的 `const kept = before.filter(...)` 改成 `const kept = []`
  （即退回「覆盖」语义），该测试立刻失败——证明断言不是摆设。
- 新增路由后同步把 `test/web-route-dispose.test.mjs` 的 `ROUTE_COUNT` 10→11、
  `ROUTE_PATHS` 补上新端点。
- 端到端探针（真起一个本地假上游 + 假 host，直接调 handler）：凭据解析出
  `Bearer sk-real-intern-key`；已带 `Bearer ` 前缀的凭据不重复加；表单 key 生效；
  匿名照发；401 回 `ok:false, error:"HTTP 401: invalid api key"`；坏 baseUrl 回 400
  `invalid_base_url`；连不上回 `fetch failed`。上游收到的 4 次 Authorization 与预期完全一致。
- 嵌套字段解析探针（嵌套 / 扁平 / 字符串 / 无元数据四类上游）全过。
- 合并语义探针（真机 11 模型 + 现有 10 模型）全过，并因此发现并修掉 `":"` 假模型缺陷。

## 1.0.37（2026-11-18）

### 「＋」面板补齐高级字段，删掉 intern-ai 后能自己加回来

上一版把 intern-ai 从 `cordis.patch.yml` 的静态路由迁到了动态上游，但「＋」表单只有
`name / id / baseUrl / apiKey` 四个字段，POST 也只发这四个——**规则包一律落默认 `generic`**，
面板根本表达不出 intern-ai 这种「透传鉴权 + 指定规则包 + 自带模型清单」的上游。所以用户一旦
把 intern-ai 删掉，就没法从面板加回来。

**修一个真 bug（`lib/index.mjs`）**

- `POST /api/api-rules/upstreams` 里 `putUpstream(...)` **漏了 `await`**（`putUpstream` 是 async）。
  后果：`upstream.id` 是 `undefined` → `ensureProviderBlock({ id: undefined })` 直接返回
  `invalid provider id` → provider 块写不进 profile，模型选择器里看不到这个上游，而接口照样回 200，
  是一个「看着成功、其实半成品」的静默失败。现已 `await`。

**面板字段扩展（`lib/client/index.js` + bundle `lib/client.js` 双份等价改动）**

- 新增 4 个输入：`rules`（规则包，逗号分隔，留空 = generic）、`models`（模型清单，逗号分隔，
  每项支持 `id` 或 `id:maxTokens`）、`concurrency`（并发数，可选）、`timeoutMs`（超时毫秒，可选）。
- 新增「透传鉴权」勾选框：勾上后 `apiKey` 可留空（密钥由 DSH 凭据持有，本插件不存、只中转）。
- POST body 从 4 个字段扩到 9 个（`rules / models / passthroughAuth / concurrency / timeoutMs`
  按需带上），服务端 handler 同步透传这 5 个字段给 `putUpstream`。
- 新增 i18n `up.rulesLabel/rulesPh/modelsLabel/modelsPh/concurrencyLabel/concurrencyPh/
  timeoutLabel/timeoutPh/passthroughLabel`（zh + en 各 9 键）与 `.arc-check` 样式。

**验证**

- `node --check lib/index.mjs`、`lib/client/index.js`、`lib/client.js` 全过。
- `node --test test/*.test.mjs` = **57 pass / 0 fail**。
- 端到端装配模拟（隔离 `DSH_HOME`，用面板的解析逻辑生成 payload → `putUpstream` →
  `readUpstreams` → `upstreamToRoute` → `normalizeRoute` → `registry.get`）：
  `rules:['intern-ai']` 正确落盘、10 个模型（首 `deepseek-v4.1-flash-1017`、
  末 `intern-decision-4b@8192`）无损、`concurrency:2 / timeoutMs:300000` 保留、
  `sessionHoldMs` 落默认 60000、`apiKeyMasked:'passthrough'`、规则包解析到 `intern-ai`。

## 1.0.36（2026-11-17）

### 动态上游的「删除」提为一级操作

「＋」面板原来把**已添加上游列表（含删除按钮）整块藏在添加表单里**，只有点开「＋」展开表单时才
看得到、才能删——「能加也得能减」，删除不该寄在「添加」之下。

- 设置卡片新增始终可见的「已添加上游」管理区：列出所有动态上游（id · baseUrl · key 掩码/透传），
  每行「删除」按钮，**点两次确认**（第一次变成「再点一次确认删除 <id>」，4s 内生效），删除后该上游
  对应的动态路由立即从代理下线并从模型选择器同步移除。
- 「＋」现在只负责展开/收起**添加表单**；列表不再依赖它展开。
- 列表为空时显示「还没有动态上游。」提示。
- 新增 i18n `up.listTitle`；`up.empty` 复用。

**验证**：`node --check lib/client/index.js`、`node --check lib/client.js` 全过；`node --test test/*.test.mjs`
57 pass / 0 fail。删除的存储/端点（`deleteUpstream` + `DELETE /api/api-rules/upstreams?id=`）在 1.0.35 已就位，
本版只把它的 UI 从「藏在添加面板里」提为始终可见。

## 1.0.35（2026-11-17）

### 动态上游（extension slot）机制扩展 + intern-ai 迁移

「＋」动态上游机制原来只支持最简单的 OpenAI 协议上游（baseURL + apiKey + rules），这次把它
扩展到能表达 intern-ai 这类「透传鉴权 + 带模型清单 + 并发/超时调优」的复杂上游，并把 intern-ai
从 cordis.patch.yml 的静态路由迁到这套机制上。

**机制扩展（`lib/upstreams.mjs`）**

- `normalizeUpstream` 新增可选高级字段，全部原样透传给 `normalizeRoute`（proxy.mjs 已支持）：
  - `passthroughAuth: true`：透传 DSH 核心发来的 Authorization（密钥由 DSH 凭据持有，本插件不存）。
    透传上游的 `apiKey` 可省（落占位值 `sk-passthrough-placeholder`，仅供非透传兜底，实际不命中）。
  - `models: [{ id, maxTokens? }]`：模型清单 + 每模型 maxTokens。
  - `concurrency` / `sessionHoldMs` / `timeoutMs`：数字，与 cordis.patch.yml 路由字段同义。
- `upstreamToRoute` 在字段存在时才带上（通用上游保持精简，不回退）。
- `maskUpstream` 对透传上游不回传 key 掩码（改标 `apiKeyMasked: 'passthrough'`），带 models 时
  回传模型数量。设置卡片上游列表因此能区分「透传」与「带 key」两类上游。

**intern-ai 迁移**

- `~/.dsh/.api-rules/upstreams.json` 种入 `intern-ai` 动态上游：baseUrl
  `https://discovery-api.intern-ai.org.cn/v1`、`passthroughAuth: true`、`rules: ['intern-ai']`、
  10 个模型（含每模型 maxTokens）、`concurrency: 2` / `sessionHoldMs: 60000` / `timeoutMs: 300000`。
- 从 `cordis.patch.yml` 的 `llm-8788` `config.routes` 删除静态 `intern-ai` 路由块（原 379–426 行）。
  运行时由 `mergeUpstreamRoutes`（`lib/index.mjs`）从 upstreams.json 装配等价路由，行为不变。
- `intern-ai` 规则包（事前 RPM/TPM 节流）保持内置（`lib/rules/intern-ai.mjs`，index.mjs 注册），
  动态路由的 `rules: ['intern-ai']` 仍解析到它。
- 桌面 profile（`~/.dsh/profiles/desktop/cordis.patch.yml`）的 `llm-pi-ai` `intern-ai` provider
  （baseURL 指向本插件代理 `http://127.0.0.1:8788/intern-ai/v1`）不受影响，模型选择器照常。

**验证**：`node --check lib/{upstreams,index,proxy}.mjs` 全过；`node --test test/*.test.mjs` 57 pass / 0 fail。
动态上游经 `normalizeUpstream → upstreamToRoute` 装配后与原静态路由逐字段等价（label 为死配置，不保留）。

**回滚**：`cordis.patch.yml.bak-migrate-<ts>` 备份了迁移前的 patch；把 intern-ai 路由块贴回
`config.routes` 即回到静态（静态优先于动态，两者并存时静态生效）。
