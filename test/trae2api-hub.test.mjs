/**
 * trae2api-hub 接入的回归测试。
 *
 * 运行：node test/trae2api-hub.test.mjs
 */

import { normalizeRoute } from '../lib/proxy.mjs'
import { traeRules } from '../lib/rules/trae2api-hub.mjs'

let failures = 0
let passes = 0

function check(name, condition, detail) {
  if (condition) { passes += 1; console.log('PASS  ' + name); return }
  failures += 1; console.log('FAIL  ' + name + (detail === undefined ? '' : '  → ' + detail))
}
function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected))
}

// ------------------------------------------------- normalizeRoute 接收 trae 路由
{
  const route = normalizeRoute({
    id: 'trae2api-hub',
    upstream: 'http://127.0.0.1:8791/v1',
    apiKey: 'sk-trae-local',
    adminUrl: 'http://127.0.0.1:8791/',
    rules: ['trae2api-hub'],
    concurrency: 4,
    sessionHoldMs: 60000,
    launch: {
      command: 'C:\\Program Files\\Python311\\python.exe',
      args: ['trae_proxy.py', '--host', '127.0.0.1', '--port', '8791', '--api-key', 'sk-trae-local', '--panel-password', 'sk-trae-local'],
      cwd: 'C:\\Users\\15940\\Documents\\dsh-plugins\\dsh-api-rules\\vendor\\trae2api-hub',
      env: {
        TRAE_PROXY_DEFAULT_REALM: 'intl',
        HTTPS_PROXY: 'http://127.0.0.1:10808',
        HTTP_PROXY: 'http://127.0.0.1:10808',
        NO_PROXY: 'localhost,127.0.0.1',
      },
      readyUrl: 'http://127.0.0.1:8791/health',
      readyTimeoutMs: 60000,
    },
  })
  equal('trae route id', route.id, 'trae2api-hub')
  check('trae route 保留了 launch', route.launch !== undefined)
  equal('trae launch command', route.launch.command, 'C:\\Program Files\\Python311\\python.exe')
  equal('trae launch args 首个是 trae_proxy.py', route.launch.args?.[0], 'trae_proxy.py')
  equal('trae launch args --port 8791', route.launch.args?.includes('8791'), true)
  equal('trae launch cwd 指向 vendor 目录', route.launch.cwd, 'C:\\Users\\15940\\Documents\\dsh-plugins\\dsh-api-rules\\vendor\\trae2api-hub')
  check('trae launch env 保留 TRAE_PROXY_DEFAULT_REALM', route.launch.env?.TRAE_PROXY_DEFAULT_REALM === 'intl')
  check('trae launch env 保留 HTTPS_PROXY', route.launch.env?.HTTPS_PROXY === 'http://127.0.0.1:10808')
  check('trae launch env 保留 NO_PROXY', route.launch.env?.NO_PROXY === 'localhost,127.0.0.1')
  equal('trae launch readyUrl', route.launch.readyUrl, 'http://127.0.0.1:8791/health')
  equal('trae launch readyTimeoutMs', route.launch.readyTimeoutMs, 60000)
  equal('trae launch killOnStop 默认 true', route.launch.killOnStop, true)
  equal('trae upstream 被保留', route.upstream, 'http://127.0.0.1:8791/v1')
  equal('trae adminUrl 指向面板', route.adminUrl, 'http://127.0.0.1:8791/')
}

// ------------------------------------------------- traeRules 请求整形
{
  const body = {
    model: 'Seed-Code',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning: { effort: 'high' },
    reasoning_effort: 'high',
    max_completion_tokens: 2048,
    max_tokens: 1000,
    max_output_tokens: 3000,
  }
  const { notes } = traeRules.normalizeRequest({ body })
  check('trae 剥离了 reasoning', !('reasoning' in body), notes.join(','))
  equal('trae reasoning_effort 保留原值', body['reasoning_effort'], 'high')
  equal('trae 归一 max_tokens = min', body['max_tokens'], 1000)
  check('trae 删掉了 max_completion_tokens', !('max_completion_tokens' in body))
  check('trae 删掉了 max_output_tokens', !('max_output_tokens' in body))
  check('trae 不剥离 messages 角色', body.messages[0].role === 'user')
  check('trae 不改模型字段', body.model === 'Seed-Code')
}

{
  const body = { model: 'Seed-Code', messages: [], reasoning_effort: 'high' }
  traeRules.normalizeRequest({ body })
  check('trae 不凭空加 thinking 字段', !('thinking' in body))
  equal('trae reasoning_effort 原样保留', body['reasoning_effort'], 'high')
}

{
  const body = { model: 'Seed-Code', messages: [], reasoning: { effort: 'high' } }
  traeRules.normalizeRequest({ body })
  check('trae 只有对象 reasoning 时删除它', !('reasoning' in body))
  equal('trae 对象 reasoning.effort high -> reasoning_effort 平铺', body['reasoning_effort'], 'high')
}

