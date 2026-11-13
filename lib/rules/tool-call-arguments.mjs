/**
 * tool_calls.arguments 非法 JSON 修复的**唯一**实现来源（rules 层的共享能力）。
 *
 * ## 根因（2026-11-12，spark-x2.6 / loomy2api）
 *
 * spark 偶发把结构化 tool_calls 的 function.arguments 写成「像 JS 对象字面量、
 * 但不是合法 JSON」的字符串。实测报错：
 *
 *   Tool call ops_glob: Unexpected token '*', ...pattern:*... is not valid JSON
 *   Received arguments: {"pattern":*,"path":"D:\Program Files\Deepseek Harness\resources","limit":20}
 *
 * 两类畸形同时出现：
 *   1. 值没加引号 —— "pattern":* 里的 * 是裸 token（glob 通配、标识符等）；
 *   2. Windows 路径里的单反斜杠没转义 —— "D:\Program..." 里的 \P / \D / \r
 *      都不是合法 JSON 转义（\r 还会被误当成回车）。
 *
 * 这是【响应侧 上游→DSH】畸形，与请求侧给裸 parameters 补 object 外壳的
 * flat-parameters.mjs 是两回事。vendored loomy2api 在 chat 流式路径上是纯透传
 * SSE（server.py 的 _chat_stream 直接 write 上游字节），不会改写 arguments；
 * 它的 anthropic.py 虽然对 /v1/messages 做了 json.loads(... ) except: args = {}，
 * 但 DSH 走的是 /v1/chat/completions，所以畸形原样抵达 DSH 工具层并报上面的错。
 *
 * ## 为什么放在 rules 层、用 normalizeDelta 拦
 *
 * proxy.mjs 的三段 SSE 循环（主流 / 空流重试 / 续推）都在写回帧之前逐帧调用
 * pack.normalizeDelta(choice.delta) —— 这是响应侧拦截的天然落点，无需改 proxy。
 * 本模块只提供纯函数，由 loomy 规则包在 normalizeDelta 里调用，做到：
 *   - 与 flat-parameters.mjs 一样「单点真相」，以后别的规则包要修同类问题直接 import；
 *   - 不动 vendored 网关源码，升级覆盖 vendor 不会冲掉修复；
 *   - 不加进 registry.mjs 的 DEFAULTS（那会让所有包都带上新钩子）。
 *
 * ## 保守性契约（很重要）
 *
 *   - 合法 JSON：原样返回，**字节不变**（不做重序列化，避免改数值/转义语义）；
 *   - 流式分片中间态（arguments 被拆成多个 delta，单片是残缺前缀/续串）：
 *     原样返回 —— 只有「以 { 开头、以 } 结尾」的完整对象才进入修复，分片几乎
 *     不会同时满足这两点；
 *   - 完整但畸形的对象：尽力修复，只有修复结果能被 JSON.parse 成对象才采用；
 *   - 修不了的：原样返回（绝不吞掉工具参数、绝不伪造 {}）。这类新畸形仍会在
 *     DSH 侧报错，可据真实样本再补规则，比静默把调用变成空参数更可诊断。
 *
 * 覆盖的畸形类别：裸值（* / glob / 标识符 / 未加引号的多词串）、无引号键、
 * 单引号字符串、尾逗号、字符串里未转义的单反斜杠、字符串里的裸换行/制表符。
 * 刻意不做：JS 注释、多行表达式、把残缺对象硬凑完整（这些交给上游修正）。
 *
 * @module dsh-api-rules/rules/tool-call-arguments
 */

// 合法的数字字面量（JSON 不允许前导 0）。裸 token 命中它就不加引号。
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const KEY_CHAR_RE = /[A-Za-z0-9_$\-.]/
const WS_RE = /\s/

/**
 * 把「看起来像 JS 对象字面量」的畸形 JSON 尽量改成合法 JSON。
 * 输入已知以 { 开头、以 } 结尾且 JSON.parse 失败。返回修复后的字符串；
 * 遇到无法安全处理的形状（如未闭合字符串）返回 null 表示放弃。
 *
 * 单次扫描，就地拼装：字符串内只修转义，字符串外只在「值位置」补引号、
 * 在「键位置」补引号、丢掉尾逗号。所有改动都是局部且可验证的（调用方会再
 * JSON.parse 一遍，解析不过就整体丢弃）。
 */
