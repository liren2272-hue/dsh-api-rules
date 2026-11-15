/**
 * 正文死循环（`</invoke>` 无限刷屏）端到端回归测试（2026-11-15）。
 *
 * 现象：长上下文下 spark-x2.6 的正文退化成「工具调用闭合标记无限刷」——
 * 单条 assistant/message 实测 192,958 字符仍在逐 token 生成（失败会话
 * session-888378a0-9e9d-492b-bdae-f5cd53614b03 turn 21/22 step 3），用户只能手动打断。
 * 根因：①框架 pipeStream 的死循环守卫只在思考阶段（!sawContent）生效，正文阶段零保护；
 *      ②规则层 containsToolCallDraft 要求「同一套标记两类共现」，只刷 </invoke>/</parameter>
 *        的退化只命中一类，连「草稿当答案」续推兜底也不触发。
 * 修复：registry 新增 contentLimitFrame 缺省钩子；proxy 主循环 + 续推循环在
 *  sawContent && !sawToolCall && !sawFinishReason 时逐帧问；loomy 规则包按「尾部窗口
 *  闭合标记密集」或「尾部 24 字片段复述占满半窗」判定，命中即报 content_loop 错误帧 +
 *  [DONE] 并掐断上游读流。
 *
 * 本测试用**真 HTTP 假上游**（不是打桩 Response）：上游每 2ms 写一帧、永不结束，
 * 所以「客户端流能结束」本身就证明是插件主动掐断的，而不是上游自己停了。
 *   场景 A：正文无限刷 </invoke> → 应提前掐断、报 content_loop、[DONE] 收尾、不伪造 stop。
 *   场景 B：正常长正文（含 1 个 </invoke> 的讲解）+ 上游 stop → 不得误杀。
 *   场景 C：思考无限重复（烟雾）→ 思考守卫（被机械抽取过一次）仍以 length 终止。
 *
 * 运行：node test/content-loop.e2e.test.mjs
 */

import { createServer } from 'node:http'
import { createProxy } from '../lib/proxy.mjs'
import { RuleRegistry } from '../lib/registry.mjs'
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

const NL = String.fromCharCode(10)
const chunk = (delta, finish = null) =>
  'data: ' + JSON.stringify({ id: 'e2e', object: 'chat.completion.chunk', model: 'spark-x2.6', choices: [{ index: 0, delta, finish_reason: finish }] }) + NL + NL

// 长而不重复的正常中文正文（尾窗内 24 字 n-gram 各只出现一次），做误杀对照。
const variedProse = (n) => {
  const verbs = ['拆解', '检索', '比对', '归纳', '验证', '推翻', '重构', '收敛']
  const objs = ['问题边界', '隐含前提', '反例', '成本', '时序依赖', '接口契约', '边界条件', '解空间']
  let s = ''
  for (let i = 0; s.length < n; i++) {
    s += '【' + i + '】' + verbs[i % 8] + objs[(i * 3) % 8] + '，结合上文第' + (i - 1) + '条与第' + (i - 2) + '条，判断是否需要回溯。'
  }
  return s
}

/**
 * 假上游：mode='content-loop' 正文无限刷闭合标记；mode='normal' 正常长正文 + stop；
 * mode='thinking-loop' 思考无限重复。记 written（上游实际写出的帧数）与 clientGone
 * （是否观测到客户端断开）供断言——clientGone 为真即证明插件真的取消了上游读流。
 */
