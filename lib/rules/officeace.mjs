/**
 * OfficeAce / 华为 ModelArts 规则包。
 *
 * 和 codearts 一样，每一条规则都对应一个被上游真实拒绝过的具体错误，前置改写请求
 * 避免踩雷，而不是在上游报错后再猜着重试。
 *
 * ## 这一包修的是什么（2026-11-05）
 *
 * GUI 里选 officeace 模型必报 400 `ModelArts.81001 / Invalid Argument`，但 curl 发个
 * 简单请求却能正常出字。逐跳二分后定位到：触发点不是字节数、不是工具数量、不是
 * 消息内容，而是 DSH 随请求带上的 `tools` 里**部分工具的 `parameters` 不是合法
 * JSON Schema 外壳**。
 *
 * OpenAI Chat Completions 规范要求 function.parameters 的根是
 *   { type: 'object', properties: { ... } }
 * 但 cnki_* 等工具的 parameters 是「裸属性表」——参数名直接铺在根上：
 *   { listPath: {...}, query: {...}, type: {...}, ... }
 * 其中恰好有一个参数就叫 `type`（值域 all/journal/thesis）。华为 ModelArts 的
 * schema 校验把这个根级 `type` 当成 schema 关键字去解析，于是判定参数非法，
 * 整条请求被拒成 `Invalid Argument`。
 *
 * 决定性消融（99 个真实 tools，走完整 8788 → 7864 → 华为链路）：
 *   - 99 个原样 tools                         → 400 81001
 *   - 补 2 个「含 type 键」的裸根外壳        → 200
 *   - 补全部 6 个裸根外壳                    → 200
 *   - 只补 4 个「不含 type 键」的裸根        → 400 81001
 *   - 把裸根里的 type 键改名（不补壳）       → 200
 *
 * 所以修复就是给这些裸属性表补上标准外壳：参数一个不少、名字一个不改，只是让
 * `type` 从「根级键」落到 `properties` 里的一个普通参数，歧义消除。合规的 object
 * schema 一律原样放行，不做任何重写。
 *
 * 注：officeace 没有并发上限，这里不引入 codearts 那套并发闸门 / 退避。
 *
 * @module dsh-api-rules/rules/officeace
 */

import { genericRules } from './generic.mjs'

/** 合规的 object 外壳：{ type: 'object', properties: { ... } } */
function hasObjectShell(params) {
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
 * 返回 null 表示无需处理（已是合规外壳，或 parameters 缺失/不是对象）。
 */
function wrapFlatParameters(params) {
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
  // 裸属性表：整体作为 properties，type 落到外层。所有属性定义原样保留。
  return { type: 'object', properties: params }
}

/** 兼容 OpenAI `{type:'function', function:{...}}` 与裸 `{name, parameters}` 两种形状。 */
function normalizeTools(tools) {
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

export const officeaceRules = {
  name: 'officeace',

  normalizeRequest(ctx) {
    // 通用归一（删 reasoning / thinking、max_tokens 取最小）与原来的 [generic] 链等价；
    // 委托给既有实现，保证换成单包后这部分行为不回退。
    const base = ctx && typeof ctx === 'object' ? ctx : { body: {} }
    const result = genericRules.normalizeRequest(base) || {}
    const body = result.body !== undefined ? result.body : base.body
    const notes = Array.isArray(result.notes) ? result.notes : []
    const wrapped = body && typeof body === 'object' ? normalizeTools(body.tools) : 0
    if (wrapped > 0) {
      notes.push('wrapped ' + wrapped + ' flat tool parameter root(s) into {type:object,properties}')
    }
    return { body, notes }
  },

  /** 与 generic 一致：不主动剥离图片，交给上游自己决定。 */
  supportsImages() {
    return true
  },
}
