/**
 * loomy2api（https://github.com/xingluoyuankong/loomy2api）规则包。
 *
 * loomy2api 是讯飞星火 Loomy 平台的 OpenAI/Anthropic 兼容网关：它维护一个多账号池，
 * 对外暴露 `/v1/chat/completions`、`/v1/messages`、`/v1/models`，模型 id 原样透传
 * （剥掉 `provider/` 前缀）。源码内嵌在本插件的 `vendor/loomy2api/`，由路由上的
 * `launch` 在插件启动时自动拉起（见 cordis.patch.yml 的 loomy 路由）。
 *
 * 也就是说，「供应商怪癖」已经在 loomy2api 那一侧消化掉了：
 *   - 换号 / 账号冷却 / 上游 429、401、402、403、5xx 的重试都在它内部
 *     （`max_retries`、`cooldown_seconds`），本层**不要**再叠一层长时间退避——
 *     否则「换个账号重试」这条路径会被自己的退避拖死（与 raccoon 同构）；
 *   - 非流式长任务它会在内部转成流式再聚合成完整响应；
 *   - 会话粘性（sticky）由它按客户端提示派生，本层不干预。
 *
 * ## 本层真正要修的（2026-11-06，决定性复现）
 *
 * 选 spark-x2.6 时：不带 tools 的小请求（标题生成等 warm-up）能正常出字，但每个
 * 带完整 DSH 工具数组的会话主轮次都确定性 400：
 *   {"error":{"message":"请求有误，请重试；若多次出现请更新应用版本",
 *    "type":"invalid_request_error","code":400,
 *    "metadata":{"provider_name":"iflytek-spark-loomy"}}}
 * 此前误判为「上游对 API 反代的间歇性风控」或「应用版本过旧」——都不是。逐跳二分
 * 定位到真实变量：DSH 随主轮次带上的 `tools` 里，部分工具的 `parameters` 不是合法
 * JSON Schema 外壳，而是「裸属性表」（参数名直接铺在根上），且其中恰有一个参数就叫
 * `type`（例如 cnki_search 的 all/journal/thesis）。iflytek-spark-loomy 把根级 `type`
 * 当成 schema 关键字去解析 → 判定参数非法 → 整条请求 400。标题 warm-up 不带 tools
 * 所以成功；主轮次带全量 tools 所以每轮必 400。这同时解释了「按时间成簇」的假象
 * （其实只是「哪几分钟选中了 spark-x2.6 跑主轮次」）。
 *
 * 决定性消融（8788 规则链 → 17890 网关 → 上游，见会话内 probe_flat_tools.py）：
 *   - 2 / 99 个合规 object 外壳 tools         → 200
 *   - +1 个裸根（含 `type` 键）               → 400（同一句 iflytek-spark-loomy）
 *   - 该裸根补 `{type:object, properties}`    → 200
 *   - 裸根但把 `type` 改名成 `kind`（不补壳） → 200（隔离出根级 `type` 才是触发点）
 *   - 93 合规 + 6 裸根（贴近真实的混合）      → 400
 *   - 6 个全部补壳                            → 200
 *
 * 这与同插件 `officeace.mjs` 记录的 ModelArts 81001 案例是同一类根因（那边已用
 * 同样的补壳修复）。本包沿用其 `wrapFlatParameters` 思路、独立实现一份，不 import
 * officeace（避免跨规则包耦合）；只改本 rules 层，vendored 网关一行不动，以后升级
 * 覆盖 vendor 不会冲掉修复。
 *
 * 所以这里主要做 OpenAI 规范内、不改语义的事：
 *   1. 删掉上游根本不认识的采样字段（`reasoning` / `thinking`）；
 *   2. 把 Responses API 的 max 叫法归一到 `max_tokens`；
 *   3. 给 `tools` 里不合规的裸 `parameters` 补上标准 object 外壳（**真正的修复**）；
 *   4. `finish_reason` 异常值与 null `content` 兜底，避免客户端卡在「未结束」；
 *   5. 【响应侧】修复结构化 tool_calls 的 function.arguments 非法 JSON（2026-11-12，
 *      spark 偶发写出 `{"pattern":*,"path":"D:\Program Files\..."}` 这类畸形：
 *      值没加引号 + Windows 路径单反斜杠未转义），见 tool-call-arguments.mjs。
 *   6. 【响应侧】正文死循环治理（2026-11-15）：长上下文下 spark-x2.6 会把工具调用闭合
 *      标记当正文无限刷（实测 `</invoke>` 重复到 19 万字符仍在逐 token 生成），见
 *      `contentLimitFrame` 与文件末尾「正文死循环」章节。
 *
 * ## 响应侧 tool_calls.arguments 非法 JSON（2026-11-12，追加）
 *
 * spark-x2.6 偶发把结构化工具调用的 function.arguments 写成「像 JS 对象字面量、
 * 但不是合法 JSON」的字符串，DSH 工具层 JSON.parse 直接失败并报：
 *   Tool call ops_glob: Unexpected token '*', ...pattern:*... is not valid JSON
 * 这与请求侧补壳是两回事（那边是【请求→上游】，这里是【上游→响应】）。vendored
 * loomy2api 的 /v1/chat/completions 流式是纯透传 SSE，不改写 arguments，所以畸形
 * 原样抵达 DSH。修复收敛在共享模块 `tool-call-arguments.mjs`（单点真相，与
 * flat-parameters.mjs 同构），由本包 normalizeDelta 逐帧调用——三段 SSE 循环
 * （主流 / 空流重试 / 续推）都走这个钩子，无需改 proxy.mjs / registry.mjs。
 * 保守契约：合法 JSON 字节不变、分片中间态原样放行、修不了原样返回（不伪造 {}）。
 *
 * ## 正文死循环：`</invoke>` 无限刷屏（2026-11-15，决定性复现）
 *
 * 现象（失败会话 session-888378a0-…，provider vision-toolkit-loomy2api / spark-x2.6，
 * 上下文约 130k-168k token）：turn 21 / turn 22 的 step 3 里 reasoning 正常收敛，正文却
 * 先吐一个上游并不存在的伪标签，接着把工具调用闭合标记当正文无限重复：
 *   `<acp_bash_not_needed>` + `</invoke>` / `</parameter>` / `</function>` 反复
 * 单条 assistant/message 已到 192,958 字符仍在生成（stream 里 text-chunks 的 dt 约
 * 700-1000ms 一批，即模型真的在逐个吐 token），用户只能手动打断。
 * 它既不是工具调用（没有结构化 tool_calls）、不是断流（连接正常、也无业务错误帧）、
 * 也不是思考死循环（已是正文阶段，sawContent 为 true）。
 *
 * 与上游无关：`request/header` 取证显示 DSH 给该 provider 传的是原生 JSON Schema tools，
 * 请求里没有任何 XML/`antml:` 工具格式，`</invoke>` 系列是模型自身退化产出的伪标记。
 *
 * 两层缺口：①`lib/proxy.mjs` 唯一的死循环守卫 `thinkingLimitFrameOf` 只在
 * `!sawContent && !sawToolCall && !sawFinishReason`（纯思考阶段）生效，正文阶段零保护，
 * 所以这条退化能一直刷到客户端超时或用户打断；②`containsToolCallDraft` 要求「同一套
 * 标记里至少两类共现」，而这串退化只命中参数类一类（`</parameter>`），连「草稿当答案」
 * 的续推兜底也不会触发。
 *
 * 修复：框架侧补一个与 `thinkingLimitFrameOf` 同构的 `contentLimitFrameOf` 钩子（正文
 * 阶段逐帧询问，命中即写本钩子给的终止帧 + [DONE] 并掐断上游）；本包按两条判据判定，
 * 都刻意收紧以免误杀正常回答（用反引号/代码围栏讲解工具调用格式的回答不受影响）：
 *   1. 尾部窗口里「工具调用闭合标记」密集出现（正常正文不会把闭合标记裸写进正文）；
 *   2. 通用兜底：尾部窗口里某 24 字片段复述到占满窗口一半，覆盖非标记类的退化。
 * 收尾帧用错误帧（而不是伪造 finish_reason:'stop'）：与本文档前面「不能把思考草稿
 * 当答案」同一条原则——退化输出的前 800 字已经流给客户端了，再补 stop 会让 agent 拿
 * 一段垃圾正文当最终答案；报错终止既如实、又比无限刷屏快得多（实测 < 1 秒掐断）。
 *
 * @module dsh-api-rules/rules/loomy
 */

