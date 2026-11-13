/**
 * 生图 / 生视频 AI 工具定义（goal-deb5e3be）。
 *
 * 把 loomy2api / minimax2api 的 media 上游（网关 `127.0.0.1:<port>/<routeId>/v1/
 * images|videos/generations`）暴露成 DSH 的标准 AI 工具，让**任意模型**都能非流式
 * 调用生图/生视频；选到 media 模型时再由 agent/pre-step 注入引导（见 index.mjs）。
 *
 * 形态参照 app.asar 取证的 ToolDefinition（dsh-tools/src/contracts.ts）：
 *   - ToolSchema:     { name, description, parameters }
 *   - output:         { schema, render(args, value) -> ContentBlock[] }
 *   - presentResult?: (args, result) -> ToolResultView | undefined
 *   - execute(args, exec) -> Promise<canonical JSON value>（须遵守 exec.signal）
 *
 * 为什么 execute 直接 fetch 网关而不是宿主 `/api/api-rules/media-generate` 端点：
 * 工具跑在 host 进程内，与网关同机，直连回环最短；端点那层是给**浏览器卡片**用的
 * （浏览器过不了网关 Host/Origin 回环校验），工具没这个限制。两者共用同一条网关
 * media() 转发路径，只是入口不同。
 *
 * 网关 bearer：默认 token=undefined 只要求「非空 bearer」，这里给占位，与 media-generate
 * 端点保持一致；真实上游凭证在 route.apiKey / 账号文件里，网关 media() 自己会取。
 */

/** 网关回环地址兜底：正常从 route.origin() 取，取不到时按默认端口拼。 */
const GATEWAY_FALLBACK = 'http://127.0.0.1:8788'

/**
 * 在已登记路由里找「哪个路由提供这个 model 的生图/生视频」。
 *
 * @param {Array<object>} routeConfigs 已登记路由（live.routeConfigs 优先，早期回落局部表）
 * @param {'images'|'videos'} kind
 * @param {string} model 模型 id（如 Hy-Image-3.5-preview / minimax-h3-max）
 * @returns {{ routeId: string, models: string[] } | undefined}
 */
export function resolveMediaRoute(routeConfigs, kind, model) {
  if (!Array.isArray(routeConfigs) || typeof model !== 'string' || model === '') return undefined
  for (const route of routeConfigs) {
    const media = route && typeof route.media === 'object' && route.media !== null ? route.media : null
    if (!media) continue
    const models = Array.isArray(media[kind]) ? media[kind] : []
    if (models.includes(model)) return { routeId: route.id, models }
  }
  return undefined
}

/**
 * 打网关 media 路由，返回规范化结果（不抛）。
 *
 * @param {string} origin 网关 origin（proxy.origin()）
 * @param {string} routeId
 * @param {'images'|'videos'} kind
 * @param {object} payload 上游格式 body（原样转发）
 * @param {AbortSignal} signal 取消信号（来自 exec.signal）
 * @returns {Promise<{ ok: boolean, status: number, data: object }>}
 */
export async function callMediaGateway(origin, routeId, kind, payload, signal) {
  const base = typeof origin === 'string' && origin !== '' ? origin.replace(/\/+$/u, '') : GATEWAY_FALLBACK
  const endpoint = base + '/' + routeId + '/v1/' + kind + '/generations'
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer api-rules-media' },
      body: JSON.stringify(payload ?? {}),
      signal,
    })
    const text = await upstream.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
    return { ok: upstream.ok === true, status: upstream.status, data }
  } catch (error) {
    const aborted = signal?.aborted === true
    return {
      ok: false,
      status: aborted ? 504 : 502,
      data: { error: aborted ? 'timeout' : 'media_upstream_error', detail: String(error?.cause ?? error) },
    }
  }
}

/**
 * 从上游返回里提取可展示的媒体地址（图片 URL / 视频 URL / 异步 task）。
 * 兼容 OpenAI images 格式 { data:[{url}] }、minimax 视频 { url } / { video_url } / { task_id }。
 *
 * @param {object} data
 * @returns {{ url?: string, taskId?: string, status?: string }}
 */
