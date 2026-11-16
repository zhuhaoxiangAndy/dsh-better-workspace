// 重启后的界面核验（目标第 6 项）。
//
// 为什么需要它：本轮每一项修复都只能"重启后看屏幕"确认，而那是在考记忆。
// 这个脚本从运行中的渲染进程里读真实 DOM 与模块状态，把"看到了吗"变成可复跑的输出。
//
// 用法（DSH 需以调试端口启动，或把输出粘回来看）：
//   node scripts/verify-after-restart.mjs
//
// 若拿不到调试端口，脚本会明确说明"无法自动核验"，而不是假装通过。
import { execFileSync } from 'node:child_process'

const PORT = process.env.DSH_DEBUG_PORT || '9230'
const ENDPOINT = `http://127.0.0.1:${PORT}`

async function targets() {
  try {
    const res = await fetch(`${ENDPOINT}/json/list`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

console.log('=== DSH 界面核验（重启后） ===')
const list = await targets()
if (list.length === 0) {
  console.log(`  无法连接调试端口 ${PORT}。`)
  console.log('  这不是失败：说明未开远程调试，无法从外部读取 DOM。')
  console.log('  替代做法：在 DSH 里打开控制台执行 window.__bwsSelfCheck() 并把结果贴出来。')
  process.exit(0)
}
console.log('  调试目标:', list.length)

// 优先挑渲染进程（url 以 dsh:// 或 http 开头且不是 host）
const page = list.find((t) => /dsh:\/\/|localhost|127\.0\.0\.1/.test(String(t.url)) && t.webSocketDebuggerUrl)
if (!page) {
  console.log('  未找到可用页面目标')
  process.exit(0)
}
console.log('  页面:', String(page.url).slice(0, 60))

// 用 CDP 求值 window.__bwsSelfCheck()
const wsUrl = page.webSocketDebuggerUrl
let result = null
try {
  const { WebSocket } = await import('node:worker_threads').then(() => ({ WebSocket: globalThis.WebSocket }))
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
    setTimeout(() => reject(new Error('ws timeout')), 6000)
  })
  const reply = new Promise((resolve, reject) => {
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data))
        if (msg.id === 1) resolve(msg)
      } catch { /* ignore */ }
    })
    setTimeout(() => reject(new Error('cdp timeout')), 8000)
  })
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: 'typeof window.__bwsSelfCheck === "function" ? JSON.stringify(window.__bwsSelfCheck()) : "NO_PROBE"',
      returnByValue: true,
      awaitPromise: false,
    },
  }))
  const msg = await reply
  ws.close()
  const raw = msg?.result?.result?.value
  if (raw === 'NO_PROBE') {
    console.log('  window.__bwsSelfCheck 不存在 —— 说明运行的是旧版本（未包含本探针）。')
    process.exit(0)
  }
  result = raw ? JSON.parse(raw) : null
} catch (error) {
  console.log('  CDP 求值失败:', String(error && error.message || error))
  process.exit(0)
}

if (!result) { console.log('  探针未返回数据'); process.exit(0) }

let fail = 0
const ck = (label, cond, extra) => {
  if (cond) console.log('  OK   ' + label)
  else { console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + extra : '')); fail += 1 }
}

console.log()
console.log('=== 目标 3：图标 ===')
console.log('  primitives 收到:', result.primitives.received, '| 导出图标:', result.primitives.iconCount)
ck('primitives 模块已注入', result.primitives.received === true)
ck('图标名没有缺失', (result.primitives.missing || []).length === 0, (result.primitives.missing || []).join(','))

console.log()
console.log('=== 目标 1：两类组胶囊 + tree 竖线 ===')
console.log('  会话组气泡:', result.groups.sessionPills, '| mini:', result.groups.sessionMini,
  '| 工作区气泡:', result.groups.workspaceBubbles, '| 竖线:', result.groups.rails)
ck('有组气泡或 mini', result.groups.sessionPills + result.groups.sessionMini > 0)
ck('组行没有多余三角', result.groups.strayChevronsInGroups === 0, result.groups.strayChevronsInGroups)

console.log()
console.log('=== 目标 4：工作区文件夹图标 ===')
console.log('  文件夹槽位:', result.rows.folderSlots, '| 符号兜底:', result.rows.glyphFallbacks)
ck('工作区行有文件夹槽位', result.rows.folderSlots > 0)

console.log()
console.log('=== 其其余 ===')
ck('侧栏头部无设置按钮（已回原生位置）', result.headerHasSettingsButton === 0, result.headerHasSettingsButton)
console.log('  置顶标记:', result.pinMarks, '| 分栏容器:', result.columns)

console.log()
if (fail) { console.error(fail + ' 项未通过'); process.exit(1) }
console.log('PASS: 重启后界面核验通过')
