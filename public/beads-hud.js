import { marked } from '/vendor/marked.esm.js'

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
let taskView = localStorage.getItem('beadshud.taskView') || 'board'
let sort = { key: '', dir: 1 }
let showClosed = localStorage.getItem('beadshud.closed') === '1'
// Search is per-sitting on purpose: a filter that survives the night gives a
// wrong picture of the world in the morning.
let qTasks = ''
let qDocs = ''
let docGroup = localStorage.getItem('beadshud.docGroup') || 'dir'
let data = { docs: [], issues: [], groups: [], loose: [] }
let waiting = false
let doc = null
let sheet = null
let task = null
// Last events board we actually painted, per folder. A 2s tick with the same
// seq has nothing new; repainting the drawer resets its scroll.
let liveSeen = null
let editing = null

/* ── Theme ─────────────────────────────────────────────────────── */
// Liquid glass lives on the light promo wallpaper; dark is the exception
// someone deliberately asks for.
const applyTheme = (t) => {
  if (t === 'dark') document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
  $('theme').title = t === 'dark' ? 'Тема: тёмная' : 'Тема: светлая'
}
applyTheme(localStorage.getItem('beadshud.theme'))
$('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
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

/* ── Task view switcher ────────────────────────────────────────── */

const TASK_VIEWS = ['board', 'table', 'graph']
function setTaskView(v) {
  taskView = v
  localStorage.setItem('beadshud.taskView', v)
  $('task-seg').style.setProperty('--seg-i', TASK_VIEWS.indexOf(v))
  $('tv-board').setAttribute('aria-pressed', String(v === 'board'))
  $('tv-table').setAttribute('aria-pressed', String(v === 'table'))
  $('tv-graph').setAttribute('aria-pressed', String(v === 'graph'))
  $('board').hidden = v !== 'board'
  $('tbl').hidden = v !== 'table'
  $('graphview').hidden = v !== 'graph'
  renderTasks()
}
$('tv-board').onclick = () => setTaskView('board')
$('tv-table').onclick = () => setTaskView('table')
$('tv-graph').onclick = () => setTaskView('graph')

function renderTasks() {
  $('closed-n').textContent = String(data.issues.filter((i) => i.column === 'closed').length)
  if (taskView === 'board') renderBoard()
  else if (taskView === 'table') renderTable()
  else renderGraph()
}

/* ── Closed toggle & search ────────────────────────────────────── */

function setShowClosed(v) {
  showClosed = v
  localStorage.setItem('beadshud.closed', v ? '1' : '0')
  $('show-closed').setAttribute('aria-pressed', String(v))
  renderTasks()
}
$('show-closed').onclick = () => setShowClosed(!showClosed)

$('search-tasks').oninput = () => {
  qTasks = $('search-tasks').value.trim().toLowerCase()
  renderTasks()
}
$('search-docs').oninput = () => {
  qDocs = $('search-docs').value.trim().toLowerCase()
  renderDocs()
}
for (const id of ['search-tasks', 'search-docs']) {
  $(id).onkeydown = (e) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if ($(id).value) {
      $(id).value = ''
      $(id).dispatchEvent(new Event('input'))
    } else $(id).blur()
  }
}

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
    renderTasks()
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

const hit = (i) => (i.title + ' ' + i.id).toLowerCase().includes(qTasks)
const visible = (list) => list.filter((i) => (showClosed || i.column !== 'closed') && (!qTasks || hit(i)))
const emptyMsg = (base) =>
  data.error || (base.length ? (qTasks ? `Ничего не нашлось по «${qTasks}»` : 'Все задачи здесь закрыты.') : 'Здесь пока нет задач.')

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
  const base = selected()
  const items = visible(base)
  if (!items.length) {
    const col = column('Пусто', null, 0)
    col.body.appendChild(el('p', 'col__empty', emptyMsg(base)))
    board.appendChild(col.box)
    return
  }
  for (const c of COLUMNS) {
    if (c.key === 'closed' && !showClosed) continue
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
        : issue.status === 'in_progress' ? 'release'
        : null
      if (!op) return toast('Из этой колонки так не переносят', 'err')
      await act({ op, id: issue.id })
    }
    board.appendChild(col.box)
  }
}

/* ── Table ─────────────────────────────────────────────────────── */

