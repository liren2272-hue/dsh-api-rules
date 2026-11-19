/**
 * tongji 规则包自测（离线，不连真实上游）。
 *
 * 覆盖点：
 *   1. 三种 403 文案的区分（网络不通 / 空 key / 错 key）与状态码映射
 *   2. 429 并发上限的识别与专用退避（比通用退避短很多）
 *   3. `reasoning` → `reasoning_content` 镜像（七个模型只发前者，DSH 只读后者）
 *   4. GLM-5.3 剥图 / 其余模型不剥图
 *   5. developer → system 角色归一
 *   6. 工具参数对象壳归一
 *   7. 业务错误（HTTP 200 里夹带 error）的翻译
 *   8. finish_reason 兜底与 ensureFinishReason 的「只思考无正文」例外
 *
 * 运行：node --test test/tongji.test.mjs 或直接 node test/tongji.test.mjs
 */

import { tongjiRules, TONGJI_CONCURRENCY, NON_CHAT_MODELS } from '../lib/rules/tongji.mjs'

let passes = 0
let failures = 0

function check(name, condition, detail) {
  if (condition) {
    passes += 1
    console.log('  ok   ' + name)
  } else {
    failures += 1
    console.log('  FAIL ' + name + (detail === undefined ? '' : ' — ' + detail))
  }
}

