/**
 * 「启用插件时刷新可用模型」——纯 Node 实现，零第三方依赖。
 *
 * 背景：DSH 模型选择器的清单只来自 llm-pi-ai config.providers.<id>.models 的静态声明，
 * 而 profile 层按 id 整块覆盖 bundle（last-wins，非深合并）。因此要在 profile 致胜层里
 * 增删 owned provider 的 models 条目，宿主会热拾取，无需重启。
 *
 * 数据源：本插件自己的规则前置层 GET /<routeId>/v1/models（复用既有凭证 / 签名 / 发现逻辑），
 * 而不是直接打上游。这样一份代码、零新配置。
 *
 * 口径（用户 2026-11-12 拍板）：
 *   - 新模型「全部登记」：上游 /v1/models 返回的每个模型 id 都写进声明，不再用
 *     「只加安全的」过滤（那会把不带能力元数据的新模型全挡掉，用户就看不到更新）。
 *     是否适合聊天由用户在现成的模型选择器编辑器里自己挑；能力元数据缺失时补保守默认值，
 *     绝不臆造 reasoningEfforts。
 *   - 消失模型「自动移除」：声明里有、本次上游确实拉不到的，整条删除；上游清单疑似残缺时
 *     整条保护跳过，避免误删。
 *   - 上游模型 id 命名空间整体变更时（声明与发现零交集）允许整份替换，否则残缺保护会把
 *     这种迁移永远挡住。实例：trae2api-hub 从 display_name 短名换成带 realm 前缀的
 *     trae:/solo:/trae-intl:/solo-intl: config_name（vendor/trae2api/internal/server/channel.go:388）。
 *   - 只动「从本插件路由表派生、且在 llm-pi-ai 里有声明」的 provider，绝不碰 profile 独有的
 *     tongji / workbuddy / deepseek-account 等。
 *
 * 扩展性（用户 2026-11-12 追加要求：以后新增供应商别再漏）：
 *   - 「要同步哪些 provider」不再靠手写常量，运行时由 syncModels({ routes }) 从**本插件
 *     路由表 config.routes 的 id**（= index.mjs 里 live.routeConfigs）与 profile 的
 *     llm-pi-ai providers 键求交集自动派生：deriveOwnedProviders()。
 *   - 接一个上游本来就要在 cordis.patch.yml 做两步：config.routes 加一条 + llm-pi-ai
 *     providers 加同名键。做完这两步，同步器下次自动纳入，无需改任何 .mjs 常量。
 *   - 路由表里出现、但 llm-pi-ai 没声明的 id 不会被静默忽略：会以
 *     provider-not-declared-in-llm-pi-ai 记进 skipped 并 warn，便于发现漏配。
 *   - OWNED_PROVIDERS 降级为「无路由表信息时的离线 / 向后兼容兜底」，不是运行时真相源。
 *
 * 安全：保留原 EOL；写前带时间戳备份；.tmp -> rename 原子替换；写前后结构自检；
 * changed=false 绝不写盘（否则改 profile 会触发本插件 HMR 重载 -> 无限循环）。
 */
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 向后兼容 / 离线兜底：没有路由表信息（routes 未传）时用的默认 owned 清单。
 *  运行时真相源是 syncModels({ routes }) 的派生结果，不是这个数组 —— 新增供应商请改
 *  cordis.patch.yml 的 config.routes 与 llm-pi-ai providers，不要再往这里加。
 *  （保留 7 家含 trae2api-hub，供 test/ 里未传 routes 的旧脚本继续跑。） */
export const OWNED_PROVIDERS = ['codearts', 'officeace', 'cline', 'raccoon', 'loomy2api', 'minimax2api', 'trae2api-hub']

/** profile 致胜层 patch 路径：零硬编码，全靠宿主注入的环境变量。 */
export function profilePatchPath(env = process.env) {
  if (env.DSH_PROFILE_DIR) return join(env.DSH_PROFILE_DIR, 'cordis.patch.yml')
  const home = env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', env.DSH_PROFILE || 'desktop', 'cordis.patch.yml')
}

