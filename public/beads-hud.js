const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}
const icon = (name, cls) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('class', cls || 'ico ico--sm')
  s.setAttribute('aria-hidden', 'true')
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  u.setAttribute('href', '#i-' + name)
  s.appendChild(u)
  return s
}

const COLUMNS = [
  { key: 'todo', label: 'Открыто' },
  { key: 'doing', label: 'В работе' },
  { key: 'blocked', label: 'Заблокировано' },
  { key: 'closed', label: 'Закрыто' },
]
const KINDS = [
  { key: 'epic', label: 'Эпики' },
  { key: 'feature', label: 'Фичи' },
  { key: 'bug', label: 'Баги' },
  { key: 'verify', label: 'Верификация' },
  { key: 'task', label: 'Прочее' },
]
const STATUS = { open: 'открыта', in_progress: 'в работе', closed: 'закрыта' }

let root = localStorage.getItem('beadshud.root') || ''
let sel = localStorage.getItem('beadshud.sel') || 'all'
let view = 'board'
let docGroup = localStorage.getItem('beadshud.docGroup') || 'dir'
let data = { docs: [], issues: [], groups: [], loose: [] }
let waiting = false
let doc = null
let sheet = null
let task = null
let editing = null

/* ── Theme ─────────────────────────────────────────────────────── */
// The console is read at a desk at night, next to a dark terminal; dark is the
// surface, and light is the exception someone deliberately asks for.
const applyTheme = (t) => {
  if (t === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  $('theme').title = t === 'light' ? 'Тема: светлая' : 'Тема: тёмная'
}
applyTheme(localStorage.getItem('beadshud.theme'))
$('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
  localStorage.setItem('beadshud.theme', next)
  applyTheme(next)
}

/* ── Views ─────────────────────────────────────────────────────── */

function show(next) {
  view = next
  $('view-board').hidden = next !== 'board'
  $('view-docs').hidden = next !== 'docs'
  $('view-read').hidden = next !== 'read'
  $('kinds').hidden = next !== 'board'
  $('tab-board').setAttribute('aria-current', String(next === 'board'))
  $('tab-docs').setAttribute('aria-current', String(next !== 'board'))
  $('view-name').textContent =
    next === 'board' ? 'задачи' : next === 'docs' ? 'документы' : sheet?.title || 'документ'
  if (next !== 'read') closeTask()
}

$('tab-board').onclick = () => show('board')
$('tab-docs').onclick = () => {
  show('docs')
  renderDocs()
}
$('read-back').onclick = () => show('docs')

/* ── Kind rail ─────────────────────────────────────────────────── */

function kindItem(label, meta, key, child) {
  const b = el('button', 'kind' + (child ? ' kind--child' : ''))
  b.type = 'button'
  b.setAttribute('aria-current', String(sel === key))
  b.appendChild(el('span', 'kind__title', label))
  if (meta) b.appendChild(el('span', 'kind__n', meta))
  b.onclick = () => {
    sel = key
    localStorage.setItem('beadshud.sel', key)
    renderKinds()
    renderBoard()
  }
  return b
}

function renderKinds() {
  const rail = $('kinds')
  rail.replaceChildren()
  if (waiting && !data.issues.length) {
    rail.appendChild(el('div', 'kinds__wait', 'считаю задачи…'))
    return
  }
  const openCount = (list) => list.filter((i) => i.status !== 'closed').length

  const first = el('div', 'kinds__group')
  first.appendChild(kindItem('Все задачи', String(openCount(data.issues)), 'all'))
  if (data.loose.length) first.appendChild(kindItem('Без эпика', String(openCount(data.loose)), 'loose'))
  rail.appendChild(first)

  const box = el('div', 'kinds__group')
  box.appendChild(el('div', 'kinds__label', 'Виды работ'))
  for (const kind of KINDS) {
    const ofKind = data.issues.filter((i) => i.kind === kind.key)
    if (!ofKind.length) continue
    // The kind is itself the destination — no second row repeating its name.
    box.appendChild(kindItem(kind.label, String(openCount(ofKind)), 'kind:' + kind.key))
    if (kind.key === 'epic') {
      for (const g of data.groups.filter((g) => g.kind === 'epic' && g.status !== 'closed')) {
        box.appendChild(kindItem(g.title, `${g.doneCount}/${g.childCount}`, g.id, true))
      }
    }
  }
  rail.appendChild(box)
}

/* ── Board ─────────────────────────────────────────────────────── */

function selected() {
  if (sel === 'all') return data.issues
  if (sel === 'loose') return data.loose
  if (sel.startsWith('kind:')) return data.issues.filter((i) => i.kind === sel.slice(5))
  const kids = data.issues.filter((i) => i.parent === sel)
  const self = data.issues.find((i) => i.id === sel)
  return kids.length ? kids : self ? [self] : []
}

function card(i) {
  const c = el('button', `card${i.status === 'closed' ? ' card--closed' : ''}${task === i.id ? ' is-open' : ''}`)
  c.type = 'button'
  c.draggable = true
  c.dataset.id = i.id
  c.appendChild(el('div', 'card__title', i.title))
  const foot = el('div', 'card__foot')
  foot.appendChild(el('span', 'card__type', i.issue_type))
  foot.appendChild(el('span', 'card__id', i.id.split('-').pop()))
  foot.appendChild(el('span', `card__p${i.priority === 0 ? ' card__p--p0' : ''}`, 'P' + i.priority))
  if (i.blockedBy.length) {
    const w = el('span', 'card__wait')
    w.appendChild(icon('clock'))
    w.appendChild(el('span', null, 'ждёт ' + i.blockedBy.length))
    foot.appendChild(w)
  }
  c.appendChild(foot)
  c.title = i.blockedBy.length
    ? 'Заблокировано: ' + i.blockedBy.map((b) => data.issues.find((x) => x.id === b)?.title || b).join(', ')
    : i.id
  c.ondragstart = (e) => {
    e.dataTransfer.setData('text/plain', i.id)
    c.classList.add('is-dragging')
  }
  c.ondragend = () => c.classList.remove('is-dragging')
  c.onclick = () => openTask(i.id)
  return c
}

function column(name, light, count) {
  const box = el('section', 'col')
  const head = el('div', 'col__head')
  if (light != null) head.appendChild(el('span', 'light light--' + light))
  head.appendChild(el('span', 'col__name', name))
  head.appendChild(el('span', 'col__n', String(count)))
  box.appendChild(head)
  const body = el('div', 'col__body')
  box.appendChild(body)
  return { box, body }
}

function renderBoard() {
  const board = $('board')
  board.replaceChildren()
  if (waiting && !data.issues.length) {
    const col = column('Задачи', null, '')
    col.body.appendChild(el('p', 'col__empty', 'bd отвечает не мгновенно на большом проекте. Документы уже открыты.'))
    board.appendChild(col.box)
    return
  }
  const items = selected()
  if (!items.length) {
    const col = column('Пусто', null, 0)
    col.body.appendChild(el('p', 'col__empty', data.error || 'Здесь пока нет задач.'))
    board.appendChild(col.box)
    return
  }
  for (const c of COLUMNS) {
    const list = items.filter((i) => i.column === c.key).sort((a, b) => a.priority - b.priority)
    const col = column(c.label, c.key, list.length)
    if (!list.length) col.body.appendChild(el('p', 'col__empty', '—'))
    for (const i of list) col.body.appendChild(card(i))

    col.box.ondragover = (e) => {
      if (c.key === 'blocked') return
      e.preventDefault()
      col.box.classList.add('is-over')
    }
    col.box.ondragleave = () => col.box.classList.remove('is-over')
    col.box.ondrop = async (e) => {
      e.preventDefault()
      col.box.classList.remove('is-over')
      const issue = data.issues.find((x) => x.id === e.dataTransfer.getData('text/plain'))
      if (!issue || issue.column === c.key) return
      if (c.key === 'blocked') return toast('Блокировку задают зависимости, а не колонка', 'err')
      const op =
        c.key === 'closed' ? 'close'
        : c.key === 'doing' ? 'claim'
        : issue.status === 'closed' ? 'reopen'
        : null
      if (!op) return toast('Из этой колонки так не переносят', 'err')
      await act({ op, id: issue.id })
    }
    board.appendChild(col.box)
  }
}

/* ── Documents ─────────────────────────────────────────────────── */

const setGroup = (g) => {
  docGroup = g
  localStorage.setItem('beadshud.docGroup', g)
  $('by-dir').setAttribute('aria-pressed', String(g === 'dir'))
  $('by-epic').setAttribute('aria-pressed', String(g === 'epic'))
  renderDocs()
}
$('by-dir').onclick = () => setGroup('dir')
$('by-epic').onclick = () => setGroup('epic')

function sheetCard(d) {
  const b = el('button', 'sheet')
  b.type = 'button'
  const head = el('div', 'sheet__head')
  // Every card on this canvas is a live unit with a light. A document's state is
  // whether any task actually points at it — the unattached ones are the pile
  // nobody is reading, and that is worth seeing without switching grouping.
  head.appendChild(el('span', 'light' + (d.links.length ? ' light--closed' : '')))
  head.appendChild(el('h3', 'sheet__title', d.title))
  b.appendChild(head)
  b.appendChild(el('div', 'sheet__path', d.path))
  const foot = el('div', 'sheet__foot')
  foot.appendChild(el('span', null, `${d.words} слов`))
  foot.appendChild(el('span', null, d.changed))
  if (d.links.length) {
    const w = el('span', 'sheet__work')
    w.appendChild(icon('link'))
    w.appendChild(el('span', null, String(d.links.length)))
    foot.appendChild(w)
  }
  b.appendChild(foot)
  b.title = d.links.length
    ? 'В работе: ' + d.links.map((id) => data.issues.find((i) => i.id === id)?.title || id).join(', ')
    : 'Ни одна задача на этот документ не ссылается'
  b.onclick = () => openDoc(d.path)
  return b
}

function renderDocs() {
  const board = $('docs-board')
  board.replaceChildren()
  board.classList.remove('board--grid')
  if (!data.docs.length) {
    const col = column('Пусто', null, 0)
    col.body.appendChild(el('p', 'col__empty', 'В этом проекте нет .md файлов'))
    board.appendChild(col.box)
    return
  }

  const groups = new Map()
  const put = (key, name, d) => {
    if (!groups.has(key)) groups.set(key, { name, docs: [] })
    groups.get(key).docs.push(d)
  }
  if (docGroup === 'dir') {
    for (const d of data.docs) put(d.dir, d.dir || 'корень проекта', d)
  } else {
    const titleOf = (id) => data.issues.find((i) => i.id === id)?.title || id
    for (const d of data.docs) {
      if (d.links.length) for (const e of d.links) put(e, titleOf(e), d)
      else put('', 'Ни к чему не привязаны', d)
    }
  }

  // The unattached pile is real information, but it is never the headline.
  const order = [...groups.entries()].sort(([ka, a], [kb, b]) =>
    !ka === !kb ? b.docs.length - a.docs.length || a.name.localeCompare(b.name) : ka ? -1 : 1,
  )
  const recent = (g) => g.docs.sort((a, b) => b.at - a.at)

  // One group is not a board. A project whose documents all sit in one folder
  // gets a grid, so the surface is not four fifths empty canvas.
  if (order.length === 1) {
    board.classList.add('board--grid')
    for (const d of recent(order[0][1])) board.appendChild(sheetCard(d))
    return
  }
  board.classList.remove('board--grid')
  for (const [, g] of order) {
    const col = column(g.name, null, g.docs.length)
    for (const d of recent(g)) col.body.appendChild(sheetCard(d))
    board.appendChild(col.box)
  }
}

/* ── Reading and editing ───────────────────────────────────────── */

async function openDoc(path) {
  doc = path
  try {
    sheet = await (await fetch(`/api/doc?root=${encodeURIComponent(root)}&p=${encodeURIComponent(path)}`)).json()
    if (sheet.error) throw new Error(sheet.error)
  } catch (e) {
    return toast(e.message, 'err')
  }
  show('read')
  $('read-path').textContent = sheet.path
  $('read-meta').textContent = `${sheet.changed} · ${(sheet.bytes / 1024).toFixed(1)} КБ`
  renderRead()
  $('read').scrollTop = 0
}

function renderRead() {
  const box = $('read')
  box.replaceChildren()
  editing = null
  sheet.blocks.forEach((b, i) => {
    const n = el('div', 'blk')
    n.innerHTML = b.html
    n.dataset.i = String(i)
    n.onclick = (e) => {
      if (e.target.closest('a')) return
      editBlock(i)
    }
    box.appendChild(n)
  })
  const add = el('button', 'read__add', '+ добавить абзац')
  add.type = 'button'
  add.onclick = () => editBlock(null)
  box.appendChild(add)
}

/** Editing happens where the text is read: the block becomes its own source. */
function editBlock(i) {
  if (editing != null) return
  editing = i
  const box = $('read')
  const target = i == null ? box.querySelector('.read__add') : box.querySelector(`.blk[data-i="${i}"]`)
  const holder = el('div', 'blk')
  const area = el('textarea', 'blk__edit')
  area.value = i == null ? '' : sheet.blocks[i].src
  area.spellcheck = false
  const fit = () => {
    area.style.height = 'auto'
    area.style.height = area.scrollHeight + 2 + 'px'
  }
  area.oninput = fit
  holder.appendChild(area)
  holder.appendChild(el('div', 'blk__hint', 'Ctrl+Enter — сохранить, Esc — отменить, пусто — удалить'))
  target.replaceWith(holder)
  fit()
  area.focus()
  if (i != null) area.setSelectionRange(area.value.length, area.value.length)

  const stop = () => {
    editing = null
    renderRead()
  }
  area.onkeydown = (e) => {
    // Escape belongs to the block being edited; letting it bubble would also
    // close the document the user is still writing in.
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      stop()
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      e.stopPropagation()
      saveBlock(i, area.value)
    }
  }
  area.onblur = () => {
    if (editing == null) return
    const same = i != null && area.value === sheet.blocks[i].src
    if (same || (i == null && !area.value.trim())) return stop()
    saveBlock(i, area.value)
  }
}

