/**
 * 「答一步就停」续推逻辑的端到端回归测试（2026-11-08 三段修复）。
 *
 * 场景：QoDuck (lmodel) 在长上下文下常见——模型说「让我检查...」但没真正发
 * 工具调用就 stopReason=stop 结束了。规则层检测到这种不完整轮后，proxy 应
 * 自动追加「继续」消息重发一次，把续推的响应接着写进同一个 SSE 流。
 *
 * 假上游行为：
 *   - 第 1 次请求：返回 SSE 流，content = 「让我检查网关状态」+ finish_reason=stop，无 tool-call。
 *   - 第 2 次请求（续推）：返回 SSE 流，带 tool-call。
 * 客户端应收到两次响应拼接成的连续流（先文本、后工具调用）。
 *
 * 运行：node test/qoder-incomplete-turn.e2e.test.mjs
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

/** 假上游：第 1 次返回不完整轮，第 2 次返回带 tool-call 的完整轮。 */
async function startStub() {
  let requestCount = 0
  const seenBodies = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      if ((request.url ?? '').endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'QoDuck' }] }))
        return
      }
      requestCount += 1
      seenBodies.push(JSON.parse(raw))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })

      if (requestCount === 1) {
        // 第 1 次：有正文（含意图模式）、无工具调用、finish_reason=stop
        response.write('data: ' + JSON.stringify({
          id: 'r1', object: 'chat.completion.chunk', model: 'QoDuck',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        }) + '\n\n')
        response.write('data: ' + JSON.stringify({
          id: 'r1', object: 'chat.completion.chunk', model: 'QoDuck',
          choices: [{ index: 0, delta: { content: '让我检查一下网关状态' }, finish_reason: null }],
        }) + '\n\n')
        response.write('data: ' + JSON.stringify({
          id: 'r1', object: 'chat.completion.chunk', model: 'QoDuck',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }) + '\n\n')
        response.end('data: [DONE]\n\n')
      } else {
        // 第 2 次（续推）：带工具调用
        response.write('data: ' + JSON.stringify({
          id: 'r2', object: 'chat.completion.chunk', model: 'QoDuck',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        }) + '\n\n')
        response.write('data: ' + JSON.stringify({
          id: 'r2', object: 'chat.completion.chunk', model: 'QoDuck',
          choices: [{ index: 0, delta: { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ops_bash', arguments: '{"command":"echo ok"}' } }] }, finish_reason: null }],
        }) + '\n\n')
        response.write('data: ' + JSON.stringify({
          id: 'r2', object: 'chat.completion.chunk', model: 'QoDuck',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }) + '\n\n')
        response.end('data: [DONE]\n\n')
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, seenBodies, requestCount: () => requestCount, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) }
}

// ------------------------------------------------- 续推 E2E
{
  const upstream = await startStub()

  const registry = new RuleRegistry()
  registry.register(qoderRules)

  const proxy = createProxy({
    port: 0,
    registry,
    routes: [
      {
        id: 'qoder2api-hub',
        default: true,
        upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
        apiKey: 'sk-test',
        rules: ['qoder2api-hub'],
        models: [{ id: 'QoDuck', maxTokens: 4096 }],
      },
    ],
  })
  await proxy.ready

  const chat = await fetch(proxy.origin() + '/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'QoDuck',
      messages: [{ role: 'user', content: '检查网关状态' }],
      stream: true,
    }),
  })
  check('续推 E2E: chat 返回 200', chat.status === 200, 'status=' + chat.status)

  // 读取完整 SSE 流
  const text = await chat.text()
  const frames = text.split('\n\n').filter((f) => f.startsWith('data:')).map((f) => f.slice(5).trim()).filter((f) => f !== '[DONE]').map((f) => JSON.parse(f))

  // 收集 content 和 tool_calls
  let fullContent = ''
  let sawToolCall = false
  let toolCallName = ''
  for (const frame of frames) {
    for (const choice of frame.choices ?? []) {
      if (typeof choice.delta?.content === 'string') fullContent += choice.delta.content
      if (Array.isArray(choice.delta?.tool_calls)) {
        sawToolCall = true
        toolCallName = choice.delta.tool_calls[0]?.function?.name ?? ''
      }
    }
  }

  check('续推 E2E: 上游收到 2 次请求（原请求 + 续推）', upstream.requestCount() === 2, 'requestCount=' + upstream.requestCount())
  check('续推 E2E: 收到第 1 次的文本', fullContent.includes('让我检查一下网关状态'), 'content=' + JSON.stringify(fullContent))
  check('续推 E2E: 收到第 2 次的工具调用', sawToolCall === true, 'sawToolCall=' + sawToolCall)
  check('续推 E2E: 工具调用名正确', toolCallName === 'ops_bash', 'toolCallName=' + toolCallName)

  // 验证续推请求的 messages 结构
  const secondBody = upstream.seenBodies[1]
  check('续推 E2E: 续推请求 messages 包含原始 user 消息',
    secondBody.messages.length === 3 &&
    secondBody.messages[0].role === 'user' &&
    secondBody.messages[0].content === '检查网关状态',
    'messages=' + JSON.stringify(secondBody.messages))
  check('续推 E2E: 续推请求追加 assistant 回复',
    secondBody.messages[1].role === 'assistant' &&
    secondBody.messages[1].content === '让我检查一下网关状态',
    'assistant=' + JSON.stringify(secondBody.messages[1]))
  check('续推 E2E: 续推请求追加 user「继续」指令',
    secondBody.messages[2].role === 'user' &&
    secondBody.messages[2].content === '请继续执行你刚才说要做的操作。',
    'user=' + JSON.stringify(secondBody.messages[2]))

  await proxy.close()
  await upstream.close()
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