function parseId(line) {
  const m = line.match(/^ {10}- id:\s*(.+?)\s*(?:#.*)?$/)
  if (!m) return ''
  return m[1].replace(/^["']|["']$/g, '').trim()
}

function findKeyLine(lines, from, to, key) {
  // 不再把 key 拼进正则：provider id 现在可能来自 profile / 路由表，含 . + 等正则元字符，
  // 旧写法会把 'a.b' 误当通配。改成 6 空格前缀的字面比较，任意 id 都安全。
  const prefix = '      ' + String(key) + ':'
  for (let i = from; i < to; i++) {
    const line = lines[i]
    if (line === prefix || (line.startsWith(prefix) && /^\s*$/.test(line.slice(prefix.length)))) return i
  }
  return -1
}

function findModelsBlock(lines, keyLine, rangeEnd) {
  let modelsLine = -1
  for (let i = keyLine + 1; i < rangeEnd; i++) {
    // 允许 `models: # 注释` 这种手写形式（新增供应商时常这么写）。
    if (/^ {8}models:\s*(?:#.*)?$/.test(lines[i])) { modelsLine = i; break }
    // 只把「下一个同级 provider 键（6 空格）」当边界；4~5 空格的注释不再被误判成
    // 「已经走出这个 provider」，否则夹在中间的一行注释会让已有 models: 段被漏掉。
    if (/^ {6}[A-Za-z0-9._-]+:\s*$/.test(lines[i]) || /^- id: /.test(lines[i])) break
  }
  if (modelsLine < 0) {
    // 新供应商刚写好 baseURL / apiKeyEnv 等属性、还没建 models: 段：返回「待创建」结构，
    // 让 planSync/applyEdits 自动补一段 models:，而不是像旧版那样 found:false 被静默跳过
    // —— 这正是「新增供应商后模型清单一直不更新」的另一种成因。
    let insertAt = rangeEnd
    for (let i = keyLine + 1; i < rangeEnd; i++) {
      if (/^ {6}[A-Za-z0-9._-]+:\s*$/.test(lines[i]) || /^- id: /.test(lines[i])) { insertAt = i; break }
    }
    return { modelsLine: -1, needsModelsBlock: true, blockEnd: insertAt, entries: [], ids: [] }
  }
  let blockEnd = rangeEnd
  for (let i = modelsLine + 1; i < rangeEnd; i++) {
    if (/^\s*$/.test(lines[i])) continue
    const indent = (lines[i].match(/^( *)/) || ['', ''])[1].length
    if (indent <= 8) { blockEnd = i; break }
  }
  const starts = []
  for (let i = modelsLine + 1; i < blockEnd; i++) {
    if (/^ {10}- id:\s*/.test(lines[i])) starts.push(i)
  }
  const entries = starts.map((s, k) => ({
    start: s,
    end: k + 1 < starts.length ? starts[k + 1] : blockEnd,
    id: parseId(lines[s]),
  }))
  return { modelsLine, blockEnd, entries, ids: entries.map((e) => e.id) }
}

/**
 * 纯文本解析 profile patch：只在 '- id: llm-pi-ai' 到下一个顶层条目之间工作。
 * 不依赖任何 YAML 库（插件无 yaml 依赖，也不想引外部 python）。
 */
export function parseProviders(text, owned = OWNED_PROVIDERS) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let start = -1
  let end = lines.length
  let topLevelCount = 0
  for (const line of lines) if (/^- id: /.test(line)) topLevelCount++
  for (let i = 0; i < lines.length; i++) {
    if (/^- id: llm-pi-ai\s*$/.test(lines[i])) { start = i; break }
  }
  if (start < 0) {
    return { ok: false, error: 'llm-pi-ai entry not found in profile patch', eol, lines, providers: {}, topLevelCount, start, end }
  }
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- id: /.test(lines[i])) { end = i; break }
  }
  const providers = {}
  for (const key of owned) {
    const keyLine = findKeyLine(lines, start + 1, end, key)
    if (keyLine < 0) { providers[key] = { found: false }; continue }
    const block = findModelsBlock(lines, keyLine, end)
    providers[key] = block ? { found: true, keyLine, ...block } : { found: false, keyLine }
  }
  return { ok: true, eol, lines, start, end, providers, topLevelCount }
}

/**
 * 列出 profile 的 llm-pi-ai 段里声明过的所有 provider 键（6 空格缩进），去重保序。
 * 这是「声明侧」全集：既有本插件拥有的，也有 tongji / workbuddy 等别处注入的。
 */
export function listDeclaredProviders(text) {
  const lines = String(text).split(/\r?\n/)
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (/^- id: llm-pi-ai\s*$/.test(lines[i])) { start = i; break }
  }
  if (start < 0) return []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- id: /.test(lines[i])) { end = i; break }
  }
  const out = []
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^ {6}([A-Za-z0-9._-]+):\s*$/)
    if (m && out.indexOf(m[1]) < 0) out.push(m[1])
  }
  return out
}

