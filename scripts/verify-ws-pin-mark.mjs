// 验证工作区级置顶：排序 + 视觉标记 + 与 session pin 互不干扰。
import fs from 'node:fs'
import vm from 'node:vm'

const text = fs.readFileSync('C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js', 'utf8')
let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); fail += 1 } }

function render({ pinnedWs = [], pinnedSessions = [] } = {}) {
  let cap = null
  const store = new Map()
  const sandbox = {
    window: { __ModuleLoader__: { load: (e) => { cap = e } } },
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
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

  const ids = ['s1', 's2']
  const byId = {
    s1: { id: 's1', title: 'A/one', blank: false, updatedAt: 20 },
    s2: { id: 's2', title: 'B/two', blank: false, updatedAt: 10 },
  }
  const ws = [
    { workspaceId: 'w1', title: 'GrpA', path: 'D:/a', sessionIds: ['s1'], leaf: 'GrpA' },
    { workspaceId: 'w2', title: 'GrpB', path: 'D:/b', sessionIds: ['s2'], leaf: 'GrpB' },
  ]
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
    workspaces: { list: { getSnapshot: () => ({ items: ws, pinnedSessionIds: pinnedSessions, archivedSessionIds: [] }) }, rename: async () => {}, delete: async () => {}, create: async () => {}, insertBefore: () => {}, insertSessionBefore: () => {} },
    uiWorkspace: uiW, locale: { register: () => () => {}, bind: () => null },
  }
  api.apply({ get: (n) => svc[n], effect: (fn) => { try { const d = fn(); if (typeof d === 'function') d() } catch {} }, settingsScope: undefined })

  const W = reg.get('sidebar.workspaces')
  const sel = (st) => (fn) => (typeof fn === 'function' ? fn(st) : st)
  const props = {
    wide: true, expandSidebar() {},
    useSessions: sel({ ids, byId }), useSessionPendingInteraction: sel({}),
    useWorkspaces: sel({ items: ws, phase: 'ready', archivedSessionIds: [], pinnedSessionIds: pinnedSessions }),
    useSessionStatus: sel({ get: () => undefined, entries: () => [] }),
    useStore: sel({
      expanded: {}, sessionsExpanded: { w1: true, w2: true }, sessionGroups: {}, sessionOrder: {},
      sessionGroupOrder: {}, workspaceGroupOrder: [], sessionWatermarks: {}, hiddenSessionGroups: {},
      pinnedWorkspaceIds: pinnedWs, prefs: {}, styling: {}, groupBy: 'workspace-tree', orderBy: 'manual',
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
  const seq = []
  const marks = []
  const walk = (n, d = 0) => {
    if (!n || d > 60) return
    if (Array.isArray(n)) { n.forEach((c) => walk(c, d + 1)); return }
    if (typeof n !== 'object') return
    if (typeof n.type === 'function') {
      if (n.type.name === 'WorkspaceRow') seq.push('WS:' + String(n.props.workspace.title))
      if (n.type.name === 'FolderRow') seq.push('F:' + n.props.node.name)
    }
    const cls = String((n.props && n.props.className) || '')
    if (cls.includes('bw-pin-mark')) marks.push(seq[seq.length - 1] || '?')
    if (n.props && n.props.children !== undefined) walk(n.props.children, d + 1)
    if (n.children !== undefined) walk(n.children, d + 1)
    // 行组件的内部结构只有调用后才存在，必须展开。
    if (typeof n.type === 'function' && n.props) {
      let sub = null
      try { sub = n.type(n.props) } catch { sub = null }
      if (sub) walk(sub, d + 1)
    }
  }
  walk(tree)
  return { seq, marks }
}

console.log('=== 无置顶 ===')
const base = render()
console.log('  ', base.seq.join(' '))
console.log('  置顶标记:', base.marks.length)

console.log()
console.log('=== 置顶工作区 w2（原本在后）===')
const r2 = render({ pinnedWs: ['w2'] })
console.log('  ', r2.seq.join(' '))
console.log('  置顶标记:', r2.marks.join(' '))
ck('置顶工作区排到最前', r2.seq[0] === 'WS:GrpB', r2.seq[0])
ck('置顶工作区有视觉标记', r2.marks.some((m) => String(m).includes('GrpB')), r2.marks.join(','))

console.log()
console.log('=== 会话置顶与工作区置顶互不干扰 ===')
const r3 = render({ pinnedWs: ['w2'], pinnedSessions: ['s1'] })
console.log('  ', r3.seq.join(' '))
ck('两者同时生效', r3.seq.includes('WS:GrpB') && r3.marks.length >= 1)

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: 工作区置顶排序与标记都正确')