async function saveBlock(i, src) {
  editing = null
  try {
    const r = await fetch('/api/doc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, p: doc, block: i, src }),
    })
    const d = await r.json()
    if (d.error) throw new Error(d.error)
    sheet = d
    $('read-meta').textContent = `${d.changed} · ${(d.bytes / 1024).toFixed(1)} КБ`
    toast(src.trim() ? 'Сохранено' : 'Блок удалён')
  } catch (e) {
    toast(e.message, 'err')
  }
  renderRead()
}

/* ── Task drawer ───────────────────────────────────────────────── */

function openTask(id) {
  const i = data.issues.find((x) => x.id === id)
  if (!i) return
  task = id
  $('task').hidden = false
  $('task-id').textContent = i.id
  const body = $('task-body')
  body.replaceChildren()
  body.appendChild(el('h1', 'task__title', i.title))

  const meta = el('div', 'task__meta')
  const light = el('span', 'chip')
  light.appendChild(el('span', 'light light--' + (i.column === 'todo' ? '' : i.column)))
  light.appendChild(el('span', null, STATUS[i.status] || i.status))
  meta.appendChild(light)
  const facts = [i.issue_type, 'P' + i.priority]
  if (i.assignee) facts.push(i.assignee)
  if (i.parent) facts.push('эпик: ' + (data.issues.find((x) => x.id === i.parent)?.title || i.parent))
  for (const f of facts) meta.appendChild(el('span', 'chip', f))
  body.appendChild(meta)

  const block = (label, text) => {
    if (!text) return
    body.appendChild(el('h2', 'task__h', label))
    body.appendChild(el('p', 'task__text', text))
  }
  block('Описание', i.description)
  block('Замысел', i.design)

  const links = (label, list) => {
    if (!list.length) return
    body.appendChild(el('h2', 'task__h', label))
    const ul = el('ul', 'task__links')
    for (const other of list) {
      const o = data.issues.find((x) => x.id === other)
      const b = el('button', 'task__link')
      b.type = 'button'
      b.appendChild(el('span', 'light light--' + (o?.column === 'todo' || !o ? '' : o.column)))
      b.appendChild(el('span', null, o ? o.title : other))
      b.onclick = () => openTask(other)
      ul.appendChild(el('li')).appendChild(b)
    }
    body.appendChild(ul)
  }
  links('Ждёт', i.blockedBy)
  links('Держит', i.blocks)
  links(
    'Дети',
    data.issues.filter((x) => x.parent === i.id).map((x) => x.id),
  )

  // The tasks that cite a document are the only reason it matters here.
  const cited = data.docs.filter((d) => `${i.description || ''}\n${i.design || ''}`.includes(d.path))
  if (cited.length) {
    body.appendChild(el('h2', 'task__h', 'Документы'))
    const ul = el('ul', 'task__links')
    for (const d of cited) {
      const b = el('button', 'task__link')
      b.type = 'button'
      b.appendChild(icon('docs'))
      b.appendChild(el('span', null, d.title))
      b.appendChild(el('span', 'task__doc', d.path))
      b.onclick = () => openDoc(d.path)
      ul.appendChild(el('li')).appendChild(b)
    }
    body.appendChild(ul)
  }

  const closed = i.status === 'closed'
  $('task-move').hidden = i.status === 'in_progress' || closed
  $('task-shut').textContent = closed ? 'Открыть заново' : 'Закрыть'
  body.scrollTop = 0
  if (view === 'board') renderBoard()
}

