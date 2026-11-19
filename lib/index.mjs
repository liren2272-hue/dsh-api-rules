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

import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createProxy, normalizeRoute } from './proxy.mjs'
import { RuleRegistry, normalizePack } from './registry.mjs'
import { codeartsRules } from './rules/codearts.mjs'
import { genericRules } from './rules/generic.mjs'
import { clineRules } from './rules/cline.mjs'
import { raccoonRules } from './rules/raccoon.mjs'
import { minimaxRules } from './rules/minimax2api.mjs'
import { qoderRules } from './rules/qoder.mjs'
import { officeaceRules } from './rules/officeace.mjs'
import { internAiRules } from './rules/intern-ai.mjs'
import { tongjiRules, tongjiVpnStatus } from './rules/tongji.mjs'
import {
  signChatHeaders,
  discoverModels,
  toOpenAiModel,
  CODEARTS_CHAT_BASE,
  CODEARTS_AGENT_TYPE,
} from './huawei.mjs'
import { ensureBearerReference } from './seed.mjs'
import { syncModels, ensureProviderBlock, removeProviderBlock } from './sync-models.mjs'
import {
  readUpstreams,
  writeUpstreams,
  putUpstream,
  deleteUpstream,
  upstreamToRoute,
  maskUpstream,
} from './upstreams.mjs'
import { defineMediaTool } from './media-tool.mjs'
import { defineAudioTranscribeTool } from './audio-tool.mjs'
// 同济 AIGC 专区子系统（原 dsh-tongji-aigc 整包并入）：激活时调 injectAigc(ctx) 挂载
// 9 个 DSH 工具 + 14 个卡片端点 `/api/dsh-api-rules/aigc/*`，并复用 TongjiVpn 单例。
import { injectAigc } from './aigc-legacy/index.mjs'

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
   * 每次插件启用（规则前置层监听就绪）后，自动刷新一次本机可用的模型清单。
   * 这是用户要的「启用时更新注册模型信息」：复用上游发现能力，把声明写回
   * profile 的 cordis.patch.yml（宿主会热拾取），用户再用现成的选择器编辑器微调。
   * 设 false 可彻底关闭自动同步，仍可用卡片按钮 / HTTP 端点手动触发。
   */
  syncModelsOnEnable: true,
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

/**
 * 外部规则包目录（固定扫描约定）：
 *
 *     ~/.dsh/.api-rules/rules/*.mjs
 *
 * 用户把写好的规则包丢进这个目录，插件启动时逐个 `import()`、`normalizePack`、
 * `registry.register`。改名或加删文件后重启插件即可生效（固定目录扫描方案，
 * 不做面板粘贴 / 热加载）。intern-ai 这类「直连 OpenAI 协议」的规则包就是放在这里。
 */
function rulesHome(env = process.env) {
  return join(pluginHome(env), 'rules')
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
  return s.length <= 4 ? '*'.repeat(s.length) : '****' + s.slice(-4)
}

/**
 * 账号文件里允许的凭据字段。
 *
 * `ak`/`sk` 给签名器路由（codearts），`baseUrl`/`authorization` 给自带凭据的透传路由
 * （officeace：地址与 `Authorization: Basic <AK:SK>` 由卡片填，插件直连网关，
 * 因此不需要 officeace2api 那个常驻进程）。
 */
const CREDENTIAL_FIELDS = ['ak', 'sk', 'baseUrl', 'authorization']

/**
 * 进程级的「当前活着的那个实例」。
 *
 * 2026-11-09 事故：HMR 重载时旧 fiber 的 HTTP handler 闭包会一直留在 webserver 的
 * 路由表上（原因见下面 ctx.inject 里的注释），它捕获的是旧 `routeConfigs` 与旧
 * `proxy`。于是卡片读到「6 条路由 + listening:false」，而同一时刻新 fiber 的
 * `ctx.effect` 已经把 8788 好好起起来在服务七条路由——卡片就此撒谎。
 *
 * 根因已在 inject 的 disposer 上修掉，但闭包捕获这件事本身太脆：只要还有任何一条
 * 旧 handler 存活，它就会报旧数据。所以 handler 一律不读闭包变量，改读这个模块级
 * 的 live 引用——由最近一次 apply 写入。重载后旧 handler 哪怕还在，读到的也是新的。
 */
