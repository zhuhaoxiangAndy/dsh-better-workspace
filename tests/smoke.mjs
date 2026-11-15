// Smoke tests: pure helper/file-level, no Cordis runtime, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('package.json declares a dual-face dsh web plugin', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.name, 'dsh-better-workspace')
  assert.equal(pkg.main, 'src/index.js')
  assert.equal(pkg.exports['./client'], './src/client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('src/client.js'), 'client entry must ship')
  assert.ok(pkg.files.includes('src/index.js'), 'host entry must ship')
})

test('dsh.plugin.json version matches package.json', () => {
  const pkg = JSON.parse(read('package.json'))
  const manifest = JSON.parse(read('dsh.plugin.json'))
  assert.equal(manifest.id, 'dsh-external/dsh-better-workspace')
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.main, './src/index.js')
})

test('cordis.patch.yml inserts exactly one plugin row', () => {
  const text = read('cordis.patch.yml')
  assert.match(text, /^- insert:/m)
  assert.match(text, /id: better-workspace/)
  assert.match(text, /name: 'dsh-better-workspace'/)
  const insertRows = text.match(/name: 'dsh-better-workspace'/g) || []
  assert.equal(insertRows.length, 2) // comment example + real row
})

test('package.json declares the dsh engine floor (plugin market requirement)', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.engines.node, '>=18')
  assert.equal(pkg.engines.dsh, '>=0.1.0')
})

