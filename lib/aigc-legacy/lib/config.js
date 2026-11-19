/**
 * 配置解析。
 *
 * 优先级（**高的赢**）：
 *   1. 插件配置 —— profile 的 cordis.patch.yml 里那条 entry 的 `config:`（宿主注入的 apply(ctx, config)）
 *   2. 配置文件 —— `~/.dsh/.tongji-aigc/config.json`（不用重启 DSH、不用改 profile）
 *   3. 环境变量 —— TONGJI_AIGC_*（适合临时覆盖）
 *   4. 内置默认值 —— 本文件 DEFAULTS
 *
 * 不依赖任何第三方 schema 库：Cordis 在插件没有导出 `Config` schema 时会把原始配置
 * 对象原样交给 apply，所以手写校验就够了，也避免了 link 安装下的依赖解析问题。
 *
 * 注意：**登录令牌不放这里**。令牌由设置卡片写入独立的 `~/.dsh/.tongji-aigc/token.json`
 * （与配置分离，清除令牌不需要动配置，反之亦然）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logWarn } from './log.js'

/** 插件 id，同时用作配置目录名。 */
export const PLUGIN_ID = 'dsh-tongji-aigc'

/** 同济 AIGC 站点 API 默认基址（生产同域）。 */
export const DEFAULT_BASE_URL = 'https://agi.tongji.edu.cn/api/v1'

/** 配置文件位置；测试可以用 TONGJI_AIGC_CONFIG 指到临时目录。 */
export const CONFIG_FILE =
  process.env.TONGJI_AIGC_CONFIG || path.join(os.homedir(), `.${PLUGIN_ID}`, 'config.json')

/** 内置默认值。 */
export const DEFAULTS = {
  baseUrl: DEFAULT_BASE_URL,
  /** 单次 HTTP 请求超时（毫秒）。上游生成接口偶尔要算很久，给宽一点。 */
  requestTimeoutMs: 300_000,
  /** 任务轮询间隔（毫秒）。 */
  pollIntervalMs: 2000,
  /** 任务轮询总超时（毫秒）：视频生成常需几十秒到几分钟，默认 10 分钟。 */
  pollTimeoutMs: 600_000,
  /** 产物落盘目录；不填则用调用时解析出的会话工作目录。 */
  outputDir: '',
  /** 生成数量上限（同一次调用最多产出几张/几段）。 */
  maxCount: 4,
}

/** 环境变量名 → 插件配置键。 */
const ENV_KEYS = {
  TONGJI_AIGC_BASE_URL: 'baseUrl',
  TONGJI_AIGC_BASEURL: 'baseUrl',
  TONGJI_AIGC_POLL_INTERVAL_MS: 'pollIntervalMs',
  TONGJI_AIGC_POLL_TIMEOUT_MS: 'pollTimeoutMs',
  TONGJI_AIGC_REQUEST_TIMEOUT_MS: 'requestTimeoutMs',
  TONGJI_AIGC_OUTPUT_DIR: 'outputDir',
  TONGJI_AIGC_MAX_COUNT: 'maxCount',
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读配置文件；坏了就当没有，绝不因为这个把插件搞挂。 */
export function readConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {}
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch (error) {
    logWarn(`配置文件读不了，已忽略：${CONFIG_FILE}（${error instanceof Error ? error.message : String(error)}）`)
    return {}
  }
}

/** 把一份补丁合并进配置文件（留给面板/脚本用）。 */
export function writeConfigFile(patch) {
  const next = { ...readConfigFile(), ...patch }
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/** 从环境变量里抽配置。 */
export function configFromEnv(env = process.env) {
  const out = {}
  for (const [envKey, configKey] of Object.entries(ENV_KEYS)) {
    const value = env[envKey]
    if (value !== undefined && value !== '') out[configKey] = value
  }
  return out
}

function pickString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return undefined
}

function pickNumber(value, fallback) {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) && num > 0 ? num : fallback
}

/**
 * 解析并校验配置。任何非法项都回落到默认值，绝不让插件因一个坏配置起不来。
 *
 * @param {object} pluginConfig 宿主注入的插件配置（可能为空）
 * @returns {object} 归一化后的配置
 */
export function resolveConfig(pluginConfig = {}) {
  const fileConfig = readConfigFile()
  const envConfig = configFromEnv()
  const merged = { ...DEFAULTS, ...fileConfig, ...envConfig, ...(isPlainObject(pluginConfig) ? pluginConfig : {}) }

  const baseUrl = pickString(merged.baseUrl, DEFAULT_BASE_URL)
  return {
    baseUrl: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    requestTimeoutMs: pickNumber(merged.requestTimeoutMs, DEFAULTS.requestTimeoutMs),
    pollIntervalMs: pickNumber(merged.pollIntervalMs, DEFAULTS.pollIntervalMs),
    pollTimeoutMs: pickNumber(merged.pollTimeoutMs, DEFAULTS.pollTimeoutMs),
    outputDir: pickString(merged.outputDir) ?? '',
    maxCount: Math.max(1, Math.min(8, Math.floor(pickNumber(merged.maxCount, DEFAULTS.maxCount)))),
  }
}

export { CONFIG_FILE as TONGJI_AIGC_CONFIG_FILE }
