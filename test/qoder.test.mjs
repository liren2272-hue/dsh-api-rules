/**
 * qoder2api-hub 接入的回归测试。
 *
 * 覆盖几件事：
 *  1. qoder 路由的 normalizeRoute 正确规整 launch（command/args/cwd/readyUrl/killOnStop）。
 *  2. qoderRules 的请求整形：把 max_completion_tokens/max_output_tokens 归一到 max_tokens；
 *     **保留 reasoning_effort 与 thinking**——这是与 raccoon/loomy 唯一差别：
 *     vendored qoder_proxy.py 读 effort 的优先级是
 *       payload.reasoning_effort → reasoning.effort → thinking.effort/thinking.level
 *     （requested_effort, qoder_proxy.py:3797-3810），删掉 reasoning 或 thinking 都会丢思考档位。
 *     所以这里**只删裸的 reasoning 透传对象**（DSH 会发、qoder 不认的形状），thinking 原样保留。
 *  3. 给 tools 里不合规的「裸属性表」parameters 补上标准 {type:object, properties} 外壳
 *     （与 officeace.mjs / loomy.mjs 同类修复，纯防御——qoder 自身解析宽容，但补上无害）。
 *  4. null content chunk 归一成空串；finish_reason 兜底。
 *  5. 与 raccoon/loomy 同构：上游自己换号重试，本层只认 429/502/503/504，
 *     400 一律不重试（确定性 400 重试只会污染 keep-alive 连接），退避短、不叠预算。
 *
 * qoder2api-hub 是纯标准库、上游原样 vendored，没有像 loomy2api 那样打「400 瞬时重试」补丁，
 * 因此本测试不校验 vendor 源码内容。运行：node test/qoder.test.mjs
 */

import { normalizeRoute } from '../lib/proxy.mjs'
import { qoderRules } from '../lib/rules/qoder.mjs'

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

// ------------------------------------------------- normalizeRoute 接收 qoder 路由
{
  const route = normalizeRoute({
    id: 'qoder2api-hub',
    upstream: 'http://127.0.0.1:8790/v1',
    apiKey: 'sk-qoder-local',
    adminUrl: 'http://127.0.0.1:8790/',
    rules: ['qoder2api-hub'],
    concurrency: 4,
    sessionHoldMs: 60000,
    launch: {
      command: 'C:\\Program Files\\Python311\\python.exe',
      args: ['qoder_proxy.py', '--host', '127.0.0.1', '--port', '8790', '--api-key', 'sk-qoder-local', '--panel-password', 'sk-qoder-local'],
      cwd: 'C:\\...\\vendor\\qoder2api-hub',
      // 注意：不传 readyPollMs，模拟 YAML 原始配置——normalizeRoute 只在
      // raw.launch.readyPollMs 不是数字时才现场规整（proxy.mjs），从而应用 killOnStop 默认值。
      readyUrl: 'http://127.0.0.1:8790/health',
      readyTimeoutMs: 60000,
    },
  })
  equal('qoder route id', route.id, 'qoder2api-hub')
  check('qoder route 保留了 launch', route.launch !== undefined)
  equal('qoder launch command', route.launch.command, 'C:\\Program Files\\Python311\\python.exe')
  equal('qoder launch args 首个是入口脚本', route.launch.args?.[0], 'qoder_proxy.py')
  // --api-key 钉死本地 key 是本接入的关键：否则 qoder 无 Key 时 /v1/* 免鉴权，DSH 侧 key 形同虚设。
  check('qoder launch args 含 --api-key 与值', route.launch.args?.includes('--api-key') === true && route.launch.args?.includes('sk-qoder-local') === true)
  equal('qoder launch readyUrl', route.launch.readyUrl, 'http://127.0.0.1:8790/health')
  equal('qoder launch killOnStop 默认 true', route.launch.killOnStop, true)
  equal('qoder upstream 被保留', route.upstream, 'http://127.0.0.1:8790/v1')
  equal('qoder adminUrl 指向看板', route.adminUrl, 'http://127.0.0.1:8790/')
}

