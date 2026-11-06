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
 * 所以这里主要做 OpenAI 规范内、不改语义的事：
 *   1. 删掉上游根本不认识的采样字段（`reasoning` / `thinking` / `reasoning_effort`）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. `finish_reason` 异常值与 null `content` 兜底，避免客户端卡在「未结束」。
 *
 * 此外，针对星火上游对「API 反代」的间歇性风控采样（见下方两处），本层额外：
 *   4. 在请求体注入一方客户端元数据 `request_purpose` / `msg_id` / `turn_id`——
 *      vendored 网关有现成扩展点把它们转成 `X-Loomy-Request-Purpose` 等头
 *      （server.py:1662-1670），让经本代理转发的裸 OpenAI 请求带上官方客户端头，
 *      不再被上游识别成反代；
 *   5. 把上游那句已知的瞬时 400「请求有误，请重试」判定为可重试，用短退避
 *      把重试摊出风控窗口。
 * 这两处都只改本 rules 层、不动 vendored 网关，以后升级覆盖 vendor 不会冲掉。
 *
 * @module dsh-api-rules/rules/loomy
 */

import { randomUUID } from 'node:crypto'

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
   * 请求整形：删掉上游不认识的字段，把 Responses API 的 max 叫法归一到 `max_tokens`，
   * 并注入一方客户端元数据（详见文件头第 4 点）。角色、图片、工具一律不动。
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

    // 星火上游对「API 反代」有间歇性风控采样：经 8788 转发的裸 OpenAI 请求不带
    // 任何官方客户端头，会在特定时间窗内成簇回 400「请求有误，请重试」，窗口过后自愈。
    // vendored 网关 server.py:1662-1670 有个现成扩展点：把 body 里的
    //   request_purpose -> X-Loomy-Request-Purpose 头（值须在 constants.REQUEST_PURPOSES 内）
    //   msg_id          -> MsgId 头
    //   turn_id         -> TurnId 头
    // 从 req 里 pop 出来再发给上游，所以这些字段不会污染上游请求体，只会变成官方头。
    // 只注入这三个「每次请求」级别的字段：不注入 chat_id，因为它会被 session_key()
    // （server.py:1621，早于 pop）抢先消费、把粘性键从 d-<...> 改成 c-<...>，
    // 一旦每轮用新 UUID 就会在多账号池下每轮换号、破坏会话粘性。
    // 值用真实 UUID，贴近官方桌面客户端；payload 在 proxy 层只 stringify 一次，
    // 因此 postWithRetry 的多次尝试会复用同一组 id（幂等正确）。
    body['request_purpose'] = 'chat.message'
    body['msg_id'] = randomUUID()
    body['turn_id'] = randomUUID()
    notes.push('injected loomy client metadata')

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
   *
   * 另外，星火上游对「API 反代」的间歇性风控会成簇回同一个已知瞬时 400
   * 「请求有误，请重试；若多次出现请更新应用版本」。网关内部 1s×3 的原地重试常
   * 全撞在同一风控窗口里、用尽后把这个 400 透传出来；此时用本层已有的 2s/4s
   * 短退避再试，能把重试摊到窗口之后。只认这句特定文案 + status 400，避免误重试
   * 真正坏掉的 400（如「messages 不能为空」、非 chat 模型的 400 指路）。
   */
  isRetryable({ status, text }) {
    if (status === 429 || status === 502 || status === 503 || status === 504) return true
    if (status === 400 && typeof text === 'string' && text.includes('请求有误')) return true
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
