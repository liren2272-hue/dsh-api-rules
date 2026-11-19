// 同济 Array AG VPN 拨号器（方案 C：插件内置 openconnect --protocol=array）
//
// ══ 每条设计决策的证据来源 ═══════════════════════════════════════════════
//
//  1. **必须提权**：openconnect 的 wintun.c → `WintunCreateAdapter` 失败返回
//     `ERROR_ACCESS_DENIED`，源码把它映射成 `-EPERM`。建 TUN 网卡没有第二条路。
//     本机实测：DSH 会话非管理员，但 `Start-Process -Verb RunAs` 能正常触发
//     系统 UAC（已用它装完 openconnect，exit=0）。需 Administrators 组用户运行。
//
//  2. **stdin 字段顺序 = 密码在前、authgroup 在后**（这是本模块最容易踩的坑）：
//     `--passwd-on-stdin` 会让 openconnect 先读第一行当密码，随后 authgroup
//     提示再读第二行。实测对照：
//       输入 "default_method_localdb\ndummypass"（顺序反）
//         → POST body `method=dummypass&uname=...&pwd=default_method_localdb`
//         → HTTP 400 「内部错误 - 无法处理请求」
//       输入 "dummypass\ndefault_method_localdb"（正确）
//         → POST body `method=default_method_localdb&uname=...&pwd=dummypass`
//         → HTTP 301 + `Set-Cookie: _AN_msgID=215`（215 = 凭据错误，协议本身通了）
//
//  3. **密码不落盘、不进 argv**：argv 在进程列表里对全机可见，绝不能放密码。
//     密码只从 `src/tongji-vpn.env`（用户手填的那一份）读取；提权脚本自己去读
//     同一个文件——**不复制、不编码、不产生第二份含密码的文件**。
//
//  4. **就绪判据是网络，不是进程**：轮询 `agi.tongji.edu.cn/v1/models`，直到
//     403「当前网络环境不支持」消失。openconnect 进程活着 ≠ 路由/DNS 已生效。
//
//  5. **停止只杀 openconnect**：`taskkill /IM openconnect.exe /F`，不动别的进程。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { lookup } from 'node:dns/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_GATEWAY = 'vpn.tongji.cn';
export const DEFAULT_PROBE_URL = 'https://agi.tongji.edu.cn/v1/models';
export const DEFAULT_AUTHGROUP = 'default_method_localdb';
export const OPENCONNECT_CANDIDATES = [
  'C:/Program Files/OpenConnect/openconnect.exe',
  'C:/Program Files (x86)/OpenConnect/openconnect.exe',
];

// 分流包装脚本（纯 ASCII，JScript/ECMAScript 3.0）。
//
// 依据：libopenconnect-5.dll 内置字符串里有 `cscript.exe /e:JScript` 与
// `cscript.exe`，说明 openconnect 发现 --script 指向 .js 时会用 cscript 执行它；
// 同一处还有 `Script did not complete within 10 seconds.`，所以脚本必须快
// （我们只做 env 改写 + 一次 netsh/route，不做事）。
//
// 为什么需要它：同济 AG 网关不推 CISCO_SPLIT_INC，官方脚本于是走「带网关的
// set address」，系统自动生成 0.0.0.0/0 默认路由并接管 DNS —— 全机流量都走
// 校园网。包装脚本通过改写进程环境变量把官方脚本导向它本来就支持的
// split-include 分支，从而只加 10.67.0.0/16 一条路由、不设 DNS。
export const SPLIT_SCRIPT_PATH = fileURLToPath(new URL('./vpnc-script-split.js', import.meta.url));

// 215 = 网关返回的「用户名或密码错误」错误码，用于把 UAC/网络问题与凭据问题分开。
export const AN_MSGID_BAD_CREDENTIAL = '215';

export function findOpenconnect(explicit) {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return existsSync(explicit) ? explicit : undefined;
  }
  for (const candidate of OPENCONNECT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// 解析 INI 风格配置（`key=value`，# 或 ; 开头为注释）。
export function parseEnvText(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (key.length > 0) out[key] = value;
  }
  return out;
}

