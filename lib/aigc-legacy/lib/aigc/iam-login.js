/**
 * 同济统一身份认证（IAM）纯 HTTP 登录：账号 + 密码 + 验证码，全自动换回 agi 令牌。
 *
 * 为什么是纯 HTTP：用户选定「账号密码面板」路线。整条链不碰浏览器、不碰 sessionStorage：
 *   1. discover        GET agi /auth/sso/discover → { redirect_url(IAM授权地址), state }
 *   2. 登录页           GET redirect_url（302 链）→ 落地 ActionAuthChain，拿 cookie(SESSION/_idp_authn_lc_key)
 *                      并解析主表单 authen1Form 的 action / 隐藏字段 / 验证码图 id
 *   3. 验证码图         GET iam /idp/Kaptcha.jpg?dt=<ms>（绑上一步 cookie）→ jpeg 字节，给人眼看
 *   4. 提交登录         POST 表单 action，j_password 用固定 RSA 公钥(PKCS#1 v1.5)加密，带 j_checkcode
 *                      → 302 链最终 302 到 agi /callback?code=..&state=..（假凭据会卡在 SSO 鉴权）
 *   5. 换令牌           GET agi /auth/sso/callback?code=..&state=.. → JSON { code:200, data:{ access_token, user } }
 *                      令牌在**响应体**里，无需浏览器 sessionStorage。
 *
 * 关键实现点（踩过/查证过）：
 *   - cookie：IAM 用 SESSION + _idp_authn_lc_key 绑会话，验证码必须同 cookie 才算同一 session；
 *     用自实现 cookie jar（存 Set-Cookie，逐跳回传），跨 IAM/agi 两域都带。
 *   - 重定向：fetch 用 redirect:'manual' 自己跟 302，才能在每一跳累积 cookie、并识别最终
 *     agi /callback?code= 那一跳（不能让它自动跟，否则拿不到 code）。
 *   - RSA：公钥来自 IAM 登录页引用的 crypt.js（固定），Node crypto.publicEncrypt + RSA_PKCS1_PADDING
 *     已验证与页面 JSEncrypt 输出一致（128 字节密文）。
 *   - state：discover 返回的 state 必须原样带回 /auth/sso/callback，否则 agi 校验失败。
 *
 * 会话落盘：第 3 步和第 4 步之间人要看图输验证码，两次 HTTP 之间 cookie/表单信息不能丢，
 *          存到状态文件（内存兜底），用 sessionId 关联。
 */
import { createPublicKey, publicEncrypt, constants, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'

/**
 * 同济 IAM/agi 是校内域名，若宿主进程走了系统代理（很多用户挂着 v2ray/clash 等本地代理），
 * 代理回不了校内源会直接返回 404/超时。Node fetch（undici）尊重 NO_PROXY/HTTPS_PROXY 环境变量：
 * 这里把同济域名加入 NO_PROXY 强制直连，避免插件在代理环境下登录失败。
 * 只追加、不覆盖用户已有的 NO_PROXY 值。
 */
try {
  const bypassDomains = ['tongji.edu.cn', '.tongji.edu.cn']
  for (const k of ['NO_PROXY', 'no_proxy']) {
    const cur = process.env[k]
    if (!cur) process.env[k] = bypassDomains.join(',')
    else if (!cur.split(',').some((d) => d.trim() && 'tongji.edu.cn'.endsWith(d.trim().replace(/^\./, '')))) {
      process.env[k] = `${cur},${bypassDomains.join(',')}`
    }
  }
} catch {
  /* 环境变量写入失败不影响登录主流程 */
}

/** IAM 固定 RSA 公钥（登录页 crypt.js，PKCS#1 v1.5，1024-bit）。 */
const IAM_RSA_PUBLIC_KEY_B64 =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC9t16RqQWUE/J1IyOfoNHc4r/h6RPnXcWTJ4IbhQVUsEqMMm65F0hiytAgozXmVw68yPJywbpblDrx9zl1wdRcdHCoUvmPdr9/oCQtpQyVc7BXZIN6wJlD6MTeMeni+N0toNPxfXjiAawjNHGZZuT8wQpNEMwsVyJ/lonXaVdGZwIDAQAB'

/** 会话状态文件：两次 HTTP 之间保存 cookie jar / 表单信息 / discover 的 state。 */
const SESSION_FILE =
  process.env.TONGJI_AIGC_IAM_SESSION_FILE || join(homedir(), '.dsh-tongji-aigc', 'iam-session.json')

export class IamLoginError extends Error {
  constructor(code, message, hint) {
    super(message)
    this.name = 'IamLoginError'
    this.code = code
    this.hint = hint || ''
  }
}

// ---------- cookie jar（自实现，够用即可） ----------

function newJar() {
  return /** @type {Record<string,string>} */ ({})
}

/** 把响应的 set-cookie 塞进 jar。fetch 在 node 里把 set-cookie 暴露为 getSetCookie()。 */
function storeCookies(jar, response) {
  const list =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean)
  for (const raw of list) {
    const pair = String(raw).split(';')[0]
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (!name) continue
    // 值为空视为删除
    if (value === '') delete jar[name]
    else jar[name] = value
  }
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

// ---------- 小工具 ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function absoluteUrl(base, maybeRelative) {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative
  const u = new URL(base)
  return `${u.protocol}//${u.host}${maybeRelative.startsWith('/') ? maybeRelative : `/${maybeRelative}`}`
}

