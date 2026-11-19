/**
 * dsh-api-rules 的同济 AIGC 专区子系统（整包从 dsh-tongji-aigc 搬进来）。
 *
 * 职责（原 dsh-tongji-aigc lib/index.js 等价）：
 *   1. 解析配置，构造 AigcClient（JWT 令牌从 ~/.dsh/.tongji-aigc/token.json 现取）；
 *   2. 注册全套 DSH 工具（生图/生视频/3D/音乐、模板、任务、报价、健康）；
 *   3. 注册同源 HTTP 端点 `/api/dsh-api-rules/aigc/*`，供客户端设置卡片做登录、令牌读写、
 *      额度监控、快速生成、SSO 自动登录（隔离浏览器 + 临时扩展回传）。
 *
 * 为什么是子模块而不是塞进 lib/index.mjs：
 *   - 主入口已经 1700+ 行，再叠 700 行 AIGC 会让回滚和 diff 阅读都变难；
 *   - 子模块只暴露 `injectAigc(ctx)` 一个入口，主入口 import + 一行调用就接线完；
 *   - 整包回滚 = 删掉 `lib/aigc-legacy/` 目录 + 撤掉主入口那 1 行调用。
 *
 * 与 dsh-api-rules 主功能（LLM 路由代理）的关系：
 *   - 共享 TongjiVpn（通过 lib/rules/tongji.mjs 的 ensureTunnelForThirdParty / vpnState）：
 *     AIGC 请求前按需拨号 + 续命 idle timer，和 chat 请求抢的是同一个 openconnect 进程；
 *   - 不共享 JWT/TONGJI_API_KEY：AIGC 用浏览器登录拿到的 JWT，落盘 ~/.dsh/.tongji-aigc/token.json；
 *     chat 走 .credentials.yaml 的 TONGJI_API_KEY。两套认证完全隔离。
 *   - 不共享 client bundle 入口：api-rules 原本没有客户端卡片，本子系统自带一张，
 *     package.json 的 dsh.client.inject 需要显式声明依赖（见 package.json 的 patch）。
 */
import { resolveConfig } from './lib/config.js'
import { AigcClient } from './lib/aigc/client.js'
import { createTools } from './lib/aigc/tools.js'
import { readToken, clearToken, tokenStatus, writeToken, isTokenExpired } from './lib/token.js'
import { logInfo, logWarn } from './lib/log.js'
import {
  ensureLoginEnv,
  startLogin,
  readLoginToken,
  cleanupLogin,
  AutoLoginError,
  NEED_BROWSER_LOGIN,
} from './lib/auto-login.js'
import {
  beginIamLogin,
  completeIamLogin,
  fetchIamCaptcha,
  IamLoginError,
} from './lib/aigc/iam-login.js'
import {
  startBrowserLogin,
  pollBrowserLogin,
  takeBrowserLoginToken,
  cleanupBrowserLogin,
  scheduleDeferredCleanup,
  BrowserLoginError,
} from './lib/browser-login.js'
import { ensureTunnelForThirdParty } from '../rules/tongji.mjs'

/** 插件 live 状态，供工具/端点读最新配置与令牌。 */
const live = { config: resolveConfig(), client: null, credentials: null }

/** 端点前缀：和客户端卡片保持一致。 */
const EP = '/api/dsh-api-rules/aigc'

/** 从 DSH credentials 服务解析同济 API key（内存使用，不落盘不打印）；拿不到再回退环境变量。 */
async function getTongjiApiKey() {
  try {
    if (live.credentials) {
      const rec = await live.credentials.resolve('TONGJI_API_KEY')
      if (rec?.value) return rec.value
    }
  } catch {
    /* 服务不可用则回退环境变量 */
  }
  return process.env.TONGJI_API_KEY || null
}

/** 构造（或复用）客户端。令牌每次现取，改令牌/换登录无需重启。 */
function getClient() {
  if (live.client) return live.client
  live.client = new AigcClient({
    baseUrl: live.config.baseUrl,
    requestTimeoutMs: live.config.requestTimeoutMs,
    getToken: readToken,
  })
  return live.client
}

