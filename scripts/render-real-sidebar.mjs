// 用真实的 workspace.json + session 缓存渲染一次侧栏，统计实际渲染出的每一行。
// 目的：回答"未分组太多"到底是数据问题还是渲染问题。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const DSH = 'C:/Users/Andy/.dsh'
const CLIENT = 'C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js'
const text = fs.readFileSync(CLIENT, 'utf8')

const reg = JSON.parse(fs.readFileSync(path.join(DSH, 'storages/workspace.json'), 'utf8'))
const CACHE = path.join(DSH, 'storages/session_projcache/sessions')

// ---- 真实数据 ----
const items = Object.entries(reg.tables.workspaces).map(([workspaceId, r]) => ({
  workspaceId,
  title: r.title,
  path: r.path,
  sessionIds: r.sessionIds || [],
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
    id: sid,
    title: val('title', ''),
    blank: val('blank', false) === true,
    origin: val('origin', 'user'),
    updatedAt: Number(val('updatedAt', 0)) || 0,
  }
}
console.log('真实工作区:', items.length, '| 缓存会话:', ids.length, '| 已归属:', accounted.size)

const archivedSessionIds = reg.global.archivedSessionIds || []
const pinnedSessionIds = reg.global.pinnedSessionIds || []

// ---- 渲染 ----
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
    prefs: {}, styling: {}, groupBy: 'workspace-tree', orderBy: 'manual',
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

// 统计渲染行
const stats = { ungroupedLabel: 0, sessionRows: [], workspaceRows: [], folderRows: [] }
const walk = (n, depth = 0) => {
  if (!n || depth > 60) return
  if (Array.isArray(n)) { n.forEach((c) => walk(c, depth + 1)); return }
  if (typeof n !== 'object') return
  if (typeof n.type === 'function') {
    const nm = n.type.name || ''
    if (nm === 'SessionRow') stats.sessionRows.push(n.props.node.id)
    if (nm === 'WorkspaceRow') stats.workspaceRows.push(n.props.workspace.title)
    if (nm === 'FolderRow') stats.folderRows.push(n.props.node.name)
  }
  if (n.props && n.props.children !== undefined) walk(n.props.children, depth + 1)
  if (n.children !== undefined) walk(n.children, depth + 1)
}
walk(tree)

console.log()
console.log('=== 实际渲染 ===')
console.log('  工作区行:', stats.workspaceRows.length)
console.log('  文件夹/组行:', stats.folderRows.length)
console.log('  会话行:', stats.sessionRows.length)
const shownUngrouped = stats.sessionRows.filter((id) => !accounted.has(id))
console.log('  未分组会话行:', shownUngrouped.length)
for (const id of shownUngrouped) {
  const s = byId[id] || {}
  console.log('    ', id.slice(0, 26), '|', String(s.title || '(无标题)').slice(0, 40))
}