function closeTask() {
  if (!task) return
  task = null
  $('task').hidden = true
  if (view === 'board') renderBoard()
}

$('task-x').onclick = closeTask
$('task-move').onclick = () => act({ op: 'claim', id: task })
$('task-shut').onclick = () =>
  act({ op: data.issues.find((x) => x.id === task)?.status === 'closed' ? 'reopen' : 'close', id: task })

/* ── Actions ───────────────────────────────────────────────────── */

async function act(payload) {
  try {
    const r = await fetch('/api/act', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, root }),
    })
    const d = await r.json()
    if (d.error) throw new Error(d.error)
    toast(d.out ? d.out.split('\n')[0] : 'Готово')
    await load()
    return true
  } catch (e) {
    toast(e.message, 'err')
    return false
  }
}

let toastTimer
function toast(msg, kind) {
  const n = $('toast')
  n.textContent = msg
  n.dataset.kind = kind || 'ok'
  n.dataset.show = '1'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (n.dataset.show = '0'), kind === 'err' ? 6000 : 2600)
}

/* ── Load ──────────────────────────────────────────────────────── */

async function loadProjects() {
  const d = await (await fetch('/api/projects')).json()
  if (!root || !d.projects.some((p) => p.path === root)) root = d.start
  const picker = $('project')
  picker.replaceChildren()
  for (const p of d.projects) {
    const o = new Option(p.name, p.path)
    o.selected = p.path === root
    picker.appendChild(o)
  }
  picker.onchange = () => {
    root = picker.value
    localStorage.setItem('beadshud.root', root)
    sel = 'all'
    doc = null
    task = null
    show('board')
    load()
  }
}

