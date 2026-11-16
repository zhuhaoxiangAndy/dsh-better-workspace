// 目标第 6 项的深层验证：CUMCM26 不只要"出现"，还必须是**正确层级**的组节点，
// 且它的 4 个成员真的挂在它下面。
//
// 之前的验证只看组名是否出现在渲染结果里，证明不了：
//   - 它是不是 Project > ADS999-Model > CUMCM26 的三层嵌套
//   - 成员是不是它的子级而不是兄弟
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
const archivedSessionIds = reg.global.archivedSessionIds || []
const pinnedSessionIds = reg.global.pinnedSessionIds || []

const ids = []; const byId = {}
for (const f of fs.readdirSync(CACHE)) {
  if (!f.endsWith('.json')) continue
  const sid = f.slice(0, -5)
  let rec
  try { rec = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')).record || {} } catch { continue }
  const rows = rec.rows || {}
  const val = (k, d) => (rows[k] && rows[k].val !== undefined ? rows[k].val : d)
  ids.push(sid)
  byId[sid] = { id: sid, title: val('title', ''), blank: val('blank', false) === true, origin: val('origin', 'user'), updatedAt: Number(val('updatedAt', 0)) || 0 }
}

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

// 建立 (depth, name) 序列，用来验证层级
const seq = []
const walk = (n, d = 0) => {
  if (!n || d > 80) return
  if (Array.isArray(n)) { n.forEach((c) => walk(c, d + 1)); return }
  if (typeof n !== 'object') return
  if (typeof n.type === 'function') {
    const nm = n.type.name || ''
    if (nm === 'FolderRow') seq.push({ kind: 'folder', name: n.props.node.name, depth: n.props.depth, path: n.props.node.path })
    if (nm === 'WorkspaceRow') seq.push({ kind: 'ws', title: n.props.workspace.title, depth: n.props.depth })
  }
  if (n.props && n.props.children !== undefined) walk(n.props.children, d + 1)
  if (n.children !== undefined) walk(n.children, d + 1)
}
walk(tree)

let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); fail += 1 } }

console.log('=== 真实数据中 Project 子树渲染出的层级 ===')
for (const r of seq.filter((x) => (x.path || x.title || '').includes('Project'))) {
  console.log('  ' + '  '.repeat(r.depth) + (r.kind === 'folder' ? '[组] ' + r.name : '[WS] ' + String(r.title).slice(0, 50)))
}

console.log()
const proj = seq.find((r) => r.kind === 'folder' && r.name === 'Project')
const ads = seq.find((r) => r.kind === 'folder' && r.name === 'ADS999-Model')
const cumcm = seq.find((r) => r.kind === 'folder' && r.name === 'CUMCM26')

ck('Project 组节点存在', !!proj)
ck('ADS999-Model 组节点存在', !!ads)
ck('CUMCM26 组节点存在', !!cumcm, 'CUMCM26 没有作为组节点出现')

if (proj && ads && cumcm) {
  console.log()
  console.log('=== 层级检查 ===')
  console.log('  Project depth       =', proj.depth)
  console.log('  ADS999-Model depth  =', ads.depth)
  console.log('  CUMCM26 depth       =', cumcm.depth)
  ck('ADS999-Model 是 Project 的直接子级', ads.depth === proj.depth + 1, ads.depth)
  ck('CUMCM26 是 ADS999-Model 的直接子级', cumcm.depth === ads.depth + 1, cumcm.depth)
  ck('CUMCM26 路径正确', String(cumcm.path) === 'Project/ADS999-Model/CUMCM26', cumcm.path)
}

console.log()
console.log('=== CUMCM26 的成员（4 个 A-DsDsh-*）===')
const members = seq.filter((r) => r.kind === 'ws' && String(r.title).includes('CUMCM26/'))
for (const m of members) console.log('  ' + '  '.repeat(m.depth) + String(m.title))
ck('4 个成员都在', members.length === 4, members.length)
if (cumcm && members.length > 0) {
  ck('所有成员 depth 都大于 CUMCM26', members.every((m) => m.depth > cumcm.depth),
    members.map((m) => m.depth).join(','))
}

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: CUMCM26 是正确的三层嵌套组，4 个成员挂在它下面')
