/**
 * normalizeModel 的嵌套模态解析（回归测试）。
 *
 * 起因：intern-ai 的 /v1/models 是 schema 2.x，上下文长度只在
 * `input_modalities[].supported_inputs.max_context_length.value`、输出上限只在
 * `output_modalities[].max_length.value`，扁平的 context_length / max_tokens 一个都没有。
 * 只读扁平字段时，面板能拉到 1048576，但「删掉再加回」走 syncModels 时会把每个模型
 * 都写成默认 128000 / 65536 —— 看起来加回来了，实际窗口全错。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeModel, buildEntryLines } from '../lib/sync-models.mjs'

test('normalizeModel reads nested schema 2.x modality fields', () => {
  const m = normalizeModel({
    id: 'deepseek-v4.1-flash-1017',
    input_modalities: [{ supported_inputs: { max_context_length: { value: 1048576 } } }],
    output_modalities: [{ max_length: { value: 262144 } }],
  })
  assert.equal(m.contextWindow, 1048576, 'nested max_context_length.value must win over the 128000 default')
  assert.equal(m.maxTokens, 262144, 'nested max_length.value must win over the 65536 default')
})

test('normalizeModel keeps flat fields working (other upstreams)', () => {
  assert.equal(normalizeModel({ id: 'flat', context_length: 200000 }).contextWindow, 200000)
  assert.equal(normalizeModel({ id: 'flat', context_window: 128000 }).contextWindow, 128000)
  assert.equal(normalizeModel({ id: 'flat', max_output_tokens: 64000 }).maxTokens, 64000)
  // 已归一化过的对象（camelCase）再跑一次必须幂等。
  const once = normalizeModel({ id: 'x', input_modalities: [{ supported_inputs: { max_context_length: { value: 524288 } } }] })
  const twice = normalizeModel(once)
  assert.equal(twice.contextWindow, once.contextWindow)
  assert.equal(twice.id, once.id)
})

test('normalizeModel ignores non-numeric modality entries', () => {
  const m = normalizeModel({
    id: 'str-mods',
    input_modalities: ['text', 'image'],
    output_modalities: ['text'],
  })
  assert.equal(m.id, 'str-mods', 'a model with only string modalities must not be dropped')
  assert.equal(m.contextWindow, undefined, 'string modalities must not become NaN/0')
  assert.equal(m.maxTokens, undefined)
  assert.equal(m.supportsImages, true, 'the plain "image" entry still marks vision support')
})

test('normalizeModel drops models without an id', () => {
  assert.equal(normalizeModel({ name: 'no id' }), null)
  assert.equal(normalizeModel(null), null)
  assert.equal(normalizeModel('nope'), null)
})

test('buildEntryLines writes the parsed window, not the default', () => {
  const m = normalizeModel({
    id: 'deepseek-v4.1-flash-1017',
    input_modalities: [{ supported_inputs: { max_context_length: { value: 1048576 } } }],
    output_modalities: [{ max_length: { value: 262144 } }],
  })
  const lines = buildEntryLines(m)
  assert.ok(lines.some((l) => l.trim() === 'contextWindow: 1048576'), lines.join('\n'))
  assert.ok(lines.some((l) => l.trim() === 'maxTokens: 262144'), lines.join('\n'))
  assert.ok(!lines.some((l) => l.trim() === 'contextWindow: 128000'), 'must not fall back to the default window')
})