export function extractMedia(data) {
  if (!data || typeof data !== 'object') return {}
  const direct = typeof data.url === 'string' ? data.url : typeof data.video_url === 'string' ? data.video_url : undefined
  if (direct) return { url: direct }
  if (Array.isArray(data.data)) {
    const first = data.data.find((item) => item && typeof item === 'object')
    if (first) {
      if (typeof first.url === 'string') return { url: first.url }
      if (typeof first.b64_json === 'string') return { url: 'data:image/png;base64,' + first.b64_json }
    }
  }
  const taskId = typeof data.task_id === 'string' ? data.task_id : typeof data.id === 'string' ? data.id : undefined
  const status = typeof data.status === 'string' ? data.status : undefined
  if (taskId || status) return { taskId, status }
  return {}
}

/**
 * 生成前强制向用户确认关键参数（硬规则）。
 *
 * 调 ctx.userQuestions.ask() 暂停工具调用、把问题推给用户、等回答后再继续 —— 与
 * ask_user_question 工具同一套底层（dsh-user-questions 服务）。返回合并后的
 * { model, width, height, duration, ratio }，任何一项用户没给就用传入缺省。
 *
 * 限制：userQuestions.ask() 要求调用方是 root agent（assertLiveRoot），子代理/后台任务
 * 会抛 DELEGATED_CALLER / CALLER_NOT_LIVE。所以 exec.parent 存在（子代理）或拿不到
 * agent 时直接跳过提问、用 AI 自己给的参数（或缺省）—— 子代理里没法问人，不阻断。
 * ask() 本身抛错（如 UI 没接 answerer）也降级用缺省，不让硬规则把生成卡死。
 *
 * @param {object} deps deps.userQuestions = ctx.userQuestions（工具注册时从 host 注入）
 * @param {object} exec 工具执行上下文（exec.agent / exec.signal / exec.callId / exec.parent）
 * @param {Array<string>} models 该 kind 可用的模型清单（route.media 里登记的）
 * @param {object} cur AI 本次调用已给的参数（可能为空）
 * @param {(n: string, v: object) => string} t i18n（defineMediaTool 闭包内的翻译函数）
 * @returns {Promise<object>} 确认后的 { model, width, height, duration, ratio }
 */
