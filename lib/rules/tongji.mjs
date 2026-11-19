/**
 * tongji（同济大学 agi.tongji.edu.cn）规则包。
 *
 * ## 这个包要解决的两条硬规则（用户明确要求）
 *
 * ### 规则一：必须在同济内网才能运行
 *
 * 这一条**不是客户端自检，而是上游按源地址判定的**。实测（2026-11-19，同一把有效 key）：
 *
 * | 强制解析到 | 结果 |
 * | --- | --- |
 * | `10.67.0.251`（校内 DNS 解析出的内网地址） | `HTTP 200` 正常返回 |
 * | `202.120.188.251`（公网 DoH 解析出的地址） | `HTTP 403 {"error":{"code":403,"message":"当前网络环境不支持"}}` |
 *
 * 所以本地做任何「假装在内网」的伪装都没意义——上游看的是 TCP 源地址。本包能做的是：
 * **把这条 403 认出来，翻译成用户看得懂的、可操作的错误**，而不是把它混进通用的
 * 502/上游错误里让人猜。具体做法见 `translateBusinessError` + `statusForError`：
 * 403 且文案命中「当前网络环境不支持」时，返回 503 + 明确提示「请先连接 MotionPro VPN」。
 *
 * 注意区分三种 403 文案（实测都可复现）：
 *   - `当前网络环境不支持`        → 网络不通（外网）→ **503，提示连 VPN**
 *   - `API密钥不能为空`           → 没带 key        → **401，提示配 key**
 *   - `API密钥不存在`             → key 无效        → **401，提示换 key**
 * 三者混成一个「403 无权限」会让排障彻底失去方向，所以必须分开。
 *
 * ### 规则二：并发数有限
 *
 * 实测套餐上限是 **3 个并发请求**，超出的直接 `HTTP 429`：
 * `{"error":{"code":429,"message":"并发请求数已达套餐上限（3 个），请等待正在进行的请求完成后重试"}}`
 *
 * 与码道（codearts）不同，同济这里是**真的按在飞请求数**判定的：短请求（0.4s）打 30
 * 并发只挂 9 个，长请求（47s）打 12 并发挂 3 个——说明槽位在响应结束时释放，不是固定
 * TTL 占位。所以本包**不使用** SessionGate 的 60s TTL 语义（那会把 3 个槽位锁死一分钟），
 * 而是：
 *   1. 在路由配置里设 `concurrency: 3`（由 proxy 的闸门做真正的排队）；
 *   2. 把 `sessionHoldMs` 设成很短（本包建议 2000ms），因为槽位实际是随请求释放的；
 *   3. 万一仍然撞 429（比如别的设备/进程也在用同一个账号），用 `isConcurrencyError`
 *      认出来，走「并发专用退避」而不是通用指数退避。
 *
 * ## 思考内容字段：两套上游混用
 *
 * 实测同一个网关下的模型分两组：
 *   - 用 `reasoning`：DeepSeek-V4.1-Flash、GLM-5.3、GLM-5.3-Flash、MiniMax-M3.1-Flash、
 *     Kimi-K3.1-Pro、MiMo-V2.6-Pro、MiMo-V2.6-Flash
 *   - 用 `reasoning_content`：Qwen3.8-Flash-Next、Qwen3.8-27B
 *
 * 而 DSH 侧只认 `reasoning_content`（proxy.mjs 的 aggregateSse 只读这个键）。所以
 * `normalizeDelta` 必须把 `reasoning` 镜像到 `reasoning_content`，否则前七个模型的思考
 * 过程在 DSH 界面上会**整段消失**（不是报错，是静默丢内容——最难受的那种 bug）。
 *
 * ## 多模态：按模型区分，不能一刀切
 *
 * 实测只有 `GLM-5.3` 不是多模态（`"GLM-5.3-NVFP4 is not a multimodal model"`，HTTP 400），
 * 其余模型都接受 `image_url`。plantext（`GLM-5.3-Flash`）反而是支持图片的。
 * 所以 `supportsImages` 按模型 id 判，默认 `true`、黑名单 `false`。
 *
 * 误判方向很重要：把不支持图的模型判成支持 → 上游 400 且重试无用；把支持图的判成不支持
 * → 只是少看一张图。所以黑名单里的必须先剥图。
 *
 * @module dsh-api-rules/rules/tongji
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { normalizeToolParameters } from './flat-parameters.mjs'
import { TongjiVpn, findOpenconnect, probeTunnel, readConfig } from '../tongji-vpn.mjs'

/** 套餐并发上限（实测 429 文案里的数字）。 */
export const TONGJI_CONCURRENCY = 3

/**
 * 上游 403「当前网络环境不支持」的判定。
 *
 * 文案是中文，且可能被网关包一层引号/转义，所以用包含匹配而不是全等。
 */
const NETWORK_BLOCKED_RE = /当前网络环境不支持|网络环境不支持/

