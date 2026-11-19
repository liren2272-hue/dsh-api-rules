/**
 * tongji 路由端到端回归：并发闸门 + 规则包在真实 HTTP 链路上是否成立。
 *
 * 这个测试存在的理由：`test/tongji.test.mjs` 只证明规则包的纯函数对，`test/gate.test.mjs`
 * 只证明闸门对象的计数对。**两者都证明不了「接进 proxy 之后真的只发 3 个并发」**——
 * 而这一条正是用户提的两条硬规则之一。所以这里起一个假上游，数它实际收到多少个
 * 同时在飞的请求。
 *
 * 覆盖：
 *   A. concurreny=3 + holdMs=0：4 个并发打进来，上游同时在飞的不超过 3 个，4 个都成功
 *   B. 请求结束后槽位归还（holdMs=0 语义）：第一波 3 个完成后，第 4 个不需要等 60s
 *   C. reasoning 镜像走完整链路：上游只发 `reasoning`，客户端读到 `reasoning_content`
 *   D. 403「当前网络环境不支持」被翻译成 503 + network_blocked，README 里写的诊断口径
 *   E. 上游 429 并发文案 → 客户端拿到 429 + rate_limit_error
 *
 * 运行：node test/tongji-e2e.test.mjs
 */

import { createServer } from 'node:http'
import { createProxy } from '../lib/proxy.mjs'
import { RuleRegistry } from '../lib/registry.mjs'
import { tongjiRules } from '../lib/rules/tongji.mjs'

let passes = 0
let failures = 0

function check(name, condition, detail) {
  if (condition) {
    passes += 1
    console.log('PASS  ' + name)
    return
  }
  failures += 1
  console.log('FAIL  ' + name + (detail === undefined ? '' : '  → ' + detail))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 假上游。
 *
 * mode='ok'      ：延迟 delayMs 后正常返回（用来数并发）
 * mode='reasoning'：流式只发 `reasoning` 字段（模拟 DeepSeek 系实测行为）
 * mode='reasoning-json'：**非流式**响应把思考放在 message.reasoning（DeepSeek 系真实形状）
 * mode='netblock'：返回 403「当前网络环境不支持」
 * mode='busy'    ：返回 429「并发请求数已达套餐上限（3 个）」
 */
async function startStub(mode, { delayMs = 150 } = {}) {
  const state = { inFlight: 0, maxInFlight: 0, requests: 0, bodies: [] }
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (c) => { raw += c })
    request.on('end', async () => {
      const url = request.url ?? ''
      if (url.endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'DeepSeek-V4.1-Flash' }] }))
        return
      }

      state.requests += 1
      if (raw !== '') state.bodies.push(JSON.parse(raw))
      state.inFlight += 1
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      const done = () => { state.inFlight -= 1 }

      if (mode === 'netblock') {
        await sleep(5)
        done()
        response.writeHead(403, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { code: 403, message: '当前网络环境不支持' } }))
        return
      }

      if (mode === 'busy') {
        await sleep(5)
        done()
        response.writeHead(429, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          error: { code: 429, message: '并发请求数已达套餐上限（3 个），请等待正在进行的请求完成后重试' },
        }))
        return
      }

      await sleep(delayMs)

      if (mode === 'reasoning-json') {
        done()
        response.writeHead(200, { 'Content-Type': 'application/json' })
        // 真实上游形状：思考在 message.reasoning，没有 reasoning_content。
        response.end(JSON.stringify({
          id: 'x', object: 'chat.completion', model: 'DeepSeek-V4.1-Flash',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '答案在这里', reasoning: '先想一想' },
            finish_reason: 'stop',
          }],
        }))
        return
      }

      if (mode === 'reasoning') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const frame = (delta, finish = null) =>
          'data: ' + JSON.stringify({
            id: 'x', object: 'chat.completion.chunk', model: 'DeepSeek-V4.1-Flash',
            choices: [{ index: 0, delta, finish_reason: finish }],
          }) + '\n\n'
        response.write(frame({ role: 'assistant', content: '' }))
        // 关键：上游只发 `reasoning`（tongji 的 7 个模型的真实行为），不发 reasoning_content。
        response.write(frame({ reasoning: '先想一想' }))
        response.write(frame({ content: '答案在这里' }))
        response.write(frame({}, 'stop'))
        done()
        response.end('data: [DONE]\n\n')
        return
      }

      done()
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        id: 'x', object: 'chat.completion', model: 'DeepSeek-V4.1-Flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    state,
    port: server.address().port,
    close: () => new Promise((r) => server.close(r)),
  }
}

/** 起一个只含 tongji 路由的代理。 */
async function startProxy(upstreamPort, { concurrency = 3, sessionHoldMs = 0 } = {}) {
  const registry = new RuleRegistry()
  registry.register(tongjiRules)
  const proxy = createProxy({
    port: 0,
    registry,
    routes: [{
      id: 'tongji',
      default: true,
      upstream: 'http://127.0.0.1:' + upstreamPort + '/v1',
      apiKey: 'sk-test',
      rules: ['tongji'],
      concurrency,
      sessionHoldMs,
      models: [{ id: 'DeepSeek-V4.1-Flash', maxTokens: 8192 }],
    }],
  })
  await proxy.ready
  return proxy
}

function chatBody(extra = {}) {
  return JSON.stringify({
    model: 'DeepSeek-V4.1-Flash',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    ...extra,
  })
}

async function chat(proxy, extra) {
  return await fetch(proxy.origin() + '/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: chatBody(extra),
  })
}

