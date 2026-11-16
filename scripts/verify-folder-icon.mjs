// 目标 4：工作区行必须产出原生文件夹图标；图标不可用时必须有兜底，
// 不能变成"什么都没有"（那正是用户说的"三角标"观感问题）。
import fs from 'node:fs'
import vm from 'node:vm'

const CLIENT = 'C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js'
const text = fs.readFileSync(CLIENT, 'utf8')
let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x ? ' -> ' + x : '')); fail += 1 } }

function renderWith(primitivesMode) {
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
  const PRIM = primitivesMode === 'full'
    ? new Proxy({}, { get: (_t, n) => {
        if (typeof n !== 'string') return undefined
        const F = () => null
        Object.defineProperty(F, 'name', { value: n })
        return F
      }})
    : {}
  const api = cap.factory((n) => {
    if (n === 'react') return react
    if (n === '@deepseek-ai/dsh-client-store') return { defineStore: (d) => d }
    if (n === '@deepseek-ai/dsh-client-ui-primitives') return PRIM
    return new Proxy({}, { get: () => new Proxy(() => null, { get: () => () => null, apply: () => null }) })
  })
  const ids = ['s1']
  const byId = { s1: { id: 's1', title: 'x', blank: false, updatedAt: 1 } }
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
    useStore: sel({ expanded: {}, sessionsExpanded: { w1: true }, sessionGroups: {}, sessionOrder: {}, sessionGroupOrder: {}, workspaceGroupOrder: [], sessionWatermarks: {}, hiddenSessionGroups: {}, pinnedWorkspaceIds: [], prefs: {}, styling: {}, groupBy: 'workspace-tree', orderBy: 'manual', sessionTitleSlash: true, workspaceTitleSlash: true, tabCycleOrder: 'page' }),
    actions: new Proxy({}, { get: () => () => {} }),
    startSession() {}, open() {}, renameSession: async () => {}, forkSession() {},
    renameWorkspace: async () => {}, deleteWorkspace: async () => {}, archiveSession: async () => {},
    createWorkspace: async () => {}, insertWorkspaceBefore() {}, insertSessionBefore() {},
    useDirectoryFlow: () => false, pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '',
    officialT: null, uiWorkspace: uiW, t: (k) => String(k),
  }
  const w = W(props)
  const tree = w.children[0].type(w.children[0].props)
  const out = []
  const walk = (n, d = 0) => {
    if (!n || d > 60) return
    if (Array.isArray(n)) { n.forEach((c) => walk(c, d + 1)); return }
    if (typeof n !== 'object') return
    if (typeof n.type === 'function') out.push({ comp: n.type.name })
    const cls = String((n.props && n.props.className) || '')
    if (cls.includes('bw-folder-slot')) out.push({ slot: true, child: n.props.children })
    if (cls.includes('bw-chevron')) out.push({ chevron: true })
    if (cls.includes('bw-icon-glyph')) out.push({ glyph: true, text: n.children !== undefined ? n.children : n.props.children })
    if (n.props && n.props.children !== undefined) walk(n.props.children, d + 1)
    if (n.children !== undefined) walk(n.children, d + 1)
    // WorkspaceRow 的内部结构只有调用组件后才存在，必须展开函数组件。
    if (typeof n.type === 'function' && n.props) {
      let sub = null
      try { sub = n.type(n.props) } catch { sub = null }
      if (sub) walk(sub, d + 1)
    }
  }
  walk(tree)
  return out
}

console.log('=== primitives 正常时 ===')
const full = renderWith('full')
console.log('  组件:', [...new Set(full.filter(x=>x.comp).map(x=>x.comp))].join(', '))
console.log('  文件夹槽位数:', full.filter((x) => x.slot).length)
console.log('  独立三角数 :', full.filter((x) => x.chevron).length)
ck('工作区行有文件夹槽位', full.some((x) => x.slot))
ck('不画独立三角（互斥）', !full.some((x) => x.chevron))

console.log()
console.log('=== primitives 缺失时（图标取不到）===')
const empty = renderWith('empty')
console.log('  文件夹槽位数:', empty.filter((x) => x.slot).length)
console.log('  独立三角数 :', empty.filter((x) => x.chevron).length)
ck('仍然有文件夹槽位（不消失）', empty.some((x) => x.slot))
// 图标缺失时 icon() 返回可读符号（▸/▾），折叠指示依然可见。
const glyphs = empty.filter((x) => x.glyph).map((x) => x.text)
console.log('  兜底符号:', JSON.stringify(glyphs))
ck('图标缺失时用可读符号兜底', glyphs.length > 0, '没有任何符号')

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: 文件夹图标与三角互斥且都有兜底')
