/**
 * minimax2api 接入的回归测试。
 *
 * 覆盖几件事：
 *  1. minimax 路由的 normalizeRoute 正确规整 launch（command/args/cwd/env/readyUrl/killOnStop）。
 *  2. minimaxRules 的请求整形：删对象形式 `reasoning`、把 max_completion_tokens/max_output_tokens
 *     归一到 max_tokens、给裸 tools.parameters 补 object 外壳、以及 **reasoning_effort →
 *     thinking 布尔开关翻译**（off/none/disabled/minimal/false/0 → false；low/medium/high/
 *     xhigh/max → true；没带档位时不动 thinking，让上游默认生效）。
 *  3. supportsImages() = true（图片原样透传，由 provider 的 input 声明控制）。
 *  4. 可重试判定：408/429/500/502/503/504 → true；400 确定性失败 → false（与 qoder/loomy 同构）。
 *  5. 流内/HTTP 200 业务错误翻译（translateBusinessError / statusForError）：订阅→503、
 *     无账号→503、过载→503（带 code 时保留）、模型非法→400、上游断流→502。
 *  6. 思考阶段断流兜底（ensureFinishReason + streamAbortFrame）：只发过 reasoning_content、
 *     没正文没工具调用时拒绝补 stop，改发错误帧。
 *  7. finish_reason 异常值与 null content 兜底。
 *  8. 「答一步就停」检测（isIncompleteTurn）：只匹配最后一句意图词。
 *
 * minimax2api 是 Go 静态编译二进制（含内嵌前端），上游已 vendored 进 vendor/minimax2api/，
 * 没有像 loomy2api 那样打「400 瞬时重试」补丁，因此本测试不校验 vendor 源码内容。
 * 运行：node test/minimax2api.test.mjs
 */

import { normalizeRoute } from '../lib/proxy.mjs'
import { minimaxRules } from '../lib/rules/minimax2api.mjs'

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

// ------------------------------------------------- normalizeRoute 接收 minimax 路由
{
  const route = normalizeRoute({
    id: 'minimax2api',
    upstream: 'http://127.0.0.1:8080/v1',
    apiKey: 'sk-mm-local',
    adminUrl: 'http://127.0.0.1:8080/',
    rules: ['minimax2api'],
    concurrency: 4,
    sessionHoldMs: 60000,
    launch: {
      command: 'C:\\Users\\15940\\Documents\\dsh-plugins\\dsh-api-rules\\vendor\\minimax2api\\minimax2api.exe',
      args: ['-addr', '127.0.0.1:8080'],
      cwd: 'C:\\Users\\15940\\Documents\\dsh-plugins\\dsh-api-rules\\vendor\\minimax2api',
      env: {
        MINIMAX2API_DATA: 'data',
        MINIMAX2API_ADMIN_PASSWORD: 'sk-mm-local',
        MINIMAX2API_CLIENT_KEY: 'sk-mm-local',
        MINIMAX2API_CLIENT_KEY_NAME: 'dsh',
        HTTPS_PROXY: 'http://127.0.0.1:10808',
        HTTP_PROXY: 'http://127.0.0.1:10808',
        NO_PROXY: 'localhost,127.0.0.1',
      },
      readyUrl: 'http://127.0.0.1:8080/health',
      readyTimeoutMs: 60000,
    },
  })
  equal('minimax route id', route.id, 'minimax2api')
  check('minimax route 保留了 launch', route.launch !== undefined)
  equal('minimax launch command', route.launch.command, 'C:\\Users\\15940\\Documents\\dsh-plugins\\dsh-api-rules\\vendor\\minimax2api\\minimax2api.exe')
  equal('minimax launch args 首个是 -addr', route.launch.args?.[0], '-addr')
  equal('minimax launch args 次个是监听地址', route.launch.args?.[1], '127.0.0.1:8080')
  equal('minimax launch cwd 指向 vendor 目录', route.launch.cwd, 'C:\\Users\\15940\\Documents\\dsh-plugins\\dsh-api-rules\\vendor\\minimax2api')
  check('minimax launch env 保留 MINIMAX2API_CLIENT_KEY', route.launch.env?.MINIMAX2API_CLIENT_KEY === 'sk-mm-local')
  check('minimax launch env 保留 HTTPS_PROXY', route.launch.env?.HTTPS_PROXY === 'http://127.0.0.1:10808')
  check('minimax launch env 保留 NO_PROXY', route.launch.env?.NO_PROXY === 'localhost,127.0.0.1')
  equal('minimax launch readyUrl', route.launch.readyUrl, 'http://127.0.0.1:8080/health')
  equal('minimax launch readyTimeoutMs', route.launch.readyTimeoutMs, 60000)
  equal('minimax launch killOnStop 默认 true', route.launch.killOnStop, true)
  equal('minimax upstream 被保留', route.upstream, 'http://127.0.0.1:8080/v1')
  equal('minimax adminUrl 指向面板', route.adminUrl, 'http://127.0.0.1:8080/')
}

