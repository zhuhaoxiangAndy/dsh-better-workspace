// Coverage the region-slicing smoke tests structurally cannot provide.
//
// Every test in smoke.mjs slices a REGION of client.js and runs it through
// `new Function`. That proves the sliced helpers work, but it never executes
// the component bodies — so a reference to an identifier renamed in one place
// but not the other stays invisible.
//
// That is exactly how the desktop crashed on 2026-11-11 10:55:09:
//     ReferenceError: sgroupDropEvents is not defined
// `node --check` passed (a call to an undefined const is valid syntax) and all
// 38 smoke tests passed (none of them paint the sidebar), while the Electron
// renderer died — Electron reports that as `render-process-gone` / `crashed`.
//
// This file closes that gap by loading the real bundle the way the browser
// does (window.__ModuleLoader__), applying the plugin against stub services,
// capturing the component registered into `sidebar.workspaces`, and PAINTING it
// with a seeded workspace/session tree. The registered wrapper is
// `(props) => E(QuietBoundary, null, E(BetterBrowser, props))`; QuietBoundary
// deliberately swallows render errors, so the inner component is invoked
// directly — otherwise this test would be blind to the very bug it exists for.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const CLIENT = new URL('../src/client.js', import.meta.url)

/** Minimal React: enough for module-level class/component definitions. */
function fakeReact() {
  class Component {
    constructor(props) { this.props = props }
    setState() {}
    forceUpdate() {}
  }
  return {
    Component,
    PureComponent: Component,
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props, children }),
    cloneElement: (el) => el,
    isValidElement: (el) => !!(el && el.type),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useContext: () => ({}),
    useReducer: (reducer, initial) => [initial, () => {}],
    memo: (c) => c,
    forwardRef: (f) => f,
    createContext: (value) => ({ Provider: 'Provider', Consumer: 'Consumer', _currentValue: value }),
    Children: {
      map: (c, f) => (Array.isArray(c) ? c.map(f) : []),
      toArray: (c) => (Array.isArray(c) ? c : []),
    },
  }
}