/** 上游 429「并发请求数已达套餐上限」的判定。 */
const CONCURRENCY_RE = /并发请求数已达|并发.*上限/

/** 密钥问题（空 / 不存在），用来跟「网络不通」区分开。 */
const KEY_MISSING_RE = /API密钥不能为空|密钥不能为空/
const KEY_INVALID_RE = /API密钥不存在|密钥不存在|无效的?\s*API\s*密钥/i

/**
 * 非多模态模型黑名单。
 *
 * `GLM-5.3` 实测返回 `GLM-5.3-NVFP4 is not a multimodal model`（HTTP 400）。
 * 注意 `GLM-5.3-Flash` **不**在黑名单里——它实测接受图片。
 */
const TEXT_ONLY_MODELS = new Set(['GLM-5.3'])

/**
 * 只做文本/向量、不走 chat/completions 的模型。
 *
 * 这些模型在 `/v1/models` 里列出，但打 `/chat/completions` 会 404。规则包本身不需要
 * 拦截（调用方自己会选模型），这里只作为**文档性常量**导出，供宿主侧做模型清单过滤。
 */
export const NON_CHAT_MODELS = new Set([
  'MiniMax-H3-Image',
  'Whisper',
  'Qwen3-Embedding',
  'Qwen3-Reranker',
])

/** 从请求体里抽掉所有图片段，换成文字占位。 */
const IMAGE_PLACEHOLDER = '[图片已省略：当前模型不支持图片输入]'

/**
 * 把 content 数组里的图片段改成文字段。
 * @returns {number} 剥掉的图片数量
 */
function stripImagesFromContent(content) {
  let removed = 0
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = content[index]
    if (part === null || typeof part !== 'object') continue
    if (part.type === 'image_url' || part.type === 'image' || part.image_url !== undefined) {
      content[index] = { type: 'text', text: IMAGE_PLACEHOLDER }
      removed += 1
      continue
    }
    // 嵌套 tool_result 里也可能带图。
    if (Array.isArray(part.content)) {
      removed += stripImagesFromContent(part.content)
    }
  }
  return removed
}

/**
 * 遍历 messages，剥掉图片。文本里内联的 `[image]` 标记也一并替换——某些客户端会把
 * 图片序列化成这个字符串，上游同样会 400。
 * @returns {number} 剥掉的总数
 */
function stripImagesFromMessages(messages) {
  let removed = 0
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue
    const content = message.content
    if (Array.isArray(content)) {
      removed += stripImagesFromContent(content)
    } else if (typeof content === 'string' && content.includes('[image]')) {
      message.content = content.split('[image]').join(IMAGE_PLACEHOLDER)
      removed += 1
    }
  }
  return removed
}

/** 把一段上游错误文本解析成结构化的错误（能解析 JSON 就取 message，不能就原样）。 */
function parseErrorText(text) {
  if (typeof text !== 'string') return { message: '' }
  const trimmed = text.trim()
  if (trimmed === '') return { message: '' }
  try {
    const parsed = JSON.parse(trimmed)
    const error = parsed?.error
    if (error !== null && typeof error === 'object') {
      return { message: String(error.message ?? ''), code: error.code, type: error.type }
    }
    if (typeof error === 'string') return { message: error }
    return { message: String(parsed?.message ?? trimmed) }
  } catch {
    return { message: trimmed }
  }
}

/** 上游对非 chat 模型打 /chat/completions 时的原文：`{"detail":"Not Found"}`。 */
const NOT_FOUND_RE = /Not Found|404/

/**
 * 判定一段错误文本属于哪一类。
 *
 * `model` 是可选的：非 chat 模型（图像/语音/向量/重排）的 404 只有结合模型名才能
 * 说清楚——上游只回一句 `{"detail":"Not Found"}`，脱离模型名这句话毫无信息量。
 */
function classifyError(text, model) {
  const { message, code } = parseErrorText(text)
  const haystack = message === '' ? String(text ?? '') : message
  if (NETWORK_BLOCKED_RE.test(haystack)) return { kind: 'network_blocked', message: haystack, code }
  if (CONCURRENCY_RE.test(haystack)) return { kind: 'concurrency', message: haystack, code }
  if (KEY_MISSING_RE.test(haystack)) return { kind: 'key_missing', message: haystack, code }
  if (KEY_INVALID_RE.test(haystack)) return { kind: 'key_invalid', message: haystack, code }
  // 非 chat 模型必须排在最后：先让真正的 key/网络错误优先命中，避免把
  // 「非 chat 模型 + 网络不通」这类组合误判成模型问题。
  if (typeof model === 'string' && NON_CHAT_MODELS.has(model) && NOT_FOUND_RE.test(haystack)) {
    return { kind: 'non_chat_model', message: haystack, code }
  }
  return { kind: 'other', message: haystack, code }
}