const live = {
  /** @type {undefined | { status: () => unknown, origin: () => string }} */
  proxy: undefined,
  /** @type {Array<object>} */
  routeConfigs: [],
  /** 最近一次模型同步的摘要（accounts 端点回给卡片显示）。 */
  lastSync: null,
  /** 防止「启动同步 + 手动点击」并发写同一份 profile 配置。 */
  syncPromise: null,
  /**
   * DSH credentials 服务实例（`ctx.inject(['credentials'])` 里拿到）。
   * 用于「自动拉取模型清单」：拉上游 /v1/models 需要真密钥，而透传上游的密钥
   * 只有 DSH 凭据一处真源。未就绪时是 undefined，端点会明确回 503。
   */
  credentials: undefined,
}

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
  registry.register(minimaxRules)
  registry.register(qoderRules)
  registry.register(officeaceRules)
  registry.register(internAiRules)
  registry.register(tongjiRules)

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
    /** 监听状态快照（含最近一次监听错误）；未启动时 listening=false。 */
    status: () => live.proxy?.status?.() ?? { listening: false, port: config.port },
    /** 扩展点：别的插件/自动化也能主动触发一次模型清单刷新。 */
    syncModels: (options) => runSync(Boolean(options && options.dryRun)),
    /** 最近一次模型同步摘要（只读）。 */
    lastModelSync: () => live.lastSync,
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
    // 留一份引用给「自动拉取模型清单」用：拉上游 /v1/models 需要**真密钥**，而透传上游
    // 的密钥只有 DSH 凭据这一处真源（本插件不存）。credentials 服务是延迟就绪的，
    // 所以只能在这里拿，不能写进顶层 inject（那会推迟整个插件装载）。
    live.credentials = credentialCtx.credentials
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

  // proxy 与 shuttingDown 提到前面声明：下面的 rebuildProxy() 会引用它们，
  // 而 rebuildProxy 定义在这两个 let 之前会踩 TDZ。
  let proxy
  let shuttingDown = false
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

  /**
   * 扫描外部规则包目录（~/.dsh/.api-rules/rules/*.mjs），逐个动态 import、
   * normalizePack、注册进 registry。目录不存在 / 单个文件损坏都只记 warn，
   * 绝不让一个坏包拖垮整个前置层装载。
   *
   * 每个文件默认导出（或命名导出 `rule` / `default`）一个 RulePack；文件名不需要等于
   * pack.name（pack.name 才是路由 `rules:[...]` 里引用的名字）。
   */
  async function loadExternalRules() {
    const dir = rulesHome(process.env)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // 目录不存在是常态（用户还没放任何外部规则），静默跳过。
      return []
    }
    const loaded = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
      const file = join(dir, entry.name)
      try {
        const mod = await import(pathToFileURL(file).href)
        const pack = mod?.default ?? mod?.rule ?? mod
        if (pack === undefined || pack === null || typeof pack !== 'object') {
          logger?.warn?.('[api-rules] 外部规则包 ' + entry.name + ' 没有导出规则对象，已跳过')
          continue
        }
        const normalized = normalizePack(pack)
        registry.replace(normalized)
        loaded.push(normalized.name)
        logger?.info?.('[api-rules] 已加载外部规则包 ' + normalized.name + '（' + entry.name + '）')
      } catch (error) {
        logger?.warn?.('[api-rules] 加载外部规则包 ' + entry.name + ' 失败: ' + String(error?.message ?? error))
      }
    }
    return loaded
  }

  /**
   * 把 upstreams.json 里的动态上游路由并进 routeConfigs（走和静态路由同一套
   * normalizeRoute + 规则包解析 + 签名器校验）。返回新增的路由 id 列表。
   *
   * 动态上游 = 用户在面板「＋」里填的直连 OpenAI 协议上游：{ id, baseUrl, apiKey }，
   * 转成 { id, upstream: baseUrl, apiKey, rules, models: [] } 后交给 normalizeRoute，
   * 因此代理转发时会用 `Authorization: Bearer <apiKey>` 直连真实上游（见 proxy.authHeaders）。
   * 已存在的 id（比如和静态路由撞名）会跳过，静态路由优先。
   */
  async function mergeUpstreamRoutes() {
    const existing = new Set(routeConfigs.map((r) => r.id))
    const map = await readUpstreams(process.env)
    const added = []
    for (const upstream of Object.values(map)) {
      let raw
      try {
        raw = upstreamToRoute(upstream)
      } catch (error) {
        logger?.warn?.('[api-rules] 忽略非法动态上游 ' + upstream?.id + ': ' + String(error?.message ?? error))
        continue
      }
      if (existing.has(raw.id)) {
        logger?.warn?.('[api-rules] 动态上游 ' + raw.id + ' 与已有路由撞名，已跳过（静态路由优先）')
        continue
      }
      let route
      try {
        route = normalizeRoute(raw)
      } catch (error) {
        logger?.warn?.('[api-rules] 忽略非法动态上游配置 ' + raw.id + ': ' + String(error))
        continue
      }
      const packs = []
      for (const packName of route.rules) {
        try {
          packs.push(registry.get(packName))
        } catch {
          logger?.warn?.('[api-rules] 动态上游 ' + route.id + ' 引用了未知规则包 ' + packName + '，已跳过该包')
        }
      }
      if (packs.length === 0) packs.push(registry.get('generic'))
      if (route.signer && signers[route.signer] === undefined) route.signer = undefined
      routeConfigs.push({ ...route, packs, dynamicUpstream: true })
      existing.add(route.id)
      added.push(route.id)
    }
    return added
  }

  /**
   * 按当前 upstreams.json + 静态 config.routes 重建路由表并重启监听。
   *
   * 面板「＋」添加 / 删除动态上游后调用：先把旧监听干净关掉（避免 EADDRINUSE），
   * 再原地清空 routeConfigs 重新装配（静态路由 + 动态上游），最后 createProxy 重新
   * listen。因为 proxy 在构造时就固定了路由表，没有热加路由的口子，所以走整实例重建。
   * 正在关闭 / 还没起来时是 no-op（交给正常启动流程处理）。
   */
  async function rebuildProxy() {
    if (shuttingDown) return { ok: false, error: 'shutting_down' }
    const old = live.proxy
    if (old !== undefined) {
      if (live.proxy === old) live.proxy = undefined
      await old.close?.()
    }
    // 原地重建，保持 routeConfigs 数组引用不变（runSync / modelInfoOf 闭包都抓着它）。
    routeConfigs.length = 0
    const staticRouteIds = new Set()
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
      if (packs.length === 0) packs.push(registry.get('generic'))
      if (route.signer && signers[route.signer] === undefined) route.signer = undefined
      routeConfigs.push({ ...route, packs })
      staticRouteIds.add(route.id)
    }
    await mergeUpstreamRoutes()
    if (routeConfigs.length === 0) {
      live.routeConfigs = routeConfigs
      return { ok: true, routes: [], started: false }
    }
    proxy = createProxy({
      port: config.port,
      routes: routeConfigs,
      registry,
      logger,
      modelInfo: modelInfoOf,
      signers,
      autoLaunch: config.autoLaunch !== false,
      getCredential: (routeId) => accountStore.read(routeId),
      // 透传路由的模型发现要真密钥：按 apiKeyEnv 从 DSH 凭据实时取（本插件不存密钥）。
      resolveEnvCredential: (ref) => live.credentials?.resolve?.(ref),
    })
    live.proxy = proxy
    live.routeConfigs = routeConfigs
    return { ok: true, routes: proxy.routes(), started: true, staticRouteIds: [...staticRouteIds] }
  }

  /**
   * 跑一次模型同步：从规则前置层的 /<id>/v1/models 发现可用模型，写回 profile
   * 的 llm-pi-ai providers.<owned>.models。并发保护 + 关闭短路都在这里。
   *
   * owned 不再手写：把本轮路由表传给 syncModels，由「路由表 id ∩ llm-pi-ai 声明键」
   * 自动派生，新增供应商只要在 cordis.patch.yml 的 routes 与 providers 各加一条即可。
   * 优先用 live.routeConfigs（HMR 后指向最新一轮），装载早期还没登记时回落本轮局部表。
   */
  async function runSync(dryRun = false) {
    if (live.syncPromise) return live.syncPromise
    let origin
    try {
      origin = proxy?.origin?.()
    } catch {
      origin = undefined
    }
    if (!origin) {
      return { ok: false, changed: false, added: [], removed: [], skipped: [], guarded: [], error: 'proxy not listening' }
    }
    const task = (async () => {
      if (shuttingDown) return { ok: false, changed: false, error: 'shutting down' }
      const result = await syncModels({
        origin,
        dryRun,
        // live.routeConfigs 初始是 []（模块级兜底）。装载早期若还没登记成完整表，
        // 就回落本轮 routeConfigs，避免派生出 0 个 provider 让同步静默空跑。
        routes: (Array.isArray(live.routeConfigs) && live.routeConfigs.length > 0)
          ? live.routeConfigs : routeConfigs,
        logger,
        env: process.env,
      })
      if (shuttingDown) return result
      // 只读 dry-run 不应覆盖「上次真实启用同步」摘要，卡片会显示误导性的 0/0。
      if (!dryRun) live.lastSync = result
      return result
    })()
    live.syncPromise = task
    try {
      return await task
    } finally {
      live.syncPromise = null
    }
  }

  // 立刻登记本轮的 routeConfigs：即使下面的 effect 因为「没有配置任何路由」提前返回，
  // handler 也不能继续读上一轮的路由表。
  live.routeConfigs = routeConfigs

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

    /**
     * minimax2api 账号管理端点。
     *
     * minimax2api 的账号（MiniMax Agent JWT）只在它自己的 admin panel 里管理，
     * 插件的 proxy 只转发 /v1/* 不转发 /admin/*。这里代登录后调用 minimax2api 的
     * /admin/api/* 管理账号，让卡片能在 DSH GUI 里直接增删账号，不用另开浏览器。
     *
     * GET    /api/api-rules/minimax-account          → 列出账号
     * POST   /api/api-rules/minimax-account          → 新增账号 { token, region, name }
     * DELETE /api/api-rules/minimax-account?id=<id>  → 删除账号
     *
     * adminPassword 从 routeConfigs 读取，绝不回传给卡片。
     */
    const minimaxAccountHandler = async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'DELETE') {
        writeJson(response, 405, { error: 'method not allowed' })
        return
      }
      try {
        const route = live.routeConfigs.find((entry) => entry.id === 'minimax2api')
        if (route === undefined) {
          writeJson(response, 404, { error: 'minimax2api route not configured' })
          return
        }
        const adminBase = String(route.adminUrl ?? '').replace(/\/+$/u, '')
        if (adminBase === '' || !/^https?:\/\//iu.test(adminBase)) {
          writeJson(response, 500, { error: 'minimax2api adminUrl not set' })
          return
        }
        // adminPassword 可能被 Cordis 路由 schema 剥掉（不是已知字段），
        // 但 launch.env.MINIMAX2API_ADMIN_PASSWORD 一定在（patch.yml 里配了）。
        const adminPassword = String(route.adminPassword ?? route.launch?.env?.MINIMAX2API_ADMIN_PASSWORD ?? route.env?.MINIMAX2API_ADMIN_PASSWORD ?? '')
        if (adminPassword === '') {
          writeJson(response, 500, { error: 'minimax2api adminPassword not set' })
          return
        }

        // 代登录拿 admin session token。
        const loginRes = await fetch(adminBase + '/admin/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: adminPassword }),
        })
        if (!loginRes.ok) {
          const detail = await loginRes.text().catch(() => '')
          writeJson(response, 502, { error: 'minimax2api admin login failed: ' + loginRes.status + ' ' + detail })
          return
        }
        const { token: adminToken } = await loginRes.json()
        const adminHeaders = { Authorization: 'Bearer ' + String(adminToken) }

        if (request.method === 'GET') {
          const listRes = await fetch(adminBase + '/admin/api/accounts?page=1&pageSize=100', { headers: adminHeaders })
          if (!listRes.ok) {
            writeJson(response, 502, { error: 'minimax2api list accounts failed: ' + listRes.status })
            return
          }
          const data = await listRes.json()
          writeJson(response, 200, {
            accounts: data.items ?? [],
            summary: data.summary ?? null,
          })
          return
        }

        if (request.method === 'POST') {
          const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
          const token = String(body.token ?? '').trim()
          if (token === '') {
            writeJson(response, 400, { error: 'empty_token' })
            return
          }
          const region = String(body.region ?? '').trim()
          const name = String(body.name ?? '').trim()
          const payload = { token }
          if (region !== '') payload.region = region
          if (name !== '') payload.name = name
          const createRes = await fetch(adminBase + '/admin/api/accounts', {
            method: 'POST',
            headers: { ...adminHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!createRes.ok) {
            const detail = await createRes.text().catch(() => '')
            writeJson(response, 502, { error: 'minimax2api create account failed: ' + createRes.status + ' ' + detail })
            return
          }
          const data = await createRes.json()
          writeJson(response, 200, { account: data.account ?? data })
          return
        }

        // DELETE
        const url = new URL(request.url ?? '/', 'http://localhost')
        const accountId = url.searchParams.get('id')
        if (accountId === null || accountId === '') {
          writeJson(response, 400, { error: 'empty_id' })
          return
        }
        const delRes = await fetch(adminBase + '/admin/api/accounts/' + encodeURIComponent(accountId), {
          method: 'DELETE',
          headers: adminHeaders,
        })
        if (!delRes.ok) {
          const detail = await delRes.text().catch(() => '')
          writeJson(response, 502, { error: 'minimax2api delete account failed: ' + delRes.status + ' ' + detail })
          return
        }
        writeJson(response, 200, { ok: true, id: accountId })
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
      let authorization = typeof entry?.authorization === 'string' && entry.authorization !== ''
        ? entry.authorization
        : route.apiKey ? 'Bearer ' + route.apiKey : ''
      // 透传路由的 apiKey 是占位符；探测要用 DSH 凭据里的真密钥（与模型发现同一路径），
      // 否则健康徽章会因占位密钥 401 假红。解析失败就退回原值，不改变其它路由。
      if (route.passthroughAuth === true && typeof route.apiKeyEnv === 'string' && route.apiKeyEnv !== '') {
        try {
          const resolved = await live.credentials?.resolve?.(route.apiKeyEnv)
          const realKey = typeof resolved === 'string' ? resolved : resolved?.value
          if (typeof realKey === 'string' && realKey !== '') {
            authorization = /^Bearer\s/iu.test(realKey) ? realKey : 'Bearer ' + realKey
          }
        } catch (error) {
          logger?.debug?.('[api-rules] probe 读取凭据 ' + route.apiKeyEnv + ' 失败，退回占位: ' + String(error?.message ?? error))
        }
      }
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
    /**
     * 上游面板剩余积分抓取（面板下方显示剩余积分）。
     *
     * 按 route.id 分支打各上游面板的积分接口，带 TTL 缓存 + 超时 + 独立兜底：
     * 任何一条拉不到都只让该路由 points=null，不影响卡片其它字段。
     * codearts（直连华为云签名、无本机面板）与 cline（面板无积分端点）返回 null。
     */
    const POINTS_TTL_MS = 30_000
    const pointsCache = new Map()

    async function fetchPoints(route) {
      const cached = pointsCache.get(route.id)
      const now = Date.now()
      if (cached !== undefined && now - cached.at < POINTS_TTL_MS) return cached.value
      const value = await readPoints(route)
      // 错误结果（available 为 null，如面板瞬时异常）不缓存，避免把一次失败钉住 30s。
      if (value && value.available !== null) pointsCache.set(route.id, { at: now, value })
      return value
    }

    function pointsNum(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value)
        if (Number.isFinite(n)) return n
      }
      return null
    }

    async function pointsGet(url, headers) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      try {
        const res = await fetch(url, { headers: headers || {}, signal: controller.signal })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error('HTTP ' + res.status + (text ? ' ' + text.slice(0, 120) : ''))
        }
        return await res.json().catch(() => null)
      } finally {
        clearTimeout(timer)
      }
    }

    async function minimaxPointsHeaders(adminBase, password) {
      const res = await fetch(adminBase + '/admin/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password }),
      })
      if (!res.ok) throw new Error('minimax login HTTP ' + res.status)
      const { token } = await res.json()
      return { Authorization: 'Bearer ' + String(token) }
    }

    async function readPoints(route) {
      const id = route.id
      const base = String(route.adminUrl || '').replace(/\/+$/, '')
      const out = { available: null, permanent: null, daily: null, cn: null, intl: null, error: '' }
      if (base === '' || !/^https?:\/\//.test(base)) {
        out.error = 'no_admin_url'
        return out
      }
      try {
        if (id === 'minimax2api') {
          const password = String(route.adminPassword ?? route.launch?.env?.MINIMAX2API_ADMIN_PASSWORD ?? route.env?.MINIMAX2API_ADMIN_PASSWORD ?? '')
          if (password === '') { out.error = 'no_admin_password'; return out }
          const headers = await minimaxPointsHeaders(base, password)
          const body = await pointsGet(base + '/admin/api/accounts?page=1&pageSize=100', headers)
          const summary = body?.summary || {}
          const items = Array.isArray(body?.items) ? body.items : []
          let cnSum = 0, intlSum = 0, cnSeen = false, intlSeen = false
          for (const item of items) {
            const credit = pointsNum(item?.credit?.total)
            if (credit === null) continue
            const region = String(item?.region || '').toLowerCase()
            if (region === 'cn') { cnSum += credit; cnSeen = true }
            else if (region === 'global') { intlSum += credit; intlSeen = true }
          }
          out.available = pointsNum(summary.creditTotal)
          if (out.available === null && (cnSeen || intlSeen)) out.available = cnSum + intlSum
          out.cn = cnSeen ? cnSum : null
          out.intl = intlSeen ? intlSum : null
          if (out.available === null) out.error = 'no_credit'
        } else if (id === 'officeace') {
          const parsed = new URL(base)
          const token = parsed.searchParams.get('token') || ''
          const credits = (await pointsGet(parsed.origin + '/admin/api/state?token=' + encodeURIComponent(token), {}))?.credits || {}
          out.available = pointsNum(credits.summary?.remaining)
          if (out.available === null) out.error = 'no_credit'
        } else if (id === 'trae2api-hub') {
          const password = String(route.apiKey ?? '')
          const accounts = (await pointsGet(base + '/status', password !== '' ? { Authorization: 'Bearer ' + password } : {}))?.accounts || []
          let cnSum = 0, intlSum = 0, cnSeen = false, intlSeen = false
          for (const account of accounts) {
            const credit = pointsNum(account?.credits)
            if (credit === null) continue
            const product = String(account?.product || account?.name || '').toLowerCase()
            if (/(^|[-_])cn([-_]|$)/.test(product) || product.includes('domestic')) {
              cnSum += credit; cnSeen = true
            } else {
              intlSum += credit; intlSeen = true
            }
          }
          out.available = (cnSeen || intlSeen) ? cnSum + intlSum : null
          out.cn = cnSeen ? cnSum : null
          out.intl = intlSeen ? intlSum : null
          if (out.available === null) out.error = 'no_credit'
        } else if (id === 'raccoon') {
          const key = String(route.pointsAdminKey ?? route.launch?.env?.RACCOON_MANAGEMENT_KEY ?? route.env?.RACCOON_MANAGEMENT_KEY ?? '')
          if (key === '') { out.error = 'no_admin_key'; return out }
          // adminUrl 指向的是控制台页面，而管理 API 在服务根下的 /v0/management/...，
          // 用 origin 拼，避免把控制台子路径带进 API 地址。
          const serverOrigin = new URL(base).origin
          const accounts = (await pointsGet(serverOrigin + '/v0/management/raccoon2api/accounts', { Authorization: 'Bearer ' + key }))?.accounts || []
          let sum = 0
          let seen = false
          for (const account of accounts) {
            const v = pointsNum(account?.points_available)
            if (v !== null) { sum += v; seen = true }
          }
          out.available = seen ? sum : null
          if (!seen) out.error = 'no_credit'
        } else {
          out.error = 'no_points'
        }
      } catch (error) {
        out.error = error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error)
      }
      return out
    }

    /**
     * 账号级积分明细（composer pill 点击展开浮层用）。
     * 与 readPoints 走同一批上游端点，但把每账号一条明细返回，而非只给汇总。
     * 拿不到账号级数据或该路由无积分端点时 accounts 为空数组，前端据此隐藏「账号明细」区。
     */
    async function readDetail(route) {
      const out = { accounts: [], points: null, adminUrl: '', error: '' }
      const base = typeof route.adminUrl === 'string' && route.adminUrl !== '' ? route.adminUrl.replace(/\/$/, '') : ''
      if (!/^https?:\/\//i.test(base)) { out.error = 'no_admin_url'; return out }
      out.adminUrl = route.adminUrl
      try {
        if (route.id === 'minimax2api') {
          const password = route.adminPassword ?? route.launch?.env?.MINIMAX2API_ADMIN_PASSWORD ?? route.env?.MINIMAX2API_ADMIN_PASSWORD
          if (!password) { out.error = 'no_admin_key'; return out }
          const headers = await minimaxPointsHeaders(base, password)
          const body = await pointsGet(base + '/admin/api/accounts?page=1&pageSize=100', headers)
          out.points = summarizePoints(route.id, body?.summary, body?.items)
          for (const item of body?.items || []) {
            const credit = pointsNum(item?.credit?.total)
            if (credit !== null) {
              out.accounts.push({ name: String(item?.name ?? ''), value: credit, region: item?.region === 'cn' ? 'cn' : 'intl' })
            }
          }
        } else if (route.id === 'officeace') {
          const url = new URL(base)
          const token = url.searchParams.get('token')
          if (!token) { out.error = 'no_admin_token'; return out }
          const body = await pointsGet(url.origin + '/admin/api/state?token=' + encodeURIComponent(token))
          out.points = summarizePoints(route.id, body?.credits?.summary, body?.credits?.items)
          for (const a of body?.credits?.items || []) {
            const remaining = pointsNum(a?.remaining)
            if (remaining !== null) out.accounts.push({ name: String(a?.name ?? a?.id ?? ''), value: remaining })
          }
        } else if (route.id === 'trae2api-hub') {
          // adminUrl 指向 /admin 页面，而 /status 在服务根下，用 origin 拼避免带上子路径。
          const body = await pointsGet(new URL(base).origin + '/status', { Authorization: 'Bearer ' + (route.apiKey || '') })
          out.points = summarizePoints(route.id, null, body?.accounts)
          for (const a of body?.accounts || []) {
            const v = pointsNum(a?.credits)
            if (v !== null) out.accounts.push({ name: String(a?.name ?? a?.product ?? ''), value: v, region: isDomestic(a?.product) ? 'cn' : 'intl' })
          }
        } else if (route.id === 'raccoon') {
          const key = route.pointsAdminKey ?? route.launch?.env?.RACCOON_MANAGEMENT_KEY ?? route.env?.RACCOON_MANAGEMENT_KEY
          if (!key) { out.error = 'no_admin_key'; return out }
          const serverOrigin = new URL(base).origin
          const body = await pointsGet(serverOrigin + '/v0/management/raccoon2api/accounts', { Authorization: 'Bearer ' + key })
          out.points = summarizePoints(route.id, null, body?.accounts)
          for (const a of body?.accounts || []) {
            const v = pointsNum(a?.points_available)
            if (v !== null) out.accounts.push({ name: String(a?.id ?? a?.name ?? ''), value: v })
          }
        } else {
          out.error = 'no_points'
        }
      } catch (error) {
        out.error = error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error)
      }
      return out
    }

    /** 把上游汇总（summary/totals）或账号数组聚合成 readPoints 的 {available,permanent,daily,cn,intl} 形态。 */
    function summarizePoints(id, summary, items) {
      const list = Array.isArray(items) ? items : []
      const out = { available: null, permanent: null, daily: null, cn: null, intl: null, error: '' }
      if (id === 'minimax2api') {
        let cnSum = 0; let intlSum = 0
        for (const item of list) {
          const v = pointsNum(item?.credit?.total)
          if (v === null) continue
          if (item?.region === 'cn') cnSum += v; else intlSum += v
        }
        out.cn = cnSum; out.intl = intlSum
        out.available = pointsNum(summary?.creditTotal)
        if (out.available === null && (cnSum || intlSum)) out.available = cnSum + intlSum
      } else if (id === 'officeace') {
        out.available = pointsNum(summary?.remaining)
      } else if (id === 'trae2api-hub') {
        let cnSum = 0; let intlSum = 0
        for (const a of list) {
          const v = pointsNum(a?.credits)
          if (v === null) continue
          if (isDomestic(a?.product)) cnSum += v; else intlSum += v
        }
        out.cn = cnSum; out.intl = intlSum
        out.available = (cnSum || intlSum) ? cnSum + intlSum : null
      } else if (id === 'raccoon') {
        let sum = 0
        for (const a of list) {
          const v = pointsNum(a?.points_available)
          if (v !== null) sum += v
        }
        out.available = sum
      }
      return out
    }

    /** trae 账号 product（trae-cn / trae-domestic…）是否属国内池。 */
    const isDomestic = (product) => /(^|[-_])(cn|domestic)([-_]|$)/i.test(String(product ?? ''))

    /** 面板标签的显示名（与卡片 tab 文案对齐）。 */
    const routeLabel = (route) =>
      route.id === 'codearts'
        ? 'Codearts'
        : route.id === 'officeace'
          ? 'OfficeAce'
          : route.id === 'cline'
            ? 'Cline (cline2api)'
            : route.id === 'raccoon'
              ? 'Raccoon (raccoon2api)'
              : route.id
    const listHandler = async (request, response) => {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      try {
        const routes = []
        for (const route of live.routeConfigs) {
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
            label: routeLabel(route),
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
            /**
             * 动态上游（upstreams.json）：卡片要显示真实上游地址与凭据名，而不再显示空的管理面板提示。
             * 真实请求仍走本插件 8788 代理（规则包节流继续生效），这里只做只读展示，不回显任何明文密钥。
             */
            dynamicUpstream: route.dynamicUpstream === true,
            upstreamUrl: typeof route.upstream === 'string' ? route.upstream : '',
            apiKeyEnv: typeof route.apiKeyEnv === 'string' && route.apiKeyEnv !== '' ? route.apiKeyEnv : '',
            passthroughAuth: route.passthroughAuth === true,
            /** 设置卡片上「打开登录面板」按钮指向的地址（如 officeace2api :7864、cline2api :3457 管理后台）。 */
            adminUrl: typeof route.adminUrl === 'string' && route.adminUrl !== '' ? route.adminUrl : '',
            /**
             * 该路由的上游进程是否由本插件拉起（patch 里配了 launch）。
             *
             * 光看 credentialKind 分不出来：officeace 与 cline 都是 'managed'，
             * 但 officeace2api 是用户自己起的、cline2api 是插件自动起的，卡片文案必须不同。
             */
            autoLaunched: route.launch !== undefined,
            /**
             * 生图/生视频通道声明（goal-58ba6a2c）。原样透传 normalizeRoute 解析好的
             * route.media（{ images: [id…], videos: [id…] }，缺省 = 该通道不支持）。
             * 卡片据此决定展示生图还是生视频表单、下拉里列哪些模型；没有 media 的
             * 路由（codearts/officeace/cline/raccoon/trae）完全不渲染媒体面板。
             */
            media:
              typeof route.media === 'object' && route.media !== null
                ? {
                    images: Array.isArray(route.media.images) ? route.media.images : [],
                    videos: Array.isArray(route.media.videos) ? route.media.videos : [],
                  }
                : null,
            updatedAt: entry?.updatedAt ?? null,
            models: health?.ok && health.models > 0 ? health.models : declaredModels,
            health,
            /** 上游面板剩余积分（面板下方展示）；拉不到就是 null，卡片静默不显示。 */
            points: await fetchPoints(route),
          })
        }
        writeJson(response, 200, {
          routes,
          /**
           * 前置层的监听状态。
           *
           * 2026-11-08 的事故：六条 API 全断，而这张卡片完全正常——因为它读的是
           * routeConfigs（配置），与「端口到底起没起」无关。把 status 一并回给卡片，
           * 「配置对、监听挂了」才看得见。
           */
          proxy: live.proxy?.status?.() ?? { listening: false, port: config.port },
          /** 最近一次模型同步摘要；卡片据此显示「上次同步 +x -y」。 */
          modelSync: live.lastSync,
        })
      } catch (error) {
        writeJson(response, 500, { error: String(error) })
      }
    }

    /**
     * 注册并**收集** disposer。
     *
     * 2026-11-09 事故：原来这三行只调用 register 不收集返回值，inject 回调也没把
     * 清理函数交还给 Cordis。HMR 重载本条目时旧 handler 仍然挂在 webserver 的路由表上，
     * 新的 apply 一注册就撞 `webserver: duplicate exact route "/api/api-rules/accounts"`
     * ——整个 inject 回调失败，于是这条路由**永远由旧闭包回答**：卡片读到的
     * routeConfigs 是旧的（少一条路由），proxy 也指向那次已经失败的新实例
     * （listening:false），而 `ctx.effect` 里新起的监听却好端端在 8788 上服务。
     * 症状就是「8788 明明是通的，accounts 却说没监听、还少一条路由」。
     * 把 disposer 交还，重载才会先摘掉旧路由再挂新的。
     */
    const disposers = []
    const register = (path, handler) => {
      disposers.push(webCtx.webServer.register({ kind: 'exact', path, handler }))
    }
    register('/api/api-rules/diag', (req, res) => {
      const fs = require('fs')
      const os = require('os')
      const path = require('path')
      const file = path.join(os.tmpdir(), 'dsh-api-rules-diag.json')
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => { try { fs.writeFileSync(file, body) } catch {} res.writeHead(204); res.end() })
        return
      }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      try { const txt = fs.readFileSync(file, 'utf8'); res.writeHead(200, { 'Content-Type': "application/json" }); res.end(txt || '[]') } catch { res.writeHead(200, { 'Content-Type': "application/json" }); res.end('[]') }
    })
    /**
     * 同济 VPN 状态：只读，不做任何拨号动作。
     *
     * 拨号要提权、要 UAC，绝不能由 HTTP 请求触发——网页上一个误点就弹窗，
     * 用户会不知道发生了什么。所以这个接口只回答「现在什么状态」，
     * 真要拨号走 CLI（tongji-vpn-cli.mjs connect）或等 throttle 在请求路径上自动处理。
     */
    register('/api/api-rules/tongji-vpn', async (request, response) => {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      try {
        const { probeTunnel, probeIntranet } = await import('./tongji-vpn.mjs')
        const status = tongjiVpnStatus()
        const route = routeConfigs.find((entry) => entry.id === 'tongji')
        // 按 apiKeyEnv 从 DSH 凭据实时取真密钥（本插件不存密钥）。
        // 这里没有 createProxy 内部那个 resolveEnvCredential 闭包，
        // 只能走 live.credentials.resolve——写错会变成 500 probe_failed。
        const apiKey = route?.apiKeyEnv ? await live.credentials?.resolve?.(route.apiKeyEnv) : undefined
        const [tunnel, intranet] = await Promise.all([
          probeTunnel({ timeoutMs: 3000 }),
          probeIntranet({ apiKey, timeoutMs: 8000 }),
        ])
        writeJson(response, 200, { ...status, tunnel, intranet })
      } catch (error) {
        writeJson(response, 500, { error: 'probe_failed', detail: String(error?.message ?? error) })
      }
    })
    // ── 同济账号 · 读写 tongji-vpn.env ────────────────────
    // 这份 env 是 openconnect 拨号 + AIGC IAM 登录共同的凭据源。
    // 为什么放 env 而不是 ~/.dsh/.credentials.yaml：提权后的 PowerShell 进程
    // 读不到 DSH 凭据服务，必须自己拿文件；且密码不进命令行（--passwd-on-stdin）。
    // GET 返回掩码账号 + VPN 状态；POST 增量落盘（留空字段不改）。
    // 拨号触发：lazy —— throttle 钩子在「403 且不在内网」时自动拨，AIGC /iam-login 端点已在，
    // 只要把账号写迚 env 文件就打通了，不需要额外的手动 connect 端点。
    register('/api/api-rules/tongji-account', async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'POST') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      try {
        const { readConfig, parseEnvText } = await import('./tongji-vpn.mjs')
        // 找 env 路径：与 tongji.mjs resolveVpnConfigPath() 同规则（env > pluginRoot > cwd）
        const pluginDir = dirname(fileURLToPath(import.meta.url))
        const envPath = process.env.TONGJI_VPN_CONFIG?.trim() || join(pluginDir, '..', 'tongji-vpn.env')
        if (request.method === 'POST') {
          const chunks = []
          for await (const chunk of request) chunks.push(chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          const username = String(body.username ?? '').trim()
          const password = String(body.password ?? '')
          if (username === '' && password === '') {
            writeJson(response, 400, { error: 'empty_credentials', detail: 'username 和 password 至少填一个' })
            return
          }
          // 增量更新：只覆盖传了的字段，其余保留
          const existing = existsSync(envPath) ? parseEnvText(readFileSync(envPath, 'utf8')) : {}
          const nextUsername = username !== '' ? username : String(existing.username ?? '')
          const nextPassword = password !== '' ? password : String(existing.password ?? '')
          if (nextUsername === '' || nextPassword === '') {
            writeJson(response, 400, {
              error: 'missing_fields',
              detail: nextUsername === ''
                ? '工号不能为空（当前 .env 文件里没有 username，请在面板填一次）'
                : '密码不能为空（当前 .env 文件里没有 password，请在面板填一次）',
            })
            return
          }
          const next = [
            '# 同济 VPN + AIGC 凭据（由设置面板写入，.gitignore 已忽略）',
            `username=${nextUsername}`,
            'authgroup=' + String(existing.authgroup ?? 'default_method_localdb'),
            `password=${nextPassword}`,
            '',
          ].join('\n')
          mkdirSync(dirname(envPath), { recursive: true })
          writeFileSync(envPath, next, 'utf8')
          writeJson(response, 200, { ok: true, username: nextUsername, passwordHint: maskTail(nextPassword) })
          return
        }
        // GET：返回掩码账号 + 状态
        const config = readConfig(envPath)
        const status = tongjiVpnStatus()
        writeJson(response, 200, {
          username: config.username ?? '',
          passwordHint: maskTail(config.password),
          authgroup: config.authgroup,
          gateway: config.gateway,
          vpn: status,
        })
      } catch (error) {
        writeJson(response, 500, { error: 'tongji_account_failed', detail: String(error?.message ?? error) })
      }
    })
    register('/api/api-rules/accounts', listHandler)
    /**
     * 模型选择器旁边的「提供商 · 积分」pill 数据源。
     * 只按 route 查询单条 points，复用 fetchPoints 的 30s TTL 缓存 + 6s 超时。
     */
    /**
     * 「提供商 · 积分」pill 点击展开的账号明细浮层数据源。
     * 与 points 同一批上游端点，但返回每账号一条明细 + 面板跳转地址（adminUrl）。
     */
    register('/api/api-rules/detail', async (request, response) => {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      try {
        const query = String(request.url || '').split('?')[1] || ''
        const routeId = decodeURIComponent(query.split('route=')[1] || '')
        if (routeId === '') {
          writeJson(response, 400, { error: 'missing_route' })
          return
        }
        const route = live.routeConfigs.find((r) => r.id === routeId)
        if (!route) {
          writeJson(response, 404, { error: 'unknown_route', route: routeId })
          return
        }
        const detail = await readDetail(route)
        writeJson(response, 200, { route: routeId, label: routeLabel(route), ...detail })
      } catch (error) {
        writeJson(response, 500, { error: String(error?.message ?? error) })
      }
    })
    register('/api/api-rules/points', async (request, response) => {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      try {
        const query = String(request.url || '').split('?')[1] || ''
        const routeId = decodeURIComponent(query.split('route=')[1] || '')
        if (routeId === '') {
          writeJson(response, 400, { error: 'missing_route' })
          return
        }
        const route = live.routeConfigs.find((r) => r.id === routeId)
        if (!route) {
          writeJson(response, 404, { error: 'unknown_route', route: routeId })
          return
        }
        writeJson(response, 200, { route: routeId, label: routeLabel(route), points: await fetchPoints(route) })
      } catch (error) {
        writeJson(response, 500, { error: String(error?.message ?? error) })
      }
    })
    register('/api/api-rules/account', accountHandler)
    register('/api/api-rules/codearts-account', accountHandler)
    register('/api/api-rules/minimax-account', minimaxAccountHandler)
    /**
     * 动态上游（扩展槽）CRUD：面板「＋」添加 OpenAI 协议上游。
     *
     * GET    → 列出全部动态上游（apiKey 打码）。
     * POST   → 新增 / 覆盖一条上游，body:
     *            { id, name?, baseUrl, apiKey?, rules?, passthroughAuth?, models?,
     *              concurrency?, sessionHoldMs?, timeoutMs? }
     *          （passthroughAuth=true 时 apiKey 可省——密钥由 DSH 凭据持有、本插件只中转；
     *           models 是 [{ id, maxTokens? }]，面板按「id」或「id:maxTokens」逗号分隔输入。）
     *          写 upstreams.json + ensureProviderBlock（让选择器出现这个 provider）+
     *          重建监听（新路由立刻可转发）+ 触发一次模型同步（把 discovered 清单写回）。
     * DELETE → ?id=<id> 删除：删 upstreams.json 条目 + removeProviderBlock + 重建监听。
     *
     * 所有写操作落 upstreams.json（重启仍在），provider 块落 cordis.patch.yml（宿主热拾取）。
     */
    const upstreamsHandler = async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'DELETE') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      try {
        if (request.method === 'GET') {
          const map = await readUpstreams(process.env)
          writeJson(response, 200, { upstreams: Object.values(map).map((u) => maskUpstream(u)) })
          return
        }

        if (request.method === 'POST') {
          let body
          try {
            body = JSON.parse(Buffer.from(await readBody(request)).toString('utf8') || '{}')
          } catch (error) {
            writeJson(response, 400, { error: 'invalid_json', detail: String(error) })
            return
          }
          // 编辑已有上游时（apiKeyKeep=true）host 不回传明文 key，浏览器填不出旧值；
          // 这里若没传新 key，就沿用 upstreams.json 里的旧 key，避免把 key 清空。
          let keepApiKey = ''
          if (body.apiKeyKeep === true) {
            const existing = (await readUpstreams(process.env))[String(body.id ?? '').trim().toLowerCase()]
            if (existing) keepApiKey = existing.apiKey
          }
          let upstream
          try {
            upstream = await putUpstream(
              {
                id: body.id,
                name: body.name,
                baseUrl: body.baseUrl,
                apiKey: typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey : keepApiKey,
                rules: body.rules,
                passthroughAuth: body.passthroughAuth,
                apiKeyEnv: body.apiKeyEnv,
                models: body.models,
                concurrency: body.concurrency,
                sessionHoldMs: body.sessionHoldMs,
                timeoutMs: body.timeoutMs,
              },
              process.env,
            )
          } catch (error) {
            // normalizeUpstream 抛的校验错误（缺 id / baseUrl / apiKey）回 400。
            writeJson(response, 400, { error: 'invalid_upstream', detail: String(error?.message ?? error) })
            return
          }
          // 让模型选择器出现这个 provider（写入 cordis.patch.yml 的 llm-pi-ai 块）。
          let provider = null
          try {
            provider = await ensureProviderBlock({
              id: upstream.id,
              name: upstream.name,
              apiKeyEnv: upstream.apiKeyEnv,
              port: config.port,
              env: process.env,
              logger,
            })
          } catch (error) {
            logger?.warn?.('[api-rules] 写入 provider 块失败（上游仍已保存）: ' + String(error?.message ?? error))
            provider = { ok: false, error: String(error?.message ?? error) }
          }
          // 重建监听，让新路由立刻可转发（不等重启）。
          let rebuilt = null
          try {
            rebuilt = await rebuildProxy()
          } catch (error) {
            rebuilt = { ok: false, error: String(error?.message ?? error) }
          }
          // 触发一次模型同步，把上游 discovered 的清单写回 provider.models。
          let sync = null
          try {
            sync = await runSync(false)
          } catch (error) {
            sync = { ok: false, error: String(error?.message ?? error) }
          }
          writeJson(response, 200, { ok: true, upstream: maskUpstream(upstream), provider, rebuilt, sync })
          return
        }

        // DELETE
        const url = new URL(request.url ?? '/', 'http://localhost')
        const id = (url.searchParams.get('id') ?? '').trim()
        if (id === '') {
          writeJson(response, 400, { error: 'missing_id' })
          return
        }
        const removed = await deleteUpstream(id, process.env)
        if (!removed) {
          writeJson(response, 404, { error: 'unknown_upstream', id })
          return
        }
        let provider = null
        try {
          provider = await removeProviderBlock({ id, env: process.env, logger })
        } catch (error) {
          provider = { ok: false, error: String(error?.message ?? error) }
        }
        let rebuilt = null
        try {
          rebuilt = await rebuildProxy()
        } catch (error) {
          rebuilt = { ok: false, error: String(error?.message ?? error) }
        }
        writeJson(response, 200, { ok: true, id, provider, rebuilt })
      } catch (error) {
        writeJson(response, 500, { error: String(error?.message ?? error) })
      }
    }
    register('/api/api-rules/upstreams', upstreamsHandler)
    /**
     * 「＋」表单里的「拉取模型清单」按钮打这里。
     *
     * 为什么不从卡片直连上游：① 上游要鉴权，而透传上游的真密钥只在 DSH 凭据里
     * （`live.credentials.resolve(ref)` 才能读到，卡片拿不到也不该拿）；② 浏览器
     * 直连会撞 CORS。所以由宿主代拉一次 `/v1/models`，只回「模型 id + 上限」这类
     * 非敏感元数据。
     *
     * body: { baseUrl, apiKeyEnv?, apiKey?, passthroughAuth? }
     * resp: { ok, models: [{id, maxTokens?}], source: 'credential'|'apiKey'|'none', error? }
     */
    register('/api/api-rules/upstreams/models', async (request, response) => {
      if (request.method !== 'POST') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      let body
      try {
        body = JSON.parse(Buffer.from(await readBody(request)).toString('utf8') || '{}')
      } catch (error) {
        writeJson(response, 400, { error: 'invalid_json', detail: String(error) })
        return
      }
      const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/u, '') : ''
      if (!/^https?:\/\//iu.test(baseUrl)) {
        writeJson(response, 400, { ok: false, error: 'invalid_base_url' })
        return
      }
      // 鉴权优先级：显式 apiKeyEnv（DSH 凭据）> 表单里粘的 apiKey > 无（试匿名）。
      const ref = typeof body.apiKeyEnv === 'string' ? body.apiKeyEnv.trim() : ''
      const rawKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      let authorization = ''
      let source = 'none'
      if (ref !== '') {
        try {
          const resolved = await live.credentials?.resolve?.(ref)
          const value = typeof resolved === 'string' ? resolved : resolved?.value
          if (typeof value === 'string' && value !== '') {
            authorization = /^Bearer\s/iu.test(value) ? value : 'Bearer ' + value
            source = 'credential'
          }
        } catch (error) {
          logger?.warn?.('[api-rules] 读取凭据 ' + ref + ' 失败: ' + String(error?.message ?? error))
        }
      }
      if (authorization === '' && rawKey !== '') {
        authorization = /^Bearer\s/iu.test(rawKey) ? rawKey : 'Bearer ' + rawKey
        source = 'apiKey'
      }
      try {
        const res = await fetch(baseUrl + '/models', {
          headers: authorization !== '' ? { authorization } : {},
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          writeJson(response, 200, {
            ok: false,
            models: [],
            source,
            error: 'HTTP ' + res.status + (detail ? ': ' + detail.slice(0, 200) : ''),
          })
          return
        }
        const payload = await res.json().catch(() => null)
        const list = Array.isArray(payload?.data) ? payload.data
          : Array.isArray(payload?.models) ? payload.models
            : Array.isArray(payload) ? payload : []
        // 各家字段名不同，且同一家也可能把长度嵌在 modality 里。取值优先级：
        // ① 扁平 maxTokens / max_tokens / max_output_tokens（输出上限）
        // ② 嵌套 output_modalities[].max_length.value（同上）
        // ③ 扁平 context_length / context_window / max_context_length（上下文窗口）
        // ④ 嵌套 input_modalities[].supported_inputs.max_context_length.value（同上）
        // intern-ai 的 schema 2.x 只给 ②④，扁平字段全无 —— 不读嵌套就一个 maxTokens 都拿不到。
        const nestedNumber = (arr, pick) => {
          for (const item of Array.isArray(arr) ? arr : []) {
            const value = Number(pick(item)?.value ?? pick(item))
            if (Number.isFinite(value) && value > 0) return value
          }
          return undefined
        }
        const models = list
          .map((m) => {
            const id = typeof m === 'string' ? m : (typeof m?.id === 'string' ? m.id : '')
            if (id === '') return null
            if (typeof m === 'string') return { id }
            const ctx = Number(m.maxTokens ?? m.max_tokens ?? m.max_output_tokens)
            if (Number.isFinite(ctx) && ctx > 0) return { id, maxTokens: ctx }
            const out = nestedNumber(m.output_modalities, (mod) => mod?.max_length)
            if (out !== undefined) return { id, maxTokens: out }
            const win = Number(m.context_length ?? m.context_window ?? m.max_context_length)
            if (Number.isFinite(win) && win > 0) return { id, maxTokens: win }
            const inCtx = nestedNumber(m.input_modalities, (mod) => mod?.supported_inputs?.max_context_length)
            return inCtx !== undefined ? { id, maxTokens: inCtx } : { id }
          })
          .filter(Boolean)
        writeJson(response, 200, { ok: true, models, source, error: '' })
      } catch (error) {
        writeJson(response, 200, {
          ok: false,
          models: [],
          source,
          error: error?.name === 'TimeoutError' ? 'timeout' : String(error?.message ?? error),
        })
      }
    })
    /** 卡片上的「同步可用模型」按钮打这里；也允许 GET 做只读 dry-run。 */
    register('/api/api-rules/models-sync', async (request, response) => {
      if (request.method !== 'POST' && request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      try {
        const result = await runSync(request.method === 'GET')
        writeJson(response, result.ok === false && result.error === 'proxy not listening' ? 503 : 200, result)
      } catch (error) {
        writeJson(response, 500, { ok: false, error: String(error) })
      }
    })
    /**
     * 生图 / 生视频转发（goal-58ba6a2c）。
     *
     * 客户端设置卡片同源 fetch 本端点（无需 bearer），本端点把请求转发到回环网关
     * `proxy.origin()/<routeId>/v1/{images|videos}/generations`。网关侧 media() 再转发
     * 到真实上游。为什么不直接从卡片 fetch 网关：网关有 Host/Origin 回环校验 + bearer，
     * 卡片所在 origin 未必过；统一走宿主同源端点与 accounts/models-sync 一致。
     *
     * body: { routeId, kind: 'images'|'videos', payload: {...} }（payload 原样是上游格式）
     * resp: 上游 JSON 原样回传（200），或 { error } 非上游错误。
     */
    register('/api/api-rules/media-generate', async (request, response) => {
      if (request.method !== 'POST') {
        writeJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      let origin
      try {
        origin = proxy?.origin?.()
      } catch {
        origin = undefined
      }
      if (!origin) {
        writeJson(response, 503, { error: 'proxy not listening' })
        return
      }
      let body
      try {
        body = JSON.parse(Buffer.from(await readBody(request)).toString('utf-8') || '{}')
      } catch (error) {
        writeJson(response, 400, { error: 'invalid_json', detail: String(error) })
        return
      }
      const routeId = typeof body.routeId === 'string' && body.routeId !== '' ? body.routeId : ''
      const kind = body.kind === 'videos' ? 'videos' : 'images'
      if (routeId === '') {
        writeJson(response, 400, { error: 'missing_route' })
        return
      }
      // 校验路由存在（防拼错 routeId 打错上游），复用 routeConfigs 而非 live.routeConfigs
      // 早期可能为空的兜底：与 runSync 一致。
      const routes = (Array.isArray(live.routeConfigs) && live.routeConfigs.length > 0)
        ? live.routeConfigs : routeConfigs
      if (!routes.some((entry) => entry.id === routeId)) {
        writeJson(response, 404, { error: 'unknown_route', routeId })
        return
      }
      const endpoint = origin + '/' + routeId + '/v1/' + kind + '/generations'
      // 网关默认 token=undefined 只要求「非空 bearer」；这里给占位，真实上游凭证在
      // route.apiKey / 账号文件里，网关 media() 自己会取。
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 600_000)
      try {
        const upstream = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer api-rules-media' },
          body: JSON.stringify(body.payload ?? {}),
          signal: controller.signal,
        })
        const text = await upstream.text()
        clearTimeout(timer)
        let result
        try { result = JSON.parse(text) } catch { result = { raw: text } }
        writeJson(response, upstream.ok ? 200 : (upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502), result)
      } catch (error) {
        clearTimeout(timer)
        const aborted = controller.signal.aborted === true
        writeJson(response, aborted ? 504 : 502, {
          error: aborted ? 'timeout' : 'media_upstream_error',
          detail: String(error?.cause ?? error),
        })
      }
    })
    return () => {
      for (const dispose of disposers.splice(0)) {
        if (typeof dispose !== 'function') continue
        try {
          dispose()
        } catch (error) {
          logger?.warn?.('[api-rules] 摘除 HTTP 路由失败: ' + String(error))
        }
      }
    }

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
   * 生图 / 生视频 AI 工具（goal-deb5e3be）。把 media 上游暴露成标准 DSH 工具，
   * 全局注册——**任意模型**都能非流式调用 generate_image / generate_video；
   * 选到 media 模型时再用 agent/pre-step 注入引导（双触发，见下）。
   *
   * 工具 execute 从 host 进程直连回环网关 media()，与 /api/api-rules/media-generate
   * 端点共用同一条转发路径；getOrigin/getRoutes 读实时 live 状态，让工具永远打
   * 当前活着的网关与最新路由表（热改配置即刻生效）。
   */
  ctx.inject(['tools', 'sessionProjections', 'userQuestions'], (toolCtx) => {
    const deps = {
      getOrigin: () => {
        try {
          return live.proxy?.origin?.()
        } catch {
          return undefined
        }
      },
      getRoutes: () => (Array.isArray(live.routeConfigs) && live.routeConfigs.length > 0 ? live.routeConfigs : routeConfigs),
      /** 生成前强制向用户确认「模型 + 尺寸/时长」用（工具 execute 里 ctx.userQuestions.ask()）。 */
      userQuestions: toolCtx.userQuestions,
    }
    const disposers = [
      toolCtx.tools.register(defineMediaTool('images', deps)),
      toolCtx.tools.register(defineMediaTool('videos', deps)),
      /** 语音转文字：同济 Whisper ASR，网关 /audio/transcriptions 透传（见 proxy.mjs::audioTranscribe）。 */
      toolCtx.tools.register(defineAudioTranscribeTool({ getOrigin: deps.getOrigin })),
    ]
    disposers.push(
      /** 选到 media 模型时注入一句引导，让模型知道该用生图/生视频工具。 */
      /**
       * 双触发的第二触：选中 media 模型时，在 pre-step 之后追加一条 notice 引导模型
       * 去调 generate_image / generate_video（照 action-cards 样板，非突变 spread）。
       * decision 形状见 PreStepDecision = {kind:'reject'} | {kind:'enter', messages}。
       */
      toolCtx.on('agent/pre-step', async ({ modelSelection }, next) => {
        const decision = await next()
        try {
          if (!decision || decision.kind === 'reject') return decision
          const media = mediaSelectionHint(modelSelection, live.routeConfigs)
          if (!media) return decision
          const notice = {
            role: 'user',
            content: [{ type: 'text', text: media.hint }],
            source: {
              kind: 'api-rules-media-hint',
              form: 'notice',
              summary: media.kind === 'images' ? '媒体模型引导：请调用 api_generate_image 工具生成图片' : '媒体模型引导：请调用 api_generate_video 工具生成视频',
            },
          }
          return { ...decision, messages: [...decision.messages, notice] }
        } catch (error) {
          logger?.warn?.('[api-rules] media 引导注入失败（忽略）: ' + String(error))
          return decision
        }
      }),
    )
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          logger?.warn?.('[api-rules] 摘除 media 工具失败: ' + String(error))
        }
      }
    }
  })

  /** 判断当前选中模型是不是 media 模型，是则返回 { hint }，否则 undefined。 */
  function mediaSelectionHint(modelSelection, routes) {
    if (!modelSelection || typeof modelSelection !== 'object') return undefined
    const model = typeof modelSelection.model === 'string' ? modelSelection.model : ''
    if (model === '') return undefined
    const configured = Array.isArray(routes) ? routes : []
    const findRoute = (kind) => {
      for (const route of configured) {
        const media = route && typeof route.media === 'object' && route.media !== null ? route.media : null
        if (media && Array.isArray(media[kind]) && media[kind].includes(model)) return route.id
      }
      return undefined
    }
    const imageRoute = findRoute('images')
    if (imageRoute) {
      return {
        kind: 'images',
        routeId: imageRoute,
        hint: '当前会话选中的 ' + model + ' 是生图模型。请调用 api_generate_image 工具（把用户这句话当作 prompt）来生成图片，不要把它当对话来回答。',
      }
    }
    const videoRoute = findRoute('videos')
    if (videoRoute) {
      return {
        kind: 'videos',
        routeId: videoRoute,
        hint: '当前会话选中的 ' + model + ' 是生视频模型。请调用 api_generate_video 工具（把用户这句话当作 prompt）来生成视频，不要把它当对话来回答。',
      }
    }
    return undefined
  }

  /**
   * 启动顺序：先加载外部规则包 + 并入动态上游路由（都是异步文件操作），再起监听。
   *
   * 外部规则 / 动态上游是「扩展槽」的两条来路：前者来自 ~/.dsh/.api-rules/rules/*.mjs，
   * 后者来自面板「＋」写进 upstreams.json 的直连 OpenAI 上游。两者都要在读盘后才知道，
   * 所以整个启动做成 async bootstrap；disposer 用 bootPromise 串起清理顺序，
   * 保证 HMR 重载时「旧监听真正关掉」之后新实例才开始 listen（EADDRINUSE 防线，见下）。
   */
  ctx.effect(() => {
    const boot = (async () => {
      // 1) 外部规则包先注册（动态上游可能引用它们）。
      try {
        await loadExternalRules()
      } catch (error) {
        logger?.warn?.('[api-rules] 扫描外部规则包目录失败: ' + String(error?.message ?? error))
      }
      // 2) 动态上游路由并入 routeConfigs（静态路由已在上面同步装配好）。
      try {
        await mergeUpstreamRoutes()
      } catch (error) {
        logger?.warn?.('[api-rules] 读取动态上游路由失败: ' + String(error?.message ?? error))
      }
      // 3) 异步窗口里可能已经被 disposer 叫停（HMR 快速重载），别再起监听。
      if (shuttingDown) return
      if (routeConfigs.length === 0) {
        logger?.info?.('[api-rules] 没有配置任何路由，规则前置层不启动')
        live.proxy = undefined
        return
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
        /** 透传路由的模型发现要真密钥：按 apiKeyEnv 从 DSH 凭据实时取。 */
        resolveEnvCredential: (ref) => live.credentials?.resolve?.(ref),
      })
      // 把本次实例登记为「当前活着的那个」，让 HTTP handler 读实时状态而不是闭包快照。
      live.proxy = proxy
      live.routeConfigs = routeConfigs
      proxy.ready.then(
        () => {
          logger?.info?.('[api-rules] 规则前置层监听 ' + proxy.origin() + '，路由: ' + proxy.routes().join(', '))
          // 每次启用插件都刷新一次可用模型。上游（尤其自动拉起的进程）常比监听就绪晚几秒，
          // 只固定等 1.5s 跑一次会把还没就绪的 provider 判成 upstream-fallback 直接跳过，
          // 那次同步就白跑了（用户反馈「重启了还是没做到模型更新」的根因之一）。
          // 这里改成最多重试若干次，直到所有 owned provider 都返回真实清单才收手。
          // syncModels 对回落/失败是 skip 且不写盘，所以中途重试幂等、安全。
          if (config.syncModelsOnEnable !== false) {
            const MAX_ATTEMPTS = 6
            const RETRY_MS = 3000
            let attempt = 0
            const runWhenReady = () => {
              if (shuttingDown || live.proxy !== proxy) return
              attempt += 1
              runSync().then((result) => {
                if (shuttingDown || live.proxy !== proxy) return
                const pending = (result.skipped || []).filter((s) =>
                  /upstream-fallback|discovery-failed|empty-model-list|no-discovery-result/.test(s.reason || ''))
                // 上游清单「疑似残缺」也会整条 guarded 跳过；启动期这多半是进程还没喂全，
                // 同样计入未就绪，交给下一轮重试（重试有上限，永久残缺不会无限循环）。
                const partial = (result.guarded || []).filter((g) =>
                  /upstream-list-looks-partial/.test(g.reason || ''))
                const notReady = pending.length + partial.length
                const needsRetry = notReady > 0 && attempt < MAX_ATTEMPTS
                logger?.info?.('[api-rules] 启用时模型同步: ' + (result.ok ? '完成' : '失败')
                  + ' +' + (result.added?.length ?? 0) + ' -' + (result.removed?.length ?? 0)
                  + (result.error ? ' ' + result.error : '')
                  + (needsRetry ? '（上游未就绪 ' + notReady + ' 家，' + attempt + '/' + MAX_ATTEMPTS + ' 稍后重试）' : ''))
                if (needsRetry) {
                  const timer = setTimeout(runWhenReady, RETRY_MS)
                  timer?.unref?.()
                }
              })
            }
            const first = setTimeout(runWhenReady, 1500)
            first?.unref?.()
          }
        },
        (error) => logger?.error?.('[api-rules] 规则前置层启动失败: ' + String(error)),
      )
    })()
    return () => {
      shuttingDown = true
      // 只清掉自己那一份：若新实例已经登记过，别把它的状态抹了。
      if (live.proxy === proxy) live.proxy = undefined
      /**
       * 必须把 close() 的 Promise 交还给 Cordis。
       *
       * 2026-11-08 的事故链：profile 的 cordis.patch.yml 被上游面板回写 → HMR 重载
       * 本条目 → 旧 effect 的清理函数被调用。清理函数若不 await，server.close() 还在
       * 异步收尾，新的 apply 就已经开始 listen 同一个 8788 → EADDRINUSE → 新前置层
       * 静默死掉，六条 API 一起断。返回 Promise 让重载按顺序等旧监听真正关掉。
       *
       * 启动现在是 async bootstrap：先等 boot 收尾（可能还在读盘 / 还没 listen），
       * 再 close。boot 里看到 shuttingDown 会自己提前返回、不起监听。
       */
      return boot.then(() => proxy?.close?.())
    }
  })

  // 同济 AIGC 专区子系统（原 dsh-tongji-aigc 整包并入）：注册 9 个工具 + 14 个卡片端点
  // `/api/dsh-api-rules/aigc/*`，并复用 lib/rules/tongji.mjs 的 TongjiVpn 单例。
  // 详细说明见 lib/aigc-legacy/index.mjs 的文件头注释。
  injectAigc(ctx)
}

export { createProxy, normalizeRoute } from './proxy.mjs'
export { RuleRegistry, normalizePack } from './registry.mjs'
export { SessionGate } from './gate.mjs'
export { codeartsRules } from './rules/codearts.mjs'
export { genericRules } from './rules/generic.mjs'
export { clineRules } from './rules/cline.mjs'
export { raccoonRules } from './rules/raccoon.mjs'
export { officeaceRules } from './rules/officeace.mjs'
export { minimaxRules } from './rules/minimax2api.mjs'
export { qoderRules } from './rules/qoder.mjs'
