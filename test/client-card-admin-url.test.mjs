// Headless acceptance for the dsh-api-rules settings card.
//
// Goal: every route's "open admin panel" entry renders with THAT route's own adminUrl.
// No host window, no real React: the card receives React through props, so we inject a
// fake React whose hooks land in a fake store. Driving a render = set the store value,
// reset the hook cursor (hookIdx = 0), re-execute the component function. Routes are
// replayed from a captured live payload of GET /api/api-rules/accounts (never invented),
// and each route is rendered on its own tab before asserting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', 'lib', 'client', 'index.js')
const FIXTURE_FILE = join(HERE, 'fixtures', 'accounts-live-20261108.json')
const NS = 'settings.api-rules'

const isElement = (n) => Boolean(n) && typeof n === 'object' && typeof n.type !== 'undefined'

// Expand a function component (e.g. PanelLink) into its rendered element, so its
// output is walked like any other node. Depth-capped against accidental recursion.
function expand(node, depth = 0) {
  let cur = node
  while (isElement(cur) && typeof cur.type === 'function' && depth < 8) {
    cur = cur.type(cur.props)
    depth++
  }
  return cur
}

// Collect elements matching pred. <style> is skipped: its CSS source is not visible copy.
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

// Count <style> nodes with a walker that does NOT skip them (collect() would).
function countStyles(node, n = 0) {
  if (Array.isArray(node)) return node.reduce((acc, c) => countStyles(c, acc), n)
  const cur = expand(node)
  if (!isElement(cur)) return n
  if (cur.type === 'style') return n + 1
  return (cur.props.children || []).reduce((acc, c) => countStyles(c, acc), n)
}

// Visible text only; skipping <style> keeps CSS source out of the copy assertions.
function visibleText(node, out = []) {
  if (Array.isArray(node)) {
    for (const c of node) visibleText(c, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  const n = expand(node)
  if (!isElement(n)) return out
  if (n.type === 'style') return out
  for (const c of n.props.children || []) visibleText(c, out)
  return out
}

const tabsOf = (tree) => collect(tree, (n) => n.type === 'button' && n.props && n.props.role === 'tab')
const anchorsOf = (tree) => collect(tree, (n) => n.type === 'a')
const byClass = (tree, cls) => collect(tree, (n) => n.props && n.props.className === cls) // exact, not substring

async function mount(payload) {
  let factoryFn = null
  new Function('window', readFileSync(CLIENT_FILE, 'utf8'))({
    __ModuleLoader__: { load: (spec) => { factoryFn = spec.factory } },
  })
  assert.equal(typeof factoryFn, 'function', 'client.js must register a factory on window.__ModuleLoader__')

  const dicts = {}
  const store = { slots: [], effects: [] }
  let hookIdx = 0
  const slotOf = (init) => {
    const i = hookIdx++
    if (!(i in store.slots)) store.slots[i] = { value: typeof init === 'function' ? init() : init }
    return store.slots[i]
  }
  const React = {
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

  // Mirrors the host: register(ns, { zh, en }) then bind(ns) -> t(key, vars); flat dotted keys.
  const locale = {
    register: (ns, dict) => { dicts[ns] = dict },
    // zh is the default language here; flat dotted keys are looked up literally.
    bind: (ns) => (key, vars) => {
      const table = (dicts[ns] && dicts[ns].zh) || {}
      let out = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
      return out
    },
  }

  const { apply } = factoryFn((id) => {
    if (id === 'react') return React
    throw new Error('unexpected require: ' + id)
  })
  let cardEl = null
  apply({
    effect: (fn) => { fn() },
    locale,
    slots: { inject: (_n, f) => { cardEl = f() }, register: (_m, f) => f() },
  })
  assert.ok(cardEl, 'card element must be registered on the plugins.bundle.config slot')
  assert.equal(typeof cardEl.type, 'function', 'slot must yield the ApiRulesCard element')

  const render = () => {
    hookIdx = 0
    store.effects = []
    return cardEl.type(cardEl.props)
  }

  const savedGlobals = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, fetch: globalThis.fetch }
  globalThis.setInterval = () => 0 // the 60s poll must not pin the event loop
  globalThis.clearInterval = () => {}
  globalThis.fetch = async (url) => {
    assert.equal(String(url), '/api/api-rules/accounts', 'card must load the live accounts endpoint')
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payload)) }
  }
  const restore = () => Object.assign(globalThis, savedGlobals)

  let tree = render()
  const effect = store.effects[0]
  assert.equal(typeof effect, 'function', 'card must load routes inside useEffect')
  const cleanup = effect()
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)) // flush the async load()
  tree = render()

  return { tree, render, store, dicts, cleanup, restore }
}

