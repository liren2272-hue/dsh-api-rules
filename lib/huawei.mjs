/**
 * 华为云 CodeArts（SnapAccess）传输与模型发现。
 *
 * 这一层把 codearts2api 的 `vendor_guard/transport.py` 与 `legacy-python/server.py`
 * 的「签名 + 模型发现」逻辑逐字节地搬到了 DSH 这一侧——这样插件启动即直连华为云，
 * 不再需要 8787 那个 Python 网关注程。
 *
 * **算法权威**：`transport.py` 的 `CodeArtsTransport.headers`（永久 AK/SK 的
 * SDK-HMAC-SHA256）与 `signed_request`（GET 模型发现的查询串签名）。本文件与其保持
 * 完全一致：规范化头的白名单、字典序、必须以 `/` 结尾的 canonical_uri、SHA256 的
 * hex 摘要、以及 `Agent-Type` 头**不参与签名**只作必填身份头。
 *
 * 注意：华为「果办 OfficeAce」走的是另一套 `x-auth-token + refresh_token` 临时凭证流
 * （见 dsh-huawei-connect 的 sign.mjs），与这里的永久 AK/SK 完全不同——本文件只服务
 * 码道（CodeArts）。
 *
 * @module dsh-api-rules/huawei
 */

import { createHmac, createHash } from 'node:crypto'
import { URL } from 'node:url'

/** 码道聊天主站。netloc 即签名头里的 `host`。 */
export const CODEARTS_BASE_URL = 'https://snap-access.cn-north-4.myhuaweicloud.com'

/** 聊天接口路径（不含域名）。POST 时拼接在 upstream 之后。 */
export const CODEARTS_CHAT_PATH = '/api/v2/chat/completions'

/** 聊天 upstream 基址：proxy 会在后面拼 `/chat/completions`。 */
export const CODEARTS_CHAT_BASE = CODEARTS_BASE_URL + '/api/v2'

/** AgentCenter：当前账号可用的「老套餐」模型（基础签名即可）。 */
const AGENT_LIST_URL = CODEARTS_BASE_URL + '/v1/agent-center/agents/useragents?offset=0&limit=100'
const AGENT_DETAIL_PATH = '/v1/agent-center/agents/detail'

/** opengw 免费额度网关：动态发现免费模型（需带 maas_type/model-id 三件套签名）。 */
const OPENGW_BASE = 'https://opengw.developer.huaweicloud.com'
const OPENGW_CONFIG_URL = OPENGW_BASE + '/api/v1/gateway/config'

/** AgentCenter 同步失败时的兜底（server.py 同款）。 */
const FALLBACK_AGENT_MODELS = ['openpangu-2.0-pro', 'openpangu-2.0-flash', 'GLM-5.2']

/** 免费模型兜底（opengw 同步失败时）。 */
const BENEFIT_MODELS = ['glm-5.3-flash', 'deepseek-v4-pro-0813', 'deepseek-v4-flash-0731']

/** 码道要求的固定身份头（缺失报 TM.00001001）；与 transport.py 的缺省一致。 */
export const CODEARTS_AGENT_TYPE = 'PromptCenter'

// ---------------------------------------------------------------------------
// 签名原语
// ---------------------------------------------------------------------------

function utcSdkDate(now) {
  // now 可选：仅测试注入用（跨语言 KAT 需要两边用同一时刻）。
  const d = now === undefined ? new Date() : new Date(now)
  const p = (n, len = 2) => String(n).padStart(len, '0')
  return (
    String(d.getUTCFullYear()) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    'T' +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    'Z'
  )
}

function sha256Hex(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8')
  return createHash('sha256').update(buffer).digest('hex')
}

