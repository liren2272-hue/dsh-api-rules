// 回归：修复「删上游 -> rebuildProxy -> close() kill 网关 -> 不等退出 -> 重建时
// ensureUpstream 误判 already_running -> 网关永久消失」的竞态。
//
// 两层防护都要在：
//   1) launcher.dispose() 必须 async，且 kill 后 await waitForChildExit(...)。
//   2) proxy.close() 必须 await launchReady（收齐 dispose）再逐个 await dispose()。
//
// waitForChildExit 的可变退出时序在 Windows 上无法用真子进程稳定模拟
// （child.kill() 是强杀、几乎瞬时退出），所以用 EventEmitter 假 child 直接测
// helper 的等待/超时逻辑；再用静态断言守住 dispose/close 的接线，防止回退。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const launcherSrc = await readFile(join(ROOT, 'lib/launcher.mjs'), 'utf8')
const proxySrc = await readFile(join(ROOT, 'lib/proxy.mjs'), 'utf8')

/** 造一个"活的"假子进程：exitCode/signalCode 为 null，kill() 可配置何时触发 exit。 */
function fakeChild(exitAfterMs, { killedCalls } = {}) {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kills = 0
  child.kill = () => {
    child.kills++
    if (killedCalls) killedCalls.push(Date.now())
    if (exitAfterMs !== null) {
      setTimeout(() => {
        child.exitCode = 0
        child.emit('exit', 0)
      }, exitAfterMs)
    }
    return true
  }
  return child
}

test('静态接线：dispose 是 async 且 kill 后 await 等待；close 收齐并 await dispose', () => {
  // launcher：dispose 必须 async + 调用 waitForChildExit
  assert.match(launcherSrc, /const dispose = async \(\) => \{/, 'dispose 必须是 async')
  assert.match(launcherSrc, /child\.kill\(\)[\s\S]{0,120}await waitForChildExit\(/, 'kill 后必须 await waitForChildExit')
  // proxy：launchReady 收齐 + close 里 await launchReady + await dispose
  assert.match(proxySrc, /const launchReady = Promise\.all\(launchTasks\)/, '必须收集 launchTasks')
  assert.match(proxySrc, /await launchReady[\s\S]{0,120}await dispose\(\)/, 'close 必须先 await launchReady 再 await dispose')
})

test('waitForChildExit：进程在超时前退出 -> 快速 resolve，不再强杀', async () => {
  const { waitForChildExit } = await import('../lib/launcher.mjs')
  const killedCalls = []
  const child = fakeChild(40, { killedCalls })
  child.kill() // 模拟 dispose 先发 kill：40ms 后进程真正退出
  const killsBefore = killedCalls.length
  const t0 = Date.now()
  await waitForChildExit(child, () => child.exitCode !== null, 1000, undefined, 'test')
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 500, '应在远小于超时前返回，实际 ' + elapsed)
  assert.equal(killedCalls.length, killsBefore, 'helper 等待期间不应再调 kill')
})

test('waitForChildExit：进程已退出 -> 立即 resolve，不挂 timer', async () => {
  const { waitForChildExit } = await import('../lib/launcher.mjs')
  const child = fakeChild(null)
  child.exitCode = 0
  const t0 = Date.now()
  await waitForChildExit(child, () => child.exitCode !== null, 5000, undefined, 'test')
  assert.ok(Date.now() - t0 < 100, '已退出应立刻返回')
})

test('waitForChildExit：超时仍未退出 -> 强杀一次并在兜底窗口后返回（不无限挂）', async () => {
  const { waitForChildExit } = await import('../lib/launcher.mjs')
  let killAgain = 0
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = () => {
    killAgain++
    return true
  }
  const t0 = Date.now()
  await waitForChildExit(child, () => false, 120, undefined, 'test')
  const elapsed = Date.now() - t0
  assert.ok(elapsed >= 120, '至少等满超时窗口，实际 ' + elapsed)
  assert.ok(elapsed < 1200, '超时后应尽快返回，不能无限挂，实际 ' + elapsed)
  assert.ok(killAgain >= 1, '超时后必须强杀兜底')
})
