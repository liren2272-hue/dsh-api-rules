/**
 * 用一个假的 ctx 装配插件，验证「apply 能被调用、服务被 provide、代理真的起来」。
 *
 * 真 Host 里的 Cordis 上下文无法在这里复现，所以只验证插件自己那一侧：
 * apply 不抛错、apiRules 服务有预期方法、effect 里的代理监听成功。
 */

import { apply, name, inject } from '../lib/index.mjs'

const logs = []
const effects = []
const provided = new Map()

const ctx = {
  logger: {
    info: (m) => logs.push('info ' + m),
    warn: (m) => logs.push('warn ' + m),
    error: (m) => logs.push('error ' + m),
    debug: () => {},
  },
  provide: (serviceName, value) => provided.set(serviceName, value),
  get: () => undefined,
  effect: (fn) => {
    const dispose = fn()
    effects.push(dispose)
    return dispose
  },
}

apply(ctx, {
  port: 0,
  autoLaunch: false,
  routes: [
    {
      id: 'codearts',
      default: true,
      upstream: 'http://127.0.0.1:8787/v1',
      rules: ['codearts'],
      concurrency: 3,
      models: [{ id: 'GLM-5.2', maxTokens: 65_536 }],
    },
  ],
})

let failures = 0
const check = (label, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok || detail === undefined ? '' : '  → ' + detail))
  if (!ok) failures += 1
}

check('导出 name', name === 'dsh-api-rules')
check('inject 为空数组（不阻塞装载）', Array.isArray(inject) && inject.length === 0)
check('提供了 apiRules 服务', provided.has('apiRules'))

const service = provided.get('apiRules')
check('服务有 register', typeof service.register === 'function')
check('服务有 list', Array.isArray(service.list()))
check('服务注册了 codearts 与 generic', ['codearts', 'generic'].every((n) => service.list().includes(n)))
check('effect 被登记', effects.length === 1, String(effects.length))

// 代理是异步起来的：轮询到有 origin 为止。
const deadline = Date.now() + 3000
while (service.origin() === undefined && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
const origin = service.origin()
check('代理已监听', typeof origin === 'string' && origin.startsWith('http://127.0.0.1:'), String(origin))
check('路由列表正确', JSON.stringify(service.routes()) === '["codearts"]', JSON.stringify(service.routes()))

if (origin !== undefined) {
  const health = await fetch(origin + '/health')
  const body = await health.json()
  check('/health 可用', health.status === 200 && body.ok === true, JSON.stringify(body))
  check('/health 报告规则包', JSON.stringify(body.packs) === '["codearts","generic"]', JSON.stringify(body.packs))
}

for (const dispose of effects) await dispose?.()
console.log('')
console.log(failures === 0 ? 'all checks passed' : failures + ' failed')
process.exitCode = failures === 0 ? 0 : 1
