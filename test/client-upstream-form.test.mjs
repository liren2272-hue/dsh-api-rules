// Headless acceptance for the dynamic-upstream「＋」panel: the model-list fetch button
// must exist, and clicking it must MERGE the upstream list into the existing text
// (models the upstream omits — e.g. intern-ai's intern-decision-4b — must survive).
//
// Same approach as client-card-admin-url.test.mjs: no host window, no real React.
// The card receives React through props, so a fake React lands hooks in a fake store;
// driving a render = mutate a slot value, reset the hook cursor, re-execute the component.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_FILE = join(HERE, 'fixtures', 'accounts-live-20261108.json')

// The host loads the BUNDLE (lib/client.js); lib/client/index.js is the readable source.
// Both are hand-maintained and must stay equivalent, so every assertion runs twice.
// ARC_TEST_CLIENT overrides the bundle path, which is how the negative control runs a
// deliberately-broken copy and proves these assertions can actually fail.
const BUNDLE_FILE = process.env.ARC_TEST_CLIENT || join(HERE, '..', 'lib', 'client.js')
const CLIENTS = [
  { label: 'bundle', file: BUNDLE_FILE },
  { label: 'source', file: join(HERE, '..', 'lib', 'client', 'index.js') },
]

const isElement = (n) => Boolean(n) && typeof n === 'object' && typeof n.type !== 'undefined'

function expand(node, depth = 0) {
  let cur = node
  while (isElement(cur) && typeof cur.type === 'function' && depth < 8) {
    cur = cur.type(cur.props)
    depth++
  }
  return cur
}

function collect(node, pred, out = []) {
  if (Array.isArray(node)) {
    for (const c of node) collect(c, pred, out)
    return out
  }
  const n = expand(node)
  if (!isElement(n)) return out
  if (n.type === 'style') return out
  if (pred(n)) out.push(n)
  for (const c of n.props.children || []) collect(c, pred, out)
  return out
}

const byClass = (tree, cls) => collect(tree, (n) => n.props && n.props.className === cls)

// Inputs are matched by placeholder, which is unique per field in this form.
const inputByPlaceholder = (tree, ph) =>
  collect(tree, (n) => n.type === 'input' && n.props && n.props.placeholder === ph)[0]

async function mount(payload, clientFile) {
  let factoryFn = null
  new Function('window', readFileSync(clientFile, 'utf8'))({
    __ModuleLoader__: { load: (spec) => { factoryFn = spec.factory } },
  })
  assert.equal(typeof factoryFn, 'function', 'client must register a factory on window.__ModuleLoader__')

  const dicts = {}
  const store = { slots: [], effects: [] }
  let hookIdx = 0
  const slotOf = (init) => {
    const i = hookIdx++
    if (!(i in store.slots)) store.slots[i] = { value: typeof init === 'function' ? init() : init }
    return store.slots[i]
  }
  const React = {
    // The form is wrapped in <React.Fragment>; without it createElement(undefined, …)
    // yields an element the walker cannot descend into, hiding every field.
    Fragment: Symbol.for('react.fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState: (init) => {
      const s = slotOf(init)
      return [s.value, (v) => { s.value = typeof v === 'function' ? v(s.value) : v }]
    },
    useRef: (init) => {
      const i = hookIdx++
      if (!(i in store.slots)) store.slots[i] = { current: init }
      return store.slots[i]
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => { store.effects.push(fn) },
  }

  const locale = {
    register: (ns, dict) => { dicts[ns] = dict },
    bind: (ns) => (key, vars) => {
      const table = (dicts[ns] && dicts[ns].zh) || {}
      let out = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
      return out
    },
  }

  const { apply } = factoryFn((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return { createPortal: (el) => el }
    throw new Error('unexpected require: ' + id)
  })
  let cardEl = null
  apply({
    effect: (fn) => { fn() },
    locale,
    slots: {
      inject: (_n, f) => {
        const el = f()
        if (_n === 'plugins.bundle.config') cardEl = el
        return el
      },
      register: (_m, f) => f(),
    },
  })
  assert.ok(cardEl, 'card element must be registered on the plugins.bundle.config slot')

  const render = () => {
    hookIdx = 0
    store.effects = []
    return cardEl.type(cardEl.props)
  }

  const saved = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    fetch: globalThis.fetch,
  }
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url) === '/api/api-rules/accounts') {
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payload)) }
    }
    throw new Error('unexpected fetch in mount: ' + url)
  }
  const restore = () => Object.assign(globalThis, saved)

  let tree = render()
  const effect = store.effects[0]
  assert.equal(typeof effect, 'function', 'card must load routes inside useEffect')
  const cleanup = effect()
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r))
  tree = render()

  return { tree, render, store, dicts, cleanup, restore, calls }
}

