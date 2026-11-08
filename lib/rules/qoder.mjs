/**
 * qoder2api-hub（https://github.com/shuishuipingan/qoder2api-hub）规则包。
 *
 * qoder2api-hub 是 Qoder（qoder.com.cn / qoder.com）官方桌面客户端的
 * OpenAI/Anthropic 兼容网关：它维护一个多账号池，对外暴露 `/v1/chat/completions`、
 * `/v1/messages`、`/v1/models`，模型 id 用目录里的 display_name（如 `Qwen3.8-Max`）。
 * 源码内嵌在本插件的 `vendor/qoder2api-hub/`（纯标准库 Python，无第三方依赖），
 * 由路由上的 `launch` 在插件启动时自动拉起（见 cordis.patch.yml 的 qoder2api-hub 路由）。
 *
 * ## 根因一（2026-11-08，网络层）：国际版上游从国内直连断联
 *
 * qoder 模型「经常失败」的根因**不是**规则层，而是网关到**国际版（intl）上游**的网络路径。
 * qoder2api-hub 有两套账号池与两套上游：
 *   - `cn`（国内版）：gateway = `gateway.qoder.com.cn`，本机实测建连 0.02s，正常；
 *   - `intl`（国际版）：gateway = `api3.qoder.sh`（备 `api2`/`api1`、openapi.qoder.sh），
 *     从国内直连常年 10s+ 建连后超时——实测 `POST /v1/chat/completions` 40s 无响应
 *     （HTTP=000；TCP/TLS 层能通，是出口 IP 被卡，真正的 POST 发不出去）。
 *
 * 用户明确要求「我要的是国际版能用」，所以**不能**绕到 cn 了事。定稿修复 = 让网关的
 * intl 上游流量走本机 xray 混合代理 127.0.0.1:10808（实测经代理 0.6s 即达），cn 域名用
 * NO_PROXY 旁路保持直连（0.02s，不受代理影响）；默认区域恢复 `intl`。四变量持久化在
 * cordis.patch.yml 的 qoder2api-hub `launch.env`（QD_PROXY_DEFAULT_REALM / HTTPS_PROXY /
 * HTTP_PROXY / NO_PROXY），网关主聊天路径是裸 `urllib.request.urlopen`
 * （qoder_proxy.py:8894），进程启动时设好 env 即生效；cn 旁路见 `proxy_bypass_environment`。
 * 详见 cordis.patch.yml 该路由注释与 tmp/respawn-qoder-gateway.ps1。
 *
 * ## 根因二（2026-11-08，规则层）：网关自定义错误类型被当正文吞掉
 *
 * proxy 修好后，intl 团队账号仍会排队限流（10605 / isQueued）。网关
 * `friendly_upstream_error()`（qoder_proxy.py:7755-7812）会发十几种自定义 `type` 的
 * 错误帧（`upstream_queued` / `quota_exhausted` / ...，见 `ERROR_TYPE_STATUS`）。此前本包的
 * `translateBusinessError` / `statusForError` 只认 8 个标准 type，`lib/proxy.mjs:541` 对
 * 这些帧判 undefined、`:579` 当普通 chunk 转发；流结束时 `streamAbortFrame` 补一帧
 * 「upstream stream aborted during thinking (no content emitted)」——这就是用户看到的报错，
 * 真实原因（排队限流）被吞掉了。
 *
 * 定稿修复（本文件 + cordis.patch.yml）：
 *   1. `ERROR_TYPE_STATUS` 补齐网关 12 种自定义 type 并给出正确 HTTP 状态码；
 *   2. 新增 `QUEUE_RE` 识别只带消息关键词（10605 / isQueued）的排队帧，排队统一翻成
 *      可重试的 **429**，非流式 `statusForError` 也返回 429 而非伪装成 200 completion；
 *   3. cordis.patch.yml 该路由 `timeoutMs: 300000`（规则层默认 120s 会在网关把最终排队帧
 *      发出来之前掐断流），`launch.env` 加 `QD_QUEUE_WAIT_BUDGET_SECS: "180"` 收敛排队预算。
 *
 * 下面的钩子（translateBusinessError / statusForError / streamAbortFrame /
 * ensureFinishReason）是**纵深防御**：即使网络通畅，上游仍可能限流/断流，此时必须把
 * 错误如实翻出来，而不是补一帧合成 stop 让客户端收到空的「成功」响应。
 *
 * 也就是说，「供应商怪癖」已经在 qoder2api-hub 那一侧消化掉了：
 *   - 换号 / 账号轮换 / 上游 429、401、402、403、5xx 的重试都在它内部
 *     （`qoder_routing` / `qoder_accounts`），本层**不要**再叠一层长时间退避——
 *     否则「换个账号重试」这条路径会被自己的退避拖死（与 raccoon / loomy 同构）；
 *   - 模型名解析（display_name / upstream_key / 别名都能认）、账号冷却、峰谷计价
 *     都在它内部；
 *   - 思考档位它自己也做归一：`normalize_reasoning_effort` 会把上游不支持的档位
 *     拉到最近合法档，本层只负责把 DSH 选择器的档位翻译成 `reasoning_effort`。
 *
 * ## 与 raccoon / loomy 的唯一差别：**不删 `thinking`**
 *
 * raccoon / loomy 的规则包把 `reasoning` 与 `thinking` 都当「上游不认识的字段」删掉。
 * qoder2api-hub 不一样——它的 `requested_effort`（qoder_proxy.py:3797-3810）读档位的
 * 优先级是：
 *
 *     payload.reasoning_effort  →  reasoning.effort  →  thinking.effort / thinking.level
 *
 * 也就是说 `thinking`（对象形式，含 `effort` / `level` / Anthropic 的 `budget_tokens`）
 * 是它**认识的入参**，删掉等于把客户端的思考档位丢掉。所以本包只删 `reasoning`
 * （对象形式——`applyReasoningEffort` 已经把它的 `effort` 搬到扁平的
 * `reasoning_effort`，qoder 读 `reasoning_effort` 的优先级最高，不会丢），`thinking`
 * 原样保留交给 qoder 自己处理。DSH 自己走 OpenAI Chat Completions，不会发 `thinking`，
 * 所以保留它对 DSH 无副作用，只让 Anthropic 风格的客户端也能把档位传进去。
 *
 * ## 本层真正要修的（2026-11-07，排查「qoder 模型经常失败」）
 *
 * qoder2api-hub 是**思考模型密集**的网关（Qwen3.8-Max / DeepSeek-V4-Pro / GLM-5.3 等
 * 都走 `reasoning_content` 长思考）。它的上游断流/超时会以两种形状漏到本层：
 *
 *  1. **流内错误帧**：网关在已经建好的 SSE 流里投一帧
 *     `{"error":{"message":"upstream stream error: ...","type":"upstream_error","code":502}}`
 *     （qoder_proxy.py:14142-14157），随后紧跟 `[DONE]`。本层此前**没有** `translateBusinessError`
 *     钩子，proxy 的 pipeStream 把这帧当普通 chunk 原样转发（客户端看到没有 choices 的帧直接忽略），
 *     再因 `ensureFinishReason()` 恒 true 补一帧合成 `finish_reason:stop`——结果是客户端收到一个
 *     **空的「成功」响应**：思考草稿被当结果、或干脆什么都没有。用户感知就是「qoder 又失败了」。
 *
 *  2. **HTTP 200 + 业务错误体**：非流式路径上网关可能返回 200 但 body 是
 *     `{"error":{...}}`；同样因为没有 `translateBusinessError` / `statusForError`，
 *     proxy 的 collectJson 把它当正常 completion 返回，客户端拿到一个「错误对象当答案」。
 *
 *  3. **思考阶段断流**：上游在 `reasoning_content` 阶段被掐断（网关 10053 / 规则层超时关响应体），
 *     此时只发过思考、没发正文也没发工具调用。`ensureFinishReason()` 恒 true 会补 `stop`，
 *     把思考草稿伪装成最终答案（与 loomy.mjs 记录的 spark-x2.6 坑完全同构）。
 *
 * 修复（与 loomy.mjs 同一套钩子，判定与文案都放在规则包里，框架只负责调用）：
 *   - 新增 `translateBusinessError`：识别网关的流内/JSON 错误帧并翻成标准 OpenAI 错误帧；
 *   - 新增 `statusForError`：HTTP 200 业务错误给真实状态码（502/429/503）；
 *   - 新增 `streamAbortFrame`：思考阶段断流时给出明确错误帧，而不是补 stop；
 *   - `ensureFinishReason(model, meta)` 改为接收 pipeStream 的快照，思考阶段断流返回 false。
 *
 * 所以这里只做 OpenAI 规范内、不改语义的事：
 *   1. 删掉上游不认识的对象形式 `reasoning`（`reasoning_effort` 保留）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. 给 `tools` 里不合规的裸 `parameters` 补上标准 object 外壳（防根级 `type` 歧义）；
 *   4. `finish_reason` 异常值与 null `content` 兜底，避免客户端卡在「未结束」；
 *   5. 流内/JSON 业务错误翻译 + 思考阶段断流兜底（**真正的修复**）。
 *
 * @module dsh-api-rules/rules/qoder
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/**
 * 上游不认识的采样字段（对象形式）。
 *
 * 只删 `reasoning`：`applyReasoningEffort` 已把 `reasoning.effort` 翻译进扁平的
 * `reasoning_effort`，而 qoder 读 `reasoning_effort` 优先级最高，删对象形式不丢档位。
 * **保留 `thinking`**：qoder 的 `requested_effort` 会读 `thinking.effort` / `thinking.level`，
 * 它是入参不是脏字段（见文件头「与 raccoon / loomy 的唯一差别」）。
 */
