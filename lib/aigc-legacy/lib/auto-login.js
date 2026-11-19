/**
 * 自动登录：临时扩展程序 + 隔离一次性浏览器窗，SSO 认证完成后由扩展自动回传令牌。
 *
 * 关键背景（踩过的坑，别再改回去）：
 *   1. 站点 SSO 成功后把令牌写进 agi.tongji.edu.cn 源的 sessionStorage，并立刻
 *      location.replace 跳回站内，地址栏不留 token=。卡片运行在宿主域，跨域读不到，
 *      也没有可读的 cookie / localStorage。
 *   2. 宿主无法跨进程 / 跨源读用户浏览器的存储；要把令牌弄出来，必须有代码跑在
 *      用户登录的那个浏览器会话里读 sessionStorage 再回传 DSH。形态可选项：
 *        a. bsk 受控 tab（扩展性差，已弃）；
 *        b. 临时扩展程序（当前方案，零粘贴、用完即卸）；
 *        c. 油猴 / 书签脚本（用户否，需手动装）；
 *        d. 手动复制粘贴（用户否）。
 *   3. 本方案：宿主自己找一个本机浏览器（Edge / Chrome），开一个**独立临时配置目录**
 *      的窗口并加载一个**临时生成的 Manifest V3 扩展**。用户在那个窗口里完成同济 SSO，
 *      扩展的 content script 轮询到 sessionStorage.access_token 后，通过**顶层导航**
 *      `location.replace(origin + '/api/tongji-aigc/relay?token=...')` 把令牌回传 DSH
 *      （带本地标记完成即停），令牌校验通过后落盘，宿主随即关闭该临时窗口并删除临时扩展
 *      与配置目录（关窗即卸载）。
 *      —— 两个已经踩过并绕开的坑：
 *          ① MV3 SW 常被系统回收，fetch 还没发出就被杀，令牌永久丢失（已弃 background）；
 *          ② 从 agi.tongji.edu.cn（HTTPS）用 fetch 发往 DSH 回传端点（HTTP）会被浏览器
 *             判为**混合内容（mixed-content）并静默拦截**，即使 no-cors 也到不了服务器；
 *             改用顶层导航后，浏览器不对顶层导航做混合内容拦截，HTTPS→HTTP 才能顺利跳转。
 *   4. 不碰用户的常用浏览器配置（独立 --user-data-dir）；不要求开发者模式；不上传
 *      任何数据到第三方，扩展只在本地把令牌回传给本机 DSH。
 *
 * 对外接口（符号保持兼容旧 index.js 调用形态）：
 *   ensureLoginEnv()     检查本机是否有可用浏览器；没有抛 no_browser
 *   startLogin(url,relay) 找浏览器 → 写临时扩展 → 开隔离窗口；返回 {pid,extDir,...}
 *   readLoginToken()     读回登录态（令牌已由扩展回传落盘，这里从磁盘读回并校验）
 *   cleanupLogin()       关闭临时窗口并删除临时扩展 / 配置目录
 */
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { readToken } from './token.js'

/** 临时登录会话状态落盘：HMR 重载只丢内存变量，文件还在就能继续管同一个窗口。测试可用 TONGJI_AIGC_LOGIN_STATE_FILE 指到临时目录。 */
const LOGIN_STATE_FILE = process.env.TONGJI_AIGC_LOGIN_STATE_FILE || join(homedir(), '.dsh-tongji-aigc', 'login-state.json')

/** 临时扩展与隔离浏览器窗配置的最长存活时间（毫秒）。到点无论是否登录都清理，避免残留临时目录。 */
const LOGIN_MAX_AGE_MS = 10 * 60 * 1000

export class AutoLoginError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AutoLoginError'
    this.code = code
  }
}

/** 判定为「还没登录好，继续轮询」的 reason；其余属于环境缺失，停止轮询并降级。 */
export const NEED_BROWSER_LOGIN = new Set([
  'no_login_tab', 'not_logged_in', 'no_browser',
])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadState() {
  try {
    if (!existsSync(LOGIN_STATE_FILE)) return null
    const s = JSON.parse(readFileSync(LOGIN_STATE_FILE, 'utf8').replace(/^﻿/, ''))
    if (s && typeof s.pid === 'number' && s.extDir && s.userDataDir) return s
  } catch {
    /* 状态文件坏了就当没开始过 */
  }
  return null
}

function saveState(state) {
  try {
    mkdirSync(dirname(LOGIN_STATE_FILE), { recursive: true })
    if (state == null) {
      rmSync(LOGIN_STATE_FILE, { force: true })
    } else {
      writeFileSync(LOGIN_STATE_FILE, JSON.stringify(state), 'utf8')
    }
  } catch {
    /* 落盘失败不影响内存里的登录流程 */
  }
}