// ------------------------------------------------------- A/B: 并发上限与归还
{
  const upstream = await startStub('ok', { delayMs: 200 })
  const proxy = await startProxy(upstream.port, { concurrency: 3, sessionHoldMs: 0 })

  const startedAt = Date.now()
  // 4 个请求一起打进去：闸门只放 3 个，第 4 个必须排队。
  const responses = await Promise.all([chat(proxy, {}), chat(proxy, {}), chat(proxy, {}), chat(proxy, {})])
  const elapsed = Date.now() - startedAt

  check('A: 4 个请求全部 200', responses.every((r) => r.status === 200),
    JSON.stringify(responses.map((r) => r.status)))
  check('A: 上游同时在飞的不超过 3 个', upstream.state.maxInFlight <= 3,
    'maxInFlight=' + upstream.state.maxInFlight)
  check('A: 上游确实收到了 4 次请求', upstream.state.requests === 4,
    'requests=' + upstream.state.requests)
  // 每波 200ms：3 个并发一波 + 1 个补位一波，约 400ms。若闸门是 60s TTL，这里会到 60s。
  check('B: 第 4 个请求靠槽位归还立刻补位（不是 60s TTL）', elapsed < 5_000,
    'elapsed=' + elapsed + 'ms')
  check('B: 4 个请求确实排成了两波', elapsed >= 350,
    'elapsed=' + elapsed + 'ms（太快说明没排队）')

  await proxy.close()
  await upstream.close()
}

// ------------------------------------------- C: reasoning 镜像走完整链路
{
  const upstream = await startStub('reasoning', { delayMs: 10 })
  const proxy = await startProxy(upstream.port)

  const response = await fetch(proxy.origin() + '/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: chatBody({ stream: true }),
  })
  const text = await response.text()
  const frames = text.split('\n\n')
    .filter((f) => f.startsWith('data:'))
    .map((f) => f.slice(5).trim())
    .filter((f) => f !== '' && f !== '[DONE]')
    .map((f) => JSON.parse(f))

  let reasoning = ''
  let content = ''
  for (const frame of frames) {
    for (const choice of frame.choices ?? []) {
      if (typeof choice.delta?.reasoning_content === 'string') reasoning += choice.delta.reasoning_content
      if (typeof choice.delta?.content === 'string') content += choice.delta.content
    }
  }
  check('C: 上游只发 reasoning，客户端读到 reasoning_content',
    reasoning.includes('先想一想'), 'reasoning_content=' + JSON.stringify(reasoning))
  check('C: 正文照常透出', content.includes('答案在这里'), 'content=' + JSON.stringify(content))

  await proxy.close()
  await upstream.close()
}

// ------------------------------------------------ D: 403 网络不通 → 503
{
  const upstream = await startStub('netblock', { delayMs: 5 })
  const proxy = await startProxy(upstream.port)

  const response = await chat(proxy, {})
  const body = await response.json()
  check('D: 网络不通映射成 503', response.status === 503, 'status=' + response.status)
  check('D: 错误码是 network_blocked', body?.error?.code === 'network_blocked', JSON.stringify(body))
  check('D: 提示里指向 MotionPro 或 VPN',
    /MotionPro|VPN|内网/.test(body?.error?.message ?? ''), body?.error?.message)

  await proxy.close()
  await upstream.close()
}

// ------------------------------- F: 非流式响应也要过规则包（collectJson 镜像）
{
  const upstream = await startStub('reasoning-json', { delayMs: 5 })
  const registry = new RuleRegistry()
  registry.register(tongjiRules)
  const proxy = createProxy({
    port: 0,
    registry,
    routes: [{
      id: 'tongji',
      default: true,
      upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
      apiKey: 'sk-test',
      rules: ['tongji'],
      models: [{ id: 'DeepSeek-V4.1-Flash', maxTokens: 8192 }],
    }],
  })
  await proxy.ready

  const response = await chat(proxy, {})
  const body = await response.json()
  const message = body?.choices?.[0]?.message

  check('F: 非流式 200', response.status === 200, 'status=' + response.status)
  // 这条是回归：collectJson 此前从不调用 normalizeDelta，非流式下 DSH 完全看不到思考。
  check('F: 非流式 message.reasoning 被镜像成 reasoning_content',
    typeof message?.reasoning_content === 'string' && message.reasoning_content === '先想一想',
    JSON.stringify(message))
  check('F: 镜像不动原始 reasoning 字段', message?.reasoning === '先想一想', JSON.stringify(message))
  check('F: 正文未被破坏', message?.content === '答案在这里', JSON.stringify(message))

  await proxy.close()
  await upstream.close()
}

// ------------------------------------------ E: 429 并发文案 → 429 rate_limit
{
  const upstream = await startStub('busy', { delayMs: 5 })
  // 这个用例只想验错误映射，所以把闸门关掉（concurrency 不设），让请求直达上游。
  const registry = new RuleRegistry()
  registry.register(tongjiRules)
  const proxy = createProxy({
    port: 0,
    registry,
    routes: [{
      id: 'tongji',
      default: true,
      upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
      apiKey: 'sk-test',
      rules: ['tongji'],
      models: [{ id: 'DeepSeek-V4.1-Flash', maxTokens: 8192 }],
    }],
  })
  await proxy.ready

  const response = await chat(proxy, {})
  const body = await response.json()
  check('E: 上游 429 保持 429', response.status === 429, 'status=' + response.status)
  check('E: 错误类型是 rate_limit_error',
    body?.error?.type === 'rate_limit_error', JSON.stringify(body))
  check('E: 并发错误被识别（文案保留）',
    /并发请求数已达/.test(body?.error?.message ?? ''), body?.error?.message)

  await proxy.close()
  await upstream.close()
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