const nameOf = (id) => data.issues.find((x) => x.id === id)?.title || id
const COLNAME = Object.fromEntries(COLUMNS.map((c) => [c.key, c.label]))
const ORDER = { todo: 0, doing: 1, blocked: 2, closed: 3 }
const TCOLS = [
  { key: 'status', label: 'Статус' },
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Задача' },
  { key: 'type', label: 'Тип' },
  { key: 'p', label: 'P' },
  { key: 'epic', label: 'Эпик' },
  { key: 'wait', label: 'Ждёт' },
  { key: 'upd', label: 'Обновлена' },
]
const tval = (i, k) =>
  k === 'status' ? ORDER[i.column]
  : k === 'id' ? i.id
  : k === 'title' ? i.title.toLowerCase()
  : k === 'type' ? i.issue_type
  : k === 'p' ? i.priority
  : k === 'epic' ? (i.parent ? nameOf(i.parent).toLowerCase() : '')
  : k === 'wait' ? i.blockedBy.length
  : i.updated_at || ''

function renderTable() {
  const box = $('tbl')
  box.replaceChildren()
  if (waiting && !data.issues.length) return box.appendChild(el('p', 'tbl__empty', 'считаю задачи…'))
  const base = selected()
  const items = visible(base)
  if (!items.length) return box.appendChild(el('p', 'tbl__empty', emptyMsg(base)))

  const list = [...items].sort((a, b) => {
    if (sort.key) {
      const x = tval(a, sort.key)
      const y = tval(b, sort.key)
      if (x < y) return -sort.dir
      if (x > y) return sort.dir
    }
    return ORDER[a.column] - ORDER[b.column] || a.priority - b.priority || a.id.localeCompare(b.id)
  })

  const table = el('table')
  const hr = el('tr')
  for (const c of TCOLS) {
    const th = el('th', sort.key === c.key ? 'is-sorted' : null)
    const b = el('button')
    b.type = 'button'
    b.appendChild(el('span', null, c.label))
    if (sort.key === c.key) b.appendChild(icon('down', 'ico' + (sort.dir > 0 ? ' ico--asc' : '')))
    b.onclick = () => {
      sort = sort.key !== c.key ? { key: c.key, dir: 1 } : sort.dir > 0 ? { key: c.key, dir: -1 } : { key: '', dir: 1 }
      renderTable()
    }
    th.appendChild(b)
    hr.appendChild(th)
  }
  table.appendChild(el('thead')).appendChild(hr)

  const tb = el('tbody')
  for (const i of list) {
    const tr = el('tr', (i.status === 'closed' ? 'is-closed' : '') + (task === i.id ? ' is-open' : ''))
    const cell = (node) => tr.appendChild(el('td')).appendChild(node)
    const st = el('span', 'tbl__status')
    st.appendChild(el('span', 'light' + (i.column === 'todo' ? '' : ' light--' + i.column)))
    st.appendChild(el('span', null, COLNAME[i.column]))
    cell(st)
    cell(el('span', 'tbl__id', i.id.split('-').pop()))
    cell(el('span', 'tbl__title', i.title))
    cell(el('span', 'tbl__type', i.issue_type))
    cell(el('span', 'tbl__p' + (i.priority === 0 ? ' tbl__p--p0' : ''), 'P' + i.priority))
    cell(el('span', 'tbl__epic', i.parent ? nameOf(i.parent) : '—'))
    if (i.blockedBy.length) {
      const w = el('span', 'tbl__wait')
      w.appendChild(icon('clock'))
      w.appendChild(el('span', null, String(i.blockedBy.length)))
      cell(w)
    } else cell(el('span', 'tbl__date', '—'))
    cell(el('span', 'tbl__date', (i.updated_at || '').slice(0, 10) || '—'))
    tr.tabIndex = 0
    tr.onclick = () => openTask(i.id)
    tr.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openTask(i.id)
      }
    }
    tb.appendChild(tr)
  }
  table.appendChild(tb)
  box.appendChild(table)
}

/* ── Graph ─────────────────────────────────────────────────────── */

const svgEl = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag)

/**
 * The epic tree is the skeleton, blocker arrows ride on top: both relationships
 * from PRODUCT.md on one screen. Tiered layout — a parent sits at the vertical
 * middle of its children, clusters stack; leaves each take one row.
 */