/** 模块级 live 状态：当前一次性登录窗口的信息；另有落盘兜底。 */
let loginState = loadState()

/**
 * 解析本机浏览器可执行文件。
 *   - 优先 Edge：本机实测只有 Edge 会真正安装 `--load-extension` 的临时扩展；
 *     Chrome 因企业托管策略会静默丢弃 unpacked 扩展（manifest 加载了但 content script 不注入）。
 *     Edge 里没有用户已存凭据，但同济 SSO 若走 WNA / 已登录会话仍能自动跳转；
 *     用户可用 TONGJI_AIGC_CHROMIUM_PATH 显式指定自己常用的浏览器（严格遵循，不存在→视为不可用）。
 *   - 显式配置 TONGJI_AIGC_CHROMIUM_PATH 严格遵循：配了却不存在 → 当作不可用（返回 null），不回退；
 *   - 未配置 → 在常用安装位置与 PATH 里找 Edge / Chrome。
 */
function findChromium() {
  const fromEnv = String(process.env.TONGJI_AIGC_CHROMIUM_PATH || '').trim()
  if (fromEnv !== '') return existsSync(fromEnv) ? fromEnv : null

  // 优先 Edge：本机实测只有 Edge 会真正安装 --load-extension 的临时扩展；
  // Chrome 因企业托管策略会静默丢弃 unpacked 扩展（manifest 加载了但 content script 不注入）。
  // Edge 里没有用户已存凭据，但同济 SSO 若走 WNA / 已登录会话仍能自动跳转。
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]

  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }

  // 再扫一遍 PATH，兜底常见绿色版 / 自定义安装。
  const pathDirs = String(process.env.PATH || '')
    .split(/[;:]/)
    .filter(Boolean)
  for (const dir of pathDirs) {
    for (const name of ['msedge.exe', 'chrome.exe', 'msedge', 'chrome']) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }

  return null
}

/**
 * 临时扩展的 content script 模板：在 *.tongji.edu.cn 站内轮询 sessionStorage.access_token，
 * 读到后通过**顶层导航**回传 DSH 的令牌端点（?token=...）。
 *
 * 为什么用顶层导航而不是 fetch：
 *   - agi.tongji.edu.cn 是 HTTPS，而 DSH 的回传端点是 http://127.0.0.1:PORT（HTTP）。
 *   - content script 用 fetch 从 HTTPS 页发往 HTTP 源会被浏览器判为**混合内容（mixed-content）**
 *     并**静默拦截**（即使是 no-cors 模式），导致令牌永远到不了 DSH，且毫无报错。
 *   - 浏览器**不对顶层导航（top-level navigation）做混合内容拦截**，所以 `location.replace(relay?token=...)`
 *     能从 HTTPS 页顺利跳到 HTTP 的 DSH 回传端点，令牌随之以 query 送达。
 *   - 也不依赖 background service worker（MV3 SW 常被系统回收且曾是 CORS 拦截点）。
 * @param {string} relayUrl 回传端点（不含 query），例如 http://localhost:16554/api/tongji-aigc/relay
 */
function contentJs(relayUrl) {
  const relay = JSON.stringify(relayUrl)
  return [
    '(function () {',
    '  var KEY = "access_token";',
    '  var RELAY_URL = ' + relay + ';',
    '  var DONE_KEY = "dsh_tongji_relay_done";',
    '  var MAX_MS = 6 * 60 * 1000;',
    '  var start = Date.now();',
    '  function schedule() { if (Date.now() - start < MAX_MS) setTimeout(tick, 1500); }',
    '  function trace(msg) {',
    '    try {',
    '      var img = new Image();',
    '      img.src = RELAY_URL + "?__trace__=" + encodeURIComponent(msg)',
    '        + "&host=" + encodeURIComponent(location.hostname)',
    '        + "&path=" + encodeURIComponent(location.pathname)',
    '        + "&t=" + Date.now();',
    '    } catch (e) {}',
    '  }',
    '  function relay(token) {',
    '    try { window.sessionStorage.setItem(DONE_KEY, "1"); } catch (e) {}',
    '    trace("relay:navigating");',
    '    // 顶层导航：不被混合内容拦截，HTTPS 页也能顺利跳到 HTTP 的 DSH 回传端点。',
    '    window.location.replace(RELAY_URL + "?token=" + encodeURIComponent(token));',
    '  }',
    '  function tick() {',
    '    try {',
    '      if (window.sessionStorage.getItem(DONE_KEY) === "1") return;',
    '      var token = window.sessionStorage.getItem(KEY);',
    '      if (token && token.trim()) { relay(token.trim()); return; }',
    '    } catch (e) {}',
    '    schedule();',
    '  }',
    '  trace("injected");',
    '  tick();',
    '})();',
  ].join('\n')
}

