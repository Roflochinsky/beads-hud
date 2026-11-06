(() => {
  "use strict";

  const D = window.BEADS_DEMO;
  const ME = Object.values(D.people).find((p) => p.me);
  const STALE_AFTER = 30 * 60 * 1000;
  const CLOSED_PREVIEW = 5;
  const CLOSED_WINDOW = 7 * 24 * 60 * 60 * 1000;

  const TYPES = {
    task: { icon: "task_alt", label: "Task" },
    bug: { icon: "bug_report", label: "Bug" },
    feature: { icon: "lightbulb", label: "Feature" },
    chore: { icon: "handyman", label: "Chore" },
    epic: { icon: "stacks", label: "Epic" },
    decision: { icon: "gavel", label: "Decision" },
    spike: { icon: "science", label: "Spike" },
    story: { icon: "auto_stories", label: "Story" },
    milestone: { icon: "flag", label: "Milestone" },
  };
  const PRIORITY_NAMES = ["Critical", "High", "Medium", "Low", "Backlog"];

  const COLUMNS = [
    { id: "ready", title: "Ready", glyph: '<span class="glyph"><span class="bead" aria-hidden="true"></span></span>',
      help: "Open issues with no open blockers. The same list bd ready returns, highest priority first." },
    { id: "progress", title: "In progress", glyph: '<span class="glyph"><span class="bead bead--active" aria-hidden="true"></span></span>',
      help: "Claimed issues. Agents hold a lease and send heartbeats; a lease with no heartbeat for 30 minutes is stale." },
    { id: "blocked", title: "Blocked", glyph: '<span class="glyph"><svg class="icon" aria-hidden="true"><use href="#i-lock"></use></svg></span>',
      help: "Open issues waiting on at least one open blocker, or marked blocked by hand." },
    { id: "closed", title: "Closed", glyph: '<span class="glyph"><span class="bead bead--done" aria-hidden="true"></span></span>',
      help: "Closed in the last 7 days, newest first. Older issues stay in bd." },
    { id: "deferred", title: "Deferred", glyph: '<span class="glyph"><svg class="icon" aria-hidden="true"><use href="#i-snooze"></use></svg></span>',
      help: "Hidden from Ready until their defer date." },
  ];

  // ---------- state ----------
  const LAYOUT_KEY = "beads-board.layout";
  function loadLayout() {
    try { return localStorage.getItem(LAYOUT_KEY) === "table" ? "table" : "board"; } catch { return "board"; }
  }
  const state = {
    issues: structuredClone(D.issues),
    activity: structuredClone(D.activity),
    filters: { q: "", types: new Set(), priorities: new Set(), assignees: new Set(), labels: new Set(), epic: null },
    view: "all",
    density: "comfortable",
    showClosed: true,
    spotlightOn: true,
    closedExpanded: false,
    deferredOpen: false,
    selected: null,
    drawerTab: "details",
    mode: "board",
    lastSync: Date.now() - 2 * 60 * 1000,
    drag: null,
    quickAdd: false,
    quickDraft: "",
    layout: loadLayout(),
    sort: { key: "status", dir: "asc" },
  };

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (name, extra = "") => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

  const byId = (id) => state.issues.find((i) => i.id === id);
  const epicOf = (issue) => D.epics.find((e) => e.id === issue.epic);
  const person = (id) => D.people[id];
  const openBlockers = (issue) => issue.deps.map(byId).filter((d) => d && d.status !== "closed");
  const dependents = (issue) => state.issues.filter((i) => i.deps.includes(issue.id));
  // a card on the board or a row in the table: both open the drawer and take part in the chain spotlight
  const ITEM = ".issue-card[data-id], .data-table__row[data-id]";
  const itemEl = (id) => $(`#board .issue-card[data-id="${id}"], #board .data-table__row[data-id="${id}"]`);
  const itemMod = (el, mod) => `${el.matches(".data-table__row") ? "data-table__row" : "issue-card"}--${mod}`;
  function flash(el) {
    const c = itemMod(el, "unblocked");
    el.classList.remove(c);
    void el.offsetWidth;
    el.classList.add(c);
  }
  const isStale = (issue) => issue.status === "in_progress" && issue.heartbeat && Date.now() - issue.heartbeat > STALE_AFTER;

  function columnOf(issue) {
    if (issue.status === "closed") return "closed";
    if (issue.status === "deferred") return "deferred";
    if (issue.status === "blocked" || openBlockers(issue).length) return "blocked";
    if (issue.status === "in_progress") return "progress";
    return "ready";
  }

  function rel(ts) {
    const diff = Date.now() - ts;
    const future = diff < 0;
    const a = Math.abs(diff);
    const m = Math.round(a / 60000);
    let s;
    if (m < 1) return "just now";
    if (m < 60) s = `${m}m`;
    else if (m < 60 * 24) s = `${Math.round(m / 60)}h`;
    else s = `${Math.round(m / 1440)}d`;
    return future ? `in ${s}` : `${s} ago`;
  }
  const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const fmtEstimate = (min) => (min >= 60 ? `${+(min / 60).toFixed(1)}h` : `${min}m`);
  const shellQuote = (s) => `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`;

  function dependsOn(fromId, targetId, seen = new Set()) {
    if (fromId === targetId) return true;
    if (seen.has(fromId)) return false;
    seen.add(fromId);
    const issue = byId(fromId);
    return !!issue && issue.deps.some((d) => dependsOn(d, targetId, seen));
  }

  function newId() {
    let id;
    do id = `${D.prefix}-${Math.random().toString(16).slice(2, 6)}`;
    while (byId(id));
    return id;
  }

  // ---------- filtering ----------
  function matches(issue) {
    const f = state.filters;
    if (issue.type === "epic" && !f.types.has("epic")) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      const hay = `${issue.id} ${issue.title} ${issue.labels.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.types.size && !f.types.has(issue.type)) return false;
    if (f.priorities.size && !f.priorities.has(issue.priority)) return false;
    if (f.assignees.size && !f.assignees.has(issue.assignee || "none")) return false;
    if (f.labels.size && !issue.labels.some((l) => f.labels.has(l))) return false;
    if (f.epic && issue.epic !== f.epic) return false;
    if (state.view === "mine" && issue.assignee !== ME.id) return false;
    if (state.view === "agents" && person(issue.assignee)?.kind !== "agent") return false;
    if (state.view === "stale" && !isStale(issue)) return false;
    return true;
  }
  const filtersActive = () => {
    const f = state.filters;
    return !!(f.q || f.types.size || f.priorities.size || f.assignees.size || f.labels.size || f.epic || state.view !== "all");
  };

  function sortFor(col) {
    if (col === "closed") return (a, b) => (b.closed || 0) - (a.closed || 0);
    if (col === "deferred") return (a, b) => (a.deferUntil || 0) - (b.deferUntil || 0);
    if (col === "progress") return (a, b) => a.priority - b.priority || (b.updated || 0) - (a.updated || 0);
    return (a, b) => a.priority - b.priority || (a.created || 0) - (b.created || 0);
  }

  // ---------- rendering: card ----------
  function avatar(pid, size = "") {
    const p = person(pid);
    if (!p) return `<span class="avatar avatar--empty ${size}" title="Unassigned">${icon("person")}</span>`;
    if (p.kind === "agent") return `<span class="avatar avatar--agent ${size}" title="${esc(p.name)} (agent)"><svg class="icon" aria-hidden="true"><use href="#a-${p.brand}"></use></svg></span>`;
    return `<span class="avatar ${size}" title="${esc(p.name)}">${esc(p.initials)}</span>`;
  }

  function cardHTML(issue) {
    const col = columnOf(issue);
    const type = TYPES[issue.type] || TYPES.task;
    const epic = epicOf(issue);
    const deps = issue.deps.map(byId).filter(Boolean);
    const blockers = openBlockers(issue);
    const deps_out = dependents(issue).filter((d) => d.status !== "closed");
    const who = person(issue.assignee);
    const classes = ["issue-card"];
    if (col === "closed") classes.push("issue-card--closed");
    if (state.density === "compact") classes.push("issue-card--compact");
    if (state.selected === issue.id) classes.push("issue-card--selected");

    let strip = "";
    if (col === "blocked") {
      const beads = deps.map((d) => `<span class="bead ${d.status === "closed" ? "bead--done" : d.status === "in_progress" ? "bead--active" : ""}"></span>`).join("");
      const named = blockers.slice(0, 2).map((b) => `<span class="mono">${b.id}</span>`).join(", ");
      const text = blockers.length
        ? `Waiting on ${named}${blockers.length > 2 ? ` +${blockers.length - 2}` : ""}`
        : "Marked blocked";
      strip = `<div class="issue-card__blockers">${icon("lock")}<span class="issue-card__beads" aria-hidden="true">${beads}</span><span class="issue-card__blockers-text">${text}</span></div>`;
    }
    if (isStale(issue)) {
      strip = `<div class="issue-card__lease">${icon("hourglass_disabled")}<span class="issue-card__lease-text">No heartbeat for ${rel(issue.heartbeat).replace(" ago", "")}</span><button class="btn btn--text btn--sm" type="button" data-action="reclaim" data-id="${issue.id}">Reclaim</button></div>`;
    }

    const labels = issue.labels.slice(0, 2).map((l) => `<span class="chip chip--label">${esc(l)}</span>`).join("")
      + (issue.labels.length > 2 ? `<span class="chip chip--label">+${issue.labels.length - 2}</span>` : "");

    const stats = [];
    if (col === "closed") stats.push(`<span class="issue-card__stat">Closed ${rel(issue.closed)}</span>`);
    else if (col === "deferred") stats.push(`<span class="issue-card__stat">${icon("event")}Until ${fmtDate(issue.deferUntil)}</span>`);
    else {
      if (deps_out.length) stats.push(`<span class="issue-card__stat" data-tooltip="Blocks ${deps_out.length} open issue${deps_out.length > 1 ? "s" : ""}">${icon("account_tree")}${deps_out.length}</span>`);
      if (issue.comments) stats.push(`<span class="issue-card__stat" data-tooltip="${issue.comments} comment${issue.comments > 1 ? "s" : ""}">${icon("chat_bubble")}${issue.comments}</span>`);
      if (issue.estimate) stats.push(`<span class="issue-card__stat" data-tooltip="Estimate">${icon("schedule")}${fmtEstimate(issue.estimate)}</span>`);
      if (col === "progress" && issue.heartbeat && !isStale(issue)) stats.push(`<span class="issue-card__stat" data-tooltip="Last heartbeat">${icon("ecg_heart")}${rel(issue.heartbeat).replace(" ago", "")}</span>`);
    }
    const assignee = issue.assignee
      ? `<span class="issue-card__assignee">${col === "progress" ? `<span class="issue-card__assignee-name">${esc(who?.name)}</span>` : ""}${avatar(issue.assignee)}</span>`
      : "";

    const colTitle = COLUMNS.find((c) => c.id === col).title;
    const describe = [
      `${issue.id}, P${issue.priority} ${PRIORITY_NAMES[issue.priority].toLowerCase()} ${type.label.toLowerCase()}, ${colTitle}.`,
      blockers.length ? `Waiting on ${blockers.map((b) => b.id).join(", ")}.` : "",
      deps_out.length ? `Blocks ${deps_out.length} open issue${deps_out.length > 1 ? "s" : ""}.` : "",
      isStale(issue) ? "Lease is stale." : "",
      who ? `Assigned to ${who.name}.` : "Unassigned.",
      issue.comments ? `${issue.comments} comments.` : "",
    ].filter(Boolean).join(" ");
    return `<article class="${classes.join(" ")}" tabindex="0" draggable="true" data-id="${issue.id}" data-col="${col}"
        aria-labelledby="t-${issue.id}" aria-describedby="d-${issue.id}">
      <span class="visually-hidden" id="d-${issue.id}">${esc(describe)}</span>
      <span class="issue-card__relation"></span>
      <div class="issue-card__top">
        <svg class="icon issue-card__type" aria-hidden="true" data-tooltip="${type.label}"><use href="#i-${type.icon}"></use></svg>
        <span class="issue-card__id mono">${issue.id}</span>
        <span class="issue-card__spacer"></span>
        <span class="chip chip--priority chip--p${issue.priority}" data-tooltip="P${issue.priority} · ${PRIORITY_NAMES[issue.priority]}">P${issue.priority}</span>
        <button class="btn btn--icon btn--sm issue-card__menu" type="button" data-action="issue-menu" data-id="${issue.id}" aria-label="Actions for ${issue.id}" aria-haspopup="menu">${icon("more_horiz")}</button>
      </div>
      <h3 class="issue-card__title" id="t-${issue.id}" ${issue.title.length > 90 ? `data-tooltip="${esc(issue.title)}"` : ""}>${esc(issue.title)}</h3>
      ${epic ? `<div class="issue-card__epic">${icon("stacks")}<span class="issue-card__epic-name">${esc(epic.title)}</span></div>` : ""}
      ${strip}
      ${labels && col !== "closed" ? `<div class="issue-card__labels">${labels}</div>` : ""}
      ${stats.length || assignee ? `<div class="issue-card__footer">${stats.join("")}${assignee}</div>` : ""}
    </article>`;
  }

  // ---------- rendering: columns ----------
  function columnEmpty(colId, counts) {
    if (!state.issues.length && colId === "ready") {
      return `<div class="column__empty"><span class="column__empty-title">No issues yet</span><span>Start with the first piece of work. It lands here when nothing blocks it.</span>
        <span class="column__empty-actions"><button class="btn btn--primary btn--sm" type="button" data-action="new">${icon("add", "btn__icon")}New issue</button></span></div>`;
    }
    const filtered = filtersActive();
    if (filtered) return `<div class="column__empty"><span class="column__empty-title">No matches here</span><span>Filters hide everything in this column.</span></div>`;
    const copy = {
      ready: counts.blocked
        ? ["Nothing is ready", `Every open issue waits on another one. ${counts.blocked} in Blocked.`]
        : ["Nothing is ready", "Create an issue, or drop a closed one here to reopen it."],
      progress: ["Nothing in progress", "Drag a ready issue here to claim it."],
      blocked: ["Nothing is blocked", "Drop an issue here to say what it waits on."],
      closed: ["Nothing closed this week", "Drag an issue here when the work is done."],
      deferred: ["Nothing deferred", "Deferred issues come back to Ready on their date."],
    }[colId];
    return `<div class="column__empty"><span class="column__empty-title">${copy[0]}</span><span>${copy[1]}</span></div>`;
  }

  function columnHTML(col, list, counts) {
    if (col.id === "deferred" && !state.deferredOpen) {
      const next = list[0]?.deferUntil;
      const tipText = next ? `${list.length} deferred. Next one returns ${fmtDate(next)}.` : col.help;
      return `<button class="column column--collapsed" type="button" data-col="deferred" data-action="toggle-deferred" aria-label="Show Deferred, ${list.length} issues${next ? `, next returns ${fmtDate(next)}` : ""}" data-tooltip="${esc(tipText)}">
        <div class="column__header">${col.glyph}<span class="column__count">${list.length}</span><span class="column__title">${col.title}</span></div>
      </button>`;
    }
    let shown = list;
    let more = "";
    if (col.id === "closed" && !state.closedExpanded && list.length > CLOSED_PREVIEW) {
      shown = list.slice(0, CLOSED_PREVIEW);
      more = `<button class="btn btn--text btn--sm column__more" type="button" data-action="expand-closed">Show ${list.length - CLOSED_PREVIEW} more</button>`;
    }
    const body = shown.length ? shown.map(cardHTML).join("") : columnEmpty(col.id, counts);
    let footer = "";
    if (col.id === "ready") {
      footer = state.quickAdd
        ? `<div class="quick-add">
            <label class="visually-hidden" for="quick-add-input">New issue title</label>
            <textarea class="quick-add__input" id="quick-add-input" rows="2" placeholder="What needs doing?" maxlength="300">${esc(state.quickDraft)}</textarea>
            <div class="quick-add__row"><span>Enter to add as P2 task · Shift+Enter for details</span>
              <button class="btn btn--text btn--sm" type="button" data-action="quick-cancel">Cancel</button>
              <button class="btn btn--primary btn--sm" type="button" data-action="quick-submit">Add</button></div>
          </div>`
        : `<button class="btn btn--text btn--sm btn--block" type="button" data-action="quick-open">${icon("add", "btn__icon")}Add issue</button>`;
    }
    if (col.id === "closed") footer = more;
    if (col.id === "deferred") footer = `<button class="btn btn--text btn--sm btn--block" type="button" data-action="toggle-deferred">${icon("chevron_right", "btn__icon")}Collapse</button>`;
    return `<section class="column" data-col="${col.id}" aria-labelledby="col-${col.id}">
      <header class="column__header">
        ${col.glyph}
        <h2 class="column__title" id="col-${col.id}">${col.title}</h2>
        <span class="column__count">${list.length}</span>
        <span class="column__spacer"></span>
        <button class="btn btn--icon column__help" type="button" data-tooltip="${esc(col.help)}" aria-label="About ${col.title}">${icon("help")}</button>
      </header>
      <div class="column__drop-hint" aria-hidden="true"></div>
      <div class="column__body">${body}</div>
      ${footer ? `<div class="column__footer">${footer}</div>` : ""}
    </section>`;
  }

  // ---------- rendering: table ----------
  const STATUS_ORDER = { ready: 0, progress: 1, blocked: 2, deferred: 3, closed: 4 };
  const TABLE_COLS = [
    { key: "status", label: "Status", sort: true },
    { key: "id", label: "ID", sort: true },
    { key: "title", label: "Title", sort: true },
    { key: "priority", label: "Priority", sort: true },
    { key: "blockers", label: "Blocked by" },
    { key: "assignee", label: "Assignee", sort: true },
    { key: "type", label: "Type", sort: true },
    { key: "epic", label: "Epic", sort: true },
    { key: "labels", label: "Labels" },
    { key: "updated", label: "Updated", sort: true },
  ];
  const byText = (a, b) => a.localeCompare(b, "en", { sensitivity: "base" });
  const LAST = "\uffff";
  const SORTERS = {
    status: (a, b) => STATUS_ORDER[columnOf(a)] - STATUS_ORDER[columnOf(b)],
    id: (a, b) => byText(a.id, b.id),
    title: (a, b) => byText(a.title, b.title),
    priority: (a, b) => a.priority - b.priority,
    type: (a, b) => byText((TYPES[a.type] || TYPES.task).label, (TYPES[b.type] || TYPES.task).label),
    assignee: (a, b) => byText(person(a.assignee)?.name || LAST, person(b.assignee)?.name || LAST),
    epic: (a, b) => byText(epicOf(a)?.title || LAST, epicOf(b)?.title || LAST),
    updated: (a, b) => a.updated - b.updated,
  };
  function sortRows(list) {
    const { key, dir } = state.sort;
    const sign = dir === "asc" ? 1 : -1;
    return list.sort((a, b) => SORTERS[key](a, b) * sign || a.priority - b.priority || a.created - b.created);
  }

  const statusGlyph = (col) => COLUMNS.find((c) => c.id === col).glyph;

  function headHTML() {
    const ths = TABLE_COLS.map((c) => {
      const sorted = state.sort.key === c.key;
      const aria = sorted ? ` aria-sort="${state.sort.dir === "asc" ? "ascending" : "descending"}"` : "";
      const inner = c.sort
        ? `<button class="data-table__sort" type="button" data-action="sort" data-key="${c.key}">${c.label}${icon(sorted && state.sort.dir === "desc" ? "arrow_downward" : "arrow_upward")}</button>`
        : c.label;
      return `<th class="data-table__th data-table__th--${c.key}" scope="col"${aria}>${inner}</th>`;
    }).join("");
    return `<thead class="data-table__head"><tr>${ths}<th class="data-table__th data-table__th--menu" scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>`;
  }

  function rowHTML(issue) {
    const col = columnOf(issue);
    const type = TYPES[issue.type] || TYPES.task;
    const epic = epicOf(issue);
    const blockers = openBlockers(issue);
    const who = person(issue.assignee);
    const classes = ["data-table__row"];
    if (col === "closed") classes.push("data-table__row--closed");
    if (state.selected === issue.id) classes.push("data-table__row--selected");
    const cell = (key, html) => `<td class="data-table__cell data-table__cell--${key}">${html}</td>`;
    const none = '<span class="visually-hidden">None</span>';
    const stale = isStale(issue);
    const named = blockers.slice(0, 2).map((b) => `<span class="mono">${b.id}</span>`).join(", ") + (blockers.length > 2 ? ` +${blockers.length - 2}` : "");
    const labels = issue.labels.slice(0, 2).map((l) => `<span class="chip chip--label">${esc(l)}</span>`).join("")
      + (issue.labels.length > 2 ? `<span class="chip chip--label">+${issue.labels.length - 2}</span>` : "");
    return `<tr class="${classes.join(" ")}" tabindex="-1" data-id="${issue.id}" data-col="${col}" ${state.selected === issue.id ? 'aria-current="true"' : ""}>
      ${cell("status", `<span class="data-table__status">${statusGlyph(col)}<span>${COLUMNS.find((c) => c.id === col).title}</span>${stale ? `<button class="btn btn--text btn--sm data-table__reclaim" type="button" data-action="reclaim" data-id="${issue.id}" data-tooltip="No heartbeat for ${rel(issue.heartbeat).replace(" ago", "")}">Reclaim</button>` : ""}</span>`)}
      ${cell("id", `<span class="mono">${issue.id}</span>`)}
      ${cell("title", `<div class="data-table__title-wrap"><span class="data-table__title" ${issue.title.length > 90 ? `data-tooltip="${esc(issue.title)}"` : ""}>${esc(issue.title)}</span><span class="data-table__relation"></span></div>`)}
      ${cell("priority", `<span class="chip chip--priority chip--p${issue.priority}" data-tooltip="P${issue.priority} · ${PRIORITY_NAMES[issue.priority]}">P${issue.priority}</span>`)}
      ${cell("blockers", blockers.length ? `<span class="data-table__blockers">${icon("lock", "icon--sm")}<span>${named}</span></span>` : none)}
      ${cell("assignee", who ? `<span class="data-table__person">${avatar(issue.assignee)}<span class="data-table__person-name">${esc(who.name)}</span></span>` : `<span class="data-table__person">${avatar(null)}<span class="data-table__person-name data-table__muted">Unassigned</span></span>`)}
      ${cell("type", `<span class="data-table__type">${icon(type.icon, "icon--sm")}${type.label}</span>`)}
      ${cell("epic", epic ? `<span class="data-table__epic">${esc(epic.title)}</span>` : none)}
      ${cell("labels", labels || none)}
      ${cell("updated", `<span class="data-table__muted">${rel(issue.updated)}</span>`)}
      <td class="data-table__cell data-table__cell--menu"><button class="btn btn--icon btn--sm data-table__menu" type="button" data-action="issue-menu" data-id="${issue.id}" aria-label="Actions for ${issue.id}" aria-haspopup="menu">${icon("more_horiz")}</button></td>
    </tr>`;
  }

  function tableViewHTML(rows, total) {
    const sortLabel = TABLE_COLS.find((c) => c.key === state.sort.key).label.toLowerCase();
    const count = filtersActive() || !state.showClosed ? `${rows.length} of ${total} issues` : `${rows.length} issue${rows.length === 1 ? "" : "s"}`;
    return `<section class="table-view" aria-label="Issues table">
      <div class="table-view__scroll">
        <table class="data-table ${state.density === "compact" ? "data-table--compact" : ""}">
          <caption class="visually-hidden">Issues. Use the column headers to sort.</caption>
          ${headHTML()}
          <tbody>${rows.map(rowHTML).join("")}</tbody>
        </table>
      </div>
      <footer class="table-view__footer">
        <span class="table-view__count">${count}</span>
        <span class="table-view__sort">Sorted by ${sortLabel}, ${state.sort.dir === "asc" ? "ascending" : "descending"}</span>
        <button class="btn btn--text btn--sm" type="button" data-action="new">${icon("add", "btn__icon")}Add issue</button>
      </footer>
    </section>`;
  }

  function tableSkeleton() {
    const rows = [92, 70, 84, 60, 78, 66].map((w) => `<tr aria-hidden="true">
      <td class="data-table__cell data-table__cell--status"><span class="skeleton" style="width:72px;height:14px"></span></td>
      <td class="data-table__cell data-table__cell--id"><span class="skeleton" style="width:56px;height:12px"></span></td>
      <td class="data-table__cell data-table__cell--title"><span class="skeleton" style="width:${w}%;height:14px"></span></td>
      <td class="data-table__cell data-table__cell--priority"><span class="skeleton" style="width:28px;height:20px"></span></td>
      <td class="data-table__cell data-table__cell--assignee"><span class="skeleton" style="width:24px;height:24px;border-radius:50%"></span></td>
      <td class="data-table__cell data-table__cell--menu"></td></tr>`).join("");
    return `<section class="table-view" aria-label="Issues table" aria-busy="true"><div class="table-view__scroll"><table class="data-table"><caption class="visually-hidden">Loading issues</caption>${headHTML()}<tbody>${rows}</tbody></table></div></section>`;
  }

  function rovingRows() {
    const rows = $$("#board .data-table__row[data-id]");
    const active = rows.find((r) => r.dataset.id === state.selected) || rows[0];
    rows.forEach((r) => (r.tabIndex = r === active ? 0 : -1));
  }

  function skeletonColumns() {
    const card = (w) => `<div class="issue-card issue-card--skeleton" aria-hidden="true">
      <div class="issue-card__top"><span class="skeleton" style="width:56px;height:12px"></span><span class="issue-card__spacer"></span><span class="skeleton" style="width:28px;height:20px"></span></div>
      <span class="skeleton" style="width:${w}%;height:14px"></span><span class="skeleton" style="width:${w - 30}%;height:14px"></span>
      <div class="issue-card__footer"><span class="skeleton" style="width:40px;height:12px"></span><span class="issue-card__assignee"><span class="skeleton" style="width:24px;height:24px;border-radius:50%"></span></span></div></div>`;
    return COLUMNS.filter((c) => c.id !== "deferred").map((c, i) => `<section class="column" aria-busy="true">
      <header class="column__header">${c.glyph}<h2 class="column__title">${c.title}</h2><span class="column__count"><span class="skeleton" style="width:16px;height:12px;display:inline-block"></span></span></header>
      <div class="column__body">${[92, 78, 86].slice(0, 3 - (i % 2)).map(card).join("")}</div></section>`).join("");
  }

  function renderBoard() {
    const board = $("#board");
    const tableLayout = state.layout === "table";
    board.classList.toggle("board--state", state.mode === "nodb");
    board.classList.toggle("board--table", tableLayout && state.mode !== "nodb");
    board.setAttribute("aria-label", tableLayout ? "Issues table" : "Issues by status");
    $("#banner").innerHTML = "";

    if (state.mode === "loading") {
      board.innerHTML = tableLayout ? tableSkeleton() : skeletonColumns();
      board.setAttribute("aria-busy", "true");
      renderSummary(null);
      return;
    }
    board.removeAttribute("aria-busy");

    if (state.mode === "nodb") {
      board.innerHTML = `<div class="empty-state empty-state--centered">
        <div class="empty-state__head">${icon("database")}<h2 class="empty-state__title">No beads database in this folder</h2></div>
        <p class="empty-state__text">The board reads issues through bd. Initialise a database in the repository, then retry.</p>
        <ol class="empty-state__steps">
          <li class="command"><span class="command__text mono"><span class="command__prompt">$ </span>cd ~/code/beads-board</span></li>
          <li class="command"><span class="command__text mono"><span class="command__prompt">$ </span>bd init</span><button class="btn btn--icon btn--sm" type="button" data-action="copy" data-copy="bd init" aria-label="Copy command">${icon("content_copy")}</button></li>
        </ol>
        <div class="empty-state__actions">
          <button class="btn btn--primary" type="button" data-action="retry">${icon("refresh", "btn__icon")}Retry</button>
          <button class="btn btn--secondary" type="button" data-action="choose-folder">Open another folder</button>
        </div></div>`;
      renderSummary(null);
      return;
    }

    if (state.mode === "error") {
      $("#banner").innerHTML = `<div class="banner" role="alert">
        ${icon("sync_problem", "banner__icon")}
        <div class="banner__text"><div class="banner__title">Can't read the beads database</div>
          <div class="banner__detail">bd reported "database is locked by another process". Showing issues from ${rel(state.lastSync)}; moves are paused.</div></div>
        <button class="btn btn--secondary btn--sm" type="button" data-action="copy" data-copy="bd doctor">Copy bd doctor</button>
        <button class="btn btn--primary btn--sm" type="button" data-action="retry">Retry</button></div>`;
    }

    const visible = state.issues.filter(matches);
    const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
    visible.forEach((i) => {
      const col = columnOf(i);
      if (col === "closed" && Date.now() - (i.closed || 0) > CLOSED_WINDOW) return;
      groups[col].push(i);
    });
    Object.entries(groups).forEach(([k, list]) => list.sort(sortFor(k)));
    const counts = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));

    if (filtersActive() && visible.length === 0) {
      board.innerHTML = `<div class="empty-state board__filter-empty">
        <div class="empty-state__head">${icon("filter_list_off")}<h2 class="empty-state__title">No issues match</h2></div>
        <p class="empty-state__text">${state.filters.q ? `Nothing contains “${esc(state.filters.q)}” with the current filters.` : "The current filters leave nothing on the board."}</p>
        <div class="empty-state__actions"><button class="btn btn--secondary" type="button" data-action="clear-filters">Clear filters</button></div></div>`;
      renderSummary(counts, 0);
      return;
    }

    if (tableLayout) {
      const rows = sortRows(visible.filter((i) => state.showClosed || columnOf(i) !== "closed"));
      renderSummary(counts, visible.length);
      if (!rows.length) {
        const none = !state.issues.length;
        board.innerHTML = `<div class="empty-state board__filter-empty">
          <div class="empty-state__head">${icon(none ? "table_rows" : "filter_list_off")}<h2 class="empty-state__title">${none ? "No issues yet" : "No open issues"}</h2></div>
          <p class="empty-state__text">${none ? "Create the first issue. It shows up here with its status and blockers." : "Everything left is closed. Turn on Closed to see it."}</p>
          ${none ? `<div class="empty-state__actions"><button class="btn btn--primary" type="button" data-action="new">${icon("add", "btn__icon")}New issue</button></div>` : ""}</div>`;
        return;
      }
      board.innerHTML = tableViewHTML(rows, state.issues.filter((i) => i.type !== "epic").length);
      rovingRows();
      if (state.selected) applySpotlight(state.selected);
      return;
    }

    const cols = COLUMNS.filter((c) => c.id !== "closed" || state.showClosed);
    board.innerHTML = cols.map((c) => columnHTML(c, groups[c.id], counts)).join("");
    renderSummary(counts, visible.length);
    if (state.selected) applySpotlight(state.selected);
  }

  function renderSummary(counts, visibleCount) {
    const el = $("#summary");
    const res = $("#result-count");
    if (!counts) { el.innerHTML = ""; res.textContent = ""; return; }
    el.innerHTML = `<span><strong>${counts.ready}</strong> ready</span><span class="main__summary-sep"></span>
      <span><strong>${counts.progress}</strong> in progress</span><span class="main__summary-sep"></span>
      <span><strong>${counts.blocked}</strong> blocked</span>`;
    const total = state.issues.filter((i) => i.type !== "epic").length;
    res.textContent = filtersActive() ? `${visibleCount} of ${total} issues` : "";
  }

  // ---------- rendering: rail ----------
  function renderRail() {
    const all = state.issues;
    const views = [
      { id: "all", label: "All issues", icon: "view_kanban", count: all.filter((i) => i.status !== "closed").length },
      { id: "mine", label: "Assigned to me", icon: "person", count: all.filter((i) => i.assignee === ME.id && i.status !== "closed").length },
      { id: "agents", label: "Agent work", icon: "smart_toy", count: all.filter((i) => person(i.assignee)?.kind === "agent" && i.status !== "closed").length },
      { id: "stale", label: "Stale leases", icon: "hourglass_disabled", count: all.filter(isStale).length },
    ];
    $("#rail-views").innerHTML = views.map((v) => `<button class="rail__item" type="button" data-action="view" data-view="${v.id}" ${state.view === v.id ? 'aria-current="true"' : ""}>
      ${icon(v.icon)}<span class="rail__label">${v.label}</span><span class="rail__count">${v.count}</span></button>`).join("");

    $("#rail-epics").innerHTML = D.epics.map((e) => {
      const kids = all.filter((i) => i.epic === e.id);
      const done = kids.filter((i) => i.status === "closed").length;
      const pct = kids.length ? Math.round((done / kids.length) * 100) : 0;
      return `<button class="rail__item rail__epic" type="button" data-action="epic" data-epic="${e.id}" ${state.filters.epic === e.id ? 'aria-current="true"' : ""}>
        <span class="rail__epic-row">${icon("stacks")}<span class="rail__label">${esc(e.title)}</span><span class="rail__count">${done}/${kids.length}</span></span>
        <span class="progress" role="progressbar" aria-label="${esc(e.title)} progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span class="progress__bar" style="width:${pct}%"></span></span>
      </button>`;
    }).join("");

    const labelCounts = {};
    all.filter((i) => i.status !== "closed").forEach((i) => i.labels.forEach((l) => (labelCounts[l] = (labelCounts[l] || 0) + 1)));
    $("#rail-labels").innerHTML = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, n]) => `<button class="rail__item" type="button" data-action="label" data-label="${esc(l)}" ${state.filters.labels.has(l) && state.filters.labels.size === 1 ? 'aria-current="true"' : ""}>
      ${icon("label")}<span class="rail__label">${esc(l)}</span><span class="rail__count">${n}</span></button>`).join("");
  }

  // ---------- rendering: filter chips ----------
  function chipLabel(name, set, fmt) {
    if (!set.size) return `<span class="chip__label">${name}</span>`;
    if (set.size === 1) return `<span class="chip__label">${name}: <span class="chip__value">${esc(fmt([...set][0]))}</span></span>`;
    return `<span class="chip__label">${name}: <span class="chip__value">${set.size}</span></span>`;
  }
  function renderFilters() {
    const f = state.filters;
    const typeFmt = (t) => TYPES[t].label;
    const prioFmt = (p) => `P${p}`;
    const whoFmt = (a) => (a === "none" ? "Unassigned" : person(a)?.name);
    const chip = (key, name, set, fmt, ic) => `<button class="chip chip--filter ${set.size ? "chip--selected" : ""}" type="button" data-action="filter-menu" data-filter="${key}" aria-haspopup="menu">
      ${icon(set.size ? "check" : ic, "chip__icon")}${chipLabel(name, set, fmt)}${icon("arrow_drop_down", "chip__caret")}</button>`;
    let html = chip("types", "Type", f.types, typeFmt, "category")
      + chip("priorities", "Priority", f.priorities, prioFmt, "signal_cellular_alt")
      + chip("assignees", "Assignee", f.assignees, whoFmt, "person")
      + chip("labels", "Label", f.labels, (x) => x, "label");
    if (f.epic) {
      const e = D.epics.find((x) => x.id === f.epic);
      html += `<button class="chip chip--selected" type="button" data-action="clear-epic" aria-label="Remove epic filter ${esc(e.title)}">${icon("stacks", "chip__icon")}<span class="chip__label">${esc(e.title)}</span>${icon("close", "chip__caret")}</button>`;
    }
    if (filtersActive()) html += `<button class="btn btn--text btn--sm" type="button" data-action="clear-filters">Clear all</button>`;
    $("#filter-chips").innerHTML = html;
  }

  function focusKey() {
    const el = document.activeElement;
    if (!el || el === document.body || el.closest("dialog, #menu")) return null;
    if (el.matches(ITEM)) return `#board [data-id="${el.dataset.id}"]${el.matches(".data-table__row") ? ".data-table__row" : ".issue-card"}`;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const attrs = ["data-action", "data-id", "data-tab", "data-p", "data-field", "data-filter", "data-view", "data-epic", "data-label", "data-dep", "data-key", "data-layout"];
    const parts = attrs.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`).join("");
    if (!parts) return null;
    const scope = ["#drawer", "#board", "#rail", "#filter-chips"].find((sc) => el.closest(sc)) || "";
    return `${scope} ${el.tagName.toLowerCase()}${parts}`;
  }
  function restoreFocus(key) {
    if (!key) return;
    const el = $(key);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }

  function renderAll() {
    const key = focusKey();
    renderRail();
    renderFilters();
    renderBoard();
    if (state.selected) renderDrawer();
    $$('[data-action="layout"]').forEach((b) => b.setAttribute("aria-checked", String(b.dataset.layout === state.layout)));
    syncRoving();
    restoreFocus(key);
  }

  // radio groups built from segmented buttons: one tab stop, arrows move
  function syncRoving(root = document) {
    $$(".segmented[role='radiogroup']", root).forEach((g) => {
      const opts = $$("[role='radio']", g);
      const on = opts.find((o) => o.getAttribute("aria-checked") === "true") || opts[0];
      opts.forEach((o) => (o.tabIndex = o === on ? 0 : -1));
    });
  }

  // ---------- chain spotlight ----------
  let spotTimer = null;
  function applySpotlight(id) {
    const issue = byId(id);
    const cards = $$(`#board ${ITEM.split(", ").join(", #board ")}`);
    clearSpotlightClasses(cards);
    if (!issue || !state.spotlightOn) return;
    const up = new Set(issue.deps);
    const down = new Set(dependents(issue).map((d) => d.id));
    const related = new Set([...(issue.related || []), ...(issue.discoveredFrom ? [issue.discoveredFrom] : [])]);
    if (!up.size && !down.size && !related.size) return;
    cards.forEach((c) => {
      const cid = c.dataset.id;
      const badge = c.querySelector(".issue-card__relation, .data-table__relation");
      if (cid === id) return;
      if (up.has(cid)) { c.classList.add(itemMod(c, "chain")); badge.innerHTML = `${icon("arrow_downward")}Blocks this`; }
      else if (down.has(cid)) { c.classList.add(itemMod(c, "chain")); badge.innerHTML = `${icon("arrow_upward")}Waits on this`; }
      else if (related.has(cid)) { c.classList.add(itemMod(c, "chain")); badge.innerHTML = `${icon("link")}${cid === issue.discoveredFrom ? "Found in" : "Related"}`; }
      else c.classList.add(itemMod(c, "dimmed"));
    });
  }
  function clearSpotlightClasses(cards = $$(`#board ${ITEM.split(", ").join(", #board ")}`)) {
    cards.forEach((c) => c.classList.remove("issue-card--chain", "issue-card--dimmed", "data-table__row--chain", "data-table__row--dimmed"));
  }
  function spotlight(id) {
    clearTimeout(spotTimer);
    if (state.drag) return;
    spotTimer = setTimeout(() => (id ? applySpotlight(id) : state.selected ? applySpotlight(state.selected) : clearSpotlightClasses()), id ? 120 : 60);
  }

  // ---------- moves ----------
  let undoStack = null;
  const snapshot = () => ({ issues: structuredClone(state.issues), activity: structuredClone(state.activity) });
  function restore(snap) {
    state.issues = snap.issues;
    state.activity = snap.activity;
    renderAll();
  }

  function canDrop(issue, to) {
    const from = columnOf(issue);
    const blockers = openBlockers(issue).length;
    if (state.mode === "error") return { ok: false, hint: "Moves are paused until bd responds" };
    if (from === to) return { ok: null };
    switch (to) {
      case "ready":
        if (blockers && from === "closed") return { ok: true, hint: "Reopen. It lands in Blocked" };
        if (blockers && from === "deferred") return { ok: true, hint: "Bring back. It lands in Blocked" };
        if (blockers) return { ok: false, hint: `Still waits on ${blockers} open issue${blockers > 1 ? "s" : ""}` };
        if (from === "progress") return { ok: true, hint: "Release the lease and put it back" };
        if (from === "closed") return { ok: true, hint: "Reopen" };
        if (from === "deferred") return { ok: true, hint: "Bring back now" };
        return { ok: true, hint: "Mark as unblocked" };
      case "progress":
        if (from === "blocked") return { ok: false, hint: "Finish its blockers first" };
        if (from === "closed") return { ok: false, hint: "Reopen it to Ready first" };
        if (from === "deferred") return { ok: false, hint: "Bring it back to Ready first" };
        return { ok: true, hint: issue.assignee && issue.assignee !== ME.id ? `Claim from ${person(issue.assignee).name}` : "Claim as you" };
      case "blocked":
        if (from === "closed") return { ok: false, hint: "Closed issues can't be blocked" };
        return { ok: true, hint: "Choose what blocks it" };
      case "closed":
        return { ok: true, hint: blockers ? "Close without its blockers" : "Close" };
      case "deferred":
        if (from === "closed") return { ok: false, hint: "Reopen it first" };
        return { ok: true, hint: "Pick a date" };
    }
    return { ok: false, hint: "" };
  }

  function logEvent(id, text) {
    (state.activity[id] ||= []).push({ kind: "event", who: ME.id, when: Date.now(), text });
  }

  function commit(id, fn, message, opts = {}) {
    const snap = snapshot();
    const before = new Set(state.issues.filter((i) => columnOf(i) === "ready").map((i) => i.id));
    const issue = byId(id);
    const oldCard = $(`#board .issue-card[data-id="${id}"]`);   // only cards travel between columns
    const oldRect = oldCard?.getBoundingClientRect();
    const oldCol = columnOf(issue);
    fn(issue);
    issue.updated = Date.now();
    renderAll();
    const newCard = itemEl(id);
    if (newCard && oldRect && oldCol !== columnOf(issue) && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const r = newCard.getBoundingClientRect();
      newCard.animate([
        { transform: `translate(${oldRect.left - r.left}px, ${oldRect.top - r.top}px)`, boxShadow: "var(--shadow-raised)" },
        { transform: "none" },
      ], { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
    if (newCard && (document.activeElement === document.body || !document.activeElement)) newCard.focus({ preventScroll: true });
    const nowReady = state.issues.filter((i) => columnOf(i) === "ready" && !before.has(i.id) && i.id !== id);
    nowReady.forEach((i) => {
      const card = itemEl(i.id);
      if (card) flash(card);
    });
    let msg = message;
    if (nowReady.length && opts.announceUnblocked !== false) {
      msg += nowReady.length === 1 ? ` <span class="mono">${nowReady[0].id}</span> is ready now.` : ` ${nowReady.length} issues are ready now.`;
    }
    undoStack = snap;
    snackbar(msg, { label: "Undo", fn: () => { restore(undoStack); undoStack = null; snackbar("Undone"); } });
  }

  function moveTo(id, to) {
    const issue = byId(id);
    if (!issue) return;
    const verdict = canDrop(issue, to);
    if (!verdict.ok) { if (verdict.ok === false) snackbar(`Can't move <span class="mono">${id}</span>: ${esc(verdict.hint.toLowerCase())}.`); return; }
    const from = columnOf(issue);
    if (to === "blocked") return openBlockerPicker(id);
    if (to === "deferred") return openDefer(id);
    if (to === "progress") return commit(id, (i) => { i.status = "in_progress"; i.assignee = ME.id; i.heartbeat = Date.now(); logEvent(id, "claimed the issue"); }, `Claimed <span class="mono">${id}</span>.`);
    if (to === "closed") return commit(id, (i) => { i.status = "closed"; i.closed = Date.now(); logEvent(id, "closed the issue"); }, `Closed <span class="mono">${id}</span>.`);
    if (to === "ready") {
      return commit(id, (i) => {
        if (from === "progress") { i.assignee = null; i.heartbeat = null; logEvent(id, "released the lease"); }
        if (from === "closed") { i.closed = null; logEvent(id, "reopened the issue"); }
        if (from === "deferred") { i.deferUntil = null; logEvent(id, "brought the issue back"); }
        i.status = "open";
      }, from === "closed" ? `Reopened <span class="mono">${id}</span>.` : from === "progress" ? `Released <span class="mono">${id}</span>.` : `Moved <span class="mono">${id}</span> to Ready.`);
    }
  }

  function reclaim(id) {
    commit(id, (i) => { const who = person(i.assignee)?.name; i.status = "open"; i.assignee = null; i.heartbeat = null; logEvent(id, `reclaimed the lease from ${who}`); }, `Reclaimed <span class="mono">${id}</span>. It's back in Ready.`);
  }

  // ---------- drag and drop ----------
  function onDragStart(e) {
    const card = e.target.closest(".issue-card[data-id]");
    if (!card) return;
    const issue = byId(card.dataset.id);
    state.drag = { id: issue.id, from: columnOf(issue) };
    clearSpotlightClasses();
    hideTooltip();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", issue.id);
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add("issue-card--ghost");
    ghost.removeAttribute("id");
    ghost.style.cssText = `position:fixed;top:-1000px;left:0;width:${r.width}px`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, e.clientX - r.left, e.clientY - r.top);
    setTimeout(() => ghost.remove(), 0);
    requestAnimationFrame(() => card.classList.add("issue-card--dragging"));
    $$("#board .column[data-col]").forEach((col) => {
      const v = canDrop(issue, col.dataset.col);
      const hint = col.querySelector(".column__drop-hint");
      if (v.ok === true) { col.classList.add("column--drop-valid"); if (hint) hint.innerHTML = `${icon("south")}${esc(v.hint)}`; }
      else if (v.ok === false) { col.classList.add("column--drop-invalid"); if (hint) hint.innerHTML = `${icon("block")}${esc(v.hint)}`; }
    });
  }
  function onDragOver(e) {
    if (!state.drag) return;
    const col = e.target.closest(".column[data-col]");
    if (!col || !col.classList.contains("column--drop-valid")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    $$(".column--drop-over").forEach((c) => c !== col && c.classList.remove("column--drop-over"));
    col.classList.add("column--drop-over");
  }
  function onDrop(e) {
    const col = e.target.closest(".column[data-col]");
    if (!state.drag || !col) return;
    e.preventDefault();
    const { id } = state.drag;
    endDrag();
    moveTo(id, col.dataset.col);
  }
  function endDrag() {
    state.drag = null;
    $$(".issue-card--dragging").forEach((c) => c.classList.remove("issue-card--dragging"));
    $$(".column").forEach((c) => c.classList.remove("column--drop-valid", "column--drop-invalid", "column--drop-over"));
  }

  // ---------- menus ----------
  const menuEl = $("#menu");
  let menuAnchor = null;
  function openMenu(anchor, html, { align = "start", onClick } = {}) {
    menuEl.innerHTML = html;
    menuEl._onClick = onClick;
    menuAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    if (!menuEl.matches(":popover-open")) menuEl.showPopover();
    const r = anchor.getBoundingClientRect();
    const mw = menuEl.offsetWidth;
    const mh = menuEl.offsetHeight;
    let left = align === "end" ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    menuEl.style.transformOrigin = align === "end" ? "top right" : "top left";
    menuEl.querySelector(".menu__item:not([aria-disabled='true'])")?.focus({ preventScroll: true });
  }
  function closeMenu() { if (menuEl.matches(":popover-open")) menuEl.hidePopover(); }
  menuEl.addEventListener("toggle", (e) => {
    if (e.newState === "closed" && menuAnchor) { menuAnchor.setAttribute("aria-expanded", "false"); menuAnchor = null; }
  });
  menuEl.addEventListener("click", (e) => {
    const item = e.target.closest(".menu__item");
    if (!item || item.getAttribute("aria-disabled") === "true") return;
    menuEl._onClick?.(item.dataset, item);
  });
  menuEl.addEventListener("keydown", (e) => {
    const items = $$(".menu__item:not([aria-disabled='true'])", menuEl);
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });

  const menuItem = (attrs, ic, label, meta = "", disabled = false) =>
    `<button class="menu__item" type="button" role="menuitem" ${Object.entries(attrs).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")} ${disabled ? 'aria-disabled="true"' : ""}>
      ${ic ? icon(ic) : ""}<span class="menu__item-label">${label}</span>${meta ? `<span class="menu__item-meta">${meta}</span>` : ""}</button>`;

  function filterMenuHTML(key) {
    const f = state.filters[key];
    const row = (val, lead, label, meta) => `<button class="menu__item" type="button" role="menuitemcheckbox" aria-checked="${f.has(val)}" data-val="${esc(val)}">
      <span class="menu__check ${f.has(val) ? "menu__check--on" : ""}" aria-hidden="true"></span>
      ${lead ? `<span class="menu__lead">${lead}</span>` : ""}
      <span class="menu__item-label">${label}</span><span class="menu__item-meta">${meta}</span></button>`;
    const pool = state.issues.filter((i) => i.status !== "closed");
    const count = (pred) => pool.filter(pred).length;
    let rows = "";
    if (key === "types") rows = Object.entries(TYPES).map(([t, v]) => row(t, icon(v.icon), v.label, count((i) => i.type === t))).join("");
    if (key === "priorities") rows = [0, 1, 2, 3, 4].map((p) => row(p, `<span class="chip chip--priority chip--p${p}">P${p}</span>`, PRIORITY_NAMES[p], count((i) => i.priority === p))).join("");
    if (key === "assignees") rows = Object.values(D.people).map((p) => row(p.id, avatar(p.id), `${esc(p.name)}${p.me ? " (you)" : ""}`, count((i) => i.assignee === p.id))).join("") + row("none", avatar(null), "Unassigned", count((i) => !i.assignee));
    if (key === "labels") rows = [...new Set(state.issues.flatMap((i) => i.labels))].sort().map((l) => row(l, "", esc(l), count((i) => i.labels.includes(l)))).join("");
    return rows + (f.size ? `<hr class="menu__divider">${menuItem({ clear: "1" }, "close", "Clear")}` : "");
  }

  function openFilterMenu(anchor) {
    const key = anchor.dataset.filter;
    const handler = (data) => {
      const set = state.filters[key];
      if (data.clear) set.clear();
      else {
        const v = key === "priorities" ? Number(data.val) : data.val;
        set.has(v) ? set.delete(v) : set.add(v);
      }
      renderFilters();
      renderBoard();
      const fresh = $(`#filter-chips [data-filter="${key}"]`);
      if (data.clear) return closeMenu();
      const focused = data.val;
      openMenu(fresh, filterMenuHTML(key), { onClick: handler });
      menuEl.querySelector(`[data-val="${CSS.escape(String(focused))}"]`)?.focus({ preventScroll: true });
    };
    openMenu(anchor, filterMenuHTML(key), { onClick: handler });
  }

  function openCardMenu(anchor, id) {
    const issue = byId(id);
    const from = columnOf(issue);
    const targets = COLUMNS.map((c) => {
      const v = canDrop(issue, c.id);
      if (v.ok === null) return menuItem({ move: c.id }, "check", c.title, "Here", true);
      return menuItem({ move: c.id }, v.ok ? "east" : "block", c.title, v.ok ? "" : esc(v.hint), !v.ok);
    }).join("");
    openMenu(anchor, `
      ${menuItem({ act: "open" }, "open_in_new", "Open", "Enter")}
      ${from === "ready" ? menuItem({ act: "claim" }, "play_arrow", "Claim") : ""}
      ${menuItem({ act: "blocker" }, "lock", "Add blocker…", "", from === "closed")}
      ${menuItem({ act: "copy" }, "content_copy", "Copy ID")}
      <hr class="menu__divider"><div class="menu__heading">Move to</div>${targets}`, {
      align: "end",
      onClick: (d) => {
        closeMenu();
        if (d.move) return moveTo(id, d.move);
        if (d.act === "open") openDrawer(id);
        if (d.act === "claim") moveTo(id, "progress");
        if (d.act === "blocker") openBlockerPicker(id);
        if (d.act === "copy") copy(id);
      },
    });
  }

  // ---------- drawer ----------
  const drawer = $("#drawer");
  function openDrawer(id, tab) {
    state.selected = id;
    if (tab) state.drawerTab = tab;
    $("#app").classList.add("app--drawer-open");
    drawer.classList.add("drawer--open");
    drawer.setAttribute("aria-hidden", "false");
    if (matchMedia("(max-width: 767px)").matches) { $("#main").inert = true; $("#rail").inert = true; }
    renderDrawer();
    $$("#board .issue-card, #board .data-table__row").forEach((c) => c.classList.toggle(itemMod(c, "selected"), c.dataset.id === id));
    applySpotlight(id);
    $("#board .issue-card--selected, #board .data-table__row--selected")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    drawer.focus({ preventScroll: true });
  }
  function closeDrawer() {
    const id = state.selected;
    state.selected = null;
    $("#app").classList.remove("app--drawer-open");
    drawer.classList.remove("drawer--open");
    drawer.setAttribute("aria-hidden", "true");
    $("#main").inert = false;
    $("#rail").inert = false;
    $$("#board .issue-card--selected, #board .data-table__row--selected").forEach((c) => c.classList.remove("issue-card--selected", "data-table__row--selected"));
    clearSpotlightClasses();
    (itemEl(id) || $(`#board ${ITEM.split(", ").join(", #board ")}`))?.focus({ preventScroll: true });
  }

  function threadItem(issue, cls = "", removable = false) {
    const bead = issue.status === "closed" ? "bead--done" : issue.status === "in_progress" ? "bead--active" : "";
    const statusText = { closed: "Closed", in_progress: "In progress", deferred: "Deferred" }[issue.status] || (openBlockers(issue).length ? "Blocked" : "Ready");
    return `<li class="bead-thread__item ${cls || "bead-thread__item--link"}" ${cls ? "" : `data-action="open" data-id="${issue.id}" tabindex="0"`}>
      <span class="bead-thread__node"><span class="bead ${bead}"></span></span>
      <span class="bead-thread__body"><span class="bead-thread__title">${esc(issue.title)}</span>
        <span class="bead-thread__meta"><span class="mono">${issue.id}</span><span>${statusText}</span>${issue.assignee ? `<span>${esc(person(issue.assignee)?.name)}</span>` : ""}</span></span>
      ${removable ? `<button class="btn btn--icon btn--sm bead-thread__remove" type="button" data-action="remove-dep" data-dep="${issue.id}" aria-label="Remove ${issue.id} as a blocker">${icon("close")}</button>` : `<span class="chip chip--priority chip--p${issue.priority}">P${issue.priority}</span>`}
    </li>`;
  }

  function renderDrawer() {
    const issue = byId(state.selected);
    if (!issue) return closeDrawer();
    const col = columnOf(issue);
    const type = TYPES[issue.type] || TYPES.task;
    const ups = issue.deps.map(byId).filter(Boolean);
    const downs = dependents(issue);
    const acts = state.activity[issue.id] || [];
    const blockers = openBlockers(issue);

    const actions = {
      ready: `<button class="btn btn--primary" type="button" data-action="claim">${icon("play_arrow", "btn__icon")}Claim</button><button class="btn btn--secondary" type="button" data-action="close-issue">${icon("check", "btn__icon")}Close</button>`,
      progress: isStale(issue)
        ? `<button class="btn btn--primary" type="button" data-action="reclaim" data-id="${issue.id}">${icon("hourglass_disabled", "btn__icon")}Reclaim lease</button><button class="btn btn--secondary" type="button" data-action="close-issue">Close</button>`
        : `<button class="btn btn--primary" type="button" data-action="close-issue">${icon("check", "btn__icon")}Close</button><button class="btn btn--secondary" type="button" data-action="release">Release</button>`,
      blocked: `<button class="btn btn--secondary" type="button" data-action="add-blocker">${icon("lock", "btn__icon")}Add blocker</button><button class="btn btn--text" type="button" data-action="close-issue">Close anyway</button>`,
      closed: `<button class="btn btn--secondary" type="button" data-action="reopen">${icon("undo", "btn__icon")}Reopen</button>`,
      deferred: `<button class="btn btn--secondary" type="button" data-action="undefer">${icon("event_available", "btn__icon")}Bring back now</button>`,
    }[col];

    const lead = (inner) => `<span class="glyph glyph--lg">${inner}</span>`;
    const statusLine = {
      ready: `${lead('<span class="bead"></span>')}Ready`,
      progress: `${lead('<span class="bead bead--active"></span>')}In progress${issue.heartbeat ? ` · heartbeat ${rel(issue.heartbeat)}` : ""}`,
      blocked: `${lead(icon("lock"))}Blocked by ${blockers.length || "hand"}`,
      closed: `${lead('<span class="bead bead--done"></span>')}Closed ${rel(issue.closed)}`,
      deferred: `${lead(icon("snooze"))}Deferred until ${fmtDate(issue.deferUntil)}`,
    }[col];

    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(label)}</option>`;
    const sel = (field, options) => `<span class="select select--bare">${`<select class="select__input" data-field="${field}" aria-label="${field}">${options}</select>`}${icon("arrow_drop_down", "select__caret")}</span>`;

    const details = `
      <dl class="meta-list">
        <dt class="meta-list__key">Status</dt><dd class="meta-list__value">${statusLine}</dd>
        <dt class="meta-list__key">Priority</dt><dd class="meta-list__value"><div class="segmented" role="radiogroup" aria-label="Priority">
          ${[0, 1, 2, 3, 4].map((p) => `<button class="segmented__option" type="button" role="radio" aria-checked="${issue.priority === p}" data-action="set-priority" data-p="${p}" data-tooltip="${PRIORITY_NAMES[p]}">P${p}</button>`).join("")}</div></dd>
        <dt class="meta-list__key">Type</dt><dd class="meta-list__value">${lead(icon(type.icon))}${sel("type", Object.entries(TYPES).map(([k, v]) => opt(k, v.label, issue.type)).join(""))}</dd>
        <dt class="meta-list__key">Assignee</dt><dd class="meta-list__value">${avatar(issue.assignee)}${sel("assignee", opt("", "Unassigned", issue.assignee || "") + Object.values(D.people).map((p) => opt(p.id, p.name + (p.kind === "agent" ? " (agent)" : ""), issue.assignee)).join(""))}</dd>
        <dt class="meta-list__key">Epic</dt><dd class="meta-list__value">${lead(icon("stacks"))}${sel("epic", opt("", "None", issue.epic || "") + D.epics.map((e) => opt(e.id, e.title, issue.epic)).join(""))}</dd>
        <dt class="meta-list__key">Labels</dt><dd class="meta-list__value">${issue.labels.map((l) => `<span class="chip chip--label">${esc(l)}</span>`).join("") || '<span class="meta-list__empty">None</span>'}</dd>
        ${issue.estimate ? `<dt class="meta-list__key">Estimate</dt><dd class="meta-list__value">${fmtEstimate(issue.estimate)}</dd>` : ""}
        <dt class="meta-list__key">Updated</dt><dd class="meta-list__value">${rel(issue.updated)} · created ${fmtDate(issue.created)}</dd>
      </dl>
      <section class="drawer__section"><div class="drawer__section-head"><h3 class="drawer__section-title">Description</h3></div>
        <div class="drawer__prose">${issue.description ? `<p>${inline(issue.description)}</p>` : '<p class="drawer__muted">No description yet.</p>'}</div></section>
      ${issue.acceptance ? `<section class="drawer__section"><div class="drawer__section-head"><h3 class="drawer__section-title">Acceptance criteria</h3><span class="drawer__section-count">${issue.acceptance.filter((a) => a[1]).length}/${issue.acceptance.length}</span></div>
        <ul class="drawer__checklist">${issue.acceptance.map(([t, done], i) => `<li><label class="checkbox"><input class="checkbox__input" type="checkbox" ${done ? "checked" : ""} data-action="toggle-ac" data-i="${i}"><span>${inline(t)}</span></label></li>`).join("")}</ul></section>` : ""}
      ${issue.closeReason ? `<section class="drawer__section"><div class="drawer__section-head"><h3 class="drawer__section-title">Close reason</h3></div><p class="drawer__prose">${esc(issue.closeReason)}</p></section>` : ""}`;

    const related = [...(issue.related || []).map(byId), ...(issue.discoveredFrom ? [byId(issue.discoveredFrom)] : [])].filter(Boolean);
    const deps = `
      <section class="drawer__section">
        <div class="drawer__section-head"><h3 class="drawer__section-title">Chain</h3>
          <button class="btn btn--text btn--sm" type="button" data-action="add-blocker" ${col === "closed" ? "disabled" : ""}>${icon("add", "btn__icon")}Add blocker</button></div>
        <ul class="bead-thread">
          ${ups.length ? `<li class="bead-thread__group">Blocked by · ${blockers.length} open of ${ups.length}</li>` : ""}
          ${ups.map((u) => threadItem(u, "", true)).join("")}
          ${threadItem(issue, "bead-thread__item--current")}
          ${downs.length ? `<li class="bead-thread__group">Blocks · ${downs.length}</li>` : ""}
          ${downs.map((d) => threadItem(d)).join("")}
        </ul>
        ${!ups.length && !downs.length ? '<p class="drawer__muted">No dependencies. Add a blocker when this waits on other work.</p>' : ""}
      </section>
      ${related.length ? `<section class="drawer__section"><div class="drawer__section-head"><h3 class="drawer__section-title">Related</h3></div>
        <ul class="bead-thread">${related.map((r) => threadItem(r)).join("")}</ul></section>` : ""}`;

    const activity = `
      <ol class="activity">${acts.length ? acts.map((a) => a.kind === "comment"
        ? `<li class="activity__item">${avatar(a.who)}<div><div class="activity__head"><span class="activity__who">${esc(person(a.who)?.name)}</span><span class="activity__when">${rel(a.when)}</span></div><p class="activity__text">${inline(a.text)}</p></div></li>`
        : `<li class="activity__item activity__item--event"><span class="activity__event-icon">${icon("history")}</span><div class="activity__head"><span class="activity__text"><span class="activity__actor">${esc(person(a.who)?.name)}</span> ${esc(a.text)}</span><span class="activity__when">${rel(a.when)}</span></div></li>`).join("")
        : '<li class="drawer__muted">No activity recorded in this demo.</li>'}</ol>
      <form class="composer" data-form="comment">
        <label class="field"><textarea class="field__input" name="comment" rows="3" placeholder="Markdown is fine" maxlength="4000"></textarea><span class="field__label">Add a comment</span></label>
        <div class="composer__actions"><button class="btn btn--primary btn--sm" type="submit">Comment</button></div>
      </form>`;

    const tabs = [["details", "Details", ""], ["deps", "Dependencies", ups.length + downs.length], ["activity", "Activity", acts.length]];

    drawer.innerHTML = `
      <header class="drawer__header">
        <span class="drawer__id">${icon(type.icon, "icon--sm")}<span class="mono">${issue.id}</span>
          <button class="btn btn--icon btn--sm" type="button" data-action="copy" data-copy="${issue.id}" aria-label="Copy ID">${icon("content_copy", "icon--sm")}</button></span>
        <span class="drawer__spacer"></span>
        <button class="btn btn--icon" type="button" data-action="drawer-menu" aria-label="More actions" aria-haspopup="menu">${icon("more_vert")}</button>
        <button class="btn btn--icon" type="button" data-action="close-drawer" aria-label="Close panel" data-tooltip="Close · Esc">${icon("close")}</button>
      </header>
      <div class="drawer__title-wrap"><label class="visually-hidden" for="drawer-title">Title</label>
        <textarea class="drawer__title" id="drawer-title" rows="1" maxlength="300" data-field="title">${esc(issue.title)}</textarea></div>
      <div class="drawer__actions">${actions}</div>
      <div class="tabs drawer__tabs" role="tablist" aria-label="Issue sections">
        ${tabs.map(([k, l, n]) => `<button class="tabs__tab" type="button" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${state.drawerTab === k}" tabindex="${state.drawerTab === k ? 0 : -1}" data-action="tab" data-tab="${k}">${l}${n !== "" ? `<span class="tabs__count">${n}</span>` : ""}</button>`).join("")}
        <span class="tabs__indicator"></span>
      </div>
      <div class="drawer__body">
        <div class="drawer__panel" role="tabpanel" id="panel-details" aria-labelledby="tab-details" ${state.drawerTab === "details" ? "" : "hidden"}>${details}</div>
        <div class="drawer__panel" role="tabpanel" id="panel-deps" aria-labelledby="tab-deps" ${state.drawerTab === "deps" ? "" : "hidden"}>${deps}</div>
        <div class="drawer__panel" role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" ${state.drawerTab === "activity" ? "" : "hidden"}>${activity}</div>
      </div>
      <footer class="drawer__footer"><div class="command"><span class="command__text mono"><span class="command__prompt">$ </span>bd show ${issue.id}</span>
        <button class="btn btn--icon btn--sm" type="button" data-action="copy" data-copy="bd show ${issue.id}" aria-label="Copy command">${icon("content_copy", "icon--sm")}</button></div></footer>`;
    moveIndicator();
  }

  function moveIndicator() {
    const tab = $(".tabs__tab[aria-selected='true']", drawer);
    const ind = $(".tabs__indicator", drawer);
    if (!tab || !ind) return;
    ind.style.width = `${tab.offsetWidth}px`;
    ind.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  // ---------- blocker picker ----------
  const dlgBlocker = $("#dlg-blocker");
  function candidateRows(issue, q, exclude = new Set()) {
    const ql = q.trim().toLowerCase();
    return state.issues
      .filter((c) => c.id !== issue.id && c.status !== "closed" && c.type !== "epic")
      .filter((c) => !ql || `${c.id} ${c.title}`.toLowerCase().includes(ql))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 8)
      .map((c) => {
        let reason = "";
        if (issue.deps.includes(c.id) || exclude.has(c.id)) reason = "Already a blocker";
        else if (dependsOn(c.id, issue.id)) reason = "Would create a cycle";
        return { c, reason };
      });
  }
  function renderBlockerOptions() {
    const issue = byId(dlgBlocker.dataset.id);
    const q = $("#blocker-q").value;
    const rows = candidateRows(issue, q);
    $("#blocker-list").innerHTML = rows.length
      ? rows.map(({ c, reason }, i) => `<li class="autocomplete__option" role="option" id="opt-${c.id}" data-id="${c.id}" ${reason ? 'aria-disabled="true"' : ""} aria-selected="false">
          <span class="chip chip--priority chip--p${c.priority}">P${c.priority}</span><span class="mono">${c.id}</span><span class="autocomplete__title">${esc(c.title)}</span>
          ${reason ? `<span class="autocomplete__reason">${reason}</span>` : ""}</li>`).join("")
      : `<li class="autocomplete__empty">No open issue matches “${esc(q)}”.</li>`;
    blockerActive = -1;
    $("#blocker-q").setAttribute("aria-expanded", String(rows.length > 0));
    $("#blocker-q").removeAttribute("aria-activedescendant");
    const cycle = rows.find((r) => r.reason === "Would create a cycle");
    $("#blocker-helper").innerHTML = cycle
      ? `${icon("info", "icon--sm")}<span><span class="mono">${cycle.c.id}</span> already waits on this issue, so it can't block it.</span>`
      : "Pick the open issue that has to finish first.";
  }
  let blockerActive = -1;
  function openBlockerPicker(id) {
    const issue = byId(id);
    dlgBlocker.dataset.id = id;
    $("#blocker-title").innerHTML = `What blocks <span class="mono">${id}</span>?`;
    $("#blocker-sub").textContent = issue.title;
    $("#blocker-q").value = "";
    renderBlockerOptions();
    dlgBlocker.showModal();
    $("#blocker-q").focus();
  }
  function chooseBlocker(depId) {
    const id = dlgBlocker.dataset.id;
    dlgBlocker.close();
    commit(id, (i) => { i.deps.push(depId); if (i.status === "blocked" || i.status === "deferred") { i.status = "open"; i.deferUntil = null; } logEvent(id, `added ${depId} as a blocker`); }, `<span class="mono">${depId}</span> now blocks <span class="mono">${id}</span>.`);
    if (state.selected === id) { state.drawerTab = "deps"; renderDrawer(); }
  }

  // ---------- defer ----------
  const dlgDefer = $("#dlg-defer");
  function openDefer(id) {
    dlgDefer.dataset.id = id;
    $("#defer-title").innerHTML = `Defer <span class="mono">${id}</span>`;
    const d = new Date(); d.setDate(d.getDate() + 7);
    $("#defer-date").value = d.toISOString().slice(0, 10);
    $("#defer-date").min = new Date().toISOString().slice(0, 10);
    $$('input[name="defer"]', dlgDefer).forEach((r, i) => (r.checked = i === 1));
    dlgDefer.showModal();
  }
  function deferUntil() {
    const v = $('input[name="defer"]:checked', dlgDefer).value;
    const d = new Date(); d.setHours(9, 0, 0, 0);
    if (v === "tomorrow") d.setDate(d.getDate() + 1);
    if (v === "monday") d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    if (v === "month") d.setMonth(d.getMonth() + 1);
    if (v === "date") return new Date(`${$("#defer-date").value}T09:00`).getTime();
    return d.getTime();
  }

  // ---------- close with reason ----------
  const dlgClose = $("#dlg-close");
  function openClose(id) {
    const issue = byId(id);
    dlgClose.dataset.id = id;
    $("#close-title").innerHTML = `Close <span class="mono">${id}</span>`;
    const ds = dependents(issue).filter((d) => d.status !== "closed");
    const freed = ds.filter((d) => openBlockers(d).length === 1);
    $("#close-impact").innerHTML = ds.length
      ? `${icon("account_tree", "icon--sm")}<span>${freed.length ? `${freed.map((f) => `<span class="mono">${f.id}</span>`).join(", ")} will become ready.` : `${ds.length} dependent issue${ds.length > 1 ? "s" : ""} still wait on other blockers.`}</span>`
      : "";
    $("#close-impact").hidden = !ds.length;
    $("#close-reason").value = "";
    updateCloseCmd();
    dlgClose.showModal();
    $("#close-reason").focus();
  }
  function updateCloseCmd() {
    const r = $("#close-reason").value.trim();
    $("#close-cmd").textContent = `bd close ${dlgClose.dataset.id}${r ? ` --reason ${shellQuote(r)}` : ""}`;
  }

  // ---------- create ----------
  const dlgCreate = $("#dlg-create");
  const createState = { type: "task", priority: 2, deps: [] };
  function openCreate(prefill = {}) {
    const form = $("#create-form");
    form.reset();
    Object.assign(createState, { type: prefill.type || "task", priority: prefill.priority ?? 2, deps: prefill.deps || [] });
    form.title.value = prefill.title || "";
    form.epic.innerHTML = `<option value="">None</option>` + D.epics.map((e) => `<option value="${e.id}" ${state.filters.epic === e.id ? "selected" : ""}>${esc(e.title)}</option>`).join("");
    form.assignee.innerHTML = `<option value="">Unassigned</option>` + Object.values(D.people).map((p) => `<option value="${p.id}">${esc(p.name)}${p.me ? " (you)" : ""}</option>`).join("");
    $("#create-title-field").classList.remove("field--error");
    $("#create-title-help").textContent = "Imperative and specific: what should be true when it's done.";
    renderCreateControls();
    dlgCreate.showModal();
    form.title.focus();
  }
  function renderCreateControls() {
    $("#create-type").innerHTML = ["task", "bug", "feature", "chore", "epic"].map((t) => `<button class="segmented__option" type="button" role="radio" aria-checked="${createState.type === t}" data-type="${t}">${icon(TYPES[t].icon)}${TYPES[t].label}</button>`).join("");
    $("#create-priority").innerHTML = [0, 1, 2, 3, 4].map((p) => `<button class="segmented__option" type="button" role="radio" aria-checked="${createState.priority === p}" data-p="${p}" data-tooltip="${PRIORITY_NAMES[p]}">P${p}</button>`).join("");
    $("#create-deps").innerHTML = createState.deps.map((d) => `<span class="token"><span class="mono">${d}</span><button class="btn btn--icon token__remove" type="button" data-remove="${d}" aria-label="Remove ${d}">${icon("close")}</button></span>`).join("");
    renderCreateSuggestions();
    updateCreateCmd();
    syncRoving(dlgCreate);
  }
  function renderCreateSuggestions() {
    const q = $("#create-deps-q").value;
    const list = $("#create-deps-list");
    const input = $("#create-deps-q");
    depsActive = -1;
    input.removeAttribute("aria-activedescendant");
    if (!q.trim()) { list.innerHTML = ""; input.setAttribute("aria-expanded", "false"); return; }
    const fake = { id: "__new__", deps: [] };
    const rows = candidateRows(fake, q, new Set(createState.deps));
    input.setAttribute("aria-expanded", "true");
    list.innerHTML = rows.length
      ? rows.map(({ c, reason }) => `<li class="autocomplete__option" role="option" id="dep-opt-${c.id}" aria-selected="false" data-id="${c.id}" ${reason ? 'aria-disabled="true"' : ""}><span class="chip chip--priority chip--p${c.priority}">P${c.priority}</span><span class="mono">${c.id}</span><span class="autocomplete__title">${esc(c.title)}</span>${reason ? `<span class="autocomplete__reason">${reason}</span>` : ""}</li>`).join("")
      : `<li class="autocomplete__empty">No open issue matches.</li>`;
  }
  let depsActive = -1;
  function updateCreateCmd() {
    const f = $("#create-form");
    const parts = ["bd create", shellQuote(f.title.value.trim() || "Title")];
    if (createState.type !== "task") parts.push(`-t ${createState.type}`);
    if (createState.priority !== 2) parts.push(`-p ${createState.priority}`);
    if (f.assignee.value) parts.push(`-a ${shellQuote(person(f.assignee.value).name)}`);
    if (f.epic.value) parts.push(`--parent ${f.epic.value}`);
    const labels = f.labels.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (labels.length) parts.push(`-l ${labels.join(",")}`);
    if (createState.deps.length) parts.push(`--deps ${createState.deps.map((d) => `blocked-by:${d}`).join(",")}`);
    if (f.description.value.trim()) parts.push(`-d ${shellQuote(f.description.value.trim().slice(0, 40) + (f.description.value.trim().length > 40 ? "…" : ""))}`);
    $("#create-cmd").textContent = parts.join(" ");
  }
  function submitCreate(e) {
    e?.preventDefault();
    const f = $("#create-form");
    const title = f.title.value.trim();
    if (!title) {
      $("#create-title-field").classList.add("field--error");
      $("#create-title-help").innerHTML = `${icon("error")}Give the issue a title. It's the only required field.`;
      f.title.focus();
      return;
    }
    const issue = createIssue({
      title, type: createState.type, priority: createState.priority,
      assignee: f.assignee.value || null, epic: f.epic.value || null,
      labels: f.labels.value.split(",").map((s) => s.trim()).filter(Boolean),
      deps: [...createState.deps], description: f.description.value.trim(),
    });
    if (f.another.checked) {
      f.title.value = "";
      f.description.value = "";
      createState.deps = [];
      renderCreateControls();
      f.title.focus();
      snackbar(`Created <span class="mono">${issue.id}</span>. Ready for the next one.`);
    } else {
      dlgCreate.close();
      snackbar(`Created <span class="mono">${issue.id}</span> in ${COLUMNS.find((c) => c.id === columnOf(issue)).title}.`, { label: "Open", fn: () => openDrawer(issue.id) });
    }
  }
  function createIssue(fields) {
    const issue = { id: newId(), status: "open", labels: [], deps: [], comments: 0, created: Date.now(), updated: Date.now(), ...fields };
    if (issue.type === "epic") D.epics.push({ id: issue.id, title: issue.title });
    state.issues.push(issue);
    undoStack = null;
    (state.activity[issue.id] ||= []).push({ kind: "event", who: ME.id, when: Date.now(), text: "created the issue" });
    renderAll();
    const card = itemEl(issue.id);
    if (card) { flash(card); card.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    return issue;
  }

  // ---------- snackbar ----------
  const snack = $("#snackbar");
  let snackTimer;
  function snackbar(html, action) {
    clearTimeout(snackTimer);
    $(".snackbar__message", snack).innerHTML = html;
    const btn = $(".snackbar__action", snack);
    btn.hidden = !action;
    btn.textContent = action?.label || "";
    btn.onclick = () => { hideSnack(); action?.fn(); };
    snack.classList.add("snackbar--visible");
    snackTimer = setTimeout(hideSnack, action ? 7000 : 4000);
  }
  function hideSnack() { snack.classList.remove("snackbar--visible"); }
  snack.addEventListener("mouseenter", () => clearTimeout(snackTimer));
  snack.addEventListener("focusin", () => clearTimeout(snackTimer));
  snack.addEventListener("focusout", () => (snackTimer = setTimeout(hideSnack, 3000)));
  snack.addEventListener("mouseleave", () => (snackTimer = setTimeout(hideSnack, 3000)));
  $(".snackbar__close", snack).addEventListener("click", hideSnack);

  // ---------- tooltip ----------
  const tip = $("#tooltip");
  let tipTimer;
  function showTooltip(el) {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      if (state.drag || !el.isConnected) return;
      tip.textContent = el.dataset.tooltip;
      tip.classList.add("tooltip--visible");
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let top = r.bottom + 6;
      if (top + th > window.innerHeight - 8) top = r.top - th - 6;
      tip.style.top = `${top}px`;
      tip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8))}px`;
    }, 450);
  }
  function hideTooltip() { clearTimeout(tipTimer); tip.classList.remove("tooltip--visible"); }
  document.addEventListener("pointerover", (e) => { const el = e.target.closest("[data-tooltip]"); el ? showTooltip(el) : hideTooltip(); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tooltip]"); if (el && e.target.matches(":focus-visible")) showTooltip(el); });
  document.addEventListener("focusout", hideTooltip);
  document.addEventListener("pointerdown", hideTooltip);

  // ---------- ripple ----------
  document.addEventListener("pointerdown", (e) => {
    const host = e.target.closest(".btn, button.chip, .rail__item, .menu__item, .segmented__option, .tabs__tab, .rail__workspace");
    if (!host || host.disabled) return;
    host.classList.add("ripple");
    const r = host.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const dot = document.createElement("span");
    dot.className = "ripple__wave";
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    host.appendChild(dot);
    dot.addEventListener("animationend", () => dot.remove());
  });

  // ---------- misc actions ----------
  function copy(text) {
    navigator.clipboard?.writeText(text).then(
      () => snackbar(`Copied <span class="mono">${esc(text)}</span>`),
      () => snackbar("Couldn't reach the clipboard. Select the text and copy it by hand."),
    );
  }

  function sync() {
    const btn = $("#sync");
    btn.classList.add("app-bar__sync--busy");
    $("#sync-label").textContent = "Syncing…";
    setTimeout(() => {
      btn.classList.remove("app-bar__sync--busy");
      if (state.mode === "error") { $("#sync-label").textContent = "Sync failed"; return; }
      state.lastSync = Date.now();
      updateSyncLabel();
    }, 700);
  }
  function updateSyncLabel() {
    const t = rel(state.lastSync);
    $("#sync-label").textContent = state.mode === "error" ? "Sync failed" : t === "just now" ? "Synced just now" : `Synced ${t}`;
  }

  function setLayout(layout) {
    if (state.layout === layout) return;
    state.layout = layout;
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* storage can be blocked; the choice then lasts one session */ }
    closeMenu();
    clearTimeout(spotTimer);
    renderAll();
  }

  function setMode(mode) {
    $("#proto-state").value = mode;
    if (mode !== "board" && mode !== "error" && state.selected) closeDrawer();
    if (mode === "empty") state.issues = [];
    else if (!state.issues.length) state.issues = structuredClone(D.issues);
    state.mode = mode === "empty" ? "board" : mode;
    updateSyncLabel();
    renderAll();
  }
  function retry() {
    state.mode = "loading";
    renderBoard();
    setTimeout(() => {
      state.issues = state.issues.length ? state.issues : structuredClone(D.issues);
      state.mode = "board";
      state.lastSync = Date.now();
      $("#proto-state").value = "board";
      updateSyncLabel();
      renderAll();
    }, 900);
  }

  // ---------- event wiring ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) {
      const card = e.target.closest(ITEM);
      if (card) openDrawer(card.dataset.id);
      return;
    }
    const a = t.dataset.action;
    const id = t.dataset.id || state.selected;
    switch (a) {
      case "issue-menu": e.stopPropagation(); return openCardMenu(t, t.dataset.id);
      case "filter-menu": return openFilterMenu(t);
      case "clear-filters":
        Object.values(state.filters).forEach((v) => v instanceof Set && v.clear());
        state.filters.q = ""; state.filters.epic = null; state.view = "all"; $("#search").value = "";
        return renderAll();
      case "clear-epic": state.filters.epic = null; return renderAll();
      case "view": state.view = t.dataset.view; $("#app").classList.remove("app--rail-open"); return renderAll();
      case "epic": state.filters.epic = state.filters.epic === t.dataset.epic ? null : t.dataset.epic; $("#app").classList.remove("app--rail-open"); return renderAll();
      case "label": {
        const l = t.dataset.label;
        const only = state.filters.labels.has(l) && state.filters.labels.size === 1;
        state.filters.labels.clear();
        if (!only) state.filters.labels.add(l);
        $("#app").classList.remove("app--rail-open");
        return renderAll();
      }
      case "toggle-deferred": state.deferredOpen = !state.deferredOpen; return renderBoard();
      case "expand-closed": state.closedExpanded = true; return renderBoard();
      case "quick-open": state.quickAdd = true; renderBoard(); return $("#quick-add-input")?.focus();
      case "quick-cancel": state.quickAdd = false; state.quickDraft = ""; renderBoard(); return $('[data-action="quick-open"]')?.focus();
      case "quick-submit": return quickSubmit();
      case "reclaim": e.stopPropagation(); return reclaim(t.dataset.id);
      case "open": return openDrawer(t.dataset.id);
      case "close-drawer": return closeDrawer();
      case "tab":
        state.drawerTab = t.dataset.tab;
        $$(".tabs__tab", drawer).forEach((x) => { const on = x === t; x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; });
        $$(".drawer__panel", drawer).forEach((p) => (p.hidden = p.id !== `panel-${state.drawerTab}`));
        return moveIndicator();
      case "claim": return moveTo(id, "progress");
      case "release": return moveTo(id, "ready");
      case "reopen": return moveTo(id, "ready");
      case "undefer": return moveTo(id, "ready");
      case "close-issue": return openClose(id);
      case "add-blocker": return openBlockerPicker(id);
      case "remove-dep": {
        e.stopPropagation();
        const dep = t.dataset.dep;
        return commit(state.selected, (i) => { i.deps = i.deps.filter((d) => d !== dep); logEvent(i.id, `removed ${dep} as a blocker`); }, `<span class="mono">${dep}</span> no longer blocks <span class="mono">${state.selected}</span>.`);
      }
      case "set-priority": {
        const p = Number(t.dataset.p);
        if (byId(id).priority === p) return;
        return commit(id, (i) => { i.priority = p; logEvent(id, `set priority to P${p}`); }, `Priority set to P${p}.`);
      }
      case "drawer-menu":
        return openMenu(t, `${menuItem({ act: "copy-show" }, "terminal", "Copy bd show command")}
          ${menuItem({ act: "defer" }, "snooze", "Defer…", "", columnOf(byId(id)) === "closed")}
          ${menuItem({ act: "follow" }, "add_link", "New issue blocked by this")}
          <hr class="menu__divider">${menuItem({ act: "delete" }, "delete", "Delete…")}`, {
          align: "end",
          onClick: (d) => {
            closeMenu();
            if (d.act === "copy-show") copy(`bd show ${id}`);
            if (d.act === "defer") openDefer(id);
            if (d.act === "follow") openCreate({ deps: [id], type: "task" });
            if (d.act === "delete") { $("#delete-title").innerHTML = `Delete <span class="mono">${id}</span>?`; $("#dlg-delete").dataset.id = id; $("#dlg-delete").showModal(); }
          },
        });
      case "copy": return copy(t.dataset.copy);
      case "new": return openCreate();
      case "sync": return sync();
      case "retry": return retry();
      case "choose-folder": return snackbar("Folder picking happens in the host app. In this prototype, use Retry.");
      case "rail-toggle":
        if (window.matchMedia("(max-width: 767px)").matches) $("#app").classList.toggle("app--rail-open");
        else $("#app").classList.toggle("app--rail-collapsed");
        return;
      case "layout": return setLayout(t.dataset.layout);
      case "sort": {
        const key = t.dataset.key;
        state.sort = state.sort.key === key
          ? { key, dir: state.sort.dir === "asc" ? "desc" : "asc" }
          : { key, dir: key === "updated" ? "desc" : "asc" };
        return renderAll();
      }
      case "density": state.density = t.dataset.density; $$('[data-action="density"]').forEach((b) => b.setAttribute("aria-checked", b.dataset.density === state.density)); syncRoving(); return renderBoard();
      case "spotlight-toggle":
        state.spotlightOn = !state.spotlightOn;
        t.setAttribute("aria-pressed", state.spotlightOn);
        if (!state.spotlightOn) clearSpotlightClasses(); else if (state.selected) applySpotlight(state.selected);
        return snackbar(state.spotlightOn ? "Dependency highlight on" : "Dependency highlight off");
      case "shortcuts": return $("#dlg-keys").showModal();
      case "workspace": return snackbar("This demo has one workspace. Federated workspaces are deferred (bb-f3d4).");
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "show-closed") { state.showClosed = t.checked; return renderBoard(); }
    if (t.id === "proto-state") return setMode(t.value);
    if (t.dataset.action === "toggle-ac") {
      const issue = byId(state.selected);
      issue.acceptance[Number(t.dataset.i)][1] = t.checked;
      undoStack = null;
      renderDrawer();
      return $(`#drawer [data-action="toggle-ac"][data-i="${t.dataset.i}"]`)?.focus();
    }
    if (t.closest("#drawer") && t.dataset.field && t.tagName === "SELECT") {
      const field = t.dataset.field;
      const val = t.value || null;
      const label = { type: "Type", assignee: "Assignee", epic: "Epic" }[field];
      return commit(state.selected, (i) => { i[field] = field === "type" ? val || "task" : val; logEvent(i.id, `changed ${field}`); }, `${label} updated.`);
    }
  });

  // roving arrows for tabs and segmented radio groups
  document.addEventListener("keydown", (e) => {
    const item = e.target.closest?.(".tabs__tab, .segmented[role='radiogroup'] [role='radio']");
    if (!item || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const group = $$(item.matches(".tabs__tab") ? ".tabs__tab" : "[role='radio']", item.parentElement);
    const i = group.indexOf(item);
    const next = e.key === "Home" ? 0 : e.key === "End" ? group.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + group.length) % group.length;
    e.preventDefault();
    const target = group[next];
    const sel = target.matches(".tabs__tab") ? `.tabs__tab[data-tab="${target.dataset.tab}"]` : null;
    const groupId = item.parentElement.id;
    const p = target.dataset.p, type = target.dataset.type, density = target.dataset.density;
    target.click();
    const fresh = sel ? $(sel, drawer)
      : p !== undefined ? $(`${groupId ? `#${groupId}` : "#drawer"} [data-p="${p}"]`)
      : type ? $(`#create-type [data-type="${type}"]`)
      : density ? $(`[data-density="${density}"]`) : target;
    fresh?.focus();
  });

  // title edit, keyboard activation of list rows
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "drawer-title" && e.key === "Enter") { e.preventDefault(); e.target.blur(); }
    if (e.target.matches?.('li[data-action="open"]') && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDrawer(e.target.dataset.id); }
  });
  document.addEventListener("focusout", (e) => {
    if (e.target.id !== "drawer-title") return;
    const v = e.target.value.trim();
    const issue = byId(state.selected);
    if (!issue) return;
    if (!v) { e.target.value = issue.title; return snackbar("A title can't be empty. Kept the previous one."); }
    if (v !== issue.title) commit(issue.id, (i) => { i.title = v; logEvent(i.id, "renamed the issue"); }, "Title updated.");
  });

  // comment
  document.addEventListener("submit", (e) => {
    if (e.target.dataset.form !== "comment") return;
    e.preventDefault();
    const text = e.target.comment.value.trim();
    if (!text) return e.target.comment.focus();
    const issue = byId(state.selected);
    (state.activity[issue.id] ||= []).push({ kind: "comment", who: ME.id, when: Date.now(), text });
    issue.comments = (issue.comments || 0) + 1;
    undoStack = null;
    renderAll();
    snackbar("Comment added.");
  });

  // board pointer + keyboard
  const board = $("#board");
  board.addEventListener("dragstart", onDragStart);
  board.addEventListener("dragover", onDragOver);
  board.addEventListener("dragleave", (e) => { const col = e.target.closest(".column"); if (col && !col.contains(e.relatedTarget)) col.classList.remove("column--drop-over"); });
  board.addEventListener("drop", onDrop);
  board.addEventListener("dragend", () => { endDrag(); spotlight(null); });
  board.addEventListener("pointerover", (e) => { const c = e.target.closest(ITEM); if (c) spotlight(c.dataset.id); });
  board.addEventListener("pointerleave", () => spotlight(null));
  board.addEventListener("pointerout", (e) => { const c = e.target.closest(ITEM); if (c && !c.contains(e.relatedTarget)) spotlight(null); });
  board.addEventListener("focusin", (e) => {
    const c = e.target.closest(ITEM);
    if (!c) return;
    if (c.matches(".data-table__row")) $$("#board .data-table__row").forEach((r) => (r.tabIndex = r === c ? 0 : -1));
    spotlight(c.dataset.id);
  });
  board.addEventListener("focusout", (e) => { if (!board.contains(e.relatedTarget)) spotlight(null); });
  board.addEventListener("input", (e) => { if (e.target.id === "quick-add-input") state.quickDraft = e.target.value; });

  function cardGrid() {
    return $$("#board .column[data-col]").map((col) => $$(".issue-card[data-id]", col));
  }
  board.addEventListener("keydown", (e) => {
    const card = e.target.closest(".issue-card[data-id]");
    if (e.target.id === "quick-add-input") {
      if (e.key === "Escape") { state.quickAdd = false; state.quickDraft = ""; renderBoard(); $('[data-action="quick-open"]')?.focus(); }
      if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); const title = e.target.value.trim(); state.quickAdd = false; state.quickDraft = ""; renderBoard(); openCreate({ title }); }
      else if (e.key === "Enter") { e.preventDefault(); quickSubmit(); }
      return;
    }
    const row = e.target.closest(".data-table__row[data-id]");
    if (row && e.target === row) {
      const rows = $$("#board .data-table__row[data-id]");
      const i = rows.indexOf(row);
      const go = (r) => r && (e.preventDefault(), r.focus());
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(row.dataset.id); }
      if (e.key === "ArrowDown") go(rows[i + 1]);
      if (e.key === "ArrowUp") go(rows[i - 1]);
      if (e.key === "Home") go(rows[0]);
      if (e.key === "End") go(rows[rows.length - 1]);
      if (e.key === "PageDown") go(rows[Math.min(i + 10, rows.length - 1)]);
      if (e.key === "PageUp") go(rows[Math.max(i - 10, 0)]);
      if (e.key.toLowerCase() === "m") { e.preventDefault(); openCardMenu(row.querySelector(".data-table__menu"), row.dataset.id); }
      return;
    }
    if (!card || e.target !== card) return;
    const grid = cardGrid();
    const ci = grid.findIndex((col) => col.includes(card));
    const ri = grid[ci].indexOf(card);
    const focus = (c) => c && (e.preventDefault(), c.focus());
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(card.dataset.id); }
    if (e.key === "ArrowDown") focus(grid[ci][ri + 1]);
    if (e.key === "ArrowUp") focus(grid[ci][ri - 1]);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const step = e.key === "ArrowRight" ? 1 : -1;
      for (let j = ci + step; j >= 0 && j < grid.length; j += step) if (grid[j].length) { focus(grid[j][Math.min(ri, grid[j].length - 1)]); break; }
    }
    if (e.key.toLowerCase() === "m") { e.preventDefault(); openCardMenu(card.querySelector(".issue-card__menu"), card.dataset.id); }
  });

  function quickSubmit() {
    const input = $("#quick-add-input");
    const title = input?.value.trim();
    if (!title) { input?.focus(); return; }
    state.quickDraft = "";
    const issue = createIssue({ title, type: "task", priority: 2, epic: state.filters.epic || null });
    state.quickAdd = true;
    renderBoard();
    $("#quick-add-input")?.focus();
    snackbar(`Created <span class="mono">${issue.id}</span>.`, { label: "Open", fn: () => openDrawer(issue.id) });
  }

  // global shortcuts
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, textarea, select, [contenteditable]");
    if (e.key === "Escape") {
      if (document.querySelector("dialog[open]") || menuEl.matches(":popover-open")) return;
      if (state.selected) { e.preventDefault(); closeDrawer(); return; }
      if ($("#app").classList.contains("app--rail-open")) { $("#app").classList.remove("app--rail-open"); $('[data-action="rail-toggle"]').focus(); }
      return;
    }
    if (!typing && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && undoStack && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      restore(undoStack);
      undoStack = null;
      return snackbar("Undone");
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
    if (e.key === "n" || e.key === "N") { e.preventDefault(); openCreate(); }
    if (e.key === "v" || e.key === "V") { e.preventDefault(); setLayout(state.layout === "board" ? "table" : "board"); }
    if (e.key === "?") { e.preventDefault(); $("#dlg-keys").showModal(); }
  });

  // search
  const search = $("#search");
  search.addEventListener("input", () => {
    state.filters.q = search.value;
    $("#search-clear").hidden = !search.value;
    renderFilters();
    renderBoard();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { search.value = ""; search.dispatchEvent(new Event("input")); search.blur(); }
    if (e.key === "Enter") { e.preventDefault(); $(`#board ${ITEM.split(", ").join(", #board ")}`)?.focus(); }
  });
  $("#search-clear").addEventListener("click", () => { search.value = ""; search.dispatchEvent(new Event("input")); search.focus(); });

  // blocker dialog wiring
  $("#blocker-q").addEventListener("input", renderBlockerOptions);
  $("#blocker-q").addEventListener("keydown", (e) => {
    const opts = $$("#blocker-list .autocomplete__option:not([aria-disabled='true'])");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      blockerActive = (blockerActive + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => { o.classList.toggle("autocomplete__option--active", i === blockerActive); o.setAttribute("aria-selected", i === blockerActive); });
      if (opts[blockerActive]) { $("#blocker-q").setAttribute("aria-activedescendant", opts[blockerActive].id); opts[blockerActive].scrollIntoView({ block: "nearest" }); }
    }
    if (e.key === "Enter") { e.preventDefault(); const o = opts[Math.max(0, blockerActive)]; if (o) chooseBlocker(o.dataset.id); }
  });
  $("#blocker-list").addEventListener("click", (e) => {
    const o = e.target.closest(".autocomplete__option");
    if (o && o.getAttribute("aria-disabled") !== "true") chooseBlocker(o.dataset.id);
  });

  // defer dialog
  $("#defer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.submitter?.value === "cancel") return dlgDefer.close();
    const id = dlgDefer.dataset.id;
    const until = deferUntil();
    if (!until || Number.isNaN(until) || until < Date.now()) { $("#defer-date").focus(); return snackbar("Pick a date in the future."); }
    dlgDefer.close();
    commit(id, (i) => { if (i.status === "in_progress") { i.assignee = null; i.heartbeat = null; } i.status = "deferred"; i.deferUntil = until; logEvent(id, `deferred until ${fmtDate(until)}`); }, `Deferred <span class="mono">${id}</span> until ${fmtDate(until)}.`);
  });
  $$("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $("#defer-date").addEventListener("focus", () => ($('input[value="date"]', dlgDefer).checked = true));

  // close dialog
  $("#close-reason").addEventListener("input", updateCloseCmd);
  $("#close-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.submitter?.value === "cancel") return dlgClose.close();
    const id = dlgClose.dataset.id;
    const reason = $("#close-reason").value.trim();
    dlgClose.close();
    commit(id, (i) => { i.status = "closed"; i.closed = Date.now(); if (reason) i.closeReason = reason; logEvent(id, reason ? `closed the issue: ${reason}` : "closed the issue"); }, `Closed <span class="mono">${id}</span>.`);
  });

  // delete dialog
  $("#delete-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const dlg = $("#dlg-delete");
    if (e.submitter?.value === "cancel") return dlg.close();
    const id = dlg.dataset.id;
    dlg.close();
    const snap = snapshot();
    state.issues = state.issues.filter((i) => i.id !== id).map((i) => ({ ...i, deps: i.deps.filter((d) => d !== id) }));
    closeDrawer();
    renderAll();
    undoStack = snap;
    snackbar(`Deleted <span class="mono">${id}</span> and its links.`, { label: "Undo", fn: () => { restore(undoStack); undoStack = null; } });
  });

  // create dialog
  const cf = $("#create-form");
  cf.addEventListener("submit", (e) => { if (e.submitter?.value === "cancel") { e.preventDefault(); return dlgCreate.close(); } submitCreate(e); });
  cf.addEventListener("input", (e) => {
    if (e.target.name === "title" && e.target.value.trim()) { $("#create-title-field").classList.remove("field--error"); $("#create-title-help").textContent = "Imperative and specific: what should be true when it's done."; }
    if (e.target.id === "create-deps-q") renderCreateSuggestions();
    updateCreateCmd();
  });
  cf.addEventListener("change", updateCreateCmd);
  cf.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitCreate(); }
    if (e.target.id === "create-deps-q" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const opts = $$("#create-deps-list .autocomplete__option:not([aria-disabled='true'])");
      if (!opts.length) return;
      depsActive = (depsActive + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => { o.classList.toggle("autocomplete__option--active", i === depsActive); o.setAttribute("aria-selected", String(i === depsActive)); });
      e.target.setAttribute("aria-activedescendant", opts[depsActive].id);
    }
    if (e.target.id === "create-deps-q" && e.key === "Enter") {
      e.preventDefault();
      const opts = $$("#create-deps-list .autocomplete__option:not([aria-disabled='true'])");
      const o = opts[Math.max(0, depsActive)];
      if (o) { createState.deps.push(o.dataset.id); e.target.value = ""; renderCreateControls(); e.target.focus(); }
    }
  });
  $("#create-type").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) { createState.type = b.dataset.type; renderCreateControls(); } });
  $("#create-priority").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) { createState.priority = Number(b.dataset.p); renderCreateControls(); } });
  $("#create-deps").addEventListener("click", (e) => { const b = e.target.closest("[data-remove]"); if (b) { createState.deps = createState.deps.filter((d) => d !== b.dataset.remove); renderCreateControls(); } });
  $("#create-deps-list").addEventListener("click", (e) => {
    const o = e.target.closest(".autocomplete__option");
    if (!o || o.getAttribute("aria-disabled") === "true") return;
    createState.deps.push(o.dataset.id);
    $("#create-deps-q").value = "";
    renderCreateControls();
    $("#create-deps-q").focus();
  });

  // dialogs close on backdrop click
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  window.addEventListener("resize", () => { closeMenu(); moveIndicator(); });
  setInterval(updateSyncLabel, 30000);

  // ---------- boot ----------
  state.mode = "loading";
  renderAll();
  setTimeout(() => { state.mode = "board"; updateSyncLabel(); renderAll(); }, 650);
})();
