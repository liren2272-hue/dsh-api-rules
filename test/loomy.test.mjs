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

// ------------------------------------------------- 思考死循环检测（2026-11-08）
// spark-x2.6 推理不收敛：reasoning_content 无限生成直到把 max_tokens 预算耗尽
// （实测两次 955s / 输出恰好 131072，content 为空）。规则层 thinkingLimitFrame
// 两级判定：尾部 1000 字窗内同一 24 字 n-gram 出现 > 8 次；或思考帧数 > 6000 仍无正文。
{
  const tlf = (meta) => loomyRules.thinkingLimitFrame(meta)

  // 1) 尾部重复命中：尾部窗内同一 24 字片段反复出现（loopUnit 26 字，repeat 40）
  const loopUnit = '用户让我读一下这个文件的内容然后再决定下一步应该怎么做。' // 26 字
  const repeatedTail = '嗯，用户的问题是这样的，我需要仔细分析。'.padEnd(200, '。') + loopUnit.repeat(40)
  const rep = tlf({ reasoningText: repeatedTail, reasoningChunks: 50 })
  check('死循环[重复] 命中返回帧', rep !== undefined && rep.choices?.[0]?.finish_reason === 'length', JSON.stringify(rep)?.slice(0, 200))
  check('死循环[重复] 标记 reason=repetition', rep?._thinking_loop?.reason === 'repetition', JSON.stringify(rep?._thinking_loop))

  // 2) 停滞兜底：帧数超 6000、无重复文本
  const stagn = tlf({ reasoningText: '正常思考'.padEnd(100, '随机'), reasoningChunks: 6001 })
  check('死循环[停滞] 帧数>6000 命中', stagn !== undefined && stagn.choices?.[0]?.finish_reason === 'length', JSON.stringify(stagn)?.slice(0, 200))
  check('死循环[停滞] 标记 reason=stagnation', stagn?._thinking_loop?.reason === 'stagnation', JSON.stringify(stagn?._thinking_loop))

  // 3) 不误杀：短思考、无重复
  check('死循环[正常短思考] 不命中', tlf({ reasoningText: '嗯，用户让我先读文件。', reasoningChunks: 5 }) === undefined)
  // 4) 不误杀：长思考但真正不重复（每 24 字窗口含递增计数器与变化词，尾窗内 n-gram 各只出现 1 次）
  let varied = ''
  const verbs = ['拆解', '检索', '比对', '归纳', '验证', '推翻', '重构', '收敛']
  const objs = ['问题边界', '隐含前提', '反例', '成本', '时序依赖', '接口契约', '边界条件', '解空间']
  for (let i = 0; i < 200; i++) {
    varied += `【${i}】${verbs[i % 8]}${objs[(i * 3) % 8]}，结合上文第${i - 1}条与第${i - 2}条，判断是否需要回溯。`
  }
  check('死循环[长而不重复] 不命中', tlf({ reasoningText: varied, reasoningChunks: 3000 }) === undefined, '误杀合法长思考')
  // 5) meta 缺省不抛
  check('死循环[空 meta] 不命中且不抛', tlf({}) === undefined && tlf(undefined) === undefined)

  // E2E：真实起 proxy，喂一段「思考重复」流，断言中途被 finish_reason:length 终止。
  // 对照：正常短思考流完整跑完、由上游 finish_reason 收尾。
  const { createProxy } = await import('../lib/proxy.mjs')
  const { RuleRegistry } = await import('../lib/registry.mjs')
  const NL2 = String.fromCharCode(10)
  const sse2 = (frames) => frames.map((f) => 'data: ' + f + NL2 + NL2).join('')
  const realFetch2 = globalThis.fetch

  async function runStream(frames) {
    const registry = new RuleRegistry()
    registry.register(loomyRules)
    globalThis.fetch = async () => new Response(sse2(frames), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    let proxy
    try {
      proxy = createProxy({ port: 0, autoLaunch: false, registry, routes: [{ id: 'loomy2api', upstream: 'http://127.0.0.1:17890/v1', apiKey: 'sk-loomy-local', rules: ['loomy2api'], timeoutMs: 3600000 }] })
      await proxy.ready
      const res = await realFetch2(proxy.origin() + '/loomy2api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer sk-loomy-local', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'spark-x2.6', stream: true, messages: [{ role: 'user', content: 'x' }] }),
      })
      return await res.text()
    } finally {
      globalThis.fetch = realFetch2
      if (proxy) { try { await Promise.race([proxy.close(), new Promise((r) => setTimeout(r, 1500))]) } catch {} }
    }
  }

  try {
    // 死循环流：40 个重复思考 chunk（每个都带同一段 24+ 字重复），无 content/finish_reason
    const loopChunk = JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: loopUnit } }] })
    const loopOut = await runStream(Array(40).fill(loopChunk))
    check('E2E[死循环] 以 finish_reason:length 终止', loopOut.includes('"finish_reason":"length"'), loopOut.slice(0, 240))
    check('E2E[死循环] 有 [DONE] 收尾', loopOut.includes('[DONE]'))
    check('E2E[死循环] 不补合成 stop（不是伪装正常完成）', !loopOut.includes('"finish_reason":"stop"'), loopOut.slice(0, 240))

    // 正常流：短思考 + 正文 + 上游 stop，不应被误杀
    const normalOut = await runStream([
      JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: '嗯，用户让我先读文件。' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: '好的，这是结果。' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      '[DONE]',
    ])
    check('E2E[正常] 不误杀（保留上游 stop）', normalOut.includes('"finish_reason":"stop"'), normalOut.slice(0, 240))
    check('E2E[正常] 正文保留', normalOut.includes('好的，这是结果。'))
    check('E2E[正常] 无 length 截断', !normalOut.includes('"finish_reason":"length"'), normalOut.slice(0, 240))
  } catch (error) {
    check('E2E[死循环/正常] 无异常', false, String((error && error.stack) || error))
  }
}


