#!/usr/bin/env node
import { createServer } from 'node:http'
import { execFile, spawn as spawnChild } from 'node:child_process'
import { promisify } from 'node:util'
import { watch, writeFileSync } from 'node:fs'
import { readFile, readdir, stat, mkdir, writeFile, rm, rename } from 'node:fs/promises'
import { join, relative, resolve, sep, extname, basename, dirname } from 'node:path'
import { homedir } from 'node:os'
import { marked } from 'marked'
import { asPollBoard, cloneIdentity, deriveBoard, eventsCheckpointPath, Follower, makeDiskThrottle, stateFromScan } from './lib/live.mjs'

const run = promisify(execFile)
const HOME = homedir()
const START = resolve(process.cwd())
const PUBLIC = join(import.meta.dirname, 'public')

// One server, one address, every project. The picker switches folders, so a
// port per folder only ever produced a stale link.
const PORT = Number(process.env.BEADS_HUD_PORT) || 7777
const RUN_DIR = join(HOME, '.cache', 'beads-hud')
const RUN_FILE = join(RUN_DIR, 'server.json')

// bd on a big workspace takes tens of seconds, so a stale answer now beats a
// fresh answer in a minute: past CACHE_MS the old data still goes out while one
// refresh runs behind it. inflight keeps the poll from stacking scans.
const CACHE_MS = 15000
const cache = new Map()
const inflight = new Map()

// One follower per beads workspace. The cap and the idle timeout are what
// keep a stroll through the picker from leaving a bd process per folder.
const EVENTS_IDLE_MS = 10 * 60 * 1000
const EVENTS_MAX = 4
const DISK_WRITE_MS = 5000
// Editors and `bd config set` replace config.yaml in a burst of events.
// One recheck after the burst is enough; the 15s timer is the fallback.
const CONFIG_WATCH_MS = 300
const followers = new Map()
// stop() promises for followers already removed from the map (LRU eviction,
// idle sweep). Shutdown has to await these too, or the child and the
// checkpoint flush can still be in flight when the process exits.
const stopping = new Set()

const SKIP = new Set(['node_modules', '.git', '.beads', 'dist', 'build', '.next', '.astro', 'vendor', 'coverage'])
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

/** Anything inside the home directory is fair game; nothing outside it is. */
function safeRoot(p) {
  const full = resolve(p || START)
  if (full !== HOME && !full.startsWith(HOME + sep)) return null
  if (full.split(sep).includes('node_modules')) return null
  return full
}

