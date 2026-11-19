/**
 * 动态上游（extension slot）存储。
 *
 * ## 这是什么
 *
 * 用户在设置卡片上点「＋」加的 OpenAI 协议上游（baseURL + apiKey）落在这里，
 * 而不是写进 cordis.patch.yml。这样「接一个新上游」就不再需要手改两处配置
 * （config.routes + llm-pi-ai providers），卡片一次填完即可。
 *
 * 每条动态上游在运行时会被拼成两条东西：
 *
 * 1. 一条**代理路由**（喂给 proxy 的 routeConfigs）：
 *        { id, upstream: baseUrl, apiKey, rules: ['generic'], models: [] }
 *    鉴权走 `Bearer route.apiKey`（见 proxy.mjs authHeaders）——DSH 核心发来的
 *    是共享占位密钥 API_RULES_BEARER，本层转发时换成真正的 apiKey。
 *
 * 2. 一条 **llm-pi-ai provider 声明**（写进 profile 的 cordis.patch.yml，见
 *    sync-models.mjs ensureProviderBlock）：
 *        <id>: apiKeyEnv API_RULES_BEARER, api openai-completions,
 *              baseURL http://127.0.0.1:8788/<id>/v1, models: [...]
 *    这样上游才会出现在模型选择器里；models 由模型同步发现后填回。
 *
 * 换机/卸载：删掉这个文件（及 profile 里对应的 provider 块）即彻底清除，
 * 与 accounts.json 一样的隔离哲学。
 *
 * @module dsh-api-rules/upstreams
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 上游 id 允许的字符：小写字母/数字/连字符，1~48 位。 */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/

/**
 * 本插件的落盘位置（与 index.mjs 的 dshHome 一致：$DSH_HOME 优先，缺省 ~/.dsh）。
 */
function dshHome(env = process.env) {
  const explicit = env['DSH_HOME']
  if (explicit !== undefined && explicit.trim() !== '') return explicit.trim()
  return join(homedir(), '.dsh')
}

function pluginHome(env = process.env) {
  return join(dshHome(env), '.api-rules')
}

/** 动态上游文件路径。 */
export function upstreamsPath(env = process.env) {
  return join(pluginHome(env), 'upstreams.json')
}

/**
 * 只保留末 4 位的掩码（与 index.mjs maskTail 一致），用于卡片确认而不泄露整段密钥。
 */
export function maskTail(value) {
  const s = typeof value === 'string' ? value : ''
  if (s === '') return ''
  return s.length <= 4 ? '*'.repeat(s.length) : '****' + s.slice(-4)
}

/**
 * 规整一条上游：校验 id/baseUrl/apiKey，补默认 rules，返回给路由装配用的纯净对象。
 * 抛 TypeError 表示入参非法（调用方转成 HTTP 400）。
 *
 * 高级字段（goal 扩展机制：让 intern-ai 这类 passthrough + 带模型清单的路由也能表达）：
 * - passthroughAuth: true  = 透传 DSH 核心发来的 Authorization（密钥由 DSH 凭据持有，本插件不存）。
 *   此时 apiKey 可省（落一个占位值，仅供非透传调用方兜底，实际不会命中）。
 * - models: [{ id, maxTokens? }]  模型清单 + 每模型 maxTokens（原样带给 normalizeRoute）。
 * - concurrency / sessionHoldMs / timeoutMs: 数字，原样透传（与 cordis.patch.yml 路由字段同义）。
 *
 * @param {object} raw
 * @param {string} raw.id
 * @param {string} raw.baseUrl
 * @param {string} [raw.apiKey]
 * @param {string} [raw.name]
 * @param {string[]} [raw.rules]
 * @param {boolean} [raw.passthroughAuth]
 * @param {Array<{id:string,maxTokens?:number}>} [raw.models]
 * @param {number} [raw.concurrency]
 * @param {number} [raw.sessionHoldMs]
 * @param {number} [raw.timeoutMs]
 */