function equal(name, actual, expected) {
  check(name, Object.is(actual, expected), 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

function section(title) {
  console.log('\n== ' + title + ' ==')
}

/** 造一个最小的 OpenAI 风格 body。 */
function body(extra = {}) {
  return { model: 'DeepSeek-V4.1-Flash', messages: [{ role: 'user', content: 'hi' }], ...extra }
}

// ---------------------------------------------------------------- 1. 三种 403
section('403 三种文案必须分开')

const netBlocked = JSON.stringify({ error: { code: 403, message: '当前网络环境不支持' } })
const keyEmpty = JSON.stringify({ error: { code: 403, message: 'API密钥不能为空' } })
const keyBad = JSON.stringify({ error: { code: 403, message: 'API密钥不存在' } })

equal('网络不通 → 503', tongjiRules.statusForError({ error: { message: '当前网络环境不支持' } }), 503)
equal('空 key → 401', tongjiRules.statusForError({ error: { message: 'API密钥不能为空' } }), 401)
equal('错 key → 401', tongjiRules.statusForError({ error: { message: 'API密钥不存在' } }), 401)

const netErr = tongjiRules.translateBusinessError({ error: { code: 403, message: '当前网络环境不支持' } })
check('网络不通的错误码是 network_blocked', netErr?.error?.code === 'network_blocked', JSON.stringify(netErr))
check('网络不通的提示里点名 MotionPro', /MotionPro/.test(netErr?.error?.message ?? ''), netErr?.error?.message)

const keyErr = tongjiRules.translateBusinessError({ error: { code: 403, message: 'API密钥不存在' } })
check('错 key 的错误码是 key_invalid', keyErr?.error?.code === 'key_invalid', JSON.stringify(keyErr))
check('错 key 的提示指向 TONGJI_API_KEY', /TONGJI_API_KEY/.test(keyErr?.error?.message ?? ''), keyErr?.error?.message)

check('三种 403 互不混淆',
  new Set([netErr.error.code, keyErr.error.code]).size === 2
  && tongjiRules.statusForError({ error: { message: 'API密钥不能为空' } })
     !== tongjiRules.statusForError({ error: { message: '当前网络环境不支持' } }))

check('403 网络不通不可重试', tongjiRules.isRetryable({ status: 403, text: '当前网络环境不支持' }) === false)
check('403 未知原因可重试', tongjiRules.isRetryable({ status: 403, text: 'something else' }) === true)
check('429 可重试', tongjiRules.isRetryable({ status: 429, text: '' }) === true)
check('400 不可重试', tongjiRules.isRetryable({ status: 400, text: 'bad request' }) === false)

// ---------------------------------------------------------------- 2. 并发
section('并发上限 3')

const busyText = '{"error":{"code":429,"message":"并发请求数已达套餐上限（3 个），请等待正在进行的请求完成后重试"}}'

equal('套餐并发常量是 3', TONGJI_CONCURRENCY, 3)
check('recognises 429 并发文案', tongjiRules.isConcurrencyError(busyText) === true, 'returns false')
check('普通 429 不当并发', tongjiRules.isConcurrencyError('rate limited') === false)
// 并发退避增长得更慢：第 4 次重试时 6s < 通用 15s（后者已在封顶）。
check('并发退避增长比通用退避慢',
  tongjiRules.backoffMs({ attempt: 4, concurrency: true }) < tongjiRules.backoffMs({ attempt: 4, concurrency: false }),
  'concurrency=' + tongjiRules.backoffMs({ attempt: 4, concurrency: true })
  + ' generic=' + tongjiRules.backoffMs({ attempt: 4, concurrency: false }))
check('并发退避有上限 8s', tongjiRules.backoffMs({ attempt: 99, concurrency: true }) === 8_000,
  String(tongjiRules.backoffMs({ attempt: 99, concurrency: true })))
check('并发重试预算 60s', tongjiRules.retryBudgetMs(true) === 60_000, String(tongjiRules.retryBudgetMs(true)))
check('普通重试预算 30s', tongjiRules.retryBudgetMs(false) === 30_000, String(tongjiRules.retryBudgetMs(false)))
check('Retry-After 优先', tongjiRules.backoffMs({ attempt: 0, concurrency: true, retryAfterMs: 5_000 }) >= 5_000)
check('并发冷却 2s', tongjiRules.cooldownMs({}) === 2_000, String(tongjiRules.cooldownMs({})))

// ---------------------------------------------------------------- 3. 思考字段
section('reasoning 镜像到 reasoning_content')

const d1 = { reasoning: 'let me think' }
tongjiRules.normalizeDelta(d1)
equal('reasoning 被镜像', d1.reasoning_content, 'let me think')
equal('reasoning 本身保留', d1.reasoning, 'let me think')

const d2 = { reasoning_content: 'qwen style' }
tongjiRules.normalizeDelta(d2)
equal('reasoning_content 反镜像到 reasoning', d2.reasoning, 'qwen style')
equal('reasoning_content 本身保留', d2.reasoning_content, 'qwen style')

const d3 = { content: null }
tongjiRules.normalizeDelta(d3)
equal('null content 补空串', d3.content, '')

const d4 = { content: 'answer', reasoning: 'thought' }
tongjiRules.normalizeDelta(d4)
equal('正文与思考共存时不互相覆盖', d4.content, 'answer')
equal('共存时思考也镜像', d4.reasoning_content, 'thought')

const d5 = { role: 'assistant' }
tongjiRules.normalizeDelta(d5)
check('无思考字段时不凭空造', d5.reasoning_content === undefined && d5.reasoning === undefined, JSON.stringify(d5))

// normalizeDelta 必须能扛住 null（proxy 在某些帧会传 undefined）
let survived = true
try { tongjiRules.normalizeDelta(null) } catch { survived = false }
check('normalizeDelta 扛 null', survived)

// ---------------------------------------------------------------- 4. 多模态
section('GLM-5.3 剥图，其余保留')

const imagePart = {
  type: 'image_url',
  image_url: { url: 'data:image/png;base64,AAAA' },
}

const withImage = body({
  model: 'GLM-5.3',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this' }, imagePart] }],
})
const outImage = tongjiRules.normalizeRequest({ body: withImage, model: 'GLM-5.3' })
const outContent = outImage.body.messages[0].content
equal('GLM-5.3 的图片段被换成文字', outContent[1].type, 'text')
check('GLM-5.3 的占位文案说明原因', /不支持图片/.test(outContent[1].text ?? ''), outContent[1].text)
equal('GLM-5.3 文字段原样保留', outContent[0].text, 'what is this')
check('GLM-5.3 的 notes 报告剥图数', outImage.notes.some((note) => note.includes('1 张图片')), JSON.stringify(outImage.notes))

const flashImage = body({
  model: 'GLM-5.3-Flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this' }, imagePart] }],
})
const outFlash = tongjiRules.normalizeRequest({ body: flashImage, model: 'GLM-5.3-Flash' })
equal('GLM-5.3-Flash 的图片段保留', outFlash.body.messages[0].content[1].type, 'image_url')
check('GLM-5.3-Flash 不报剥图', outFlash.notes.length === 0, JSON.stringify(outFlash.notes))

check('supportsImages: GLM-5.3 false', tongjiRules.supportsImages('GLM-5.3') === false)
check('supportsImages: GLM-5.3-Flash true', tongjiRules.supportsImages('GLM-5.3-Flash') === true)
check('supportsImages: DeepSeek true', tongjiRules.supportsImages('DeepSeek-V4.1-Flash') === true)

