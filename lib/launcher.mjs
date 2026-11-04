/**
 * 上游进程自动拉起（launch）。
 *
 * ## 为什么需要
 *
 * 有些上游（cline2api 这类）是**独立进程**，DSH 启动时它未必在跑。让每台机器的
 * 用户自己开一个终端去拉起它，等于把「接入一个 API」又拆成两步。路由上写 `launch`
 * 后，本插件在监听就绪前先探测一次；没起来才拉起，并轮询它的健康端点，起来后继续
 * 服务。**已经跑着的（用户手动开的）绝不重复拉起**——否则每台机器会出现第二个实例。
 *
 * ## 安全边界
 *
 * `command` 是**配置文件里的明文**，与 patch 里写 `upstream` 同等级 —— 谁改得了
 * patch 谁就能让本插件执行任意命令。因此本模块不做任何「命令白名单」：它只负责把
 * 配置里的命令原样跑起来，安全责任在写配置的人。
 *
 * ## 进程生命周期
 *
 * `ensureUpstream()` 返回的 `dispose()` 会 kill 掉本插件 spawn 的那一个子进程
 * （只 kill 自己拉起的那个 pid），插件退出时调用。`launch.killOnStop: false` 可以
 * 让它在插件退出后继续留在后台。
 *
 * @module dsh-api-rules/launcher
 */

import { spawn } from 'node:child_process'

/**
 * 把 launch 配置规整一下。缺 `command` 就是「没配」，返回 undefined。
 *
 * 幂等：`normalizeRoute` 会被调用两次（index.mjs 预规整 + createProxy 内部再规整），
 * 已经规整过的对象再进一次也不会退化。
 */
export function normalizeLaunch(raw) {
  if (typeof raw !== 'object' || raw === null) return undefined
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  if (command === '') return undefined
  return {
    command,
    args: Array.isArray(raw.args) ? raw.args.filter((arg) => typeof arg === 'string') : [],
    cwd: typeof raw.cwd === 'string' && raw.cwd.trim() !== '' ? raw.cwd : undefined,
    /**
     * 拉起上游时附加的环境变量（叠加在 process.env 之上）。
     * 用途：给「首次启动会自己生成随机 key 且只打印一次」的上游（如 loomy2api）
     * 钉一个**已知**的网关 key，这样路由的 `apiKey` 才能与之对齐，而不必去读
     * 那个只打印���次、不落盘的随机串。
     */
    env:
      typeof raw.env === 'object' && raw.env !== null
        ? Object.fromEntries(
            Object.entries(raw.env).filter(([, value]) => typeof value === 'string'),
          )
        : undefined,
    /** 健康探测路径，拼在 upstream 之后（cline2api 同时有 `/health` 与 `/v1/health`）。 */
    readyPath: typeof raw.readyPath === 'string' && raw.readyPath.trim() !== '' ? raw.readyPath : '/health',
    /**
     * 健康探测的绝对地址。上游的健康端点在 `upstream` 之外的路径上时用它取代
     * `upstream + readyPath` —— 例如 officeace2api 的 `/healthz` 在站点根，
     * 而它的路由 `upstream` 是 `http://127.0.0.1:7864/v1`。留空则沿用旧行为。
     */
    readyUrl: typeof raw.readyUrl === 'string' && /^https?:\/\//u.test(raw.readyUrl.trim()) ? raw.readyUrl.trim() : undefined,
    /** 等上游就绪的总预算。 */
    readyTimeoutMs: typeof raw.readyTimeoutMs === 'number' && raw.readyTimeoutMs > 0 ? raw.readyTimeoutMs : 30_000,
    /** 轮询间隔。 */
    readyPollMs: typeof raw.readyPollMs === 'number' && raw.readyPollMs > 0 ? raw.readyPollMs : 1_000,
    /** 插件退出时是否 kill 自己拉起的进程。默认 true。 */
    killOnStop: raw.killOnStop !== false,
  }
}

/**
 * 探测上游是否已在监听。
 *
 * 只认「收到 HTTP 响应」——端口通了但返回 401/404 也算活着（鉴权是上游的事，本层
 * 只判断端口）。这样不会把「已启动但还没配好 key」的上游误判成没起来而再拉一个实例。
 */
