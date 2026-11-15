/**
 * Run ONE enable-time model sync against the real desktop profile patch.
 * Default = dry-run (read-only). Set APPLY=1 to actually write (timestamped backup + atomic rename).
 * This is the manual equivalent of what index.mjs does on proxy.ready; it uses the SAME
 * lib/sync-models.mjs code, including the newly added trae2api-hub provider.
 * Run: node test/trae-sync-once.mjs          (dry-run)
 *      APPLY=1 node test/trae-sync-once.mjs  (write)
 */
import { syncModels, OWNED_PROVIDERS } from '../lib/sync-models.mjs'

const res = await syncModels({
  origin: 'http://127.0.0.1:8788',
  profilePath: 'C:/Users/15940/.dsh/profiles/desktop/cordis.patch.yml',
  dryRun: process.env.APPLY !== '1',
  logger: console,
})
console.log('OWNED=' + OWNED_PROVIDERS.join(','))
console.log('RESULT ' + JSON.stringify(res, null, 2))
