/**
 * 通用规则包：任何 OpenAI 兼容上游都能用的最小归一。
 *
 * 这一包的存在是为了让「新接一个 API」有个安全的起点——它只做 OpenAI 规范内、
 * 不改变语义的清理，不假设任何供应商的怪癖。
 *
 * @module dsh-api-rules/rules/generic
 */

/** 上游普遍不认识的采样字段；带着它们只会换来 400。 */
const UNSUPPORTED_PARAMS = ['reasoning', 'reasoning_effort', 'thinking']

export const genericRules = {
  name: 'generic',

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

  /** 通用包不知道模型能力，保守按纯文本处理由调用方决定；这里不剥离图片。 */
  supportsImages() {
    return true
  },
}
