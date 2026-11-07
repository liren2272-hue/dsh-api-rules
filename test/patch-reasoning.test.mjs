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
//   codearts/GLM-5.2                       -> [minimal, low, medium, high, xhigh, max]
//   codearts/glm-5.3                       -> [low, high, max]
//   codearts/deepseek-v4.1-flash           -> [low, medium, high, xhigh, max]
//   loomy2api/<chat>                       -> [low, medium, high, xhigh]
//   cline-free/* / nvidia/*                 -> [minimal, low, medium, high, xhigh, max]
//     （2026-11-06 只保留有权限的 3 个免费模型；Vercel/Openrouter 上游实测拒绝非法值）
//   raccoon/*                              -> [low, medium, high]
//     （raccoon2api 插件归一化：off/none/minimal -> low；GLM/Kimi 的 medium -> high）
const EXPECTED = new Map([
  ['codearts/GLM-5.2', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['codearts/glm-5.3', ['low', 'high', 'max']],
  ['codearts/deepseek-v4.1-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/deepseek-v4-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/deepseek-v4-flash-0731', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/deepseek-v4.1-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/deepseek-v4.1-flash-0930', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/glm-5.1', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/glm-5.2', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['officeace/kimi-k2.6', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['loomy2api/spark-x2.6', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/DeepSeek-V4.1-Flash', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/deepseek-v4-flash-0731', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/GLM-5.3-Flash', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/qwen3.8-flash', ['low', 'medium', 'high', 'xhigh']],
  ['loomy2api/mimo-v2.5', ['low', 'medium', 'high', 'xhigh']],
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
])

// 明确不声明的模型（探针实测网关剥离 / 上游忽略 / 无访问 / 动态路由）。
const FORBIDDEN = [
  'officeace/glm-5.2-zx', 'officeace/glm-5.3', 'officeace/glm-5.3-zx',
  'officeace/kimi-k3', 'officeace/qwen3-30b-a3b', 'officeace/qwen3-32b',
  'codearts/glm-5.2-sft-harmony', 'codearts/openpangu-2.0-pro', 'codearts/openpangu-2.0-flash', 'codearts/kimi-k3',
  'loomy2api/qwen-3.8-max', 'loomy2api/auto',
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