// 嵌套 tool_result 里的图也要剥
const nested = body({
  model: 'GLM-5.3',
  messages: [{
    role: 'tool',
    content: [{ type: 'tool_result', content: [{ type: 'text', text: 'ok' }, imagePart] }],
  }],
})
tongjiRules.normalizeRequest({ body: nested, model: 'GLM-5.3' })
equal('嵌套 tool_result 的图也被剥',
  nested.messages[0].content[0].content[1].type, 'text')

// 字符串内联 [image]
const inline = body({ model: 'GLM-5.3', messages: [{ role: 'user', content: 'look [image] here' }] })
tongjiRules.normalizeRequest({ body: inline, model: 'GLM-5.3' })
check('字符串 [image] 被替换', !inline.messages[0].content.includes('[image]'), inline.messages[0].content)

// ---------------------------------------------------------------- 5. 角色归一
section('developer → system')

const dev = body({ messages: [{ role: 'developer', content: 'be terse' }, { role: 'user', content: 'hi' }] })
tongjiRules.normalizeRequest({ body: dev, model: 'DeepSeek-V4.1-Flash' })
equal('developer 变 system', dev.messages[0].role, 'system')
equal('user 不受影响', dev.messages[1].role, 'user')

// ---------------------------------------------------------------- 6. 工具参数
section('工具参数归一')

