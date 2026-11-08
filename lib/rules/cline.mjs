/**
 * cline2api（https://github.com/luawei1/cline2api）规则包。
 *
 * cline2api 本身已经是一个 OpenAI 兼容的反向代理，绝大多数「供应商怪癖」都已经在
 * 它那一侧消化掉了：
 *   - `max_tokens` 过低兜底到默认值、过高按模型硬上限封顶（providers.go / proxy.go）；
 *   - `role: developer`、图片、DSH 形状的 assistant 内容都自行清洗（sanitizeMessages）；
 *   - `reasoning_effort` / `thinking` 自家上游认识，按原样透传；
 *   - 工具调用（`tool_choice`、孤儿 tool 结果）由代理层归整。
 *
 * 因此这一层**只做 OpenAI 规范内、不改语义的清理**，以及在 proxy 层统一的可重试错误
 * 判定。真正的「进程拉起」不在这里，而在 lib/launcher.mjs + 路由上的 `launch` 字段
 * （见 cordis.patch.yml 里 cline 路由的配置）——本包只负责请求/响应整形。
 *
 * ## 本层真正要修的（2026-11-08）：「把思考过程输出作为答案」
 *
 * 决定性取证（本机 3457 真机 + 8788 规则层 + app.asar 里 pi-ai 的解析）：
 *   - cline2api 的免费模型（nemotron-3.5-super-vl / solar-mini4 / lightning-free）
 *     是**重思考**模型：一次回答先吐几百帧 `delta.reasoning`（OpenRouter 风格，
 *     同时带 `delta.reasoning_details`），思考期间 `delta.content` 缺席；收敛后才
 *     吐 `delta.content:"5"`，最后 `finish_reason:"stop"` + usage + [DONE]。
 *     非流式则是 message 带 `reasoning` / `reasoning_details`，`content` 才是答案。
 *   - **思考字段名是 `reasoning`，不是 `reasoning_content`。** 本插件框架
 *     （lib/proxy.mjs 的 pipeStream / aggregateSse）只认 `reasoning_content`：
 *     既不会把它累积进「思考死循环检测」的 reasoningText，也不会在 SSE 聚合时
 *     单独带出思考。客户端 pi-ai 虽然能读 `delta.reasoning`（reasoningFields =
 *     ["reasoning_content","reasoning","reasoning_text"]）并渲染成独立 thinking 块，
 *     但那只在**流正常收尾**时才正确。
 *   - 这些免费模型上游不稳：`.cline-request-logs.json` 里有一条 durationMs:420796
 *     （≈7 分钟）、completed:false、error:"no active accounts available..." 的实证；
 *     规则层 120s 超时 / 网关换号失败都会让流**停在纯思考阶段**断掉。
 *   - 旧版本包 `ensureFinishReason()` 恒返回 true：纯思考截断流（发过东西、但
 *     没有正文/工具调用/finish_reason）到这里，pipeStream 会补一帧合成的
 *     `finish_reason:'stop'`。客户端于是把「只发了一堆 thinking、没有答案」当成
 *     一次**干净完成的回答**——用户看到的就是「思考过程被当成了答案」。
 *     这与 loomy.mjs 的 spark-x2.6、qoder.mjs 记录的同构坑完全一致。
 *
 * 修复（与 loomy.mjs / qoder.mjs 同一套钩子，判定与文案都放在规则包里，框架只调用）：
 *   1. `normalizeDelta`：把 cline 的 `delta.reasoning` **镜像**成 `reasoning_content`
 *      （保留原 `reasoning` 与 `reasoning_details`，纯增量、不改客户端既有渲染），
 *      让框架的思考累积 / 死循环检测 / SSE 聚合「看得见」cline 的思考；
 *   2. `thinkingLimitFrame`：照搬 loomy 的重复 n-gram + 停滞兜底，掐断无限思考；
 *   3. `translateBusinessError` / `statusForError`：识别 cline2api 的流内 / HTTP 200
 *      业务错误帧（模型 disabled、no active accounts、上游断流/超时），翻成标准
 *      OpenAI 错误帧并给真实状态码，别让错误被当成正文转发、再被合成 stop 盖掉；
 *   4. `streamAbortFrame`：纯思考截断时给出明确错误帧，而不是补合成 stop；
 *   5. `ensureFinishReason(model, meta)`：接收 pipeStream 的「这轮流发过什么」快照，
 *      纯思考截断返回 false（meta 缺省时保持原行为 true，向后兼容）。
 *
 * 只改本 rules 层，vendored cline2api / app.asar / 框架 proxy.mjs 一行不动。
 *
 * @module dsh-api-rules/rules/cline
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/** 上游普遍不认识的采样字段（Anthropic 风格的叫法，OpenAI 侧不该带）。 */
const UNSUPPORTED_PARAMS = ['reasoning', 'thinking']

