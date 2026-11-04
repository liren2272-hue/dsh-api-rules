/**
 * loomy / loomy2api 接入的回归测试。
 *
 * 覆盖三件事：
 *  1. loomy 路由的 normalizeRoute 正确规整 launch（command/args/cwd/env/readyUrl），
 *     且 env 里钉死的网关 key 能存活下来（这是「首次启动随机 key 只打印一次」的对策）；
 *  2. loomyRules 的请求整形：剥离 reasoning/reasoning_effort/thinking、把
 *     max_completion_tokens/max_output_tokens 归一到 max_tokens，且不做任何语义改写；
 *     null content chunk 归一成空串；finish_reason 兜底；
 *  3. 与 raccoon 同构：上游自己换号重试，本层只认 429/502/503/504、退避短、不叠重试预算。
 *
 * 不连真实 loomy2api。运行：node test/loomy.test.mjs
 */

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
  // 退避短一档：账号冷却以百秒计，本层只是磨掉瞬时抖动。
  check('loomy 退避上限 15s', loomyRules.backoffMs({ attempt: 10 }) <= 15_000)
  check('loomy 重试预算 20s', loomyRules.retryBudgetMs({}) === 20_000)
  check('loomy 全局冷却 0（不叠冷却）', loomyRules.cooldownMs() === 0)
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
