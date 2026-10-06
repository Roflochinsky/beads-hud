import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import {
  applyEvent,
  cloneIdentity,
  deriveBoard,
  emptyState,
  eventsCheckpointPath,
  Follower,
  parseVersion,
  stateFromScan,
  supportsEvents,
} from '../lib/live.mjs'

const fixtureLines = readFileSync(join(import.meta.dirname, 'fixtures', 'events-sample.jsonl'), 'utf8')
  .trim()
  .split('\n')

function issue(id, extra = {}) {
  return { id, title: id, status: 'open', priority: 2, issue_type: 'task', ...extra }
}

function replay(lines) {
  const state = emptyState()
  for (const line of lines) applyEvent(state, JSON.parse(line))
  return state
}

function view(board) {
  return {
    issues: board.issues
      .map((item) => ({
        id: item.id,
        status: item.status,
        column: item.column,
        parent: item.parent,
        kind: item.kind,
        blockedBy: item.blockedBy,
        blocks: item.blocks,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    groups: board.groups.map((group) => group.id).sort(),
    loose: board.loose.map((item) => item.id).sort(),
  }
}

function fakeClock(start = 0) {
  let t = start
  let n = 0
  const timers = []
  return {
    get t() {
      return t
    },
    setTimer(fn, ms) {
      const timer = { at: t + ms, fn, cleared: false, n: n++ }
      timers.push(timer)
      return timer
    },
    clearTimer(timer) {
      if (timer) timer.cleared = true
    },
    async advance(ms) {
      t += ms
      for (let i = 0; i < 80; i++) {
        const due = timers
          .filter((timer) => !timer.cleared && timer.at <= t)
          .sort((a, b) => a.at - b.at || a.n - b.n)
        if (!due.length) return
        due[0].cleared = true
        await due[0].fn()
      }
      throw new Error('timer cascade')
    },
  }
}

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => {
    child.killed = true
    child.emit('exit', null, 'SIGTERM')
  }
  return child
}

function setup(opts = {}) {
  const clock = fakeClock(opts.time || 0)
  const spawned = []
  const execLog = []
  const saves = []
  const logs = []
  const scans = { n: 0 }
  const bag = {
    version: opts.version ?? '1.3.1',
    journal: opts.journal ?? 'true',
    identity: opts.identity ?? 'clone-a',
    checkpoint: opts.checkpoint ?? null,
    drain: opts.drain || (() => ({ stdout: '', stderr: '', code: 0 })),
    scanState: opts.scanState || (() => emptyState()),
  }
  function follower() {
    return new Follower({
      workspace: opts.workspace || '/home/box/proj',
      now: () => clock.t,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      async exec(args) {
        execLog.push(args)
        if (args[0] === 'version') return { stdout: JSON.stringify({ version: bag.version }), stderr: '', code: 0 }
        if (args[0] === 'config') {
          return { stdout: JSON.stringify({ key: 'events-journal', value: bag.journal }), stderr: '', code: 0 }
        }
        if (args[0] === 'events') return bag.drain(args)
        return { stdout: '', stderr: 'unexpected ' + args.join(' '), code: 1 }
      },
      spawn(args) {
        const child = fakeChild()
        spawned.push({ args, child })
        return child
      },
      async scan() {
        scans.n++
        return bag.scanState()
      },
      async loadCheckpoint() {
        return bag.checkpoint
      },
      async saveCheckpoint(payload) {
        saves.push(payload)
        bag.checkpoint = payload
      },
      async readIdentity() {
        return bag.identity
      },
      log(line) {
        logs.push(line)
      },
      configRecheckMs: opts.configRecheckMs ?? 60_000,
      reconcileMs: opts.reconcileMs ?? 600_000,
      backoffStart: opts.backoffStart ?? 30_000,
      backoffMax: opts.backoffMax ?? 600_000,
      healthyMs: opts.healthyMs ?? 60_000,
      checkpointDebounceMs: opts.checkpointDebounceMs ?? 1000,
    })
  }
  return { clock, spawned, execLog, saves, logs, scans, bag, follower }
}

async function settled() {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve))
}