// ------------------------------------------------- qoderRules 请求整形：保留 effort 载体
{
  const body = {
    model: 'Qwen3.8-Max',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning: { effort: 'high' },
    reasoning_effort: 'high',
    thinking: { type: 'enabled', effort: 'high' },
    max_completion_tokens: 2048,
    max_tokens: 1000,
    max_output_tokens: 3000,
  }
  const { notes } = qoderRules.normalizeRequest({ body })
  // 关键差异：只删 reasoning，保留 reasoning_effort 与 thinking（qoder 读它们取思考档位）。
  check('qoder 剥离了 reasoning（DSH 透传对象）', !('reasoning' in body), notes.join(','))
  check('qoder 保留 reasoning_effort（上游思考档位载体）', body['reasoning_effort'] === 'high')
  check('qoder 保留 thinking（requested_effort 的第三优先级）', body['thinking'] !== undefined && body.thinking.effort === 'high')
  // 三者同时出现取最小：min(1000, 2048, 3000) = 1000
  equal('qoder 归一 max_tokens = min', body['max_tokens'], 1000)
  check('qoder 删掉了 max_completion_tokens', !('max_completion_tokens' in body))
  check('qoder 删掉了 max_output_tokens', !('max_output_tokens' in body))
  check('qoder 不剥离 messages 角色', body.messages[0].role === 'user')
  check('qoder 不改模型字段', body.model === 'Qwen3.8-Max')
}

{
  // 单独给 thinking / reasoning_effort 时都原样保留（不凭空删）。
  const body = { model: 'x', messages: [], thinking: { type: 'enabled', effort: 'low' } }
  qoderRules.normalizeRequest({ body })
  check('qoder 只有 thinking 时原样保留', body.thinking?.effort === 'low')
  const body2 = { model: 'x', messages: [], reasoning_effort: 'xhigh' }
  qoderRules.normalizeRequest({ body: body2 })
  equal('qoder 只有 reasoning_effort 时原样保留', body2['reasoning_effort'], 'xhigh')
}

{
  // 只给 max_output_tokens 时也应落到 max_tokens
  const body = { model: 'x', messages: [], max_output_tokens: 500 }
  qoderRules.normalizeRequest({ body })
  equal('qoder 只有 max_output_tokens 时归入 max_tokens', body['max_tokens'], 500)
  check('qoder 删掉原 max_output_tokens', !('max_output_tokens' in body))
}

{
  // 没给任何 max 字段时不凭空补
  const body = { model: 'x', messages: [] }
  qoderRules.normalizeRequest({ body })
  check('qoder 无 max 字段时不补', !('max_tokens' in body))
}

// ------------------------------------------------- 裸 tools 参数补壳（防御性，与 loomy/officeace 同款）
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
  return {
    type: 'function',
    function: {
      name,
      description: 'do ' + name,
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  }
}

{
  // 裸属性表（含根级 type 键）应被补成 {type:object, properties: 原表}。
  const body = { model: 'Qwen3.8-Max', messages: [{ role: 'user', content: 'hi' }], tools: [flatTool('web_search')] }
  const { notes } = qoderRules.normalizeRequest({ body })
  const p = body.tools[0].function.parameters
  equal('qoder 裸根补壳：根 type 变成 object', p.type, 'object')
  check('qoder 裸根补壳：properties 是对象', p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties))
  const props = (p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties)) ? p.properties : {}
  check('qoder 补壳保留 listPath/query/top 三个参数', ['listPath', 'query', 'top'].every((k) => k in props))
  check('qoder 补壳把根级 type 降为 properties.type 普通参数', 'type' in props && typeof props.type === 'object')
  check('qoder 补壳写进 notes', notes.some((n) => n.includes('flat tool parameter')))
}