/**
 * A document belongs to the work that cites its path — "Спека: docs/specs/x.md".
 * Computed here rather than on the server because it needs both halves, and the
 * halves now arrive separately.
 */
function linkDocs() {
  // Documents arrive before the tasks do, so every card must survive having no
  // links yet rather than waiting for the slow half.
  for (const d of data.docs) if (!d.links) d.links = []
  if (!data.issues.length) return
  const byId = new Map(data.issues.map((i) => [i.id, i]))
  const isGroup = new Set(data.groups.map((g) => g.id))
  for (const d of data.docs) {
    const hits = new Set()
    for (const i of data.issues) {
      if (!`${i.description || ''}\n${i.design || ''}`.includes(d.path)) continue
      const parent = i.parent && byId.has(i.parent) ? i.parent : null
      hits.add(isGroup.has(i.id) ? i.id : parent && isGroup.has(parent) ? parent : i.id)
    }
    d.links = [...hits]
  }
}

let loading = false
async function load() {
  const want = root
  loading = true
  // The documents land in a moment; bd can take a minute on a big workspace. The
  // board says so rather than showing the previous folder's tasks as if they were
  // this one's.
  waiting = true
  renderKinds()
  renderBoard()

  const get = (part) =>
    fetch(`/api/${part}?root=${encodeURIComponent(want)}`)
      .then((r) => r.json())
      // A slow scan can land after the picker already moved on; that answer
      // belongs to a folder nobody is looking at any more.
      .then((d) => (want === root ? d : null))

  const docsJob = get('docs').then((d) => {
    if (!d) return
    data = { ...data, ...d }
    // Tasks come from the nearest .beads upwards, which may not be this folder.
    $('crumb').textContent = data.workspace ? `задачи из ${data.workspace}` : ''
    linkDocs()
    if (view === 'docs') renderDocs()
  })

  const boardJob = get('board').then((b) => {
    if (!b) return
    data = { ...data, ...b }
    waiting = false
    if (sel !== 'all' && sel !== 'loose' && !sel.startsWith('kind:') && !data.groups.some((g) => g.id === sel))
      sel = 'all'
    linkDocs()
    renderKinds()
    renderBoard()
    if (view === 'docs') renderDocs()
    if (task) data.issues.some((i) => i.id === task) ? openTask(task) : closeTask()
  })

  try {
    await Promise.all([docsJob, boardJob])
  } finally {
    loading = false
    if (want === root) waiting = false
  }
}

