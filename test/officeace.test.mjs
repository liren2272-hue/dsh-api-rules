/**
 * officeace / 华为 ModelArts 规则包的回归测试。
 *
 * 背景（2026-11-05）：GUI 里选 officeace 模型必报 400 `ModelArts.81001 / Invalid
 * Argument`，但 curl 发简单请求能出字。逐跳二分定位到：DSH 随请求带上的 tools 里，
 * cnki_* 等工具的 `parameters` 是「裸属性表」（参数名直接铺在根上，缺
 * {type:'object', properties} 外壳），且根里恰好有个参数叫 `type`。华为 ModelArts
 * 的 schema 校验把根级 `type` 当成 schema 关键字解析，整条请求被拒。
 *
 * 本测试锁定修复行为：
 *  1. officeace 路由的 normalizeRoute 保留 `rules: ['officeace']`（不再是 generic）；
 *  2. 裸属性表被补成合规外壳，参数名/定义一个不少，名为 `type` 的普通参数
 *     （all/journal/thesis）作为 properties 里的普通属性保留并带 enum；
 *  3. 已合规的 object schema 逐字节不动（不做无谓重写）、净化幂等；
 *  4. 通用归一（删 reasoning/thinking、max_tokens 取最小）与 generic 包等价；
 *  5. 不引入 codearts 那套并发闸门 / 退避（officeace 无并发上限）。
 *
 * 不连真实上游。运行：node test/officeace.test.mjs
 */

import { normalizeRoute } from '../lib/proxy.mjs'
import { genericRules } from '../lib/rules/generic.mjs'
import { officeaceRules } from '../lib/rules/officeace.mjs'

let failures = 0
let passes = 0

function check(name, condition, detail) {
  if (condition) {
    passes += 1
    console.log('PASS  ' + name)
    return
  }
  failures += 1
  console.log('FAIL  ' + name + (detail === undefined ? '' : '  → ' + detail))
}

function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected))
}

const isShell = (p) => p !== null && typeof p === 'object' && !Array.isArray(p)
  && p.type === 'object' && p.properties !== null && typeof p.properties === 'object'
  && !Array.isArray(p.properties)

// 复刻触发 81001 的 tools 形状：既有合规 object schema，也有带 `type` 键的裸属性表。
function fixtureTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'acp_cache',
        description: '合规 object schema 工具',
        parameters: {
          type: 'object',
          properties: { detail: { type: 'string', enum: ['summary', 'full'] } },
          required: ['x'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cnki_search',
        description: '裸属性表工具，根里带一个叫 type 的参数',
        parameters: {
          query: { type: 'string', description: '检索词' },
          type: { type: 'string', enum: ['all', 'journal', 'thesis'], description: '检索库类型' },
          top: { type: 'number', description: '每页条数' },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cnki_doctor',
        description: '裸属性表工具，根里不带 type',
        parameters: { outputDir: { type: 'string', description: '目录' } },
      },
    },
    // 也兼容不含 `type:'function'` 外壳的裸 function 形状。
    {
      name: 'cnki_verify',
      description: '裸 function 形状',
      parameters: { outputDir: { type: 'string' } },
    },
    // parameters 缺失 / 为 null 不应让插件崩溃。
    { type: 'function', function: { name: 'no_params', description: '无 parameters' } },
    { type: 'function', function: { name: 'null_params', description: 'null', parameters: null } },
  ]
}

// ------------------------------------------------- 1. 路由接线
{
  const route = normalizeRoute({
    id: 'officeace',
    upstream: 'http://127.0.0.1:7864/v1/',
    apiKey: 'sk-officeace',
    rules: ['officeace'],
    concurrency: 4,
    sessionHoldMs: 60000,
  })
  equal('officeace route id', route.id, 'officeace')
  equal('officeace rules 指向 officeace', JSON.stringify(route.rules), JSON.stringify(['officeace']))
  // 没写 rules 时仍回落到 generic，不影响别的路由。
  const fallback = normalizeRoute({ id: 'x', upstream: 'http://127.0.0.1:1/v1' })
  equal('未写 rules 回落 generic', JSON.stringify(fallback.rules), JSON.stringify(['generic']))
}

