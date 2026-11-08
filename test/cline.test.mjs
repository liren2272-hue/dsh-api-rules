/**
 * cline / cline2api 接入的回归测试。
 *
 * 覆盖三件事：
 *  1. cline 路由的 normalizeRoute 正确规整 launch（command/args/readyPath 等），
 *     且不因为「credentialed 且无 upstream」被拒绝；
 *  2. clineRules 的请求整形：剥离 reasoning/thinking、把 max_completion_tokens
 *     归一到 max_tokens，且不做任何语义改写；null content chunk 归一成空串；
 *  3. ensureUpstream 在「上游已经活着」时返回 already_running、不 spawn 第二个进程
 *     （防止多实例）；以及 command 不存在时优雅报错（不抛、返回 spawned=false）。
 *
 * 不连真实 cline2api；第 3 项用本机 node 起一个迷你健康检查服务当「已在运行的上游」。
 * 运行：node test/cline.test.mjs
 */

import { createServer } from 'node:http'
import { normalizeRoute } from '../lib/proxy.mjs'
import { clineRules } from '../lib/rules/cline.mjs'
import { ensureUpstream } from '../lib/launcher.mjs'

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

// ------------------------------------------------- normalizeRoute 接收 cline 路由
{
  const route = normalizeRoute({
    id: 'cline',
    credentialed: true,
    upstream: 'http://127.0.0.1:3457/v1',
    apiKey: 'sk-cline',
    rules: ['cline'],
    launch: {
      command: 'C:\\Users\\15940\\.dsh\\cline2api\\cline-proxy.exe',
      args: ['-port', '3457'],
      readyPath: '/health',
      readyTimeoutMs: 20000,
    },
  })
  equal('cline route id', route.id, 'cline')
  check('cline route 保留了 launch', route.launch !== undefined)
  equal('cline launch command', route.launch.command, 'C:\\Users\\15940\\.dsh\\cline2api\\cline-proxy.exe')
  equal('cline launch args', JSON.stringify(route.launch.args), JSON.stringify(['-port', '3457']))
  equal('cline launch readyPath', route.launch.readyPath, '/health')
  equal('cline launch killOnStop 默认 true', route.launch.killOnStop, true)
  equal('cline launch cwd 未给则 undefined', route.launch.cwd, undefined)
  // credentialed 路由允许没有独立 upstream 之外的约束；这里给了 upstream 也应保留。
  equal('cline upstream 被保留', route.upstream, 'http://127.0.0.1:3457/v1')
}

// ------------------------------------------------- clineRules 请求整形
{
  const body = {
    model: 'cline-pass/deepseek-v4.1-flash',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning: { effort: 'high' },
    thinking: { type: 'enabled' },
    max_completion_tokens: 2048,
    max_tokens: 1000,
  }
  const { notes } = clineRules.normalizeRequest({ body })
  check('cline 剥离了 reasoning', !('reasoning' in body), notes.join(','))
  check('cline 剥离了 thinking', !('thinking' in body))
  equal('cline 归一 max_tokens = min(1000, 2048)', body['max_tokens'], 1000)
  check('cline 删掉了 max_completion_tokens', !('max_completion_tokens' in body))
  check('cline 不剥离 messages 角色', body.messages[0].role === 'user')
  check('cline 不改模型字段', body.model === 'cline-pass/deepseek-v4.1-flash')
}

{
  // 只给 max_completion_tokens 时也应落到 max_tokens
  const body = { model: 'x', messages: [], max_completion_tokens: 500 }
  clineRules.normalizeRequest({ body })
  equal('cline 只有 max_completion_tokens 时归入 max_tokens', body['max_tokens'], 500)
  check('cline 删掉原 max_completion_tokens', !('max_completion_tokens' in body))
}

// ------------------------------------------------- clineRules 响应整形
{
  equal('cline finishReason other -> stop', clineRules.finishReason('other'), 'stop')
  equal('cline finishReason stop 原样', clineRules.finishReason('stop'), 'stop')
  const delta = { content: null }
  clineRules.normalizeDelta(delta)
  equal('cline null content chunk -> 空串', delta['content'], '')
  const delta2 = { content: 'hi' }
  clineRules.normalizeDelta(delta2)
  equal('cline 非空 content 不动', delta2['content'], 'hi')
  check('cline 支持图片', clineRules.supportsImages() === true)
  check('cline 429 可重试', clineRules.isRetryable({ status: 429 }) === true)
  check('cline 200 不重试', clineRules.isRetryable({ status: 200 }) === false)
}

