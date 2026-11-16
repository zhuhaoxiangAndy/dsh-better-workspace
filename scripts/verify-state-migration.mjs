// 验证外观与其它偏好在「旧版本持久化状态」下不会丢失或崩溃。
//
// 依据源码注释：
//   hydration REPLACES the state with the persisted whole value —
//   init defaults never merge.
// 这意味着一个用 v0.20 存下的状态（没有 hiddenSessionGroups / pinnedWorkspaceIds /
// sessionWatermarks 等新键）加载后，那些键就是 undefined。
// 只要有一个 selector 直接解引用，整个侧栏就白屏。
import fs from 'node:fs'
import vm from 'node:vm'

const CLIENT = 'C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js'
const text = fs.readFileSync(CLIENT, 'utf8')

let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); fail += 1 } }

// 模拟三份不同的持久化快照
const SNAPSHOTS = {
  'v0.20（无新键）': { expanded: {}, prefs: { compactChains: true }, styling: {}, groupBy: 'workspace-tree', orderBy: 'manual' },
  'v0.30（部分键）': { expanded: {}, sessionGroups: {}, sessionOrder: {}, prefs: {}, styling: {}, groupBy: 'workspace-tree', orderBy: 'manual', tabCycleOrder: 'page' },
  '完全空': {},
}

function renderWith(snapshot) {
  let cap = null
  const store = new Map()
  const sandbox = {
    window: { __ModuleLoader__: { load: (e) => { cap = e } } },
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: {
      getItem: (k) => (k.includes('betterWorkspace') && snapshot !== null ? JSON.stringify(snapshot) : (store.has(k) ? store.get(k) : null)),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), clear: () => store.clear(),
    },
    document: { querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, documentElement: { style: {} }, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    navigator: { clipboard: { writeText: async () => {} }, language: 'zh' },
    getComputedStyle: () => ({ color: 'rgb(255,255,255)' }),
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: () => {},
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
  }
  vm.createContext(sandbox)
  vm.runInContext(text, sandbox)

  class C { constructor(p) { this.props = p } setState() {} }
  const react = {
    Component: C, PureComponent: C, Fragment: 'F',
    createElement: (t, p, ...c) => ({ type: t, props: p, children: c }),
    useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
    useEffect: () => {}, useLayoutEffect: () => {}, useRef: (i) => ({ current: i }),
    useMemo: (f) => f(), useCallback: (f) => f, useContext: () => ({}),
    memo: (c) => c, forwardRef: (f) => f,
    createContext: (v) => ({ Provider: 'P', _currentValue: v }),
    Children: { map: (c, f) => (Array.isArray(c) ? c.map(f) : []), toArray: (c) => (Array.isArray(c) ? c : []) },
  }
  const PRIM = new Proxy({}, { get: (_t, n) => {
    if (typeof n !== 'string') return undefined
    const F = () => null
    Object.defineProperty(F, 'name', { value: n })
    return F
  }})
  const api = cap.factory((n) => {
    if (n === 'react') return react
    if (n === '@deepseek-ai/dsh-client-store') return { defineStore: (d) => d }
    if (n === '@deepseek-ai/dsh-client-ui-primitives') return PRIM
    return new Proxy({}, { get: () => new Proxy(() => null, { get: () => () => null, apply: () => null }) })
  })

  const ids = ['s1']
  const byId = { s1: { id: 's1', title: 'g/x', blank: false, updatedAt: 1 } }
  const ws = [{ workspaceId: 'w1', title: 'W', path: 'C:/w', sessionIds: ids }]
  const reg = new Map(); let pend = null
  const slots = { register: (o, c) => { if (pend) reg.set(pend, c); return () => {} }, inject: (n, t) => { pend = n; try { if (typeof t === 'function' && t.length === 0) t() } catch {} pend = null; return () => {} }, entries: () => [], subscribe: () => () => {} }
  const uiW = { openSession() {}, startSession() {}, forkSession() {}, archiveSession: async () => {}, pinSession: async () => {}, unpinSession: async () => {}, unarchiveSession: async () => {}, pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '' }
  const svc = { slots, sessions: { list: { getSnapshot: () => ({ ids, byId }) }, searchSessions: async () => [], searchResultLimit: 20 }, workspaces: { list: { getSnapshot: () => ({ items: ws, pinnedSessionIds: [], archivedSessionIds: [] }) }, rename: async () => {}, delete: async () => {}, create: async () => {}, insertBefore: () => {}, insertSessionBefore: () => {} }, uiWorkspace: uiW, locale: { register: () => () => {}, bind: () => null } }
  api.apply({ get: (n) => svc[n], effect: (fn) => { try { const d = fn(); if (typeof d === 'function') d() } catch {} }, settingsScope: undefined })

  const W = reg.get('sidebar.workspaces')
  const sel = (st) => (fn) => (typeof fn === 'function' ? fn(st) : st)
  const props = {
    wide: true, expandSidebar() {},
    useSessions: sel({ ids, byId }), useSessionPendingInteraction: sel({}),
    useWorkspaces: sel({ items: ws, phase: 'ready', archivedSessionIds: [], pinnedSessionIds: [] }),
    useSessionStatus: sel({ get: () => undefined, entries: () => [] }),
    useStore: sel(snapshot),
    actions: new Proxy({}, { get: () => () => {} }),
    startSession() {}, open() {}, renameSession: async () => {}, forkSession() {},
    renameWorkspace: async () => {}, deleteWorkspace: async () => {}, archiveSession: async () => {},
    createWorkspace: async () => {}, insertWorkspaceBefore() {}, insertSessionBefore() {},
    useDirectoryFlow: () => false, pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '',
    officialT: null, uiWorkspace: uiW, t: (k) => String(k),
  }
  const w = W(props)
  const tree = w.children[0].type(w.children[0].props)
  return tree
}

