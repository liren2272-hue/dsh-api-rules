// 健康徽章修复回归：透传路由（passthroughAuth + apiKeyEnv）用 DSH 真密钥探测上游。
//
// 背景：intern-ai 这类透传路由的 route.apiKey 是占位符 sk-passthrough-placeholder，
// 旧 probePassthrough 拿它去打 /models 得 401 → 徽章假红，而实际 chat 与模型发现
// 都用真密钥正常。本测试用真实 HTTP 假上游 + 真实 listHandler 驱动这条链路：
//   - 凭据服务能解析出真密钥 → 上游 200 → health.ok=true
//   - 凭据服务只给出占位符 / 解析失败 → 上游 401 → health.ok=false
// 另加一条静态断言钉住补丁块本身，便于负向对照（删掉补丁块 → 该断言变红）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const INDEX = join(HERE, '..', 'lib', 'index.mjs')

const REAL_KEY = 'sk-real-intern-key'
const PLACEHOLDER = 'sk-passthrough-placeholder'

function startFakeUpstream() {
  return new Promise((resolve) => {
    const seen = []
    const server = createServer((req, res) => {
      seen.push({ url: req.url, authorization: req.headers.authorization || '' })
      if (req.url === '/v1/models' && req.headers.authorization === 'Bearer ' + REAL_KEY) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'm1' }, { id: 'm2' }] }))
      } else {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid API key' } }))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, seen, port: server.address().port })
    })
  })
}

// 用最小假 ctx 驱动真实 apply：credentials 回调塞入假凭据服务，webServer 回调收集 handler。
function applyWithCredentials(route, resolver) {
  const handlers = {}
  const ctx = {
    logger: undefined,
    get: () => undefined,
    provide: () => {},
    effect: () => {},
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps[0] === 'credentials') {
        cb({
          credentials: {
            async resolve(ref) { return resolver(ref) },
            async describe() { return { configured: true } },
            async set() {},
          },
        })
      } else if (Array.isArray(deps) && deps[0] === 'webServer') {
        cb({ webServer: { register: (spec) => { handlers[spec.path] = spec.handler } } })
      }
      // tools/sessionProjections/userQuestions 依赖忽略：不注册工具不影响本测试。
    },
  }
  // apply 是同步的，注入回调在 apply 内同步执行，apply 返回时 handler 已就绪。
  // 动态 import 缓存同一模块实例，但每次 apply 都会重建 probeCache 并覆写 live.credentials。
  return import('../lib/index.mjs').then(({ apply }) => {
    apply(ctx, { port: 0, routes: [route] })
    return handlers
  })
}

async function callAccounts(handlers) {
  const handler = handlers['/api/api-rules/accounts']
  assert.ok(handler, 'accounts handler 应已注册')
  const captured = {}
  await handler(
    { method: 'GET' },
    {
      writeHead: (status) => { captured.status = status },
      end: (body) => { captured.body = JSON.parse(body) },
    },
  )
  assert.equal(captured.status, 200)
  const route = captured.body.routes.find((r) => r.id === 'intern-ai-probe')
  assert.ok(route, 'routes 里应有被测路由')
  return route
}

function passthroughRoute(port) {
  return {
    id: 'intern-ai-probe',
    upstream: 'http://127.0.0.1:' + port + '/v1',
    apiKey: PLACEHOLDER,
    apiKeyEnv: 'INTERN_AI_API_KEY',
    passthroughAuth: true,
    rules: ['generic'],
  }
}

test('透传路由健康探测用 DSH 真密钥（真密钥 → 绿，占位符 → 红）', async (t) => {
  const upstream = await startFakeUpstream()
  t.after(() => new Promise((r) => upstream.server.close(r)))

  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-probe-cred-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmp
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  })

  // 场景 1：凭据服务解析出真密钥 → 上游 200 → health.ok=true。
  const handlersOk = await applyWithCredentials(passthroughRoute(upstream.port), () => REAL_KEY)
  const okRoute = await callAccounts(handlersOk)
  assert.equal(okRoute.health.checked, true)
  assert.equal(okRoute.health.ok, true, '用真密钥探测应为绿')
  assert.equal(okRoute.health.models, 2)
  assert.equal(okRoute.health.error, '')
  assert.ok(
    upstream.seen.some((s) => s.url === '/v1/models' && s.authorization === 'Bearer ' + REAL_KEY),
    '上游必须收到真密钥，而不是占位符',
  )

  // 场景 2：凭据服务只给占位符（模拟 resolve 返回占位/异常兜底）→ 上游 401 → health.ok=false。
  // 用新的 apply（新 probeCache）避免 30s 缓存复用场景 1 的绿结果。
  const handlersBad = await applyWithCredentials(passthroughRoute(upstream.port), () => PLACEHOLDER)
  const badRoute = await callAccounts(handlersBad)
  assert.equal(badRoute.health.checked, true)
  assert.equal(badRoute.health.ok, false, '占位密钥探测应为红')
  assert.equal(badRoute.health.error, 'HTTP 401')
})

test('源码钉住：probePassthrough 的凭据解析块存在（负向对照锚点）', () => {
  const src = readFileSync(INDEX, 'utf8')
  assert.match(
    src,
    /route\.passthroughAuth === true && typeof route\.apiKeyEnv/,
    '应有透传 + apiKeyEnv 守卫',
  )
  assert.match(
    src,
    /live\.credentials\?\.resolve\?\.\(route\.apiKeyEnv\)/,
    '应通过 live.credentials.resolve 取真密钥',
  )
})
