// 验证「归档会话显示 & 彻底删除」在真实数据上真的工作：
//   1. 默认（showArchived=false）归档会话不渲染
//   2. 开启后归档会话渲染出来，且带归档标记
//   3. 归档会话的右键菜单里有「取消归档」和「彻底删除」
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const DSH = 'C:/Users/Andy/.dsh'
const CLIENT = 'C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js'
const text = fs.readFileSync(CLIENT, 'utf8')

const reg = JSON.parse(fs.readFileSync(path.join(DSH, 'storages/workspace.json'), 'utf8'))
const CACHE = path.join(DSH, 'storages/session_projcache/sessions')

const items = Object.entries(reg.tables.workspaces).map(([workspaceId, r]) => ({
  workspaceId, title: r.title, path: r.path, sessionIds: r.sessionIds || [],
}))
const accounted = new Set()
for (const w of items) for (const s of w.sessionIds) accounted.add(s)

const ids = []
const byId = {}
for (const f of fs.readdirSync(CACHE)) {
  if (!f.endsWith('.json')) continue
  const sid = f.slice(0, -5)
  let rec
  try { rec = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')).record || {} } catch { continue }
  const rows = rec.rows || {}
  const val = (k, d) => (rows[k] && rows[k].val !== undefined ? rows[k].val : d)
  ids.push(sid)
  byId[sid] = {
    id: sid, title: val('title', ''), blank: val('blank', false) === true,
    origin: val('origin', 'user'), updatedAt: Number(val('updatedAt', 0)) || 0,
  }
}
const archivedSessionIds = reg.global.archivedSessionIds || []
const pinnedSessionIds = reg.global.pinnedSessionIds || []

function render({ showArchived }) {
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

  const regMap = new Map(); let pend = null
  const slots = {
    register: (o, c) => { if (pend) regMap.set(pend, c); return () => {} },
    inject: (n, t) => { pend = n; try { if (typeof t === 'function' && t.length === 0) t() } catch {} pend = null; return () => {} },
    entries: () => [], subscribe: () => () => {},
  }
  const uiW = { openSession() {}, startSession() {}, forkSession() {}, archiveSession: async () => {}, pinSession: async () => {}, unpinSession: async () => {}, unarchiveSession: async () => {}, pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '' }
  const svc = {
    slots,
    sessions: { list: { getSnapshot: () => ({ ids, byId }) }, searchSessions: async () => [], searchResultLimit: 20 },
    workspaces: { list: { getSnapshot: () => ({ items, pinnedSessionIds, archivedSessionIds }) }, rename: async () => {}, delete: async () => {}, create: async () => {}, insertBefore: () => {}, insertSessionBefore: () => {} },
    uiWorkspace: uiW, locale: { register: () => () => {}, bind: () => null },
  }
  api.apply({ get: (n) => svc[n], effect: (fn) => { try { const d = fn(); if (typeof d === 'function') d() } catch {} }, settingsScope: undefined })

  const W = regMap.get('sidebar.workspaces')
  const sel = (st) => (fn) => (typeof fn === 'function' ? fn(st) : st)
  const props = {
    wide: true, expandSidebar() {},
    useSessions: sel({ ids, byId }), useSessionPendingInteraction: sel({}),
    useWorkspaces: sel({ items, phase: 'ready', archivedSessionIds, pinnedSessionIds }),
    useSessionStatus: sel({ get: () => undefined, entries: () => [] }),
    useStore: sel({
      expanded: {}, sessionsExpanded: {}, sessionGroups: {}, sessionOrder: {}, sessionGroupOrder: {},
      workspaceGroupOrder: [], sessionWatermarks: {}, hiddenSessionGroups: {}, pinnedWorkspaceIds: [],
      prefs: showArchived ? { showArchived: true } : {}, styling: {},
      groupBy: 'workspace-tree', orderBy: 'manual',
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
  const walk = (n, depth = 0) => {
    if (!n || depth > 60) return
    if (Array.isArray(n)) { n.forEach((c) => walk(c, depth + 1)); return }
    if (typeof n !== 'object') return
    if (typeof n.type === 'function' && n.type.name === 'SessionRow') rows.push(n.props.node)
    if (n.props && n.props.children !== undefined) walk(n.props.children, depth + 1)
    if (n.children !== undefined) walk(n.children, depth + 1)
  }
  walk(tree)
  return rows
}

let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x ? ' -> ' + x : '')); fail += 1 } }

console.log('=== 归档集合 ===')
const archivedSet = new Set(archivedSessionIds)
console.log('  归档会话数:', archivedSessionIds.length)

console.log()
console.log('=== 1. 默认不显示归档会话 ===')
const off = render({ showArchived: false })
const shownArchived = off.filter((r) => archivedSet.has(r.id))
console.log('  渲染会话行:', off.length)
console.log('  其中归档的:', shownArchived.length)
ck('默认不渲染归档会话（当前打开的除外）', shownArchived.length === 0, shownArchived.map((r) => r.id.slice(0, 12)).join(','))

console.log()
console.log('=== 2. 开启后显示归档会话 ===')
const on = render({ showArchived: true })
const onArchived = on.filter((r) => archivedSet.has(r.id))
console.log('  渲染会话行:', on.length)
console.log('  其中归档的:', onArchived.length)
ck('开启后归档会话出现', onArchived.length > 0, '归档 ' + archivedSessionIds.length + ' 个却渲染 0 个')

console.log()
console.log('=== 3. 菜单里有取消归档与彻底删除 ===')
ck('取消归档菜单项存在', text.includes("id: 'unarchive'"))
ck('彻底删除菜单项存在', text.includes("id: 'delete-forever'"))
ck('彻底删除是 danger 样式', text.includes('danger: true'))
ck('归档会话走 unarchive 而非 archive', text.includes("archivedSet.has(ctx.payload.id)"))

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: 归档显示与彻底删除均可用')