/**
 * 网关错误帧里 `type` 到 HTTP 状态码的映射（与 qoder.mjs 一致，保证跨包同码）。
 * cline2api 的流内 / HTTP 200 业务错误都用这些 OpenAI 风格的 type。
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
}

/** cline2api「上游断流 / 读超时 / 空流」类消息（含 120s 规则层超时关响应体）。 */
const UPSTREAM_BROKEN_RE = /上游流中断|upstream stream (broken|error)|empty upstream stream|upstream unreachable|stream.*timed? ?out|read timeout|context deadline exceeded/i

/** cline2api「整池无可用账号 / 未登录」消息（.cline-request-logs.json 里 7 分钟挂起实证）。 */
const NO_ACCOUNT_RE = /no active accounts|no usable account|account pool|not logged in|please (login|log in)|use --login/i

/** 限流 / 排队类消息（网关 429 / 团队账号限流 isQueued）。 */
const RATE_LIMIT_RE = /rate.?limit|too many requests|is queued|queue full/i

// —— 思考死循环检测阈值（与 loomy.mjs 一致，已用 dbg 脚本标定）——
// 尾窗：只在 reasoning 全文尾部这么长的范围内做重复统计，控制每帧成本。
const TAIL_WINDOW = 1000
// 重复 n-gram 长度：24 字。太短易误杀，太长漏检。
const REPEAT_N = 24
// 同一 24 字片段在尾窗里出现超过此次数 → 判死循环（合法长思考尾窗内最多 1 次）。
const REPEAT_THRESHOLD = 8
// 停滞兜底：思考帧数超过此值仍无正文/工具调用/finish_reason → 判死循环。
const STAGNATION_CHUNKS = 6000

