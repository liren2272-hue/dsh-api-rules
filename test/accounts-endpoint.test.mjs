// 验证 host 侧新增的 GET /api/api-rules/accounts 端点：
//  - 返回 routeConfigs 驱动的分区列表（横向扩展：新增 route 即自动出现）
//  - 不回显明文，只给 akHint/skHint 掩码 + configured + updatedAt
//  - codearts 的 label 显式给 'Codearts'
//  - 只有带 signer 的路由 needsCredential=true（纯透传路由不需要 AK/SK）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('accounts endpoint lists routes with masked hints', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-accounts-'))
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  // 预置一个已保存的 codearts 账号，验证掩码 + configured。
  mkdirSync(join(tmp, '.api-rules'), { recursive: true })
  writeFileSync(join(tmp, '.api-rules', 'accounts.json'), JSON.stringify({
    codearts: { ak: 'AK123456', sk: 'SKabcdef', updatedAt: 1761555000000 },
  }), 'utf8')

  const { apply } = await import('../lib/index.mjs')

  const handlers = {}
  const ctx = {
    logger: undefined,
    get: () => undefined,
    provide: () => {},
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps[0] === 'webServer') {
        cb({ webServer: { register: (spec) => { handlers[spec.path] = spec.handler } } })
      }
    },
    effect: () => {}, // 不真正起 proxy
  }
  apply(ctx, {
    port: 8788,
    routes: [
      { id: 'codearts', signer: 'huawei', rules: ['codearts'] },
      { id: 'kimi', upstream: 'http://127.0.0.1:9999', rules: ['generic'] },
    ],
  })

  const handler = handlers['/api/api-rules/accounts']
  assert.ok(handler, 'accounts handler 应已注册')

  let captured = null
  const response = {
    writeHead: (status, headers) => { captured = { status, headers } },
    end: (body) => { captured.body = JSON.parse(body) },
  }
  await handler({ method: 'GET' }, response)
  assert.equal(captured.status, 200)
  const routes = captured.body.routes
  assert.equal(routes.length, 2)
  const codearts = routes.find((r) => r.id === 'codearts')
  assert.equal(codearts.label, 'Codearts')
  assert.equal(codearts.configured, true)
  assert.equal(codearts.akHint, '****3456') // AK123456 → 末4位掩码
  assert.equal(codearts.skHint, '****cdef')
  assert.equal(codearts.updatedAt, 1761555000000)
  assert.equal(codearts.needsCredential, true) // 有 signer 才需要 AK/SK
  const kimi = routes.find((r) => r.id === 'kimi')
  assert.equal(kimi.needsCredential, false) // 无 signer
  assert.equal(kimi.configured, false)
})

