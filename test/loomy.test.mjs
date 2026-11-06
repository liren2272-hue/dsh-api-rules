/**
 * loomy / loomy2api 接入的回归测试。
 *
 * 覆盖几件事：
 *  1. loomy 路由的 normalizeRoute 正确规整 launch（command/args/cwd/env/readyUrl），
 *     且 env 里钉死的网关 key 能存活下来（这是「首次启动随机 key 只打印一次」的对策）；
 *  2. loomyRules 的请求整形：剥离 reasoning/reasoning_effort/thinking、把
 *     max_completion_tokens/max_output_tokens 归一到 max_tokens；
 *     并注入一方客户端元数据 request_purpose / msg_id / turn_id（UUID），让经本代理
 *     转发的裸 OpenAI 请求带上官方客户端头、躲开星火上游对「API 反代」的风控采样；
 *  3. null content chunk 归一成空串；finish_reason 兜底；
 *  4. 与 raccoon 同构：上游自己换号重试，本层只认 429/502/503/504（外加那句已知
 *     瞬时 400「请求有误」）、退避短、不叠重试预算；
 *  5. vendor 内嵌网关的 400 瞬时重试补丁还在（避免 vendor 重新同步把补丁冲掉）。
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

// ------------------------------------------------- 一方客户端元数据注入（反「API 反代」风控）
// vendored 网关 server.py:1662-1670 会把 body 里的这些字段 pop 出来转成官方请求头：
//   request_purpose -> X-Loomy-Request-Purpose，msg_id -> MsgId，turn_id -> TurnId。
// 不注入 chat_id：它会被 session_key()（server.py:1621，早于 pop）抢先消费、把粘性键
// 从 d-<...> 改成 c-<...>，每轮换 UUID 就会在多账号池下每轮换号，破坏会话粘性。
{
  const body = { model: 'spark-x2.6', messages: [{ role: 'user', content: 'hi' }] }
  loomyRules.normalizeRequest({ body })
  equal('loomy 注入 request_purpose = chat.message', body['request_purpose'], 'chat.message')
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  check('loomy 注入 msg_id 为 UUID', typeof body['msg_id'] === 'string' && uuidRe.test(body['msg_id']), String(body['msg_id']))
  check('loomy 注入 turn_id 为 UUID', typeof body['turn_id'] === 'string' && uuidRe.test(body['turn_id']), String(body['turn_id']))
  check('loomy 不注入 chat_id（避免破坏 session_key 粘性）', !('chat_id' in body))
  // 每次调用生成新 id；proxy 只 stringify 一次，多次尝试复用同一组（幂等正确）。
  const body2 = { model: 'spark-x2.6', messages: [] }
  loomyRules.normalizeRequest({ body: body2 })
  check('loomy 每次请求生成不同的 msg_id', body2['msg_id'] !== body['msg_id'])
  check('loomy 每次请求生成不同的 turn_id', body2['turn_id'] !== body['turn_id'])
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
  // 星火上游对「API 反代」的间歇性风控：网关内部 1s×3 原地重试全撞同一窗口、
  // 用尽后把这句已知瞬时 400 透传出来，本层用 2s/4s 退避摊出窗口再试。
  // lastText 是 proxy 从 17890 网关读到的原始 400 body（网关用尽后透传），不带
  // 「upstream 400:」前缀——那个前缀是 proxy 抛给客户端时 upstreamError 才拼的。
  const transient400 = '{"error":{"message":"请求有误，请重试；若多次出现请更新应用版本","type":"invalid_request_error","param":null,"code":400,"metadata":{"provider_name":"iflytek-spark-loomy"}}}'
  check('loomy 已知瞬时 400 可重试（网关原始 body）', loomyRules.isRetryable({ status: 400, text: transient400 }) === true)
  // 只认这句文案：真正坏掉的 400 不能白烧重试（400 没带文案也不重试）。
  check('loomy 其它 400 不重试', loomyRules.isRetryable({ status: 400, text: 'messages 不能为空' }) === false)
  check('loomy 无文案 400 不重试', loomyRules.isRetryable({ status: 400 }) === false)
  check('loomy 非 400 状态带该文案也不重试', loomyRules.isRetryable({ status: 422, text: transient400 }) === false)
  // 退避短一档：账号冷却以百秒计，本层只是磨掉瞬时抖动。
  check('loomy 退避上限 15s', loomyRules.backoffMs({ attempt: 10 }) <= 15_000)
  check('loomy 重试预算 20s', loomyRules.retryBudgetMs({}) === 20_000)
  check('loomy 全局冷却 0（不叠冷却）', loomyRules.cooldownMs() === 0)
}

// ------------------------------------------------- vendor 内嵌 loomy2api：上游 400 瞬时重试
// 星火 spark-x2.6 等模型会间歇性回 400「请求有误，请重试；若多次出现请更新应用版本」。
// 内嵌网关 vendor/loomy2api 原先把 400 当 FATAL 直接判死，单账号池下瞬间变 502。
// 这里只读校验 vendor 补丁还在（避免将来 vendor 重新同步把补丁冲掉却没人发现）。
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
    // rules 层注入的 request_purpose / msg_id / turn_id 依赖 server.py 的现成扩展点
    // （pop 成 X-Loomy-Request-Purpose/MsgId/TurnId 头）。vendor 重新同步若删掉它，
    // 注入字段会变成未知 body 字段原样转发 → 反代指纹依旧。这里守住这个依赖。
    check('vendor 扩展点仍会 pop request_purpose', /purpose\s*=\s*req\.pop\("request_purpose",\s*None\)/.test(serverSrc))
    check('vendor 扩展点仍转 X-Loomy-Request-Purpose 头', /extra\["X-Loomy-Request-Purpose"\]\s*=\s*purpose/.test(serverSrc))
    check('vendor 扩展点仍 pop msg_id -> MsgId', /\("msg_id",\s*"MsgId"\)/.test(serverSrc))
    check('vendor 扩展点仍 pop turn_id -> TurnId', /\("turn_id",\s*"TurnId"\)/.test(serverSrc))
  }
  if (configSrc) {
    check('vendor 配置有 transient_400_retries 默认值', /"transient_400_retries":\s*\d+/.test(configSrc))
    check('vendor 配置有 transient_400_backoff_seconds 默认值', /"transient_400_backoff_seconds":\s*[\d.]+/.test(configSrc))
  }
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