/** 从错误帧推一个 HTTP 状态码；流式与非流式两条路径共用，保证同一种错误同码。 */
function errorStatus(err) {
  const type = typeof err['type'] === 'string' ? err['type'] : ''
  const message = String(err['message'] ?? '')
  const rawCode = err['code']
  if (NO_ACCOUNT_RE.test(message) || type === 'overloaded_error') return 503
  if (type === 'rate_limit_error' || RATE_LIMIT_RE.test(message)) return 429
  if (UPSTREAM_BROKEN_RE.test(message) || type === 'upstream_error' || type === 'server_error') return 502
  if (ERROR_TYPE_STATUS[type] !== undefined) return ERROR_TYPE_STATUS[type]
  if (typeof rawCode === 'number' && rawCode >= 400 && rawCode <= 599) return rawCode
  return 502
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

export const clineRules = {
  name: 'cline',

  /**
   * 请求整形：删掉上游不认识的字段，把 Responses API 的 max 叫法归一到 `max_tokens`。
   * 不带任何语义改写（角色、图片一律不动）。
   */
  normalizeRequest({ body, model }) {
    const notes = []
    // 档位翻译放在删字段之前：reasoning: {effort} 这种对象形式也要能读到。
    applyReasoningEffort('cline', model, body, notes)
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
    const wrapped = body && typeof body === 'object' ? normalizeToolParameters(body['tools']) : 0
    if (wrapped > 0) {
      notes.push('wrapped ' + wrapped + ' flat tool parameter root(s) into {type:object,properties}')
    }
    return { body, notes }
  },

  /** cline2api 上游自己会按模型能力处理多模态，本层不预先剥离图片。 */
  supportsImages() {
    return true
  },

  /** 网关抖动 / 限流都可重试；cline2api 把上游 429 透传下来。400 确定性失败不重试。 */
  isRetryable({ status }) {
    return status === 429 || status === 502 || status === 503 || status === 504
  },

  isConcurrencyError() {
    return false
  },

  backoffMs({ attempt }) {
    return Math.min(5000 * 2 ** attempt, 30_000)
  },

  retryBudgetMs() {
    return 30_000 * 2 ** 6
  },

  maxAttempts() {
    return 6
  },

  cooldownMs() {
    return 0
  },

  /**
   * 把 cline2api 的流内 / HTTP 200 业务错误帧翻成标准 OpenAI 错误帧。
   *
   * cline2api 的错误形状没有 qoder/loomy 那样逐条编目（实测有
   * `{"error":{"message":"model ... is disabled","type":"invalid_request_error"}}`
   * 与日志里的 "no active accounts available..."，还可能有上游断流/超时帧），
   * 所以这里采取**保守但更稳**的判定：SSE 帧或 completion 里只要带 `error` 对象，
   * 本身就是错误（正常 chunk / chat.completion 绝不会有 error 字段），一律翻译。
   * 这样任何错误帧都不会被当普通 chunk 转发、再被合成的 finish_reason:'stop'
   * 盖成「空白成功」。返回 undefined 才表示「不是本包该管的」。
   */
  translateBusinessError(chunk) {
    if (!isObject(chunk)) return undefined
    const err = chunk['error']
    if (!isObject(err)) return undefined
    const message = String(err['message'] ?? '')
    const code = errorStatus(err)
    return { error: { message: message || 'upstream error', type: 'upstream_error', code } }
  },

  /** 非流式 HTTP 200 业务错误：给真实状态码，让客户端能正确重试或提示。 */
  statusForError(chunk) {
    if (!isObject(chunk)) return undefined
    const err = chunk['error']
    if (!isObject(err)) return undefined
    return errorStatus(err)
  },

  /**
   * 规则层「断流收尾帧」钩子：上游没发 finish_reason 就断流、且规则包决定不补
   * 合成 stop 时，pipeStream 拿 meta 来问「这轮该给客户端发什么错误帧」。
   * 纯思考截断（只发过思考、没正文没工具调用）给出明确错误帧，而不是让客户端
   * 把思考草稿当答案。meta: { sawFinishReason, sentAnything, sawContent, sawToolCall }
   */
  streamAbortFrame(meta) {
    if (!isObject(meta)) return undefined
    if (meta.sawFinishReason === true) return undefined
    if (meta.sentAnything !== true) return undefined
    if (meta.sawContent !== true && meta.sawToolCall !== true) {
      return { error: { message: 'upstream stream aborted during thinking (no content emitted)', type: 'upstream_error', code: 502 } }
    }
    return undefined
  },

  /**
   * 规则层「思考死循环检测」钩子（与 loomy.mjs 同构，依赖 normalizeDelta 把
   * cline 的 delta.reasoning 镜像成 reasoning_content 后框架才看得见思考文本）。
   *
   * 两级判定，命中任一即让 pipeStream 主动终止流：
   *   1. 尾部重复：取 reasoning 全文尾部 1000 字，滑窗统计 24 字 n-gram，
   *      某片段出现 >8 次 → 强死循环信号（正常推理不会在 1000 字窗口里复述 8 遍）。
   *   2. 停滞兜底：思考帧数 > 6000 却始终无正文/工具调用/finish_reason → 判死。
   *
   * 收尾帧用 finish_reason:'length'（OpenAI 标准枚举，DSH 一定认识）：语义精确
   * （思考预算耗尽被截断），已转发的思考 chunk 保留给用户看「思考到哪卡住」，
   * 总比十几分钟黑盒转圈强。meta 缺字段时返回 undefined，行为不变（向后兼容）。
   *
   * @param {{reasoningText?: string, reasoningChunks?: number}} meta pipeStream 给的思考累积快照
   */
  thinkingLimitFrame(meta) {
    if (!isObject(meta)) return undefined
    const text = typeof meta.reasoningText === 'string' ? meta.reasoningText : ''
    const chunks = typeof meta.reasoningChunks === 'number' ? meta.reasoningChunks : 0
    let reason = null
    if (text.length >= TAIL_WINDOW) {
      const tail = text.slice(-TAIL_WINDOW)
      const grams = new Map()
      for (let i = 0; i + REPEAT_N <= tail.length; i++) {
        const g = tail.slice(i, i + REPEAT_N)
        const c = (grams.get(g) ?? 0) + 1
        grams.set(g, c)
        if (c > REPEAT_THRESHOLD) { reason = 'repetition'; break }
      }
    }
    if (reason === null && chunks > STAGNATION_CHUNKS) reason = 'stagnation'
    if (reason === null) return undefined
    return {
      id: 'api-rules-thinking-limit',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'length',
      }],
      _thinking_loop: { reason, reasoningChunks: chunks, reasoningChars: text.length },
    }
  },

  /** `other` 不是 OpenAI 认识的值；不映射会让客户端停在「未结束」。 */
  finishReason(value) {
    if (value === null || value === undefined || value === 'other') return 'stop'
    return value
  },

  /**
   * 响应增量整形：
   *  - `content === null` 归一成空串（部分客户端把 null chunk 当「没有响应」）；
   *  - 把 cline2api 的 `delta.reasoning` 镜像成 `reasoning_content`。
   *
   * **为什么是镜像（保留原字段）而不是改名/删除**：cline2api 把思考放在
   * `delta.reasoning`（OpenRouter 风格），而框架 lib/proxy.mjs 的 pipeStream /
   * aggregateSse 只从 `reasoning_content` 累积思考文本。镜像后：
   *   - 框架的死循环检测（thinkingLimitFrame）与 SSE 聚合才「看得见」cline 的思考；
   *   - 纯增量，客户端 pi-ai 的 reasoningFields 取第一个非空字段，仍是同一个
   *     thinking 块（reasoning_content 命中即 break，reasoning_details 只是回放
   *     元数据、不追加文本），不会重复、也不会把思考混进正文答案；
   *   - 其它只认 `reasoning` 的客户端照旧能读，零回归。
   * `reasoning_content` 已非空时不覆盖（避免同帧双字段时把已有内容冲掉）。
   */
  normalizeDelta(delta) {
    if (!isObject(delta)) return
    if (delta['content'] === null) delta['content'] = ''
    if (typeof delta['reasoning'] === 'string' && delta['reasoning'].length > 0) {
      if (typeof delta['reasoning_content'] !== 'string' || delta['reasoning_content'].length === 0) {
        delta['reasoning_content'] = delta['reasoning']
      }
    }
  },

  /**
   * 断流时是否补 finish_reason。meta 是 pipeStream 给的「这轮流发过什么」快照：
   * 只发了思考、没有正文/工具调用、也没收到 finish_reason，说明上游在思考阶段
   * 就被掐断（cline 免费模型长思考 + 120s 超时 / no active accounts）。补 stop 会把
   * 思考草稿当成最终答案——必须拒绝补，让 pipeStream 改问 streamAbortFrame。
   * meta 缺省（旧调用方）保持原行为 true，向后兼容。
   */
  ensureFinishReason(model, meta) {
    if (meta === undefined || meta === null) return true
    if (meta.sawFinishReason === true) return true
    if (meta.sentAnything === true && meta.sawContent !== true && meta.sawToolCall !== true) return false
    return true
  },
}