/**
 * 运行时 owned 清单的**唯一派生点**：本插件路由表的 id ∩ profile 已声明的 provider 键。
 * 新增供应商只要在 cordis.patch.yml 的 config.routes 与 llm-pi-ai providers 各加一条，
 * 这里自动纳入，无需改任何 JS 常量。routeIds 非数组时退回离线兜底常量。
 * 返回 { owned, missing, declared }：missing = 路由表里有、但 llm-pi-ai 没声明的 id
 * （漏配，调用方会记进 skipped 并告警，不再静默忽略）。
 */
export function deriveOwnedProviders(text, routeIds) {
  const declared = listDeclaredProviders(text)
  if (!Array.isArray(routeIds)) {
    return { owned: OWNED_PROVIDERS.slice(), missing: [], declared }
  }
  const declaredSet = new Set(declared)
  const owned = []
  const missing = []
  for (const raw of routeIds) {
    // 兼容两种调用形态：syncModels 已先把 routes 归一化成 id 字符串；外部直接调用时
    // 也可能传 route 对象（取 .id）。都按字面 id 处理，绝不拼正则。
    const id = typeof raw === 'string' ? raw.trim()
      : (raw && typeof raw === 'object' && typeof raw.id === 'string' ? raw.id.trim() : '')
    if (!id || owned.indexOf(id) >= 0) continue
    if (declaredSet.has(id)) owned.push(id)
    else if (missing.indexOf(id) < 0) missing.push(id)
  }
  return { owned, missing, declared }
}

function firstFinitePositive(...vals) {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v)
  }
  return undefined
}

/** 把各家 /v1/models 的字段名归一成一份安全的最小元数据。 */
export function normalizeModel(m) {
  if (!m || typeof m !== 'object') return null
  const id = typeof m.id === 'string' ? m.id.trim() : ''
  if (!id) return null
  const nameRaw = typeof m.name === 'string' ? m.name : (typeof m.display_name === 'string' ? m.display_name : '')
  const caps = (m.capabilities && typeof m.capabilities === 'object') ? m.capabilities : {}
  const inMods = Array.isArray(m.input_modalities) ? m.input_modalities
    : (Array.isArray(caps.input_modalities) ? caps.input_modalities : null)
  const outMods = Array.isArray(m.output_modalities) ? m.output_modalities
    : (Array.isArray(caps.output_modalities) ? caps.output_modalities : null)
  const supportsImages = m.supports_images === true || m.vision === true || m.supports_vision === true
    || caps.vision === true || m.supportsImages === true
    || (Array.isArray(inMods) && inMods.includes('image'))
  // 幂等：既接受上游原始 payload（snake_case），也接受已归一化过的对象（camelCase）。
  return {
    id,
    name: nameRaw.trim(),
    contextWindow: firstFinitePositive(m.context_window, m.context_length, m.contextWindow),
    maxTokens: firstFinitePositive(m.max_tokens, m.max_output_tokens, m.maxTokens),
    supportsImages,
    outModalities: Array.isArray(outMods) ? outMods : (Array.isArray(m.outModalities) ? m.outModalities : null),
  }
}

/**
 * 是否登记进模型声明。
 * 用户口径：上游返回的模型全部登记，是否适合聊天交给模型选择器编辑器判断；
 * 这里只挡掉连 id 都没有的脏数据。能力元数据缺失由 buildEntryLines 补默认值。
 */
export function isAddable(m) {
  return Boolean(m && m.id)
}

async function fetchOne(origin, id, timeoutMs) {
  const url = origin.replace(/\/+$/, '') + '/' + encodeURIComponent(id) + '/v1/models'
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer api-rules-model-sync' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const body = await res.json()
  const arr = Array.isArray(body && body.data) ? body.data : []
  return {
    ok: true,
    fallback: Boolean(body && body._apiRulesFallback === true),
    models: arr.map(normalizeModel).filter(Boolean),
  }
}

/** 逐条 GET 本插件规则前置层的 /<id>/v1/models；单条失败不影响其它 provider。 */
export async function discoverAll({ origin, owned = OWNED_PROVIDERS, timeoutMs = 7000 } = {}) {
  if (!origin) throw new Error('proxy origin is unavailable')
  const out = {}
  await Promise.all(owned.map(async (id) => {
    try {
      out[id] = await fetchOne(origin, id, timeoutMs)
    } catch (error) {
      out[id] = { ok: false, fallback: false, models: [], error: String((error && error.message) || error) }
    }
  }))
  return out
}