describe('reducer', () => {
  test('replays the captured journal onto an empty board', () => {
    const state = replay(fixtureLines)
    const ids = [...state.issues.keys()].sort()
    assert.deepEqual(ids, ['scratch-board-cq2', 'scratch-board-cq2.1', 'scratch-board-vk3', 'scratch-board-whw'])

    const taskA = state.issues.get('scratch-board-cq2.1')
    assert.equal(taskA.title, 'Task A')
    assert.equal(taskA.status, 'closed')
    assert.equal(taskA.assignee, 'box')

    const taskB = state.issues.get('scratch-board-whw')
    assert.equal(taskB.title, 'Task B')
    assert.equal(taskB.status, 'open')
    assert.equal(taskB.is_blocked, false)
    assert.equal(taskB.assignee, undefined)
    assert.deepEqual(taskB.labels, ['foo'])

    assert.equal(state.issues.has('scratch-board-23h'), false)
    assert.equal(state.issues.get('scratch-board-vk3').title, 'live one')
    assert.deepEqual([...state.deps.values()], [
      { issue_id: 'scratch-board-cq2.1', depends_on_id: 'scratch-board-cq2', type: 'parent-child' },
    ])

    const board = deriveBoard(state)
    assert.equal(board.issues.find((item) => item.id === 'scratch-board-cq2.1').column, 'closed')
    assert.equal(board.issues.find((item) => item.id === 'scratch-board-cq2.1').parent, 'scratch-board-cq2')
    assert.equal(board.issues.find((item) => item.id === 'scratch-board-whw').column, 'todo')
    assert.equal(board.issues.find((item) => item.id === 'scratch-board-23h'), undefined)
  })

  test('missing is_blocked is false and a later snapshot replaces the issue', () => {
    const state = emptyState()
    assert.equal(applyEvent(state, { op: 'create', issue_id: 'a', issue: issue('a') }), true)
    assert.equal(state.issues.get('a').is_blocked, false)
    applyEvent(state, { op: 'update', issue_id: 'a', issue: issue('a', { assignee: 'box', is_blocked: true }) })
    assert.equal(state.issues.get('a').assignee, 'box')
    assert.equal(state.issues.get('a').is_blocked, true)
    applyEvent(state, { op: 'update', issue_id: 'a', issue: issue('a', { title: 'renamed' }) })
    assert.equal(state.issues.get('a').title, 'renamed')
    assert.equal(state.issues.get('a').assignee, undefined)
    assert.equal(state.issues.get('a').is_blocked, false)
  })

  test('dep_add is idempotent and delete drops every touching edge', () => {
    const state = emptyState()
    const edge = { op: 'dep_add', issue_id: 'c', issue: issue('c'), dep: { kind: 'blocks', target: 'p', metadata: '{}' } }
    applyEvent(state, { op: 'create', issue_id: 'p', issue: issue('p') })
    applyEvent(state, { op: 'create', issue_id: 'x', issue: issue('x') })
    applyEvent(state, edge)
    applyEvent(state, edge)
    applyEvent(state, {
      op: 'dep_add',
      issue_id: 'p',
      issue: issue('p'),
      dep: { kind: 'parent-child', target: 'x', metadata: '{}' },
    })
    assert.equal(state.deps.size, 2)
    assert.equal(applyEvent(state, { op: 'delete', issue_id: 'p', issue: null }), true)
    assert.equal(state.issues.has('p'), false)
    assert.equal(state.issues.has('c'), true)
    assert.equal(state.deps.size, 0)
  })

  test('hides wisps, gates, infra and templates, and ignores unknown ops', () => {
    for (const issue_type of ['gate', 'agent', 'role', 'message']) {
      const state = emptyState()
      assert.equal(applyEvent(state, { op: 'create', issue_id: 'h', issue: issue('h', { issue_type }) }), true)
      assert.equal(state.issues.size, 0)
    }
    for (const extra of [{ ephemeral: true }, { is_template: true }]) {
      const state = emptyState()
      applyEvent(state, { op: 'create', issue_id: 'h', issue: issue('h', extra) })
      assert.equal(state.issues.size, 0)
    }
    const state = emptyState()
    applyEvent(state, { op: 'create', issue_id: 'a', issue: issue('a', { title: 'keep' }) })
    applyEvent(state, { op: 'update', issue_id: 'a', issue: issue('a', { ephemeral: true }) })
    assert.equal(state.issues.has('a'), false)
    applyEvent(state, { op: 'create', issue_id: 'a', issue: issue('a', { title: 'keep' }) })
    assert.equal(applyEvent(state, { op: 'rename', issue_id: 'a', issue: issue('a', { title: 'nope' }) }), false)
    assert.equal(state.issues.get('a').title, 'keep')
    assert.equal(applyEvent(state, { op: 'comment', issue_id: 'a', issue: issue('a', { title: 'noted' }) }), true)
    assert.equal(state.issues.get('a').title, 'noted')
  })

  test('event-built and scan-built boards match, including the blocked column', () => {
    const blocker = issue('a', { title: 'Blocker', priority: 1 })
    const blocked = issue('b', { title: 'Blocked' })
    const state = emptyState()
    applyEvent(state, { op: 'create', issue_id: 'a', issue: blocker })
    applyEvent(state, { op: 'create', issue_id: 'b', issue: blocked })
    applyEvent(state, {
      op: 'dep_add',
      issue_id: 'b',
      issue: { ...blocked, is_blocked: true },
      dep: { kind: 'blocks', target: 'a', metadata: '{}' },
    })
    const scanned = stateFromScan({
      open: [{ ...blocker }, { ...blocked, is_blocked: true }],
      closed: [],
      graph: [{ Issues: [], Dependencies: [{ issue_id: 'b', depends_on_id: 'a', type: 'blocks' }] }],
    })
    const live = deriveBoard(state)
    const fromScan = deriveBoard(scanned)
    assert.equal(live.issues.find((item) => item.id === 'b').column, 'blocked')
    assert.equal(fromScan.issues.find((item) => item.id === 'b').column, 'blocked')
    assert.deepEqual(view(live), view(fromScan))

    applyEvent(state, { op: 'close', issue_id: 'a', issue: { ...blocker, status: 'closed' } })
    const scannedAfter = stateFromScan({
      open: [{ ...blocked }],
      closed: [{ ...blocker, status: 'closed' }],
      graph: [{ Issues: [], Dependencies: [{ issue_id: 'b', depends_on_id: 'a', type: 'blocks' }] }],
    })
    const liveAfter = deriveBoard(state)
    const scanAfter = deriveBoard(scannedAfter)
    assert.equal(liveAfter.issues.find((item) => item.id === 'b').column, 'todo')
    assert.equal(scanAfter.issues.find((item) => item.id === 'b').column, 'todo')
    assert.equal(liveAfter.issues.find((item) => item.id === 'a').column, 'closed')
    assert.deepEqual(view(liveAfter), view(scanAfter))
  })

  test('kindOf stays on the derived board', () => {
    const state = emptyState()
    applyEvent(state, { op: 'create', issue_id: 'e', issue: issue('e', { issue_type: 'epic', title: 'Epic' }) })
    applyEvent(state, { op: 'create', issue_id: 'u', issue: issue('u', { issue_type: 'bug', title: 'Bug' }) })
    applyEvent(state, { op: 'create', issue_id: 'f', issue: issue('f', { issue_type: 'feature', title: 'Feat' }) })
    applyEvent(state, { op: 'create', issue_id: 'v', issue: issue('v', { title: 'Проверка контракта' }) })
    const kinds = Object.fromEntries(deriveBoard(state).issues.map((item) => [item.id, item.kind]))
    assert.deepEqual(kinds, { e: 'epic', u: 'bug', f: 'feature', v: 'verify' })
  })
})

