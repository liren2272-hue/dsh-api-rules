// Regression: ComposerProviderPoints must render its portal without throwing.
//
// Root cause this guards (2026-11-15): ReactDOMTop was declared INSIDE apply(),
// so the component function (defined in factory scope) could not see it. The
// pill rendered fine while open=false (portal branch untouched), but the moment
// the user clicked, open=true hit ReactDOMTop.createPortal(...) and threw
// ReferenceError -> React unmounted the subtree -> "pill vanishes / no panel".
//
// These tests execute the REAL component function through a fake React that
// (a) runs function components, (b) keeps hook state across re-renders,
// (c) actually invokes the portal branch on the open=true render, and
// (d) flushes the route load effect so the api-rules route/points data is in.
//
// Scope (2026-11-15): the pill renders ONLY for an api-rules route that has
// points (user: "workbuddy这样的就不用渲染这个面板了，只针对api-rules里面的有
// 积分的有面板"). A negative control reconstructs the historical buggy scope
// and asserts it DOES throw, proving the portal test is not a no-op.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', 'lib', 'client', 'index.js')

function collectBy(node, pred, out = []) {
  if (Array.isArray(node)) {
    for (const c of node) collectBy(c, pred, out)
    return out
  }
  if (!node || typeof node !== 'object' || typeof node.type === 'undefined') return out
  if (node.type === 'style') return out
  if (pred(node)) out.push(node)
  for (const c of (node.props && node.props.children) || []) collectBy(c, pred, out)
  return out
}

function makeDrive(src, { routes, provider }) {
  let factoryFn = null
  const win = {
    __ModuleLoader__: { load: (spec) => { factoryFn = spec.factory } },
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1280, innerHeight: 800,
  }
  const doc = { body: {}, addEventListener() {}, removeEventListener() {} }
  const run = new Function(
    'window', 'document', 'Node', 'ResizeObserver', 'fetch',
    'setInterval', 'clearInterval', 'console',
    src,
  )
  run(
    win, doc,
    function Node() {},
    function ResizeObserver() { this.observe = () => {}; this.disconnect = () => {} },
    async () => ({ ok: true, json: async () => ({ routes }) }),
    () => 0, () => {}, console,
  )
  assert.equal(typeof factoryFn, 'function', 'client must register a factory')

  const store = { slots: [], effects: [] }
  let hookIdx = 0
  const slotOf = (init) => {
    const i = hookIdx++
    if (!(i in store.slots)) store.slots[i] = { value: typeof init === 'function' ? init() : init }
    return store.slots[i]
  }
  const ReactShim = {
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
    useEffect: (fn) => { store.effects.push(fn) },
    useLayoutEffect: (fn) => { store.effects.push(fn) },
  }
  let portalCalls = 0
  let portalEl = null
  const reactDomShim = { createPortal: (el) => { portalCalls++; portalEl = el; return el } }
  const req = (id) => {
    if (id === 'react') return ReactShim
    if (id === 'react-dom') return reactDomShim
    throw new Error('unexpected require: ' + id)
  }

  const { apply } = factoryFn(req)
  let composerEl = null
  apply({
    effect: (fn) => fn(),
    locale: { register: () => {}, bind: () => (k) => k },
    slots: {
      inject: (name, f) => {
        const el = f()
        if (name === 'conversation.input.right') composerEl = el
        return el
      },
      register: (_m, f) => f(),
    },
  })
  assert.ok(composerEl, 'composer slot must be registered')
  assert.equal(typeof composerEl.type, 'function', 'composer slot yields the component function')

  const props = {
    t: (k) => k,
    useProjection: () => ({ next: { provider }, lastUsed: { provider } }),
  }
  const render = () => { hookIdx = 0; store.effects = []; return composerEl.type(props) }

  // Flush the route-load effect and let its async fetch + setDetail resolve.
  // Effects are collected during a render, so render first, then flush, then render again.
  const flush = async () => {
    const first = render()
    for (const fn of store.effects.splice(0)) fn()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    render()
    return first
  }

  return { render, flush, portalCalls: () => portalCalls, portalEl: () => portalEl }
}