// Locate the activeTab useState slot: a string-valued slot whose value flips aria-selected
// to the second route. Other string slots (global/busy) cannot move the selection.
function findTabSlot(h, payload) {
  for (let i = 0; i < h.store.slots.length; i++) {
    const s = h.store.slots[i]
    if (!s || !('value' in s) || typeof s.value !== 'string') continue
    const prev = s.value
    s.value = payload.routes[1].id
    let ok = false
    try {
      const probe = tabsOf(h.render())
      ok = probe.length === payload.routes.length && probe[1].props['aria-selected'] === 'true'
    } catch {
      ok = false
    }
    s.value = prev
    if (ok) return i
  }
  return -1
}

test("every route's admin panel entry renders that route's own adminUrl", async (t) => {
  const payload = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  assert.ok(Array.isArray(payload.routes) && payload.routes.length > 1, 'fixture must replay a multi-route payload')
  const h = await mount(payload)
  t.after(() => {
    try { h.cleanup && h.cleanup() } catch { /* ignore */ }
    h.restore()
  })

  const dict = h.dicts[NS]
  assert.ok(dict && dict.zh && dict.en, 'locale.register must supply zh + en dictionaries')
  const zh = dict.zh

  // i18n coverage for every route in the payload (flat dotted keys, both languages)
  for (const lang of ['zh', 'en']) {
    for (const route of payload.routes) {
      for (const prefix of ['tab.', 'name.', 'desc.']) {
        assert.ok(prefix + route.id in dict[lang], lang + ' dictionary misses ' + prefix + route.id)
      }
    }
    for (const k of ['panel.title', 'panel.open', 'panel.missing', 'panel.note.default']) {
      assert.ok(k in dict[lang], lang + ' dictionary misses ' + k)
    }
  }

  // card shell
  assert.equal(h.tree.props.className, 'arc', 'root element must be the card root')
  assert.equal(countStyles(h.tree), 1, 'exactly one component-level <style>')

  // default tab = routes[0], and nothing is preselected in state
  const tabIndex = findTabSlot(h, payload)
  assert.ok(tabIndex >= 0, 'could not locate the activeTab state slot')
  assert.equal(h.store.slots[tabIndex].value, '', 'activeTab must start empty and fall back to routes[0]')
  const firstTabs = tabsOf(h.render())
  assert.equal(firstTabs[0].props['aria-selected'], 'true', 'routes[0] must be the default tab')

  const report = []
  for (const route of payload.routes) {
    // drive this route: same component root, hook cursor reset, fake store tab = route id
    h.store.slots[tabIndex].value = route.id
    const tree = h.render()

    const tabs = tabsOf(tree)
    assert.equal(tabs.length, payload.routes.length, 'tab count must equal route count')
    assert.deepEqual(
      tabs.map((n) => n.props['aria-selected']),
      payload.routes.map((r) => (r.id === route.id ? 'true' : 'false')),
      route.id + ': exactly the active tab is selected',
    )
    assert.deepEqual(
      tabs.map((n) => visibleText(n).join('')),
      payload.routes.map((r) => zh['tab.' + r.id] || r.label),
      route.id + ': tab labels must be localized copy',
    )

    const titles = byClass(tree, 'arc-paneTitle')
    assert.equal(titles.length, 1, route.id + ': exactly one pane title')
    assert.equal(visibleText(titles[0]).join(''), zh['name.' + route.id] || route.label)

    const managed = route.credentialKind === 'managed' || (route.credentialKind === undefined && !route.needsCredential)
    const adminUrl = typeof route.adminUrl === 'string' ? route.adminUrl.trim() : ''
    const expectLink = managed && adminUrl !== ''
    const anchors = anchorsOf(tree)
    const panels = byClass(tree, 'arc-panel')
    const texts = visibleText(tree)

    if (expectLink) {
      assert.equal(anchors.length, 1, route.id + ': exactly one admin panel link')
      assert.equal(anchors[0].props.href, adminUrl, route.id + ': link must carry its own adminUrl')
      assert.equal(anchors[0].props.target, '_blank', route.id + ': link opens a new tab')
      assert.equal(anchors[0].props.rel, 'noreferrer', route.id + ': link is rel=noreferrer')
      assert.equal(visibleText(anchors[0]).join(''), zh['panel.open'], route.id + ': link label must be localized copy')
      assert.equal(panels.length, 1, route.id + ': exactly one panel card (exact className match)')
      assert.equal(visibleText(byClass(tree, 'arc-panel__title')[0]).join(''), zh['panel.title'])
      assert.equal(
        visibleText(byClass(tree, 'arc-panel__note')[0]).join(''),
        zh['panel.note.' + route.id] || zh['panel.note.default'],
        route.id + ': panel note falls back to panel.note.default',
      )
    } else {
      assert.equal(anchors.length, 0, route.id + ': no panel link without an adminUrl')
      assert.equal(panels.length, 0, route.id + ': no panel card without an adminUrl')
      if (managed) {
        assert.ok(texts.includes(zh['panel.missing']), route.id + ': managed route without adminUrl explains itself')
      }
    }

    // no cross-route leakage: only the active route's own adminUrl may appear
    const hrefs = anchors.map((a) => a.props.href)
    for (const other of payload.routes) {
      if (other.id === route.id || !other.adminUrl) continue
      assert.ok(!hrefs.includes(other.adminUrl), route.id + ': must not render ' + other.id + "'s adminUrl")
      assert.ok(!texts.some((x) => x.includes(other.adminUrl)), route.id + ': foreign adminUrl in visible copy')
    }

    // no raw i18n key / raw route id leaked as visible copy
    for (const text of texts) {
      const v = text.trim()
      assert.ok(
        !/^(tab|name|desc|panel|card|field|action|status|meta|error|empty|foot|ph|mask)\./.test(v),
        route.id + ': raw i18n key leaked as copy: ' + v,
      )
      assert.notEqual(v, route.id, route.id + ': raw route id leaked as copy')
    }

    // credential pane shape stays intact: codearts keeps AK + SK inputs
    if (route.id === 'codearts') {
      assert.equal(collect(tree, (n) => n.type === 'input').length, 2, 'codearts pane keeps AK + SK inputs')
    }

    report.push({
      id: route.id,
      kind: route.credentialKind || '',
      adminUrl,
      links: hrefs.length,
      href: hrefs[0] || '',
      panelCards: panels.length,
    })
  }

  assert.equal(report.length, payload.routes.length)
  const withLink = report.filter((r) => r.links === 1)
  const withoutLink = report.filter((r) => r.links === 0)
  assert.equal(withLink.length + withoutLink.length, report.length, 'every route must be classified')

  console.log('=== per-route headless render ===')
  for (const row of report) console.log(JSON.stringify(row))
  console.log(
    'RENDER OK: ' + withLink.length + ' route(s) link to their own adminUrl, ' + withoutLink.length + ' route(s) render no panel link',
  )
})