function sanitizeLooseObject(src) {
  let out = ''
  let i = 0
  const n = src.length
  const stack = []          // '{' / '[' 嵌套；用于判断 ',' 后是否期待「键」
  let expectValue = false   // 刚越过对象里的 ':'，期待值
  let expectKey = false     // 刚越过 '{' 或对象里的 ','，期待键
  const topIsObject = () => stack.length > 0 && stack[stack.length - 1] === '{'

  while (i < n) {
    const ch = src[i]

    // —— 字符串（双引号或单引号）——
    if (ch === '"' || ch === "'") {
      const q = ch
      let j = i + 1
      let body = ''
      let closed = false
      while (j < n) {
        const c = src[j]
        if (c === '\\') {
          const nx = src[j + 1]
          if (nx === undefined) { body += '\\\\'; j += 1; continue }
          if (nx === '\\' || nx === '"' || nx === '/') {
            // 已经是合法转义（\\ \" \/）：原样保留。
            body += '\\' + nx
            j += 2
            continue
          }
          if (nx === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 2, j + 6))) {
            // \uXXXX 原样保留，后面 4 个十六进制字符照抄。
            body += '\\u' + src.slice(j + 2, j + 6)
            j += 6
            continue
          }
          if (q === "'" && nx === "'") {
            // 单引号串里的 \' → 普通撇号。
            body += "'"
            j += 2
            continue
          }
          // 其余一律按「字面反斜杠」处理：补一个反斜杠把它转义成合法 JSON。
          // D:\Program(\P) / D:\Deepseek(\D) / D:\resources(\r，本会被当成回车)
          // 都能还原成字面路径。代价：畸形对象里本想表示换行的 \n 会变成
          // 字面 \n（反斜杠+n）—— 对「本就坏掉、正在抢救」的调用是可接受取舍。
          body += '\\\\' + nx
          j += 2
          continue
        }
        if (c === q) { closed = true; j += 1; break }
        if (c === '\n') { body += '\\n'; j += 1; continue }
        if (c === '\r') { body += '\\r'; j += 1; continue }
        if (c === '\t') { body += '\\t'; j += 1; continue }
        if (c === '"' && q === "'") { body += '\\"'; j += 1; continue }
        body += c
        j += 1
      }
      // 未闭合字符串：极可能是流式分片中间态，放弃修复而不是硬补一个引号。
      if (!closed) return null
      out += '"' + body + '"'
      i = j
      expectValue = false
      expectKey = false
      continue
    }

    // —— 结构字符 ——
    if (ch === '{' || ch === '[') {
      stack.push(ch)
      out += ch
      expectKey = (ch === '{')
      expectValue = false
      i += 1
      continue
    }
    if (ch === '}' || ch === ']') {
      stack.pop()
      out += ch
      expectKey = false
      expectValue = false
      i += 1
      continue
    }
    if (ch === ':') {
      out += ch
      expectValue = true
      expectKey = false
      i += 1
      continue
    }
    if (ch === ',') {
      // 前瞻跳过尾逗号（, 后面紧跟 } 或 ]）。
      let k = i + 1
      while (k < n && WS_RE.test(src[k])) k += 1
      if (k < n && (src[k] === '}' || src[k] === ']')) { i += 1; continue }
      out += ch
      expectKey = topIsObject()
      expectValue = false
      i += 1
      continue
    }
    if (WS_RE.test(ch)) { out += ch; i += 1; continue }

    // —— 裸 token：无引号键 / 无引号值 ——
    if (expectKey) {
      let j = i
      while (j < n && KEY_CHAR_RE.test(src[j])) j += 1
      const key = src.slice(i, j)
      let k = j
      while (k < n && WS_RE.test(src[k])) k += 1
      // 只有后面确实跟着 ':' 才当键补引号，否则原样抄（多半解析不过→放弃）。
      out += (key.length > 0 && k < n && src[k] === ':') ? JSON.stringify(key) : key
      expectKey = false
      i = j
      continue
    }
    if (expectValue) {
      // 读到下一个结构分隔符为止（允许值里有空格，如 command: cat foo.txt）。
      let j = i
      while (j < n && src[j] !== ',' && src[j] !== '}' && src[j] !== ']') j += 1
      const tok = src.slice(i, j).trim()
      if (tok === '') {
        out += ch
        i += 1
      } else if (tok === 'true' || tok === 'false' || tok === 'null' || NUMBER_RE.test(tok)) {
        out += tok            // 合法字面量：不加引号
        i = j
      } else {
        out += JSON.stringify(tok)   // 裸值：补引号（* / **\/x.ts / 标识符 / 多词串）
        i = j
      }
      expectValue = false
      continue
    }

    out += ch
    i += 1
  }
  return out
}

