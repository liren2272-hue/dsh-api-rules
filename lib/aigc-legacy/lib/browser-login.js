/**
 * dsh-tongji-aigc 浏览器自动化登录（绕开 IAM 风控的人脸/短信增强认证）。
 *
 * 为什么需要：同济 IAM 对部分账号（或被反复提交触发的账号）弹「增强认证」——
 * 人脸识别 / 短信验证码。纯 HTTP 登录无法完成人脸/收短信，会被挡住。而**真浏览器**
 * 带完整指纹与行为，风控基本不弹；即使弹了，用户也能在浏览器里照常完成。
 *
 * 方案（与已废弃的「临时扩展 relay」不同，不依赖扩展注入——Chrome 企业策略会丢弃 unpacked 扩展）：
 *   1. 用本机 Edge/Chrome 开一个**独立临时 user-data-dir + 远程调试端口**的窗口；
 *   2. discover 拿真 authorize URL（含真签名 state），在窗口里打开；
 *   3. 常驻一条 CDP WebSocket，监听 `Network.requestWillBeSent`——登录成功后
 *      IAM 302 → agi/callback?code=.. → agi/sso/callback?token=<JWT>，token 在**瞬时重定向**
 *      的 URL query 里（tab.url 轮询会错过，必须 ws 在跳转瞬间抓）；
 *   4. 抓到 token 存内存，端点轮询取走 → 校验 → 落盘（复用纯 HTTP 后半段）。
 *
 * 凭据只由用户在弹出的浏览器窗口手动输入，本模块不碰凭据、不落盘凭据。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { logInfo, logWarn } from './log.js'

/** 浏览器登录会话状态（本进程内存 + 落盘跨进程共享，绝不落盘凭据）。 */
let session = null

/**
 * 会话状态落盘：DSH 后端每个请求可能是独立进程，start 进程设的内存 session
 * 在 poll 进程里是 null → 误判 no_session → 前端显示「已取消」。故把 port/pid/
 * tabId/userDataDir/startedAt 写进磁盘状态文件，poll 从磁盘读、跨进程判活/取 token。
 */
const STATE_FILE = join(tmpdir(), 'dsh-tongji-aigc-browser-session.json')
// 调试文件日志：跨进程 start/poll 每步写这里，宿主排障用（tmp 目录，重启即弃）
const DEBUG_LOG = join(tmpdir(), 'dsh-tongji-aigc-browser-debug.log')
function debugLog(msg) {
  try { appendFileSync(DEBUG_LOG, `[${new Date().toISOString()} pid=${process.pid}] ${msg}\n`) } catch {}
}
export { debugLog }

function readState() {
  try {
    if (!existsSync(STATE_FILE)) return null
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return s && typeof s.port === 'number' && typeof s.pid === 'number' ? s : null
  } catch { return null }
}

function writeState(s) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({
      port: s.port, pid: s.pid, tabId: s.tabId || null,
      userDataDir: s.userDataDir || null, startedAt: s.startedAt || Date.now(),
      token: s.token || null,
    }), 'utf8')
  } catch {}
}

function clearState() {
  try { if (existsSync(STATE_FILE)) rmSync(STATE_FILE, { force: true }) } catch {}
}

/** 浏览器进程是否还活着（跨进程用 pid 探测）。 */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** 浏览器登录最长存活（到点自动清理，避免残留进程/目录）。 */
const SESSION_MAX_AGE_MS = 10 * 60 * 1000

export class BrowserLoginError extends Error {
  constructor(code, message, hint) {
    super(message)
    this.name = 'BrowserLoginError'
    this.code = code
    this.hint = hint || ''
  }
}

/** 找本机 Chromium 系浏览器（Edge 优先——本机 Edge 对自动化更稳）。 */
function findChromium() {
  const fromEnv = String(process.env.TONGJI_AIGC_CHROMIUM_PATH || '').trim()
  if (fromEnv !== '') return existsSync(fromEnv) ? fromEnv : null
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  for (const c of candidates) { if (c && existsSync(c)) return c }
  return null
}

/** 找一个空闲调试端口（避免和已有实例冲突）。 */
async function findFreePort(preferred) {
  const { createServer } = await import('node:net')
  const tryPort = (port) => new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
  for (let p = preferred; p < preferred + 20; p++) {
    if (await tryPort(p)) return p
  }
  return null
}

