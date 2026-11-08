/**
 * trae2api-hub（https://github.com/shuishuipingan/trae2api-hub）规则包。
 *
 * trae2api-hub 是 Trae（trae.com.cn / trae.com）官方桌面客户端的
 * OpenAI/Anthropic 兼容网关：它维护一个多账号池（账号 = Trae 桌面端导出的凭证），
 * 对外暴露 `/v1/chat/completions`、`/v1/messages`、`/v1/models`，模型 id 用目录里的
 * display_name（如 `Seed-Code`）。源码内嵌在本插件的 `vendor/trae2api-hub/`
 * （纯标准库 Python，无第三方依赖），由路由上的 `launch` 在插件启动时自动拉起
 * （见 cordis.patch.yml 的 trae2api-hub 路由）。
 *
 * trae2api-hub 是 qoder2api-hub 的**近亲**（同作者、同架构、模块名 `trae_*.py` 对应
 * `qoder_*.py`），所以本规则包与 lib/rules/qoder.mjs 同构。差异只在错误文案与
 * 几个 trae 特有的错误 type（risk_control / model_unknown / quota_exceeded）。
 *
 * ## 与 qoder2api-hub 同构的部分
 *
 *   - 换号 / 账号轮换 / 上游 429、401、402、403、5xx 的重试都在网关内部
 *     （`trae_scheduler` / `trae_accounts`），本层**不再**叠长时间退避；
 *   - 模型名解析（display_name / upstream_key / 别名都能认）、账号冷却、峰谷计价
 *     都在它内部；
 *   - 思考档位它自己也做归一：`normalize_reasoning_effort`（trae_proxy.py:3812）
 *     会把上游不支持的档位拉到最近合法档，本层只负责把 DSH 选择器的档位翻译成
 *     `reasoning_effort`；
 *   - 网关读档位的优先级同样是 `payload.reasoning_effort → reasoning.effort →
 *     thinking.effort / thinking.level`（trae_proxy.py:3878-3883），所以 **`thinking`
 *     是入参不是脏字段**，删掉会丢客户端的思考档位——本包只删对象形式的 `reasoning`
 *     （`applyReasoningEffort` 已把 `effort` 搬到扁平的 `reasoning_effort`，优先级最高）。
 *
 * ## trae 特有的错误 type（friendly_upstream_error，trae_proxy.py:7053-7105）
 *
 *   - `quota_exhausted`（429）：4008 免费额度用尽（"Trae 免费额度已用尽（4008 …）"）；
 *   - `risk_control`（403）：Trae 4015/4019 账号/出口风控；
 *   - `model_unknown`（400）：Trae 4023 上游不认识该模型；
 *   - `invalid_request_error`（400）：Trae 4001 参数非法；
 *   - `authentication_error`（401/403）：Trae 1001 鉴权失败；
 *   - `content_policy_rejected`（400）：DataInspectionFailed；
 *   - `invalid_tool_arguments`（400）：上游生成的工具调用参数不是合法 JSON；
 *   - `upstream_transient_error`（502）：上游瞬时故障（418/5xx）。
 *
 * 这些 type 与 qoder 的 `ERROR_TYPE_STATUS` 并集一起给进 `translateBusinessError` /
 * `statusForError`，保证同一种错误在流式与非流式两条路径上给出一致的状态码。
 *
 * ## 本层要修的（与 qoder.mjs 同类）
 *
 *   1. 流内/HTTP 200 业务错误翻译（translateBusinessError / statusForError）；
 *   2. 思考阶段断流兜底（ensureFinishReason + streamAbortFrame）；
 *   3. finish_reason 异常值与 null content 兜底；
 *   4. 「答一步就停」检测（isIncompleteTurn）。
 *
 * @module dsh-api-rules/rules/trae2api-hub
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/**
 * 上游不认识的采样字段（对象形式）。
 *
 * 只删 `reasoning`：`applyReasoningEffort` 已把 `reasoning.effort` 翻译进扁平的
 * `reasoning_effort`，而 trae 读 `reasoning_effort` 优先级最高，删对象形式不丢档位。
 * **保留 `thinking`**：trae 的 `requested_effort` 会读 `thinking.effort` / `thinking.level`
 * （trae_proxy.py:3878-3883），它是入参不是脏字段（与 qoder.mjs 同构）。
 */
const UNSUPPORTED_PARAMS = ['reasoning']

/**
 * 网关错误帧里 `type` 到 HTTP 状态码的映射。
 *
 * trae2api-hub 的 `_error`（trae_proxy.py:8999）、`_quota_error`（:9003）、
 * `_rate_limited`（:9025）与流内错误帧都用这些 type；`statusForError` 与
 * `translateBusinessError` 共用，保证同一种错误在流式与非流式两条路径上状态码一致。
 */