async function bd(root, args) {
  const { stdout } = await run('bd', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

async function bdJson(root, args, fallback) {
  try {
    return JSON.parse(await bd(root, [...args, '--json']))
  } catch {
    return fallback
  }
}

// A hung `bd version` / scan must not leave the follower in 'starting', or in
// reconcile with the live tail already dead. Exit 1 is still how a truncated
// journal is reported (payload on stdout); a killed child is a real failure.
const BD_RUN_MS = 120 * 1000
async function bdRun(root, args) {
  try {
    const { stdout, stderr } = await run('bd', ['-C', root, ...args], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: BD_RUN_MS,
      killSignal: 'SIGKILL',
    })
    return { stdout: stdout || '', stderr: stderr || '', code: 0 }
  } catch (e) {
    if (e.code === 'ENOENT') throw e
    if (e.killed) throw e
    return {
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
      code: typeof e.code === 'number' ? e.code : 1,
    }
  }
}

async function bdJsonStrict(root, args) {
  const res = await bdRun(root, [...args, '--json'])
  if (res.code) throw new Error((res.stderr || '').trim().split('\n')[0] || 'bd отказал')
  return JSON.parse(res.stdout)
}

/** Folders worth offering in the picker: a repo, a beads workspace, or some prose. */
async function projects() {
  const bases = [join(HOME, 'code'), HOME]
  const seen = new Map()
  for (const base of bases) {
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue
      const dir = join(base, e.name)
      if (seen.has(dir)) continue
      let marks
      try {
        marks = await readdir(dir)
      } catch {
        continue
      }
      const isRepo = marks.includes('.git') || marks.includes('.beads')
      const hasDocs = marks.some((m) => extname(m).toLowerCase() === '.md')
      if (isRepo || hasDocs) seen.set(dir, { path: dir, name: e.name, repo: isRepo })
    }
  }
  if (!seen.has(START)) seen.set(START, { path: START, name: basename(START), repo: true })
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** First heading of a document, which is its real name far more often than the filename. */
function titleOf(md, fallback) {
  const h = md.match(/^#{1,2}\s+(.+)$/m)
  return h ? h[1].replace(/[*`_]/g, '').trim() : fallback
}

async function docs(root, dir = root, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      await docs(root, full, out)
      continue
    }
    if (extname(e.name).toLowerCase() !== '.md') continue
    const path = relative(root, full)
    try {
      const [raw, info] = await Promise.all([readFile(full, 'utf8'), stat(full)])
      out.push({
        path,
        dir: dirname(path) === '.' ? '' : dirname(path),
        title: titleOf(raw, basename(path, '.md')),
        words: (raw.match(/\S+/g) || []).length,
        changed: info.mtime.toISOString().slice(0, 10),
        at: info.mtimeMs,
      })
    } catch {
      /* unreadable file is not a document */
    }
  }
  return out
}

// A document is edited a paragraph at a time, so the server hands over its
// blocks with the exact offsets they occupy. Splicing by offset keeps every
// byte outside the edited block untouched — no reformatting on save.
function blocksOf(md) {
  const out = []
  let start = 0
  let fence = null
  let pos = 0
  let open = -1
  const push = (end) => {
    const src = md.slice(start, end).replace(/\s+$/, '')
    if (src.trim()) out.push({ start, end: start + src.length, src })
  }
  for (const line of md.split('\n')) {
    const isFence = /^\s*(```|~~~)/.test(line)
    if (open < 0 && line.trim()) {
      open = pos
      start = pos
    }
    if (fence) {
      // 'fm' closes on its own '---' and the block ends right there — no blank
      // line after the header required.
      if (fence === 'fm' && line.trim() === '---') {
        fence = null
        push(pos + line.length)
        open = -1
      } else if (fence !== 'fm' && isFence) fence = null
    } else if (isFence) {
      fence = true
    } else if (pos === 0 && line.trim() === '---' && /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.test(md)) {
      // A leading '---' opens YAML frontmatter — but only when a closing '---'
      // actually exists; a lone rule must not swallow the whole document.
      fence = 'fm'
    } else if (!line.trim() && open >= 0) {
      push(pos)
      open = -1
    }
    pos += line.length + 1
  }
  if (open >= 0) push(md.length)
  return out
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Frontmatter is machinery, not prose: it ships collapsed, native <details>, raw text.
const strWord = (n) => {
  const d = n % 10
  const h = n % 100
  return d === 1 && h !== 11 ? 'строка' : d >= 2 && d <= 4 && (h < 10 || h >= 20) ? 'строки' : 'строк'
}
const fmHtml = (src) => {
  const lines = src.split('\n').length - 2
  return `<details class="fm"><summary>служебная шапка · ${lines} ${strWord(lines)}</summary><pre>${esc(src)}</pre></details>`
}
const isFm = (b) => b.start === 0 && /^---\n[\s\S]*\n---$/.test(b.src)

const rendered = (md) => blocksOf(md).map((b) => ({ ...b, html: isFm(b) ? fmHtml(b.src) : marked.parse(b.src) }))

// beads-hud install / uninstall — writing into Claude Code's settings is an
// explicit command, never a postinstall side effect.
if (process.argv[2] === 'install' || process.argv[2] === 'uninstall') {
  const flags = process.argv.slice(3)
  const opts = {
    project: flags.includes('--project'),
    force: flags.includes('--force'),
    dryRun: flags.includes('--dry-run'),
  }
  const mod = await import('./bin/install.mjs')
  try {
    process.exit(await mod[process.argv[2]](opts))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}

// node server.mjs selfcheck — the splitter decides what a save overwrites, so a
// wrong offset silently eats a neighbouring paragraph.
if (process.argv[2] === 'selfcheck') {
  const { strict: a } = await import('node:assert')
  const doc = '# Заголовок\n\nПервый абзац.\nВторая строка.\n\n```js\nconst x = 1\n\nconst y = 2\n```\n\n- пункт\n- пункт\n'
  const b = blocksOf(doc)
  a.deepEqual(b.map((x) => x.src), [
    '# Заголовок',
    'Первый абзац.\nВторая строка.',
    '```js\nconst x = 1\n\nconst y = 2\n```',
    '- пункт\n- пункт',
  ])
  for (const x of b) a.equal(doc.slice(x.start, x.end), x.src, 'смещения блока должны указывать на него самого')
  const edited = doc.slice(0, b[1].start) + 'Новый текст.' + doc.slice(b[1].end)
  a.equal(edited, '# Заголовок\n\nНовый текст.\n\n```js\nconst x = 1\n\nconst y = 2\n```\n\n- пункт\n- пункт\n')
  a.deepEqual(blocksOf('').length, 0)
  a.deepEqual(blocksOf('\n\n   \n').length, 0)
  const fmDoc = '---\nname: x\ncolors:\n  a: "#fff"\n---\n\nПервый абзац.\n'
  const fb = blocksOf(fmDoc)
  a.equal(fb[0].src, '---\nname: x\ncolors:\n  a: "#fff"\n---', 'frontmatter должен быть одним блоком')
  a.equal(fb[1].src, 'Первый абзац.')
  for (const x of fb) a.equal(fmDoc.slice(x.start, x.end), x.src)
  a.ok(isFm(fb[0]) && !isFm(fb[1]))
  // Шапка без пустой строки после — блок всё равно заканчивается на '---'.
  const tight = blocksOf('---\na: 1\n---\n# Заголовок\n')
  a.deepEqual(tight.map((x) => x.src), ['---\na: 1\n---', '# Заголовок'])
  a.ok(isFm(tight[0]))
  // Одинокий '---' в первой строке — линия, а не шапка: документ не склеивается.
  const rule = blocksOf('---\n\nТекст после линии.\n')
  a.deepEqual(rule.map((x) => x.src), ['---', 'Текст после линии.'])
  a.ok(!isFm(rule[0]))
  a.deepEqual(strWord(1), 'строка')
  a.deepEqual(strWord(2), 'строки')
  a.deepEqual(strWord(147), 'строк')
  a.deepEqual(strWord(11), 'строк')
  console.log('selfcheck: ок,', b.length + fb.length, 'блоков')
  process.exit(0)
}

async function sheet(full, root) {
  const [raw, info] = await Promise.all([readFile(full, 'utf8'), stat(full)])
  return {
    path: relative(root, full),
    title: titleOf(raw, basename(full, '.md')),
    text: raw,
    blocks: rendered(raw),
    bytes: info.size,
    changed: info.mtime.toISOString().slice(0, 16).replace('T', ' '),
  }
}

async function loadScan(root) {
  const [open, closed, graph] = await Promise.all([
    bdJson(root, ['list'], []),
    bdJson(root, ['list', '--status=closed'], []),
    bdJson(root, ['graph', '--all'], []),
  ])
  return { open, closed, graph }
}

async function board(root) {
  return deriveBoard(stateFromScan(await loadScan(root)))
}

// A failed scan must not become an empty live board. The poll path stays
// lenient and can still answer from the disk cache.
async function scanWorkspace(root) {
  const [open, closed, graph] = await Promise.all([
    bdJsonStrict(root, ['list']),
    bdJsonStrict(root, ['list', '--status=closed']),
    bdJsonStrict(root, ['graph', '--all']),
  ])
  return stateFromScan({ open, closed, graph })
}

/** Which .beads bd will actually answer from — it climbs until it finds one. */
async function beadsRoot(root) {
  for (let d = root; d.startsWith(HOME); d = dirname(d)) {
    if (await stat(join(d, '.beads')).then(() => true, () => false)) return d
    if (d === HOME) break
  }
  return null
}

/**
 * The two halves of a project cost two different orders of magnitude: walking
 * the .md files takes a moment, asking bd for the whole graph can take a minute
 * on a big workspace. They are served separately so a folder switch shows its
 * documents immediately instead of holding everything back for the slow half.
 */
async function docsOf(root) {
  const [sheets, ws] = await Promise.all([docs(root), beadsRoot(root)])
  return {
    project: basename(root),
    root,
    // A folder without its own .beads shows the parent workspace's tasks. That is
    // bd's behaviour, not a bug — but unlabelled it reads as someone else's board.
    workspace: ws && ws !== root ? ws : null,
    docs: sheets.sort(
      (a, b) => a.path.split(sep).length - b.path.split(sep).length || a.path.localeCompare(b.path),
    ),
  }
}

const boardOf = (root) =>
  board(root).catch(() => ({ issues: [], groups: [], loose: [], error: 'bd не отвечает в этой папке' }))

const MAKE = { docs: docsOf, board: boardOf }

// Диск помнит последний удачный скан каждого проекта: холодный старт и смена
// проекта показывают прошлую доску мгновенно — с честным временем скана и
// пометкой stale, пока фоном идёт настоящий bd. Срока годности нет намеренно:
// картинка с видимым возрастом лучше пустоты.
const diskPath = (root) => join(RUN_DIR, 'board-' + Buffer.from(root).toString('base64url') + '.json')
const readDisk = (root) => readFile(diskPath(root), 'utf8').then(JSON.parse).catch(() => null)
// One write per window. A board skipped inside the window is written when the
// window ends (the helper unrefs that timer). Poll scans share the throttle
// so a late events snapshot cannot clobber a newer scan. flush() waits on the
// promise write() returns; a block body would drop it and process.exit would
// cut the deferred board.
const diskThrottle = makeDiskThrottle({
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer),
  waitMs: DISK_WRITE_MS,
  write: (root, board) => writeFile(diskPath(root), JSON.stringify(board)).catch(() => {}),
})

async function part(kind, rootIn) {
  const root = safeRoot(rootIn)
  if (!root) return { error: 'Папка вне домашнего каталога' }
  const key = kind + '\0' + root
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  let job = inflight.get(key)
  if (!job) {
    const t0 = Date.now()
    job = MAKE[kind](root)
      .then((data) => {
        // scannedAt — момент реального ответа bd, scanMs — его цена: клиент
        // показывает первое и подстраивает частоту опроса по второму.
        const out = { ...data, scannedAt: Date.now(), scanMs: Date.now() - t0 }
        cache.set(key, { at: Date.now(), data: out })
        if (kind === 'board' && !data.error) diskThrottle.put(root, out)
        return out
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, job)
  }
  if (hit) {
    job.catch(() => {})
    return { ...hit.data, stale: true }
  }
  if (kind === 'board') {
    const disk = await readDisk(root)
    if (disk) {
      job.catch(() => {})
      return { ...disk, stale: true }
    }
  }
  return job
}

const dropCache = (root) => {
  for (const k of cache.keys()) if (k.endsWith('\0' + root)) cache.delete(k)
}

// The events cursor is per clone. A half-written file would look like a
// cursor of zero and replay stale snapshots over the next scan.
async function loadEventsCheckpoint(workspace) {
  try {
    return JSON.parse(await readFile(eventsCheckpointPath(RUN_DIR, workspace), 'utf8'))
  } catch {
    return null
  }
}

async function saveEventsCheckpoint(workspace, payload) {
  await mkdir(RUN_DIR, { recursive: true })
  const file = eventsCheckpointPath(RUN_DIR, workspace)
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(payload))
  await rename(tmp, file)
}

// `bd config set` and editors replace config.yaml. A watch on the file itself
// goes silent across that replace; the directory event still carries the name.
// The journal and the database live in the same directory, so anything other
// than config.yaml must not turn into a `bd config get`.
function watchBeadsConfig(workspace, onChange) {
  let timer = null
  let closed = false
  let watcher
  try {
    watcher = watch(join(workspace, '.beads'), (_event, filename) => {
      if (basename(String(filename || '')) !== 'config.yaml') return
      if (closed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (!closed) onChange()
      }, CONFIG_WATCH_MS)
      if (typeof timer.unref === 'function') timer.unref()
    })
  } catch {
    return { close() {} }
  }
  watcher.on('error', () => {})
  return {
    close() {
      if (closed) return
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
      try {
        watcher.close()
      } catch {
        /* already closed */
      }
    },
  }
}

function createFollower(workspace) {
  // stdin is ignored: `bd events tail --follow` must not sit waiting on a pipe
  // we never write. bd serve is not a substitute — preview, and it needs Dolt.
  return new Follower({
    workspace,
    exec: (args) => bdRun(workspace, args),
    spawn: (args) => spawnChild('bd', ['-C', workspace, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }),
    scan: () => scanWorkspace(workspace),
    loadCheckpoint: () => loadEventsCheckpoint(workspace),
    saveCheckpoint: (payload) => saveEventsCheckpoint(workspace, payload),
    readIdentity: () => cloneIdentity(workspace),
    log: (line) => console.log(line),
    watchConfig: (onChange) => watchBeadsConfig(workspace, onChange),
  })
}

function forgetFollower(key) {
  const slot = followers.get(key)
  if (!slot) return
  followers.delete(key)
  const done = Promise.resolve(slot.follower.stop()).catch(() => {})
  stopping.add(done)
  done.finally(() => stopping.delete(done))
}

function evictOldestFollower() {
  let oldestKey = null
  let oldestAt = Infinity
  for (const [key, slot] of followers) {
    if (slot.lastAsk < oldestAt) {
      oldestAt = slot.lastAsk
      oldestKey = key
    }
  }
  if (oldestKey) forgetFollower(oldestKey)
}

function sweepIdleFollowers(now = Date.now()) {
  for (const [key, slot] of followers) {
    if (now - slot.lastAsk >= EVENTS_IDLE_MS) forgetFollower(key)
  }
}

async function ensureFollower(workspace) {
  // Shutdown already asked every child to die. A request in that window must
  // not start another `bd events tail --follow`.
  if (closing) return null
  const now = Date.now()
  let slot = followers.get(workspace)
  if (!slot) {
    if (closing) return null
    while (followers.size >= EVENTS_MAX) evictOldestFollower()
    if (closing) return null
    slot = { follower: createFollower(workspace), lastAsk: now }
    followers.set(workspace, slot)
    slot.follower.start().catch((e) => console.error(`beads-hud · follower · ${e.message}`))
  } else {
    slot.lastAsk = now
  }
  sweepIdleFollowers(now)
  return slot.follower
}

function rememberBoard(root, out) {
  diskThrottle.put(root, out)
}

async function boardResponse(rootIn) {
  const root = safeRoot(rootIn)
  if (!root) return { error: 'Папка вне домашнего каталога' }
  if (process.env.BEADS_HUD_EVENTS === '0') {
    return asPollBoard(await part('board', root), 'disabled')
  }
  // No .beads at all (not the same as "~/.beads exists but bd rejects it").
  const workspace = await beadsRoot(root)
  if (!workspace) return asPollBoard(await part('board', root), 'no-workspace')
  const follower = await ensureFollower(workspace)
  if (!follower) return asPollBoard(await part('board', root), 'starting')
  if (follower.mode === 'events' && follower.state) {
    const out = {
      ...follower.board(),
      scannedAt: follower.scannedAt,
      scanMs: follower.scanMs,
      live: 'events',
      liveReason: null,
      seq: follower.seq,
      // Reconcile rescans without moving seq. rev is the change counter.
      rev: follower.version,
    }
    rememberBoard(root, out)
    return out
  }
  // While the follower is scanning, part('board') would scan the same
  // workspace again. A disk picture is enough until events are up.
  // The cached events board still has seq/rev; a poll answer must not.
  if (follower.mode === 'starting') {
    const disk = await readDisk(root)
    if (disk) return asPollBoard({ ...disk, stale: true }, 'starting')
  }
  return asPollBoard(await part('board', root), follower.reason || 'starting')
}

async function stopFollowers() {
  const slots = [...followers.values()]
  followers.clear()
  const pending = slots.map((slot) => Promise.resolve(slot.follower.stop()).catch(() => {}))
  pending.push(...stopping)
  await Promise.all(pending)
}

const send = (res, code, type, body) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}
const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj))

