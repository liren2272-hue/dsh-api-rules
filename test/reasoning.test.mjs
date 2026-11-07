/**
 * 思考强度档位翻译层（lib/rules/reasoning.mjs）的测试。
 *
 * 覆盖四件事：
 *   1. 各 provider 的档位词表都在 pi-ai 认识的档位内；
 *   2. translateEffort：非 raccoon 恒等，raccoon 做 off/none/minimal→low 与 GLM/Kimi medium→high；
 *   3. applyReasoningEffort：写回、note、无档位、reasoning 对象形式搬平；
 *   4. 规则包集成：每个 pack 确实走这一层（raccoon 的 GLM medium → high）。
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  THINKING_LEVELS,
  PROVIDER_EFFORTS,
  translateEffort,
  applyReasoningEffort,
} from '../lib/rules/reasoning.mjs'
import { raccoonRules } from '../lib/rules/raccoon.mjs'
import { officeaceRules } from '../lib/rules/officeace.mjs'
import { codeartsRules } from '../lib/rules/codearts.mjs'
import { loomyRules } from '../lib/rules/loomy.mjs'
import { clineRules } from '../lib/rules/cline.mjs'

const here = dirname(fileURLToPath(import.meta.url))

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

// ---- 1. 词表 ----
equal('THINKING_LEVELS 是 7 档', THINKING_LEVELS.length, 7)
check('THINKING_LEVELS 含 off', THINKING_LEVELS.includes('off'))
for (const [provider, vocab] of Object.entries(PROVIDER_EFFORTS)) {
  check(provider + ' 词表非空', vocab.length > 0)
  check(provider + ' 词表都在 THINKING_LEVELS 内', vocab.every((v) => THINKING_LEVELS.includes(v)), JSON.stringify(vocab))
}

// ---- 2. translateEffort ----
for (const provider of Object.keys(PROVIDER_EFFORTS)) {
  for (const level of PROVIDER_EFFORTS[provider]) {
    equal('translateEffort(' + provider + ',' + level + ') 恒等', translateEffort(provider, level, 'x'), level)
  }
}
equal('raccoon off → low', translateEffort('raccoon', 'off', 'raccoon/sn-glm-5-3'), 'low')
equal('raccoon none → low', translateEffort('raccoon', 'none', 'raccoon/sn-glm-5-3'), 'low')
equal('raccoon minimal → low', translateEffort('raccoon', 'minimal', 'raccoon/sn-glm-5-3'), 'low')
equal('raccoon disabled → low', translateEffort('raccoon', 'disabled', 'raccoon/sn-glm-5-3'), 'low')
equal('raccoon low → low', translateEffort('raccoon', 'low', 'raccoon/sn-glm-5-3'), 'low')
equal('raccoon high → high', translateEffort('raccoon', 'high', 'raccoon/sn-glm-5-3'), 'high')
equal('raccoon GLM medium → high', translateEffort('raccoon', 'medium', 'raccoon/sn-glm-5-3'), 'high')
equal('raccoon Kimi medium → high', translateEffort('raccoon', 'medium', 'raccoon/sn-kimi-k3'), 'high')
equal('raccoon 非 GLM/Kimi medium → medium', translateEffort('raccoon', 'medium', 'raccoon/raccoon-090dd3'), 'medium')
equal('raccoon 未知值原样', translateEffort('raccoon', 'xhigh', 'raccoon/sn-glm-5-3'), 'xhigh')

// ---- 3. applyReasoningEffort ----
{
  const body = {}
  equal('无档位时返回 null', applyReasoningEffort('officeace', 'm', body, []), null)
  equal('无档位时 body 不变', JSON.stringify(body), '{}')
}
{
  const body = { reasoning_effort: 'high' }
  const notes = []
  equal('officeace high 原样返回', applyReasoningEffort('officeace', 'm', body, notes), 'high')
  equal('officeace 无变化不记 note', notes.length, 0)
}
{
  const body = { reasoning_effort: 'medium' }
  const notes = []
  equal('raccoon GLM medium → high', applyReasoningEffort('raccoon', 'raccoon/sn-glm-5-3', body, notes), 'high')
  equal('raccoon 写回 high', body['reasoning_effort'], 'high')
  equal('raccoon 记 note', notes[0], 'reasoning_effort medium -> high')
}
{
  // 对象形式必须提前搬成扁平字段，否则随后被删 reasoning 时一起丢掉。
  const body = { reasoning: { effort: 'high' } }
  const notes = []
  equal('reasoning 对象形式也能读到', applyReasoningEffort('officeace', 'm', body, notes), 'high')
  equal('reasoning 对象形式搬成扁平字段', body['reasoning_effort'], 'high')
  equal('reasoning 对象形式无变化不记 note', notes.length, 0)
}

// ---- 4. 规则包集成 ----
{
  const body = { messages: [], reasoning_effort: 'medium' }
  const out = raccoonRules.normalizeRequest({ body, model: 'raccoon/sn-glm-5-3' })
  equal('raccoon 包 GLM medium → high', out.body['reasoning_effort'], 'high')
  check('raccoon 包记了翻译 note', out.notes.some((n) => n.includes('reasoning_effort medium -> high')), JSON.stringify(out.notes))
}
{
  const body = { messages: [], reasoning_effort: 'medium' }
  const out = raccoonRules.normalizeRequest({ body, model: 'raccoon/raccoon-090dd3' })
  equal('raccoon 包非 GLM/Kimi medium 保留', out.body['reasoning_effort'], 'medium')
}
{
  const body = { messages: [], reasoning_effort: 'high' }
  const out = officeaceRules.normalizeRequest({ body, model: 'officeace/deepseek-v4.1-flash' })
  equal('officeace 包保留 reasoning_effort', out.body['reasoning_effort'], 'high')
}
{
  const body = { messages: [], reasoning: { effort: 'high' } }
  const out = officeaceRules.normalizeRequest({ body, model: 'officeace/deepseek-v4.1-flash' })
  equal('officeace 包把 reasoning.effort 搬平', out.body['reasoning_effort'], 'high')
  check('officeace 包删掉了 reasoning', !('reasoning' in out.body))
}
{
  const body = { messages: [], reasoning_effort: 'xhigh' }
  const out = codeartsRules.normalizeRequest({ body, model: 'codearts/GLM-5.2' })
  equal('codearts 包保留 reasoning_effort', out.body['reasoning_effort'], 'xhigh')
}
{
  const body = { messages: [], reasoning_effort: 'xhigh' }
  const out = loomyRules.normalizeRequest({ body, model: 'loomy2api/spark-x2.6' })
  equal('loomy 包保留 reasoning_effort', out.body['reasoning_effort'], 'xhigh')
}
{
  const body = { messages: [], reasoning_effort: 'max' }
  const out = clineRules.normalizeRequest({ body, model: 'cline/cline-free/solar-mini4' })
  equal('cline 包保留 reasoning_effort', out.body['reasoning_effort'], 'max')
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
