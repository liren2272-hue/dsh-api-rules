/**
 * trae2api-hub joins enable-time model sync -- offline regression (self-contained, no live host).
 * Covers: namespace-migration exemption, idempotency after replacement, partial-list guard still
 * active, non-owned providers untouched, dryRun never writes, real write + backup + verifyWrite.
 * Run: node test/trae-sync-selftest.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OWNED_PROVIDERS, parseProviders, planSync, applyEdits, normalizeModel, syncModels,
} from '../lib/sync-models.mjs'

const OWNED = ['codearts', 'trae2api-hub'] // only these two, to avoid not-found noise from the other 5
assert.ok(OWNED_PROVIDERS.includes('trae2api-hub'), 'OWNED_PROVIDERS must contain trae2api-hub')
assert.equal(OWNED_PROVIDERS.length, 7)
console.log('[0] OWNED_PROVIDERS OK = ' + OWNED_PROVIDERS.join(','))

// Minimal synthetic profile patch; indentation must match parseProviders (6/8/10 spaces).
const SHORT = ['Seed-Code', 'Kimi-K3', 'DeepSeek-V4-Flash']
const PREFIXED = ['trae:DeepSeek-V4-Flash-Official', 'trae:glm-5.3', 'solo:kimi-k3', 'trae-intl:gpt-6', 'solo-intl:dsh']
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
  '          - id: ca-2',
  '            contextWindow: 128000',
  '            maxTokens: 65536',
  '      trae2api-hub:',
  '        models:',
  ...SHORT.flatMap((id) => [
    '          - id: ' + id,
    '            name: ' + id,
    '            contextWindow: 128000',
    '            maxTokens: 65536',
  ]),
  '      tongji:',
  '        models:',
  '          - id: tj-1',
  '            contextWindow: 128000',
  '- id: dsh-connect-trae',
  '  config: {}',
  '',
].join('\n')

const dir = await mkdtemp(join(tmpdir(), 'trae-sync-selftest-'))
const patch = join(dir, 'cordis.patch.yml')
await writeFile(patch, yaml, 'utf8')
try {
  // 1. parseProviders finds trae2api-hub among the 7 owned providers.
  const parsed = parseProviders(yaml, OWNED)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.providers['trae2api-hub'].found, true)
  assert.deepEqual(parsed.providers['trae2api-hub'].ids, SHORT)
  assert.deepEqual(parsed.providers.codearts.ids, ['ca-1', 'ca-2'])
  console.log('[1] parseProviders OK - trae short ids=3, codearts ids=2')

  // 2. Namespace migration: zero overlap + discovered >= declared -> NOT guarded.
  const discovered = {
    codearts: { ok: true, fallback: false, models: ['ca-1', 'ca-2'].map((id) => normalizeModel({ id })) },
    'trae2api-hub': { ok: true, fallback: false, models: PREFIXED.map((id) => normalizeModel({ id, name: id })) },
  }
  const plan = planSync(parsed, discovered, OWNED)
  assert.deepEqual(plan.guarded, [], 'namespace migration must not be guarded')
  const traeEdit = plan.edits.find((e) => e.provider === 'trae2api-hub')
  assert.ok(traeEdit, 'must produce a trae2api-hub edit')
  assert.equal(plan.added.filter((a) => a.provider === 'trae2api-hub').length, PREFIXED.length)
  assert.equal(plan.removed.filter((a) => a.provider === 'trae2api-hub').length, SHORT.length)
  assert.equal(plan.edits.length, 1, 'codearts unchanged -> no edit')
  console.log('[2] namespace migration OK - guarded=0, +' + PREFIXED.length + ' -' + SHORT.length)

  // 3. applyEdits then planSync again -> idempotent (edits=0).
  const newText = applyEdits(parsed, plan.edits).join(parsed.eol)
  const p2 = parseProviders(newText, OWNED)
  assert.equal(p2.ok, true)
  assert.deepEqual(p2.providers['trae2api-hub'].ids.slice().sort(), PREFIXED.slice().sort())
  const plan2 = planSync(p2, discovered, OWNED)
  assert.equal(plan2.edits.length, 0, 'after replacement must be idempotent')
  assert.deepEqual(plan2.guarded, [])
  console.log('[3] idempotency OK - second round edits=0')

  // 4. Partial-list guard still active: upstream returns only 1 unrelated prefixed id.
  const tiny = { ...discovered, 'trae2api-hub': { ok: true, fallback: false, models: [normalizeModel({ id: 'solo:only-one' })] } }
  const plan3 = planSync(parsed, tiny, OWNED)
  assert.ok(plan3.guarded.some((g) => g.provider === 'trae2api-hub' && /upstream-list-looks-partial/.test(g.reason)),
    'a tiny unrelated list must still be guarded')
  console.log('[4] partial-list guard regression OK - still guarded')

  // 5. Full syncModels(dryRun) path: verifyWrite passes, and dryRun never writes.
  const res = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: true, owned: OWNED, profilePath: patch,
    discover: async () => discovered,
  })
  assert.equal(res.ok, true, 'syncModels dryRun should be ok: ' + res.error)
  assert.equal(res.changed, true)
  assert.equal(res.added.length, PREFIXED.length)
  assert.equal(res.removed.length, SHORT.length)
  assert.deepEqual(res.guarded, [])
  assert.equal(res.error, null)
  assert.equal(await readFile(patch, 'utf8'), yaml, 'dryRun must never write')
  console.log('[5] syncModels(dryRun) full path OK - verifyWrite passed, file untouched')

  // 6. Real write (to temp file): backup exists, prefixed ids land, non-owned tongji kept.
  const res2 = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: false, owned: OWNED, profilePath: patch,
    discover: async () => discovered,
  })
  assert.equal(res2.ok, true, 'syncModels write should be ok: ' + res2.error)
  assert.equal(res2.changed, true)
  assert.ok(res2.backup && res2.backup.includes('.bak-modelsync-'))
  const finalText = await readFile(patch, 'utf8')
  const p3 = parseProviders(finalText, OWNED)
  assert.deepEqual(p3.providers['trae2api-hub'].ids.slice().sort(), PREFIXED.slice().sort())
  assert.deepEqual(p3.providers.codearts.ids, ['ca-1', 'ca-2'])
  assert.equal(finalText.includes('- id: tj-1'), true, 'non-owned tongji must be preserved')
  assert.equal(finalText.includes('- id: Seed-Code'), false, 'old short ids must be removed')
  console.log('[6] real write OK - backup present, prefixed ids landed, tongji untouched')

  // 7. After write, another run -> changed=false (no HMR reload loop).
  const res3 = await syncModels({
    origin: 'http://127.0.0.1:1', dryRun: false, owned: OWNED, profilePath: patch,
    discover: async () => discovered,
  })
  assert.equal(res3.ok, true)
  assert.equal(res3.changed, false, 'after write must be changed=false')
  console.log('[7] write idempotency OK - changed=false, no HMR reload loop')

  console.log('\nALL PASS')
} finally {
  await rm(dir, { recursive: true, force: true })
}