const UNSUPPORTED_PARAMS = ['reasoning']

/**
 * 网关错误帧里 `type` 到 HTTP 状态码的映射。
 *
 * qoder2api-hub 的 `_error` / `_rate_limited` / 流内错误帧都用这些 type；
 * `statusForError` 与 `translateBusinessError` 共用，保证同一种错误在流式与
 * 非流式两条路径上给出一致的状态码。
 */
const ERROR_TYPE_STATUS = {
  rate_limit_error: 429,
  invalid_request_error: 400,
  authentication_error: 401,
  permission_denied_error: 403,
  not_found_error: 404,
  upstream_error: 502,
  server_error: 502,
  overloaded_error: 503,
  // 2026-11-08 二段修复：网关 friendly_upstream_error() / _queue_error_frame()
  // 会发十几种自定义 type（qoder_proxy.py:7755-7812、10895-10916）。此前只认
  // 上面 8 个标准类型，其余错误帧被当成正文吞掉，客户端只看到「思考阶段断流」。
  upstream_queued: 429,                    // 10605 isQueued / RESOURCE_LIMIT，可重试
  quota_exhausted: 429,                   // 套餐额度（112）
  quota_daily_limit: 429,                 // 当日次数上限（110）
  upstream_transient_error: 502,
  upstream_empty_response: 502,
  upstream_incomplete_tool_call: 502,
  upstream_image_conversion_timeout: 504,
  upstream_plan_rejected: 402,
  version_too_low: 426,
  payload_too_large: 413,
  content_policy_rejected: 400,
  invalid_tool_arguments: 400,
}

