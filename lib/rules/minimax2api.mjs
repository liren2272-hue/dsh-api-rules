/**
 * minimax2api（https://github.com/zakolinxi/minimax2api）规则包。
 *
 * minimax2api 是 MiniMax Agent（agent.minimax.io / agent.minimaxi.com）官方网页端的
 * OpenAI / Anthropic 兼容网关：它维护一个多账号池（账号 = 从 MiniMax Agent 网页
 * localStorage 里粘过来的 JWT `_token`），对外暴露 `/v1/chat/completions`、
 * `/v1/messages`、`/v1/images/generations`、`/v1/videos/generations`、`/v1/models`。
 * 二进制（Go 静态编译）与前端产物内嵌在本插件的 `vendor/minimax2api/`，由路由上的
 * `launch` 在插件启动时直接拉起（见 cordis.patch.yml 的 minimax2api 路由）。
 *
 * ## 本层要做什么
 *
 * 网关自己已经消化掉大部分供应商怪癖：
 *   - 换号 / 账号冷却 / 上游 429、401、402、403、5xx 的重试都在它内部
 *     （`routing` least_inflight / cooldown / maxAttempts），本层**不要**再叠一层
 *     长时间退避——否则「换个账号重试」这条路径会被自己的退避拖死（与 raccoon /
 *     loomy / qoder 同构）；
 *   - 模型名精确匹配内置目录，`context_window` 由它用 `nearestInt` 归一到合法档位；
 *   - 思考档位是**布尔开关** `thinking`（不是 OpenAI 的 `reasoning_effort` 档位）。
 *
 * 所以这里只做 OpenAI 规范内、不改语义的事：
 *   1. 删掉上游不认识的对象形式 `reasoning`（`reasoning_effort` 保留并翻译成 `thinking`）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. 给 `tools` 里不合规的裸 `parameters` 补上标准 object 外壳（与 qoder/loomy 同类修复）；
 *   4. `reasoning_effort` → `thinking` 布尔翻译（minimax 只认布尔开关，见下）；
 *   5. `finish_reason` 异常值与 null `content` 兜底；
 *   6. 流内/JSON 业务错误翻译 + 思考阶段断流兜底（纵深防御）。
 *
 * ## thinking：布尔开关，不是档位
 *
 * 网关的 `modelSelection(model, thinking, contextWindow)`（gateway.go:1033）：
 *   - `forced_on`（minimax-m3.1-flash）：忽略入参，恒发 `variant:"thinking"`；
 *   - `switchable`（minimax-m3）：`thinking != nil` 时按布尔值发 `thinking`/空 variant；
 *   - `forced_off`：恒不思考。
 * `thinking` 缺省（DSH 没选档）时 `variant` 为 nil，即**沿用上游默认**（M3 上游默认开思考）。
 * 所以本层只在请求真的带了档位时翻译：`off/none/disabled/minimal` → `thinking:false`，
 * 其余（low/medium/high/xhigh/max）→ `thinking:true`；没带档位就**不动** `thinking`，
 * 让上游默认生效——这与 cordis.patch.yml 顶部「一律不声明 off」的原则一致。
 *
 * ## 鉴权
 *
 * 网关的 `/v1/*` 用 `Authorization: Bearer <client-key>` 或 `X-Api-Key` 精确匹配
 * `store.ClientKeyByValue`，**没有内置默认 key**；client key 只能经管理面板
 * `POST /admin/api/client-keys` 创建（值形如 `sk-mm-<40hex>`）。本插件在 vendored
 * 源码里加了 `MINIMAX2API_CLIENT_KEY` 环境变量种子（`store.SeedClientKey`，幂等），
 * 路由 `launch.env` 把它钉成与 `route.apiKey` 同值的已知串，这样全新克隆也能直接用，
 * 不必先去面板抄一个只显示一次的 key。
 *
 * @module dsh-api-rules/rules/minimax2api
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/**
 * 上游不认识的采样字段（对象形式）。
 *
 * 只删 `reasoning`：`applyReasoningEffort` 已把它的 `effort` 搬到扁平的
 * `reasoning_effort`，本层随后再翻译成 `thinking`。`thinking` 是网关认识的入参，
 * 原样保留（DSH 走 OpenAI 不会发，Anthropic 风格客户端发了也正好被网关用上）。
 */
