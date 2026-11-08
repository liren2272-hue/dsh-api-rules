/**
 * 思考强度档位（reasoning effort）的统一翻译层。
 *
 * cordis.patch.yml 里各模型的 `reasoningEfforts` 声明只负责一件事：让宿主模型选择器
 * 渲染出档位菜单（pi-ai 的 `reasoningInfo()` 据此产出 `reasoning.efforts`，客户端再
 * 据此渲染档位按钮）。**真正下发到上游的 `reasoning_effort` 值由本层决定**，插件因此
 * 不依赖 pi-ai 的 `thinkingLevelMap` 行为，也不依赖各家上游自己的归一化。
 *
 * 各上游的档位词表（本机探针实测，见 cordis.patch.yml 里各模型的探针注释）：
 *   officeace / codearts : low medium high xhigh max（glm-5.2 另接受 minimal）
 *   cline (Vercel/OR)     : minimal low medium high xhigh max
 *   loomy2api            : low medium high xhigh
 *   raccoon2api          : low medium high
 *
 * @module dsh-api-rules/rules/reasoning
 */

/** pi-ai 认识的档位名。off 不在此列：声明里一律不写 off（见 cordis.patch.yml 顶部注释）。 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * 每个 provider 接受的档位词表。
 *
 * 声明已经按模型把菜单收窄过，这里是**兜底**：请求体带了词表外的档位时，只做该
 * provider 认识的归一，不猜测、不发明新值。
 */
export const PROVIDER_EFFORTS = {
  officeace: ['low', 'medium', 'high', 'xhigh', 'max'],
  codearts: ['low', 'medium', 'high', 'xhigh', 'max'],
  cline: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  loomy2api: ['low', 'medium', 'high', 'xhigh'],
  raccoon: ['low', 'medium', 'high'],
  // qoder2api-hub 的档位词表逐模型不同（来自 qoder_catalog_*.json 的 thinking_config），
  // 这里只填并集做兜底文档；真实档位由网关的 normalize_reasoning_effort 按模型归一，
  // 本层 translateEffort 对 qoder 不改写、原样下发 reasoning_effort。
  'qoder2api-hub': ['low', 'medium', 'high', 'xhigh'],
  // minimax2api 的网关把 thinking 当**布尔开关**（见 minimax2api.mjs 的 normalizeRequest
  // 把 reasoning_effort 翻译成 thinking true/false），档位词表只作文档与兜底归一。
  minimax2api: ['low', 'medium', 'high', 'xhigh'],
  // trae2api-hub 是 qoder2api-hub 的近亲（同作者、同架构），档位词表与 qoder 一致；
  // 真实档位由网关的 normalize_reasoning_effort（trae_proxy.py:3812）按模型归一。
  'trae2api-hub': ['low', 'medium', 'high', 'xhigh'],
}

/**
 * raccoon2api 的档位归一化（payload.go `normalizeReasoningEffort`）。
 *
 * 以前这件事由 CPA 侧的 raccoon2api 插件做；现在在本层自己做，上游那层只当兜底：
 *   off / none / disabled / minimal → low
 *   low / medium / high              → 保留
 *   GLM / Kimi 的 medium             → high（上游只认 high 这一档深思考）
 * 其它值原样返回，交给上游决定。
 */
function raccoonNormalize(effort, model) {
  const value = String(effort).trim().toLowerCase()
  if (value === 'off' || value === 'none' || value === 'disabled' || value === 'minimal') return 'low'
  if (value === 'low' || value === 'medium' || value === 'high') {
    if (value === 'medium' && /glm|kimi/i.test(String(model || ''))) return 'high'
    return value
  }
  return value
}

/**
 * 把档位翻译成上游认识的值。
 *
 * @param {string} provider provider 键（officeace/codearts/cline/loomy2api/raccoon）
 * @param {string} effort  pi-ai 下发的档位
 * @param {string} model   模型 id（raccoon 的 GLM/Kimi 归一需要它）
 * @returns {string} 翻译后的 wire 值
 */
export function translateEffort(provider, effort, model) {
  const value = String(effort).trim().toLowerCase()
  if (provider === 'raccoon') return raccoonNormalize(value, model)
  return value
}

/**
 * 在 normalizeRequest 里调用：翻译 `body.reasoning_effort`。
 *
 * 只处理「已经带档位」的请求；没带就什么都不做，让上游用自己的默认值（raccoon 的
 * 面板「思考强度 low」就是它的配置默认值）。
 *
 * 档位统一落到扁平字段 `reasoning_effort`：`reasoning: {effort}` 这种对象形式随后会被
 * 规则包当成上游不认识的字段删掉，不提前搬出来就会一起丢掉。
 *
 * @returns {string|null} 生效的档位（没带档位返回 null）
 */
export function applyReasoningEffort(provider, model, body, notes) {
  if (body === null || typeof body !== 'object') return null
  const fromObject = body['reasoning'] && typeof body['reasoning'] === 'object'
    ? body['reasoning']['effort']
    : undefined
  const raw = body['reasoning_effort'] !== undefined ? body['reasoning_effort'] : fromObject
  if (typeof raw !== 'string' || raw.trim() === '') return null

  const translated = translateEffort(provider, raw, model)
  if (translated !== raw && Array.isArray(notes)) {
    notes.push('reasoning_effort ' + raw + ' -> ' + translated)
  }
  body['reasoning_effort'] = translated
  return translated
}
