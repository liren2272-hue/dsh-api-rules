/**
 * 并发闸门自测（离线，纯内存，不连任何上游）。
 *
 * 覆盖两种释放语义：
 *   1. TTL 模式（holdMs > 0，码道）：占位后要等 holdMs 才回来，release() 是空操作
 *   2. 手工模式（holdMs === 0，同济 agi）：release() 立刻归还，不归还就排队
 *
 * 运行：node --test test/gate.test.mjs 或直接 node test/gate.test.mjs
 */

import { SessionGate } from '../lib/gate.mjs'

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

// ------------------------------------------------------------ 1. TTL 模式
section('TTL 模式（码道：占满 60s 才释放）')

{
  let clock = 0
  const gate = new SessionGate({ limit: 2, holdMs: 60_000, now: () => clock })

  const a = await gate.acquire(['k'], undefined)
  const b = await gate.acquire(['k'], undefined)
  equal('前两个拿到槽位', a.key === 'k' && b.key === 'k', true)
  equal('用满两个槽', gate.snapshot(['k'])[0].used, 2)

  // 第三个不该立刻拿到：给一个立刻 abort 的信号，验证它确实在排队而不是直接放行。
  const aborter = new AbortController()
  setTimeout(() => aborter.abort(), 30)
  const c = await gate.acquire(['k'], aborter.signal)
  equal('第三个排队后被中止', c.key, undefined)

  // TTL 模式下调 release() 不该让槽位提前回来。
  a.release()
  b.release()
  equal('TTL 模式下 release 是空操作', gate.snapshot(['k'])[0].used, 2)

  // 时间推进 60s 后槽位自然过期。
  clock += 60_001
  equal('60s 后槽位过期', gate.snapshot(['k'])[0].used, 0)
}

// ------------------------------------------------------------ 2. 手工模式
section('手工释放模式（同济 agi：请求结束就归还）')

{
  let clock = 0
  const gate = new SessionGate({ limit: 3, holdMs: 0, now: () => clock })

  const s1 = await gate.acquire(['tj'], undefined)
  const s2 = await gate.acquire(['tj'], undefined)
  const s3 = await gate.acquire(['tj'], undefined)
  equal('三个并发都能进', [s1.key, s2.key, s3.key].every((k) => k === 'tj'), true)
  equal('三个槽都占着', gate.snapshot(['tj'])[0].used, 3)

  // 第四个必须排队（不推进时钟，验证它不是靠 TTL 放行的）。
  const aborter = new AbortController()
  setTimeout(() => aborter.abort(), 40)
  const s4 = await gate.acquire(['tj'], aborter.signal)
  equal('第四个排队后被中止', s4.key, undefined)

  // 归还一个，第四个立刻能进——不需要等任何时间。
  s2.release()
  equal('归还后立刻少一个占位', gate.snapshot(['tj'])[0].used, 2)
  const s5 = await gate.acquire(['tj'], undefined)
  equal('归还后新请求立刻拿到槽位', s5.key, 'tj')

  // 重复 release 不能把计数弄成负数。
  s5.release()
  s5.release()
  s5.release()
  equal('重复 release 不会变负', gate.snapshot(['tj'])[0].used, 2)

  // 全部归还后归零。
  s1.release()
  s3.release()
  equal('全部归还后计数归零', gate.snapshot(['tj'])[0].used, 0)
}

// ------------------------------------------------------------ 3. 边界
section('边界与兼容')

{
  const gate = new SessionGate({ limit: 1, holdMs: 0 })
  const s = await gate.acquire(['x'], undefined)
  check('acquire 返回 release 函数', typeof s.release === 'function')
  s.release()

  // 空候选：立刻返回 undefined，不能挂死。
  const none = await gate.acquire([], undefined)
  equal('空候选返回 undefined', none.key, undefined)

  // 已经 abort 的信号：立刻返回，不进循环。
  const aborted = new AbortController()
  aborted.abort()
  const pre = await gate.acquire(['x'], aborted.signal)
  equal('预中止信号立刻返回', pre.key, undefined)

  // 默认 holdMs 仍是 60s（不能因为加了手工模式就把默认改掉）。
  const legacy = new SessionGate()
  equal('默认 holdMs 是 60000', legacy.holdMs, 60_000)
  equal('默认 limit 是 3', legacy.limit, 3)
}

{
  // 多 key 候选：一个满了应该换另一个。
  const gate = new SessionGate({ limit: 1, holdMs: 0 })
  const a = await gate.acquire(['a', 'b'], undefined)
  equal('第一个候选被选中', a.key, 'a')
  const b = await gate.acquire(['a', 'b'], undefined)
  equal('a 满了选 b', b.key, 'b')
  a.release()
  b.release()
  equal('两个都归还', gate.snapshot(['a', 'b']).every((row) => row.used === 0), true)
}

// ------------------------------------------------------------ 汇总
console.log('\n' + '='.repeat(50))
console.log('通过 ' + passes + ' 项，失败 ' + failures + ' 项')
if (failures > 0) {
  console.log('结果：FAILED')
  process.exitCode = 1
} else {
  console.log('结果：PASSED')
}
