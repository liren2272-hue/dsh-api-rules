/**
 * 规则前置层：把 DSH 的 OpenAI 请求按「规则包」加工后转发到真正的上游。
 *
 * ## 它解决的问题
 *
 * 上游供应商的「必然被拒 / 必然报错」规则（参数上限、角色名、图片、并发配额、
 * 200 里的业务错误）本来散落在各自的代理进程里。这一层把它们提到 DSH 进程内，
 * 于是**任何**走 DSH 的请求都受约束，而不是只有启动那个代理的客户端受约束。
 *
 * ## 路由形状
 *
 *   GET  /health                          自检
 *   GET  /<routeId>/v1/models             模型清单（透传上游，失败时回落到配置）
 *   POST /<routeId>/v1/chat/completions   聊天（流式或非流式）
 *   GET|POST /v1/...                      默认路由的短路径（配置 default: true 的那条）
 *
 * ## 为什么是「进程内 HTTP」而不是自己实现 LlmAdapter
 *
 * 沿用 DSH 现有的 pi-ai provider 意味着模型选择器、provider 名、模型清单全都不变，
 * 用户只要把 baseURL 指到本层即可。自己实现 LlmAdapter 要重写流式翻译与 /v1/models
 * 探测，收益为零、风险全在。
 *
 * @module dsh-api-rules/proxy
 */

import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { hostIsLoopback, originIsLoopback, readBody, writeJson, writeOpenAiError } from './http.mjs'
import { SessionGate } from './gate.mjs'
import { normalizeLaunch, ensureUpstream } from './launcher.mjs'
import { ToolCallFragmentBuffer } from './rules/tool-call-arguments.mjs'

/** 上游请求超时（不含流式读取）。 */
const UPSTREAM_TIMEOUT_MS = 120_000

/** 一次转发里最多尝试几次（规则包可通过 maxAttempts 覆盖）。 */
const DEFAULT_MAX_ATTEMPTS = 8

const noop = () => {}

/**
 * 起规则层。
 *
 * @param {object} options
 * @param {number} options.port                监听端口；0 表示随机（测试用）
 * @param {Array} options.routes               路由表，见 normalizeRoute()
 * @param {import('./registry.mjs').RuleRegistry} options.registry
 * @param {object} [options.logger]
 * @param {Function} [options.modelInfo]       (routeId, modelId) => 元数据
 */