/* ── New task ──────────────────────────────────────────────────── */

$('new-task').onclick = () => {
  const s = $('entry-parent')
  s.replaceChildren(new Option('без эпика', ''))
  for (const g of data.groups) s.appendChild(new Option(g.title, g.id))
  if (sel !== 'all' && sel !== 'loose' && !sel.startsWith('kind:')) s.value = sel
  $('entry-err').hidden = true
  $('entry-title').value = ''
  $('entry').hidden = false
  $('scrim').hidden = false
  $('entry-title').focus()
}
const closeEntry = () => {
  $('entry').hidden = true
  $('scrim').hidden = true
}
$('entry-cancel').onclick = closeEntry
$('scrim').onclick = closeEntry
$('entry').onsubmit = async (e) => {
  e.preventDefault()
  const title = $('entry-title').value.trim()
  if (!title) {
    $('entry-err').textContent = 'Без заголовка задачу не создать.'
    $('entry-err').hidden = false
    return
  }
  const ok = await act({
    op: 'create',
    title,
    type: $('entry-type').value,
    priority: Number($('entry-priority').value),
    parent: $('entry-parent').value || undefined,
  })
  if (ok) closeEntry()
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('entry').hidden) return closeEntry()
    if (editing != null) return
    if (task) return closeTask()
    if (view === 'read') return show('docs')
  }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey && $('entry').hidden && !typing) {
    e.preventDefault()
    $('new-task').click()
  }
})

await loadProjects()
await load()
// A refresh on a large workspace can take a minute; polling a hidden tab, or
// stacking a second scan on the first, only ever made it slower. Editing text
// never gets its ground pulled out from under it.
setInterval(() => {
  if (!loading && editing == null && !document.hidden) load().catch(() => {})
}, 10000)
