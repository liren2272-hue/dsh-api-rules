/**
 * loomy2api（https://github.com/xingluoyuankong/loomy2api）规则包。
 *
 * loomy2api 是讯飞星火 Loomy 平台的 OpenAI/Anthropic 兼容网关：它维护一个多账号池，
 * 对外暴露 `/v1/chat/completions`、`/v1/messages`、`/v1/models`，模型 id 原样透传
 * （剥掉 `provider/` 前缀）。源码内嵌在本插件的 `vendor/loomy2api/`，由路由上的
 * `launch` 在插件启动时自动拉起（见 cordis.patch.yml 的 loomy 路由）。
 *
 * 也就是说，「供应商怪癖」已经在 loomy2api 那一侧消化掉了：
 *   - 换号 / 账号冷却 / 上游 429、401、402、403、5xx 的重试都在它内部
 *     （`max_retries`、`cooldown_seconds`），本层**不要**再叠一层长时间退避——
 *     否则「换个账号重试」这条路径会被自己的退避拖死（与 raccoon 同构）；
 *   - 非流式长任务它会在内部转成流式再聚合成完整响应；
 *   - 会话粘性（sticky）由它按客户端提示派生，本层不干预。
 *
 * 所以这里只做三件 OpenAI 规范内、不改语义的事：
 *   1. 删掉上游根本不认识的采样字段（`reasoning` / `thinking` / `reasoning_effort`）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. `finish_reason` 异常值与 null `content` 兜底，避免客户端卡在「未结束」。
 *
 * @module dsh-api-rules/rules/loomy
 */

/**
 * 上游（以及 loomy2api）不认识的采样字段。
 *
 * `reasoning_effort` 也在内：即便某些 Loomy 上游模型有「思考强度」概念，它也由
 * loomy2api 的配置项下发，客户端在请求体里塞同名字段只会被当成未知字段剔除或写进
 * 日志，透传没有收益（与 raccoon2api 的取舍一致）。
 */
const UNSUPPORTED_PARAMS = ['reasoning', 'reasoning_effort', 'thinking']

export const loomyRules = {
  name: 'loomy2api',

  /**
   * 请求整形：删掉上游不认识的字段，把 Responses API 的 max 叫法归一到 `max_tokens`。
   * 不带任何语义改写（角色、图片、工具一律不动）。
   */
  normalizeRequest({ body }) {
    const notes = []
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
    return { body, notes }
  },

  /**
   * 图片原样透传。
   *
   * loomy2api 把多模态请求原样交给上游，模型能不能看图由上游决定（视觉模型在
   * cordis.patch.yml 里用 `input: [text, image]` 标记；纯文本模型不带该标记，
   * DSH 就不会给它们送图）。本层不预先剥离图片。
   */
  supportsImages() {
    return true
  },

  /**
   * 只把「上游明确说可以立刻重来」的判定为可重试。
   *
   * 429 / 5xx 在 loomy2api 里意味着「这个账号被冷却、已经换下一个账号重试过了」，
   * 到这里还失败说明整池都不可用，短退避再试一次是合理的；而 402 与业务码（积分不足）
   * 在同一段时间内必然继续失败，重试只会白烧复述。
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
