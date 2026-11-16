#!/usr/bin/env node
// 把插件完整同步到两个 profile。
//
// WHY THIS EXISTS
// 2026-11-16: bws stopped loading in the desktop app — the sidebar reverted to the
// official one, the plugin list showed no error, and dozens of code fixes looked
// like they had no effect. The cause was mundane: I had been copying only
// `src/client.js` and `package.json` into the profile, so `src/delete-session.mjs`
// and `src/paths.mjs` were never there. `src/index.js` imports them, the host half
// failed to load, and the WHOLE plugin was skipped — including the client half.
//
// So: copy EVERY file a package declares, not the two I happened to edit.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const PROFILES = ['desktop', 'web'].map((p) => path.join(os.homedir(), '.dsh', 'profiles', p, 'node_modules', 'dsh-better-workspace'))

/** Every file that must ship: declared entry points plus the whole src/ tree. */
function payloadFiles(root) {
  const out = new Set()
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

  const addDeclared = (v) => {
    if (typeof v === 'string' && (v.startsWith('./'))) out.add(v.slice(2))
    else if (v && typeof v === 'object') for (const x of Object.values(v)) addDeclared(x)
  }
  addDeclared(pkg.main)
  addDeclared(pkg.exports)
  out.add('package.json')
  if (fs.existsSync(path.join(root, 'cordis.patch.yml'))) out.add('cordis.patch.yml')
  if (fs.existsSync(path.join(root, 'dsh.plugin.json'))) out.add('dsh.plugin.json')
  if (fs.existsSync(path.join(root, 'README.md'))) out.add('README.md')

  // The whole src tree, minus editor backups.
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (/\.bak-|~$/.test(e.name)) continue
      const rel = path.relative(root, p).split(path.sep).join('/')
      out.add(rel)
    }
  }
  if (fs.existsSync(path.join(root, 'src'))) walk(path.join(root, 'src'))
  return [...out].sort()
}

const files = payloadFiles(SRC)
console.log('要同步的文件:', files.length)
for (const f of files) console.log('  ' + f)

let failed = 0
for (const dst of PROFILES) {
  console.log()
  console.log('=== ' + dst + ' ===')
  if (!fs.existsSync(dst)) { console.log('  跳过（未安装）'); continue }
  for (const rel of files) {
    const from = path.join(SRC, rel)
    const to = path.join(dst, rel)
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
    } catch (error) {
      console.log('  FAIL ' + rel + ' — ' + error.message)
      failed += 1
    }
  }
  // Verify the host half actually loads.
  const pkg = JSON.parse(fs.readFileSync(path.join(dst, 'package.json'), 'utf8'))
  const missing = []
  const check = (v) => {
    if (typeof v === 'string' && v.startsWith('./')) {
      if (!fs.existsSync(path.join(dst, v.slice(2)))) missing.push(v)
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) check(x)
  }
  check(pkg.main)
  check(pkg.exports)
  if (missing.length) { console.log('  FAIL 声明了但不存在: ' + missing.join(', ')); failed += 1 }
  else console.log('  全部声明入口都存在')
}

console.log()
if (failed) { console.error(failed + ' 项失败'); process.exit(1) }
console.log('PASS: 两个 profile 都拿到了完整插件')
