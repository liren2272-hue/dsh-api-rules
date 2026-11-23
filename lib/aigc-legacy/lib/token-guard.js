/**
 * 令牌自动续期。
 *
 * 同济 AIGC 的 access_token TTL 是 24 小时。原来过期后必须人工去卡片里重登，
 * 于是每跑一次任务前都要先撞一次 `token is expired`。这里把「发现过期 → 用存下的
 * 账号密码走 IAM 登录 → 写回 token.json」变成请求路径上的透明一步：
 *
 *   - 令牌还新鲜（剩余 > 10 分钟）→ 直接用，零额外请求；
 *   - 快过期/已过期 → 用 `creds.js` 里的凭据重登，成功后写回；
 *   - 没有凭据 / IAM 要求验证码 / 密码错了 → **不阻塞**，返回旧令牌让上层照常报错，
 *     同时进入 5 分钟冷却，避免每个请求都去打一次 IAM 把账号打到锁定。
 *
 * 并发安全：同一时刻只跑一次续期，其余调用共享同一个 Promise。
 */
import { readToken, writeToken, isTokenExpired, decodeJwtPayload } from './token.js'
import { readCreds } from './creds.js'
import { beginIamLogin, completeIamLogin, IamLoginError } from './aigc/iam-login.js'
import { logInfo, logWarn } from './log.js'

/** 距过期不足这么多就先续（秒）。 */
const RENEW_SKEW_SECONDS = 10 * 60
/** 续期失败后的冷却时间（毫秒）。 */
const FAIL_COOLDOWN_MS = 5 * 60 * 1000

const state = {
  /** @type {{agiBaseUrl: string, requestTimeoutMs: number}|null} */
  config: null,
  /** @type {Promise<string|null>|null} 正在进行的续期 */
  inflight: null,
  /** 上次失败时间戳，用于冷却 */
  lastFailAt: 0,
  lastFailMsg: '',
  /** 只告警一次，避免日志刷屏 */
  warnedNoCreds: false,
}

/** 由 index.js 在配置解析后调用；客户端构造前必须有值。 */
export function setTokenGuardConfig(config) {
  state.config = config || null
}

/** 令牌的剩余秒数（解析失败返回 -Infinity，视作已过期）。 */
function secondsLeft(token) {
  const payload = decodeJwtPayload(token)
  const exp = Number(payload?.exp)
  if (!Number.isFinite(exp) || exp <= 0) return Number.NEGATIVE_INFINITY
  return exp - Math.floor(Date.now() / 1000)
}

/** 这个令牌还能不能直接用。 */
export function tokenUsable(token) {
  if (!token) return false
  if (isTokenExpired(token)) return false
  return secondsLeft(token) > RENEW_SKEW_SECONDS
}

function inCooldown() {
  return state.lastFailAt > 0 && Date.now() - state.lastFailAt < FAIL_COOLDOWN_MS
}

/**
 * 用存下的凭据重登一次。失败只记日志，不抛。
 * @returns {Promise<string|null>} 新令牌，失败为 null
 */
async function renewToken(currentToken) {
  const config = state.config
  if (!config) {
    logWarn('令牌续期跳过：尚未设置站点配置')
    return null
  }
  const creds = readCreds()
  if (!creds) {
    state.lastFailAt = Date.now()
    state.lastFailMsg = 'no_credentials'
    if (!state.warnedNoCreds) {
      state.warnedNoCreds = true
      logWarn('令牌已过期且没有存下的凭据，无法自动续期；请在设置卡片里登录一次（登录后密码会被保存，之后自动续期）。')
    }
    return null
  }

  // IAM 在内网：续期前先按需拨号（由宿主注入，best-effort，失败也继续试一次）。
  if (typeof config.ensureTunnel === 'function') {
    try {
      await config.ensureTunnel()
    } catch {
      /* 隧道失败也让下面的请求自己报错，便于看到真实原因 */
    }
  }

  try {
    await beginIamLogin({ agiBaseUrl: config.baseUrl || config.agiBaseUrl, requestTimeoutMs: config.requestTimeoutMs }, { fetchCaptcha: false })
  } catch (error) {
    const msg = error instanceof IamLoginError ? `${error.code}: ${error.message}` : String(error?.message || error)
    state.lastFailAt = Date.now()
    state.lastFailMsg = msg
    logWarn(`令牌续期失败（IAM 会话未就绪）：${msg}`)
    return null
  }

  try {
    const result = await completeIamLogin({ username: creds.username, password: creds.password, checkcode: '' })
    const token = String(result?.token || '').trim()
    if (token === '') {
      state.lastFailAt = Date.now()
      state.lastFailMsg = 'no_token'
      logWarn('令牌续期失败：IAM 登录未返回令牌')
      return null
    }
    writeToken(token)
    state.lastFailAt = 0
    state.lastFailMsg = ''
    state.warnedNoCreds = false
    const left = secondsLeft(token)
    const hours = Number.isFinite(left) ? (left / 3600).toFixed(1) : '?'
    logInfo(`令牌已自动续期（账号 ${creds.username}，剩余约 ${hours} 小时）`)
    return token
  } catch (error) {
    const code = error instanceof IamLoginError ? error.code : ''
    const msg = error instanceof IamLoginError ? `${error.code}: ${error.message}` : String(error?.message || error)
    state.lastFailAt = Date.now()
    state.lastFailMsg = msg
    if (code === 'bad_captcha' || code === 'second_factor') {
      logWarn(`令牌续期需要人工介入（${msg}），本次沿用旧令牌；请在设置卡片里完成一次登录。`)
    } else if (code === 'bad_credentials') {
      logWarn(`令牌续期失败：保存的账号或密码已失效（${msg}），请在设置卡片里重新登录以更新凭据。`)
    } else {
      logWarn(`令牌续期失败：${msg}`)
    }
    return currentToken || null
  }
}

/**
 * 取一个可用的令牌；必要时先续期。
 * 客户端在每个请求前调用，所以这里必须便宜：令牌新鲜时只有一次同步文件读。
 * @returns {Promise<string|null>}
 */
export async function ensureToken() {
  const current = readToken()
  if (tokenUsable(current)) return current

  if (state.inflight) return state.inflight

  if (inCooldown()) {
    // 冷却期内不再尝试，直接把旧令牌交出去，让上层拿到真实的 401 而不是排队等登录。
    return current
  }

  state.inflight = renewToken(current)
    .then((token) => token || current)
    .catch((error) => {
      logWarn(`令牌续期异常：${error instanceof Error ? error.message : String(error)}`)
      return current
    })
    .finally(() => {
      state.inflight = null
    })
  return state.inflight
}

/** 供卡片/端点查询续期状态（不含密码）。 */
export function guardStatus() {
  const current = readToken()
  const left = current ? secondsLeft(current) : null
  return {
    has_token: Boolean(current),
    usable: tokenUsable(current),
    seconds_left: Number.isFinite(left) ? left : null,
    renewing: Boolean(state.inflight),
    last_fail: state.lastFailMsg,
    cooldown: inCooldown(),
  }
}

/** 手动触发一次续期（强制，忽略冷却）。 */
export async function renewNow() {
  state.lastFailAt = 0
  const current = readToken()
  if (state.inflight) return state.inflight
  state.inflight = renewToken(current).finally(() => {
    state.inflight = null
  })
  return state.inflight
}
