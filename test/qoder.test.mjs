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
 *  5. 与 raccoon/loomy 同构：上游自己换号重试，本层只认 408/429/5xx，
 *     400 一律不重试（确定性 400 重试只会污染 keep-alive 连接），退避短、不叠预算。
 *  6. （2026-11-07 修复）流内/HTTP 200 业务错误翻译（translateBusinessError /
 *     statusForError）：网关在已建好的 SSE 流里投 `{"error":{...}}` 后紧跟 [DONE]，
 *     此前本层不认 → proxy 补合成 stop → 客户端收到空的「成功」响应（即「qoder 经常失败」）。
 *  7. （2026-11-07 修复）思考阶段断流兜底（ensureFinishReason(model, meta) + streamAbortFrame）：
 *     只发过 reasoning_content、没正文没工具调用时拒绝补 stop，改发错误帧，
 *     避免把思考草稿当最终答案（与 loomy.mjs 的 spark-x2.6 坑同构）。
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
  check('qoder ensureFinishReason 无参向后兼容', qoderRules.ensureFinishReason() === true)
}

// ------------------------------------------------- 流内/JSON 业务错误翻译（2026-11-07 修复）
{
  // 网关在已建好的 SSE 流里投的错误帧（qoder_proxy.py:14142-14157）。
  const upstreamErr = { error: { message: 'upstream stream error: connection reset', type: 'upstream_error', code: 502 } }
  const t1 = qoderRules.translateBusinessError(upstreamErr)
  check('qoder 翻译流内 upstream_error', t1 !== undefined && t1.error.code === 502 && t1.error.type === 'upstream_error')
  check('qoder 翻译保留原始 message', t1 !== undefined && t1.error.message === 'upstream stream error: connection reset')

  // 网关「空上游流」（qoder_proxy.py:14154-14157）——type 是 server_error，无 code。
  const emptyErr = { error: { message: 'empty upstream stream', type: 'server_error' } }
  const t2 = qoderRules.translateBusinessError(emptyErr)
  check('qoder 翻译 empty upstream stream -> 502', t2 !== undefined && t2.error.code === 502)

  // 网关限流帧（qoder_proxy.py:10967-10988）——type=rate_limit_error, code=429。
  const rateErr = { error: { message: 'upstream rate limit reached for this model; retry in 60s', type: 'rate_limit_error', code: 429 } }
  const t3 = qoderRules.translateBusinessError(rateErr)
  check('qoder 翻译 rate_limit_error -> 429', t3 !== undefined && t3.error.code === 429)

  // 整池无可用账号（qoder_proxy.py:13442-13444）——应翻成 503（可重试）。
  const noAcc = { error: { message: 'no usable account - add or enable one at the dashboard', type: 'server_error' } }
  const t4 = qoderRules.translateBusinessError(noAcc)
  check('qoder 翻译 no usable account -> 503', t4 !== undefined && t4.error.code === 503)

  // 正常 completion chunk 不误判。
  const normal = { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }
  check('qoder 正常 chunk 不翻译', qoderRules.translateBusinessError(normal) === undefined)
  // 非 error 对象 / 空值不崩。
  check('qoder null 不翻译', qoderRules.translateBusinessError(null) === undefined)
  check('qoder 非 error 帧不翻译', qoderRules.translateBusinessError({ id: 'x' }) === undefined)

  // statusForError：HTTP 200 + 业务错误体给真实状态码。
  check('qoder statusForError upstream_error -> 502', qoderRules.statusForError(upstreamErr) === 502)
  check('qoder statusForError rate_limit -> 429', qoderRules.statusForError(rateErr) === 429)
  check('qoder statusForError no account -> 503', qoderRules.statusForError(noAcc) === 503)
  check('qoder statusForError 正常体 undefined', qoderRules.statusForError(normal) === undefined)
}

