// HTTP 层的「删掉再加回」回归：真正走 POST / DELETE handler，而不是只调库函数。
//
// 为什么必须测到 handler 这一层：曾经的真 bug 就在 handler 里 ——
//   upstream = putUpstream({...})   // 少了 await
// putUpstream 是 async，于是 upstream 是 Promise，`upstream.id` 是 undefined，
// ensureProviderBlock 收到 undefined 回 `invalid provider id`，provider 块写不进 profile
// → 模型选择器里看不到这个供应商，但接口照样回 200。只调库函数测不出来，只有打 HTTP
// 端点、看响应里的 provider.created 才抓得住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { profilePatchPath } from '../lib/sync-models.mjs'

const PROFILE = [
  '- id: llm-pi-ai',
  '  name: llm-pi-ai',
  '  config:',
  '    providers:',
  '      codearts:',
  '        displayName: Codearts',
  '        apiKeyEnv: API_RULES_BEARER',
  '        api: openai-completions',
  '        baseURL: http://127.0.0.1:8788/codearts/v1',
  '        models:',
  '          - id: agent-chat',
  '            contextWindow: 128000',
  '            maxTokens: 32000',
  '- id: dsh-connect-trae',
  '  name: dsh-connect-trae',
  '',
].join('\n')

const PANEL_BODY = {
  id: 'intern-ai',
  name: 'intern-ai',
  baseUrl: 'https://discovery-api.intern-ai.org.cn/v1',
  apiKey: '',
  rules: ['intern-ai'],
  passthroughAuth: true,
  apiKeyEnv: 'INTERN_AI_API_KEY',
  models: [{ id: 'intern-s2', maxTokens: 262144 }],
  concurrency: 2,
  timeoutMs: 300000,
}

/** 复刻宿主 webserver 的 (kind, path) 语义，register 返回摘除函数。 */
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
      if (Array.isArray(deps) && deps[0] === 'webServer') disposers.push(cb({ webServer }))
    },
    effect: () => {},
  }
}

/** 把一次 handler 调用包成「可 await 的 (status, body)」。 */
async function call(handler, { method, url = '/', body }) {
  const request = {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
  const captured = { status: 0, body: null, headers: {} }
  const response = {
    headersSent: false,
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers ?? {}
      this.headersSent = true
    },
    end(payload) {
      captured.body = payload === undefined ? null : JSON.parse(payload)
    },
  }
  await handler(request, response)
  return captured
}

const blockOf = (text, id) => {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l === '      ' + id + ':')
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}[A-Za-z0-9._-]+:\s*$/.test(lines[i]) || /^- id: /.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end)
}

