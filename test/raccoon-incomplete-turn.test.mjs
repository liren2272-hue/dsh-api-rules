/**
 * raccoon 规则包「早停续推」判定的单元测试（2026-11-27）。
 *
 * 覆盖边界：
 *  1. 最后一句是意图宣告、无工具调用、正常 stop → 续推；
 *  2. 中间出现「让我解释一下」但最后落到结论句 → 不续推（避免正常任务无法结束）；
 *  3. 有工具调用 / 断流无 finish_reason / 无正文 → 不续推；
 *  4. incompleteTurnMessages 不修改原数组，追加顺序正确。
 *
 * 运行：node test/raccoon-incomplete-turn.test.mjs
 */

import { raccoonRules } from '../lib/rules/raccoon.mjs'

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

const base = { sawFinishReason: true, sentAnything: true, sawContent: true, sawToolCall: false }

check('宣告「我读一下…」后 stop → 续推',
  raccoonRules.isIncompleteTurn('raccoon/sn-sensenova-6-8-flash', {
    ...base,
    contentText: '当前目录有两个文件：a.ts 和 b.ts。我读一下它们的内容来做总结。',
  }) === true)

check('宣告「让我检查一下」后 stop → 续推',
  raccoonRules.isIncompleteTurn('raccoon/sn-sensenova-6-8-flash', {
    ...base,
    contentText: '让我检查一下网关和宿主的状态',
  }) === true)

check('英文 I will … → 续推',
  raccoonRules.isIncompleteTurn('raccoon/sn-glm-5-3', {
    ...base,
    contentText: 'I will read the files first.',
  }) === true)

check('中间有意图词但结尾是结论 → 不续推',
  raccoonRules.isIncompleteTurn('raccoon/sn-sensenova-6-8-flash', {
    ...base,
    contentText: '让我解释一下这个机制。它其实只有三步。结论：不需要改动。',
  }) === false)

check('有工具调用 → 不续推',
  raccoonRules.isIncompleteTurn('raccoon/sn-sensenova-6-8-flash', {
    ...base,
    sawToolCall: true,
    contentText: '我读一下它们的内容来做总结。',
  }) === false)

check('断流无 finish_reason → 不续推',
  raccoonRules.isIncompleteTurn('raccoon/sn-sensenova-6-8-flash', {
    ...base,
    sawFinishReason: false,
    contentText: '我读一下它们的内容来做总结。',
  }) === false)

check('无正文 → 不续推',
  raccoonRules.isIncompleteTurn('raccoon/sn-sensenova-6-8-flash', {
    ...base,
    sawContent: false,
    contentText: '',
  }) === false)

check('meta 不是对象 → 不续推', raccoonRules.isIncompleteTurn('m', null) === false)

{
  const original = [{ role: 'user', content: 'hi' }]
  const next = raccoonRules.incompleteTurnMessages(original, '我读一下')
  check('incompleteTurnMessages 不修改原数组', original.length === 1, 'len=' + original.length)
  check('incompleteTurnMessages 追加 assistant + user',
    next.length === 3 && next[1].role === 'assistant' && next[1].content === '我读一下' && next[2].role === 'user',
    JSON.stringify(next))
  check('maxIncompleteTurnRetries = 1', raccoonRules.maxIncompleteTurnRetries() === 1)
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)