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
// One issue snapshot is one line. A longer line is not a record we can apply;
// dropping it keeps a single fat line from wedging the mirror in poll forever.
const LINE_CAP = 8 * 1024 * 1024
// Truncation is a small pretty-printed object. The journal itself must not
// accumulate here — that is the buffer the streaming drain exists to avoid.
const LOOSE_CAP = 64 * 1024
// A dead cache dir must not reschedule a checkpoint write on every tick.
const CHECKPOINT_RETRIES = 5

// bd list hides the same rows. They stay in the mirror: graph --all still emits
// edges at them, and a dropped closed gate looks like an open blocker.
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
// Hidden rows are kept (normalized) so a blocks/parent edge can read their
// status. deriveBoard is what leaves them off the projected board.
function putIssue(state, issue) {
  if (!issue || !issue.id) return
  state.issues.set(issue.id, normalizeIssue(issue))
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
  // List rows win over the graph: graph Issues is a subset and can be staler.
  // Hidden rows from either source stay, same as the event path.
  for (const issue of [...(open || []), ...(closed || [])]) putIssue(state, issue)
  for (const comp of graph || []) {
    for (const issue of comp.Issues || []) {
      if (!issue || !issue.id || state.issues.has(issue.id)) continue
      putIssue(state, issue)
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
  // A future op we do not recognise may still carry the issue after the
  // mutation. Keep that picture, but report the op as unhandled.
  if (rec.issue && typeof rec.issue === 'object') putIssue(state, rec.issue)
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
  const stored = state.issues
  const present = (id) => stored.has(id)
  const visible = (id) => {
    const issue = stored.get(id)
    return !!issue && !isHiddenIssue(issue)
  }
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

  const done = (id) => stored.get(id)?.status === 'closed'
  // An id the scan never saw must not count as an open blocker. A hidden row
  // is present, so a closed gate still counts as closed.
  const openIds = (ids) => (ids || []).filter((id) => present(id) && !done(id))
  // Fresh objects: the memoized board and the raw mirror must not share
  // records, or a derived field would stick to the stored issue.
  // Hidden rows stay in the mirror and leave only here, including child counts.
  const all = []
  for (const issue of stored.values()) {
    if (isHiddenIssue(issue)) continue
    const openBlockedBy = openIds(blockedBy.get(issue.id))
    const openBlocks = openIds(blocks.get(issue.id))
    const rawParent = parent.get(issue.id) || null
    all.push({
      ...issue,
      // A parent the board cannot show (hidden, or gone) is no parent. The
      // child would otherwise sit in neither a group nor loose.
      parent: rawParent && visible(rawParent) ? rawParent : null,
      blockedBy: openBlockedBy,
      blocks: openBlocks,
      kind: kindOf(issue),
      column:
        issue.status === 'closed' ? 'closed'
        : issue.status === 'in_progress' ? 'doing'
        : openBlockedBy.length ? 'blocked'
        : 'todo',
    })
  }

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

function mentionsJournalDisabled(text) {
  return typeof text === 'string' && text.toLowerCase().includes('events journal is disabled')
}

// Real bd prints the note on stderr. A JSON record may quote the same words
// in a title; only a non-JSON stdout line counts as the diagnostic.
function journalDisabled(stderr, stdout) {
  if (mentionsJournalDisabled(stderr)) return true
  if (!mentionsJournalDisabled(stdout)) return false
  for (const raw of String(stdout).split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (!line || line.startsWith('{') || line.startsWith('[')) continue
    if (line.toLowerCase().includes('events journal is disabled')) return true
  }
  return false
}

// Brace-match one object. A `{` inside a string must not end it early, and a
// failed parse must not swallow the rest of the buffer.
function parseObjectAt(text, start) {
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
          return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

// The first `{...}` in the text may be an ordinary record. The truncation
// marker is what we came for; a warning or a snapshot in front of it must not hide it.
function extractJsonObject(text) {
  if (typeof text !== 'string') return null
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('{', i)
    if (start < 0) return null
    const parsed = parseObjectAt(text, start)
    if (!parsed) {
      i = start + 1
      continue
    }
    if (parsed.value && parsed.value.code === 'events_journal_truncated') return parsed.value
    i = parsed.end
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

// Number(null) is 0, which would look like a real head and respawn forever.
function finiteHead(info) {
  const head = info && info.head
  return Number.isFinite(head) ? head : null
}

// A poll answer must not carry the events cursor. The disk cache stores the
// events board verbatim, and a later poll would otherwise look live.
export function asPollBoard(data, liveReason) {
  const src = data && typeof data === 'object' ? data : {}
  const { seq, rev, ...rest } = src
  return { ...rest, live: 'poll', liveReason }
}

// Leading write, and one deferred write for whatever was skipped inside the
// window. Dropping that last board is how a restart missed a delete.
export function makeDiskThrottle({ now, setTimer, clearTimer, write, waitMs }) {
  const slots = new Map()
  const slot = (key) => {
    let cur = slots.get(key)
    if (!cur) {
      cur = { wroteAt: null, pending: null, timer: null }
      slots.set(key, cur)
    }
    return cur
  }
  const send = (key, cur, board) => {
    cur.pending = null
    cur.wroteAt = now()
    return write(key, board)
  }
  return {
    put(key, board) {
      const cur = slot(key)
      const t = now()
      if (cur.wroteAt != null && t - cur.wroteAt < waitMs) {
        cur.pending = board
        if (cur.timer) return
        const timer = setTimer(() => {
          cur.timer = null
          if (cur.pending != null) send(key, cur, cur.pending)
        }, waitMs - (t - cur.wroteAt))
        if (timer && typeof timer.unref === 'function') timer.unref()
        cur.timer = timer
        return
      }
      if (cur.timer) {
        clearTimer(cur.timer)
        cur.timer = null
      }
      send(key, cur, board)
    },
    flush() {
      const jobs = []
      for (const [key, cur] of slots) {
        if (cur.timer) {
          clearTimer(cur.timer)
          cur.timer = null
        }
        if (cur.pending == null) continue
        const board = cur.pending
        cur.pending = null
        cur.wroteAt = now()
        jobs.push(Promise.resolve().then(() => write(key, board)))
      }
      return Promise.all(jobs)
    },
    pending() {
      const out = []
      for (const [key, cur] of slots) if (cur.pending != null) out.push([key, cur.pending])
      return out
    },
  }
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

function blankOut() {
  return { buf: '', skipping: false, loose: '' }
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
    this.opTimeoutMs = opts.opTimeoutMs ?? 120_000
    this.lineCap = opts.lineCap || LINE_CAP
    // 'exit' can beat the last stdout chunk. 'close' is the real end of the
    // pipes; this only fires when 'close' never comes.
    this.closeFallbackMs = opts.closeFallbackMs ?? 50

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
    this._checkpointRetries = 0
    this._saveChain = Promise.resolve()
    this._killed = new WeakSet()
    this._opTimers = new Set()
    this._busy = false
    this._drainChild = null
    this._out = blankOut()
    this._memo = null
    this._memoVersion = -1
    this._closeTimers = new Map()
  }

  board() {
    if (!this.state) return null
    if (this._memo && this._memoVersion === this.version) return this._memo
    this._memo = deriveBoard(this.state)
    this._memoVersion = this.version
    return this._memo
  }

  // Synchronous on purpose: process 'exit' cannot wait, and a crashed server
  // must not leave `bd events tail --follow` behind.
  killChild() {
    this._retire(this.child)
    this._retire(this._drainChild)
  }

  async start() {
    if (this.stopped) return
    const gen = ++this._generation
    this.killChild()
    this._clearTimers()
    this.mode = 'starting'
    this.reason = null
    try {
      let version
      try {
        version = await this._version()
      } catch {
        // The binary did not answer. That is not the same as "answered, and
        // the version is older than the journal".
        if (this._alive(gen)) this._enterPoll('bd-unavailable', gen)
        return
      }
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
    this.killChild()
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
    this.killChild()
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
    for (const timer of this._opTimers) clearTimeout(timer)
    this._opTimers.clear()
    for (const child of [...this._closeTimers.keys()]) this._cancelCloseFallback(child)
    if (this._checkpointDirty) void this._flushCheckpoint()
  }

  // A late exit from a child we already replaced must not look like the live
  // follower dying. One slot cannot tell those children apart.
  _retire(child) {
    if (!child || typeof child !== 'object') return
    this._cancelCloseFallback(child)
    this._killed.add(child)
    if (this.child === child) this.child = null
    if (this._drainChild === child) this._drainChild = null
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }

  // A child with no pipes cannot be read, and leaving it running leaks a bd.
  _checkPipes(child) {
    if (child && child.stdout && child.stderr) return
    if (child && typeof child === 'object') this._retire(child)
    throw new Error('spawn returned no pipes')
  }

  _armCloseFallback(child, fn) {
    this._cancelCloseFallback(child)
    const timer = this.setTimer(() => {
      this._closeTimers.delete(child)
      fn()
    }, this.closeFallbackMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
    this._closeTimers.set(child, timer)
  }

  _cancelCloseFallback(child) {
    const timer = this._closeTimers.get(child)
    if (!timer) return
    this.clearTimer(timer)
    this._closeTimers.delete(child)
  }

  // Wall-clock, not the injected test clock: a hung bd has to lose even when
  // the caller never advances time. The server's exec timeout is the other half.
  _withTimeout(promise) {
    const ms = this.opTimeoutMs
    if (!ms) return Promise.resolve(promise)
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        this._opTimers.delete(timer)
        if (settled) return
        settled = true
        const err = new Error('bd timed out')
        err.reason = 'events-error'
        reject(err)
      }, ms)
      // Ref'd on purpose: an unref'd timer never fires when it is the only
      // thing left on the loop, which is exactly a hung `bd` during startup.
      this._opTimers.add(timer)
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this._opTimers.delete(timer)
        fn(value)
      }
      Promise.resolve(promise).then(
        (value) => finish(resolve, value),
        (err) => finish(reject, err),
      )
    })
  }

  _exec(args) {
    return this._withTimeout(Promise.resolve().then(() => this.exec(args)))
  }

  async _version() {
    const res = await this._exec(['version', '--json'])
    if (!res || res.code) {
      const err = new Error('bd version failed')
      err.reason = 'bd-unavailable'
      throw err
    }
    let parsed
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      const err = new Error('bd version unparsable')
      err.reason = 'bd-unavailable'
      throw err
    }
    const version = parsed && typeof parsed.version === 'string' ? parsed.version : ''
    if (!parseVersion(version)) {
      const err = new Error('bd version unparsable')
      err.reason = 'bd-unavailable'
      throw err
    }
    return version
  }

  async _journalOn() {
    // Config can flip while we are following. The env var forces the journal
    // on for this process even when the stored value is still false.
    const res = await this._exec(['config', 'get', 'events-journal', '--json'])
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

  // Head first, then the scan, then follow from that head. Replaying the
  // drain over the scan resurrects rows whose later edits were never journaled.
  async _baseline(gen) {
    const head = await this._discoverHead(gen)
    if (!this._alive(gen) || this.mode === 'poll' || head == null) return
    await this._rescan(gen)
    if (!this._alive(gen) || this.mode === 'poll') return
    this.seq = head
    if (this.seq > 0) this._scheduleCheckpoint()
  }

  async _rescan(gen) {
    const t0 = this.now()
    const state = await this._withTimeout(Promise.resolve().then(() => this.scan()))
    if (!this._alive(gen)) return
    if (!state || !(state.issues instanceof Map) || !(state.deps instanceof Map)) throw new Error('scan returned no state')
    this.state = state
    this.scanMs = Math.max(0, this.now() - t0)
    this.scannedAt = this.now()
    this.version++
    this._memo = null
  }

  // Stream the tail. The checkpoint is the lower bound, so a cold journal of
  // 100k records does not have to fit in one execFile buffer. Records are not
  // applied: the scan that follows is newer than every one of them.
  // allowProbe is false on the redo after a cursor past the head, so a second
  // empty drain cannot recurse.
  async _discoverHead(gen, allowProbe = true) {
    const since = this.seq || 0
    const result = await this._drain(gen, ['events', 'tail', '--since', String(since), '--json'])
    if (!this._alive(gen) || !result) return null
    const truncated = this._takeTruncation(result, gen)
    if (truncated !== undefined) return truncated
    if (journalDisabled(result.stderr, result.loose)) {
      this._enterPoll('journal-disabled', gen)
      return null
    }
    if (result.code) throw new Error((result.stderr || '').trim() || 'events tail failed')
    // Caught up and ahead-of-head look the same: --since <checkpoint> is empty.
    // A probe one seq back tells them apart. Otherwise a rebuilt .beads with
    // the same metadata.json drops every record until the journal passes it.
    if (result.maxSeq == null && allowProbe && since > 0) {
      const verdict = await this._probeCursor(gen, since)
      if (!this._alive(gen) || this.mode === 'poll') return null
      if (verdict === 'ahead') {
        this.log(`beads-hud · checkpoint ahead of head · ${this.workspace} · seq ${since}`)
        this.seq = 0
        // Persist the discard. An empty journal would otherwise reload the
        // same cursor and probe it again on every start.
        this._scheduleCheckpoint()
        return this._discoverHead(gen, false)
      }
      if (typeof verdict === 'number') return verdict
      if (verdict === 'valid') return since
      return null
    }
    if (result.maxSeq == null) return this.seq
    return Math.max(this.seq, result.maxSeq)
  }

  async _probeCursor(gen, since) {
    const result = await this._drain(gen, [
      'events',
      'tail',
      '--since',
      String(since - 1),
      '--limit',
      '1',
      '--json',
    ])
    if (!this._alive(gen) || !result) return null
    const truncated = this._takeTruncation(result, gen)
    if (truncated !== undefined) return truncated
    if (journalDisabled(result.stderr, result.loose)) {
      this._enterPoll('journal-disabled', gen)
      return null
    }
    if (result.code) throw new Error((result.stderr || '').trim() || 'events tail failed')
    // No record at or after the checkpoint: the cursor is past this journal.
    if (result.maxSeq == null || result.maxSeq < since) return 'ahead'
    // seq == checkpoint confirms the cursor. A higher seq means the drain
    // raced a new record; the checkpoint is still not past the head.
    return 'valid'
  }

  // undefined: not a truncation. null: entered poll (no numeric head).
  // A number, including 0, is the head to follow from.
  _takeTruncation(result, gen) {
    if (!result || !result.truncation) return undefined
    const head = finiteHead(result.truncation)
    if (head == null) {
      this._enterPoll('events-error', gen)
      return null
    }
    return head
  }

  async _drain(gen, args) {
    if (!this._alive(gen)) return null
    const child = this.spawn(args)
    this._checkPipes(child)
    this._drainChild = child
    const reading = this._readChild(child)
    let result
    try {
      result = await this._withTimeout(reading)
    } finally {
      if (this._drainChild === child) this._drainChild = null
      this._retire(child)
    }
    if (!this._alive(gen)) return null
    return result
  }

  _readChild(child) {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (err, value) => {
        if (settled) return
        settled = true
        this._cancelCloseFallback(child)
        if (err) reject(err)
        else resolve(value)
      }
      const session = { buf: '', skipping: false, loose: '', maxSeq: null, truncation: null }
      let stderr = ''
      let exitCode = null
      const deliver = () => {
        if (settled) return
        if (!session.skipping && session.buf.length) {
          if (session.buf.length > this.lineCap) this._noteOverlong()
          else this._onDrainLine(session, session.buf.replace(/\r$/, '').trim())
          session.buf = ''
        }
        const truncation = session.truncation || truncationInfo(session.loose, stderr)
        finish(null, {
          code: typeof exitCode === 'number' ? exitCode : 0,
          stderr,
          loose: session.loose,
          maxSeq: session.maxSeq,
          truncation,
        })
      }
      child.stdout.on('data', (chunk) => {
        this._feed(session, toText(chunk), (line) => this._onDrainLine(session, line))
      })
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + toText(chunk)).slice(-4000)
      })
      child.on('error', (err) => finish(err || new Error('events tail failed')))
      // 'exit' can precede the last stdout chunk. Wait for 'close' (stdio
      // flushed). The timer covers a child that exits and never closes.
      child.on('exit', (code) => {
        if (settled) return
        if (exitCode == null) exitCode = typeof code === 'number' ? code : 0
        if (this._killed.has(child)) return
        this._armCloseFallback(child, deliver)
      })
      child.on('close', (code) => {
        if (exitCode == null) exitCode = typeof code === 'number' ? code : 0
        deliver()
      })
    })
  }

  _onDrainLine(session, line) {
    if (!line) return
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      this._rememberLoose(session, line)
      return
    }
    if (rec && rec.code === 'events_journal_truncated') {
      session.truncation = rec
      return
    }
    const seq = Number(rec && rec.seq)
    if (Number.isFinite(seq) && (session.maxSeq == null || seq > session.maxSeq)) session.maxSeq = seq
  }

  async _recoverTruncation(info, gen) {
    // The prefix we asked for is gone. Scan, then follow from the error's
    // head — replaying the surviving suffix over the scan would be stale.
    // No numeric head means we cannot follow without looping rescan↔respawn.
    const head = finiteHead(info)
    if (head == null) {
      this._enterPoll('events-error', gen)
      return
    }
    await this._rescan(gen)
    if (!this._alive(gen)) return
    this.seq = head
    this._scheduleCheckpoint()
  }

  _applyRecord(rec) {
    if (!rec || !this.state) return
    const seq = Number(rec.seq)
    if (!Number.isFinite(seq)) return
    // Replays and a follow that overlaps the previous cursor must not move state backward.
    if (seq <= this.seq) return
    const applied = applyEvent(this.state, rec)
    this.seq = seq
    // applyEvent returns false for an unknown op even when it kept the snapshot.
    const changed = applied || !!(rec.issue && typeof rec.issue === 'object' && rec.issue.id)
    if (changed) {
      this.version++
      this._memo = null
      this.scannedAt = this.now()
    }
    this._scheduleCheckpoint()
  }

  _scheduleCheckpoint() {
    // A fresh record gets a new budget. The failure path arms the timer
    // without resetting, so a dead directory cannot spin.
    this._checkpointRetries = 0
    this._armCheckpoint()
  }

  _armCheckpoint() {
    this._checkpointDirty = true
    if (this._checkpointTimer || this.stopped) return
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
        this._checkpointRetries = 0
      } catch {
        this._checkpointDirty = true
        this._checkpointRetries++
        if (this._checkpointRetries < CHECKPOINT_RETRIES && !this.stopped) this._armCheckpoint()
        return
      }
    }
  }

  _noteOverlong() {
    this.log(`beads-hud · skip overlong events line · ${this.workspace}`)
  }

  _rememberLoose(session, line) {
    if (!line) return
    session.loose = (session.loose + line + '\n').slice(-LOOSE_CAP)
  }

  _feed(session, text, onLine) {
    if (session.skipping) {
      const nl = text.indexOf('\n')
      if (nl < 0) return
      session.skipping = false
      text = text.slice(nl + 1)
      if (!text) return
    }
    session.buf += text
    let nl
    while ((nl = session.buf.indexOf('\n')) >= 0) {
      const raw = session.buf.slice(0, nl)
      session.buf = session.buf.slice(nl + 1)
      if (raw.length > this.lineCap) {
        this._noteOverlong()
        continue
      }
      const stop = onLine(raw.replace(/\r$/, '').trim())
      if (stop === 'stop') {
        session.buf = ''
        return
      }
    }
    if (session.buf.length > this.lineCap) {
      this._noteOverlong()
      session.buf = ''
      session.skipping = true
    }
  }

  _spawnFollow(gen) {
    if (!this._alive(gen)) return
    // Recovery and reconcile can otherwise each leave a live `bd --follow`.
    this._retire(this.child)
    this._out = blankOut()
    const child = this.spawn(['events', 'tail', '--since', String(this.seq || 0), '--follow', '--json'])
    this._checkPipes(child)
    this.child = child
    let errBuf = ''
    let exitCode = null
    let settled = false
    const finishFollow = () => {
      if (settled) return
      settled = true
      this._cancelCloseFallback(child)
      if (this._killed.has(child)) {
        if (this.child === child) this.child = null
        return
      }
      // A trailing record or truncation object may have no newline yet.
      // Flush it before deciding the child died empty.
      if (!this._out.skipping && this._out.buf.length && this.child === child) {
        const pending = this._out.buf.replace(/\r$/, '').trim()
        this._out.buf = ''
        if (pending.length > this.lineCap) this._noteOverlong()
        else if (pending) this._onFollowLine(pending, child, gen)
      }
      if (this._killed.has(child)) {
        if (this.child === child) this.child = null
        return
      }
      // A line already started recovery. This close must not also enter poll.
      // The process has exited; killing it again is the respawn's job only
      // when this child is still the live handle.
      if (!this._alive(gen) || this._busy) {
        if (this.child === child) this.child = null
        return
      }
      if (this.child === child) this.child = null
      if (exitCode) {
        // bd 1.3 prints truncation as pretty-printed multi-line JSON, then
        // exits 1. A single-line check never sees that object.
        const info = truncationInfo(this._out.loose, errBuf)
        if (info) {
          this._followTruncation(info, gen)
          return
        }
        this._enterPoll('events-error', gen)
        return
      }
      this._enterPoll('events-exited', gen)
    }
    child.stdout.on('data', (chunk) => {
      if (this._killed.has(child) || this.child !== child || !this._alive(gen)) return
      this._feed(this._out, toText(chunk), (line) => this._onFollowLine(line, child, gen))
    })
    child.stderr.on('data', (chunk) => {
      if (this._killed.has(child) || !this._alive(gen)) return
      errBuf = (errBuf + toText(chunk)).slice(-4000)
      if (mentionsJournalDisabled(errBuf)) this._enterPoll('journal-disabled', gen)
    })
    child.on('error', () => {
      if (settled || this._killed.has(child) || !this._alive(gen)) return
      settled = true
      this._cancelCloseFallback(child)
      this._enterPoll('events-error', gen)
    })
    child.on('exit', (code) => {
      if (settled) return
      if (this._killed.has(child)) {
        if (this.child === child) this.child = null
        return
      }
      if (exitCode == null) exitCode = typeof code === 'number' ? code : 0
      this._armCloseFallback(child, finishFollow)
    })
    child.on('close', (code) => {
      if (this._killed.has(child)) {
        this._cancelCloseFallback(child)
        if (this.child === child) this.child = null
        return
      }
      if (exitCode == null) exitCode = typeof code === 'number' ? code : 0
      finishFollow()
    })
  }

  _onFollowLine(line, child, gen) {
    if (!line) return
    if (this.child !== child || !this._alive(gen)) return
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      this._rememberLoose(this._out, line)
      return
    }
    if (rec && rec.code === 'events_journal_truncated') {
      this._followTruncation(rec, gen)
      return 'stop'
    }
    this._applyRecord(rec)
  }

  _followTruncation(info, gen) {
    if (!this._alive(gen) || this.mode !== 'events') return
    // Reconcile is already replacing the stream. A second recovery would
    // spawn a follower we never track.
    if (this._busy) return
    // A truncation with no numeric head cannot be followed. Rescanning and
    // respawning from the same cursor loops until the process is killed.
    if (finiteHead(info) == null) {
      this._enterPoll('events-error', gen)
      return
    }
    this._busy = true
    void (async () => {
      try {
        await this._recoverTruncation(info, gen)
        if (!this._alive(gen) || this.mode !== 'events') return
        this._spawnFollow(gen)
      } catch {
        if (this._alive(gen) && this.mode !== 'poll') this._enterPoll('events-error', gen)
      } finally {
        this._busy = false
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
    if (this._busy) {
      this._armReconcile(gen)
      return
    }
    this._busy = true
    try {
      // The running follow keeps serving until the new scan has landed. Killing
      // it first left mode 'events' pointed at a frozen board whenever bd hung.
      const head = await this._discoverHead(gen)
      if (!this._alive(gen) || this.mode !== 'events' || head == null) return
      await this._rescan(gen)
      if (!this._alive(gen) || this.mode !== 'events') return
      this.seq = head
      if (this.seq > 0) this._scheduleCheckpoint()
      this._spawnFollow(gen)
    } catch {
      if (this._alive(gen) && this.mode !== 'poll') this._enterPoll('events-error', gen)
    } finally {
      this._busy = false
      if (this._alive(gen) && this.mode === 'events') this._armReconcile(gen)
    }
  }

  _armHealthy(gen) {
    this._later(gen, this.healthyMs, () => {
      if (this.mode === 'events') this.backoff = this.backoffStart
    })
  }
}
