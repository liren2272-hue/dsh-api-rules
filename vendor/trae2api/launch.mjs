// trae2api（XCool-603/trae2api，Go 实现的 Trae CN 桥）启动器。
//
// 被本插件 lib/launcher.mjs 的 launch 段以
//   spawn(node.exe, ['launch.mjs', '--listen', '127.0.0.1:7870'], { cwd: <本目录>, ... })
// 拉起。职责只有两件事：
//   1) 首次运行时现场 `go build` 出 trae2api.exe（本目录只内嵌 Go 源码，不提交 exe，
//      见 .gitignore）。这个项目 go.mod 零第三方依赖（README: CI 里出现 require 就报错），
//      GOPROXY=off 也能编，无需联网拉包。
//   2) 拉起 trae2api.exe 并把 stdout/stderr 透传、SIGTERM/SIGINT 透传给子进程，
//      使 lib/launcher.mjs 的 killOnStop 能干净地关掉桥。
//
// 端口/数据目录由 cordis.patch.yml 的 launch.args 决定：-listen 覆盖 config.json 的 listen，
// -config / -data-dir 用绝对路径钉进本目录，避免依赖 process.cwd()（保持自包含）。
// Go 工具链绝对路径：DSH 自带 go-toolchain 路径无空格、已验证；winget 装的在 C:\Program Files\Go（带空格）作兜底。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'trae2api.exe');
const GO_CANDIDATES = [
  process.env.DSH_GO_BIN || 'C:/Program Files/Go/bin/go.exe', // DSH 自带 go-toolchain 可经 DSH_GO_BIN 覆盖；默认走 winget 安装路径
];

function findGo() {
  if (process.env.TRAE2API_GO) return process.env.TRAE2API_GO;
  for (const p of GO_CANDIDATES) if (existsSync(p)) return p;
  return 'go'; // 最后靠 PATH
}

if (!existsSync(EXE)) {
  const go = findGo();
  console.log(`[trae2api-launcher] trae2api.exe 不存在，用 ${go} 现场编译（零依赖，GOPROXY=off 即可）…`);
  const t0 = Date.now();
  const b = spawnSync(go, ['build', '-o', EXE, './cmd/trae2api'], { cwd: HERE, stdio: 'inherit' });
  if (b.error) { console.error(`[trae2api-launcher] go 启动失败: ${b.error.message}`); process.exit(1); }
  if (b.status !== 0) { console.error(`[trae2api-launcher] go build 失败 exit=${b.status}`); process.exit(b.status ?? 1); }
  console.log(`[trae2api-launcher] 编译完成 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// 数据目录收进本目录 data/（cordis.patch.yml 也可用 -data-dir 覆盖）。
mkdirSync(join(HERE, 'data'), { recursive: true });

const args = process.argv.slice(2);
const child = spawn(EXE, args, { cwd: HERE, stdio: 'inherit', env: process.env });
child.on('error', (e) => { console.error(`[trae2api-launcher] 桥进程启动失败: ${e.message}`); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { try { child.kill(sig); } catch {} process.exit(0); });
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));