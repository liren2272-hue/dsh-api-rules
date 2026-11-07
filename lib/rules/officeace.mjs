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
import { normalizeToolParameters } from './flat-parameters.mjs'

export const officeaceRules = {
  name: 'officeace',

  normalizeRequest(ctx) {
    // 通用归一（删 reasoning / thinking、max_tokens 取最小）与原来的 [generic] 链等价；
    // 委托给既有实现，保证换成单包后这部分行为不回退。
    const base = ctx && typeof ctx === 'object' ? ctx : { body: {} }
    const result = genericRules.normalizeRequest({ ...base, provider: 'officeace' }) || {}
    const body = result.body !== undefined ? result.body : base.body
    const notes = Array.isArray(result.notes) ? result.notes : []
    const wrapped = body && typeof body === 'object' ? normalizeToolParameters(body.tools) : 0
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
