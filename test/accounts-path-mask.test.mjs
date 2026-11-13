// 验证 GET /api/api-rules/accounts 的 configured 与掩码来自**正确路径**：
//  - 只认 <DSH_HOME>/.api-rules/accounts.json（同目录外的同名文件不算）
//  - configured 跟随该文件存在与否变化（证明不是别的来源/缓存）
//  - 响应 JSON 任何位置都不得出现 ak/sk 明文
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const AK = 'AK123456'
const SK = 'SKabcdef'

test('configured and hints come from <DSH_HOME>/.api-rules/accounts.json only', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'api-rules-path-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  // DSH_HOME 必须在写 fixture 之前、且在测试体内设置
  process.env.DSH_HOME = tmp

  const expected = join(tmp, '.api-rules', 'accounts.json')
  mkdirSync(join(tmp, '.api-rules'), { recursive: true })
  writeFileSync(expected, JSON.stringify({ codearts: { ak: AK, sk: SK, updatedAt: 1761555000000 } }), 'utf8')
  assert.ok(existsSync(expected), 'fixture 应落在 <DSH_HOME>/.api-rules/accounts.json')

  // 诱饵：把同名文件放在 DSH_HOME 根下（错误路径），内容不同；handler 绝不能读到它
  writeFileSync(join(tmp, 'accounts.json'), JSON.stringify({ codearts: { ak: 'AKDECOY0', sk: 'SKdecoy0', updatedAt: 1 } }), 'utf8')

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
  apply(ctx, { port: 8788, routes: [{ id: 'codearts', signer: 'huawei', rules: ['codearts'] }] })

  const handler = handlers['/api/api-rules/accounts']
  assert.ok(handler, 'accounts handler 应已注册')

  async function call() {
    const captured = {}
    await handler({ method: 'GET' }, {
      writeHead: (status) => { captured.status = status },
      end: (body) => { captured.body = JSON.parse(body); captured.raw = body },
    })
    return captured
  }

  // 1) 正确路径有文件 → configured 为真，掩码只留末 4 位
  let res = await call()
  assert.equal(res.status, 200)
  let route = res.body.routes.find((r) => r.id === 'codearts')
  assert.equal(route.configured, true)
  assert.equal(route.akHint, '****3456')
  assert.equal(route.skHint, '****cdef')
  assert.equal(route.updatedAt, 1761555000000)
  // 掩码长度固定为 8（**** + 末 4 位），不随密钥长度变化——否则等于泄露密钥长度
  assert.equal(route.akHint.length, 8)
  assert.equal(route.skHint.length, 8)
  // 结构上也只允许 *Hint 字段出现：响应里不得有 ak / sk / authorization 原名字段
  assert.deepEqual(Object.keys(route).filter((k) => /^(ak|sk|authorization)$/.test(k)), [])

  // 诱饵值没有生效
  assert.ok(!res.raw.includes('AKDECOY0') && !res.raw.includes('SKdecoy0'))
  // 明文绝不出现在响应里（整个 body，含 routes/proxy）
  assert.ok(!res.raw.includes(AK), 'AK 明文不得回显')
  assert.ok(!res.raw.includes(SK), 'SK 明文不得回显')
  assert.equal(JSON.stringify(res.body).includes(AK + SK), false)

  // 2) 删掉正确路径的文件（诱饵仍在）→ configured 必须变 false，说明读的就是这个路径
  rmSync(expected)
  res = await call()
  route = res.body.routes.find((r) => r.id === 'codearts')
  assert.equal(route.configured, false)
  assert.equal(route.akHint, '')
  assert.equal(route.skHint, '')

  // 3) 只恢复诱饵文件也不该被当成账号
  assert.ok(existsSync(join(tmp, 'accounts.json')))
  res = await call()
  assert.equal(res.body.routes.find((r) => r.id === 'codearts').configured, false)

  // 4) 重新写回正确路径 → configured 再次为真，掩码随之变化
  writeFileSync(expected, JSON.stringify({ codearts: { ak: 'AK99999999', sk: 'SKzzzzzz', updatedAt: 1761555000001 } }), 'utf8')
  res = await call()
  route = res.body.routes.find((r) => r.id === 'codearts')
  assert.equal(route.configured, true)
  assert.equal(route.akHint, '****9999')
  assert.equal(route.skHint, '****zzzz')
  assert.ok(!res.raw.includes('AK99999999') && !res.raw.includes('SKzzzzzz'))
})