async function confirmMediaParams(deps, exec, models, cur, t, fields) {
  const uq = deps.userQuestions
  const isImage = cur.kind === 'images'
  // 子代理 / 无 agent / 没接到 userQuestions 服务 → 没法问人，降级用传入值
  if (!canAskMediaParams(deps, exec)) {
    return { model: cur.model, width: cur.width, height: cur.height, duration: cur.duration, ratio: cur.ratio }
  }
  // 本次要问哪些字段：缺省问全部；前置补 model 时只问 model；主确认时只问尺寸/时长。
  // 但 AI 已经从对话里明确拿到的字段（cur 里给了真值）不再重复问——只问缺的。
  const requested = Array.isArray(fields) && fields.length > 0 ? new Set(fields) : new Set(['model', isImage ? 'size' : 'duration'])
  const ask = new Set()
  for (const f of requested) {
    if (f === 'model' && typeof cur.model === 'string' && cur.model !== '') continue
    if (f === 'size' && Number(cur.width) > 0 && Number(cur.height) > 0) continue
    if (f === 'duration' && Number(cur.duration) > 0) continue
    ask.add(f)
  }
  if (ask.size === 0) {
    // 对话已把要问的都说明白了，直接用 AI 给的参数，不打扰用户
    return { model: cur.model, width: cur.width, height: cur.height, duration: cur.duration, ratio: cur.ratio }
  }

  /** 把「模型 + 尺寸」或「模型 + 时长/比例」组成一两条问题（只组本次要问的）。 */
  const questions = []
  if (ask.has('model')) {
    questions.push({
      id: 'media_model',
      question: t('tool.' + cur.kind + '.ask.model'),
      header: t('tool.' + cur.kind + '.ask.modelHeader'),
      options: buildModelOptions(models, cur.model),
    })
  }
  if (isImage && ask.has('size')) {
    questions.push({
      id: 'media_size',
      question: t('tool.images.ask.size', { size: (cur.width ?? 1024) + 'x' + (cur.height ?? 1024) }),
      header: t('tool.images.ask.sizeHeader'),
      options: buildSizeOptions(cur.width, cur.height),
    })
  }
  if (!isImage && ask.has('duration')) {
    questions.push({
      id: 'media_duration',
      question: t('tool.videos.ask.duration', { duration: cur.duration ?? 6 }),
      header: t('tool.videos.ask.durationHeader'),
      options: buildDurationOptions(cur.duration),
    })
  }
  if (questions.length === 0) {
    return { model: cur.model, width: cur.width, height: cur.height, duration: cur.duration, ratio: cur.ratio }
  }

  let answers
  try {
    const result = await uq.ask({
      questions,
      agent: exec.agent,
      signal: exec.signal,
      wait: { callId: exec.callId },
    })
    answers = result && Array.isArray(result.answers) ? result.answers : []
  } catch {
    // 没人答 / 服务异常 / 信号取消 → 降级用 AI 给的参数，不阻断
    return { model: cur.model, width: cur.width, height: cur.height, duration: cur.duration, ratio: cur.ratio }
  }

  /** 把回答合并回参数：selected[0] 是选项 label（模型 id / 预设尺寸），custom 是自由填写。 */
  const out = { model: cur.model, width: cur.width, height: cur.height, duration: cur.duration, ratio: cur.ratio }
  for (const answer of answers) {
    const chosen = Array.isArray(answer.selected) && answer.selected.length > 0 ? answer.selected[0] : ''
    const custom = typeof answer.custom === 'string' && answer.custom.trim() !== '' ? answer.custom.trim() : ''
    if (answer.id === 'media_model') {
      const model = custom !== '' ? custom : chosen
      if (model !== '') out.model = model
    } else if (answer.id === 'media_size') {
      const size = custom !== '' ? custom : chosen
      const dims = parseSize(size)
      if (dims) { out.width = dims.width; out.height = dims.height }
    } else if (answer.id === 'media_duration') {
      const dur = custom !== '' ? Number(custom) : Number(String(chosen).replace(/[^0-9.]/gu, ''))
      if (Number.isFinite(dur) && dur > 0) out.duration = Math.round(dur)
    }
  }
  return out
}

/** 能否向用户提问：接到了 userQuestions 服务、exec 带 agent 且不是子代理。 */
function canAskMediaParams(deps, exec) {
  const uq = deps.userQuestions
  return Boolean(uq && typeof uq.ask === 'function' && exec && exec.agent && exec.parent === undefined)
}

/** 汇总某 kind 在所有路由里登记的全部模型（问用户「用哪个模型」时列候选）。 */
function collectMediaModels(routes, kind) {
  const out = []
  for (const route of Array.isArray(routes) ? routes : []) {
    const list = route && route.media ? route.media[kind] : undefined
    if (Array.isArray(list)) {
      for (const m of list) {
        if (typeof m === 'string' && m !== '' && !out.includes(m)) out.push(m)
      }
    }
  }
  return out
}

/** 模型选项：当前 model 放首位（若在其中），其余按登记顺序。 */
function buildModelOptions(models, current) {
  const list = Array.isArray(models) ? models.filter(m => typeof m === 'string' && m !== '') : []
  const ordered = current && list.includes(current) ? [current, ...list.filter(m => m !== current)] : list
  return ordered.map(m => ({ label: m, description: m === current ? 'AI 默认选择' : undefined }))
}

/** 尺寸选项：AI 给的（若有）放首位标「AI 默认」，再补常见预设。 */
function buildSizeOptions(width, height) {
  const w = Number(width) > 0 ? Math.round(Number(width)) : 1024
  const h = Number(height) > 0 ? Math.round(Number(height)) : 1024
  const aiDefault = w + 'x' + h
  const presets = ['1024x1024', '1280x720', '720x1280', '1920x1080', '1080x1920']
  const ordered = [aiDefault, ...presets.filter(p => p !== aiDefault)]
  return ordered.map(s => ({ label: s, description: s === aiDefault ? 'AI 默认选择' : undefined }))
}