/** 网关「上游流中断 / 空流」类错误消息的匹配（qoder_proxy.py:14154-14157、13196、13650）。 */
const UPSTREAM_BROKEN_RE = /上游流中断|upstream stream (broken|error)|empty upstream stream|upstream unreachable/

/** 网关「整池无可用账号」消息（qoder_proxy.py:13442-13444、13109-13111）。 */
const NO_ACCOUNT_RE = /no usable account|account pool (not ready|unavailable)/

/** 网关「上游排队」消息（10605 / isQueued / RESOURCE_LIMIT，qoder_proxy.py:7773-7805）。 */
const QUEUE_RE = /10605|isQueued|RESOURCE_LIMIT|上游(模型)?排队中|上游模型排队超时|upstream model queue is full/

/**
 * 「答一步就停」意图词：只用于匹配「最后一句」。最后一句以这些词开头/包含它们，
 * 说明模型宣告要做某事却没真正发工具调用就停了。不能匹配全文——正常回答中间
 * 也可能出现「让我解释一下」，那不是早停。
 *
 * 这不是网关吞帧 bug（无 stream aborted / thinking aborted 帧），而是模型自身
 * 在高压长上下文+排队限流下的早停行为。修复方式：规则层检测到这种不完整轮
 * 后，自动追加「继续执行」消息重发一次，逼模型真正发出工具调用。
 */
