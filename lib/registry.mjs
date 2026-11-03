/**
 * 规则包注册表：本插件的扩展点。
 *
 * ## 为什么是「注册表 + 规则包」而不是一堆 if
 *
 * 用户的要求是「以后还要接别的 API 和它们各自的规则」。如果把 codearts 的规则写成
 * 散落在转发逻辑里的分支，接第二个 API 就得改转发层；接第三个时没人敢动那团代码。
 *
 * 所以转发层（proxy.mjs）只认一个**固定的规则包接口**，供应商知识全部下沉到
 * rules/<name>.mjs。接新 API = 写一个规则包 + 在配置里点名，转发层一行不改。
 *
 * 规则包也可以由**别的插件**在运行时注入（`ctx.apiRules.register(...)`），
 * 这样规则可以跟着它所属的接入插件一起发布，不必回到本仓库改文件。
 *
 * ## 接口（每个字段都可省略，省略即「不干预」）
 *
 * ```js
 * {
 *   name: 'codearts',
 *   maxTokensHardCap: 65536,
 *   maxTokensCap(model, modelInfo) -> number,
 *   normalizeRequest({ body, model, modelInfo, route }) -> { body, notes: string[] },
 *   supportsImages(model, modelInfo) -> boolean,
 *   isRetryable({ status, text }) -> boolean,
 *   isConcurrencyError(text) -> boolean,
 *   backoffMs({ attempt, concurrency }) -> number,
 *   retryBudgetMs(concurrency) -> number,
 *   cooldownMs() -> number,               // 撞上限后全局冷却时长
 *   translateBusinessError(chunk) -> object | undefined,
 *   finishReason(value) -> string,
 *   normalizeDelta(delta) -> void,
 *   ensureFinishReason(model) -> boolean,  // 上游不补 finish_reason 时是否补
 * }
 * ```
 *
 * @module dsh-api-rules/registry
 */

/**
 * @typedef {object} RulePack
 * @property {string} name
 */

const DEFAULTS = {
  maxTokensHardCap: Number.POSITIVE_INFINITY,
  maxTokensCap: () => Number.POSITIVE_INFINITY,
  normalizeRequest: ({ body }) => ({ body, notes: [] }),
  supportsImages: () => false,
  isRetryable: () => false,
  isConcurrencyError: () => false,
  backoffMs: ({ attempt }) => Math.min(1000 * 2 ** attempt, 30_000),
  retryBudgetMs: () => 0,
  cooldownMs: () => 0,
  translateBusinessError: () => undefined,
  finishReason: (value) => (value === null || value === undefined || value === 'other' ? 'stop' : value),
  normalizeDelta: () => {},
  ensureFinishReason: () => false,
}

/** 把规则包补齐成完整接口；缺省项一律「不干预」。 */
export function normalizePack(pack) {
  if (typeof pack !== 'object' || pack === null || typeof pack.name !== 'string' || pack.name === '') {
    throw new TypeError('rule pack must be an object with a non-empty name')
  }
  return { ...DEFAULTS, ...pack }
}

export class RuleRegistry {
  constructor() {
    /** @type {Map<string, RulePack>} */
    this.packs = new Map()
  }

  /**
   * 注册一个规则包。重复注册抛错而不是静默覆盖：两个来源都想定义 `codearts` 的
   * 规则时，静默覆盖会让「谁在生效」变成不可推理的事。
   */
  register(pack) {
    const normalized = normalizePack(pack)
    if (this.packs.has(normalized.name)) {
      throw new Error('rule pack already registered: ' + normalized.name)
    }
    this.packs.set(normalized.name, normalized)
    return () => this.packs.delete(normalized.name)
  }

  /** 覆盖注册：给「用户想改某个内置规则包」留的口子，语义明确。 */
  replace(pack) {
    const normalized = normalizePack(pack)
    this.packs.set(normalized.name, normalized)
    return () => this.packs.delete(normalized.name)
  }

  has(name) {
    return this.packs.has(name)
  }

  get(name) {
    const pack = this.packs.get(name)
    if (pack === undefined) {
      throw new Error('unknown rule pack: ' + name + '（已注册: ' + [...this.packs.keys()].sort().join(', ') + '）')
    }
    return pack
  }

  list() {
    return [...this.packs.keys()].sort()
  }

  /**
   * 按名字解析一条链。链上的规则按顺序作用，后一个看到的是前一个改过的 body——
   * 这正好表达「先通用归一、再供应商特化」。
   */
  chain(names) {
    return names.map((name) => this.get(name))
  }
}
