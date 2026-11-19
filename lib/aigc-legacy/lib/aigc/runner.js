/**
 * 生成任务的轮询与产物回收。
 *
 * 上游是「创建任务 → 轮询 → 产物 URL 下载」的异步模型。本模块负责：
 *   1. 组装创建请求（template_code / params / count / quote_token / idempotency_key）；
 *   2. 轮询到终态（succeeded / failed / canceled）或超时；
 *   3. 把 outputs 里的产物下载到会话工作目录，返回绝对路径。
 */
import fs from 'node:fs'
import path from 'node:path'

import { AigcError } from './client.js'
import { logDebug, logInfo } from '../log.js'

/** 活跃状态：还在排队/运行中。 */
const ACTIVE_STATUSES = new Set(['queued', 'submitted', 'running', 'moderating'])
/** 终态。 */
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 一个任务最终成功了吗。 */
export function isTerminal(status) {
  return TERMINAL_STATUSES.has(status)
}

/** 任务是否还在进行。 */
export function isActive(status) {
  return ACTIVE_STATUSES.has(status)
}

/** 从上游 output 元素推断文件名。 */
function guessFilename(output, fallbackIndex, ext) {
  const candidates = [output?.name, output?.file_name, output?.filename]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return path.basename(candidate)
  }
  const url = typeof output?.url === 'string' ? output.url : ''
  const base = path.basename(new URL(url, 'http://localhost').pathname)
  if (base && !base.startsWith('/')) return base
  return `tongji_${fallbackIndex}${ext}`
}

/**
 * 轮询并下载。
 *
 * @param {object} client AigcClient 实例
 * @param {object} options
 * @param {string} options.taskId 任务 id（可为多个，取第一个轮询）
 * @param {number} options.pollIntervalMs 轮询间隔
 * @param {number} options.pollTimeoutMs 轮询总超时
 * @param {string} options.outputDir 落盘目录（绝对路径）
 * @param {string} [options.type] 任务类型（用于扩展名推断）
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} 任务终态 + 产物绝对路径
 */
export async function pollTask(client, { taskId, pollIntervalMs, pollTimeoutMs, outputDir, type, signal }) {
  const startedAt = Date.now()
  let last = null
  let lastProgress = null

  fs.mkdirSync(outputDir, { recursive: true })

  while (Date.now() - startedAt <= pollTimeoutMs) {
    if (signal?.aborted) {
      throw new AigcError(`任务 ${taskId} 已取消（本地中断）`, '重新发起生成即可。')
    }
    const task = await client.getTask(taskId)
    last = task
    const status = task?.status

    if (status !== lastProgress) {
      logInfo(`同济 AIGC 任务 ${taskId}：${status || '未知'}（进度 ${task?.progress ?? '-'}）`)
      lastProgress = status
    }

    // 终态成功，或审核态（moderating）但产物已就绪时，都回收产物。
    // 同济平台在进入 moderating（内容审核）时 outputs 往往已可下载，等 succeeded 会白等。
    const outputsReady = Array.isArray(task?.outputs) && task.outputs.length > 0
    if (status === 'succeeded' || (status === 'moderating' && outputsReady)) {
      return await finalize(client, task, outputDir, type)
    }
    if (status === 'failed' || status === 'canceled') {
      const reason = task?.error?.message || task?.error || '上游未返回失败原因'
      throw new AigcError(`同济 AIGC 任务 ${taskId} 未成功（${status}）：${reason}`, '可调整提示词/参数后重试。')
    }
    await sleep(pollIntervalMs)
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  throw new AigcError(
    `同济 AIGC 任务 ${taskId} 在 ${Math.round(pollTimeoutMs / 1000)} 秒内未完成（当前 ${last?.status || '未知'}，已等待 ${elapsed}s）`,
    '视频生成较慢时可调大配置的 pollTimeoutMs，或改用 tongji_aigc_task 查询结果。',
  )
}

/** 下载产物并整理返回结构。 */
async function finalize(client, task, outputDir, type) {
  const outputs = Array.isArray(task?.outputs) ? task.outputs : []
  const results = []

  for (let i = 0; i < outputs.length; i += 1) {
    const output = outputs[i] || {}
    const url = typeof output.url === 'string' ? output.url : ''
    const ext = type === 'video' ? '.mp4' : guessExtension(output, type)
    const filename = guessFilename(output, i + 1, ext)
    const safeName = `${task?.id || 'task'}-${String(i + 1).padStart(2, '0')}_${filename}`
    const absPath = path.join(outputDir, safeName)

    if (url) {
      try {
        const buffer = await client.downloadBuffer(url)
        fs.mkdirSync(outputDir, { recursive: true })
        fs.writeFileSync(absPath, buffer)
        logInfo(`同济 AIGC 产物已保存：${absPath}`)
      } catch (error) {
        logDebug(`产物下载失败：${url}（${error?.message}）`)
      }
    }

    results.push({
      index: i + 1,
      name: output.name || filename,
      url,
      path: url ? absPath : null,
      width: output.width,
      height: output.height,
      duration: output.duration,
    })
  }

  return {
    task_id: task?.id,
    status: task?.status,
    type: task?.type,
    template_code: task?.template_code,
    template_name: task?.template_name,
    billing: task?.billing,
    progress: task?.progress,
    execution_stage: task?.execution_stage,
    created_at: task?.created_at,
    outputs: results,
    output_count: results.length,
    output_dir: outputDir,
  }
}

function guessExtension(output, type) {
  const url = typeof output?.url === 'string' ? output.url : ''
  try {
    const parsed = new URL(url, 'http://localhost')
    const match = parsed.pathname.match(/\.([a-zA-Z0-9]{2,4})(?:$|[?#])/)
    if (match) return `.${match[1].toLowerCase()}`
  } catch {
    /* 忽略 */
  }
  if (type === 'video') return '.mp4'
  if (type === '3d') return '.glb'
  if (type === 'music') return '.mp3'
  return '.png'
}