import { applyReasoningEffort } from './reasoning.mjs'
import { normalizeToolParameters } from './flat-parameters.mjs'
import { repairToolCallsInDelta } from './tool-call-arguments.mjs'

/**
 * 上游（以及 loomy2api）不认识的采样字段。
 *
 * `reasoning_effort` 不再剥离：vendored loomy2api 的 server.py:1371-1375 会读请求体里的
 * `reasoning.effort` / `reasoning_effort` 并透传给上游，`/v1/models` 也逐模型暴露了
 * `reasoning_efforts`（见 cordis.patch.yml 里 loomy2api 的 reasoningEfforts 声明）。
 * 只有 `reasoning`（对象形式）与 `thinking` 这种上游不认识的字段才在这里删掉。
 */
const UNSUPPORTED_PARAMS = ['reasoning', 'thinking']

// —— 思考死循环检测阈值（见 thinkingLimitFrame 的 JSDoc；已用 dbg 脚本标定）——
// 尾部窗口：只在 reasoning 全文尾部这么长的范围内做重复统计，控制每帧成本。
// 1000 字既能让短死循环（千余字即典型）尽快触发，又把每帧统计成本压在几万次
// slice+Map 操作量级。真实死循环会一路涨到十几万 token，越往后越稳命中。
const TAIL_WINDOW = 1000
// 重复 n-gram 长度：24 字。太短易误杀（正常措辞会复现），太长漏检。
const REPEAT_N = 24
// 同一 24 字片段在尾部窗口里出现超过此次数 → 判死循环。
// 标定依据：真正不重复的合法长思考，尾窗内任何 24 字片段最多出现 1 次；
// 死循环同一片段出现 30+ 次。阈值 8 居中，正常措辞（含模板化推理）远达不到。
const REPEAT_THRESHOLD = 8
// 停滞兜底：思考帧数超过此值仍无正文/工具调用/finish_reason → 判死循环。
// 一条 SSE chunk 约带几个 token，6000 帧已是相当长的合法思考上界。
const STAGNATION_CHUNKS = 6000

