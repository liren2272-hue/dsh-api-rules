// lib/index.mjs 里必须显式 import fileURLToPath：/api/api-rules/tongji-account 的
// env 路径推导（lib/index.mjs:1268 附近）用了它，但历史上只 import 了 pathToFileURL，
// 运行时一保存同济账号就 ReferenceError: fileURLToPath is not defined。
// 这条测试扫源码：任何 fileURLToPath(...) 调用点所在文件顶部必须有对应 import。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

test('lib/index.mjs imports fileURLToPath it uses', () => {
  const source = readFileSync(join(ROOT, 'lib', 'index.mjs'), 'utf8')
  const imports = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]node:url['"]/gu)].flatMap((m) =>
    m[1].split(',').map((s) => s.trim()),
  )
  const usedBare = /\bfileURLToPath\s*\(/u.test(source)
  if (usedBare) {
    assert.ok(
      imports.includes('fileURLToPath'),
      'lib/index.mjs 调用了 fileURLToPath 但没从 node:url 显式 import（保存同济账号会 ReferenceError）',
    )
  }
})
