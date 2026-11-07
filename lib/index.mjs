/**
 * dsh-api-rules —— API 规则前置层（内置网关）。
 *
 * ## 它做什么
 *
 * DSH 启动时，本插件在回环端口（默认 8788）上起一个 OpenAI 兼容端点。DSH 的
 * provider（pi-ai 那一侧）把 baseURL 指到这里；本层按配置的**规则包**加工请求，
 * 再转发给真正的上游。
 *
 *     DSH → 8788（本插件：规则）→ 上游
 *
 * 对于 `signer: huawei` 的路由，本插件**自带网关**：直接对华为云做 SDK-HMAC-SHA256
 * 签名与模型发现，不再依赖 8787 那个 Python 进程。AK/SK 由「Codearts账号」设置卡片
 * 填入，存在本插件的文件存储里（与上游客户端目录完全隔离）。
 *
 * ## 为什么规则要放在 DSH 这一侧
 *
 * 放在代理进程里，只有「启动那个代理的客户端」受约束；DSH 自己发的标题生成、
 * 压缩摘要、子代理请求都会绕过它。放在 DSH 进程内，**任何**走 DSH 的请求都受约束。
 *
 * ## 扩展点（用户的核心要求）
 *
 * 接一个新 API = 在 config.routes 里加一条，`rules` 指向一个规则包名，`signer` 指向
 * 一个签名器名（或留空走通用透传）。规则包有两条来路：本插件的 `lib/rules/<name>.mjs`
 * （内置 `codearts`、`generic`），或别的插件运行时通过 `ctx.apiRules.register(...)` 注入。
 * 签名器同理：未来接别的「需要自己签名的 API」只要写一个 signer 挂到 signers 注册表。
 *
 * @module dsh-api-rules
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createProxy, normalizeRoute } from './proxy.mjs'
import { RuleRegistry } from './registry.mjs'
import { codeartsRules } from './rules/codearts.mjs'
import { genericRules } from './rules/generic.mjs'
import { clineRules } from './rules/cline.mjs'
import { raccoonRules } from './rules/raccoon.mjs'
import { loomyRules } from './rules/loomy.mjs'
import { qoderRules } from './rules/qoder.mjs'
import { officeaceRules } from './rules/officeace.mjs'
import {
  signChatHeaders,
  discoverModels,
  toOpenAiModel,
  CODEARTS_CHAT_BASE,
  CODEARTS_AGENT_TYPE,
} from './huawei.mjs'
import { ensureBearerReference } from './seed.mjs'

/** 默认端口。 */
const DEFAULT_PORT = 8788

const DEFAULTS = {
  port: DEFAULT_PORT,
  /**
   * 是否允许在启动时自动拉起带 `launch` 的上游进程（如 cline2api）。
   * 设为 false 可彻底关闭自动拉起（用户想自己手动管进程时）。
   */
  autoLaunch: true,
  /**
   * 路由表。空表 = 什么都不转发（只留 /health），这是有意的默认：
   * 一个装了却没配的插件不应该偷偷代理任何流量。
   */
  routes: [],
}

/**
 * 本插件的落盘位置（与 dsh-huawei-connect 一致地落在 $DSH_HOME 下，不碰上游客户端目录）。
 */
function dshHome(env = process.env) {
  const explicit = env['DSH_HOME']
  if (explicit !== undefined && explicit.trim() !== '') return explicit.trim()
  return join(homedir(), '.dsh')
}

function pluginHome(env = process.env) {
  return join(dshHome(env), '.api-rules')
}

function accountPath(env = process.env) {
  return join(pluginHome(env), 'accounts.json')
}

export const name = 'dsh-api-rules'

/**
 * 不注入任何必需服务：本插件不注册 provider（沿用 pi-ai 现有的那条），只在有 `llm` 时
 * 顺手读一下模型元数据。Cordis 的 inject 数组语义是「必需依赖，缺了就不装载」，
 * 把这些写成 inject 会让插件在 llm 还没就绪时被整体推迟——所以一律走 `ctx.get()`。
 */
export const inject = []