/**
 * 保守修复一条 tool_call 的 arguments 字符串。
 *
 * @param {string} raw 上游给的 function.arguments（可能合法、可能畸形、可能是流式分片）
 * @returns {string} 合法 JSON 或不可安全处理时返回原值（同一引用）
 */
export function repairToolCallArguments(raw) {
  if (typeof raw !== 'string') return raw
  const t = raw.trim()
  // 只处理「看起来是完整对象」的字符串：分片中间态（无尾 } / 续串无首 {）
  // 和非对象值一律原样放行，绝不改写。
  if (!t.startsWith('{') || !t.endsWith('}')) return raw
  try {
    JSON.parse(t)
    return raw               // 合法 JSON：原样返回，字节不变
  } catch { /* 落到修复 */ }

  const repaired = sanitizeLooseObject(t)
  if (repaired === null || repaired === t) return raw
  try {
    const v = JSON.parse(repaired)
    // 必须是对象：数组/null/其它解析结果不采用，避免把调用改得面目全非。
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return repaired
  } catch { /* 修不了 */ }
  return raw                 // 修不了：原样返回，不吞参数、不伪造 {}
}

/**
 * 就地修复一个 SSE delta 里所有 tool_calls 的 function.arguments。
 * 供规则包的 normalizeDelta 直接调用；不做任何帧结构假设之外的改动。
 *
 * @param {object} delta OpenAI chat.completion.chunk 的 choice.delta
 * @returns {object} 同一个 delta（就地修改后返回，便于链式调用）
 */
export function repairToolCallsInDelta(delta) {
  if (delta === null || typeof delta !== 'object') return delta
  const calls = delta['tool_calls']
  if (!Array.isArray(calls)) return delta
  for (const call of calls) {
    if (call === null || typeof call !== 'object') continue
    const fn = call['function']
    if (fn === null || typeof fn !== 'object') continue
    const args = fn['arguments']
    if (typeof args !== 'string') continue
    const fixed = repairToolCallArguments(args)
    if (fixed !== args) fn['arguments'] = fixed
  }
  return delta
}

/**
 * 每请求的 tool_calls 分片累积器（2026-11-13 新增，修流式分片根因）。
 *
 * ## 为什么需要它
 *
 * repairToolCallArguments 的守卫「只处理以 { 开头、以 } 结尾的完整对象」是对的——
 * 它保证合法 JSON / 非对象值字节不变。但 spark 走 SSE 流式时 function.arguments
 * 是**分片到达**的：每个 delta 只带一段碎片（实测 db2e53a5 turn5 step9）：
 *
 *   "args":["", "{\"pattern\":C", ":/Users/1", "5940/", ".dsh/mobile",
 *            "-access/[GLOB].css", "}"
 *
 * 单片碎片（如 {"pattern":C）既不以 { 开头也不以 } 结尾 → 命中守卫原样放行 →
 * repair 从未在完整对象上运行。normalizeDelta 逐帧调用对分片无效。
 *
 * 正确落点是**累积层**：把含 tool_calls 的 chunk 缓冲（不立即写回），等 finish_reason
 * 到达时对每条调用**拼接后的完整 args** 跑一次 repairToolCallArguments，再 flush。
 * 正文/思考帧仍即时透传；只有工具调用片段在 finish 前缓冲（工具调用本就在流末尾，
 * 延迟可忽略）。合法 args 拼接后仍合法 → repair 原样返回，字节不变。
 *
 * 用法（proxy 三段 SSE 循环）：
 *   const toolBuf = new ToolCallFragmentBuffer()
 *   // 收到含 tool_calls 的 chunk：toolBuf.push(chunk)（返回 true 表示已缓冲，跳过 write）
 *   // 收到 finish_reason：toolBuf.flush(write) 先刷工具调用，再 write finish 帧
 */