console.log('=== 旧版持久化状态下渲染（不能白屏）===')
for (const [name, snap] of Object.entries(SNAPSHOTS)) {
  let ok = true
  let err = ''
  try {
    const tree = renderWith(snap)
    ok = !!tree
  } catch (e) {
    ok = false
    err = String(e && e.message || e)
  }
  ck(name + ' 能渲染', ok, err)
}

console.log()
console.log('=== 每个 selector 都必须有回退 ===')
const fallbacks = [
  ["useStore(s => s.sessionGroups) || {}", 'sessionGroups'],
  ["useStore(s => s.sessionWatermarks) || {}", 'sessionWatermarks'],
  ["useStore(s => s.hiddenSessionGroups) || {}", 'hiddenSessionGroups'],
  ["useStore(s => s.pinnedWorkspaceIds) || []", 'pinnedWorkspaceIds'],
  ["useStore(s => s.styling) || {}", 'styling'],
  ["useStore(s => s.prefs) || {}", 'prefs'],
]
for (const [needle, label] of fallbacks) {
  ck(label + ' 读取有回退', text.includes(needle), needle)
}

console.log()
console.log('=== 外观写入会进入持久化状态 ===')
// setStyling 必须同时调用 store action（由 storeKit 的 persist 接管写盘），
// 否则重启后自定义外观就丢了 —— 那正是"设置无效"的另一种表现。
ck('setStyling 同时写 store', text.includes("if (actions && typeof actions.setStyling === 'function') actions.setStyling(key, value)"))
ck('setStyling 维护本地副本', text.includes('const next = { ...stylingMap }'))
ck('清除时删除键而非留空', text.includes('if (value === null) delete next[key]'))
ck('store 声明了 persist 键', text.includes("persist: 'dsh.betterWorkspace.view.v1'"))
ck('persist 键带版本号（可演进）', /persist: 'dsh\.betterWorkspace\.view\.v\d+'/.test(text))

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: 旧版状态不会白屏，外观偏好可安全加载且会持久化')