/**
 * 账号存储：把每个路由的 AK/SK 存进本插件的 accounts.json。
 *
 * 之所以自己写文件而不是用 `credentials` 服务：本插件是本地规则层，不沿 DSH 的
 * 跨会话/跨设备凭证链共享这些密钥；写一份隔离的文件，卸载插件即可彻底清除。
 */
/**
 * 只保留末 4 位的掩码，用于在卡片上确认"改没改对"，但不泄露整段密钥。
 * 过短的串（<= 4 位）整段打码。
 */
function maskTail(value) {
  const s = typeof value === 'string' ? value : ''
  if (s === '') return ''
  return s.length <= 4 ? '*'.repeat(s.length) : '*'.repeat(s.length - 4) + s.slice(-4)
}

/**
 * 账号文件里允许的凭据字段。
 *
 * `ak`/`sk` 给签名器路由（codearts），`baseUrl`/`authorization` 给自带凭据的透传路由
 * （officeace：地址与 `Authorization: Basic <AK:SK>` 由卡片填，插件直连网关，
 * 因此不需要 officeace2api 那个常驻进程）。
 */
const CREDENTIAL_FIELDS = ['ak', 'sk', 'baseUrl', 'authorization']

const accountStore = {
  async read(routeId) {
    try {
      const p = accountPath()
      const raw = await readFile(p, 'utf8')
      const map = JSON.parse(raw)
      const entry = map[routeId]
      if (entry === null || typeof entry !== 'object') return undefined
      // 两种凭据形态都认：
      //  - 签名器路由（codearts）：{ ak, sk }
      //  - 自带凭据路由（officeace 直连）：{ baseUrl, authorization }
      const hasKeys = typeof entry.ak === 'string' && typeof entry.sk === 'string'
      const hasEndpoint = typeof entry.baseUrl === 'string' && entry.baseUrl.trim() !== ''
      if (hasKeys || hasEndpoint) return entry
    } catch {
      /* 文件不存在或损坏都按未配置处理 */
    }
    return undefined
  },
  /**
   * 写一条路由的凭据。
   *
   * 只覆盖本次真的给了值的字段：卡片对已保存的密文是「留空表示不更改」，
   * 所以这里必须是合并语义，而不是整条替换（authorization 是长串密钥，
   * 每次保存都要求重贴会让人不敢改别的字段）。
   */
  async write(routeId, fields) {
    const home = pluginHome()
    await mkdir(home, { recursive: true }).catch(() => {})
    const path = accountPath()
    let map = {}
    try {
      map = JSON.parse(await readFile(path, 'utf8'))
    } catch {
      map = {}
    }
    const previous = map[routeId] !== null && typeof map[routeId] === 'object' ? map[routeId] : {}
    const next = { ...previous, updatedAt: Date.now() }
    for (const key of CREDENTIAL_FIELDS) {
      const value = fields?.[key]
      if (typeof value === 'string' && value.trim() !== '') next[key] = value.trim()
    }
    map[routeId] = next
    const tmp = path + '.tmp'
    await writeFile(tmp, JSON.stringify(map, null, 2), 'utf8')
    await rename(tmp, path) // 原子替换，避免半写文件
    return map[routeId]
  },
  async clear(routeId) {
    const path = accountPath()
    let map = {}
    try {
      map = JSON.parse(await readFile(path, 'utf8'))
    } catch {
      map = {}
    }
    delete map[routeId]
    const tmp = path + '.tmp'
    await writeFile(tmp, JSON.stringify(map, null, 2), 'utf8')
    await rename(tmp, path)
  },
}

