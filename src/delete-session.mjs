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
  const webServer = (() => {
    try {
      if (typeof ctx.get === 'function') {
        const svc = ctx.get('webServer')
        if (svc) return svc
      }
      return ctx.webServer
    } catch { return undefined }
  })()
  if (!webServer || typeof webServer.register !== 'function') {
    log('[dsh-better-workspace] webServer unavailable; permanent delete stays disabled')
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

  try {
    const off = webServer.register({ kind: 'exact', path: SESSION_ROUTE + '/delete', handler })
    if (typeof off === 'function' && typeof ctx.effect === 'function') ctx.effect(() => off)
    log('[dsh-better-workspace] permanent-delete route registered at ' + SESSION_ROUTE + '/delete')
    return true
  } catch (error) {
    log('[dsh-better-workspace] permanent-delete route registration failed: ' + (error && error.message))
    return false
  }
}