// ------------------------------------------------- minimaxRules 请求整形：reasoning_effort → thinking 布尔
{
  // 对象形式 reasoning 应被删掉，reasoning_effort 翻译成 thinking:true
  const body = {
    model: 'minimax-m3',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning: { effort: 'high' },
    reasoning_effort: 'high',
    max_completion_tokens: 2048,
    max_tokens: 1000,
    max_output_tokens: 3000,
  }
  const { notes } = minimaxRules.normalizeRequest({ body })
  check('minimax 剥离了 reasoning（DSH 透传对象）', !('reasoning' in body), notes.join(','))
  equal('minimax reasoning_effort high -> thinking true', body['thinking'], true)
  equal('minimax 归一 max_tokens = min', body['max_tokens'], 1000)
  check('minimax 删掉了 max_completion_tokens', !('max_completion_tokens' in body))
  check('minimax 删掉了 max_output_tokens', !('max_output_tokens' in body))
  check('minimax 不剥离 messages 角色', body.messages[0].role === 'user')
  check('minimax 不改模型字段', body.model === 'minimax-m3')
  check('minimax 翻译写进 notes', notes.some((n) => n.includes('reasoning_effort high -> thinking true')))
}

{
  // off / none / disabled / minimal 都翻译成 thinking:false
  for (const level of ['off', 'none', 'disabled', 'minimal']) {
    const body = { model: 'minimax-m3', messages: [], reasoning_effort: level }
    minimaxRules.normalizeRequest({ body })
    equal('minimax reasoning_effort ' + level + ' -> thinking false', body['thinking'], false)
  }
}

{
  // low/medium/high/xhigh/max 翻译成 thinking:true
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const body = { model: 'minimax-m3', messages: [], reasoning_effort: level }
    minimaxRules.normalizeRequest({ body })
    equal('minimax reasoning_effort ' + level + ' -> thinking true', body['thinking'], true)
  }
}

{
  // 没带档位时不动 thinking（让上游默认生效）
  const body = { model: 'minimax-m3', messages: [] }
  const { notes } = minimaxRules.normalizeRequest({ body })
  check('minimax 无档位时不凭空加 thinking', !('thinking' in body), notes.join(','))
}

{
  // 单独给对象 reasoning（无显式 reasoning_effort）：applyReasoningEffort 把 effort 摊平到
  // reasoning_effort，随后本层翻译成 thinking 布尔。
  const body = { model: 'minimax-m3', messages: [], reasoning: { effort: 'high' } }
  minimaxRules.normalizeRequest({ body })
  check('minimax 只有对象 reasoning 时删除它', !('reasoning' in body))
  equal('minimax 对象 reasoning.effort high -> thinking true', body['thinking'], true)
}

