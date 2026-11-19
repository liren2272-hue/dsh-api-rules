/**
 * 语音转文字 AI 工具定义（whisper）。
 *
 * 把同济 AGI 平台的 Whisper ASR 上游暴露成 DSH 工具，让**任意模型**都能非流式调用
 * 语音转文字。工具 execute 从 host 进程直连回环网关 /audio/transcriptions，与
 * /chat/completions 共用同一条 parseRoute 透传路径（网关侧写死转发到
 * https://agi.tongji.edu.cn/nonstandard/asr/whisper，见 proxy.mjs::audioTranscribe）。
 *
 * 上游是 multipart/form-data（字段 file + model=Whisper），不是 OpenAI 的
 * /v1/audio/transcriptions 形状；网关负责把 JSON 错误包装成 OpenAI 形状让 DSH 显示。
 *
 * 网关 bearer：默认 token=undefined 只要求「非空 bearer」，这里给占位，与 media-generate
 * 端点保持一致；真实上游凭证在 route.apiKey / 账号文件里，网关 audioTranscribe() 自己会取。
 */

/** 网关回环地址兜底：正常从 route.origin() 取，取不到时按默认端口拼。 */
const GATEWAY_FALLBACK = 'http://127.0.0.1:8788'

/** 转写默认模型：同济 AGI 平台的 whisper 模型 id。 */
const DEFAULT_MODEL = 'Whisper'

/**
 * 构造音频转写 ToolDefinition。
 *
 * @param {object} deps
 * @param {() => string | undefined} deps.getOrigin 读网关 origin
 * @returns {object} ToolDefinition
 */
