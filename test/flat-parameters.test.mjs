/**
 * rules 层「裸参数补合规外壳」的**单点真相**回归测试 + 负向对照。
 *
 * 根因：DSH 主轮次 tools 里部分工具 `parameters` 是「裸属性表」（参数名直接铺在根），
 * 且根里恰有一个参数叫 `type`。上游（iflytek-spark-loomy / 华为 ModelArts）把根级
 * `type` 当成 JSON Schema 关键字解析 -> 判定参数非法 -> 整条请求确定性 400。
 * 修复 = 补 `{ type: 'object', properties: { ... } }` 外壳，参数一个不少、名字一个不改。
 *
 * 覆盖：A. 单函数单元；B. 决定性消融；C. 负向对照（type=string/object/number/array）；
 * D. 不变量（合规外壳逐字节不动、幂等、异常形状不崩）；E. 六个 provider 都接同一份 wrap。
 *
 * 运行：node test/flat-parameters.test.mjs
 */

import { hasObjectShell, wrapFlatParameters, normalizeToolParameters } from '../lib/rules/flat-parameters.mjs'
import { loomyRules } from '../lib/rules/loomy.mjs'
import { officeaceRules } from '../lib/rules/officeace.mjs'
import { genericRules } from '../lib/rules/generic.mjs'
import { clineRules } from '../lib/rules/cline.mjs'
import { raccoonRules } from '../lib/rules/raccoon.mjs'
import { codeartsRules } from '../lib/rules/codearts.mjs'

let failures = 0
let passes = 0
function check(name, condition, detail) {
  if (condition) { passes += 1; console.log('PASS  ' + name); return }
  failures += 1; console.log('FAIL  ' + name + (detail === undefined ? '' : '  -> ' + detail))
}
function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected))
}
const isShell = (p) => p !== null && typeof p === 'object' && !Array.isArray(p)
  && p.type === 'object' && p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties)

// A. ---------------------------------------------------------------- 单函数单元
{
  check('hasObjectShell 接受合规 {object,properties}', isShell({ type: 'object', properties: { a: { type: 'string' } } }))
  check('hasObjectShell 拒绝裸属性表', !hasObjectShell({ a: { type: 'string' }, type: { type: 'string' } }))
  check('hasObjectShell 拒绝 type:object 但 properties 缺失', !hasObjectShell({ type: 'object' }))
  check('hasObjectShell 拒绝 type:string', !hasObjectShell({ type: 'string', properties: {} }))
  check('hasObjectShell 拒绝 null / 数组', !hasObjectShell(null) && !hasObjectShell([]))
}
{
  const flat = { listPath: { type: 'string' }, query: { type: 'string' }, type: { type: 'string', enum: ['all', 'journal'] } }
  const wrapped = wrapFlatParameters(flat)
  check('wrapFlatParameters 裸根补成外壳', isShell(wrapped), JSON.stringify(wrapped))
  equal('wrapFlatParameters 参数原样迁移', Object.keys(wrapped.properties).sort(), ['listPath', 'query', 'type'])
  check('wrapFlatParameters 根级 type 降为 properties.type（普通参数）', wrapped.properties.type && wrapped.properties.type.type === 'string')
  check('wrapFlatParameters 根级 type 的 enum 保留', Array.isArray(wrapped.properties.type.enum) && wrapped.properties.type.enum[0] === 'all')
}
{
  const shell = { type: 'object', properties: { q: { type: 'string' } } }
  equal('wrapFlatParameters 已合规返回 null', wrapFlatParameters(shell), null)
  const half = { type: 'object', required: ['a'], additionalProperties: false }
  const w = wrapFlatParameters(half)
  check('wrapFlatParameters 缺 properties 只补 properties', isShell(w))
  equal('wrapFlatParameters 保留 required 同级关键字', w.required, ['a'])
  equal('wrapFlatParameters 保留 additionalProperties', w.additionalProperties, false)
  equal('wrapFlatParameters null -> null', wrapFlatParameters(null), null)
  equal('wrapFlatParameters 数组 -> null', wrapFlatParameters([1, 2]), null)
  equal('wrapFlatParameters 字符串 -> null', wrapFlatParameters('x'), null)
}
{
  const tools = [
    { type: 'function', function: { name: 'a', parameters: { type: { type: 'string' }, q: { type: 'string' } } } },
    { name: 'b', parameters: { type: { type: 'string' } } },
    { type: 'function', function: { name: 'c', parameters: { type: 'object', properties: { ok: { type: 'string' } } } } },
    { type: 'function', function: { name: 'd' } },
    { type: 'function', function: { name: 'e', parameters: null } },
  ]
  const n = normalizeToolParameters(tools)
  equal('normalizeToolParameters 补壳 2 个裸根', n, 2)
  check('normalizeToolParameters function 形状被补壳', isShell(tools[0].function.parameters))
  check('normalizeToolParameters 裸工具形状被补壳', isShell(tools[1].parameters))
  check('normalizeToolParameters 已合规不动', isShell(tools[2].function.parameters))
  check('normalizeToolParameters 缺失 parameters 不动', !('parameters' in tools[3].function))
  check('normalizeToolParameters null parameters 不动', tools[4].function.parameters === null)
  for (const bad of [undefined, null, 'oops', {}, [null, 3, 'x'], [{ type: 'function', function: { name: 'n' } }], 'notarray']) {
    let ok = true
    try { normalizeToolParameters(bad) } catch { ok = false }
    check('normalizeToolParameters 异常形状不崩（' + JSON.stringify(bad) + '）', ok)
  }
  equal('normalizeToolParameters 非数组返回 0', normalizeToolParameters('notarray'), 0)
}