{
  // 上游已认识的 thinking 布尔原样保留（不覆盖）
  const body = { model: 'minimax-m3', messages: [], thinking: true }
  minimaxRules.normalizeRequest({ body })
  check('minimax thinking 布尔原样保留', body['thinking'] === true)
}

{
  // 只给 max_output_tokens 时也应落到 max_tokens
  const body = { model: 'x', messages: [], max_output_tokens: 500 }
  minimaxRules.normalizeRequest({ body })
  equal('minimax 只有 max_output_tokens 时归入 max_tokens', body['max_tokens'], 500)
  check('minimax 删掉原 max_output_tokens', !('max_output_tokens' in body))
}

{
  // 没给任何 max 字段时不凭空补
  const body = { model: 'x', messages: [] }
  minimaxRules.normalizeRequest({ body })
  check('minimax 无 max 字段时不补', !('max_tokens' in body))
}

// ------------------------------------------------- 裸 tools 参数补壳（防御性，与 loomy/qoder 同款）
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
  // 裸属性表（含根级 type 键）应被补成 {type:object, properties: 原表}
  const body = { model: 'minimax-m3', messages: [{ role: 'user', content: 'hi' }], tools: [flatTool('web_search')] }
  const { notes } = minimaxRules.normalizeRequest({ body })
  const p = body.tools[0].function.parameters
  equal('minimax 裸根补壳：根 type 变成 object', p.type, 'object')
  check('minimax 裸根补壳：properties 是对象', p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties))
  const props = (p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties)) ? p.properties : {}
  check('minimax 补壳保留 listPath/query/top 三个参数', ['listPath', 'query', 'top'].every((k) => k in props))
  check('minimax 补壳把根级 type 降为 properties.type 普通参数', 'type' in props && typeof props.type === 'object')
  check('minimax 补壳写进 notes', notes.some((n) => n.includes('flat tool parameter')))
}

{
  // 合规 object 外壳一律原样放行
  const original = cleanTool('alpha')
  const snapshot = JSON.stringify(original)
  const body = { model: 'minimax-m3', messages: [], tools: [original] }
  const { notes } = minimaxRules.normalizeRequest({ body })
  equal('minimax 合规 object 外壳原样不动', JSON.stringify(body.tools[0]), snapshot)
  check('minimax 合规外壳不写补壳 notes', !notes.some((n) => n.includes('flat tool parameter')))
}

{
  // 非数组 tools / 缺 parameters / 非对象 tools 不崩、不误补
  for (const tools of [undefined, null, 'oops', {}, [null, 3, 'x'], [{ type: 'function', function: { name: 'nope' } }]]) {
    const body = { model: 'x', messages: [] }
    if (tools !== undefined) body.tools = tools
    let ok = true
    try { minimaxRules.normalizeRequest({ body }) } catch (e) { ok = false; console.log('  threw: ' + e.message) }
    check('minimax 异常 tools 形状不崩（' + JSON.stringify(tools) + '）', ok)
  }
}

// ------------------------------------------------- minimaxRules 响应整形 + 图片
{
  equal('minimax finishReason other -> stop', minimaxRules.finishReason('other'), 'stop')
  equal('minimax finishReason null -> stop', minimaxRules.finishReason(null), 'stop')
  equal('minimax finishReason undefined -> stop', minimaxRules.finishReason(undefined), 'stop')
  equal('minimax finishReason stop 原样', minimaxRules.finishReason('stop'), 'stop')
  equal('minimax finishReason length 原样', minimaxRules.finishReason('length'), 'length')
  const delta = { content: null }
  minimaxRules.normalizeDelta(delta)
  equal('minimax null content chunk -> 空串', delta['content'], '')
  const delta2 = { content: 'hi' }
  minimaxRules.normalizeDelta(delta2)
  equal('minimax 非空 content 不动', delta2['content'], 'hi')
  equal('minimax 支持图片', minimaxRules.supportsImages(), true)
  check('minimax ensureFinishReason 无参向后兼容', minimaxRules.ensureFinishReason() === true)
}