function renderGraph() {
  const box = $('graphview')
  box.replaceChildren()
  if (waiting && !data.issues.length) return box.appendChild(el('p', 'graph__empty', 'считаю задачи…'))
  if (!data.issues.length) return box.appendChild(el('p', 'graph__empty', data.error || 'Здесь пока нет задач.'))

  // The rail speaks here too: an epic opens as its own graph — the epic and
  // every descendant; «Все задачи» keeps the whole-project map. On top of the
  // scope, the closed toggle and the search apply; a match keeps its ancestors
  // so the tree keeps its shape.
  let scope
  if (sel === 'all') scope = data.issues
  else if (sel === 'loose') scope = data.loose
  else if (sel.startsWith('kind:')) scope = data.issues.filter((i) => i.kind === sel.slice(5))
  else {
    const ids = new Set([sel])
    let grew = true
    while (grew) {
      grew = false
      for (const i of data.issues)
        if (i.parent && ids.has(i.parent) && !ids.has(i.id)) {
          ids.add(i.id)
          grew = true
        }
    }
    scope = data.issues.filter((i) => ids.has(i.id))
  }
  let base = scope.filter((i) => showClosed || i.column !== 'closed')
  if (qTasks) {
    const all = new Map(data.issues.map((i) => [i.id, i]))
    const keep = new Set()
    for (const i of base) {
      if (!hit(i)) continue
      for (let c = i; c; c = c.parent ? all.get(c.parent) : null) {
        if (keep.has(c.id)) break
        keep.add(c.id)
      }
    }
    base = base.filter((i) => keep.has(i.id))
  }
  if (!base.length) return box.appendChild(el('p', 'graph__empty', emptyMsg(scope)))

  // ponytail: раскладка на сетке 4px по референсу diagram-design.
  const NW = 260, NH = 72, GX = 96, GY = 12, CLUSTER = 32, PAD = 28
  const byId = new Map(base.map((i) => [i.id, i]))
  const kidsOf = (id) =>
    base.filter((i) => i.parent === id).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const groupIds = new Set(data.groups.map((g) => g.id).filter((id) => byId.has(id)))

  // pos holds pixel coordinates of each node's top-left corner.
  const pos = new Map()
  let cursor = PAD + 8
  let maxDepth = 0
  const place = (i, depth) => {
    maxDepth = Math.max(maxDepth, depth)
    const kids = kidsOf(i.id)
    if (!kids.length) {
      pos.set(i.id, { x: PAD + depth * (NW + GX), y: cursor })
      cursor += NH + GY
      return cursor - GY - NH
    }
    const ys = kids.map((k) => place(k, depth + 1))
    const mid = (ys[0] + ys[ys.length - 1]) / 2
    pos.set(i.id, { x: PAD + depth * (NW + GX), y: mid })
    return mid
  }

  // Roots are the scope's own top nodes: groups whose parent is outside the
  // scope — for an epic selection that is the epic itself.
  for (const g of data.groups.filter((g) => byId.has(g.id) && (!g.parent || !byId.has(g.parent)))) {
    place(byId.get(g.id), 0)
    cursor += CLUSTER
  }
  let W = PAD * 2 + (maxDepth + 1) * NW + maxDepth * GX
  const labels = []
  // The junk drawer flows into a grid of columns: twenty parentless tasks are a
  // field, not a tower under the epics.
  const rest = base.filter((i) => !pos.has(i.id))
  if (rest.length) {
    const cols = Math.max(1, Math.min(3, Math.ceil(rest.length / 8)))
    // A kind slice is just a grid — «Без эпика» would be a false caption there.
    if (sel === 'all' || sel === 'loose') {
      labels.push({ text: 'Без эпика', y: cursor })
      cursor += 28
    }
    rest.forEach((i, n) => {
      pos.set(i.id, { x: PAD + (n % cols) * (NW + 24), y: cursor + Math.floor(n / cols) * (NH + GY) })
    })
    cursor += Math.ceil(rest.length / cols) * (NH + GY)
    W = Math.max(W, PAD * 2 + cols * NW + (cols - 1) * 24)
  }

  const H = cursor + PAD
  const field = el('div', 'graph__field')
  field.style.width = W + 'px'
  field.style.height = H + 'px'

  const svg = svgEl('svg')
  svg.setAttribute('class', 'graph__edges')
  svg.setAttribute('width', W)
  svg.setAttribute('height', H)
  svg.innerHTML =
    '<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M0 0 8 4 0 8Z" style="fill:var(--stop)" stroke="none"/></marker></defs>'

  for (const i of base) {
    if (!i.parent || !pos.has(i.parent) || !pos.has(i.id)) continue
    const a = pos.get(i.parent)
    const b = pos.get(i.id)
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2
    const p = svgEl('path')
    p.setAttribute('d', `M${x1} ${y1}C${x1 + GX / 2} ${y1} ${x2 - GX / 2} ${y2} ${x2} ${y2}`)
    p.setAttribute('class', 'edge')
    svg.appendChild(p)
  }
  // ponytail: backward blocker arrows draw an S through the field; orthogonal
  // routing if a real project makes them unreadable.
  for (const i of base) {
    for (const b of i.blockedBy) {
      if (!pos.has(b) || !pos.has(i.id)) continue
      const s = pos.get(b)
      const t = pos.get(i.id)
      let d
      if (s.x === t.x) {
        const x = s.x, y1 = s.y + NH / 2, y2 = t.y + NH / 2
        const bow = 36 + Math.min(40, Math.abs(y2 - y1) / 8)
        d = `M${x} ${y1}C${x - bow} ${y1} ${x - bow} ${y2} ${x} ${y2}`
      } else {
        const x1 = s.x + NW, y1 = s.y + NH / 2, x2 = t.x, y2 = t.y + NH / 2
        d = `M${x1} ${y1}C${x1 + GX / 2} ${y1} ${x2 - GX / 2} ${y2} ${x2} ${y2}`
      }
      const p = svgEl('path')
      p.setAttribute('d', d)
      p.setAttribute('class', 'edge edge--block')
      p.setAttribute('marker-end', 'url(#arrow)')
      svg.appendChild(p)
    }
  }
  field.appendChild(svg)

  for (const l of labels) {
    const n = el('div', 'graph__label', l.text)
    n.style.left = PAD + 'px'
    n.style.top = l.y + 'px'
    field.appendChild(n)
  }
  for (const [id, p] of pos) {
    const i = byId.get(id)
    if (!i) continue
    const n = el(
      'button',
      'gnode' +
        (groupIds.has(id) ? ' gnode--epic' : '') +
        (i.status === 'closed' ? ' gnode--closed' : '') +
        (task === id ? ' is-open' : ''),
    )
    n.type = 'button'
    n.style.left = p.x + 'px'
    n.style.top = p.y + 'px'
    const row = el('div', 'gnode__row')
    row.appendChild(el('span', 'light' + (i.column === 'todo' ? '' : ' light--' + i.column)))
    row.appendChild(el('span', 'gnode__title', i.title))
    n.appendChild(row)
    const meta = el('div', 'gnode__meta')
    meta.appendChild(el('span', null, i.id.split('-').pop() + ' · P' + i.priority))
    const g = data.groups.find((x) => x.id === id)
    if (g) meta.appendChild(el('span', null, `${g.doneCount}/${g.childCount}`))
    if (i.blockedBy.length) meta.appendChild(el('span', 'gnode__wait', 'ждёт ' + i.blockedBy.length))
    n.appendChild(meta)
    n.title = i.title
    n.onclick = () => openTask(id)
    field.appendChild(n)
  }

  const legend = el('div', 'graph__legend')
  const key = (sample, text) => {
    const k = el('span', 'graph__key')
    k.innerHTML = sample
    k.appendChild(el('span', null, text))
    return k
  }
  legend.appendChild(
    key('<svg viewBox="0 0 22 8" aria-hidden="true"><path d="M1 4h20" style="stroke:var(--hairline-strong)" stroke-width="1.5" fill="none"/></svg>', 'эпик → дети'),
  )
  legend.appendChild(
    key('<svg viewBox="0 0 22 8" aria-hidden="true"><path d="M1 4h15" style="stroke:var(--stop)" stroke-width="1.5" fill="none"/><path d="M15 1l6 3-6 3z" style="fill:var(--stop)"/></svg>', 'блокирует'),
  )
  box.appendChild(legend)
  box.appendChild(field)
}

