// 审批「受影响目录」提取的行为测试。
//
// 用户需求：审批交互中心要硬编码剔除与本次改动无关的只读命令，
// 把真正涉及的目录去重后以列表呈现。
//
// 这里直接从实装的 client.js 里截取提取器并真实运行，避免「只验证写了什么、
// 没验证实际读到什么」——本项目已经因为这种漏检崩过一次。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const text = fs.readFileSync(path.join(dir, '../src/client.js'), 'utf8')

/**
 * 截取 client.js 里从 WRITE_VERBS 到 extractWriteDirectories 结束的整段，
 * 在独立作用域里求值，拿到真实的提取函数（它们不依赖 React/DOM）。
 */
function loadExtractor() {
  const start = text.indexOf('const WRITE_VERBS = [')
  const endMarker = 'const extractWriteDirectories = (rawText) => {'
  const end = text.indexOf(endMarker)
  assert.ok(start !== -1 && end !== -1 && start < end, 'approval path extractor not found in client.js')
  // 找到该箭头函数体的闭合：从 end 起按大括号配平
  let i = text.indexOf('{', end)
  let depth = 0
  let j = i
  for (; j < text.length; j += 1) {
    if (text[j] === '{') depth += 1
    else if (text[j] === '}') { depth -= 1; if (depth === 0) { j += 1; break } }
  }
  const slice = text.slice(start, j)
  // 函数体末尾以 } 结束，补一个分号再 return 出来
  const factory = new Function(slice + ';\nreturn { extractWriteDirectories, extractPaths, collapseToTopLevel };')
  return factory()
}

const { extractWriteDirectories, extractPaths, collapseToTopLevel } = loadExtractor()

test('drops read-only statements and keeps only write paths', () => {
  const script = [
    'Write-Output "=== scan ==="',
    'Get-ChildItem C:\\work -Recurse | Measure-Object',
    'Test-Path C:\\work\\target',
    'Get-Process | Where-Object { $_.ProcessName -match "node" }',
    'New-Item -ItemType Directory -Path C:\\work\\target -Force',
    'Move-Item -LiteralPath C:\\work\\a.txt -Destination C:\\work\\target\\a.txt',
    'Remove-Item -LiteralPath C:\\work\\old -Recurse -Force',
  ].join('\n')

  const r = extractWriteDirectories(script)
  assert.equal(r.statements, 7, 'all statements are examined')
  assert.equal(r.writeStatements, 3, 'only New/Move/Remove are writes')
  assert.equal(r.dropped, 4, 'four read-only statements are dropped')
  // Every surviving path lives under C:\work, so collapsing to the top level
  // leaves exactly that one directory — a short, deduped answer.
  assert.deepEqual(r.directories, ['C:\\work'],
    'children collapse into their common parent, and no file path is listed as a directory')
  assert.ok(
    !r.directories.some((d) => /\.[A-Za-z0-9]{1,5}$/.test(d)),
    'no entry looks like a file name',
  )
})

test('a write outside the common parent stays visible', () => {
  const r = extractWriteDirectories([
    'New-Item -ItemType Directory -Path C:\\work\\target -Force',
    'Remove-Item -LiteralPath C:\\elsewhere\\old -Recurse -Force',
  ].join('\n'))
  assert.equal(r.directories.length, 2, 'two disjoint parents are both listed')
  assert.ok(r.directories.some((d) => d.toLowerCase() === 'c:\\work\\target'))
  assert.ok(r.directories.some((d) => d.toLowerCase() === 'c:\\elsewhere\\old'))
})

test('collapses children when the parent is already listed', () => {
  const folded = collapseToTopLevel(['C:\\a\\b', 'C:\\a\\b\\c', 'C:\\a\\b\\c\\d.txt', 'C:\\x'])
  assert.deepEqual(folded, ['C:\\a\\b', 'C:\\x'])
})

test('dedupes repeated paths across statements', () => {
  const r = extractWriteDirectories([
    'Copy-Item C:\\d\\x.txt C:\\d\\y.txt',
    'Move-Item C:\\d\\y.txt C:\\d\\z.txt',
  ].join('\n'))
  const keys = r.directories.map((d) => d.toLowerCase())
  assert.equal(new Set(keys).size, keys.length, 'no duplicate directory is listed twice')
})

test('extractPaths finds absolute Windows paths and trims trailing punctuation', () => {
  const p = extractPaths('Copy-Item "C:\\a\\b.txt" C:\\a\\c\\, and C:\\a\\b.txt again')
  assert.ok(p.includes('C:\\a\\b.txt'), 'quoted path found')
  // The unquoted form keeps its trailing separator; compare on the trimmed key.
  assert.ok(
    p.some((x) => x.replace(/[\\/]+$/, '').toLowerCase() === 'c:\\a\\c'),
    'trailing comma trimmed even though the separator remains',
  )
  assert.equal(p.filter((x) => x.toLowerCase() === 'c:\\a\\b.txt').length, 1, 'duplicates removed in place')
})

test('a purely read-only approval yields no directories at all', () => {
  const r = extractWriteDirectories('Get-Content C:\\x\\y.txt | Select-Object -First 5')
  assert.deepEqual(r.directories, [])
  assert.equal(r.writeStatements, 0)
})

test('relative paths are not invented into absolute ones', () => {
  // Under-reporting is deliberate: a path built from a variable must not be
  // guessed, or the summary would claim a directory the command never touches.
  const r = extractWriteDirectories('New-Item -ItemType Directory -Path .\\local -Force')
  assert.deepEqual(r.directories, [])
})

test('empty input is handled', () => {
  const r = extractWriteDirectories('')
  assert.deepEqual(r.directories, [])
  assert.equal(r.statements, 0)
})
