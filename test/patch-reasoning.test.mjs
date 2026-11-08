/**
 * cordis.patch.yml 里 llm-pi-ai 的 `reasoningEfforts` 声明的回归测试。
 *
 * 为什么需要它：模型选择器里「思考强度」档位菜单完全由 pi-ai 的模型元数据驱动
 * （`reasoningInfo()` 对 `reasoning:false` 的模型返回 {}，菜单就不出现）。档位来自
 * cordis.patch.yml 里每个模型的 `reasoningEfforts`（档位 -> 上游 wire 值）。写错一个
 * 键名、漏掉 off、或给不支持的模型声明，都只会在运行期才发现（要么菜单不出现，要么
 * 上游 400）。所以这里把「本机实测出来的可取档位」钉成白名单。
 *
 * 校验规则（复刻 @deepseek-ai/dsh-llm-pi-ai resolveModelReasoning）：
 *   - 档位名必须落在 THINKING_LEVELS 里；
 *   - wire 值必须是非空字符串；
 *   - 至少要有 1 个 off 之外的档位；
 *   - 一律不声明 off：不选档时 pi-ai 不下发 reasoning_effort，由上游默认值决定。声明 off 为某个
 *     wire 值会让 pi-ai 在**所有**请求里强制带上它（openai 分支 offValue 逻辑），把上游默认的
 *     「思考开」改成显式关闭。上游的 "none"（关闭思考）不是 pi-ai 档位名，无法作为档位声明；
 *     glm-5.1 / kimi-k2.6 / deepseek-v4-flash 连 none 都不接受，声明了只会 400。
 *
 * 说明：本测试用一个针对本文件结构的小型扫描器抽取 reasoningEfforts 块，不引入 YAML
 * 依赖（插件测试保持零依赖）。完整 YAML 语法由宿主启动时 Cordis 解析兜底。
 *
 * 运行：node test/patch-reasoning.test.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

// 本机实测（2026-11-06 探针 + 华为 MaaS 文档）。上游接受 none 的模型也不声明它：nnone 不是
// pi-ai 档位名，只有声明 off 才能表达，而声明 off 会让所有默认请求都带上 reasoning_effort。
//   officeace/deepseek-v4-flash            -> [low, medium, high, xhigh, max]（不接受 none）
//   officeace/deepseek-v4-flash-0731       -> [low, medium, high, xhigh, max]（上游接受 none）
//   officeace/deepseek-v4.1-flash          -> [low, medium, high, xhigh, max]（上游接受 none）
//   officeace/deepseek-v4.1-flash-0930     -> [low, medium, high, xhigh, max]（上游接受 none）
//   officeace/glm-5.1                      -> [low, medium, high, xhigh, max]（不接受 none）
//   officeace/glm-5.2                      -> [minimal, low, medium, high, xhigh, max]（上游接受 none/minimal）
//   officeace/kimi-k2.6                    -> [low, medium, high, xhigh, max]（不接受 none）
//   officeace/glm-5.3-flash                -> [low, high, max]（实测 400：始终思考，不支持关闭）
//   codearts/GLM-5.2                       -> [minimal, low, medium, high, xhigh, max]
//   codearts/glm-5.3                       -> [low, high, max]
//   codearts/deepseek-v4.1-flash           -> [low, medium, high, xhigh, max]
//   loomy2api/<chat>                       -> [low, medium, high, xhigh]
//   cline-free/* / nvidia/*                 -> [minimal, low, medium, high, xhigh, max]
//     （2026-11-06 只保留有权限的 3 个免费模型；Vercel/Openrouter 上游实测拒绝非法值）
//   raccoon/*                              -> [low, medium, high]
//     （raccoon2api 插件归一化：off/none/minimal -> low；GLM/Kimi 的 medium -> high）
const EXPECTED = new Map([
  // 2026-11-08 17:11 探针（tmp/probe-all-efforts.json）在 8788 上实测：
  // qoder2api-hub 的 Auto / Efficient / Fast 五个档位返回 200（Auto 的 max 那次 400，
  // 其余档位 200），loomy2api 的 qwen-3.8-max / auto 也补了声明。这五条曾经在
  // FORBIDDEN 里（「无思考配置，不声明」），补声明后白名单必须同步，否则本测试会红。
  ['loomy2api/qwen-3.8-max', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['loomy2api/auto', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['qoder2api-hub/Auto', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['qoder2api-hub/Efficient', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['qoder2api-hub/Fast', ['low', 'medium', 'high', 'xhigh', 'max']],
  // 2026-11-09 minimax2api（MiniMax Agent 官方客户端网关，:8080）：
  // 它不认 OpenAI 的 reasoning_effort 档位，只认布尔 `thinking`；规则层
  // （lib/rules/minimax2api.mjs:112-118）把任何非 off/none/disabled/minimal 的档位
  // 一律翻成 thinking:true，而 m3.1-flash 是 forced_on（忽略入参恒开思考）、
  // m3 是 switchable（按布尔发 thinking）。也就是说五档对它全部合法、语义等价，
  // 声明出来只是让选择器能列档，不会产生 400 —— 所以按五档声明。
  ['minimax2api/minimax-m3.1-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['minimax2api/minimax-m3', ['low', 'medium', 'high', 'xhigh', 'max']],
  // 2026-11-09 trae2api-hub（:8791，trae_proxy.py:1.4.3）：
  // 网关原生处理 reasoning_effort（低/中/高/超高/最高五档直接透传给上游的
  // parameters.reasoning_effort，见 trae_proxy.py:3812 normalize_reasoning_effort），
  // 五档对 trae 模型全部合法、语义等价，声明出来让选择器能列档，不会产生 400。
  ['trae2api-hub/Seed-Code', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Kimi-K3', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/DeepSeek-V4-Flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/DeepSeek-V4-Pro', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/GLM-5.3', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Qwen3.8-Max', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Kimi-K2.8-Preview', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/MiniMax-M3', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Seed-2.1-Pro-0915', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/DeepSeek-V3.1-Terminus', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Claude-Opus-4.7', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Claude-Sonnet-4.6', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/GPT-5.5', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/GPT-6-Astra', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Gemini-2.5-Pro', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Gemini-3.1-Pro-Preview', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Grok-4', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['trae2api-hub/Kimi-K2-0905', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/GLM-5.2', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/glm-5.3', ['low', 'high', 'max']],
  ['codearts/deepseek-v4.1-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  // 以下 9 个 codearts 模型 2026-11-08 经 8788 codearts 路由实测：low/medium/high/xhigh/max 全 200。
  // 曾经漏声明的 deepseek-v4.1-flash-1017 就是因为没进白名单、也没人强制分类，才在运行期抛
  // UNSUPPORTED_REASONING_EFFORT。补全后「每个模型都必须被显式分类」才成立（见文件末尾的全覆盖校验）。
  ['codearts/deepseek-v4.1-flash-1017', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/kimi-k3', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/glm-5.3-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/kimi-k3.1-pro', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/speed', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/deepseek-v4-pro-0813', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/deepseek-v4-flash-0731', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/glm-5.2-sft-harmony', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/openpangu-2.0-pro', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/openpangu-2.0-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/deepseek-v4-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/deepseek-v4-flash-0731', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/deepseek-v4.1-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/deepseek-v4.1-flash-0930', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/glm-5.1', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/glm-5.2', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/kimi-k2.6', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/glm-5.3-flash', ['low', 'high', 'max']],
  // 2026-11-08 实测经 8788 officeace 路由：下列 4 个全部 low/medium/high/xhigh/max = 200。
  ['officeace/deepseek-v4.1-flash-1017', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/glm-5.3', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/kimi-k3', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/qwen3-30b-a3b', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/qwen3-32b', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['loomy2api/spark-x2.6', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/DeepSeek-V4.1-Flash', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/deepseek-v4-flash-0731', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/GLM-5.3-Flash', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/qwen3.8-flash', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/mimo-v2.5', ['low', 'medium', 'high', 'xhigh']],
  // qoder2api-hub：档位来自上游 /v1/models 实测（账号 intl realm，阵容动态，随账号/上游变化）。
  // 网关自动把上游不支持的档位归一到最近合法档（qoder_proxy.py normalize_reasoning_effort:3751）。
  // Auto / Efficient / Fast 无思考配置，不声明 reasoningEfforts（选择器不出现档位菜单）。
  ['qoder2api-hub/Ultimate', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['qoder2api-hub/Sonus', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['qoder2api-hub/Cantus', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['qoder2api-hub/MiniMax-M3.1-Flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['qoder2api-hub/Qwen3.8-Max', ['low', 'medium', 'xhigh']],
  ['qoder2api-hub/Qwen3.8-Flash', ['low', 'medium', 'xhigh']],
  ['qoder2api-hub/Kimi-K3.1-Pro', ['low', 'high', 'max']],
  ['qoder2api-hub/Kimi-K2.8-Preview', ['low', 'high', 'max']],
  ['qoder2api-hub/GLM-5.3', ['low', 'high', 'max']],
  ['qoder2api-hub/GLM-5.3-Flash', ['high', 'max']],
  ['qoder2api-hub/DeepSeek-V4-Pro', ['high', 'max']],
  ['qoder2api-hub/DeepSeek-Flash', ['low', 'high', 'max']],
  ['qoder2api-hub/QoDuck', ['low', 'high', 'xhigh']],
  ['cline/cline-free/nemotron-3.5-super-vl', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['cline/cline-free/solar-mini4', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['cline/nvidia/nemotron-3.5-lightning-free', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['raccoon/raccoon/raccoon-19b265', ['low', 'medium', 'high']],
  ['raccoon/raccoon/raccoon-405a1c', ['low', 'medium', 'high']],
  ['raccoon/raccoon/raccoon-8c4485', ['low', 'medium', 'high']],
  ['raccoon/raccoon/sn-deepseek-v4-1-flash-1017', ['low', 'medium', 'high']],
  ['raccoon/raccoon/sn-glm-5-3', ['low', 'medium', 'high']],
  ['raccoon/raccoon/sn-glm-5-3-flash', ['low', 'medium', 'high']],
  ['raccoon/raccoon/sn-kimi-k3', ['low', 'medium', 'high']],
  ['raccoon/raccoon/sn-sensenova-6-8-flash', ['low', 'medium', 'high']],
  ['raccoon/raccoon/sn-sensenova-6-8-flash-lite', ['low', 'medium', 'high']],
  ['raccoon/raccoon/raccoon-090dd3', ['low', 'medium', 'high']],
])

// 明确不声明的模型（探针实测网关剥离 / 上游忽略 / 无访问 / 动态路由）。
// 这是「故意不声明」的白名单：凡在 pi-ai 段里出现、但不该有 reasoningEfforts 的模型都必须列在这里，
// 否则末尾的全覆盖校验会失败——逼着新增模型时显式决定「声明 or 故意不声明」，而不是漏掉。
const FORBIDDEN = [
  // officeace：经 8788 路由实测 404（网关不转发 / 上游不提供），无强度档可言。
  'officeace/glm-5.2-zx', 'officeace/glm-5.3-zx',
  // minimax2api/minimax-agent：网关里它没有 modelSelection 条目（既非 forced_on 也非
  // switchable，见 lib/rules/minimax2api.mjs:29-38），thinking 入参对它无意义，
  // 所以 cordis.patch.yml 不给它声明 reasoningEfforts；列在这里把「故意不声明」固化下来。
  'minimax2api/minimax-agent',
]

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

const here = dirname(fileURLToPath(import.meta.url))
const patch = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8')
const lines = patch.split(/\r?\n/)

const indentOf = (line) => line.match(/^ */)[0].length