// ------------------------------------------------- 可重试判定
{
  for (const status of [408, 429, 500, 502, 503, 504]) {
    check('minimax status ' + status + ' 可重试', minimaxRules.isRetryable({ status }) === true)
  }
  for (const status of [400, 401, 403, 404, 413, 422]) {
    check('minimax status ' + status + ' 不重试（确定性失败）', minimaxRules.isRetryable({ status }) === false)
  }
  equal('minimax backoffMs attempt 0', minimaxRules.backoffMs({ attempt: 0 }), 2000)
  equal('minimax backoffMs attempt 1', minimaxRules.backoffMs({ attempt: 1 }), 4000)
  equal('minimax backoffMs 封顶 15000', minimaxRules.backoffMs({ attempt: 10 }), 15000)
  equal('minimax retryBudgetMs', minimaxRules.retryBudgetMs(), 20000)
  equal('minimax maxAttempts', minimaxRules.maxAttempts(), 3)
  equal('minimax cooldownMs', minimaxRules.cooldownMs(), 0)
  equal('minimax isConcurrencyError', minimaxRules.isConcurrencyError(), false)
}

// ------------------------------------------------- 业务错误翻译（translateBusinessError / statusForError）
{
  // 订阅缺失 → 503
  const sub = minimaxRules.translateBusinessError({ error: { message: 'subscription account required: minimax-h3 needs a Token Plan account and the pool has none', type: 'minimax2api_error' } })
  check('minimax translateBusinessError 订阅 -> 503', sub !== undefined && sub.error.code === 503)
  // 无账号 → 503
  const noAcc = minimaxRules.translateBusinessError({ error: { message: 'no account available', type: 'minimax2api_error' } })
  check('minimax translateBusinessError 无账号 -> 503', noAcc !== undefined && noAcc.error.code === 503)
  // 过载 → 503
  const over = minimaxRules.translateBusinessError({ error: { message: '服务器繁忙，请稍后重试', type: 'minimax2api_error' } })
  check('minimax translateBusinessError 过载 -> 503', over !== undefined && over.error.code === 503)
  // 模型非法 → 400
  const badModel = minimaxRules.translateBusinessError({ error: { message: 'unknown or disabled model "foo"', type: 'minimax2api_error' } })
  check('minimax translateBusinessError 模型非法 -> 400', badModel !== undefined && badModel.error.code === 400)
  // 上游断流 → 502
  const broken = minimaxRules.translateBusinessError({ error: { message: 'upstream stream broken', type: 'minimax2api_error' } })
  check('minimax translateBusinessError 上游断流 -> 502', broken !== undefined && broken.error.code === 502)
  // 非网关错误 → undefined
  const other = minimaxRules.translateBusinessError({ error: { message: 'something else', type: 'invalid_request_error' } })
  check('minimax translateBusinessError 非网关错误 -> undefined', other === undefined)
  // 非对象 → undefined
  check('minimax translateBusinessError null -> undefined', minimaxRules.translateBusinessError(null) === undefined)
}

{
  // statusForError 与 translateBusinessError 同源推断
  check('minimax statusForError 订阅 -> 503', minimaxRules.statusForError({ error: { message: 'subscription account required', type: 'minimax2api_error' } }) === 503)
  check('minimax statusForError 无账号 -> 503', minimaxRules.statusForError({ error: { message: 'no account available', type: 'minimax2api_error' } }) === 503)
  check('minimax statusForError 模型非法 -> 400', minimaxRules.statusForError({ error: { message: 'not a chat model', type: 'minimax2api_error' } }) === 400)
  check('minimax statusForError 上游断流 -> 502', minimaxRules.statusForError({ error: { message: 'upstream unreachable', type: 'minimax2api_error' } }) === 502)
  check('minimax statusForError 非网关错误 -> undefined', minimaxRules.statusForError({ error: { message: 'x', type: 'invalid_request_error' } }) === undefined)
}

