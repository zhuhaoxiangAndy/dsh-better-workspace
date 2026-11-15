/**
 * delete-session.mjs — permanent session deletion for dsh-better-workspace.
 *
 * WHY THIS LIVES IN THE HOST HALF
 * DSH exposes no way to delete a session:
 *   - `sessionController` offers list / inspect / create / rename / cancel, and
 *     nothing that removes an archive;
 *   - `sessionPersistence` keeps its removal internals private;
 *   - the jsonl backend's only `unlink` targets lock files.
 * Archiving is not deletion either — it just adds the id to the registry
 * `archivedSessionIds` and never touches the log, which is why an archived
 * session is still perfectly openable.
 *
 * So the bytes can only be removed from a process that can reach the
 * filesystem, i.e. here.
 *
 * SAFETY MODEL
 * The default is to MOVE the archive into `<DSH_HOME>/.del/sessions-deleted-*`,
 * making a wrong click recoverable by dragging the folder back. Unlinking
 * happens only when the caller explicitly passes `keepCopy: false`. This
 * mirrors the project-wide rule that deletion prefers moving aside over `rm`.
 *
 * The session id is validated before any filesystem access, so a crafted id
 * cannot escape the sessions root.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Route prefix the browser half calls. */
export const SESSION_ROUTE = '/api/better-workspace'

/** Current session log filename (dsh 0.2.x). */
export const SESSION_LOG_NAME = 'session.v4.jsonl.zstd'

/**
 * Copy of DSH's encodeSegment(): escape everything outside [A-Za-z0-9._-] as
 * ~XXXX (four upper-case hex digits). `~` itself is escaped too.
 * @param {string} raw
 * @returns {string}
 */