// 读配置：**文件优先**，环境变量兜底。
// 为什么文件优先：提权后的 PowerShell 进程不保证继承调用方的环境变量
// （Start-Process -Verb RunAs 跨完整性级别时环境可能不传），而提权脚本必须
// 自己拿到密码。所以密码的唯一可靠来源就是这份文件。
export function readConfig(filePath) {
  const fromEnv = {
    username: process.env.TONGJI_VPN_USER?.trim(),
    password: process.env.TONGJI_VPN_PASSWORD,
    authgroup: process.env.TONGJI_VPN_AUTHGROUP?.trim(),
    gateway: process.env.TONGJI_VPN_GATEWAY?.trim(),
  };
  let fromFile = {};
  if (typeof filePath === 'string' && existsSync(filePath)) {
    try {
      fromFile = parseEnvText(readFileSync(filePath, 'utf8'));
    } catch {
      fromFile = {};
    }
  }
  const pick = (key) => {
    const f = fromFile[key];
    if (typeof f === 'string' && f.length > 0) return f;
    const e = fromEnv[key];
    if (typeof e === 'string' && e.length > 0) return e;
    return undefined;
  };
  return {
    username: pick('username'),
    password: pick('password'),
    authgroup: pick('authgroup') ?? DEFAULT_AUTHGROUP,
    gateway: pick('gateway') ?? DEFAULT_GATEWAY,
  };
}

// 隧道就绪的**决定性**判据：能否 TCP 连上同济内网的 agi 地址。
// 外网实测 `10.67.0.251:443` 连不通（只有公网地址 202.120.188.251 通），
// 所以这条 TCP 探测成功 = 隧道真的把内网路由接过来了。
// 它比「HTTP 探测」更硬：不受 key 是否有效影响。
// 网关 IP 落盘：DSH 重启会丢掉内存里的 gatewayIp，而隧道可能还连着
// （DNS 仍被内网接管、网关域名依旧解析不到），下次拨号就会死在解析上。
// 落盘格式是一行 IPv4；读取时严格校验字面量，脏数据一律不采纳——
// 这个值最终会进 openconnect 的命令行，不能容忍任何注入。
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function readGatewayIp(workDir) {
  try {
    const text = readFileSync(join(workDir, 'gateway-ip.txt'), 'utf8').trim();
    return IPV4_RE.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

export function writeGatewayIp(workDir, ip) {
  if (typeof ip !== 'string' || !IPV4_RE.test(ip)) return undefined;
  try {
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'gateway-ip.txt'), ip + '\n', 'utf8');
    return ip;
  } catch {
    return undefined;
  }
}

export function probeTunnel({ hosts = ['10.67.0.251', '10.67.0.252'], port = 443, timeoutMs = 4000 } = {}) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let remaining = hosts.length;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    for (const host of hosts) {
      const socket = connect({ host, port });
      const done = (ok, reason) => {
        socket.destroy();
        remaining -= 1;
        if (ok) finish({ ok: true, host });
        else if (remaining <= 0) finish({ ok: false, reason: reason ?? 'unreachable' });
      };
      socket.setTimeout(timeoutMs, () => done(false, 'timeout'));
      socket.once('connect', () => done(true));
      socket.once('error', (error) => done(false, String(error?.code ?? error)));
    }
    if (hosts.length === 0) finish({ ok: false, reason: 'no_hosts' });
  });
}

// 探测是否处于「同济内网可访问」状态。
// 判据：403 + 「当前网络环境不支持」= 不在内网；其余任何响应都说明链路通了。
export async function probeIntranet({ url = DEFAULT_PROBE_URL, apiKey, timeoutMs = 8000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    headers.Authorization = 'Bearer ' + apiKey;
  }
  let response;
  try {
    response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { ok: false, reason: 'unreachable', text: String(error?.message ?? error) };
  }
  if (response.ok) {
    await response.text().catch(() => '');
    return { ok: true, status: response.status };
  }
  let text = '';
  try {
    text = (await response.text()).slice(0, 400);
  } catch {}
  // 三种 403 必须分开：只有「当前网络环境不支持」才说明不在内网。
  // 「API密钥不存在 / 不能为空」是 key 的问题——链路已经通了，不能当成网络不通，
  // 更不能当成「隧道建好了」。
  const blocked = response.status === 403 && /当前网络环境不支持|网络环境不支持/.test(text);
  const keyIssue = response.status === 403 && /API密钥不存在|密钥不存在|API密钥不能为空|密钥不能为空/.test(text);
  return {
    ok: false,
    reason: blocked ? 'network_blocked' : keyIssue ? 'key_invalid' : 'http_' + response.status,
    status: response.status,
    text,
  };
}