async function body(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString() || '{}')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const q = url.searchParams
  try {
    if (url.pathname === '/api/projects') return json(res, 200, { start: START, projects: await projects() })

    if (url.pathname === '/api/docs') return json(res, 200, await part('docs', q.get('root')))

    if (url.pathname === '/api/board') return json(res, 200, await boardResponse(q.get('root')))

    if (url.pathname === '/api/doc' && req.method === 'POST') {
      const b = await body(req)
      const root = safeRoot(b.root)
      const full = root && resolve(root, b.p || '')
      if (!root || !full.startsWith(root + sep) || extname(full).toLowerCase() !== '.md')
        return json(res, 400, { error: 'Документ вне проекта' })
      if (typeof b.src !== 'string') return json(res, 400, { error: 'Нечего сохранять' })
      const raw = await readFile(full, 'utf8')
      const parts = blocksOf(raw)
      const src = b.src.replace(/\s+$/, '')
      let next
      if (b.block == null) {
        next = raw.replace(/\s*$/, '') + (raw.trim() ? '\n\n' : '') + src + '\n'
      } else {
        const at = parts[b.block]
        if (!at) return json(res, 409, { error: 'Документ изменился, откройте заново' })
        // An empty edit deletes the block along with the blank line that followed it.
        next = src
          ? raw.slice(0, at.start) + src + raw.slice(at.end)
          : raw.slice(0, at.start) + raw.slice(at.end).replace(/^\n{1,2}/, '')
      }
      await writeFile(full, next, 'utf8')
      dropCache(root)
      return json(res, 200, await sheet(full, root))
    }

    if (url.pathname === '/api/doc') {
      const root = safeRoot(q.get('root'))
      const full = root && resolve(root, q.get('p') || '')
      if (!root || !full.startsWith(root + sep) || extname(full).toLowerCase() !== '.md')
        return json(res, 400, { error: 'Документ вне проекта' })
      return json(res, 200, await sheet(full, root))
    }

    if (url.pathname === '/api/act' && req.method === 'POST') {
      const b = await body(req)
      const root = safeRoot(b.root)
      if (!root) return json(res, 400, { error: 'Папка вне домашнего каталога' })
      const args =
        b.op === 'close' ? ['close', b.id]
        : b.op === 'claim' ? ['update', b.id, '--claim']
        : b.op === 'reopen' ? ['reopen', b.id]
        : b.op === 'release' ? ['update', b.id, '--status=open']
        : b.op === 'create' ? ['create', `--title=${b.title}`, `--type=${b.type || 'task'}`, `--priority=${b.priority ?? 2}`, ...(b.parent ? [`--parent=${b.parent}`] : [])]
        : null
      if (!args) return json(res, 400, { error: 'Неизвестная операция' })
      if (b.op === 'create' && !String(b.title || '').trim()) return json(res, 400, { error: 'Пустой заголовок' })
      if (b.op !== 'create' && !b.id) return json(res, 400, { error: 'Не указана задача' })
      try {
        const out = await bd(root, args)
        dropCache(root)
        return json(res, 200, { ok: true, out: out.trim() })
      } catch (e) {
        return json(res, 500, { error: (e.stderr || e.message || '').trim().split('\n')[0] || 'bd отказал' })
      }
    }

    // The one dependency, served to the browser too: the drawer renders bd
    // descriptions with the same marked that renders documents.
    if (url.pathname === '/vendor/marked.esm.js')
      return send(res, 200, 'text/javascript; charset=utf-8', await readFile(join(import.meta.dirname, 'node_modules', 'marked', 'lib', 'marked.esm.js')))

    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const full = resolve(PUBLIC, file)
    if (!full.startsWith(PUBLIC + sep) && full !== join(PUBLIC, 'index.html')) return send(res, 403, 'text/plain', 'нет')
    return send(res, 200, (MIME[extname(full)] || 'application/octet-stream') + '; charset=utf-8', await readFile(full))
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'text/plain', 'не найдено')
    return json(res, 500, { error: e.message })
  }
})