/**
 * 启动浏览器登录。会弹出一个独立窗口打开同济 IAM 授权页，并常驻监听 token。
 * @param {string} authorizeUrl discover 返回的真 authorize URL（含真签名 state）。
 * @param {{requestTimeoutMs?: number}} [opts]
 */
export async function startBrowserLogin(authorizeUrl, opts = {}) {
  debugLog('start: begin, authorizeUrl=' + String(authorizeUrl).slice(0, 60))
  if (!authorizeUrl || !/^https:\/\/iam\.tongji\.edu\.cn\//.test(String(authorizeUrl))) {
    throw new BrowserLoginError('bad_authorize', '授权地址无效，需先通过 discover 获取同济 IAM 授权 URL。', '请重试，或检查网络。')
  }
  await cleanupBrowserLogin() // 若有上一次残留，先清

  const exe = findChromium()
  if (!exe) {
    throw new BrowserLoginError('no_browser', '未找到 Edge 或 Chrome，无法启动浏览器登录。', '请安装 Edge/Chrome，或设 TONGJI_AIGC_CHROMIUM_PATH 指向浏览器可执行文件。')
  }
  const port = await findFreePort(9333)
  if (!port) throw new BrowserLoginError('no_port', '找不到空闲调试端口。', '请稍后重试。')

  const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-tongji-cdp-'))
  const child = spawn(exe, [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDataDir,
    '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    'about:blank',
  ], { stdio: 'ignore' })
  child.on('error', (e) => logWarn('[tongji-aigc] 浏览器启动失败: ' + e.message))

  session = { child, userDataDir, port, tabId: null, token: null, startedAt: Date.now(), ws: null, closed: false }
  logInfo(`[tongji-aigc] 浏览器登录已启动 pid=${child.pid} port=${port}`)
  writeState(session)

  // 等调试端口就绪
  let ready = false
  for (let i = 0; i < 48; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) { ready = true; break } } catch {}
    await sleep(250)
  }
  if (!ready) {
    await cleanupBrowserLogin()
    throw new BrowserLoginError('browser_not_ready', '浏览器调试端口未就绪。', '请重试。')
  }

  // 打开授权页
  const tabRes = await fetch(`http://127.0.0.1:${port}/json/new?` + encodeURIComponent(authorizeUrl), { method: 'PUT' })
  const tab = await tabRes.json().catch(() => null)
  if (!tab || !tab.id) {
    await cleanupBrowserLogin()
    throw new BrowserLoginError('open_tab_failed', '无法在浏览器中打开登录页。', '请重试。')
  }
  session.tabId = tab.id
  writeState(session)

  // 常驻 ws 监听该 tab 的网络请求，抓瞬时 token 重定向
  watchTabForToken(tab.id, port).catch((e) => logWarn('[tongji-aigc] 监听中断: ' + (e?.message || e)))

  // 到点自动清理
  setTimeout(() => { if (session && !session.token) cleanupBrowserLogin() }, SESSION_MAX_AGE_MS).unref()

  return { started: true, pid: child.pid, port }
}

/**
 * 常驻监听一个 tab 的网络请求，抓 token。ws 保持到抓到 token 或浏览器关闭。
 */