// Find the boolean slot that toggles the add panel: flipping it makes .arc-addpanel appear.
function findShowAddSlot(h) {
  for (let i = 0; i < h.store.slots.length; i++) {
    const s = h.store.slots[i]
    if (!s || !('value' in s) || typeof s.value !== 'boolean') continue
    const prev = s.value
    s.value = true
    let ok = false
    try {
      ok = byClass(h.render(), 'arc-fetchRow').length === 1
    } catch { ok = false }
    s.value = prev
    if (ok) return i
  }
  return -1
}

// Find the addDraft object slot by shape, not by index.
function findAddDraftSlot(h) {
  for (let i = 0; i < h.store.slots.length; i++) {
    const s = h.store.slots[i]
    if (!s || !('value' in s) || typeof s.value !== 'object' || s.value === null) continue
    const v = s.value
    if ('baseUrl' in v && 'models' in v && 'passthroughAuth' in v) return i
  }
  return -1
}

for (const client of CLIENTS) {
test(`add-upstream form renders a fetch button and merges the upstream model list [${client.label}]`, async (t) => {
  const payload = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  const h = await mount(payload, client.file)
  t.after(() => {
    try { h.cleanup && h.cleanup() } catch { /* ignore */ }
    h.restore()
  })

  const showAddIdx = findShowAddSlot(h)
  assert.notEqual(showAddIdx, -1, 'a boolean state slot must toggle the add-upstream panel')
  h.store.slots[showAddIdx].value = true

  const draftIdx = findAddDraftSlot(h)
  assert.notEqual(draftIdx, -1, 'addDraft state slot must exist')
  const draft = h.store.slots[draftIdx].value
  draft.baseUrl = 'https://discovery-api.intern-ai.org.cn/v1'
  draft.apiKeyEnv = 'INTERN_AI_API_KEY'
  // 现有清单里有一个上游 /v1/models 不会返回的模型。
  draft.models = 'glm-5.3:131072, intern-decision-4b:8192'

  let tree = h.render()

  // The 9 fields plus the passthrough checkbox must all be on screen.
  const expectedFields = [
    '例如 My Upstream', // name
    '例如 my-upstream', // id
    'https://api.example.com/v1', // baseUrl
    'sk-...', // apiKey
    '如 INTERN_AI_API_KEY；留空则用占位密钥', // apiKeyEnv
    '留空 = generic；如 intern-ai', // rules
    '如 deepseek-v4.1-flash-1017, glm-5.3:131072', // models
    '如 2', // concurrency
    '如 300000', // timeoutMs
  ]
  for (const ph of expectedFields) {
    assert.ok(inputByPlaceholder(tree, ph), 'missing form field with placeholder: ' + ph)
  }
  const fetchRow = byClass(tree, 'arc-fetchRow')
  assert.equal(fetchRow.length, 1, 'exactly one fetch row must render')
  const fetchBtn = collect(fetchRow[0], (n) => n.type === 'button')[0]
  assert.ok(fetchBtn, 'fetch row must contain a button')
  assert.equal(fetchBtn.props.children[0], '拉取模型清单', 'button label comes from up.modelsFetch')
  assert.equal(fetchBtn.props.disabled, false, 'button must be enabled when idle')
  assert.equal(byClass(tree, 'arc-check').length, 1, 'passthrough checkbox must render')

  // Upstream /v1/models omits intern-decision-4b and gives glm-5.3 a bigger context.
  const upstreamModels = [
    { id: 'glm-5.3', maxTokens: 1048576 },
    { id: 'deepseek-v4.1-flash-1017', maxTokens: 1048576 },
  ]
  let sawBody = null
  globalThis.fetch = async (url, opts) => {
    assert.equal(String(url), '/api/api-rules/upstreams/models', 'must call the host-side model endpoint')
    sawBody = JSON.parse(opts.body)
    return { ok: true, status: 200, json: async () => ({ ok: true, models: upstreamModels, source: 'credential' }) }
  }

  await fetchBtn.props.onClick()
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r))

  assert.equal(sawBody.baseUrl, 'https://discovery-api.intern-ai.org.cn/v1', 'baseUrl must be forwarded')
  assert.equal(sawBody.apiKeyEnv, 'INTERN_AI_API_KEY', 'credential ref must be forwarded to the host')

  tree = h.render()
  const modelsInput = inputByPlaceholder(tree, '如 deepseek-v4.1-flash-1017, glm-5.3:131072')
  assert.ok(modelsInput, 'models input must render')
  assert.equal(
    modelsInput.props.value,
    'glm-5.3:1048576, deepseek-v4.1-flash-1017:1048576, intern-decision-4b:8192',
    'upstream entries win, omitted models are kept',
  )

  const hint = byClass(tree, 'arc-fetchHint')[0]
  assert.ok(hint, 'fetch must report a hint')
  assert.equal(
    hint.props.children[0],
    '已拉取 2 个模型，另保留上游未列出的：intern-decision-4b',
    'hint must name the kept models',
  )
})

