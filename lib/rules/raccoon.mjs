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
 * 所以这里只做三件 OpenAI 规范内的、不改语义的事：
 *   1. 删掉上游根本不认识的采样字段（`reasoning` / `thinking`）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. `finish_reason: "other"` 与 null `content` 兜底，避免客户端卡在「未结束」。
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
}