// —— 正文死循环检测阈值（见 loomyRules.contentLimitFrame 的 JSDoc；2026-11-15）——
// 尾部窗口：只统计正文尾部这么长的范围。既把每帧成本压成常数（与 reasoning 同一手法），
// 又正好贴合退化形态——退化标记是成片出现的，窗口一满就是几十上百个。
const CONTENT_TAIL_WINDOW = 800
// 尾部窗口内工具调用闭合标记 ≥ 此次数 → 判正文死循环。
// 标定依据：正常正文（哪怕在讲解工具调用格式）不会把闭合标记裸写进正文——那种讲解一定
// 写在反引号/代码围栏里，已被 stripCodeSpans 剔掉；实测退化样本在窗口里有上百个。
// 阈值 8 而非 6：留出「正文里逐个列举闭合标记名」这种正当写法（一句里点 6-7 个标记名很
// 容易做到，对抗复核把它记为「零余量」），而真实退化在窗口里是 77-80 个，抬高阈值不损检出。
const CONTENT_TAG_HITS = 8
// 同一窗口内闭合标记 ≥ 此次数 → 也算「正文草稿」（供 containsToolCallDraft 用）。
// 比 CONTENT_TAG_HITS 更低：这里判的是「这轮把草稿当答案收尾了」的场景，多给一次纠正
// 续推的代价（一次重发）远小于让 agent 拿着垃圾正文停住的代价。
const DRAFT_TAG_HITS = 4
// 通用重复兜底：尾部窗口内某 24 字片段出现 ≥ 此次数，且非重叠铺开面积 ≥ 窗口八成 → 判退化。
// 「占满八成窗口」是误杀闸门：合法长文（表格、清单、排比、模板化措辞）即使有重复片段，
// 也很少达到「尾部窗口八成字都在复述同一句」；而死循环正是这个形态（实测真实退化样本
// 的重复覆盖率 ~1.0）。定 0.8 是让步于「行级同构的正常输出」（60 行相同日志行 / 同构表格，
// 覆盖率约 0.75-0.87，其中 0.75 那批被放过）。
// 它兜住不含闭合标记的退化（例如某个伪标签名被无限复述）。
const CONTENT_REPEAT_N = 24
const CONTENT_REPEAT_THRESHOLD = 8
const CONTENT_REPEAT_COVERAGE = 0.8
// 判标记前先在这个更长的切片上做一次「去代码片段」：尾部窗口只有 800 字，若合法的
// 代码围栏整体远长于 800 字，开栏会落在窗口之外，窗口里只剩「块内标记 + 收尾 ```」——
// 直接对 800 字窗口剥离会被那个收尾 ``` 骗到（从它往后截断），把块内标记当成正文。
// 先剥 4000 字再取尾部 800 字，跨窗口的围栏就能整块被剔掉。
// 取 4000 是成本/覆盖的折中：每帧一次 4KB 正则剥离仍是常数级成本。
// 失败方向是 fail-open——切片起点落在代码块中间时，误截断只会少算标记、不会多杀。
const CONTENT_SCAN_WINDOW = 4000

// —— 正文伪工具调用标记检测（见 loomyRules.isIncompleteTurn 的 JSDoc）——
// spark-x2.6 在长上下文 + xhigh 档下会把本该是结构化 tool_calls 的调用退化成正文里的
// XML 草稿。三类标记各成一个正则；只有「至少两类共现」才判为草稿，避免把正文里偶然
// 提到一个 `<arg_key>` 的技术说明误判成故障。
// 旧式 XML 草稿（spark-x2.6 早期退化形态）：<ops_bash> / <arg_key> / </tool_call>。
const TOOL_DRAFT_MARKERS = [
  /<ops_[\w.-]+|<tool_call\b|<antml:invoke\b|<function_calls?\b/i,  // ① 工具名 / 调用开标签
  /<\/?(?:arg_key|arg_value|parameter|antml:parameter)\b/i,           // ② 参数键/值标记
  /<\/(?:tool_call|antml:invoke|function_calls?)>/i,                   // ③ 调用闭合标签
]

// DSML 草稿（spark-x2.6 另一种退化形态，2026-11-10 补）：
//   <｜｜DSML｜｜ calls> <｜｜DSML｜｜ invoke name="ops_bash"> <｜｜DSML｜｜ parameter …>
// 注意竖线是全角 U+FF5C（｜），不是 ASCII `|`；[\uFF5C|]{2} 两种都兼容。
// 与旧式同样要求「本套内至少两类共现」。
const DSML_DRAFT_MARKERS = [
  /<[\uFF5C|]{2}\s*DSML\s*[\uFF5C|]{2}\s*(?:calls|invoke)\b/i,               // ① 调用开标签
  /<[\uFF5C|]{2}\s*DSML\s*[\uFF5C|]{2}\s*parameter\b/i,                   // ② 参数标记
  /<\/[\uFF5C|]{2}\s*DSML\s*[\uFF5C|]{2}\s*(?:invoke|parameter|calls)\s*>/i, // ③ 闭合标签
]