{
  const body = { model: 'Seed-Code', messages: [], thinking: { effort: 'high' } }
  traeRules.normalizeRequest({ body })
  check('trae thinking 对象原样保留', body['thinking']?.effort === 'high')
}

{
  const body = { model: 'x', messages: [], max_output_tokens: 500 }
  traeRules.normalizeRequest({ body })
  equal('trae 只有 max_output_tokens 时归入 max_tokens', body['max_tokens'], 500)
  check('trae 删掉原 max_output_tokens', !('max_output_tokens' in body))
}

{
  const body = { model: 'x', messages: [] }
  traeRules.normalizeRequest({ body })
  check('trae 无 max 字段时不补', !('max_tokens' in body))
}

// ------------------------------------------------- 裸 tools 参数补壳
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
  const body = { model: 'Seed-Code', messages: [{ role: 'user', content: 'hi' }], tools: [flatTool('web_search')] }
  const { notes } = traeRules.normalizeRequest({ body })
  const p = body.tools[0].function.parameters
  equal('trae 裸根补壳：根 type 变成 object', p.type, 'object')
  check('trae 裸根补壳：properties 是对象', p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties))
  const props = (p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties)) ? p.properties : {}
  check('trae 补壳保留 listPath/query/top 三个参数', ['listPath', 'query', 'top'].every((k) => k in props))
  check('trae 补壳把根级 type 降为 properties.type 普通参数', 'type' in props && typeof props.type === 'object')
  check('trae 补壳写进 notes', notes.some((n) => n.includes('flat tool parameter')))
}

{
  const original = cleanTool('alpha')
  const snapshot = JSON.stringify(original)
  const body = { model: 'Seed-Code', messages: [], tools: [original] }
  const { notes } = traeRules.normalizeRequest({ body })
  equal('trae 合规 object 外壳原样不动', JSON.stringify(body.tools[0]), snapshot)
  check('trae 合规外壳不写补壳 notes', !notes.some((n) => n.includes('flat tool parameter')))
}

{
  for (const tools of [undefined, null, 'oops', {}, [null, 3, 'x'], [{ type: 'function', function: { name: 'nope' } }]]) {
    const body = { model: 'x', messages: [] }
    if (tools !== undefined) body.tools = tools
    let ok = true
    try { traeRules.normalizeRequest({ body }) } catch (e) { ok = false; console.log('  threw: ' + e.message) }
    check('trae 异常 tools 形状不崩（' + JSON.stringify(tools) + '）', ok)
  }
}

// ------------------------------------------------- traeRules 响应整形 + 图片
{
  equal('trae finishReason other -> stop', traeRules.finishReason('other'), 'stop')
  equal('trae finishReason null -> stop', traeRules.finishReason(null), 'stop')
  equal('trae finishReason undefined -> stop', traeRules.finishReason(undefined), 'stop')
  equal('trae finishReason stop 原样', traeRules.finishReason('stop'), 'stop')
  equal('trae finishReason length 原样', traeRules.finishReason('length'), 'length')
  const delta = { content: null }
  traeRules.normalizeDelta(delta)
  equal('trae null content chunk -> 空串', delta['content'], '')
  const delta2 = { content: 'hi' }
  traeRules.normalizeDelta(delta2)
  equal('trae 非空 content 不动', delta2['content'], 'hi')
  equal('trae 支持图片', traeRules.supportsImages(), true)
  check('trae ensureFinishReason 无参向后兼容', traeRules.ensureFinishReason() === true)
}

// ------------------------------------------------- 可重试判定
{
  for (const status of [408, 429, 500, 502, 503, 504]) {
    check('trae status ' + status + ' 可重试', traeRules.isRetryable({ status }) === true)
  }
  for (const status of [400, 401, 403, 404, 413, 422]) {
    check('trae status ' + status + ' 不重试（确定性失败）', traeRules.isRetryable({ status }) === false)
  }
  equal('trae backoffMs attempt 0', traeRules.backoffMs({ attempt: 0 }), 2000)
  equal('trae backoffMs attempt 1', traeRules.backoffMs({ attempt: 1 }), 4000)
  equal('trae backoffMs 封顶 15000', traeRules.backoffMs({ attempt: 10 }), 15000)
  equal('trae retryBudgetMs', traeRules.retryBudgetMs(), 20000)
  equal('trae maxAttempts', traeRules.maxAttempts(), 3)
  equal('trae cooldownMs', traeRules.cooldownMs(), 0)
  equal('trae isConcurrencyError', traeRules.isConcurrencyError(), false)
}

