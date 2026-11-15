/**
 * Verify the real trae2api-hub apply: disk content, backup integrity, idempotency,
 * and that the RUNNING host hot-picked the new model list via model-selector-config.
 * Run: node test/trae-verify-apply.mjs
 */
import { readFile, readdir } from 'node:fs/promises'
import { parseProviders, syncModels, OWNED_PROVIDERS } from '../lib/sync-models.mjs'

const PROFILE_DIR = 'C:/Users/15940/.dsh/profiles/desktop'
const PATCH = PROFILE_DIR + '/cordis.patch.yml'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const text = await readFile(PATCH, 'utf8')
const p = parseProviders(text, ['trae2api-hub'])
const ids = p.ok ? p.providers['trae2api-hub'].ids : []
const prefixed = ids.filter((x) => /^(trae|solo|trae-intl|solo-intl):/.test(x))
const dsh = ids.filter((x) => x === 'dsh')
const short = ids.filter((x) => !x.includes(':') && x !== 'dsh')
console.log('DISK trae ids = ' + ids.length
  + ' | prefixed=' + prefixed.length + ' | dsh=' + dsh.length + ' | short-leftover=' + short.length)
console.log('DISK top-level entries = ' + p.topLevelCount)
console.log('DISK short-leftover list = ' + JSON.stringify(short))

// Backup: find the newest .bak-modelsync-* and prove the tail (tongji onward) is byte-identical.
const files = await readdir(PROFILE_DIR)
const baks = files.filter((f) => f.startsWith('cordis.patch.yml.bak-modelsync-')).sort()
const bakName = baks[baks.length - 1]
if (bakName) {
  const bakText = await readFile(PROFILE_DIR + '/' + bakName, 'utf8')
  const bp = parseProviders(bakText, ['trae2api-hub'])
  const bakIds = bp.ok ? bp.providers['trae2api-hub'].ids : []
  const anchor = '      tongji:'
  const tailA = bakText.slice(bakText.indexOf(anchor))
  const tailB = text.slice(text.indexOf(anchor))
  console.log('BACKUP ' + bakName + ' | old trae ids=' + bakIds.length
    + ' | old short=' + bakIds.filter((x) => !x.includes(':')).length
    + ' | tail(tongji..EOF) identical=' + (tailA === tailB && tailA.length > 0))
  console.log('BACKUP old short list = ' + JSON.stringify(bakIds.filter((x) => !x.includes(':') && x !== 'dsh')))
} else {
  console.log('BACKUP none found')
}

// Idempotency: a fresh dry-run against the real (just-written) patch must be changed=false.
const idem = await syncModels({ origin: 'http://127.0.0.1:8788', profilePath: PATCH, dryRun: true, owned: OWNED_PROVIDERS })
console.log('IDEMPOTENT dry-run changed=' + idem.changed + ' ok=' + idem.ok
  + ' added=' + idem.added.length + ' removed=' + idem.removed.length
  + ' guarded=' + JSON.stringify(idem.guarded) + ' error=' + idem.error)

// Running host hot-pick: poll the model-selector-config endpoint.
console.log('---- GUI HOT-PICK POLL ----')
for (let i = 0; i < 6; i++) {
  try {
    const r = await fetch('http://127.0.0.1:41264/api/model-selector-config/providers', { signal: AbortSignal.timeout(4000) })
    const body = await r.text()
    const cnt = (s) => (body.match(new RegExp(s, 'g')) || []).length
    console.log('poll ' + i + ' http=' + r.status
      + ' bytes=' + body.length
      + ' trae:=' + cnt('"trae:') + ' solo:=' + cnt('"solo:')
      + ' Seed-Code=' + cnt('Seed-Code') + ' Kimi-K3=' + cnt('"Kimi-K3"'))
  } catch (e) {
    console.log('poll ' + i + ' ERROR ' + String((e && e.message) || e))
  }
  await sleep(1500)
}