export class TongjiVpn {
  constructor(options = {}) {
    this.gateway = options.gateway ?? DEFAULT_GATEWAY;
    // 网关域名解析：隧道建起来之后，网关自己的域名会被内网 DNS 覆盖成不存在的名字
    // （实测：隧道在线时 getaddrinfo('vpn.tongji.cn') 直接失败），
    // 所以重连时必须用之前学到的 IP 直连，否则会死在 DNS 上。
    this.gatewayIp = options.gatewayIp;
    this.username = options.username;
    this.authgroup = options.authgroup ?? DEFAULT_AUTHGROUP;
    this.password = options.password;
    this.executable = options.executable ?? findOpenconnect();
    this.probeUrl = options.probeUrl ?? DEFAULT_PROBE_URL;
    this.apiKey = options.apiKey;
    this.configPath = options.configPath;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 90_000;
    // 可覆盖的探测目标，只为可测性：测试里指到必然连不通的地址，
    // 才不会因为『本机恰好已经连着隧道』而短路掉被测逻辑。
    this.probeHosts = options.probeHosts;
    this.probePort = options.probePort;
    this.logger = options.logger ?? console;
    this.workDir = options.workDir ?? join(process.env.TEMP ?? '.', 'tongji-vpn');
    this.state = 'down';
    this.lastError = undefined;
    this.logTail = [];
    this.startedAt = 0;
  }

  status() {
    return {
      state: this.state,
      startedAt: this.startedAt,
      lastError: this.lastError,
      logFile: join(this.workDir, 'openconnect.log'),
      logTail: this.logTail.slice(-15),
    };
  }