// ------------------------------------------------- 2. 净化逻辑
{
  const tools = fixtureTools()
  const beforeCompliant = JSON.stringify(tools[0].function.parameters)
  const body = {
    model: 'deepseek-v4.1-flash',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 128,
    reasoning_effort: 'high',
    thinking: { type: 'enabled' },
    tools,
  }
  const res = officeaceRules.normalizeRequest({ body, model: 'deepseek-v4.1-flash', modelInfo: {}, route: {} })

  check('返回 { body, notes }', res && typeof res.body === 'object' && Array.isArray(res.notes))
  check('notes 记录补壳数量', /wrapped 3 /.test(res.notes.join(' ')), JSON.stringify(res.notes))
  equal('工具数量不变', res.body.tools.length, tools.length)

  // 合规 schema 逐字节不动
  equal('合规 object schema 逐字节未改', JSON.stringify(res.body.tools[0].function.parameters), beforeCompliant)

  // 带 type 键的裸根：补壳后 3 个参数全在，type 作为普通属性保留并带 enum
  const p2 = res.body.tools[1].function.parameters
  check('cnki_search 补成合规外壳', isShell(p2), JSON.stringify(p2))
  equal('cnki_search 参数个数', Object.keys(p2.properties).length, 3)
  check('cnki_search 名为 type 的参数带 enum', Array.isArray(p2.properties.type?.enum)
    && JSON.stringify(p2.properties.type.enum) === JSON.stringify(['all', 'journal', 'thesis']))
  equal('cnki_search query 定义未改', p2.properties.query.type, 'string')

  // 不带 type 键的裸根
  const p3 = res.body.tools[2].function.parameters
  check('cnki_doctor 补成合规外壳', isShell(p3))
  equal('cnki_doctor outputDir 定义未改', p3.properties.outputDir.type, 'string')

  // 裸 function 形状（无 type:'function' 外壳）也要能补
  const p4 = res.body.tools[3].parameters
  check('裸 function 形状也补成合规外壳', isShell(p4))

  // 缺失 / null 的 parameters 不动，不抛异常
  check('parameters 缺失保持缺失', !('parameters' in res.body.tools[4].function))
  check('parameters=null 保持 null', res.body.tools[5].function.parameters === null)

  // 幂等：再净化一次不再补壳、body 不变
  const snapshot = JSON.stringify(res.body)
  const res2 = officeaceRules.normalizeRequest({ body: JSON.parse(snapshot) })
  check('二次净化不再补壳', !/wrapped/.test(res2.notes.join(' ')), JSON.stringify(res2.notes))
  equal('二次净化 body 逐字节不变', JSON.stringify(res2.body), snapshot)
}

// ------------------------------------------------- 3. 与 generic 的等价性（无 tools）
{
  const mk = () => ({ max_tokens: 50, max_completion_tokens: 80, reasoning: true, thinking: 'x', messages: [] })
  const g = genericRules.normalizeRequest({ body: mk() })
  const o = officeaceRules.normalizeRequest({ body: mk() })
  equal('无 tools 时与 generic 等价', JSON.stringify(o.body), JSON.stringify(g.body))
  check('supportsImages 与 generic 一致', officeaceRules.supportsImages() === genericRules.supportsImages())
}

// ------------------------------------------------- 4. 不引入并发闸门 / 退避
{
  check('无 maxTokensHardCap（默认 Infinity）', officeaceRules.maxTokensHardCap === undefined)
  check('无自定义 maxAttempts', officeaceRules.maxAttempts === undefined)
  check('无自定义 isRetryable', officeaceRules.isRetryable === undefined)
  check('无自定义 backoffMs', officeaceRules.backoffMs === undefined)
  check('无自定义 isConcurrencyError', officeaceRules.isConcurrencyError === undefined)
  check('无自定义 cooldownMs', officeaceRules.cooldownMs === undefined)
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
