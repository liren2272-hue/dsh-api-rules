/**
 * 工具定义：把同济 AIGC 能力包装成 DSH 工具。
 *
 * 只用 DSH 支持的 JSON Schema 子集（type / properties / required / enum /
 * additionalProperties / items / description）；范围、默认值一律写进 description，
 * 因为 minimum/maximum/format 这类键会被宿主直接拒绝。
 *
 * 生成主链路在 lib/aigc/generate.js，工具与卡片端点共用同一份逻辑。
 */
import fs from 'node:fs'
import path from 'node:path'

import { createTaskDependencies, MODE_LABELS } from './generate.js'
import { readToken } from '../token.js'

/** 从 exec 上下文里解析会话工作目录。 */
export function resolveCwd(exec) {
  try {
    const candidates = [
      exec?.agent?.meta?.cwd,
      exec?.agent?.cwd,
      exec?.agent?.session?.cwd,
      exec?.agent?.session?.meta?.cwd,
      exec?.cwd,
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() !== '') return path.resolve(candidate)
    }
  } catch {
    /* 忽略 */
  }
  return process.cwd()
}

/** 生成工具的核心逻辑，返回工具对象。 */
function createGenerateTool(config, getClient) {
  return {
    name: 'tongji_aigc_generate',
    description:
      '调用同济 AIGC 专区生成图片、视频、3D 或音乐。文生图(t2i)/图生图(i2i)/文生视频(t2v)/图生视频(i2v)/文生3D(t23d)/图生3D(i23d)/文生音乐(t2a)。' +
      '会先校验登录（未登录会提示去设置里登录），然后创建任务、轮询到完成，并把产物下载到会话工作目录，返回绝对路径。' +
      'count 为生成数量，通常 1-4；不指定 template_code 时会自动按 mode 挑选一个可用模板。' +
      '图生图/图生视频需要传 reference_image（本地图片绝对路径），插件会自动上传并作为参考图。' +
      '输出目录默认用会话工作目录，也可用 output_path 指定。',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: '生成模式，必须是以下之一：t2i（文生图）、i2i（图生图）、t2v（文生视频）、i2v（图生视频）、t23d（文生3D）、i23d（图生3D）、t2a（文生音乐）。',
          enum: ['t2i', 'i2i', 't2v', 'i2v', 't23d', 'i23d', 't2a'],
        },
        prompt: {
          type: 'string',
          description: '生成提示词。中文或英文都可以，越具体越好。图生图/图生视频也建议给一句对结果的描述。',
        },
        template_code: {
          type: 'string',
          description: '可选。生成模板 code；不填时插件按 mode 自动挑选一个可用模板。可先用 tongji_aigc_templates 查看可用模板。',
        },
        params: {
          type: 'object',
          description: '可选。模板的附加参数对象（键值对）。image 类型的参数值应填参考图 URL，一般不需要手动填。',
          additionalProperties: true,
        },
        reference_image: {
          type: 'string',
          description: '可选。本地图片的绝对路径，用于 i2i（图生图）或 i2v（图生视频）。插件会读取文件并上传为参考图。',
        },
        count: {
          type: 'integer',
          description: '生成数量，通常填 1-4。视频/3D 建议填 1。',
        },
        output_path: {
          type: 'string',
          description: '可选。产物落盘目录的绝对路径；不填则用当前会话工作目录。',
        },
        estimate_only: {
          type: 'boolean',
          description: '可选。只做生成前报价预估，不真正生成，返回积分/费用。',
        },
      },
      required: ['mode', 'prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: { type: 'string' },
          type: { type: 'string' },
          template_code: { type: 'string' },
          template_name: { type: 'string' },
          estimate: { type: 'object' },
          outputs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                name: { type: 'string' },
                url: { type: 'string' },
                path: { type: 'string' },
              },
            },
          },
          output_dir: { type: 'string' },
          output_count: { type: 'integer' },
          message: { type: 'string' },
        },
        required: ['task_id', 'status'],
      },
      render: (_args, value) => {
        const lines = [`**同济 AIGC 任务 ${value?.task_id ?? '-'}**：${value?.status ?? '-'}`]
        if (value?.template_code) lines.push(`模板：${value.template_code}（${value.template_name || '未命名'}）`)
        if (value?.output_count) {
          lines.push(`产物：${value.output_count} 个，目录 ${value.output_dir || '-'}`)
          for (const output of value.outputs || []) {
            lines.push(`  - ${output.name}${output.path ? ` → ${output.path}` : ''}`)
          }
        }
        if (value?.estimate) lines.push(`预估：${JSON.stringify(value.estimate)}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta: (args, value) => {
        const images = []
        const files = []
        for (const output of value?.outputs || []) {
          if (output?.path && fs.existsSync(output.path)) {
            if ((args?.mode === 't2i' || args?.mode === 'i2i') && /\.(png|jpe?g|webp|gif)$/i.test(output.path)) {
              images.push(output.path)
            } else {
              files.push(output.path)
            }
          }
        }
        return { images, files }
      },
    },
    async execute(args, exec) {
      if (!readToken()) {
        throw new Error('尚未登录同济 AIGC：请到「设置 → 插件 → 同济 AIGC」点「打开登录页」完成登录，并把 access_token 粘回卡片。')
      }
      const mode = String(args?.mode || '').trim()
      const deps = createTaskDependencies(config)
      return deps.run({
        client: getClient(config),
        mode,
        prompt: args?.prompt,
        template_code: args?.template_code,
        params: args?.params,
        reference_image: args?.reference_image,
        count: args?.count,
        output_path: args?.output_path,
        estimate_only: args?.estimate_only,
        cwd: resolveCwd(exec),
      })
    },
  }
}

/** 模板列表工具。 */
function createTemplatesTool(config, getClient) {
  return {
    name: 'tongji_aigc_templates',
    description: '列出同济 AIGC 可用的生成模板（含模板 code、名称、参数 schema）。可按类型筛选（image/video/3d/music 或 t2i/i2v 等模式）。生成前可先调用它确认 template_code。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '可选。按类型筛选模板，可填 image/video/3d/music，或直接填模式 t2i/i2i/t2v/i2v/t23d/i23d/t2a。不填则返回全部。',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          templates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                template_code: { type: 'string' },
                template_name: { type: 'string' },
                type: { type: 'string' },
                param_schema: { type: 'array' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `共 ${value?.total ?? 0} 个模板：\n` + (value?.templates || []).map((t) => `- ${t.template_code}（${t.template_name}，类型 ${t.type}）`).join('\n') }],
      presentationMeta: () => ({}),
    },
    async execute(args) {
      if (!readToken()) throw new Error('尚未登录同济 AIGC：请先在「设置 → 插件 → 同济 AIGC」完成登录。')
      const type = args?.type ? String(args.type).trim() : undefined
      const data = await getClient(config).templates(type)
      const templates = Array.isArray(data) ? data : data?.templates || []
      return { total: templates.length, templates }
    },
  }
}

/** 单个任务查询/下载工具。 */
function createTaskTool(config, getClient) {
  return {
    name: 'tongji_aigc_task',
    description: '查询同济 AIGC 某个生成任务的状态与详情，可选下载产物到本地。task_id 由 tongji_aigc_generate 返回。',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '任务 id（必填）。' },
        download: { type: 'boolean', description: '可选。是否把产物下载到本地，默认 true。' },
        output_path: { type: 'string', description: '可选。下载目录绝对路径，默认用会话工作目录。' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          task: { type: 'object' },
          outputs: { type: 'array' },
          output_dir: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `任务 ${value?.task?.id ?? '-'}：${value?.task?.status ?? '-'}\n${JSON.stringify(value?.task, null, 2)}` }],
      presentationMeta: (_args, value) => ({
        images: (value?.outputs || []).filter((o) => o.path && /\.(png|jpe?g|webp|gif)$/i.test(o.path)).map((o) => o.path),
        files: (value?.outputs || []).map((o) => o.path).filter(Boolean),
      }),
    },
    async execute(args, exec) {
      const client = getClient(config)
      const taskId = String(args?.task_id || '').trim()
      if (!taskId) throw new Error('缺少 task_id。')
      const task = await client.getTask(taskId)
      if (args?.download === false) return { task, outputs: [], message: '未下载，仅返回任务信息。' }

      const outputDir = path.resolve(args?.output_path || config.outputDir || resolveCwd(exec))
      if (task?.status === 'succeeded' && Array.isArray(task.outputs) && task.outputs.length > 0) {
        const results = []
        let i = 0
        fs.mkdirSync(outputDir, { recursive: true })
        for (const output of task.outputs) {
          const url = typeof output.url === 'string' ? output.url : ''
          if (!url) continue
          i += 1
          const filename = path.basename(new URL(url, 'http://localhost').pathname) || `task_${i}`
          const absPath = path.join(outputDir, filename)
          try {
            fs.writeFileSync(absPath, await client.downloadBuffer(url))
            results.push({ index: i, name: filename, url, path: absPath })
          } catch (error) {
            results.push({ index: i, name: filename, url, path: null, error: String(error?.message || error) })
          }
        }
        return { task, outputs: results, output_dir: outputDir, message: `下载 ${results.filter((r) => r.path).length} 个产物到 ${outputDir}` }
      }
      return { task, outputs: [], message: `任务当前状态 ${task?.status}，暂无可下载产物。` }
    },
  }
}

/** 任务历史工具。 */
function createTasksTool(config, getClient) {
  return {
    name: 'tongji_aigc_tasks',
    description: '列出同济 AIGC 的历史生成任务（分页）。可按状态筛选（queued/submitted/running/succeeded/failed/canceled）。',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: '页码，从 1 开始，默认 1。' },
        page_size: { type: 'integer', description: '每页条数，默认 20，建议不超过 50。' },
        status: { type: 'string', description: '可选。按状态筛选：queued/submitted/running/succeeded/failed/canceled。' },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          tasks: { type: 'array' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `共 ${value?.total ?? 0} 条任务：\n` + (value?.tasks || []).slice(0, 30).map((t) => `- ${t.id} ${t.status} ${t.template_name || t.template_code || ''} ${t.created_at || ''}`).join('\n') }],
      presentationMeta: () => ({}),
    },
    async execute(args) {
      const data = await getClient(config).listTasks({
        page: Math.max(1, Math.floor(Number(args?.page) || 1)),
        pageSize: Math.max(1, Math.min(50, Math.floor(Number(args?.page_size) || 20))),
        status: args?.status ? String(args.status).trim() : undefined,
      })
      const tasks = Array.isArray(data) ? data : data?.tasks || []
      const total = typeof data?.total === 'number' ? data.total : tasks.length
      return { total, tasks }
    },
  }
}

/** 报价工具。 */
function createQuoteTool(config, getClient) {
  return {
    name: 'tongji_aigc_quote',
    description: '对同济 AIGC 的一次生成做生成前报价（积分/费用预估），不真正生成。可先用 tongji_aigc_templates 确认模板 code。',
    parameters: {
      type: 'object',
      properties: {
        template_code: { type: 'string', description: '模板 code（必填）。' },
        params: { type: 'object', description: '可选。模板参数对象。', additionalProperties: true },
        count: { type: 'integer', description: '生成数量，默认 1。' },
      },
      required: ['template_code'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          estimate: { type: 'object' },
          quote: { type: 'object' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `报价：${JSON.stringify(value?.estimate ?? value?.quote ?? {}, null, 2)}` }],
      presentationMeta: () => ({}),
    },
    async execute(args) {
      const templateCode = String(args?.template_code || '').trim()
      if (!templateCode) throw new Error('缺少 template_code。')
      const count = Math.max(1, Math.floor(Number(args?.count) || 1))
      const payload = { template_code: templateCode, params: args?.params || {}, count }
      const [estimate, quote] = await Promise.all([
        getClient(config).estimate(payload).catch((error) => ({ error: String(error?.message || error) })),
        getClient(config).quote(payload).catch(() => null),
      ])
      return { estimate, quote }
    },
  }
}

/** 健康/登录状态工具。 */
function createHealthTool(config, getClient) {
  return {
    name: 'tongji_aigc_health',
    description: '检查同济 AIGC 站点可达性、登录态是否有效、以及当前令牌信息。登录或排障时先调用它。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          base_url: { type: 'string' },
          logged_in: { type: 'boolean' },
          healthy: { type: 'boolean' },
          health: { type: 'object' },
          user: { type: 'object' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `同济 AIGC（${value?.base_url}）：登录=${value?.logged_in}，站点=${value?.healthy}，用户=${JSON.stringify(value?.user || {})}` }],
      presentationMeta: () => ({}),
    },
    async execute() {
      const client = getClient(config)
      const base = { base_url: config.baseUrl, logged_in: Boolean(readToken()), healthy: false, health: {}, user: {}, error: '' }
      try {
        const health = await client.health().catch(() => null)
        base.health = health && typeof health === 'object' ? health : {}
        base.healthy = true
      } catch (error) {
        base.error = String(error?.message || error)
      }
      if (readToken()) {
        try {
          const me = await client.me()
          base.user = me && typeof me === 'object' ? me : {}
        } catch (error) {
          base.error = base.error || `登录校验失败：${error?.message || error}`
        }
      }
      return base
    },
  }
}

/**
 * MiniMax-H3 生图已下线：工具与 nonstandard 端点实现都删掉，改走通用 media 通道
 * （在 tongji 上游声明 media.images = ['MiniMax-H3-Image']，由 api_generate_image
 * 统一走 /v1/images/generations）。详见 lib/media-tool.mjs 与 lib/proxy.mjs::media。
 */

/** 创建全部工具。 */
export function createTools(config, getClient, getApiKey) {
  return [
    createGenerateTool(config, getClient),
    createTemplatesTool(config, getClient),
    createTaskTool(config, getClient),
    createTasksTool(config, getClient),
    createQuoteTool(config, getClient),
    createHealthTool(config, getClient),
  ]
}

export { MODE_LABELS }
