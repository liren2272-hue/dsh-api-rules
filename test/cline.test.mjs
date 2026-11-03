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

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
