/**
 * 透传路由（`passthroughAuth`）的模型发现回归测试。
 *
 * 这条链路曾经整段坏掉，症状很隐蔽：面板「加回上游」之后，provider 块永远是空的、
 * 模型选择器里一个模型都没有，但接口回 200、没有任何报错。
 *
 * 根因有两层，缺一层就复发：
 *  1. `normalizeRoute` 没把 `apiKeyEnv` 带下去 —— proxy 侧根本不知道凭据名叫什么；
 *  2. `listModels` 拿 `route.apiKey`（透传路由只是占位值 `sk-passthrough-placeholder`）
 *     去打上游 `/v1/models`，上游 401 → 回落到 `route.models` 并打上
 *     `_apiRulesFallback: true` → `planSync` 对 fallback 是**整条跳过** → 同步永远不写盘。
 *
 * 所以断言必须打到「上游确实收到了真密钥」与「响应里没有 fallback 标记」这两点上，
 * 只看 HTTP 200 是看不出问题的（回落也是 200）。
 *
 * 所有上游都是本地起的小 HTTP 服务，不连真实网关。
 * 运行：node test/passthrough-discovery.test.mjs
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

const PLACEHOLDER = 'sk-passthrough-placeholder'
const REAL_KEY = 'sk-real-intern-key'

/** 假上游：只有拿到真密钥才回模型清单，占位密钥一律 401（复刻 intern-ai 的真实行为）。 */
async function startUpstream() {
  const seen = []
  const server = createServer((request, response) => {
    const authorization = request.headers.authorization ?? ''
    seen.push({ url: request.url, authorization })
    if ((request.url ?? '').endsWith('/models')) {
      if (authorization !== 'Bearer ' + REAL_KEY) {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'invalid API key', code: 'invalid_api_key' } }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'deepseek-v4.1-flash-1017', input_modalities: [], output_modalities: [] },
            { id: 'intern-s2' },
          ],
        }),
      )
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    seen,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function makeRegistry() {
  const registry = new RuleRegistry()
  registry.register(genericRules)
  return registry
}

const BEARER = { Authorization: 'Bearer ' + PLACEHOLDER, 'Content-Type': 'application/json' }

// ------------------------------------------------- normalizeRoute 必须带下 apiKeyEnv
{
  const route = normalizeRoute({
    id: 'intern-ai',
    upstream: 'http://127.0.0.1:1/v1',
    apiKey: PLACEHOLDER,
    passthroughAuth: true,
    apiKeyEnv: 'INTERN_AI_API_KEY',
    rules: ['generic'],
    models: [],
  })
  equal('normalizeRoute 保留 apiKeyEnv', route.apiKeyEnv, 'INTERN_AI_API_KEY')
  equal('normalizeRoute 保留 passthroughAuth', route.passthroughAuth, true)

  const plain = normalizeRoute({ id: 'plain', upstream: 'http://127.0.0.1:1/v1', apiKey: 'sk-x', rules: ['generic'] })
  equal('没有 apiKeyEnv 时不会凭空造一个', plain.apiKeyEnv, undefined)
}

// ------------------------------------------------- 透传路由用真密钥发现模型
{
  const upstream = await startUpstream()
  const proxy = createProxy({
    port: 0,
    registry: makeRegistry(),
    resolveEnvCredential: async (ref) => (ref === 'INTERN_AI_API_KEY' ? { value: REAL_KEY } : undefined),
    routes: [
      {
        id: 'intern-ai',
        default: true,
        passthroughAuth: true,
        apiKeyEnv: 'INTERN_AI_API_KEY',
        upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
        apiKey: PLACEHOLDER,
        rules: ['generic'],
        models: [{ id: 'stale-declared-model', maxTokens: 8192 }],
      },
    ],
  })
  await proxy.ready

  const res = await fetch(proxy.origin() + '/v1/models', { headers: BEARER })
  equal('/v1/models 回 200', res.status, 200)
  const body = await res.json()

  equal('发现用的是上游真实清单，不是回落', body._apiRulesFallback, undefined)
  check(
    '清单里有上游的模型',
    Array.isArray(body.data) && body.data.some((m) => m.id === 'deepseek-v4.1-flash-1017'),
    JSON.stringify(body.data?.map((m) => m.id)),
  )
  check(
    '回落清单里的旧模型没被端出来',
    !(body.data ?? []).some((m) => m.id === 'stale-declared-model'),
    JSON.stringify(body.data?.map((m) => m.id)),
  )

  const hit = upstream.seen.find((entry) => (entry.url ?? '').endsWith('/models'))
  equal('上游收到的是 DSH 凭据里的真密钥', hit?.authorization, 'Bearer ' + REAL_KEY)

  await proxy.close()
  await upstream.close()
}

// ------------------------------------------------- 凭据拿不到 → 回落（保持老行为）
{
  const upstream = await startUpstream()
  const proxy = createProxy({
    port: 0,
    registry: makeRegistry(),
    resolveEnvCredential: async () => undefined,
    routes: [
      {
        id: 'intern-ai',
        default: true,
        passthroughAuth: true,
        apiKeyEnv: 'INTERN_AI_API_KEY',
        upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
        apiKey: PLACEHOLDER,
        rules: ['generic'],
        models: [{ id: 'declared-only', maxTokens: 8192 }],
      },
    ],
  })
  await proxy.ready

  const res = await fetch(proxy.origin() + '/v1/models', { headers: BEARER })
  equal('凭据缺失时 /v1/models 仍然 200', res.status, 200)
  const body = await res.json()
  equal('凭据缺失时明确标出这是回落', body._apiRulesFallback, true)
  equal('回落内容就是 route.models', body.data?.[0]?.id, 'declared-only')

  await proxy.close()
  await upstream.close()
}

// ------------------------------------------------- 非透传路由不受影响
{
  const upstream = await startUpstream()
  const proxy = createProxy({
    port: 0,
    registry: makeRegistry(),
    resolveEnvCredential: async () => ({ value: REAL_KEY }),
    routes: [
      {
        id: 'plain',
        default: true,
        upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
        apiKey: 'sk-plain-key',
        rules: ['generic'],
        models: [],
      },
    ],
  })
  await proxy.ready

  await fetch(proxy.origin() + '/v1/models', { headers: BEARER })
  const hit = upstream.seen.find((entry) => (entry.url ?? '').endsWith('/models'))
  equal('普通路由仍用自己的 apiKey（不被凭据名劫持）', hit?.authorization, 'Bearer sk-plain-key')

  await proxy.close()
  await upstream.close()
}

console.log('\n' + (failures === 0 ? 'ALL_PASS' : 'FAILURES') + ': ' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
