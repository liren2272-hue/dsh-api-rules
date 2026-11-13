/**
 * media-tool.mjs 离线 selftest（goal-deb5e3be）。
 *
 * 不依赖 DSH/Cordis：用假 routeConfigs + 真实 defineMediaTool + 拦截 fetch 走假上游，
 * 断言工具的参数解析、路由解析、payload 组装、渲染与 presentResult 分支。
 *
 * 跑：node --test test/media-tool.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineMediaTool, resolveMediaRoute, extractMedia } from '../lib/media-tool.mjs'

/** 假路由表：一个生图路由 + 一个生视频路由。 */
const ROUTES = [
  { id: 'loomy2api', media: { images: ['Hy-Image-3.5-preview', 'doubao-seedream-5-lite'] } },
  { id: 'minimax2api', media: { images: ['minimax-image'], videos: ['minimax-h3-max'] } },
]

const DEPS = {
  getOrigin: () => 'http://127.0.0.1:8788',
  getRoutes: () => ROUTES,
}

test('resolveMediaRoute: 按 model+kind 找到正确路由', () => {
  assert.equal(resolveMediaRoute(ROUTES, 'images', 'Hy-Image-3.5-preview')?.routeId, 'loomy2api')
  assert.equal(resolveMediaRoute(ROUTES, 'images', 'minimax-image')?.routeId, 'minimax2api')
  assert.equal(resolveMediaRoute(ROUTES, 'videos', 'minimax-h3-max')?.routeId, 'minimax2api')
})

test('resolveMediaRoute: kind 不匹配返回 undefined（model 只会生图不会生视频）', () => {
  assert.equal(resolveMediaRoute(ROUTES, 'videos', 'Hy-Image-3.5-preview'), undefined)
})

test('resolveMediaRoute: 空 model / 空表返回 undefined', () => {
  assert.equal(resolveMediaRoute(ROUTES, 'images', ''), undefined)
  assert.equal(resolveMediaRoute([], 'images', 'Hy-Image-3.5-preview'), undefined)
  assert.equal(resolveMediaRoute(undefined, 'images', 'x'), undefined)
})

test('extractMedia: OpenAI images 格式 {data:[{url}]}', () => {
  assert.equal(extractMedia({ data: [{ url: 'https://x/y.png' }] }).url, 'https://x/y.png')
})

test('extractMedia: minimax 视频直出 url / video_url', () => {
  assert.equal(extractMedia({ url: 'https://v/1.mp4' }).url, 'https://v/1.mp4')
  assert.equal(extractMedia({ video_url: 'https://v/2.mp4' }).url, 'https://v/2.mp4')
})

test('extractMedia: 异步任务 {task_id,status}', () => {
  const m = extractMedia({ task_id: 't-123', status: 'queued' })
  assert.equal(m.taskId, 't-123')
  assert.equal(m.status, 'queued')
  assert.equal(m.url, undefined)
})

test('generate_image ToolDefinition: 名称/参数/output 齐全', () => {
  const tool = defineMediaTool('images', DEPS)
  assert.equal(tool.name, 'api_generate_image')
  assert.equal(typeof tool.description, 'string')
  assert.equal(tool.parameters.required.includes('prompt'), true)
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(typeof tool.presentResult, 'function')
  assert.equal(tool.timeoutMs, 600000)
})

test('generate_video ToolDefinition: 名称/参数含 duration/ratio 不含 width/height', () => {
  const tool = defineMediaTool('videos', DEPS)
  assert.equal(tool.name, 'api_generate_video')
  assert.equal(tool.parameters.properties.duration !== undefined, true)
  assert.equal(tool.parameters.properties.ratio !== undefined, true)
  assert.equal(tool.parameters.properties.width, undefined)
})

test('generate_image execute: 缺 prompt 返回 prompt_required，不打网关', async () => {
  const tool = defineMediaTool('images', DEPS)
  const result = await tool.execute({}, { signal: new AbortController().signal })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'prompt_required')
})

test('generate_image execute: 未知 model 且无 route 返回 no_media_route', async () => {
  const tool = defineMediaTool('images', DEPS)
  const result = await tool.execute({ prompt: 'cat' }, { signal: new AbortController().signal })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'no_media_route')
})