/** 时长选项：AI 给的（若有）放首位标「AI 默认」，再补常见秒数。 */
function buildDurationOptions(duration) {
  const d = Number(duration) > 0 ? Math.round(Number(duration)) : 6
  const aiDefault = d + 's'
  const presets = ['5s', '6s', '8s', '10s']
  const ordered = [aiDefault, ...presets.filter(p => p !== aiDefault)]
  return ordered.map(s => ({ label: s, description: s === aiDefault ? 'AI 默认选择' : undefined }))
}

/** 解析 "WxH" 尺寸串，非法返回 undefined。 */
function parseSize(str) {
  if (typeof str !== 'string') return undefined
  const match = /^\s*(\d{1,5})\s*[x×*]\s*(\d{1,5})\s*$/iu.exec(str)
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return undefined
  return { width, height }
}

/**
 * 构造 generate_image / generate_video 的 ToolDefinition。kind 区分生图/生视频；
 * 两者只在参数与文案上不同，转发/渲染/呈现逻辑一致。
 *
 * @param {'images'|'videos'} kind
 * @param {object} deps
 * @param {() => string | undefined} deps.getOrigin 读网关 origin
 * @param {() => Array<object>} deps.getRoutes 读已登记路由
 * @param {object} [deps.userQuestions] ctx.userQuestions 服务（生成前强制确认参数用）
 * @param {(n: string, v: object) => string} [deps.t] i18n（缺省用内置中文）
 * @returns {object} ToolDefinition
 */