/* ── Documents ─────────────────────────────────────────────────── */

const setGroup = (g) => {
  docGroup = g
  localStorage.setItem('beadshud.docGroup', g)
  $('by-dir').setAttribute('aria-pressed', String(g === 'dir'))
  $('by-epic').setAttribute('aria-pressed', String(g === 'epic'))
  $('docs-seg').style.setProperty('--seg-i', g === 'dir' ? 0 : 1)
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
  const docs = qDocs
    ? data.docs.filter((d) => (d.title + ' ' + d.path).toLowerCase().includes(qDocs))
    : data.docs
  if (!docs.length) {
    const col = column('Пусто', null, 0)
    col.body.appendChild(
      el('p', 'col__empty', data.docs.length ? `Ничего не нашлось по «${qDocs}»` : 'В этом проекте нет .md файлов'),
    )
    board.appendChild(col.box)
    return
  }

  const groups = new Map()
  const put = (key, name, d) => {
    if (!groups.has(key)) groups.set(key, { name, docs: [] })
    groups.get(key).docs.push(d)
  }
  if (docGroup === 'dir') {
    for (const d of docs) put(d.dir, d.dir || 'корень проекта', d)
  } else {
    const titleOf = (id) => data.issues.find((i) => i.id === id)?.title || id
    for (const d of docs) {
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
      // A link click follows the link, a summary click toggles the frontmatter,
      // and a drag that left a selection is copying, not editing.
      if (e.target.closest('a') || e.target.closest('summary')) return
      if (!window.getSelection().isCollapsed) return
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

function openTask(id, opts) {
  const i = data.issues.find((x) => x.id === id)
  if (!i) return
  task = id
  $('task').hidden = false
  $('task-id').textContent = i.id
  const body = $('task-body')
  // A live tick rebuilds this node. Keeping the offset is what leaves a long
  // description scrollable while events are flowing.
  const keep = opts && opts.keepScroll ? body.scrollTop : 0
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
    const md = el('div', 'task__md')
    md.innerHTML = marked.parse(text)
    body.appendChild(md)
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
  $('task-move').hidden = i.status !== 'open'
  $('task-release').hidden = i.status !== 'in_progress'
  $('task-shut').textContent = closed ? 'Открыть заново' : 'Закрыть'
  body.scrollTop = keep
  if (view === 'board') renderTasks()
}

function closeTask() {
  if (!task) return
  task = null
  $('task').hidden = true
  if (view === 'board') renderTasks()
}

$('task-x').onclick = closeTask
$('task-move').onclick = () => act({ op: 'claim', id: task })
$('task-release').onclick = () => act({ op: 'release', id: task })
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
    // bd подтвердил запись; полный перескан большого проекта занимает десятки
    // секунд, поэтому карточка переезжает сразу, а скан догоняет фоном.
    const i = payload.id && data.issues.find((x) => x.id === payload.id)
    if (i) {
      if (payload.op === 'close') {
        i.status = 'closed'
        i.column = 'closed'
      } else if (payload.op === 'claim') {
        i.status = 'in_progress'
        i.column = 'doing'
      } else if (payload.op === 'reopen' || payload.op === 'release') {
        i.status = 'open'
        i.column = i.blockedBy.length ? 'blocked' : 'todo'
      }
      renderKinds()
      renderTasks()
      if (task === i.id) openTask(i.id)
      if (!loading) load().catch(() => {})
    } else await load()
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

/** The picture's age, always on screen: the stamp is the REAL bd scan time the
    server recorded, so a disk-cached morning answer says yesterday's date. */
let freshAt = ''
const fmtWhen = (t) => {
  const d = new Date(t)
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? hm
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + hm
}
function setFresh(state, scannedAt) {
  if (scannedAt) freshAt = fmtWhen(scannedAt)
  const stamp = freshAt ? 'обновлено ' + freshAt : ''
  $('fresh').textContent = state === 'loading' ? (stamp ? stamp + ' · обновляю…' : 'обновляю…') : stamp
}
$('refresh').onclick = () => {
  if (!loading) load().catch(() => {})
}

let loading = false
async function load(opts) {
  const wantDocs = !opts || opts.docs !== false
  const wantBoard = !opts || opts.board !== false
  // A 2s events tick is a memory read. Flashing «обновляю…» and re-walking
  // every .md on that tick would make the live board busier than the old poll.
  const quiet = wantBoard && !wantDocs
  const want = root
  loading = true
  if (!quiet) {
    setFresh('loading')
    // The documents land in a moment; bd can take a minute on a big workspace. The
    // board says so rather than showing the previous folder's tasks as if they were
    // this one's.
    waiting = true
    renderKinds()
    renderTasks()
  }

  const get = (part) =>
    fetch(`/api/${part}?root=${encodeURIComponent(want)}`)
      .then((r) => r.json())
      // A slow scan can land after the picker already moved on; that answer
      // belongs to a folder nobody is looking at any more.
      .then((d) => (want === root ? d : null))

  const jobs = []
  if (wantDocs) {
    jobs.push(get('docs').then((d) => {
      if (!d) return
      // Служебные поля кэша принадлежат board-ответу: docs-овские scanMs/scannedAt
      // затёрли бы цену настоящего скана и сломали бы адаптивный опрос.
      const { scanMs, scannedAt, stale, ...docsData } = d
      data = { ...data, ...docsData }
      // Tasks come from the nearest .beads upwards, which may not be this folder.
      $('crumb').textContent = data.workspace ? `задачи из ${data.workspace}` : ''
      linkDocs()
      if (view === 'docs') renderDocs()
    }))
  }

  if (wantBoard) {
    jobs.push(get('board').then((b) => {
      if (!b) return
      // Same events cursor we already painted for this folder: the board did
      // not change. Rebuilding the drawer here throws scrollTop back to 0.
      if (b.live === 'events' && liveSeen && liveSeen.root === want && liveSeen.seq === b.seq) {
        waiting = false
        setFresh(b.stale ? 'loading' : 'done', b.scannedAt)
        return
      }
      const prev = task && data.issues.find((i) => i.id === task)
      const prevJson = prev ? JSON.stringify(prev) : null
      const liveUpdate = b.live === 'events' && prevJson != null
      data = { ...data, ...b }
      waiting = false
      if (sel !== 'all' && sel !== 'loose' && !sel.startsWith('kind:') && !data.groups.some((g) => g.id === sel))
        sel = 'all'
      linkDocs()
      renderKinds()
      renderTasks()
      if (view === 'docs') renderDocs()
      if (task) {
        const next = data.issues.find((i) => i.id === task)
        if (!next) closeTask()
        else if (!liveUpdate || JSON.stringify(next) !== prevJson) openTask(task, liveUpdate ? { keepScroll: true } : undefined)
      }
      if (b.live === 'events') liveSeen = { root: want, seq: b.seq }
      else liveSeen = null
      // A cached answer served mid-rescan keeps saying «обновляю…» until a fresh
      // one lands; short retries catch it without waiting for the slow poll.
      setFresh(b.stale ? 'loading' : 'done', b.scannedAt)
      if (b.stale)
        setTimeout(() => {
          if (!loading && editing == null && !document.hidden && want === root) load().catch(() => {})
        }, 3000)
    }))
  }
  try {
    await Promise.all(jobs)
  } finally {
    loading = false
    if (want === root && !quiet) waiting = false
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
  if ((e.key === '/' || e.key === 'f') && !e.metaKey && !e.ctrlKey && !typing && $('entry').hidden) {
    const inp = view === 'board' ? $('search-tasks') : view === 'docs' ? $('search-docs') : null
    if (inp) {
      e.preventDefault()
      inp.focus()
    }
  }
})

document.addEventListener('visibilitychange', () => {
  // Coming back from the terminal is exactly when the picture is oldest.
  if (!document.hidden && !loading && editing == null) load().catch(() => {})
})

setShowClosed(showClosed)
setTaskView(taskView)
setGroup(docGroup)
await loadProjects()
await load()
// A refresh on a large workspace can take a minute; polling a hidden tab, or
// stacking a second scan on the first, only ever made it slower. Editing text
// never gets its ground pulled out from under it. A scan slower than three
// seconds drops the routine poll to once a minute — the refresh button and the
// return to the tab stay instant, so freshness rides on those instead.
// Once the server is mirroring `bd events`, /api/board is a memory read and
// the board can ask every two seconds. Documents stay on the slow cadence:
// walking the tree that often would cost more than the board update saves.
let polledAt = Date.now()
let docsPolledAt = Date.now()
setInterval(() => {
  if (loading || editing != null || document.hidden) return
  const now = Date.now()
  const slow = (data.scanMs || 0) > 3000
  const events = data.live === 'events'
  if (!events) {
    const every = slow ? 60000 : 10000
    if (now - polledAt < every) return
    polledAt = now
    docsPolledAt = now
    load().catch(() => {})
    return
  }
  const wantBoard = now - polledAt >= 2000
  const wantDocs = now - docsPolledAt >= (slow ? 60000 : 10000)
  if (!wantBoard && !wantDocs) return
  if (wantBoard) polledAt = now
  if (wantDocs) docsPolledAt = now
  load({ board: wantBoard, docs: wantDocs }).catch(() => {})
}, 1000)