export function createProxy(options) {
  const { registry, logger } = options
  /** 是否允许在监听前拉起带 launch 的上游进程（顶层 `autoLaunch` 配置；默认开）。 */
  const autoLaunch = options.autoLaunch !== false
  const routes = new Map()
  let defaultRouteId
  /** 签名器注册表：名字 -> { signChatHeaders, discoverModels, toOpenAiModel, agentType, chatBase }。
   * 目前只有 huawei（码道）；未来接别的签名式 API 只要在这里挂一个即可。 */
  const signers = options.signers ?? {}
  /** 运行时取某路由的 AK/SK（由 index.mjs 从账号存储读出）；支持用户改完卡片后即时生效。 */
  const getCredential = typeof options.getCredential === 'function' ? options.getCredential : () => undefined
  /**
   * 按 DSH 凭据引用名（apiKeyEnv）取真密钥。由 index.mjs 注入
   * `live.credentials.resolve(ref)`：透传路由的密钥只有 DSH 凭据一处真源，
   * 模型发现必须用它去打上游 /v1/models，否则只能拿占位 bearer（上游 401 → 回落）。
   */
  const resolveEnvCredential = typeof options.resolveEnvCredential === 'function'
    ? options.resolveEnvCredential
    : () => undefined

  /**
   * 取凭证并 await。
   *
   * 凭证源（账号文件读取）天生是异步的，返回 Promise；这里必须 await 后再交给
   * 签名器——否则签名器拿到的是 Promise 对象，`cred.ak` 取到 undefined，
   * 签名出来 `Access=` 为空，上游一律拒绝，而现象只是"静默退回兜底清单"，极难定位。
   */
  async function resolveCredential(routeId) {
    return await getCredential(routeId)
  }
  for (const raw of options.routes) {
    const route = normalizeRoute(raw)
    // 规则包实例优先用调用方解析好的（index.mjs 已经做过启动期校验），
    // 没给就现场按名字解析——这样代理层单独使用时也能工作。
    route.packs = route.packs ?? route.rules.map((packName) => registry.get(packName))
    routes.set(route.id, route)
    if (route.isDefault) defaultRouteId = route.id
  }
  if (defaultRouteId === undefined && routes.size === 1) defaultRouteId = [...routes.keys()][0]

  const modelInfoOf = options.modelInfo ?? (() => undefined)
  /** 每条路由一个闸门：不同上游的配额互不相干。 */
  const gates = new Map()
  function gateOf(route) {
    if (route.concurrency === undefined || route.concurrency <= 0) return undefined
    let gate = gates.get(route.id)
    if (gate === undefined) {
      gate = new SessionGate({ limit: route.concurrency, holdMs: route.sessionHoldMs })
      gates.set(route.id, gate)
    }
    return gate
  }

  /**
   * 鉴权。
   *
   * 这里的取舍要说清楚：本层**不是**凭证边界。真正的上游凭证（AK/SK、appSecret）
   * 在下游网关里，DSH 发给本层的只是一个占位 bearer（patch 里的 `apiKeyEnv`）。
   *
   * 所以默认只要求「有非空 bearer」——外部与跨站请求由三道回环检查挡住
   * （Host、Origin、只绑 127.0.0.1）。想更严就把 config.token 设成与 patch 里
   * `apiKeyEnv` 同一个值，本层就只认这一个 bearer。
   */
  const token = typeof options.token === 'string' && options.token !== '' ? options.token : undefined
  const tokenBuffer = token === undefined ? undefined : Buffer.from(token)

  function bearerOk(request) {
    const header = request.headers.authorization
    if (typeof header !== 'string') return false
    const match = /^Bearer\s+(.+)$/iu.exec(header.trim())
    if (match === null) return false
    if (tokenBuffer === undefined) return match[1].length > 0
    const presented = Buffer.from(match[1])
    if (presented.length !== tokenBuffer.length) return false
    return timingSafeEqual(presented, tokenBuffer)
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      logger?.warn?.('[api-rules] ' + String(error))
      if (!response.headersSent) writeOpenAiError(response, 500, 'internal', String(error))
      else response.end()
    })
  })

  /**
   * 在途连接登记表。
   *
   * `server.close()` 只停止接受新连接，却要等所有既有连接结束才回调；而 DSH 自己
   * 就是最大的客户端，它发的是 keep-alive 长连接——于是一次 HMR 重载里旧实例的
   * close 可以吊住几十秒，新实例拿着同一个 8788 反复 EADDRINUSE。2026-11-09 00:26
   * 的事故就是这么发生的：重试预算耗尽后彻底放弃，8788 与六条上游一起消失。
   * 关停时主动断开这些连接，端口才能真正立刻回到可用状态。
   */
  const connections = new Set()
  server.on('connection', (socket) => {
    connections.add(socket)
    socket.on('close', () => connections.delete(socket))
  })

  /**
   * 监听失败（尤其是 EADDRINUSE）绝不能让整个前置层「静默死掉」。
   *
   * 2026-11-08 的事故就是这一类：宿主重启时上一次进程还没把 8788 放开，
   * `listen` 一次性失败 → `ready` reject → 只留下一条 error 日志，于是六条
   * API 同时全断，而设置卡片里看不出任何异常（卡片读的是 routeConfigs，
   * 与监听状态无关）。这里对 EADDRINUSE 做有界重试，其它错误立刻 reject。
   */
  const LISTEN_RETRY_DELAYS_MS = [200, 500, 1000, 2000, 3000, 5000, 5000, 5000]
  const listenPort = options.port ?? 0
  /** 最近一次成功绑定到的端口（配置 0 时由内核分配，关停后仍要能报出来）。 */
  let boundPort = listenPort
  /** 最近一次监听错误，供设置卡片显示「为什么没起来」。 */
  let lastListenError
  const ready = new Promise((resolve, reject) => {
    let attempt = 0
    server.on('listening', () => {
      lastListenError = undefined
      const address = server.address()
      if (address !== null && typeof address !== 'string') boundPort = address.port
      resolve()
    })
    server.on('error', (error) => {
      lastListenError = error
      if (error?.code !== 'EADDRINUSE' || attempt >= LISTEN_RETRY_DELAYS_MS.length) {
        reject(error)
        return
      }
      const delay = LISTEN_RETRY_DELAYS_MS[attempt]
      attempt += 1
      logger?.warn?.(
        '[api-rules] 端口 ' + listenPort + ' 被占用，' + delay + 'ms 后重试（第 ' + attempt + ' 次）',
      )
      setTimeout(() => server.listen(listenPort, '127.0.0.1'), delay).unref?.()
    })
    server.listen(listenPort, '127.0.0.1')
  })

  function origin() {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('api-rules proxy is not listening')
    return 'http://127.0.0.1:' + address.port
  }

  async function handle(request, response) {
    if (!hostIsLoopback(request.headers.host)) {
      writeOpenAiError(response, 403, 'host_not_allowed', 'Host header must name the loopback interface')
      return
    }
    if (!originIsLoopback(request.headers.origin)) {
      writeOpenAiError(response, 403, 'origin_not_allowed', 'Origin must be a loopback origin')
      return
    }
    // /health 不需要 bearer：它是启动探活用，不含任何上游数据。
    const url = request.url ?? '/'
    if (url === '/health' || url === '/healthz') {
      writeJson(response, 200, {
        ok: true,
        routes: [...routes.keys()],
        packs: registry.list(),
        uptimeMs: Math.round(process.uptime() * 1000),
      })
      return
    }
    if (!bearerOk(request)) {
      writeOpenAiError(response, 401, 'unauthorized', 'missing or invalid Authorization bearer')
      return
    }

    const parsed = parseRoute(url, routes, defaultRouteId)
    if (parsed === undefined) {
      writeOpenAiError(response, 404, 'not_found', 'no such route: ' + request.method + ' ' + url)
      return
    }
    const { route, path } = parsed

    if (path === '/models' && (request.method === 'GET' || request.method === 'HEAD')) {
      await listModels(route, response)
      return
    }
    if (path === '/chat/completions' && request.method === 'POST') {
      await chat(route, request, response)
      return
    }
    if (path === '/images/generations' && request.method === 'POST') {
      await media(route, request, response, 'images')
      return
    }
    if (path === '/videos/generations' && request.method === 'POST') {
      await media(route, request, response, 'videos')
      return
    }
    if (path === '/audio/transcriptions' && request.method === 'POST') {
      await audioTranscribe(route, request, response)
      return
    }
    writeOpenAiError(response, 404, 'not_found', 'no such route: ' + request.method + ' ' + url)
  }

  /** 模型清单：签名器路由走上游发现，其余透传 upstream+/models，均失败时回落配置。 */
  async function listModels(route, response) {
    // 自带凭据路由的地址与鉴权头可能在账号文件里（卡片填的），这里同样实时取。
    const override = route.credentialed ? credentialOverride(route, await resolveCredential(route.id)) : undefined
    const upstreamBase = override?.baseUrl ?? route.upstream
    /**
     * 透传路由（passthroughAuth）的真实鉴权头。
     *
     * route.apiKey 对透传路由只是占位值（sk-passthrough-placeholder），拿它去打上游
     * /v1/models 一定 401；401 后本函数回落到 route.models 并打上 `_apiRulesFallback`，
     * 而 syncModels 对 fallback 是整条跳过 —— 于是「面板加回上游」之后 provider 块
     * 永远是空的、模型选择器里一个模型都没有。所以这里必须按 apiKeyEnv 去 DSH 凭据
     * 取真密钥。取不到就保持原行为（回落），绝不因为读凭据失败而让 /models 报错。
     */
    let discoveredAuthorization
    if (route.passthroughAuth === true && typeof route.apiKeyEnv === 'string' && route.apiKeyEnv !== '') {
      try {
        const resolved = await resolveEnvCredential(route.apiKeyEnv)
        const value = typeof resolved === 'string' ? resolved : resolved?.value
        if (typeof value === 'string' && value !== '') {
          discoveredAuthorization = /^Bearer\s/iu.test(value) ? value : 'Bearer ' + value
        }
      } catch (error) {
        logger?.debug?.('[api-rules] ' + route.id + ' 读取凭据 ' + route.apiKeyEnv + ' 失败: ' + String(error))
      }
    }
    const signer = route.signer ? signers[route.signer] : undefined
    if (signer?.discoverModels !== undefined) {
      try {
        const result = await signer.discoverModels(await resolveCredential(route.id))
        writeJson(response, 200, {
          object: 'list',
          data: result.models.map((model) => signer.toOpenAiModel(model)),
          /** 签名器自身用了兜底清单时为真：同步读到会整条跳过，避免拿旧清单裁掉声明。 */
          _apiRulesFallback: result.fallbackUsed === true,
        })
        return
      } catch (error) {
        logger?.debug?.('[api-rules] ' + route.id + ' model discovery failed: ' + String(error))
      }
    } else if (upstreamBase) {
      try {
        const upstream = await fetch(upstreamBase + '/models', {
          headers: authHeaders(route, {}, override, discoveredAuthorization),
          signal: AbortSignal.timeout(route.probeTimeoutMs ?? 5000),
        })
        if (!upstream.ok) throw new Error('upstream ' + upstream.status)
        const body = await upstream.json()
        writeJson(response, 200, body)
        return
      } catch (error) {
        logger?.debug?.('[api-rules] ' + route.id + ' model list failed: ' + String(error))
      }
    }
    const fallback = route.models ?? []
    writeJson(response, 200, {
      object: 'list',
      _apiRulesFallback: true,
      data: fallback.map((model) => ({
        id: model.id,
        object: 'model',
        created: 0,
        owned_by: route.id,
        name: model.name ?? model.id,
        context_window: model.contextWindow,
        max_tokens: model.maxTokens,
      })),
    })
  }

  /**
   * 自带凭据路由的「地址 + 鉴权头」覆盖。
   *
   * 存储里给了就用存储的（用户粘贴的 Authorization 原样送出，不强制加 `Bearer `），
   * 存储为空则返回 undefined，调用方回落到 patch 里的 upstream/apiKey —— 于是
   * 「装了插件还没配」的机器行为与以前完全一致，配了就直接打自己的上游。
   */
  function credentialOverride(route, credential) {
    if (route.credentialed !== true) return undefined
    if (credential === undefined || credential === null || typeof credential !== 'object') return undefined
    const baseUrl = typeof credential.baseUrl === 'string' ? credential.baseUrl.trim().replace(/\/+$/u, '') : ''
    const authorization = typeof credential.authorization === 'string' ? credential.authorization.trim() : ''
    if (baseUrl === '' && authorization === '') return undefined
    return { baseUrl: baseUrl !== '' ? baseUrl : route.upstream, authorization }
  }

  /**
   * 一条路由的鉴权头。上游凭证由配置或账号文件给出；没有就留空，交给下游网关自己解决。
   * passthroughAuth=true 时改用「透传」：把 DSH 核心发来的 Authorization 原样转交上游。
   * 这让 intern-ai 这类「密钥由 DSH 凭据（apiKeyEnv）持有、api-rules 只是中转」的路由不需要
   * 在本插件重复存一份密钥（也不必写进 accounts.json / patch），凭据始终只有一处真源。
   */
  function authHeaders(route, extra, override, passthroughAuthorization) {
    const headers = { 'Content-Type': 'application/json', ...extra }
    if (typeof passthroughAuthorization === 'string' && passthroughAuthorization !== '') {
      headers['Authorization'] = passthroughAuthorization
    } else if (typeof override?.authorization === 'string' && override.authorization !== '') {
      headers['Authorization'] = override.authorization
    } else if (typeof route.apiKey === 'string' && route.apiKey !== '') {
      headers['Authorization'] = 'Bearer ' + route.apiKey
    }
    return headers
  }

  async function chat(route, request, response) {
    // 走签名器的路由：取当前凭证（用户在卡片里改完即刻生效）并判定通道。
    const signer = route.signer ? signers[route.signer] : undefined
    let credential
    if (signer) {
      credential = await resolveCredential(route.id)
      if (!credential || !credential.ak || !credential.sk) {
        writeOpenAiError(response, 503, 'auth_missing', '码道账号未配置 AK/SK：请在设置 → 插件 → Codearts账号 中填写')
        return
      }
      // 通道判定依赖 agentModels 清单；首次聊天前若尚未发现则补一次（结果会被缓存）。
      if (!Array.isArray(signer.agentModels)) {
        try {
          const result = await signer.discoverModels(credential)
          signer.agentModels = result.agentModels
        } catch {
          signer.agentModels = []
        }
      }
    }

    // 自带凭据路由（credentialed）：凭据 = { baseUrl, authorization }，与签名器一样实时取，
    // 用户在卡片里改完立刻生效；卡片还没填时 authOverride 为 undefined，退回 patch 里的 upstream。
    const authOverride = signer === undefined && route.credentialed
      ? credentialOverride(route, await resolveCredential(route.id))
      : undefined

    // 透传鉴权（passthroughAuth）：把 DSH 核心发来的 Authorization 原样留到发送时转交上游。
    // 用于 intern-ai 这类「密钥由 DSH 凭据（apiKeyEnv）持有、本插件只做中转节流」的路由，
    // 密钥始终只有 DSH 凭据一处真源，本插件不重复存。优先级低于 credentialed 覆盖。
    const passthroughAuthorization = signer === undefined && route.passthroughAuth === true
      ? (request.headers?.['authorization'] ?? undefined)
      : undefined

    const raw = await readBody(request)
    let body
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      writeOpenAiError(response, 400, 'invalid_json', 'request body is not JSON')
      return
    }
    const model = typeof body['model'] === 'string' ? body['model'] : ''
    const modelInfo = modelInfoOf(route.id, model)

    // ---- 规则链：按顺序作用，后一个看到前一个的结果 ----
    const notes = []
    for (const pack of route.packs) {
      const outcome = pack.normalizeRequest({ body, model, modelInfo, route })
      if (outcome && typeof outcome === 'object') {
        if (outcome.body !== undefined) body = outcome.body
        if (Array.isArray(outcome.notes)) notes.push(...outcome.notes.map((note) => pack.name + ': ' + note))
      }
    }
    if (notes.length > 0) logger?.debug?.('[api-rules] ' + route.id + ' ' + model + ' ' + notes.join('; '))

    const wantStream = body['stream'] === true
    const controller = new AbortController()
    // 用户在 UI 上点停止：把上游连接也断开，否则上游那边会白占一个并发槽近 1 分钟。
    request.on('close', () => controller.abort())

    // ---- 并发闸门：只在配置了配额的路由上生效 ----
    // slot.release() 必须在请求真正结束时调用：对 holdMs === 0 的上游（同济 agi）
    // 槽位是随请求结束释放的，不归还会把这个路由永久锁死。
    const gate = gateOf(route)
    let releaseSlot
    if (gate !== undefined) {
      const slot = await gate.acquire([route.id], controller.signal)
      if (slot.key === undefined) {
        if (controller.signal.aborted) {
          response.end()
          return
        }
        writeOpenAiError(response, 503, 'gate_unavailable', route.id + ' 没有可用的并发槽位')
        return
      }
      releaseSlot = slot.release
    }
    // 无论后续走哪条分支（失败、流式、非流式）都要归还，所以挂在响应收尾上。
    if (releaseSlot !== undefined) response.on('close', releaseSlot)

    const packs = route.packs
    const payload = JSON.stringify(body)

    // ---- 事前节流：规则包可实现 async throttle({route,model,body,signal}) 在发送前按配额等待 ----
    // 与被动「撞 429 再退避」互补：让实现方（如 intern-ai 的 RPM/TPM 令牌桶）在请求发出前主动
    // 卡住，从源头减少 429。没实现 throttle 的规则包完全不受影响（跳过即可）。
    for (const pack of packs) {
      if (typeof pack.throttle !== 'function') continue
      await pack.throttle({ route, model, body, signal: controller.signal })
    }

    // 签名器路由：预计算聊天签名头（必须在规则改完 body 之后、发送之前）。
    // 单一 AgentCenter 通道，不再区分 benefit——签名只含 host/content-type/x-sdk-date。
    let preHeaders
    if (signer) {
      preHeaders = signer.signChatHeaders(credential, payload, {
        agentType: signer.agentType,
        baseUrl: signer.chatBase,
      })
    }

    let upstream
    try {
      upstream = await postWithRetry({ route, payload, packs, model, preHeaders, authOverride, passthroughAuthorization, signal: controller.signal, logger })
    } catch (error) {
      const status = error?.status ?? 502
      if (error?.body !== undefined) {
        // 规则包翻译过的错误：原样回传它给的 { error: { message, type, code } }。
        writeJson(response, status, error.body)
        return
      }
      writeOpenAiError(response, status, error?.kind ?? 'upstream_error', error?.detail ?? String(error))
      return
    }

    if (wantStream) {
      const sendRequest = async (modifiedBody) => {
        const newPayload = JSON.stringify(modifiedBody)
        return await postWithRetry({ route, payload: newPayload, packs, model, preHeaders, authOverride, passthroughAuthorization, signal: controller.signal, logger })
      }
      await pipeStream({ route, packs, model, upstream, response, signal: controller.signal, logger, body, sendRequest })
      return
    }
    await collectJson({ route, packs, model, upstream, response, logger })
  }

  /**
   * 发上游请求，按规则包判定重试。
   *
   * 重试分两类，退避量级差一个数量级：并发上限（TM.00001041）按槽位 TTL 的 25/40 秒
   * 走，并且带全局冷却；网关抖动按 5/10/20 秒走。把它们混成一套退避是 Python 版踩过
   * 的坑——8 秒封顶会在槽位还没释放时连试 4 次然后放弃。
   */
  /**
   * 生图 / 生视频转发（goal-58ba6a2c）。
   *
   * chat() 只走 /chat/completions，模型选择器对回环路由没有任何生图/生视频调用链路，
   * 故这里补一条通用转发：把 DSH 侧（设置卡片 → 宿主 /api/api-rules/media-generate）
   * 收到的 OpenAI 风格 body 原样 POST 到 upstream/{images|videos}/generations，
   * 上游返回什么就回什么（生图 data[{url}]、生视频 url/task 等）。
   *
   * 与 chat() 的差异（都是刻意的，不是偷工减料）：
   *   - 不走规则链 pack.normalizeRequest：媒体 body 不是 chat 格式，规则包会判不出
   *     model/消息而误改。生图/生视频目前无需敏感词拦截，上游自己会拒。
   *   - 不做流式：images/videos 都是同步返回最终 JSON，无 SSE。
   *   - 不做重试退避：媒体上游慢（生图 10s、生视频 20s～30 分钟），重试会把慢请求
   *     翻倍；失败直接回给客户端让用户改参重试。
   *   - 超时用 mediaTimeoutMs（默认 600s，视频慢档靠它在长任务上多等；生视频慢档
   *     返回 task id 而非阻塞，快档同步等 ≤30s 也够）。
   *
   * 签名器路由不支持媒体：huawei 签名器只实现了 chat 的签名通道，生图/生视频通道
   * 上游（ModelArts/华为云）协议不同，这里直接 400。
   */
  async function media(route, request, response, kind) {
    if (route.signer) {
      writeOpenAiError(response, 400, 'media_not_supported', '签名器路由 ' + route.id + ' 暂不支持生图/生视频（仅 chat）')
      return
    }
    const override = route.credentialed ? credentialOverride(route, await resolveCredential(route.id)) : undefined
    const upstreamBase = override?.baseUrl ?? route.upstream
    if (!upstreamBase) {
      writeOpenAiError(response, 503, 'no_upstream', '路由 ' + route.id + ' 没有可用的上游地址')
      return
    }

    let payload
    try {
      payload = await readBody(request)
    } catch (error) {
      writeOpenAiError(response, 400, 'invalid_request', '读取请求体失败: ' + String(error))
      return
    }

    const endpoint = upstreamBase + '/' + kind + '/generations'
    const timeoutMs = route.mediaTimeoutMs ?? 600_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let upstream
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(route, {}, override),
        body: payload,
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      const aborted = controller.signal.aborted === true
      writeOpenAiError(response, aborted ? 504 : 502, aborted ? 'media_timeout' : 'media_upstream_error',
        (aborted ? '生图/生视频超时（' + Math.round(timeoutMs / 1000) + 's）' : '上游请求失败') + ': ' + String(error?.cause ?? error))
      return
    }

    // 媒体上游错误格式与 chat 不同（minimax 抛 JSON、loomy 抛字符串），不套
    // translateBusinessError，按 HTTP 状态码 + 原始 body 回给客户端即可。
    const text = await upstream.text()
    clearTimeout(timer)
    if (!upstream.ok) {
      let detail = text
      try { detail = JSON.stringify(JSON.parse(text)) } catch { /* 原文回传 */ }
      writeOpenAiError(response, upstream.status, 'media_upstream_error', '上游 ' + upstream.status + ': ' + detail.slice(0, 500))
      return
    }
    let result
    try { result = JSON.parse(text) } catch { result = { raw: text } }
    writeJson(response, 200, result)
  }

  /**
   * 语音转文字透传（whisper）：客户端 POST multipart/form-data 到
   * /<routeId>/v1/audio/transcriptions，本函数原样转发到上游 nonstandard asr 端点。
   *
   * 与 media() 的差异（都是刻意的）：
   *   - endpoint 写死 /nonstandard/asr/whisper（同济 ASR 的真实路径），不是 /audio/transcriptions。
   *     baseUrl 末尾若带 /v1 则剥掉，避免拼出 /v1/nonstandard/... 404。
   *   - body 是 multipart/form-data，必须把客户端原始 Content-Type（含 boundary）透传上去，
   *     不能像 chat() 那样强制 application/json。
   *   - 上游可能返回 text/plain（whisper 常见）或 JSON { text }，原样回写不二次包装。
   *   - 不做重试退避：转写是同步阻塞任务，重试会把长音频请求翻倍。
   *
   * 签名器路由不支持 ASR（华为云签名器只实现 chat），直接 400。
   */
  async function audioTranscribe(route, request, response) {
    if (route.signer) {
      writeOpenAiError(response, 400, 'audio_not_supported', '签名器路由 ' + route.id + ' 暂不支持语音转文字（仅 chat）')
      return
    }
    const override = route.credentialed ? credentialOverride(route, await resolveCredential(route.id)) : undefined
    const upstreamBase = override?.baseUrl ?? route.upstream
    if (!upstreamBase) {
      writeOpenAiError(response, 503, 'no_upstream', '路由 ' + route.id + ' 没有可用的上游地址')
      return
    }

    let payload
    try {
      payload = await readBody(request)
    } catch (error) {
      writeOpenAiError(response, 400, 'invalid_request', '读取请求体失败: ' + String(error))
      return
    }

    // 剥掉 baseUrl 末尾的 /v1（同济 baseUrl 是 https://agi.tongji.edu.cn/v1，但 asr 端点在根下）。
    const siteBase = upstreamBase.replace(/\/v1\/?$/u, '')
    const endpoint = siteBase + '/nonstandard/asr/whisper'
    const timeoutMs = route.mediaTimeoutMs ?? 600_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // 鉴权：透传路由按 apiKeyEnv 去 DSH 凭据取真密钥（占位 bearer 打上游必 401）。
    const headers = { 'Content-Type': request.headers['content-type'] ?? 'multipart/form-data' }
    if (typeof override?.authorization === 'string' && override.authorization !== '') {
      headers.Authorization = override.authorization
    } else if (route.passthroughAuth === true && typeof route.apiKeyEnv === 'string' && route.apiKeyEnv !== '') {
      try {
        const resolved = await resolveEnvCredential(route.apiKeyEnv)
        const value = typeof resolved === 'string' ? resolved : resolved?.value
        if (typeof value === 'string' && value !== '') {
          headers.Authorization = /^Bearer\s/iu.test(value) ? value : 'Bearer ' + value
        }
      } catch (error) {
        logger?.debug?.('[api-rules] ' + route.id + ' 读取凭据 ' + route.apiKeyEnv + ' 失败: ' + String(error))
      }
    } else if (typeof route.apiKey === 'string' && route.apiKey !== '') {
      headers.Authorization = 'Bearer ' + route.apiKey
    }

    let upstream
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      const aborted = controller.signal.aborted === true
      writeOpenAiError(response, aborted ? 504 : 502, aborted ? 'audio_timeout' : 'audio_upstream_error',
        (aborted ? '语音转文字超时（' + Math.round(timeoutMs / 1000) + 's）' : '上游请求失败') + ': ' + String(error?.cause ?? error))
      return
    }

    const text = await upstream.text()
    clearTimeout(timer)
    if (!upstream.ok) {
      let detail = text
      try { detail = JSON.stringify(JSON.parse(text)) } catch { /* 原文回传 */ }
      writeOpenAiError(response, upstream.status, 'audio_upstream_error', '上游 ' + upstream.status + ': ' + detail.slice(0, 500))
      return
    }
    // 上游可能是 text/plain（whisper 常见，直接是转写文本）或 JSON { text } / { segments }。
    const upstreamContentType = upstream.headers?.get?.('content-type') ?? ''
    if (/application\/json/iu.test(upstreamContentType)) {
      let result
      try { result = JSON.parse(text) } catch { result = { raw: text } }
      writeJson(response, 200, result)
    } else {
      // text/plain：包一层 JSON 让 DSH 工具侧能按 data.text 取值，同时保留 raw 原文。
      writeJson(response, 200, { text: text, model: 'Whisper', object: 'audio.transcription' })
    }
  }

  async function postWithRetry({ route, payload, packs, model, preHeaders, authOverride, passthroughAuthorization, signal, logger }) {
    const maxAttempts = Math.max(
      1,
      ...packs.map((pack) => (typeof pack.maxAttempts === 'function' ? pack.maxAttempts() : DEFAULT_MAX_ATTEMPTS)),
    )
    let lastStatus = 502
    let lastText = ''
    const started = Date.now()

    // 签名器路由直连华为云：url 由 chatBase 拼聊天路径；自带凭据路由用卡片里填的地址；
    // 其余透传配置里的 upstream。
    const signerForUrl = route.signer ? signers[route.signer] : undefined
    const chatUrl = signerForUrl
      ? signerForUrl.chatBase + '/chat/completions'
      : (authOverride?.baseUrl ?? route.upstream) + '/chat/completions'

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal.aborted) throw abortError()
      if (attempt > 0) await waitCooldown(route, signal)

      let response
      try {
        // 预签名头（华为）直接用于发送；自带凭据路由用卡片里的 Authorization；
        // 否则走通用鉴权头（Bearer）。
        const headers = preHeaders ?? authHeaders(route, undefined, authOverride, passthroughAuthorization)
        response = await fetch(chatUrl, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.any([signal, AbortSignal.timeout(route.timeoutMs ?? UPSTREAM_TIMEOUT_MS)]),
        })
      } catch (error) {
        if (signal.aborted) throw abortError()
        lastStatus = 502
        lastText = String(error)
        const pack = packs[0]
        if (pack && attempt + 1 < maxAttempts) {
          await sleepFor(pack.backoffMs({ attempt, concurrency: false }), signal)
          continue
        }
        throw upstreamError(502, 'upstream_error', 'upstream connection error: ' + String(error))
      }

      if (response.ok) return response

      lastStatus = response.status
      // 读取上游的 Retry-After 头（429/503 常带），让规则包能精确等待而不是盲退避。
      let retryAfterMs = 0
      try {
        const retryAfter = response.headers?.get?.('retry-after')
        if (typeof retryAfter === 'string' && retryAfter.trim() !== '') {
          const seconds = Number(retryAfter.trim())
          if (Number.isFinite(seconds)) retryAfterMs = Math.max(0, seconds * 1000)
        }
      } catch {
        retryAfterMs = 0
      }
      try {
        lastText = (await response.text()).slice(0, 2000)
      } catch {
        lastText = ''
      }

      const retryable = packs.some((pack) => pack.isRetryable({ status: lastStatus, text: lastText }))
      const concurrency = packs.some((pack) => pack.isConcurrencyError(lastText))
      if (!retryable || attempt + 1 >= maxAttempts) break

      const pack = packs[0]
      const backoff = pack.backoffMs({ attempt, concurrency, retryAfterMs, model })
      if (concurrency || (retryAfterMs > 0 && lastStatus === 429)) {
        const budget = pack.retryBudgetMs(true)
        if (Date.now() - started + backoff > budget) {
          logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 并发上限重试预算已用尽，放弃')
          break
        }
        // 登记全局冷却：让同时在飞的请求一起等，而不是各自退避后再一起撞上限。
        // 429 带 Retry-After 时也一起冷却，避免别的在飞请求紧接着又撞同一个限。
        cooldowns.set(route.id, Date.now() + pack.cooldownMs({ retryAfterMs }))
      }
      logger?.debug?.(
        '[api-rules] ' +
          route.id +
          ' ' +
          model +
          ': 上游 ' +
          lastStatus +
          (concurrency ? '（并发上限）' : '') +
          '，退避 ' +
          Math.round(backoff / 1000) +
          's 后重试 (' +
          (attempt + 1) +
          '/' +
          maxAttempts +
          ')',
      )
      await sleepFor(backoff, signal)
    }

    // 非 2xx 也要走规则包的业务错误翻译：同济的 403「当前网络环境不支持」、
    // 429「并发请求数已达套餐上限」都是可操作的诊断信息，原样抛出「upstream 403: {...}」
    // 等于把最有用的那句话埋进 JSON 里。翻译不出就保持原样（绝不吞掉上游原文）。
    const business = businessErrorOf(packs, lastText, model)
    if (business !== undefined) {
      const translated = upstreamError(
        statusForError(packs, business, { model }),
        business.error.code ?? 'upstream_error',
        business.error.message,
      )
      // 把规则包产出的完整错误体挂上去：它的 `type` 比通用 kind 更有信息量
      // （rate_limit_error / upstream_error），写回客户端时原样用它。
      translated.body = business
      throw translated
    }
    throw upstreamError(lastStatus, 'upstream_error', 'upstream ' + lastStatus + ': ' + lastText)
  }

  /**
   * 把上游错误原文交给规则包翻译。
   *
   * 上游错误体有时是 JSON、有时是纯文本，两种都试：JSON 能被规则包读到
   * `chunk.error.message` 的完整结构；纯文本就退化成 `{ error: { message: 原文 } }`，
   * 规则包里的正则照样能匹配文案。翻译不出来一律返回 undefined。
   */
  function businessErrorOf(packs, text, model) {
    if (typeof text !== 'string' || text === '') return undefined
    let chunk
    try {
      chunk = JSON.parse(text)
    } catch {
      chunk = { error: { message: text } }
    }
    if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) return undefined
    const translated = translateBusinessError(packs, chunk, { model })
    return translated === undefined ? undefined : translated
  }

  /** 撞上限后的全局冷却。 */
  const cooldowns = new Map()
  async function waitCooldown(route, signal) {
    const until = cooldowns.get(route.id) ?? 0
    const remaining = until - Date.now()
    if (remaining > 0) await sleepFor(remaining, signal)
  }

  /**
   * 流式转发。
   *
   * 上游可能：正常 SSE、把 JSON 当 SSE 发、或者在 HTTP 200 的流里用 error_code 表示
   * 业务失败。三种都必须翻成客户端认得的形状，否则 DSH 会把空流当正常结束。
   */
  async function pipeStream({ route, packs, model, upstream, response, signal, logger, body, sendRequest }) {
    const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase()
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // 上游忽略了 stream=true、直接返回 JSON：包成单帧 SSE。
    if (!contentType.includes('text/event-stream')) {
      try {
        const text = await upstream.text()
        const result = JSON.parse(text)
        for (const choice of result['choices'] ?? []) {
          choice['finish_reason'] = finishReasonOf(packs, choice['finish_reason'])
        }
        response.write('data: ' + JSON.stringify(result) + '\n\n')
      } catch (error) {
        response.write('data: ' + JSON.stringify({ error: { message: String(error), type: 'upstream_error' } }) + '\n\n')
      }
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }

    const reader = upstream.body?.getReader()
    if (reader === undefined) {
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }

    let buffer = ''
    let sawFinishReason = false
    let sentAnything = false
    let sawContent = false
    let sawToolCall = false
    // 思考死循环检测：累积 reasoning_content 全文 + 思考帧数，逐帧问规则包是否触顶。
    // spark-x2.6 对某些输入推理不收敛，reasoning_content 无限生成直到把 max_tokens
    // 预算耗尽（实测两次 955s / 输出恰好 131072）。这里在框架侧只做「累积 + 逐帧问」，
    // 是否构成死循环、该发什么收尾帧，全部交给规则包的 thinkingLimitFrame 钩子判定
    // （与 streamAbortFrame 同构：框架不写死任何上游专属阈值/文案）。
    let reasoningText = ''
    let reasoningChunks = 0
    // 累积正文全文，供「答一步就停」检测用（qoder QoDuck 模型常见早停）。
    let contentText = ''
    // 正文死循环检测（2026-11-15）：正文帧计数，与 contentText 一起逐帧送给规则包的
    // contentLimitFrame 钩子（与 reasoningChunks / thinkingLimitFrame 同构）。
    // spark-x2.6 在长上下文下会把工具调用闭合标记当正文无限刷（实测 `</invoke>` 重复到
    // 19 万字符），正文阶段原先没有任何守卫，只能等客户端超时或用户手动打断。
    let contentChunks = 0
    // 纯思考截断、零正文时的空流重试（跨平台通用，2026-11-08）。
    // reasoning 模型在思考阶段被读超时 / 网关空闲超时 / 网络抖动掐断时，往往只发过
    // reasoning_content、没正文没工具调用没 finish_reason。此时正文一个字都没发给客户端
    // （reasoning 是一次性草稿，客户端本就不当答案），重发一次原始请求是安全的——与
    // 「答一步就停」续推同构，但这里是「整段重来」而非「追加继续指令」。重试拿到的帧
    // 接进同一个 SSE 流，客户端无感。重试几次交给规则包 maxStreamAbortRetries 钩子。
    let abortRetried = false
    const isThinkingAbort = () => !sawFinishReason && !sawContent && !sawToolCall
    // spark 流式分片修复（2026-11-13）：function.arguments 分片到达时，单片既不以 { 开头
    // 也不以 } 结尾，normalizeDelta 的守卫会原样放行、修复从未在完整对象上运行。这里把含
    // tool_calls 的 chunk 缓冲，等 finish_reason 到达时对拼接后的完整 args 修一次再 flush。
    const toolBuf = new ToolCallFragmentBuffer()

    /**
     * 中途死循环收尾（2026-11-15）：写规则包给的终止帧 + [DONE]、结束响应、掐断上游读流。
     * 思考阶段（thinkingLimitFrameOf）与正文阶段（contentLimitFrameOf）共用同一收尾动作，
     * 避免两处各写一遍「写帧 + 写 DONE + cancel + return」而漏掉某一步。
     * 帧由规则包给：框架不写死任何上游专属阈值/文案。
     */
    const terminateStreamWithFrame = (frame, why, cancelReader) => {
      logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': ' + why + ' ' + JSON.stringify(frame))
      response.write('data: ' + JSON.stringify(frame) + '\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
      try { cancelReader?.cancel?.().catch(() => {}) } catch {}
    }

    /**
     * 把一个上游响应的 SSE 帧接进同一个客户端流，并更新上面的追踪标记。
     * 返回命中的业务错误帧（调用方负责写错误+[DONE]+end），没有则返回 null。
     */
    async function pumpResponseIntoStream(resp) {
      const r = resp?.body?.getReader()
      if (r === undefined) return null
      let buf = ''
      for (;;) {
        const { done, value } = await r.read()
        if (done) break
        if (signal.aborted) break
        buf += Buffer.from(value).toString('utf8')
        let b = buf.indexOf('\n\n')
        while (b !== -1) {
          const f = buf.slice(0, b)
          buf = buf.slice(b + 2)
          b = buf.indexOf('\n\n')
          if (f.trim() === '') continue
          for (const line of f.split('\n')) {
            const t = line.trim()
            if (t === '') continue
            if (!t.startsWith('data:')) {
              if (t.startsWith(':')) response.write(line + '\n\n')
              continue
            }
            const p = t.slice(5).trim()
            if (p === '[DONE]') continue
            let c
            try { c = JSON.parse(p) } catch { continue }
            const business = translateBusinessError(packs, c, { model })
            if (business !== undefined) return business
            for (const choice of c['choices'] ?? []) {
              if (choice['finish_reason'] !== null && choice['finish_reason'] !== undefined) {
                sawFinishReason = true
                choice['finish_reason'] = finishReasonOf(packs, choice['finish_reason'])
                // finish 帧前先刷缓冲的工具调用（对完整 args 修复后再写），保证 finish_reason 在最后。
                toolBuf.flush((o) => { response.write('data: ' + JSON.stringify(o) + '\n\n'); sentAnything = true })
              }
              for (const pack of packs) pack.normalizeDelta(choice['delta'])
              const d = choice['delta'] ?? {}
              if (typeof d['content'] === 'string' && d['content'] !== '') {
                sawContent = true
                contentText += d['content']
              }
              if (Array.isArray(d['tool_calls']) && d['tool_calls'].length > 0) sawToolCall = true
            }
            // 正文死循环检测（2026-11-15）：空流重试（retryEmptyStream）走的这条
            // pump 路径此前同样没有任何守卫；退化流会在这里一直 pump 到客户端超时。
            // 命中就把终止帧当作「业务帧」返回，由调用方写帧 + [DONE] + end。
            if (sawContent && !sawToolCall && !sawFinishReason) {
              const pumpContentMeta = { contentText, contentChunks, sawContent, sawToolCall, sawFinishReason }
              const pumpContentFrame = contentLimitFrameOf(packs, pumpContentMeta)
              if (pumpContentFrame !== undefined) {
                try { r.cancel().catch(() => {}) } catch {}
                return pumpContentFrame
              }
            }
            if (!toolBuf.push(c)) {
              response.write('data: ' + JSON.stringify(c) + '\n\n')
              sentAnything = true
            }
          }
        }
      }
      return null
    }

    /**
     * 空流重试：重发原始 body，做一次全新尝试。
     * 返回 'recovered'（拿到正文/工具调用/finish_reason）| 'exhausted'（预算用尽仍空流）
     * | 'ended'（重试响应里出现业务错误帧，已写错误+[DONE] 并 end）。
     */
    async function retryEmptyStream() {
      const maxRetries = Math.max(0, ...packs.map((p) => (typeof p.maxStreamAbortRetries === 'function' ? p.maxStreamAbortRetries() : 1)))
      abortRetried = true
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        if (signal.aborted) return 'exhausted'
        logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 思考阶段空流截断（无正文），空流重试 ' + attempt + '/' + maxRetries)
        let retryUpstream
        try {
          retryUpstream = await sendRequest(body) // 重发原始请求
        } catch (e) {
          logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 空流重试请求失败: ' + String(e))
          return 'exhausted'
        }
        let businessFrame = null
        try {
          businessFrame = await pumpResponseIntoStream(retryUpstream)
        } catch (e) {
          logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 空流重试读取失败: ' + String(e))
          return 'exhausted'
        }
        if (businessFrame !== null) {
          response.write('data: ' + JSON.stringify(businessFrame) + '\n\n')
          response.write('data: [DONE]\n\n')
          response.end()
          return 'ended'
        }
        if (!isThinkingAbort()) return 'recovered'
      }
      return isThinkingAbort() ? 'exhausted' : 'recovered'
    }

    /** 正常收尾：能补干净 stop 就补，否则问规则包要断流帧（附诊断元数据），最后补 [DONE]。 */
    function finalizeNormalEnd() {
      // 兜底刷缓冲的工具调用：finish_reason 已在流内触发过 flush 时 pending 为空（no-op）；
      // 断流/未收到 finish_reason 时这里把已缓冲的调用修一次再写，避免丢调用。
      toolBuf.flush((o) => { response.write('data: ' + JSON.stringify(o) + '\n\n'); sentAnything = true })
      const meta = { sawFinishReason, sentAnything, sawContent, sawToolCall, contentText }
      const needsFinish = !sawFinishReason && packs.some((pack) => pack.ensureFinishReason(model, meta))
      if (needsFinish) {
        response.write(
          'data: ' +
            JSON.stringify({
              id: 'api-rules-finish',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            }) +
            '\n\n',
        )
      } else {
        // 规则包拒绝补 stop：问它「这轮该发什么收尾帧」。框架里不写死任何
        // 上游专属文案/判定；没实现该钩子的规则包得到 undefined，维持原行为。
        const frame = streamAbortFrameOf(packs, meta)
        if (frame !== undefined) {
          attachStreamAbortMeta(frame, { sawFinishReason, sawContent, sawToolCall, sentAnything, abortRetried })
          response.write('data: ' + JSON.stringify(frame) + '\n\n')
        }
      }
      // 无条件补一帧 [DONE]：主循环遇到上游 [DONE] 只置标记没转发，这里必须补。
      response.write('data: [DONE]\n\n')
      response.end()
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal.aborted) break
        buffer += Buffer.from(value).toString('utf8')

        // SSE 帧以空行分隔；不完整的尾部留在 buffer 里等下一块。
        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
          if (frame.trim() === '') continue
          for (const line of frame.split('\n')) {
            const trimmed = line.trim()
            if (trimmed === '') continue
            if (!trimmed.startsWith('data:')) {
              // 注释行（: keep-alive）原样转发，客户端靠它续命。
              if (trimmed.startsWith(':')) response.write(line + '\n\n')
              continue
            }
            const payload = trimmed.slice(5).trim()
            if (payload === '[DONE]') {
              // 上游的终止帧不在这里转发，结尾统一写一帧，保证恰好一次。
              // （早先这里是 continue + 结尾 if (!sawDone)，结果是上游发了 DONE
              //   反而一帧都不转发，客户端永远等不到终止帧。）
              continue
            }
            let chunk
            try {
              chunk = JSON.parse(payload)
            } catch {
              continue
            }
            // 业务错误帧：必须翻译并终止，不能当成正文转发。
            const business = translateBusinessError(packs, chunk, { model })
            if (business !== undefined) {
              logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 流内业务错误 ' + JSON.stringify(business))
              response.write('data: ' + JSON.stringify(business) + '\n\n')
              response.write('data: [DONE]\n\n')
              response.end()
              return
            }
            for (const choice of chunk['choices'] ?? []) {
              if (choice['finish_reason'] !== null && choice['finish_reason'] !== undefined) {
                sawFinishReason = true
                choice['finish_reason'] = finishReasonOf(packs, choice['finish_reason'])
                toolBuf.flush((o) => { response.write('data: ' + JSON.stringify(o) + '\n\n'); sentAnything = true })
              }
              for (const pack of packs) pack.normalizeDelta(choice['delta'])
              const delta = choice['delta'] ?? {}
              if (typeof delta['content'] === 'string' && delta['content'] !== '') {
                sawContent = true
                contentText += delta['content']
                contentChunks += 1
              }
              if (Array.isArray(delta['tool_calls']) && delta['tool_calls'].length > 0) sawToolCall = true
              // 累积思考文本，供死循环检测用（reasoning_content 是 CoT 草稿，丢
              // 弃不影响最终答案；content/tool_calls 一旦出现说明模型已收敛，不再检测）。
              if (typeof delta['reasoning_content'] === 'string') {
                reasoningText += delta['reasoning_content']
                reasoningChunks += 1
              }
            }
            // 思考死循环检测：已收敛（出正文/工具调用/finish_reason）就不必再查；
            // 否则把「思考全文 + 帧数 + 是否已收尾」交给规则包判定，命中就立刻掐断。
            if (!sawContent && !sawToolCall && !sawFinishReason) {
              const limitMeta = { reasoningText, reasoningChunks, sawFinishReason, sawContent, sawToolCall }
              const limitFrame = thinkingLimitFrameOf(packs, limitMeta)
              if (limitFrame !== undefined) {
                terminateStreamWithFrame(limitFrame, '检测到思考死循环，主动终止流', reader)
                return
              }
            }
            // 正文死循环检测（2026-11-15）：已经在出正文、还没有工具调用、也没有
            // finish_reason 时，把「正文全文 + 帧数」交给规则包判定。spark-x2.6 长上下文
            // 下会把工具调用闭合标记当正文无限刷（实测 `</invoke>` 重复到 19 万字符），
            // 这一段此前完全没有守卫，只能等客户端超时或用户手动打断。命中即掐断。
            if (sawContent && !sawToolCall && !sawFinishReason) {
              const contentMeta = { contentText, contentChunks, sawContent, sawToolCall, sawFinishReason }
              const contentFrame = contentLimitFrameOf(packs, contentMeta)
              if (contentFrame !== undefined) {
                terminateStreamWithFrame(contentFrame, '检测到正文死循环，主动终止流', reader)
                return
              }
            }
            if (!toolBuf.push(chunk)) {
              response.write('data: ' + JSON.stringify(chunk) + '\n\n')
              sentAnything = true
            }
          }
        }
      }

      // 「答一步就停」续推：检测到有文本无工具调用+stop=stop，追加"继续"消息重发一次。
      // QoDuck (lmodel) 在长上下文下常见——模型说「让我检查...」但没真正发工具调用就停了。
      // 续推的响应接着写进同一个 SSE 流，客户端无感（看到的是连续的一次响应）。
      if (!signal.aborted) {
        const incompleteMeta = { sawFinishReason, sentAnything, sawContent, sawToolCall, contentText }
        const isIncomplete = packs.some((pack) => pack.isIncompleteTurn?.(model, incompleteMeta))
        if (isIncomplete && typeof sendRequest === 'function' && body && Array.isArray(body['messages'])) {
          const continuationPack = packs.find((p) => typeof p.incompleteTurnMessages === 'function')
          if (continuationPack !== undefined) {
            const maxRetries = continuationPack.maxIncompleteTurnRetries?.() ?? 1
            for (let retryNum = 0; retryNum < maxRetries; retryNum++) {
              const continuationMessages = continuationPack.incompleteTurnMessages(body['messages'], contentText)
              const modifiedBody = { ...body, messages: continuationMessages }
              logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 检测到不完整轮（有文本无工具调用+stop=stop），续推重试 (' + (retryNum + 1) + '/' + maxRetries + ')')
              try {
                const retryUpstream = await sendRequest(modifiedBody)
                const retryReader = retryUpstream.body?.getReader()
                if (retryReader === undefined) break
                let retryBuffer = ''
                // 续推轮自己的追踪量（2026-11-15）：全局 sawFinishReason 在启动续推前
                // 就已经是 true（上一轮以 stop 收尾），用它当条件会让续推轮的正文守卫
                // 永远不触发。这里单独记本轮的内容与终态，并把「本轮自己吐出的正文」
                // 交给规则包判定——规则包自带的 800 字窗口顺带成为闸门：续推轮必须自己
                // 先吐出 800 字，才可能被判死循环，不会一开轮就凭上一轮的尾巴误杀。
                let retryContentText = ''
                let retryContentChunks = 0
                let retrySawToolCall = false
                let retrySawFinishReason = false
                for (;;) {
                  const { done, value } = await retryReader.read()
                  if (done) break
                  if (signal.aborted) break
                  retryBuffer += Buffer.from(value).toString('utf8')
                  let retryBoundary = retryBuffer.indexOf('\n\n')
                  while (retryBoundary !== -1) {
                    const retryFrame = retryBuffer.slice(0, retryBoundary)
                    retryBuffer = retryBuffer.slice(retryBoundary + 2)
                    retryBoundary = retryBuffer.indexOf('\n\n')
                    if (retryFrame.trim() === '') continue
                    for (const retryLine of retryFrame.split('\n')) {
                      const retryTrimmed = retryLine.trim()
                      if (retryTrimmed === '') continue
                      if (!retryTrimmed.startsWith('data:')) {
                        if (retryTrimmed.startsWith(':')) response.write(retryLine + '\n\n')
                        continue
                      }
                      const retryPayload = retryTrimmed.slice(5).trim()
                      if (retryPayload === '[DONE]') continue
                      let retryChunk
                      try { retryChunk = JSON.parse(retryPayload) } catch { continue }
                      const retryBusiness = translateBusinessError(packs, retryChunk, { model })
                      if (retryBusiness !== undefined) {
                        logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 续推流内业务错误 ' + JSON.stringify(retryBusiness))
                        response.write('data: ' + JSON.stringify(retryBusiness) + '\n\n')
                        response.write('data: [DONE]\n\n')
                        response.end()
                        return
                      }
                      for (const retryChoice of retryChunk['choices'] ?? []) {
                        if (retryChoice['finish_reason'] !== null && retryChoice['finish_reason'] !== undefined) {
                          sawFinishReason = true
                          retrySawFinishReason = true
                          retryChoice['finish_reason'] = finishReasonOf(packs, retryChoice['finish_reason'])
                          toolBuf.flush((o) => { response.write('data: ' + JSON.stringify(o) + '\n\n'); sentAnything = true })
                        }
                        for (const retryPack of packs) retryPack.normalizeDelta(retryChoice['delta'])
                        const retryDelta = retryChoice['delta'] ?? {}
                        if (typeof retryDelta['content'] === 'string' && retryDelta['content'] !== '') {
                          sawContent = true
                          contentText += retryDelta['content']
                          contentChunks += 1
                          retryContentText += retryDelta['content']
                          retryContentChunks += 1
                        }
                        if (Array.isArray(retryDelta['tool_calls']) && retryDelta['tool_calls'].length > 0) {
                          sawToolCall = true
                          retrySawToolCall = true
                        }
                      }
                      // 正文死循环检测（2026-11-15）：续推流同样要查。这条循环原先没有任何
                      // 守卫，退化重试流会把「无限刷 `</invoke>`」一直灌到客户端超时。
                      if (!retrySawToolCall && !retrySawFinishReason && retryContentText !== '') {
                        const retryContentMeta = {
                          contentText: retryContentText,
                          contentChunks: retryContentChunks,
                          sawContent: true,
                          sawToolCall: false,
                          sawFinishReason: false,
                        }
                        const retryContentFrame = contentLimitFrameOf(packs, retryContentMeta)
                        if (retryContentFrame !== undefined) {
                          terminateStreamWithFrame(retryContentFrame, '检测到续推正文死循环，主动终止流', retryReader)
                          return
                        }
                      }
                      if (!toolBuf.push(retryChunk)) {
                        response.write('data: ' + JSON.stringify(retryChunk) + '\n\n')
                        sentAnything = true
                      }
                    }
                  }
                }
                // 续推后如果已经有工具调用或再次检测到不完整，决定是否继续循环
                const postRetryMeta = { sawFinishReason, sentAnything, sawContent, sawToolCall, contentText }
                if (postRetryMeta.sawToolCall === true) break
                if (!packs.some((pack) => pack.isIncompleteTurn?.(model, postRetryMeta))) break
              } catch (retryError) {
                logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 续推失败: ' + String(retryError))
                break
              }
            }
          }
        }
      }

      // 断流收尾前：若命中「纯思考截断、零正文」，先做跨平台空流重试（重发原始请求）。
      // 重试成功（拿到正文/工具调用/finish_reason）就按正常完成收尾；预算用尽仍空流，
      // 才落到底部发带诊断的断流帧。业务错误帧已在 retryEmptyStream 里写完并 end。
      if (sentAnything && isThinkingAbort()) {
        const outcome = await retryEmptyStream()
        if (outcome === 'ended') return
      }

      finalizeNormalEnd()
    } catch (error) {
      logger?.warn?.('[api-rules] ' + route.id + ' stream failed: ' + String(error))
      // 读体阶段抛错（典型：读超时 TimeoutError / 网关 10053）也是「纯思考截断」的高发
      // 路径，同样先给一次空流重试的机会；恢复了就按正常完成收尾。
      if (!sawFinishReason && sentAnything && isThinkingAbort()) {
        const outcome = await retryEmptyStream()
        if (outcome === 'ended') return
        if (outcome === 'recovered') {
          finalizeNormalEnd()
          return
        }
      }
      // 重试预算用尽（或本就不可重试）：补一帧带诊断的错误，别让客户端把思考草稿当
      // 成一次「干净完成」。帧由规则包给，框架只附 _streamAbort 元数据，不写死文案。
      if (!sawFinishReason) {
        const meta = { sawFinishReason, sentAnything, sawContent, sawToolCall, contentText }
        const frame = streamAbortFrameOf(packs, meta) ?? { error: { message: String(error), type: 'upstream_error' } }
        attachStreamAbortMeta(frame, { upstreamError: String(error) })
        response.write('data: ' + JSON.stringify(frame) + '\n\n')
      }
      response.write('data: [DONE]\n\n')
      response.end()
    }
  }

  /**
   * 非流式：上游可能返回 JSON，也可能无视 stream=false 返回 SSE。
   * 两种都归一成一个 `chat.completion`。
   */
  async function collectJson({ route, packs, model, upstream, response, logger }) {
    const text = await upstream.text()
    let result
    try {
      result = JSON.parse(text)
    } catch {
      result = aggregateSse(text, packs, model)
    }
    if (Array.isArray(result['choices'])) {
      for (const choice of result['choices']) {
        choice['finish_reason'] = finishReasonOf(packs, choice['finish_reason'])
        /**
         * 非流式路径此前从不经过规则包，于是「上游把思考放在 message.reasoning」这类
         * 问题只有流式请求修得掉：DSH 非流式调用会完全看不到思考内容，且两类上游
         * （reasoning / reasoning_content）在非流式下表现不一致。
         *
         * 这里把 message 喂给同一个 normalizeDelta —— 它的入参在流式侧是 choice.delta、
         * 在非流式侧是 choice.message，字段契约相同（content 置空串、思考键双向镜像），
         * 所以不必新增一套钩子。只传 message，绝不传整个 choice：choice 上挂着
         * tool_calls / logprobs / token_ids 等不该被 delta 语义碰的东西。
         */
        const message = choice['message']
        if (typeof message === 'object' && message !== null) {
          for (const pack of packs) pack.normalizeDelta(message)
        }
      }
    }
    // HTTP 200 里的业务错误：给出真实状态码，让客户端能正确重试或提示。
    const business = translateBusinessError(packs, result, { model })
    if (business !== undefined) {
      const status = statusForError(packs, result, { model })
      logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 上游业务错误 ' + JSON.stringify(business))
      writeJson(response, status, business)
      return
    }
    writeJson(response, 200, result)
  }

  /**
   * 拉起带 `launch` 的上游进程（如 cline2api）。
   *
   * 每条带 launch 的路由各自调一次；已经在跑的（用户手动开的 / 上次插件拉起的）
   * 绝不重复拉起。返回的 dispose 收进全局列表，proxy 关闭时一起 kill 自己拉起的。
   */
  const launchDisposers = []
  const launchTasks = []
  for (const route of routes.values()) {
    if (route.launch === undefined) continue
    const task = ensureUpstream({ route, logger, autoLaunch })
      .then((outcome) => {
        if (typeof outcome?.dispose === 'function') launchDisposers.push(outcome.dispose)
        if (outcome?.launched === true) {
          logger?.info?.('[api-rules] 上游 ' + route.id + ' 已拉起 (pid=' + outcome.pid + ')')
        }
      })
      .catch((error) => {
        logger?.warn?.('[api-rules] 上游 ' + route.id + ' 拉起异常: ' + String(error?.message ?? error))
      })
    launchTasks.push(task)
  }
  // close() 要等这些任务收齐：否则刚建好就 close 时 dispose 可能还没 push 进列表。
  const launchReady = Promise.all(launchTasks)

  return {
    ready,
    origin,
    /** 供测试与启动日志使用；配置了 token 才有值。 */
    token: () => token,
    routes: () => [...routes.keys()],
    /** 监听状态快照：设置卡片据此显示「前置层到底起没起」。 */
    status: () => {
      // port 要报「实际绑定的端口」而不是配置值：配置 0 时由内核分配，
      // 报 0 会让卡片显示一个根本不存在的端口。
      const address = server.address()
      const port = address === null || typeof address === 'string' ? boundPort : address.port
      return {
        listening: server.listening,
        port,
        error: lastListenError === undefined ? undefined : String(lastListenError?.code ?? lastListenError?.message ?? lastListenError),
      }
    },
    sessions: () => [...gates.entries()].map(([id, gate]) => ({ id, slots: gate.snapshot([id])[0] })),
    close: async () => {
      // 先等 ensureUpstream 收齐 dispose，再逐个 await 等进程真正退出。
      // 这样重建 proxy 前端口一定已释放，新实例不会误判 already_running。
      await launchReady
      for (const dispose of launchDisposers) {
        try {
          await dispose()
        } catch {
          /* 关闭阶段忽略单个上游的清理错误 */
        }
      }
      /**
       * 先断开在途连接再 close：keep-alive 长连接会让 server.close() 的回调迟迟不来，
       * 端口就一直被占着，重载后的新实例只能干等到重试预算耗尽（见上面 connections
       * 的注释）。socket.destroy() 之后 close 的回调会立刻触发。
       */
      for (const socket of connections) {
        try {
          socket.destroy()
        } catch {
          /* 关闭阶段忽略单个连接的销毁错误 */
        }
      }
      connections.clear()
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

/** 规则链上「第一个给出了答案的包」胜出，与 Python 版单一 adapter 的语义一致。 */
function translateBusinessError(packs, chunk, ctx) {
  for (const pack of packs) {
    const translated = pack.translateBusinessError(chunk, ctx)
    if (translated !== undefined) return translated
  }
  return undefined
}

function statusForError(packs, chunk, ctx) {
  for (const pack of packs) {
    if (typeof pack.statusForError === 'function') {
      const status = pack.statusForError(chunk, ctx)
      if (status !== undefined) return status
    }
  }
  return 502
}

/** 规则链上「第一个给出了收尾帧的包」胜出；没实现钩子的包返回 undefined。 */
function streamAbortFrameOf(packs, meta) {
  for (const pack of packs) {
    if (typeof pack.streamAbortFrame === 'function') {
      const frame = pack.streamAbortFrame(meta)
      if (frame !== undefined) return frame
    }
  }
  return undefined
}

/**
 * 给断流帧附诊断元数据（客户端忽略未知字段），不改动规则包给的 error 文案。
 * 让「思考阶段断流」这类截断在日志/调试里能看出：是否已空流重试过、当时发了什么。
 */
function attachStreamAbortMeta(frame, info) {
  if (frame === null || typeof frame !== 'object') return frame
  frame['_streamAbort'] = { reasoningOnly: true, ...info }
  return frame
}

/**
 * 规则链上「第一个判定思考死循环的包」胜出；没实现钩子的包返回 undefined（不干预）。
 * meta: { reasoningText, reasoningChunks, sawFinishReason, sawContent, sawToolCall }。
 * 返回帧会让 pipeStream 立刻写它 + [DONE] 并掐断上游连接。
 */
function thinkingLimitFrameOf(packs, meta) {
  for (const pack of packs) {
    if (typeof pack.thinkingLimitFrame === 'function') {
      const frame = pack.thinkingLimitFrame(meta)
      if (frame !== undefined) return frame
    }
  }
  return undefined
}

/**
 * 规则链上「第一个判定正文死循环的包」胜出；没实现钩子的包返回 undefined（不干预）。
 * meta: { contentText, contentChunks, sawContent, sawToolCall, sawFinishReason }。
 * 与 thinkingLimitFrameOf 同构，但覆盖思考阶段之外的退化：模型把工具调用闭合标记当正文
 * 无限刷（spark-x2.6 实测 `</invoke>` 重复到 19 万字符），框架层逐帧问、命中即掐断。
 * 返回帧会让 pipeStream 立刻写它 + [DONE] 并掐断上游连接。
 */
function contentLimitFrameOf(packs, meta) {
  for (const pack of packs) {
    if (typeof pack.contentLimitFrame === 'function') {
      const frame = pack.contentLimitFrame(meta)
      if (frame !== undefined && frame !== null) return frame
    }
  }
  return undefined
}

function finishReasonOf(packs, value) {
  let current = value
  for (const pack of packs) current = pack.finishReason(current)
  return current
}

/** 把一整段 SSE 文本聚合成一个 chat.completion。 */
export function aggregateSse(text, packs, model) {
  const parts = []
  const reasoning = []
  const toolCalls = new Map()
  let usage
  let finish = null
  let id
  let created

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') continue
    let chunk
    try {
      chunk = JSON.parse(payload)
    } catch {
      continue
    }
    if (chunk['id'] !== undefined) id = chunk['id']
    if (chunk['created'] !== undefined) created = chunk['created']
    if (chunk['usage'] !== undefined) usage = chunk['usage']
    for (const choice of chunk['choices'] ?? []) {
      if (choice['finish_reason'] !== null && choice['finish_reason'] !== undefined) {
        finish = finishReasonOf(packs, choice['finish_reason'])
      }
      const message = choice['message']
      if (typeof message === 'object' && message !== null) {
        if (typeof message['content'] === 'string') parts.push(message['content'])
        if (typeof message['reasoning_content'] === 'string') reasoning.push(message['reasoning_content'])
        for (const call of message['tool_calls'] ?? []) pushToolCall(toolCalls, call)
        continue
      }
      const delta = choice['delta']
      if (typeof delta !== 'object' || delta === null) continue
      if (typeof delta['content'] === 'string') parts.push(delta['content'])
      if (typeof delta['reasoning_content'] === 'string') reasoning.push(delta['reasoning_content'])
      for (const call of delta['tool_calls'] ?? []) pushToolCall(toolCalls, call)
    }
  }

  const message = { role: 'assistant', content: parts.join('') }
  if (reasoning.length > 0) message['reasoning_content'] = reasoning.join('')
  if (toolCalls.size > 0) message['tool_calls'] = [...toolCalls.keys()].sort((a, b) => a - b).map((key) => toolCalls.get(key))

  const result = {
    id: id ?? 'api-rules-aggregate',
    object: 'chat.completion',
    created: created ?? Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finish ?? (toolCalls.size > 0 ? 'tool_calls' : 'stop'),
      },
    ],
  }
  if (usage !== undefined) result['usage'] = usage
  return result
}