/** RSA 加密（PKCS#1 v1.5），返回 base64 密文（128 字节 → 172 字符）。 */
function rsaEncrypt(plain) {
  const key = createPublicKey({ key: Buffer.from(IAM_RSA_PUBLIC_KEY_B64, 'base64'), format: 'der', type: 'spki' })
  const out = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(String(plain), 'utf8'))
  return out.toString('base64')
}

// ---------- 会话状态 ----------

function loadSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8').replace(/^﻿/, ''))
      if (s && s.sessionId && s.cookies && s.formAction) return s
    }
  } catch { /* 坏了当没有 */ }
  return null
}

function saveSession(state) {
  try {
    if (state == null) {
      rmSync(SESSION_FILE, { force: true })
      return
    }
    mkdirSync(dirname(SESSION_FILE), { recursive: true })
    writeFileSync(SESSION_FILE, JSON.stringify(state), 'utf8')
  } catch { /* 落盘失败不影响内存流程 */ }
}

let memorySession = loadSession()

// ---------- 第 1~3 步：开始登录，拿验证码图 ----------

/**
 * 发起一次登录：discover → 登录页（→ 可选验证码图）。
 * 同济 IAM 多数不弹验证码，默认不再强制取验证码；会话（cookie/formAction）仍会就绪。
 * @param {object} cfg { agiBaseUrl, requestTimeoutMs }
 * @param {object} [opts] { fetchCaptcha: false 关闭备用验证码预取 }
 * @returns {Promise<{sessionId, captchaBase64, captchaMime}>}
 */
