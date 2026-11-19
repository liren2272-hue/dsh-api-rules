// VPN 拨号器离线自测（不连真实网关、不需要 UAC）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_AUTHGROUP,
  DEFAULT_GATEWAY,
  findOpenconnect,
  parseEnvText,
  probeIntranet,
  readConfig,
  TongjiVpn,
} from '../lib/tongji-vpn.mjs';

const workRoot = mkdtempSync(join(tmpdir(), 'tongji-vpn-test-'));

test.after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

test('parseEnvText 忽略注释与空行，保留密码里的等号', () => {
  const parsed = parseEnvText(
    ['# 注释', '', 'username=2630397', '  password = a=b=c  ', '; 另一种注释', 'authgroup=ldap'].join('\r\n'),
  );
  assert.equal(parsed.username, '2630397');
  assert.equal(parsed.password, 'a=b=c');
  assert.equal(parsed.authgroup, 'ldap');
});

test('readConfig：文件优先于环境变量', () => {
  const filePath = join(workRoot, 'a.env');
  writeFileSync(filePath, 'username=fromfile\npassword=filedpw\n', 'utf8');
  const saved = {
    user: process.env.TONGJI_VPN_USER,
    pw: process.env.TONGJI_VPN_PASSWORD,
  };
  process.env.TONGJI_VPN_USER = 'fromenv';
  process.env.TONGJI_VPN_PASSWORD = 'envpw';
  try {
    const cfg = readConfig(filePath);
    // 关键：提权进程拿不到调用方环境变量，密码必须靠文件，所以文件优先
    assert.equal(cfg.username, 'fromfile');
    assert.equal(cfg.password, 'filedpw');
    assert.equal(cfg.authgroup, DEFAULT_AUTHGROUP);
    assert.equal(cfg.gateway, DEFAULT_GATEWAY);
  } finally {
    if (saved.user === undefined) delete process.env.TONGJI_VPN_USER;
    else process.env.TONGJI_VPN_USER = saved.user;
    if (saved.pw === undefined) delete process.env.TONGJI_VPN_PASSWORD;
    else process.env.TONGJI_VPN_PASSWORD = saved.pw;
  }
});

test('readConfig：文件里 password 为空时回落到环境变量', () => {
  const filePath = join(workRoot, 'empty.env');
  writeFileSync(filePath, 'username=2630397\npassword=\n', 'utf8');
  const saved = process.env.TONGJI_VPN_PASSWORD;
  process.env.TONGJI_VPN_PASSWORD = 'envfallback';
  try {
    const cfg = readConfig(filePath);
    assert.equal(cfg.password, 'envfallback');
  } finally {
    if (saved === undefined) delete process.env.TONGJI_VPN_PASSWORD;
    else process.env.TONGJI_VPN_PASSWORD = saved;
  }
});

test('preflight 把缺项说清楚，不吞成泛化错误', () => {
  // 显式给一个不存在的可执行文件路径——构造函数里 `executable: undefined`
  // 会走自动探测（本机装了 openconnect 就会探测到），所以这里不能传 undefined。
  const bare = new TongjiVpn({
    executable: 'C:/definitely/not/here/openconnect.exe',
    username: undefined,
    password: undefined,
  });
  const result = bare.preflight();
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.sort(), ['missing_password', 'missing_username', 'openconnect_missing']);

  // 全部满足时应为 ok。可执行文件必须真的存在——preflight 会用 findOpenconnect
  // 复核路径，随手指一个不存在的路径会被正确地判成 openconnect_missing。
  const realExecutable = findOpenconnect();
  if (realExecutable !== undefined) {
    const ready = new TongjiVpn({ executable: realExecutable, username: 'u', password: 'p' });
    assert.equal(ready.preflight().ok, true);
  }
});

test('ensureUp 在前置条件不足时给出具体 reason，不尝试提权', async () => {
  const vpn = new TongjiVpn({
    executable: 'C:/definitely/not/here/openconnect.exe',
    username: undefined,
    password: undefined,
    // 指到必然连不通的探测目标：否则本机若已连着隧道，ensureUp 会（正确地）
    // 走「复用现有隧道」分支直接返回 ok，就测不到前置条件检查了。
    // 用 127.0.0.1 上的冷端口（Windows 上连 192.0.2.1 都可能被隧道兜住）。
    probeHosts: ['127.0.0.1'],
    probePort: 1,
  });
  const result = await vpn.ensureUp();
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.match(result.reason, /missing_/);
});

