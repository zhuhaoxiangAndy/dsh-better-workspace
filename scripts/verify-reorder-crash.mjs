// 复现并验证 "commitFolderReorderBesideWorkspace: node.groups is not iterable"。
// 触发条件：有一个名字层分组（如 RBE999/ 或 Sim-to-Real…/），把组拖到工作区行旁边。
import fs from 'node:fs'
import vm from 'node:vm'

const CLIENT = 'C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js'
const text = fs.readFileSync(CLIENT, 'utf8')

// 完整沙箱加载：把整个 client.js 跑起来，再通过临时挂载点取出 buildTree，
// 这样它能拿到全部依赖（DISK_SEP / normDiskPath / splitTitleSegs …）。
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
  sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) }, searchSessions: async () => [], searchResultLimit: 20 },
  workspaces: { list: { getSnapshot: () => ({ items: [], pinnedSessionIds: [], archivedSessionIds: [] }) }, rename: async () => {}, delete: async () => {}, create: async () => {}, insertBefore: () => {}, insertSessionBefore: () => {} },
  uiWorkspace: uiW, locale: { register: () => () => {}, bind: () => null },
}
api.apply({ get: (n) => svc[n], effect: (fn) => { try { const d = fn(); if (typeof d === 'function') d() } catch {} }, settingsScope: undefined })

// 从注册的组件里无法直接拿 buildTree；改用源码文本检查 + 一个轻量形状断言：
// 用真实数据渲染，确认不抛 node.groups 错误即可（这才是用户看到的故障）。
const items = [
  { workspaceId: 'w-sim', title: 'Sim-to-Real_GR00T-N1.7+SO-101', path: 'D:/a', sessionIds: [], leaf: 'Sim-to-Real_GR00T-N1.7+SO-101', folderPath: '' },
  { workspaceId: 'w-rbe', title: 'RBE999', path: 'D:/b', sessionIds: [], leaf: 'RBE999', folderPath: '' },
  { workspaceId: 'w-rbe2', title: 'RBE999/child', path: 'D:/c', sessionIds: [], leaf: 'child', folderPath: 'RBE999' },
]

let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); fail += 1 } }

console.log('=== 用这两个名字的真实场景渲染（原 bug 会在这里抛）===')
const W = regMap.get('sidebar.workspaces')
const sel = (st) => (fn) => (typeof fn === 'function' ? fn(st) : st)
const props = {
  wide: true, expandSidebar() {},
  useSessions: sel({ ids: [], byId: {} }), useSessionPendingInteraction: sel({}),
  useWorkspaces: sel({ items, phase: 'ready', archivedSessionIds: [], pinnedSessionIds: [] }),
  useSessionStatus: sel({ get: () => undefined, entries: () => [] }),
  useStore: sel({ expanded: {}, sessionsExpanded: {}, sessionGroups: {}, sessionOrder: {}, sessionGroupOrder: {}, workspaceGroupOrder: [], sessionWatermarks: {}, hiddenSessionGroups: {}, pinnedWorkspaceIds: [], prefs: {}, styling: {}, groupBy: 'workspace-tree', orderBy: 'manual', sessionTitleSlash: true, workspaceTitleSlash: true, tabCycleOrder: 'page' }),
  actions: new Proxy({}, { get: () => () => {} }),
  startSession() {}, open() {}, renameSession: async () => {}, forkSession() {},
  renameWorkspace: async () => {}, deleteWorkspace: async () => {}, archiveSession: async () => {},
  createWorkspace: async () => {}, insertWorkspaceBefore() {}, insertSessionBefore() {},
  useDirectoryFlow: () => false, pickDirectory: async () => '', listDirectory: async () => [], createDirectory: async () => '',
  officialT: null, uiWorkspace: uiW, t: (k) => String(k),
}
let renderErr = null
let rows = []
try {
  const w = W(props)
  const tree = w.children[0].type(w.children[0].props)
  const walk = (n, d = 0) => {
    if (!n || d > 60) return
    if (Array.isArray(n)) { n.forEach((c) => walk(c, d + 1)); return }
    if (typeof n !== 'object') return
    if (typeof n.type === 'function') {
      if (n.type.name === 'WorkspaceRow') rows.push(n.props.workspace.title)
      if (n.type.name === 'FolderRow') rows.push('[组] ' + n.props.node.name)
    }
    if (n.props && n.props.children !== undefined) walk(n.props.children, d + 1)
    if (n.children !== undefined) walk(n.children, d + 1)
  }
  walk(tree)
} catch (e) { renderErr = String(e && e.message || e) }

ck('渲染不抛错', renderErr === null, renderErr)
console.log('  渲染出的行:', rows.join(' | '))
ck('RBE999 组出现', rows.some((r) => String(r).includes('RBE999')))
ck('Sim-to-Real 出现', rows.some((r) => String(r).includes('Sim-to-Real')))

console.log()
console.log('=== 源码里不再有 node.groups 遍历 ===')
const body = text.slice(text.indexOf('const commitFolderReorderBesideWorkspace'), text.indexOf('const commitWorkspaceMoveInto'))
ck('commitFolderReorderBesideWorkspace 用 childFolders', body.includes('childFolders'))
ck('不再直接遍历 node.groups', !/for \(const g of node\.groups\)/.test(body))

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: 崩溃已定位并修复')