test('client half is a __ModuleLoader__ bundle with baseline requires only', () => {
  const text = read('src/client.js')
  assert.match(text, /window\.__ModuleLoader__\.load\(/)
  assert.match(text, /id: 'dsh-better-workspace'/)
  const requires = [...text.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  const baseline = new Set([
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
  ])
  for (const specifier of requires) {
    assert.ok(baseline.has(specifier), 'non-baseline require: ' + specifier)
  }
  assert.ok(requires.length > 0, 'expected at least one require')
})

test('client half registers the expected seats (v0.12.1)', () => {
  const text = read('src/client.js')
  assert.match(text, /slots\.inject\('sidebar\.workspaces'/)
  assert.match(text, /priority: -1/, 'browser shadowing needs the lowest rank')
  // NO children declaration, ever (the v0.12.0 regression): a child-hole
  // declaration is EXCLUSIVE and the shipped browser entry keeps owning
  // 'sidebar.workspaces.directoryFlow' even after losing the render race —
  // re-declaring throws and silently unregisters this whole seat.
  assert.doesNotMatch(text, /children:\s*\{[^}]*directoryFlow/,
    'a children declaration for the directory-flow hole must never return')
  // The sidebar hole is occupied by our own picking flow at priority -1;
  // the hero hole stays untouched so the conversation flow is purely official.
  assert.match(text, /slots\.inject\('sidebar\.workspaces\.directoryFlow', guarded\([\s\S]*?priority: -1/,
    'the sidebar hole needs our own occupant')
  assert.doesNotMatch(text, /slots\.inject\('conversation\.hero\.workspace\.directoryFlow'/,
    'the hero hole must stay official')
  // Settings ride BOTH host eras.
  assert.match(text, /slots\.inject\('settings\.plugin\.item',[\s\S]*?key: 'better-workspace',/)
  assert.match(text, /slots\.inject\('plugins\.bundle\.config',[\s\S]*?key: 'dsh-better-workspace',/)
  assert.match(text, /props\.view === 'page'/)
})

test('client plugin exports the cordis plugin triple', () => {
  const text = read('src/client.js')
  assert.match(text, /name: 'dsh-better-workspace'/)
  assert.match(text, /inject: \['slots', 'sessions', 'workspaces', 'locale', 'uiWorkspace'\]/)
  assert.match(text, /function apply\(ctx\)/)
})

test('client half stays plain JavaScript (no import/JSX/TS syntax)', () => {
  const text = read('src/client.js')
  assert.doesNotMatch(text, /(^|\n)\s*import\s/)
  assert.doesNotMatch(text, /(^|\n)\s*export\s/)
  assert.doesNotMatch(text, /=> </, 'JSX arrow syntax is forbidden')
  assert.doesNotMatch(text, /:\s*(string|number|boolean)\b/, 'TypeScript annotations are forbidden')
  // Compiles as a function body (never executed — window is absent in Node).
  new Function(text)
})

/**
 * Extract the pure title-splitting helpers from the client bundle and run
 * them for real. Everything between splitPlainSegs and normPath is plain,
 * dependency-free JavaScript, so evaluating the slice in one Function scope
 * executes exactly what ships.
 */
const loadTitleSegs = () => {
  const text = read('src/client.js')
  const start = text.indexOf('const splitPlainSegs = (text) => {')
  const end = text.indexOf('const normPath =')
  assert.ok(start !== -1 && end !== -1 && start < end, 'splitting helpers not found')
  const scope = new Function(text.slice(start, end) + '\nreturn { splitTitleSegs }')
  return scope()
}

test('splitTitleSegs: paired quotes verbatim, lone quotes are plain text', () => {
  const { splitTitleSegs } = loadTitleSegs()
  // Unquoted slashes split (deliberate user grouping).
  assert.deepEqual(splitTitleSegs('插件开发/更好的左侧边栏'), ['插件开发', '更好的左侧边栏'])
  // Paired quotes: one verbatim leaf including the quote characters.
  assert.deepEqual(splitTitleSegs('“插件开发/更好的左侧边栏”'), ['“插件开发/更好的左侧边栏”'])
  assert.deepEqual(splitTitleSegs('"a/b" and c/d'), ['"a/b"', 'and c', 'd'])
  // A lone opener (no matching closer) is an ORDINARY character — 0.9.1
  // swallowed the rest of the title instead.
  assert.deepEqual(splitTitleSegs('插件开发/"abc'), ['插件开发', '"abc'])
  assert.deepEqual(splitTitleSegs('say “hello'), ['say “hello'])
  // A closer without an opener never started a span.
  assert.deepEqual(splitTitleSegs('a/b”c'), ['a', 'b”c'])
  // URL tail stays opaque from the first :// onward.
  assert.deepEqual(splitTitleSegs('see https://x.dev/a/b'), ['see https://x.dev/a/b'])
})

test('quote-on-land effect: blank-born only, user renames pinned, stability window', () => {
  const text = read('src/client.js')
  // Eligibility is keyed off an observed BLANK snapshot, not "first time seen".
  assert.match(text, /blankSeen\.add\(id\)/, 'blank birth mark must be recorded')
  assert.match(text, /!blankSeen\.has\(id\) \|\| touched\.has\(id\)/, 'untouched blankSeen/human guard')
  assert.doesNotMatch(text, /titledSeenRef/, '0.9.1 first-snapshot heuristic must be gone')
  // User renames route through the pinning wrapper; the automatic path alone
  // keeps the raw injected renameSession. 8 call sites: drag-into-session-group,
  // session rename dialog, session-group rename, the two group-move entry points
  // (single session / session-group batch), dropping a session onto a row inside
  // another group (JOINS the group instead of flat-reordering), the v0.18.2
  // cross-group session move (commitSessionDrop's other-workspace branch), and
  // v0.23.0 "new session inside this group" (stamps the group prefix on the
  // freshly created session).
  // v0.29.0 SPLIT the two kinds of rename:
  //   renameByUser       -> the user typed a title (claims it, stops auto-naming)
  //   renameForGrouping  -> a grouping change rewrote the "/"-prefix (must NOT
  //                         claim the title, or dsh-session-title stops working)
  // Only the rename DIALOG may use the first one now.
  assert.match(text, /const renameByUser = \(sessionId, title\) => \{/)
  // v0.29.0 SPLIT: grouping rewrites must NOT claim the title, or
  // dsh-session-title stops auto-naming that session.
  assert.match(text, /const renameForGrouping = \(sessionId, title\) => \{/, 'grouping path exists')
  const gStart = text.indexOf('const renameForGrouping = (sessionId, title) => {')
  const gEnd = text.indexOf(String.fromCharCode(10) + '      }', gStart)
  const gBody = text.slice(gStart, gEnd)
  assert.doesNotMatch(gBody, /humanTouchedRef\.current\.add/, 'grouping must not claim the title')
  const dStart = text.indexOf('const submitSessionRename = (session, nextTitle) => {')
  const dBody = text.slice(dStart, dStart + 400)
  assert.match(dBody, /renameByUser\(/, 'the rename dialog uses the user path')
  // The automatic quote waits out a stabilization window instead of racing
  // the async LLM name.
  assert.match(text, /TITLE_STABLE_MS = 20000/)
  assert.match(text, /prev\.title === text/, 'title change resets the window')
  assert.match(text, /\[list, stableTick\]/, 'stability tick re-runs the effect')
})

test('host half imports cleanly and applies without side effects', async () => {
  const plugin = await import('../src/index.js')
  assert.equal(plugin.name, 'dsh-better-workspace')
  assert.equal(typeof plugin.apply, 'function')
  let logged = ''
  plugin.apply({ logger: { info: (m) => { logged = String(m) } } })
  assert.match(logged, /dsh-better-workspace/)
  plugin.apply(undefined) // must not throw without a logger
})

test('locale dictionaries cover every static t() key in both languages', () => {
  const text = read('src/client.js')
  const slice = (startMarker, endMarker) => {
    const start = text.indexOf(startMarker)
    assert.ok(start !== -1, 'missing block: ' + startMarker)
    const end = text.indexOf(endMarker, start)
    assert.ok(end !== -1, 'missing end marker for ' + startMarker)
    return text.slice(start, end)
  }
  const keysOf = (block) => new Set([...block.matchAll(/'([a-zA-Z][^']*)':/g)].map((m) => m[1]))
  const zhBlock = slice('const zh = {', 'const en = {')
  const enBlock = slice('const en = {', 'const LOCALES = {')
  const zhKeys = keysOf(zhBlock)
  const enKeys = keysOf(enBlock)
  assert.ok(zhKeys.size > 20, 'zh dictionary looks too small')
  assert.deepEqual([...enKeys].sort(), [...zhKeys].sort(), 'zh/en dictionaries must be key-aligned')
  const used = new Set([...text.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]))
  for (const key of used) {
    assert.ok(zhKeys.has(key), 't("' + key + '") missing from zh dictionary')
    assert.ok(enKeys.has(key), 't("' + key + '") missing from en dictionary')
  }
  // dynamic time keys
  for (const unit of ['minutes', 'hours', 'days', 'months', 'years']) {
    assert.ok(zhKeys.has('time.' + unit) && enKeys.has('time.' + unit), 'missing time.' + unit)
  }
})

// Same guard as dsh-ide-git's smoke suite. Every third-language block is
// preceded by a /* locale: <tag> */ marker, so the blocks can be sliced out of
// the file without parsing it. Equality matters because a key missing from a
// third language falls back to English at lookup time — a silent
// half-translated panel, which is exactly what this catches.
const SHIPPED_LOCALES = [
  'ar', 'de', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl',
  'pt', 'ru', 'sv', 'th', 'tr', 'vi', 'zh-HK', 'zh-MO', 'zh-TW',
]

test('every shipped dictionary carries the same key set as zh', () => {
  const text = read('src/client.js')
  // Values may be single- OR double-quoted (apostrophe-bearing copy), so
  // the line pattern stops at the key's closing colon.
  const keyLines = (segment) => [...segment.matchAll(/^ +'([^']+)': (?!\{)/gm)].map((m) => m[1]).sort()
  const zhKeys = keyLines(text.slice(text.indexOf('const zh = {'), text.indexOf('const en = {')))
  assert.ok(zhKeys.length >= 80, 'the zh dictionary looks truncated: ' + zhKeys.length)

  const start = text.indexOf('const LOCALES = {')
  const end = text.indexOf('/* ============================= helpers', start)
  assert.ok(start !== -1 && end !== -1 && start < end, 'the LOCALES table is missing')
  const parts = text.slice(start, end).split('/* locale: ')
  assert.ok(
    parts.length - 1 >= SHIPPED_LOCALES.length,
    'expected at least ' + SHIPPED_LOCALES.length + ' third-language dictionaries, saw ' + (parts.length - 1),
  )
  const tags = []
  for (let index = 1; index < parts.length; index += 1) {
    const tag = parts[index].slice(0, parts[index].indexOf(' */'))
    tags.push(tag)
    assert.deepEqual(keyLines(parts[index]), zhKeys, 'dictionary ' + tag + ' does not match the zh key set')
  }
  assert.deepEqual(tags, SHIPPED_LOCALES, 'the shipped language list changed')
  // All dictionaries ride the one register call the host locale service reads;
  // a dropped locale here would leave that language on English.
  assert.match(
    text,
    /ctx\.locale\.register\(NS, Object\.assign\(\{ zh, en \}, LOCALES\)\)/,
    'every dictionary must be published through ctx.locale.register',
  )

  // Live switching is the host's job here. `t` is a seat the renderer binds
  // from the registration's locale: NS and rebuilds on every locale revision,
  // so nothing may resolve or capture a dictionary plugin-side — a
  // translatorOf / dictionaryFor (which dsh-ide-git needs only because its
  // panel is not a DSH slot) would fork that single source of truth and pin
  // the language until the next page load.
  assert.match(text, /locale: NS/, 'every registration must name the dictionary namespace')
  assert.doesNotMatch(
    text,
    /translatorOf|dictionaryFor|dictionaryOf\(/,
    'dictionary resolution belongs to the host locale service, not this plugin',
  )
})

/**
 * Cold-restart title fallback (0.9.4). The host list serves titles only from
 * the persisted projection cache; fork-born and never-checkpointed sessions
 * restart with title absent and displayTitle degraded to the workspace
 * basename. The plugin remembers last-known real wire titles and feeds them
 * through sessionTitleOf's third parameter.
 */
test('sessionTitleOf: wire title wins, remembered fills the cold-restart window', () => {
  const text = read('src/client.js')
  const start = text.indexOf('const sessionTitleOf =')
  const end = text.indexOf('/**', start)
  assert.ok(start !== -1 && end !== -1, 'sessionTitleOf not found')
  const { sessionTitleOf } = new Function(text.slice(start, end) + '\nreturn { sessionTitleOf }')()
  const t = (k) => k
  assert.equal(sessionTitleOf({ blank: true }, t, 'x'), 'session.new', 'blank stays New Session')
  assert.equal(sessionTitleOf({ title: 'wire/real' }, t, 'old/name'), 'wire/real', 'wire title beats memory')
  assert.equal(sessionTitleOf({ displayTitle: 'basename' }, t, 'web/前端'), 'web/前端', 'remembered beats the basename fallback')
  assert.equal(sessionTitleOf({ displayTitle: 'basename' }, t), 'basename', 'no memory: fallback stands')
  assert.equal(sessionTitleOf({ displayTitle: 'basename' }, t, ''), 'basename', 'blank memory never masks the fallback')
  assert.equal(sessionTitleOf(undefined, t, 'x'), '', 'no summary renders nothing')
})

test('title cache: persisted key, batch learning, debounced save, bounded eviction (0.9.6)', async () => {
  const text = read('src/client.js')
  // 0.9.6 shape (issue #1): the cache is plain module state — no reactive
  // store, no per-session dispatch; one batch pass + one debounced save.
  assert.doesNotMatch(text, /createTitleCacheStore|actions\.rememberTitle/)
  assert.match(text, /const TITLE_CACHE_KEY = 'dsh\.betterWorkspace\.titles\.v1'/)
  // Learning discipline kept: only real wire titles (summary.title), never blank rows.
  assert.match(text, /if \(!summary \|\| summary\.blank\) continue/)
  assert.match(text, /typeof title !== 'string' \|\| title === ''\) continue/)
  assert.match(text, /titleCacheRef\.rememberAllTitles\(list\)/)
  // Rows render through the remembered fallback.
  assert.match(text, /sessionTitleOf\(summary, t, rememberedTitleOf\(id\)\)/)
  // Drive the real block with a mocked localStorage.
  const start = text.indexOf('const TITLE_CACHE_LIMIT =')
  const end = text.indexOf('/* ======================= host settings sync')
  assert.ok(start !== -1 && end !== -1 && start < end, 'title cache block not found')
  const saved = new Map()
  const fakeLocalStorage = {
    getItem: (k) => (saved.has(k) ? saved.get(k) : null),
    setItem: (k, v) => { saved.set(k, String(v)) },
  }
  const scope = new Function('localStorage', 'setTimeout', 'clearTimeout',
    text.slice(start, end)
    + '\nreturn { titleCache, loadTitleCache, rememberAllTitles, TITLE_CACHE_LIMIT, TITLE_CACHE_KEEP }')
  const api = scope(fakeLocalStorage, setTimeout, clearTimeout)
  // Hydration: existing persisted state replaces the empty seed.
  saved.set('dsh.betterWorkspace.titles.v1', JSON.stringify({ byId: { old: { title: 'a/b', at: 1 } } }))
  api.loadTitleCache()
  assert.equal(api.titleCache.byId.old.title, 'a/b')
  // Batch learning: blank and empty-title rows never learn; real titles do.
  const list = { byId: { a: { title: 'web/one' }, b: { blank: true }, c: { title: '' }, d: { title: 'web/two' } } }
  assert.equal(api.rememberAllTitles(list), true, 'first pass learns')
  assert.ok(api.titleCache.byId.a && api.titleCache.byId.d)
  assert.ok(!api.titleCache.byId.b && !api.titleCache.byId.c)
  assert.equal(typeof api.titleCache.byId.a.at, 'number')
  // Same values again: nothing changes, nothing schedules a save.
  assert.equal(api.rememberAllTitles(list), false, 'unchanged pass is a no-op')
  // Eviction past the cap keeps the newest TITLE_CACHE_KEEP entries.
  const big = { byId: {} }
  for (let i = 0; i < api.TITLE_CACHE_LIMIT + 1; i++) big.byId['k' + i] = { title: 't' + i }
  api.rememberAllTitles(big)
  assert.equal(Object.keys(api.titleCache.byId).length, api.TITLE_CACHE_KEEP)
  assert.ok(api.titleCache.byId['k' + api.TITLE_CACHE_LIMIT], 'newest survives')
  assert.ok(!api.titleCache.byId.old, 'oldest evicted')
  // Debounced save lands under the same persist key (~200 ms).
  await new Promise((r) => setTimeout(r, 260))
  assert.ok(saved.has('dsh.betterWorkspace.titles.v1'), 'debounced save persisted')
  const persisted = JSON.parse(saved.get('dsh.betterWorkspace.titles.v1'))
  assert.ok(persisted && typeof persisted.byId === 'object')
})


test('manual cross-device sync: host scope bind, dual writes, pull modes', () => {
  const text = read('src/client.js')
  // Scope bound once per activation; failures degrade to browser-local.
  assert.match(text, /ctx\.settingsScope && typeof ctx\.settingsScope\.bind === 'function'/)
  assert.match(text, /bind\(\{ namespace: 'better-workspace' \}\)/)
  // Dual-write wrappers exist and route every preference mutation through them.
  // v0.12.0 dropped the explicit-folder channel with the feature itself.
  assert.match(text, /const makeSharedWrites = \(actions, stylingMap\)/)
  assert.equal((text.match(/shared\.setStyling\(/g) || []).length, 2,
    'the customize dialog writes through the shared wrapper')
  assert.doesNotMatch(text, /shared\.(addFolder|removeFolder|renameFolder)\(/, 'explicit folders are gone (v0.12.0)')
  // Pull modes: overwrite replaces, merge unions with the pulled copy winning.
  assert.match(text, /importHost: \(d, host\)/)
  assert.match(text, /mergeHost: \(d, host\)/)
  // Surface detection picks the pull label direction.
  assert.match(text, /location\.protocol === 'dsh-app:'/)
  assert.match(text, /t\(IS_DESKTOP_SURFACE \? 'sync\.pull\.web' : 'sync\.pull\.desktop'\)/)
  // No automatic mirror/migration remains: sync is manual by user decision.
  assert.doesNotMatch(text, /useHostMirror/)
  assert.doesNotMatch(text, /HOST_SYNC_MARK/)
  for (const key of ['sync.pull.desktop', 'sync.pull.web', 'sync.mode.overwrite', 'sync.mode.merge', 'sync.push']) {
    assert.ok(text.includes("'" + key + "':"), 'missing dictionary key ' + key)
  }
})

/**
 * Appearance defaults + the derived text outline (0.10.0). The outline color is
 * never picked by hand: it is the pole that contrasts with the label color, so
 * it survives a theme or background-plugin light/dark flip.
 */
test('appearance: outline on (gray default), pick or auto, field-by-field merge (0.10.0)', () => {
  const text = read('src/client.js')
  const start = text.indexOf('const colorToRgb =')
  const end = text.indexOf('function FolderRow(')
  assert.ok(start !== -1 && end !== -1 && start < end, 'appearance helpers not found')
  const loaded = new Function(text.slice(start, end) +
    '\nreturn { DEFAULT_APPEARANCE, readAppearance, mergeAppearance, contrastStrokeColor, parseCssColor, strokeStyleOf }')()
  const { DEFAULT_APPEARANCE, readAppearance, mergeAppearance, contrastStrokeColor, parseCssColor, strokeStyleOf } = loaded
  // The outline ships ON — text over a background image is unreadable without it.
  assert.equal(DEFAULT_APPEARANCE.stroke, true)
  assert.equal(DEFAULT_APPEARANCE.strokeWidth, 1)
  assert.equal(DEFAULT_APPEARANCE.color, '')
  assert.equal(DEFAULT_APPEARANCE.strokeColor, '#808080', 'the outline defaults to gray')
  // Hydration replaces state wholesale: every read tolerates missing keys.
  assert.deepEqual(readAppearance(undefined), DEFAULT_APPEARANCE)
  assert.equal(readAppearance({}).stroke, true, 'a missing stroke key keeps the default outline')
  assert.equal(readAppearance({}).strokeColor, '#808080', 'a missing color key keeps the gray default')
  assert.equal(readAppearance({ stroke: false }).stroke, false, 'an explicit off survives')
  assert.equal(readAppearance({ strokeWidth: 99 }).strokeWidth, 2, 'width clamps to the slider range')
  assert.equal(readAppearance({ strokeWidth: 0 }).strokeWidth, 1, 'a zero width falls back to the default')
  // Row entries override the default FIELD BY FIELD: entries written before the
  // outline existed still inherit it.
  const merged = mergeAppearance(DEFAULT_APPEARANCE, { color: '#f85149', glow: 6 })
  assert.equal(merged.color, '#f85149')
  assert.equal(merged.glow, 6)
  assert.equal(merged.stroke, true, 'older entries inherit the default outline')
  assert.equal(merged.strokeWidth, 1)
  assert.equal(mergeAppearance(DEFAULT_APPEARANCE, { stroke: false }).stroke, false, 'a row can turn it off')
  // The pole follows the LABEL color (WCAG contrast against both poles).
  assert.equal(contrastStrokeColor([255, 255, 255]), '#000000')
  assert.equal(contrastStrokeColor([0, 0, 0]), '#ffffff')
  assert.equal(contrastStrokeColor([230, 230, 230]), '#000000')
  assert.equal(contrastStrokeColor([91, 141, 239]), '#000000')
  assert.equal(contrastStrokeColor(null), '#000000')
  assert.equal(parseCssColor('rgb(230, 230, 230)')[0], 230)
  assert.equal(parseCssColor('rgba(18, 18, 20, 0.9)')[2], 20)
  assert.equal(parseCssColor('color(srgb 0.9 0.9 0.9)')[0], 229.5, 'color(srgb ...) is understood too')
  assert.equal(parseCssColor('nonsense'), null)
  // Custom colors compute their own pole; rows without one read the sampled
  // variable so a palette flip needs no React render.
  assert.equal(strokeStyleOf({ color: '#ffffff', stroke: true, strokeWidth: 2 }).WebkitTextStrokeColor, '#808080', 'gray is the default pick')
  assert.equal(strokeStyleOf({ color: '#ffffff', stroke: true, strokeWidth: 2, strokeColor: '#f85149' }).WebkitTextStrokeColor, '#f85149', 'a picked color wins')
  assert.equal(strokeStyleOf({ color: '#ffffff', stroke: true, strokeWidth: 2, strokeColor: 'not-a-color' }).WebkitTextStrokeColor, '#808080', 'a malformed pick falls back to gray')
  assert.equal(strokeStyleOf({ color: '#ffffff', stroke: true, strokeWidth: 2, strokeColor: 'auto' }).WebkitTextStrokeColor, '#000000', 'auto derives the pole')
  assert.equal(strokeStyleOf({ color: '#0b0b0b', stroke: true, strokeWidth: 1, strokeColor: 'auto' }).WebkitTextStrokeColor, '#ffffff')
  assert.match(strokeStyleOf({ color: '', stroke: true, strokeWidth: 1, strokeColor: 'auto' }).WebkitTextStrokeColor, /--bw-stroke-color/)
  // paint-order hides the inner half of the band, so the painted width is TWICE
  // the rim the slider promises: painting the configured value left a 0.5px rim
  // that antialiasing blended away into the pale, uneven edge users reported.
  assert.equal(strokeStyleOf({ color: '#ffffff', stroke: true, strokeWidth: 1 }).WebkitTextStrokeWidth, '2px', 'a 1px rim is painted 2px wide')
  assert.equal(strokeStyleOf({ color: '#ffffff', stroke: true, strokeWidth: 2 }).WebkitTextStrokeWidth, '4px')
  assert.equal(strokeStyleOf({ color: '#ffffff', stroke: true, strokeWidth: 2 }).paintOrder, 'stroke fill')
  assert.equal(strokeStyleOf({ color: '#fff', stroke: false }), null, 'off renders no stroke style')
  // 0.11.1's offset-copy rim is gone: eight directions are four diagonal
  // samples, so slopes and curves came out as detached blocks.
  assert.doesNotMatch(text, /STROKE_DIRECTIONS|strokeShadowsOf/, 'the rim must stay a real geometric stroke')
  // Host schema + cross-device sync carry the new field.
  assert.match(read('src/index.js'), /appearance: Schema\.dict/, 'host namespace must declare appearance')
  assert.match(text, /host\.appearance && typeof host\.appearance === 'object'/, 'pull paths must carry appearance')
  assert.match(text, /scopeSet\('appearance'/, 'the push path must carry appearance')
  assert.match(text, /--bw-stroke-color/, 'the sampled variable is what unattributed rows read')
})

/**
 * Outline clipping + meta-column rules (0.10.1): an outer outline overflows the
 * glyph box, so the label's overflow:hidden (needed for the ellipsis) cut it off
 * at the left edge; the 11px meta column must not be stroked at all.
 */
test('outline: label keeps a bleed, meta column stays unstroked (0.10.1)', () => {
  const text = read('src/client.js')
  assert.match(text, /\.bw-row-label\{[^}]*padding:3px;margin:-3px/, 'the label needs a bleed for the rim')
  assert.match(text, /\.bw-row-label\{[^}]*overflow:hidden/, 'the ellipsis overflow must stay')
  assert.match(text, /\.bw-preview-label\{[^}]*padding:3px;margin:-3px/, 'the preview label bleeds too')
  assert.match(text, /\.bw-row-count,\.bw-row-time\{-webkit-text-stroke-width:0\}/, 'count/time must not be stroked')
  // The rim never travels through text-shadow, so the halo and the breathing
  // keyframes keep working exactly as they did before 0.11.1.
  assert.doesNotMatch(text, /--bw-stroke-shadow|--bw-glow-shadow|--bw-text-glow/, 'the rim must not ride in text-shadow')
  assert.match(text, /@keyframes bw-breathe-text\{0%,100%\{text-shadow:0 0 1px var\(--bw-pulse-color\)/, 'the pulse keyframes are untouched')
})

/**
 * Icon compatibility (0.10.2): dsh 0.1.6-alpha.1 replaced part of the
 * primitives icon set (IconSendOutline16 -> IconPaperPlaneOutline14 and
 * friends), so a persisted custom icon naming a retired glyph must resolve to a
 * surviving equivalent instead of rendering an empty cell.
 */
test('icons: retired glyphs resolve to a survivor; the picker follows the host set (0.10.2)', () => {
  const text = read('src/client.js')
  const start = text.indexOf('const ICON_ALIASES =')
  // Anchor on the end of resolveIconName itself, so unrelated changes to icon()
  // cannot break this slice.
  const NL = String.fromCharCode(10)
  const end = text.indexOf(NL + '    }', text.indexOf('const resolveIconName = (')) + 6
  assert.ok(start !== -1 && end !== -1 && start < end, 'icon resolution helpers not found')
  const load = (ui) => new Function('ui', text.slice(start, end) + '\nreturn { resolveIconName }')(ui)

  const oldUi = { IconSendOutline16: () => null, IconSendOutline14: () => null, IconSearchOutline16: () => null }
  assert.equal(load(oldUi).resolveIconName('IconSendOutline16'), 'IconSendOutline16', 'a live glyph is used as-is')
  assert.equal(load(oldUi).resolveIconName('IconNope'), '', 'an unknown glyph degrades to empty')
  assert.equal(load(oldUi).resolveIconName(''), '')
  assert.equal(load(oldUi).resolveIconName(undefined), '')
  assert.equal(load(oldUi).resolveIconName('solid'), '', 'legacy slots are not glyph names')

  const added = ['IconPaperPlaneOutline14', 'IconShieldOutline16', 'IconCompactOutline16', 'IconWrapLinesOutline16', 'IconPlanOutline14']
  const newUi = { IconSendOutline14: () => null }
  for (const name of added) newUi[name] = () => null
  assert.equal(load(newUi).resolveIconName('IconSendOutline16'), 'IconSendOutline14', 'a retired glyph follows its alias chain')
  assert.equal(load(newUi).resolveIconName('IconSendOutline14'), 'IconSendOutline14')
  assert.equal(load({}).resolveIconName('IconSendOutline16'), '', 'an alias with no survivor stays empty rather than crashing')

  const choicesStart = text.indexOf('const ICON_CHOICES = [')
  const choicesEnd = text.indexOf('})()', choicesStart) + 4
  assert.ok(choicesStart !== -1 && choicesEnd > choicesStart, 'icon choice list not found')
  const aliasCode = text.slice(start, end)
  const pickerCode = aliasCode + '\n' + text.slice(choicesStart, choicesEnd)
  const listOf = (ui) => new Function('ui', pickerCode + '\nreturn { ICON_CHOICES, ICON_PICKER_CHOICES }')(ui)
  const onNew = listOf(newUi)
  assert.ok(!onNew.ICON_CHOICES.includes('IconSendOutline16'), 'the retired name is gone from the committed list')
  assert.ok(onNew.ICON_CHOICES.includes('IconSendOutline14'), 'the surviving glyph is committed')
  assert.ok(onNew.ICON_PICKER_CHOICES.includes('IconSendOutline14'), 'the surviving glyph is offered')
  assert.equal(new Set(onNew.ICON_PICKER_CHOICES).size, onNew.ICON_PICKER_CHOICES.length, 'no duplicate cells')
  assert.ok(onNew.ICON_PICKER_CHOICES.includes('solid') && onNew.ICON_PICKER_CHOICES.includes('none'), 'legacy slots always survive')
  assert.ok(onNew.ICON_PICKER_CHOICES.length < onNew.ICON_CHOICES.length, 'glyphs this host lacks are filtered out')
  for (const name of added) {
    assert.ok(onNew.ICON_CHOICES.includes(name), name + ' is part of the committed list')
    assert.ok(onNew.ICON_PICKER_CHOICES.includes(name), name + ' is offered on a host that exports it')
  }
  // A host that lacks the newer glyphs still offers the survivors, never them.
  const bare = listOf({ IconSendOutline14: () => null })
  for (const name of added) assert.ok(!bare.ICON_PICKER_CHOICES.includes(name), name + ' must be filtered out on a host that lacks it')
  assert.ok(bare.ICON_PICKER_CHOICES.includes('IconSendOutline14'), 'the survivor stays offered')
})

/**
 * Session reorder fallback (0.10.2): dsh 0.1.6-alpha.1 stopped injecting
 * insertSessionBefore, which used to be the only reorder channel — the browser
 * keeps its own flat order so the gesture keeps working.
 */
test('session reorder: host action preferred, browser-local order as the fallback (0.10.2)', () => {
  const text = read('src/client.js')

  const start = text.indexOf('function reorderIds(ids, id, anchor)')
  const end = text.indexOf('const countSessionTree = (node) =>')
  assert.ok(start !== -1 && end !== -1 && start < end, 'reorderIds not found')
  const { reorderIds } = new Function(text.slice(start, end) + '\nreturn { reorderIds }')()
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b'], 'move before an anchor')
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'a', 'c'), ['b', 'a', 'c'])
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'a', undefined), ['b', 'c', 'a'], 'no anchor appends')
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'b', 'gone'), ['a', 'c', 'b'], 'a vanished anchor appends')
  assert.deepEqual(reorderIds([], 'a', undefined), ['a'])
  assert.deepEqual(reorderIds(undefined, 'a', undefined), ['a'], 'a missing list is tolerated')

  // Store action: hydration replaces state wholesale, so a state persisted
  // before this key existed must still accept the write.
  const storeStart = text.indexOf('const createViewStore = () => storeKit.defineStore({')
  const storeEnd = text.indexOf('/* ========================= title cache store')
  assert.ok(storeStart !== -1 && storeEnd !== -1 && storeStart < storeEnd, 'view store not found')
  const def = new Function('storeKit', text.slice(storeStart, storeEnd) + '\nreturn createViewStore()')({ defineStore: (d) => d })
  assert.deepEqual(def.init().sessionOrder, {}, 'init carries the new key')
  const setSessionOrder = def.actions.setSessionOrder
  const stale = { folders: [] }
  setSessionOrder(stale, 'ws1', ['a', 'b'])
  assert.deepEqual(stale.sessionOrder.ws1, ['a', 'b'])
  setSessionOrder(stale, 'ws1', [])
  assert.equal('ws1' in stale.sessionOrder, false, 'an empty order clears the entry')
  setSessionOrder(stale, 'ws2', undefined)
  assert.equal('ws2' in stale.sessionOrder, false)
  setSessionOrder(stale, 'ws3', 'not-a-list')
  assert.equal('ws3' in stale.sessionOrder, false)

  // Wiring: the host action stays authoritative; the local order only applies
  // where the host no longer injects one — or has refused for that workspace.
  // 0.1.5-rc.x resolves insertSessionBefore with a RemoteResult, so a refusal
  // arrives as {ok:false} and must never look like a silent no-op.
  assert.match(text, /typeof insertSessionBefore === 'function' && !hostOrderFailed\(workspace\.workspaceId\)/,
    'the host order wins wherever the action exists and has not refused')
  assert.match(text, /actions\.setSessionOrder\(workspaceId, reorderIds\(flat\.map/,
    'the fallback commits the move into the local order')
  assert.match(text, /const sessionOrderMap = useStore \? \(useStore\(s => s\.sessionOrder\) \|\| \{\}\) : \{\}/,
    'the browser subscribes to the local order')
  assert.match(text, /if \(typeof insertSessionBefore === 'function'\) \{\n            return Promise\.resolve\(\)/,
    'the host channel is tried first in the drop commit')
  assert.match(text, /if \(result && result\.ok === false\) throw new Error\(result\.error \? result\.error\.message : 'session reorder failed'\)/,
    'a resolved refusal is turned into an error')
  assert.match(text, /hostOrderFailedRef\.current\.add\(workspaceId\)/,
    'the refusing workspace hands the order to the device-local fallback')
  assert.match(text, /fail\(messageOf\(error\)\)/, 'the refusal is surfaced, never silent')
})

/**
 * The two-layer tree (v0.12.0). Disk nesting follows the official
 * owningParentFolder semantics — a workspace row nests under its nearest
 * registered ancestor directory, no virtual nodes for unregistered paths —
 * while name groups ("/" in titles) live INSIDE each level. This drives
 * buildTree for real across both layers.
 */
test('buildTree: disk nesting + name groups inside each level (0.12.0)', () => {
  const text = read('src/client.js')
  const helpers = new Function(text.slice(
    text.indexOf('const basename ='),
    text.indexOf('const splitPlainSegs ='),
  ) + text.slice(
    text.indexOf('const splitPlainSegs ='),
    text.indexOf('const normPath ='),
  ) + text.slice(
    text.indexOf('const DISK_SEP ='),
    text.indexOf('const countWorkspaces ='),
  ) + '\nreturn { buildTree, diskParentMapOf, normDiskPath }')()
  const { buildTree, diskParentMapOf, normDiskPath } = helpers

  // Windows paths normalize for comparison without interpreting POSIX
  // backslashes as separators.
  assert.equal(normDiskPath('C:\\Users\\kanna'), 'C:/Users/kanna')
  assert.equal(normDiskPath('/home/u/'), '/home/u')

  const items = [
    // v0.18.0: containment is TITLE-ONLY — paths are no longer tree force.
    // The old disk-nesting fixture (b under a via /home/u/web/api) becomes a
    // title-nested equivalent: same tree shape, path-agnostic.
    { workspaceId: 'a', title: 'web/前端', path: '/x/1' },
    { workspaceId: 'b', title: 'web/前端/api', path: '/x/2' },
    { workspaceId: 'c', title: 'web/后端', path: '/x/3' },
    { workspaceId: 'd', title: 'web/前端/api/d', path: '/x/4' },
    { workspaceId: 'top', title: '独立', path: '/x/5' },
  ]
  // (v0.18.0) diskParentMapOf still computes path ancestry for bookkeeping,
  // but buildTree no longer consumes it as tree force.
  const parents = diskParentMapOf(items)
  assert.equal(parents.get('a'), undefined)

  const tree = buildTree(items)
  // v0.18.0 title-only: b and d nest under a BY TITLE (web/前端/api, …/d),
  // paths are irrelevant. Root: name group web holds a and c; standalone top.
  assert.deepEqual(tree.folders.map((f) => f.name), ['web'])
  assert.deepEqual(tree.folders[0].workspaces.map((w) => w.workspaceId), ['a', 'c'])
  assert.deepEqual(tree.workspaces.map((w) => w.workspaceId), ['top'])
  // a's title children form a nested LEVEL.
  const a = tree.folders[0].workspaces[0]
  assert.ok(a.sub, 'a has nested workspaces')
  // a's sub level: b strips to leaf 'api' (root-level row); d strips to 'api/d'
  // which mounts inside the name group 'api'. b and the api group coexist.
  assert.deepEqual(a.sub.workspaces.map((w) => w.workspaceId), ['b'])
  assert.deepEqual(a.sub.folders.map((f) => f.name), ['api'])
  assert.deepEqual(a.sub.folders[0].workspaces.map((w) => w.workspaceId), ['d'])
  // Sub-level folder identity keys carry the owning chain so same-named
  // groups in different levels never share expansion/styling state.
  // (checked on b's nested level below, where d's title forms groups)
  // d's title 'web/前端/api/d' nests INSIDE b's title chain: b's sub level
  // holds the name group api (from segment 3), and d is its workspace.
  // d also title-nests under b ('web/前端/api' + '/d') → b.sub holds d directly.
  const b = a.sub.workspaces[0]
  assert.ok(b.sub, 'b has title-nested workspaces')
  assert.deepEqual(b.sub.workspaces.map((w) => w.workspaceId), ['d'], 'd nests one level below b by title')
  assert.deepEqual(b.sub.folders, [], "d strips to 'd' under b — a bare leaf, no name groups")
  // c has no nested level: sub is null, the row stays a leaf.
  assert.equal(tree.folders[0].workspaces[1].sub, null)
})

/**
 * View options (v0.13): the official group/order menu plus the two
 * slash-grouping toggles. Guards the store contract (defaults in init,
 * fallback reads), the toggle-aware tree builders, and the menu wiring
 * (feature-probed primitives Menu, disabled rows for options that cannot
 * affect the current mode, anchor suppression while recency sorts).
 */
test('view options: group/order menu + the two slash toggles (0.13.0)', () => {
  const text = read('src/client.js')
  assert.match(text, /groupBy: 'workspace-tree', orderBy: 'manual', sessionTitleSlash: true, workspaceTitleSlash: true/)
  for (const action of ['setGroupBy', 'setOrderBy', 'setSessionTitleSlash', 'setWorkspaceTitleSlash']) {
    assert.ok(text.includes(action + ': (d, value)'), 'store action ' + action)
  }
  assert.match(text, /useStore\(s => s\.groupBy\) \|\| 'workspace-tree'/)
  assert.match(text, /useStore\(s => s\.sessionTitleSlash\) !== false/)

  const helpers = new Function(text.slice(
    text.indexOf('const basename ='),
    text.indexOf('const splitPlainSegs ='),
  ) + text.slice(
    text.indexOf('const splitPlainSegs ='),
    text.indexOf('const normPath ='),
  ) + text.slice(
    text.indexOf('function buildSessionTree'),
    text.indexOf('function reorderIds'),
  ) + text.slice(
    text.indexOf('const DISK_SEP ='),
    text.indexOf('const countWorkspaces ='),
  ) + '\nreturn { buildTree, buildSessionTree }')()
  const { buildTree, buildSessionTree } = helpers

  const items = [
    // v0.18.0 title-only containment fixture.
    { workspaceId: 'a', title: 'web/前端', path: '/x/1' },
    { workspaceId: 'b', title: 'web/前端/api', path: '/x/2' },
  ]
  // Workspace slash toggle OFF: no name layer — workspaces mount straight
  // at the root level; titles stay intact either way.
  const flat = buildTree(items, false)
  assert.deepEqual(flat.folders, [], 'no name groups')
  assert.deepEqual(flat.workspaces.map((w) => w.workspaceId), ['a', 'b'], 'both at root — no name layer, no title nesting')
  assert.equal(flat.workspaces[0].leaf, 'web/前端', 'leaf keeps the full title')
  assert.equal(flat.workspaces[0].folderPath, '')
  assert.equal(flat.workspaces[0].sub, null, 'v0.18.0: no disk nesting, b is a peer by title only')

  const rows = [
    { id: '1', title: 'proj/设计' },
    { id: '2', title: 'plain' },
  ]
  // Session slash toggle OFF: every row at the root, full title as leaf.
  const sess = buildSessionTree(rows, false)
  assert.deepEqual(sess.groups, [])
  assert.deepEqual(sess.sessions.map((s) => s.leaf), ['proj/设计', 'plain'])
  // Default (toggle on) keeps the founding grouping behavior.
  const grouped = buildSessionTree(rows, true)
  assert.equal(grouped.groups.length, 1)
  assert.equal(grouped.groups[0].name, 'proj')

  // The menu mirrors the official ViewOptionsMenu and feature-probes Menu;
  // options that cannot affect the current mode render disabled.
  assert.match(text, /function ViewOptionsMenu/)
  assert.match(text, /typeof ui\.Menu !== 'function'\) return null/)
  assert.match(text, /disabled: groupBy === 'flat'/)
  assert.match(text, /disabled: groupBy !== 'workspace-tree'/)
  // Recency ordering is presentational: reorder anchors suppressed.
  assert.match(text, /if \(orderBy === 'updated'\) return null/)
  // alpha.2 retention contract: open goes through the navigation service.
  assert.match(text, /open: \(sessionId\) => \{ uiWorkspace\.openSession\(sessionId\) \}/)
  assert.match(text, /mainSessionIdOf/)
})

/**
 * The add-workspace flow runs the OFFICIAL interaction (v0.12.0): the
 * browser is the owner (open/busy/onPicked/onCancel/onError), the composed
 * picker serves the declared child hole, and a picked directory is adopted
 * with createWorkspace + startSession — the shipped browser's behavior.
 */
test('add-workspace flow: own occupant, official host services (0.12.1)', () => {
  const text = read('src/client.js')
  // The occupant flow probes the composed backend and keeps BOTH interactions.
  assert.match(text, /pickerCapabilityNow\(\)/)
  assert.match(text, /if \(kind === 'browse'\) \{ setPhase\('browsing'\); return undefined \}/)
  assert.match(text, /if \(pickerRefusal\(reason\)\) \{ markPickerBrowse\(\); setPhase\('browsing'\); return \}/)
  assert.match(text, /function DirectoryBrowseDialog\(/, 'the in-app dialog must stay available')
  // Native Hosts ride the SAME official host service (no custom chooser).
  assert.match(text, /pickDirectory: \(\) => uiWorkspace\.pickDirectory\(\)/)
  // The owner adopts with create + startSession; no parent-group popup.
  assert.match(text, /createWorkspace\(\{ path: String\(path\) \}\)/)
  assert.match(text, /startSession\(workspace\.workspaceId\)/)
  assert.doesNotMatch(text, /'flow\.parent'|'flow\.picked'|initialParent/,
    'the parent-group popup must not return')
})
/**
 * Create-folder regression (0.11.5, restored in 0.12.1): v0.11.4 folded
 * createDirectory into the success handler until only the handler was left
 * — the form closed on a resolved undefined while nothing landed on disk.
 * The seam below is driven for real; a dropped or renamed call fails here.
 */
test('in-app browser: the create action really calls the wire verb (0.11.5)', async () => {
  const text = read('src/client.js')
  const start = text.indexOf('const createFolderIn =')
  const end = text.indexOf('function DirectoryBrowseDialog(')
  assert.ok(start !== -1 && end !== -1 && start < end, 'the create seam is missing')
  const { createFolderIn } = new Function(text.slice(start, end) + '\nreturn { createFolderIn }')()

  const calls = []
  const created = await createFolderIn((path, name) => {
    calls.push([path, name])
    return Promise.resolve(path + '/' + name)
  }, '/tmp/x', 'demo')
  assert.equal(created, '/tmp/x/demo')
  assert.deepEqual(calls, [['/tmp/x', 'demo']])
  await assert.rejects(createFolderIn(() => Promise.reject(new Error('nope')), '/a', 'b'), /nope/)
  await assert.rejects(createFolderIn(() => { throw new Error('sync') }, '/a', 'b'), /sync/)

  // Wiring: the dialog's action runs through the seam exactly once.
  const submit = text.slice(text.indexOf('const submitCreate = () => {'), text.indexOf('const head = editing'))
  assert.ok(submit.length > 0, 'submitCreate not found')
  assert.equal((submit.match(/createFolderIn\(createDirectory, currentPath, name\)/g) || []).length, 1,
    'submitCreate must run the create through the seam')
  assert.doesNotMatch(submit, /Promise\.resolve\(\)\s*\n\s*\.then\(\(created\)/, 'the dangling chain must not return')
})


/**
 * Context menu (v0.14.0): mirrors the OFFICIAL row menus item-for-item —
 * same ids, icons, danger semantics, and the official 'workspace'
 * dictionary COPY bound at apply time so upstream rewording follows
 * without a release. Customize appearance appends after a separator; the
 * session archive entry is deliberately NOT destructive (official
 * semantics), and the menu renders through the official primitives Menu.
 */
test('context menu: official alignment via the workspace dictionary (0.14.0)', () => {
  const text = read('src/client.js')
  assert.match(text, /ctx\.locale\.bind\('workspace'\)/, 'binds the official dictionary')
  assert.match(text, /let officialT = null/)
  assert.match(text, /officialT,/)
  // Menu entries follow official ids, icons, and danger semantics.
  assert.match(text, /ot\('delete\.workspace'\)/)
  assert.match(text, /ot\('menu\.fork'\)/)
  assert.match(text, /ot\('menu\.archiveSession'\)/)
  assert.match(text, /ot\('rename'\)/)
  assert.match(text, /icon\('IconArchiveOutline20', 16\)/)
  assert.match(text, /icon\('IconTrashOutline16', 16\), danger: true/)
  // The archive entry must NOT be destructive (official Rows.tsx comment).
  assert.match(text, /deliberately NOT styled destructive/)
  // Rendered through the official primitives Menu, positioned by the event.
  assert.match(text, /typeof ui\.Menu === 'function'\) \? E\(ui\.Menu/)
  assert.match(text, /getAnchorRect: \(\) => new DOMRect\(ctx\.x, ctx\.y, 0, 0\)/)
  // The bw-only entries ride after a separator.
  assert.match(text, /id: 'customize', label: t\('custom\.title'\), icon: icon\('IconPersonalizationOutline16', 16\)/)
})

/**
 * Group discoverability (v0.15.0): a row could always be grouped by retyping
 * its title, but nothing in the UI said so — no "new group" affordance, and
 * drag-into-group only worked once a group already existed. The header button
 * + drop slot and the menu entry funnel into one dialog, and grouping stays a
 * name projection: no empty group container, no new store key.
 */
test('group move: one shared menu entry on every row kind, one dialog for both entry paths', () => {
  const text = read('src/client.js')
  // One shared item object, inserted into all four row-kind branches.
  assert.match(text, /const groupItem = \{ id: 'move-group', label: t\('menu\.moveToGroup'\)/, 'shared group item')
  assert.equal((text.match(/groupItem,/g) || []).length, 4, 'every row kind offers the entry')
  // One dialog serves the row menu (target locked) and the header picker.
  assert.match(text, /if \(dialog\.kind === 'group-move'\) return E\(GroupDialog/, 'dialog wiring')
  assert.match(text, /targets: dialog\.targets \|\| null/)
  assert.match(text, /onConfirm: \(tv, gv\) => submitGroupMove\(dialog\.targets \? targetOfValue\(tv\) : dialog\.target, gv\)/)
  // Module-level component: an inline definition would remount and drop input.
  assert.match(text, /function GroupDialog\(\{ title, hint, initial, targets, groupPaths, onConfirm, onClose, t \}\)/)
})

test('group move: the header "New group" button doubles as the drop slot', () => {
  const text = read('src/client.js')
  assert.match(text, /'aria-label': t\('group\.new'\)/, 'header button is labelled')
  assert.match(text, /const groupDropTarget = \(\) => drag !== null && drag\.over && drag\.over\.kind === 'newgroup'/)
  assert.match(text, /over: \{ kind: 'newgroup' \}/, 'drag over the button marks the new-group target')
  assert.match(text, /collectGroupPaths\(dialog\.target \? dialog\.target\.kind : undefined\)/, 'suggestions follow the locked kind')
  assert.match(text, /\.bw-drop-into-strong\{outline:2px solid var\(--dsw-alias-brand-primary/, 'drop highlight')
})

test('group move: titles ride renameForGrouping, host reorder stays optional', () => {
  const text = read('src/client.js')
  const start = text.indexOf('const submitGroupMove = (target, rawGroup) =>')
  const end = text.indexOf('/* ------------------------- drag & drop --------------------------')
  assert.ok(start !== -1 && end > start, 'submitGroupMove sits before the drag section')
  const body = text.slice(start, end)
  assert.match(body, /renameWorkspace\(target\.id, next\)/, 'workspace move is a plain rename')
  assert.match(body, /typeof insertWorkspaceBefore === 'function'/, 'host reorder action stays optional (0.1.6-alpha.1 contract)')
  // v0.29.0: a group move rewrites the title, so it must use the GROUPING path.
  // Routing it through renameByUser marked the session human-touched and
  // permanently disabled automatic titles for it.
  assert.match(body, /renameForGrouping\(target\.id, next\)/, 'group move uses the grouping path, not the user path')
  assert.match(body, /await renameForGrouping\(row\.id, next \+ row\.title\.slice\(target\.path\.length\)\)/, 'session-group batch move uses the grouping path too')
  assert.match(body, /for \(const w of affected\)[\s\S]*renameWorkspace\(w\.workspaceId, next \+ String\(w\.title\)\.slice\(target\.path\.length\)\)/, 'workspace-group batch move rewrites every member')
})

/**
 * Host-era compat: 0.1.6-alpha.2 replaced ISessions.binding with the
 * retention-contract using(); 0.1.5-rc.x hosts still ship binding only, where
 * the unconditional using() call threw "sessions.using is not a function" and
 * took every rename path down with it (row dialog, session-group batch, move
 * to group). Both contracts must stay wired.
 */
test('session rename: using() preferred, binding() fallback for 0.1.5-rc.x hosts', () => {
  const text = read('src/client.js')
  const start = text.indexOf('const renameSession = async (sessionId, title) =>')
  const end = text.indexOf('const forkSession = (sessionId)')
  assert.ok(start !== -1 && end > start, 'renameSession sits before forkSession')
  const body = text.slice(start, end)
  assert.match(body, /if \(typeof sessions\.using === 'function'\)/, 'the new contract is probed, never assumed')
  assert.match(body, /source: 'workspaceOperation'/, 'new contract keeps the explicit retention source')
  assert.match(body, /typeof sessions\.binding === 'function' \? sessions\.binding\(sessionId\) : undefined/, 'old binding fallback is probed too')
  assert.match(body, /face\.rename\(title\)/, 'old contract renames through the session face')
  assert.match(body, /throw new Error\('session rename is unavailable on this host'\)/, 'fails loud when neither contract exists')
})

/**
 * Session drag, second pass: dropping a session onto a session that lives
 * inside a name group joins that group (0.14.0 flat-reordered only and said so
 * in its known-limitations list), and dropping still ends at the host order —
 * with the device-local fallback whenever the host refuses. Workspace rows also
 * carry a "new group" button left of "new session".
 */
test('session drag: grouped-row drop joins the group; rows get a group button', () => {
  const text = read('src/client.js')
  const start = text.indexOf('const commitSessionDrop = (workspaceId, targetSessionId, half) =>')
  const end = text.indexOf('const commitSessionMoveInto = (workspaceId, groupPath)')
  assert.ok(start !== -1 && end > start, 'commitSessionDrop sits before commitSessionMoveInto')
  const body = text.slice(start, end)
  assert.match(body, /const targetGroup = targetRow \? groupPrefixOf\(targetRow\.title\) : ''/, 'the drop reads the target row group')
  assert.match(body, /const nextTitle = targetGroup !== '' \? targetGroup \+ '\/' \+ leafOf\(source\.title\) : leafOf\(source\.title\)/, 'the dragged leaf keeps its name under the target group')
  assert.match(body, /renameForGrouping\(source\.sessionId, nextTitle\)\.then\(commitOrder\)\.catch\(fail\)/, 'group join rewrites via the grouping path, then applies the anchor')
  assert.match(body, /if \(result && result\.ok === false\) throw new Error/, 'resolved host refusal is turned into an error')
  assert.match(body, /hostOrderFailedRef\.current\.add\(workspaceId\)/, 'the local order takes over for the refusing workspace')
  // feat2: the per-workspace group button rides the shared move dialog.
  assert.match(text, /onAddGroup \? E\('button'/, 'the workspace row renders the extra button only when it can act')
  assert.match(text, /onAddGroup: count > 0 \? \(\) => setDialog\(\{/, 'it is offered only when the workspace has sessions to move')
  assert.match(text, /targets: sessionsOf\(workspace\)\.map\(\(s\) => \(\{ value: 'sess:' \+ s\.id, label: s\.title \}\)\)/, 'picker scoped to this workspace')
})

/**
 * Official hover parity: the official browser's hover card carries the disk
 * path on a workspace row and the full display title on a session row. The
 * sidebar replacement had dropped both (display name only / no title at all),
 * so hovering stopped showing where a workspace actually lives.
 */
test('hover cards: workspace rows expose the disk path, session rows the full title', () => {
  const text = read('src/client.js')
  assert.match(text, /title: \[workspace\.title \|\| workspace\.leaf, workspace\.path\]\.filter\(Boolean\)\.join\('\\n'\)/,
    'workspace hover keeps the group-qualified name and appends the disk path')
  assert.match(text, /className: 'bw-row-label', title: node\.title \|\| node\.leaf/,
    'session hover carries the full display title again')
})

test('client.js registers Ctrl+Tab / Ctrl+Shift+Tab tab cycling (v0.17)', () => {
  const text = read('src/client.js')
  assert.match(text, /cycleTabs/, 'cycle helper must exist')
  assert.match(text, /document\.addEventListener\('keydown', handler, true\)/, 'capture-phase keydown listener')
  assert.match(text, /e\.key !== 'Tab'/, 'Tab keys only')
  assert.match(text, /e\.ctrlKey/, 'Ctrl modifier required')
  assert.match(text, /e\.shiftKey \? -1 : 1/, 'Shift reverses direction')
  assert.match(text, /e\.preventDefault\(\)/, 'prevent the browser tab switch')
  // v0.27.0 added the showArchived argument, so the call now passes a fourth
  // parameter; assert the call shape loosely so either form is accepted.
  assert.match(text, /sessionVisible\(summary, currentId, archivedSet[,)]/, 'tabs must be visibility-filtered')
})

test('client.js does not hard-inject settingsScope (desktop 0.2.x compat, v0.15.1)', () => {
  const text = read('src/client.js')
  assert.doesNotMatch(text, /inject: \[[^\]]*settingsScope/, 'settingsScope must stay a runtime probe, not an inject dependency')
  assert.match(text, /ctx\.settingsScope && typeof ctx\.settingsScope\.bind/, 'probe fallback must remain')
})

test('client.js consumes the host ui status store with legacy fallback (v0.16.0)', () => {
  const text = read('src/client.js')
  assert.match(text, /useSessionStatus/, 'standard face hook must be consumed')
  assert.match(text, /statusFaceOf/, 'unified per-row status derivation')
  assert.match(text, /completionUnread === true/, 'completed follows the official completionUnread contract')
  assert.match(text, /return 'idle'/, 'plain sessions render the official idle dot')
})

test('client.js mirrors official status presentation (v0.16.1)', () => {
  const text = read('src/client.js')
  assert.match(text, /status\.compact\.planReview/, 'official compact trailing keys')
  assert.match(text, /ot\('status\.waitingApproval'\)/, 'official dictionary copy preferred')
  assert.match(text, /status && status\.trailing \? status\.trailing : timeLabel/, 'official trailingLabel ?? timeLabel contract')
})

test('client.js cycles session tabs across groups with two persisted orders (v0.17)', () => {
  const text = read('src/client.js')
  assert.match(text, /cycleTabs/, 'session-level cycle helper')
  assert.match(text, /tabCycleOrder/, 'order persists in the view store')
  assert.match(text, /setTabCycleOrder/, 'store action exists')
  assert.match(text, /'recent' \? 'page' : 'recent'/, 'header button toggles the order')
  assert.match(text, /IconClockOutline16/, 'recent order uses the official clock icon')
  assert.match(text, /cycle\.order\.page/, 'i18n keys shipped')
})

test('containment follows the title, folders drag, chains show a visual separator (v0.18.0)', () => {
  const text = read('src/client.js')
  assert.match(text, /return buildLevel\(list, '', \[\], true\)/, 'tree built from ALL workspaces by title segments')
  // v0.23.0 cycle guard: a workspace sharing a name with its own group used to
  // recurse forever (the "same session keeps reappearing" bug), so every
  // ancestor title is carried down and excluded from the child set.
  assert.match(text, /idPrefixTitles/, 'ancestor-title chain carried through recursion')
  assert.match(text, /!seen\.includes\(String\(w\.title \|\| ''\)\)/, 'ancestor titles excluded from children')
  // v0.23.0 double-placement guard: a title-nested workspace must not ALSO be
  // emitted in its own name folder (that is the duplicate row the user saw).
  assert.match(text, /const nestedIds = new Set\(\)/, 'pre-pass collects nested workspace ids')
  assert.match(text, /if \(isRoot && nestedIds\.has\(workspace\.workspaceId\)\) continue/, 'root level skips already-nested rows only')
  assert.match(text, /folderDragEvents/, 'folder rows are drag sources')
  assert.match(text, /commitFolderMoveInto/, 'folder drop commit')
  assert.match(text, /segs\.join\(' › '\)/, 'compressed chains render a visual separator, not a raw slash')
  assert.doesNotMatch(text, /const sameDisk = source\.disk/, 'disk-layer gating removed from drop commits')
})

test('interaction hub renders in the additive composer dock (v0.24.0)', () => {
  const text = read('src/client.js')
  assert.match(text, /slots\.inject\('conversation\.composer\.dock'/, 'registers into the additive dock list')
  assert.match(text, /function InteractionComposerPanel/, 'composer panel component exists')
  assert.doesNotMatch(text, /InteractionHubModal/, 'the centered-modal variant is gone')
  assert.doesNotMatch(text, /bw-hub-panel/, 'no hand-rolled absolute panel')
  assert.match(text, /useHubOpen/, 'sidebar trigger and composer panel share one open flag')
  assert.match(text, /bw-hub-card\{[^}]*border-radius:16px/, 'card follows the native approval shape')
  // v0.24.0: an ADDITIVE strip must ride the LIST hole `composer.dock`.
  // v0.23 wrongly took `conversation.composer`, a SINGLE-occupancy hole whose
  // first non-null select OWNS the composer area — a permanently non-null select
  // there evicted the shipped composer and the user's input box disappeared.
  assert.match(text, /slots\.inject\('conversation\.composer\.dock'/, 'hub rides the additive dock list')
  assert.doesNotMatch(text, /slots\.inject\('conversation\.composer',/, 'must never take the single-occupancy composer hole')
  assert.doesNotMatch(text, /hubSeat/, 'the single-hole select sentinel is gone')
  assert.doesNotMatch(text, /pendingInteraction === undefined \? null : pendingInteraction/,
    'select must not gate on this session having an interaction')
})

/* ---------------------------------------------------- drag fixes (v0.26.0) --
 * Two reported defects, both rooted in the folder-row drop semantics:
 *  1. a group could only be "moved into" — never placed BEFORE another group or
 *     between two groups, because the row had exactly one drop meaning;
 *  2. dropping the CUMCM26 group onto the root stripped the prefix from EVERY
 *     member, so the whole group scattered to the top level.
 */
test('folder rows expose edge bands so a group can be placed beside another', () => {
  const text = read('src/client.js')
  assert.match(text, /const folderEdgeBand = \(event\) => \{/, 'edge-band helper exists')
  assert.match(text, /if \(event\.clientY < rect\.top \+ 6\) return 'before'/, 'top 6px band means insert before')
  assert.match(text, /if \(event\.clientY > rect\.bottom - 6\) return 'after'/, 'bottom 6px band means insert after')
  assert.match(text, /return null/, 'the middle keeps the move-into meaning')
  // The drop must branch on the band, not always move-into.
  assert.match(text, /const band = folderEdgeBand\(event\)/, 'drop reads the band')
  assert.match(text, /commitFolderReorder\(path, band\)/, 'group drags beside a sibling have their own commit')
  assert.match(text, /commitWorkspaceReorderBeside\(path, band\)/, 'workspace drags beside a group have their own commit')
  // And the visual affordance exists: the folder row accepts dropHalf.
  assert.match(text, /function FolderRow\(\{ node, depth, expanded, onToggle, onContextMenu, dropInto, dropHalf,/, 'folder row accepts dropHalf')
  assert.match(text, /dropHalf === 'before' && 'bw-drop-before'/, 'before-line renders')
  assert.match(text, /dropHalf === 'after' && 'bw-drop-after'/, 'after-line renders')
})

test('dropping a group on the root no longer scatters its members', () => {
  const text = read('src/client.js')
  // The old destructive loop must be gone: it renamed every member to its leaf.
  assert.doesNotMatch(text, /for \(const w of affected\) \{\s*\n\s*const segs = splitTitleSegs\(w\.title\)\s*\n\s*await renameWorkspace\(w\.workspaceId, segs\[segs\.length - 1\]\)/,
    'the prefix-stripping loop over every member is removed')
  assert.match(text, /ROOT DROP IS A NO-OP \(v0\.26\.0 BUG FIX\)/, 'the fix is documented at the drop site')
  // A workspace dropped on the root still un-groups — but only itself.
  assert.match(text, /if \(dragMatches\('workspace'\)\) \{[\s\S]{0,220}renameWorkspace\(source\.workspaceId, source\.leaf\)/,
    'a single workspace still un-groups itself on a root drop')
})

test('sibling order writer keeps other levels intact', () => {
  const text = read('src/client.js')
  assert.match(text, /const writeWorkspaceOrder = \(siblings, movedKey, anchorKey, half\)/, 'order writer exists')
  assert.match(text, /const rest = \(Array\.isArray\(workspaceGroupOrder\) \? workspaceGroupOrder : \[\]\)\.filter\(\(k\) => !set\.has\(k\)\)/,
    'keys from other levels are preserved')
  assert.match(text, /without\.splice\(half === 'after' \? idx \+ 1 : idx, 0, movedKey\)/, 'the moved key lands before/after the anchor')
})

/* ------------------------------------------- archive & delete (v0.27.0) ---
 * Two capabilities the plugin was missing:
 *  - archived sessions were filtered out unconditionally, so "archive" looked
 *    like a one-way black hole with no way to look inside or undo;
 *  - there was no way to delete a session for good (the host exposes none).
 */
test('archived rows can be revealed and carry a visual marker', () => {
  const text = read('src/client.js')
  assert.match(text, /const sessionVisible = \(summary, current, archivedSet, showArchived\)/,
    'visibility accepts the showArchived flag')
  assert.match(text, /showArchived === true \|\| !\(archivedSet && archivedSet\.has\(summary\.id\)\)/,
    'the flag bypasses the archive filter')
  assert.match(text, /const showArchived = prefsMap\.showArchived === true/, 'preference is read defensively')
  assert.match(text, /archived: archivedSet\.has\(session\.id\)/, 'row is told it is archived')
  assert.match(text, /archived && 'bw-row-archived'/, 'archived rows get their own class')
  assert.match(text, /\.bw-row-archived\{opacity:\.62\}/, 'dimmed styling exists')
})

test('archived rows offer unarchive, others offer archive', () => {
  const text = read('src/client.js')
  assert.match(text, /const isArchived = ctx\.kind === 'session' && archivedSet\.has\(ctx\.payload\.id\)/,
    'menu knows whether the row is archived')
  assert.match(text, /isArchived\s*\n\s*\? \{ id: 'unarchive'/, 'archived rows swap in unarchive')
  assert.match(text, /id === 'unarchive'[\s\S]{0,120}unarchiveSession\(payload\.id\)/, 'unarchive calls the host')
  assert.match(text, /unarchiveSession: typeof uiWorkspace\.unarchiveSession === 'function'/, 'host action is feature-probed')
})

test('permanent delete exists, is destructive, and confirms first', () => {
  const text = read('src/client.js')
  assert.match(text, /id: 'delete-forever'/, 'a delete-forever menu item exists')
  assert.match(text, /label: t\('menu\.deleteForever'\),[^}]*danger: true/, 'it is styled destructive')
  assert.match(text, /setDeleteSession\(\{ session: payload \}\)/, 'selecting it opens a confirmation')
  assert.match(text, /submitSessionDelete/, 'the delete submit path exists')
  assert.match(text, /fetch\('\/api\/better-workspace\/delete'/, 'it calls the host route')
  // Archiving must stay reversible-looking; the destructive action is separate.
  assert.ok(text.includes("id === 'archive') { Promise.resolve().then(() => archiveSession(payload.id))"),
    'archive remains the non-destructive path')
})

test('host half can delete an archive and moves it aside by default', () => {
  // v0.27.0 keeps this in its own module so the host entry stays tiny.
  const host = read('src/delete-session.mjs') + read('src/index.js')
  assert.match(host, /export function deleteSessionArchive/, 'host delete helper exists')
  assert.match(host, /keepCopy === false/, 'an explicit opt-out exists for unlinking')
  assert.match(host, /sessions-deleted-/, 'the default destination is a dated .del folder')
  assert.match(host, /fs\.renameSync\(dir, dest\)/, 'default path MOVES rather than removes')
  assert.match(host, /export function encodeSegment/, 'session id encoder is re-implemented')
  assert.match(host, /export function projectKey/, 'project key encoder is re-implemented')
  assert.match(host, /SESSION_ROUTE \+ '\/delete'/, 'route path is built from one constant')
  assert.match(host, /req\.method !== 'POST'/, 'the route refuses non-POST')
  assert.match(host, /invalid sessionId/, 'the session id is validated before touching the filesystem')
})

/* ---------------------------------------------- behaviour, not presence ---
 * The rules in the workspace's DONE-CRITERIA.md: a UI task is only done when it
 * was actually RENDERED and the resulting behaviour was observed. These two
 * tests exist because the previous round reported both features as complete on
 * the strength of grep matches, and the user found neither worked.
 */
test('every rendered button carries an icon (not just "icon(...) exists")', () => {
  const text = read('src/client.js')
  // Session rows must own the two official row-action occupants. Before this,
  // SessionRow had NO action span at all — the buttons did not exist, so there
  // was nothing to give an icon to, and every grep still looked fine.
  const row = text.slice(text.indexOf('function SessionRow('), text.indexOf('function ViewOptionsMenu'))
  assert.match(row, /className: 'bw-row-actions'/, 'session rows own a hover action span')
  assert.match(row, /onArchiveToggle \? E\('button'/, 'archive hover button exists')
  assert.match(row, /onPinToggle \? E\('button'/, 'pin hover button exists')
  assert.match(row, /IconArchiveOutline20/, 'archive button carries an icon')
  assert.match(row, /icon\('IconRightUpOutline16', 14\)/, 'pin button carries a real primitives icon')
  // The header's "new group" button used to be text-only.
  assert.match(text, /bw-newgroup-btn[^]*?icon\('IconFolderClose16'/, 'new-group button carries an icon')
  // Hover reveal, mirroring the official row.
  assert.match(text, /\.bw-row:hover \.bw-row-actions/, 'row actions are revealed on hover')
})

test('pinning reorders WITHIN a section, exactly like the shipped sectionMembers()', () => {
  const text = read('src/client.js')
  // Ported from @deepseek-ai/dsh-client-ui-workspace/lib/client.js:
  //   blank first, then pinned-and-not-archived, then the rest.
  assert.match(text, /const withPinned = \(rows\) => \{/, 'pin partition helper exists')
  assert.match(text, /if \(row\.blank\) placeholders\.push\(row\)/, 'the provisional blank row leads')
  assert.match(text, /pinnedSet\.has\(row\.id\) && !archivedSet\.has\(row\.id\)/, 'pinned-but-archived falls to rest')
  assert.match(text, /return placeholders\.concat\(leading, rest\)/, 'the shipped output order')
  // All three order branches must apply it.
  assert.match(text, /return withPinned\(sorted\)/, 'recency order applies the partition')
  assert.match(text, /return withPinned\(out\)/, 'manual order applies the partition')
  assert.match(text, /return withPinned\(rows\)/, 'the untouched order applies the partition')
  // Host order inside `leading` is preserved.
  assert.match(text, /const rank = new Map\(pinnedSessionIds\.map/, 'pinned ids keep the host array order')
})

test('there is NO global pinned block — the shipped browser has none', () => {
  const text = read('src/client.js')
  // My earlier global block above every workspace was invented; reading the
  // shipped bundle showed pinning is per-section only.
  assert.doesNotMatch(text, /renderPinnedBlock/, 'no global pinned block')
  assert.doesNotMatch(text, /bodyRows = \[\.\.\.pinBlock/, 'nothing is prepended to the whole tree')
})

test('ghost rows (cache entry, no archive file) never render', () => {
  const text = read('src/client.js')
  assert.match(text, /const hasArchive = \(sessionId\) => archiveIds === null \|\| archiveIds\.has/, 'archive presence gates visibility')
  assert.match(text, /&& hasArchive\(summary\.id\)/, 'sessionVisible consults it')
  assert.match(text, /refreshArchiveIds/, 'the host audit is fetched')
  assert.match(text, /useArchiveIds\(\)/, 'the component subscribes to it')
  // Unknown must NEVER hide real rows.
  assert.match(text, /archiveIds === null \|\|/, 'unknown archive set stands down')
  // Host side must expose the audit.
  const host = read('src/delete-session.mjs')
  assert.match(host, /export function auditSessionArchives/, 'host can report which sessions really exist')
  assert.match(host, /SESSION_ROUTE \+ '\/archives'/, 'the audit is exposed as a route')
})

test('approval directory extraction handles the REAL interaction shape', () => {
  const text = read('src/client.js')
  // The approval contract declares displayReason as a LOCALE MAP, not a string.
  // Assigning it straight to a React child rendered "[object Object]", so the
  // extractor never received a command and the summary was silently empty —
  // that is why the user reported this feature as not done at all.
  assert.match(text, /function resolveInteractionText/, 'a locale-map resolver exists')
  assert.match(text, /for \(const key of \[lang, short, 'zh', 'en'\]\)/, 'it resolves the active locale then falls back')
  assert.match(text, /reason: resolveInteractionText\(it\)/, 'collectInteractions uses the resolver')
  assert.doesNotMatch(text, /reason: it\.displayReason \|\| it\.reason/, 'the raw object is never passed through')
  // The command text for a tool approval lives in the tool call's arguments.
  assert.match(text, /rawArguments: it\.arguments \|\| it\.rawArguments/, 'tool-call arguments are carried')
  assert.match(text, /const fromArgs = extractWriteDirectories\(text\)/, 'the extractor runs on those arguments')
})

test('directory extraction drops read-only statements from a realistic script', () => {
  const text = read('src/client.js')
  const start = text.indexOf('const WRITE_VERBS = [')
  const em = 'const extractWriteDirectories = (rawText) => {'
  const e = text.indexOf(em)
  // bracket-match the arrow function body
  let i = text.indexOf('{', e)
  let d = 0
  let j = i
  for (; j < text.length; j += 1) {
    if (text[j] === '{') d += 1
    else if (text[j] === '}') { d -= 1; if (d === 0) { j += 1; break } }
  }
  const fn = new Function(text.slice(start, j) + ';\nreturn extractWriteDirectories;')()

  const B = String.fromCharCode(92)
  const NL = String.fromCharCode(10)
  const p = (...parts) => parts.join(B)
  const script = [
    'Write-Output "scan"',
    `Get-ChildItem ${p('C:', 'work')} -Recurse | Measure-Object`,
    `Test-Path ${p('C:', 'work', 'target')}`,
    `Get-Process | Where-Object { $_.ProcessName -match "node" }`,
    `New-Item -ItemType Directory -Path ${p('C:', 'work', 'target')} -Force`,
    `Copy-Item ${p('C:', 'work', 'a.txt')} ${p('C:', 'work', 'target', '')}`,
    `Remove-Item -LiteralPath ${p('C:', 'work', 'old')} -Recurse -Force`,
  ].join(NL)

  const r = fn(script)
  assert.equal(r.statements, 7, 'every statement is examined')
  assert.equal(r.writeStatements, 3, 'exactly the three write statements survive')
  assert.equal(r.dropped, 4, 'four read-only statements are dropped')
  assert.ok(r.directories.length > 0, 'directories were extracted')
  assert.ok(r.directories.every((x) => !x.includes('Recurse')), 'no flag leaked into a path')
})


test('registry never registers a session without an archive file', () => {
  // Data invariant proven against the live registry after the cleanup: every
  // registered id must have a real session.v4.jsonl.zstd. A cache entry alone
  // is not enough — that is what produced rows opening to an empty transcript.
  const REG = 'C:/Users/Andy/.dsh/storages/workspace.json'
  const ROOT = 'C:/Users/Andy/.dsh/sessions'
  if (!existsSync(REG)) return               // registry not present on this host
  const reg = JSON.parse(readFileSync(REG, 'utf8'))
  const present = new Set()
  for (const slug of readdirSync(ROOT)) {
    const sd = join(ROOT, slug)
    if (!statSync(sd).isDirectory()) continue
    for (const sid of readdirSync(sd)) {
      if (existsSync(join(sd, sid, 'session.v4.jsonl.zstd'))) present.add(sid)
    }
  }
  const ghosts = []
  for (const [wid, rec] of Object.entries(reg.tables.workspaces)) {
    for (const sid of rec.sessionIds || []) {
      if (!present.has(sid)) ghosts.push(wid + '/' + sid)
    }
  }
  assert.deepEqual(ghosts, [], 'no registered session may lack an archive file')
})

test('every icon name exists in the real primitives export list', () => {
  // The previous icon test used a Proxy that answered for ANY `Icon*` name, so
  // it passed while four names did not exist and rendered as null — buttons
  // looked iconless. This one compares against the authoritative export list in
  // the dsh source checkout (packages/client/ui-primitives/src/icons/index.tsx).
  const ICONS_SRC = 'C:/Users/Andy/dsh/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx'
  if (!existsSync(ICONS_SRC)) return   // source checkout absent on this host
  const real = new Set(
    [...readFileSync(ICONS_SRC, 'utf8').matchAll(/export const (Icon[A-Za-z0-9]+)/g)].map((m) => m[1]),
  )
  assert.ok(real.size > 50, 'the export list parsed correctly')
  const text = read('src/client.js')
  const used = new Set()
  for (const m of text.matchAll(/icon\('([A-Za-z0-9]+)'/g)) used.add(m[1])
  for (const m of text.matchAll(/\bui\.(Icon[A-Za-z0-9]+)/g)) used.add(m[1])
  const missing = [...used].filter((n) => !real.has(n))
  assert.deepEqual(missing, [], 'no icon name may be absent from primitives (it renders as null)')
})

test('workspace rows always show a folder icon, and folder precedes the chevron', () => {
  const text = read('src/client.js')
  // The shipped row renders <span folder><span chevron>; a workspace with no
  // user-picked icon must still get the default folder glyph.
  assert.match(text, /if \(!mode \|\| mode === 'solid' \|\| mode === 'folder'\)/, 'an unset mode means the solid folder')
  assert.match(text, /icon\(expanded \? 'IconFolderOpen16' : 'IconFolderClose16', 16\)/, 'the folder glyph is actually produced')
  // Order: folder slot first, chevron second.
  const row = text.slice(text.indexOf('function WorkspaceRow('), text.indexOf('function SessionGroupRow('))
  const folderAt = row.indexOf("'bw-row-icon', 'bw-folder-slot'")
  const chevronAt = row.indexOf("'bw-chevron'")
  assert.ok(folderAt > 0 && chevronAt > 0, 'both slots exist')
  assert.ok(folderAt < chevronAt, 'folder comes before the chevron, like the shipped row')
})

test('row typography: shipped font size, user-chosen density', () => {
  const text = read('src/client.js')
  // Font size follows the shipped Rows.module.css (14px); the row HEIGHT does
  // not: the user explicitly found 34px too tall for a dense tree and asked for
  // tighter rows, so density is their call and the type scale is the bundle's.
  assert.match(text, /\.bw-row\{[^}]*font-size:14px/, 'row text is 14px')
  assert.match(text, /\.bw-row\{[^}]*line-height:20px/, 'row line-height is 20px')
  assert.match(text, /\.bw-row\{[^}]*min-height:28px/, 'rows are 28px tall by user preference')
  assert.match(text, /'\.bw-sgroup-row\{min-height:26px/, 'group rows are slightly tighter still')
})

/* ---------------------------------- tab-group rail + global pinned (v0.28) --- */
test('session groups render a coloured tab-group rail, not a folder icon', () => {
  const text = read('src/client.js')
  // Edge/Chrome tab-group idiom: one thin coloured bar, narrow enough for deep
  // nesting, instead of a folder glyph that pushed the label right.
  assert.match(text, /const TAB_GROUP_COLORS = \[/, 'a stable colour table exists')
  assert.match(text, /const tabGroupColor = \(name\) => \{/, 'colour is derived from the group name')
  // v0.30.1 uses the Edge/Chrome idiom properly: a coloured PILL with the group
  // name, plus a rail in the same colour continuing through the members.
  assert.match(text, /className: cls\('bw-group-pill'/, 'the group row renders a coloured pill')
  assert.match(text, /style: \{ background: tabGroupColor\(name\) \}/, 'the pill carries the group colour')
  assert.match(text, /'\.bw-group-pill\{[^']*border-radius:11px/, 'the pill is a rounded capsule')
  assert.match(text, /bw-sgroup-member-rail/, 'members draw the same colour as a left rail')
  assert.match(text, /renderSessionNode\(group, workspaceId, depth \+ 1, tabGroupColor\(group\.name\)\)/,
    'the colour is inherited down the whole subtree')
  // The style must be switchable back to the folder look.
  assert.match(text, /const groupIcon = prefsMap\.groupIcon === 'folder' \? 'folder' : 'tab'/, 'the style preference exists')
  assert.match(text, /settings\.groupIcon/, 'the settings toggle exists')
})

test('settings entries live in OUR header and never occupy a shell single-slot', () => {
  const text = read('src/client.js')
  // `settings.launcher` is kind:"single": occupying it REPLACES the shipped
  // Settings button (that is exactly how the user lost it at v0.28.0). So the
  // plugin must never register that hole.
  assert.doesNotMatch(text, /slots\.inject\('settings\.launcher'/, 'never take the launcher single-slot')
  assert.doesNotMatch(text, /slots\.inject\('settings\.trigger'/, 'never take the trigger single-slot')

  // Instead: our own buttons in our own header.
  assert.match(text, /const labelsSettings = \(\) => \{/, 'a settings label helper exists')
  assert.match(text, /const openSettingsPage = \(page\) => \{/, 'a settings opener exists')
  assert.match(text, /'aria-label': labelsSettings\(\)/, 'the header renders a Settings button')
  assert.match(text, /'aria-label': labelsLauncher\(\)/, 'the header renders a Plugins button')

  // The opener dispatches the shell's own settings.open shortcut (Ctrl+,).
  assert.match(text, /key: ','/, 'it dispatches the comma key')
  assert.match(text, /ctrlKey: true/, 'with the primary modifier')
  assert.match(text, /document\.dispatchEvent\(ev\)/, 'on document, where the shell listens')

  // It must be defined BEFORE the component that uses it, or painting throws
  // ReferenceError (this actually happened and the paint test caught it).
  const defAt = text.indexOf('const labelsSettings = () => {')
  const useAt = text.indexOf("'aria-label': labelsSettings()")
  assert.ok(defAt > 0 && useAt > 0 && defAt < useAt, 'the helper is defined before its use')

  // And a settings page can be contributed safely: settings.section is a list.
  assert.match(text, /slots\.inject\('settings\.section'/, 'a settings page is registered on the LIST slot')
})

test('a failing drag commit cannot take the sidebar down (v0.28)', () => {
  const text = read('src/client.js')
  // Drag commits run inside DOM handlers, outside React's render tree, so
  // QuietBoundary does NOT catch them. The user hit this: a bad drag errored
  // and the sidebar stopped accepting drags until restart.
  const start = text.indexOf('const safeCommit = (label, fn) =>')
  assert.ok(start > 0, 'safeCommit exists')
  // Take the whole arrow-returned function: from the opener to the matching brace
  // of its body, so the slice is self-contained and parseable.
  const opener = text.indexOf('=> (...args) => {', start)
  assert.ok(opener > 0, 'safeCommit wraps a variadic function')
  let i = text.indexOf('{', opener)
  let depth = 0
  let j = i
  for (; j < text.length; j += 1) {
    if (text[j] === '{') depth += 1
    else if (text[j] === '}') { depth -= 1; if (depth === 0) { j += 1; break } }
  }
  // Rebuild just the wrapper so the test does not depend on the surrounding scope.
  const src = 'const safeCommit = (label, fn) => (...args) => ' + text.slice(i, j)
  const safeCommit = new Function(src + '\nreturn safeCommit;')()

  let cleared = 0
  let reported = null
  const real = new Function('setDrag', 'fail', src + '\nreturn safeCommit;')(
    () => { cleared += 1 },
    (m) => { reported = m },
  )
  const boom = real('drag', () => { throw new Error('workspace rename exploded') })
  assert.equal(boom(), undefined, 'the wrapper swallows the throw')
  assert.equal(cleared, 1, 'drag state is cleared so the next gesture works')
  assert.match(String(reported), /workspace rename exploded/, 'the failure is surfaced inline')

  // And the malformed-title guard that caused one of these throws.
  assert.match(text, /if \(!source \|\| drag\.kind !== 'workspace' \|\| source\.workspaceId === undefined\) return/,
    'a cross-kind drag is refused instead of building an "undefined" title')
  assert.match(text, /const leaf = String\(source\.leaf \|\| source\.title \|\| ''\)\.trim\(\)/,
    'the title leaf is validated before use')
  assert.doesNotMatch(text, /const newTitle = tgtParent !== '' \? tgtParent \+ '\/' \+ source\.leaf/,
    'the old undefined-title path is gone')
})

/* ------------------------ auto-title compatibility (v0.29.0) ---
 * @deepseek-ai/dsh-session-title only auto-names a session while the title
 * source stays 'provider'/'fallback'. A rename claims the title
 * (source.kind='user') and the provider then stops. Grouping is expressed as a
 * "/"-prefix on the title, so every group drag used to silently disable
 * auto-naming for the sessions it moved. These tests pin the separation.
 */
test('grouping changes never claim the title (auto-naming must survive)', () => {
  const text = read('src/client.js')
  // The grouping path exists and does NOT register a human edit.
  const gStart = text.indexOf('const renameForGrouping = (sessionId, title) => {')
  assert.ok(gStart > 0, 'renameForGrouping exists')
  const gEnd = text.indexOf(String.fromCharCode(10) + '      }', gStart)
  const gBody = text.slice(gStart, gEnd)
  assert.doesNotMatch(gBody, /humanTouchedRef\.current\.add/,
    'grouping must not mark the session human-touched')
  assert.match(gBody, /groupDerivedTitlesRef\.current\.set/,
    'the group-derived title is remembered so auto-name can recognise it')
  assert.match(gBody, /renameSession\(sessionId, title\)/,
    'the host rename still happens (the prefix really must change)')

  // The user path is the only place that claims a title.
  const uStart = text.indexOf('const renameByUser = (sessionId, title) => {')
  const uBody = text.slice(uStart, uStart + 400)
  assert.match(uBody, /humanTouchedRef\.current\.add/, 'only a user rename claims the title')
})

test('every group-drag call site uses the grouping path', () => {
  const text = read('src/client.js')
  // The eight grouping rewrites (drag join, batch move, nest, re-prefix, …)
  const calls = (text.match(/renameForGrouping\(/g) || []).length
  assert.ok(calls >= 8, 'grouping rewrites go through their own path')
  // And the dialog is the single user-intent call.
  const dStart = text.indexOf('const submitSessionRename = (session, nextTitle) => {')
  const dBody = text.slice(dStart, dStart + 400)
  assert.match(dBody, /renameByUser\(/, 'the rename dialog still uses the user path')
})

/* ------------------------------------------- column view + archive (v0.30) --- */
test('column view splits workspaces and sessions into two panes', () => {
  const text = read('src/client.js')
  // A fourth grouping mode beside workspace / workspace-tree / flat.
  assert.match(text, /id: 'columns', label: t\('viewOptions\.columns'\)/, 'the menu entry exists')
  assert.match(text, /id === 'flat' \|\| id === 'columns'/, 'selecting it switches groupBy')
  assert.match(text, /const renderColumnsNav = \(\) => \{/, 'left pane renderer exists')
  assert.match(text, /const renderColumnsSessions = \(\) => \{/, 'right pane renderer exists')
  // Both panes must read the SAME data path as the tree, so a fix applies to both.
  assert.match(text, /const visible = sessionsOf\(workspace\)/, 'the nav pane counts through sessionsOf')
  assert.match(text, /pinnedSetForTree, pinRankForTree/, 'the session pane reuses the grouped tree, pinning included')
  // Two independent scroll regions.
  assert.match(text, /'\.bw-columns\{flex:1;display:flex/, 'the panes sit side by side')
  assert.match(text, /'\.bw-column\{overflow-y:auto/, 'each pane scrolls independently')
  // Selecting on the left persists, so reopening keeps the same workspace.
  assert.match(text, /columnsActiveWorkspace/, 'the active pane selection persists')
})

test('archived rows can be revealed, unarchived, and deleted for good', () => {
  const text = read('src/client.js')
  // Reveal
  assert.match(text, /const showArchived = prefsMap\.showArchived === true/, 'reveal preference is read')
  assert.match(text, /settings\.showArchived/, 'the settings switch exists')
  assert.match(text, /'\.bw-row-archived\{opacity/, 'revealed rows are visually distinct')
  // Unarchive in place
  assert.match(text, /id: 'unarchive'/, 'an unarchive menu item exists')
  assert.match(text, /unarchiveSession: typeof uiWorkspace\.unarchiveSession === 'function'/, 'host action is feature-probed')
  // Permanent delete, destructive and confirmed
  assert.match(text, /id: 'delete-forever'/, 'a delete-forever item exists')
  assert.match(text, /danger: true/, 'it is styled destructive')
  assert.match(text, /better-workspace\/delete/, 'it calls the host route')
  // Host side moves aside by default rather than unlinking.
  const host = read('src/delete-session.mjs')
  assert.match(host, /export function deleteSessionArchive/, 'host delete helper exists')
  assert.match(host, /sessions-deleted-/, 'default is a dated .del folder')
  assert.match(host, /keepCopy === false/, 'unlinking requires an explicit opt-out')
})

/* ------------------------- approval ordering + collapsible (v0.30.4) --- */
test('approval directory extraction: source excluded, command order kept', () => {
  const text = read('src/client.js')
  // A copy/move marks its FIRST path as a source (read-only). Listing it as a
  // directory the approval modifies was wrong.
  assert.match(text, /const SOURCE_FIRST_VERBS = \/\^\(cp\|copy\|copy-item/, 'source-first verbs are recognised')
  assert.match(text, /if \(sourceFirst && index === 0\) return/, 'the source path is skipped')
  // The list must follow the order the commands appear, not an alphabetical sort.
  assert.match(text, /const ordered = \[\]/, 'an ordered accumulator exists')
  assert.match(text, /dirs\.sort\(\(a, b\) => \(firstAt\.get\(a\.toLowerCase\(\)\) \?\? 0\) - \(firstAt\.get\(b\.toLowerCase\(\)\) \?\? 0\)\)/,
    'final order follows first-seen position')
  // Siblings still collapse to their common parent, which keeps the answer short.
  assert.match(text, /Pass 2: repeatedly lift SIBLINGS to their common parent/, 'sibling collapsing exists')
})

test('levels get a configurable collapse count', () => {
  const text = read('src/client.js')
  // Menu entries on a workspace and on a name group.
  const wsMenu = text.slice(text.indexOf("if (ctx.kind === 'workspace') return ["), text.indexOf("if (ctx.kind === 'session') return ["))
  assert.match(wsMenu, /id: 'watermark'/, 'a workspace can set the count')
  const folderMenu = text.slice(text.indexOf("if (ctx.kind === 'folder') return ["), text.indexOf("if (ctx.kind === 'session') return ["))
  assert.match(folderMenu, /id: 'watermark'/, 'a name group can set the count')
  // Dialog writes through the store action used by the renderer.
  assert.match(text, /dialog\.kind === 'watermark'/, 'the numeric dialog exists')
  assert.match(text, /actions\.setSessionWatermark\(dialog\.levelKey, Math\.floor\(n\)\)/, 'it persists the value')
  // Workspace-level value is the default for every group inside it.
  assert.match(text, /const wmWsKey = \(workspaceId \|\| ''\) \+ '\|'/, 'a workspace-level key exists')
  assert.match(text, /Number\.isFinite\(wmExact\) \? wmExact : \(Number\.isFinite\(wmInherited\)/, 'group falls back to workspace')
})

test('a session can collapse or expand its own group', () => {
  const text = read('src/client.js')
  const sessMenu = text.slice(text.indexOf("if (ctx.kind === 'session') return ["), text.indexOf('if (ctx.kind === \'sgroup\''))
  assert.match(sessMenu, /id: 'toggle-group'/, 'the menu item exists')
  assert.match(text, /id === 'toggle-group'/, 'it is handled')
  // It flips the same expanded state the group row toggles.
  assert.match(text, /actions\.setSessionGroupExpanded\(key, !open\)/, 'it flips the group expansion')
  // A session outside any group must be told so, not silently ignored.
  assert.match(text, /menu\.toggleGroupNoGroup/, 'an ungrouped session gets an explanation')
})

test('an ungrouped session can be dropped onto a workspace (v0.30.6)', () => {
  const text = read('src/client.js')
  // The row handler used to ignore `session` drags entirely, which is why an
  // ungrouped session could only be reordered inside the ungrouped pool.
  const dragEvents = text.slice(
    text.indexOf('const folderDragEvents = (path) =>'),
    text.indexOf('const commitFolderMoveInto = (targetIdPath) =>'),
  )
  assert.match(dragEvents, /!dragMatches\('session'\)/, 'the row accepts session drags')
  assert.match(dragEvents, /if \(dragMatches\('session'\)\) \{ commitSessionJoinWorkspace\(path\); return \}/,
    'a session drop joins the target')
  // The commit must use the grouping path so auto-titles keep working.
  const join = text.slice(
    text.indexOf('const commitSessionJoinWorkspace = (idPath) => {'),
    text.indexOf('const commitWorkspaceMoveInto = (folderIdPath) => {'),
  )
  assert.match(join, /renameForGrouping\(source\.sessionId, nextTitle\)/, 'it renames through the grouping path')
  assert.match(join, /const groupPath = cutAt === -1 \? text : text\.slice\(cutAt \+ 2\)/, 'it reads the group prefix from the id path')
  assert.match(join, /groupPath === '' \? leaf : groupPath \+ '\/' \+ leaf/, 'workspace-level drop keeps the bare leaf')
})