const UNSUPPORTED_PARAMS = ['reasoning']

/** 档位里视为「关闭思考」的取值（小写比较）。 */
const THINKING_OFF = new Set(['off', 'none', 'disabled', 'minimal', 'false', '0'])

/** 网关错误消息里「需要订阅账号（Token Plan）」的匹配。 */
const SUBSCRIPTION_RE = /subscription account required|Token Plan|token plan/

/** 网关错误消息里「整池无可用账号 / 账号池耗尽」的匹配（store sentinel 文案）。 */
const NO_ACCOUNT_RE = /no account available|all accounts are busy|no account matches|account pool|no usable account/

/** 网关错误消息里「过载 / 限流」的匹配（withRequestGate 503、limiter 429）。 */
const OVERLOADED_RE = /服务器繁忙|overloaded|too many|rate limit|quota/

/** 网关错误消息里「上游断流 / 空流 / 不可达」的匹配。 */
const UPSTREAM_BROKEN_RE = /upstream stream|stream (broken|error)|empty upstream stream|upstream unreachable|upstream request|upstream (status|error)/

/** 网关错误消息里「模型名非法」的匹配（400，确定性失败）。 */
const MODEL_RE = /unknown or disabled model|not a chat model/

/**
 * 「答一步就停」意图词：只用于匹配「最后一句」。最后一句以这些词开头/包含它们，
 * 说明模型宣告要做某事却没真正发工具调用就停了。不能匹配全文——正常回答中间
 * 也可能出现「让我解释一下」，那不是早停。
 *
 * minimax-agent 是「自动规划并调用工具」的 Agent 模型，长上下文下同样会早停。
 */