const ERROR_TYPE_STATUS = {
  // 标准 OpenAI 风格 type
  rate_limit_error: 429,
  invalid_request_error: 400,
  authentication_error: 401,
  permission_denied_error: 403,
  not_found_error: 404,
  upstream_error: 502,
  server_error: 502,
  overloaded_error: 503,
  // 网关自定义 type（friendly_upstream_error / _queue_error_frame）
  upstream_queued: 429,                    // 10605 isQueued / RESOURCE_LIMIT，可重试
  quota_exhausted: 429,                   // 4008 免费额度用尽
  quota_daily_limit: 429,                 // 当日次数上限
  upstream_transient_error: 502,
  upstream_empty_response: 502,
  upstream_incomplete_tool_call: 502,
  upstream_image_conversion_timeout: 504,
  upstream_plan_rejected: 402,
  version_too_low: 426,
  payload_too_large: 413,
  content_policy_rejected: 400,
  invalid_tool_arguments: 400,
  // trae 特有 type（trae_proxy.py:7066-7105）
  risk_control: 403,                     // Trae 4015/4019 风控
  model_unknown: 400,                    // Trae 4023
  invalid_request: 400,                  // Trae 4001（friendly_upstream_error 的别名）
}

/** 网关「上游流中断 / 空流 / 不可达」错误消息的匹配（trae_proxy.py:11206-11225）。 */
const UPSTREAM_BROKEN_RE = /上游流中断|upstream stream (broken|error)|empty upstream stream|upstream unreachable|upstream (status|error)/

/** 网关「整池无可用账号」消息（trae_proxy.py:7575-7577）。 */
const NO_ACCOUNT_RE = /no usable account|account pool (not ready|unavailable)/

/** 网关「上游排队」消息（10605 / isQueued / RESOURCE_LIMIT，trae_proxy.py:6961-6983）。 */
const QUEUE_RE = /10605|isQueued|RESOURCE_LIMIT|上游(模型)?排队中|上游模型排队超时|upstream model queue is full/

/** 网关「套餐额度用尽」消息（4008 / quota exceeded / 免费额度，trae_proxy.py:7068-7072）。 */
const QUOTA_RE = /4008|quota exceeded|免费额度|quota_exceeded|usage exceeds frequency limit/

/** 网关「过载 / 服务器繁忙」消息（trae_proxy.py overloaded gate）。 */
const OVERLOADED_RE = /服务器繁忙|overloaded|too many|rate limit|429/

/** 网关「模型名非法 / 跨 realm 禁用」消息（model_unknown / trae 4023 / banned model，trae_proxy.py:7085-7090）。 */
const MODEL_RE = /model_unknown|trae 4023|unknown or disabled model|not a chat model|banned model|cross-realm/

/** 网关「内容安全审核」消息（DataInspectionFailed，trae_proxy.py:7006-7014、7093-7097）。 */
const CONTENT_POLICY_RE = /DataInspectionFailed|inappropriate content|ContentFilter|SensitiveContent/

/**
 * 「答一步就停」意图词：只用于匹配「最后一句」。最后一句以这些词开头/包含它们，
 * 说明模型宣告要做某事却没真正发工具调用就停了。不能匹配全文——正常回答中间
 * 也可能出现「让我解释一下」，那不是早停。
 *
 * 这不是网关吞帧 bug，而是模型自身在高压长上下文下的早停行为。修复方式：规则层
 * 检测到这种不完整轮后，自动追加「继续执行」消息重发一次，逼模型真正发出工具调用。
 */
