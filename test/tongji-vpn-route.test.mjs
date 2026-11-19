// 回归：/api/api-rules/tongji-vpn 处理器内部是否引用了不存在的标识符。
//
// 2026-11-19 事故：处理器里写了 `resolveEnvCredential(route.apiKeyEnv)`，
// 但那个名字只是 createProxy 内部的闭包参数，在这个作用域里根本不存在。
// `node --check` 查不出（语法合法），路由测试也查不出（只数路由条数），
// 只有真调用一次才会 500 `resolveEnvCredential is not defined`。
//
// 所以本测试的做法是：真的把 apply() 跑起来，拿到路由表，然后**调用这个 handler**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

function createFakeWebServer() {
  const table = new Map()
  return {
    table,
    register(spec) {
      const key = spec.kind + ' ' + spec.path
      if (table.has(key)) throw new Error('webserver: duplicate ' + spec.kind + ' route "' + spec.path + '"')
      table.set(key, spec.handler)
      return () => table.delete(key)
    },
  }
}

function makeCtx(webServer, disposers) {
  return {
    logger: undefined,
    get: () => undefined,
    provide: () => {},
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps[0] === 'webServer') {
        disposers.push(cb({ webServer }))
      }
    },
    effect: () => {},
  }
}

/** 收集一次响应：handler 只用到 writeJson/writeHead，够用。 */
function makeResponse() {
  const state = { status: 0, body: undefined }
  return {
    state,
    writeHead(status) {
      state.status = status
    },
    setHeader() {},
    end(chunk) {
      if (typeof chunk === 'string' && chunk.length > 0) {
        try {
          state.body = JSON.parse(chunk)
        } catch {
          state.body = chunk
        }
      }
    },
  }
}

test('/api/api-rules/tongji-vpn 的处理器能真跑起来，不引未定义标识符', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-tongji-vpn-route-'))
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  // 让 provider 块定位有个可写 profile，避免 apply 早期就抛。
  const profileDir = join(tmp, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '- insert:\n    - id: llm-pi-ai\n      config:\n')

  const { apply } = await import('../lib/index.mjs')
  const webServer = createFakeWebServer()
  const disposers = []
  // 关键：config 里必须**真有**一条 tongji 路由，否则处理器里
  // `route?.apiKeyEnv ? ... : undefined` 会短路，那个未定义标识符根本执行不到，
  // 负向对照也就测不出来（这是第一版测试的漏洞，已用负向对照证实）。
  apply(makeCtx(webServer, disposers), {
    port: 0,
    routes: [
      { id: 'codearts', signer: 'huawei', rules: ['codearts'] },
      { id: 'tongji', upstream: 'https://agi.tongji.edu.cn/v1', rules: ['tongji'], apiKeyEnv: 'TONGJI_API_KEY' },
    ],
  })

  const handler = webServer.table.get('exact /api/api-rules/tongji-vpn')
  assert.equal(typeof handler, 'function', 'tongji-vpn 路由必须注册')

  const response = makeResponse()
  await handler({ method: 'GET', url: '/api/api-rules/tongji-vpn', headers: {} }, response)

  // 关键断言：不能是 500 + 「... is not defined」。
  // 允许 200（探测成功）、也允许 200 里带 probe 失败信息（外网环境），
  // 但不允许 ReferenceError 类的编程错误漏成 500。
  if (response.state.status === 500) {
    assert.notEqual(
      response.state.body?.error,
      'probe_failed',
      '处理器抛异常了：' + JSON.stringify(response.state.body),
    )
  }
  assert.equal(response.state.status, 200, '实际响应：' + JSON.stringify(response.state.body))
  assert.equal(typeof response.state.body, 'object')
  // 至少要回传 VPN 状态字段，证明真的走完了状态收集这条路径
  assert.ok('state' in response.state.body, '响应里应有 state 字段：' + JSON.stringify(response.state.body))
  assert.ok('configPath' in response.state.body, '响应里应有 configPath 字段')
  assert.ok('tunnel' in response.state.body, '响应里应有 tunnel 探测结果')

  for (const dispose of disposers) dispose()
})

test('非 GET 请求被 405 拦掉（不做拨号副作用）', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-tongji-vpn-method-'))
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  const profileDir = join(tmp, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '- insert:\n    - id: llm-pi-ai\n      config:\n')

  const { apply } = await import('../lib/index.mjs')
  const webServer = createFakeWebServer()
  const disposers = []
  apply(makeCtx(webServer, disposers), {
    port: 0,
    routes: [
      { id: 'codearts', signer: 'huawei', rules: ['codearts'] },
      { id: 'tongji', upstream: 'https://agi.tongji.edu.cn/v1', rules: ['tongji'], apiKeyEnv: 'TONGJI_API_KEY' },
    ],
  })

  const handler = webServer.table.get('exact /api/api-rules/tongji-vpn')
  const response = makeResponse()
  await handler({ method: 'POST', url: '/api/api-rules/tongji-vpn', headers: {} }, response)
  assert.equal(response.state.status, 405)
  assert.equal(response.state.body?.error, 'method_not_allowed')

  for (const dispose of disposers) dispose()
})