test('probeIntranet 能把 key 错误与网络不通分开', async () => {
  // 本地起一个假服务器，模拟三种 403 形状
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    if (auth.includes('blocked')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 403, message: '当前网络环境不支持' } }));
      return;
    }
    if (auth.includes('badkey')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 403, message: 'API密钥不存在' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"data":[]}');
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/v1/models';
  try {
    assert.deepEqual(await probeIntranet({ url, apiKey: 'sk-ok' }), { ok: true, status: 200 });
    const blocked = await probeIntranet({ url, apiKey: 'sk-blocked' });
    assert.equal(blocked.reason, 'network_blocked');
    const bad = await probeIntranet({ url, apiKey: 'sk-badkey' });
    // 关键回归：key 错不能被当成「网络不通」，否则会误报去连 VPN
    assert.equal(bad.reason, 'key_invalid');
    assert.equal(bad.ok, false);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('probeTunnel 对不可达地址返回失败而不是抛异常', async () => {
  const { probeTunnel } = await import('../lib/tongji-vpn.mjs');
  const result = await probeTunnel({ hosts: ['127.0.0.1'], port: 1, timeoutMs: 800 });
  assert.equal(result.ok, false);
  assert.ok(['timeout', 'ECONNREFUSED', 'unreachable'].includes(result.reason) || result.reason.length > 0);
});

test('findOpenconnect 对显式不存在的路径返回 undefined', () => {
  assert.equal(findOpenconnect('C:/definitely/not/here/openconnect.exe'), undefined);
});

// ---------------------------------------------------------------------------
// throttle 钩子：接线是否真的在「请求发出前」把 VPN 处理掉。
//
// 这几个用例都刻意不真的拨号——拨号要 UAC + 真密码，在 CI 上不可行。
// 验的是「该拨 / 不该拨 / 该拦」三种判断，以及任何情况下都不能把请求卡死。
// ---------------------------------------------------------------------------

test('throttle 在 signal 已中止时直接返回，不做任何探测', async () => {
  const { tongjiRules } = await import('../lib/rules/tongji.mjs');
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  const result = await tongjiRules.throttle({ signal: controller.signal });
  // 中止的请求不该还去连 TCP（1.5s 超时），必须是立刻返回
  assert.ok(Date.now() - started < 200, 'aborted 分支应立刻返回');
  assert.equal(result.aborted, true);
});

test('throttle 在凭据不全时记录缺项、不抛异常、不阻塞请求', async () => {
  // 安全护栏：测试绝不能真的拨号（要弹 UAC、要真密码）。
  // 把配置指到一个不存在的路径，readConfig 会退回环境变量兜底 → 全空 → missing_* 分支。
  // 否则等用户填了密码又在校园网外跑测试时，会突然弹一次 UAC。
  const previous = process.env.TONGJI_VPN_CONFIG;
  process.env.TONGJI_VPN_CONFIG = join(tmpdir(), 'tongji-vpn-test-no-such.env');
  try {
    const { tongjiRules, tongjiVpnStatus } = await import('../lib/rules/tongji.mjs');
    const result = await tongjiRules.throttle({ signal: undefined });
    assert.equal(result.waitMs, 0, 'throttle 永远不能返回非 0 等待，否则请求被卡住');
    const status = tongjiVpnStatus();
    assert.equal(status.attempting, false, '拨号结束后 attempting 必须复位');
    assert.equal(status.lastResult?.ok !== true, true, '这个用例里不该拨号成功');
  } finally {
    if (previous === undefined) delete process.env.TONGJI_VPN_CONFIG;
    else process.env.TONGJI_VPN_CONFIG = previous;
  }
});

test('throttle 缺配置时把原因写进 lastResult（供排障接口读）', async () => {
  const previous = process.env.TONGJI_VPN_CONFIG;
  process.env.TONGJI_VPN_CONFIG = join(tmpdir(), 'tongji-vpn-test-no-such-2.env');
  try {
    const { tongjiRules, tongjiVpnStatus } = await import('../lib/rules/tongji.mjs');
    await tongjiRules.throttle({ signal: undefined });
    const status = tongjiVpnStatus();
    // 本机若在校园网内，探测会提前返回、不写 lastResult，此时跳过。
    if (status.lastResult !== undefined) {
      const reason = String(status.lastResult.reason ?? '');
      assert.ok(
        reason.includes('missing_password') || reason.includes('missing_username'),
        '缺项原因应指出缺什么，实际：' + reason,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TONGJI_VPN_CONFIG;
    else process.env.TONGJI_VPN_CONFIG = previous;
  }
});

test('throttle 不是同步钩子：返回 Promise', async () => {
  const { tongjiRules } = await import('../lib/rules/tongji.mjs');
  const maybe = tongjiRules.throttle({ signal: undefined });
  // proxy 里是 await pack.throttle(...)，这里必须真能 await
  assert.equal(typeof maybe.then, 'function', 'throttle 必须是 async');
  await maybe;
});

test('tongjiVpnStatus 暴露 configPath，便于排障时定位文件', async () => {
  const { tongjiVpnStatus } = await import('../lib/rules/tongji.mjs');
  const status = tongjiVpnStatus();
  assert.equal(typeof status.configPath, 'string');
  assert.ok(status.configPath.length > 0);
  assert.ok(status.configPath.endsWith('tongji-vpn.env'));
});

test('网关 IP 落盘后可读回，脏数据不采纳', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readGatewayIp, writeGatewayIp } = await import('../lib/tongji-vpn.mjs');
  const workDir = mkdtempSync(join(tmpdir(), 'tj-vpn-gw-'));

  // 空目录读不到
  assert.equal(readGatewayIp(workDir), undefined);
  // 写→读 往返
  assert.equal(writeGatewayIp(workDir, '202.120.189.34'), '202.120.189.34');
  assert.equal(readGatewayIp(workDir), '202.120.189.34');
  // 非法值不写盘（这个值会进 openconnect 命令行，必须严格校验）
  assert.equal(writeGatewayIp(workDir, 'evil; rm -rf /'), undefined);
  assert.equal(writeGatewayIp(workDir, '1.2.3'), undefined);
  assert.equal(readGatewayIp(workDir), '202.120.189.34', '非法写入不应污染已有值');
});

test('落盘文件被手工改坏时 readGatewayIp 返回 undefined 而不是抛异常', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readGatewayIp } = await import('../lib/tongji-vpn.mjs');
  const workDir = mkdtempSync(join(tmpdir(), 'tj-vpn-gw2-'));
  writeFileSync(join(workDir, 'gateway-ip.txt'), 'not-an-ip\n', 'utf8');
  assert.equal(readGatewayIp(workDir), undefined);
});