// ------------------------------------------------- ensureUpstream 不重复拉起
async function withHealthServer(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    port,
    base: 'http://127.0.0.1:' + port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

{
  // 上游（一个迷你 /health 服务）已在监听：ensureUpstream 必须 already_running，不 spawn。
  const upstream = await withHealthServer((request, response) => {
    if ((request.url ?? '').startsWith('/health')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok' }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  const result = await ensureUpstream({
    route: { id: 'cline', upstream: upstream.base + '/v1', launch: { command: 'node', args: ['--version'], readyPath: '/health' } },
    logger: { info() {}, warn() {}, error() {} },
    autoLaunch: true,
  })
  check('上游已运行时返回 already_running', result.launched === false && result.reason === 'already_running', JSON.stringify(result))
  check('already_running 时不返回 dispose（不该杀别人的进程）', result.dispose === undefined)
  await upstream.close()
}

{
  // command 不存在：确保优雅返回 spawned=false，不抛。
  const result = await ensureUpstream({
    route: { id: 'cline', upstream: 'http://127.0.0.1:1/v1', launch: { command: 'this-binary-does-not-exist-xyz', args: [], readyPath: '/health' } },
    logger: { info() {}, warn() {}, error() {} },
    autoLaunch: true,
  })
  check('command 不存在时不开新进程', result.launched === false, JSON.stringify(result))
  check('command 不存在时 reason 是 spawn_failed', result.reason === 'spawn_failed', JSON.stringify(result))
}

{
  // autoLaunch=false 时绝对不拉起。
  const upstream = await withHealthServer((request, response) => {
    response.writeHead(404)
    response.end()
  })
  const result = await ensureUpstream({
    route: { id: 'cline', upstream: upstream.base + '/v1', launch: { command: 'node', args: ['--version'], readyPath: '/health' } },
    logger: { info() {}, warn() {}, error() {} },
    autoLaunch: false,
  })
  equal('autoLaunch=false 时 reason', result.reason, 'auto_launch_disabled')
  await upstream.close()
}


// =====================================================================
// 「把思考过程输出作为答案」回归（2026-11-08）
//
// 根因：cline2api 免费模型重思考，思考放在 delta.reasoning（框架只认
// reasoning_content）；上游常把流掐在纯思考阶段，旧包 ensureFinishReason()
// 恒 true → pipeStream 补合成 finish_reason:'stop' → 客户端把思考草稿
// 当成一次干净完成的回答。修复 = 与 loomy/qoder 同族的六钩子 + 镜像语义。
//
// 这一段同时是负向对照的判据：把旧版 cline.mjs 装回时，下面这些断言
// 必须干净 FAIL（旧版缺 5 个钩子、normalizeDelta 不镜像、ensureFinishReason
// 恒 true）。hook() 守卫保证「缺钩子」只记 FAIL 不会抛崩，便于观察。
// =====================================================================

function isObj(v) {
  return v !== null && typeof v === 'object'
}

// 六个钩子必须齐全（旧版只有 normalizeDelta/finishReason，缺 5 个）。
const HOOKS = ['translateBusinessError', 'statusForError', 'streamAbortFrame', 'thinkingLimitFrame', 'ensureFinishReason', 'normalizeDelta']
for (const name of HOOKS) {
  check('cline 提供钩子 ' + name, typeof clineRules[name] === 'function', 'typeof=' + typeof clineRules[name])
}

// 缺钩子时返回 undefined，让断言干净 FAIL 而不是抛 TypeError。
function hook(name, ...args) {
  if (typeof clineRules[name] !== 'function') return undefined
  return clineRules[name](...args)
}

// ---- normalizeDelta: 把 delta.reasoning 镜像成 reasoning_content ----
{
  const delta = { content: '', reasoning: '让我仔细想想', reasoning_details: [{ type: 'reasoning.text', text: '让我仔细想想' }] }
  hook('normalizeDelta', delta)
  equal('镜像出 reasoning_content', delta['reasoning_content'], '让我仔细想想')
  check('保留原 reasoning 字段（不改名/不删）', delta['reasoning'] === '让我仔细想想')
  check('保留原 reasoning_details（不删）', Array.isArray(delta['reasoning_details']) && delta['reasoning_details'].length === 1)
  hook('normalizeDelta', delta)
  equal('重复调用幂等（不产生重复字段）', delta['reasoning_content'], '让我仔细想想')

  const delta2 = { reasoning: '新思考', reasoning_content: '已有思考' }
  hook('normalizeDelta', delta2)
  equal('已有 reasoning_content 不被覆盖', delta2['reasoning_content'], '已有思考')

  const delta3 = { reasoning: '' }
  hook('normalizeDelta', delta3)
  check('空串 reasoning 不镜像', !('reasoning_content' in delta3))
  const delta4 = { reasoning: null }
  hook('normalizeDelta', delta4)
  check('null reasoning 不镜像', !('reasoning_content' in delta4))

  const delta5 = { content: null, reasoning: 'x' }
  hook('normalizeDelta', delta5)
  equal('null content 仍归一空串（旧行为保留）', delta5['content'], '')
  equal('归一同时仍镜像思考', delta5['reasoning_content'], 'x')
}

// ---- translateBusinessError: 错误帧翻成标准 OpenAI 错误帧 ----
{
  check('正常 chunk 不算业务错误', hook('translateBusinessError', { choices: [{ delta: { reasoning: 'x' } }] }) === undefined)
  check('非对象不算业务错误', hook('translateBusinessError', 'oops') === undefined)

  const disabled = hook('translateBusinessError', { error: { message: 'model cline-pass/deepseek-v4.1-flash is disabled', type: 'invalid_request_error' } })
  check('disabled 错误帧被翻译', disabled !== undefined && isObj(disabled.error))
  equal('disabled → type upstream_error', disabled && disabled.error.type, 'upstream_error')
  equal('disabled → code 400', disabled && disabled.error.code, 400)

  const noAcct = hook('translateBusinessError', { error: { message: 'no active accounts available. Use --login or login first', type: 'server_error' } })
  equal('no active accounts → 503', noAcct && noAcct.error.code, 503)

  const rate = hook('translateBusinessError', { error: { message: 'rate limit exceeded', type: 'rate_limit_error' } })
  equal('rate limit → 429', rate && rate.error.code, 429)

  const broken = hook('translateBusinessError', { error: { message: 'upstream stream broken', type: 'upstream_error' } })
  equal('upstream stream broken → 502', broken && broken.error.code, 502)
}

// ---- statusForError: 非流式同码 ----
{
  equal('statusForError invalid_request → 400', hook('statusForError', { error: { message: 'model is disabled', type: 'invalid_request_error' } }), 400)
  equal('statusForError no accounts → 503', hook('statusForError', { error: { message: 'no active accounts available' } }), 503)
  check('statusForError 正常 chunk → undefined', hook('statusForError', { choices: [] }) === undefined)
}

// ---- streamAbortFrame: 纯思考截断给错误帧，不补 stop ----
{
  const pureThinking = { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false }
  const frame = hook('streamAbortFrame', pureThinking)
  check('纯思考断流给出错误帧', frame !== undefined && isObj(frame.error))
  equal('断流帧 code 502', frame && frame.error.code, 502)
  check('断流帧文案含 no content emitted', frame !== undefined && /no content emitted/.test(frame.error.message))
  check('有正文时不给断流帧', hook('streamAbortFrame', { sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }) === undefined)
  check('有工具调用时不给断流帧', hook('streamAbortFrame', { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: true }) === undefined)
  check('有 finish_reason 时不给断流帧', hook('streamAbortFrame', { sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false }) === undefined)
  check('未发任何东西时不给断流帧', hook('streamAbortFrame', { sawFinishReason: false, sentAnything: false, sawContent: false, sawToolCall: false }) === undefined)
  check('非对象 meta 不给断流帧', hook('streamAbortFrame', null) === undefined)
}

// ---- ensureFinishReason: 纯思考截断拒绝补合成 stop ----
{
  equal('meta 缺省保持向后兼容 true', hook('ensureFinishReason', 'm', undefined), true)
  equal('纯思考截断返回 false（不补 stop）', hook('ensureFinishReason', 'm', { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false }), false)
  equal('已有 finish_reason 返回 true', hook('ensureFinishReason', 'm', { sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false }), true)
  equal('有正文返回 true', hook('ensureFinishReason', 'm', { sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }), true)
  equal('有工具调用返回 true', hook('ensureFinishReason', 'm', { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: true }), true)
}

// ---- thinkingLimitFrame: 思考死循环检测 ----
{
  check('正常短思考不触发', hook('thinkingLimitFrame', { reasoningText: '让我想想 1+1', reasoningChunks: 3 }) === undefined)
  check('缺字段不触发', hook('thinkingLimitFrame', {}) === undefined)
  const gram = 'ABCDEFGHIJKLMNOPQRSTUVWX' // 24 字
  const loopText = gram.repeat(50) // 1200 字 ≥ TAIL_WINDOW=1000，尾窗内同 gram 出现 >8 次
  const loopFrame = hook('thinkingLimitFrame', { reasoningText: loopText, reasoningChunks: 50 })
  check('重复 n-gram 触发死循环帧', loopFrame !== undefined)
  equal('死循环帧 finish_reason=length', loopFrame && loopFrame.choices[0].finish_reason, 'length')
  equal('死循环帧 reason=repetition', loopFrame && loopFrame._thinking_loop.reason, 'repetition')
  const stagFrame = hook('thinkingLimitFrame', { reasoningText: 'once', reasoningChunks: 6001 })
  equal('停滞兜底 reason=stagnation', stagFrame && stagFrame._thinking_loop.reason, 'stagnation')
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