// ------------------------------------------------- 思考阶段断流兜底（2026-11-07 修复）
{
  // 只发过 reasoning_content、没正文没工具调用、没 finish_reason → 拒绝补 stop。
  const thinkingOnly = { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false }
  check('qoder 思考阶段断流不补 stop', qoderRules.ensureFinishReason('Qwen3.8-Max', thinkingOnly) === false)
  // 已发过正文 → 可以补 stop。
  const hasContent = { sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }
  check('qoder 已发正文断流补 stop', qoderRules.ensureFinishReason('Qwen3.8-Max', hasContent) === true)
  // 已发过工具调用 → 可以补 stop。
  const hasTool = { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: true }
  check('qoder 已发工具调用断流补 stop', qoderRules.ensureFinishReason('Qwen3.8-Max', hasTool) === true)
  // 已收到 finish_reason → 不干预。
  const done = { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: false }
  check('qoder 已收 finish_reason 不干预', qoderRules.ensureFinishReason('Qwen3.8-Max', done) === true)
  // 没发过任何东西 → 不干预（交给 proxy 默认行为）。
  const nothing = { sawFinishReason: false, sentAnything: false, sawContent: false, sawToolCall: false }
  check('qoder 空流不干预', qoderRules.ensureFinishReason('Qwen3.8-Max', nothing) === true)

  // streamAbortFrame：思考阶段断流给错误帧。
  const frame = qoderRules.streamAbortFrame(thinkingOnly)
  check('qoder 思考断流给错误帧', frame !== undefined && frame.error.code === 502 && frame.error.type === 'upstream_error')
  check('qoder 已发正文断流不给错误帧', qoderRules.streamAbortFrame(hasContent) === undefined)
  check('qoder 已收 finish_reason 不给错误帧', qoderRules.streamAbortFrame(done) === undefined)
  check('qoder 空流不给错误帧', qoderRules.streamAbortFrame(nothing) === undefined)
}

// ------------------------------------------------- 重试面扩大到传输层瞬时故障
{
  check('qoder 408 可重试', qoderRules.isRetryable({ status: 408 }) === true)
  check('qoder 500 可重试（整池失败后的瞬时重试）', qoderRules.isRetryable({ status: 500 }) === true)
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
  check('qoder 500 可重试（整池失败后的瞬时重试）', qoderRules.isRetryable({ status: 500 }) === true)
  // 400 一律不重试：空 messages、参数非法是确定性失败，重试不会改变结果。
  check('qoder 400 不重试', qoderRules.isRetryable({ status: 400 }) === false)
  // 退避短一档：账号冷却以百秒计，本层只是磨掉瞬时抖动。
  check('qoder 退避上限 15s', qoderRules.backoffMs({ attempt: 10 }) <= 15_000)
  check('qoder 退避 2^attempt 增长', qoderRules.backoffMs({ attempt: 0 }) === 2_000 && qoderRules.backoffMs({ attempt: 1 }) === 4_000)
  check('qoder 重试预算 20s', qoderRules.retryBudgetMs({}) === 20_000)
  check('qoder 全局冷却 0（不叠冷却）', qoderRules.cooldownMs() === 0)
  check('qoder 最大尝试 3', qoderRules.maxAttempts() === 3)
}

// ------------------------------------------------- 网关自定义错误类型（2026-11-08 二段修复）
{
  // friendly_upstream_error() / _queue_error_frame() 的真实帧形状。此前除
  // upstream_empty_response（消息命中 UPSTREAM_BROKEN_RE）外全被吞掉。
  const cases = [
    ['upstream_queued', 503, '上游模型排队中（10605 / RESOURCE_LIMIT）：请稍后重试', 429],
    ['quota_exhausted', 429, '上游拒绝本次模型额度/套餐权限（112）', 429],
    ['quota_daily_limit', 429, '上游账号今日请求次数已达上限（110）', 429],
    ['upstream_transient_error', 502, '上游瞬时错误，请重试', 502],
    ['upstream_plan_rejected', 402, '上游返回套餐购买/权限入口', 402],
    ['upstream_empty_response', 502, 'empty upstream stream', 502],
    ['upstream_incomplete_tool_call', 502, '上游工具调用缺少名称', 502],
    ['upstream_image_conversion_timeout', 504, '上游图片转换超时', 504],
    ['version_too_low', 426, '客户端/网关版本过低（430）', 426],
    ['payload_too_large', 413, '请求体过大', 413],
    ['content_policy_rejected', 400, '内容策略拒绝', 400],
    ['invalid_tool_arguments', 400, '工具参数非法', 400],
  ]
  for (const [type, code, message, expected] of cases) {
    const chunk = { error: { message, type, code } }
    const t = qoderRules.translateBusinessError(chunk)
    check('qoder 识别网关自定义类型 ' + type,
      t !== undefined && t.error.code === expected && t.error.message === message)
    check('qoder statusForError ' + type + ' -> ' + expected,
      qoderRules.statusForError(chunk) === expected)
  }
  // 只有消息关键词、没有自定义 type 的排队帧也要认。
  const msgOnly = { error: { message: 'upstream rate limit: {"code":"10605","isQueued":true,"retryAfterSeconds":30}', type: 'server_error', code: 502 } }
  check('qoder 10605 消息关键词也识别', qoderRules.translateBusinessError(msgOnly) !== undefined && qoderRules.translateBusinessError(msgOnly).error.code === 429)
  check('qoder 10605 statusForError -> 429', qoderRules.statusForError(msgOnly) === 429)
  check('qoder 排队 429 可重试', qoderRules.isRetryable({ status: 429 }) === true)
  check('qoder 正常 chunk 仍不翻译',
    qoderRules.translateBusinessError({ choices: [{ index: 0, delta: { content: 'hi' } }] }) === undefined)
}