/**
 * 算计划。discovered 全量 id 集合用于 prune 与 add（都不再按能力元数据过滤，全部登记）。
 * 上游异常（ok=false / fallback / 空列表 / 清单疑似残缺）整条跳过，保证幂等与安全。
 */
export function planSync(parsed, discovered, owned = OWNED_PROVIDERS) {
  const added = []
  const removed = []
  const skipped = []
  const guarded = []
  const edits = []
  for (const key of owned) {
    const p = parsed.providers[key]
    if (!p || !p.found) { skipped.push({ provider: key, reason: 'provider-or-models-block-not-found' }); continue }
    const d = discovered[key]
    if (!d || !d.ok || d.fallback || d.models.length === 0) {
      const why = !d ? 'no-discovery-result'
        : (!d.ok ? 'discovery-failed:' + (d.error || '')
          : (d.fallback ? 'upstream-fallback' : 'empty-model-list'))
      skipped.push({ provider: key, reason: why })
      continue
    }
    const declared = p.ids.slice()
    const declaredSet = new Set(declared)
    const discoveredSet = new Set(d.models.map((m) => m.id))
    const addMap = new Map()
    for (const m of d.models) {
      if (!declaredSet.has(m.id) && isAddable(m) && !addMap.has(m.id)) addMap.set(m.id, m)
    }
    const addModels = [...addMap.values()]
    const toRemoveIds = declared.filter((x) => !discoveredSet.has(x))
    // 上游清单疑似残缺（发现数不到声明一半，或缺失过半）时整条跳过：
    // 此时 add 与 remove 都不可信；整条 skip 还保证幂等（声明不变 -> 下次判定一致）。
    //
    // 例外：声明与上游 id **零交集**、且上游数量不少于声明数量 —— 这不是「残缺」，
    // 而是上游整体换了模型 id 命名空间（实例：trae2api-hub 从 display_name 短名换成
    // 带 realm 前缀的 trae:/solo:/trae-intl:/solo-intl: config_name，
    // 见 vendor/trae2api/internal/server/channel.go:388）。此时旧 id 全部失效，必须允许
    // 整份替换，否则残缺保护会把它永远挡住、同步永不生效。数量下限保证上游临时返回
    // 一份残缺且无关的清单不会误触发。替换后下一轮零交集不成立，幂等恢复 changed=false。
    const namespaceChanged = declared.length > 0
      && declared.every((x) => !discoveredSet.has(x))
      && discoveredSet.size >= declared.length
    const looksPartial = discoveredSet.size * 2 < declared.length
      || toRemoveIds.length * 2 > declared.length
    if (looksPartial && !namespaceChanged) {
      guarded.push({ provider: key, reason: 'upstream-list-looks-partial '
        + discoveredSet.size + '/' + declared.length + ' discovered, ' + toRemoveIds.length + ' missing' })
      continue
    }
    const removeIds = toRemoveIds
    for (const m of addModels) added.push({ provider: key, id: m.id })
    for (const id of removeIds) removed.push({ provider: key, id })
    if (addModels.length || removeIds.length) {
      edits.push({
        provider: key,
        add: addModels,
        remove: new Set(removeIds),
        modelsLine: p.modelsLine,
        blockEnd: p.blockEnd,
        entries: p.entries,
      })
    }
  }
  return { added, removed, skipped, guarded, edits }
}

function yamlScalar(v) {
  const s = String(v)
  if (/^[A-Za-z0-9._@/+-]+$/.test(s)) return s
  return JSON.stringify(s)
}

// 上游 /v1/models 大多不返回能力元数据；给缺失项补保守默认值，保证 pi-ai 能正常加载
// 这条声明（缺 maxTokens 会被当成不可用）。有真实元数据时以真实值优先。
const DEFAULT_CONTEXT_WINDOW = 128000
const DEFAULT_MAX_TOKENS = 65536

