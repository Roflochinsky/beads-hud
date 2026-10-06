// Live board mirror. One workspace keeps one in-memory board: a full `bd` scan
// is the baseline, and `bd events tail --follow` applies only the journal on
// top. The journal is opt-in and per clone. When bd is too old, the journal is
// off, or the follower dies, the caller falls back to polling and we try the
// events path again later.
// `bd serve` is intentionally not used: the HTTP API is still a preview and it
// needs its own Dolt server.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const HIDDEN_TYPES = new Set(['gate', 'agent', 'role', 'message'])
const REPLACE_OPS = new Set(['create', 'update', 'close', 'comment'])

// bd list hides the same rows. A mirror that kept them would disagree with a scan.
function isHiddenIssue(issue) {
  if (!issue) return false
  if (issue.ephemeral) return true
  if (issue.is_template) return true
  return HIDDEN_TYPES.has(issue.issue_type)
}

// Absence means "not blocked". Callers compare the flag, so a missing field
// and an explicit false must become the same value.
function normalizeIssue(issue) {
  return { ...issue, is_blocked: issue.is_blocked === true }
}

function depKey(edge) {
  return edge.issue_id + '\0' + edge.depends_on_id + '\0' + edge.type
}

function edgeFrom(rec) {
  const dep = rec && rec.dep
  if (!dep || !rec.issue_id || !dep.target || !dep.kind) return null
  return { issue_id: rec.issue_id, depends_on_id: dep.target, type: dep.kind }
}

// The snapshot is the whole issue after the mutation. Merging would resurrect
// a cleared assignee, label, or any other field the new object simply omits.
function putIssue(state, issue) {
  if (!issue || !issue.id) return
  const next = normalizeIssue(issue)
  if (isHiddenIssue(next)) state.issues.delete(next.id)
  else state.issues.set(next.id, next)
}

// A delete cascades in the journal, but a consumer that missed a dep_remove
// (or a truncated prefix) must still not keep an edge into a gone id.
function removeIssue(state, id) {
  state.issues.delete(id)
  for (const key of [...state.deps.keys()]) {
    const edge = state.deps.get(key)
    if (edge.issue_id === id || edge.depends_on_id === id) state.deps.delete(key)
  }
}

export function emptyState() {
  return { issues: new Map(), deps: new Map() }
}

export function stateFromScan({ open, closed, graph } = {}) {
  const state = emptyState()
  for (const issue of [...(open || []), ...(closed || [])]) {
    if (issue && issue.id) state.issues.set(issue.id, normalizeIssue(issue))
  }
  for (const comp of graph || []) {
    for (const issue of comp.Issues || []) {
      if (issue && issue.id && !state.issues.has(issue.id)) state.issues.set(issue.id, normalizeIssue(issue))
    }
    for (const dep of comp.Dependencies || []) {
      if (!dep || !dep.issue_id || !dep.depends_on_id || !dep.type) continue
      const edge = { issue_id: dep.issue_id, depends_on_id: dep.depends_on_id, type: dep.type }
      state.deps.set(depKey(edge), edge)
    }
  }
  return state
}

// Returns whether the op was understood. Unknown ops are ignored: a future bd
// must not take the mirror down, and the caller still advances its cursor.
export function applyEvent(state, rec) {
  if (!rec || typeof rec.op !== 'string') return false
  if (REPLACE_OPS.has(rec.op)) {
    putIssue(state, rec.issue)
    return true
  }
  if (rec.op === 'delete') {
    const id = rec.issue_id || rec.issue?.id
    if (id) removeIssue(state, id)
    return true
  }
  if (rec.op === 'dep_add' || rec.op === 'dep_remove') {
    putIssue(state, rec.issue)
    const edge = edgeFrom(rec)
    if (edge) {
      const key = depKey(edge)
      // dep_add is an upsert: bd emits it again when the same edge is re-added.
      if (rec.op === 'dep_add') state.deps.set(key, edge)
      else state.deps.delete(key)
    }
    return true
  }
  return false
}

const VERIFY = /verif|верифик|провер|acceptance|qa\b/i

function kindOf(issue) {
  if (issue.issue_type === 'epic') return 'epic'
  if (issue.issue_type === 'bug') return 'bug'
  if (issue.issue_type === 'feature') return 'feature'
  if (VERIFY.test(issue.title || '')) return 'verify'
  return 'task'
}