const src = readFileSync(CLIENT_FILE, 'utf8')
const POINTED_ROUTE = [{ id: 'raccoon', points: { available: 9946 } }]

test('composer pill renders only for an api-rules route that has points', async () => {
  const d = makeDrive(src, { routes: POINTED_ROUTE, provider: 'raccoon' })
  const before = d.render()
  assert.equal(collectBy(before, (n) => n.props && n.props.className === 'dsm-workbuddy-composer-credits-trigger').length, 0,
    'pill must be hidden before the api-rules route data arrives')
  await d.flush()
  const loaded = d.render()
  const triggers = collectBy(loaded, (n) => n.props && n.props.className === 'dsm-workbuddy-composer-credits-trigger')
  assert.equal(triggers.length, 1, 'exactly one trigger button once the pointed api-rules route is loaded')
  assert.equal(typeof triggers[0].props.onClick, 'function', 'trigger must expose onClick')

  // Click -> setOpen(true) -> re-render -> portal branch executes.
  triggers[0].props.onClick()
  let err = null
  let second = null
  try { second = d.render() } catch (e) { err = e }
  assert.equal(err, null, 'open=true render must not throw: ' + (err && err.message))
  assert.equal(d.portalCalls(), 1, 'createPortal must be called exactly once when open')
  assert.ok(d.portalEl(), 'portal element must be produced')
  assert.equal(d.portalEl().props.className, 'dsm-workbuddy-composer-panel', 'portal must be the account panel')
  assert.equal(d.portalEl().props.role, 'dialog', 'portal must be a dialog')
})

test('pill does not render for a non-api-rules provider (workbuddy)', async () => {
  const d = makeDrive(src, { routes: POINTED_ROUTE, provider: 'workbuddy' })
  await d.flush()
  const el = d.render()
  const triggers = collectBy(el, (n) => n.props && n.props.className === 'dsm-workbuddy-composer-credits-trigger')
  assert.equal(triggers.length, 0, 'workbuddy-style provider must not render the api-rules credits pill')
})

test('pill does not render for an api-rules route without points (codearts/cline)', async () => {
  const d = makeDrive(src, { routes: [{ id: 'codearts', points: { available: null } }], provider: 'codearts' })
  await d.flush()
  const el = d.render()
  const triggers = collectBy(el, (n) => n.props && n.props.className === 'dsm-workbuddy-composer-credits-trigger')
  assert.equal(triggers.length, 0, 'api-rules route with no points must not render the pill')
})

test('negative control: historical scope (ReactDOMTop only inside apply) throws', async () => {
  // Reconstruct the exact pre-fix shape: remove the factory-top declaration,
  // re-declare it inside apply(). The component then cannot resolve it.
  const topDecl = "    const ReactDOMTop = require('react-dom')\n"
  const applyAnchor = "        const t = ctx.locale.bind(namespace)\n        const React = require('react')\n"
  assert.ok(src.includes(topDecl), 'fixture: factory-top ReactDOMTop declaration present')
  assert.ok(src.includes(applyAnchor), 'fixture: apply() anchor present')
  const buggy = src
    .replace(topDecl, '')
    .replace(applyAnchor, applyAnchor + "        const ReactDOMTop = require('react-dom')\n")
  const d = makeDrive(buggy, { routes: POINTED_ROUTE, provider: 'raccoon' })
  await d.flush()
  const loaded = d.render()
  const triggers = collectBy(loaded, (n) => n.props && n.props.className === 'dsm-workbuddy-composer-credits-trigger')
  assert.equal(triggers.length, 1, 'buggy fixture: pill must render before the click')
  triggers[0].props.onClick()
  let err = null
  try { d.render() } catch (e) { err = e }
  assert.ok(err, 'buggy scope MUST throw on open=true render (test would be a no-op otherwise)')
  assert.match(String(err && err.message), /ReactDOMTop/, 'error must name the missing binding')
  assert.equal(d.portalCalls(), 0, 'createPortal must never be reached in the buggy build')
})