/** 写最小声明：真实元数据优先、缺失补默认值；绝不写 reasoningEfforts（凭 /models 猜会抛错）。 */
export function buildEntryLines(m) {
  const lines = ['          - id: ' + yamlScalar(m.id)]
  if (m.name && m.name !== m.id) lines.push('            name: ' + yamlScalar(m.name))
  lines.push('            contextWindow: ' + (m.contextWindow ?? DEFAULT_CONTEXT_WINDOW))
  lines.push('            maxTokens: ' + (m.maxTokens ?? DEFAULT_MAX_TOKENS))
  if (m.supportsImages) {
    lines.push('            input:')
    lines.push('              - text')
    lines.push('              - image')
  }
  return lines
}

/** 从后往前 splice：先删除整条条目（含其注释），再把新条目追加到 models 段末尾。
 *  e.modelsLine < 0 表示这个 provider 还没有 models: 段，直接整段新建。 */
export function applyEdits(parsed, edits) {
  const lines = parsed.lines.slice()
  // 按 blockEnd 倒序：无论「改已有段」还是「新建段」，都从文件靠后的位置先动手，
  // 前面尚未处理的行号才不会被先前的 splice 挪动。
  const ordered = edits.slice().sort((a, b) => b.blockEnd - a.blockEnd)
  for (const e of ordered) {
    if (e.modelsLine < 0) {
      const addLines = ['        models:']
      for (const m of e.add) addLines.push(...buildEntryLines(m))
      lines.splice(e.blockEnd, 0, ...addLines)
      continue
    }
    const ranges = e.entries.filter((en) => e.remove.has(en.id)).sort((a, b) => b.start - a.start)
    let removedLines = 0
    for (const r of ranges) {
      lines.splice(r.start, r.end - r.start)
      removedLines += r.end - r.start
    }
    const insertAt = e.blockEnd - removedLines
    const addLines = []
    for (const m of e.add) addLines.push(...buildEntryLines(m))
    if (addLines.length) lines.splice(insertAt, 0, ...addLines)
  }
  return lines
}

function providerIdsSnapshot(text) {
  const base = parseProviders(text, [])
  if (!base.ok) return {}
  const keys = []
  for (let i = base.start + 1; i < base.end; i++) {
    const m = base.lines[i].match(/^ {6}([A-Za-z0-9._-]+):\s*$/)
    if (m && keys.indexOf(m[1]) < 0) keys.push(m[1])
  }
  const snap = {}
  for (const k of keys) {
    const p = parseProviders(text, [k])
    snap[k] = (p.ok && p.providers[k] && p.providers[k].found) ? p.providers[k].ids.slice() : null
  }
  return snap
}

function verifyWrite(beforeText, afterText, expectedIds, owned, expectedTopLevel) {
  const after = parseProviders(afterText, owned)
  if (!after.ok) return { ok: false, error: after.error }
  if (after.topLevelCount !== expectedTopLevel) return { ok: false, error: 'top-level entry count changed' }
  for (const key of owned) {
    const want = expectedIds[key]
    if (!want) continue
    const got = after.providers[key]
    if (!got || !got.found || got.ids.length !== want.length) {
      return { ok: false, error: key + ': entry count mismatch' }
    }
    if (got.ids.slice().sort().join('\n') !== want.slice().sort().join('\n')) {
      return { ok: false, error: key + ': id set mismatch' }
    }
  }
  // 非 owned provider（profile 独有的 tongji / workbuddy / deepseek-account 等）一个都不许变。
  const beforeAll = providerIdsSnapshot(beforeText)
  const afterAll = providerIdsSnapshot(afterText)
  const keys = new Set([...Object.keys(beforeAll), ...Object.keys(afterAll)])
  for (const k of keys) {
    if (owned.indexOf(k) >= 0) continue
    if (JSON.stringify(beforeAll[k]) !== JSON.stringify(afterAll[k])) {
      return { ok: false, error: 'non-owned provider changed: ' + k }
    }
  }
  return { ok: true }
}

/**
 * 主入口。
 * @param {Object} options
 * @param {string} options.origin 规则前置层 origin，如 http://127.0.0.1:8788
 * @param {Array<object|string>} [options.routes] 本插件路由表（config.routes / live.routeConfigs）。
 *   传了它，owned 就由「路由表 id ∩ profile 的 llm-pi-ai providers 键」自动派生，
 *   新增供应商无需改任何 JS 常量；不传才退回 OWNED_PROVIDERS 兜底（离线/向后兼容）。
 * @param {string[]} [options.owned] 显式指定 owned（离线单测用，优先于 routes）。
 * @param {boolean} [options.dryRun] 只算不写
 * @param {Function} [options.discover] 可注入的发现函数（离线单测用）
 * @returns {Promise<{ok:boolean, changed:boolean, added:Array, removed:Array, skipped:Array, guarded:Array, owned:string[], backup:string|null, at:string, dryRun:boolean, error:string|null}>}
 */