const INCOMPLETE_TURN_RE = /(?:让我|我来|我先|let me |I'll |I will )/i

/** 续推最多重试次数（防止无限循环）。 */
const MAX_INCOMPLETE_TURN_RETRIES = 1

export const minimaxRules = {
  name: 'minimax2api',

  /**
   * 请求整形：删掉上游不认识的对象形式 `reasoning`、把 Responses API 的 max 叫法归一到
   * `max_tokens`、给 `tools` 里不合规的裸 `parameters` 补上标准外壳，并把 DSH 的
   * `reasoning_effort` 档位翻译成网关的 `thinking` 布尔开关。角色、图片、消息一律不动。
   */
  normalizeRequest({ body, model }) {
    const notes = []
    // 档位翻译放在删字段之前：reasoning: {effort} 这种对象形式也要能读到。
    applyReasoningEffort('minimax2api', model, body, notes)
    for (const key of UNSUPPORTED_PARAMS) {
      if (key in body) {
        delete body[key]
        notes.push('dropped ' + key)
      }
    }
    // minimax 只认布尔 `thinking`；DSH 下发的是 `reasoning_effort` 档位。
    // 只在请求真的带了档位时翻译，没带就留空让上游默认生效。
    if (typeof body['reasoning_effort'] === 'string' && body['reasoning_effort'].trim() !== '') {
      const level = body['reasoning_effort'].trim().toLowerCase()
      const on = !THINKING_OFF.has(level)
      body['thinking'] = on
      notes.push('reasoning_effort ' + level + ' -> thinking ' + on)
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
   * minimax2api 把多模态请求原样交给上游，模型能不能看图由上游 + 目录决定。本层不预先
   * 剥离图片；DSH 是否送图由 provider 的 `input: [text, image]` 声明控制。
   */
  supportsImages() {
    return true
  },

  /**
   * 只把「上游明确说可以立刻重来」的判定为可重试。
   *
   * 429 / 5xx 在 minimax2api 里意味着「这个账号被冷却、已经换下一个账号重试过了」，
   * 到这里还失败说明整池都不可用，短退避再试一次是合理的；而订阅缺失（503）在
   * 同一段时间内必然继续失败，重试只会白烧复述。
   *
   * 400 一律不重试：确定性失败（未知模型、非聊天模型、空 messages），重试不会改变结果。
   * 408（请求超时）/ 504（网关超时）也重试：传输层瞬时故障，换一次上游连接大概率恢复。
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
   * 网关在已建好的 SSE 流里经 `writeSSEError` 投
   * `data: {"error":{"message":...,"type":"minimax2api_error"}}\n\n data: [DONE]`；
   * 若本层不认，proxy 会把这帧当普通 chunk 转发、再补一帧合成 `finish_reason:stop`，
   * 客户端收到空的「成功」响应。这里按消息关键词给出真实状态码。
   */
  translateBusinessError(chunk) {
    if (chunk === null || typeof chunk !== 'object') return undefined
    const err = chunk['error']
    if (err === null || typeof err !== 'object') return undefined
    const type = typeof err['type'] === 'string' ? err['type'] : ''
    const message = String(err['message'] ?? '')
    // 网关所有错误帧的 type 都是 minimax2api_error；再按消息关键词兜底。
    const isGatewayError = type === 'minimax2api_error' ||
      SUBSCRIPTION_RE.test(message) ||
      NO_ACCOUNT_RE.test(message) ||
      OVERLOADED_RE.test(message) ||
      UPSTREAM_BROKEN_RE.test(message) ||
      MODEL_RE.test(message)
    if (!isGatewayError) return undefined
    // 网关已经给了数字 code 就用它（范围合法时）；否则按消息推断；都没有兜底 502。
    let code = typeof err['code'] === 'number' && err['code'] >= 400 && err['code'] <= 599 ? err['code'] : undefined
    if (SUBSCRIPTION_RE.test(message)) code = 503
    else if (NO_ACCOUNT_RE.test(message)) code = 503
    else if (MODEL_RE.test(message)) code = 400
    else if (OVERLOADED_RE.test(message)) code = code === 429 ? 429 : 503
    else if (UPSTREAM_BROKEN_RE.test(message)) code = 502
    if (code === undefined) code = 502
    return { error: { message: message || 'upstream error', type: 'upstream_error', code } }
  },

  /**
   * 非流式 HTTP 200 业务错误：给真实状态码，让客户端能正确重试或提示。
   * 与 translateBusinessError 共用同一套消息→状态码推断。
   */
  statusForError(chunk) {
    if (chunk === null || typeof chunk !== 'object') return undefined
    const err = chunk['error']
    if (err === null || typeof err !== 'object') return undefined
    const type = typeof err['type'] === 'string' ? err['type'] : ''
    const message = String(err['message'] ?? '')
    if (type !== 'minimax2api_error' && !SUBSCRIPTION_RE.test(message) && !NO_ACCOUNT_RE.test(message) &&
      !OVERLOADED_RE.test(message) && !UPSTREAM_BROKEN_RE.test(message) && !MODEL_RE.test(message)) {
      return undefined
    }
    if (SUBSCRIPTION_RE.test(message) || NO_ACCOUNT_RE.test(message)) return 503
    if (MODEL_RE.test(message)) return 400
    if (OVERLOADED_RE.test(message)) return 429
    if (UPSTREAM_BROKEN_RE.test(message)) return 502
    return typeof err['code'] === 'number' && err['code'] >= 400 && err['code'] <= 599 ? err['code'] : 502
  },

  /**
   * 规则层「断流收尾帧」钩子：上游没发 finish_reason 就断流、且规则包决定不补
   * 合成 stop 时，pipeStream 会拿 meta 来问「这轮该给客户端发什么错误帧」。
   * 思考阶段断流（只发过 reasoning_content、没正文没工具调用）给出明确错误帧，
   * 而不是让客户端把思考草稿当答案。
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
   * 思考阶段就被掐断。补 stop 会把思考草稿当成最终答案——必须拒绝补。
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
   * minimax-agent 是「自动规划并调用工具」的 Agent 模型，长上下文下同样会宣告
   * 「让我检查一下…」然后 stop 不带 tool-call。规则层检测到这种不完整轮后，
   * proxy 会自动追加「继续执行」消息重发一次，逼模型真正发出工具调用。
   *
   * meta: { sawFinishReason, sentAnything, sawContent, sawToolCall, contentText }
   * 返回 true 表示这轮不完整，proxy 应该续推。
   */
  isIncompleteTurn(model, meta) {
    if (meta === null || typeof meta !== 'object') return false
    if (meta.sawContent !== true) return false
    if (meta.sawToolCall === true) return false
    if (meta.sawFinishReason !== true) return false
    // 只有「最后一句」是意图宣告（让我/我来/I'll…）且本轮没发工具调用，才算不完整轮。
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