// ------------------------------------------------- 业务错误翻译
{
  const noAcc = traeRules.translateBusinessError({ error: { message: "no usable account for realm 'cn': all are disabled, cooling down, or expired", type: 'server_error' } })
  check('trae translateBusinessError 无账号 -> 503', noAcc !== undefined && noAcc.error.code === 503)
  const queue = traeRules.translateBusinessError({ error: { message: '10605 upstream model queue is full', type: 'upstream_error' } })
  check('trae translateBusinessError 排队 -> 429', queue !== undefined && queue.error.code === 429)
  const over = traeRules.translateBusinessError({ error: { message: '服务器繁忙，请稍后重试', type: 'server_error' } })
  check('trae translateBusinessError 过载 -> 503', over !== undefined && over.error.code === 503)
  const badModel = traeRules.translateBusinessError({ error: { message: 'model_unknown: Seed-Code not found', type: 'invalid_request_error' } })
  check('trae translateBusinessError 模型非法 -> 400', badModel !== undefined && badModel.error.code === 400)
  const broken = traeRules.translateBusinessError({ error: { message: 'empty upstream stream', type: 'server_error' } })
  check('trae translateBusinessError 上游断流 -> 502', broken !== undefined && broken.error.code === 502)
  const other = traeRules.translateBusinessError({ error: { message: 'something else', type: 'invalid_request_error' } })
  check('trae translateBusinessError 已知 type 走 map -> 400', other !== undefined && other.error.code === 400)
  check('trae translateBusinessError null -> undefined', traeRules.translateBusinessError(null) === undefined)
}

{
  check('trae statusForError 无账号 -> 503', traeRules.statusForError({ error: { message: 'no usable account', type: 'server_error' } }) === 503)
  check('trae statusForError 模型非法 -> 400', traeRules.statusForError({ error: { message: 'banned model', type: 'invalid_request_error' } }) === 400)
  check('trae statusForError 排队 -> 429', traeRules.statusForError({ error: { message: 'upstream model queue is full', type: 'upstream_error' } }) === 429)
  check('trae statusForError 上游断流 -> 502', traeRules.statusForError({ error: { message: 'upstream unreachable', type: 'server_error' } }) === 502)
  check('trae statusForError 已知 type 走 map -> 400', traeRules.statusForError({ error: { message: 'x', type: 'invalid_request_error' } }) === 400)
}

// ------------------------------------------------- 思考阶段断流兜底
{
  const frame = traeRules.streamAbortFrame({ sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false })
  check('trae 思考阶段断流 -> 502 错误帧', frame !== undefined && frame.error.code === 502)
  check('trae 已 finish_reason 时不补错误帧', traeRules.streamAbortFrame({ sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false }) === undefined)
  check('trae 未发任何东西时不补错误帧', traeRules.streamAbortFrame({ sawFinishReason: false, sentAnything: false, sawContent: false, sawToolCall: false }) === undefined)
  check('trae 已发正文时不补错误帧', traeRules.streamAbortFrame({ sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }) === undefined)

  check('trae ensureFinishReason 思考阶段断流 -> false', traeRules.ensureFinishReason('Seed-Code', { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false }) === false)
  check('trae ensureFinishReason 已 finish -> true', traeRules.ensureFinishReason('Seed-Code', { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: false }) === true)
  check('trae ensureFinishReason 已发正文 -> true', traeRules.ensureFinishReason('Seed-Code', { sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }) === true)
}

// ------------------------------------------------- 「答一步就停」检测
{
  check('trae 最后一句意图词 -> 不完整轮', traeRules.isIncompleteTurn('Seed-Code', { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: false, contentText: '我先检查一下这个项目。' }) === true)
  check('trae 已发工具调用 -> 完整', traeRules.isIncompleteTurn('Seed-Code', { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: true, contentText: '我先检查一下这个项目。' }) === false)
  check('trae 意图词在非最后一句 -> 完整', traeRules.isIncompleteTurn('Seed-Code', { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: false, contentText: '让我解释一下。项目很简单，代码很清楚。' }) === false)
  check('trae 无正文 -> 完整', traeRules.isIncompleteTurn('Seed-Code', { sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false, contentText: '' }) === false)
  check('trae 未 finish -> 完整', traeRules.isIncompleteTurn('Seed-Code', { sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false, contentText: '我先检查一下。' }) === false)
}

// ------------------------------------------------- 续推消息构造
{
  const original = [{ role: 'user', content: '帮我查一下' }]
  const next = traeRules.incompleteTurnMessages(original, '我先检查一下项目。')
  check('trae 续推追加 assistant 消息', next.length === original.length + 2 && next[next.length - 2].role === 'assistant')
  check('trae 续推追加「继续」用户消息', next[next.length - 1].role === 'user' && next[next.length - 1].content.includes('继续'))
  check('trae 续推不修改原数组', original.length === 1)
  equal('trae 续推最大重试次数', traeRules.maxIncompleteTurnRetries(), 1)
}

// ------------------------------------------------- 汇总
console.log('')
console.log('passes: ' + passes + '  failures: ' + failures)
if (failures > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('ALL SCENARIOS PASS')