const INCOMPLETE_TURN_RE = /(?:让我|我来|我先|let me |I'll |I will )/i

/** 续推最多重试次数（防止无限循环）。 */
const MAX_INCOMPLETE_TURN_RETRIES = 1

export const traeRules = {
  name: 'trae2api-hub',

  /**
   * 请求整形：删掉上游不认识的对象形式 `reasoning`、把 Responses API 的 max 叫法归一到
   * `max_tokens`，并给 `tools` 里不合规的裸 `parameters` 补上标准外壳。
   * 角色、图片、`thinking`、消息一律不动。
   */
  normalizeRequest({ body, model }) {
    const notes = []
    // 档位翻译放在删字段之前：reasoning: {effort} 这种对象形式也要能读到。
    applyReasoningEffort('trae2api-hub', model, body, notes)
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
   * trae2api-hub 把多模态请求原样交给上游，模型能不能看图由上游 + 目录里的
   * `thinking` / 视觉标记决定（视觉模型在 cordis.patch.yml 里用 `input: [text, image]`
   * 标记）。本层不预先剥离图片。
   */
  supportsImages() {
    return true
  },

  /**
   * 只把「上游明确说可以立刻重来」的判定为可重试。
   *
   * 429 / 5xx 在 trae2api-hub 里意味着「这个账号被冷却、已经换下一个账号重试过了」，
   * 到这里还失败说明整池都不可用，短退避再试一次是合理的；而 402 与业务码（积分不足）
   * 在同一段时间内必然继续失败，重试只会白烧复述。
   *
   * 400 一律不重试：确定性失败（空 messages、参数非法、模型不存在），重试不会改变结果。
   *
   * 408（请求超时）/ 504（网关超时）也重试：传输层瞬时故障，换一次上游连接
   * 大概率能恢复，且网关自身已对账号做过轮换。
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
   * 网关在已建好的 SSE 流里投 `{"error":{"message":...,"type":<etype>,"code":<status>}}`
   * 然后紧跟 `[DONE]`（trae_proxy.py:11206-11225）；非流式也可能返回 200 + 同样的错误体。
   * 若本层不认，proxy 会把这帧当普通 chunk 转发、再补一帧合成 `finish_reason:stop`，
   * 客户端收到空的「成功」响应——这就是「trae 经常失败」的直接表现。
   *
   * 这里识别五类：网关自定义 type（见 ERROR_TYPE_STATUS）、「上游断流 / 空流」关键词、
   * 「上游排队 10605」关键词、「套餐额度用尽 4008」关键词、「整池无可用账号」。
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
      QUOTA_RE.test(message) ||
      OVERLOADED_RE.test(message) ||
      UPSTREAM_BROKEN_RE.test(message) ||
      NO_ACCOUNT_RE.test(message) ||
      MODEL_RE.test(message) ||
      CONTENT_POLICY_RE.test(message)
    if (!isGatewayError) return undefined
    // 网关已经给了数字 code 就用它；否则按 type 推断；都没有就兜底 502。
    let code = typeof err['code'] === 'number' ? err['code'] : undefined
    if (code === undefined) code = ERROR_TYPE_STATUS[type] ?? 502
    // 网关的 code 有时是业务码（如 418/10605），落到 HTTP 语义上统一成 5xx/429。
    if (code < 400 || code > 599) code = ERROR_TYPE_STATUS[type] ?? 502
    // 整池无账号 → 503；上游排队 → 429（可重试）；额度用尽 → 429；过载 → 503；上游断流 → 502。
    if (NO_ACCOUNT_RE.test(message)) code = 503
    else if (type === 'upstream_queued' || QUEUE_RE.test(message)) code = 429
    else if (QUOTA_RE.test(message) || type === 'quota_exhausted' || type === 'rate_limit_error') code = 429
    else if (OVERLOADED_RE.test(message)) code = 503
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
    if (
      ERROR_TYPE_STATUS[type] === undefined &&
      !QUEUE_RE.test(message) &&
      !QUOTA_RE.test(message) &&
      !OVERLOADED_RE.test(message) &&
      !UPSTREAM_BROKEN_RE.test(message) &&
      !NO_ACCOUNT_RE.test(message) &&
      !MODEL_RE.test(message) &&
      !CONTENT_POLICY_RE.test(message)
    ) {
      return undefined
    }
    if (NO_ACCOUNT_RE.test(message)) return 503
    if (type === 'upstream_queued' || QUEUE_RE.test(message)) return 429
    if (type === 'rate_limit_error' || QUOTA_RE.test(message) || type === 'quota_exhausted') return 429
    if (OVERLOADED_RE.test(message)) return 503
    if (type === 'content_policy_rejected' || CONTENT_POLICY_RE.test(message)) return 400
    if (type === 'model_unknown' || MODEL_RE.test(message)) return 400
    if (type === 'authentication_error') return 401
    if (type === 'risk_control') return 403
    if (UPSTREAM_BROKEN_RE.test(message)) return 502
    return typeof err['code'] === 'number' && err['code'] >= 400 && err['code'] <= 599 ? err['code'] : (ERROR_TYPE_STATUS[type] ?? 502)
  },

  /**
   * 规则层「断流收尾帧」钩子：上游没发 finish_reason 就断流、且规则包决定不补
   * 合成 stop 时，pipeStream 会拿 meta 来问「这轮该给客户端发什么错误帧」。
   * 与 qoder.mjs / loomy.mjs 同构：思考阶段断流（只发过 reasoning_content、没正文
   * 没工具调用）给出明确错误帧，而不是让客户端把思考草稿当答案。
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
   * 思考阶段就被掐断（trae 思考模型长思考 + 网关超时关响应体）。补 stop 会把
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
   * trae 的 Seed-Code / DeepSeek 等思考模型在长上下文下常见：模型产出
   * reasoning「让我检查…」+ text「让我检查一下…」然后 stopReason=stop 不带 tool-call。
   * 用户感知就是「只回答一步然后就不思考了」。
   *
   * 这不是网关吞帧 bug，而是模型自身在高压长上下文下的早停行为。规则层检测到这种
   * 不完整轮后，proxy 会自动追加「继续执行」消息重发一次，逼模型真正发出工具调用。
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
    // 正常完整回答即使中间出现「让我解释一下」，只要最后落到了结论句，就不续推。
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