test('managed route without adminUrl renders the explanatory copy and no link', async (t) => {
  const base = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  const payload = { routes: base.routes.map((r) => (r.id === 'cline' ? { ...r, adminUrl: '' } : r)) }
  const h = await mount(payload)
  t.after(() => {
    try { h.cleanup && h.cleanup() } catch { /* ignore */ }
    h.restore()
  })

  const tabIndex = findTabSlot(h, payload)
  assert.ok(tabIndex >= 0, 'could not locate the activeTab state slot')
  h.store.slots[tabIndex].value = 'cline'
  const tree = h.render()
  const zh = h.dicts[NS].zh
  assert.equal(anchorsOf(tree).length, 0, 'no link when adminUrl is empty')
  assert.equal(byClass(tree, 'arc-panel').length, 0, 'no panel card when adminUrl is empty')
  assert.ok(visibleText(tree).includes(zh['panel.missing']), 'must explain the missing panel URL')
})

test('admin panel entry follows the payload, not a hard-coded route list', async (t) => {
  const base = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  const extra = {
    id: 'newroute',
    label: 'NewRoute',
    needsCredential: false,
    credentialKind: 'managed',
    configured: true,
    adminUrl: 'http://127.0.0.1:19999/admin',
  }
  const payload = { routes: [...base.routes, extra] }
  const h = await mount(payload)
  t.after(() => {
    try { h.cleanup && h.cleanup() } catch { /* ignore */ }
    h.restore()
  })

  const tabIndex = findTabSlot(h, payload)
  assert.ok(tabIndex >= 0, 'could not locate the activeTab state slot')
  h.store.slots[tabIndex].value = 'newroute'
  const tree = h.render()
  const anchors = anchorsOf(tree)
  assert.equal(anchors.length, 1, 'a newly configured route gets its own panel link')
  assert.equal(anchors[0].props.href, extra.adminUrl, 'link carries the new route adminUrl')
})

test('card copy is read through t(key, vars), never t.property', () => {
  const code = readFileSync(CLIENT_FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments / jsdoc
    .replace(/^\s*\/\/.*$/gm, '') // line comments
  assert.ok(!/(^|[^A-Za-z0-9_$.])t\.[A-Za-z_]/m.test(code), 'must not read copy as t.<property>')
  assert.ok(!/t\[['"]/.test(code), "must not index t['key']")
  assert.match(code, /t\(['"]panel\.open['"]\)/, 'panel link label must go through t(key)')
})
