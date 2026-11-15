/**
 * 扩展性回归：证明「新增供应商不再需要改任何 .mjs 常量」（自包含、不依赖运行宿主）。
 * 覆盖：listDeclaredProviders / deriveOwnedProviders / 字面键(含 . 与易误匹配对照) /
 *       新建 models: 段 / routes 驱动端到端 / 漏配可见 / owned 显式优先 /
 *       真实写盘 + 备份 + 幂等 + 非 owned 保护。
 * 跑法：node test/sync-extensibility-selftest.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OWNED_PROVIDERS, listDeclaredProviders, deriveOwnedProviders,
  parseProviders, planSync, applyEdits, normalizeModel, syncModels,
} from '../lib/sync-models.mjs'

const M = (id, extra = {}) => normalizeModel({ id, ...extra })

// 合成 profile：6 空格 provider 键。刻意包含：
//  - brandnew：只写了 baseURL，还没建 models: 段（新增供应商的典型初始状态）；
//  - axb 放在 a.b 前面：老代码把 key 拼进正则 '^ {6}a.b:' 会先命中 axb（. 当通配）；
//  - a.b：含正则元字符 '.' 的合法字面键；
//  - tongji：非本插件拥有，任何情况下都不许动。
const yaml = [
  '- id: some-other-plugin',
  '  config: {}',
  '- id: llm-pi-ai',
  '  config:',
  '    providers:',
  '      codearts:',
  '        models:',
  '          - id: ca-1',
  '            contextWindow: 128000',
  '            maxTokens: 65536',
  '      trae2api-hub:',
  '        models: # 手写行尾注释也要认',
  '          - id: old-short',
  '            contextWindow: 128000',
  '            maxTokens: 65536',
  '      brandnew:',
  '        baseURL: http://127.0.0.1:9999/v1',
  '        apiKeyEnv: BRANDNEW_KEY',
  '      axb:',
  '        models:',
  '          - id: wrong-1',
  '            contextWindow: 128000',
  '            maxTokens: 65536',
  '      a.b:',
  '        models:',
  '          - id: meta-1',
  '            contextWindow: 128000',
  '            maxTokens: 65536',
  '      tongji:',
  '        models:',
  '          - id: tj-1',
  '            contextWindow: 128000',
  '            maxTokens: 65536',
  '- id: dsh-connect-trae',
  '  config: {}',
  '',
].join('\n')

const DECLARED = ['codearts', 'trae2api-hub', 'brandnew', 'axb', 'a.b', 'tongji']
const ROUTES = ['codearts', 'trae2api-hub', 'brandnew', 'a.b']
const discovered = {
  codearts: { ok: true, fallback: false, models: [M('ca-1'), M('ca-new')] },
  'trae2api-hub': { ok: true, fallback: false, models: [M('trae:x1'), M('solo:y1'), M('trae-intl:z1')] },
  brandnew: { ok: true, fallback: false, models: [M('b1'), M('b2')] },
  'a.b': { ok: true, fallback: false, models: [M('meta-1')] },
}
const inject = async () => discovered

const dir = await mkdtemp(join(tmpdir(), 'sync-ext-selftest-'))
const patch = join(dir, 'cordis.patch.yml')
await writeFile(patch, yaml, 'utf8')
try {
  // [0] 声明侧全集（6 空格键），8 空格的 models: 不算 provider 键。
  assert.deepEqual(listDeclaredProviders(yaml), DECLARED)
  console.log('[0] listDeclaredProviders OK = ' + DECLARED.join(','))

  // [1] 派生：route ∩ declared（去重保序），漏配单独进 missing。
  const d1 = deriveOwnedProviders(yaml, ['codearts', 'brandnew', 'ghost', 'a.b', 'codearts'])
  assert.deepEqual(d1.owned, ['codearts', 'brandnew', 'a.b'])
  assert.deepEqual(d1.missing, ['ghost'])
  assert.deepEqual(d1.declared, DECLARED)
  // 直接传 route 对象也要认（与 syncModels 里 routes 归一化的结果一致）。
  assert.deepEqual(deriveOwnedProviders(yaml, [{ id: 'codearts' }, { id: 'brandnew' }, { id: 'ghost' }]).owned,
    ['codearts', 'brandnew'])
  console.log('[1] deriveOwnedProviders OK - owned=3 missing=ghost (object routes OK)')

  // [2] 非数组 routeIds -> 退回离线兜底常量（向后兼容）。
  const d2 = deriveOwnedProviders(yaml, undefined)
  assert.deepEqual(d2.owned, OWNED_PROVIDERS.slice())
  assert.deepEqual(d2.missing, [])
  console.log('[2] fallback OK - owned=' + d2.owned.length + ' 家')

  // [3] 字面键：'a.b' 必须命中 a.b 而不是排在它前面的 axb（老正则会串）。
  const pab = parseProviders(yaml, ['a.b'])
  assert.equal(pab.providers['a.b'].found, true)
  assert.deepEqual(pab.providers['a.b'].ids, ['meta-1'])
  const paxb = parseProviders(yaml, ['axb'])
  assert.deepEqual(paxb.providers['axb'].ids, ['wrong-1'])
  // 行尾注释的 models: 也要认
  const ptr = parseProviders(yaml, ['trae2api-hub'])
  assert.deepEqual(ptr.providers['trae2api-hub'].ids, ['old-short'])
  console.log('[3] literal key + trailing-comment models OK - a.b=meta-1, axb=wrong-1')

  // [4] 无 models: 段 -> needsModelsBlock，且 planSync/applyEdits 能整段新建。
  const pbn = parseProviders(yaml, ['brandnew'])
  assert.equal(pbn.providers['brandnew'].found, true)
  assert.equal(pbn.providers['brandnew'].modelsLine, -1)
  assert.equal(pbn.providers['brandnew'].needsModelsBlock, true)
  const planBn = planSync(pbn, discovered, ['brandnew'])
  assert.equal(planBn.edits.length, 1)
  assert.equal(planBn.edits[0].modelsLine, -1)
  const bnText = applyEdits(pbn, planBn.edits).join(pbn.eol)
  assert.ok(bnText.includes('        models:\n          - id: b1'))
  assert.deepEqual(parseProviders(bnText, ['brandnew']).providers['brandnew'].ids.slice().sort(), ['b1', 'b2'])
  console.log('[4] new models: block OK - brandnew auto-created with b1,b2')

  // [5] routes 驱动端到端（不传 owned）：owned 自动派生、新供应商被纳入、dryRun 绝不写盘。
  const res = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: true, routes: ROUTES,
    profilePath: patch, discover: inject,
  })
  assert.equal(res.ok, true, 'dryRun ok: ' + res.error)
  assert.equal(res.changed, true)
  assert.deepEqual(res.owned, ROUTES, 'owned must be derived from routes, not handwritten')
  // 点睛：brandnew 根本不在 OWNED_PROVIDERS 兜底常量里 —— 证明「新增供应商无需改任何 .mjs 常量」。
  assert.ok(!OWNED_PROVIDERS.includes('brandnew'), 'brandnew must NOT be in the fallback constant')
  assert.deepEqual(res.skipped.filter((s) => s.reason === 'provider-not-declared-in-llm-pi-ai'), [])
  assert.equal(res.added.filter((a) => a.provider === 'brandnew').length, 2)
  assert.equal(res.added.filter((a) => a.provider === 'trae2api-hub').length, 3)
  assert.equal(await readFile(patch, 'utf8'), yaml, 'dryRun must never write')
  console.log('[5] routes-driven dryRun OK - owned=' + res.owned.join(',') + ' , brandnew +2, trae +3')

  // [5b] 真实启用路径的形态：index.mjs 传的是 live.routeConfigs（route 对象数组，带 .id），
  //      不是 id 字符串数组。端到端证明这条路径也派生正确。
  const resObj = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: true,
    routes: ROUTES.map((id) => ({ id, label: id })),
    profilePath: patch, discover: inject,
  })
  assert.deepEqual(resObj.owned, ROUTES, 'object-array routes must derive the same owned list')
  console.log('[5b] object-array routes (real enable path) OK - owned=' + resObj.owned.join(','))

  // [6] 漏配可见：路由表里有、profile 没声明 -> skipped + warn，绝不再静默忽略。
  const warns = []
  const resMiss = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: true, routes: [...ROUTES, 'ghost'],
    profilePath: patch, discover: inject,
    logger: { warn: (m) => warns.push(m), info: () => {} },
  })
  assert.ok(resMiss.skipped.some((s) => s.provider === 'ghost' && s.reason === 'provider-not-declared-in-llm-pi-ai'))
  assert.ok(warns.some((m) => m.includes('ghost')), 'must warn about undeclared provider')
  assert.ok(!resMiss.owned.includes('ghost'))
  console.log('[6] undeclared-provider visible OK - skipped + warn, ghost not owned')

  // [7] owned 显式传值优先于 routes（离线/单测后门保留）。
  const resOwn = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: true, owned: ['codearts'], routes: ['brandnew'],
    profilePath: patch, discover: inject,
  })
  assert.deepEqual(resOwn.owned, ['codearts'])
  console.log('[7] explicit owned overrides routes OK')

  // [8] 真实写盘：多 provider 同时改 + 新建段倒序 splice 不错位；备份、幂等、非 owned 保护。
  const res2 = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: false, routes: ROUTES,
    profilePath: patch, discover: inject,
  })
  assert.equal(res2.ok, true, 'write ok: ' + res2.error)
  assert.equal(res2.changed, true)
  assert.ok(res2.backup && res2.backup.includes('.bak-modelsync-'))
  const finalText = await readFile(patch, 'utf8')
  const pf = parseProviders(finalText, ROUTES)
  assert.deepEqual(pf.providers.codearts.ids.slice().sort(), ['ca-1', 'ca-new'])
  assert.deepEqual(pf.providers['trae2api-hub'].ids.slice().sort(), ['trae:x1', 'solo:y1', 'trae-intl:z1'].sort())
  assert.deepEqual(pf.providers.brandnew.ids.slice().sort(), ['b1', 'b2'])
  assert.deepEqual(pf.providers['a.b'].ids, ['meta-1'])
  // 非 owned：axb / tongji 一个都不许变
  const pnon = parseProviders(finalText, ['axb', 'tongji'])
  assert.deepEqual(pnon.providers.axb.ids, ['wrong-1'])
  assert.deepEqual(pnon.providers.tongji.ids, ['tj-1'])
  assert.equal(finalText.includes('- id: old-short'), false, 'trae short id must be pruned')
  console.log('[8] real write OK - backup + new block + non-owned(axb,tongji) untouched')

  // [9] 写后二次运行 changed=false（绝不写盘，防 HMR 重载循环）。
  const res3 = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: false, routes: ROUTES,
    profilePath: patch, discover: inject,
  })
  assert.equal(res3.ok, true)
  assert.equal(res3.changed, false)
  console.log('[9] post-write idempotency OK - changed=false')

  console.log('\nALL PASS (extensibility)')
} finally {
  await rm(dir, { recursive: true, force: true })
}
