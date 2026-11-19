/**
 * intern-ai（书生 / Intern InkStone，discovery-api.intern-ai.org.cn）规则包。
 *
 * ## 为什么单独写一个包：把「撞上 429 再硬等」换成「事前按配额节流」
 *
 * intern-ai 上游的并发槽/配额紧张。此前 DSH 核心侧（cordis.patch.yml 的 intern-ai provider）
 * 只能在**撞上 429 之后**被动退避（`retryPolicy: mode: always`，2s→4s→8s…上限 60s），对话
 * 一旦触发限流就卡死十几秒到一分钟。而 DSH 核心 LLM 的 retryPolicy 是纯被动的——schema 里
 * 只有 mode/maxRetries/retryableCodes/backoff，**没有** rpm/tpm/concurrency 这种「发请求前
 * 主动按配额节流」的字段（已在 app.asar 里取证确认）。所以主动节流只能做在**代理层**，
 * 也就是本插件这一侧。
 *
 * 本包在**每个请求发出之前**（proxy 的 `throttle` 钩子，见 proxy.mjs postWithRetry）按官方
 * 公布的配额做**令牌桶节流**，从源头尽量不触发 429；万一上游仍然 429，再用上游给的
 * `Retry-After` 头精确等待（读不到时按桶容量估算），而不是盲等指数退避。
 *
 * ## 配额来源（官方 token-plan 页，2026-11-17 取证）
 *
 * https://discovery.intern-ai.org.cn/token-plan/home?tabIndex=1 的模型表里「模型类型」列只有
 * **一个**决策模型：
 *   - 决策模型：`intern-decision-4b`（书生-Decision-4B，SystemOne 协议，8K 上下文）→ **200 RPM**
 *   - 其余全是生成模型（多模态/大语言/Agent）：Agents-A1、Atria-Dawn、Atria-Dawn-Preview、
 *     Sage-A1.5、Sage-A1.5-Taiyi、Sage-S2.1-Flash、deepseek-v4.1-flash-1017、glm-5.3、
 *     intern-s2、kimi-k3.1-pro、qwen3.8-27b → **50 RPM**
 * 另有一条**全局共享**的 TPM 上限 **2.00M Token/分钟**（所有模型共享一个桶）。
 *
 * 实测里对话/蒸馏最常用的是 deepseek-v4.1-flash-1017 这类生成模型，所以 50 RPM 那个桶是
 * 主要瓶颈；TPM 2M 在长上下文（这些模型 256K~1M 上下文）下也可能先到顶，故 RPM、TPM 两个
 * 维度都要卡。
 *
 * @module dsh-api-rules/rules/intern-ai
 */

/** 每个桶的 RPM 配额（请求次数 / 分钟）。 */
const RPM = {
  decision: 200,
  generation: 50,
}

/** 全局共享 TPM 配额（Token / 分钟）。 */
const TPM_PER_MIN = 2_000_000

/** 决策模型清单——官方表里唯一的决策模型。其余一律按生成模型（更严的 50 RPM）处理。 */
const DECISION_MODELS = new Set(['intern-decision-4b'])

/**
 * 保守的输出 token 预留：节流时除了估算输入 token，还要给响应预留一份，否则长回答会在
 * TPM 桶里「先上车后补票」，等响应 token 真正回来时这一分钟已经超了。这里给一个保守的
 * 固定预留（不读 max_tokens——很多调用根本不传），避免 TPM 桶被单条长回答打穿。
 */
const OUTPUT_TOKEN_RESERVE = 16_000

/** 估算一段请求体的输入 token 数。粗略按「英文 ~4 字符/token、中文 ~1.5 字符/token」折中取 3。 */
function estimateInputTokens(body) {
  if (!body || typeof body !== 'object') return 0
  let chars = 0
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (const message of messages) {
    const content = message?.content
    if (typeof content === 'string') chars += content.length
    else if (Array.isArray(content)) {
      // 多模态 content：文本段计字符，图片段按一个固定开销计（上游按图折算 token，这里保守估）。
      for (const part of content) {
        if (typeof part?.text === 'string') chars += part.text.length
        else if (part?.type === 'image_url' || part?.image_url) chars += 2000
      }
    }
  }
  if (typeof body.prompt === 'string') chars += body.prompt.length
  // 取 3 字符/token（中英混合折中），再夹到 [1, 512k]，避免极端值。
  return Math.max(1, Math.min(512_000, Math.round(chars / 3)))
}

/**
 * 滚动窗口计数器：记录最近 60s 内的采样时间戳，超窗的清掉。
 * 返回还需要等待多少毫秒才能容纳 `n` 个新采样（0 = 现在就能过）。
 */
function waitMsForWindow(timestamps, limit, now, windowMs = 60_000) {
  const cutoff = now - windowMs
  while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift()
  if (timestamps.length < limit) return 0
  // 已满：要等到最早那次采样滑出窗口（再留 20ms 余量防边界抖动）。
  return timestamps[0] + windowMs - now + 20
}