const INCOMPLETE_TURN_RE = /(?:让我|我来|我先|let me |I'll |I will )/i

/** 续推最多重试次数（防止无限循环）。 */
const MAX_INCOMPLETE_TURN_RETRIES = 1

export const qoderRules = {
  name: 'qoder2api-hub',

  /**
   * 请求整形：删掉上游不认识的对象形式 `reasoning`、把 Responses API 的 max 叫法归一到
   * `max_tokens`，并给 `tools` 里不合规的裸 `parameters` 补上标准外壳。
   * 角色、图片、`thinking`、消息一律不动。
   */
  normalizeRequest({ body, model }) {
    const notes = []
    // 档位翻译放在删字段之前：reasoning: {effort} 这种对象形式也要能读到。
    applyReasoningEffort('qoder2api-hub', model, body, notes)
    for (const key of UNSUPPORTED_PARAMS) {
      if (key in body) {
        delete body[key]
        notes.push('dropped ' + key)
      }
    }
    // max_completion_tokens / max_output_tokens 是 Responses API 的叫法，
    // Chat Completions 上游只认 max_tokens；两者同时出现时以较小者为准。
    const candidates = [body['max_tokens'], body['max_completion_tokens'], body['max_output_tokens']].filter(
      (value) => typeof value === 'number' && value > 0,
    )
    if (candidates.length > 0) {
      body['max_tokens'] = Math.min(...candidates)
      delete body['max_completion_tokens']
      delete body['max_output_tokens']
    }

    // 给 tools 里不合规的裸 parameters 补 object 外壳（消除根级 type 被当 schema 关键字）。
    // 合规外壳、缺失/非对象 parameters、非数组 tools 全部原样放行（见 flat-parameters.mjs）。
    const wrapped = body && typeof body === 'object' ? normalizeToolParameters(body['tools']) : 0
    if (wrapped > 0) {
      notes.push('wrapped ' + wrapped + ' flat tool parameter root(s) into {type:object,properties}')
    }

    return { body, notes }
  },

  /**
   * 图片原样透传。
   *
   * qoder2api-hub 把多模态请求原样交给上游，模型能不能看图由上游 + 目录里的 `is_vl`
   * 决定（视觉模型在 cordis.patch.yml 里用 `input: [text, image]` 标记；纯文本模型
   * 不带该标记，DSH 就不会给它们送图）。本层不预先剥离图片。
   */
  supportsImages() {
    return true
  },

  /**
   * 只把「上游明确说可以立刻重来」的判定为可重试。
   *
   * 429 / 5xx 在 qoder2api-hub 里意味着「这个账号被冷却、已经换下一个账号重试过了」，
   * 到这里还失败说明整池都不可用，短退避再试一次是合理的；而 402 与业务码（积分不足）
   * 在同一段时间内必然继续失败，重试只会白烧复述。
   *
   * 400 一律不重试：确定性失败（空 messages、参数非法），重试不会改变结果，反而可能把
   * 真正的错误盖掉（与 loomy 的结论一致）。
   *
   * 408（请求超时）/ 504（网关超时）也重试：这两类是传输层瞬时故障，换一次上游连接
   * 大概率能恢复，且网关自身已对账号做过轮换，本层再磨一次不会叠第二层账号退避。
   */
  isRetryable({ status }) {
    if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true
    return false
  },

  isConcurrencyError() {
    return false
  },

  /** 退避比 cline 短一档：账号冷却以百秒计，本层只是磨掉瞬时抖动。 */
  backoffMs({ attempt }) {
    return Math.min(2000 * 2 ** attempt, 15_000)
  },

  /** 最多再试一次 = 两次退避窗口，仍失败就把上游错误原样交给客户端。 */
  retryBudgetMs() {
    return 20_000
  },

  maxAttempts() {
    return 3
  },

  cooldownMs() {
    return 0
  },

  /**
   * 把网关的流内 / HTTP 200 业务错误帧翻成标准 OpenAI 错误帧。
   *
   * 网关在已建好的 SSE 流里投 `{"error":{"message":...,"type":"upstream_error","code":502}}`
   * 然后紧跟 `[DONE]`（qoder_proxy.py:14142-14157）；非流式也可能返回 200 + 同样的错误体。
   * 若本层不认，proxy 会把这帧当普通 chunk 转发、再补一帧合成 `finish_reason:stop`，
   * 客户端收到空的「成功」响应——这就是「qoder 经常失败」的直接表现。
   *
   * 这里识别四类：网关自定义 type（标准 8 种 + friendly_upstream_error 的 12 种自定义
   * 类型，见 ERROR_TYPE_STATUS）、「上游断流 / 空流」关键词、「上游排队 10605」关键词、
   * 以及「整池无可用账号」。
   * 返回 undefined 表示「不是本包该管的错误」，proxy 维持原行为。
   */
  translateBusinessError(chunk) {
    if (chunk === null || typeof chunk !== 'object') return undefined
    const err = chunk['error']
    if (err === null || typeof err !== 'object') return undefined
    const type = typeof err['type'] === 'string' ? err['type'] : ''
    const message = String(err['message'] ?? '')
    const isGatewayError =
      ERROR_TYPE_STATUS[type] !== undefined ||
      QUEUE_RE.test(message) ||
      UPSTREAM_BROKEN_RE.test(message) ||
      NO_ACCOUNT_RE.test(message)
    if (!isGatewayError) return undefined
    // 网关已经给了数字 code 就用它；否则按 type 推断；都没有就兜底 502。
    let code = typeof err['code'] === 'number' ? err['code'] : undefined
    if (code === undefined) code = ERROR_TYPE_STATUS[type] ?? 502
    // 网关的 code 有时是业务码（如 418/10605），落到 HTTP 语义上统一成 5xx/429。
    if (code < 400 || code > 599) code = ERROR_TYPE_STATUS[type] ?? 502
    // 整池无账号 → 503；上游排队 → 429（可重试）；上游断流 → 502。
    if (NO_ACCOUNT_RE.test(message)) code = 503
    else if (type === 'upstream_queued' || QUEUE_RE.test(message)) code = 429
    else if (UPSTREAM_BROKEN_RE.test(message)) code = code === 429 ? 429 : 502
    return { error: { message: message || 'upstream error', type: 'upstream_error', code } }
  },

  /**
   * 非流式 HTTP 200 业务错误：给真实状态码，让客户端能正确重试或提示。
   * 与 translateBusinessError 共用同一套 type→status 映射。
   */
  statusForError(chunk) {
    if (chunk === null || typeof chunk !== 'object') return undefined
    const err = chunk['error']
    if (err === null || typeof err !== 'object') return undefined
    const type = typeof err['type'] === 'string' ? err['type'] : ''
    const message = String(err['message'] ?? '')
    if (ERROR_TYPE_STATUS[type] === undefined && !QUEUE_RE.test(message) && !UPSTREAM_BROKEN_RE.test(message) && !NO_ACCOUNT_RE.test(message)) {
      return undefined
    }
    if (NO_ACCOUNT_RE.test(message)) return 503
    if (type === 'upstream_queued' || QUEUE_RE.test(message)) return 429
    if (type === 'rate_limit_error') return 429
    if (UPSTREAM_BROKEN_RE.test(message)) return 502
    return typeof err['code'] === 'number' && err['code'] >= 400 && err['code'] <= 599 ? err['code'] : 502
  },

  /**
   * 规则层「断流收尾帧」钩子：上游没发 finish_reason 就断流、且规则包决定不补
   * 合成 stop 时，pipeStream 会拿 meta 来问「这轮该给客户端发什么错误帧」。
   * 与 loomy.mjs 同构：思考阶段断流（只发过 reasoning_content、没正文没工具调用）
   * 给出明确错误帧，而不是让客户端把思考草稿当答案。
   * meta: { sawFinishReason, sentAnything, sawContent, sawToolCall }
   */
  streamAbortFrame(meta) {
    if (meta === null || typeof meta !== 'object') return undefined
    if (meta.sawFinishReason === true) return undefined
    if (meta.sentAnything !== true) return undefined
    if (meta.sawContent !== true && meta.sawToolCall !== true) {
      return { error: { message: 'upstream stream aborted during thinking (no content emitted)', type: 'upstream_error', code: 502 } }
    }
    return undefined
  },

  /** `other` 不是 OpenAI 认识的值；不映射会让客户端停在「未结束」。 */
  finishReason(value) {
    if (value === null || value === undefined || value === 'other') return 'stop'
    return value
  },

  /** 只有思考内容、正文为 null 的 chunk：客户端会把 null 当「没有响应」，空串才是同义形状。 */
  normalizeDelta(delta) {
    if (typeof delta !== 'object' || delta === null) return
    if (delta['content'] === null) delta['content'] = ''
  },

  /**
   * 断流时是否补 finish_reason。meta 是 pipeStream 给的「这轮流发过什么」快照：
   * 只发了 reasoning_content、没有正文/工具调用、也没收到 finish_reason，说明上游在
   * 思考阶段就被掐断（qoder 思考模型长思考 + 网关超时关响应体）。补 stop 会把
   * 思考草稿当成最终答案——必须拒绝补，让 pipeStream 改问 streamAbortFrame。
   * meta 缺省（旧调用方）保持原行为 true，向后兼容。
   */
  ensureFinishReason(model, meta) {
    if (meta === undefined || meta === null) return true
    if (meta.sawFinishReason === true) return true
    if (meta.sentAnything === true && meta.sawContent !== true && meta.sawToolCall !== true) return false
    return true
  },

  /**
   * 「答一步就停」检测钩子：模型产出了正文/思考但没有工具调用就自然结束。
   *
   * QoDuck (lmodel) 在长上下文（in=145k-156k，max_input 180k）下常见：模型产出
   * reasoning「让我检查网关状态」+ text「让我检查一下网关和宿主的状态」然后
   * stopReason=stop 不带 tool-call。用户感知就是「只回答一步然后就不思考了」。
   *
   * 这不是网关吞帧 bug（无 stream aborted / thinking aborted 帧），而是模型自身
   * 在高压长上下文+排队限流下的早停行为。规则层检测到这种不完整轮后，proxy 会
   * 自动追加「继续执行」消息重发一次，逼模型真正发出工具调用。
   *
   * meta: { sawFinishReason, sentAnything, sawContent, sawToolCall, contentText }
   * 返回 true 表示这轮不完整，proxy 应该续推。
   */
  isIncompleteTurn(model, meta) {
    if (meta === null || typeof meta !== 'object') return false
    // 必须有正文、无工具调用、有正常 finish_reason（不是断流）
    if (meta.sawContent !== true) return false
    if (meta.sawToolCall === true) return false
    if (meta.sawFinishReason !== true) return false
    // 只有「最后一句」是意图宣告（让我/我来/I'll…）且本轮没发工具调用，才算不完整轮。
    // 正常完整回答即使中间出现「让我解释一下」，只要最后落到了结论句，就不续推——
    // 这正是用户反馈「正常任务都无法结束」的根因：旧逻辑在全文任意位置匹配意图词。
    const text = typeof meta.contentText === 'string' ? meta.contentText : ''
    if (text.length === 0) return false
    const sentences = text.split(/[。！？.!?\n\r]+/).map((s) => s.trim()).filter((s) => s.length > 0)
    if (sentences.length === 0) return false
    const lastSentence = sentences[sentences.length - 1]
    return INCOMPLETE_TURN_RE.test(lastSentence)
  },

  /**
   * 续推时追加的消息：把助手的不完整回复 + 一条「继续」用户消息追加到原始消息列表。
   * 返回新的 messages 数组（不修改原数组）。
   */
  incompleteTurnMessages(originalMessages, assistantText) {
    if (!Array.isArray(originalMessages)) return originalMessages
    return [
      ...originalMessages,
      { role: 'assistant', content: assistantText },
      { role: 'user', content: '请继续执行你刚才说要做的操作。' },
    ]
  },

  /** 续推最大重试次数。 */
  maxIncompleteTurnRetries() {
    return MAX_INCOMPLETE_TURN_RETRIES
  },
}
