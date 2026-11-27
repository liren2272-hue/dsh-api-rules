/**
 * raccoon2api（https://github.com/JustCnc/raccoon2api）规则包。
 *
 * raccoon2api 不是独立进程，而是 CLIProxyAPI（CPA）的一个 Go 动态库插件：
 * CPA 把自己伪装成「小浣熊（Office Raccoon）桌面客户端」去请求上游
 * `https://xiaohuanxiong.com/api/web/llm/v2`，对外仍然只暴露 CPA 的标准
 * OpenAI 端点 `/v1/chat/completions` 与 `/v1/models`，模型 id 一律带
 * `raccoon/` 前缀（例如 `raccoon/sn-glm-5-3-flash`）。
 *
 * 也就是说，「供应商怪癖」已经在 CPA 的 raccoon2api 插件里消化掉了：
 *   - 只转发上游认识的字段（上游对未知字段直接 500 `Unexpected keyword argument`）；
 *   - `max_completion_tokens` 改名为 `max_tokens`，缺 `max_tokens` 时补默认值；
 *   - 流式强制 `stream_options.include_usage`；`function` 角色改成 `tool`/`user`；
 *   - 重试 / 换号 / 账号冷却（429、5xx、401、积分不足 402/`1000007`）都在插件里，
 *     冷却时长可配（`cooldown_seconds`、`quota_cooldown_seconds`），本层不要再叠一层
 *     长时间退避——那只会让「换个账号重试」这条路径被自己的退避拖死；
 *   - 会话稳定性靠 `X-RACCOON-Session-ID` / `X-RACCOON-Turn-ID`，由 CPA 插件按
 *     客户端提示派生，本层不干预。
 *
 * 所以这里只做四件 OpenAI 规范内的、不改语义的事：
 *   1. 删掉上游根本不认识的采样字段（`reasoning` / `thinking`）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. `finish_reason: "other"` 与 null `content` 兜底，避免客户端卡在「未结束」；
 *   4. **早停续推**（2026-11-27）：sensenova 在 OPS/PTC 模式下常常在正文里写
 *      「我读一下…」「让我检查…」却不发 tool_calls 就以 stop 收尾，用户看到的就是
 *      「只说一句话就瞬间结束对话」。`isIncompleteTurn` 判定这种不完整轮后，
 *      proxy.mjs 的通用续推块自动追加一条「继续执行」消息重发一次（与 qoder.mjs 同构）。
 *
 * 进程拉起不在这里，而在 lib/launcher.mjs + 路由上的 `launch` 字段
 * （见 cordis.patch.yml 里 raccoon 路由的配置）——它负责把 CPA 本体拉起来。
 *
 * @module dsh-api-rules/rules/raccoon
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/**
 * 上游（以及 CPA 插件）不认识的采样字段。
 *
 * `reasoning_effort` 不在此列：raccoon2api 插件会把它透传给上游并归一化
 * （off/none/minimal → low；low/medium/high 保留；GLM/Kimi 的 medium → high）。
 * 客户端带了 `reasoning_effort` 就以客户端为准，只有没带时才套用配置项
 * `reasoning_effort`（默认 low，也就是面板上看到的「思考强度 low」）。
 * 之前把它一并删掉，等于永远走配置默认值，选择器上的档位也传不进去。
 */
const UNSUPPORTED_PARAMS = ['reasoning', 'thinking']

/**
 * 「答一步就停」的意图宣告词。
 *
 * 只匹配**最后一句**：模型宣告要做某事（让我/我来/我先/I'll…）却没发工具调用就 stop，
 * 才算不完整轮。正常回答中间也可能出现「让我解释一下」，那不是早停。
 */
const INCOMPLETE_TURN_RE = /(?:让我|我来|我先|我这就|我读|我看|我查|我确认|我检查|我会|接下来|下面我|现在让我|let me |I'll |I will |I'm going to )/i

/** 续推最多重试次数（防止无限循环）。 */
const MAX_INCOMPLETE_TURN_RETRIES = 1

export const raccoonRules = {
  name: 'raccoon',

  /**
   * 请求整形：删掉上游不认识的字段，把 Responses API 的 max 叫法归一到 `max_tokens`。
   * 不带任何语义改写（角色、图片、工具一律不动）。
   */
  normalizeRequest({ body, model }) {
    const notes = []
    // 档位翻译放在删字段之前：reasoning: {effort} 这种对象形式也要能读到。
    applyReasoningEffort('raccoon', model, body, notes)
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

  /**
   * 图片原样透传。
   *
   * 上游对视觉能力只有 `tags.vision` 一个标记，而它并不可靠（`raccoon-8c4485`
   * 能看图却没有标记，`sn-glm-5-3` 有标记却看不见图）。取舍一致的做法是在 CPA 的
   * `vision_denylist` 里拉黑不可用的模型，本层不做第二套判断。
   */
  supportsImages() {
    return true
  },

  /**
   * 只把「上游明确说可以立刻重来」的判定为可重试。
   *
   * 429 / 5xx 在 raccoon2api 里意味着「这个账号被冷却、已经换下一个账号重试过了」，
   * 到这里还失败说明整池都不可用，短退避再试一次是合理的；而 402 与业务码
   * `1000007`（积分不足）在同一段时间内必然继续失败，重试只会白烧复述。
   */
  isRetryable({ status }) {
    return status === 429 || status === 502 || status === 503 || status === 504
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

  /** 流式响应缺失 finish_reason 时补一个，避免客户端一直转圈。 */
  ensureFinishReason() {
    return true
  },

  /**
   * 「答一步就停」续推判定（2026-11-27，sensenova 在 OPS/PTC 模式下一句话就结束）。
   *
   * sn-sensenova-6-8-flash 在长上下文 / 多工具（OPS 只有 run_code 一个入口）下常见：
   * 正文里写「我读一下它们的内容来做总结。」「让我检查一下…」然后 finish_reason=stop，
   * 却不真正发 tool_calls。客户端看到的就是「只说一句话就瞬间结束对话」。
   *
   * 这不是 CPA / raccoon2api 吞帧（无 stream aborted、无业务错误帧，finish_reason 是
   * 正常的 stop），而是模型自身的早停行为。与 qoder.mjs 同一套钩子：规则层判定「不完整
   * 轮」，proxy.mjs 的续推块自动追加一条「继续执行」消息重发一次，把续推响应接进同一个
   * SSE 流，客户端无感。
   *
   * meta: { sawFinishReason, sentAnything, sawContent, sawToolCall, contentText }
   */
  isIncompleteTurn(model, meta) {
    if (meta === null || typeof meta !== 'object') return false
    // 必须有正文、无工具调用、有正常 finish_reason（断流走 streamAbortFrame 那条路）
    if (meta.sawContent !== true) return false
    if (meta.sawToolCall === true) return false
    if (meta.sawFinishReason !== true) return false
    // 只看最后一句：正常完整回答中间出现「让我解释一下」，只要落到结论句就不续推。
    const text = typeof meta.contentText === 'string' ? meta.contentText : ''
    if (text.length === 0) return false
    const sentences = text
      .split(/[。！？.!?\n\r]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
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

  /** 续推最大重试次数（防止无限循环）。 */
  maxIncompleteTurnRetries() {
    return MAX_INCOMPLETE_TURN_RETRIES
  },
}