test('generate_image execute: 已知 model 组 size payload 并解析 url', async () => {
  const tool = defineMediaTool('images', DEPS)
  /** 拦 fetch：截 payload、回 OpenAI images 格式。 */
  let captured = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ created: 1, data: [{ url: 'https://img/x.png' }] }),
    }
  }
  try {
    const result = await tool.execute(
      { prompt: 'a clover interchange', model: 'Hy-Image-3.5-preview', width: 768, height: 1344 },
      { signal: new AbortController().signal },
    )
    assert.equal(result.ok, true)
    assert.equal(result.routeId, 'loomy2api')
    assert.equal(result.url, 'https://img/x.png')
    assert.equal(captured.url, 'http://127.0.0.1:8788/loomy2api/v1/images/generations')
    assert.equal(captured.body.prompt, 'a clover interchange')
    assert.equal(captured.body.size, '768x1344')
    assert.equal(captured.body.model, 'Hy-Image-3.5-preview')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('generate_video execute: 组 duration/ratio payload', async () => {
  const tool = defineMediaTool('videos', DEPS)
  let captured = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ url: 'https://vid/1.mp4' }),
    }
  }
  try {
    const result = await tool.execute(
      { prompt: 'traffic timelapse', model: 'minimax-h3-max', duration: 6.4, ratio: '16:9' },
      { signal: new AbortController().signal },
    )
    assert.equal(result.ok, true)
    assert.equal(result.routeId, 'minimax2api')
    assert.equal(result.url, 'https://vid/1.mp4')
    assert.equal(captured.url, 'http://127.0.0.1:8788/minimax2api/v1/videos/generations')
    assert.equal(captured.body.duration, 6)
    assert.equal(captured.body.ratio, '16:9')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute: 上游失败回 ok:false + error，不抛', async () => {
  const tool = defineMediaTool('images', DEPS)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: 'bad' } }),
  })
  try {
    const result = await tool.execute(
      { prompt: 'x', model: 'Hy-Image-3.5-preview' },
      { signal: new AbortController().signal },
    )
    assert.equal(result.ok, false)
    assert.notEqual(result.error, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('output.render: 成功给 url 文本，失败给 error 文本', () => {
  const tool = defineMediaTool('images', DEPS)
  const okBlocks = tool.output.render({}, { ok: true, url: 'https://img/x.png' })
  assert.equal(okBlocks[0].type, 'text')
  assert.equal(okBlocks[0].text.includes('https://img/x.png'), true)
  const failBlocks = tool.output.render({}, { ok: false, error: 'no_media_route' })
  assert.equal(failBlocks[0].type, 'text')
  assert.equal(failBlocks[0].text.includes('no_media_route'), true)
})

test('presentResult: 成功且 url 返回 generic card，含 markdown 图片', () => {
  const tool = defineMediaTool('images', DEPS)
  const view = tool.presentResult({}, { meta: { ok: true, url: 'https://img/x.png' } })
  assert.equal(view.card, 'generic')
  assert.equal(view.content[0].text.includes('![生成的图片](https://img/x.png)'), true)
})

test('presentResult: 失败/无 url 返回 undefined（回落通用呈现）', () => {
  const tool = defineMediaTool('images', DEPS)
  assert.equal(tool.presentResult({}, { meta: { ok: false } }), undefined)
  assert.equal(tool.presentResult({}, { meta: { ok: true } }), undefined)
})

/**
 * 回归测试（真 pipeline 语义，钉死 presentResult 卡片 bug）：
 * DSH 的 pipeline 是 execute 返回值 -> output.presentationMeta(args, value) -> result.meta
 * -> presentResult(args, result) 读 result.meta 出卡片。之前工具漏定义 presentationMeta，
 * meta 恒 undefined，presentResult 永远 return undefined，GUI 卡片出不来——而旧测试拿
 * 假 meta({meta:{ok,url}}) 直接喂 presentResult，掩盖了这个 bug。这里改成真投影链路。
 */
test('presentationMeta -> result.meta -> presentResult 全链路（成功出卡片）', async () => {
  const tool = defineMediaTool('images', DEPS)
  assert.equal(typeof tool.output.presentationMeta, 'function')
  // 拦 fetch，避免打到真网关（DEPS.getOrigin 是真地址）
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ created: 1, data: [{ url: 'https://example/img.png' }] }),
  })
  try {
    const executeResult = await tool.execute(
      { prompt: 'x', model: 'Hy-Image-3.5-preview' },
      { signal: new AbortController().signal },
    )
    // pipeline 会把 execute 的返回值经 presentationMeta 投影成 meta
    const meta = tool.output.presentationMeta({}, executeResult)
    const view = tool.presentResult({}, { meta, isError: false })
    assert.equal(view.card, 'generic')
    assert.equal(view.content[0].text.includes('![生成的图片](https://example/img.png)'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('presentationMeta: 失败值投影后 presentResult 出不来卡片', async () => {
  const tool = defineMediaTool('images', DEPS)
  const executeResult = await tool.execute({ prompt: 'x', model: 'gpt-4o' }, { signal: new AbortController().signal })
  const meta = tool.output.presentationMeta({}, executeResult)
  assert.equal(meta.ok, false)
  assert.equal(tool.presentResult({}, { meta, isError: false }), undefined)
})

/** 假 userQuestions.ask：记录收到的 questions，按脚本回固定 answers。 */
function fakeUQ(script) {
  const calls = []
  return {
    calls,
    ask: async (request) => {
      calls.push(request)
      return { answers: script(request) }
    },
  }
}

test('confirmMediaParams: ask 返回的 model+size 覆盖 payload（正向）', async () => {
  /** 两步 ask：前置问 model → 回 doubao；主确认问 size → 回 1280x720。 */
  const uq = fakeUQ((request) => request.questions.map((q) => (
    q.id === 'media_model'
      ? { id: 'media_model', selected: ['doubao-seedream-5-lite'] }
      : { id: 'media_size', selected: ['1280x720'] }
  )))
  const deps = { ...DEPS, userQuestions: uq }
  const tool = defineMediaTool('images', deps)
  const rootExec = { signal: new AbortController().signal, agent: {}, callId: 'c1' } // parent 缺省=undefined → root，会问
  let captured = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ created: 1, data: [{ url: 'https://example/i.png' }] }),
    }
  }
  try {
    const result = await tool.execute({ prompt: 'cat' }, rootExec)
    assert.equal(result.ok, true)
    assert.equal(uq.calls.length, 2) // 前置问 model + 主确认问 size
    assert.equal(captured.model, 'doubao-seedream-5-lite')
    assert.equal(captured.size, '1280x720')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('confirmMediaParams: 对话已明确模型+尺寸 → 完全不问，直接用 AI 参数', async () => {
  // 用户要求：对话里说清了模型和尺寸就别再问。AI 已给 model+width/height → uq 一次都不被调。
  const uq = fakeUQ(() => [])
  const deps = { ...DEPS, userQuestions: uq }
  const tool = defineMediaTool('images', deps)
  const rootExec = { signal: new AbortController().signal, agent: {}, callId: 'c9' }
  let captured = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ created: 1, data: [{ url: 'https://example/i.png' }] }),
    }
  }
  try {
    const result = await tool.execute(
      { prompt: 'cat', model: 'doubao-seedream-5-lite', width: 1280, height: 720 },
      rootExec,
    )
    assert.equal(result.ok, true)
    assert.equal(uq.calls.length, 0) // 都明确了，不该问
    assert.equal(captured.model, 'doubao-seedream-5-lite')
    assert.equal(captured.size, '1280x720') // 用对话给的尺寸，不是默认 1024x1024
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('confirmMediaParams: 子代理（exec.parent 存在）跳过 ask 不阻断', async () => {
  const uq = fakeUQ(() => [])
  const deps = { ...DEPS, userQuestions: uq }
  const tool = defineMediaTool('images', deps)
  const subExec = { signal: new AbortController().signal, agent: {}, parent: {}, callId: 'c2' }
  let captured = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ created: 1, data: [{ url: 'https://example/i.png' }] }),
    }
  }
  try {
    const result = await tool.execute({ prompt: 'cat', model: 'Hy-Image-3.5-preview', width: 1024, height: 1024 }, subExec)
    assert.equal(result.ok, true)
    assert.equal(uq.calls.length, 0) // 没问
    assert.equal(captured.model, 'Hy-Image-3.5-preview')
    assert.equal(captured.size, '1024x1024')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('confirmMediaParams: ask 抛错降级用 AI 参数（不阻断）', async () => {
  const deps = {
    ...DEPS,
    userQuestions: { ask: async () => { throw new Error('DELEGATED_CALLER') } },
  }
  const tool = defineMediaTool('images', deps)
  const rootExec = { signal: new AbortController().signal, agent: {}, callId: 'c3' }
  let captured = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ created: 1, data: [{ url: 'https://example/i.png' }] }),
    }
  }
  try {
    const result = await tool.execute({ prompt: 'cat', model: 'Hy-Image-3.5-preview', width: 800, height: 600 }, rootExec)
    assert.equal(result.ok, true)
    assert.equal(captured.model, 'Hy-Image-3.5-preview')
    assert.equal(captured.size, '800x600')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('confirmMediaParams: 用户自定义填写（custom）优先于预设', async () => {
  /** 两步 ask，都走 custom 自由填写。 */
  const uq = fakeUQ((request) => request.questions.map((q) => (
    q.id === 'media_model'
      ? { id: 'media_model', selected: [], custom: 'doubao-seedream-5-lite' }
      : { id: 'media_size', selected: [], custom: '640x480' }
  )))
  const deps = { ...DEPS, userQuestions: uq }
  const tool = defineMediaTool('images', deps)
  const rootExec = { signal: new AbortController().signal, agent: {}, callId: 'c4' }
  let captured = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ created: 1, data: [{ url: 'https://example/i.png' }] }),
    }
  }
  try {
    const result = await tool.execute({ prompt: 'cat' }, rootExec)
    assert.equal(result.ok, true)
    assert.equal(captured.model, 'doubao-seedream-5-lite')
    assert.equal(captured.size, '640x480')
  } finally {
    globalThis.fetch = originalFetch
  }
})