let closing = false
let sweepTimer = null
async function shutdown(why) {
  if (closing) return
  closing = true
  if (sweepTimer) clearInterval(sweepTimer)
  await stopFollowers()
  await diskThrottle.flush()
  await rm(RUN_FILE, { force: true }).catch(() => {})
  console.log(`beads-hud · остановлен (${why})`)
  process.exit(0)
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(sig))
// 'exit' is synchronous. An uncaught throw skips shutdown(), and the follow
// children would outlive the server.
process.on('exit', () => {
  // shutdown() already flushed. This covers an exit that skipped it, so the
  // deferred board is not dropped on the floor.
  for (const [root, board] of diskThrottle.pending()) {
    try {
      writeFileSync(diskPath(root), JSON.stringify(board))
    } catch {
      /* a missed cache only means a colder start */
    }
  }
  for (const slot of followers.values()) {
    try {
      slot.follower.killChild()
    } catch {
      /* already dying */
    }
  }
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') process.exit(0)
  console.error(e.message)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${PORT}`
  await mkdir(RUN_DIR, { recursive: true })
  await writeFile(RUN_FILE, JSON.stringify({ root: START, project: basename(START), port: PORT, url, pid: process.pid, started: new Date().toISOString() }))
  sweepTimer = setInterval(() => sweepIdleFollowers(), 60 * 1000)
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref()
  console.log(`beads-hud · ${basename(START)} · ${url}`)
})
