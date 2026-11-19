/**
 * 生成主链路：模板选择 → 参考图上传 → 报价 → 创建任务 → 轮询 → 产物落盘。
 *
 * 抽成独立模块，让 DSH 工具（lib/aigc/tools.js）与卡片快速生成端点
 * （lib/index.js 的 /api/tongji-aigc/generate）共用同一条逻辑，避免行为分叉。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { AigcError } from './client.js'
import { pollTask } from './runner.js'
import { logWarn } from '../log.js'

export const MODE_LABELS = {
  t2i: '文生图',
  i2i: '图生图',
  t2v: '文生视频',
  i2v: '图生视频',
  t23d: '文生 3D',
  i23d: '图生 3D',
  t2a: '文生音乐',
}

const MODE_CATEGORIES = {
  t2i: ['image', 'image_gen', 'img'],
  i2i: ['image', 'image_gen', 'img'],
  t2v: ['video', 'video_gen'],
  i2v: ['video', 'video_gen'],
  t23d: ['3d'],
  i23d: ['3d'],
  t2a: ['music', 'audio'],
}

const IMAGE_PARAM_KEYS = ['image', 'image_url', 'reference_image', 'init_image', 'input_image']

/** 模式 → 落盘产物类别。 */
function outputKind(mode) {
  if (mode === 't2v' || mode === 'i2v') return 'video'
  if (mode.includes('3d')) return '3d'
  if (mode === 't2a') return 'music'
  return 'image'
}

function pickTemplate(templates, mode) {
  const list = Array.isArray(templates) ? templates : []
  const categories = MODE_CATEGORIES[mode] || []
  const match = (template) => {
    if (template?.type === mode) return true
    if (template?.generate_type === mode) return true
    if (template?.kind === mode) return true
    if (categories.includes(String(template?.type).toLowerCase())) return true
    if (categories.includes(String(template?.category).toLowerCase())) return true
    return false
  }
  return list.find(match) || null
}

function injectReferenceImage(params, imageUrl) {
  const next = { ...(params || {}) }
  const key = IMAGE_PARAM_KEYS.find((candidate) => typeof next[candidate] !== 'string') || IMAGE_PARAM_KEYS[0]
  next[key] = imageUrl
  return next
}

function extractQuoteToken(estimate) {
  if (!estimate || typeof estimate !== 'object') return null
  return estimate.quote_token || estimate.token || estimate.estimate_token || null
}

/**
 * @param {object} config 归一化配置
 * @returns {{ run: Function }}
 */