/** 各类错误的用户可读提示。 */
const HINTS = {
  network_blocked:
    '同济 API 只接受校内网络的请求（上游按源地址判定）。请先连接 MotionPro VPN'
    + '（网关 vpn.tongji.cn），或在同济校园网内使用；连接后重试即可。',
  key_missing: '没有携带 API key。请在插件设置里为 tongji 路由填写 TONGJI_API_KEY。',
  key_invalid: 'API key 无效或已被回收。请在插件设置里更新 TONGJI_API_KEY。',
  concurrency:
    '同济网关的并发名额已满（套餐上限 ' + TONGJI_CONCURRENCY + ' 个）。'
    + '本插件已在本地按配额排队，若仍看到这条，通常是同一个账号还在别处（如浏览器）使用。',
  non_chat_model:
    '这个模型不提供 /chat/completions 对话接口。同济平台为不同类型分别开了接口：'
    + '向量 /v1/embeddings、重排 /v1/rerank、图像生成 /v1/images/generations（或 /svc/<路由>）、'
    + '语音 /v1/audio/speech｜transcriptions。请在模型选择器里改用对话模型'
    + '（如 DeepSeek-V4.1-Flash、GLM-5.3），或按上述接口直接调用。',
}

/**
 * 把分类结果变成 OpenAI 风格的错误对象。
 * @param {string} kind
 * @param {string} detail
 */
/**
 * 把当前 VPN 状态翻译成「下一步该做什么」。
 *
 * 不这么做的话，用户在外网看到的永远是同一句「请先连接 MotionPro VPN」，
 * 而他可能已经填了密码、只是密码错了；也可能压根没填。这两种情况的下一步
 * 完全不同（改密码 vs 打开文件填密码），必须分开说。
 */
function vpnAdvice() {
  const result = vpnState.lastResult
  if (vpnState.state === 'up') return ''
  if (result === undefined) {
    // 还没尝试过（例如请求在探测前就撞了 403），给最通用的指引。
    return '插件可以自动拨号：在 tongji-vpn.env 里填好 password 后重试即可。'
  }
  if (result.ok === true) return ''
  const reason = String(result.reason ?? '')
  if (reason.includes('missing_password')) {
    return '自动拨号已就绪，但 tongji-vpn.env 里的 password 还空着——填上学工号对应的统一身份认证密码即可。'
  }
  if (reason.includes('missing_username')) {
    return '自动拨号已就绪，但 tongji-vpn.env 里的 username 还空着——填上学工号即可。'
  }
  if (reason.includes('openconnect_missing')) {
    return '自动拨号需要 openconnect，本机没找到——装好后重试（choco install openconnect）。'
  }
  if (reason === 'bad_credential') {
    return '自动拨号失败：网关判定用户名或密码不对（_AN_msgID=215）——检查 tongji-vpn.env 里的 password。'
  }
  if (reason.startsWith('tunnel_not_ready')) {
    return '自动拨号已启动但内网地址一直连不通——看 %TEMP%\\tongji-vpn\\openconnect.log（也可能是在系统弹窗里点了「否」）。'
  }
  if (reason === 'openconnect_exited') {
    return 'openconnect 启动后立刻退出——看 %TEMP%\\tongji-vpn\\openconnect.log 里的原因。'
  }
  if (reason === 'exception') {
    return '自动拨号抛出异常：' + String(result.detail ?? '') + '。可先用 tongji-vpn-cli.mjs status 排查。'
  }
  return '自动拨号未成功：' + reason + '。'
}

function makeError(kind, detail) {
  let hint = HINTS[kind]
  if (kind === 'network_blocked') {
    const advice = vpnAdvice()
    if (advice !== '') hint = hint + ' ' + advice
  }
  return {
    error: {
      message: detail === '' ? hint : hint + '（上游原文：' + detail + '）',
      type: kind === 'concurrency' ? 'rate_limit_error' : 'upstream_error',
      code: kind,
    },
  }
}

/**
 * 进程级 VPN 状态。
 *
 * 放模块级而不是放 rules 对象里：rules 是纯对象，DSH 会把它当配置读；
 * 可变状态留在模块作用域更安全，也不会被 pack 的序列化/深拷贝弄丢。
 */
const vpnState = { state: 'down', attempting: false, lastResult: undefined }

/** 内网可达性探测缓存，避免每个请求都做一次 TCP 连接。 */
const TUNNEL_CACHE_MS = 30_000
const tunnelCache = { ok: false, at: 0 }

/**
 * 内网直连探测缓存：真在同济内网时，物理网卡上会有一条
 *   10.67.0.0/16 -> On-link -> <物理接口IP>
 * 的路由（DHCP 下发的 classless route 或静态路由）。
 * 这时根本不需要 openconnect VPN，请求直接走内网就行。
 * 外网/隧道在线时，这条路由的网关是 111.187.x.x（隧道自身 IP）或干脆没有。
 */