// ------------------------------------------------- 「答一步就停」续推检测（2026-11-08 三段修复）
{
  // 正例：有正文、无工具调用、有 stop、正文以意图模式结尾 → 不完整轮
  const incompleteMeta = {
    sawFinishReason: true,
    sentAnything: true,
    sawContent: true,
    sawToolCall: false,
    contentText: '好的，DSH 已经重启了。让我检查一下网关和宿主的状态，确认新的规则层已经生效。',
  }
  check('qoder isIncompleteTurn 正例（有文本无工具调用+stop）', qoderRules.isIncompleteTurn('QoDuck', incompleteMeta) === true)

  // 反例 1：有工具调用 → 完整轮
  const withToolCall = { ...incompleteMeta, sawToolCall: true }
  check('qoder isIncompleteTurn 反例（有工具调用）', qoderRules.isIncompleteTurn('QoDuck', withToolCall) === false)

  // 反例 2：无正文（只有思考）→ 不算不完整轮
  const noContent = { ...incompleteMeta, sawContent: false, contentText: '' }
  check('qoder isIncompleteTurn 反例（无正文）', qoderRules.isIncompleteTurn('QoDuck', noContent) === false)

  // 反例 3：无 finish_reason（断流）→ 不算不完整轮
  const noFinish = { ...incompleteMeta, sawFinishReason: false }
  check('qoder isIncompleteTurn 反例（无 finish_reason）', qoderRules.isIncompleteTurn('QoDuck', noFinish) === false)

  // 反例 4：正文不含意图模式 → 不算不完整轮
  const noIntent = { ...incompleteMeta, contentText: '这是正常的回答，不包含任何意图模式。' }
  check('qoder isIncompleteTurn 反例（无意图模式）', qoderRules.isIncompleteTurn('QoDuck', noIntent) === false)

  // 反例 5（用户反馈的核心误判）：意图词出现在中间，但最后一句是结论 → 正常回答，不续推
  const intentMid = { ...incompleteMeta, contentText: '让我解释一下。网关地址是 127.0.0.1:8788，状态正常。' }
  check('qoder isIncompleteTurn 反例（意图词在中间、末句是结论）', qoderRules.isIncompleteTurn('QoDuck', intentMid) === false)

  // 反例 6：英文 I'll 在中间，末句是结论 → 正常回答
  const intentMidEn = { ...incompleteMeta, contentText: "I'll explain. The gateway is up and healthy." }
  check('qoder isIncompleteTurn 反例（英文意图词在中间）', qoderRules.isIncompleteTurn('QoDuck', intentMidEn) === false)

  // 正例 2：最后一句就是意图宣告（说完就停）→ 不完整轮
  const intentLast = { ...incompleteMeta, contentText: '先看一下日志。让我检查网关状态。' }
  check('qoder isIncompleteTurn 正例（末句是意图宣告）', qoderRules.isIncompleteTurn('QoDuck', intentLast) === true)

  // 正例 3：英文末句意图宣告
  const intentLastEn = { ...incompleteMeta, contentText: "Looking at the logs. I'll check the gateway now." }
  check('qoder isIncompleteTurn 正例（英文末句意图宣告）', qoderRules.isIncompleteTurn('QoDuck', intentLastEn) === true)

  // incompleteTurnMessages：追加助手回复 + 「继续」用户消息
  const originalMessages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: '检查网关状态' },
  ]
  const continuationMessages = qoderRules.incompleteTurnMessages(originalMessages, '让我检查网关状态')
  check('qoder incompleteTurnMessages 追加 assistant 消息',
    continuationMessages.length === originalMessages.length + 2 &&
    continuationMessages[continuationMessages.length - 2].role === 'assistant' &&
    continuationMessages[continuationMessages.length - 2].content === '让我检查网关状态')
  check('qoder incompleteTurnMessages 追加 user「继续」消息',
    continuationMessages[continuationMessages.length - 1].role === 'user' &&
    continuationMessages[continuationMessages.length - 1].content === '请继续执行你刚才说要做的操作。')
  check('qoder incompleteTurnMessages 不修改原数组',
    originalMessages.length === 2)

  // maxIncompleteTurnRetries：返回 1（防止无限循环）
  check('qoder maxIncompleteTurnRetries = 1', qoderRules.maxIncompleteTurnRetries() === 1)
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