export function createTaskDependencies(config) {
  /**
   * 执行一次生成。
   * @param {object} input
   * @param {import('./client.js').AigcClient} input.client
   * @param {string} input.mode
   * @param {string} input.prompt
   * @param {string} [input.template_code]
   * @param {object} [input.params]
   * @param {string} [input.reference_image] 本地图片绝对路径
   * @param {number} [input.count]
   * @param {string} [input.output_path]
   * @param {boolean} [input.estimate_only]
   * @param {string} [input.cwd] 会话工作目录（缺省时用 config.outputDir 或 process.cwd()）
   * @returns {Promise<object>}
   */
  async function run({ client, mode, prompt, template_code, params, reference_image, count, output_path, estimate_only, cwd }) {
    if (!MODE_LABELS[mode]) {
      throw new AigcError(`不支持的生成模式：${mode}。可用：${Object.keys(MODE_LABELS).join('、')}。`)
    }
    // 先解析模板（后续要按 schema 判断是否有 prompt 字段）
    const templates = await client.templates()
    const total = Math.max(1, Math.min(config.maxCount, Math.floor(Number(count) || 1)))
    const outputDir = path.resolve(output_path || config.outputDir || cwd || process.cwd())

    // 1) 模板
    let templateCode = template_code
    let templateName
    let templateMeta = null
    if (!templateCode) {
      const picked = pickTemplate(templates, mode)
      if (!picked?.template_code) {
        throw new AigcError(
          `按 ${mode}（${MODE_LABELS[mode]}）找不到可用模板，请先用 tongji_aigc_templates 查看，并显式传 template_code。`,
        )
      }
      templateCode = picked.template_code
      templateName = picked.template_name || picked.name
      templateMeta = picked
    } else {
      templateMeta = (Array.isArray(templates) ? templates : []).find((t) => t.template_code === templateCode || t.code === templateCode) || null
      if (templateMeta) templateName = templateMeta.template_name || templateMeta.name
    }
    // 解析模板 param_schema，判断该模板是否真的有 prompt 字段
    const hasPromptField = (() => {
      if (!templateMeta) return true // 查不到 schema 时按保守处理，保持向后兼容
      let sch = templateMeta.param_schema
      try { if (typeof sch === 'string') sch = JSON.parse(sch) } catch {}
      const fields = Array.isArray(sch) ? sch : Object.values(sch || {})
      return fields.some((f) => f?.key === 'prompt')
    })()

    // 模板 schema 有 prompt 字段才要求/注入 prompt（纯图生 3D 和纯音乐 t2a 模型没有）
    const hasPrompt = prompt != null && String(prompt).trim() !== ''
    if (!hasPrompt && hasPromptField) {
      throw new AigcError('缺少提示词 prompt。')
    }
    const safePrompt = hasPrompt ? String(prompt).trim() : ''

    // 2) 参数 + 参考图
    // 顶层 prompt 必须显式写进 params.prompt，否则服务端会用模板自带的默认提示词。
    // 仅在「有 prompt 值且模板 schema 有 prompt 字段」时注入，避免给纯 i23d/纯音乐 t2a 模型塞 prompt 报「未知参数 prompt」。
    let taskParams = (hasPrompt && hasPromptField) ? { prompt: safePrompt, ...(params || {}) } : { ...(params || {}) }
    // 调用方若在 params 里显式传了 prompt，以 params 为准（保持向后兼容）
    if (params?.prompt) taskParams.prompt = String(params.prompt)
    if (mode === 'i2i' || mode === 'i2v' || mode === 'i23d') {
      if (!reference_image) {
        throw new AigcError(`${MODE_LABELS[mode]}需要参考图：请传 reference_image（本地图片绝对路径）。`)
      }
      const abs = path.resolve(String(reference_image))
      if (!fs.existsSync(abs)) throw new AigcError(`参考图不存在：${abs}`)
      const uploaded = await client.uploadImage(fs.readFileSync(abs), path.basename(abs))
      // 上游认可的是 path 字段（2630397/aigc/inputs/in_xxx.png），不是带 ticket 的 url
      const refRef = uploaded?.path || uploaded?.data?.path || uploaded?.url || uploaded?.data?.url
      taskParams = injectReferenceImage(taskParams, refRef)
    }

    // 3) 报价 + 预估
    let estimate = null
    let quoteToken = null
    try {
      // 模板 schema 无 prompt 字段时 estimate 端点同样会报「未知参数 prompt」，跳过。
      if (hasPromptField && hasPrompt) estimate = await client.estimate({ template_code: templateCode, params: taskParams, count: total })
    } catch (error) {
      logWarn(`预估失败（estimate）：${error?.message}`)
    }
    if (!estimate_only) {
      try {
        const quote = await client.quote({ template_code: templateCode, params: taskParams, count: total })
        quoteToken = extractQuoteToken(quote)
        if (!quoteToken) throw new AigcError('报价未返回 token')
      } catch (error) {
        logWarn(`报价失败（quote）：${error?.message}`)
      }
    } else {
      return {
        task_id: null,
        status: 'estimate',
        type: mode,
        template_code: templateCode,
        template_name: templateName,
        estimate,
        message: '仅报价预估，未创建任务。',
      }
    }

    // 4) 创建 + 轮询
    const created = await client.createTask({
      template_code: templateCode,
      params: taskParams,
      count: total,
      quote_token: quoteToken,
      idempotency_key: randomUUID(),
    })
    const taskIds = Array.isArray(created?.task_ids) ? created.task_ids : []
    if (taskIds.length === 0) {
      throw new AigcError('创建生成任务失败：上游未返回 task_ids。请检查模板 code、参数与配额。')
    }

    const result = await pollTask(client, {
      taskId: taskIds[0],
      pollIntervalMs: config.pollIntervalMs,
      pollTimeoutMs: config.pollTimeoutMs,
      outputDir,
      type: outputKind(mode),
    })
    return { ...result, estimate }
  }

  return { run }
}