/** 临时扩展的 manifest（Manifest V3，仅 content script，无 background）。 */
function manifestJson() {
  return JSON.stringify({
    manifest_version: 3,
    name: 'Tongji AIGC Login Relay (temporary)',
    version: '0.0.1',
    description: 'Temporary relay that returns the Tongji AIGC session token to local DSH. Auto-removed after use.',
    permissions: ['storage'],
    content_scripts: [
      { matches: ['https://*.tongji.edu.cn/*'], js: ['content.js'], run_at: 'document_idle' },
    ],
  }, null, 2)
}

/**
 * 把临时扩展写到系统临时目录，返回扩展目录路径。
 * @param {string} relayUrl 回传端点（不含 query），例如 http://localhost:16554/api/tongji-aigc/relay
 */
export function writeTempExtension(relayUrl) {
  const extDir = mkdtempSync(join(tmpdir(), 'dsh-tongji-ext-'))
  writeFileSync(join(extDir, 'manifest.json'), manifestJson(), 'utf8')
  writeFileSync(join(extDir, 'content.js'), contentJs(relayUrl), 'utf8')
  return extDir
}

/** 关闭之前的残留登录窗口并清理其临时目录（同一次会话重启时调用）。 */
function cleanupOldLogin() {
  const st = loginState
  loginState = null
  saveState(null)
  if (st && st.pid) {
    try { process.kill(st.pid) } catch { /* 已退出 */ }
  }
  if (st && st.extDir) rmSync(st.extDir, { recursive: true, force: true })
  if (st && st.userDataDir) rmSync(st.userDataDir, { recursive: true, force: true })
}

/**
 * 关闭当前登录窗口并删除临时扩展 / 配置目录（关窗即卸载）。
 * 幂等：没有活动会话时直接返回。
 */
export function cleanupLogin() {
  const st = loginState
  if (!st) return
  loginState = null
  saveState(null)
  if (st.pid) {
    try { process.kill(st.pid) } catch { /* 已退出 */ }
  }
  if (st.extDir) rmSync(st.extDir, { recursive: true, force: true })
  if (st.userDataDir) rmSync(st.userDataDir, { recursive: true, force: true })
}

/**
 * 确保本机有可用浏览器；没有则抛 no_browser（快速降级，不白打上游）。
 */
export async function ensureLoginEnv() {
  const exe = findChromium()
  if (!exe) {
    throw new AutoLoginError('no_browser', '未找到可用的浏览器（Edge / Chrome），无法自动登录。请安装 Edge 或 Chrome 后重试。')
  }
  return exe
}

/**
 * 打开隔离的一次性登录窗口并加载临时扩展。
 * @param {string} authUrl  IAM 授权地址（由 /auth/sso/discover 返回）
 * @param {string} relayUrl 令牌回传端点（含本机 DSH 源与端口）
 */
export async function startLogin(authUrl, relayUrl) {
  const exe = await ensureLoginEnv()

  // 先清理上一次可能残留的窗口 / 临时目录
  cleanupOldLogin()

  const extDir = writeTempExtension(relayUrl)
  const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-tongji-login-'))

  let child
  try {
    child = spawn(
      exe,
      [
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${userDataDir}`,
        `--load-extension=${extDir}`,
        String(authUrl),
      ],
      { detached: false, stdio: 'ignore', windowsHide: false },
    )
  } catch (error) {
    rmSync(extDir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
    throw new AutoLoginError('no_browser', `无法启动登录浏览器窗口：${String(error?.message || error)}`)
  }

  // 启动失败（例如可执行文件实际无法运行）时记录并清理。
  child.on('error', () => {
    if (loginState && loginState.pid === child.pid) cleanupLogin()
  })

  loginState = {
    exe,
    extDir,
    userDataDir,
    pid: child.pid,
    startedAt: Date.now(),
    relayUrl,
  }
  saveState(loginState)

  // 兜底：最长存活 LOGIN_MAX_AGE_MS，到点清理（避免极长时间未关窗残留临时目录）。
  const pid = child.pid
  setTimeout(() => {
    if (loginState && loginState.pid === pid) cleanupLogin()
  }, LOGIN_MAX_AGE_MS).unref?.()

  return loginState
}

/**
 * 读回登录态：令牌已由临时扩展回传并落盘，这里直接从磁盘读回并校验。
 * @returns {Promise<string>} 令牌
 * @throws {AutoLoginError} code 区分「尚未登录好」与「环境缺失」
 */
export async function readLoginToken() {
  if (!loginState) {
    throw new AutoLoginError('no_login_tab', '请先点击「统一身份认证登录」')
  }
  const token = readToken()
  if (typeof token !== 'string' || token.trim() === '') {
    throw new AutoLoginError('not_logged_in', '尚未完成同济统一身份认证')
  }
  return token.trim()
}