/**
 * 桶集合：RPM 按模型分桶（生成 / 决策），TPM 全局共享一个桶。
 * 闭包持有状态，跨请求累积；进程内单例即可（api-rules 是单进程事件循环）。
 */
function createRateLimiter() {
  /** @type {{ generation: number[], decision: number[], tpm: { stamps: number[], tokens: number[] } }} */
  const state = {
    generation: [],
    decision: [],
    tpm: { stamps: [], tokens: [] },
  }

  /**
   * 计算要让一个请求立即放行还需要等多久（毫秒），并**记账**（先记账再返回等待时间，
   * 这样并发的第二条会看到第一条已占的额度，避免同时放行把桶打穿）。
   */
  function reserve(bucket, rpmLimit, tokens, now) {
    const rpmStamps = state[bucket]
    let wait = waitMsForWindow(rpmStamps, rpmLimit, now)

    // TPM：清掉 60s 前的采样，算当前已用 token。
    const tpm = state.tpm
    const cutoff = now - 60_000
    while (tpm.stamps.length > 0 && tpm.stamps[0] <= cutoff) {
      tpm.stamps.shift()
      tpm.tokens.shift()
    }
    const usedTokens = tpm.tokens.reduce((sum, value) => sum + value, 0)
    if (usedTokens + tokens > TPM_PER_MIN) {
      // TPM 到顶：最早那条采样滑出窗口后释放的 token 才能用。
      if (tpm.stamps.length > 0) {
        wait = Math.max(wait, tpm.stamps[0] + 60_000 - now + 20)
      } else {
        // 窗口空却仍超（单条请求本身就 > 2M，几乎不可能）：不再等，放行交上游裁决。
        wait = Math.max(wait, 0)
      }
    }

    // 记账：RPM 记一次请求，TPM 记这次请求估算占用的 token。
    rpmStamps.push(now)
    tpm.stamps.push(now)
    tpm.tokens.push(tokens)
    return wait
  }

  return { reserve, state }
}

/** 进程级单例：同一路由的所有在飞请求共享一套桶。 */
const limiter = createRateLimiter()

/** 由模型 id 判定所属桶。 */
function bucketOf(model) {
  return DECISION_MODELS.has(model) ? 'decision' : 'generation'
}

export const internAiRules = {
  name: 'intern-ai',

  /**
   * 事前节流（proxy 在发请求前 await 本钩子）。按模型分桶做 RPM 节流 + 全局 TPM 节流。
   * 返回 { waitMs } 让 proxy 决定是否真的 sleep（也方便日志与测试）。
   */
  async throttle({ model, body, signal }) {
    const bucket = bucketOf(model)
    const rpmLimit = RPM[bucket]
    const tokens = estimateInputTokens(body) + OUTPUT_TOKEN_RESERVE
    let wait = limiter.reserve(bucket, rpmLimit, tokens, Date.now())
    // 尊重取消：等待被分片，随时响应用户点停止。
    while (wait > 0) {
      if (signal?.aborted) return { waitMs: wait, aborted: true }
      const slice = Math.min(wait, 250)
      await new Promise((resolve) => setTimeout(resolve, slice))
      wait -= slice
    }
    return { waitMs: 0 }
  },

  /** 上游仍 429 时的退避：优先用上游给的 Retry-After，读不到再按桶容量估算。 */
  backoffMs({ attempt, retryAfterMs, model }) {
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      // 上游明确给了等待时间：照它等，再加 100ms 余量，避免掐点重试又撞上。
      return retryAfterMs + 100
    }
    // 没给 Retry-After：按桶容量算「一个请求槽位」的间隔（50 RPM ≈ 1.2s，200 RPM ≈ 0.3s），
    // 再随 attempt 温和递增（避免同一窗口反复撞），上限 10s。
    const base = Math.round(60_000 / RPM[bucketOf(model)])
    return Math.min(10_000, base * (attempt + 1))
  },

  /** 429 / 5xx / 网络 class 都可重试；4xx（除 429）不重试。 */
  isRetryable({ status }) {
    return status === 429 || status === 408 || (status >= 500 && status <= 599)
  },

  isConcurrencyError() {
    return false
  },

  /** 有 Retry-After 时一次就够；没有时最多试 3 次。 */
  maxAttempts() {
    return 3
  },

  retryBudgetMs() {
    // 覆盖「50 RPM 桶下若干次退避 + 一条 Retry-After（可能到 60s）」的最坏情况。
    return 120_000
  },

  /**
   * 429 的全局冷却：让同时在飞的请求一起等，而不是各自退避后又一起撞上限。
   * 没读到 Retry-After 时退回按生成桶的槽位间隔（1.2s）。
   */
  cooldownMs({ retryAfterMs } = {}) {
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return retryAfterMs + 100
    }
    return Math.round(60_000 / RPM.generation)
  },

  /** intern-ai 是多模态上游，不剥离图片。 */
  supportsImages() {
    return true
  },
}
