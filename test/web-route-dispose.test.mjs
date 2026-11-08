// 验证 host 侧 HTTP 路由在插件重载时能被正确摘除。
//
// 2026-11-09 事故：`ctx.inject(['webServer'], cb)` 里的 cb 注册了三条路由，但**没有
// 把 disposer 交还给 Cordis**。HMR 重载本条目时旧 handler 仍留在 webserver 路由表上，
// 新 apply 一注册就撞 `webserver: duplicate exact route "..."` → 整个 inject 回调失败
// → 这条路由永远由旧闭包回答（卡片读到旧 routeConfigs、proxy 指向已失败的新实例），
// 而 `ctx.effect` 里新起的监听却在 8788 上正常服务。
//
// 本测试把「重载」建模成：同一个 webServer 路由表上跑两遍 apply，第二遍必须不撞车，
// 且第一遍的 handler 必须已被摘掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 复刻宿主 dsh-host-webserver 的语义：重复 (kind, path) 抛错，register 返回摘除函数。 */
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
        const dispose = cb({ webServer })
        assert.equal(typeof dispose, 'function', 'inject 回调必须交还 disposer，否则重载会撞重复路由')
        disposers.push(dispose)
      }
    },
    effect: () => {},
  }
}

test('inject 回调交还 disposer，重载不撞重复路由', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-dispose-'))
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const { apply } = await import('../lib/index.mjs')
  const webServer = createFakeWebServer()
  const disposers = []
  const config = { port: 8788, routes: [{ id: 'codearts', signer: 'huawei', rules: ['codearts'] }] }

  apply(makeCtx(webServer, disposers), config)
  assert.equal(webServer.table.size, 3, '三条路由应全部注册')
  assert.ok(webServer.table.has('exact /api/api-rules/accounts'))

  // 模拟 HMR：先跑旧条目的清理函数，再 apply 一次。
  disposers[0]()
  assert.equal(webServer.table.size, 0, 'disposer 必须把三条路由全部摘掉')

  assert.doesNotThrow(() => apply(makeCtx(webServer, disposers), config), '重载不应撞 duplicate route')
  assert.equal(webServer.table.size, 3, '重载后仍是三条路由')
})

test('重复注册同一路径确实会抛错（负向对照，证明上面的断言不是空转）', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-dispose-neg-'))
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const { apply } = await import('../lib/index.mjs')
  const webServer = createFakeWebServer()
  const config = { port: 8788, routes: [{ id: 'codearts', signer: 'huawei', rules: ['codearts'] }] }

  // 第二遍用「不交还 disposer」的 ctx：旧路由不会被摘，必须撞车。
  const ctxNoDispose = {
    logger: undefined,
    get: () => undefined,
    provide: () => {},
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps[0] === 'webServer') cb({ webServer })
    },
    effect: () => {},
  }

  apply(ctxNoDispose, config)
  assert.throws(
    () => apply(ctxNoDispose, config),
    /duplicate exact route "\/api\/api-rules\/accounts"/,
    '不交还 disposer 时第二遍 apply 必须撞重复路由——这正是事故现场的机制',
  )
})

test('旧闭包 handler 也不能报旧数据：accounts 读的是实时 live 状态', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-live-'))
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const { apply } = await import('../lib/index.mjs')
  const webServer = createFakeWebServer()
  const disposers = []

  // 第一轮：只有 codearts 一条路由，effect 不真起监听（proxy 为 undefined）。
  const configA = { port: 8788, routes: [{ id: 'codearts', signer: 'huawei', rules: ['codearts'] }] }
  apply(makeCtx(webServer, disposers), configA)
  const staleHandler = webServer.table.get('exact /api/api-rules/accounts')

  const read = async (handler) => {
    let captured = null
    await handler({ method: 'GET' }, {
      writeHead: (status) => { captured = { status } },
      end: (body) => { captured.body = JSON.parse(body) },
    })
    return captured.body
  }

  const before = await read(staleHandler)
  assert.equal(before.routes.length, 1)

  // 第二轮：换成两条路由（模拟 patch 加了 minimax2api 之后重载）。
  disposers[0]()
  const configB = {
    port: 8788,
    routes: [
      { id: 'codearts', signer: 'huawei', rules: ['codearts'] },
      { id: 'minimax2api', upstream: 'http://127.0.0.1:9999', rules: ['generic'] },
    ],
  }
  apply(makeCtx(webServer, disposers), configB)

  // 关键断言：**第一轮那个旧闭包**现在也必须看到两条路由。
  const after = await read(staleHandler)
  assert.equal(after.routes.length, 2, '旧 handler 闭包必须读实时 live.routeConfigs，不能报旧快照')
  assert.ok(after.routes.some((r) => r.id === 'minimax2api'), '新路由必须立刻出现在旧 handler 的响应里')
})