const tools = [{
  type: 'function',
  function: {
    name: 'f',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
}]
const toolBody = body({ tools: JSON.parse(JSON.stringify(tools)) })
const toolNotes = tongjiRules.normalizeRequest({ body: toolBody, model: 'DeepSeek-V4.1-Flash' }).notes
check('空壳工具参数被规整', Array.isArray(toolNotes), JSON.stringify(toolNotes))

// ---------------------------------------------------------------- 7. 业务错误翻译
section('HTTP 200 内夹带业务错误')

const biz = tongjiRules.translateBusinessError({ error: { message: '并发请求数已达套餐上限（3 个）', code: 429 } })
check('200 里的并发错误被翻译成 rate_limit', biz?.error?.type === 'rate_limit_error', JSON.stringify(biz))
equal('200 里的并发错误状态码 429', tongjiRules.statusForError({ error: { message: '并发请求数已达套餐上限' } }), 429)

const bizOther = tongjiRules.translateBusinessError({ error: { message: 'some unknown failure', code: 500 } })
check('未知业务错误仍包成标准错误', bizOther?.error?.message === 'some unknown failure', JSON.stringify(bizOther))
equal('未知业务错误状态码 502', tongjiRules.statusForError({ error: { message: 'some unknown failure' } }), 502)

check('没有 error 字段时返回 undefined', tongjiRules.translateBusinessError({ choices: [] }) === undefined)
check('error 是字符串时返回 undefined', tongjiRules.translateBusinessError({ error: 'plain string' }) === undefined)
// 非 chat 模型打 /chat/completions 时上游返回 {"detail":"Not Found"}（没有 error 字段）。
// 光看这句话无法判断原因，必须结合模型名才能给出可操作提示。
const detailOnly = { detail: 'Not Found' }
const nonChat = tongjiRules.translateBusinessError(detailOnly, { model: 'Qwen3-Embedding' })
check('detail 形状 + 非 chat 模型 → 可读提示',
  nonChat?.error?.code === 'non_chat_model' && nonChat.error.message.includes('/v1/embeddings'),
  JSON.stringify(nonChat))
equal('非 chat 模型状态码 400',
  tongjiRules.statusForError(detailOnly, { model: 'MiniMax-H3-Image' }), 400)
check('detail 形状 + 对话模型 → 不抢（返回 undefined）',
  tongjiRules.translateBusinessError(detailOnly, { model: 'DeepSeek-V4.1-Flash' }) === undefined)
check('detail 形状 + 缺 model → 不猜测（返回 undefined）',
  tongjiRules.translateBusinessError(detailOnly) === undefined)
// 鉴权错误是第三种形状：顶层直接 {code, message}，没有 error/detail 包装。
// 实测三种 403 形状并不统一，只认 {error:{...}} 会让「密钥错了」原样漏出去。
const keyShape = { code: 403, message: 'API密钥不存在' }
const keyTr = tongjiRules.translateBusinessError(keyShape)
check('顶层 {code,message} 的错密钥被识别',
  keyTr?.error?.code === 'key_invalid', JSON.stringify(keyTr))
equal('错密钥状态码 401', tongjiRules.statusForError(keyShape), 401)
const emptyKey = { code: 403, message: 'API密钥不能为空' }
check('顶层 {code,message} 的空密钥被识别',
  tongjiRules.translateBusinessError(emptyKey)?.error?.code === 'key_missing')
equal('空密钥状态码 401', tongjiRules.statusForError(emptyKey), 401)
check('顶层 {code,message} 但文案无关 → 不接管（返回 undefined）',
  tongjiRules.translateBusinessError({ code: 500, message: 'internal boom' }) === undefined)
check('顶层 {code,message} 的网络错误也能识别',
  tongjiRules.translateBusinessError({ code: 403, message: '当前网络环境不支持' })?.error?.code === 'network_blocked')
check('非 chat 模型但 404 文案无关 → 不误判',
  tongjiRules.translateBusinessError({ detail: 'quota exceeded' }, { model: 'Whisper' }) === undefined)

// ---------------------------------------------------------------- 8. finish_reason
section('finish_reason 兜底')

equal('other → stop', tongjiRules.finishReason('other'), 'stop')
equal('null → stop', tongjiRules.finishReason(null), 'stop')
equal('length 保留', tongjiRules.finishReason('length'), 'length')
equal('tool_calls 保留', tongjiRules.finishReason('tool_calls'), 'tool_calls')

check('ensureFinishReason: 已发过就不补',
  tongjiRules.ensureFinishReason('m', { sawFinishReason: true }) === true)
check('ensureFinishReason: 只思考无正文不补',
  tongjiRules.ensureFinishReason('m', {
    sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false,
  }) === false)
check('ensureFinishReason: 有正文则补',
  tongjiRules.ensureFinishReason('m', {
    sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false,
  }) === true)
check('ensureFinishReason: meta 为 null 时补', tongjiRules.ensureFinishReason('m', null) === true)

// ---------------------------------------------------------------- 9. 元数据
section('规则包元数据')

equal('包名是 tongji', tongjiRules.name, 'tongji')
equal('并发常量挂在包上', tongjiRules.concurrency, 3)
check('非 chat 模型清单含 Image/Whisper/Embedding/Reranker',
  ['MiniMax-H3-Image', 'Whisper', 'Qwen3-Embedding', 'Qwen3-Reranker'].every((id) => NON_CHAT_MODELS.has(id)),
  JSON.stringify([...NON_CHAT_MODELS]))
check('DeepSeek 不在非 chat 清单里', NON_CHAT_MODELS.has('DeepSeek-V4.1-Flash') === false)
// streamAbortFrame 必须带 meta 守卫：正常结束/有正文/有工具调用一律不给错误帧
// （2026-11-19 bug：无条件返回错误帧，导致每个正常流式请求末尾都追加假错误）
const thinkingOnly = { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false }
const abortFrame = tongjiRules.streamAbortFrame(thinkingOnly)
check('纯思考截断给错误帧', abortFrame !== undefined && abortFrame.error && /中断/.test(abortFrame.error.message),
  JSON.stringify(abortFrame))
check('错误文案不再误导去查 VPN', !/VPN|MotionPro/.test(abortFrame.error.message), abortFrame.error.message)
check('已收 finish_reason 不给错误帧',
  tongjiRules.streamAbortFrame({ sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false }) === undefined)
check('有正文不给错误帧',
  tongjiRules.streamAbortFrame({ sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }) === undefined)
check('有工具调用不给错误帧',
  tongjiRules.streamAbortFrame({ sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: true }) === undefined)
check('未发任何东西不给错误帧',
  tongjiRules.streamAbortFrame({ sawFinishReason: false, sentAnything: false, sawContent: false, sawToolCall: false }) === undefined)
check('meta 为 undefined 不给错误帧', tongjiRules.streamAbortFrame(undefined) === undefined)
check('meta 为 null 不给错误帧', tongjiRules.streamAbortFrame(null) === undefined)

// ---------------------------------------------------------------- 汇总
console.log('\n' + '='.repeat(50))
console.log('通过 ' + passes + ' 项，失败 ' + failures + ' 项')
if (failures > 0) {
  console.log('结果：FAILED')
  process.exitCode = 1
} else {
  console.log('结果：PASSED')
}
