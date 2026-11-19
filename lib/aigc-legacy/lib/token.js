/**
 * 登录令牌的本地存储。
 *
 * 令牌**不写进插件配置**，也不写进上游站点目录：单独落在
 * `~/.dsh/.tongji-aigc/token.json`，只存一份 access_token。这样
 * 「清除登录」只需要删这个文件，不用动配置，反之亦然。
 *
 * 对外只暴露「取明文 / 存 / 清 / 回掩码」，明文永不回传给客户端。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logDebug, logWarn } from './log.js'

/** 令牌文件路径。测试可用 TONGJI_AIGC_TOKEN_FILE 指到临时目录。 */
export const TOKEN_FILE =
  process.env.TONGJI_AIGC_TOKEN_FILE || path.join(os.homedir(), '.dsh-tongji-aigc', 'token.json')

/** 令牌的 sessionStorage key（与上游站点保持一致，方便排查）。 */
export const ACCESS_TOKEN_KEY = 'access_token'

/** 只保留尾部 n 位，前面打码。 */
export function maskTail(value, n = 4) {
  if (typeof value !== 'string' || value.length === 0) return ''
  if (value.length <= n) return '****'
  return `${'*'.repeat(Math.min(8, value.length - n))}${value.slice(-n)}`
}

/** 解析 JWT payload（不校验签名，仅用于读 exp / 账号信息，做展示和过期提示）。 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

/** 令牌是否已过期（没有 exp 字段时视为未知，不算过期）。 */
export function isTokenExpired(token) {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return false
  // 提前 60 秒视为过期，避免边界上刚过期就请求失败。
  return payload.exp * 1000 < Date.now() + 60_000
}

/** 读令牌；文件不存在/损坏时返回 null。 */
export function readToken() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null
    const parsed = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (typeof parsed?.token === 'string' && parsed.token.trim() !== '') return parsed.token.trim()
    return null
  } catch (error) {
    logWarn(`令牌文件读不了，已视为未登录：${TOKEN_FILE}（${error instanceof Error ? error.message : String(error)}）`)
    return null
  }
}

/** 存令牌。目录不存在时自动创建。 */
export function writeToken(token) {
  const value = typeof token === 'string' ? token.trim() : ''
  if (value === '') throw new Error('令牌为空')
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  const payload = {
    token: value,
    savedAt: new Date().toISOString(),
    savedBy: 'dsh-tongji-aigc',
  }
  fs.writeFileSync(TOKEN_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  logDebug(`令牌已保存：${TOKEN_FILE}（${maskTail(value)}）`)
  return value
}

/** 清除令牌。文件不存在也返回成功（幂等）。 */
export function clearToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE)
    return true
  } catch (error) {
    logWarn(`令牌清除失败：${TOKEN_FILE}（${error instanceof Error ? error.message : String(error)}）`)
    return false
  }
}

/** 供卡片展示的令牌状态（绝不回传明文）。 */
export function tokenStatus() {
  const token = readToken()
  if (!token) return { configured: false, hint: '', expired: false }
  const payload = decodeJwtPayload(token)
  return {
    configured: true,
    hint: maskTail(token),
    expired: isTokenExpired(token),
    expiresAt: payload && typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null,
  }
}
