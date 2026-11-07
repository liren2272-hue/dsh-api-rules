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
 * @module dsh-api-rules/rules/cline
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/** 上游普遍不认识的采样字段（Anthropic 风格的叫法，OpenAI 侧不该带）。 */
const UNSUPPORTED_PARAMS = ['reasoning', 'thinking']

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

  /** 网关抖动 / 限流都可重试；cline2api 把上游 429 透传下来。 */
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

  /** `other` 不是 OpenAI 认识的值；不映射会让客户端停在「未结束」。 */
  finishReason(value) {
    if (value === null || value === undefined || value === 'other') return 'stop'
    return value
  },

  /**
   * cline2api 流里 `content` 有时为 null（只有 reasoning 有值）。
   * 部分客户端把 null chunk 当成「没有响应」，空串才是同样语义的 OpenAI 形状。
   */
  normalizeDelta(delta) {
    if (typeof delta !== 'object' || delta === null) return
    if (delta['content'] === null) delta['content'] = ''
  },

  /** cline 流基本都带 finish_reason + [DONE]；只有完全缺失时才补。 */
  ensureFinishReason() {
    return true
  },
}
