// 端到端回归：模拟 dsh-hmr 的一次「重载插件条目」完整循环，断言新实例能接住同一个端口。
//
// 2026-11-09 事故现场（用户看到的「怎么又坏了」）：
//   1. workbuddy 面板把 profile 的 cordis.patch.yml 回写 → dsh-hmr 的 watchConfig
//      发现内容变了 → reconcileProfile() → 重载 llm-api-rules 条目；
//   2. 旧 fiber 的 `ctx.effect` 清理函数调 proxy.close()，而 server.close() 要等
//      所有 keep-alive 连接结束才回调 —— DSH 自己是最大客户端，于是旧监听吊住；
//   3. 新 fiber 拿同一个 8788 连续 EADDRINUSE，8 次重试耗尽后 reject；
//   4. 同时旧 fiber 的 HTTP handler 还留在 webserver 路由表上（inject 没交还 disposer），
//      于是 /api/api-rules/accounts 永远由旧闭包回答：6 条路由 + listening:false，
//      而新 fiber 的监听其实已经起来在服务 7 条路由 → 卡片报「没有监听」的假红条。
//
// 本测试把 1-4 全串起来跑：真起两个 proxy 实例、真注册 HTTP 路由、真跑清理函数，
// 断言重载后端口没丢、路由是新的一份、accounts 报的是实时状态。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 找一个当前空闲的端口（绑 0 拿号后立刻释放）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

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

/** 收集 inject 与 effect 交还的清理函数，模拟 Cordis fiber 卸载。 */
function makeCtx(webServer, cleanups) {
  return {
    logger: undefined,
    get: () => undefined,
    provide: () => {},
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps[0] === 'webServer') {
        const dispose = cb({ webServer })
        if (typeof dispose === 'function') cleanups.push(dispose)
      }
    },
    effect: (factory) => {
      const dispose = factory()
      if (typeof dispose === 'function') cleanups.push(dispose)
    },
  }
}

test('重载循环：旧实例关停后新实例能接住同一个端口，且 accounts 报实时状态', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-reload-'))
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const port = await freePort()
  const { apply } = await import('../lib/index.mjs')
  const webServer = createFakeWebServer()

  const configA = {
    port,
    routes: [{ id: 'codearts', signer: 'huawei', rules: ['codearts'] }],
  }
  const cleanupsA = []
  apply(makeCtx(webServer, cleanupsA), configA)
  const staleHandler = webServer.table.get('exact /api/api-rules/accounts')
  assert.ok(staleHandler, '第一轮的 accounts handler 应已注册')

  // 等第一轮监听就绪
  await new Promise((resolve) => setTimeout(resolve, 300))

  const readAccounts = async (handler) => {
    let captured = null
    await handler({ method: 'GET' }, {
      writeHead: (status) => { captured = { status } },
      end: (body) => { captured.body = JSON.parse(body) },
    })
    return captured.body
  }
  const first = await readAccounts(staleHandler)
  assert.equal(first.routes.length, 1)
  assert.equal(first.proxy.listening, true, '第一轮应已监听')
  assert.equal(first.proxy.port, port)

  // ---- 模拟 HMR 重载：按 Cordis 的顺序先跑完所有清理函数 ----
  for (const dispose of cleanupsA.splice(0)) await dispose()

  const configB = {
    port,
    routes: [
      { id: 'codearts', signer: 'huawei', rules: ['codearts'] },
      { id: 'minimax2api', upstream: 'http://127.0.0.1:9999', rules: ['generic'] },
    ],
  }
  const cleanupsB = []
  assert.doesNotThrow(() => apply(makeCtx(webServer, cleanupsB), configB), '重载不应抛错')

  await new Promise((resolve) => setTimeout(resolve, 600))

  // 关键断言 1：新实例必须真的接住同一个端口（不是 EADDRINUSE 静默失败）
  const second = await readAccounts(webServer.table.get('exact /api/api-rules/accounts'))
  assert.equal(second.proxy.listening, true, '重载后必须仍在监听同一个端口（旧实例没释放会变成 false）')
  assert.equal(second.proxy.port, port)
  assert.equal(second.routes.length, 2, '重载后必须是新配置的两条路由')

  // 关键断言 2：旧闭包也不能报旧数据
  const viaStale = await readAccounts(staleHandler)
  assert.equal(viaStale.routes.length, 2, '旧 handler 必须读实时 live.routeConfigs')
  assert.equal(viaStale.proxy.listening, true, '旧 handler 也必须报实时监听状态')

  for (const dispose of cleanupsB.splice(0)) await dispose()
})