// 工具调用闭合标记（旧式 XML + Anthropic antml: + DSML 三套写法）。
// 只数闭合标记：它们是「本该由结构化 tool_calls 承载、却被写进正文」最硬的信号；
// 开标签（<ops_bash>、<invoke name=…）在正文里被讨论时更常见，容易误伤。
const CLOSING_TAG_RE = /<\/(?:antml:)?(?:invoke|parameter|function|function_calls|tool_call|arg_key|arg_value)\s*>|<\/[\uFF5C|]{2}\s*DSML\s*[\uFF5C|]{2}\s*(?:invoke|parameter|calls)\s*>/gi

/**
 * 剔除「用代码讲解这些标记」的正当内容：围栏代码块、行内反引号片段，以及流式中途
 * 还没闭合的围栏/反引号（否则一段正在流的示例代码会被当成退化）。
 * 退化标记是模型直接写进正文的裸文本，不受影响。
 */
function stripCodeSpans(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    // 未闭合的围栏必须排在行内规则之前：三个反引号会被行内规则 /`[^`\n]*`/ 先吃掉两个
    // （`` 当成一对行内反引号），只剩一个反引号就再也匹配不上围栏，退化标记就漏出来了。
    .replace(/```[\s\S]*$/g, '')
    .replace(/~~~[\s\S]*$/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/`[^\n]*$/g, '')
}

/**
 * 正文尾部窗口内工具调用闭合标记的出现次数（正文不足一个窗口时按全文算）。
 * 先在 CONTENT_SCAN_WINDOW 切片上剥代码片段，再取剥完的尾部窗口来数——这样
 * 跨越窗口边界的代码围栏能被整块剔除；若先取尾部窗口再剥，收尾的 ``` 会把
 * 「块内标记」误留成正文（见 CONTENT_SCAN_WINDOW 的注释）。
 */
function countClosingTagsInTail(text) {
  const scan = text.length > CONTENT_SCAN_WINDOW ? text.slice(-CONTENT_SCAN_WINDOW) : text
  const prose = stripCodeSpans(scan)
  const tail = prose.length > CONTENT_TAIL_WINDOW ? prose.slice(-CONTENT_TAIL_WINDOW) : prose
  return (tail.match(CLOSING_TAG_RE) ?? []).length
}

/**
 * 通用退化兜底：尾部窗口里有没有「一句话被复述到占满大半个窗口」。
 * 返回 {gramChars, occurrences} 或 null。字符级 n-gram 对中文无空格分词也适用；
 * 每帧约 800 次 24 字切片，常数级成本。
 * 与 countClosingTagsInTail 同样先在 CONTENT_SCAN_WINDOW 切片上剥代码片段再取尾部窗口：
 * 否则一段远长于窗口的合法代码块（重复的日志行、重复的示例行）会把开栏挤到窗口外，
 * 块内重复内容被当成正文重复，正常回答被误判成死循环（对抗复核实测 FP3/FP6）。
 */
