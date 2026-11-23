/**
 * 同济统一身份认证凭据的本地存储。
 *
 * 为什么单独存：令牌只有 24 小时，过期后必须重新走 IAM 登录（账号 + 密码 + 验证码）。
 * 把凭据存在插件自己的目录里，`ensureToken()` 才能在你无感的情况下自动续期，
 * 而不是每 24 小时让你手打一次密码。
 *
 * 安全边界：
 *   - 只写在本机 `~/.dsh-tongji-aigc/credentials.json`（用户目录，不出机器）；
 *   - 明文**绝不**回传给客户端卡片、绝不写日志、绝不进工具返回值；
 *   - 对外只暴露「是否已存」与账号名，密码仅在本模块内被 `ensureToken()` 读取。
 *
 * 首次播种：若本文件不存在，会尝试从 dsh-api-rules 的 `tongji-vpn.env` 复制一份
 * （那是你本来就维护的 VPN 凭据）。**只复制一次**，之后完全自包含，不再依赖那个文件夹。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logInfo, logWarn } from './log.js'

/** 凭据文件位置；测试可用 TONGJI_AIGC_CRED_FILE 指到临时目录。 */
export const CRED_FILE =
  process.env.TONGJI_AIGC_CRED_FILE || path.join(os.homedir(), '.dsh-tongji-aigc', 'credentials.json')

/** 一次性播种来源（按顺序找第一个存在的）。 */
const VPN_ENV_CANDIDATES = [
  process.env.TONGJI_VPN_ENV || '',
  path.join(os.homedir(), 'Documents', 'dsh-plugins', 'dsh-api-rules', 'tongji-vpn.env'),
].filter(Boolean)

/** 解析 KEY=VALUE 形式的 env 文件（支持 # 注释与成对引号）。 */
function parseEnvFile(file) {
  const out = {}
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[trimmed.slice(0, eq).trim()] = value
  }
  return out
}

/**
 * 读凭据。没有或损坏都返回 null（不抛）。
 * @returns {{username: string, password: string, savedAt: string, source: string}|null}
 */
export function readCreds() {
  try {
    if (!fs.existsSync(CRED_FILE)) return null
    const parsed = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8').replace(/^\uFEFF/, ''))
    const username = typeof parsed?.username === 'string' ? parsed.username.trim() : ''
    const password = typeof parsed?.password === 'string' ? parsed.password : ''
    if (username === '' || password === '') return null
    return {
      username,
      password,
      savedAt: typeof parsed?.savedAt === 'string' ? parsed.savedAt : '',
      source: typeof parsed?.source === 'string' ? parsed.source : 'unknown',
    }
  } catch (error) {
    logWarn(`凭据文件读不了，已忽略：${CRED_FILE}（${error instanceof Error ? error.message : String(error)}）`)
    return null
  }
}

/** 存凭据。调用方负责保证 username/password 非空。 */
export function writeCreds(username, password, source = 'card') {
  const u = String(username || '').trim()
  const p = String(password || '')
  if (u === '' || p === '') throw new Error('凭据为空')
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true })
  const payload = { username: u, password: p, savedAt: new Date().toISOString(), source }
  fs.writeFileSync(CRED_FILE, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  logInfo(`凭据已保存：${CRED_FILE}（账号 ${u}，来源 ${source}）`)
  return { username: u, savedAt: payload.savedAt, source }
}

/** 清除凭据（幂等）。 */
export function clearCreds() {
  try {
    if (fs.existsSync(CRED_FILE)) fs.unlinkSync(CRED_FILE)
    return true
  } catch (error) {
    logWarn(`凭据清除失败：${CRED_FILE}（${error instanceof Error ? error.message : String(error)}）`)
    return false
  }
}

/**
 * 首次播种：没有凭据时，从 VPN 的 env 文件复制一份。
 * 只复制，不保留对该文件的运行时依赖。
 */
export function seedFromVpnEnv() {
  if (readCreds()) return readCreds()
  for (const candidate of VPN_ENV_CANDIDATES) {
    if (!candidate || !fs.existsSync(candidate)) continue
    const env = parseEnvFile(candidate)
    const username = String(env.username || env.user || env.TONGJI_USERNAME || '').trim()
    const password = String(env.password || env.pass || env.TONGJI_PASSWORD || '')
    if (username === '' || password === '') continue
    try {
      writeCreds(username, password, path.basename(candidate))
      return readCreds()
    } catch (error) {
      logWarn(`从 ${candidate} 播种凭据失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return null
}

/** 给卡片看的凭据状态（绝不含密码）。 */
export function credStatus() {
  const creds = readCreds()
  if (!creds) return { configured: false, username: '', source: '', savedAt: '' }
  return { configured: true, username: creds.username, source: creds.source, savedAt: creds.savedAt }
}