async function watchTabForToken(_tabId, port) {
  if (!session || session.closed) return
  // 拿 browser 级 WebSocketDebuggerUrl（/json/version 的，不是单个 tab 的）
  let ver = null
  for (let i = 0; i < 10; i++) {
    ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json().catch(() => null)
    if (ver && ver.webSocketDebuggerUrl) break
    await sleep(300)
  }
  if (!ver || !ver.webSocketDebuggerUrl) throw new BrowserLoginError('no_tab_ws', '无法连接登录页调试通道。', '请重试。')

  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  session.ws = ws
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws open failed')) })

  // browser 级 ws + Target.setAutoAttach：自动附加到所有 tab（含 IAM 登录链新开/跳转的），
  // 每个 tab 单独 Fetch.enable 拦 token= 请求。旧版只 attach 第一个 tab，登录链跳到
  // 另一个 tab 的 agi callback?token= 收不到 → token 永远漏抓（探针已证实）。
  let msgSeq = 1
  const pending = new Map() // 消息 id -> resolve
  const attached = new Set() // 已 Fetch.enable 的 sessionId
  const paused = new Map() // requestId -> 已放行（去重）
  const cdpSend = (method, params, sessionId) => {
    const id = msgSeq++
    const msg = { id, method, params: params || {} }
    if (sessionId) msg.sessionId = sessionId
    return new Promise((resolve) => {
      pending.set(id, resolve)
      try { ws.send(JSON.stringify(msg)) } catch { pending.delete(id); resolve(null) }
    })
  }

  ws.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    // 响应：resolve 对应 pending
    if (msg.id && pending.has(msg.id)) {
      const r = pending.get(msg.id)
      pending.delete(msg.id)
      r(msg)
      return
    }
    const method = msg?.method
    const params = msg?.params
    // 新 target 附加（登录链跳转/新开 tab 都会触发）
    if (method === 'Target.attachedToTarget') {
      const sessionId = params?.sessionId
      const tinfo = params?.targetInfo || {}
      logInfo('[tongji-aigc] CDP attached: type=' + (tinfo.type || '?') + ' url=' + String(tinfo.url || '').slice(0, 80))
      if (sessionId && !attached.has(sessionId)) {
        attached.add(sessionId)
        cdpSend('Fetch.enable', {
          patterns: [{ urlPattern: '*token=*', requestStage: 'Request' }],
        }, sessionId)
      }
      return
    }
    if (method === 'Target.detachedFromTarget') {
      attached.delete(params?.sessionId)
      return
    }
    // Fetch 域主动拦截（主路径）：token 请求被暂停时推送
    if (method === 'Fetch.requestPaused') {
      const sessionId = msg.sessionId
      const u = params?.request?.url || ''
      const requestId = params?.requestId
      captureToken(u)
      // 放行请求，让浏览器继续完成登录（避免卡住页面）
      if (requestId && !paused.has(requestId)) {
        paused.set(requestId, true)
        cdpSend('Fetch.continueRequest', { requestId }, sessionId)
      }
      return
    }
    // 兜底：扫常规网络事件 URL
    const u = params?.request?.url || params?.response?.url || params?.redirectResponse?.url || ''
    if (u) captureToken(u)
  }
  ws.onclose = () => { if (session) session.ws = null }

  // 开启自动附加所有子 target（flatten 让事件带 sessionId 走同一 ws）
  cdpSend('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  })

  // 双保险：轮询 /json/list **所有** tab 的 url（旧版只轮询第一个 tab，漏跳转）。
  const urlPoll = async () => {
    debugLog('urlPoll: start, port=' + port)
    let seenTabs = -1
    while (session && !session.token && !session.closed) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json().catch(() => [])
        const tabs = Array.isArray(list) ? list : []
        if (tabs.length !== seenTabs) { debugLog('urlPoll: tabs=' + tabs.length + ' urls=' + tabs.map((t) => String(t.url || '').slice(0, 60)).join(' | ')); seenTabs = tabs.length }
        for (const t of tabs) {
          if (t && t.url) captureToken(t.url)
        }
      } catch {}
      await sleep(400)
    }
    debugLog('urlPoll: exit, token=' + (session?.token ? 'yes' : 'no') + ' closed=' + (session?.closed ? 'yes' : 'no'))
  }
  urlPoll().catch(() => {})
}

/** 从 URL query 里抓 token 存入 session + 落盘（幂等，只存第一个）。 */
function captureToken(u) {
  if (!u || !session || session.token) return
  const m = /[?&]token=([^&]+)/.exec(u)
  if (m) {
    session.token = decodeURIComponent(m[1])
    writeState(session) // 跨进程：poll 进程从磁盘读 token
    debugLog('captureToken: captured len=' + session.token.length + ' (source url=' + String(u).slice(0, 80) + ')')
    logInfo('[tongji-aigc] 浏览器登录：已捕获 token（len=' + session.token.length + '）')
  } else {
    debugLog('captureToken: URL no token: ' + String(u).slice(0, 80))
    logInfo('[tongji-aigc] CDP 抓到 URL（无 token）: ' + String(u).slice(0, 100))
  }
}

