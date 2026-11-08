/**
 * 「纯思考截断、零正文」空流重试的端到端回归测试（2026-11-08 跨平台修复）。
 *
 * 现象：reasoning 模型在思考阶段被读超时 / 网关空闲超时 / 网络抖动掐断时，往往只发过
 * reasoning_content、没正文没工具调用没 finish_reason。框架 pipeStream 命中这种
 * 「纯思考截断」后，应自动重发一次原始请求做全新尝试（空流重试），把重试拿到的帧接进
 * 同一个 SSE 流；重试预算用尽仍空流，才发带诊断的断流帧（_streamAbort）。
 *
 * 场景 A（恢复）：第 1 次请求只发 reasoning 就断流；第 2 次（重试）发完整正文。
 *   客户端应收连续一次响应（先思考、后正文），无 error 帧。
 * 场景 B（有界放弃）：每次都只发 reasoning 断流。客户端应收恰好 maxRetries+1 次请求，
 *   最终收到 error 帧（aborted during thinking）+ [DONE]，且流正常终止（不悬挂）。
 *
 * 运行：node test/stream-abort-retry.e2e.test.mjs
 */

import { createServer } from 'node:http'
import { createProxy } from '../lib/proxy.mjs'
import { RuleRegistry } from '../lib/registry.mjs'
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

const chunk = (id, delta, finish = null) =>
  'data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', model: 'QoDuck', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'

/**
 * 假上游。mode='recover'：第 1 次纯思考断流、之后给完整正文；mode='always-abort'：永远纯思考断流。
 * 记录 requestCount 供断言。
 */
async function startStub(mode) {
  let requestCount = 0
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (c) => { raw += c })
    request.on('end', () => {
      if ((request.url ?? '').endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'QoDuck' }] }))
        return
      }
      requestCount += 1
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const recover = mode === 'recover' && requestCount >= 2
      if (recover) {
        // 重试：发完整正文 + finish_reason=stop
        response.write(chunk('r' + requestCount, { role: 'assistant', content: '' }))
        response.write(chunk('r' + requestCount, { content: '网关状态正常' }))
        response.write(chunk('r' + requestCount, {}, 'stop'))
        response.end('data: [DONE]\n\n')
        return
      }
      // 纯思考断流：只发 reasoning_content，不收尾、不 finish_reason
      response.write(chunk('a' + requestCount, { role: 'assistant', content: '' }))
      response.write(chunk('a' + requestCount, { reasoning_content: '让我想想……' }))
      response.end() // 直接断流，无 finish_reason、无 [DONE]
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, requestCount: () => requestCount, port: server.address().port, close: () => new Promise((r) => server.close(r)) }
}

async function drive(upstream) {
  const registry = new RuleRegistry()
  registry.register(qoderRules)
  const proxy = createProxy({
    port: 0,
    registry,
    routes: [{
      id: 'qoder2api-hub',
      default: true,
      upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
      apiKey: 'sk-test',
      rules: ['qoder2api-hub'],
      models: [{ id: 'QoDuck', maxTokens: 4096 }],
    }],
  })
  await proxy.ready
  const chat = await fetch(proxy.origin() + '/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'QoDuck', messages: [{ role: 'user', content: '检查网关状态' }], stream: true }),
  })
  const text = await chat.text()
  const frames = text.split('\n\n').filter((f) => f.startsWith('data:')).map((f) => f.slice(5).trim()).filter((f) => f !== '' && f !== '[DONE]').map((f) => JSON.parse(f))
  let content = ''
  let reasoning = ''
  let errorFrame = null
  let finishReason = null
  for (const f of frames) {
    if (f.error) { errorFrame = f.error; continue }
    if (f._streamAbort !== undefined) continue
    for (const c of f.choices ?? []) {
      if (typeof c.delta?.content === 'string') content += c.delta.content
      if (typeof c.delta?.reasoning_content === 'string') reasoning += c.delta.reasoning_content
      if (c.finish_reason) finishReason = c.finish_reason
    }
  }
  await proxy.close()
  return { content, reasoning, errorFrame, finishReason }
}

// ------------------------- 场景 A：空流重试后恢复 -------------------------
{
  const upstream = await startStub('recover')
  const r = await drive(upstream)
  check('A: 上游收到 2 次请求（原请求 + 空流重试）', upstream.requestCount() === 2, 'requestCount=' + upstream.requestCount())
  check('A: 收到第 1 次的思考', r.reasoning.includes('让我想想'), 'reasoning=' + JSON.stringify(r.reasoning))
  check('A: 收到重试的正文（恢复成功）', r.content.includes('网关状态正常'), 'content=' + JSON.stringify(r.content))
  check('A: 无 error 帧', r.errorFrame === null, 'errorFrame=' + JSON.stringify(r.errorFrame))
  check('A: 正常 finish_reason=stop', r.finishReason === 'stop', 'finishReason=' + r.finishReason)
  await upstream.close()
}

// ------------------------- 场景 B：始终断流，有界放弃 -------------------------
{
  const upstream = await startStub('always-abort')
  const r = await drive(upstream)
  // 默认 maxStreamAbortRetries=1：原请求 1 次 + 重试 1 次 = 2 次
  check('B: 上游收到 2 次请求（原请求 + 1 次重试，有界）', upstream.requestCount() === 2, 'requestCount=' + upstream.requestCount())
  check('B: 最终收到 thinking-abort error 帧', r.errorFrame !== null && /aborted during thinking/.test(r.errorFrame.message ?? ''), 'errorFrame=' + JSON.stringify(r.errorFrame))
  check('B: 无正文（没把思考当答案）', r.content === '', 'content=' + JSON.stringify(r.content))
  await upstream.close()
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