export async function beginIamLogin(cfg, opts = {}) {
  // agiBaseUrl 可能带 /api/v1 后缀（来自上游 baseUrl），discover/authorize 拼接前剥掉，避免 /api/v1/api/v1/... 导致 404。
  const agi = String(cfg.agiBaseUrl || 'https://agi.tongji.edu.cn')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v\d+$/i, '')
  const timeout = Number(cfg.requestTimeoutMs || 30000)
  const jar = newJar()

  // 0. 会话复用：已落盘会话在 30 分钟内、且仍指向同一 agi，就直接复用（cookie jar / formAction / hidden）。
  //    同济 IAM 登录页会话有效期远长于一次交互，重复 discover 反而脆弱（网络抖动即 discover_failed）。
  const SESSION_TTL_MS = 30 * 60 * 1000
  const existing = memorySession || loadSession()
  if (existing && existing.formAction && Number(existing.createdAt || 0) > Date.now() - SESSION_TTL_MS
      && String(existing.agiBaseUrl || '') === agi) {
    // 仍可选择为旧会话补一张备用验证码（默认按需，不阻塞）
    let captchaBase64 = null
    let captchaMime = null
    if (opts.fetchCaptcha !== false) {
      try {
        const cap = await fetchIamCaptcha(existing)
        captchaBase64 = cap.captchaBase64
        captchaMime = cap.captchaMime
      } catch { /* 验证码非必需，失败静默 */ }
    }
    return { sessionId: existing.sessionId, captchaBase64, captchaMime }
  }

  // 1. discover
  let discRes
  try {
    discRes = await fetch(`${agi}/api/v1/auth/sso/discover?domain=tongji`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    throw new IamLoginError('discover_failed', '无法连接同济 AIGC 站点（网络或超时）。', `请检查网络后重试。（${error?.message || '未知错误'}）`)
  }
  storeCookies(jar, discRes)
  const discText = await discRes.text().catch(() => '')
  let disc = null
  try { disc = JSON.parse(discText) } catch { /* 下面判空 */ }
  const redirectUrl = String(disc?.data?.redirect_url || disc?.data?.url || '').trim()
  const state = String(disc?.data?.state || '').trim()
  if (!redirectUrl) {
    // 带上完整 URL + HTTP 状态 + 响应片段，便于一眼定位是网络/代理还是接口变化导致的失败。
    const snippet = discText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    throw new IamLoginError(
      'discover_failed',
      `同济站点未返回统一身份认证地址（HTTP ${discRes.status}）。`,
      `请求地址：${agi}/api/v1/auth/sso/discover?domain=tongji。${snippet ? `响应片段：${snippet}` : '（空响应）'}。若是代理环境，请让 agi.tongji.edu.cn 直连。`
    )
  }

  // 2. 跟随 redirect_url 的 302 链到登录页（手动跟，累积 cookie，抓最终 ActionAuthChain HTML）
  let current = redirectUrl
  let loginHtml = ''
  let loginPageUrl = ''
  for (let hop = 0; hop < 8; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { Accept: 'text/html,application/xhtml+xml', ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}) },
      signal: AbortSignal.timeout(timeout),
    })
    storeCookies(jar, res)
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      current = absoluteUrl(current, loc)
      continue
    }
    loginHtml = await res.text().catch(() => '')
    loginPageUrl = current
    break
  }
  if (!loginHtml) {
    throw new IamLoginError('login_page_failed', '未能打开同济统一身份认证登录页。', '稍后重试。')
  }

  // 解析主表单 authen1Form 的 action 与隐藏字段（用最简正则，避免引 DOM 解析器）
  const formMatch = loginHtml.match(/<form[^>]*id="authen1Form"[^>]*>/i)
  if (!formMatch) {
    throw new IamLoginError('form_not_found', '登录页结构已变化，未找到账号密码表单。', '同济可能改版，请反馈。')
  }
  const actionAttr = formMatch[0].match(/action=["']([^"']*)["']/i)
  if (!actionAttr) {
    throw new IamLoginError('form_action_missing', '登录表单缺少提交地址。', '同济可能改版，请反馈。')
  }
  const formAction = absoluteUrl(loginPageUrl, actionAttr[1].replace(/&amp;/g, '&'))

  // 隐藏字段：抓 authen1Form 区块内所有「带 name 的 input」（同济把这些字段写成
  // <input type="text" style="display:none">，而非 type=hidden，所以不能按 type 过滤，
  // 只排除提交按钮；op=login / authnLcKey 缺失会导致 IAM 报「无登录认证用户信息」）
  const segStart = loginHtml.indexOf(formMatch[0])
  const segEnd = loginHtml.indexOf('</form>', segStart)
  const seg = segEnd > segStart ? loginHtml.slice(segStart, segEnd) : loginHtml
  const hidden = {}
  const inputRe = /<input\b[^>]*>/gi
  let m
  while ((m = inputRe.exec(seg))) {
    const tag = m[0]
    const name = (tag.match(/name=["']([^"']*)["']/i) || [])[1]
    if (!name) continue
    const type = (tag.match(/type=["']([^"']*)["']/i) || [])[1] || 'text'
    if (/^(submit|button|image|reset)$/i.test(type)) continue
    const value = (tag.match(/value=["']([^"']*)["']/i) || [])[1] || ''
    if (!(name in hidden)) hidden[name] = value
  }

  // spAuthChainCode（认证链 code）：HTML 里 value 常为空，由登录页 JS 运行时
  // 写入（$("#spAuthChainCode1").val('xxxx') / var spCode="#spAuthChainCode"+view;
  // $(spCode).val('xxxx')）。漏抓会导致 IAM 报「验证码为空」之外的鉴权失败。
  // 这里从内联 JS 里提取该 code 补进去（仅当 HTML 未给非空值时）。
  if (!hidden.spAuthChainCode) {
    const spFromJs =
      (loginHtml.match(/spAuthChainCode1["']?\)\.val\(\s*['"]([^'"]+)['"]/i) || [])[1] ||
      (loginHtml.match(/spCode\)\.val\(\s*['"]([^'"]+)['"]/i) || [])[1] ||
      (loginHtml.match(/spAuthChainCode["']?\s*,\s*['"]([0-9a-f]{16,})['"]/i) || [])[1]
    if (spFromJs) hidden.spAuthChainCode = spFromJs
  }

  const session = {
    sessionId: randomUUID(),
    createdAt: Date.now(),
    cookies: jar,
    formAction,
    hidden,
    state,
    loginPageUrl,
    agiBaseUrl: agi,
    requestTimeoutMs: timeout,
  }
  memorySession = session
  saveSession(session)

  // 3. 验证码图（可选）。同济 IAM 多数不弹验证码，这里尽力取一张备用；取不到不报错，
  //    等真正登录被要求验证码时再由 fetchIamCaptcha 现取。
  let captchaBase64 = null
  let captchaMime = null
  if (opts.fetchCaptcha !== false) {
    try {
      const cap = await fetchIamCaptcha(session)
      captchaBase64 = cap.captchaBase64
      captchaMime = cap.captchaMime
    } catch { /* 验证码非必需，失败静默 */ }
  }

  return {
    sessionId: session.sessionId,
    captchaBase64,
    captchaMime,
  }
}

/**
 * 用已存在的登录会话（cookie jar）现取一张验证码图。
 * 同济 IAM 多数不弹验证码，登录被要求时才调用。
 * @param {object} [session] 缺省用 memorySession / 落盘会话
 * @returns {Promise<{captchaBase64, captchaMime}>}
 */
export async function fetchIamCaptcha(session) {
  const s = session || memorySession || loadSession()
  if (!s || !s.cookies || !s.loginPageUrl) {
    throw new IamLoginError('no_session', '登录会话未就绪，无法取验证码。', '请重试登录。')
  }
  const jar = s.cookies || {}
  const timeout = Number(s.requestTimeoutMs || 30000)
  const captchaUrl = `${s.loginPageUrl.split('/idp/')[0]}/idp/Kaptcha.jpg?dt=${Date.now()}`
  const capRes = await fetch(captchaUrl, {
    headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}) },
    signal: AbortSignal.timeout(timeout),
  })
  storeCookies(jar, capRes)
  if (!capRes.ok) {
    throw new IamLoginError('captcha_failed', '未能获取登录验证码图片。', '稍后重试。')
  }
  const capBuf = Buffer.from(await capRes.arrayBuffer())
  return {
    captchaBase64: capBuf.toString('base64'),
    captchaMime: capRes.headers.get('content-type') || 'image/jpeg',
  }
}

// ---------- 第 4~5 步：提交登录，换令牌 ----------

/**
 * 用账号 + 密码 + 验证码完成登录，换回 agi access_token。
 * @param {object} p { username, password, checkcode }
 * @returns {Promise<{token, user}>}
 */
export async function completeIamLogin({ username, password, checkcode }) {
  const s = memorySession || loadSession()
  if (!s || !s.formAction) {
    throw new IamLoginError('no_session', '请先获取验证码。', '刷新验证码后重试。')
  }
  const jar = s.cookies || {}
  const timeout = Number(s.requestTimeoutMs || 30000)

  // 4a. 账号密码 XHR 提交：POST ActionAuthChain（带 authnLcKey 的登录页表单端点）。
  // 实测（干净账号首次）：POST ActionAuthChain 带 XHR 头 → {"loginFailed":"false"}
  // = 账号密码被接受、不弹验证码。成功响应是 JSON（非 3xx），故必须先单独发这一次，
  // 不能和后面的 302 跟跳混在一个循环里（否则 JSON 会被 classifyLoginFailure 误判成失败）。
  const authnLcKey = String((s.hidden || {}).authnLcKey || '')
  const loginChainUrl = /authcenter\/ActionAuthChain/i.test(String(s.formAction || ''))
    ? String(s.formAction)
    : `https://iam.tongji.edu.cn/idp/authcenter/ActionAuthChain?authnLcKey=${encodeURIComponent(authnLcKey)}`
  const loginParams = new URLSearchParams()
  for (const [k, v] of Object.entries(s.hidden || {})) {
    if (k === 'j_password' || k === 'j_username' || k === 'j_checkcode') continue
    loginParams.set(k, v)
  }
  loginParams.set('j_username', String(username || ''))
  loginParams.set('j_password', rsaEncrypt(String(password || '')))
  // j_checkcode：多数情况无验证码。浏览器表单此字段 value 是占位文字「请输入验证码」，
  // 提交时若留空 IAM 会报「验证码为空/有误」；发占位文字（无真验证码时）IAM 才当
  // 「本链不需要验证码」处理。有真验证码时用用户输入覆盖。
  loginParams.set('j_checkcode', String(checkcode || '请输入验证码'))

  // 4a-0. 前置：displayVerificationCode.do（浏览器成功链在提交前会发这一步，
  // body=j_username&j_authMethodID=1&spAuthChainCode，返回 'false'）。
  // 漏发会被 IAM 风控判为可疑请求 → 弹验证码/人脸。发一次即可（浏览器发 ×3）。
  const sp = String(loginParams.get('spAuthChainCode') || '')
  try {
    const pre = new URLSearchParams({ j_username: String(username || ''), j_authMethodID: '1', spAuthChainCode: sp })
    await fetch('https://iam.tongji.edu.cn/idp/displayVerificationCode.do', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://iam.tongji.edu.cn',
        Referer: String(s.loginPageUrl || 'https://iam.tongji.edu.cn/'),
        ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}),
      },
      body: pre.toString(),
      signal: AbortSignal.timeout(timeout),
    }).then((r) => r.text().catch(() => ''))
  } catch { /* 前置失败不阻断主流程 */ }

  const loginRes = await fetch(loginChainUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: new URL(loginChainUrl).origin,
      Referer: String(s.loginPageUrl || 'https://iam.tongji.edu.cn/'),
      ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}),
    },
    body: loginParams.toString(),
    signal: AbortSignal.timeout(timeout),
  })
  storeCookies(jar, loginRes)
  const loginText = await loginRes.text().catch(() => '')
  let loginJson = null
  try { loginJson = JSON.parse(loginText) } catch { /* 非 JSON */ }

  let code = ''
  let callbackState = s.state || ''
  // loginFailed 是字符串 "false"（IAM 返回 {"loginFailed":"false"}）。
  // 注意：JS 里 "false" == false 是 false（字符串转数字 NaN，布尔转 0，NaN==0 为 false），
  // 所以绝不能用 == / === 比较。只认「loginFailed 为 false 布尔或 "false"/"False" 字符串」为成功。
  const lf = loginJson ? String(loginJson.loginFailed).toLowerCase() : 'true'
  if (loginJson && (lf === 'false' || loginJson.loginFailed === false)) {
    // 4b. 登录成功：GET AuthnEngine（同一 authnLcKey），IAM 认到已登录 → 302 链拿 code。
    // 实测：AuthnEngine → 302 AuthorizationCode/SSO → 302 agi/callback?code=.. → 302 agi/sso/callback?token=..
    const engineUrl = String(s.formAction || '')
    if (engineUrl && /AuthnEngine/i.test(engineUrl)) {
      const engineRes = await fetch(engineUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
          Referer: String(s.loginPageUrl || 'https://iam.tongji.edu.cn/'),
          ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}),
        },
        signal: AbortSignal.timeout(timeout),
      })
      storeCookies(jar, engineRes)
      const ssoUrl = engineRes.headers.get('location')
      if (ssoUrl) {
        const grabbed = await followSsoForCode(ssoUrl, jar, timeout)
        if (grabbed.code) { code = grabbed.code; callbackState = grabbed.state || callbackState }
      }
    }
  } else {
    // 登录失败或需二级认证（验证码 / 人脸风控）
    throw classifyLoginFailure(loginText, loginRes.status)
  }
  if (!code) {
    throw new IamLoginError('no_code', '登录未返回授权码，可能账号密码或验证码有误。', '核对后重试。')
  }

  // 5. agi 换 token：GET /auth/sso/callback?code=..&state=..。
  // 实测：该端点不直接返回 JSON，而是 302 → agi/sso/callback?token=<JWT>（token 在最终
  // URL 的 query 里）。故手动跟 302，遇到带 token= 的跳转就取出 JWT。
  const agi = String(s.agiBaseUrl || 'https://agi.tongji.edu.cn').replace(/\/+$/, '')
  const cbUrl = `${agi}/api/v1/auth/sso/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(callbackState)}`
  let token = ''
  let user = null
  let current = cbUrl
  for (let hop = 0; hop < 8; hop++) {
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/json, text/html, */*',
        ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}),
      },
      signal: AbortSignal.timeout(timeout),
    })
    storeCookies(jar, res)
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = absoluteUrl(current, loc)
      const m = /[?&]token=([^&]+)/.exec(next)
      if (m) { token = decodeURIComponent(m[1]); break }
      current = next
      continue
    }
    // 非 3xx：尝试从响应体 JSON 取 token
    const text = await res.text().catch(() => '')
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON */ }
    if (json) {
      token = String(json?.data?.access_token || json?.data?.token || '').trim()
      user = json?.data?.user || null
    }
    break
  }
  token = String(token || '').trim()
  if (!token) {
    throw new IamLoginError('token_exchange_failed', '换取令牌失败：登录跳转未返回令牌。', '登录态可能已过期，请重试。')
  }
  // 用完即清会话
  memorySession = null
  saveSession(null)
  return { token, user }
}