function pushToolCall(map, call) {
  if (typeof call !== 'object' || call === null) return
  const index = call['index'] ?? 0
  let current = map.get(index)
  if (current === undefined) {
    current = { id: call['id'], type: call['type'] ?? 'function', function: { name: '', arguments: '' } }
    map.set(index, current)
  }
  if (call['id']) current['id'] = call['id']
  if (call['type']) current['type'] = call['type']
  const fn = call['function'] ?? {}
  if (fn['name']) current.function.name += fn['name']
  if (fn['arguments']) current.function.arguments += fn['arguments']
}

/**
 * 把一条配置规整成路由。
 *
 * `rules` 是规则包名字数组；`models` 只用于上游模型清单探测失败时的回落，
 * 以及给规则包提供 maxTokens/supportsImages 元数据。
 */
export function normalizeRoute(raw) {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('route must be an object')
  const id = raw.id
  if (typeof id !== 'string' || id === '') throw new TypeError('route.id must be a non-empty string')
  // 签名器路由（如 huawei）由插件自己直连上游，无需配置 upstream；
  // 其余路由必须给出上游地址。
  const signer = raw.signer
  /**
   * `credentialed: true` = 这条路由的上游地址与鉴权头存在本插件的账号文件里
   * （`{ baseUrl, authorization }`），而不是写死在 patch 里。这样同一个插件装到
   * 别的机器上，只要在设置卡片里粘一次自己的地址与凭据就能用；patch 里的
   * upstream/apiKey 退化成「存储为空时的回退目标」。
   */
  const credentialed = raw.credentialed === true
  let upstream = raw.upstream
  if (!signer && !credentialed) {
    if (typeof upstream !== 'string' || upstream === '') {
      throw new TypeError('route ' + id + ' needs an upstream URL (or a signer)')
    }
    upstream = upstream.replace(/\/+$/u, '')
  }
  // 自带凭据的路由允许完全不写 upstream（地址在卡片里填），此时 upstream 为 ''。
  if (typeof upstream === 'string') upstream = upstream.replace(/\/+$/u, '')
  return {
    id,
    signer: typeof signer === 'string' && signer !== '' ? signer : undefined,
    /** 凭据（地址 + 鉴权头）由用户在本插件的设置卡片里给出，见 credentialOverride()。 */
    credentialed,
    /**
     * 透传鉴权：把 DSH 核心发来的 Authorization 原样转交上游（见 chat() 的
     * passthroughAuthorization）。用于 intern-ai 这类「密钥由 DSH 凭据持有、本插件只中转」的路由。
     */
    passthroughAuth: raw.passthroughAuth === true,
    upstream: typeof upstream === 'string' ? upstream : '',
    rules: Array.isArray(raw.rules) && raw.rules.length > 0 ? raw.rules : ['generic'],
    models: Array.isArray(raw.models) ? raw.models : [],
    // 生图/生视频通道声明（goal-58ba6a2c）。media.images / media.videos 各是模型 id
    // 字符串数组（非空数组才认，缺省 = 该路由不提供该媒体通道，卡片据此决定展示哪个表单）。
    media:
      typeof raw.media === 'object' && raw.media !== null
        ? {
            images: Array.isArray(raw.media.images) && raw.media.images.length > 0 ? raw.media.images : undefined,
            videos: Array.isArray(raw.media.videos) && raw.media.videos.length > 0 ? raw.media.videos : undefined,
          }
        : undefined,
    apiKey: raw.apiKey,
    /**
     * 透传路由的 DSH 凭据引用名。必须在 normalizeRoute 里原样带下去：
     * 模型发现（listModels）要用它去 credentials.resolve() 取**真密钥**去打上游
     * /v1/models；丢了它就只能拿 route.apiKey 的占位值，上游 401 后回落到 route.models，
     * 而 planSync 遇到 fallback 会整条跳过 —— 表现就是「加回上游后选择器里一个模型都没有」。
     */
    apiKeyEnv: typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv !== '' ? raw.apiKeyEnv : undefined,
    /** 设置卡片上「打开登录 / 管理面板」按钮指向的地址（如 officeace2api :7864、cline2api :3457 的管理后台）。 */
    adminUrl: typeof raw.adminUrl === 'string' && raw.adminUrl !== '' ? raw.adminUrl : undefined,
    concurrency: typeof raw.concurrency === 'number' ? raw.concurrency : undefined,
    sessionHoldMs: typeof raw.sessionHoldMs === 'number' ? raw.sessionHoldMs : 60_000,
    timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : undefined,
    probeTimeoutMs: typeof raw.probeTimeoutMs === 'number' ? raw.probeTimeoutMs : undefined,
    // 生图/生视频转发超时（goal-58ba6a2c）。媒体上游慢（生视频快档 20s、慢档 30 分钟），
    // 不复用 chat 的 timeoutMs：媒体需要独立且更长的预算，默认 600s（10 分钟）。
    mediaTimeoutMs: typeof raw.mediaTimeoutMs === 'number' ? raw.mediaTimeoutMs : undefined,
    // 上游进程自动拉起配置（cline2api 这类独立进程）。
    // 已规整过的对象（raw.launch 是 normalizeLaunch 的产物，必然带 readyPollMs 字段）
    // 原样带过，保证 createProxy 二次 normalize 不退化；原始配置（YAML 里没有 readyPollMs）
    // 才现场规整。命令缺失时 normalizeLaunch 返回 undefined。
    launch:
      typeof raw.launch === 'object' && raw.launch !== null && typeof raw.launch.readyPollMs === 'number'
        ? raw.launch
        : normalizeLaunch(raw.launch),
    // 既认 `default`（patch 源配置），也认 `isDefault`（经 index.mjs 预规整后的形态，
    // createProxy 会二次 normalize，必须保留默认标记，否则多路由时 defaultRouteId 丢失、
    // 默认路由的短路径 /v1/... 全部 404）。
    isDefault: raw.default === true || raw.isDefault === true,
    /**
     * 已解析的规则包实例。由 index.mjs 注入；第二次 normalize（createProxy 内部）
     * 必须原样带过，否则规则会在装配阶段被悄悄丢掉。
     */
    packs: Array.isArray(raw.packs) ? raw.packs : undefined,
  }
}

