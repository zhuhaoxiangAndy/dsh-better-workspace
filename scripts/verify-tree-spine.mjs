// 验证 tree 竖线：多层嵌套会话组的成员，必须画出每一条祖先色带。
import fs from 'node:fs'
import vm from 'node:vm'

const CLIENT = 'C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js'
const text = fs.readFileSync(CLIENT, 'utf8')

let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x ? ' -> ' + x : '')); fail += 1 } }

function render() {
  let cap = null
  const store = new Map()
  const sandbox = {
    window: { __ModuleLoader__: { load: (e) => { cap = e } } },
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
    document: { addEventListener() {}, removeEventListener() {}, documentElement: { style: {} }, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
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

  // 三层嵌套：A/x (A/B/x)
  const ids = ['deep', 'shallow']
  const byId = {
    deep: { id: 'deep', title: 'A/B/deep', blank: false, updatedAt: 20 },
    shallow: { id: 'shallow', title: 'A/solo', blank: false, updatedAt: 10 },
  }
  const ws = [{ workspaceId: 'w1', title: 'W', path: 'C:/w', sessionIds: ids }]
  const reg = new Map(); let pend = null
  const slots = {
    register: (o, c) => { if (pend) reg.set(pend, c); return () => {} },
    inject: (n, t) => { pend = n; try { if (typeof t === 'function' && t.length === 0) t() } catch {} pend = null; return () => {} },
    entries: () => [], subscribe: () => () => {},
  }
  const uiW = { openSession() {}, startSession() {}, forkSession() {}, archiveSession: async () => {}, pinSession: async () => {}, unpinSession: async () => {}, unarchiveSession: async () => {}, pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '' }
  const svc = {
    slots,
    sessions: { list: { getSnapshot: () => ({ ids, byId }) }, searchSessions: async () => [], searchResultLimit: 20 },
    workspaces: { list: { getSnapshot: () => ({ items: ws, pinnedSessionIds: [], archivedSessionIds: [] }) }, rename: async () => {}, delete: async () => {}, create: async () => {}, insertBefore: () => {}, insertSessionBefore: () => {} },
    uiWorkspace: uiW, locale: { register: () => () => {}, bind: () => null },
  }
  api.apply({ get: (n) => svc[n], effect: (fn) => { try { const d = fn(); if (typeof d === 'function') d() } catch {} }, settingsScope: undefined })

  const W = reg.get('sidebar.workspaces')
  const sel = (st) => (fn) => (typeof fn === 'function' ? fn(st) : st)
  const props = {
    wide: true, expandSidebar() {},
    useSessions: sel({ ids, byId }), useSessionPendingInteraction: sel({}),
    useWorkspaces: sel({ items: ws, phase: 'ready', archivedSessionIds: [], pinnedSessionIds: [] }),
    useSessionStatus: sel({ get: () => undefined, entries: () => [] }),
    useStore: sel({
      expanded: {}, sessionsExpanded: { w1: true }, sessionGroups: {}, sessionOrder: {},
      sessionGroupOrder: {}, workspaceGroupOrder: [], sessionWatermarks: {}, hiddenSessionGroups: {},
      pinnedWorkspaceIds: [], prefs: {}, styling: {}, groupBy: 'workspace-tree', orderBy: 'manual',
      sessionTitleSlash: true, workspaceTitleSlash: true, tabCycleOrder: 'page',
    }),
    actions: new Proxy({}, { get: () => () => {} }),
    startSession() {}, open() {}, renameSession: async () => {}, forkSession() {},
    renameWorkspace: async () => {}, deleteWorkspace: async () => {}, archiveSession: async () => {},
    createWorkspace: async () => {}, insertWorkspaceBefore() {}, insertSessionBefore() {},
    useDirectoryFlow: () => false, pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '',
    officialT: null, uiWorkspace: uiW, t: (k) => String(k),
  }
  const w = W(props)
  const tree = w.children[0].type(w.children[0].props)

  const rows = []
  const walk = (n, d = 0) => {
    if (!n || d > 60) return
    if (Array.isArray(n)) { n.forEach((c) => walk(c, d + 1)); return }
    if (typeof n !== 'object') return
    if (typeof n.type === 'function' && n.type.name === 'SessionRow') rows.push(n.props)
    if (typeof n.type === 'function' && n.type.name === 'SessionGroupRow') rows.push({ __group: n.props.name, depth: n.props.depth })
    if (n.props && n.props.children !== undefined) walk(n.props.children, d + 1)
    if (n.children !== undefined) walk(n.children, d + 1)
  }
  walk(tree)
  return rows
}

console.log('=== 多层嵌套的色链 ===')
const rows = render()
for (const r of rows) {
  if (r.__group) console.log('  [组]', '  '.repeat(r.depth || 0) + r.__group)
  else console.log('  [会话]', '  '.repeat(r.depth || 0) + (r.node.id), '| railChain =', JSON.stringify(r.railChain))
}

const deep = rows.find((r) => r.node && r.node.id === 'deep')
const shallow = rows.find((r) => r.node && r.node.id === 'shallow')

ck('深层成员有 railChain', !!deep && Array.isArray(deep.railChain))
ck('深层成员链长 2（A 和 A/B 各一条）', deep && deep.railChain.length === 2, deep ? String(deep.railChain.length) : 'none')
ck('浅层成员链长 1', shallow && Array.isArray(shallow.railChain) && shallow.railChain.length === 1,
  shallow ? String(shallow.railChain && shallow.railChain.length) : 'none')
ck('两层颜色不同（各用自己组的色）', deep && deep.railChain[0] !== deep.railChain[1])

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: 竖线按祖先逐层绘制')