export function defineMediaTool(kind, deps) {
  const isImage = kind === 'images'
  // 【注意】这里**不能**用 generate_image / generate_video 这两个裸名字。
  // 同机的 @local/dsh-comfyui-image 插件已经用这两个名字注册了本地 ComfyUI 后端的
  // generate_image / generate_video。DSH 的 ctx.tools.register 同层不允许重名
  // （重名会抛 tool "generate_image" is already registered），一撞名两边的工具都会
  // 注册失败、报同一个错。所以本插件（云端 API 路由后端）的工具统一加 api- 前缀，
  // 跟 ComfyUI（本地后端）的那套共存。
  const name = isImage ? 'api_generate_image' : 'api_generate_video'
  const t = typeof deps.t === 'function' ? deps.t : defaultText

  /** 工具入参 schema（模型可见）。route 可省，省了按 model 自动解析。 */
  const parameters = {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: t('tool.' + kind + '.param.prompt') },
      model: { type: 'string', description: t('tool.' + kind + '.param.model') },
      route: { type: 'string', description: t('tool.' + kind + '.param.route') },
      ...(isImage
        ? {
            width: { type: 'number', description: t('tool.images.param.width') },
            height: { type: 'number', description: t('tool.images.param.height') },
          }
        : {
            duration: { type: 'number', description: t('tool.videos.param.duration') },
            ratio: { type: 'string', description: t('tool.videos.param.ratio') },
          }),
    },
    required: ['prompt'],
  }

  return {
    name,
    description: t('tool.' + kind + '.desc'),
    parameters,
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const input = args && typeof args === 'object' ? args : {}
      const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
      if (prompt === '') return { ok: false, error: 'prompt_required' }

      const routes = deps.getRoutes() ?? []
      let model = typeof input.model === 'string' ? input.model : ''
      const routeId = typeof input.route === 'string' && input.route !== '' ? input.route : ''
      let resolved = routeId !== '' ? { routeId } : resolveMediaRoute(routes, kind, model)

      /**
       * 硬规则前置：AI 没给 model（或给了无法解析路由的 model）时，先问用户用哪个模型，
       * 拿到确认值再解析路由。子代理/服务缺失时 canAskMediaParams 为 false，跳过提问，
       * 维持原来的 no_media_route 返回。
       */
      if ((!resolved || !resolved.routeId) && canAskMediaParams(deps, exec)) {
        const answered = await confirmMediaParams(
          deps,
          exec,
          collectMediaModels(routes, kind),
          { kind, model: model !== '' ? model : undefined, width: undefined, height: undefined, duration: undefined, ratio: undefined },
          t,
          ['model'],
        )
        const answeredModel = typeof answered.model === 'string' ? answered.model : ''
        if (answeredModel !== '') {
          resolved = routeId !== '' ? { routeId } : resolveMediaRoute(routes, kind, answeredModel)
          if (resolved && resolved.routeId) model = answeredModel
        }
      }
      if (!resolved || !resolved.routeId) {
        return { ok: false, error: 'no_media_route', hint: t('tool.' + kind + '.error.route') }
      }

      /** 组上游 payload：prompt 必带，尺寸/时长按 kind 补。 */
      const payload = { prompt }
      if (model !== '') payload.model = model
      if (isImage) {
        const w = Number(input.width) > 0 ? Math.round(Number(input.width)) : 1024
        const h = Number(input.height) > 0 ? Math.round(Number(input.height)) : 1024
        payload.size = w + 'x' + h
      } else {
        if (Number(input.duration) > 0) payload.duration = Math.round(Number(input.duration))
        if (typeof input.ratio === 'string' && input.ratio !== '') payload.ratio = input.ratio
      }

      /**
       * 硬规则：生成前强制向用户确认「模型 + 尺寸（生图）/ 时长（生视频）」。
       * 调 userQuestions.ask() 暂停等回答，拿不到（子代理/没人答/服务异常）就降级
       * 用 AI 给的参数。确认值覆盖 payload。
       */
      const confirmed = await confirmMediaParams(
        deps,
        exec,
        resolved.models ?? [],
        {
          kind,
          model: model !== '' ? model : undefined,
          width: isImage && Number(input.width) > 0 ? Math.round(Number(input.width)) : undefined,
          height: isImage && Number(input.height) > 0 ? Math.round(Number(input.height)) : undefined,
          duration: !isImage && Number(input.duration) > 0 ? Math.round(Number(input.duration)) : undefined,
          ratio: !isImage && typeof input.ratio === 'string' ? input.ratio : undefined,
        },
        t,
        isImage ? ['size'] : ['duration'],
      )
      const finalModel = typeof confirmed.model === 'string' && confirmed.model !== '' ? confirmed.model : model
      if (finalModel !== '') payload.model = finalModel
      if (isImage) {
        const w = Number(confirmed.width) > 0 ? Math.round(Number(confirmed.width)) : Number(payload.size.split('x')[0])
        const h = Number(confirmed.height) > 0 ? Math.round(Number(confirmed.height)) : Number(payload.size.split('x')[1])
        payload.size = w + 'x' + h
      } else {
        if (Number(confirmed.duration) > 0) payload.duration = Math.round(Number(confirmed.duration))
        if (typeof confirmed.ratio === 'string' && confirmed.ratio !== '') payload.ratio = confirmed.ratio
      }
      const usedModel = finalModel

      const origin = deps.getOrigin()
      const result = await callMediaGateway(origin, resolved.routeId, kind, payload, exec.signal)
      const media = result.ok ? extractMedia(result.data) : {}
      return {
        ok: result.ok,
        kind,
        routeId: resolved.routeId,
        model: usedModel !== '' ? usedModel : undefined,
        prompt,
        url: media.url,
        taskId: media.taskId,
        status: media.status,
        error: result.ok ? undefined : (result.data?.error ?? 'upstream_error'),
        detail: result.ok ? undefined : result.data,
      }
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          kind: { type: 'string' },
          routeId: { type: 'string' },
          model: { type: 'string' },
          prompt: { type: 'string' },
          url: { type: 'string' },
          taskId: { type: 'string' },
          status: { type: 'string' },
          error: { type: 'string' },
        },
        required: ['ok'],
      },
      /**
       * UI 卡片要用的私有元数据：由 pipeline 投影成 result.meta 持久化到 session log，
       * presentResult 再从 result.meta 读回来出卡片（app.asar 取证：client 只读 session
       * log 的 meta，不直接调 presentResult；不定义 presentationMeta 则 meta 恒 undefined，
       * 卡片永远出不来）。这里把 ok/url/kind 原样透传。
       */
      presentationMeta(_args, value) {
        const v = value && typeof value === 'object' ? value : {}
        return { ok: v.ok === true, url: typeof v.url === 'string' ? v.url : undefined, kind: v.kind ?? kind }
      },
      /**
       * 模型可见内容：成功给可点 URL / 异步任务，失败给错误码。
       * 这里给纯文本 block，URL 让模型能转述给用户。
       */
      render(_args, value) {
        const v = value && typeof value === 'object' ? value : {}
        if (v.ok !== true) {
          return [{ type: 'text', text: t('tool.' + kind + '.result.fail', { error: String(v.error ?? 'unknown') }) }]
        }
        if (typeof v.url === 'string' && v.url !== '') {
          return [{ type: 'text', text: t('tool.' + kind + '.result.ok', { url: v.url }) }]
        }
        return [
          { type: 'text', text: t('tool.' + kind + '.result.async', { taskId: String(v.taskId ?? ''), status: String(v.status ?? '') }) },
        ]
      },
    },
    /**
     * 原生 UI 的完成态卡片：成功时把 URL 作为 markdown 内容渲染（GUI 自动出图）。
     * GenericResultView.content 收 ContentBlock[]；给 markdown 图片/链接文本块。
     */
    presentResult(_args, result) {
      const meta = result && typeof result.meta === 'object' && result.meta !== null ? result.meta : {}
      if (meta.ok !== true) return undefined
      const url = typeof meta.url === 'string' ? meta.url : ''
      if (url === '') return undefined
      const title = t('tool.' + kind + '.card.title')
      const md = isImage ? '![' + title + '](' + url + ')' : '[' + title + '](' + url + ')'
      return { card: 'generic', title, content: [{ type: 'text', text: md }] }
    },
  }
}

