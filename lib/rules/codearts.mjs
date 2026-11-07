/**
 * 码道（CodeArts / 华为云 SnapAccess）规则包。
 *
 * 这里是 codearts2api 的 `vendor_guard/vendors/codearts.py` 在 DSH 侧的等价物。
 * 迁移的原则是**行为逐条对齐**，因为每一条都是被上游真实拒绝过才写下来的：
 *
 *   规则 1  max_tokens > 65536 不会报 400，而是 HTTP 200 开流后流内失败
 *           （InferHub.001001005.400），无法重放 —— 必须前置钳制。
 *   规则 2  `role: "developer"` 被拒（InferHub.001001044.400
 *           `Message role cannot empty`）—— 改写为 system。
 *   规则 3  纯文本模型收到图片被硬拒（InferHub.001001020.406
 *           `The request model is not multimodal`）—— 换成文字占位。
 *   规则 4  每账号只开 3 个并发会话，超出报 TM.00001041；且**中途停止不减免**，
 *           一个会话要占满约 60 秒 —— 本地闸门排队 + 退避重试，而不是把 400 甩给用户。
 *   规则 5  多模态模型必须带 Agent-Type 头（缺失报 TM.00001001）—— 由本插件的
 *           华为云签名器（lib/huawei.mjs）在签名时附加，本层不重复处理，只在这里记录归属。
 *
 * 与 Python 版的差异只有一处，且是刻意的：并发闸门的**等待**改用异步 sleep
 * （Python 是阻塞线程）。DSH 是单进程事件循环，阻塞会把整个 Host 冻住。
 *
 * @module dsh-api-rules/rules/codearts
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'

/** 规则 3 的占位文本。用中文，与 Python 版一致，便于对照日志。 */
export const IMAGE_PLACEHOLDER = '[图片已省略：当前模型不支持多模态输入]'

/** 规则 1 的硬天花板。 */
export const MAX_TOKENS_HARD_CAP = 65_536

/** 规则 5：Agent-Type 缺省值（与 codearts2api 的 CODEARTS_AGENT_TYPE 一致）。 */
export const DEFAULT_AGENT_TYPE = 'PromptCenter'

/**
 * 规则 4 的退避参数。
 *
 * 槽位释放是 TTL 驱动的（实测 45–60 秒），所以首次退避就给到 25 秒量级：
 * 在 5/10/20 秒的阶梯上先烧三次，等于必然在槽位还没释放时重试。
 */
export const CONCURRENCY = {
  firstBackoffMs: 25_000,
  nextBackoffMs: 40_000,
  jitterMs: 5_000,
  /** 撞上限后的全局冷却：让同时在飞的请求一起等，避免各自退避后形成惊群。 */
  cooldownMs: 25_000,
  /** 并发上限重试的时间预算（覆盖 45–60 秒 TTL 的两轮）。 */
  budgetMs: 150_000,
}

/** 其它可重试错误（网关 502 / 网络抖动）的指数退避。 */
export const TRANSIENT = { baseMs: 5_000, capMs: 30_000, maxAttempts: 8 }

/** 并发上限的判定：错误码或中文原文都算。 */
export function isConcurrencyText(text) {
  if (typeof text !== 'string') return false
  return text.includes('TM.00001041') || text.includes('并发会话数已达上限')
}

