/**
 * raccoon（sensenova）「答一步就停」续推逻辑的端到端回归测试（2026-11-27）。
 *
 * 场景：sn-sensenova-6-8-flash 在 OPS/PTC 模式（只有 run_code 一个入口、上下文很长）
 * 下常见——正文里写「我读一下它们的内容来做总结。」然后 finish_reason=stop，
 * 却不真正发 tool_calls，客户端看到的就是「只说一句话就瞬间结束对话」。
 * raccoon 规则包检测到这种不完整轮后，proxy 应自动追加「继续执行」消息重发一次，
 * 把续推的响应接着写进同一个 SSE 流。
 *
 * 假上游行为：
 *   - 第 1 次请求：content = 「我看到两个文件：a.ts 和 b.ts。我读一下它们的内容来做总结。」+ finish_reason=stop，无 tool-call。
 *   - 第 2 次请求（续推）：content 一句 + tool_calls(run_code) + finish_reason=tool_calls。
 *
 * 运行：node test/raccoon-incomplete-turn.e2e.test.mjs
 */

import { createServer } from 'node:http'
import { createProxy } from '../lib/proxy.mjs'
import { RuleRegistry } from '../lib/registry.mjs'
import { raccoonRules } from '../lib/rules/raccoon.mjs'

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
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'sn-sensenova-6-8-flash' }] }))
        return
      }
      requestCount += 1
      seenBodies.push(JSON.parse(raw))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const model = 'sn-sensenova-6-8-flash'

      if (requestCount === 1) {
        // 第 1 次：有正文（最后一句是意图宣告）、无工具调用、finish_reason=stop
        response.write('data: ' + JSON.stringify({
          id: 'r1', object: 'chat.completion.chunk', model,
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        }) + '\n\n')
        response.write('data: ' + JSON.stringify({
          id: 'r1', object: 'chat.completion.chunk', model,
          choices: [{ index: 0, delta: { content: '当前目录有两个文件：a.ts 和 b.ts。我读一下它们的内容来做总结。' }, finish_reason: null }],
        }) + '\n\n')
        response.write('data: ' + JSON.stringify({
          id: 'r1', object: 'chat.completion.chunk', model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }) + '\n\n')
        response.end('data: [DONE]\n\n')
      } else {
        // 第 2 次（续推）：带工具调用
        response.write('data: ' + JSON.stringify({
          id: 'r2', object: 'chat.completion.chunk', model,
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        }) + '\n\n')
        response.write('data: ' + JSON.stringify({
          id: 'r2', object: 'chat.completion.chunk', model,
          choices: [{ index: 0, delta: { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'run_code', arguments: '{"code":"console.log(1)","description":"read files"}' } }] }, finish_reason: null }],
        }) + '\n\n')
        response.write('data: ' + JSON.stringify({
          id: 'r2', object: 'chat.completion.chunk', model,
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
  registry.register(raccoonRules)

  const proxy = createProxy({
    port: 0,
    registry,
    routes: [
      {
        id: 'raccoon',
        default: true,
        upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
        apiKey: 'sk-test',
        rules: ['raccoon'],
        models: [{ id: 'raccoon/sn-sensenova-6-8-flash', maxTokens: 4096 }],
      },
    ],
  })
  await proxy.ready

  const chat = await fetch(proxy.origin() + '/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'raccoon/sn-sensenova-6-8-flash',
      messages: [{ role: 'user', content: '帮我看看当前目录里有哪些文件，然后总结一下。' }],
      stream: true,
    }),
  })
  check('续推 E2E: chat 返回 200', chat.status === 200, 'status=' + chat.status)

  const text = await chat.text()
  const frames = text.split('\n\n').filter((f) => f.startsWith('data:')).map((f) => f.slice(5).trim()).filter((f) => f !== '[DONE]').map((f) => JSON.parse(f))

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
  check('续推 E2E: 收到第 1 次的文本', fullContent.includes('我读一下它们的内容来做总结'), 'content=' + JSON.stringify(fullContent))
  check('续推 E2E: 收到第 2 次的工具调用', sawToolCall === true, 'sawToolCall=' + sawToolCall)
  check('续推 E2E: 工具调用名正确', toolCallName === 'run_code', 'toolCallName=' + toolCallName)

  const secondBody = upstream.seenBodies[1]
  check('续推 E2E: 续推请求 messages 包含原始 user 消息',
    secondBody.messages.length === 3 &&
    secondBody.messages[0].role === 'user' &&
    secondBody.messages[0].content === '帮我看看当前目录里有哪些文件，然后总结一下。',
    'messages=' + JSON.stringify(secondBody.messages))
  check('续推 E2E: 续推请求追加 assistant 回复',
    secondBody.messages[1].role === 'assistant' &&
    secondBody.messages[1].content === '当前目录有两个文件：a.ts 和 b.ts。我读一下它们的内容来做总结。',
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