export class ToolCallFragmentBuffer {
  constructor() {
    /** @type {Array<{chunk:object, calls:Array<object>}>} */
    this.pending = []
  }

  /**
   * 若 chunk 里带 tool_calls，就地缓冲并返回 true（调用方跳过 write）；
   * 否则返回 false（调用方正常 write）。
   * @param {object} chunk OpenAI chat.completion.chunk
   * @returns {boolean}
   */
  push(chunk) {
    if (chunk === null || typeof chunk !== 'object') return false
    const choices = chunk['choices']
    if (!Array.isArray(choices) || choices.length === 0) return false
    // 只要有任一 choice.delta.tool_calls 就整帧缓冲，保证帧内 tool_calls 一起修。
    const callsPerChoice = []
    let hasCalls = false
    for (const choice of choices) {
      const d = choice?.['delta']
      const calls = d !== null && typeof d === 'object' ? d['tool_calls'] : undefined
      if (Array.isArray(calls) && calls.length > 0) { callsPerChoice.push(calls); hasCalls = true }
      else callsPerChoice.push(null)
    }
    if (!hasCalls) return false
    const calls = []
    for (const c of callsPerChoice) if (c !== null) for (const call of c) calls.push(call)
    this.pending.push({ chunk, calls })
    return true
  }

  /**
   * 分组口径：同一次「工具调用」由稳定键 (index, id) 标识——OpenAI 流式里 id 只在调用首帧
   * 出现一次、index 贯穿后续碎片帧。遇到新 id 或不同 index 就开新组；同 index 且 id 匹配（或
   * 双方都匿名无 id）则并入该 index 的当前开放组。��内按到达顺序拼接 args 碎片成完整串，对
   * 完整串修一次，然后：该组**最后一帧**写完整（修复后）args，组内中间帧 args 清空 ''，其余
   * 字段（index/id/role 等）保留。
   * @param {(obj:object)=>void} write
   */
  flush(write) {
    // groupKey -> { pieces:[], slots:[{ei,ci}] }
    const groups = new Map()
    // index -> 该 index 当前开放组的 id（字符串）或 null（匿名组）
    const openIdByIndex = new Map()
    let anonCounter = 0
    for (let ei = 0; ei < this.pending.length; ei++) {
      const entry = this.pending[ei]
      for (let ci = 0; ci < entry.calls.length; ci++) {
        const call = entry.calls[ci]
        if (call === null || typeof call !== 'object') continue
        const fn = call['function']
        const hasArgs = fn !== null && typeof fn === 'object' && typeof fn['arguments'] === 'string'
        const idx = typeof call['index'] === 'number' ? call['index'] : 0
        const id = call['id'] !== undefined && call['id'] !== null ? String(call['id']) : null
        // 开新组的条件：该 index 无开放组，或出现新 id（含从匿名组切到具名组）
        const needNew = !openIdByIndex.has(idx) || (id !== null && id !== openIdByIndex.get(idx))
        if (needNew) {
          const keyId = id !== null ? id : 'anon#' + (++anonCounter)
          openIdByIndex.set(idx, keyId)
        }
        const key = idx + '::' + openIdByIndex.get(idx)
        if (!groups.has(key)) groups.set(key, { pieces: [], slots: [] })
        const g = groups.get(key)
        g.pieces.push(hasArgs ? fn['arguments'] : '')
        g.slots.push({ ei, ci })
      }
    }
    // 对每组：拼接 → 修复；最后一帧写完整串，中间帧清空
    for (const g of groups.values()) {
      const full = g.pieces.join('')
      const fixed = repairToolCallArguments(full)
      g.slots.forEach((slot, i) => {
        const call = this.pending[slot.ei].calls[slot.ci]
        const fn = call['function']
        if (fn === null || typeof fn !== 'object') return
        fn['arguments'] = (i === g.slots.length - 1) ? fixed : ''
      })
    }
    for (const entry of this.pending) write(entry.chunk)
    this.pending = []
  }
}
