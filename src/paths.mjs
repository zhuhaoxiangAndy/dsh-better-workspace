// src/paths.mjs — 从审批请求里提炼「真正会被改动的目录」。
//
// 背景：审批面板把整条命令原文（可能几百字、夹着大量与本次改动无关的
// Get-ChildItem / Test-Path / Write-Output 之类只读命令）一股脑显示出来，
// 用户要在里面自己找「到底会动哪些目录」。本模块把它压成一份去重目录列表。
//
// 设计原则（按用户要求「硬编码」）：
//   1. **白名单式硬规则**，不猜、不用启发式权重；
//   2. 只认**会写入/移动/删除**的命令关键字——纯读取命令一律剔除；
//   3. 路径按字面量提取，不解析变量展开（宁可少报，不可错报）；
//   4. 结果**去重 + 排序**，父目录已在列表里时保留父目录（避免刷屏）。
//
// 全部为纯函数：无 IO、无依赖，便于单测。

/** 会改动文件系统的命令「动词」（小写匹配）。命中即认为该语句需关注。 */
const WRITE_VERBS = [
  // PowerShell
  'new-item', 'mkdir', 'md', 'set-content', 'add-content', 'out-file', 'copy-item',
  'move-item', 'remove-item', 'rename-item', 'set-itemproperty', 'new-itemproperty',
  'remove-itemproperty', 'clear-content', 'expand-archive', 'compress-archive',
  'tee-object', 'export-csv', 'export-clixml', 'export-modulemember', 'start-process',
  'robocopy', 'xcopy',
  // 通用 CLI
  'cp', 'mv', 'rm', 'rmdir', 'del', 'erase', 'mkdir', 'touch', 'install', 'uninstall',
  'npm', 'pnpm', 'yarn', 'pip', 'pip3', 'git', 'cargo', 'go', 'dotnet', 'msbuild',
  'cmake', 'make', 'ninja', 'tsc', 'node', 'python', 'python3', 'pwsh', 'powershell',
  'git.exe', '7z', 'tar', 'unzip', 'zip', 'scp', 'rsync', 'curl', 'wget',
]

/**
 * 明显是「只看不动」的命令。即便同一行里出现写动词的同名子串也不必管，
 * 这里用于整条语句级别的快速剔除（例如 `Get-ChildItem ... Express`）。
 */
const READ_VERBS = [
  'get-childitem', 'get-item', 'get-content', 'get-itemproperty', 'get-process',
  'test-path', 'select-object', 'where-object', 'foreach-object', 'measure-object',
  'sort-object', 'format-table', 'format-list', 'write-output', 'write-host',
  'out-string', 'select-string', 'resolve-path', 'join-path', 'split-path',
  'compare-object', 'get-filehash', 'get-location', 'set-location', 'cd', 'pwd',
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'rg', 'find', 'echo', 'which',
  'stat', 'file', 'du', 'df', 'whoami', 'netstat', 'tasklist', 'get-netTCPconnection',
  'get-ciminstance', 'get-wmiobject', 'get-service', 'get-date', 'start-sleep',
]