/**
 * 解析请求路径。
 *
 * 支持两种形状：带路由前缀的 `/codearts/v1/...`（多路由时用），以及默认路由的
 * 短路径 `/v1/...`（这样 cordis.patch.yml 里 baseURL 可以保持 `/v1` 结尾）。
 */
export function parseRoute(url, routes, defaultRouteId) {
  const pathname = url.split('?')[0].replace(/\/+$/u, '')
  const prefixed = /^\/([^/]+)\/v1(\/.*)$/u.exec(pathname)
  if (prefixed !== null && routes.has(prefixed[1])) {
    return { route: routes.get(prefixed[1]), path: prefixed[2] }
  }
  const bare = /^\/v1(\/.*)$/u.exec(pathname)
  if (bare !== null && defaultRouteId !== undefined) {
    return { route: routes.get(defaultRouteId), path: bare[1] }
  }
  return undefined
}

function upstreamError(status, kind, detail) {
  const error = new Error(detail)
  error.status = status
  error.kind = kind
  error.detail = detail
  return error
}

function abortError() {
  return upstreamError(499, 'cancelled', 'request cancelled by the client')
}

async function sleepFor(ms, signal) {
  if (!(ms > 0)) return
  await new Promise((resolve) => {
    if (signal?.aborted === true) return resolve()
    const timer = setTimeout(finish, ms)
    timer.unref?.()
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

export { noop }
