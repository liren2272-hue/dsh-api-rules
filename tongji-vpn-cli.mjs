#!/usr/bin/env node
// 同济 VPN 拨号命令行入口（插件内正式版）。
//
//   node tongji-vpn-cli.mjs status      看当前状态（是否在内网 / 配置是否齐）
//   node tongji-vpn-cli.mjs connect     拨号（会弹一次 UAC，需要 tongji-vpn.env 里有密码）
//   node tongji-vpn-cli.mjs disconnect  断开
//   node tongji-vpn-cli.mjs check       只做连通性检查，不拨号
//
// 密码从同目录的 tongji-vpn.env 读，不进 argv、不落第二份文件。
// API key 从 ~/.dsh/.credentials.yaml 的 TONGJI_API_KEY 读，只用于 probeIntranet 判定。

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TongjiVpn,
  findOpenconnect,
  probeIntranet,
  probeTunnel,
  readConfig,
} from './lib/tongji-vpn.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(here, 'tongji-vpn.env');

function readApiKey() {
  const credentialsPath = join(process.env.USERPROFILE ?? '', '.dsh', '.credentials.yaml');
  if (!existsSync(credentialsPath)) return undefined;
  try {
    const text = readFileSync(credentialsPath, 'utf8');
    return text.match(/TONGJI_API_KEY:\s*(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

function report(lines) {
  for (const line of lines) process.stdout.write(line + '\n');
}

async function main() {
  const command = (process.argv[2] ?? 'status').toLowerCase();
  const config = readConfig(CONFIG_PATH);
  const executable = findOpenconnect();
  const apiKey = readApiKey();

  if (command === 'status' || command === 'check') {
    const tunnel = await probeTunnel({ timeoutMs: 3000 });
    const intranet = await probeIntranet({ apiKey, timeoutMs: 8000 });
    const verdict = tunnel.ok
      ? '已在内网（无需拨号）'
      : intranet.reason === 'key_invalid'
        ? '链路可达，但 API key 有问题'
        : '不在内网';
    report([
      'configPath        ' + CONFIG_PATH,
      'configExists      ' + existsSync(CONFIG_PATH),
      'username          ' + (config.username ?? '(未填)'),
      'passwordFilled    ' + (typeof config.password === 'string' && config.password.length > 0),
      'openconnect       ' + (executable ?? '(未安装)'),
      'tunnelReachable   ' + JSON.stringify(tunnel),
      'intranet          ' + JSON.stringify(intranet),
      'verdict           ' + verdict,
    ]);
    return;
  }

  if (command === 'connect') {
    const vpn = new TongjiVpn({
      ...config,
      executable,
      configPath: CONFIG_PATH,
      apiKey,
      readyTimeoutMs: 90_000,
      logger: {
        info: (msg) => process.stdout.write('[vpn] ' + msg + '\n'),
        warn: (msg) => process.stderr.write('[vpn] ' + msg + '\n'),
        error: (msg) => process.stderr.write('[vpn] ' + msg + '\n'),
      },
    });
    const result = await vpn.ensureUp();
    report([JSON.stringify(result, null, 2)]);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'disconnect') {
    const vpn = new TongjiVpn({ ...config, executable, configPath: CONFIG_PATH });
    const result = await vpn.stop('manual');
    report([JSON.stringify(result ?? { ok: true }, null, 2)]);
    return;
  }

  process.stderr.write('未知命令：' + command + '\n');
  process.stderr.write('可用：status | connect | disconnect | check\n');
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write('失败：' + (error?.message ?? String(error)) + '\n');
  process.exitCode = 1;
});