async function startStub(mode) {
  const state = { written: 0, clientGone: false, requests: 0 }
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (c) => { raw += c })
    request.on('end', () => {
      if ((request.url ?? '').endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'spark-x2.6' }] }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      state.requests += 1
      if (mode === 'continuation-loop') {
        if (state.requests === 1) {
          // 第一轮：正文主体正常，只有尾部 4 个闭合标记——小于正文守卫的阈值（6），
          // 但已达到 containsToolCallDraft 的第三路判据（4）→ 被判「把工具草稿当答案」
          // → 触发「答一步就停」续推。这一轮以 stop 收尾，所以全局 sawFinishReason
          // 在续推开始前就已经是 true（这正是续推守卫曾经恒不触发的成因）。
          response.write(chunk({ role: 'assistant', content: '' }))
          response.write(chunk({ content: variedProse(900) + NL + '</invoke>' + NL + '</parameter>' + NL + '</invoke>' + NL + '</parameter>' + NL }))
          state.written += 2
          response.write(chunk({}, 'stop'))
          response.end('data: [DONE]' + NL + NL)
          return
        }
        // 第二轮（续推）：退化成无限刷，永不结束。
        const contDelta = { content: '</invoke>' + NL + '</parameter>' + NL }
        const contTimer = setInterval(() => {
          if (state.clientGone || state.written >= 20000) return
          response.write(chunk(contDelta))
          state.written += 1
        }, 2)
        response.on('close', () => {
          state.clientGone = true
          clearInterval(contTimer)
        })
        return
      }
      if (mode === 'normal') {
        response.write(chunk({ role: 'assistant', content: '' }))
        response.write(chunk({ content: variedProse(1200) + '\n例如 </invoke> 这样的闭合标记。' }))
        state.written = 2
        response.write(chunk({}, 'stop'))
        response.end('data: [DONE]' + NL + NL)
        return
      }
      const delta = mode === 'thinking-loop'
        ? { reasoning_content: '让我再确认一遍刚才那个结论。' }
        : { content: '</invoke>' + NL + '</parameter>' + NL }
      const timer = setInterval(() => {
        if (state.clientGone || state.written >= 20000) return
        response.write(chunk(delta))
        state.written += 1
      }, 2)
      response.on('close', () => {
        state.clientGone = true
        clearInterval(timer)
      })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    mode,
    port: server.address().port,
    state,
    close: () => new Promise((r) => server.close(r)),
  }
}

/** 起 proxy、发一次流式请求、把响应拆成可断言的形状；整体 15s 超时守卫。 */
async function drive(upstream) {
  const registry = new RuleRegistry()
  registry.register(loomyRules)
  const proxy = createProxy({
    port: 0,
    autoLaunch: false,
    registry,
    routes: [{
      id: 'loomy2api',
      upstream: 'http://127.0.0.1:' + upstream.port + '/v1',
      apiKey: 'sk-loomy-local',
      rules: ['loomy2api'],
      timeoutMs: 3600000,
    }],
  })
  await proxy.ready
  let timedOut = false
  const result = { timedOut: false, content: '', errorFrame: null, finishReason: null, sawDone: false, frames: 0 }
  try {
    const chat = await fetch(proxy.origin() + '/loomy2api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-loomy-local', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'spark-x2.6', stream: true, messages: [{ role: 'user', content: '继续' }] }),
    })
    const text = await Promise.race([
      chat.text(),
      new Promise((resolve) => setTimeout(() => { timedOut = true; resolve('') }, 15000)),
    ])
    result.timedOut = timedOut
    if (text.includes('[DONE]')) result.sawDone = true
    const payloads = text.split(NL + NL).filter((f) => f.startsWith('data:')).map((f) => f.slice(5).trim()).filter((f) => f !== '' && f !== '[DONE]')
    for (const p of payloads) {
      let frame
      try { frame = JSON.parse(p) } catch { continue }
      result.frames += 1
      if (frame.error) { result.errorFrame = frame.error; continue }
      for (const c of frame.choices ?? []) {
        if (typeof c.delta?.content === 'string') result.content += c.delta.content
        if (c.finish_reason !== null && c.finish_reason !== undefined) result.finishReason = c.finish_reason
      }
    }
  } finally {
    try { await Promise.race([proxy.close(), new Promise((r) => setTimeout(r, 3000))]) } catch {}
  }
  return result
}