describe('version gate', () => {
  test('parses bd versions and accepts 1.3.0 and newer', () => {
    assert.deepEqual(parseVersion('1.3.1'), [1, 3, 1])
    assert.deepEqual(parseVersion('v1.3.0'), [1, 3, 0])
    assert.deepEqual(parseVersion('1.3.2-rc.1'), [1, 3, 2])
    assert.equal(parseVersion('nope'), null)
    assert.equal(parseVersion(''), null)
    assert.equal(parseVersion(null), null)
    assert.equal(supportsEvents('1.3.0'), true)
    assert.equal(supportsEvents('1.3.1'), true)
    assert.equal(supportsEvents('v1.3.0'), true)
    assert.equal(supportsEvents('1.3.2-rc.1'), true)
    assert.equal(supportsEvents('2.0.0'), true)
    assert.equal(supportsEvents('1.4.0'), true)
    assert.equal(supportsEvents('1.2.9'), false)
    assert.equal(supportsEvents('0.9.0'), false)
    assert.equal(supportsEvents('garbage'), false)
    assert.equal(supportsEvents(''), false)
  })
})

describe('follower', () => {
  test('bd older than 1.3 stays on the poll path', async () => {
    for (const version of ['1.2.9', 'not-a-version']) {
      const env = setup({ version })
      const follower = env.follower()
      try {
        await follower.start()
        assert.equal(follower.mode, 'poll')
        assert.equal(follower.reason, 'bd-too-old')
        assert.equal(env.scans.n, 0)
        assert.equal(env.spawned.length, 0)
        assert.match(env.logs[0], /beads-hud · poll · \/home\/box\/proj · bd-too-old/)
      } finally {
        await follower.stop()
      }
    }
  })

  test('disabled journal config stays on the poll path', async () => {
    const env = setup({ journal: 'false' })
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.mode, 'poll')
      assert.equal(follower.reason, 'journal-disabled')
      assert.equal(env.scans.n, 0)
      assert.equal(env.spawned.length, 0)
      assert.equal(env.execLog.some((args) => args[0] === 'events'), false)
      assert.match(env.logs[0], /beads-hud · poll · \/home\/box\/proj · journal-disabled/)
    } finally {
      await follower.stop()
    }
  })

  test('a disabled-journal note on the drain does not start --follow', async () => {
    const env = setup({
      drain: () => ({
        stdout: '',
        stderr: "note: the events journal is disabled for this workspace (enable with 'bd config set events-journal true')\n",
        code: 0,
      }),
    })
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.mode, 'poll')
      assert.equal(follower.reason, 'journal-disabled')
      assert.equal(env.scans.n, 1)
      assert.equal(env.spawned.length, 0)
    } finally {
      await follower.stop()
    }
  })

  test('a disabled-journal note during follow drops back to poll', async () => {
    const env = setup()
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.mode, 'events')
      const child = env.spawned[0].child
      child.stderr.emit('data', 'note: the events journal is dis')
      assert.equal(follower.mode, 'events')
      child.stderr.emit('data', "abled for this workspace (enable with 'bd config set events-journal true')\n")
      assert.equal(follower.mode, 'poll')
      assert.equal(follower.reason, 'journal-disabled')
      assert.equal(child.killed, true)
    } finally {
      await follower.stop()
    }
  })

  test('follow exit polls, then a retry after backoff is live again', async () => {
    const env = setup({ backoffStart: 5000, configRecheckMs: 600_000, healthyMs: 600_000 })
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.mode, 'events')
      assert.match(env.logs[0], /beads-hud · events · \/home\/box\/proj · seq 0/)
      env.spawned[0].child.emit('exit', 0, null)
      assert.equal(follower.mode, 'poll')
      assert.equal(follower.reason, 'events-exited')
      await env.clock.advance(4999)
      assert.equal(follower.mode, 'poll')
      await env.clock.advance(1)
      assert.equal(follower.mode, 'events')
      assert.equal(env.spawned.length, 2)
      assert.match(env.logs.at(-1), /beads-hud · events · \/home\/box\/proj · seq 0/)
    } finally {
      await follower.stop()
    }
  })

  test('a follower error and a non-zero exit are events-error', async () => {
    const env = setup()
    const follower = env.follower()
    try {
      await follower.start()
      env.spawned[0].child.emit('error', new Error('boom'))
      assert.equal(follower.mode, 'poll')
      assert.equal(follower.reason, 'events-error')
    } finally {
      await follower.stop()
    }

    const again = setup()
    const second = again.follower()
    try {
      await second.start()
      again.spawned[0].child.emit('exit', 1, null)
      assert.equal(second.mode, 'poll')
      assert.equal(second.reason, 'events-error')
    } finally {
      await second.stop()
    }
  })

  test('truncation rescans and resumes from head', async () => {
    const pretty = JSON.stringify(
      {
        code: 'events_journal_truncated',
        error: 'missing prefix {seq < floor}',
        floor: 3,
        head: 11,
        since: 0,
      },
      null,
      2,
    )
    const env = setup({
      drain(args) {
        const since = args[args.indexOf('--since') + 1]
        if (since === '0') return { stdout: pretty + '\n', stderr: '', code: 1 }
        return { stdout: '', stderr: '', code: 0 }
      },
    })
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.mode, 'events')
      assert.equal(follower.seq, 11)
      assert.equal(env.scans.n, 2)
      assert.deepEqual(env.spawned.at(-1).args, ['events', 'tail', '--since', '11', '--follow', '--json'])
      assert.match(env.logs[0], /beads-hud · events · \/home\/box\/proj · seq 11/)
    } finally {
      await follower.stop()
    }
  })

  test('truncation on the follow stream rescans and follows from head', async () => {
    const env = setup({
      drain(args) {
        const since = args[args.indexOf('--since') + 1]
        if (since === '0') return { stdout: '', stderr: '', code: 0 }
        return { stdout: '', stderr: '', code: 0 }
      },
    })
    const follower = env.follower()
    try {
      await follower.start()
      const line = JSON.stringify({
        code: 'events_journal_truncated',
        error: 'missing prefix {seq < floor}',
        floor: 4,
        head: 12,
        since: 0,
      })
      env.spawned[0].child.stdout.emit('data', line + '\n')
      await settled()
      assert.equal(follower.mode, 'events')
      assert.equal(follower.seq, 12)
      assert.equal(env.scans.n, 2)
      assert.equal(env.spawned[0].child.killed, true)
      assert.deepEqual(env.spawned.at(-1).args, ['events', 'tail', '--since', '12', '--follow', '--json'])
    } finally {
      await follower.stop()
    }
  })

  test('partial chunks assemble a line and seq at or below the cursor is skipped', async () => {
    const env = setup()
    const follower = env.follower()
    try {
      await follower.start()
      const line1 = JSON.stringify({ seq: 1, op: 'create', issue_id: 'a', issue: issue('a', { title: 'A' }) })
      const line2 = JSON.stringify({ seq: 2, op: 'create', issue_id: 'b', issue: issue('b', { title: 'B' }) })
      const child = env.spawned[0].child
      child.stdout.emit('data', Buffer.from(line1.slice(0, 15)))
      assert.equal(follower.state.issues.size, 0)
      child.stdout.emit('data', Buffer.from(line1.slice(15) + '\n' + line2 + '\n'))
      assert.equal(follower.state.issues.get('a').title, 'A')
      assert.equal(follower.state.issues.get('b').title, 'B')
      assert.equal(follower.seq, 2)
      const first = follower.board()
      assert.equal(follower.board(), first)
      child.stdout.emit('data', JSON.stringify({ seq: 2, op: 'update', issue_id: 'a', issue: issue('a', { title: 'OLD' }) }) + '\n')
      child.stdout.emit('data', JSON.stringify({ seq: 1, op: 'update', issue_id: 'a', issue: issue('a', { title: 'OLDER' }) }) + '\n')
      assert.equal(follower.state.issues.get('a').title, 'A')
      assert.equal(follower.seq, 2)
      assert.equal(follower.board(), first)
      child.stdout.emit('data', JSON.stringify({ seq: 3, op: 'update', issue_id: 'a', issue: issue('a', { title: 'NEW' }) }) + '\n')
      assert.equal(follower.state.issues.get('a').title, 'NEW')
      assert.notEqual(follower.board(), first)
      assert.equal(follower.board().issues.find((item) => item.id === 'a').title, 'NEW')
    } finally {
      await follower.stop()
    }
  })

  test('checkpoint is saved, loaded, and records at or below it are skipped', async () => {
    const env = setup({ checkpointDebounceMs: 1000, configRecheckMs: 60_000 })
    const first = env.follower()
    try {
      await first.start()
      const line = JSON.stringify({ seq: 3, op: 'create', issue_id: 'a', issue: issue('a', { title: 'A' }) }) + '\n'
      env.spawned[0].child.stdout.emit('data', line)
      assert.equal(env.saves.length, 0)
      await env.clock.advance(999)
      assert.equal(env.saves.length, 0)
      await env.clock.advance(1)
      assert.equal(env.bag.checkpoint.seq, 3)
      assert.equal(env.bag.checkpoint.identity, 'clone-a')
      assert.equal(env.bag.checkpoint.workspace, '/home/box/proj')
      assert.equal(typeof env.bag.checkpoint.at, 'number')
    } finally {
      await first.stop()
    }

    env.bag.scanState = () => {
      const state = emptyState()
      applyEvent(state, { op: 'create', issue_id: 'a', issue: issue('a', { title: 'SCAN' }) })
      return state
    }
    env.bag.drain = () => ({
      stdout:
        [
          JSON.stringify({ seq: 3, op: 'update', issue_id: 'a', issue: issue('a', { title: 'OLD' }) }),
          JSON.stringify({ seq: 4, op: 'create', issue_id: 'b', issue: issue('b', { title: 'B' }) }),
        ].join('\n') + '\n',
      stderr: '',
      code: 0,
    })
    const second = env.follower()
    try {
      await second.start()
      assert.equal(second.state.issues.get('a').title, 'SCAN')
      assert.equal(second.state.issues.get('b').title, 'B')
      assert.equal(second.seq, 4)
      assert.deepEqual(env.spawned.at(-1).args, ['events', 'tail', '--since', '4', '--follow', '--json'])
    } finally {
      await second.stop()
    }
  })

  test('stop flushes a checkpoint the debounce has not written yet', async () => {
    const env = setup()
    const follower = env.follower()
    try {
      await follower.start()
      env.spawned[0].child.stdout.emit(
        'data',
        JSON.stringify({ seq: 4, op: 'create', issue_id: 'a', issue: issue('a') }) + '\n',
      )
      assert.equal(env.saves.length, 0)
    } finally {
      await follower.stop()
    }
    assert.equal(env.bag.checkpoint.seq, 4)
    assert.equal(env.saves.at(-1).seq, 4)
  })

  test('a checkpoint past the drain is kept and those records are skipped', async () => {
    const env = setup({
      checkpoint: { seq: 20, identity: 'clone-a', workspace: '/home/box/proj', at: 1 },
      drain: () => ({
        stdout:
          [
            JSON.stringify({ seq: 4, op: 'create', issue_id: 'z', issue: issue('z', { title: 'Z' }) }),
            JSON.stringify({ seq: 5, op: 'update', issue_id: 'z', issue: issue('z', { title: 'later' }) }),
          ].join('\n') + '\n',
        stderr: '',
        code: 0,
      }),
    })
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.seq, 20)
      assert.equal(follower.state.issues.has('z'), false)
      assert.deepEqual(env.spawned[0].args, ['events', 'tail', '--since', '20', '--follow', '--json'])
    } finally {
      await follower.stop()
    }
  })

  test('an identity mismatch discards the checkpoint', async () => {
    const env = setup({
      checkpoint: { seq: 8, identity: 'other-clone', workspace: '/home/box/proj', at: 1 },
      identity: 'clone-a',
      scanState: () => {
        const state = emptyState()
        applyEvent(state, { op: 'create', issue_id: 'a', issue: issue('a', { title: 'SCAN' }) })
        return state
      },
      drain: () => ({
        stdout: JSON.stringify({ seq: 8, op: 'update', issue_id: 'a', issue: issue('a', { title: 'FROM-JOURNAL' }) }) + '\n',
        stderr: '',
        code: 0,
      }),
    })
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.state.issues.get('a').title, 'FROM-JOURNAL')
      assert.equal(follower.seq, 8)
    } finally {
      await follower.stop()
    }
  })

  test('a config recheck that flips off leaves events mode', async () => {
    const env = setup({ configRecheckMs: 5000, backoffStart: 30_000 })
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.mode, 'events')
      env.bag.journal = 'false'
      await env.clock.advance(4999)
      assert.equal(follower.mode, 'events')
      await env.clock.advance(1)
      assert.equal(follower.mode, 'poll')
      assert.equal(follower.reason, 'journal-disabled')
      assert.equal(env.spawned[0].child.killed, true)
      assert.match(env.logs.at(-1), /beads-hud · poll · \/home\/box\/proj · journal-disabled/)
    } finally {
      await follower.stop()
    }
  })

  test('a healthy stretch resets the backoff', async () => {
    const env = setup({ backoffStart: 1000, healthyMs: 5000, configRecheckMs: 600_000, reconcileMs: 600_000 })
    const follower = env.follower()
    try {
      await follower.start()
      env.spawned[0].child.emit('exit', 0, null)
      assert.equal(follower.mode, 'poll')
      await env.clock.advance(1000)
      assert.equal(follower.mode, 'events')
      await env.clock.advance(5000)
      env.spawned[1].child.emit('exit', 0, null)
      assert.equal(follower.mode, 'poll')
      await env.clock.advance(999)
      assert.equal(follower.mode, 'poll')
      await env.clock.advance(1)
      assert.equal(follower.mode, 'events')
      assert.equal(env.spawned.length, 3)
    } finally {
      await follower.stop()
    }
  })

  test('reconcile rescans without leaving events mode', async () => {
    let title = 'before'
    const env = setup({
      reconcileMs: 1000,
      configRecheckMs: 600_000,
      healthyMs: 600_000,
      scanState: () => {
        const state = emptyState()
        applyEvent(state, { op: 'create', issue_id: 'a', issue: issue('a', { title }) })
        return state
      },
    })
    const follower = env.follower()
    try {
      await follower.start()
      assert.equal(follower.board().issues.find((item) => item.id === 'a').title, 'before')
      const first = env.spawned[0].child
      title = 'after'
      await env.clock.advance(1000)
      assert.equal(follower.mode, 'events')
      assert.equal(follower.board().issues.find((item) => item.id === 'a').title, 'after')
      assert.equal(first.killed, true)
      assert.equal(env.spawned.length, 2)
      assert.equal(env.scans.n, 2)
      assert.equal(env.logs.length, 1)
    } finally {
      await follower.stop()
    }
  })
})

describe('checkpoint files', () => {
  test('names the cursor by workspace and hashes metadata.json', async () => {
    const path = eventsCheckpointPath('/tmp/cache', '/home/box/proj')
    assert.equal(path, join('/tmp/cache', 'events-' + Buffer.from('/home/box/proj').toString('base64url') + '.json'))
    const dir = await mkdtemp(join(tmpdir(), 'hud-id-'))
    try {
      assert.equal(await cloneIdentity(dir), '')
      await mkdir(join(dir, '.beads'))
      const body = '{"project_id":"abc"}\n'
      await writeFile(join(dir, '.beads', 'metadata.json'), body)
      assert.equal(await cloneIdentity(dir), createHash('sha256').update(body).digest('hex'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