/**
 * 轮询浏览器登录结果（跨进程）。
 * DSH 每个请求可能是独立进程：start 进程在内存里养着 ws 抓 token 并落盘，
 * poll 进程可能没有内存 session，故从磁盘状态文件读 port/pid/tabId/token，
 * 用 pid 判活、用 /json/list 抓 tab URL 兜底。
 * @returns {Promise<{pending: boolean, reason?: string, token?: string}>}
 *   pending=true 表示还没登录好（用户仍在操作），token 有值表示已抓到。
 */
export async function pollBrowserLogin() {
  debugLog('poll: enter, inMemSession=' + (session ? 'yes' : 'no') + ' stateFile=' + STATE_FILE)
  // ① 本进程内存有 token（ws 抓到了），直接返回
  if (session?.token) { debugLog('poll: in-mem token hit'); return { pending: false, token: session.token } }

  // ② 读磁盘状态（跨进程共享）
  const s = session ? {
    port: session.port, pid: session.child?.pid, tabId: session.tabId,
    userDataDir: session.userDataDir, startedAt: session.startedAt, token: session.token,
  } : readState()
  if (!s) { debugLog('poll: no state on disk → no_session'); return { pending: true, reason: 'no_session' } }
  debugLog('poll: disk state hasToken=' + !!s.token + ' pid=' + s.pid + ' port=' + s.port)

  // ③ 已落盘 token（start 进程的 ws 抓到并写盘）
  if (s.token) { debugLog('poll: disk token hit'); return { pending: false, token: s.token } }

  // ④ 浏览器进程还活着吗（跨进程用 pid）
  if (typeof s.pid !== 'number' || !pidAlive(s.pid)) {
    debugLog('poll: pid not alive (' + s.pid + ') → browser_closed')
    await cleanupBrowserLogin()
    return { pending: true, reason: 'browser_closed' }
  }

  // ⑤ 超时
  if (Date.now() - (s.startedAt || Date.now()) > SESSION_MAX_AGE_MS) {
    await cleanupBrowserLogin()
    return { pending: true, reason: 'timeout' }
  }

  // ⑥ 用 /json/list 抓 tab URL 兜底（ws 时机偏晚时，这里能抓到落地的 token URL）
  if (typeof s.port === 'number' && s.tabId) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${s.port}/json/list`)).json().catch(() => [])
      const t = list.find((x) => x.id === s.tabId)
      if (t && t.url) {
        const m = /[?&]token=([^&]+)/.exec(t.url)
        if (m) {
          const tok = decodeURIComponent(m[1])
          if (session) { session.token = tok; writeState(session) }
          else writeState({ ...s, token: tok })
          logInfo('[tongji-aigc] 浏览器登录：poll 抓到 token（len=' + tok.length + '）')
          return { pending: false, token: tok }
        }
      }
    } catch {}
  }

  return { pending: true, reason: 'waiting' }
}

/** 取走已捕获的 token（取后清会话、关浏览器）。跨进程：内存没有就从磁盘读。 */
export async function takeBrowserLoginToken() {
  let token = session?.token || null
  if (!token) {
    const s = readState()
    token = s?.token || null
  }
  if (!token) return null
  // 不在这里清理：poll 端点发回成功响应后延迟清理（scheduleDeferredCleanup），
  // 否则 session 立刻被清、前端下次 poll 撞空 → no_session → 误判「已取消」覆盖成功。
  return token
}

/** 延迟清理：成功响应发出后再清浏览器/会话，避免与前端「成功后停轮询」竞态。 */
let deferredCleanupTimer = null
export function scheduleDeferredCleanup(delayMs = 3000) {
  if (deferredCleanupTimer) clearTimeout(deferredCleanupTimer)
  deferredCleanupTimer = setTimeout(async () => {
    deferredCleanupTimer = null
    debugLog('deferred cleanup: firing')
    await cleanupBrowserLogin()
  }, delayMs)
}

/** 关浏览器、删临时目录、清状态。跨进程：能从磁盘状态补齐要清理的目标。 */
export async function cleanupBrowserLogin() {
  debugLog('cleanup: called')
  const s = session
  session = null
  clearState()
  if (!s) return
  s.closed = true
  try { if (s.ws) s.ws.close() } catch {}
  try { if (s.child && s.child.exitCode === null) s.child.kill() } catch {}
  try { if (s.userDataDir) rmSync(s.userDataDir, { recursive: true, force: true }) } catch {}
}