export function normalizeUpstream(raw) {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('upstream must be an object')
  const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : ''
  if (!ID_RE.test(id)) {
    throw new TypeError('upstream.id must match ' + ID_RE.source + ' (got ' + JSON.stringify(raw.id) + ')')
  }
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim().replace(/\/+$/u, '') : ''
  if (!/^https?:\/\//iu.test(baseUrl)) throw new TypeError('upstream.baseUrl must be an http(s) URL')
  const passthroughAuth = raw.passthroughAuth === true
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : ''
  // 透传路由的密钥由 DSH 凭据持有，本插件不存真密钥；apiKey 可省，落占位值兜底。
  if (apiKey === '' && !passthroughAuth) throw new TypeError('upstream.apiKey must be a non-empty string')
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : id
  const rules = Array.isArray(raw.rules) && raw.rules.length > 0
    ? raw.rules.filter((r) => typeof r === 'string' && r.trim() !== '')
    : ['generic']
  // 模型清单：[{ id, maxTokens? }]，只保留 id 合法的条目，原样透传给 normalizeRoute。
  const models = Array.isArray(raw.models)
    ? raw.models
        .map((m) =>
          typeof m === 'object' && m !== null && typeof m.id === 'string' && m.id.trim() !== ''
            ? {
                id: m.id.trim(),
                ...(typeof m.maxTokens === 'number' ? { maxTokens: m.maxTokens } : {}),
              }
            : null,
        )
        .filter(Boolean)
    : []
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  // 媒体能力声明（media.images / media.videos / media.audio）：模型 id 数组，告诉
  // resolveMediaRoute「哪个路由提供哪些模型的生图/生视频/语音」。缺省不写，路由就不参与媒体解析。
  // 只接受字符串数组，过滤空值与重复，最多 32 条防滥用。
  const media = sanitizeMedia(raw.media)
  // DSH 凭据引用名（apiKeyEnv）：透传上游靠它让 DSH 核心送出**真密钥**。
  // 留空则由 ensureProviderBlock 落默认占位 API_RULES_BEARER（密钥挂在本插件 route.apiKey 上）。
  const apiKeyEnv = typeof raw.apiKeyEnv === 'string' ? raw.apiKeyEnv.trim() : ''
  if (apiKeyEnv !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
    throw new TypeError('upstream.apiKeyEnv must be a credential ref name (got ' + JSON.stringify(raw.apiKeyEnv) + ')')
  }
  return {
    id,
    name,
    baseUrl,
    apiKey: apiKey !== '' ? apiKey : 'sk-passthrough-placeholder',
    rules: rules.length > 0 ? rules : ['generic'],
    ...(passthroughAuth ? { passthroughAuth: true } : {}),
    ...(apiKeyEnv !== '' ? { apiKeyEnv } : {}),
    ...(models.length > 0 ? { models } : {}),
    ...(media ? { media } : {}),
    ...(num(raw.concurrency) !== undefined ? { concurrency: num(raw.concurrency) } : {}),
    ...(num(raw.sessionHoldMs) !== undefined ? { sessionHoldMs: num(raw.sessionHoldMs) } : {}),
    ...(num(raw.timeoutMs) !== undefined ? { timeoutMs: num(raw.timeoutMs) } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
  }
}

/**
 * 规整 media 字段：{ images?: string[], videos?: string[], audio?: string[] }。
 * 只保留合法的字符串数组（去空、去重、上限 32），没有任何合法条目则返回 undefined
 * （让 upstreamToRoute 省掉这个字段，路由对象保持精简）。
 */
function sanitizeMedia(raw) {
  if (typeof raw !== 'object' || raw === null) return undefined
  const out = {}
  for (const kind of ['images', 'videos', 'audio']) {
    const list = raw[kind]
    if (!Array.isArray(list)) continue
    const cleaned = []
    for (const item of list) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (trimmed === '' || cleaned.includes(trimmed)) continue
      cleaned.push(trimmed)
      if (cleaned.length >= 32) break
    }
    if (cleaned.length > 0) out[kind] = cleaned
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 读全部动态上游，返回 { [id]: upstream }。文件缺失/损坏一律回落空表（绝不抛）。
 */
export async function readUpstreams(env = process.env) {
  const path = upstreamsPath(env)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

/**
 * 原子写全部动态上游（.tmp + rename，与 accounts.json 一致）。
 */
export async function writeUpstreams(map, env = process.env) {
  const path = upstreamsPath(env)
  await mkdir(dirnameSafe(path), { recursive: true })
  const tmp = path + '.tmp'
  await writeFile(tmp, JSON.stringify(map, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
}

function dirnameSafe(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? '.' : p.slice(0, i)
}

/**
 * 新增/覆盖一条上游，返回规整后的对象。
 */
export async function putUpstream(raw, env = process.env) {
  const upstream = normalizeUpstream(raw)
  const map = await readUpstreams(env)
  map[upstream.id] = upstream
  await writeUpstreams(map, env)
  return upstream
}

/**
 * 删除一条上游。返回是否真的删掉了（原本就不存在返回 false）。
 */
export async function deleteUpstream(id, env = process.env) {
  if (typeof id !== 'string' || id.trim() === '') return false
  const key = id.trim().toLowerCase()
  const map = await readUpstreams(env)
  if (map[key] === undefined) return false
  delete map[key]
  await writeUpstreams(map, env)
  return true
}

/**
 * 把动态上游拼成代理路由配置（喂给 normalizeRoute）。
 * upstream = 真正的上游地址；apiKey 直接挂在路由上（转发时换掉 DSH 的占位密钥）。
 * 透传路由（passthroughAuth）apiKey 是占位值，normalizeRoute 会 delete 掉、改用 DSH 原始 Authorization。
 *
 * @param {object} upstream normalizeUpstream 的产物
 */
export function upstreamToRoute(upstream) {
  const route = {
    id: upstream.id,
    upstream: upstream.baseUrl,
    apiKey: upstream.apiKey,
    rules: upstream.rules,
    models: Array.isArray(upstream.models) ? upstream.models : [],
  }
  // 高级字段：仅在存在时带上，通用上游保持精简（与静态 cordis.patch.yml 路由字段同义）。
  if (upstream.passthroughAuth === true) route.passthroughAuth = true
  // 透传上游的密钥真源在 DSH 凭据里：把引用名带进 route，provider 块据此写 apiKeyEnv
  // （不写就是占位 API_RULES_BEARER，透传上去会 401）。
  if (typeof upstream.apiKeyEnv === 'string' && upstream.apiKeyEnv !== '') route.apiKeyEnv = upstream.apiKeyEnv
  if (typeof upstream.concurrency === 'number') route.concurrency = upstream.concurrency
  if (typeof upstream.sessionHoldMs === 'number') route.sessionHoldMs = upstream.sessionHoldMs
  if (typeof upstream.timeoutMs === 'number') route.timeoutMs = upstream.timeoutMs
  // 媒体能力声明：让 resolveMediaRoute 能按模型 id 找到本路由（生图/生视频/语音）。
  if (upstream.media && typeof upstream.media === 'object' && upstream.media !== null) route.media = upstream.media
  return route
}

/**
 * 列表视图：给卡片用，apiKey 打码，绝不回传明文。
 * 透传路由不回传 key 掩码（改标 passthrough），带 models 时回传模型数量。
 */
export function maskUpstream(upstream) {
  const passthrough = upstream.passthroughAuth === true
  return {
    id: upstream.id,
    name: upstream.name,
    baseUrl: upstream.baseUrl,
    apiKeyMasked: passthrough ? 'passthrough' : maskTail(upstream.apiKey),
    rules: upstream.rules,
    ...(passthrough ? { passthroughAuth: true } : {}),
    ...(typeof upstream.apiKeyEnv === 'string' && upstream.apiKeyEnv !== '' ? { apiKeyEnv: upstream.apiKeyEnv } : {}),
    ...(Array.isArray(upstream.models) ? { models: upstream.models.length } : {}),
    // 编辑预填用：模型 id 列表（id:maxTokens），非敏感。models 仍是数量供卡片显示。
    ...(Array.isArray(upstream.models) && upstream.models.length > 0
      ? { modelIds: upstream.models.map((m) => (typeof m.maxTokens === 'number' ? m.id + ':' + m.maxTokens : m.id)) }
      : {}),
    createdAt: upstream.createdAt,
  }
}