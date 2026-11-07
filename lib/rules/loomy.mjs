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
 * ## 本层真正要修的（2026-11-06，决定性复现）
 *
 * 选 spark-x2.6 时：不带 tools 的小请求（标题生成等 warm-up）能正常出字，但每个
 * 带完整 DSH 工具数组的会话主轮次都确定性 400：
 *   {"error":{"message":"请求有误，请重试；若多次出现请更新应用版本",
 *    "type":"invalid_request_error","code":400,
 *    "metadata":{"provider_name":"iflytek-spark-loomy"}}}
 * 此前误判为「上游对 API 反代的间歇性风控」或「应用版本过旧」——都不是。逐跳二分
 * 定位到真实变量：DSH 随主轮次带上的 `tools` 里，部分工具的 `parameters` 不是合法
 * JSON Schema 外壳，而是「裸属性表」（参数名直接铺在根上），且其中恰有一个参数就叫
 * `type`（例如 cnki_search 的 all/journal/thesis）。iflytek-spark-loomy 把根级 `type`
 * 当成 schema 关键字去解析 → 判定参数非法 → 整条请求 400。标题 warm-up 不带 tools
 * 所以成功；主轮次带全量 tools 所以每轮必 400。这同时解释了「按时间成簇」的假象
 * （其实只是「哪几分钟选中了 spark-x2.6 跑主轮次」）。
 *
 * 决定性消融（8788 规则链 → 17890 网关 → 上游，见会话内 probe_flat_tools.py）：
 *   - 2 / 99 个合规 object 外壳 tools         → 200
 *   - +1 个裸根（含 `type` 键）               → 400（同一句 iflytek-spark-loomy）
 *   - 该裸根补 `{type:object, properties}`    → 200
 *   - 裸根但把 `type` 改名成 `kind`（不补壳） → 200（隔离出根级 `type` 才是触发点）
 *   - 93 合规 + 6 裸根（贴近真实的混合）      → 400
 *   - 6 个全部补壳                            → 200
 *
 * 这与同插件 `officeace.mjs` 记录的 ModelArts 81001 案例是同一类根因（那边已用
 * 同样的补壳修复）。本包沿用其 `wrapFlatParameters` 思路、独立实现一份，不 import
 * officeace（避免跨规则包耦合）；只改本 rules 层，vendored 网关一行不动，以后升级
 * 覆盖 vendor 不会冲掉修复。
 *
 * 所以这里主要做 OpenAI 规范内、不改语义的事：
 *   1. 删掉上游根本不认识的采样字段（`reasoning` / `thinking`）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. 给 `tools` 里不合规的裸 `parameters` 补上标准 object 外壳（**真正的修复**）；
 *   4. `finish_reason` 异常值与 null `content` 兜底，避免客户端卡在「未结束」。
 *
 * @module dsh-api-rules/rules/loomy
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/**
 * 上游（以及 loomy2api）不认识的采样字段。
 *
 * `reasoning_effort` 不再剥离：vendored loomy2api 的 server.py:1371-1375 会读请求体里的
 * `reasoning.effort` / `reasoning_effort` 并透传给上游，`/v1/models` 也逐模型暴露了
 * `reasoning_efforts`（见 cordis.patch.yml 里 loomy2api 的 reasoningEfforts 声明）。
 * 只有 `reasoning`（对象形式）与 `thinking` 这种上游不认识的字段才在这里删掉。
 */
const UNSUPPORTED_PARAMS = ['reasoning', 'thinking']

export const loomyRules = {
  name: 'loomy2api',

  /**
   * 请求整形：删掉上游不认识的字段、把 Responses API 的 max 叫法归一到 `max_tokens`，
   * 并给 `tools` 里不合规的裸 `parameters` 补上标准外壳（详见文件头「真正的修复」）。
   * 角色、图片、消息一律不动。
   */
  normalizeRequest({ body, model }) {
    const notes = []
    // 档位翻译放在删字段之前：reasoning: {effort} 这种对象形式也要能读到。
    applyReasoningEffort('loomy2api', model, body, notes)
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

    // spark-x2.6 的确定性 400 就来自这里：DSH 主轮次的全量 tools 里有裸属性表参数
    // （根级 `type` 键）。补成合规 object 外壳后，上游 schema 校验即可通过。
    // 合规外壳、缺失/非对象 parameters、非数组 tools 全部原样放行（见上面的函数）。
    const wrapped = body && typeof body === 'object' ? normalizeToolParameters(body['tools']) : 0
    if (wrapped > 0) {
      notes.push('wrapped ' + wrapped + ' flat tool parameter root(s) into {type:object,properties}')
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
   *
   * 400 一律不重试：tools 补壳后那句 iflytek-spark-loomy 的 400 已不会再出现；
   * 万一出现别的 400（空 messages、参数非法），它是确定性失败，重试不会改变结果，
   * 且实测曾把网关 keep-alive 连接拖出二次错误「messages 不能为空」，反而把真正的
   * 错误盖掉。之前给「请求有误」这句 400 加的重试已据此移除。
   */
  isRetryable({ status }) {
    if (status === 429 || status === 502 || status === 503 || status === 504) return true
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