  #loadGatewayIp() {
    if (this.gatewayIp) return this.gatewayIp;
    const cached = readGatewayIp(this.workDir);
    if (cached !== undefined) this.gatewayIp = cached;
    return cached;
  }

  #saveGatewayIp(ip) {
    if (writeGatewayIp(this.workDir, ip) !== undefined) this.gatewayIp = ip;
  }

  #record(line) {
    const text = String(line).trim();
    if (text.length === 0) return;
    this.logTail.push(text);
    if (this.logTail.length > 400) this.logTail.shift();
  }

  // 前置条件检查：缺什么就明确说缺什么，不让调用方去猜。
  preflight() {
    const problems = [];
    // 用 findOpenconnect 复核：构造函数里传进来的路径可能并不存在
    if (findOpenconnect(this.executable) === undefined) problems.push('openconnect_missing');
    if (typeof this.username !== 'string' || this.username.length === 0) {
      problems.push('missing_username');
    }
    if (typeof this.password !== 'string' || this.password.length === 0) {
      problems.push('missing_password');
    }
    return { ok: problems.length === 0, problems };
  }

  async ensureUp() {
    // 先看隧道是不是本来就在（可能是上一次拨的、也可能是 MotionPro 连的）。
    // 不先探就拨，会在同一台机器上起第二个 openconnect，两条隧道抢同一组路由。
    const existing = await probeTunnel({
      hosts: this.probeHosts,
      port: this.probePort,
      timeoutMs: 4000,
    });
    if (existing.ok) {
      this.state = 'up';
      return { ok: true, state: 'up', via: existing.host, reused: true };
    }

    if (this.state === 'up') {
      const probe = await probeIntranet({ url: this.probeUrl, apiKey: this.apiKey });
      if (probe.ok) return { ok: true, state: 'up' };
      this.logger.warn?.('[tongji-vpn] 隧道标记为 up 但探测失败，重建');
      await this.stop('probe failed');
    }

    const pre = this.preflight();
    if (!pre.ok) {
      this.state = 'failed';
      this.lastError = pre.problems.join(',');
      return { ok: false, state: 'failed', reason: this.lastError, problems: pre.problems };
    }

    // 记下网关的 IP：隧道建好后 DNS 被内网接管，网关域名会解析不到，
    // 下一次拨号必须靠这个 IP 直连（--resolve），否则重连永远失败。
    this.#loadGatewayIp();
    try {
      const list = await lookup(this.gateway, { family: 4, all: true });
      const first = Array.isArray(list) ? list[0] : list;
      if (first && typeof first.address === 'string') this.#saveGatewayIp(first.address);
    } catch {
      // 解析不到：如果以前记过 IP 就用它（--resolve 直连），
      // 否则只能按域名连，让 openconnect 自己报错。
    }

    this.state = 'connecting';
    this.startedAt = Date.now();
    this.lastError = undefined;

    const started = this.#startElevated();
    if (!started.ok) {
      this.state = 'failed';
      this.lastError = started.reason;
      return { ok: false, state: 'failed', reason: started.reason };
    }

    const deadline = Date.now() + this.readyTimeoutMs;
    let lastTunnel;
    while (Date.now() < deadline) {
      await sleep(2500);
      // 判据 1：能不能 TCP 连到内网地址（决定性的，与 key 无关）
      lastTunnel = await probeTunnel({
        hosts: this.probeHosts,
        port: this.probePort,
        timeoutMs: 4000,
      });
      if (lastTunnel.ok) {
        this.state = 'up';
        return { ok: true, state: 'up', via: lastTunnel.host };
      }
      if (this.#badCredential()) {
        this.state = 'failed';
        this.lastError = 'bad_credential';
        await this.stop('bad credential');
        return {
          ok: false,
          state: 'failed',
          reason: 'bad_credential',
          hint: '统一身份认证用户名或密码错误，请改 ' + (this.configPath ?? 'tongji-vpn.env') + ' 的 password= 那一行',
        };
      }
      if (Date.now() - this.startedAt > 15_000 && this.#openconnectRunning() !== true) {
        this.state = 'failed';
        this.lastError = 'openconnect_exited';
        return { ok: false, state: 'failed', reason: 'openconnect_exited', logTail: this.status().logTail };
      }
    }

    this.state = 'failed';
    this.lastError = 'tunnel_not_ready_' + (lastTunnel?.reason ?? 'unknown');
    await this.stop('ready timeout');
    return { ok: false, state: 'failed', reason: this.lastError, logTail: this.status().logTail };
  }

  // 从 openconnect 日志里找网关的凭据错误码（_AN_msgID=215）。
  #badCredential() {
    const logFile = join(this.workDir, 'openconnect.log');
    if (!existsSync(logFile)) return false;
    try {
      const text = readFileSync(logFile, 'utf8');
      return text.includes('_AN_msgID=' + AN_MSGID_BAD_CREDENTIAL);
    } catch {
      return false;
    }
  }

  #openconnectRunning() {
    if (process.platform !== 'win32') return undefined;
    const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq openconnect.exe', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return /openconnect\.exe/i.test(out.stdout ?? '');
  }

  // 提权启动：写一个只做「读配置 → 起 openconnect → 喂 stdin」的 PowerShell 脚本，
  // 用 Start-Process -Verb RunAs 触发系统 UAC。
  // **脚本里不含密码**，它自己去读 configPath，所以不会产生第二份含密码的文件。
  #startElevated() {
    mkdirSync(this.workDir, { recursive: true });
    const logFile = join(this.workDir, 'openconnect.log');
    const ps1 = join(this.workDir, 'start-openconnect.ps1');

    // 注意：authgroup 不通过 --authgroup 传（实测那条路会退回交互提示），
    // 改为与密码一起写进 stdin，顺序必须是「密码在前」。
    const ocArgs = [
      '--protocol=array',
      // 分流：只让 10.67.0.0/16 走隧道、不接管系统 DNS、hosts 钉死 agi。
      // 不传这个参数就会落回官方默认脚本的全局路由。
      ...(existsSync(SPLIT_SCRIPT_PATH) ? ['--script=' + SPLIT_SCRIPT_PATH] : []),
      // 已知网关 IP 时钉死它，绕开「隧道在线 → 网关域名解析不到」的死锁。
      ...(this.gatewayIp ? ['--resolve=' + this.gateway + ':' + this.gatewayIp] : []),
      '--user=' + this.username,
      '--passwd-on-stdin',
      '--non-inter',
      '--timestamp',
      '-v',
      this.gateway,
    ];

    const configPath = resolve(this.configPath ?? join(this.workDir, 'tongji-vpn.env'));
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$cfgPath = ' + ps1Quote(this.configPath ?? configPath),
      '$logFile = ' + ps1Quote(logFile),
      '$cfg = @{}',
      'foreach ($line in Get-Content -LiteralPath $cfgPath -Encoding UTF8) {',
      '  $t = $line.Trim()',
      '  if ($t.Length -eq 0 -or $t.StartsWith("#") -or $t.StartsWith(";")) { continue }',
      '  $i = $t.IndexOf("=")',
      '  if ($i -lt 0) { continue }',
      '  $cfg[$t.Substring(0,$i).Trim().ToLower()] = $t.Substring($i+1).Trim()',
      '}',
      '$pw = $cfg["password"]',
      'if (-not $pw) { Set-Content -LiteralPath $logFile -Value "ERROR: password empty in $cfgPath"; exit 10 }',
      '$group = $cfg["authgroup"]',
      'if (-not $group) { $group = "default_method_localdb" }',
      '$psi = New-Object System.Diagnostics.ProcessStartInfo',
      '$psi.FileName = ' + ps1Quote(this.executable),
      '$psi.Arguments = ' + ps1Quote(ocArgs.map(winQuote).join(' ')),
      '$psi.UseShellExecute = $false',
      '$psi.RedirectStandardInput = $true',
      '$psi.RedirectStandardOutput = $true',
      '$psi.RedirectStandardError = $true',
      '$psi.CreateNoWindow = $true',
      '$psi.WorkingDirectory = ' + ps1Quote(dirname(this.executable)),
      '$proc = [System.Diagnostics.Process]::Start($psi)',
      'try {',
      '  $sw = New-Object System.IO.StreamWriter($proc.StandardInput.BaseStream, (New-Object System.Text.UTF8Encoding($false)))',
      '  $sw.AutoFlush = $true',
      '  $sw.WriteLine($pw)',
      '  $sw.WriteLine($group)',
      '  $sw.Close()',
      '} catch {}',
      '$outTask = $proc.StandardOutput.ReadToEndAsync()',
      '$errTask = $proc.StandardError.ReadToEndAsync()',
      '$proc.WaitForExit()',
      'Set-Content -LiteralPath $logFile -Encoding UTF8 -Value ($outTask.Result + "`n--- stderr ---`n" + $errTask.Result)',
      'exit $proc.ExitCode',
    ].join('\r\n');

    try {
      writeFileSync(ps1, script, 'utf8');
    } catch (error) {
      this.#record('[ps1] ' + String(error?.message ?? error));
      return { ok: false, reason: 'ps1_write_failed' };
    }

    const launcher = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Start-Process -FilePath powershell.exe -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",' +
          ps1Quote(ps1) +
          ') -Verb RunAs -WindowStyle Hidden',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );

    launcher.stderr?.on('data', (buf) => this.#record('[launcher] ' + buf.toString('utf8')));
    launcher.on('error', (error) => this.#record('[launcher] ' + String(error?.message ?? error)));

    // 清掉上一轮日志，避免读到旧的 215 误判
    try {
      writeFileSync(logFile, '');
    } catch {}

    this.#record('[elevate] UAC 已请求，脚本=' + ps1 + ' 日志=' + logFile);
    return { ok: true };
  }

  async stop(reason) {
    this.state = 'down';
    this.#record('[stop] ' + (reason ?? ''));
    if (process.platform !== 'win32') return;
    spawnSync('taskkill', ['/IM', 'openconnect.exe', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

// PowerShell 单引号字符串：内部单引号翻倍。
function ps1Quote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// Windows 命令行参数引用（给 ProcessStartInfo.Arguments 用）。
function winQuote(value) {
  const text = String(value);
  if (text.length > 0 && !/[\s"']/.test(text)) return text;
  return '"' + text.replace(/"/g, '\\"') + '"';
}
