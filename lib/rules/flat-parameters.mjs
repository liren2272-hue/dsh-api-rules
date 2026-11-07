/**
 * 裸参数补合规外壳的**唯一**实现来源（rules 层的共享能力）。
 *
 * ## 根因（2026-11-05 ~ 11-06，loomy / officeace 两个上游各触发一次）
 *
 * DSH 随主轮次带上的 `tools` 里，部分工具的 `parameters` 不是合法 JSON Schema 外壳，
 * 而是「裸属性表」——参数名直接铺在根上：
 *   { listPath: {...}, query: {...}, type: {...}, ... }
 * 其中恰好有一个参数就叫 `type`（值域 all/journal/thesis 之类）。上游（讯飞星火
 * iflytek-spark-loomy、华为 ModelArts）把根级的 `type` 当成 JSON Schema 关键字去解析
 * → 判定参数非法 → 整条请求确定性 400。不带 tools 的小请求（标题生成、压缩摘要）能
 * 正常出字，带全量 tools 的主轮次每轮必 400，于是表现为「按时间成簇」的假象。
 *
 * ## 修复策略（只改 rules 层，绝不动 vendored 网关源码）
 *
 * 给裸 `parameters` 补上标准 OpenAI 外壳 `{ type: 'object', properties: { ... } }`：
 * 参数一个不少、名字一个不改，只是让根级的 `type` 落到 properties 里当一个普通参数，
 * 消除 schema 关键字歧义。合规的 object schema 一律原样放行（幂等、不重写、不计数）。
 *
 * 此前 `loomy.mjs` 与 `officeace.mjs` 各抄了一份同构实现；这里收口成单点真相，
 * 两个规则包改为 import 本模块，避免「一类 bug 两套实现、修一处漏一处」。
 *
 * @module dsh-api-rules/rules/flat-parameters
 */

/**
 * 判断是否已经是合规 object 外壳：
 *   { type: 'object', properties: { ... 全部是 schema 对象 ... } }
 */
export function hasObjectShell(params) {
  return params !== null
    && typeof params === 'object'
    && !Array.isArray(params)
    && params.type === 'object'
    && params.properties !== null
    && typeof params.properties === 'object'
    && !Array.isArray(params.properties)
}

/**
 * 把「裸属性表」补成合规外壳。
 *
 * @param {*} params 工具的 `parameters` 字段（任意类型）。
 * @returns {object|null} 合规外壳；返回 null 表示无需处理（已是合规外壳，
 *   或 parameters 缺失 / 不是对象 / 是数组）。
 */
export function wrapFlatParameters(params) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return null
  if (hasObjectShell(params)) return null
  if (params.type === 'object') {
    // 已有 type:object 但 properties 缺失/不合规：只补 properties，
    // 保留 required / additionalProperties 等同级 schema 关键字。
    const props = (params.properties !== null
      && typeof params.properties === 'object'
      && !Array.isArray(params.properties)) ? params.properties : {}
    return { ...params, properties: props }
  }
  // 裸属性表：根级所有键（含名为 `type` 的参数——其取值可能是 string/number/object/array）
  // 整体作为 properties，type 落到外层。根级 `type` 的值一律当作普通参数，绝不被当成
  // JSON Schema 关键字消化（这是确定性 400 的根因）。所有属性定义原样保留。
  return { type: 'object', properties: params }
}

/**
 * 兼容 OpenAI `{type:'function', function:{...}}` 与裸 `{name, parameters}` 两种形状，
 * 给 `tools` 里不合规的裸 `parameters` 补上标准 object 外壳。
 *
 * @param {*} tools 请求体里的 `tools` 字段（任意类型）。
 * @returns {number} 被补壳的工具数量（0 表示无需处理 / 非数组 / 全部已合规）。
 */
export function normalizeToolParameters(tools) {
  if (!Array.isArray(tools)) return 0
  let wrapped = 0
  for (const tool of tools) {
    if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) continue
    const fn = (tool.function !== null
      && typeof tool.function === 'object'
      && !Array.isArray(tool.function)) ? tool.function : tool
    const next = wrapFlatParameters(fn.parameters)
    if (next !== null) {
      fn.parameters = next
      wrapped += 1
    }
  }
  return wrapped
}
