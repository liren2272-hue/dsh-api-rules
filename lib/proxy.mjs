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

  const ready = new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  server.listen(options.port ?? 0, '127.0.0.1')

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
    writeOpenAiError(response, 404, 'not_found', 'no such route: ' + request.method + ' ' + url)
  }

  /** 模型清单：签名器路由走上游发现，其余透传 upstream+/models，均失败时回落配置。 */
  async function listModels(route, response) {
    // 自带凭据路由的地址与鉴权头可能在账号文件里（卡片填的），这里同样实时取。
    const override = route.credentialed ? credentialOverride(route, await resolveCredential(route.id)) : undefined
    const upstreamBase = override?.baseUrl ?? route.upstream
    const signer = route.signer ? signers[route.signer] : undefined
    if (signer?.discoverModels !== undefined) {
      try {
        const result = await signer.discoverModels(await resolveCredential(route.id))
        writeJson(response, 200, { object: 'list', data: result.models.map((model) => signer.toOpenAiModel(model)) })
        return
      } catch (error) {
        logger?.debug?.('[api-rules] ' + route.id + ' model discovery failed: ' + String(error))
      }
    } else if (upstreamBase) {
      try {
        const upstream = await fetch(upstreamBase + '/models', {
          headers: authHeaders(route, {}, override),
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

  /** 一条路由的鉴权头。上游凭证由配置或账号文件给出；没有就留空，交给下游网关自己解决。 */
  function authHeaders(route, extra, override) {
    const headers = { 'Content-Type': 'application/json', ...extra }
    if (typeof override?.authorization === 'string' && override.authorization !== '') {
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
    const gate = gateOf(route)
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
    }

    const packs = route.packs
    const payload = JSON.stringify(body)

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
      upstream = await postWithRetry({ route, payload, packs, model, preHeaders, authOverride, signal: controller.signal, logger })
    } catch (error) {
      const status = error?.status ?? 502
      writeOpenAiError(response, status, error?.kind ?? 'upstream_error', error?.detail ?? String(error))
      return
    }

    if (wantStream) {
      await pipeStream({ route, packs, model, upstream, response, signal: controller.signal, logger })
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
  async function postWithRetry({ route, payload, packs, model, preHeaders, authOverride, signal, logger }) {
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
        const headers = preHeaders ?? authHeaders(route, undefined, authOverride)
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
      try {
        lastText = (await response.text()).slice(0, 2000)
      } catch {
        lastText = ''
      }

      const retryable = packs.some((pack) => pack.isRetryable({ status: lastStatus, text: lastText }))
      const concurrency = packs.some((pack) => pack.isConcurrencyError(lastText))
      if (!retryable || attempt + 1 >= maxAttempts) break

      const pack = packs[0]
      const backoff = pack.backoffMs({ attempt, concurrency })
      if (concurrency) {
        const budget = pack.retryBudgetMs(true)
        if (Date.now() - started + backoff > budget) {
          logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 并发上限重试预算已用尽，放弃')
          break
        }
        // 登记全局冷却：让同时在飞的请求一起等，而不是各自退避后再一起撞上限。
        cooldowns.set(route.id, Date.now() + pack.cooldownMs())
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

    throw upstreamError(lastStatus, 'upstream_error', 'upstream ' + lastStatus + ': ' + lastText)
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
  async function pipeStream({ route, packs, model, upstream, response, signal, logger }) {
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
            const business = translateBusinessError(packs, chunk)
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
              }
              for (const pack of packs) pack.normalizeDelta(choice['delta'])
              const delta = choice['delta'] ?? {}
              if (typeof delta['content'] === 'string' && delta['content'] !== '') sawContent = true
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
                logger?.warn?.('[api-rules] ' + route.id + ' ' + model + ': 检测到思考死循环，主动终止流 ' + JSON.stringify(limitFrame))
                response.write('data: ' + JSON.stringify(limitFrame) + '\n\n')
                response.write('data: [DONE]\n\n')
                response.end()
                try { reader.cancel().catch(() => {}) } catch {}
                return
              }
            }
            response.write('data: ' + JSON.stringify(chunk) + '\n\n')
            sentAnything = true
          }
        }
      }

      // 断流时给规则包一个「这轮流到底发过什么」的快照。spark-x2.6 这类思考模型
      // 把 CoT 放在 reasoning_content、正文放在 content；若上游在思考阶段被掐断
      // （规则层 120s 超时关掉响应体 / 网关 10053），这里只会看到 reasoning_content。
      // 绝不能补 finish_reason:'stop' —— 那会把「思考草稿 / 工具调用草稿」当成最终答案。
      const meta = { sawFinishReason, sentAnything, sawContent, sawToolCall }
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
        if (frame !== undefined) response.write('data: ' + JSON.stringify(frame) + '\n\n')
      }
      // 无条件补一帧：上面遇到上游的 [DONE] 只置标记、没有转发，所以这里必须写，
      // 否则「上游发了 DONE」反而是唯一收不到 DONE 的情况。
      response.write('data: [DONE]\n\n')
      response.end()
    } catch (error) {
      logger?.warn?.('[api-rules] ' + route.id + ' stream failed: ' + String(error))
      // 已经发过思考 chunk 的截断流也要补一帧错误：否则只剩 [DONE]，客户端把
      // 思考草稿当成一次「干净完成」。只在没收到 finish_reason 时补，且先问规则包。
      if (!sawFinishReason) {
        const meta = { sawFinishReason, sentAnything, sawContent, sawToolCall }
        const frame = streamAbortFrameOf(packs, meta) ?? { error: { message: String(error), type: 'upstream_error' } }
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
      }
    }
    // HTTP 200 里的业务错误：给出真实状态码，让客户端能正确重试或提示。
    const business = translateBusinessError(packs, result)
    if (business !== undefined) {
      const status = statusForError(packs, result)
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
  for (const route of routes.values()) {
    if (route.launch === undefined) continue
    void ensureUpstream({ route, logger, autoLaunch })
      .then((outcome) => {
        if (typeof outcome?.dispose === 'function') launchDisposers.push(outcome.dispose)
        if (outcome?.launched === true) {
          logger?.info?.('[api-rules] 上游 ' + route.id + ' 已拉起 (pid=' + outcome.pid + ')')
        }
      })
      .catch((error) => {
        logger?.warn?.('[api-rules] 上游 ' + route.id + ' 拉起异常: ' + String(error?.message ?? error))
      })
  }

  return {
    ready,
    origin,
    /** 供测试与启动日志使用；配置了 token 才有值。 */
    token: () => token,
    routes: () => [...routes.keys()],
    sessions: () => [...gates.entries()].map(([id, gate]) => ({ id, slots: gate.snapshot([id])[0] })),
    close: async () => {
      for (const dispose of launchDisposers) {
        try {
          dispose()
        } catch {
          /* 关闭阶段忽略单个上游的清理错误 */
        }
      }
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

/** 规则链上「第一个给出了答案的包」胜出，与 Python 版单一 adapter 的语义一致。 */
function translateBusinessError(packs, chunk) {
  for (const pack of packs) {
    const translated = pack.translateBusinessError(chunk)
    if (translated !== undefined) return translated
  }
  return undefined
}

function statusForError(packs, chunk) {
  for (const pack of packs) {
    if (typeof pack.statusForError === 'function') {
      const status = pack.statusForError(chunk)
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
    upstream: typeof upstream === 'string' ? upstream : '',
    rules: Array.isArray(raw.rules) && raw.rules.length > 0 ? raw.rules : ['generic'],
    models: Array.isArray(raw.models) ? raw.models : [],
    apiKey: raw.apiKey,
    /** 设置卡片上「打开登录 / 管理面板」按钮指向的地址（如 officeace2api :7864、cline2api :3457 的管理后台）。 */
    adminUrl: typeof raw.adminUrl === 'string' && raw.adminUrl !== '' ? raw.adminUrl : undefined,
    concurrency: typeof raw.concurrency === 'number' ? raw.concurrency : undefined,
    sessionHoldMs: typeof raw.sessionHoldMs === 'number' ? raw.sessionHoldMs : 60_000,
    timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : undefined,
    probeTimeoutMs: typeof raw.probeTimeoutMs === 'number' ? raw.probeTimeoutMs : undefined,
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