export function defineAudioTranscribeTool(deps) {
  return {
    name: 'api_transcribe_audio',
    description:
      '用同济 Whisper 语音转文字（audio → text）。' +
      '需要同济模型的 API key（与 DSH 模型选择器同一个 TONGJI_API_KEY）。' +
      '传本地音频绝对路径（mp3/wav/m4a/webm 等上游支持的格式），返回转写文本。' +
      'model 默认 Whisper；长音频耗时线性上涨，一次别超过几分钟。',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: '本地音频绝对路径（必填，如 D:/a/talk.mp3 或 /tmp/a.wav）。' },
        model: { type: 'string', description: '可选。转写模型，默认 Whisper。' },
        language: { type: 'string', description: '可选。语言提示（如 zh / en），不传由模型自动识别。' },
        output_path: { type: 'string', description: '可选。转写文本落盘绝对路径（.txt 或 .json），不传只回文本。' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          routeId: { type: 'string' },
          model: { type: 'string' },
          file: { type: 'string' },
          text: { type: 'string' },
          output_path: { type: 'string' },
          bytes: { type: 'integer' },
          duration_ms: { type: 'integer' },
          error: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (_args, value) => {
        if (value?.ok !== true) return [{ type: 'text', text: '**语音转文字失败**：' + (value?.error || '-') + (value?.detail ? '\n' + value.detail : '') }]
        const lines = ['**语音转文字**：' + (value?.model || DEFAULT_MODEL) + '，源 ' + (value?.file || '-')]
        if (value?.output_path) lines.push('落盘：' + value.output_path + (value?.bytes ? '（' + value.bytes + ' 字符）' : ''))
        const preview = (value?.text || '').slice(0, 400)
        if (preview) lines.push('', preview + ((value?.text || '').length > preview.length ? '…' : ''))
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta: (_args, value) => ({
        files: value?.output_path ? [value.output_path] : [],
      }),
    },
    async execute(args, exec) {
      const started = Date.now()
      const filePath = typeof args?.file === 'string' ? args.file.trim() : ''
      if (filePath === '') return { ok: false, error: 'file_required', detail: '必须传本地音频绝对路径（file）。' }

      const model = typeof args?.model === 'string' && args.model.trim() !== '' ? args.model.trim() : DEFAULT_MODEL
      const language = typeof args?.language === 'string' && args.language.trim() !== '' ? args.language.trim() : undefined
      const outputPath = typeof args?.output_path === 'string' && args.output_path.trim() !== '' ? args.output_path.trim() : undefined

      /** 读音频为 Buffer 再放进 File：host 端没有 ReadableStream，Buffer → Blob 最稳。 */
      let audioBuffer
      try {
        audioBuffer = await import('node:fs/promises').then((fs) => fs.readFile(filePath))
      } catch (error) {
        return { ok: false, error: 'file_not_readable', detail: String(error?.cause ?? error), file: filePath }
      }
      if (!audioBuffer || audioBuffer.length === 0) {
        return { ok: false, error: 'file_empty', detail: '音频文件为空（0 字节）。', file: filePath }
      }

      /** multipart/form-data：Node 20 自带 FormData / File，无需 form-data npm 包。 */
      const form = new FormData()
      const fileName = filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'audio'
      form.append('model', model)
      if (language) form.append('language', language)
      form.append('file', new File([audioBuffer], fileName, { type: guessMime(fileName) }))

      const origin = typeof deps.getOrigin === 'function' ? deps.getOrigin() : undefined
      const base = typeof origin === 'string' && origin !== '' ? origin.replace(/\/+$/u, '') : GATEWAY_FALLBACK
      // 网关路由写死 tongji：whisper 端点只有同济有。后续要多路由可改成 resolveAudioRoute。
      const routeId = 'tongji'
      const endpoint = base + '/' + routeId + '/v1/audio/transcriptions'

      let upstream
      try {
        upstream = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: 'Bearer api-rules-media' },
          body: form,
          signal: exec?.signal,
        })
      } catch (error) {
        const aborted = exec?.signal?.aborted === true
        return {
          ok: false,
          error: aborted ? 'timeout' : 'audio_upstream_error',
          detail: String(error?.cause ?? error),
          file: filePath,
        }
      }

      const rawText = await upstream.text()
      let data
      try {
        data = JSON.parse(rawText)
      } catch {
        // 上游返回 text/plain（whisper 常见）：网关应已包成 JSON，这里兜底直接当文本。
        data = { text: rawText }
      }

      if (!upstream.ok) {
        return {
          ok: false,
          error: data?.error?.code ?? data?.error?.type ?? 'audio_upstream_error',
          detail: data?.error?.message ?? rawText.slice(0, 500),
          routeId,
          model,
          file: filePath,
        }
      }

      const text = typeof data?.text === 'string' ? data.text : typeof data?.raw === 'string' ? data.raw : rawText
      let written
      if (outputPath && text !== '') {
        try {
          const fs = await import('node:fs/promises')
          const path = await import('node:path')
          const resolved = path.resolve(outputPath)
          await fs.mkdir(path.dirname(resolved), { recursive: true })
          if (/\.json$/iu.test(resolved)) {
            await fs.writeFile(resolved, JSON.stringify({ model, file: filePath, text, language }, null, 2), 'utf8')
          } else {
            await fs.writeFile(resolved, text, 'utf8')
          }
          written = resolved
        } catch (error) {
          return {
            ok: true,
            routeId,
            model,
            file: filePath,
            text,
            error: 'output_write_failed',
            detail: String(error?.cause ?? error),
            duration_ms: Date.now() - started,
          }
        }
      }

      return {
        ok: true,
        routeId,
        model: data?.model ?? model,
        file: filePath,
        text,
        output_path: written,
        bytes: text.length,
        duration_ms: Date.now() - started,
      }
    },
  }
}

/** 按扩展名猜 mime，只是给 File 一个合理默认；上游 whisper 一般不严格校验。 */
function guessMime(name) {
  const ext = /\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase() ?? ''
  const map = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    flac: 'audio/flac',
    webm: 'audio/webm',
    mp4: 'video/mp4',
  }
  return map[ext] ?? 'application/octet-stream'
}
