// 「删掉一个动态上游再加回来」的完整回归（隔离环境，绝不碰真 profile）。
//
// 用户的原计划就是这条路径：把 intern-ai 从面板删掉，再用面板加回来，看能不能正确加载。
// 这条链上有三个曾经真出过错的地方，必须一起钉住：
//   1. POST handler 少了 `await putUpstream(...)` → upstream.id 是 undefined →
//      ensureProviderBlock 拿 undefined 建块 → 返回 invalid provider id → provider 块写不进去，
//      但接口照样回 200（半成品：面板显示已添加、选择器里却没有这个 provider）。
//   2. provider 块的 apiKeyEnv 曾被硬编码成占位 API_RULES_BEARER → 透传上游送上去的是
//      占位密钥 → 上游必然 401。
//   3. 模型同步只读扁平 context_length → intern-ai 的 schema 2.x 嵌套字段读不到 →
//      加回来后 11 个模型的窗口全被写成默认 128000（面板明明拉到 1048576）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  putUpstream, deleteUpstream, readUpstreams, upstreamToRoute, maskUpstream,
} from '../lib/upstreams.mjs'
import {
  ensureProviderBlock, removeProviderBlock, syncModels, normalizeModel, profilePatchPath,
} from '../lib/sync-models.mjs'
import { normalizeRoute } from '../lib/proxy.mjs'
import { RuleRegistry } from '../lib/registry.mjs'
import { internAiRules } from '../lib/rules/intern-ai.mjs'

/** 一份最小但结构真实的 profile patch：llm-pi-ai 段里有两个 provider，外加一个别的顶层条目。 */
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
  '      intern-ai:',
  '        displayName: intern-ai',
  '        apiKeyEnv: INTERN_AI_API_KEY',
  '        api: openai-completions',
  '        baseURL: http://127.0.0.1:8788/intern-ai/v1',
  '        models:',
  '          - id: intern-s2',
  '            contextWindow: 262144',
  '            maxTokens: 262144',
  '- id: dsh-connect-trae',
  '  name: dsh-connect-trae',
  '',
].join('\n')

/** 面板「＋」提交时会发出的 body（字段与 lib/client/index.js 的 onAddUpstream 一致）。 */
const PANEL_BODY = {
  id: 'intern-ai',
  name: 'intern-ai',
  baseUrl: 'https://discovery-api.intern-ai.org.cn/v1',
  apiKey: '',
  rules: ['intern-ai'],
  passthroughAuth: true,
  apiKeyEnv: 'INTERN_AI_API_KEY',
  models: [
    { id: 'deepseek-v4.1-flash-1017', maxTokens: 262144 },
    { id: 'intern-s2', maxTokens: 262144 },
    { id: 'intern-decision-4b', maxTokens: 8192 },
  ],
  concurrency: 2,
  timeoutMs: 300000,
}

/** intern-ai 真机 /v1/models 的 schema 2.x 形状（11 条，仅保留测试关心的字段）。 */
const UPSTREAM_MODELS = [
  ['Agents-A1', 262144], ['Atria-Dawn', 524288], ['Atria-Dawn-Preview', 524288],
  ['Sage-A1.5', 524288], ['Sage-A1.5-Taiyi', 524288], ['Sage-S2.1-Flash', 524288],
  ['deepseek-v4.1-flash-1017', 1048576], ['glm-5.3', 1048576], ['intern-s2', 262144],
  ['kimi-k3.1-pro', 1048576], ['qwen3.8-27b', 262144],
].map(([id, ctx]) => ({
  id,
  input_modalities: [{ supported_inputs: { max_context_length: { value: ctx } } }],
  output_modalities: [{ max_length: { value: ctx } }],
}))

async function setup(t) {
  const home = await mkdtemp(join(tmpdir(), 'api-rules-cycle-'))
  await mkdir(join(home, '.api-rules'), { recursive: true })
  await writeFile(join(home, 'cordis.patch.yml'), PROFILE, 'utf8')
  const env = { ...process.env, DSH_HOME: home, DSH_PROFILE_DIR: home }
  t.after(() => rm(home, { recursive: true, force: true }))
  const text = () => readFile(profilePatchPath(env), 'utf8')
  return { home, env, text }
}

const topLevelCount = (text) => text.split(/\r?\n/).filter((l) => /^- id: /.test(l)).length
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

test('删除动态上游：条目与 provider 块一起消失，且不牵连别的 provider', async (t) => {
  const { env, text } = await setup(t)
  await putUpstream(PANEL_BODY, env)
  const before = await text()
  assert.equal(topLevelCount(before), 2)

  assert.equal(await deleteUpstream('intern-ai', env), true, '第一次删除应返回 true')
  assert.equal(await deleteUpstream('intern-ai', env), false, '重复删除应幂等返回 false')
  assert.deepEqual(Object.keys(await readUpstreams(env)), [], 'upstreams.json 应已清空')

  const rm = await removeProviderBlock({ id: 'intern-ai', env })
  assert.equal(rm.ok, true)
  assert.equal(rm.removed, true)

  const after = await text()
  assert.equal(blockOf(after, 'intern-ai'), null, 'provider 块应已移除')
  assert.equal(topLevelCount(after), 2, '顶层条目数不能变')
  assert.ok(blockOf(after, 'codearts'), '邻居 provider codearts 必须还在')
  assert.ok(!after.includes('INTERN_AI_API_KEY'), '不能残留凭据引用')

  // 再删一次是幂等 no-op（面板连点 / 重载重放都不会炸）。
  const again = await removeProviderBlock({ id: 'intern-ai', env })
  assert.equal(again.ok, true)
  assert.equal(again.removed, false)
})

