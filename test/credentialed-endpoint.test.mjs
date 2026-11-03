/**
 * 自带凭据路由（`credentialed: true`）的回归测试。
 *
 * 这是「插件不依赖 officeace2api」的核心保证：
 *  1. 账号存储里有 { baseUrl, authorization } 时，请求打到**凭据里的 baseUrl**，
 *     并且 Authorization **原样透传**（不是 `Bearer apiKey`）；
 *  2. 账号存储为空时，回落到配置里的 upstream/apiKey —— 老部署零回归；
 *  3. `credentialed: true` 且没有 upstream 的路由不再被 normalizeRoute 拒绝。
 *
 * 所有上游都是本地起的小 HTTP 服务，不连真实网关。
 * 运行：node test/credentialed-endpoint.test.mjs
 */

import { createServer } from 'node:http'
import { createProxy, normalizeRoute } from '../lib/proxy.mjs'
import { RuleRegistry } from '../lib/registry.mjs'
import { genericRules } from '../lib/rules/generic.mjs'

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

/** 假上游：记下每个请求的 url 与 Authorization 头。 */
async function startStub() {
  const seen = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      seen.push({ url: request.url, authorization: request.headers.authorization, body: raw })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      if ((request.url ?? '').endsWith('/models')) {
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-model' }] }))
        return
      }
      response.end(
        JSON.stringify({
          id: 'stub',
          object: 'chat.completion',
          model: 'stub-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, seen, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) }
}

function makeRegistry() {
  const registry = new RuleRegistry()
  registry.register(genericRules)
  return registry
}

const CRED = 'Basic QUJDMTIzOlNLYWJjZGVm'
const BEARER = { Authorization: 'Bearer test', 'Content-Type': 'application/json' }

// ------------------------------------------------- credentialed 且给了凭据
{
  const gateway = await startStub()
  const fallback = await startStub()

  const proxy = createProxy({
    port: 0,
    registry: makeRegistry(),
    getCredential: async () => ({
      baseUrl: 'http://127.0.0.1:' + gateway.port + '/v2',
      authorization: CRED,
    }),
    routes: [
      {
        id: 'officeace',
        default: true,
        credentialed: true,
        upstream: 'http://127.0.0.1:' + fallback.port + '/v1',
        apiKey: 'sk-fallback',
        rules: ['generic'],
        models: [{ id: 'stub-model', maxTokens: 4096 }],
      },
    ],
  })
  await proxy.ready

  const models = await fetch(proxy.origin() + '/v1/models', { headers: BEARER })
  equal('配了凭据: /v1/models 返回 200', models.status, 200)
  const modelsBody = await models.json()
  equal('配了凭据: 模型清单来自凭据的网关', modelsBody.data[0].id, 'stub-model')

  const chat = await fetch(proxy.origin() + '/v1/chat/completions', {
    method: 'POST',
    headers: BEARER,
    body: JSON.stringify({ model: 'stub-model', messages: [{ role: 'user', content: 'hi' }], stream: false }),
  })
  equal('配了凭据: chat 返回 200', chat.status, 200)

  const modelHit = gateway.seen.find((entry) => entry.url === '/v2/models')
  check('配了凭据: /models 打到 baseUrl 拼出的路径', modelHit !== undefined, JSON.stringify(gateway.seen.map((e) => e.url)))
  equal('配了凭据: /models 用凭据里的 Authorization（不是 Bearer）', modelHit?.authorization, CRED)

  const chatHit = gateway.seen.find((entry) => entry.url === '/v2/chat/completions')
  check('配了凭据: chat 打到 baseUrl 拼出的路径', chatHit !== undefined, JSON.stringify(gateway.seen.map((e) => e.url)))
  equal('配了凭据: chat 用凭据里的 Authorization（不是 Bearer）', chatHit?.authorization, CRED)

  equal('配了凭据: 完全没碰回落 upstream', fallback.seen.length, 0)

  await proxy.close()
  await gateway.close()
  await fallback.close()
}

// ------------------------------------------------- 没给凭据 → 回落 upstream/apiKey
{
  const fallback = await startStub()

  const proxy = createProxy({
    port: 0,
    registry: makeRegistry(),
    getCredential: async () => undefined,
    routes: [
      {
        id: 'officeace',
        default: true,
        credentialed: true,
        upstream: 'http://127.0.0.1:' + fallback.port + '/v1',
        apiKey: 'sk-fallback',
        rules: ['generic'],
        models: [{ id: 'stub-model', maxTokens: 4096 }],
      },
    ],
  })
  await proxy.ready

  const models = await fetch(proxy.origin() + '/v1/models', { headers: BEARER })
  equal('没给凭据: /v1/models 仍然 200（回落）', models.status, 200)

  const chat = await fetch(proxy.origin() + '/v1/chat/completions', {
    method: 'POST',
    headers: BEARER,
    body: JSON.stringify({ model: 'stub-model', messages: [{ role: 'user', content: 'hi' }], stream: false }),
  })
  equal('没给凭据: chat 仍然 200（回落）', chat.status, 200)

  const hit = fallback.seen.find((entry) => entry.url === '/v1/chat/completions')
  check('没给凭据: 打到配置的 upstream', hit !== undefined, JSON.stringify(fallback.seen.map((e) => e.url)))
  equal('没给凭据: 沿用 Bearer apiKey', hit?.authorization, 'Bearer sk-fallback')

  await proxy.close()
  await fallback.close()
}

// ------------------------------------------------- normalizeRoute 的接受条件
{
  const route = normalizeRoute({ id: 'no-upstream', credentialed: true, rules: ['generic'] })
  equal('credentialed 路由不写 upstream 也能过（凭据运行时决定）', route.credentialed, true)
  equal('credentialed 路由的 upstream 缺省为空串', route.upstream, '')

  let threw = false
  try {
    normalizeRoute({ id: 'plain', rules: ['generic'] })
  } catch {
    threw = true
  }
  check('既无 signer 又无 credentialed 且无 upstream 仍然要报错', threw)
}

console.log('')
console.log(passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)