export const codeartsRules = {
  name: 'codearts',
  maxTokensHardCap: MAX_TOKENS_HARD_CAP,

  /** 规则 1：模型元数据声明的上限与硬天花板取小。 */
  maxTokensCap(model, modelInfo) {
    const declared = modelInfo?.maxTokens
    if (typeof declared === 'number' && declared > 0) return Math.min(declared, MAX_TOKENS_HARD_CAP)
    return MAX_TOKENS_HARD_CAP
  },

  /** 规则 1 + 2 + 3：全部在**发出去之前**完成。 */
  normalizeRequest({ body, model, modelInfo }) {
    const notes = []

    // 思考强度档位：声明在 cordis.patch.yml，翻译语义在本层（见 reasoning.mjs）。
    applyReasoningEffort('codearts', model, body, notes)

    // 规则 1：max_tokens 钳制。三种叫法都收，取最大意图再钳。
    const asked = [body['max_tokens'], body['max_completion_tokens'], body['max_output_tokens']].filter(
      (value) => typeof value === 'number' && value > 0,
    )
    if (asked.length > 0) {
      const intent = Math.max(...asked)
      const cap = this.maxTokensCap(model, modelInfo)
      const capped = Math.min(intent, cap)
      if (capped !== intent) notes.push('max_tokens ' + intent + ' -> ' + capped)
      body['max_tokens'] = capped
      delete body['max_completion_tokens']
      delete body['max_output_tokens']
    }

    // 上游不认识的采样字段。reasoning_effort 保留：codearts 直连华为 ModelArts，
    // 实测会校验并生效（见 cordis.patch.yml 里 codearts 的 reasoningEfforts 探针注释）。
    for (const key of ['reasoning', 'thinking']) delete body[key]

    const supportsImages = this.supportsImages(model, modelInfo)
    const messages = Array.isArray(body['messages']) ? body['messages'] : []
    let roleRewrites = 0
    let imagesStripped = 0
    for (const message of messages) {
      if (typeof message !== 'object' || message === null) continue
      // 规则 2：developer -> system
      if (message['role'] === 'developer') {
        message['role'] = 'system'
        roleRewrites += 1
      }
      // 规则 3：纯文本模型上的图片换占位，文本部分原样保留
      if (!supportsImages) {
        const content = message['content']
        if (Array.isArray(content)) {
          const kept = []
          for (const part of content) {
            if (typeof part === 'object' && part !== null && (part['type'] === 'image_url' || part['type'] === 'image')) {
              kept.push({ type: 'text', text: IMAGE_PLACEHOLDER })
              imagesStripped += 1
            } else {
              kept.push(part)
            }
          }
          message['content'] = kept
        } else if (typeof content === 'string' && content.includes('[image]')) {
          message['content'] = content.split('[image]').join(IMAGE_PLACEHOLDER)
          imagesStripped += 1
        }
      }
    }
    if (roleRewrites > 0) notes.push('developer->system x' + roleRewrites)
    if (imagesStripped > 0) notes.push('images->placeholder x' + imagesStripped)

    // 给 tools 里不合规的裸 parameters 补 object 外壳（消除根级 type 被当 schema 关键字）。
    const wrapped = body && typeof body === 'object' ? normalizeToolParameters(body['tools']) : 0
    if (wrapped > 0) {
      notes.push('wrapped ' + wrapped + ' flat tool parameter root(s) into {type:object,properties}')
    }

    return { body, notes }
  },

  /**
   * 规则 3 的判定依据：上游元数据的 supports_images。
   *
   * 拿不到元数据时按**纯文本**处理。这个方向的误判代价不对称：把图剥掉，模型少看见
   * 一张图；把图发过去，整个请求 406 失败且重试无用。
   */
  supportsImages(model, modelInfo) {
    if (typeof modelInfo?.supportsImages === 'boolean') return modelInfo.supportsImages
    return false
  },

  /** 规则 4：并发上限与网关抖动都可重试。 */
  isRetryable({ status, text }) {
    if (status === 502 || status === 503 || status === 504) return true
    if (status === 400 && isConcurrencyText(text)) return true
    return false
  },

  isConcurrencyError(text) {
    return isConcurrencyText(text)
  },

  backoffMs({ attempt, concurrency }) {
    if (concurrency) {
      const base = attempt === 0 ? CONCURRENCY.firstBackoffMs : CONCURRENCY.nextBackoffMs
      const jitter = Math.round((Math.random() * 2 - 1) * CONCURRENCY.jitterMs)
      return Math.max(1000, base + jitter)
    }
    return Math.min(TRANSIENT.baseMs * 2 ** attempt, TRANSIENT.capMs)
  },

  retryBudgetMs(concurrency) {
    return concurrency ? CONCURRENCY.budgetMs : TRANSIENT.baseMs * 2 ** TRANSIENT.maxAttempts
  },

  maxAttempts() {
    return TRANSIENT.maxAttempts
  },

  cooldownMs() {
    return CONCURRENCY.cooldownMs
  },

  /**
   * 上游用 HTTP 200 + `error_code` 表示业务失败（max_tokens 超限、并发超限等）。
   * 不翻译成 OpenAI 错误帧的话，客户端会把空流当成正常结束。
   */
  translateBusinessError(chunk) {
    if (!chunk || typeof chunk !== 'object') return undefined
    if (!chunk['error_code'] && !chunk['error_msg']) return undefined
    return {
      error: {
        message: chunk['error_msg'] || 'upstream error',
        type: 'upstream_error',
        code: chunk['error_code'],
      },
    }
  },

  /** 业务错误码里带 .400/.429 后缀，据此给出真实 HTTP 状态码。 */
  statusForError(chunk) {
    const code = String(chunk?.['error_code'] ?? '')
    for (const [suffix, status] of [
      ['.400', 400],
      ['.401', 401],
      ['.403', 403],
      ['.404', 404],
      ['.429', 429],
    ]) {
      if (code.endsWith(suffix)) return status
    }
    return 502
  },

  /** `other` 不是 OpenAI 认识的值；不映射会让客户端停在「未结束」。 */
  finishReason(value) {
    if (value === null || value === undefined || value === 'other') return 'stop'
    return value
  },

  /**
   * 免费额度通道（benefit）流里 `content` 会是 null 而 `reasoning_content` 有值。
   * 部分 Agent Runtime 把 null chunk 当成「没有响应」，空串才是同样语义的 OpenAI 形状。
   */
  normalizeDelta(delta) {
    if (typeof delta !== 'object' || delta === null) return
    if (delta['content'] === null) delta['content'] = ''
  },

  /**
   * benefit 通道有时整条流都不带 finish_reason，也不发 [DONE]。客户端会一直等。
   * 只有**完全缺失**时才补，绝不重发上游已有的块。
   */
  ensureFinishReason() {
    return true
  },
}