/** 内置中文文案（deps.t 缺省时兜底，避免没接 i18n 就拿不到提示）。 */
function defaultText(name, vars) {
  const table = {
    'tool.images.desc': '生成一张图片。给出提示词即可；可选指定模型、路由与宽高。生成后返回图片地址。',
    'tool.videos.desc': '生成一段视频。给出提示词即可；可选指定模型、路由、时长（秒）与画面比例。生成后返回视频地址或异步任务号。',
    'tool.images.param.prompt': '画面描述（提示词）',
    'tool.videos.param.prompt': '画面描述（提示词）',
    'tool.images.param.model': '生图模型 id，如 Hy-Image-3.5-preview。省略时按已登记路由自动解析。',
    'tool.videos.param.model': '生视频模型 id，如 minimax-h3-max。省略时按已登记路由自动解析。',
    'tool.images.param.route': '路由 id（如 loomy2api / minimax2api）。省略时按 model 自动解析。',
    'tool.videos.param.route': '路由 id（如 minimax2api）。省略时按 model 自动解析。',
    'tool.images.param.width': '图片宽度（像素，默认 1024）',
    'tool.images.param.height': '图片高度（像素，默认 1024）',
    'tool.videos.param.duration': '视频时长（整秒）',
    'tool.videos.param.ratio': '画面比例，如 16:9 / 9:16',
    'tool.images.error.route': '没有找到能生这个图的模型。请确认路由已在 API Rules 里配置了 media.images，或显式传 route。',
    'tool.videos.error.route': '没有找到能生这个视频的模型。请确认路由已在 API Rules 里配置了 media.videos，或显式传 route。',
    'tool.images.result.ok': '图片已生成：{url}',
    'tool.videos.result.ok': '视频已生成：{url}',
    'tool.images.result.async': '生图任务已提交，任务号 {taskId}，状态 {status}。',
    'tool.videos.result.async': '生视频任务已提交，任务号 {taskId}，状态 {status}。',
    'tool.images.result.fail': '生图失败：{error}',
    'tool.videos.result.fail': '生视频失败：{error}',
    'tool.images.card.title': '生成的图片',
    'tool.videos.card.title': '生成的视频',
    'tool.images.ask.model': '用哪个模型生成这张图？',
    'tool.images.ask.modelHeader': '生图模型',
    'tool.images.ask.size': '图片尺寸用多少？（AI 建议 {size}，可从预设选或自己填 宽x高）',
    'tool.images.ask.sizeHeader': '生图尺寸',
    'tool.videos.ask.model': '用哪个模型生成这段视频？',
    'tool.videos.ask.modelHeader': '生视频模型',
    'tool.videos.ask.duration': '视频时长用多少秒？（AI 建议 {duration}s，可从预设选或自己填）',
    'tool.videos.ask.durationHeader': '生视频时长',
  }
  let out = table[name] ?? name
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
  }
  return out
}
