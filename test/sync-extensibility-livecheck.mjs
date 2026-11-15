/**
 * 真机校验：从运行中的规则前置层 /health 取路由表，喂给 syncModels({ routes })
 * 做一次只读 dry-run，证明「owned 由路由表自动派生」在真实 profile 上成立。
 * 不写盘、不改配置、不重启任何进程。
 * 跑法：node test/sync-extensibility-livecheck.mjs
 */
import { syncModels } from '../lib/sync-models.mjs'

const ORIGIN = 'http://127.0.0.1:8788'
const PROFILE = 'C:/Users/15940/.dsh/profiles/desktop/cordis.patch.yml'
const GUI = 'http://127.0.0.1:41264'

// 1) 从活宿主拿路由表（不是手写常量，正是扩展性的数据源）。
const health = await fetch(ORIGIN + '/health', { signal: AbortSignal.timeout(5000) }).then((r) => r.json())
const routes = Array.isArray(health.routes) ? health.routes : []
console.log('HEALTH ok=' + health.ok + ' routes=' + JSON.stringify(routes))

// 2) 真 routes 驱动 dry-run。
const res = await syncModels({ origin: ORIGIN, profilePath: PROFILE, routes, dryRun: true, logger: console })
console.log('RESULT ' + JSON.stringify(res, null, 2))
const missing = res.skipped.filter((s) => s.reason === 'provider-not-declared-in-llm-pi-ai')
console.log('CHECK-A owned_n=' + res.owned.length
  + ' owned=' + res.owned.join(',')
  + ' has_trae=' + res.owned.includes('trae2api-hub')
  + ' undeclared=' + JSON.stringify(missing)
  + ' changed=' + res.changed + ' ok=' + res.ok + ' error=' + res.error)

// 3) 负向对照：故意塞一个 profile 没声明的 id，漏配必须显形（仍只读）。
const warns = []
const bad = await syncModels({
  origin: ORIGIN, profilePath: PROFILE, routes: [...routes, '__ghost_provider__'], dryRun: true,
  logger: { warn: (m) => warns.push(m), info: () => {} },
})
const ghost = bad.skipped.filter((s) => s.provider === '__ghost_provider__' && s.reason === 'provider-not-declared-in-llm-pi-ai')
console.log('CHECK-B ghost_visible=' + (ghost.length === 1)
  + ' warned=' + warns.some((m) => m.includes('__ghost_provider__'))
  + ' ghost_not_owned=' + !bad.owned.includes('__ghost_provider__'))

// 4) 顺带确认 GUI 数据源没被这次改动破坏（trae 仍是上一轮 apply 的 56 个前缀模型）。
try {
  const r = await fetch(GUI + '/api/model-selector-config/providers', { signal: AbortSignal.timeout(5000) })
  const body = await r.json()
  const grp = Array.isArray(body.groups) ? body.groups.find((g) => g.provider === 'trae2api-hub') : null
  const mc = grp && grp.models ? grp.models.length : -1
  const colons = grp && grp.models ? grp.models.filter((m) => String(m.id).includes(':')).length : -1
  console.log('CHECK-C gui_http=' + r.status + ' trae_models=' + mc + ' prefixed=' + colons)
} catch (e) {
  console.log('CHECK-C SKIP ' + String((e && e.message) || e))
}