// 自带凭据路由（generic gateway）：卡片存的是「网关地址 + Authorization」，
// 插件拿它直连上游，不需要本机任何上游进程。
// 注意：officeace 现在不是这类路由了（它是跳转页形态，账号在 officeace2api 里），
// 所以这里用一个专门的 gateway 路由来覆盖 credentialed 能力，避免和 UI 语义耦合。
test('credentialed route stores endpoint credential, masks it, and keeps it on partial save', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-endpoint-'))
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const { apply } = await import('../lib/index.mjs')

  const handlers = {}
  const ctx = {
    logger: undefined,
    get: () => undefined,
    provide: () => {},
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps[0] === 'webServer') {
        cb({ webServer: { register: (spec) => { handlers[spec.path] = spec.handler } } })
      }
    },
    effect: () => {},
  }
  apply(ctx, {
    port: 8788,
    routes: [
      { id: 'codearts', signer: 'huawei', rules: ['codearts'] },
      // 自带凭据路由：故意保留 upstream，没填凭据时要能回落到它。
      { id: 'gateway', credentialed: true, upstream: 'http://127.0.0.1:7864/v1', apiKey: 'sk-gateway', rules: ['generic'], adminUrl: 'http://127.0.0.1:7864/admin' },
      // 跳转页路由（officeace 的真实形态）：不 credentialed、不收集密钥，只透出 adminUrl。
      { id: 'officeace', upstream: 'http://127.0.0.1:7864/v1', apiKey: 'sk-officeace', rules: ['generic'], adminUrl: 'http://127.0.0.1:7864/admin?token=officeace-local-admin' },
      { id: 'cline', upstream: 'http://127.0.0.1:3457/v1', apiKey: 'sk-cline', rules: ['cline'], adminUrl: 'http://127.0.0.1:3457/admin', launch: { command: 'cline-proxy.exe', args: ['-port', '3457'] } },
    ],
  })

  const listHandler = handlers['/api/api-rules/accounts']
  const accountHandler = handlers['/api/api-rules/account']

  async function call(handler, request) {
    const captured = {}
    await handler(request, {
      writeHead: (status) => { captured.status = status },
      end: (body) => { captured.body = body === undefined ? undefined : JSON.parse(body) },
    })
    return captured
  }

  const put = (obj) => ({
    method: 'PUT',
    url: '/api/api-rules/account?route=gateway',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(obj), 'utf8')
    },
  })
  const get = (path) => ({ method: 'GET', url: path })
  const del = (path) => ({ method: 'DELETE', url: path })

  const SECRET = 'Basic QUJDMTIzOlNLYWJjZGVm'

  // 地址必须像 URL
  assert.equal((await call(accountHandler, put({ baseUrl: 'ftp://gw', authorization: SECRET }))).status, 400)
  // 首次必须有 Authorization（之后可以留空表示不更改）
  assert.equal((await call(accountHandler, put({ baseUrl: 'https://gw.example/v2' }))).status, 400)

  assert.equal((await call(accountHandler, put({ baseUrl: 'https://gw.example/v2', authorization: SECRET }))).status, 200)

  let routes = (await call(listHandler, get('/api/api-rules/accounts'))).body.routes
  let gateway = routes.find((r) => r.id === 'gateway')
  assert.equal(gateway.needsCredential, true)
  assert.equal(gateway.credentialKind, 'endpoint')
  assert.equal(gateway.configured, true)
  assert.equal(gateway.baseUrl, 'https://gw.example/v2') // 地址不是秘密，明文回填
  assert.ok(gateway.authorizationHint.endsWith('ZGVm'))
  assert.ok(!gateway.authorizationHint.includes('Basic'))
  assert.equal(routes.find((r) => r.id === 'codearts').credentialKind, 'aksk')

  // officeace 已回退成「跳转页」形态：不收集密钥，adminUrl 原样透出（含 ?token=）。
  let officeace = routes.find((r) => r.id === 'officeace')
  assert.equal(officeace.needsCredential, false)
  assert.equal(officeace.credentialKind, 'managed')
  assert.equal(officeace.autoLaunched, false) // 用户自己起的进程，不是插件拉起
  assert.equal(officeace.adminUrl, 'http://127.0.0.1:7864/admin?token=officeace-local-admin')

  // cline 同为 managed 但由插件自动拉起：autoLaunched 必须能把它和 officeace 区分开。
  const cline = routes.find((r) => r.id === 'cline')
  assert.equal(cline.credentialKind, 'managed')
  assert.equal(cline.autoLaunched, true)
  assert.equal(cline.adminUrl, 'http://127.0.0.1:3457/admin')

  // 只改地址、Authorization 留空：旧密文必须保留（合并语义）
  assert.equal((await call(accountHandler, put({ baseUrl: 'https://gw2.example/v2' }))).status, 200)
  routes = (await call(listHandler, get('/api/api-rules/accounts'))).body.routes
  gateway = routes.find((r) => r.id === 'gateway')
  assert.equal(gateway.baseUrl, 'https://gw2.example/v2')
  assert.ok(gateway.authorizationHint.endsWith('ZGVm'))
  // 整个响应里不能出现 Authorization 明文
  assert.ok(!JSON.stringify(routes).includes('QUJDMTIzOlNLYWJjZGVm'))

  // 清除后端点凭据消失（configured 可能仍为 true：那是回落 upstream 探测的结果）
  assert.equal((await call(accountHandler, del('/api/api-rules/account?route=gateway'))).status, 200)
  routes = (await call(listHandler, get('/api/api-rules/accounts'))).body.routes
  gateway = routes.find((r) => r.id === 'gateway')
  assert.equal(gateway.baseUrl, '')
  assert.equal(gateway.authorizationHint, '')
  assert.equal((await call(listHandler, get('/api/api-rules/accounts'))).body.routes.find((r) => r.id === 'officeace').adminUrl,
    'http://127.0.0.1:7864/admin?token=officeace-local-admin')
})