test(`fetch rejects an empty or non-http baseUrl without calling the endpoint [${client.label}]`, async (t) => {
  const payload = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  const h = await mount(payload, client.file)
  t.after(() => {
    try { h.cleanup && h.cleanup() } catch { /* ignore */ }
    h.restore()
  })

  h.store.slots[findShowAddSlot(h)].value = true
  const draft = h.store.slots[findAddDraftSlot(h)].value
  draft.baseUrl = 'ftp://nope'
  const tree = h.render()
  const btn = collect(byClass(tree, 'arc-fetchRow')[0], (n) => n.type === 'button')[0]

  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('should not fetch') }
  await btn.props.onClick()
  assert.equal(called, false, 'invalid baseUrl must be rejected before any request')

  const after = h.render()
  const err = byClass(after, 'arc-fieldError')[0]
  assert.ok(err, 'invalid baseUrl must surface an error')
  assert.equal(err.props.children[0], '请填写合法的 http(s) 上游地址。')
})

test(`leaving the baseUrl field auto-fetches the model list [${client.label}]`, async (t) => {
  const payload = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  const h = await mount(payload, client.file)
  t.after(() => {
    try { h.cleanup && h.cleanup() } catch { /* ignore */ }
    h.restore()
  })

  h.store.slots[findShowAddSlot(h)].value = true
  const draft = h.store.slots[findAddDraftSlot(h)].value
  draft.baseUrl = 'https://discovery-api.intern-ai.org.cn/v1'
  draft.apiKeyEnv = 'INTERN_AI_API_KEY'
  draft.models = ''
  const tree = h.render()

  const baseUrlInput = inputByPlaceholder(tree, 'https://api.example.com/v1')
  assert.ok(baseUrlInput, 'baseUrl input must render')
  assert.equal(typeof baseUrlInput.props.onBlur, 'function', 'baseUrl field must auto-fetch on blur')

  let sawBody = null
  globalThis.fetch = async (url, opts) => {
    assert.equal(String(url), '/api/api-rules/upstreams/models')
    sawBody = JSON.parse(opts.body)
    return { ok: true, status: 200, json: async () => ({ ok: true, models: [{ id: 'glm-5.3', maxTokens: 1048576 }], source: 'credential' }) }
  }
  await baseUrlInput.props.onBlur({ target: { value: 'https://discovery-api.intern-ai.org.cn/v1' } })
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r))

  assert.ok(sawBody, 'blur must trigger the host-side model fetch')
  assert.equal(sawBody.baseUrl, 'https://discovery-api.intern-ai.org.cn/v1')
  assert.equal(sawBody.apiKeyEnv, 'INTERN_AI_API_KEY', 'blur must forward the credential ref')

  const modelsInput = inputByPlaceholder(h.render(), '如 deepseek-v4.1-flash-1017, glm-5.3:131072')
  assert.equal(modelsInput.props.value, 'glm-5.3:1048576', 'auto-fetch must fill the model list')
})