/** Windows 盘符路径：C:\... 或 C:/...（允许前后被引号/括号包裹）。 */
const WIN_PATH = /(?:[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n'"`]*[\\/])*[^\\/:*?"<>|\r\n'"`]*)/gu

/** UNC 路径 \\server\share\... */
const UNC_PATH = /\\\\\\\\[^\\/\s'"]+\\\\[^\\/\s'"]+(?:\\\\[^\\/\s'"]*)*/gu

/**
 * 判断一行是否「只读」。用命令段第一个 token 判定，避免
 * `Get-ChildItem ... | Select-String Express` 因含 "Express" 而被误判。
 * @param {string} segment
 * @returns {boolean}
 */
function isReadOnlySegment(segment) {
  const head = String(segment).trim().replace(/^[(&]\s*/u, '').split(/[\s|;]/u)[0]?.toLowerCase() ?? ''
  if (head === '') return true
  // 形如 ./script.ps1 或 node xxx：交给写动词表处理
  if (READ_VERBS.includes(head)) return true
  // `Get-Foo` 家族一律只读
  if (/^get-/u.test(head)) return true
  return false
}

/**
 * 判断一行是否「会写」。只认白名单动词。
 * @param {string} segment
 * @returns {boolean}
 */
function isWriteSegment(segment) {
  const text = String(segment).toLowerCase()
  return WRITE_VERBS.some((v) => new RegExp(`(^|[\\s(;&|])${v.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}([\\s(;&|]|$)`, 'u').test(text))
}

/**
 * 从文本里抽出所有 Windows/UNC 绝对路径字面量（去重、保序）。
 * @param {string} text
 * @returns {string[]}
 */
export function extractPaths(text) {
  const src = String(text ?? '')
  const out = []
  const seen = new Set()
  for (const m of src.matchAll(WIN_PATH)) {
    // 去掉尾部常见的标点
    const raw = m[0].replace(/[,.'"`)\]}]+$/u, '')
    if (raw.length < 4) continue
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  for (const m of src.matchAll(UNC_PATH)) {
    const raw = m[0].replace(/[,.'"`)\]}]+$/u, '')
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

/**
 * 规范化路径用于比较：统一斜杠、去尾部斜杠、保留大小写原样（仅比较用小写）。
 * @param {string} p
 * @returns {string}
 */
function normKey(p) {
  return String(p).replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()
}

/**
 * 若候选路径位于某个已收集路径之下，且该已收集路径本身也在结果里，则省略候选
 * （父目录已经表达了「这个范围内的东西会被动」）。这样列表不会刷屏。
 * @param {string[]} paths
 * @returns {string[]}
 */
export function collapseToTopLevel(paths) {
  const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p !== '') : []
  const keys = list.map(normKey)
  const keep = []
  for (let i = 0; i < list.length; i += 1) {
    const k = keys[i]
    let covered = false
    for (let j = 0; j < list.length; j += 1) {
      if (i === j) continue
      const other = keys[j]
      if (other === '') continue
      if (k !== other && k.startsWith(other + '/')) { covered = true; break }
    }
    if (!covered) keep.push(list[i])
  }
  return keep
}

/**
 * 把一段命令文本切成「语句」，按写/读分类。
 * 分隔符：换行、`;`、`&&`、`||`、`|`（管道两侧视为同一语句的延续，
 * 这里按简单语义切分为独立语句后再判断，宁可多留）。
 * @param {string} text
 * @returns {Array<{text: string, write: boolean}>}
 */
export function splitSegments(text) {
  const src = String(text ?? '')
  const parts = src
    .split(/\r?\n|;|&&|\|\|/u)
    .map((s) => s.trim())
    .filter((s) => s !== '')
  const out = []
  for (const p of parts) {
    const readOnly = isReadOnlySegment(p)
    const writes = !readOnly && isWriteSegment(p)
    out.push({ text: p, write: writes })
  }
  return out
}

/**
 * 从审批请求的原文里提炼「会被改动的目录」。
 *
 * 规则（硬编码、可预测）：
 *   1. 按语句切分；
 *   2. 丢弃纯只读语句（Get-* / Test-Path / Write-Output / Select-* …）；
 *   3. 保留含写动词的语句里的**全部绝对路径字面量**；
 *   4. 对全部保留语句的路径合集做父级折叠 + 去重 + 稳定排序。
 *
 * @param {string} rawText - 审批面板展示的命令原文（可能是多行脚本）。
 * @returns {{directories: string[], statements: number, writeStatements: number, dropped: number}}
 */
export function extractWriteDirectories(rawText) {
  const segments = splitSegments(rawText)
  const writeSegs = segments.filter((s) => s.write)
  /** @type {string[]} */
  const paths = []
  for (const seg of writeSegs) {
    for (const p of extractPaths(seg.text)) paths.push(p)
  }
  const collapsed = collapseToTopLevel(paths)
  // 稳定排序：短（层级浅）的在前，再按字母序，便于阅读
  collapsed.sort((a, b) => {
    const da = (a.match(/[\\/]/gu) || []).length
    const db = (b.match(/[\\/]/gu) || []).length
    if (da !== db) return da - db
    return a.localeCompare(b, 'zh')
  })
  return {
    directories: collapsed,
    statements: segments.length,
    writeStatements: writeSegs.length,
    dropped: segments.length - writeSegs.length,
  }
}
