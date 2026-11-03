/**
 * 集成测试：把 huawei 签名器接入 createProxy，发一条 chat 请求，
 * 验证「本插件自带网关」确实在转发前做好了 SDK-HMAC-SHA256 签名（单一 AgentCenter
 * 通道 + Agent-Type）。benefit 免费额度通道已删除，见下方 opengw 断言。
 *
 * 上游用桩 fetch 拦截，不碰真实华为云。
 */
import assert from 'node:assert'
import http from 'node:http'
import { createProxy } from '../lib/proxy.mjs'
import { RuleRegistry } from '../lib/registry.mjs'
import { codeartsRules } from '../lib/rules/codearts.mjs'
import { genericRules } from '../lib/rules/generic.mjs'
import {
  signChatHeaders,
  discoverModels,
  toOpenAiModel,
  CODEARTS_CHAT_BASE,
  CODEARTS_AGENT_TYPE,
} from '../lib/huawei.mjs'

let passed = 0
function ok(name) {
  passed += 1
  console.log('PASS  ' + name)
}

const account = { ak: 'AK', sk: 'SK' }

// 桩：按 URL 分流，记录上游收到的请求头/体。
// - 发现类请求：回一份能解析出模型的真实结构，这样断言的是"真发现"而不是"兜底"。
// - 聊天请求：回一个非流式 chat.completion。
let receivedHeaders = null
let receivedBody = null
const discoveryCalls = []
global.fetch = async (url, opts) => {
  receivedHeaders = opts?.headers ?? {}
  receivedBody = opts?.body
  const href = String(url)

  if (href.includes('/v1/agent-center/agents/useragents')) {
    discoveryCalls.push({ url: href, headers: receivedHeaders })
    return new Response(
      JSON.stringify({
        total: 1,
        agents: [{ agent_id: 'a1', agent_name: 'CodeAgent', is_primary_agent: true, agent_order: 1000 }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  if (href.includes('/v1/agent-center/agents/detail')) {
    discoveryCalls.push({ url: href, headers: receivedHeaders })
    return new Response(
      JSON.stringify({
        gpts: {
          models: [
            {
              model_alias: 'GLM-5.2',
              model_name: 'GLM-5.2',
              model_parameters: { context_window: 202752, max_tokens: 65536, enable_queue: true },
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  // opengw benefit 网关已按用户实测结论删除；万一还被调用，测试要立刻炸。
  if (href.includes('opengw.developer.huaweicloud.com')) {
    throw new Error('不应再请求 opengw（benefit 通道已删除）：' + href)
  }
  return new Response(
    JSON.stringify({
      id: 'x',
      object: 'chat.completion',
      created: 0,
      model: 'glm-5.3-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const signers = {
  huawei: {
    signChatHeaders,
    discoverModels,
    toOpenAiModel,
    agentType: CODEARTS_AGENT_TYPE,
    chatBase: CODEARTS_CHAT_BASE,
  },
}

const registry = new RuleRegistry()
registry.register(genericRules)
registry.register(codeartsRules)

const proxy = createProxy({
  port: 0,
  routes: [{ id: 'codearts', signer: 'huawei', rules: ['codearts'], models: [], concurrency: 3, sessionHoldMs: 60_000 }],
  registry,
  logger: { debug() {}, warn() {}, error() {}, info() {} },
  modelInfo: () => undefined,
  signers,
  getCredential: () => account,
})

const origin = await proxy.ready.then(() => proxy.origin())

function post(path, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj)
    const req = http.request(
      origin + path,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = ''
        res.on('data', (c) => (buf += c))
        res.on('end', () => resolve({ status: res.statusCode, body: buf }))
      },
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// 单一 AgentCenter 通道：任意 model 都走同一套签名，不带 benefit 三件套
const resp = await post('/codearts/v1/chat/completions', {
  model: 'glm-5.3-flash',
  stream: false,
  messages: [{ role: 'user', content: 'hi' }],
})
assert.strictEqual(resp.status, 200, '聊天请求应 200，实际 ' + resp.status)
assert.ok(receivedHeaders !== null, '上游应收到请求')
assert.ok(
  typeof receivedHeaders['Authorization'] === 'string' && receivedHeaders['Authorization'].startsWith('SDK-HMAC-SHA256'),
  '上游请求头应带 SDK-HMAC-SHA256 签名',
)
assert.strictEqual(receivedHeaders['Agent-Type'], 'PromptCenter', 'Agent-Type 头应被附加')
assert.strictEqual(receivedHeaders['maas_type'], undefined, '不应再带 maas_type（benefit 通道已删除）')
assert.strictEqual(receivedHeaders['model-id'], undefined, '不应再带 model-id')
assert.strictEqual(receivedHeaders['model-name'], undefined, '不应再带 model-name')
// 签名头白名单必须恰好是 host/content-type/x-sdk-date
const shMatch = /SignedHeaders=([^,]+),/.exec(receivedHeaders['Authorization'])
assert.ok(shMatch !== null, 'Authorization 应含 SignedHeaders')
assert.deepStrictEqual(
  shMatch[1].split(';'),
  ['content-type', 'host', 'x-sdk-date'],
  'SignedHeaders 应为 content-type;host;x-sdk-date（字典序）',
)
ok('huawei 签名器在转发前附加了单一通道签名头（无 benefit 三件套）')

// 另一个 model 同样走单一通道
receivedHeaders = null
const resp2 = await post('/codearts/v1/chat/completions', {
  model: 'GLM-5.2',
  stream: false,
  messages: [{ role: 'user', content: 'hi' }],
})
assert.strictEqual(resp2.status, 200, '第二个 model 请求应 200')
assert.strictEqual(receivedHeaders['maas_type'], undefined, '任何 model 都不应带 maas_type')
assert.strictEqual(receivedHeaders['model-id'], undefined, '任何 model 都不应带 model-id')
assert.strictEqual(receivedHeaders['Agent-Type'], 'PromptCenter', '仍要带 Agent-Type')
ok('所有 model 统一走 AgentCenter 通道')

// ---- 回归：异步凭证 -------------------------------------------------------
//
// 真实插件的凭证源（读账号文件）是 async 的，getCredential 返回 Promise。
// 曾有一个 bug：proxy 把 Promise 当同步对象直接交给签名器，
// `cred.ak` 取到 undefined → 签名 `Access=` 为空 → 上游拒绝；
// 现象只是"静默退回兜底清单"，44 个测试全绿也照样漏掉。
// 下面两个用例专门钉死这条路径。
const asyncProxy = createProxy({
  port: 0,
  routes: [{ id: 'codearts', signer: 'huawei', rules: ['codearts'], models: [], concurrency: 3, sessionHoldMs: 60_000 }],
  registry,
  logger: { debug() {}, warn() {}, error() {}, info() {} },
  modelInfo: () => undefined,
  signers,
  // 关键：返回 Promise，与 index.mjs 的真实接线一致
  getCredential: async () => account,
})
const asyncOrigin = await asyncProxy.ready.then(() => asyncProxy.origin())

function postAsync(path, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj)
    const req = http.request(
      asyncOrigin + path,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = ''
        res.on('data', (c) => (buf += c))
        res.on('end', () => resolve({ status: res.statusCode, body: buf }))
      },
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

receivedHeaders = null
const resp3 = await postAsync('/codearts/v1/chat/completions', {
  model: 'glm-5.3-flash',
  stream: false,
  messages: [{ role: 'user', content: 'hi' }],
})
assert.strictEqual(resp3.status, 200, '异步凭证下聊天请求应 200，实际 ' + resp3.status)
assert.ok(
  /^SDK-HMAC-SHA256 Access=AK,/.test(receivedHeaders['Authorization'] ?? ''),
  '异步凭证必须被 await：Authorization 里 Access 应为 AK，实际 ' + receivedHeaders['Authorization'],
)
ok('异步凭证（Promise）被正确 await，签名带真实 AK')

// 模型清单同样要走真实凭证，而不是静默兜底
const modelsRes = await new Promise((resolve, reject) => {
  const req = http.request(
    asyncOrigin + '/codearts/v1/models',
    { method: 'GET', headers: { Authorization: 'Bearer test' } },
    (res) => {
      let buf = ''
      res.on('data', (c) => (buf += c))
      res.on('end', () => resolve({ status: res.statusCode, body: buf }))
    },
  )
  req.on('error', reject)
  req.end()
})
assert.strictEqual(modelsRes.status, 200, '/v1/models 应 200')
const modelIds = JSON.parse(modelsRes.body).data.map((m) => m.id)
assert.ok(modelIds.includes('GLM-5.2'), '异步凭证下应发现到真实模型，实际: ' + modelIds.join(', '))
ok('异步凭证下 /v1/models 走真实发现（不再静默兜底）')

await asyncProxy.close?.()
await proxy.close?.()
console.log('\n' + passed + ' passed, 0 failed')
process.exit(0)