// Same derivation the polling board used: parent / blockedBy / blocks come
// only from parent-child and blocks edges, and a closed blocker does not keep
// the blocked card in the blocked column.
export function deriveBoard(state) {
  const parent = new Map()
  const blockedBy = new Map()
  const blocks = new Map()
  for (const dep of state.deps.values()) {
    if (dep.type === 'parent-child') {
      parent.set(dep.issue_id, dep.depends_on_id)
    } else if (dep.type === 'blocks') {
      if (!blockedBy.has(dep.issue_id)) blockedBy.set(dep.issue_id, [])
      blockedBy.get(dep.issue_id).push(dep.depends_on_id)
      if (!blocks.has(dep.depends_on_id)) blocks.set(dep.depends_on_id, [])
      blocks.get(dep.depends_on_id).push(dep.issue_id)
    }
  }

  const issues = state.issues
  const done = (id) => issues.get(id)?.status === 'closed'
  for (const issue of issues.values()) {
    issue.parent = parent.get(issue.id) || null
    issue.blockedBy = (blockedBy.get(issue.id) || []).filter((id) => !done(id))
    issue.blocks = (blocks.get(issue.id) || []).filter((id) => !done(id))
    issue.kind = kindOf(issue)
    issue.column =
      issue.status === 'closed' ? 'closed'
      : issue.status === 'in_progress' ? 'doing'
      : issue.blockedBy.length ? 'blocked'
      : 'todo'
  }

  const all = [...issues.values()]
  const byPriority = (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
  const childrenOf = (id) => all.filter((issue) => issue.parent === id)

  const groups = all
    .filter((issue) => issue.issue_type === 'epic' || childrenOf(issue.id).length)
    .sort(byPriority)
    .map((issue) => {
      const kids = childrenOf(issue.id)
      return { ...issue, childCount: kids.length, doneCount: kids.filter((kid) => kid.status === 'closed').length }
    })

  const grouped = new Set(groups.map((group) => group.id))
  const loose = all.filter((issue) => !grouped.has(issue.id) && !issue.parent).sort(byPriority)

  return { issues: all, groups, loose }
}

export function parseVersion(versionString) {
  if (typeof versionString !== 'string') return null
  const match = versionString.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function supportsEvents(versionString) {
  const version = parseVersion(versionString)
  if (!version) return false
  if (version[0] !== 1) return version[0] > 1
  if (version[1] !== 3) return version[1] > 3
  return version[2] >= 0
}

function envJournal() {
  const value = (process.env.BD_EVENTS_JOURNAL || '').trim().toLowerCase()
  return value === '1' || value === 'true'
}

function journalDisabledNote(text) {
  return typeof text === 'string' && text.toLowerCase().includes('events journal is disabled')
}

// Truncation is a pretty-printed object on stdout (and, mid-follow, one JSON
// line). A brace inside a string must not end the object early.
function extractJsonObject(text) {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function truncationInfo(stdout, stderr) {
  for (const text of [stdout || '', stderr || '']) {
    if (!text.includes('events_journal_truncated')) continue
    const obj = extractJsonObject(text)
    if (obj && obj.code === 'events_journal_truncated') return obj
  }
  return null
}

function eventLines(stdout) {
  const out = []
  for (const raw of String(stdout || '').split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (!line) continue
    try {
      const rec = JSON.parse(line)
      if (rec && typeof rec === 'object') out.push(rec)
    } catch {
      // A broken line is not a record. Pretty-printed truncation is detected
      // before we get here.
    }
  }
  return out
}

function toText(chunk) {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8')
}

function defaultTimer(fn, ms) {
  const timer = setTimeout(fn, ms)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}

export function eventsCheckpointPath(cacheDir, workspace) {
  return join(cacheDir, 'events-' + Buffer.from(workspace).toString('base64url') + '.json')
}

// metadata.json is stable per clone (project id, database). last-touched is
// not: it changes on every command and would throw the cursor away.
export async function cloneIdentity(workspace) {
  try {
    const raw = await readFile(join(workspace, '.beads', 'metadata.json'))
    return createHash('sha256').update(raw).digest('hex')
  } catch {
    return ''
  }
}

export class Follower {
  constructor(opts) {
    this.workspace = opts.workspace
    this.exec = opts.exec
    this.spawn = opts.spawn
    this.scan = opts.scan
    this.now = opts.now || (() => Date.now())
    this.setTimer = opts.setTimer || defaultTimer
    this.clearTimer = opts.clearTimer || ((timer) => clearTimeout(timer))
    this.loadCheckpoint = opts.loadCheckpoint
    this.saveCheckpoint = opts.saveCheckpoint
    this.readIdentity = opts.readIdentity
    this.log = opts.log || (() => {})
    this.configRecheckMs = opts.configRecheckMs ?? 45_000
    this.reconcileMs = opts.reconcileMs ?? 10 * 60 * 1000
    this.backoffStart = opts.backoffStart ?? 30_000
    this.backoffMax = opts.backoffMax ?? 10 * 60 * 1000
    this.healthyMs = opts.healthyMs ?? 60_000
    this.checkpointDebounceMs = opts.checkpointDebounceMs ?? 1000

    this.mode = 'starting'
    this.reason = null
    this.version = 0
    this.seq = 0
    this.state = null
    this.scanMs = 0
    this.scannedAt = 0
    this.child = null
    this.stopped = false
    this.backoff = this.backoffStart
    this.timers = new Set()
    this._generation = 0
    this._identity = ''
    this._checkpointDirty = false
    this._checkpointTimer = null
    this._saveChain = Promise.resolve()
    this._ignoreExit = null
    this._truncating = false
    this._memo = null
    this._memoVersion = -1
    this._buf = ''
  }

  board() {
    if (!this.state) return null
    if (this._memo && this._memoVersion === this.version) return this._memo
    this._memo = deriveBoard(this.state)
    this._memoVersion = this.version
    return this._memo
  }

  async start() {
    if (this.stopped) return
    const gen = ++this._generation
    this._killChild()
    this._clearTimers()
    this.mode = 'starting'
    this.reason = null
    try {
      const version = await this._version()
      if (!this._alive(gen)) return
      if (!supportsEvents(version)) {
        this._enterPoll('bd-too-old', gen)
        return
      }

      const enabled = await this._journalOn()
      if (!this._alive(gen)) return
      if (!enabled) {
        this._enterPoll('journal-disabled', gen)
        return
      }

      await this._adoptCheckpoint()
      if (!this._alive(gen)) return

      await this._baseline(gen)
      if (!this._alive(gen) || this.mode === 'poll') return

      this._setMode('events', null)
      this._armConfigRecheck(gen)
      this._armReconcile(gen)
      this._armHealthy(gen)
      this._spawnFollow(gen)
    } catch {
      if (this._alive(gen)) this._enterPoll('events-error', gen)
    }
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    this._generation++
    this._killChild()
    this._clearTimers()
    await this._flushCheckpoint()
  }

  _alive(gen) {
    return !this.stopped && this._generation === gen
  }

  _setMode(mode, reason) {
    if (this.mode === mode && this.reason === reason) return
    this.mode = mode
    this.reason = reason
    if (mode === 'events') this.log(`beads-hud · events · ${this.workspace} · seq ${this.seq}`)
    else if (mode === 'poll') this.log(`beads-hud · poll · ${this.workspace} · ${reason}`)
  }

  _enterPoll(reason, gen) {
    if (this.stopped || !this._alive(gen)) return
    if (this.mode === 'poll') return
    this._killChild()
    this._clearTimers()
    void this._flushCheckpoint()
    this._setMode('poll', reason)
    this._armRetry(gen)
  }

  _armRetry(gen) {
    const wait = this.backoff
    this.backoff = Math.min(this.backoff * 2, this.backoffMax)
    this._later(gen, wait, () => this.start())
  }

  _later(gen, ms, fn) {
    const timer = this.setTimer(() => {
      this.timers.delete(timer)
      if (!this._alive(gen)) return
      return Promise.resolve()
        .then(fn)
        .catch(() => {
          if (this._alive(gen) && this.mode !== 'poll') this._enterPoll('events-error', gen)
        })
    }, ms)
    this.timers.add(timer)
    return timer
  }

  _clearTimers() {
    for (const timer of this.timers) this.clearTimer(timer)
    this.timers.clear()
    if (this._checkpointTimer) {
      this.clearTimer(this._checkpointTimer)
      this._checkpointTimer = null
    }
    if (this._checkpointDirty) void this._flushCheckpoint()
  }

  _killChild() {
    const child = this.child
    if (!child) return
    this._ignoreExit = child
    this.child = null
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }

  async _version() {
    const res = await this.exec(['version', '--json'])
    try {
      return JSON.parse(res.stdout).version || ''
    } catch {
      return ''
    }
  }

  async _journalOn() {
    // Config can flip while we are following. The env var forces the journal
    // on for this process even when the stored value is still false.
    const res = await this.exec(['config', 'get', 'events-journal', '--json'])
    let configOn = false
    try {
      const value = JSON.parse(res.stdout).value
      configOn = value === true || String(value).toLowerCase() === 'true'
    } catch {
      configOn = false
    }
    return configOn || envJournal()
  }

  async _adoptCheckpoint() {
    try {
      this._identity = this.readIdentity ? await this.readIdentity() : ''
    } catch {
      this._identity = ''
    }
    if (this._identity == null) this._identity = ''
    let saved = null
    if (this.loadCheckpoint) {
      try {
        saved = await this.loadCheckpoint()
      } catch {
        saved = null
      }
    }
    // A cursor from another clone is a different seq space: using it would
    // skip this clone's real history or stall forever above its head.
    if (!saved || saved.identity !== this._identity) {
      this.seq = 0
      return
    }
    const seq = Number(saved.seq)
    if (!Number.isFinite(seq) || seq < 0) {
      this.seq = 0
      return
    }
    // Keep the higher of disk and memory. A debounced save can lag, and
    // rewinding would replay stale snapshots over a fresh scan.
    if (seq > this.seq) this.seq = seq
  }

  async _baseline(gen) {
    await this._rescan(gen)
    if (!this._alive(gen)) return
    await this._drain(gen)
  }

  async _rescan(gen) {
    const t0 = this.now()
    const state = await this.scan()
    if (!this._alive(gen)) return
    if (!state || !(state.issues instanceof Map) || !(state.deps instanceof Map)) throw new Error('scan returned no state')
    this.state = state
    this.scanMs = Math.max(0, this.now() - t0)
    this.scannedAt = this.now()
    this.version++
    this._memo = null
  }

  async _drain(gen) {
    const res = await this.exec(['events', 'tail', '--since', String(this.seq || 0), '--json'])
    if (!this._alive(gen)) return
    const info = truncationInfo(res.stdout, res.stderr)
    if (info) return this._recoverTruncation(info, gen)
    // With --follow this note is followed by a process that prints nothing
    // forever. Bail out before spawning that.
    if (journalDisabledNote(res.stderr) || journalDisabledNote(res.stdout)) {
      this._enterPoll('journal-disabled', gen)
      return
    }
    if (res.code) throw new Error((res.stderr || '').trim() || 'events tail failed')
    for (const rec of eventLines(res.stdout)) this._applyRecord(rec)
  }

  async _recoverTruncation(info, gen, depth = 0) {
    // The prefix we asked for is gone. The scan is the baseline; the cursor
    // jumps to head so we do not replay the surviving suffix over it.
    this._killChild()
    await this._rescan(gen)
    if (!this._alive(gen)) return
    const head = Number(info && info.head)
    if (Number.isFinite(head)) this.seq = head
    this._scheduleCheckpoint()
    if (depth >= 2) return
    const res = await this.exec(['events', 'tail', '--since', String(this.seq || 0), '--json'])
    if (!this._alive(gen)) return
    const again = truncationInfo(res.stdout, res.stderr)
    if (again) return this._recoverTruncation(again, gen, depth + 1)
    if (journalDisabledNote(res.stderr) || journalDisabledNote(res.stdout)) {
      this._enterPoll('journal-disabled', gen)
      return
    }
    if (res.code) throw new Error((res.stderr || '').trim() || 'events tail failed')
    for (const rec of eventLines(res.stdout)) this._applyRecord(rec)
  }

  _applyRecord(rec) {
    if (!rec || !this.state) return
    const seq = Number(rec.seq)
    if (!Number.isFinite(seq)) return
    // Replays and a follow that overlaps the drain must not move state backward.
    if (seq <= this.seq) return
    const applied = applyEvent(this.state, rec)
    this.seq = seq
    if (applied) {
      this.version++
      this._memo = null
      this.scannedAt = this.now()
    }
    this._scheduleCheckpoint()
  }

  _scheduleCheckpoint() {
    this._checkpointDirty = true
    if (this._checkpointTimer) return
    this._checkpointTimer = this.setTimer(() => {
      this._checkpointTimer = null
      return this._flushCheckpoint()
    }, this.checkpointDebounceMs)
  }

  _flushCheckpoint() {
    const run = () => this._writeCheckpoint()
    // stop() and the debounce can overlap. An older snapshot must not land last.
    const next = this._saveChain.then(run, run)
    this._saveChain = next
    // Once this write is the tail and has settled, drop it. A follower that
    // checkpoints every second would otherwise retain the whole chain.
    const settle = () => {
      if (this._saveChain === next) this._saveChain = Promise.resolve()
    }
    next.then(settle, settle)
    return next
  }

  async _writeCheckpoint() {
    if (!this.saveCheckpoint) {
      this._checkpointDirty = false
      return
    }
    while (this._checkpointDirty) {
      this._checkpointDirty = false
      const payload = {
        seq: this.seq,
        workspace: this.workspace,
        at: this.now(),
        identity: this._identity,
      }
      try {
        await this.saveCheckpoint(payload)
      } catch {
        this._checkpointDirty = true
        return
      }
    }
  }

  _spawnFollow(gen) {
    const child = this.spawn(['events', 'tail', '--since', String(this.seq || 0), '--follow', '--json'])
    if (!child || !child.stdout || !child.stderr) throw new Error('spawn returned no pipes')
    this.child = child
    this._buf = ''
    let errBuf = ''
    child.stdout.on('data', (chunk) => {
      if (this.child !== child || !this._alive(gen)) return
      this._onStdout(toText(chunk), child, gen)
    })
    child.stderr.on('data', (chunk) => {
      if (this._ignoreExit === child || !this._alive(gen)) return
      errBuf = (errBuf + toText(chunk)).slice(-4000)
      if (journalDisabledNote(errBuf)) this._enterPoll('journal-disabled', gen)
    })
    child.on('error', () => {
      if (this._ignoreExit === child || !this._alive(gen)) return
      this._enterPoll('events-error', gen)
    })
    child.on('exit', (code) => {
      if (this._ignoreExit === child) {
        if (this.child === child) this.child = null
        return
      }
      if (this.child === child) this.child = null
      if (!this._alive(gen)) return
      this._enterPoll(code ? 'events-error' : 'events-exited', gen)
    })
  }

  _onStdout(text, child, gen) {
    this._buf += text
    // One issue snapshot is a single line. Past this it is not a record we can apply.
    if (this._buf.length > 8 * 1024 * 1024) {
      this._buf = ''
      this._enterPoll('events-error', gen)
      return
    }
    let nl
    while ((nl = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, nl).replace(/\r$/, '').trim()
      this._buf = this._buf.slice(nl + 1)
      if (!line) continue
      let rec
      try {
        rec = JSON.parse(line)
      } catch {
        continue
      }
      if (rec && rec.code === 'events_journal_truncated') {
        this._followTruncation(rec, gen)
        return
      }
      this._applyRecord(rec)
    }
  }

  _followTruncation(info, gen) {
    if (this._truncating) return
    this._truncating = true
    this._ignoreExit = this.child
    void (async () => {
      try {
        await this._recoverTruncation(info, gen)
        if (!this._alive(gen) || this.mode !== 'events') return
        this._spawnFollow(gen)
      } catch {
        if (this._alive(gen) && this.mode !== 'poll') this._enterPoll('events-error', gen)
      } finally {
        this._truncating = false
      }
    })()
  }

  // Turning the journal off at runtime does not kill --follow: it prints a
  // note and then stays silent. Rechecking is the only way to notice.
  _armConfigRecheck(gen) {
    this._later(gen, this.configRecheckMs, async () => {
      if (this.mode !== 'events') return
      let on = true
      try {
        on = await this._journalOn()
      } catch {
        on = true
      }
      if (!this._alive(gen) || this.mode !== 'events') return
      if (!on) {
        this._enterPoll('journal-disabled', gen)
        return
      }
      this._armConfigRecheck(gen)
    })
  }

  // dolt pull and `bd sql` never hit the journal, so a long-lived mirror
  // drifts until something reads the database again.
  _armReconcile(gen) {
    this._later(gen, this.reconcileMs, () => this._reconcile(gen))
  }

  async _reconcile(gen) {
    if (!this._alive(gen) || this.mode !== 'events') return
    this._killChild()
    try {
      await this._rescan(gen)
      if (!this._alive(gen) || this.mode !== 'events') return
      await this._drain(gen)
      if (!this._alive(gen) || this.mode !== 'events') return
      this._spawnFollow(gen)
    } catch {
      if (this._alive(gen) && this.mode !== 'poll') this._enterPoll('events-error', gen)
    } finally {
      if (this._alive(gen) && this.mode === 'events') this._armReconcile(gen)
    }
  }

  _armHealthy(gen) {
    this._later(gen, this.healthyMs, () => {
      if (this.mode === 'events') this.backoff = this.backoffStart
    })
  }
}
