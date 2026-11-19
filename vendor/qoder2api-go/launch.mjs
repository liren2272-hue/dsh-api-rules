// qoder2api-go（EchoPing07/Qoder-2API-Go，Go 实现的 Qoder 桥）启动器。
//
// 被本插件 lib/launcher.mjs 的 launch 段以
//   spawn(node.exe, ['launch.mjs'], { cwd: <本目录>, ... })
// 拉起。职责：
//   1) 首次运行时现场 `go build -mod=vendor` 出 qoder2api.exe（本目录内嵌 Go 源码 + vendor/，
//      不提交 exe；-mod=vendor 使 uuid 依赖也从本目录 vendor/ 取，零 modcache/网络依赖）；
//   2) 首次运行时播种 data/data.json：写入固定 API key（与 cordis.patch.yml 的 route.apiKey
//      一致，DSH 代理的 Bearer 直接对上）+ 管理密码；PAT 留空由用户在 /admin 面板添加；
//   3) 拉起 qoder2api.exe 并透传 stdout/stderr 与 SIGTERM/SIGINT/SIGHUP，
//      使 lib/launcher.mjs 的 killOnStop 能干净关掉桥。
//
// 端口/数据路径由 cordis.patch.yml 的 launch.args(-listen)+launch.env(QODER_DATA_PATH) 决定，
// 数据收进本目录 data/，保持自包含、不写用户家目录。
// Go 工具链：本机 winget Go 在 `C:\Program Files\Go`（带空格，DSH node spawn 曾返回 status:null），
// DSH 自带 go-toolchain 路径无空格、已验证 spawn exit 0，故优先用后者。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'qoder2api.exe');
const DATA_DIR = join(HERE, 'data');
const DATA_FILE = join(DATA_DIR, 'data.json');
const FIXED_API_KEY = process.env.QODER_SEED_API_KEY || 'sk-qoder-local';
const ADMIN_PASSWORD = process.env.QODER_ADMIN_PASSWORD || 'password';
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
  console.log(`[qoder2api-go-launcher] qoder2api.exe 不存在，用 ${go} 现场编译(-mod=vendor)…`);
  const t0 = Date.now();
  const b = spawnSync(go, ['build', '-mod=vendor', '-o', EXE, '.'], { cwd: HERE, stdio: 'inherit' });
  if (b.error) { console.error(`[qoder2api-go-launcher] go 启动失败: ${b.error.message}`); process.exit(1); }
  if (b.status !== 0) { console.error(`[qoder2api-go-launcher] go build 失败 exit=${b.status}`); process.exit(b.status ?? 1); }
  console.log(`[qoder2api-go-launcher] 编译完成 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// 数据目录收进本目录 data/（cordis.patch.yml 也可用 QODER_DATA_PATH 覆盖到别处）。
mkdirSync(DATA_DIR, { recursive: true });

// 首跑播种：没有 data.json 时写一份最小配置，含固定 API key，使 DSH 路由 Bearer 直接对上。
// PAT 留空 —— 用户首启后到 /admin 面板（密码见 QODER_ADMIN_PASSWORD）添加 Qoder PAT 才能真正出话。
if (!existsSync(DATA_FILE)) {
  const seed = {
    host: '127.0.0.1',
    port: 10081,
    pat: '',
    password: ADMIN_PASSWORD,
    api_keys: [{ id: 'seed-local', key: FIXED_API_KEY, note: 'seeded by launch.mjs', created_at: Math.floor(Date.now() / 1000) }],
    chat_timeout_seconds: 120,
    idle_timeout_seconds: 300,
    log_retention_days: 90,
    log_max_entries: 2000,
  };
  writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), 'utf8');
  console.log(`[qoder2api-go-launcher] 已播种 ${DATA_FILE}（固定 key ${FIXED_API_KEY}；PAT 待面板添加）`);
} else {
  // 已有 data.json：确保固定 key 在（幂等，防用户在面板删掉后 DSH 侧失联）。
  try {
    const cfg = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    cfg.api_keys = Array.isArray(cfg.api_keys) ? cfg.api_keys : [];
    if (!cfg.api_keys.some((k) => k && k.key === FIXED_API_KEY)) {
      cfg.api_keys.push({ id: 'seed-local', key: FIXED_API_KEY, note: 'seeded by launch.mjs', created_at: Math.floor(Date.now() / 1000) });
      writeFileSync(DATA_FILE, JSON.stringify(cfg, null, 2), 'utf8');
      console.log(`[qoder2api-go-launcher] 已把固定 key ${FIXED_API_KEY} 补回 data.json`);
    }
  } catch (e) {
    console.error(`[qoder2api-go-launcher] 读取 data.json 失败（不阻塞启动）: ${e.message}`);
  }
}

const args = process.argv.slice(2);
const child = spawn(EXE, args, { cwd: HERE, stdio: 'inherit', env: process.env });
child.on('error', (e) => { console.error(`[qoder2api-go-launcher] 桥进程启动失败: ${e.message}`); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { try { child.kill(sig); } catch {} process.exit(0); });
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