test('加回来：provider 块按面板填的 apiKeyEnv 重建，而不是占位密钥', async (t) => {
  const { env, text } = await setup(t)
  await deleteUpstream('intern-ai', env)
  await removeProviderBlock({ id: 'intern-ai', env })

  const upstream = await putUpstream(PANEL_BODY, env)
  // 这条断言就是 await 修复的哨兵：漏了 await 时 upstream 是 Promise，id 为 undefined。
  assert.equal(upstream.id, 'intern-ai', 'putUpstream 必须被 await（否则 provider 块建不出来）')

  const provider = await ensureProviderBlock({
    id: upstream.id, name: upstream.name, apiKeyEnv: upstream.apiKeyEnv, port: 8788, env,
  })
  assert.equal(provider.ok, true, provider.error ?? '')
  assert.equal(provider.created, true)

  const after = await text()
  const block = blockOf(after, 'intern-ai')
  assert.ok(block, 'provider 块应已重建')
  assert.equal(topLevelCount(after), 2, '顶层条目数不能变')
  assert.ok(block.includes('        apiKeyEnv: INTERN_AI_API_KEY'), block.join('\n'))
  assert.ok(!block.some((l) => l.includes('API_RULES_BEARER')), '不能退回占位密钥，否则透传必然 401')
  assert.ok(block.includes('        baseURL: http://127.0.0.1:8788/intern-ai/v1'))
  assert.ok(block.some((l) => l.trim() === 'models:'), '必须留出 models: 段供同步写入')
  assert.ok(blockOf(after, 'codearts'), '邻居 provider 不能被牵连')
})

test('加回来后的装配：透传 + 规则包 + 高级字段都还在', async (t) => {
  const { env } = await setup(t)
  await putUpstream(PANEL_BODY, env)
  const stored = (await readUpstreams(env))['intern-ai']
  const route = normalizeRoute(upstreamToRoute(stored))

  assert.equal(route.id, 'intern-ai')
  assert.equal(route.upstream, 'https://discovery-api.intern-ai.org.cn/v1')
  assert.equal(route.passthroughAuth, true, '透传鉴权必须保留（密钥只在 DSH 凭据里）')
  assert.deepEqual(route.rules, ['intern-ai'])
  assert.equal(route.models.length, 3)
  assert.equal(route.models.some((m) => m.id === 'intern-decision-4b'), true, '决策模型不能被丢')
  assert.equal(route.concurrency, 2)
  assert.equal(route.sessionHoldMs, 60000, 'normalizeRoute 默认会话保持 60s')
  assert.equal(route.timeoutMs, 300000)

  const registry = new RuleRegistry()
  registry.register(internAiRules)
  const pack = registry.get('intern-ai')
  assert.equal(pack.name, 'intern-ai', '规则包必须能按名字解析出来')
  assert.equal(typeof pack.throttle, 'function', '节流钩子必须在（否则配额保护失效）')

  const mask = maskUpstream(stored)
  assert.equal(mask.apiKeyMasked, 'passthrough', '卡片应显示为透传，而不是密钥掩码')
  assert.equal(mask.apiKeyEnv, 'INTERN_AI_API_KEY')
  assert.equal(mask.models, 3)
})

test('加回来后的模型同步：嵌套 schema 2.x 的窗口不能被写成默认 128000', async (t) => {
  const { env, text } = await setup(t)
  await deleteUpstream('intern-ai', env)
  await removeProviderBlock({ id: 'intern-ai', env })
  const upstream = await putUpstream(PANEL_BODY, env)
  await ensureProviderBlock({ id: upstream.id, name: upstream.name, apiKeyEnv: upstream.apiKeyEnv, port: 8788, env })

  const route = normalizeRoute(upstreamToRoute((await readUpstreams(env))['intern-ai']))
  const sync = await syncModels({
    origin: 'http://127.0.0.1:8788',
    env,
    routes: [route],
    discover: async ({ owned }) => {
      const out = {}
      for (const id of owned) {
        out[id] = id === 'intern-ai'
          ? { ok: true, fallback: false, models: UPSTREAM_MODELS.map(normalizeModel).filter(Boolean) }
          : { ok: false, error: 'not-in-this-test' }
      }
      return out
    },
  })

  assert.equal(sync.ok, true, sync.error ?? '')
  assert.deepEqual(sync.owned, ['intern-ai'], 'owned 应从「路由表 ∩ llm-pi-ai 声明」派生出来')
  assert.equal(sync.added.length, 11, '上游 11 个模型应全部写回')

  const block = blockOf(await text(), 'intern-ai')
  const ctxOf = (id) => {
    const i = block.findIndex((l) => l.trim() === '- id: ' + id)
    if (i < 0) return null
    const m = block.slice(i + 1, i + 4).find((l) => l.trim().startsWith('contextWindow:'))
    return m ? Number(m.split(':')[1].trim()) : null
  }
  assert.equal(ctxOf('deepseek-v4.1-flash-1017'), 1048576, '嵌套的 1048576 必须被读到')
  assert.equal(ctxOf('glm-5.3'), 1048576)
  assert.equal(ctxOf('Atria-Dawn'), 524288)
  assert.equal(ctxOf('intern-s2'), 262144)
  assert.ok(
    !block.some((l) => l.trim() === 'contextWindow: 128000'),
    '不能有任何模型退化成默认 128000：\n' + block.join('\n'),
  )
})