function hmacSha256Hex(secret, message) {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

/**
 * Python `urllib.parse.quote(string, safe='-_.~')` 的等价实现。
 * 只对非（字母数字 + safe）的字节做 `%XX` 大写转义，多字节 UTF-8 逐字节处理。
 */
function quote(value, safe = '-_.~') {
  const bytes = Buffer.from(String(value), 'utf8')
  let out = ''
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte)
    const isUnreserved = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
    if (isUnreserved || safe.includes(ch)) {
      out += ch
    } else {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return out
}

/**
 * 构造聊天 POST 的 SDK-HMAC-SHA256 签名头（对齐 transport.py `headers`）。
 *
 * @param {{ak:string, sk:string}} cred
 * @param {Buffer|string} body  已序列化的请求体（签名要对它求 SHA256）
 * @param {{benefit?:boolean, modelId?:string, agentType?:string, baseUrl?:string}} opts
 * @returns {Record<string,string>}
 */
export function signChatHeaders(cred, body, opts = {}) {
  const ak = String(cred?.ak ?? '').trim()
  const sk = String(cred?.sk ?? '').trim()
  const baseUrl = (opts.baseUrl || CODEARTS_BASE_URL).replace(/\/+$/u, '')
  const sdkDate = utcSdkDate(opts.now)
  const host = new URL(baseUrl).host

  const signed = {
    host,
    'content-type': 'application/json',
    'x-sdk-date': sdkDate,
  }
  // transport.py 用的是下划线 maas_type（不是连字符），逐字节对齐。
  if (opts.benefit && opts.modelId) {
    signed['maas_type'] = 'benefit'
    signed['model-id'] = opts.modelId
    signed['model-name'] = opts.modelId
  }

  const names = Object.keys(signed).sort()
  const canonicalHeaders = names.map((k) => `${k}:${signed[k].trim()}\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalUri = CODEARTS_CHAT_PATH + '/'
  const payloadHash = sha256Hex(body)
  const canonicalRequest = `POST\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const stringToSign = `SDK-HMAC-SHA256\n${sdkDate}\n${sha256Hex(canonicalRequest)}`
  const signature = hmacSha256Hex(sk, stringToSign)

  const result = { ...signed }
  result['Authorization'] = `SDK-HMAC-SHA256 Access=${ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  if (opts.agentType) result['Agent-Type'] = opts.agentType
  // Node fetch 会自己设置 host（且禁止手动覆盖），但从签名里剔除即可——规范头仍含 host。
  delete result['host']
  return result
}

/**
 * 构造一次 GET（模型发现）的签名头并返回可直接用于 fetch 的 headers。
 * 对齐 transport.py `signed_request`：规范化查询串参与签名，authorization 头名小写。
 *
 * 注意：Node 的 fetch 不允许手动设置 `host`（会由 URL 自动决定，且与 netloc 恒等），
 * 所以返回给 fetch 的 headers 里**剔除 host**，但签名仍按 host 计算。
 */
export async function signedGet(cred, url, extraHeaders = {}, opts = {}) {
  const ak = String(cred?.ak ?? '').trim()
  const sk = String(cred?.sk ?? '').trim()
  const parsed = new URL(url)
  const canonicalUri = parsed.pathname.endsWith('/') ? parsed.pathname : parsed.pathname + '/'
  let canonicalQuery = ''
  if (parsed.search.length > 1) {
    const params = [...new URLSearchParams(parsed.search)].sort((a, b) =>
      a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1,
    )
    canonicalQuery = params.map(([k, v]) => `${quote(k)}=${quote(v)}`).join('&')
  }

  const headers = {}
  for (const [k, v] of Object.entries(extraHeaders)) headers[k.toLowerCase()] = v
  headers['host'] = parsed.host
  headers['content-type'] = headers['content-type'] || 'application/json'
  headers['x-sdk-date'] = utcSdkDate(opts.now)

  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((k) => `${k}:${headers[k].trim()}\n`).join('')
  const signedHeaders = names.join(';')
  const payloadHash = sha256Hex('')
  const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const stringToSign = `SDK-HMAC-SHA256\n${headers['x-sdk-date']}\n${sha256Hex(canonicalRequest)}`
  const signature = hmacSha256Hex(sk, stringToSign)
  headers['authorization'] = `SDK-HMAC-SHA256 Access=${ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  // 交给 fetch 时去掉 host（Node 禁止手动设置），保留其余（含 agent-type / x-language / accept）。
  const fetchHeaders = { ...headers }
  delete fetchHeaders.host
  return fetchHeaders
}

// ---------------------------------------------------------------------------
// 模型发现（对齐 server.py _refresh_models + _refresh_benefit_models）
// ---------------------------------------------------------------------------

async function fetchAgentModels(cred) {
  const listHeaders = await signedGet(cred, AGENT_LIST_URL, {
    'agent-type': 'AgentCenter',
    'x-language': 'zh-cn',
    accept: 'application/json',
  })
  const listResp = await fetch(AGENT_LIST_URL, { method: 'GET', headers: listHeaders, signal: AbortSignal.timeout(30_000) })
  if (!listResp.ok) throw new Error('agent-center list ' + listResp.status)
  const data = await listResp.json()
  const agents = Array.isArray(data?.agents) ? data.agents : []
  if (agents.length === 0) return []

  const candidates = [...agents].sort((a, b) => {
    const pa = a.is_primary_agent === true ? 0 : 1
    const pb = b.is_primary_agent === true ? 0 : 1
    if (pa !== pb) return pa - pb
    const oa = a.agent_order === undefined || a.agent_order === null ? Number.MAX_SAFE_INTEGER : a.agent_order
    const ob = b.agent_order === undefined || b.agent_order === null ? Number.MAX_SAFE_INTEGER : b.agent_order
    return oa - ob
  })

  const discovered = []
  for (const agent of candidates) {
    const agentId = agent.agent_id
    if (!agentId) continue
    const detailUrl = CODEARTS_BASE_URL + AGENT_DETAIL_PATH + '?agent_id=' + quote(String(agentId), '')
    const detailHeaders = await signedGet(cred, detailUrl, {
      'agent-type': 'AgentCenter',
      'x-language': 'zh-cn',
      accept: 'application/json',
    })
    let detailResp
    try {
      detailResp = await fetch(detailUrl, { method: 'GET', headers: detailHeaders, signal: AbortSignal.timeout(30_000) })
    } catch {
      continue
    }
    if (detailResp.status !== 200) continue
    let detail
    try {
      detail = await detailResp.json()
    } catch {
      continue
    }
    const models = detail?.gpts?.models ?? []
    for (const model of models) {
      const modelId = model.model_id || model.model_alias
      if (!modelId || discovered.some((item) => item.id === modelId)) continue
      const params = model.model_parameters ?? {}
      discovered.push({
        id: modelId,
        object: 'model',
        owned_by: 'codearts',
        channel: 'agent',
        name: model.model_alias || model.model_name || modelId,
        description: model.model_desc || '',
        context_window: params.context_window,
        max_tokens: params.max_tokens,
        supports_images: params.supports_images === true,
        enable_queue: params.enable_queue === true,
      })
    }
    if (discovered.length > 0) break // 主 Agent 已拿到完整列表，避免不必要请求
  }
  return discovered
}

async function fetchBenefitModels(cred) {
  const headers = await signedGet(cred, OPENGW_CONFIG_URL)
  const resp = await fetch(OPENGW_CONFIG_URL, { method: 'GET', headers, signal: AbortSignal.timeout(30_000) })
  if (!resp.ok) throw new Error('opengw config ' + resp.status)
  const result = (await resp.json())?.result ?? {}
  const models = Array.isArray(result?.models) ? result.models : []
  const discovered = []
  for (const model of models) {
    const modelId = model.model_id
    if (!modelId || discovered.some((item) => item.id === modelId)) continue
    discovered.push({
      id: modelId,
      object: 'model',
      owned_by: 'codearts',
      channel: 'benefit',
      name: model.model_name || modelId,
      description: '免费额度模型（签到领取）',
      context_window: model.context_window,
      max_tokens: model.max_tokens,
      supports_images: false,
    })
  }
  return discovered
}

/**
 * 一次性发现全部模型：AgentCenter（agent 通道）+ opengw（benefit 通道），并合并兜底。
 *
 * @param {{ak:string, sk:string}} cred
 * @returns {Promise<{models:Array, agentModels:string[], fallbackUsed:boolean}>}
 */
export async function discoverModels(cred) {
  let agentModels = []
  let fallbackUsed = false
  try {
    agentModels = await fetchAgentModels(cred)
  } catch {
    agentModels = []
  }
  if (agentModels.length === 0) {
    fallbackUsed = true
    agentModels = FALLBACK_AGENT_MODELS.map((id) => ({
      id,
      object: 'model',
      owned_by: 'codearts',
      channel: 'agent',
      name: id,
      description: '',
      supports_images: false,
    }))
  }

  let benefitModels = []
  try {
    benefitModels = await fetchBenefitModels(cred)
  } catch {
    benefitModels = []
  }
  if (benefitModels.length === 0) {
    benefitModels = BENEFIT_MODELS.map((id) => ({
      id,
      object: 'model',
      owned_by: 'codearts',
      channel: 'benefit',
      name: id,
      description: '免费额度模型（签到领取）',
      supports_images: false,
    }))
  }

  const byId = new Map()
  for (const item of agentModels) byId.set(item.id, item)
  for (const item of benefitModels) if (!byId.has(item.id)) byId.set(item.id, item)

  return {
    models: [...byId.values()],
    agentModels: agentModels.map((item) => item.id),
    fallbackUsed,
  }
}

/**
 * 把发现到的模型包装成 OpenAI `/v1/models` 能力元数据（对齐 server.py `_model_payload`）。
 */
export function toOpenAiModel(model) {
  const supportsImages = model.supports_images === true
  const payload = {
    id: model.id,
    object: 'model',
    created: 0,
    owned_by: model.owned_by || 'codearts',
    name: model.name || model.id,
    description: model.description || '',
    context_window: model.context_window,
    context_length: model.context_window,
    max_tokens: model.max_tokens,
    max_output_tokens: model.max_tokens,
    supports_images: supportsImages,
    vision: supportsImages,
    supports_vision: supportsImages,
    supports_function_calling: true,
    supports_tool_calling: true,
    supports_reasoning: true,
    input_modalities: supportsImages ? ['text', 'image'] : ['text'],
    output_modalities: ['text'],
  }
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined && v !== null))
}