/** 从卡片请求体读 JSON（Node http.IncomingMessage）。 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function writeJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(payload)
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 令牌有效性校验：调站点 /auth/me 或 /me。失败抛错。 */
async function validateToken(token) {
  const client = new AigcClient({
    baseUrl: live.config.baseUrl,
    requestTimeoutMs: live.config.requestTimeoutMs,
    getToken: () => token,
  })
  return client.me()
}

function handleError(response, error) {
  const message = String(error?.message ?? error)
  logWarn('[api-rules/aigc] endpoint error: ' + message)
  if (!response.headersSent) {
    writeJson(response, 500, { error: 'internal_error', detail: message })
  } else {
    try { response.end() } catch { /* ignore */ }
  }
}

/** 复用 runner 的最小生成链路（给卡片快速生成用）。 */
async function generateByMode(client, mode, prompt, options) {
  const { createTaskDependencies } = await import('./lib/aigc/generate.js')
  const deps = createTaskDependencies(live.config)
  return deps.run({ client, mode, prompt, ...options })
}

/**
 * 把 AIGC 子系统挂到 dsh-api-rules 的 activate(ctx) 里。
 * 主入口只需要：
 *   import { injectAigc } from './aigc-legacy/index.mjs'
 *   ... 在 activate 末尾调 injectAigc(ctx)
 *
 * 内部使用 scoped ctx.inject，不声明顶层 inject —— 与原 dsh-tongji-aigc 保持一致
 * （避免 webServer / tools / credentials 任一未就绪时整个插件被 Cordis 推迟装载）。
 */
