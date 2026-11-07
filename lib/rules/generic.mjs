/**
 * 通用规则包：任何 OpenAI 兼容上游都能用的最小归一。
 *
 * 这一包的存在是为了让「新接一个 API」有个安全的起点——它只做 OpenAI 规范内、
 * 不改变语义的清理，不假设任何供应商的怪癖。
 *
 * @module dsh-api-rules/rules/generic
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/**
 * 上游普遍不认识的采样字段；带着它们只会换来 400。
 *
 * reasoning_effort 不再在这里剥离：DSH 模型选择器的「思考强度」档位就是靠它下发的，
 * 而 officeace / loomy / codearts 这些上游已实测接受并生效（见 cordis.patch.yml 里各模型的
 * reasoningEfforts 探针注释）。只有真正忽略或不支持它的上游（raccoon2api——CPA 侧只认配置里的
 * reasoning_effort）才在自己的规则包里继续剥离。
 */
const UNSUPPORTED_PARAMS = ['reasoning', 'thinking']

export const genericRules = {
  name: 'generic',

  normalizeRequest({ body, model, provider }) {
    const notes = []
    // 档位翻译放在删字段之前：reasoning: {effort} 这种对象形式也要能读到。
    applyReasoningEffort(provider || 'generic', model, body, notes)
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

  /** 通用包不知道模型能力，保守按纯文本处理由调用方决定；这里不剥离图片。 */
  supportsImages() {
    return true
  },
}
