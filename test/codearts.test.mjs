/**
 * codearts / 华为 ModelArts（码道）规则包的回归测试。
 *
 * 覆盖几件事：
 *  1. codearts 路由的 normalizeRoute 保留 `rules: ['codearts']`；
 *  2. **本次改动**：normalizeRequest **保留 `reasoning_effort`**（华为 ModelArts 直连，
 *     实测会校验并生效，是思考强度档位的唯一载体），仍剥离 `reasoning` / `thinking`；
 *  3. 规则 1：max_tokens 三种叫法取最大意图再钳到硬天花板 65536；
 *  4. 规则 2：developer -> system；
 *  5. 规则 3：纯文本模型（supportsImages=false）把图片换成占位，文本原样保留；
 *  6. 规则 4：并发上限文本（TM.00001041）可重试，普通 400 不可重试。
 *
 * 不连真实华为云。运行：node test/codearts.test.mjs
 */

import { normalizeRoute } from '../lib/proxy.mjs'
import { codeartsRules } from '../lib/rules/codearts.mjs'

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

// ------------------------------------------------- 1. 路由接线
{
  const route = normalizeRoute({
    id: 'codearts',
    upstream: 'http://127.0.0.1:8788/v1',
    signer: 'huawei',
    rules: ['codearts'],
    concurrency: 3,
  })
  equal('codearts route id', route.id, 'codearts')
  equal('codearts rules 指向 codearts', JSON.stringify(route.rules), JSON.stringify(['codearts']))
  equal('codearts signer 被保留', route.signer, 'huawei')
}

// ------------------------------------------------- 2. 思考强度字段
{
  const body = {
    model: 'GLM-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning_effort: 'high',
    reasoning: { effort: 'high' },
    thinking: { type: 'enabled' },
    max_tokens: 1000,
  }
  const { notes } = codeartsRules.normalizeRequest({ body, model: 'GLM-5.2', modelInfo: {} })
  check('codearts 剥离了 reasoning', !('reasoning' in body), notes.join(','))
  check('codearts 保留 reasoning_effort（华为思考强度档位）', body['reasoning_effort'] === 'high')
  check('codearts 剥离了 thinking', !('thinking' in body))
  check('codearts 不改模型字段', body.model === 'GLM-5.2')
  check('codearts 不改 messages 角色', body.messages[0].role === 'user')
}

// ------------------------------------------------- 3. 规则 1：max_tokens 钳制
{
  const body = { model: 'GLM-5.2', messages: [], max_tokens: 999999, max_completion_tokens: 10 }
  const { notes } = codeartsRules.normalizeRequest({ body, model: 'GLM-5.2', modelInfo: { maxTokens: 65536 } })
  equal('codearts max_tokens 钳到硬天花板', body['max_tokens'], 65536)
  check('codearts 删掉 max_completion_tokens', !('max_completion_tokens' in body))
  check('codearts 记录钳制 note', /max_tokens 999999 -> 65536/.test(notes.join(' ')), JSON.stringify(notes))
}

// ------------------------------------------------- 4. 规则 2：developer -> system
{
  const body = { model: 'GLM-5.2', messages: [{ role: 'developer', content: 'x' }] }
  const { notes } = codeartsRules.normalizeRequest({ body, model: 'GLM-5.2', modelInfo: { supportsImages: true } })
  equal('codearts developer 改写为 system', body.messages[0].role, 'system')
  check('codearts 记录 developer->system note', /developer->system/.test(notes.join(' ')), JSON.stringify(notes))
}

// ------------------------------------------------- 5. 规则 3：纯文本模型图片换占位
{
  const img = { type: 'image_url', image_url: { url: 'http://x/y.png' } }
  const body = {
    model: 'GLM-5.2',
    messages: [{ role: 'user', content: [{ type: 'text', text: '看看' }, img] }],
  }
  const { notes } = codeartsRules.normalizeRequest({ body, model: 'GLM-5.2', modelInfo: { supportsImages: false } })
  const parts = body.messages[0].content
  equal('codearts 图片换成占位', parts[1].type, 'text')
  check('codearts 占位文案是中文', parts[1].text.includes('图片已省略'), parts[1].text)
  equal('codearts 文本部分原样保留', parts[0].text, '看看')
  check('codearts 记录图片占位 note', /images->placeholder/.test(notes.join(' ')), JSON.stringify(notes))
}

// ------------------------------------------------- 6. 规则 4：重试判定
{
  check('codearts 502 可重试', codeartsRules.isRetryable({ status: 502, text: '' }) === true)
  check('codearts 503 可重试', codeartsRules.isRetryable({ status: 503, text: '' }) === true)
  check('codearts 并发 400 可重试', codeartsRules.isRetryable({ status: 400, text: 'TM.00001041 并发会话数已达上限' }) === true)
  check('codearts 普通 400 不可重试', codeartsRules.isRetryable({ status: 400, text: 'InferHub.001001044' }) === false)
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