export function injectAigc(ctx) {
  ctx.inject(['credentials'], (credCtx) => {
    live.credentials = credCtx?.credentials || null
    return () => { live.credentials = null }
  })

  // 1) DSH 工具（生图/生视频/3D/音乐/模板/任务/报价/健康）
  ctx.inject(['tools'], (toolCtx) => {
    if (!toolCtx?.tools?.register) {
      logWarn('[api-rules/aigc] 宿主没有提供 tools.register，AIGC 工具未注册')
      return
    }
    const disposers = []
    for (const tool of createTools(live.config, getClient, getTongjiApiKey)) {
      disposers.push(toolCtx.tools.register(tool))
    }
    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          if (typeof dispose === 'function') dispose()
        } catch (error) {
          logWarn(`[api-rules/aigc] 摘除工具失败：${String(error)}`)
        }
      }
    }
  })

  // 2) HTTP 端点（供客户端卡片使用）
  ctx.inject(['webServer'], (webCtx) => {
    if (!webCtx?.webServer?.register) {
      logWarn('[api-rules/aigc] 宿主没有提供 webServer.register，AIGC 卡片端点未注册')
      return
    }
    const disposers = []
    const register = (path, handler) =>
      disposers.push(webCtx.webServer.register({ kind: 'exact', path, handler }))

    /** 状态：令牌是否配置、掩码、是否过期，以及站点身份校验结果。 */
    register(`${EP}/status`, async (request, response) => {
      try {
        // 顺手续命 VPN idle timer：AIGC 请求前按需拨号 / 续命，best-effort 不阻塞。
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        const status = tokenStatus()
        const body = {
          baseUrl: live.config.baseUrl,
          configured: status.configured,
          hint: status.hint,
          expired: status.expired,
          expiresAt: status.expiresAt,
        }
        if (status.configured) {
          try {
            body.user = await validateToken(readToken())
          } catch (error) {
            body.error = String(error?.message || error)
          }
        }
        writeJson(response, 200, body)
      } catch (error) {
        handleError(response, error)
      }
    })

    /**
     * 额度监控：把「积分钱包」与「套餐图片/视频用量」聚合成卡片能直接画的结构。
     * 三个上游接口各自容错，单个失败不拖垮整张卡。
     */
    register(`${EP}/quota`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        const status = tokenStatus()
        if (!status.configured) {
          writeJson(response, 200, { configured: false })
          return
        }
        const client = getClient()
        const result = { configured: true, points: null, image: null, video: null }

        let planId = null
        try {
          const ov = await client.billingOverview()
          const d = ov?.data || ov || {}
          const plan = d.plan || {}
          planId = plan.user_plan_id ?? null
          result.points = {
            total: num(d.total_available ?? plan.period_remaining ?? 0),
            wallet: num(d.wallet_balance ?? 0),
            planName: String(plan.plan_name || '套餐'),
            included: num(plan.included_points ?? 0),
            periodUsed: num(plan.period_used ?? 0),
            periodRemaining: num(plan.period_remaining ?? 0),
            nextResetAt: plan.next_reset_at || null,
          }
        } catch (error) {
          result.pointsError = String(error?.message || error)
        }

        if (planId == null) {
          try {
            const plans = await client.myCodingPlans()
            const list = plans?.data?.list || plans?.list || plans?.data || []
            const arr = Array.isArray(list) ? list : []
            const active = arr.find((p) => p.status === 'active') || arr[0]
            planId = active?.id ?? null
          } catch (error) {
            result.planError = String(error?.message || error)
          }
        }

        if (planId != null) {
          try {
            const usage = await client.planUsage(planId)
            const u = usage?.data || usage || {}
            result.image = { used: num(u.image_used), limit: num(u.image_limit), unit: '张' }
            result.video = { used: num(u.video_used), limit: num(u.video_limit), unit: '秒' }
          } catch (error) {
            result.usageError = String(error?.message || error)
          }
        }

        writeJson(response, 200, result)
      } catch (error) {
        handleError(response, error)
      }
    })

    /** 保存 / 读 / 删 令牌：先校验，通过才落盘；校验失败回 401。 */
    register(`${EP}/token`, async (request, response) => {
      try {
        if (request.method === 'GET') {
          writeJson(response, 200, tokenStatus())
          return
        }
        if (request.method === 'DELETE') {
          clearToken()
          live.client = null
          writeJson(response, 200, { configured: false })
          return
        }
        if (request.method !== 'POST' && request.method !== 'PUT') {
          writeJson(response, 405, { error: 'method_not_allowed' })
          return
        }
        const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
        const token = String(body.token ?? '').trim()
        if (token === '') {
          writeJson(response, 400, { error: 'empty_token' })
          return
        }
        try {
          await validateToken(token)
        } catch (error) {
          writeJson(response, 401, { error: 'invalid_token', detail: String(error?.message || error) })
          return
        }
        writeToken(token)
        live.client = null
        writeJson(response, 200, { configured: true, hint: tokenStatus().hint, expired: isTokenExpired(token) })
      } catch (error) {
        handleError(response, error)
      }
    })

    /**
     * 临时扩展回传令牌的落地端点（GET，顶层导航方式）：
     *   扩展从 HTTPS 的 agi.tongji.edu.cn 用 location.replace(origin + EP/relay?token=...) 跳过来，
     *   顶层导航不受混合内容拦截，可绕过 HTTPS→HTTP 限制。
     */
    register(`${EP}/relay`, async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost')
        const traceMsg = String(url.searchParams.get('__trace__') || '').trim()
        if (traceMsg !== '') {
          try {
            const { appendFileSync } = await import('node:fs')
            const { homedir: h } = await import('node:os')
            const { join: j } = await import('node:path')
            const logFile = j(h(), '.dsh-tongji-aigc', 'relay-trace.log')
            const line = `[${new Date().toISOString()}] ${traceMsg} host=${url.searchParams.get('host') || ''} path=${url.searchParams.get('path') || ''}\n`
            appendFileSync(logFile, line, 'utf8')
          } catch { /* ignore */ }
          response.writeHead(204)
          response.end()
          return
        }
        const token = String(url.searchParams.get('token') || '').trim()
        const okPage = (title, msg) =>
          `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title>` +
          `<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f3f4f6;color:#111;display:flex;height:100vh;align-items:center;justify-content:center;margin:0}` +
          `.c{max-width:360px;padding:32px 28px;text-align:center;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.12)}` +
          `h1{font-size:20px;margin:0 0 12px}h2{font-size:15px;font-weight:500;color:#374151;margin:0}p{font-size:13px;color:#6b7280;margin:14px 0 0}</style></head>` +
          `<body><div class="c"><h1>${title}</h1><h2>${msg}</h2><p>你可以直接关闭这个登录窗口了。</p></div></body></html>`
        if (token === '') {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(okPage('回传失败', '未收到令牌（token 为空）'))
          return
        }
        try {
          await validateToken(token)
        } catch (error) {
          response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(okPage('令牌无效', '回传的令牌未通过校验，请重试登录'))
          return
        }
        writeToken(token)
        live.client = null
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(okPage('登录成功', '同济 AIGC 已连接，令牌已安全保存到本机'))
      } catch (error) {
        handleError(response, error)
      }
    })

    /** 账号密码面板 · 第 1 步：取 IAM 登录验证码图（base64）。 */
    register(`${EP}/iam-captcha`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        await beginIamLogin({
          agiBaseUrl: live.config.baseUrl,
          requestTimeoutMs: live.config.requestTimeoutMs,
        }, { fetchCaptcha: false })
        const cap = await fetchIamCaptcha()
        writeJson(response, 200, { captcha: cap.captchaBase64, captchaMime: cap.captchaMime })
      } catch (error) {
        if (error instanceof IamLoginError) {
          writeJson(response, 502, { error: error.code, detail: error.message })
          return
        }
        handleError(response, error)
      }
    })

    /** 账号密码面板 · 第 2 步：工号 + 密码 + 验证码完成登录，换回 agi 令牌并落盘。 */
    register(`${EP}/iam-login`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        let username = ''
        let password = ''
        let checkcode = ''
        try {
          const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
          username = String(body.username || '').trim()
          password = String(body.password || '')
          checkcode = String(body.checkcode || '').trim()
        } catch { /* 空 body 走下面校验 */ }
        if (username === '' || password === '') {
          writeJson(response, 400, { error: 'missing_fields', detail: '请填写工号与密码' })
          return
        }
        try {
          await beginIamLogin({
            agiBaseUrl: live.config.baseUrl,
            requestTimeoutMs: live.config.requestTimeoutMs,
          }, { fetchCaptcha: false })
        } catch (error) {
          if (error instanceof IamLoginError) {
            writeJson(response, 502, { error: error.code, detail: error.message })
            return
          }
          handleError(response, error)
          return
        }
        const result = await completeIamLogin({ username, password, checkcode })
        const token = String(result?.token || '').trim()
        if (token === '') {
          writeJson(response, 502, { error: 'no_token', detail: '登录未返回令牌' })
          return
        }
        try {
          await validateToken(token)
        } catch (error) {
          writeJson(response, 502, { error: 'invalid_token', detail: error?.message || '令牌校验失败' })
          return
        }
        writeToken(token)
        live.client = null
        const st = tokenStatus()
        writeJson(response, 200, { configured: true, hint: st.hint, expired: isTokenExpired(token), user: result?.user || null })
      } catch (error) {
        if (error instanceof IamLoginError) {
          const status = error.code === 'no_session' ? 401 : error.code === 'second_factor' ? 501 : 401
          writeJson(response, status, { error: error.code, detail: error.message })
          return
        }
        handleError(response, error)
      }
    })

    /** 浏览器自动化登录启动（绕开 IAM 风控的人脸/短信增强认证）。 */
    register(`${EP}/browser-login-start`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        const data = await getClient().ssoDiscover('tongji')
        const authUrl = String(data?.redirect_url || data?.url || '').trim()
        if (authUrl === '') {
          writeJson(response, 502, { error: 'sso_discover_failed', detail: '站点未返回 SSO 授权地址' })
          return
        }
        const r = await startBrowserLogin(authUrl)
        writeJson(response, 200, r)
      } catch (error) {
        if (error instanceof BrowserLoginError) {
          const status = error.code === 'no_browser' ? 503 : 502
          writeJson(response, status, { error: error.code, detail: error.message, hint: error.hint })
          return
        }
        handleError(response, error)
      }
    })

    /** 轮询浏览器登录结果。 */
    register(`${EP}/browser-login-poll`, async (request, response) => {
      try {
        const r = await pollBrowserLogin()
        logInfo('[api-rules/aigc] browser-login-poll → ' + JSON.stringify({ pending: r.pending, reason: r.reason, hasToken: !!r.token }))
        if (!r.pending && r.token) {
          const token = await takeBrowserLoginToken()
          writeToken(token, null)
          const st = tokenStatus()
          scheduleDeferredCleanup()
          writeJson(response, 200, { pending: false, configured: true, user: null, hint: st.hint, expired: st.expired })
          return
        }
        writeJson(response, 202, { pending: true, reason: r.reason || 'waiting' })
      } catch (error) {
        handleError(response, error)
      }
    })

    /** 取消浏览器登录：关浏览器、清临时目录。 */
    register(`${EP}/browser-login-cancel`, async (request, response) => {
      try {
        await cleanupBrowserLogin()
        writeJson(response, 200, { cancelled: true })
      } catch (error) {
        handleError(response, error)
      }
    })

    /** 兼容保留：取 SSO 授权 URL（卡片应改用 login-start）。 */
    register(`${EP}/sso-url`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        const data = await getClient().ssoDiscover('tongji')
        const url = String(data?.redirect_url || data?.url || '').trim()
        if (url === '') {
          writeJson(response, 502, { error: 'sso_discover_failed', detail: '站点未返回 SSO 授权地址' })
          return
        }
        writeJson(response, 200, { url })
      } catch (error) {
        handleError(response, error)
      }
    })

    /**
     * 零粘贴自动登录起点：宿主开一个隔离的一次性浏览器窗并加载临时扩展，
     * 扩展在 agi 站内轮询 sessionStorage.access_token，读到后顶层导航回传 EP/relay。
     */
    register(`${EP}/login-start`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        const exe = await ensureLoginEnv()
        const data = await getClient().ssoDiscover('tongji')
        const authUrl = String(data?.redirect_url || data?.url || '').trim()
        if (authUrl === '') {
          writeJson(response, 502, { error: 'sso_discover_failed', detail: '站点未返回 SSO 授权地址' })
          return
        }
        let origin = ''
        try {
          const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
          origin = String(body.origin || '').trim()
        } catch { /* 没有 body 就用请求源 */ }
        if (origin === '') {
          const host = request.headers?.host || 'localhost'
          origin = `http://${host}`
        }
        const relayUrl = `${origin}${EP}/relay`
        await startLogin(authUrl, relayUrl)
        writeJson(response, 200, { started: true })
      } catch (error) {
        if (error instanceof AutoLoginError) {
          writeJson(response, 503, { pending: false, reason: error.code, detail: error.message })
          return
        }
        handleError(response, error)
      }
    })

    /** 自动同步登录态：临时扩展已回传令牌，读回并校验。 */
    register(`${EP}/auto-login`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        const token = await readLoginToken()
        try {
          await validateToken(token)
        } catch (error) {
          writeJson(response, 202, { pending: true, reason: 'invalid_token', detail: String(error?.message || error) })
          return
        }
        writeToken(token)
        live.client = null
        writeJson(response, 200, { configured: true, hint: tokenStatus().hint, expired: isTokenExpired(token) })
      } catch (error) {
        if (error instanceof AutoLoginError) {
          const pending = NEED_BROWSER_LOGIN.has(error.code)
          writeJson(response, pending ? 202 : 503, { pending, reason: error.code, detail: error.message })
          return
        }
        handleError(response, error)
      }
    })

    /** 模板列表（卡片可选展示）。 */
    register(`${EP}/templates`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        const type = new URL(request.url ?? '/', 'http://localhost').searchParams.get('type') || undefined
        const templates = await getClient().templates(type)
        writeJson(response, 200, { total: templates.length, templates })
      } catch (error) {
        handleError(response, error)
      }
    })

    /** 卡片快速生成：创建任务 → 轮询 → 落盘。 */
    register(`${EP}/generate`, async (request, response) => {
      try {
        try { await ensureTunnelForThirdParty({ signal: null }) } catch { /* 忽略 */ }
        if (request.method !== 'POST') {
          writeJson(response, 405, { error: 'method_not_allowed' })
          return
        }
        const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
        const client = getClient()
        if (!readToken()) {
          writeJson(response, 401, { error: 'not_logged_in' })
          return
        }
        const mode = String(body.mode || '').trim()
        const prompt = String(body.prompt || '').trim()
        if (!mode || !prompt) {
          writeJson(response, 400, { error: 'missing_mode_or_prompt' })
          return
        }
        const result = await generateByMode(client, mode, prompt, {
          templateCode: body.template_code,
          params: body.params || {},
          referenceImage: body.reference_image,
          count: body.count,
        })
        writeJson(response, 200, result)
      } catch (error) {
        handleError(response, error)
      }
    })

    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          if (typeof dispose === 'function') dispose()
        } catch (error) {
          logWarn(`[api-rules/aigc] 摘除 HTTP 路由失败：${String(error)}`)
        }
      }
    }
  })

  logInfo('[api-rules/aigc] 子系统已挂载：工具与卡片端点已就绪')
}