test('POST /upstreams 必须把 provider 块真的写进 profile（await 缺失的哨兵）', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'api-rules-ep-'))
  await mkdir(join(home, '.api-rules'), { recursive: true })
  await writeFile(join(home, 'cordis.patch.yml'), PROFILE, 'utf8')
  const env = { ...process.env, DSH_HOME: home, DSH_PROFILE_DIR: home }
  Object.assign(process.env, { DSH_HOME: home, DSH_PROFILE_DIR: home })

  // 上游发现一律快速失败：本用例只关心写盘链路，不打真实外网。
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline-test') }
  t.after(async () => {
    globalThis.fetch = realFetch
    await rm(home, { recursive: true, force: true })
  })

  const { apply } = await import('../lib/index.mjs')
  const webServer = createFakeWebServer()
  const disposers = []
  // port 0 = 让内核分配，绝不和线上 8788 抢端口。
  apply(makeCtx(webServer, disposers), { port: 0, routes: [], syncModelsOnEnable: false })
  t.after(async () => {
    for (const dispose of disposers.splice(0)) {
      try { await dispose() } catch { /* 清理阶段忽略 */ }
    }
  })

  const handler = webServer.table.get('exact /api/api-rules/upstreams')
  assert.ok(handler, 'upstreams 路由必须已注册')

  const post = await call(handler, { method: 'POST', body: PANEL_BODY })
  assert.equal(post.status, 200, JSON.stringify(post.body))
  assert.equal(post.body.ok, true)
  assert.equal(post.body.upstream.id, 'intern-ai', '响应里的 upstream 必须是已落盘的对象，而不是 Promise')
  assert.equal(post.body.provider?.ok, true, 'provider 块必须写入成功：' + JSON.stringify(post.body.provider))
  assert.equal(post.body.provider?.created, true)

  const text = await readFile(profilePatchPath(env), 'utf8')
  const block = blockOf(text, 'intern-ai')
  assert.ok(block, 'profile 里必须出现 intern-ai provider 块')
  assert.ok(block.includes('        apiKeyEnv: INTERN_AI_API_KEY'), block.join('\n'))
  assert.ok(!block.some((l) => l.includes('API_RULES_BEARER')), '不能退回占位密钥')

  // 卡片 GET 应该能看到这条上游，且标成透传。
  const list = await call(handler, { method: 'GET' })
  assert.equal(list.status, 200)
  const masked = list.body.upstreams.find((u) => u.id === 'intern-ai')
  assert.ok(masked, '列表里必须有 intern-ai')
  assert.equal(masked.apiKeyMasked, 'passthrough')
  assert.equal(JSON.stringify(list.body).includes('sk-'), false, '列表绝不能回传明文密钥')

  // DELETE：条目与 provider 块一起消失。
  const del = await call(handler, { method: 'DELETE', url: '/api/api-rules/upstreams?id=intern-ai' })
  assert.equal(del.status, 200, JSON.stringify(del.body))
  assert.equal(del.body.ok, true)
  assert.equal(del.body.provider?.removed, true, JSON.stringify(del.body.provider))

  const afterDel = await readFile(profilePatchPath(env), 'utf8')
  assert.equal(blockOf(afterDel, 'intern-ai'), null, 'provider 块必须被删掉')
  assert.ok(blockOf(afterDel, 'codearts'), '邻居 provider 不能被牵连')
  assert.ok(!afterDel.includes('INTERN_AI_API_KEY'), '不能残留凭据引用')

  // 再删一次：404（条目已不存在），不是 500。
  const again = await call(handler, { method: 'DELETE', url: '/api/api-rules/upstreams?id=intern-ai' })
  assert.equal(again.status, 404)
})

test('POST /upstreams 参数非法时回 400 而不是半成品 200', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'api-rules-ep-neg-'))
  await mkdir(join(home, '.api-rules'), { recursive: true })
  await writeFile(join(home, 'cordis.patch.yml'), PROFILE, 'utf8')
  Object.assign(process.env, { DSH_HOME: home, DSH_PROFILE_DIR: home })
  t.after(() => rm(home, { recursive: true, force: true }))

  const { apply } = await import('../lib/index.mjs')
  const webServer = createFakeWebServer()
  const disposers = []
  apply(makeCtx(webServer, disposers), { port: 0, routes: [], syncModelsOnEnable: false })
  t.after(async () => {
    for (const dispose of disposers.splice(0)) {
      try { await dispose() } catch { /* 清理阶段忽略 */ }
    }
  })

  const handler = webServer.table.get('exact /api/api-rules/upstreams')
  // 非透传却没给 apiKey：normalizeUpstream 抛错 → 400，且不落盘。
  const bad = await call(handler, {
    method: 'POST',
    body: { id: 'x', baseUrl: 'https://example.com/v1', rules: ['generic'] },
  })
  assert.equal(bad.status, 400, JSON.stringify(bad.body))
  assert.equal(bad.body.error, 'invalid_upstream')
  const text = await readFile(join(home, 'cordis.patch.yml'), 'utf8')
  assert.equal(blockOf(text, 'x'), null, '非法请求不能写 provider 块')
})