// —————————————————————————————————————————————————————————————————————————————
// 正文混入伪工具调用标记（spark-x2.6 工具调用格式退化）——回归
// 现象：长上下文 + xhigh 档下偶发把结构化 tool_calls 写成正文里的 XML 草稿，
//       还带正常 finish_reason:'stop' 收尾，agent 不执行任何工具直接停住。
// 修复：loomy 规则包新增 isIncompleteTurn / incompleteTurnMessages /
//       maxIncompleteTurnRetries 三个可选钩子，复用 proxy.mjs 的续推链重发一次。
// —————————————————————————————————————————————————————————————————————————————
{
  const NL3 = String.fromCharCode(10)
  const sse3 = (frames) => frames.map((f) => 'data: ' + f + NL3 + NL3).join('')
  const realFetch3 = globalThis.fetch
  const delta = (obj) => JSON.stringify({ choices: [{ index: 0, delta: obj }] })
  const finish = (reason) => JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })

  async function runDraftStream(framesPerCall, clientBody) {
    const { createProxy } = await import('../lib/proxy.mjs')
    const { RuleRegistry } = await import('../lib/registry.mjs')
    const registry = new RuleRegistry()
    registry.register(loomyRules)
    const calls = []
    let callIndex = 0
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      const frames = framesPerCall[Math.min(callIndex, framesPerCall.length - 1)]
      callIndex += 1
      return new Response(sse3(frames), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    }
    let proxy
    try {
      proxy = createProxy({ port: 0, autoLaunch: false, registry, routes: [{ id: 'loomy2api', upstream: 'http://127.0.0.1:17890/v1', apiKey: 'sk-loomy-local', rules: ['loomy2api'], timeoutMs: 3600000 }] })
      await proxy.ready
      const res = await realFetch3(proxy.origin() + '/loomy2api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer sk-loomy-local', 'Content-Type': 'application/json' },
        body: JSON.stringify(clientBody),
      })
      return { out: await res.text(), calls }
    } finally {
      globalThis.fetch = realFetch3
      if (proxy) { try { await Promise.race([proxy.close(), new Promise((r) => setTimeout(r, 1500))]) } catch {} }
    }
  }

  const originalMessages = [{ role: 'user', content: '读一下 qoder.mjs' }]
  const clientBody = { model: 'spark-x2.6', stream: true, messages: originalMessages }

  const leakText =
    '<ops_bash<arg_key>command</arg_key><arg_value>cat qoder.mjs</arg_value>' +
    '<arg_key>description</arg_key><arg_value>Read full qoder rule pack</arg_value></tool_call>'
  const draftFrames = [
    delta({ content: leakText }),
    finish('stop'),
    '[DONE]',
  ]
  const cleanFrames = [
    delta({ content: '好的，这是 qoder.mjs 的内容。' }),
    finish('stop'),
    '[DONE]',
  ]
  const toolCallFrame = JSON.stringify({
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'ops_bash', arguments: '{"command":"cat qoder.mjs"}' } }] }, finish_reason: 'tool_calls' }],
  })
  const toolFrames = [toolCallFrame, '[DONE]']

  // —— 单元：三钩子存在且只在 loomy 定义（绝不进 DEFAULTS）——
  check('[伪工具草稿] loomy.isIncompleteTurn 是函数', typeof loomyRules.isIncompleteTurn === 'function')
  check('[伪工具草稿] loomy.incompleteTurnMessages 是函数', typeof loomyRules.incompleteTurnMessages === 'function')
  check('[伪工具草稿] loomy.maxIncompleteTurnRetries 是函数', typeof loomyRules.maxIncompleteTurnRetries === 'function')
  const { normalizePack } = await import('../lib/registry.mjs')
  const defaults = normalizePack({ name: '__probe_defaults__' })
  check('[伪工具草稿] 默认包不含 isIncompleteTurn（否则续推链 find 会错位）', !('isIncompleteTurn' in defaults))
  check('[伪工具草稿] 默认包不含 incompleteTurnMessages（否则破坏 qoder 续推）', !('incompleteTurnMessages' in defaults))
  equal('[伪工具草稿] 有界重试次数=1', loomyRules.maxIncompleteTurnRetries(), 1)

  // —— 单元：检测命中/不命中边界 ——
  const meta = (over) => ({ sawContent: true, sawToolCall: false, sawFinishReason: true, sentAnything: true, contentText: leakText, ...over })
  check('[伪工具草稿] 真实泄漏文本命中', loomyRules.isIncompleteTurn('spark-x2.6', meta()) === true)
  check('[伪工具草稿] 正常回答不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: '好的，结果如下。' })) === false)
  check('[伪工具草稿] 单个 <arg_key> 技术说明不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: '正文里提到 <arg_key> 字段是正常的。' })) === false)
  check('[伪工具草稿] 代码围栏里的示例不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: '示例：```\n' + leakText + '\n```\n以上是演示。' })) === false)
  check('[伪工具草稿] 有结构化 tool_calls 不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ sawToolCall: true })) === false)
  check('[伪工具草稿] 无 finish_reason（断流）不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ sawFinishReason: false })) === false)
  check('[伪工具草稿] 无正文不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ sawContent: false, contentText: '' })) === false)
  check('[伪工具草稿] meta 为空不命中', loomyRules.isIncompleteTurn('spark-x2.6', {}) === false)

  // —— 单元：纠正消息结构 ——
  const fixed = loomyRules.incompleteTurnMessages(originalMessages, leakText)
  equal('[伪工具草稿] 纠正消息长度', fixed.length, originalMessages.length + 2)
  equal('[伪工具草稿] 追加 assistant 回合', fixed[1].role, 'assistant')
  check('[伪工具草稿] assistant 回合原样保留草稿', fixed[1].content === leakText)
  equal('[伪工具草稿] 追加 user 纠正回合', fixed[2].role, 'user')
  check('[伪工具草稿] 纠正指令点名 tool_calls', fixed[2].content.includes('tool_calls'))
  check('[伪工具草稿] 原 messages 未被改', originalMessages.length === 1)

  // —— E2E：草稿流必须触发续推（第二次请求），纠正消息进请求体 ——
  try {
    const r = await runDraftStream([draftFrames, cleanFrames], clientBody)
    equal('E2E[伪工具草稿] 触发且仅触发 1 次续推（共 2 次请求）', r.calls.length, 2)
    const retry = r.calls[1]
    equal('E2E[伪工具草稿] 续推请求 messages 长度', retry.messages.length, originalMessages.length + 2)
    equal('E2E[伪工具草稿] 续推 assistant 回合', retry.messages[1].role, 'assistant')
    check('E2E[伪工具草稿] 续推 assistant 保留草稿正文', retry.messages[1].content === leakText)
    check('E2E[伪工具草稿] 续推 user 纠正指令进请求体', retry.messages[2].content.includes('tool_calls'))
    check('E2E[伪工具草稿] 最终输出含纠正后的正常正文', r.out.includes('好的，这是 qoder.mjs 的内容。'))
  } catch (error) {
    check('E2E[伪工具草稿] 无异常', false, String((error && error.stack) || error))
  }

  // —— E2E：正常回答流不触发续推（负向，避免误伤）——
  try {
    const r = await runDraftStream([cleanFrames, cleanFrames], clientBody)
    equal('E2E[伪工具草稿] 正常回答不续推（仅 1 次请求）', r.calls.length, 1)
    check('E2E[伪工具草稿] 正常回答正文保留', r.out.includes('好的，这是 qoder.mjs 的内容。'))
  } catch (error) {
    check('E2E[伪工具草稿] 正常回答无异常', false, String((error && error.stack) || error))
  }

  // —— E2E：已有结构化 tool_calls 的流不触发续推 ——
  try {
    const r = await runDraftStream([toolFrames, cleanFrames], clientBody)
    equal('E2E[伪工具草稿] 结构化 tool_calls 不续推（仅 1 次请求）', r.calls.length, 1)
  } catch (error) {
    check('E2E[伪工具草稿] tool_calls 流无异常', false, String((error && error.stack) || error))
  }
}


// —————————————————————————————————————————————————————————————————————————————
// DSML 草稿（spark-x2.6 另一种工具调用格式退化）——回归，2026-11-10 补
// 与上面的旧式 XML 草稿是同一故障类，只是标记换成全角竖线 <｜｜DSML｜｜ …>：
//   <｜｜DSML｜｜ calls> <｜｜DSML｜｜ invoke name="…"> <｜｜DSML｜｜ parameter …> </｜｜DSML｜｜ invoke> …
// 取证：session-e4c90717 的 assistant/message 正文 text 块（L397/L628/L905/L929/L954/L1004）。
// —————————————————————————————————————————————————————————————————————————————
{
  const NL3 = String.fromCharCode(10)
  const sse3 = (frames) => frames.map((f) => 'data: ' + f + NL3 + NL3).join('')
  const realFetch3 = globalThis.fetch
  const delta = (obj) => JSON.stringify({ choices: [{ index: 0, delta: obj }] })
  const finish = (reason) => JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })

  async function runDraftStream(framesPerCall, clientBody) {
    const { createProxy } = await import('../lib/proxy.mjs')
    const { RuleRegistry } = await import('../lib/registry.mjs')
    const registry = new RuleRegistry()
    registry.register(loomyRules)
    const calls = []
    let callIndex = 0
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      const frames = framesPerCall[Math.min(callIndex, framesPerCall.length - 1)]
      callIndex += 1
      return new Response(sse3(frames), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    }
    let proxy
    try {
      proxy = createProxy({ port: 0, autoLaunch: false, registry, routes: [{ id: 'loomy2api', upstream: 'http://127.0.0.1:17890/v1', apiKey: 'sk-loomy-local', rules: ['loomy2api'], timeoutMs: 3600000 }] })
      await proxy.ready
      const res = await realFetch3(proxy.origin() + '/loomy2api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer sk-loomy-local', 'Content-Type': 'application/json' },
        body: JSON.stringify(clientBody),
      })
      return { out: await res.text(), calls }
    } finally {
      globalThis.fetch = realFetch3
      if (proxy) { try { await Promise.race([proxy.close(), new Promise((r) => setTimeout(r, 1500))]) } catch {} }
    }
  }

  const originalMessages = [{ role: 'user', content: '读一下 qoder.mjs' }]
  const clientBody = { model: 'spark-x2.6', stream: true, messages: originalMessages }

  // 用户 2026-11-10 反馈的原样样本形态（含全角竖线 U+FF5C）
  const dsmlLeak =
    '<｜｜DSML｜｜ calls>' +
    '<｜｜DSML｜｜ invoke name="ops_read_files">' +
    '<｜｜DSML｜｜ parameter name="files" string="false">[{"path":"D:\\DSH Workspace\\x.md","offset":130,"limit":17}]</｜｜DSML｜｜ parameter>' +
    '</｜｜DSML｜｜ invoke>' +
    '</｜｜DSML｜｜ calls>'
  const oldXmlLeak = '<ops_bash<arg_key>command</arg_key><arg_value>cat qoder.mjs</arg_value></tool_call>'
  const meta = (over) => ({ sawContent: true, sawToolCall: false, sawFinishReason: true, sentAnything: true, contentText: dsmlLeak, ...over })

  const dsmlFrames = [ delta({ content: dsmlLeak }), finish("stop"), "[DONE]" ]
  const cleanFrames = [ delta({ content: "好的，这是文件内容。" }), finish("stop"), "[DONE]" ]
  const toolCallFrame = JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "ops_read_files", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })
  const toolFrames = [ toolCallFrame, "[DONE]" ]

  const ok = (n, c) => check("[DSML 草稿] " + n, c === true)
  const eq = (n, a, b) => equal("[DSML 草稿] " + n, a, b)

  // —— 单元：命中 / 不命中边界 ——
  ok('真实 DSML 样本命中', loomyRules.isIncompleteTurn('spark-x2.6', meta()) === true)
  ok('旧式 XML 草稿仍命中（不回归）', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: oldXmlLeak })) === true)
  ok('ASCII 竖线变体也命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: dsmlLeak.replace(/｜/g, '|') })) === true)
  ok('正常回答不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: '好的，结果如下。' })) === false)
  ok('单个 <｜｜DSML｜｜ parameter> 技术说明不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: '正文里提到 <｜｜DSML｜｜ parameter> 标记是正常的说明。' })) === false)
  ok('代码围栏里的 DSML 示例不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: '示例：```\n' + dsmlLeak + '\n```\n以上演示。' })) === false)
  ok('旧式1类 + DSML1类 混合不凑数（避免误伤）', loomyRules.isIncompleteTurn('spark-x2.6', meta({ contentText: '关于 <arg_key> 字段，以及 <｜｜DSML｜｜ invoke> 这种格式……' })) === false)
  ok('无 finish_reason 不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ sawFinishReason: false })) === false)
  ok('有结构化 tool_calls 不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ sawToolCall: true })) === false)
  ok('无正文不命中', loomyRules.isIncompleteTurn('spark-x2.6', meta({ sawContent: false, contentText: '' })) === false)

  // —— 单元：纠正消息同时点名两种格式 ——
  ok('纠正指令点名 DSML', loomyRules.incompleteTurnMessages(originalMessages, dsmlLeak)[2].content.includes('DSML'))
  ok('纠正指令仍点名 tool_calls', loomyRules.incompleteTurnMessages(originalMessages, dsmlLeak)[2].content.includes('tool_calls'))

  // —— E2E：DSML 草稿流触发且仅触发 1 次续推 ——
  try {
    const r = await runDraftStream([dsmlFrames, cleanFrames], clientBody)
    eq('DSML 草稿触发且仅 1 次续推（共 2 次请求）', r.calls.length, 2)
    eq('续推 messages 长度', r.calls[1].messages.length, originalMessages.length + 2)
    ok('续推 assistant 回合原样保留 DSML 草稿', r.calls[1].messages[1].content === dsmlLeak)
    ok('续推 user 纠正指令含 DSML', r.calls[1].messages[2].content.includes('DSML'))
    ok('最终输出为纠正后正常正文', r.out.includes('好的，这是文件内容。'))
  } catch (error) {
    ok('DSML E2E 无异常', false, String((error && error.stack) || error))
  }

  // —— E2E：正常回答 / 结构化 tool_calls 不续推（负向）——
  try {
    eq('正常回答不续推（仅 1 次请求）', (await runDraftStream([cleanFrames, cleanFrames], clientBody)).calls.length, 1)
    eq('结构化 tool_calls 不续推（仅 1 次请求）', (await runDraftStream([toolFrames, cleanFrames], clientBody)).calls.length, 1)
  } catch (error) {
    ok('负向 E2E 无异常', false, String((error && error.stack) || error))
  }
}

// —————————————————————————————————————————————————————————————————————————————
// 响应侧 tool_calls.arguments 非法 JSON 修复（2026-11-12 spark-x2.6）——回归
// 现象：spark 偶发把结构化工具调用的 function.arguments 写成「像 JS 对象字面量、
//       但不是合法 JSON」的字符串（{"pattern":*,"path":"D:\Program Files\..."}），
//       DSH 工具层 JSON.parse 失败并报 Unexpected token '*'。
// 修复：共享模块 tool-call-arguments.mjs（单点真相）由 loomy.normalizeDelta 逐帧调用。
// 保守契约逐条钉死：合法 JSON 字节不变、分片中间态/修不了原样放行、绝不伪造 {}。
// —————————————————————————————————————————————————————————————————————————————
{
  const { repairToolCallArguments, repairToolCallsInDelta } = await import('../lib/rules/tool-call-arguments.mjs')
  const BS = String.fromCharCode(92)
  // 用 <BS> 占位符拼真实样本：JS 字符串字面量里的单反斜杠会被提前吃掉（\P / \r），
  // 必须先占位、再替换，才能保证到达修复函数的是上游原样的单反斜杠。
  const decode = (s) => s.split('<BS>').join(BS)

  const ok = (n, c, d) => check('[arguments 修复] ' + n, !!c, d)
  const eq = (n, a, b) => equal('[arguments 修复] ' + n, a, b)
  const parseable = (s) => { try { return JSON.parse(s) } catch { return undefined } }
  const isObj = (v) => v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v)

  // 真实报错样本：两类畸形同时出现（裸 * 值 + Windows 路径单反斜杠未转义）
  const realMalformed = decode('{"pattern":*,"path":"D:<BS>Program Files<BS>Deepseek Harness<BS>resources","limit":20}')
  const wantPath = decode('D:<BS>Program Files<BS>Deepseek Harness<BS>resources')

  // —— 单元：核心修复 ——
  const fixedReal = repairToolCallArguments(realMalformed)
  const parsedReal = parseable(fixedReal)
  ok('真实样本修成合法 JSON 对象', isObj(parsedReal), fixedReal)
  ok('裸 * 值补成字符串 "*"', parsedReal && parsedReal.pattern === '*', fixedReal)
  ok('Windows 路径单反斜杠保留（不丢、不多）', parsedReal && parsedReal.path === wantPath, fixedReal)
  ok('数字参数保留为数字 20', parsedReal && parsedReal.limit === 20, fixedReal)

  // —— 单元：其它畸形类别 ——
  function repaired(name, raw, want) {
    const out = repairToolCallArguments(raw)
    const v = parseable(out)
    ok(name + ' → 合法 JSON', isObj(v), out)
    if (want !== undefined) eq(name + ' → 语义', JSON.stringify(v), JSON.stringify(want))
  }
  repaired('单引号字符串', decode("{pattern:'**/*.ts', path:'D:<BS>work'}"), { pattern: '**/*.ts', path: decode('D:<BS>work') })
  repaired('无引号键 + 尾逗号', '{pattern:"*",limit:20,}', { pattern: '*', limit: 20 })
  repaired('无引号键 + bool/null/数字', '{a:true,b:null,c:20,d:-1.5}', { a: true, b: null, c: 20, d: -1.5 })
  repaired('裸值 + 单引号混合', decode("{pattern:*,path:'D:<BS>work'}"), { pattern: '*', path: decode('D:<BS>work') })

  // —— 单元：保守契约（合法 / 分片 / 修不了，一律原样返回）——
  const unchanged = (name, raw) => eq(name + ' → 原样返回', repairToolCallArguments(raw), raw)
  const validJson = JSON.stringify({ pattern: '**/*', path: wantPath, limit: 20 })
  unchanged('合法 JSON 字节不变', validJson)
  unchanged('嵌套合法对象字节不变', '{"files":[{"path":"a.ts","offset":1}],"limit":20}')
  unchanged('分片前缀（无闭合括号）', decode('{"path":"D:<BS>Pro'))
  unchanged('分片续串（不以 { 开头）', 'gram Files","limit":20}')
  unchanged('空串', '')
  unchanged('已是 {}', '{}')
  unchanged('顶层数组', '[1,2,3]')
  unchanged('完全无法修复', 'not even an object')

  // —— 单元：repairToolCallsInDelta ——
  {
    const d = { tool_calls: [{ index: 0, function: { name: 'ops_glob', arguments: realMalformed } }] }
    const ret = repairToolCallsInDelta(d)
    ok('delta 级修复返回同一对象', ret === d)
    ok('delta 级 arguments 可解析', isObj(parseable(d.tool_calls[0].function.arguments)), d.tool_calls[0].function.arguments)
    ok('delta 级 path 保留', parseable(d.tool_calls[0].function.arguments).path === wantPath)
    const validDelta = { tool_calls: [{ index: 0, function: { name: 'ops_glob', arguments: validJson } }] }
    repairToolCallsInDelta(validDelta)
    eq('delta 级合法 JSON 不改', validDelta.tool_calls[0].function.arguments, validJson)
    const weird = { tool_calls: [{ index: 0, function: { name: 'x', arguments: { a: 1 } } }], content: 'hi' }
    ok('arguments 非字符串不误伤', (() => { try { repairToolCallsInDelta(weird); return weird.tool_calls[0].function.arguments.a === 1 } catch { return false } })())
    const noCalls = { content: 'hi' }
    ok('无 tool_calls 不误伤', (() => { try { repairToolCallsInDelta(noCalls); return noCalls.content === 'hi' } catch { return false } })())
  }

  // —— 单元：loomyRules.normalizeDelta 接线（两个兜底同时生效）——
  {
    const d = { content: null, tool_calls: [{ index: 0, function: { name: 'ops_glob', arguments: realMalformed } }] }
    loomyRules.normalizeDelta(d)
    eq('normalizeDelta null content → 空串（不回归）', d.content, '')
    ok('normalizeDelta 同时修好 arguments', isObj(parseable(d.tool_calls[0].function.arguments)), d.tool_calls[0].function.arguments)
    const vd = { tool_calls: [{ index: 0, function: { name: 'ops_glob', arguments: validJson } }] }
    loomyRules.normalizeDelta(vd)
    eq('normalizeDelta 合法 JSON 不改', vd.tool_calls[0].function.arguments, validJson)
  }

  // —— E2E：真实起 proxy，喂一段带畸形 arguments 的 tool_calls 流 ——
  const { createProxy } = await import('../lib/proxy.mjs')
  const { RuleRegistry } = await import('../lib/registry.mjs')
  const NL = String.fromCharCode(10)
  const sse = (frames) => frames.map((f) => 'data: ' + f + NL + NL).join('')
  const realFetchA = globalThis.fetch
  const toolCallFrame = (args) => JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'ops_glob', arguments: args } }] }, finish_reason: 'tool_calls' }] })
  function collectArgs(out) {
    const result = []
    for (const line of out.split(NL)) {
      const t = line.trim()
      if (!t.startsWith('data: ')) continue
      const payload = t.slice(6)
      if (payload === '[DONE]') continue
      let obj
      try { obj = JSON.parse(payload) } catch { continue }
      const c0 = obj && obj.choices && obj.choices[0]
      const calls = c0 && c0.delta && c0.delta.tool_calls
      if (Array.isArray(calls)) for (const c of calls) {
        if (c && c.function && typeof c.function.arguments === 'string') result.push(c.function.arguments)
      }
    }
    return result
  }
  async function runArgsStream(frames) {
    const registry = new RuleRegistry()
    registry.register(loomyRules)
    globalThis.fetch = async () => new Response(sse(frames), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    let proxy
    try {
      proxy = createProxy({ port: 0, autoLaunch: false, registry, routes: [{ id: 'loomy2api', upstream: 'http://127.0.0.1:17890/v1', apiKey: 'sk-loomy-local', rules: ['loomy2api'], timeoutMs: 3600000 }] })
      await proxy.ready
      const res = await realFetchA(proxy.origin() + '/loomy2api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk-loomy-local', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'spark-x2.6', stream: true, messages: [{ role: 'user', content: 'x' }] }),
      })
      return await res.text()
    } finally {
      globalThis.fetch = realFetchA
      if (proxy) { try { await Promise.race([proxy.close(), new Promise((r) => setTimeout(r, 1500))]) } catch {} }
    }
  }
  try {
    const malOut = await runArgsStream([toolCallFrame(realMalformed), '[DONE]'])
    const malArgs = collectArgs(malOut)
    ok('E2E 输出含 tool_calls arguments', malArgs.length >= 1, malOut.slice(0, 300))
    const outParsed = malArgs.length ? parseable(malArgs[0]) : undefined
    ok('E2E 写回帧 arguments 可 JSON.parse', isObj(outParsed), malArgs[0])
    ok('E2E pattern 修成 "*"', outParsed && outParsed.pattern === '*', malArgs[0])
    ok('E2E Windows 路径保留', outParsed && outParsed.path === wantPath, malArgs[0])

    const validOut = await runArgsStream([toolCallFrame(validJson), '[DONE]'])
    const validArgs = collectArgs(validOut)
    ok('E2E 合法 JSON 输出存在', validArgs.length >= 1, validOut.slice(0, 300))
    eq('E2E 合法 JSON 字节不变', validArgs[0], validJson)
  } catch (error) {
    ok('E2E[arguments 修复] 无异常', false, String((error && error.stack) || error))
  }
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
