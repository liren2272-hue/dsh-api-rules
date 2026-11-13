// GET /api/api-rules/accounts 的「只回掩码、不回明文」用例。
// fixture 建在测试体内（模块顶层建/删会让 handler 读到不存在的文件 → configured:false），
// 伪造的 ctx 必须带 provide（宿主 apply 会调用 ctx.provide('apiRules', ...)）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const AK = 'AKID1234567890abcd'
const SK = 'SKsecret0987654321wxyz'

test('GET /api/api-rules/accounts 只回掩码，不回明文', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-accounts-mask-'))
  // DSH_HOME 必须在写 fixture 之前、于测试体内设置
  process.env.DSH_HOME = tmp
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const accountsFile = join(tmp, '.api-rules', 'accounts.json')
  mkdirSync(join(tmp, '.api-rules'), { recursive: true })
  writeFileSync(accountsFile, JSON.stringify({
    codearts: { ak: AK, sk: SK, updatedAt: 1761555000000 },
  }), 'utf8')

  const { apply } = await import('../lib/index.mjs')

  const handlers = {}
  const ctx = {
    logger: undefined,
    get: () => undefined,
    provide: () => {},
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps[0] === 'webServer') {
        cb({ webServer: { register: (spec) => { handlers[spec.path] = spec.handler; return () => {} } } })
      }
    },
    effect: () => {}, // 不真正起 proxy
  }
  apply(ctx, { port: 8788, routes: [{ id: 'codearts', signer: 'huawei', rules: ['codearts'] }] })

  const handler = handlers['/api/api-rules/accounts']
  assert.ok(handler, 'accounts handler 应已注册')

  let status
  let raw
  await handler({ method: 'GET' }, {
    writeHead: (code) => { status = code },
    end: (body) => { raw = body },
  })

  assert.equal(status, 200)
  const body = JSON.parse(raw)
  const route = body.routes.find((r) => r.id === 'codearts')
  assert.ok(route, 'codearts 路由应出现在列表里')
  assert.equal(route.configured, true)

  // 掩码：只留末 4 位
  assert.equal(route.akHint, '****abcd')
  assert.equal(route.skHint, '****wxyz')
  assert.match(route.akHint, /\*\*\*\*/)
  assert.notEqual(route.akHint, AK)
  assert.notEqual(route.skHint, SK)

  // 明文不得出现在响应 JSON 的任何位置（含 proxy/routes 其它字段）
  assert.ok(!raw.includes(AK), 'AK 明文不得回显')
  assert.ok(!raw.includes(SK), 'SK 明文不得回显')

  // 掩码只在响应层：落盘文件仍是明文，且路径就是 <DSH_HOME>/.api-rules/accounts.json
  assert.equal(accountsFile, join(tmp, '.api-rules', 'accounts.json'))
  const saved = JSON.parse(readFileSync(accountsFile, 'utf8'))
  assert.equal(saved.codearts.ak, AK)
  assert.equal(saved.codearts.sk, SK)
})
