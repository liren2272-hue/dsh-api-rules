/**
 * 回环 HTTP 小工具：读体、写 JSON、挡跨站请求。
 *
 * 这一层只做「怎么收发」，不含任何供应商知识——规则在 rules/ 里，转发在 proxy.mjs 里。
 *
 * @module dsh-api-rules/http
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** 请求体上限：与 DSH 会话里可能出现的最大附件量级对齐。 */
export const BODY_LIMIT = 64 * 1024 * 1024

function hostnameOf(host) {
  let value = String(host).trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(0, end + 1)
  }
  const colon = value.lastIndexOf(':')
  if (colon !== -1 && /^\d+$/u.test(value.slice(colon + 1))) value = value.slice(0, colon)
  return value
}

export function hostIsLoopback(host) {
  return typeof host === 'string' && host.trim() !== '' && LOOPBACK_HOSTS.has(hostnameOf(host))
}

/** 缺失 Origin 视为本机调用（Node 客户端不发 Origin）；有则必须是回环。 */
export function originIsLoopback(origin) {
  if (origin === undefined || origin === '') return true
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

export function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

export function writeJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

/** OpenAI 形状的错误体，让 DSH 的 pi-ai 能按既有路径显示原因。 */
export function writeOpenAiError(response, status, kind, message) {
  writeJson(response, status, { error: { message, type: kind, code: kind } })
}

export const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted === true) return resolve()
    const timer = setTimeout(finish, ms)
    timer.unref?.()
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