export function encodeSegment(raw) {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/u.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Copy of DSH's projectKey(): `/`, `\` and `:` collapse into ONE `-` run, safe
 * characters survive, everything else becomes `~XXXX`, and the whole thing is
 * wrapped in `--…--` and bounded to 251 characters.
 * @param {string} cwd
 * @returns {string}
 */
export function projectKey(cwd) {
  const text = String(cwd ?? '')
  if (text.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    const ch = String.fromCharCode(code)
    // Separators compared by code point so no backslash literal is needed.
    if (code === 0x2F || code === 0x5C || code === 0x3A) {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/u.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/u, '') || 'root').slice(0, 251)}--`
}

/** A session id must be a plain token: no separators, no traversal, bounded. */
export function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && /^[A-Za-z0-9._~-]{1,200}$/u.test(sessionId)
}

/**
 * Locate one session's archive directory by scanning project folders.
 *
 * Scanning (instead of deriving the path from a cwd) means a session still
 * resolves when its header cwd changed, when it sits under a legacy slug, or
 * when the registry and the disk disagree.
 *
 * @param {string} sessionsRoot
 * @param {string} sessionId
 * @returns {string|null} absolute directory holding the session archive
 */
export function findSessionDir(sessionsRoot, sessionId) {
  const encoded = encodeSegment(sessionId)
  let slugs
  try { slugs = fs.readdirSync(sessionsRoot, { withFileTypes: true }) } catch { return null }
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue
    const dir = path.join(sessionsRoot, slug.name, encoded)
    try {
      if (fs.statSync(dir).isDirectory()) return dir
    } catch { /* not here */ }
  }
  return null
}

/** Recursive byte count, used only for reporting. */
function measureBytes(dir) {
  let total = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { try { total += fs.statSync(p).size } catch { /* vanished */ } }
    }
  }
  try { walk(dir) } catch { /* best effort */ }
  return total
}

/**
 * Move (default) or unlink one session archive directory.
 *
 * @param {string} sessionId
 * @param {{keepCopy?: boolean, dshHome?: string}} [options]
 * @returns {{ok: boolean, movedTo?: string|null, bytes?: number, error?: string}}
 */
export function deleteSessionArchive(sessionId, options = {}) {
  if (!isValidSessionId(sessionId)) return { ok: false, error: 'invalid sessionId' }
  const dshHome = options.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const sessionsRoot = path.join(dshHome, 'sessions')
  const dir = findSessionDir(sessionsRoot, sessionId)
  if (dir === null) return { ok: false, error: 'session archive not found' }

  const bytes = measureBytes(dir)

  if (options.keepCopy === false) {
    fs.rmSync(dir, { recursive: true, force: true })
    return { ok: true, movedTo: null, bytes }
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const park = path.join(dshHome, '.del', 'sessions-deleted-' + stamp)
  fs.mkdirSync(park, { recursive: true })
  const dest = path.join(park, encodeSegment(sessionId))
  fs.renameSync(dir, dest)
  return { ok: true, movedTo: dest, bytes }
}

/**
 * Which session ids actually have an archive file on disk.
 *
 * WHY THE BROWSER CANNOT DO THIS ITSELF
 * `sessionController.list()` serves the PROJECTION CACHE. A session whose log
 * was deleted (or never written) still has a cache entry, so it appears in the
 * list, occupies a sidebar row and opens to an empty transcript — the reported
 * "未分组里有一堆点进去没历史的会话". Only the host can stat the filesystem, so
 * the browser asks here.
 *
 * @param {{dshHome?: string}} [options]
 * @returns {{present: string[], missing: string[]}}
 */
export function auditSessionArchives(options = {}) {
  const dshHome = options.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const sessionsRoot = path.join(dshHome, 'sessions')
  const present = []
  const missing = []
  let slugs = []
  try { slugs = fs.readdirSync(sessionsRoot, { withFileTypes: true }) } catch { return { present, missing } }
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue
    const dir = path.join(sessionsRoot, slug.name)
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const log = path.join(dir, e.name, SESSION_LOG_NAME)
      if (fs.existsSync(log)) present.push(e.name)
      else missing.push(e.name)
    }
  }
  return { present, missing }
}

/**
 * Register the delete route on the host web server.
 *
 * The browser cannot touch the filesystem, so the tree's "delete forever" menu
 * item POSTs here. The route is feature-probed: a host without a web server
 * simply never grows it, and the menu item stays absent.
 *
 * @param {any} ctx cordis context
 * @param {(msg: string) => void} log
 * @returns {boolean} whether the route was registered
 */
export function registerDeleteRoute(ctx, log) {
  /**
   * Locate the web server through every shape a cordis context exposes it in.
   *
   * v0.30.0: the previous version only checked `ctx.get('webServer')` and
   * `ctx.webServer`. Called from inside `ctx.inject(['webServer'], ...)` the
   * service can also arrive as (a) a bare argument, (b) `ctx.webServer` on the
   * injected child context, or (c) a property bag under `ctx.services`. Missing
   * all three meant the route was never registered and BOTH the ghost audit and
   * permanent delete silently did nothing.
   */
  const candidates = []
  try { if (typeof ctx.get === 'function') candidates.push(ctx.get('webServer')) } catch { /* not a service name */ }
  candidates.push(ctx && ctx.webServer)
  candidates.push(ctx && ctx.services && ctx.services.webServer)
  candidates.push(ctx && ctx.inject && ctx.inject.webServer)
  const webServer = candidates.find((c) => c && typeof c.register === 'function')
  if (!webServer) {
    log('[dsh-better-workspace] webServer unavailable (tried get/webServer/services); routes stay disabled')
    return false
  }

  const handler = (req, res) => {
    const send = (code, body) => {
      try {
        res.statusCode = code
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(body))
      } catch { /* client went away */ }
    }
    if (req.method !== 'POST') { send(405, { ok: false, error: 'POST only' }); return }
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try {
        const body = raw ? JSON.parse(raw) : {}
        const result = deleteSessionArchive(String(body.sessionId || ''), { keepCopy: body.keepCopy !== false })
        send(result.ok ? 200 : 400, result)
      } catch (error) {
        send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
    req.on('error', () => send(400, { ok: false, error: 'request error' }))
  }

  const auditHandler = (req, res) => {
    const send = (code, body) => {
      try {
        res.statusCode = code
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(body))
      } catch { /* client went away */ }
    }
    try {
      send(200, auditSessionArchives())
    } catch (error) {
      send(500, { present: [], missing: [], error: error instanceof Error ? error.message : String(error) })
    }
  }

  try {
    const off = webServer.register({ kind: 'exact', path: SESSION_ROUTE + '/delete', handler })
    if (typeof off === 'function' && typeof ctx.effect === 'function') ctx.effect(() => off)
    const off2 = webServer.register({ kind: 'exact', path: SESSION_ROUTE + '/archives', handler: auditHandler })
    if (typeof off2 === 'function' && typeof ctx.effect === 'function') ctx.effect(() => off2)
    log('[dsh-better-workspace] routes registered: ' + SESSION_ROUTE + '/delete, ' + SESSION_ROUTE + '/archives')
    return true
  } catch (error) {
    log('[dsh-better-workspace] route registration failed: ' + (error && error.message))
    return false
  }
}
