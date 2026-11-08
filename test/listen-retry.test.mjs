/**
 * 监听失败回归：端口被占用时必须重试，而不是让整个前置层静默死掉。
 *
 * 事故背景（2026-11-08）：宿主重启时上一次进程还没放开 8788，`server.listen`
 * 一次性失败 → ready reject → 只剩一条 error 日志；六条 API 同时全断，而设置卡片
 * 读的是 routeConfigs（配置），看上去一切正常。所以这里钉两件事：
 *   1. EADDRINUSE 后在重试窗口内仍能起监听；
 *   2. 真的起不来时 status() 能报出错误码（卡片据此显示异常）。
 *
 * 运行：node test/listen-retry.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { createProxy } from '../lib/proxy.mjs'
import { RuleRegistry, normalizePack } from '../lib/registry.mjs'

const pack = normalizePack({ name: 'passthrough' })

function registryOf() {
  const registry = new RuleRegistry()
  registry.register(pack)
  return registry
}

const ROUTE = { id: 'probe', rules: ['passthrough'], upstream: 'http://127.0.0.1:9' }

test('EADDRINUSE 之后重试仍能起来', async (t) => {
  // 先占住一个随机端口，模拟「上一个宿主进程还没退出」。
  const blocker = createServer()
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const port = blocker.address().port

  const proxy = createProxy({ port, routes: [ROUTE], registry: registryOf(), logger: undefined })
  t.after(async () => {
    await proxy.close().catch(() => {})
    await new Promise((resolve) => blocker.close(resolve))
  })

  // 占着不放时，ready 不该 resolve。
  const early = await Promise.race([
    proxy.ready.then(() => 'ready'),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 150)),
  ])
  assert.equal(early, 'pending', '端口被占用时 ready 不应 resolve')
  assert.equal(proxy.status().listening, false)

  // 放开端口，重试应当把它接起来。
  await new Promise((resolve) => blocker.close(resolve))
  await proxy.ready
  assert.equal(proxy.status().listening, true)
  assert.equal(proxy.status().port, port)
  assert.equal(proxy.status().error, undefined)
  assert.equal(proxy.origin(), 'http://127.0.0.1:' + port)
})

test('非 EADDRINUSE 的错误直接 reject 并留在 status 里', async (t) => {
  // 绑一个非法地址：不是 EADDRINUSE，应当立刻失败（不重试）。
  const proxy = createProxy({ port: 1, routes: [ROUTE], registry: registryOf(), logger: undefined })
  t.after(async () => {
    await proxy.close().catch(() => {})
  })
  // 端口 1 在普通用户下是 EACCES；某些环境允许，那就跳过断言。
  const outcome = await proxy.ready.then(
    () => 'ok',
    (error) => error,
  )
  if (outcome === 'ok') {
    assert.equal(proxy.status().listening, true)
    return
  }
  assert.notEqual(outcome.code, 'EADDRINUSE')
  assert.equal(proxy.status().listening, false)
  assert.equal(proxy.status().error, outcome.code)
})

test('有在途连接时 close() 也要立刻释放端口', async (t) => {
  /**
   * 事故背景（2026-11-09 00:26）：HMR 重载本条目时旧实例的 close() 卡在在途连接上，
   * 端口迟迟不释放；新实例 8 次重试全部 EADDRINUSE 后放弃，8788 与六条上游一起消失。
   * 所以这里钉住：只要 close() 被 await，端口就必须马上能重新绑上。
   *
   * 用裸 socket 而不是 http.Agent：Agent 会在请求结束后自行销毁连接，那样端口自然
   * 就释放了，测不出 close() 有没有主动断连（负向对照会假绿）。
   */
  const { connect } = await import('node:net')
  const proxy = createProxy({ port: 0, routes: [ROUTE], registry: registryOf(), logger: undefined })
  await proxy.ready
  const port = proxy.status().port

  // 建一条真正挂着不放的连接：连上后什么都不发，服务端会一直等请求头。
  const socket = connect({ host: '127.0.0.1', port })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  t.after(() => socket.destroy())

  const started = Date.now()
  const outcome = await Promise.race([
    proxy.close().then(() => 'closed'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000)),
  ])
  const elapsed = Date.now() - started
  assert.equal(outcome, 'closed', `close() 被在途连接吊住了（${elapsed}ms 未完成）`)
  assert.equal(proxy.status().listening, false)

  // 端口必须已经回到可用状态。
  const again = createServer()
  await new Promise((resolve, reject) => {
    again.once('error', reject)
    again.listen(port, '127.0.0.1', resolve)
  })
  await new Promise((resolve) => again.close(resolve))
})
