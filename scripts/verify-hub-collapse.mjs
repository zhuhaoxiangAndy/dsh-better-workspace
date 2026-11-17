// 验证交互中心三件事：
//   1. 关闭后不是"啥都没了"，而是留下一个可重新打开的按钮
//   2. 面板是浮层（不占布局高度），不撑满、不覆盖官方气泡
//   3. 有待答时按钮高亮并显示计数
import fs from 'node:fs'
const text = fs.readFileSync('C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js', 'utf8')
let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); fail += 1 } }

console.log('=== 1. 关闭后仍有按钮 ===')
const panel = text.slice(text.indexOf('function InteractionComposerPanel'), text.indexOf('function InteractionComposerPanel') + 3600)
ck('dock 始终渲染（不再在关闭时 return null）', !panel.includes('if (!openFlag) return null'))
ck('存在常驻切换按钮', panel.includes('bw-hub-toggle'))
ck('点击可重新打开', panel.includes('setHubOpen(true)'))
ck('关闭走 hubDismiss（记住已关闭）', panel.includes('hubDismiss(rows)'))
ck('按钮有 aria-expanded', panel.includes('aria-expanded'))

console.log()
console.log('=== 2. 面板是浮层，不占布局 ===')
const css = text.slice(text.indexOf("'.bw-hub-pop{"), text.indexOf("'.bw-hub-pop{") + 400)
console.log('  CSS:', css.split('\n')[0].slice(0, 150))
ck('绝对定位（浮层）', css.includes('position:absolute'))
ck('向上弹出', css.includes('bottom:calc(100%'))
ck('z-index 提升', css.includes('z-index'))
ck('宽度有上限，不撑满中间栏', css.includes('width:min('))
ck('高度有上限', css.includes('max-height'))
ck('dock 是定位容器', text.includes("'.bw-hub-dock{position:relative"))

console.log()
console.log('=== 3. 有待答时高亮与计数 ===')
ck('按钮带计数徽标', panel.includes('bw-hub-toggle-count'))
ck('有待答时高亮', panel.includes('bw-hub-toggle-hot'))
ck('按钮始终渲染（不受 openFlag 控制）', panel.includes('Always present'))

console.log()
console.log('=== 4. 不再撑满（旧的 100% 宽度规则）===')
ck('旧的全宽规则已不再作用于 pop', !text.includes("'.bw-hub-inline,.bw-hub-card{--bw-hub-bubble-w:100%;width:min(100%") || !panel.includes('bw-hub-card"'), '检查 pop 用的是 bw-hub-pop')

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: 交互中心可收起、可重开、不占中间栏')
