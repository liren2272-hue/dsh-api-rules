/**
 * 同济 AIGC 站点的 HTTP 客户端。
 *
 * 只做「反向代理该有的最小必要」：带 JWT 的 fetch 封装 + 响应信封解析 +
 * 错误统一成 AigcError。不引入任何第三方依赖（Node 20 自带 fetch/FormData/Blob）。
 */
import { logDebug } from '../log.js'

/** 上游响应信封：`{ code, data, message }`，成功通常 code 为 0/200，失败带 message。 */
export class AigcError extends Error {
  /** @param {string} message 人类可读的失败原因 @param {string} [hint] 给模型的补救提示 */
  constructor(message, hint) {
    super(message)
    this.name = 'AigcError'
    this.hint = hint
  }
}

/** 用 AbortSignal.timeout 合成超时；外部 signal 也一并尊重。 */
function linkSignals(timeoutMs, externalSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!externalSignal) return timeout
  try {
    return AbortSignal.any([timeout, externalSignal])
  } catch {
    return timeout
  }
}

export class AigcClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl 站点 API 基址（已去尾斜杠）
   * @param {number} options.requestTimeoutMs 单请求超时
   * @param {() => string|null} options.getToken 取当前令牌的函数（可为空）
   */
  constructor({ baseUrl, requestTimeoutMs, getToken }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this.requestTimeoutMs = requestTimeoutMs
    this.getToken = getToken || (() => null)
  }

  /** 拼完整 URL；允许传以 / 开头的相对路径或完整的 http(s) URL。 */
  url(pathname) {
    if (/^https?:\/\//i.test(pathname)) return pathname
    return `${this.baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
  }

  /**
   * 统一请求入口。
   * @param {string} pathname 路径（相对 baseUrl 或完整 URL）
   * @param {object} [options]
   * @param {string} [options.method]
   * @param {object} [options.body] JSON 请求体
   * @param {'json'|'form'|'raw'} [options.kind] 响应处理方式
   * @param {AbortSignal} [options.signal]
   * @param {boolean} [options.noAuth] 不需要令牌的请求（如登录）
   * @returns {Promise<any>} kind=json 时返回 data，raw 时返回 Response
   */
  async request(pathname, options = {}) {
    const { method = 'GET', body, kind = 'json', signal, noAuth = false } = options
    const headers = { Accept: 'application/json' }
    if (body !== undefined && kind === 'json') headers['Content-Type'] = 'application/json'
    if (!noAuth) {
      const token = await this.getToken()
      if (token) headers.Authorization = `Bearer ${token}`
    }

    let response
    try {
      response = await fetch(this.url(pathname), {
        method,
        headers,
        body: kind === 'json' && body !== undefined ? JSON.stringify(body) : body,
        signal: linkSignals(this.requestTimeoutMs, signal),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new AigcError(`请求同济 AIGC 超时（${this.requestTimeoutMs} ms）：${pathname}`, '可调大插件配置的 requestTimeoutMs，或稍后重试。')
      }
      throw new AigcError(`无法连接同济 AIGC：${error?.message || error}`, '检查网络或站点是否可达。')
    }

    if (kind === 'raw') {
      if (!response.ok) throw await this.toError(response, pathname)
      return response
    }

    return this.unwrap(response, pathname)
  }

  /** 解析 JSON 响应并判断成功/失败，失败抛 AigcError。 */
  async unwrap(response, pathname) {
    let payload = null
    const text = await response.text().catch(() => '')
    if (text.trim() !== '') {
      try {
        payload = JSON.parse(text)
      } catch {
        logDebug(`非 JSON 响应：${pathname}（HTTP ${response.status}）`)
      }
    }

    if (!response.ok) {
      throw await this.toError(response, pathname, payload, text)
    }
    // 上游成功时 code 可能为 0 / 200 / 缺失；非成功 code 一律当失败。
    const code = payload?.code
    if (code !== undefined && code !== 0 && code !== 200) {
      const message = payload?.message || `接口返回错误码 ${code}`
      const hint = code === 401
        ? '登录态失效：请在「设置 → 插件 → 同济 AIGC」里重新登录。'
        : '检查入参（模板 code、参数键值）后重试。'
      throw new AigcError(message, hint)
    }
    return payload?.data !== undefined ? payload.data : payload
  }

  async toError(response, pathname, payload, text = '') {
    const message = payload?.message || (text ? text.slice(0, 300) : `HTTP ${response.status}`)
    const hint =
      response.status === 401 || payload?.code === 401
        ? '登录态失效：请在「设置 → 插件 → 同济 AIGC」里重新登录。'
        : '检查网络、入参与登录态后重试。'
    return new AigcError(`同济 AIGC 请求失败（${pathname}）：${message}`, hint)
  }

  // ---------- 具体接口 ----------

  /** 站点健康检查（用于卡片健康状态）。 */
  health() {
    return this.request('/aigc/health', { noAuth: false })
  }

  /** 当前登录用户（用 /auth/me 验证令牌是否有效）。 */
  me() {
    return this.request('/auth/me', { noAuth: false })
  }

  /** 积分钱包概览：可用积分、套餐周期用量、钱包余额、下次重置时间。 */
  billingOverview() {
    return this.request('/billing/overview')
  }

  /** 我订阅的套餐列表（取 active 套餐的 id 再查用量）。 */
  myCodingPlans() {
    return this.request('/my-coding-plans?page=1&page_size=50')
  }

  /** 套餐用量：图片 / 视频 / 语音的已用与上限。 */
  planUsage(userPlanId) {
    return this.request(`/my-coding-plans/${encodeURIComponent(userPlanId)}/usage`)
  }

  /**
   * 用账号密码登录，返回站点下发的登录响应。
   * 站点登录接口无验证码，直接 POST {username, password}，成功响应 data 含
   * `{ access_token, user, ... }`——插件据此自动取得并保存令牌，用户无需手动找 key。
   */
  login(username, password) {
    return this.request('/auth/login', { method: 'POST', body: { username, password }, noAuth: true })
  }

  /**
   * 统一身份认证（SSO）发现：取 IAM 授权跳转地址。
   *
   * 站点默认登录走 SSO（同济大学统一身份认证），本地账号密码表单仅管理员可用，
   * 普通用户的账号体系不同，所以必须走这里。成功响应 data 含
   * `{ redirect_url }`（也兼容 `{ url }`），前端用它打开浏览器完成统一身份认证；
   * 登录完成后令牌会出现在回调地址 `/sso/callback?token=...` 的查询串里。
   */
  ssoDiscover(domain = 'tongji') {
    const query = `?domain=${encodeURIComponent(domain)}`
    return this.request(`/auth/sso/discover${query}`, { noAuth: true })
  }

  /** 列出可用生成模板（含 paramSchema）。
   * 上游在不同版本里字段命名/类型不一致：老版返回 template_code/template_name 且
   * param_schema 为数组，新版返回 code/name 且 param_schema 为 JSON 字符串。
   * 这里统一归一化为 { template_code, template_name, param_schema: Array }，
   * 下游三个调用方（generate.js / tools.js / index.js 的 /templates 端点）共用同一份结果。 */
  async templates(type) {
    const query = type ? `?type=${encodeURIComponent(type)}` : ''
    const data = await this.request(`/aigc/templates${query}`)
    const list = Array.isArray(data) ? data : (data?.templates || [])
    return list.map((tpl) => {
      const t = { ...tpl }
      if (t.template_code === undefined) t.template_code = t.code
      if (t.template_name === undefined) t.template_name = t.name
      let sch = t.param_schema
      if (typeof sch === 'string') {
        try { sch = JSON.parse(sch) } catch { sch = [] }
      }
      if (!Array.isArray(sch)) sch = Array.isArray(sch?.fields) ? sch.fields : []
      t.param_schema = sch
      return t
    })
  }

  /** 生成前预估积分/费用。 */
  estimate(payload) {
    return this.request('/aigc/estimate', { method: 'POST', body: payload })
  }

  /** 报价。 */
  quote(payload) {
    return this.request('/aigc/quote', { method: 'POST', body: payload })
  }

  /** 创建生成任务，返回 { task_ids: [...] }。 */
  createTask(payload) {
    return this.request('/aigc/tasks', { method: 'POST', body: payload })
  }

  /** 查询单个任务。 */
  getTask(taskId) {
    return this.request(`/aigc/tasks/${encodeURIComponent(taskId)}`)
  }

  /** 任务详情（含输出与计费明细）。 */
  getTaskDetails(taskId) {
    return this.request(`/aigc/tasks/${encodeURIComponent(taskId)}/details`)
  }

  /** 任务列表（分页）。 */
  listTasks({ page = 1, pageSize = 20, status, view } = {}) {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    if (status) params.set('status', status)
    if (view) params.set('view', view)
    return this.request(`/aigc/tasks?${params.toString()}`)
  }

  /** 取消任务。 */
  cancelTask(taskId) {
    return this.request(`/aigc/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: {} })
  }

  /** 删除任务。 */
  deleteTask(taskId) {
    return this.request(`/aigc/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
  }

  /**
   * 上传参考图，返回 { url }。
   * @param {Buffer|Uint8Array} bytes 图片字节
   * @param {string} [filename]
   * @param {string} [contentType]
   */
  async uploadImage(bytes, filename = 'reference.png', contentType = 'image/png') {
    const form = new FormData()
    form.append('image', new Blob([bytes], { type: contentType }), filename)
    const response = await this.request('/aigc/inputs', { method: 'POST', body: form, kind: 'form' })
    return response
  }

  /**
   * 换取产物签名 URL。上游要求传 pathname+search（不带 origin）。
   * @param {string} url 完整或相对 URL
   * @returns {Promise<string>} 可直接下载的 URL
   */
  async mediaTicket(url) {
    const data = await this.request('/aigc/media-ticket', { method: 'POST', body: { url } })
    return data?.url || url
  }

  /**
   * 下载产物到内存（不落盘，交给 runner 决定存哪）。
   * @param {string} url
   * @returns {Promise<Buffer>}
   */
  async downloadBuffer(url) {
    let target = url
    if (/^\/(aigc-preview|remote-home)\//.test(url)) {
      try {
        target = await this.mediaTicket(url)
      } catch (error) {
        logDebug(`换取签名 URL 失败，退回原始 URL：${url}（${error?.message}）`)
      }
    }
    // mediaTicket 换回的可能仍是相对路径（/remote-home/...），需用 baseUrl 解析成绝对 URL 才能下载
    if (target.startsWith('/')) {
      try {
        target = new URL(target, this.baseUrl).toString()
      } catch {
        // 保留原值，交给下方 fetch 抛出更明确的错误
      }
    }
    const response = await fetch(target, {
      signal: linkSignals(this.requestTimeoutMs),
      headers: { Accept: '*/*' },
    })
    if (!response.ok) throw new AigcError(`下载产物失败（${target}）：HTTP ${response.status}`, '产物可能已过期，可重新生成。')
    return Buffer.from(await response.arrayBuffer())
  }
}