{
  // 合规 object 外壳一律原样放行（不重写、不计数）。
  const original = cleanTool('alpha')
  const snapshot = JSON.stringify(original)
  const body = { model: 'Qwen3.8-Max', messages: [], tools: [original] }
  const { notes } = qoderRules.normalizeRequest({ body })
  equal('qoder 合规 object 外壳原样不动', JSON.stringify(body.tools[0]), snapshot)
  check('qoder 合规外壳不写补壳 notes', !notes.some((n) => n.includes('flat tool parameter')))
}

{
  // 非数组 tools / 缺 parameters / 非对象 tools 不崩、不误补。
  for (const tools of [undefined, null, 'oops', {}, [null, 3, 'x'], [{ type: 'function', function: { name: 'nope' } }]]) {
    const body = { model: 'x', messages: [] }
    if (tools !== undefined) body.tools = tools
    let ok = true
    try { qoderRules.normalizeRequest({ body }) } catch (e) { ok = false; console.log('  threw: ' + e.message) }
    check('qoder 异常 tools 形状不崩（' + JSON.stringify(tools) + '）', ok)
  }
}

// ------------------------------------------------- qoderRules 响应整形
{
  equal('qoder finishReason other -> stop', qoderRules.finishReason('other'), 'stop')
  equal('qoder finishReason null -> stop', qoderRules.finishReason(null), 'stop')
  equal('qoder finishReason stop 原样', qoderRules.finishReason('stop'), 'stop')
  equal('qoder finishReason length 原样', qoderRules.finishReason('length'), 'length')
  const delta = { content: null }
  qoderRules.normalizeDelta(delta)
  equal('qoder null content chunk -> 空串', delta['content'], '')
  const delta2 = { content: 'hi' }
  qoderRules.normalizeDelta(delta2)
  equal('qoder 非空 content 不动', delta2['content'], 'hi')
  check('qoder 支持图片', qoderRules.supportsImages() === true)
  check('qoder ensureFinishReason', qoderRules.ensureFinishReason() === true)
}

// ------------------------------------------------- 与 raccoon/loomy 同构：只认「可立刻重来」
{
  check('qoder 429 可重试', qoderRules.isRetryable({ status: 429 }) === true)
  check('qoder 502 可重试', qoderRules.isRetryable({ status: 502 }) === true)
  check('qoder 503 可重试', qoderRules.isRetryable({ status: 503 }) === true)
  check('qoder 504 可重试', qoderRules.isRetryable({ status: 504 }) === true)
  // 401/403 在 qoder2api-hub 里已换号处理过；到这里还失败说明整池不可用，不重试。
  check('qoder 401 不重试', qoderRules.isRetryable({ status: 401 }) === false)
  check('qoder 403 不重试', qoderRules.isRetryable({ status: 403 }) === false)
  check('qoder 200 不重试', qoderRules.isRetryable({ status: 200 }) === false)
  check('qoder 500 不重试（上游已换号处理过）', qoderRules.isRetryable({ status: 500 }) === false)
  // 400 一律不重试：空 messages、参数非法是确定性失败，重试不会改变结果。
  check('qoder 400 不重试', qoderRules.isRetryable({ status: 400 }) === false)
  // 退避短一档：账号冷却以百秒计，本层只是磨掉瞬时抖动。
  check('qoder 退避上限 15s', qoderRules.backoffMs({ attempt: 10 }) <= 15_000)
  check('qoder 退避 2^attempt 增长', qoderRules.backoffMs({ attempt: 0 }) === 2_000 && qoderRules.backoffMs({ attempt: 1 }) === 4_000)
  check('qoder 重试预算 20s', qoderRules.retryBudgetMs({}) === 20_000)
  check('qoder 全局冷却 0（不叠冷却）', qoderRules.cooldownMs() === 0)
  check('qoder 最大尝试 3', qoderRules.maxAttempts() === 3)
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