export function apply(ctx, rawConfig) {
  const logger = ctx.logger
  const config = { ...DEFAULTS, ...(typeof rawConfig === 'function' ? rawConfig() : (rawConfig ?? {})) }

  /** 规则包注册表：进程内唯一，供本插件与外部插件共用。 */
  const registry = new RuleRegistry()
  registry.register(genericRules)
  registry.register(codeartsRules)
  registry.register(clineRules)
  registry.register(raccoonRules)
  registry.register(loomyRules)
  registry.register(qoderRules)
  registry.register(officeaceRules)

  /**
   * 签名器注册表：每个签名器负责「自己的 API 怎么签名 / 怎么发现模型」。
   * 目前内嵌 huawei（码道）；别的插件可经 ctx.apiRules 扩展点挂新签名器。
   */
  const signers = {
    huawei: {
      signChatHeaders, // (cred, payload, {agentType, baseUrl}) => headers
      discoverModels, // (cred) => { models, agentModels, fallbackUsed }
      toOpenAiModel, // (model) => openai model object
      agentType: CODEARTS_AGENT_TYPE,
      chatBase: CODEARTS_CHAT_BASE,
    },
  }

  /**
   * 对外暴露的服务对象。
   *
   * 别的插件拿到它就能：注册自己的规则包（`register`）、查询已注册的包（`list`）、
   * 注册自己的签名器（`registerSigner`）、读取某条路由的闸门占用（`sessions`）。
   * 这是「未来接入其他 API」的主要接口。
   */
  const service = {
    version: 2,
    register: (pack) => registry.register(pack),
    replace: (pack) => registry.replace(pack),
    list: () => registry.list(),
    has: (packName) => registry.has(packName),
    /** 扩展点：别的插件挂自己的签名器（例如新的需要自签名的 API）。 */
    registerSigner: (name, signer) => {
      signers[name] = signer
    },
    /** 运行时读到的路由 id 列表。 */
    routes: () => proxy?.routes() ?? [],
    /** 每条路由的并发槽位占用（给设置卡片用）。 */
    sessions: () => proxy?.sessions() ?? [],
    /** 前置层的监听地址；未起来时是 undefined。 */
    origin: () => {
      try {
        return proxy?.origin()
      } catch {
        return undefined
      }
    },
  }
  ctx.provide('apiRules', service)

  /**
   * 自举：补上 patch 里 `apiKeyEnv: API_RULES_BEARER` 引用的那条 DSH 凭据。
   *
   * `cordis.patch.yml` 把 codearts / officeace 注册进 llm-pi-ai 时用的是这条引用；
   * 它缺失时 pi-ai 会以 MISSING_CREDENTIAL 拒绝请求，而本插件的账号（AK/SK、
   * 网关地址 + Authorization）走的是自己隔离的 accounts.json —— 于是新机器上会
   * 出现「模型在选择器里、一发请求却报缺凭据」。这里只在缺失时写一条占位值，
   * 已有的（含环境变量、.env、用户在模型页设的）一律不动。
   *
   * 用 scoped `ctx.inject` 等 credentials 就绪，而不是把 `credentials` 加进顶层的
   * `inject` 数组 —— 后者会让整个插件被推迟装载。写失败只记一条 warn，绝不抛出
   * （边界说明见 lib/seed.mjs）。
   */
  ctx.inject(['credentials'], (credentialCtx) => {
    void ensureBearerReference(credentialCtx.credentials, { logger }).catch((error) => {
      logger?.warn?.('[api-rules] 凭据自举异常: ' + String(error?.message ?? error))
    })
  })

  /**
   * 模型元数据查询。
   *
   * 规则 1（max_tokens 钳制）和规则 3（图片降级）都要知道「这个模型能输出多少、
   * 吃不吃图」。优先问 DSH 的 llm 服务（它才是模型清单的权威），拿不到就退回配置里
   * 写的 models 数组，再拿不到就按最保守的值处理。
   */
  function modelInfoOf(routeId, modelId) {
    const route = routeConfigs.find((entry) => entry.id === routeId)
    const declared = route?.models?.find((entry) => entry.id === modelId)
    if (declared !== undefined) {
      return { maxTokens: declared.maxTokens, supportsImages: declared.supportsImages }
    }
    try {
      const info = ctx.get('llm')?.listModelsSync?.(routeId, modelId)
      if (info !== undefined && info !== null) {
        return { maxTokens: info.maxTokens, supportsImages: info.supportsImages }
      }
    } catch {
      /* llm 服务可能还没就绪；退回保守值 */
    }
    return undefined
  }

  // 在装载阶段就解析好规则包，缺失即早报。
  const routeConfigs = []
  for (const raw of Array.isArray(config.routes) ? config.routes : []) {
    let route
    try {
      route = normalizeRoute(raw)
    } catch (error) {
      logger?.warn?.('[api-rules] 忽略非法路由配置: ' + String(error))
      continue
    }
    const packs = []
    for (const packName of route.rules) {
      try {
        packs.push(registry.get(packName))
      } catch {
        logger?.warn?.('[api-rules] 路由 ' + route.id + ' 引用了未知规则包 ' + packName + '，已跳过该包')
      }
    }
    if (packs.length === 0) {
      logger?.warn?.('[api-rules] 路由 ' + route.id + ' 没有任何可用规则包，按 generic 处理')
      packs.push(registry.get('generic'))
    }
    // 签名器路由：确认签名器存在（不存在是该配置写错了，早报）。
    if (route.signer && signers[route.signer] === undefined) {
      logger?.warn?.('[api-rules] 路由 ' + route.id + ' 引用了未知签名器 ' + route.signer + '，将按无签名透传处理')
      route.signer = undefined
    }
    routeConfigs.push({ ...route, packs })
  }

  let proxy
  let shuttingDown = false

  /**
   * Host 侧 HTTP 路由：客户端「Codearts账号」卡片读写 AK/SK 落在这里。
   * 路径带插件前缀 /api/api-rules/...，避免与其它插件撞车。
   */
  ctx.inject(['webServer'], (webCtx) => {
    /**
     * 账号端点，两个路径都注册：
     * - `/api/api-rules/account`：通用形态，带 ?route=<id>，未来接别的 API 复用。
     * - `/api/api-rules/codearts-account`：客户端卡片实际在用的固定路径（route=codearts）。
     * 两个路径共享同一个 handler，行为完全一致。
     */
    const accountHandler = async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PUT' && request.method !== 'DELETE') {
        writeJson(response, 405, { error: 'method not allowed' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const routeId = url.searchParams.get('route') || 'codearts'
      try {
        if (request.method === 'GET') {
          const entry = await accountStore.read(routeId)
          // 只回「是否配置」+ 末 4 位掩码，绝不回显明文：
          // 凭证回显会让任何能打到本机回环接口的东西（含被注入的网页脚本）直接读到 AK/SK。
          // 卡片要显示的是"已保存、留空表示不改"，掩码足够让用户确认改没改对。
          writeJson(response, 200, {
            route: routeId,
            configured: Boolean(entry),
            akHint: maskTail(entry?.ak),
            skHint: maskTail(entry?.sk),
            // 自带凭据路由：网关地址不是秘密，明文回填给输入框（改起来方便）；
            // Authorization 是长串密钥，只回末 4 位掩码。
            baseUrl: typeof entry?.baseUrl === 'string' ? entry.baseUrl : '',
            authorizationHint: maskTail(entry?.authorization),
            updatedAt: entry?.updatedAt,
          })
          return
        }
        // POST 与 PUT 等价：卡片用 PUT（语义上是对单一资源 upsert），
        // 脚本/未来的调用方可能用 POST，两者都接受。
        if (request.method === 'POST' || request.method === 'PUT') {
          const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
          const route = routeConfigs.find((entry) => entry.id === routeId)
          if (route?.credentialed === true) {
            // 自带凭据路由：卡片给「网关地址 + Authorization」，插件拿它直连上游。
            const baseUrl = String(body['baseUrl'] ?? '').trim()
            const authorization = String(body['authorization'] ?? '').trim()
            if (baseUrl === '' || !/^https?:\/\//iu.test(baseUrl)) {
              writeJson(response, 400, { error: 'invalid_base_url' })
              return
            }
            // 已保存过的 Authorization 允许留空（= 不更改），否则必须给。
            const previous = await accountStore.read(routeId)
            if (authorization === '' && !previous?.authorization) {
              writeJson(response, 400, { error: 'empty_authorization' })
              return
            }
            await accountStore.write(routeId, { baseUrl, authorization })
            writeJson(response, 200, { route: routeId, configured: true })
            return
          }
          const ak = String(body['ak'] ?? '').trim()
          const sk = String(body['sk'] ?? '').trim()
          if (ak === '' || sk === '') {
            // 错误码而非硬编码中文：卡片在英文界面下不该漏出中文。
            writeJson(response, 400, { error: 'empty_credentials' })
            return
          }
          await accountStore.write(routeId, { ak, sk })
          writeJson(response, 200, { route: routeId, configured: true })
          return
        }
        // DELETE：清除该路由的账号
        await accountStore.clear(routeId)
        writeJson(response, 200, { route: routeId, configured: false })
      } catch (error) {
        writeJson(response, 500, { error: String(error) })
      }
    }

    // 已核对宿主实现（dsh-host-webserver）：match() 取的是
    // `new URL(req.url, 'http://x').pathname`，即**查询串会被剥掉**后再比对，
    // 所以 `?route=<id>` 不影响 exact 命中，卡片可以放心用同一个 path 服务多条 route。
    // 另：register 对重复 (kind, path) 直接抛错，这两个路径必须互不相同。
    /**
     * 透传路由的「是否可用」实测。
     *
     * 为什么需要：透传路由（如 officeace）**不需要**账号条目——凭据由上游进程自己管，
     * 所以 `accountStore.read()` 永远是空，卡片据此推出的 `configured: false` 会一直显示
     * 「未配置」，哪怕模型明明能跑。对这类路由，唯一有意义的状态是「上游到底通不通」，
     * 于是这里真的去打一次上游的 `/v1/models`。
     *
     * 带 TTL 缓存：卡片每 60 秒轮询一次，没必要每次都打上游；上游挂了时
     * `fetch` 走 127.0.0.1 会立刻 ECONNREFUSED，不会拖慢接口。
     */
    const PROBE_TTL_MS = 30_000
    const probeCache = new Map()

    async function probePassthrough(route) {
      const cached = probeCache.get(route.id)
      const now = Date.now()
      if (cached !== undefined && now - cached.at < PROBE_TTL_MS) return cached.value

      // 自带凭据路由：地址与鉴权头可能来自账号文件（卡片填的），探测必须用同一份——
      // 否则「卡片没填、但 patch 里的上游（如本机 7864）在跑」会错报未配置。
      const entry = route.credentialed === true ? await accountStore.read(route.id) : undefined
      const base = String(entry?.baseUrl || route.upstream || '').replace(/\/+$/u, '')
      const authorization = typeof entry?.authorization === 'string' && entry.authorization !== ''
        ? entry.authorization
        : route.apiKey ? 'Bearer ' + route.apiKey : ''
      const value = { checked: true, ok: false, models: 0, error: '' }
      if (base === '') {
        value.error = 'no_upstream'
        probeCache.set(route.id, { at: now, value })
        return value
      }
      const timeoutMs = typeof route.probeTimeoutMs === 'number' ? route.probeTimeoutMs : 2000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(base + '/models', {
          headers: authorization !== '' ? { authorization } : {},
          signal: controller.signal,
        })
        if (!res.ok) {
          value.error = 'HTTP ' + res.status
        } else {
          const body = await res.json().catch(() => null)
          const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
          value.ok = true
          value.models = list.length
          if (value.models === 0) value.error = 'empty_model_list'
        }
      } catch (error) {
        value.error = error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error)
      } finally {
        clearTimeout(timer)
      }
      probeCache.set(route.id, { at: now, value })
      return value
    }

    /** 分区列表：卡片靠它做到「新增一条 route 就多一个分区，前端零改动」。 */
    const listHandler = async (request, response) => {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      try {
        const routes = []
        for (const route of routeConfigs) {
          const entry = await accountStore.read(route.id)
          // 签名器路由要 AK/SK；自带凭据路由要「网关地址 + Authorization」；
          // 纯透传路由的凭据在上游进程里，本插件不收集。
          const needsCredential = Boolean(route.signer) || route.credentialed === true
          const declaredModels = Array.isArray(route.models) ? route.models.length : 0
          // 自带凭据路由一旦填过就不再探测上游（网关的 /models 未必开放，只会误报）；
          // 没填时才探 patch 里的回退上游，于是老配置（本机 7864）仍显示「可用」。
          let health = null
          if (!needsCredential || (route.credentialed === true && entry === undefined)) {
            health = await probePassthrough(route)
          }
          routes.push({
            id: route.id,
            label:
              route.id === 'codearts'
                ? 'Codearts'
                : route.id === 'officeace'
                  ? 'OfficeAce'
                  : route.id === 'cline'
                    ? 'Cline (cline2api)'
                    : route.id === 'raccoon'
                      ? 'Raccoon (raccoon2api)'
                      : route.id,
            needsCredential,
            /** 卡片据此决定表单形态：'aksk' = AK/SK 两框，'endpoint' = 网关地址 + Authorization。 */
            // 自带启动拉起的纯透传路由（如 cline）：不收集任何凭据，卡片展示自动拉起说明。
            credentialKind: route.signer ? 'aksk' : route.credentialed === true ? 'endpoint' : 'managed',
            // 签名器/自带凭据路由看「有没有存过凭据」；纯透传路由看「上游通不通」——
            // 后者没有账号条目可看，用 configured=false 会永远显示「未配置」。
            configured: needsCredential ? Boolean(entry) || Boolean(health?.ok) : Boolean(health?.ok),
            akHint: maskTail(entry?.ak),
            skHint: maskTail(entry?.sk),
            baseUrl: typeof entry?.baseUrl === 'string' ? entry.baseUrl : '',
            authorizationHint: maskTail(entry?.authorization),
            /** 设置卡片上「打开登录面板」按钮指向的地址（如 officeace2api :7864、cline2api :3457 管理后台）。 */
            adminUrl: typeof route.adminUrl === 'string' && route.adminUrl !== '' ? route.adminUrl : '',
            /**
             * 该路由的上游进程是否由本插件拉起（patch 里配了 launch）。
             *
             * 光看 credentialKind 分不出来：officeace 与 cline 都是 'managed'，
             * 但 officeace2api 是用户自己起的、cline2api 是插件自动起的，卡片文案必须不同。
             */
            autoLaunched: route.launch !== undefined,
            updatedAt: entry?.updatedAt ?? null,
            models: health?.ok && health.models > 0 ? health.models : declaredModels,
            health,
          })
        }
        writeJson(response, 200, { routes })
      } catch (error) {
        writeJson(response, 500, { error: String(error) })
      }
    }

    const register = (path, handler) => webCtx.webServer.register({ kind: 'exact', path, handler })
    register('/api/api-rules/accounts', listHandler)
    register('/api/api-rules/account', accountHandler)
    register('/api/api-rules/codearts-account', accountHandler)

    function writeJson(response, status, body) {
      const payload = JSON.stringify(body)
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      })
      response.end(payload)
    }

    async function readBody(request) {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      return Buffer.concat(chunks)
    }
  })

  /**
   * 启动顺序：先起监听（DSH 的 provider 立刻可用），无需再拉起任何外部进程。
   */
  ctx.effect(() => {
    if (routeConfigs.length === 0) {
      logger?.info?.('[api-rules] 没有配置任何路由，规则前置层不启动')
      return () => {}
    }
    proxy = createProxy({
      port: config.port,
      routes: routeConfigs,
      registry,
      logger,
      modelInfo: modelInfoOf,
      signers,
      /** 是否允许启动时自动拉起带 launch 的上游进程（顶层 autoLaunch 配置）。 */
      autoLaunch: config.autoLaunch !== false,
      /** 每次请求都实时取凭证：用户在卡片里改完即刻生效。 */
      getCredential: (routeId) => accountStore.read(routeId),
    })
    proxy.ready.then(
      () => logger?.info?.('[api-rules] 规则前置层监听 ' + proxy.origin() + '，路由: ' + proxy.routes().join(', ')),
      (error) => logger?.error?.('[api-rules] 规则前置层启动失败: ' + String(error)),
    )
    return () => {
      shuttingDown = true
      void proxy?.close?.()
    }
  })
}

export { createProxy, normalizeRoute } from './proxy.mjs'
export { RuleRegistry, normalizePack } from './registry.mjs'
export { SessionGate } from './gate.mjs'
export { codeartsRules } from './rules/codearts.mjs'
export { genericRules } from './rules/generic.mjs'
export { clineRules } from './rules/cline.mjs'
export { raccoonRules } from './rules/raccoon.mjs'
export { officeaceRules } from './rules/officeace.mjs'
export { qoderRules } from './rules/qoder.mjs'
