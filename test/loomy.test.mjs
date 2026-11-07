/**
 * loomy / loomy2api 接入的回归测试。
 *
 * 覆盖几件事：
 *  1. loomy 路由的 normalizeRoute 正确规整 launch（command/args/cwd/env/readyUrl），
 *     且 env 里钉死的网关 key 能存活下来（这是「首次启动随机 key 只打印一次」的对策）；
 *  2. loomyRules 的请求整形：剥离 reasoning/thinking、把
 *     max_completion_tokens/max_output_tokens 归一到 max_tokens；**保留 reasoning_effort**
 *     （vendored loomy2api 读它并透传上游，是思考强度档位的唯一载体）；
 *  3. **决定性修复**：给 tools 里不合规的「裸属性表」parameters 补上标准
 *     {type:object, properties} 外壳——根级 `type` 键正是 spark-x2.6 确定性 400
 *     「请求有误…iflytek-spark-loomy」的触发点（与 officeace.mjs 同类）；
 *  4. null content chunk 归一成空串；finish_reason 兜底；
 *  5. 与 raccoon 同构：上游自己换号重试，本层只认 429/502/503/504，
 *     400 一律不重试（确定性 400 重试只会污染 keep-alive 连接），退避短、不叠预算；
 *  6. vendor 内嵌网关的 400 瞬时重试补丁还在（避免 vendor 重新同步把补丁冲掉）。
 *
 * 不连真实 loomy2api。运行：node test/loomy.test.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalizeRoute } from '../lib/proxy.mjs'
import { loomyRules } from '../lib/rules/loomy.mjs'

let failures = 0
let passes = 0

function check(name, condition, detail) {
  if (condition) {
    passes += 1
    console.log('PASS  ' + name)
    return
  }
  failures += 1
  console.log('FAIL  ' + name + (detail === undefined ? '' : '  → ' + detail))
}

function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected))
}

// ------------------------------------------------- normalizeRoute 接收 loomy 路由
{
  const route = normalizeRoute({
    id: 'loomy2api',
    upstream: 'http://127.0.0.1:17890/v1',
    apiKey: 'sk-loomy-local',
    rules: ['loomy2api'],
    concurrency: 4,
    sessionHoldMs: 60000,
    launch: {
      command: 'C:\\\\...\\\\vendor\\\\loomy2api\\\\.venv\\\\Scripts\\\\python.exe',
      args: ['-m', 'loomy2api', 'serve'],
      cwd: 'C:\\\\...\\\\vendor\\\\loomy2api',
      env: { LOOMY_PORT: '17890', LOOMY_API_KEYS: 'sk-loomy-local' },
      readyUrl: 'http://127.0.0.1:17890/health',
      readyTimeoutMs: 60000,
      // 注意：这里不传 readyPollMs，模拟 YAML 原始配置——normalizeRoute 只在
      // raw.launch.readyPollMs 不是数字时才现场规整（proxy.mjs），从而应用 killOnStop 默认值。
      // 传了 readyPollMs 会被当成「已规整」原样带过，launch 就不再是 normalizeLaunch 的产物。
    },
  })
  equal('loomy2api route id', route.id, 'loomy2api')
  check('loomy2api route 保留了 launch', route.launch !== undefined)
  equal('loomy2api launch args', JSON.stringify(route.launch.args), JSON.stringify(['-m', 'loomy2api', 'serve']))
  // env 钉死 key 是本接入的关键：否则首次启动随机 key 只打印一次、拿不到。
  equal('loomy2api launch env 保留 LOOMY_API_KEYS', route.launch.env?.LOOMY_API_KEYS, 'sk-loomy-local')
  equal('loomy2api launch env 保留 LOOMY_PORT', route.launch.env?.LOOMY_PORT, '17890')
  // readyUrl（站点根的 /health）优先于 upstream + readyPath。
  equal('loomy2api launch readyUrl', route.launch.readyUrl, 'http://127.0.0.1:17890/health')
  equal('loomy2api launch killOnStop 默认 true', route.launch.killOnStop, true)
  equal('loomy2api upstream 被保留', route.upstream, 'http://127.0.0.1:17890/v1')
}

// ------------------------------------------------- loomyRules 请求整形
{
  const body = {
    model: 'GLM-5.3-Flash',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning: { effort: 'high' },
    reasoning_effort: 'high',
    thinking: { type: 'enabled' },
    max_completion_tokens: 2048,
    max_tokens: 1000,
    max_output_tokens: 3000,
  }
  const { notes } = loomyRules.normalizeRequest({ body })
  check('loomy 剥离了 reasoning', !('reasoning' in body), notes.join(','))
  check('loomy 保留 reasoning_effort（上游思考强度档位）', body['reasoning_effort'] === 'high')
  check('loomy 剥离了 thinking', !('thinking' in body))
  // 三者同时出现取最小：min(1000, 2048, 3000) = 1000
  equal('loomy 归一 max_tokens = min', body['max_tokens'], 1000)
  check('loomy 删掉了 max_completion_tokens', !('max_completion_tokens' in body))
  check('loomy 删掉了 max_output_tokens', !('max_output_tokens' in body))
  check('loomy 不剥离 messages 角色', body.messages[0].role === 'user')
  check('loomy 不改模型字段', body.model === 'GLM-5.3-Flash')
}

{
  // 只给 max_output_tokens 时也应落到 max_tokens
  const body = { model: 'x', messages: [], max_output_tokens: 500 }
  loomyRules.normalizeRequest({ body })
  equal('loomy 只有 max_output_tokens 时归入 max_tokens', body['max_tokens'], 500)
  check('loomy 删掉原 max_output_tokens', !('max_output_tokens' in body))
}

{
  // 没给任何 max 字段时不凭空补
  const body = { model: 'x', messages: [] }
  loomyRules.normalizeRequest({ body })
  check('loomy 无 max 字段时不补', !('max_tokens' in body))
}

// ------------------------------------------------- 裸 tools 参数补壳（真正的修复）
// 决定性消融（见 probe_flat_tools.py）：合规 object 外壳 tools → 200；
// 裸属性表（根级 `type` 键）→ 400 iflytek-spark-loomy；补壳后 → 200。
// 与 officeace.mjs 的 ModelArts 81001 同类根因、同款修复。
function flatTool(name, withType = true) {
  const params = {
    listPath: { type: 'string', description: 'url list file' },
    query: { type: 'string', description: 'keywords' },
    top: { type: 'integer', description: 'top N' },
  }
  if (withType) params.type = { type: 'string', enum: ['all', 'journal', 'thesis'] }
  else params.kind = { type: 'string', enum: ['all', 'journal', 'thesis'] }
  return { type: 'function', function: { name, description: 'do ' + name, parameters: params } }
}
function cleanTool(name) {
  return {
    type: 'function',
    function: {
      name,
      description: 'do ' + name,
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  }
}

{
  // 裸属性表（含根级 type 键）应被补成 {type:object, properties: 原表}。
  const body = { model: 'spark-x2.6', messages: [{ role: 'user', content: 'hi' }], tools: [flatTool('cnki_search')] }
  const { notes } = loomyRules.normalizeRequest({ body })
  const p = body.tools[0].function.parameters
  equal('loomy 裸根补壳：根 type 变成 object', p.type, 'object')
  check('loomy 裸根补壳：properties 是对象', p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties))
  // 参数一个不少、名字一个不改，根级 `type` 降级为 properties 里的普通参数。
  const props = (p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties)) ? p.properties : {}
  check('loomy 补壳保留 listPath/query/top 三个参数', ['listPath', 'query', 'top'].every((k) => k in props))
  check('loomy 补壳把根级 type 降为 properties.type 普通参数', 'type' in props && typeof props.type === 'object')
  check('loomy 补壳写进 notes', notes.some((n) => n.includes('flat tool parameter')))
}

{
  // 合规 object 外壳一律原样放行（不重写、不计数）。
  const original = cleanTool('alpha')
  const snapshot = JSON.stringify(original)
  const body = { model: 'spark-x2.6', messages: [], tools: [original] }
  const { notes } = loomyRules.normalizeRequest({ body })
  equal('loomy 合规 object 外壳原样不动', JSON.stringify(body.tools[0]), snapshot)
  check('loomy 合规外壳不写补壳 notes', !notes.some((n) => n.includes('flat tool parameter')))
}

{
  // type:object 但 properties 缺失/不合规：只补 properties，保留同级 schema 关键字。
  const body = { model: 'x', messages: [], tools: [{ type: 'function', function: { name: 'x', parameters: { type: 'object', required: ['a'] } } }] }
  loomyRules.normalizeRequest({ body })
  const p = body.tools[0].function.parameters
  equal('loomy 缺 properties 的 object 只补 properties', p.type, 'object')
  check('loomy 补 properties 为对象', p.properties !== null && typeof p.properties === 'object')
  check('loomy 保留 required 同级关键字', Array.isArray(p.required) && p.required[0] === 'a')
}

{
  // 裸 {name, parameters} 形状（无 function 包装）也要处理。
  const body = { model: 'x', messages: [], tools: [{ name: 'bare', parameters: { type: { type: 'string' }, q: { type: 'string' } } }] }
  loomyRules.normalizeRequest({ body })
  const p = body.tools[0].parameters
  equal('loomy 裸工具形状也补壳', p.type, 'object')
  const props = (p.properties !== null && typeof p.properties === 'object' && !Array.isArray(p.properties)) ? p.properties : {}
  check('loomy 裸工具形状保留原参数', 'type' in props && 'q' in props)
}

{
  // 贴近真实：93 个合规 + 6 个裸根（cnki_* 家族），全部裸根都要补。
  const tools = []
  for (let i = 0; i < 93; i++) tools.push(cleanTool('tool_' + i))
  const flatNames = ['cnki_search', 'cnki_download', 'cnki_batch', 'cnki_verify', 'cnki_task_status', 'cnki_doctor']
  for (const n of flatNames) tools.push(flatTool(n))
  const body = { model: 'spark-x2.6', messages: [], tools }
  const { notes } = loomyRules.normalizeRequest({ body })
  const wrapped = body.tools.filter((t) => {
    const fn = t.function || t
    return fn.parameters && fn.parameters.type === 'object'
  }).length
  equal('loomy 99 工具混合：全部补成合规外壳', wrapped, 99)
  check('loomy 99 工具混合：notes 报 6 个补壳', notes.some((n) => n.includes('wrapped 6 flat tool parameter')))
}

{
  // 非数组 tools / 缺 parameters / 非对象 tools 不崩、不误补。
  for (const tools of [undefined, null, 'oops', {}, [null, 3, 'x'], [{ type: 'function', function: { name: 'nope' } }]]) {
    const body = { model: 'x', messages: [] }
    if (tools !== undefined) body.tools = tools
    let ok = true
    try { loomyRules.normalizeRequest({ body }) } catch (e) { ok = false; console.log('  threw: ' + e.message) }
    check('loomy 异常 tools 形状不崩（' + JSON.stringify(tools) + '）', ok)
  }
}

// ------------------------------------------------- loomyRules 响应整形
{
  equal('loomy finishReason other -> stop', loomyRules.finishReason('other'), 'stop')
  equal('loomy finishReason null -> stop', loomyRules.finishReason(null), 'stop')
  equal('loomy finishReason stop 原样', loomyRules.finishReason('stop'), 'stop')
  equal('loomy finishReason length 原样', loomyRules.finishReason('length'), 'length')
  const delta = { content: null }
  loomyRules.normalizeDelta(delta)
  equal('loomy null content chunk -> 空串', delta['content'], '')
  const delta2 = { content: 'hi' }
  loomyRules.normalizeDelta(delta2)
  equal('loomy 非空 content 不动', delta2['content'], 'hi')
  check('loomy 支持图片', loomyRules.supportsImages() === true)
}

// ------------------------------------------------- 与 raccoon 同构：只认「可立刻重来」
{
  check('loomy 429 可重试', loomyRules.isRetryable({ status: 429 }) === true)
  check('loomy 502 可重试', loomyRules.isRetryable({ status: 502 }) === true)
  check('loomy 503 可重试', loomyRules.isRetryable({ status: 503 }) === true)
  check('loomy 504 可重试', loomyRules.isRetryable({ status: 504 }) === true)
  // 401/402/403 在 loomy2api 里已换号处理过；到这里还失败说明整池不可用，不重试。
  check('loomy 401 不重试', loomyRules.isRetryable({ status: 401 }) === false)
  check('loomy 402 不重试', loomyRules.isRetryable({ status: 402 }) === false)
  check('loomy 403 不重试', loomyRules.isRetryable({ status: 403 }) === false)
  check('loomy 200 不重试', loomyRules.isRetryable({ status: 200 }) === false)
  check('loomy 500 不重试（上游已换号处理过）', loomyRules.isRetryable({ status: 500 }) === false)
  // 400 一律不重试：tools 补壳后那句 iflytek-spark-loomy 400 已不会再出现；
  // 万一有别种 400（空 messages、参数非法）那是确定性失败，重试不会改变结果，
  // 实测还曾把网关 keep-alive 连接拖出二次「messages 不能为空」，反把真错误盖掉。
  const transient400 = '{"error":{"message":"请求有误，请重试；若多次出现请更新应用版本","type":"invalid_request_error","param":null,"code":400,"metadata":{"provider_name":"iflytek-spark-loomy"}}}'
  check('loomy 已知瞬时 400 也不重试（交给上游确定性错误）', loomyRules.isRetryable({ status: 400, text: transient400 }) === false)
  check('loomy 其它 400 不重试', loomyRules.isRetryable({ status: 400, text: 'messages 不能为空' }) === false)
  check('loomy 无文案 400 不重试', loomyRules.isRetryable({ status: 400 }) === false)
  check('loomy 非 400 状态带该文案也不重试', loomyRules.isRetryable({ status: 422, text: transient400 }) === false)
  // 退避短一档：账号冷却以百秒计，本层只是磨掉瞬时抖动。
  check('loomy 退避上限 15s', loomyRules.backoffMs({ attempt: 10 }) <= 15_000)
  check('loomy 重试预算 20s', loomyRules.retryBudgetMs({}) === 20_000)
  check('loomy 全局冷却 0（不叠冷却）', loomyRules.cooldownMs() === 0)
}

// ------------------------------------------------- vendor 内嵌 loomy2api：上游 400 瞬时重试
// 星火 spark-x2.6 等模型会回 400「请求有误，请重试；若多次出现请更新应用版本」。
// 内嵌网关 vendor/loomy2api 原先把 400 当 FATAL 直接判死，单账号池下瞬间变 502。
// 这里只读校验 vendor 补丁还在（避免将来 vendor 重新同步把补丁冲掉却没人发现）。
// 注：真正的根因已在 rules 层用「裸 tools 补壳」修掉，这层只是防御性兜底。
{
  const here = dirname(fileURLToPath(import.meta.url))
  const vendorRoot = join(here, '..', 'vendor', 'loomy2api', 'loomy2api')
  let serverSrc = ''
  let configSrc = ''
  try {
    serverSrc = readFileSync(join(vendorRoot, 'server.py'), 'utf8')
    configSrc = readFileSync(join(vendorRoot, 'config.py'), 'utf8')
  } catch (error) {
    check('vendor loomy2api 源码可读', false, String(error?.message ?? error))
  }
  if (serverSrc) {
    // 400 必须从 FATAL_REQUEST 移出（只留 404/422），否则仍会判死。
    const fatal = serverSrc.match(/FATAL_REQUEST\s*=\s*\(([^)]*)\)/)
    check('vendor FATAL_REQUEST 已移出 400', fatal !== null && !/\b400\b/.test(fatal[1]), fatal && fatal[1])
    check('vendor FATAL_REQUEST 仍含 404', fatal !== null && /\b404\b/.test(fatal[1]))
    check('vendor FATAL_REQUEST 仍含 422', fatal !== null && /\b422\b/.test(fatal[1]))
    // 400 专属守卫：计数、封顶、退避、允许重选同账号、continue。
    check('vendor 有 400 瞬时重试守卫', /if (?:resp\.)?status == 400:/.test(serverSrc))
    check('vendor 有 400 重试计数器', /t400 \+= 1/.test(serverSrc))
    check('vendor 400 预算用尽即透传', /t400 > int\(gw\.cfg\.get\("transient_400_retries"\) or 0\)/.test(serverSrc))
    check('vendor 流式 400 用预算封顶', /t400 <= budget/.test(serverSrc))
    check('vendor 400 重试前退避', /time\.sleep\(self\._transient_400_sleep\(\)\)/.test(serverSrc))
    check('vendor 400 重试弹出来过账号再 continue', /tried\.pop\(\)/.test(serverSrc))
    check('vendor 有退避秒数 helper', /def _transient_400_sleep/.test(serverSrc))
    // 五条重试路径都要补上：chat/messages × 流式/非流式 + responses 兼容层。
    // 上次修复只补了 3 条非流式，漏了 DSH 实际全走的 2 条流式（单账号池下 400 变 502）。
    const guardCount = (serverSrc.match(/if (?:resp\.)?status == 400:/g) || []).length
    check('vendor 五条重试路径都补了 400 守卫', guardCount === 5, 'got ' + guardCount)
    check('vendor 用尽后透传原始 400（last_400）', /if last_400 is not None:/.test(serverSrc))
    const chatStreamBody = serverSrc.slice(serverSrc.indexOf('def _chat_stream('), serverSrc.indexOf('def _messages('))
    const msgsStreamBody = serverSrc.slice(serverSrc.indexOf('def _messages_stream'))
    check('_chat_stream 内有 400 守卫', /if resp\.status == 400:/.test(chatStreamBody))
    check('_chat_stream 内有 400 透传', /if last_400 is not None:/.test(chatStreamBody))
    check('_messages_stream 内有 400 守卫', /if resp\.status == 400:/.test(msgsStreamBody))
    check('_messages_stream 内有 400 透传', /if last_400 is not None:/.test(msgsStreamBody))
  }
  if (configSrc) {
    check('vendor 配置有 transient_400_retries 默认值', /"transient_400_retries":\s*\d+/.test(configSrc))
    check('vendor 配置有 transient_400_backoff_seconds 默认值', /"transient_400_backoff_seconds":\s*[\d.]+/.test(configSrc))
  }
}

// ------------------------------------------------- spark-x2.6 断流把思考当结果 + 10053 收尾帧（回归）
// 根因：postWithRetry 的 AbortSignal.timeout(120s) 掐断长思考流的响应体 → 网关
// self.wfile.write 抛 ConnectionAbortedError[WinError 10053] → _chat_stream 误判
// 「上游断流」发「无 choices 的 error 帧 + [DONE]」→ pipeStream 不认识它、补
// finish_reason:'stop'，于是只剩 reasoning_content 的截断流被当成正常答案输出。
// 修复（全部语义落在规则层，便于其它上游扩展）：
//   F1 路由 timeoutMs=3600000；F2 规则层翻译断流 error 帧（translateBusinessError
//   / statusForError）；F3 规则层拒绝伪造 stop（ensureFinishReason(model, meta)）+
//   规则层自定义收尾帧（streamAbortFrame(meta)，registry 声明缺省、proxy 只问钩子）；
//   F4 网关把 ConnectionAbortedError 归为「客户端已断开」。
{
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const readSrc = (rel) => { try { return readFileSync(join(pluginRoot, rel), 'utf8') } catch { return '' } }
  const proxySrc = readSrc('lib/proxy.mjs')
  const registrySrc = readSrc('lib/registry.mjs')
  const loomySrc = readSrc('lib/rules/loomy.mjs')
  const patchSrc = readSrc('cordis.patch.yml')
  const serverSrc2 = readSrc('vendor/loomy2api/loomy2api/server.py')
  const tbe = typeof loomyRules.translateBusinessError === 'function' ? loomyRules.translateBusinessError : () => undefined
  const sfe = typeof loomyRules.statusForError === 'function' ? loomyRules.statusForError : () => undefined
  const saf = typeof loomyRules.streamAbortFrame === 'function' ? loomyRules.streamAbortFrame : () => undefined

  // F1：root cause —— 路由超时抬到 1 小时（对齐内嵌网关 config.py 的 timeout:3600）
  {
    const i = patchSrc.indexOf('- id: loomy2api')
    const block = i === -1 ? '' : patchSrc.slice(i, patchSrc.indexOf('models:', i))
    check('F1 loomy2api 路由超时抬到 1 小时', /timeoutMs:\s*3600000/.test(block), block.slice(0, 260))
  }

  // F2：断流 error 帧翻译成 OpenAI 错误帧
  const abortFrame = { error: { message: '上游流中断（ConnectionAbortedError）/ upstream stream broken: [WinError 10053] 你的主机中的软件中止了一个已建立的连接。', type: 'upstream_error', code: 504 } }
  const translated = tbe(abortFrame)
  check('F2 断流帧被翻译成 upstream_error', translated !== undefined && translated.error && translated.error.type === 'upstream_error' && translated.error.code === 504, JSON.stringify(translated))
  check('F2 正常 chunk 不误伤', tbe({ choices: [{ index: 0, delta: { content: '1+1=2' } }] }) === undefined)
  check('F2 无关 error 不误伤', tbe({ error: { message: 'invalid api key', type: 'invalid_request_error', code: 401 } }) === undefined)
  check('F2 statusForError 断流映射 504', sfe(abortFrame) === 504)
  check('F2 statusForError 正常帧 undefined', sfe({ choices: [] }) === undefined)
  check('F2 旧接口 finishReason 不受影响', loomyRules.finishReason('other') === 'stop')

  // F3：纯思考截断流不补 stop —— 规则层策略 + 可扩展钩子
  check('F3 思考截断 ensureFinishReason=false', loomyRules.ensureFinishReason('spark-x2.6', { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false }) === false)
  check('F3 有正文截断 ensureFinishReason=true', loomyRules.ensureFinishReason('spark-x2.6', { sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }) === true)
  check('F3 已有 finish_reason ensureFinishReason=true', loomyRules.ensureFinishReason('spark-x2.6', { sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false }) === true)
  check('F3 不传 meta 保持 true（向后兼容）', loomyRules.ensureFinishReason('spark-x2.6') === true)
  check('F3 不剥离 reasoning_content', (() => { const d = { reasoning_content: '嗯…', content: null }; loomyRules.normalizeDelta(d); return d.reasoning_content === '嗯…' && d.content === '' })())
  check('F3 pipeStream 传 meta 给 ensureFinishReason', /ensureFinishReason\(model, meta\)/.test(proxySrc))
  check('F3 pipeStream 追踪 sawContent/sawToolCall', /sawContent = true/.test(proxySrc) && /sawToolCall = true/.test(proxySrc))
  check('F3 catch 用 !sawFinishReason', /if \(!sawFinishReason\) \{/.test(proxySrc))

  // F3-扩展：收尾帧文案/判定全部在规则层，框架只剩「问钩子」——这是本次可扩展重构的核心
  const thinkingMeta = { sawFinishReason: false, sentAnything: true, sawContent: false, sawToolCall: false }
  const safFrame = saf(thinkingMeta)
  check('F3 规则层 streamAbortFrame 纯思考返回 upstream_error(504)', safFrame !== undefined && safFrame.error && safFrame.error.type === 'upstream_error' && safFrame.error.code === 504 && /aborted during thinking/.test(safFrame.error.message), JSON.stringify(safFrame))
  check('F3 规则层 streamAbortFrame 有正文返回 undefined', saf({ sawFinishReason: false, sentAnything: true, sawContent: true, sawToolCall: false }) === undefined)
  check('F3 规则层 streamAbortFrame 已收 finish_reason 返回 undefined', saf({ sawFinishReason: true, sentAnything: true, sawContent: false, sawToolCall: false }) === undefined)
  check('F3 规则层 streamAbortFrame 未发任何帧返回 undefined', saf({ sawFinishReason: false, sentAnything: false, sawContent: false, sawToolCall: false }) === undefined)
  check('F3 文案只在规则层 loomy.mjs', /aborted during thinking/.test(loomySrc))
  check('F3 框架 proxy.mjs 不再硬编码断流文案', !/aborted during thinking/.test(proxySrc))
  check('F3 框架 proxy.mjs 定义 streamAbortFrameOf 链助手', /function streamAbortFrameOf\(packs, meta\)/.test(proxySrc))
  check('F3 框架 proxy.mjs 结尾走 streamAbortFrameOf 钩子', /streamAbortFrameOf\(packs, meta\)/.test(proxySrc))
  check('F3 registry.mjs 接口文档声明 streamAbortFrame', /streamAbortFrame\(meta\)/.test(registrySrc))
  check('F3 registry.mjs DEFAULTS 有缺省钩子', /streamAbortFrame: \(\) => undefined/.test(registrySrc))

  // F4：网关把 ConnectionAbortedError 归为客户端断开；qwenpaw 收尾帧需求不回归
  check('F4 client-disconnect 分支含 ConnectionAbortedError', /except \(BrokenPipeError, ConnectionResetError, ConnectionAbortedError\)/.test(serverSrc2))
  check('F4 上游真断流仍发收尾帧 [DONE]', /data: \[DONE\]/.test(serverSrc2) && /upstream_error/.test(serverSrc2))

  // 集成：真实起 proxy，喂两种截断流，断言「错误帧 + 不伪造 stop」
  const { createProxy } = await import('../lib/proxy.mjs')
  const { RuleRegistry } = await import('../lib/registry.mjs')
  const NL = String.fromCharCode(10)
  const sse = (frames) => frames.map((f) => 'data: ' + f + NL + NL).join('')
  const think1 = JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: '嗯，用户让我' } }] })
  const think2 = JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: '先读文件 <acp_read_files>...' } }] })
  const errFrame = JSON.stringify(abortFrame)
  const scenarios = [
    { name: '带 error 帧的断流', frames: [think1, think2, errFrame, '[DONE]'] },
    { name: '纯思考 EOF（无 error 帧）', frames: [think1, think2] },
  ]
  const realFetch = globalThis.fetch
  for (const s of scenarios) {
    const registry = new RuleRegistry()
    registry.register(loomyRules)
    globalThis.fetch = async () => new Response(sse(s.frames), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    let proxy
    try {
      proxy = createProxy({ port: 0, autoLaunch: false, registry, routes: [{ id: 'loomy2api', upstream: 'http://127.0.0.1:17890/v1', apiKey: 'sk-loomy-local', rules: ['loomy2api'], timeoutMs: 3600000 }] })
      await proxy.ready
      const res = await realFetch(proxy.origin() + '/loomy2api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer sk-loomy-local', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'spark-x2.6', stream: true, messages: [{ role: 'user', content: 'x' }] }),
      })
      const out = await res.text()
      check('集成[' + s.name + '] 发 upstream_error 帧', out.includes('"type":"upstream_error"'), out.slice(0, 240))
      check('集成[' + s.name + '] 不伪造 finish_reason', !out.includes('finish_reason'), out.slice(0, 240))
      check('集成[' + s.name + '] 有 [DONE] 收尾', out.includes('[DONE]'))
    } catch (error) {
      check('集成[' + s.name + '] 无异常', false, String((error && error.stack) || error))
    } finally {
      globalThis.fetch = realFetch
      if (proxy) {
        try { await Promise.race([proxy.close(), new Promise((r) => setTimeout(r, 1500))]) } catch {}
      }
    }
  }
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
