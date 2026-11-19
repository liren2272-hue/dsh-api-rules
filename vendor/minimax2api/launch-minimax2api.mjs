// minimax2api 启动器：同时拉起「网关 + 浏览器登录 CDP bridge」。
//
// 背景：浏览器加账号走 POST /admin/api/browser-login，网关把它转发给独立的
//   browser-login CDP bridge（默认 :8766，tools/browser-login-bridge.mjs），由 bridge
//   开真实 Chrome 抓 localStorage._token。此前 cordis.patch.yml 的 launch 只起了网关 exe，
//   bridge 从不随路由启动 → 每次重启后「浏览器登录」必然失效（报“服务未配置/不可用”）。
//   本 launcher 让两者绑定：随 DSH 路由一起起、killOnStop 一起停。
//
// 被 lib/launcher.mjs 以 spawn(node.exe, ['launch-minimax2api.mjs', ...args]) 拉起。
// 职责：
//   1) 起浏览器登录 CDP bridge（tools/browser-login-bridge.mjs，端口 BRIDGE_PORT 或 8766）；
//   2) 起网关本体 minimax2api.exe（透传 argv）；
//   3) 透传 stdout/stderr，SIGTERM/SIGINT/SIGHUP 时两个子进程一起收，使 killOnStop 干净退出。
//
// Chrome 路径：bridge 会自动探测 Windows 常见安装位置（本机已验证命中
//   C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe）；如需指定，设 CHROME_BIN。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATEWAY_EXE = join(HERE, 'minimax2api.exe');
const BRIDGE_SCRIPT = join(HERE, 'tools', 'browser-login-bridge.mjs');
const NODE = process.execPath; // DSH 拉起本脚本用的 node，直接复用
const GO_SRC = join(HERE, 'backend', 'cmd', 'minimax2api'); // 后端源码包

// 编译期才用到的：DSH go 工具链（无空格路径，避开 Program Files 空格坑）
function findGo() {
  if (process.env.MINIMAX2API_GO && existsSync(process.env.MINIMAX2API_GO)) return process.env.MINIMAX2API_GO;
  const dsh = join(process.env.USERPROFILE || '', '.dsh', 'go-toolchain', 'go', 'bin', 'go.exe');
  if (existsSync(dsh)) return dsh;
  return 'go';
}

// 关键：exe 是预编译的，改了 backend Go 源码不会自动生效。这里在源码比 exe 新
// （或 exe 缺失）时用 go 重新编译，保证源码改动落到运行中的网关。编译失败则回退
// 用现有 exe 启动（有则继续、无则退出）。
function buildIfNeeded() {
  if (!existsSync(GO_SRC)) return;
  const needBuild =
    !existsSync(GATEWAY_EXE) ||
    statSync(GO_SRC).mtimeMs > statSync(GATEWAY_EXE).mtimeMs;
  if (!needBuild) return;
  const go = findGo();
  console.error(`[minimax-launcher] 检测到源码更新，重新编译网关 (go=${go}) …`);
  const r = spawnSync(go, ['build', '-o', GATEWAY_EXE, '.'], {
    cwd: join(HERE, 'backend'),
    stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0' },
  });
  if (r.error) console.error(`[minimax-launcher] 编译进程错误: ${r.error.message}`);
  else if (r.status !== 0) console.error(`[minimax-launcher] 编译失败 (exit=${r.status})，沿用现有 exe`);
  else console.error('[minimax-launcher] 网关编译完成');
}

const BRIDGE_PORT = process.env.BRIDGE_PORT || '8766';

function startChild(cmd, args, label) {
  const child = spawn(cmd, args, { cwd: HERE, stdio: 'inherit', env: process.env });
  child.on('error', (e) => console.error(`[minimax-launcher] ${label} 启动失败: ${e.message}`));
  return child;
}

// 1) 浏览器登录 CDP bridge（幂等：脚本自身监听固定端口，重复起会 EADDRINUSE 退出，无害）
if (!existsSync(BRIDGE_SCRIPT)) {
  console.error(`[minimax-launcher] 找不到 bridge 脚本: ${BRIDGE_SCRIPT}`);
  process.exit(1);
}
const bridge = startChild(NODE, [BRIDGE_SCRIPT, '--port', BRIDGE_PORT], 'browser-login-bridge');

// 2) 网关本体（源码比 exe 新时先重编；透传 launch.args：-addr 127.0.0.1:8080 ...）
buildIfNeeded();
if (!existsSync(GATEWAY_EXE)) {
  console.error(`[minimax-launcher] 找不到网关: ${GATEWAY_EXE}（先跑 start-minimax2api.bat --rebuild 构建）`);
  process.exit(1);
}
const gateway = startChild(GATEWAY_EXE, process.argv.slice(2), 'gateway');

// 3) 信号透传：任一子进程退出即整体退出；收到终止信号把两个子进程一起收
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  for (const c of [gateway, bridge]) {
    try { c.kill(signal); } catch {}
  }
  process.exit(0);
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => shutdown(sig));
gateway.on('exit', (code, signal) => {
  if (!stopping) { stopping = true; try { bridge.kill(); } catch {} }
  process.exit(code ?? (signal ? 1 : 0));
});
bridge.on('exit', () => {
  // bridge 意外退出不影响网关主服务，只记录；浏览器登录会失效但 chat 仍可用
  if (!stopping) console.error('[minimax-launcher] browser-login-bridge 已退出（浏览器加账号将不可用，chat 不受影响）');
});