/** 找 reasoningEfforts 块上方的 provider（6 空格缩进的键）与模型 id（10 空格的 `- id:`）。 */
function scanBlocks(src) {
  const blocks = []
  for (let i = 0; i < src.length; i++) {
    const head = /^(\s*)reasoningEfforts:\s*(#.*)?$/.exec(src[i])
    if (!head) continue
    const blockIndent = head[1].length

    let provider = null
    for (let k = i - 1; k >= 0; k--) {
      const m = /^ {6}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(src[k])
      if (m) { provider = m[1]; break }
    }
    let modelId = null
    for (let k = i - 1; k >= 0; k--) {
      const m = /^ {10}-\s*id:\s*(.+?)\s*$/.exec(src[k])
      if (m) { modelId = m[1]; break }
    }

    const entries = []
    for (let j = i + 1; j < src.length; j++) {
      const line = src[j]
      if (line.trim() === '' || line.trim().startsWith('#')) continue
      if (indentOf(line) <= blockIndent) break
      const kv = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
      if (!kv) { entries.push({ raw: line }); continue }
      entries.push({ key: kv[1], value: kv[2].trim() })
    }
    blocks.push({ provider, modelId, entries })
  }
  return blocks
}

const blocks = scanBlocks(lines)

check('至少扫到 1 个 reasoningEfforts 块', blocks.length > 0, '找到 ' + blocks.length + ' 个')

// ---- 全覆盖校验（扩展性保证）----
// 扫出 pi-ai 段里**每个**模型的 id（10 空格 `- id:`，无论有没有 reasoningEfforts），要求它
// 必须被显式分类：要么进了 EXPECTED（必须声明，且档位集合与实测一致），要么进了 FORBIDDEN
// （故意不声明）。两者都不在 = 新增模型忘了决定它的思考强度 → 直接失败。
//
// 这就是 2026-11-08 那个 bug 的根治：deepseek-v4.1-flash-1017 当初既没声明也没进任何清单，
// 于是没人发现它缺声明，直到运行期 pi-ai 抛 UNSUPPORTED_REASONING_EFFORT（发生在进规则层
// 之前，规则层拦不住）。把「分类」变成测试硬门槛后，新增模型一落进 cordis.patch.yml 就必须
// 同时落进本文件的 EXPECTED 或 FORBIDDEN，漏不掉。
function scanAllModels(src) {
  const models = []
  // 顶层 `- id: llm-pi-ai`（0 缩进）之后，providers 段里的模型条目是 10 空格的 `- id:`。
  // 顶层 `- id:`（0 缩进）再次出现 = 离开了 llm-pi-ai 块，停。
  let inPiAi = false
  let provider = null
  for (let i = 0; i < src.length; i++) {
    const line = src[i]
    if (/^- id: llm-pi-ai\s*$/.test(line)) { inPiAi = true; continue }
    if (!inPiAi) continue
    if (/^- id:/.test(line)) break // 下一个顶层补丁条��，llm-pi-ai 段结束
    const prov = /^ {6}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (prov) { provider = prov[1]; continue }
    const model = /^ {10}- id:\s*(.+?)\s*$/.exec(line)
    if (model && provider) models.push({ provider, id: model[1].trim() })
  }
  return models
}

const allModels = scanAllModels(lines)
const declaredIds = new Set(blocks.map((b) => `${b.provider}/${b.modelId}`))
const forbiddenSet = new Set(FORBIDDEN)
const expectedSet = new Set(EXPECTED.keys())

for (const { provider, id } of allModels) {
  const fullId = `${provider}/${id}`
  const classified = expectedSet.has(fullId) || forbiddenSet.has(fullId)
  check(`模型 ${fullId} 已被分类（EXPECTED 或 FORBIDDEN）`, classified,
    '既不在 EXPECTED 也不在 FORBIDDEN —— 新增模型必须显式决定它的思考强度档位；' +
    '支持档位就量一遍加进 EXPECTED 并在 cordis.patch.yml 声明，不支持/不转发就加进 FORBIDDEN')
  if (!declaredIds.has(fullId)) {
    check(`未声明的 ${fullId} 必须在 FORBIDDEN 里`, forbiddenSet.has(fullId),
      '该模型没有 reasoningEfforts 块，也没进 FORBIDDEN —— 要么补声明+进 EXPECTED，要么进 FORBIDDEN')
  }
}

check('全覆盖扫描至少覆盖到 1 个模型', allModels.length > 0, '扫到 ' + allModels.length + ' 个')

// 扫描器必须恰好命中白名单里的模型
const found = blocks.map((b) => `${b.provider}/${b.modelId}`).sort()
const expectedIds = [...EXPECTED.keys()].sort()
equal('reasoningEfforts 块与白名单一一对应', JSON.stringify(found), JSON.stringify(expectedIds))

for (const block of blocks) {
  const id = `${block.provider}/${block.modelId}`
  check(`${id} 有 model id`, Boolean(block.modelId))
  check(`${id} 条目都是 key: value`, block.entries.every((e) => e.key !== undefined),
    JSON.stringify(block.entries))

  const keys = block.entries.map((e) => e.key)
  check(`${id} 档位名都在 THINKING_LEVELS 内`, keys.every((k) => THINKING_LEVELS.has(k)),
    JSON.stringify(keys))
  check(`${id} 未声明 off`, !keys.includes('off'), JSON.stringify(keys))

  for (const e of block.entries) {
    if (e.key === undefined) continue
    check(`${id} ${e.key} 的 wire 是非空字符串`,
      typeof e.value === 'string' && e.value !== '', JSON.stringify(e.value))
  }

  const got = keys.filter((k) => k !== 'off').sort()
  const want = [...(EXPECTED.get(id) || [])].sort()
  equal(`${id} 档位集合与实测一致`, JSON.stringify(got), JSON.stringify(want))
}

for (const forbidden of FORBIDDEN) {
  check(`未给 ${forbidden} 声明 reasoningEfforts`, !found.includes(forbidden))
}

console.log('\n' + passes + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