test(`auto-fetch stays quiet when the baseUrl is not yet usable [${client.label}]`, async (t) => {
  const payload = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  const h = await mount(payload, client.file)
  t.after(() => {
    try { h.cleanup && h.cleanup() } catch { /* ignore */ }
    h.restore()
  })

  h.store.slots[findShowAddSlot(h)].value = true
  const tree = h.render()
  const baseUrlInput = inputByPlaceholder(tree, 'https://api.example.com/v1')

  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('should not fetch') }
  // 用户还在输入地址（没有 scheme）：不该发请求，也不该弹错。
  await baseUrlInput.props.onBlur({ target: { value: 'discovery-api' } })
  assert.equal(called, false, 'incomplete baseUrl must not trigger a request')

  const after = h.render()
  assert.equal(byClass(after, 'arc-fieldError').length, 0, 'silent auto-fetch must not surface an error')
})

test(`a failed auto-fetch stays silent, a failed manual fetch reports [${client.label}]`, async (t) => {
  const payload = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  const h = await mount(payload, client.file)
  t.after(() => {
    try { h.cleanup && h.cleanup() } catch { /* ignore */ }
    h.restore()
  })

  h.store.slots[findShowAddSlot(h)].value = true
  const draft = h.store.slots[findAddDraftSlot(h)].value
  draft.baseUrl = 'https://discovery-api.intern-ai.org.cn/v1'
  draft.apiKeyEnv = 'INTERN_AI_API_KEY'
  let tree = h.render()

  // 自动拉取失败（例如凭据还没配好 → 401）：不该弹错。
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, models: [], error: 'HTTP 401: invalid api key' }) })
  const baseUrlInput = inputByPlaceholder(tree, 'https://api.example.com/v1')
  await baseUrlInput.props.onBlur({ target: { value: 'https://discovery-api.intern-ai.org.cn/v1' } })
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r))
  assert.equal(byClass(h.render(), 'arc-fetchHint').length, 0, 'silent auto-fetch failure must show no hint')

  // 手动点按钮失败：必须报错，否则用户不知道发生了什么。
  tree = h.render()
  const btn = collect(byClass(tree, 'arc-fetchRow')[0], (n) => n.type === 'button')[0]
  await btn.props.onClick()
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r))
  const hint = byClass(h.render(), 'arc-fetchHint')[0]
  assert.ok(hint, 'manual fetch failure must show a hint')
  assert.match(String(hint.props.children[0]), /拉取失败：HTTP 401/, 'manual fetch must report the real error')
})
}

// ── m03964: empty add-upstream box gone; dynamic-upstream card shows real address/key/delete ──

