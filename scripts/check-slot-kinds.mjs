// 确认 bws 注册的每个槽位是 list 还是 single。
// 占 single 槽位会挤掉官方控件（v0.28.0 就是这样丢了设置按钮）。
import fs from 'node:fs'
const ASAR = 'C:/Users/Andy/dsh/win/resources/app.asar'
const buf = fs.readFileSync(ASAR)
const headerSize = buf.readUInt32LE(12)
const directory = JSON.parse(buf.subarray(16, 16 + headerSize).toString('utf8'))
const base = 8 + buf.readUInt32LE(4)

const WANT = [
  'conversation.composer.dock',
  'conversation.session.header.actions',
  'plugins.bundle.config',
  'settings.plugin.item',
  'settings.section',
  'sidebar.workspaces',
  'sidebar.workspaces.directoryFlow',
]

const found = new Map()
const stack = [[directory, '']]
while (stack.length) {
  const [node, prefix] = stack.pop()
  for (const [key, val] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + key : key
    if (val.files) { stack.push([val, p]); continue }
    if (!/\.js$/.test(key) || Number(val.size) > 4_000_000) continue
    let text
    try {
      const off = base + Number(val.offset)
      text = buf.subarray(off, off + Number(val.size)).toString('utf8')
    } catch { continue }
    for (const w of WANT) {
      if (found.has(w)) continue
      const at = text.indexOf(w)
      if (at === -1) continue
      // 在名字附近 200 字符内找 kind: "list" / kind: "single"
      const win = text.slice(at, at + 260)
      // 只有当这个名字出现在 register({ name: ... }) 的位置时才算“占用”。
      // 声明 children: { 'x': { kind: 'single' } } 只是声明洞，不是占用。
      const isRegistration = /register\(\s*\{[^}]*name:\s*["']/.test(text.slice(Math.max(0, at - 200), at + 40))
      const kind = /kind:\s*["']list["']/.test(win) ? 'list'
        : /kind:\s*["']single["']/.test(win) ? 'single'
        : null
      if (!kind) continue
      found.set(w, { kind, isRegistration })
    }
  }
}

console.log('=== bws 注册的槽位类型 ===')
let danger = 0
for (const w of WANT) {
  const info = found.get(w)
  if (!info) { console.log(`  ${w.padEnd(40)} 未在官方声明中找到（bws 自定义）`); continue }
  const risky = info.kind === 'single' && info.isRegistration
  if (risky) danger += 1
  const note = info.kind === 'single'
    ? (risky ? '  <== 危险：占用会挤掉官方控件' : '  (官方声明为 single；bws 只读取不占用)')
    : ''
  console.log(`  ${w.padEnd(40)} ${info.kind}${note}`)
}
console.log()
if (danger) { console.error(danger + ' 个 single 槽位被占用'); process.exit(1) }
console.log('PASS: 没有占用任何 single 槽位')