const INTRANET_ROUTE_CACHE_MS = 60_000
const intranetCache = { onLink: false, at: 0 }

/** 读系统路由表，判断 10.67.0.0/16 是否物理网卡直连（On-link）。 */
export function isIntranetOnLink() {
  const now = Date.now()
  if (now - intranetCache.at < INTRANET_ROUTE_CACHE_MS) return intranetCache.onLink
  let onLink = false
  try {
    const out = execFileSync('netsh', ['interface', 'ipv4', 'show', 'route'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // 找 10.67.0.0/16 那一行，看接口网关是不是 On-link
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('10.67.0.0/16')) continue
      // netsh 输出按空格/斜杠分隔，字段顺序不固定；只认「该行同时含 On-link」
      if (/On-link/i.test(line)) {
        onLink = true
        break
      }
    }
  } catch {
    // netsh 不可用 / 权限不足 / 超时：按「不在内网」处理，走 VPN 拨号路径
    onLink = false
  }
  intranetCache.onLink = onLink
  intranetCache.at = now
  return onLink
}

/**
 * 隧道空闲超时：连续这么久没有任何同济请求，就主动断开。
 *
 * 懒加载语义：throttle 钩子已经「请求前按需拨号」，开机不会主动起 openconnect，
 * 所以这里只补「用完自动关」这一半，把常驻的 openconnect + 10.67.0.0/16 分流路由 +
 * hosts 托管块都撤掉，省资源也省 UAC 弹窗。
 */
const VPN_IDLE_DISCONNECT_MS = 5 * 60 * 1000
let vpnIdleTimer

/** 重置空闲倒计时；只在 vpnState.state === 'up' 时挂 timer。 */
function armVpnIdleTimer(configPath, config) {
  if (vpnIdleTimer !== undefined) clearTimeout(vpnIdleTimer)
  if (vpnState.state !== 'up') return
  vpnIdleTimer = setTimeout(async () => {
    vpnIdleTimer = undefined
    if (vpnState.state !== 'up') return
    const vpn = getVpn(configPath, config)
    try {
      await vpn.stop('idle timeout')
    } catch {
      // stop 失败也不打断请求路径；下次 ensureUp 会再探一次
    }
    vpnState.state = 'down'
    // 清探测缓存：否则 30 秒内的下一个同济请求会命中 tunnelCache.ok=true 走短路，
    // 结果撞到「当前网络环境不支持」，得再等缓存过期才能触发重拨。
    tunnelCache.ok = false
    tunnelCache.at = 0
    vpnState.lastResult = { ok: true, state: 'down', via: 'idle' }
  }, VPN_IDLE_DISCONNECT_MS)
  // Node timer 别挡进程退出
  if (typeof vpnIdleTimer.unref === 'function') vpnIdleTimer.unref()
}
let vpnInstance

