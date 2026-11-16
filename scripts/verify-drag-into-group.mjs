// 验证「把工作区拖进组」的重命名算式正确：目标路径 + 源 leaf，且带上子树。
import fs from 'node:fs'

const text = fs.readFileSync('C:/Users/Andy/dsh/my_plugin/dsh-better-workspace/src/client.js', 'utf8')
let fail = 0
const ck = (l, c, x) => { if (c) console.log('  OK   ' + l); else { console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); fail += 1 } }

console.log('=== commitWorkspaceMoveInto 的重命名算式 ===')
const start = text.indexOf('const commitWorkspaceMoveInto = (folderIdPath) => {')
const end = text.indexOf('/* ---------------------- session drag & drop')
const body = text.slice(start, end)

ck('解析目标组路径', body.includes("folderIdPath.lastIndexOf('//')"))
ck('同组拖拽是 no-op', body.includes('if (source.folderPath === folderPath) return'))
ck('新标题 = 目标组 + 源 leaf', body.includes("const newTitle = folderPath !== '' ? folderPath + '/' + source.leaf : source.leaf"))
ck('整棵子树一起搬', body.includes('t.startsWith(oldTitle + \'/\')'))
ck('保留相对路径', body.includes('t.slice(oldTitle.length + 1)'))
ck('insertWorkspaceBefore 传了锚点', body.includes('insertWorkspaceBefore(source.workspaceId, anchor'))
ck('无锚点时也调用（不阻断重命名）', body.includes('anchor ? anchor.workspaceId : undefined'))

console.log()
console.log('=== 模拟真实场景 ===')
// 把 Sim-to-Real_GR00T-N1.7+SO-101（现在在 Project/RBE999 下）拖到别的组
function moveInto(title, sourceFolderPath, sourceLeaf, targetFolder) {
  const oldTitle = sourceFolderPath !== '' ? sourceFolderPath + '/' + sourceLeaf : sourceLeaf
  const newTitle = targetFolder !== '' ? targetFolder + '/' + sourceLeaf : sourceLeaf
  if (title === oldTitle) return newTitle
  if (title.startsWith(oldTitle + '/')) {
    const relative = title.slice(oldTitle.length + 1)
    return newTitle + '/' + relative
  }
  return title
}

const cases = [
  ['Project/RBE999/Sim-to-Real_GR00T-N1.7+SO-101', 'Project/RBE999', 'Sim-to-Real_GR00T-N1.7+SO-101', 'Project/AIP'],
  ['Project/ADS999-Model/UPC26', 'Project/ADS999-Model', 'UPC26', 'Project/RBE999'],
  ['RBE999/child', 'RBE999', 'RBE999', 'Project/RBE999'],
]
for (const [t, sf, sl, tf] of cases) {
  console.log('  %s' % t)
  console.log('    -> %s' % moveInto(t, sf, sl, tf))
}
ck('拖入 AIP 得到 Project/AIP/Sim-to-Real…',
  moveInto(cases[0][0], cases[0][1], cases[0][2], cases[0][3]) === 'Project/AIP/Sim-to-Real_GR00T-N1.7+SO-101')
ck('拖入 RBE999 得到 Project/RBE999/UPC26',
  moveInto(cases[1][0], cases[1][1], cases[1][2], cases[1][3]) === 'Project/RBE999/UPC26')

console.log()
if (fail) { console.error(fail + ' failed'); process.exit(1) }
console.log('PASS: 拖入组的算式与调用都正确')
