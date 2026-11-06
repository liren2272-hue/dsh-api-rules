/**
 * loomy / loomy2api 接入的回归测试。
 *
 * 覆盖几件事：
 *  1. loomy 路由的 normalizeRoute 正确规整 launch（command/args/cwd/env/readyUrl），
 *     且 env 里钉死的网关 key 能存活下来（这是「首次启动随机 key 只打印一次」的对策）；
 *  2. loomyRules 的请求整形：剥离 reasoning/reasoning_effort/thinking、把
 *     max_completion_tokens/max_output_tokens 归一到 max_tokens；
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
  check('loomy 剥离了 reasoning_effort', !('reasoning_effort' in body))
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

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