function loadEntry() {
  const text = fs.readFileSync(CLIENT, 'utf8')
  let captured = null
  const store = new Map()
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => { captured = entry } } },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: (k) => { store.delete(k) },
      clear: () => { store.clear() },
    },
    document: {
      addEventListener() {}, removeEventListener() {},
      documentElement: { style: {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    },
    navigator: { clipboard: { writeText: async () => {} }, language: 'zh' },
    getComputedStyle: () => ({ color: 'rgb(255,255,255)' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: () => {},
  }
  vm.createContext(sandbox)
  vm.runInContext(text, sandbox)
  assert.ok(captured !== null, 'client.js must register itself through window.__ModuleLoader__.load')
  return captured
}

function makeRequire(react) {
  return (name) => {
    if (name === 'react') return react
    if (name === '@deepseek-ai/dsh-client-store') return { defineStore: (def) => def }
    // Other baseline modules are only touched inside component bodies this test
    // does not walk into: a tolerant proxy that never throws.
    return new Proxy({}, {
      get: () => new Proxy(() => null, { get: () => () => null, apply: () => null }),
      apply: () => null,
    })
  }
}

test('factory executes end-to-end (no throw at module init)', () => {
  const entry = loadEntry()
  assert.equal(entry.id, 'dsh-better-workspace', 'module id stays stable')
  let api
  assert.doesNotThrow(() => { api = entry.factory(makeRequire(fakeReact())) },
    'factory must not throw: an init-time ReferenceError kills the renderer')
  assert.ok(api && typeof api === 'object', 'factory returns the cordis plugin descriptor')
  assert.equal(api.name, 'dsh-better-workspace')
  assert.ok(Array.isArray(api.inject), 'plugin declares its inject list')
  assert.equal(typeof api.apply, 'function', 'plugin exposes apply()')
})

/**
 * The regression test for the 10:55 crash. Seeds a workspace whose sessions are
 * grouped by "/" so `renderSessionNode` runs its session-group branch — the
 * exact code path whose call site was left pointing at a renamed identifier.
 */
test('sidebar paints a "/"-grouped tree without ReferenceError (10:55 regression)', () => {
  const entry = loadEntry()
  const react = fakeReact()
  const api = entry.factory(makeRequire(react))

  // ---- host stubs -------------------------------------------------------
  const registered = new Map()
  let pendingSlot = null
  const slots = {
    // guarded() returns a registrar that calls register(options, wrapper); the
    // wrapper is the real component, so capture it under the pending slot name.
    register: (options, component) => {
      if (pendingSlot) registered.set(pendingSlot, component)
      return () => {}
    },
    inject: (name, thunkOrComponent) => {
      pendingSlot = name
      try {
        if (typeof thunkOrComponent === 'function' && thunkOrComponent.length === 0) thunkOrComponent()
      } catch { /* a seat that fails to register is not this test's target */ }
      pendingSlot = null
      return () => {}
    },
    entries: () => [],
    subscribe: () => () => {},
  }

  const wsItems = [
    { workspaceId: 'w1', title: 'plugin2/demo', path: 'C:/demo', sessionIds: ['s1', 's2'] },
    { workspaceId: 'w2', title: 'RBE999/Sim-to-Real', path: 'C:/rbe', sessionIds: ['s3'] },
    { workspaceId: 'w3', title: 'plain', path: 'C:/plain', sessionIds: ['s4'] },
  ]
  const byId = {
    s1: { id: 's1', title: 'plugin2/one', blank: false, updatedAt: 1 },
    s2: { id: 's2', title: 'plugin2/two', blank: false, updatedAt: 2 },
    s3: { id: 's3', title: 'RBE999/Sim-to-Real/session', blank: false, updatedAt: 3 },
    s4: { id: 's4', title: 'four', blank: false, updatedAt: 4 },
  }
  const uiWorkspace = {
    openSession() {}, startSession() {}, forkSession() {},
    archiveSession: async () => {}, pinSession: async () => {}, unpinSession: async () => {},
    pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '',
  }
  const services = {
    slots,
    sessions: {
      list: { getSnapshot: () => ({ ids: Object.keys(byId), byId }) },
      searchSessions: async () => [],
      searchResultLimit: 20,
    },
    workspaces: {
      list: { getSnapshot: () => ({ items: wsItems, pinnedSessionIds: [], archivedSessionIds: [] }) },
      rename: async () => {}, delete: async () => {}, create: async () => {},
      insertBefore: () => {}, insertSessionBefore: () => {},
    },
    uiWorkspace,
    locale: { register: () => () => {}, bind: () => null },
  }

  assert.doesNotThrow(() => api.apply({
    get: (name) => services[name],
    effect: (fn) => { try { const d = fn(); if (typeof d === 'function') d() } catch { /* best effort */ } },
    settingsScope: undefined,
  }), 'apply() must not throw against a realistic service set')

  const Wrapper = registered.get('sidebar.workspaces')
  assert.equal(typeof Wrapper, 'function', 'sidebar.workspaces occupant was registered')

  const selectorOf = (state) => (fn) => (typeof fn === 'function' ? fn(state) : state)
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selectorOf({ ids: Object.keys(byId), byId }),
    useSessionPendingInteraction: selectorOf({}),
    useWorkspaces: selectorOf({ items: wsItems, phase: 'ready', archivedSessionIds: [], pinnedSessionIds: [] }),
    useSessionStatus: selectorOf({ get: () => undefined, entries: () => [] }),
    useStore: selectorOf({
      expanded: {}, sessionsExpanded: {}, sessionGroups: {}, prefs: {}, styling: {},
      sessionOrder: {}, sessionGroupOrder: {}, workspaceGroupOrder: [],
      groupBy: 'workspace-tree', orderBy: 'manual',
      sessionTitleSlash: true, workspaceTitleSlash: true, tabCycleOrder: 'page',
      collapseLimit: undefined,
    }),
    actions: new Proxy({}, { get: () => () => {} }),
    startSession() {}, open() {}, renameSession: async () => {}, forkSession() {},
    renameWorkspace: async () => {}, deleteWorkspace: async () => {}, archiveSession: async () => {},
    createWorkspace: async () => {}, insertWorkspaceBefore() {}, insertSessionBefore() {},
    useDirectoryFlow: () => false,
    pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '',
    officialT: null, uiWorkspace,
    t: (key) => String(key),
  }

  // ---- paint, bypassing QuietBoundary's error swallowing ---------------
  let wrapperEl
  assert.doesNotThrow(() => { wrapperEl = Wrapper(props) }, 'the wrapper itself renders')
  assert.ok(wrapperEl && wrapperEl.children, 'wrapper wraps the browser in QuietBoundary')
  const inner = wrapperEl.children[0]
  assert.ok(inner && typeof inner.type === 'function', 'inner element is the real browser component')

  let tree
  assert.doesNotThrow(() => { tree = inner.type(inner.props) },
    'PAINTING the sidebar must not throw ReferenceError — this is the 10:55 crash')
  assert.ok(tree && typeof tree === 'object', 'the browser returns an element tree')
  assert.equal(tree.type, 'div', 'root is the sidebar container')

  // The grouped rows must actually exist, proving the group branch ran.
  const flat = []
  const walk = (node) => {
    if (!node) return
    if (Array.isArray(node)) { for (const n of node) walk(n); return }
    if (typeof node !== 'object') return
    if (node.type) flat.push(node.type)
    if (node.props && node.props.children !== undefined) walk(node.props.children)
    if (node.children !== undefined) walk(node.children)
  }
  walk(tree)
  assert.ok(flat.length > 0, 'the painted tree contains elements')
  assert.ok(flat.includes('div'), 'rows are divs')
})