/**
 * 从 AuthorizationCode/SSO 起跟 302，直到 agi /callback?code=..，取出 code 和 state。
 * @returns {Promise<{code: string, state: string}>}
 */
async function followSsoForCode(ssoUrl, jar, timeout) {
  const out = { code: '', state: '' }
  let current = String(ssoUrl || '')
  if (!current) return out
  for (let hop = 0; hop < 12; hop++) {
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
        ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}),
      },
      signal: AbortSignal.timeout(timeout),
    })
    storeCookies(jar, res)
    const loc = res.headers.get('location')
    if (!loc) break
    const next = absoluteUrl(current, loc)
    if (/[?&]code=/.test(next)) {
      const u = new URL(next)
      out.code = u.searchParams.get('code') || ''
      out.state = u.searchParams.get('state') || ''
      return out
    }
    current = next
  }
  return out
}

function classifyLoginFailure(html, status) {
  const text = String(html || '')
  // 常见错误提示（IAM 错误页 / JSON tip）
  if (/验证码/i.test(text)) {
    return new IamLoginError('bad_captcha', '验证码有误。', '请看清新验证码后重试。')
  }
  if (/密码|口令/i.test(text) && /错误|不正确|失败/i.test(text)) {
    return new IamLoginError('bad_credentials', '工号或密码有误。', '核对后重试。')
  }
  if (/无登录认证用户信息|联系管理员/i.test(text)) {
    return new IamLoginError('auth_failed', '统一身份认证未通过：账号、密码或验证码有误。', '核对工号、密码与验证码后重试。')
  }
  if (/二级|短信|otp|扫码|人脸|biometrics|增强认证|popViewException/i.test(text)) {
    return new IamLoginError('second_factor', '该账号触发了 IAM 增强认证（人脸/短信等二次验证），当前面板暂不支持。', '请登陆网站进行验证再回到本界面登陆')
  }
  return new IamLoginError('login_failed', `统一身份认证未通过（HTTP ${status}）。`, '核对工号、密码与验证码后重试。')
}