export async function syncModels(options = {}) {
  const {
    origin,
    env = process.env,
    owned: ownedOverride,
    routes,
    dryRun = false,
    logger,
    timeoutMs = 7000,
    profilePath = profilePatchPath(env),
    discover = discoverAll,
    now = () => new Date(),
  } = options
  const at = now().toISOString()
  const result = {
    ok: false, changed: false, added: [], removed: [], skipped: [], guarded: [], owned: [],
    backup: null, at, dryRun, error: null,
  }
  try {
    // 先读 profile：owned 的派生要用到「llm-pi-ai 里实际声明了哪些 provider 键」。
    const original = await readFile(profilePath, 'utf8')
    let owned
    let missing = []
    if (Array.isArray(ownedOverride)) {
      owned = ownedOverride.slice()
    } else if (Array.isArray(routes)) {
      const routeIds = routes.map((r) => (typeof r === 'string' ? r : (r && r.id))).filter(Boolean)
      const derived = deriveOwnedProviders(original, routeIds)
      owned = derived.owned
      missing = derived.missing
    } else {
      owned = OWNED_PROVIDERS.slice()
    }
    result.owned = owned.slice()
    if (missing.length) {
      // 路由表里有、但 llm-pi-ai 没声明 → 模型选择器里不会有它。旧版会静默忽略，
      // 这里明确记进 skipped 并告警，让「新供应商漏配声明」一眼可见。
      for (const id of missing) result.skipped.push({ provider: id, reason: 'provider-not-declared-in-llm-pi-ai' })
      logger?.warn?.('[api-rules] 路由表里的 provider 未在 llm-pi-ai 声明，已跳过模型同步: ' + missing.join(', '))
    }
    const rawDiscovered = await discover({ origin, owned, timeoutMs })
    // 统一再归一化一次：真实路径 fetchOne 已归一化（幂等），离线注入可直接给原始 payload。
    const discovered = {}
    for (const key of owned) {
      const d = rawDiscovered && rawDiscovered[key]
      if (!d) { discovered[key] = d; continue }
      discovered[key] = {
        ...d,
        models: (Array.isArray(d.models) ? d.models : []).map(normalizeModel).filter(Boolean),
      }
    }
    const parsed = parseProviders(original, owned)
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planSync(parsed, discovered, owned)
    result.added = plan.added
    result.removed = plan.removed
    for (const s of plan.skipped) result.skipped.push(s)
    result.guarded = plan.guarded
    if (plan.edits.length === 0) {
      result.ok = true
      return result // 无差异，绝不写盘（防 HMR 重载循环）
    }
    const expectedIds = {}
    for (const key of owned) {
      const p = parsed.providers[key]
      if (!p || !p.found) continue
      const edit = plan.edits.find((e) => e.provider === key)
      const add = edit ? edit.add.map((m) => m.id) : []
      const rem = edit ? edit.remove : new Set()
      expectedIds[key] = p.ids.filter((x) => !rem.has(x)).concat(add)
    }
    const newText = applyEdits(parsed, plan.edits).join(parsed.eol)
    const verify = verifyWrite(original, newText, expectedIds, owned, parsed.topLevelCount)
    if (!verify.ok) throw new Error('structure self-check failed: ' + verify.error)
    if (dryRun) { result.ok = true; result.changed = true; return result }
    const backup = profilePath + '.bak-modelsync-' + at.replace(/[:.]/g, '-')
    await writeFile(backup, original, 'utf8')
    const tmp = profilePath + '.tmp-modelsync-' + process.pid
    await writeFile(tmp, newText, 'utf8')
    await rename(tmp, profilePath)
    result.backup = backup
    result.changed = true
    result.ok = true
    logger?.info?.('[api-rules] 模型同步完成 +' + result.added.length + ' -' + result.removed.length
      + ' 跳过 ' + result.skipped.length + ' 保护 ' + result.guarded.length
      + '（覆盖 ' + owned.length + ' 家: ' + owned.join(',') + '）')
    return result
  } catch (error) {
    result.error = String((error && error.message) || error)
    logger?.warn?.('[api-rules] 模型同步失败（已保留原配置）: ' + result.error)
    return result
  }
}
