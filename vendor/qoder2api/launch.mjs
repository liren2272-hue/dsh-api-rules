// qoder2api（Zhengyuuuui/qoder2api，Go 实现的 Qoder 桥）启动器。
//
// 被本插件 lib/launcher.mjs 的 launch 段以
//   spawn(node.exe, ['launch.mjs', '--instance', 'cn'], { cwd: <本目录>, ... })
// 拉起。职责只有两件事：
//   1) 首次运行时现场 `go build` 出 qoder2api.exe（本目录只内嵌 Go 源码，不提交 exe，
//      见 .gitignore —— 代价是新 clone 首次要装 Go 工具链，换来仓库不背 11MB 二进制）；
//   2) 拉起 qoder2api.exe 并把 stdout/stderr 透传、SIGTERM/SIGINT 透传给子进程，
//      使 lib/launcher.mjs 的 killOnStop 能干净地关掉桥。
//
// 端口/数据目录由 cordis.patch.yml 的 launch.args + launch.env 决定（--bridge-port 8963
// / --web-port 3588 / QODER2API_HOME 指到本目录下 data/，保持自包含、不写用户家目录）。
// Go 工具链绝对路径：本机 winget 装的 Go 在 `C:\Program Files\Go`（带空格，DSH node spawn
// 它曾返回 status:null），而 DSH 自带的 go-toolchain 路径无空格、已验证 spawn exit 0，故用后者。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'qoder2api.exe');
const GO_CANDIDATES = [
  process.env.DSH_GO_BIN || 'C:/Program Files/Go/bin/go.exe', // DSH 自带 go-toolchain 可经 DSH_GO_BIN 覆盖；默认走 winget 安装路径
];

function findGo() {
  if (process.env.QODER2API_GO) return process.env.QODER2API_GO;
  for (const p of GO_CANDIDATES) if (existsSync(p)) return p;
  return 'go'; // 最后靠 PATH
}

if (!existsSync(EXE)) {
  const go = findGo();
  console.log(`[qoder2api-launcher] qoder2api.exe 不存在，用 ${go} 现场编译…`);
  const t0 = Date.now();
  const b = spawnSync(go, ['build', '-o', EXE, '.'], { cwd: HERE, stdio: 'inherit' });
  if (b.error) { console.error(`[qoder2api-launcher] go 启动失败: ${b.error.message}`); process.exit(1); }
  if (b.status !== 0) { console.error(`[qoder2api-launcher] go build 失败 exit=${b.status}`); process.exit(b.status ?? 1); }
  console.log(`[qoder2api-launcher] 编译完成 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// 数据目录默认收进本目录 data/（cordis.patch.yml 也可用 QODER2API_HOME 覆盖）。
mkdirSync(join(HERE, 'data'), { recursive: true });

const args = process.argv.slice(2);
const child = spawn(EXE, args, { cwd: HERE, stdio: 'inherit', env: process.env });
child.on('error', (e) => { console.error(`[qoder2api-launcher] 桥进程启动失败: ${e.message}`); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { try { child.kill(sig); } catch {} process.exit(0); });
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));