// ------------------------------------------------- 思考阶段断流兜底（streamAbortFrame / ensureFinishReason）
{
  // 只发过思考、没正文没工具调用、没 finish_reason → 发错误帧
  const frame = minimaxRules.streamAbortFrame({ sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false })
  check('minimax 思考阶段断流 -> 502 错误帧', frame !== undefined && frame.error.code === 502)
  // 已发过 finish_reason → 不补错误帧
  check('minimax 已 finish_reason 时不补错误帧', minimaxRules.streamAbortFrame({ sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false }) === undefined)
  // 还没发任何东西 → 不补错误帧
  check('minimax 未发任何东西时不补错误帧', minimaxRules.streamAbortFrame({ sawFinishReason: false, sentAnything: false, sawContent: false, sawToolCall: false }) === undefined)
  // 已发正文 → 不补错误帧
  check('minimax 已发正文时不补错误帧', minimaxRules.streamAbortFrame({ sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }) === undefined)

  // ensureFinishReason：思考阶段断流拒绝补 stop
  check('minimax ensureFinishReason 思考阶段断流 -> false', minimaxRules.ensureFinishReason('minimax-m3', { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false }) === false)
  // 已发 finish_reason → 补
  check('minimax ensureFinishReason 已 finish -> true', minimaxRules.ensureFinishReason('minimax-m3', { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: false }) === true)
  // 已发正文 → 补
  check('minimax ensureFinishReason 已发正文 -> true', minimaxRules.ensureFinishReason('minimax-m3', { sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }) === true)
}

// ------------------------------------------------- 「答一步就停」检测（isIncompleteTurn）
{
  // 最后一句是意图词、没工具调用 → 不完整
  check(
    'minimax 最后一句意图词 -> 不完整轮',
    minimaxRules.isIncompleteTurn('minimax-agent', { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: false, contentText: '我先检查一下这个项目。' }) === true,
  )
  // 有工具调用 → 完整
  check(
    'minimax 已发工具调用 -> 完整',
    minimaxRules.isIncompleteTurn('minimax-agent', { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: true, contentText: '我先检查一下这个项目。' }) === false,
  )
  // 意图词在非最后一句 → 完整（正常回答中间出现「让我解释」不算早停）
  check(
    'minimax 意图词在非最后一句 -> 完整',
    minimaxRules.isIncompleteTurn('minimax-agent', { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: false, contentText: '让我解释一下。项目很简单，代码很清楚。' }) === false,
  )
  // 没正文 → 完整
  check(
    'minimax 无正文 -> 完整',
    minimaxRules.isIncompleteTurn('minimax-agent', { sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false, contentText: '' }) === false,
  )
  // 没 finish_reason → 完整
  check(
    'minimax 未 finish -> 完整',
    minimaxRules.isIncompleteTurn('minimax-agent', { sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false, contentText: '我先检查一下。' }) === false,
  )
}

// ------------------------------------------------- 续推消息构造
{
  const original = [{ role: 'user', content: '帮我查一下' }]
  const next = minimaxRules.incompleteTurnMessages(original, '我先检查一下项目。')
  check('minimax 续推追加 assistant 消息', next.length === original.length + 2 && next[next.length - 2].role === 'assistant')
  check('minimax 续推追加「继续」用户消息', next[next.length - 1].role === 'user' && next[next.length - 1].content.includes('继续'))
  check('minimax 续推不修改原数组', original.length === 1)
  equal('minimax 续推最大重试次数', minimaxRules.maxIncompleteTurnRetries(), 1)
}

// ------------------------------------------------- 汇总
console.log('')
console.log('passes: ' + passes + '  failures: ' + failures)
if (failures > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('ALL SCENARIOS PASS')