// B. ---------------------------------------------------------------- 决定性消融
function flatTool(name, withType = true) {
  const params = {
    listPath: { type: 'string', description: 'url list file' },
    query: { type: 'string', description: 'keywords' },
    top: { type: 'integer', description: 'top N' },
  }
  if (withType) params.type = { type: 'string', enum: ['all', 'journal', 'thesis'] }
  else params.kind = { type: 'string', enum: ['all', 'journal', 'thesis'] }
  return { type: 'function', function: { name, description: 'do ' + name, parameters: params } }
}
function cleanTool(name) {
  return { type: 'function', function: { name, description: 'do ' + name, parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }
}
{
  const body = { model: 'spark-x2.6', messages: [{ role: 'user', content: 'hi' }], tools: [flatTool('cnki_search')] }
  const { notes } = loomyRules.normalizeRequest({ body })
  const p = body.tools[0].function.parameters
  check('消融 裸根补壳 -> 合规外壳', isShell(p))
  check('消融 根级 type 降为 properties 普通参数', p.properties.type && p.properties.type.type === 'string' && Array.isArray(p.properties.type.enum))
  check('消融 补壳写进 notes', notes.some((n) => n.includes('flat tool parameter')))
}
{
  const body = { model: 'x', messages: [], tools: [flatTool('cnki_search', false)] }
  const { notes } = loomyRules.normalizeRequest({ body })
  const p = body.tools[0].function.parameters
  check('负向-改名 仍补成外壳', isShell(p))
  check('负向-改名 原 kind 参数原样落在 properties 里', 'kind' in p.properties && p.properties.kind && p.properties.kind.type === 'string')
  check('负向-改名 根级不再有裸 type 键被误当关键字', p.type === 'object')
  check('负向-改名 notes 报告补壳', notes.some((n) => n.includes('flat tool parameter')))
}
{
  const tools = []
  for (let i = 0; i < 93; i++) tools.push(cleanTool('tool_' + i))
  for (const n of ['cnki_search', 'cnki_download', 'cnki_batch', 'cnki_verify', 'cnki_task_status', 'cnki_doctor']) tools.push(flatTool(n))
  const body = { model: 'spark-x2.6', messages: [], tools }
  const { notes } = loomyRules.normalizeRequest({ body })
  const wrapped = body.tools.filter((t) => { const fn = t.function || t; return fn.parameters && fn.parameters.type === 'object' }).length
  equal('混合 全部补成合规外壳', wrapped, 99)
  check('混合 notes 报 6 个补壳', notes.some((n) => n.includes('wrapped 6 flat tool parameter')))
  const snap = JSON.stringify(body)
  const { notes: notes2 } = loomyRules.normalizeRequest({ body: JSON.parse(snap) })
  check('混合 二次净化不再补壳', !notes2.some((n) => n.includes('flat tool parameter')))
}

// C. ---------------------------------------------------------------- 负向对照（type 值各类形态）
function wrapVia(rules, params) {
  const body = { model: 'x', messages: [], tools: [{ type: 'function', function: { name: 't', parameters: params } }] }
  rules.normalizeRequest({ body, model: 'x', modelInfo: {}, route: {} })
  return body.tools[0].function.parameters
}
{
  const p = wrapVia(loomyRules, { type: 'string', q: { type: 'string' } })
  check('负向 type=string：补壳后根 type 变 object（不再是裸 string）', p.type === 'object')
  check('负向 type=string：根级 type 值沦为 properties 里的普通参数（值仍是 string）', p.properties.type === 'string')
  check('负向 type=string：根级 type 没有被当成 schema 关键字吞掉', !('type' in p) || p.type === 'object')
  check('负向 type=string：其它参数无损', p.properties.q && p.properties.q.type === 'string')
}
{
  const p = wrapVia(officeaceRules, { type: { type: 'string', enum: ['all', 'journal'] }, q: { type: 'string' } })
  check('负向 type=object：补壳后 properties.type 保留原对象', p.properties.type && p.properties.type.type === 'string' && JSON.stringify(p.properties.type.enum) === JSON.stringify(['all', 'journal']))
}
{
  const pNum = wrapVia(genericRules, { type: 1, q: { type: 'string' } })
  check('负向 type=number：补壳后 properties.type === 1', pNum.properties.type === 1)
  const pArr = wrapVia(clineRules, { type: ['a', 'b'], q: { type: 'string' } })
  check('负向 type=array：补壳后 properties.type 是数组', Array.isArray(pArr.properties.type) && pArr.properties.type[0] === 'a')
}

// D. ---------------------------------------------------------------- 不变量：合规外壳逐字节不动
{
  const shell = { type: 'object', properties: { detail: { type: 'string', enum: ['summary', 'full'] } }, required: ['x'], additionalProperties: false }
  const before = JSON.stringify(shell)
  const res = officeaceRules.normalizeRequest({ body: { model: 'm', messages: [], tools: [{ type: 'function', function: { name: 'c', parameters: JSON.parse(before) } }] } })
  equal('合规外壳逐字节未改', JSON.stringify(res.body.tools[0].function.parameters), before)
  check('合规外壳不写补壳 notes', !res.notes.some((n) => n.includes('flat tool parameter')))
}

// E. ---------------------------------------------------------------- 所有 provider 都接了同一份 wrap
{
  const providers = [
    ['loomy', loomyRules], ['officeace', officeaceRules], ['generic', genericRules],
    ['cline', clineRules], ['raccoon', raccoonRules], ['codearts', codeartsRules],
  ]
  for (const [name, rules] of providers) {
    const body = { model: 'm', messages: [], tools: [{ type: 'function', function: { name: 'cnki_search', parameters: { type: { type: 'string' }, q: { type: 'string' } } } }] }
    const { notes } = rules.normalizeRequest({ body, model: 'm', modelInfo: {}, route: {} })
    check(name + ' 走同一份 wrap（裸根被补壳）', isShell(body.tools[0].function.parameters))
    check(name + ' 补壳写入 notes', notes.some((n) => n.includes('flat tool parameter')))
  }
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