/** 找 vpn 配置文件：环境变量优先，其次插件根目录下的 tongji-vpn.env。 */
function resolveVpnConfigPath() {
  const fromEnv = process.env.TONGJI_VPN_CONFIG?.trim()
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  // 插件根 = lib/rules/tongji.mjs 上两级。
  // 必须用 fileURLToPath 而不是 new URL().pathname：后者把空格等字符留成 %20，
  // 且 Windows 上会多出前导斜杠，路径拼出来存在但 existsSync 认不出。
  const pluginRoot = fileURLToPath(new URL('../../', import.meta.url))
  const candidates = [
    join(pluginRoot, 'tongji-vpn.env'),
    join(process.cwd(), 'tongji-vpn.env'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

/** 复用同一个 TongjiVpn 实例，避免每次请求都新建。 */
function getVpn(configPath, config) {
  if (vpnInstance !== undefined) return vpnInstance
  vpnInstance = new TongjiVpn({
    ...config,
    configPath,
    readyTimeoutMs: 90_000,
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  })
  return vpnInstance
}

/** 供 /healthz 与诊断接口读的 VPN 状态快照。 */
export function tongjiVpnStatus() {
  return {
    state: vpnState.state,
    attempting: vpnState.attempting,
    lastResult: vpnState.lastResult,
    configPath: resolveVpnConfigPath(),
  }
}

/**
 * 第三方插件借用：让 dsh-tongji-aigc 等邻居插件也能「请求前按需拨号 + 续命 idle timer」，
 * 但不另起一份 TongjiVpn 状态——直接复用本模块的 vpnInstance / vpnState / vpnIdleTimer /
 * tunnelCache，Node ESM 缓存按真实路径去重，两个插件拿到的是同一个 TongjiVpn 实例，
 * 天然不会并发拨号 / 不会抢同一个 openconnect 进程 / 不会互相覆盖 hosts。
 *
 * AIGC 端用法：在发请求前 `await ensureTunnelForThirdParty({ signal })`，
 * 通了就继续、没通也不阻塞请求（返回 ok:false + reason，让上层决定要不要报错）。
 *
 * 返回值：{ ok, via }  via ∈ 'intranet-direct' | 'tunnel-alive' | 'probe-ok' | 'dial'
 *          或 { ok:false, reason } —— reason ∈ 'aborted' | 'dial-in-progress'
 *                                    | 'config-missing' | 'dial-failed' | 'exception'
 */
export async function ensureTunnelForThirdParty({ signal } = {}) {
  if (signal?.aborted === true) return { ok: false, reason: 'aborted' }

  // 1. 内网直连：撤掉 VPN（如果有），直接让请求走物理网卡。
  //    与 throttle 里的分支保持一致，避免「一边在内网直连、一边把 VPN 续着」的诡异状态。
  if (isIntranetOnLink()) {
    if (vpnState.state === 'up') {
      const vpn = getVpn(resolveVpnConfigPath(), readConfig(resolveVpnConfigPath()))
      try { await vpn.stop('switched to intranet direct') } catch { /* 忽略 */ }
      vpnState.state = 'down'
      vpnState.lastResult = { ok: true, state: 'down', via: 'intranet-direct' }
      tunnelCache.ok = false
      tunnelCache.at = 0
    }
    return { ok: true, via: 'intranet-direct' }
  }

  // 2. VPN 已在线：续命 idle timer，直接放行。
  if (vpnState.state === 'up') {
    armVpnIdleTimer(resolveVpnConfigPath(), readConfig(resolveVpnConfigPath()))
    return { ok: true, via: 'tunnel-alive' }
  }

  // 3. VPN 没在线但探测通了（在内网或运营商 NAT 段已能直连）：刷新探测缓存，放行。
  const now = Date.now()
  if (tunnelCache.ok === true && now - tunnelCache.at < TUNNEL_CACHE_MS) {
    return { ok: true, via: 'probe-ok' }
  }
  tunnelCache.ok = false
  const tunnel = await probeTunnel({ timeoutMs: 1500 })
  if (tunnel.ok) {
    tunnelCache.ok = true
    tunnelCache.at = Date.now()
    return { ok: true, via: 'probe-ok' }
  }

  // 4. 已经有拨号在进行：别再起一次 UAC，直接放行让请求去试（大概率撞上正在拨的隧道）。
  if (vpnState.attempting === true) return { ok: false, reason: 'dial-in-progress' }

  // 5. 配置不全：让上层报「缺配置」而不是「网络不通」。
  const configPath = resolveVpnConfigPath()
  const config = readConfig(configPath)
  const problems = []
  if (findOpenconnect() === undefined) problems.push('openconnect_missing')
  if (typeof config.username !== 'string' || config.username.length === 0) problems.push('missing_username')
  if (typeof config.password !== 'string' || config.password.length === 0) problems.push('missing_password')
  if (problems.length > 0) {
    vpnState.lastResult = { ok: false, reason: problems.join(','), configPath }
    return { ok: false, reason: 'config-missing', detail: problems.join(',') }
  }

  // 6. 真的要拨了：弹一次 UAC，起 openconnect。
  vpnState.attempting = true
  try {
    const vpn = getVpn(configPath, config)
    const result = await vpn.ensureUp()
    vpnState.state = result.ok ? 'up' : 'failed'
    vpnState.lastResult = result
    if (result.ok) armVpnIdleTimer(configPath, config)
    return result.ok ? { ok: true, via: 'dial' } : { ok: false, reason: 'dial-failed', detail: result.reason }
  } catch (error) {
    vpnState.state = 'failed'
    vpnState.lastResult = { ok: false, reason: 'exception', detail: String(error?.message ?? error) }
    return { ok: false, reason: 'exception', detail: String(error?.message ?? error) }
  } finally {
    vpnState.attempting = false
  }
}

export const tongjiRules = {
  name: 'tongji',

  /** 并发上限 3：由会话闸门按此值排队。 */
  concurrency: TONGJI_CONCURRENCY,

  /**
   * 请求归一。
   *
   * 除了剥图（仅对黑名单模型），还要做两件事：
   *   1. `developer` → `system`：OpenAI 较新的角色名，vLLM 系上游不一定认。
   *   2. 工具参数对象壳归一：复用 flat-parameters，跟其他包保持一致。
   *
   * `reasoning_effort` 原样透传：实测 `reasoning_effort:"high"` 与
   * `reasoning:{effort:"low"}` 两种形状都被接受，无需翻译。
   */
  normalizeRequest({ body = {}, model } = {}) {
    const notes = []

    // 剥图：只有明确不支持图片的模型才剥。
    const textOnly = TEXT_ONLY_MODELS.has(model)
    if (textOnly) {
      const messages = Array.isArray(body.messages) ? body.messages : []
      const removed = stripImagesFromMessages(messages)
      if (removed > 0) {
        notes.push('已剥离 ' + removed + ' 张图片（' + model + ' 不是多模态模型）')
      }
    }

    // 角色归一。
    const messages = Array.isArray(body.messages) ? body.messages : []
    for (const message of messages) {
      if (message?.role === 'developer') message.role = 'system'
    }

    normalizeToolParameters(body['tools'])

    return { body, notes }
  },

  /**
   * 多模态能力：黑名单里的模型之外都支持。
   *
   * 注意 proxy 并不直接调用这个钩子（它是给宿主侧的模型清单与前端提示用的），
   * 但保持与 normalizeRequest 的剥图判定一致，避免两处判断打架。
   */
  supportsImages(model) {
    if (typeof model === 'string' && TEXT_ONLY_MODELS.has(model)) return false
    return true
  },

  /**
   * 判断是不是并发上限。
   *
   * proxy 只传 `text` 一个参数（见 proxy.mjs 的 `pack.isConcurrencyError(lastText)`），
   * 所以这里不能声明 `{ text }` 结构——必须收裸字符串。
   */
  isConcurrencyError(text) {
    return classifyError(text).kind === 'concurrency'
  },

  /** 哪些状态码值得重试。403 一律不重试（网络不通/密钥问题重试不会变好）。 */
  isRetryable({ status, text }) {
    if (status === 429) return true
    if (status === 408) return true
    if (status >= 500 && status <= 599) return true
    if (status === 403) {
      // 唯一的例外：如果 403 其实是「当前网络环境不支持」，重试也没用
      //（除非用户此刻正在连 VPN），所以仍然判不可重试，靠错误文案引导用户。
      const kind = classifyError(text).kind
      return kind === 'other'
    }
    return false
  },

  /**
   * 退避策略。
   *
   * 并发上限与网关抖动分开走：并发上限的槽位是**随请求结束释放**的，所以等 2~4 秒
   * 就够，不需要码道那种 25/40 秒的量级。
   */
  backoffMs({ attempt, concurrency, retryAfterMs }) {
    // 上游明确给了 Retry-After 就照它等（再加 100ms 余量，避免掐点重试又撞上）。
    // 这一条优先于所有估算：上游知道自己什么时候有空位，我们的猜测只是兜底。
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return retryAfterMs + 100
    }
    if (concurrency) {
      // 槽位随请求释放：短等即可，但要留出别的请求收尾的余量。
      return Math.min(2_000 + 1_000 * attempt, 8_000)
    }
    return Math.min(1_000 * 2 ** attempt, 15_000)
  },

  /** 总重试预算：并发类要给足（可能有 3 个名额都在别人手里），普通错误 30s 足够。 */
  retryBudgetMs(concurrency) {
    if (concurrency) return 60_000
    return 30_000
  },

  /**
   * 自动拨号：只在「确认是网络不通」时触发，且同一时刻只拨一次。
   *
   * 为什么放在 throttle 而不是别处：
   *   throttle 是 proxy 里唯一「请求发出前、且能 await 异步」的钩子。放在这里可以做到
   *   「先拨号再发请求」，用户无感；放 normalizeRequest（同步）做不了异步提权，
   *   放 backoffMs（同步）也不行。
   *
   * 触发条件写死为 network_blocked 的**预探测**，而不是等撞 403 再拨：
   *   - 先 TCP 探测内网地址（probeTunnel），能连上就直接返回，零额外开销；
   *   - 连不上才去读配置、起 openconnect（会弹一次 UAC）。
   *   这样在校园网内（本来就通）绝不会多弹一次 UAC。
   *
   * 失败一律不阻塞请求：拨号失败就把话说明白（缺密码/密码错/openconnect 没装），
   * 让请求继续走，由后续 403 翻译成 503 的可读提示——用户至少能看懂该改什么。
   */
  async throttle({ signal }) {
    if (signal?.aborted === true) return { waitMs: 0, aborted: true }

    // 分类判断：真在同济内网（物理网卡有 10.67.0.0/16 On-link 路由）时，
    // 走内网直连就行，不拨 VPN、不挂 idle timer。这样：
    //   - 内网用户：零开销、无 UAC、无 openconnect 常驻
    //   - 外网用户（含「在校内但走运营商 NAT 段」的诡异环境）：仍走 VPN 拨号 + idle 断开
    if (isIntranetOnLink()) {
      // 如果之前起过 VPN，顺手关掉（省资源 + 撤掉 hosts/路由残留）
      if (vpnState.state === 'up') {
        const vpn = getVpn(resolveVpnConfigPath(), readConfig(resolveVpnConfigPath()))
        try { await vpn.stop('switched to intranet direct') } catch { /* 忽略 */ }
        vpnState.state = 'down'
        vpnState.lastResult = { ok: true, state: 'down', via: 'intranet-direct' }
        tunnelCache.ok = false
        tunnelCache.at = 0
      }
      return { waitMs: 0 }
    }

    if (vpnState.state === 'up') {
      // 请求到来即续命
      armVpnIdleTimer(resolveVpnConfigPath(), readConfig(resolveVpnConfigPath()))
      return { waitMs: 0 }
    }

    // 便宜的先做：TCP 探测。通了说明在内网，什么都不用做。
    //
    // 结果缓存 30s：这个探测在「已在校内」时是本函数唯一的开销，
    // 每次请求都重新连一遍没有意义（内网地址不会在 30s 内忽通忽断）。
    // 断开校园网后最多晚 30s 才发现，对拨号场景完全够用。
    const now = Date.now()
    if (tunnelCache.ok === true && now - tunnelCache.at < TUNNEL_CACHE_MS) {
      return { waitMs: 0 }
    }
    tunnelCache.ok = false
    const tunnel = await probeTunnel({ timeoutMs: 1500 })
    if (tunnel.ok) {
      tunnelCache.ok = true
      tunnelCache.at = Date.now()
      return { waitMs: 0 }
    }

    if (vpnState.attempting === true) {
      // 已有一次拨号在进行中，别重复弹 UAC
      return { waitMs: 0 }
    }

    const configPath = resolveVpnConfigPath()
    const config = readConfig(configPath)
    const problems = []
    if (findOpenconnect() === undefined) problems.push('openconnect_missing')
    if (typeof config.username !== 'string' || config.username.length === 0) {
      problems.push('missing_username')
    }
    if (typeof config.password !== 'string' || config.password.length === 0) {
      problems.push('missing_password')
    }
    if (problems.length > 0) {
      // 没配好就别硬拨，把缺什么记在状态里，供 /healthz 与前端展示
      vpnState.lastResult = { ok: false, reason: problems.join(','), configPath }
      return { waitMs: 0 }
    }

    vpnState.attempting = true
    try {
      const vpn = getVpn(configPath, config)
      const result = await vpn.ensureUp()
      vpnState.state = result.ok ? 'up' : 'failed'
      vpnState.lastResult = result
      if (result.ok) armVpnIdleTimer(configPath, config)
    } catch (error) {
      vpnState.state = 'failed'
      vpnState.lastResult = { ok: false, reason: 'exception', detail: String(error?.message ?? error) }
    } finally {
      vpnState.attempting = false
    }
    return { waitMs: 0 }
  },

  /** 撞并发上限后的全局冷却：让同时在飞的请求一起等，避免扎堆重撞。 */
  cooldownMs({ retryAfterMs } = {}) {
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return retryAfterMs + 100
    }
    return 2_000
  },

  maxAttempts() {
    return 5
  },

  /** 504/网络类错误值得多试；4xx（除 429）不重试，由 isRetryable 把关。 */
  isRetryableStatus(status) {
    return status === 429 || status === 408 || (status >= 500 && status <= 599)
  },

  /**
   * HTTP 200 里夹带的业务错误翻译。
   *
   * 同济网关的错误有两种到达方式：一种是 4xx 状态码直接带 body（走 postWithRetry 的
   * 非 2xx 分支），另一种是 200 + `{"error":{...}}`（走 collectJson 的
   * translateBusinessError 分支）。两种都要认。
   */
  translateBusinessError(chunk, ctx) {
    const model = ctx?.model
    // 非 chat 模型（图像/向量/重排/语音）打对话接口时，上游返回的是
    // `{"detail":"Not Found"}` —— 没有 `error` 字段，只有一句 detail。
    // 若不在这里接住，用户只会看到一句毫无信息量的 404。
    if (chunk?.error === undefined && typeof chunk?.detail === 'string') {
      const detail = chunk.detail
      const kind = classifyError(detail, model).kind
      return kind === 'non_chat_model' ? makeError(kind, detail) : undefined
    }
    // 鉴权类错误是**第三种形状**：顶层直接是 `{"code":403,"message":"API密钥不存在"}`，
    // 既没有 `error` 也没有 `detail`。实测三种 403 的形状并不统一：
    //   外网     `{"error":{"code":403,"message":"当前网络环境不支持"}}`
    //   错密钥   `{"code":403,"message":"API密钥不存在"}`        ← 本分支
    //   空密钥   `{"code":403,"message":"API密钥不能为空"}`      ← 本分支
    // 只认前一种的话，「密钥错了」会被原样抛成 upstream 403，用户看不出要改密钥。
    if (chunk?.error === undefined && chunk?.detail === undefined
        && typeof chunk?.code === 'number' && typeof chunk?.message === 'string') {
      const kind = classifyError(chunk.message, model).kind
      // 只接管我们认得出的分类；其余（如 upstream 自己的 5xx 包装）保持原样，
      // 免得把不该改写的错误也吞进来。
      return kind === 'other' ? undefined : makeError(kind, chunk.message)
    }
    const error = chunk?.error
    if (error === null || typeof error !== 'object') return undefined
    const message = String(error.message ?? '')
    const kind = classifyError(message, model).kind
    if (kind === 'other') {
      // 不是我们认识的分类，交给通用处理：仍然包成标准错误，但保留原文。
      return {
        error: {
          message: message === '' ? 'upstream error' : message,
          type: 'upstream_error',
          code: error.code,
        },
      }
    }
    return makeError(kind, message)
  },

  /** 业务错误对应的 HTTP 状态码。 */
  statusForError(chunk, ctx) {
    const model = ctx?.model
    if (chunk?.error === undefined && typeof chunk?.detail === 'string') {
      const kind = classifyError(chunk.detail, model).kind
      return kind === 'non_chat_model' ? 400 : undefined
    }
    if (chunk?.error === undefined && chunk?.detail === undefined
        && typeof chunk?.code === 'number' && typeof chunk?.message === 'string') {
      const kind = classifyError(chunk.message, model).kind
      if (kind === 'other') return undefined
      return kind === 'network_blocked' ? 503 : (kind === 'key_missing' || kind === 'key_invalid' ? 401 : (kind === 'concurrency' ? 429 : 502))
    }
    const error = chunk?.error
    if (error === null || typeof error !== 'object') return undefined
    const kind = classifyError(String(error.message ?? ''), model).kind
    switch (kind) {
      case 'non_chat_model':
        // 模型选错了接口，是「请求有误」而不是网关故障：400 才能让客户端
        // 立刻知道要换模型/换接口，而不是盲目重试。
        return 400
      case 'network_blocked':
        // 网络不通是「服务不可用」而不是「无权限」：503 能让客户端知道可以稍后重试。
        return 503
      case 'key_missing':
      case 'key_invalid':
        return 401
      case 'concurrency':
        return 429
      default:
        return 502
    }
  },

  /**
   * 流式增量归一：把 `reasoning` 镜像到 `reasoning_content`。
   *
   * DSH 侧只读 `reasoning_content`（proxy.mjs:939 与 aggregateSse:1333/1340），而同济
   * 有七个模型只发 `reasoning`。不镜像的话这些模型的思考过程会静默消失。
   *
   * 反向也要处理：`content` 为 null 时补空串，避免下游 `content.length` 崩。
   */
  normalizeDelta(delta) {
    if (delta === null || typeof delta !== 'object') return
    if (delta['content'] === null) delta['content'] = ''
    if (typeof delta['reasoning'] === 'string' && typeof delta['reasoning_content'] !== 'string') {
      delta['reasoning_content'] = delta['reasoning']
    }
    // Qwen 系走 `reasoning_content` 原生键，这里补一个 `reasoning` 镜像，
    // 让两种上游在日志/前端上表现一致（DSH 不读它，但排障时有用）。
    if (typeof delta['reasoning_content'] === 'string' && typeof delta['reasoning'] !== 'string') {
      delta['reasoning'] = delta['reasoning_content']
    }
  },

  /** 上游漏发 finish_reason 时补 stop，避免客户端一直等。 */
  ensureFinishReason(model, meta) {
    if (meta == null) return true
    if (meta.sawFinishReason === true) return true
    // 只发过思考、没有正文也没有工具调用：不补 stop（交给空流重试逻辑处理）。
    if (meta.sentAnything === true && meta.sawContent !== true && meta.sawToolCall !== true) {
      return false
    }
    return true
  },

  /**
   * 断流收尾帧：只在「真的在思考阶段被掐断」时给错误帧。
   *
   * meta 是 pipeStream 给的「这轮流发过什么」快照。框架 finalizeNormalEnd
   * 在**正常结束（已收到 finish_reason）**时也会调用本钩子，所以必须先判
   * sawFinishReason —— 否则每个正常流式请求末尾都会被追加一条假错误帧
   * （2026-11-19 实测 bug：正常回答带正文+finish_reason，末尾仍吐出
   * stream_aborted，误导用户去查 VPN）。
   *
   * 判定与 cline/minimax/qoder 一致：只发过思考、没正文没工具调用、且没有
   * finish_reason，才是思考阶段断流。
   */
  streamAbortFrame(meta) {
    if (meta === null || typeof meta !== 'object') return undefined
    if (meta.sawFinishReason === true) return undefined
    if (meta.sentAnything !== true) return undefined
    if (meta.sawContent !== true && meta.sawToolCall !== true) {
      return {
        error: {
          message: '上游在思考阶段中断（未产生正文），请重试。',
          type: 'upstream_error',
          code: 'stream_aborted',
        },
      }
    }
    return undefined
  },

  /** `other` 之类非标准 finish_reason 一律当 stop。 */
  finishReason(value) {
    if (value === null || value === undefined || value === 'other') return 'stop'
    return value
  },
}

export default tongjiRules
