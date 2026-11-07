/**
 * qoder2api-hub（https://github.com/shuishuipingan/qoder2api-hub）规则包。
 *
 * qoder2api-hub 是 Qoder（qoder.com.cn / qoder.com）官方桌面客户端的
 * OpenAI/Anthropic 兼容网关：它维护一个多账号池，对外暴露 `/v1/chat/completions`、
 * `/v1/messages`、`/v1/models`，模型 id 用目录里的 display_name（如 `Qwen3.8-Max`）。
 * 源码内嵌在本插件的 `vendor/qoder2api-hub/`（纯标准库 Python，无第三方依赖），
 * 由路由上的 `launch` 在插件启动时自动拉起（见 cordis.patch.yml 的 qoder2api-hub 路由）。
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
 * 所以这里只做 OpenAI 规范内、不改语义的事：
 *   1. 删掉上游不认识的对象形式 `reasoning`（`reasoning_effort` 保留）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. 给 `tools` 里不合规的裸 `parameters` 补上标准 object 外壳（防根级 `type` 歧义）；
 *   4. `finish_reason` 异常值与 null `content` 兜底，避免客户端卡在「未结束」。
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