export async function isUpstreamReady(base, { path = '/health', timeoutMs = 2000 } = {}) {
  const root = String(base ?? '').replace(/\/+$/u, '')
  if (root === '') return false
  try {
    const response = await fetch(root + path, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) })
    // 主动丢弃 body：探针只关心「端口通不通」，不消费响应体。
    await response.body?.cancel?.().catch(() => {})
    return response.status >= 100 && response.status < 600
  } catch {
    return false
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/**
 * 确保上游在跑：已在跑就不动；没跑就拉起并等它健康。
 *
 * @param {object} options
 * @param {object} options.route           已规整的路由（需含 upstream / launch）
 * @param {object} [options.logger]
 * @param {boolean} [options.autoLaunch]  是否允许拉起（顶层 `autoLaunch` 配置）
 * @returns {Promise<{launched:boolean, pid?:number, ready?:boolean, reason?:string, dispose?:Function}>}
 */
export async function ensureUpstream({ route, logger, autoLaunch = true }) {
  const launch = route.launch
  if (launch === undefined) return { launched: false, reason: 'no_launch_config' }
  if (autoLaunch === false) return { launched: false, reason: 'auto_launch_disabled' }
  if (typeof route.upstream !== 'string' || route.upstream === '') {
    return { launched: false, reason: 'no_upstream' }
  }

  // 健康探测目标：默认拼在 upstream 之后；配了 readyUrl 就用那个绝对地址。
  const probeBase = launch.readyUrl ?? route.upstream
  const probePath = launch.readyUrl === undefined ? launch.readyPath : ''

  // 已经在跑就绝不重复拉起（用户手动启动的实例要保留）。
  if (await isUpstreamReady(probeBase, { path: probePath, timeoutMs: 2000 })) {
    return { launched: false, reason: 'already_running' }
  }

  let child
  try {
    child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, ...(launch.env ?? {}) },
    })
  } catch (error) {
    logger?.warn?.('[api-rules] ' + route.id + ' 拉起上游失败: ' + String(error?.message ?? error))
    return { launched: false, reason: 'spawn_failed', error: String(error?.message ?? error) }
  }
  // 先声明、再挂监听：命令不存在 / 路径非法时 Node 会异步 emit 'error'（且 pid 为
  // undefined），没监听会变成未捕获的异常把进程打挂；用 let 提前声明避免 TDZ。
  let exited = false
  let exitCode = null
  child.once('error', (error) => {
    exited = true
    logger?.warn?.('[api-rules] ' + route.id + ' 上游进程异常: ' + String(error?.message ?? error))
  })
  child.once('exit', (code) => {
    exited = true
    exitCode = code
  })
  if (child.pid === undefined) {
    // 同步即判定失败：'error' 事件随后异步到达，但立刻返回失败，不再空等。
    return { launched: false, reason: 'spawn_failed', error: 'spawn returned no pid' }
  }

  const pid = child.pid

  const dispose = () => {
    if (!launch.killOnStop) return
    try {
      if (!exited && child.exitCode === null && child.signalCode === null) child.kill()
    } catch (error) {
      logger?.debug?.('[api-rules] ' + route.id + ' 关闭上游进程失败: ' + String(error?.message ?? error))
    }
  }

  const deadline = Date.now() + launch.readyTimeoutMs
  while (Date.now() < deadline) {
    if (exited) {
      logger?.warn?.('[api-rules] ' + route.id + ' 上游进程启动后立即退出（code=' + exitCode + '）')
      return { launched: false, reason: 'process_exited', pid, exitCode, dispose }
    }
    if (await isUpstreamReady(probeBase, { path: probePath, timeoutMs: Math.min(2000, launch.readyPollMs) })) {
      logger?.info?.('[api-rules] ' + route.id + ' 上游已拉起并就绪 (pid=' + pid + ')')
      return { launched: true, pid, ready: true, dispose }
    }
    await sleep(launch.readyPollMs)
  }

  logger?.warn?.('[api-rules] ' + route.id + ' 上游拉起后 ' + launch.readyTimeoutMs + 'ms 内未就绪 (pid=' + pid + ')')
  return { launched: true, pid, ready: false, reason: 'ready_timeout', dispose }
}