function dominantRepeatInTail(text) {
  if (text.length < CONTENT_TAIL_WINDOW) return null
  const scan = text.length > CONTENT_SCAN_WINDOW ? text.slice(-CONTENT_SCAN_WINDOW) : text
  const prose = stripCodeSpans(scan)
  const tail = prose.length > CONTENT_TAIL_WINDOW ? prose.slice(-CONTENT_TAIL_WINDOW) : prose
  if (tail.length < CONTENT_REPEAT_N * CONTENT_REPEAT_THRESHOLD) return null
  const grams = new Map()
  for (let i = 0; i + CONTENT_REPEAT_N <= tail.length; i++) {
    const g = tail.slice(i, i + CONTENT_REPEAT_N)
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  let best = null
  let bestCount = 0
  for (const [g, c] of grams) {
    if (c > bestCount) {
      best = g
      bestCount = c
    }
  }
  if (best === null || bestCount < CONTENT_REPEAT_THRESHOLD) return null
  // 滑窗计数会把相邻重叠出现重复计入，覆盖率必须按非重叠铺开面积算，否则短周期串
  // （如 10 字一循环）会被虚报成「铺满窗口」。
  let occurrences = 0
  let idx = tail.indexOf(best)
  while (idx !== -1) {
    occurrences += 1
    idx = tail.indexOf(best, idx + CONTENT_REPEAT_N)
  }
  const gramChars = occurrences * CONTENT_REPEAT_N
  if (gramChars < tail.length * CONTENT_REPEAT_COVERAGE) return null
  return { gramChars, occurrences }
}

/**
 * 正文里是否混入了「工具调用草稿」伪标记。
 * 两套标记（旧式 XML / DSML）**分别**判定：某一套里至少两类共现即算草稿。
 * 分开数而非把 6 个正则塞进一个数组数，避免「旧式 1 类 + DSML 1 类」凑够 2 而误伤
 * 正常的技术说明（如正文里同时提到 <arg_key> 和 <｜｜DSML｜｜ invoke> 两个概念）。
 *
 * 2026-11-15 补第三路判据（只数闭合标记）：实测那串「无限刷 `</invoke>`」的退化文本
 * 只命中参数类一类（`</parameter>`），①②③ 凑不满两类 → 返回 false，于是「草稿当答案」
 * 的续推兜底也失效。而这类只由闭合标记构成的链同样是「本该由结构化 tool_calls 承载、
 * 却被写进正文」的草稿，所以这里再按「尾部窗口里闭合标记密集出现」判一次。
 */
function containsToolCallDraft(text) {
  // 正文里用 ``` 包裹的代码/示例不算：用户让模型展示一段 tool_call 标记是正常回答。
  const prose = text.replace(/```[\s\S]*?```/g, '')
  const hitsIn = (markers) => markers.reduce((n, m) => n + (m.test(prose) ? 1 : 0), 0)
  if (hitsIn(TOOL_DRAFT_MARKERS) >= 2 || hitsIn(DSML_DRAFT_MARKERS) >= 2) return true
  return countClosingTagsInTail(text) >= DRAFT_TAG_HITS
}

export const loomyRules = {
  name: 'loomy2api',

  /**
   * 请求整形：删掉上游不认识的字段、把 Responses API 的 max 叫法归一到 `max_tokens`，
   * 并给 `tools` 里不合规的裸 `parameters` 补上标准外壳（详见文件头「真正的修复」）。
   * 角色、图片、消息一律不动。
   */
  normalizeRequest({ body, model }) {
    const notes = []
    // 档位翻译放在删字段之前：reasoning: {effort} 这种对象形式也要能读到。
    applyReasoningEffort('loomy2api', model, body, notes)
    for (const key of UNSUPPORTED_PARAMS) {
      if (key in body) {
        delete body[key]
        notes.push('dropped ' + key)
      }
    }
    // max_completion_tokens / max_output_tokens 是 Responses API 的叫法，
    // Chat Completions 上游只认 max_tokens；两者同时出现时以较小者为准。
    const candidates = [body['max_tokens'], body['max_completion_tokens'], body['max_output_tokens']].filter(
      (value) => typeof value === 'number' && value > 0,
    )
    if (candidates.length > 0) {
      body['max_tokens'] = Math.min(...candidates)
      delete body['max_completion_tokens']
      delete body['max_output_tokens']
    }

    // spark-x2.6 的确定性 400 就来自这里：DSH 主轮次的全量 tools 里有裸属性表参数
    // （根级 `type` 键）。补成合规 object 外壳后，上游 schema 校验即可通过。
    // 合规外壳、缺失/非对象 parameters、非数组 tools 全部原样放行（见上面的函数）。
    const wrapped = body && typeof body === 'object' ? normalizeToolParameters(body['tools']) : 0
    if (wrapped > 0) {
      notes.push('wrapped ' + wrapped + ' flat tool parameter root(s) into {type:object,properties}')
    }

    return { body, notes }
  },

  /**
   * 图片原样透传。
   *
   * loomy2api 把多模态请求原样交给上游，模型能不能看图由上游决定（视觉模型在
   * cordis.patch.yml 里用 `input: [text, image]` 标记；纯文本模型不带该标记，
   * DSH 就不会给它们送图）。本层不预先剥离图片。
   */
  supportsImages() {
    return true
  },

  /**
   * 只把「上游明确说可以立刻重来」的判定为可重试。
   *
   * 429 / 5xx 在 loomy2api 里意味着「这个账号被冷却、已经换下一个账号重试过了」，
   * 到这里还失败说明整池都不可用，短退避再试一次是合理的；而 402 与业务码（积分不足）
   * 在同一段时间内必然继续失败，重试只会白烧复述。
   *
   * 400 一律不重试：tools 补壳后那句 iflytek-spark-loomy 的 400 已不会再出现；
   * 万一出现别的 400（空 messages、参数非法），它是确定性失败，重试不会改变结果，
   * 且实测曾把网关 keep-alive 连接拖出二次错误「messages 不能为空」，反而把真正的
   * 错误盖掉。之前给「请求有误」这句 400 加的重试已据此移除。
   */
  isRetryable({ status }) {
    if (status === 429 || status === 502 || status === 503 || status === 504) return true
    return false
  },

  isConcurrencyError() {
    return false
  },

  /** 退避比 cline 短一档：账号冷却以百秒计，本层只是磨掉瞬时抖动。 */
  backoffMs({ attempt }) {
    return Math.min(2000 * 2 ** attempt, 15_000)
  },

  /** 最多再试一次 = 两次退避窗口，仍失败就把上游错误原样交给客户端。 */
  retryBudgetMs() {
    return 20_000
  },

  maxAttempts() {
    return 3
  },

  cooldownMs() {
    return 0
  },

  /**
   * 内嵌网关「上游断流 / 读超时」会发回一帧没有 choices 的 error：
   *   {error:{message:'上游流中断（...）/ upstream stream broken: ...',
   *          type:'upstream_error', code:504}}
   * pipeStream 若不认识它，[DONE] 之后会补 finish_reason:'stop'，把只剩
   * reasoning_content 的截断流伪装成正常回答（spark-x2.6「把思考当结果」）。
   * 这里把它翻成标准 OpenAI 错误帧，让 pipeStream 明确终止并报错。
   */
  translateBusinessError(chunk) {
    if (chunk === null || typeof chunk !== 'object') return undefined
    const err = chunk['error']
    if (err === null || typeof err !== 'object') return undefined
    const msg = String(err['message'] ?? '')
    // 账号池耗尽 / 所有账号都失败了：上游断流后重试时网关账号池瞬时为空
    // （gateway.log「账号池里没有可用账号」→「502 所有账号都失败了」）。
    // 这不是「思考中断」，必须单独认出来，否则会被 streamAbortFrame 误标成
    // thinking-abort，让用户看不出真实原因是账号池耗尽（需在 loomy 桌面端补账号）。
    const isNoAccount = /账号池里没有可用账号|accounts\.json 为空|所有账号都失败了|all accounts failed|没有可用账号|no (usable|available) account|account pool/i.test(msg)
    if (isNoAccount) {
      return { error: { message: msg || 'account pool exhausted', type: 'no_account', code: 503 } }
    }
    const isUpstream = err['type'] === 'upstream_error' ||
      /上游流中断|upstream stream broken/.test(msg)
    if (!isUpstream) return undefined
    const code = typeof err['code'] === 'number' ? err['code'] : 504
    return { error: { message: msg || 'upstream stream broken', type: 'upstream_error', code } }
  },

  /** 断流按网关给的 504 暴露；账号池耗尽按 503 暴露（isRetryable 会重试）；正常 chunk 不干预。 */
  statusForError(chunk) {
    if (chunk === null || typeof chunk !== 'object') return undefined
    const err = chunk['error']
    if (err === null || typeof err !== 'object') return undefined
    if (err['type'] === 'no_account') return 503
    if (err['type'] === 'upstream_error') return typeof err['code'] === 'number' ? err['code'] : 504
    return undefined
  },

  /**
   * 规则层「断流收尾帧」钩子：上游没发 finish_reason 就断流、且规则包决定不补
   * 合成 stop 时，pipeStream 会拿 meta 来问「这轮该给客户端发什么错误帧」。
   * 把「纯思考截断」的判定与文案都放在规则包里，框架只负责调用——别的上游
   * 想定制断流行为只需覆写本钩子，无需改 lib/proxy.mjs。
   * meta: { sawFinishReason, sentAnything, sawContent, sawToolCall }
   */
  streamAbortFrame(meta) {
    if (meta === null || typeof meta !== 'object') return undefined
    if (meta.sawFinishReason === true) return undefined
    if (meta.sentAnything !== true) return undefined
    if (meta.sawContent !== true && meta.sawToolCall !== true) {
      return { error: { message: 'upstream stream aborted during thinking (no content emitted)', type: 'upstream_error', code: 504 } }
    }
    return undefined
  },

  /**
   * 规则层「思考死循环检测」钩子（spark-x2.6 推理不收敛的治理，2026-11-08）。
   *
   * 现象：spark-x2.6 对某些输入 reasoning_content 无限生成，一直思考到把 max_tokens
   * 输出预算耗尽——实测两次 955s 调用、输出恰好 131072（= maxTokens 上限 2^17），
   * content 正文为空，用户看到「卡死转圈 / 死循环」。这是模型层推理不收敛，与之前的
   * 10053 断流（已在 F1–F4 修掉）是两回事。
   *
   * 两级判定，命中任一即让 pipeStream 主动终止流：
   *   1. 尾部重复：取 reasoning 全文尾部 1000 字，滑窗统计 24 字 n-gram 出现次数，
   *      某片段出现 >8 次 → 强死循环信号（正常推理不会在 1000 字窗口里把同一句
   *      24 字复述 8 遍）。字符级 n-gram 对中文无空格分词也适用。
   *   2. 停滞兜底：思考帧数 > 6000 却始终无正文/工具调用/finish_reason → 判死。
   *      覆盖「非逐字重复、但永不收敛」的退化。合法长思考即使上万帧，只要中途出过
   *      一次 content/tool_call/finish_reason，sawContent 等会置位，检测即永久关闭
   *      （框架侧已按 !sawContent && !sawToolCall && !sawFinishReason 短路）。
   *
   * 收尾帧用 finish_reason:'length'：语义精确（思考预算耗尽被截断），是 OpenAI 标准
   * 枚举，DSH 一定认识；已转发的思考 chunk 保留给用户看「模型思考到哪卡住」，
   * 总比 16 分钟黑盒转圈强。没实现本钩子的规则包返回 undefined，行为不变（向后兼容）。
   *
   * @param {{reasoningText?: string, reasoningChunks?: number}} meta pipeStream 给的思考累积快照
   */
  thinkingLimitFrame(meta) {
    if (meta === null || typeof meta !== 'object') return undefined
    const text = typeof meta.reasoningText === 'string' ? meta.reasoningText : ''
    const chunks = typeof meta.reasoningChunks === 'number' ? meta.reasoningChunks : 0
    let reason = null
    if (text.length >= TAIL_WINDOW) {
      const tail = text.slice(-TAIL_WINDOW)
      const grams = new Map()
      for (let i = 0; i + REPEAT_N <= tail.length; i++) {
        const g = tail.slice(i, i + REPEAT_N)
        const c = (grams.get(g) ?? 0) + 1
        grams.set(g, c)
        if (c > REPEAT_THRESHOLD) { reason = 'repetition'; break }
      }
    }
    if (reason === null && chunks > STAGNATION_CHUNKS) reason = 'stagnation'
    if (reason === null) return undefined
    return {
      id: 'api-rules-thinking-limit',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'length',
      }],
      _thinking_loop: { reason, reasoningChunks: chunks, reasoningChars: text.length },
    }
  },

  /**
   * 正文死循环检测（2026-11-15，与 thinkingLimitFrame 同构的第二道闸门）。
   *
   * 框架侧在 `sawContent && !sawToolCall && !sawFinishReason`（已经在出正文、还没有工具
   * 调用、也没有 finish_reason）时逐帧问本钩子；命中即写本钩子给的帧 + [DONE] 并掐断
   * 上游。这一段原先完全没有守卫：thinkingLimitFrame 只在纯思考阶段生效，所以
   * spark-x2.6 把 `</invoke>` 当正文无限刷时没有任何机制能让它停下来
   * （实测单条 assistant/message 已到 192,958 字符，用户只能手动打断）。
   *
   * 两条判据，任一命中即终止：
   *   1. 闭合标记密集：正文尾部 800 字里工具调用闭合标记 ≥ 6 个。只认裸文本——讲解
   *      工具调用格式的回答会把标记写进反引号/代码围栏，已被 stripCodeSpans 剔除；
   *      正常写作也不会把 `</invoke>` 这类闭合标记裸写进正文。
   *   2. 通用重复：尾部窗口里某 24 字片段被复述到占满窗口一半。覆盖不含闭合标记的退化
   *      （例如某个伪标签名被无限复述）。
   *
   * 误杀闸门：正文不足一个窗口（800 字）不判；覆盖率按非重叠铺开面积算（避免短周期串
   * 虚报）；一旦出过工具调用或 finish_reason，框架侧已短路，正常长回答不受影响。
   *
   * 收尾用错误帧（type='content_loop'，code=504）而不是伪造 finish_reason:'stop'：
   * 退化正文的前 800 字已经流给客户端了，补 stop 会让 agent 拿一段垃圾正文当最终答案；
   * 报错终止既如实、又立刻结束这一轮（实测 < 1 秒掐断，而不是刷到客户端超时）。
   *
   * @param {{contentText?: string, contentChunks?: number}} meta 框架给的正文累积快照
   */
  contentLimitFrame(meta) {
    if (meta === null || typeof meta !== 'object') return undefined
    const text = typeof meta.contentText === 'string' ? meta.contentText : ''
    if (text.length < CONTENT_TAIL_WINDOW) return undefined
    let reason = null
    let detail = {}
    const tagHits = countClosingTagsInTail(text)
    if (tagHits >= CONTENT_TAG_HITS) {
      reason = 'closing-tag-spam'
      detail = { tagHits }
    }
    if (reason === null) {
      const repeat = dominantRepeatInTail(text)
      if (repeat !== null) {
        reason = 'repetition'
        detail = repeat
      }
    }
    if (reason === null) return undefined
    return {
      error: {
        message: '上游模型正文死循环：正文在没有任何工具调用的情况下无限重复（例如反复输出 </invoke> 等工具调用闭合标记），已主动终止本轮',
        type: 'content_loop',
        code: 504,
      },
      _content_loop: { reason, contentChars: text.length, ...detail },
    }
  },

  /** `other` 不是 OpenAI 认识的值；不映射会让客户端停在「未结束」。 */
  finishReason(value) {
    if (value === null || value === undefined || value === 'other') return 'stop'
    return value
  },

  /**
   * 逐帧兜底：
   *   1. 只有思考内容、正文为 null 的 chunk：客户端会把 null 当「没有响应」，空串才是同义形状；
   *   2. spark 偶发把结构化 tool_calls 的 function.arguments 写成非法 JSON（裸 * 值、
   *      Windows 路径单反斜杠未转义），在写回 SSE 帧前就地修成合法 JSON。
   *      纯函数实现见 ./tool-call-arguments.mjs（合法 JSON / 分片中间态原样放行）。
   */
  normalizeDelta(delta) {
    if (typeof delta !== 'object' || delta === null) return
    if (delta['content'] === null) delta['content'] = ''
    repairToolCallsInDelta(delta)
  },

  /**
   * 断流时是否补 finish_reason。meta 是 pipeStream 给的「这轮流发过什么」快照：
   * 只发了 reasoning_content、没有正文/工具调用、也没收到 finish_reason，说明上游在
   * 思考阶段就被掐断（spark-x2.6 长思考 + 规则层 120s 超时关响应体）。补 stop 会把
   * 思考草稿当成最终答案——必须拒绝补，让 pipeStream 改问 streamAbortFrame。
   * meta 缺省（旧调用方）保持原行为 true，向后兼容。
   */
  ensureFinishReason(model, meta) {
    if (meta === undefined || meta === null) return true
    if (meta.sawFinishReason === true) return true
    if (meta.sentAnything === true && meta.sawContent !== true && meta.sawToolCall !== true) return false
    return true
  },

  /**
   * 「正文混入伪工具调用标记」检测（spark-x2.6 工具调用格式退化，2026-11-09）。
   *
   * 现象：在 ~104k token 长上下文 + xhigh 档下，spark-x2.6 偶发（实测 1/98 轮）把本该
   * 以结构化 tool_calls 发出的调用，退化成写进正文 content 里的 XML 草稿：
   *   <ops_bash<arg_key>command</arg_key><arg_value>...</arg_value>...</tool_call>
   * 它没生成任何 tool_call 块，却带真实 finish_reason:'stop' 正常收尾——于是这一轮
   * 以「一段工具调用草稿当最终答案」结束，agent 不执行任何工具、直接停住。
   * 这不是 F1–F4 的 120s 断流（那类没有 finish_reason、被 streamAbortFrame 兜住），
   * 也不是思考死循环（thinkingLimitFrame 只在无正文时判定），现有规则层零覆盖。
   *
   * 与 qoder 的「答一步就停」同构：复用 proxy.mjs 的续推链
   *   isIncompleteTurn → incompleteTurnMessages → maxIncompleteTurnRetries
   * （这三个是规则包可选钩子，proxy 用 `?.()` 调用，本文件实现即可，转发层无需改动）。
   * 命中后 proxy 追加一条纠正消息重发一次，逼模型改用真正的 tool_calls。
   *
   * 判定刻意收紧，避免误伤正常回答：
   *   - 必须有正文、无结构化工具调用、有正常 finish_reason（断流/死循环不归这里管）；
   *   - 正文里至少两类伪标记共现（旧式 XML 或 DSML 任一套，见 containsToolCallDraft），代码围栏内的示例不算。
   *
   * 注意：这三个钩子只在本包定义，**绝不能加进 registry.mjs 的 DEFAULTS**——
   * proxy.mjs:756 用 `packs.find(p => typeof p.incompleteTurnMessages === 'function')`
   * 选续推包，一旦 DEFAULTS 带上该方法，所有规则包都「有」它，find 会永远命中链上
   * 第一个包，反而破坏 qoder 的续推。
   *
   * @param {string} model 模型 id（暂不区分，所有走本包的模型一视同仁）
   * @param {{sawFinishReason?: boolean, sentAnything?: boolean, sawContent?: boolean,
   *          sawToolCall?: boolean, contentText?: string}} meta pipeStream 给的这轮快照
   */
  isIncompleteTurn(model, meta) {
    if (meta === null || typeof meta !== 'object') return false
    if (meta.sawContent !== true) return false
    if (meta.sawToolCall === true) return false
    if (meta.sawFinishReason !== true) return false
    const text = typeof meta.contentText === 'string' ? meta.contentText : ''
    if (text.length === 0) return false
    return containsToolCallDraft(text)
  },

  /**
   * 续推消息：把模型那轮「草稿当答案」的正文原样作为 assistant 回合，再补一条明确的
   * 纠正指令——点名问题（把 tool_calls 写成了正文里的文本标记）并要求改用工具调用。
   * 返回新数组，不改原 messages。
   */
  incompleteTurnMessages(originalMessages, assistantText) {
    if (!Array.isArray(originalMessages)) return originalMessages
    return [
      ...originalMessages,
      { role: 'assistant', content: assistantText },
      {
        role: 'user',
        content: '你上一条把工具调用写进了正文（形如 <ops_bash>、<arg_key>、</tool_call>，或 <｜｜DSML｜｜ calls>、<｜｜DSML｜｜ invoke>、<｜｜DSML｜｜ parameter> 的文本标记），但没有生成真正的工具调用，导致这一步无法执行。请不要在正文里输出工具调用草稿，改用工具调用（tool_calls）重新执行你本来要做的操作。',
      },
    ]
  },

  /**
   * 续推次数刻意定为 1（只重发一次）：这是罕见的模型层偶发退化，一条纠正指令足够；
   * 且 proxy 的 contentText 是跨重试累积的，原始草稿标记会一直留在里面，若放多次会
   * 让 isIncompleteTurn 在重试后仍恒为 true、造成不必要的重复请求。一次即是有界重试。
   */
  maxIncompleteTurnRetries() {
    return 1
  },
}