// Find the string-valued slot that is the active tab: setting it to a route id makes that
// route's pane render. We detect success by asking the caller for a DOM predicate.
function findTabSlotByMarkup(h, routeId, detect) {
  for (let i = 0; i < h.store.slots.length; i++) {
    const s = h.store.slots[i]
    if (!s || !('value' in s) || typeof s.value !== 'string') continue
    const prev = s.value
    s.value = routeId
    let ok = false
    try { ok = detect(h.render()) } catch { ok = false }
    s.value = prev
    if (ok) return i
  }
  return -1
}

for (const client of CLIENTS) {
  test(`no persistent empty add-upstream box; add panel appears only on ＋ [${client.label}]`, async (t) => {
    const payload = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
    const h = await mount(payload, client.file)
    t.after(() => {
      try { h.cleanup && h.cleanup() } catch { /* ignore */ }
      h.restore()
    })

    // showAdd starts false — the old code still rendered a bordered empty arc-addpanel here.
    assert.equal(byClass(h.tree, 'arc-addpanel').length, 0,
      'no arc-addpanel may render while the add form is closed (the empty box users complained about)')

    const showAddIdx = findShowAddSlot(h)
    assert.notEqual(showAddIdx, -1, 'the ＋ toggle slot must exist')
    h.store.slots[showAddIdx].value = true
    assert.equal(byClass(h.render(), 'arc-addpanel').length, 1,
      'the bordered add panel must appear once ＋ is opened')

    h.store.slots[showAddIdx].value = false
    assert.equal(byClass(h.render(), 'arc-addpanel').length, 0,
      'closing ＋ must remove the panel again (no residual box)')
  })

  test(`dynamic-upstream card shows real address + credential + delete, no empty admin note [${client.label}]`, async (t) => {
    const payload = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
    payload.routes.push({
      id: 'intern-ai',
      label: 'intern-ai',
      credentialKind: 'managed',
      needsCredential: false,
      dynamicUpstream: true,
      upstreamUrl: 'https://discovery-api.intern-ai.org.cn/v1',
      apiKeyEnv: 'INTERN_AI_API_KEY',
      passthroughAuth: true,
      models: 11,
      health: { checked: true, ok: true, models: 11, error: '' },
      adminUrl: '',
      autoLaunched: false,
    })
    const h = await mount(payload, client.file)
    t.after(() => {
      try { h.cleanup && h.cleanup() } catch { /* ignore */ }
      h.restore()
    })

    const tabIdx = findTabSlotByMarkup(h, 'intern-ai', (tree) => byClass(tree, 'arc-upInfo').length === 1)
    assert.notEqual(tabIdx, -1, 'activeTab slot must drive the dynamic-upstream card')
    h.store.slots[tabIdx].value = 'intern-ai'
    const tree = h.render()

    const info = byClass(tree, 'arc-upInfo')
    assert.equal(info.length, 1, 'dynamic card must render exactly one info block')
    const values = byClass(tree, 'arc-upInfoValue').map((n) => String(n.props.children[0]))
    assert.ok(values.includes('https://discovery-api.intern-ai.org.cn/v1'),
      'card must show the REAL upstream URL (not the 127.0.0.1:8788 proxy mapping)')
    assert.ok(values.includes('INTERN_AI_API_KEY'), 'card must show the credential ref')

    // No useless "management panel not configured" message in this card.
    assert.equal(byClass(tree, 'arc-panel').length, 0,
      'dynamic card must not render the empty admin-panel note')
    assert.equal(byClass(tree, 'arc-paneDesc')[0].props.children[0],
      '地址仅作展示；实际请求仍经本插件代理，规则包节流继续生效。',
      'card must explain the address is display-only and proxy is retained')

    // Two-step delete button lives in the card.
    const delBtn = collect(tree, (n) =>
      n.type === 'button' && /删除/.test(String(n.props.children[0])) &&
      /arc-btn/.test(String(n.props.className)))[0]
    assert.ok(delBtn, 'dynamic card must carry a delete button')
    assert.equal(typeof delBtn.props.onClick, 'function', 'delete button must be wired')
  })
}