// ---------------------------------------------------- 场景 A：正文无限刷，必须提前掐断
{
  const upstream = await startStub('content-loop')
  try {
    const r = await drive(upstream)
    // 上游 'close' 事件比客户端流结束晚一两个 tick，稍等再断言（否则是测试自身的竞态）。
    await new Promise((resolve) => setTimeout(resolve, 300))
    check('A 客户端流未被 15s 超时守卫拦下（说明插件主动结束了流）', r.timedOut === false)
    check('A 收到 content_loop 错误帧', r.errorFrame?.type === 'content_loop', JSON.stringify(r.errorFrame))
    check('A 错误帧 code=504', r.errorFrame?.code === 504, JSON.stringify(r.errorFrame))
    check('A 以 [DONE] 收尾（客户端不会悬挂）', r.sawDone === true)
    check('A 不伪造 finish_reason（不把退化正文当正常完成）', r.finishReason === null, 'finishReason=' + r.finishReason)
    check('A 上游被提前掐断（写出的帧数远小于无限流）', upstream.state.written < 200, 'written=' + upstream.state.written)
    check('A 上游观测到客户端断开（读流确实被取消）', upstream.state.clientGone === true)
    check('A 客户端收到的正文远小于退化规模', r.content.length < 4000, 'contentChars=' + r.content.length)
  } catch (error) {
    check('A 无异常', false, String((error && error.stack) || error))
  } finally {
    await upstream.close()
  }
}

// ---------------------------------------------------- 场景 B：正常长正文不得误杀
{
  const upstream = await startStub('normal')
  try {
    const r = await drive(upstream)
    check('B 保留上游 finish_reason=stop', r.finishReason === 'stop', 'finishReason=' + r.finishReason)
    check('B 无错误帧', r.errorFrame === null, JSON.stringify(r.errorFrame))
    check('B 正文完整保留（含唯一的 </invoke> 讲解）', r.content.includes('例如 </invoke> 这样的闭合标记。'), 'contentChars=' + r.content.length)
  } catch (error) {
    check('B 无异常', false, String((error && error.stack) || error))
  } finally {
    await upstream.close()
  }
}

// ---------------------------------------------------- 场景 C：思考死循环仍被掐断（烟雾）
{
  const upstream = await startStub('thinking-loop')
  try {
    const r = await drive(upstream)
    check('C 思考死循环以 finish_reason=length 终止', r.finishReason === 'length', 'finishReason=' + r.finishReason)
    check('C 不报正文 content_loop（两套守卫互不串扰）', r.errorFrame === null, JSON.stringify(r.errorFrame))
    check('C 上游被提前掐断', upstream.state.written < 200, 'written=' + upstream.state.written)
  } catch (error) {
    check('C 无异常', false, String((error && error.stack) || error))
  } finally {
    await upstream.close()
  }
}

// --------------------------- 场景 D：续推轮退化也要掐断（全局 sawFinishReason 已是 true）
{
  const upstream = await startStub('continuation-loop')
  try {
    const r = await drive(upstream)
    await new Promise((resolve) => setTimeout(resolve, 300))
    check('D 确实走了续推路径（上游收到 ≥2 次请求）', upstream.state.requests >= 2, 'requests=' + upstream.state.requests)
    check('D 客户端流未被 15s 超时守卫拦下（续推轮也被主动掐断）', r.timedOut === false)
    check('D 收到 content_loop 错误帧', r.errorFrame?.type === 'content_loop', JSON.stringify(r.errorFrame))
    check('D 以 [DONE] 收尾', r.sawDone === true)
    check('D 续推退化流被提前掐断', upstream.state.written < 200, 'written=' + upstream.state.written)
    check('D 上游观测到客户端断开', upstream.state.clientGone === true)
    check('D 第一轮正文仍保留', r.content.includes('【0】'), 'contentChars=' + r.content.length)
    check('D 客户端收到的正文远小于退化规模', r.content.length < 4000, 'contentChars=' + r.content.length)
  } catch (error) {
    check('D 无异常', false, String((error && error.stack) || error))
  } finally {
    await upstream.close()
  }
}

console.log(NL + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
