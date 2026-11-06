// The tray plugin, shared by both host pages. Synthetic data from ../js/data.js; nothing here talks to bd.
// The host page owns the chrome (menu bar, Waybar, windows) and provides:
//   body[data-host="macos"|"omarchy"], #tray-item (the bar item), #tray-host (panel mount),
//   [data-term="ready"] (optional terminal backdrop). Everything else is injected here.
(() => {
  "use strict";

  const D = window.BEADS_DEMO;
  const HOST = document.body.dataset.host;
  const SHADE = HOST === "omarchy";
  const STALE_AFTER = 30 * 60 * 1000;
  const MIN = 60 * 1000;

  const TYPES = {
    task: { icon: "task_alt", label: "Task" }, bug: { icon: "bug_report", label: "Bug" }, feature: { icon: "lightbulb", label: "Feature" },
    chore: { icon: "handyman", label: "Chore" }, epic: { icon: "stacks", label: "Epic" }, decision: { icon: "gavel", label: "Decision" },
    spike: { icon: "science", label: "Spike" }, story: { icon: "auto_stories", label: "Story" }, milestone: { icon: "flag", label: "Milestone" },
  };
  const PRIORITY_NAMES = ["Critical", "High", "Medium", "Low", "Backlog"];
  const TABS = [["ready", "Ready"], ["progress", "Active"], ["blocked", "Blocked"]];
  const ME = Object.values(D.people).find((p) => p.me);
  const NARROW = window.matchMedia("(max-width: 899px)");
  const inlineMode = () => !SHADE || NARROW.matches;   // detail shown under the row instead of beside the list

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
  const icon = (n, x = "") => `<svg class="icon ${x}" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
  const shellQuote = (s) => `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`;
  function rel(ts) {
    const m = Math.round(Math.abs(Date.now() - ts) / MIN);
    if (m < 1) return "just now";
    return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  }
  const person = (id) => D.people[id];
  function avatar(pid) {
    const p = person(pid);
    if (!p) return `<span class="avatar avatar--empty" title="Unassigned">${icon("person")}</span>`;
    if (p.kind === "agent") return `<span class="avatar avatar--agent" title="${esc(p.name)} (agent)"><svg class="icon" aria-hidden="true"><use href="#a-${p.brand}"></use></svg></span>`;
    return `<span class="avatar" title="${esc(p.name)}">${esc(p.initials)}</span>`;
  }

  // ---------- state ----------
  let issues = [];
  const state = { scene: "open", lastOpen: "open", returnTo: "closed", tab: "ready", selected: null, q: "", unblocked: [], lastSync: Date.now() - 2 * MIN, syncing: false, cap: null, undo: null, alerted: false };

  const byId = (id) => issues.find((i) => i.id === id);
  const openBlockers = (i) => i.deps.map(byId).filter((d) => d && d.status !== "closed");
  const dependents = (i) => issues.filter((d) => d.deps.includes(i.id));
  const isStale = (i) => i.status === "in_progress" && i.heartbeat && Date.now() - i.heartbeat > STALE_AFTER;
  function columnOf(i) {
    if (i.status === "closed") return "closed";
    if (i.status === "deferred") return "deferred";
    if (i.status === "blocked" || openBlockers(i).length) return "blocked";
    if (i.status === "in_progress") return "progress";
    return "ready";
  }
  const readyIds = () => new Set(issues.filter((i) => columnOf(i) === "ready").map((i) => i.id));
  const epicOf = (i) => D.epics.find((e) => e.id === i.epic);

  function listFor(tab, query = state.q) {
    const q = query.trim().toLowerCase();
    return issues
      .filter((i) => i.type !== "epic" && columnOf(i) === tab)
      .filter((i) => !q || `${i.id} ${i.title} ${i.labels.join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => a.priority - b.priority || (tab === "progress" ? (b.updated || 0) - (a.updated || 0) : (a.created || 0) - (b.created || 0)));
  }
  const counts = () => Object.fromEntries(TABS.map(([t]) => [t, issues.filter((i) => i.type !== "epic" && columnOf(i) === t).length]));

  function fresh(scene) {
    issues = scene === "empty" ? [] : structuredClone(D.issues);
    state.unblocked = [];
    state.q = "";
    state.tab = "ready";
    state.selected = null;
    if (scene === "quiet") { const i = byId("bb-0d93"); if (i) i.heartbeat = Date.now() - 4 * MIN; }   // no stale lease, so the bar item has no dot
    if (scene === "notify") mutate("bb-1e9a", (i) => { i.status = "closed"; i.closed = Date.now(); }, "grok");
    state.undo = null;
    state.selected = listFor("ready")[0]?.id || null;
  }

  // a change to one issue; newly ready issues are remembered for the attention strip
  function mutate(id, fn, byAgent) {
    const before = readyIds();
    const issue = byId(id);
    state.undo = { issues: structuredClone(issues), unblocked: structuredClone(state.unblocked) };
    fn(issue);
    issue.updated = Date.now();
    const now = issues.filter((i) => i.type !== "epic" && columnOf(i) === "ready" && !before.has(i.id) && i.id !== id);
    now.forEach((i) => state.unblocked.push({ id: i.id, by: id, who: byAgent || ME.id }));
    state.unblocked = state.unblocked.filter((u) => columnOf(byId(u.id)) === "ready");
    return now;
  }

  // ---------- focus-preserving render ----------
  let focusKey = null;
  function remember() {
    const el = document.activeElement;
    if (!el || !$("#tray-host").contains(el)) { focusKey = null; return; }
    const k = el.closest("[data-k]");
    focusKey = k ? { k: k.dataset.k, start: k.selectionStart, end: k.selectionEnd } : null;
  }
  function restore() {
    if (!focusKey) return;
    const el = $(`#tray-host [data-k="${CSS.escape(focusKey.k)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (focusKey.start != null && el.setSelectionRange) try { el.setSelectionRange(focusKey.start, focusKey.end); } catch { /* not a text field */ }
  }

  // ---------- panel markup ----------
  const kbd = (k) => `<kbd class="kbd">${k === "cmd" ? icon("keyboard_command_key") : esc(k)}</kbd>`;
  const hint = (keys, label) => `<span class="tray-panel__hint">${keys.map(kbd).join("")}${esc(label)}</span>`;
  const HINTS = SHADE
    ? [hint(["j", "k"], "move"), hint(["c"], "claim"), hint(["x"], "close"), hint(["n"], "new"), hint(["Esc"], "hide")]
    : [hint(["Enter"], "expand"), hint(["n"], "new"), hint(["Esc"], "hide")];

  function rowHTML(i, tab, tabStop) {
    const type = TYPES[i.type] || TYPES.task;
    const epic = epicOf(i);
    const sel = state.selected === i.id;
    const blockers = openBlockers(i);
    const stale = isStale(i);
    const meta = [`<span class="mono">${i.id}</span>`];
    if (tab === "blocked") meta.push(`<span class="tray-row__flag">${icon("lock")}Waiting on <span class="mono">${blockers[0]?.id || "hand"}</span>${blockers.length > 1 ? ` +${blockers.length - 1}` : ""}</span>`);
    else if (stale) meta.push(`<span class="tray-row__flag">${icon("hourglass_disabled")}No heartbeat ${rel(i.heartbeat)}</span>`);
    else if (tab === "progress" && i.heartbeat) meta.push(`<span class="tray-row__flag">${icon("ecg_heart")}${rel(i.heartbeat)}</span>`);
    else if (epic) meta.push(`<span class="tray-row__epic">${esc(epic.title)}</span>`);
    const paused = state.scene === "error" ? "disabled" : "";
    const acts = tab === "ready"
      ? `<button class="btn btn--icon btn--sm" type="button" data-act="claim" data-id="${i.id}" title="Claim: bd update ${i.id} --claim" aria-label="Claim ${i.id}" data-k="ra:${i.id}:claim" ${paused}>${icon("play_arrow")}</button>`
      : tab === "progress" ? (stale ? `<button class="btn btn--icon btn--sm" type="button" data-act="reclaim" data-id="${i.id}" title="Reclaim lease: bd reclaim ${i.id}" aria-label="Reclaim ${i.id}" data-k="ra:${i.id}:reclaim" ${paused}>${icon("hourglass_disabled")}</button>` : "")
      : "";
    const closeBtn = tab !== "blocked" ? `<button class="btn btn--icon btn--sm" type="button" data-act="close" data-id="${i.id}" title="Close: bd close ${i.id}" aria-label="Close ${i.id}" data-k="ra:${i.id}:close" ${paused}>${icon("check")}</button>` : "";
    return `<li class="tray-row ${sel ? "tray-row--selected" : ""}" ${sel ? 'aria-current="true"' : ""} tabindex="${i.id === tabStop ? 0 : -1}" data-k="row:${i.id}" data-id="${i.id}" data-act="select">
      <span class="tray-row__prio"><span class="chip chip--priority chip--p${i.priority}" title="P${i.priority} ${PRIORITY_NAMES[i.priority]}">P${i.priority}</span></span>
      <span class="tray-row__body"><span class="tray-row__title">${esc(i.title)}</span><span class="tray-row__meta" title="${type.label}">${meta.join("")}</span></span>
      <span class="tray-row__who">${avatar(i.assignee)}</span>
      <span class="tray-row__actions">${acts}${closeBtn}</span>
      ${sel && inlineMode() ? `<div class="tray-row__detail">${inlineDetail(i)}</div>` : ""}
    </li>`;
  }

  function threadItem(i, cls = "") {
    const bead = i.status === "closed" ? "bead--done" : i.status === "in_progress" ? "bead--active" : "";
    const st = { closed: "Closed", in_progress: "In progress", deferred: "Deferred" }[i.status] || (openBlockers(i).length ? "Blocked" : "Ready");
    return `<li class="bead-thread__item ${cls || "bead-thread__item--link"}" ${cls ? "" : `data-act="jump" data-id="${i.id}" data-k="jump:${i.id}" tabindex="0"`}>
      <span class="bead-thread__node"><span class="bead ${bead}"></span></span>
      <span class="bead-thread__body"><span class="bead-thread__title">${esc(i.title)}</span><span class="bead-thread__meta"><span class="mono">${i.id}</span><span>${st}</span>${i.assignee ? `<span>${esc(person(i.assignee).name)}</span>` : ""}</span></span>
      <span class="chip chip--priority chip--p${i.priority}">P${i.priority}</span></li>`;
  }
  function chain(i) {
    const ups = i.deps.map(byId).filter(Boolean);
    const downs = dependents(i);
    if (!ups.length && !downs.length) return "";
    return `<ul class="bead-thread">
      ${ups.length ? `<li class="bead-thread__group">Blocked by · ${openBlockers(i).length} open of ${ups.length}</li>` : ""}
      ${ups.map((u) => threadItem(u)).join("")}
      ${threadItem(i, "bead-thread__item--current")}
      ${downs.length ? `<li class="bead-thread__group">Blocks · ${downs.length}</li>` : ""}
      ${downs.map((d) => threadItem(d)).join("")}</ul>`;
  }

  function primaryActions(i, small) {
    const col = columnOf(i);
    const sz = small ? "btn--sm" : "";
    const paused = state.scene === "error" ? "disabled" : "";
    const CMD = { claim: `bd update ${i.id} --claim`, close: `bd close ${i.id}`, reclaim: `bd reclaim ${i.id}`, reopen: `bd reopen ${i.id}`, board: `bd dep tree ${i.id}` };
    const b = (cls, act, ic, label) => `<button class="btn ${cls} ${sz}" type="button" data-act="${act}" data-id="${i.id}" data-k="act:${act}" title="${CMD[act]}" ${paused}>${icon(ic, "btn__icon")}${label}</button>`;
    if (col === "ready") return b("btn--primary", "claim", "play_arrow", "Claim") + b("btn--secondary", "close", "check", "Close");
    if (col === "progress") return (isStale(i) ? b("btn--primary", "reclaim", "hourglass_disabled", "Reclaim lease") : b("btn--primary", "close", "check", "Close")) + (isStale(i) ? b("btn--secondary", "close", "check", "Close") : "");
    if (col === "blocked") return b("btn--secondary", "board", "account_tree", "See chain");
    if (col === "closed") return b("btn--secondary", "reopen", "undo", "Reopen");
    return "";
  }

  function primaryCommand(i) {
    const col = columnOf(i);
    return col === "ready" ? `bd update ${i.id} --claim` : col === "progress" ? (isStale(i) ? `bd reclaim ${i.id}` : `bd close ${i.id}`) : col === "closed" ? `bd reopen ${i.id}` : `bd show ${i.id}`;
  }

  function inlineDetail(i) {
    return `${i.description ? `<p class="tray-row__text">${inline(i.description)}</p>` : ""}
      ${chain(i)}
      <div class="tray-row__buttons">${primaryActions(i, true)}<button class="btn btn--text btn--sm" type="button" data-act="board" data-k="act:board">${icon("open_in_new", "btn__icon")}Open in board</button></div>`;
  }

  function detailHTML() {
    if (state.scene === "loading") return `<aside class="tray-detail" aria-hidden="true"><span class="skeleton" style="width:40%;height:14px"></span><span class="skeleton" style="width:80%;height:20px"></span><span class="skeleton" style="width:55%;height:36px"></span><span class="skeleton" style="width:90%;height:14px"></span><span class="skeleton" style="width:70%;height:14px"></span></aside>`;
    const i = byId(state.selected);
    if (!i) return `<aside class="tray-detail"><div class="empty-state tray-detail__empty"><h2 class="empty-state__title">${issues.length ? "Select an issue" : "No issues yet"}</h2><p class="empty-state__text">${issues.length ? "Its description, blockers and dependents show up here." : "Type a title in the field on the left and press Enter, or press n."}</p></div></aside>`;
    const type = TYPES[i.type] || TYPES.task;
    const col = columnOf(i);
    const label = { ready: "Ready", progress: "In progress", blocked: "Blocked", closed: "Closed", deferred: "Deferred" }[col];
    const glyph = { ready: '<span class="bead"></span>', progress: '<span class="bead bead--active"></span>', blocked: icon("lock"), closed: '<span class="bead bead--done"></span>', deferred: icon("snooze") }[col];
    const epic = epicOf(i);
    return `<aside class="tray-detail" aria-label="Issue details">
      <div class="tray-detail__top">${icon(type.icon)}<span class="mono">${i.id}</span><span class="chip chip--priority chip--p${i.priority}">P${i.priority}</span>
        <button class="btn btn--icon btn--sm" type="button" data-act="copy" data-copy="${i.id}" data-k="copyid" aria-label="Copy ID" title="Copy ID">${icon("content_copy")}</button></div>
      <h2 class="tray-detail__title">${esc(i.title)}</h2>
      <div class="tray-detail__actions">${primaryActions(i, false)}<button class="btn btn--text" type="button" data-act="board" data-k="act:board">${icon("open_in_new", "btn__icon")}Open in board</button></div>
      <dl class="meta-list">
        <dt class="meta-list__key">Status</dt><dd class="meta-list__value"><span class="glyph glyph--lg">${glyph}</span>${label}${i.heartbeat && col === "progress" ? ` · heartbeat ${rel(i.heartbeat)} ago` : ""}</dd>
        <dt class="meta-list__key">Assignee</dt><dd class="meta-list__value">${avatar(i.assignee)}${i.assignee ? esc(person(i.assignee).name) : '<span class="tray-detail__muted">Unassigned</span>'}</dd>
        ${epic ? `<dt class="meta-list__key">Epic</dt><dd class="meta-list__value"><span class="glyph glyph--lg">${icon("stacks")}</span>${esc(epic.title)}</dd>` : ""}
        ${i.estimate ? `<dt class="meta-list__key">Estimate</dt><dd class="meta-list__value">${i.estimate >= 60 ? `${+(i.estimate / 60).toFixed(1)}h` : `${i.estimate}m`}</dd>` : ""}
      </dl>
      ${i.description ? `<section class="tray-detail__section"><h3 class="tray-detail__heading">Description</h3><p class="tray-detail__prose">${inline(i.description)}</p></section>` : ""}
      ${chain(i) ? `<section class="tray-detail__section"><h3 class="tray-detail__heading">Chain</h3>${chain(i)}</section>` : ""}
      <div class="command"><span class="command__text mono"><span class="command__prompt">$ </span>${esc(primaryCommand(i))}</span>
        <button class="btn btn--icon btn--sm" type="button" data-act="copy" data-copy="${esc(primaryCommand(i))}" data-k="copycmd" aria-label="Copy command">${icon("content_copy")}</button></div>
    </aside>`;
  }

  function attentionItems() {
    const items = [];
    state.unblocked.slice().reverse().forEach((u) => {
      const i = byId(u.id);
      if (i && columnOf(i) === "ready") items.push(`<div class="tray-attention"><span class="glyph glyph--lg"><span class="bead"></span></span>
        <div class="tray-attention__body"><span class="tray-attention__title"><span class="mono">${i.id}</span> is ready now</span><span class="tray-attention__detail">${esc(person(u.who)?.name || "Someone")} closed <span class="mono">${u.by}</span></span></div>
        <button class="btn btn--primary btn--sm" type="button" data-act="claim" data-id="${i.id}" data-k="att:${i.id}:claim" title="bd update ${i.id} --claim">Claim</button>
        <button class="btn btn--icon btn--sm" type="button" data-act="dismiss" data-id="${i.id}" data-k="att:${i.id}:dismiss" aria-label="Dismiss">${icon("close")}</button></div>`);
    });
    issues.filter(isStale).forEach((i) => items.push(`<div class="tray-attention">${icon("hourglass_disabled")}
      <div class="tray-attention__body"><span class="tray-attention__title">${esc(person(i.assignee).name)} stopped sending heartbeats</span><span class="tray-attention__detail"><span class="mono">${i.id}</span> · last seen ${rel(i.heartbeat)} ago</span></div>
      <button class="btn btn--secondary btn--sm" type="button" data-act="reclaim" data-id="${i.id}" data-k="att:${i.id}:reclaim" title="bd reclaim ${i.id}">Reclaim</button></div>`));
    return items;
  }
  function attentionHTML() {
    const items = attentionItems();
    return items.length ? `<div class="tray-panel__attention">${items.slice(0, 2).join("")}</div>` : "";
  }

  function listHTML() {
    if (state.scene === "loading") {
      return [88, 64, 78, 52].map((w) => `<li class="tray-row tray-row--skeleton" aria-hidden="true"><span class="tray-row__prio"><span class="skeleton" style="width:28px;height:20px"></span></span>
        <span class="tray-row__body"><span class="skeleton" style="width:${w}%;height:14px"></span><span class="skeleton" style="width:40%;height:12px;margin-top:4px"></span></span>
        <span class="tray-row__who"><span class="skeleton" style="width:24px;height:24px;border-radius:50%"></span></span></li>`).join("");
    }
    const list = listFor(state.tab);
    const create = state.q.trim() ? `<li><button class="tray-create" type="button" data-act="create" data-k="create"><span class="chip chip--priority chip--p2">P2</span><span class="tray-create__text">Create “${esc(state.q.trim())}”</span>${kbd("Enter")}</button></li>` : "";
    if (!list.length) {
      const total = counts();
      const none = !issues.length;
      const msg = state.q.trim() ? ["No match", "Nothing here contains that. Press Enter to create it."]
        : none ? ["No issues yet", "Type a title above and press Enter. It lands in Ready when nothing blocks it."]
        : state.tab === "ready" ? ["Nothing is ready", total.blocked ? `Every open issue waits on another one. ${total.blocked} in Blocked.` : "Create an issue to get started."]
        : state.tab === "progress" ? ["Nothing is active", "Claim a ready issue and it shows up here."]
        : ["Nothing is blocked", "Issues that wait on an open blocker show up here."];
      return create + `<li class="empty-state tray-list__empty"><h2 class="empty-state__title">${msg[0]}</h2><p class="empty-state__text">${msg[1]}</p></li>`;
    }
    const tabStop = list.some((i) => i.id === state.selected) ? state.selected : list[0].id;
    return create + list.map((i) => rowHTML(i, state.tab, tabStop)).join("");
  }

  function panelHTML() {
    const c = counts();
    const loading = state.scene === "loading";
    const error = state.scene === "error";
    const sync = loading || state.syncing ? "Syncing…" : error ? "Sync failed" : `Synced ${rel(state.lastSync)} ago`;
    const header = `<header class="tray-panel__header">
      <button class="tray-panel__workspace" type="button" data-act="stub" data-k="ws"><span class="tray-panel__workspace-glyph" aria-hidden="true">bb</span>beads-board${icon("arrow_drop_down")}</button>
      <span class="tray-panel__sync" aria-live="polite">${sync}</span>
      <button class="btn btn--icon btn--sm" type="button" data-act="sync" data-k="sync" aria-label="Sync now" title="Sync now">${icon("sync")}</button>
      <button class="btn btn--icon btn--sm" type="button" data-act="board" data-k="board" aria-label="Open the full board" title="Open the full board">${icon("open_in_new")}</button>
      <button class="btn btn--icon btn--sm" type="button" data-act="stub" data-k="settings" aria-label="Settings" title="Settings">${icon("settings")}</button></header>`;
    const capture = `<div class="tray-panel__capture"><div class="search" role="search">
      ${icon("search", "search__icon")}<label class="visually-hidden" for="tray-q">Search issues or add one</label>
      <input class="search__input" id="tray-q" data-k="q" type="search" autocomplete="off" spellcheck="false" placeholder="Search, or type a title to add" value="${esc(state.q)}">
      <kbd class="kbd search__kbd" aria-hidden="true">/</kbd></div></div>`;
    const alertAttr = state.alerted ? "" : 'role="alert"';
    if (error) state.alerted = true;
    const banner = error ? `<div class="tray-panel__banner"><div class="banner" ${alertAttr}>${icon("sync_problem", "banner__icon")}
      <div class="banner__text"><div class="banner__title">Can't read the beads database</div><div class="banner__detail">Locked by another process. Showing the last read; actions are paused.</div></div>
      <button class="btn btn--primary btn--sm" type="button" data-act="retry" data-k="retry">Retry</button></div></div>` : "";
    const tabs = `<div class="tray-panel__tabs"><div class="tabs" role="tablist" aria-label="Queues">${TABS.map(([k, l]) =>
      `<button class="tabs__tab" type="button" role="tab" aria-selected="${state.tab === k}" tabindex="${state.tab === k ? 0 : -1}" aria-controls="tray-list" data-act="tab" data-tab="${k}" data-k="tab:${k}">${l}<span class="tabs__count">${loading ? "·" : c[k]}</span></button>`).join("")}
      <span class="tabs__indicator"></span></div></div>`;
    const main = `<div class="tray-panel__main">${capture}${banner}${loading ? "" : attentionHTML()}${tabs}
      <div class="tray-panel__list" role="tabpanel" id="tray-list" aria-label="${TABS.find((t) => t[0] === state.tab)[1]} issues" ${loading ? 'aria-busy="true"' : ""}><ul class="tray-list">${listHTML()}</ul></div></div>`;
    const footer = `<footer class="tray-panel__footer"><span class="tray-panel__command mono"><span>$</span>bd ${state.tab === "ready" ? "ready" : state.tab === "progress" ? "list -s in_progress" : "blocked"}</span>
      <span class="tray-panel__hints">${HINTS.join("")}</span></footer>`;
    return `<section class="tray-panel ${SHADE ? "tray-panel--shade" : ""} ${error ? "tray-panel--error" : ""}" >${header}${main}${SHADE ? detailHTML() : ""}${footer}</section>`;
  }

  // ---------- bar item ----------
  function renderBar() {
    const item = $("#tray-item");
    if (!item) return;
    const c = counts();
    const ready = c.ready;
    const attn = attentionItems().length;
    const quiet = state.scene === "error" || !issues.length;
    const week = Date.now() - 7 * 24 * 60 * MIN;
    const on = { done: !quiet && issues.some((i) => i.status === "closed" && i.closed > week), active: !quiet && c.progress > 0, open: !quiet && ready > 0 };
    $$("[data-bead]", item).forEach((b) => {
      const k = b.dataset.bead;
      b.classList.toggle("bead--done", k === "done");
      b.classList.toggle("bead--active", k === "active");
      b.classList.toggle("tray-mark__bead--off", !on[k]);
    });
    $("[data-tray-count]", item).textContent = state.scene === "loading" ? "·" : ready;
    $("[data-tray-dot]", item).hidden = !attn;
    item.setAttribute("aria-label", `beads: ${ready} ready${attn ? `, ${attn} need attention` : ""}`);
    item.setAttribute("aria-expanded", String(isOpen()));
  }

  const isOpen = () => ["open", "loading", "empty", "error"].includes(state.scene);
  function render() {
    document.body.dataset.scene = state.scene;
    const host = $("#tray-host");
    host.classList.toggle("tray-host--open", isOpen());
    if (isOpen()) {
      remember();
      const scroll = [".tray-list", ".tray-detail"].map((sel) => $(sel, host)?.scrollTop || 0);
      host.innerHTML = panelHTML();
      [".tray-list", ".tray-detail"].forEach((sel, n) => { const el = $(sel, host); if (el) el.scrollTop = scroll[n]; });
      placeIndicator();
      place();
      restore();
    }
    renderBar();
    renderTerminals();
    const sel = $("#proto-scene");
    if (sel && sel.value !== state.scene) sel.value = state.scene;
  }

  // typing in the field only swaps the parts it affects, so the input keeps its caret, IME state and undo stack
  function refreshParts() {
    const host = $("#tray-host");
    const tmp = document.createElement("div");
    tmp.innerHTML = panelHTML();
    [".tray-panel__tabs", ".tray-panel__list", ".tray-detail"].forEach((sel) => { const n = $(sel, tmp); const o = $(sel, host); if (n && o) o.replaceWith(n); });
    placeIndicator();
    renderBar();
    renderTerminals();
  }

  function placeIndicator() {
    const t = $("#tray-host .tabs__tab[aria-selected='true']");
    const ind = $("#tray-host .tabs__indicator");
    if (t && ind) { ind.style.width = `${t.offsetWidth}px`; ind.style.transform = `translateX(${t.offsetLeft}px)`; }
  }

  function place() {
    const host = $("#tray-host");
    const item = $("#tray-item");
    if (SHADE) return;
    const r = item.getBoundingClientRect();
    const w = Math.min(400, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    host.style.left = `${left}px`;
    host.style.transformOrigin = `${r.left + r.width / 2 - left}px 0`;
  }

  // ---------- terminal backdrop ----------
  function renderTerminals() {
    const pre = $("[data-term='ready']");
    if (!pre) return;
    const rows = listFor("ready", "").slice(0, 7);
    const pad = (s, n) => String(s).padEnd(n);
    pre.innerHTML = `<span class="term__prompt">~/code/beads-board $</span> bd ready\n`
      + `<span class="term__dim">${pad("ID", 9)}${pad("P", 4)}${pad("TYPE", 9)}TITLE</span>\n`
      + (rows.length ? rows.map((i) => `${pad(i.id, 9)}${pad("P" + i.priority, 4)}${pad(i.type, 9)}${esc(i.title.length > 44 ? i.title.slice(0, 43) + "…" : i.title)}`).join("\n") : '<span class="term__dim">no ready issues</span>')
      + `\n\n<span class="term__prompt">~/code/beads-board $</span> <span class="term__cursor"></span>`;
  }

  // ---------- scenes ----------
  function go(scene, opts = {}) {
    const wasOpen = isOpen();
    const hadFocus = wasOpen && $("#tray-host").contains(document.activeElement);
    if (scene === "capture") state.returnTo = isOpen() ? (state.scene === "loading" ? "open" : state.scene) : "closed";
    if (opts.reset && scene !== "capture") fresh(scene);
    state.scene = scene;
    if (scene !== "capture") closeCapture(true);
    if (scene !== "error") state.alerted = false;
    if (["open", "empty", "error"].includes(scene)) state.lastOpen = scene;
    render();
    if (scene === "notify") showNotice(); else hideNotice();
    if (scene === "capture") openCapture();
    if (scene === "loading") { clearTimeout(go.t); go.t = setTimeout(() => state.scene === "loading" && go(state.lastOpen), 1600); }
    if (!wasOpen && isOpen() && scene !== "loading") requestAnimationFrame(() => $("#tray-q")?.focus({ preventScroll: true }));
    if (wasOpen && !isOpen() && hadFocus && scene !== "capture") $("#tray-item")?.focus({ preventScroll: true });
  }

  // ---------- actions ----------
  function snack(html, action) {
    const s = $("#snackbar");
    clearTimeout(snack.t);
    $(".snackbar__message", s).innerHTML = html;
    const b = $(".snackbar__action", s);
    b.hidden = !action;
    b.textContent = action?.label || "";
    b.onclick = () => { s.classList.remove("snackbar--visible"); action?.fn(); };
    s.classList.add("snackbar--visible");
    snack.t = setTimeout(() => s.classList.remove("snackbar--visible"), 3500);
  }
  const mono = (t) => `<span class="mono">${t}</span>`;
  const currentId = () => document.activeElement?.closest?.(".tray-row")?.dataset.id || state.selected;

  const paused = () => { if (state.scene !== "error") return false; snack("Actions are paused until bd responds."); return true; };
  const idxInTab = (id) => listFor(state.tab).findIndex((i) => i.id === id);
  function claim(id) {
    if (paused()) return;
    const at = idxInTab(id);
    const n = mutate(id, (i) => { i.status = "in_progress"; i.assignee = ME.id; i.heartbeat = Date.now(); });
    state.unblocked = state.unblocked.filter((u) => u.id !== id);
    afterChange(`Claimed ${mono(id)}.`, n, at);
  }
  function closeIssue(id) {
    if (paused()) return;
    const at = idxInTab(id);
    const n = mutate(id, (i) => { i.status = "closed"; i.closed = Date.now(); });
    afterChange(`Closed ${mono(id)}.`, n, at);
  }
  function reclaim(id) { if (paused()) return; const at = idxInTab(id); mutate(id, (i) => { i.status = "open"; i.assignee = null; i.heartbeat = null; }); afterChange(`Reclaimed ${mono(id)}. It is back in Ready.`, [], at); }
  function reopen(id) { if (paused()) return; mutate(id, (i) => { i.status = "open"; i.closed = null; }); afterChange(`Reopened ${mono(id)}.`, [], -1); }
  function undo() {
    if (!state.undo) return;
    issues = state.undo.issues;
    state.unblocked = state.undo.unblocked;
    state.undo = null;
    render();
    snack("Undone.");
  }
  function afterChange(msg, newlyReady, at = -1) {
    const list = listFor(state.tab);
    if (!list.some((i) => i.id === state.selected)) state.selected = inlineMode() ? null : list[Math.min(Math.max(at, 0), list.length - 1)]?.id || null;
    render();
    if (newlyReady.length) pulse();
    snack(msg + (newlyReady.length ? ` ${newlyReady.length === 1 ? mono(newlyReady[0].id) + " is ready now." : newlyReady.length + " issues are ready now."}` : ""), { label: "Undo", fn: undo });
    const sel = state.selected && $(`#tray-host .tray-row[data-id="${state.selected}"]`);
    if (sel && $("#tray-host").contains(document.activeElement) === false && document.activeElement === document.body) sel.focus({ preventScroll: true });
  }
  function pulse() {
    const b = $("#tray-item [data-bead='open']");
    if (!b) return;
    b.classList.remove("tray-mark__bead--pulse");
    void b.offsetWidth;
    b.classList.add("tray-mark__bead--pulse");
  }

  function select(id, { toggle, focus } = {}) {
    state.selected = toggle && state.selected === id ? null : id;
    render();
    const row = state.selected && $(`#tray-host .tray-row[data-id="${id}"]`);
    if (row) { if (focus) row.focus({ preventScroll: true }); row.scrollIntoView({ block: "nearest" }); }
  }

  function createIssue(fields) {
    let id;
    do id = `${D.prefix}-${Math.random().toString(16).slice(2, 6)}`; while (byId(id));
    const issue = { id, status: "open", labels: [], deps: [], comments: 0, created: Date.now(), updated: Date.now(), type: "task", priority: 2, ...fields };
    issues.push(issue);
    return issue;
  }
  function createFromQuery() {
    const title = state.q.trim();
    if (!title || paused()) return;
    const issue = createIssue({ title });
    state.q = "";
    state.tab = "ready";
    state.selected = issue.id;
    render();
    snack(`Created ${mono(issue.id)} in Ready.`);
  }

  // ---------- quick capture ----------
  const capEl = () => $("#capture");
  function capCommand() {
    const c = state.cap;
    const parts = ["bd create", shellQuote(c.title.trim() || "Title")];
    if (c.type !== "task") parts.push(`-t ${c.type}`);
    if (c.priority !== 2) parts.push(`-p ${c.priority}`);
    if (c.assignee) parts.push(`-a ${shellQuote(person(c.assignee).name)}`);
    if (c.epic) parts.push(`--parent ${c.epic}`);
    return parts.join(" ");
  }
  function renderCapture() {
    const c = state.cap;
    const el = capEl();
    $(".capture__chips", el).innerHTML = `
      <button class="chip" type="button" data-cap="type" aria-label="Type: ${TYPES[c.type].label}. Change">${icon(TYPES[c.type].icon, "chip__icon")}<span class="chip__label">${TYPES[c.type].label}</span></button>
      <button class="chip" type="button" data-cap="priority" aria-label="Priority: P${c.priority}. Change">${icon("signal_cellular_alt", "chip__icon")}<span class="chip__label">P${c.priority} ${PRIORITY_NAMES[c.priority]}</span></button>
      <button class="chip" type="button" data-cap="epic" aria-label="Epic. Change">${icon("stacks", "chip__icon")}<span class="chip__label">${c.epic ? esc(D.epics.find((e) => e.id === c.epic).title) : "No epic"}</span></button>
      <button class="chip" type="button" data-cap="assignee" aria-label="Assignee. Change">${icon("person", "chip__icon")}<span class="chip__label">${c.assignee ? esc(person(c.assignee).name) : "Unassigned"}</span></button>`;
    $("#capture-cmd").textContent = capCommand();
  }
  function openCapture() {
    state.cap = { title: "", type: "task", priority: 2, epic: null, assignee: null };
    const el = capEl();
    $("#capture-title").value = "";
    renderCapture();
    el.classList.add("capture--open");
    el.setAttribute("aria-hidden", "false");
    setTimeout(() => $("#capture-title").focus(), 30);
  }
  function closeCapture(silent) {
    const el = capEl();
    if (!el || !el.classList.contains("capture--open")) return;
    el.classList.remove("capture--open");
    el.setAttribute("aria-hidden", "true");
    if (!silent) go(state.returnTo);
  }
  function submitCapture() {
    const c = state.cap;
    if (!c.title.trim()) { $("#capture-title").focus(); return; }
    if (paused()) return;
    const issue = createIssue({ title: c.title.trim(), type: c.type, priority: c.priority, epic: c.epic, assignee: c.assignee });
    state.tab = "ready";
    state.selected = issue.id;
    closeCapture(true);
    state.scene = state.returnTo === "loading" ? "open" : state.returnTo;
    render();
    snack(`Created ${mono(issue.id)} in ${columnOf(issue) === "ready" ? "Ready" : "Blocked"}.`, { label: "Open", fn: () => go("open") });
  }

  // ---------- notification ----------
  function showNotice() {
    const u = state.unblocked[0];
    if (!u) return;
    const n = $("#notice");
    $("[data-notice-body]", n).innerHTML = `${esc(person(u.who).name)} closed ${mono(u.by)}. ${mono(u.id)} is ready now.`;
    n.dataset.id = u.id;
    n.classList.add("notice--visible");
  }
  function hideNotice() { $("#notice")?.classList.remove("notice--visible"); }

  // ---------- injected UI ----------
  function inject() {
    const host = HOST === "omarchy" ? "omarchy" : "macos";
    const kbdOpen = host === "omarchy" ? [kbd("Super"), kbd("N")] : [kbd("cmd"), kbd("Shift"), kbd("N")];
    document.body.insertAdjacentHTML("beforeend", `
      <section class="capture" id="capture" role="dialog" aria-modal="true" aria-label="New issue" aria-hidden="true">
        <div class="capture__head">${icon("add")}<label class="visually-hidden" for="capture-title">Title</label>
          <input class="capture__input" id="capture-title" type="text" autocomplete="off" maxlength="300" placeholder="New issue title"></div>
        <div class="capture__body"><div class="capture__chips"></div>
          <div class="command"><span class="command__text mono"><span class="command__prompt">$ </span><span id="capture-cmd"></span></span></div></div>
        <div class="capture__footer"><span>Global hotkey</span>${kbdOpen.join("")}
          <span class="tray-panel__hints">${hint(["Enter"], "create")}${hint(["Esc"], "cancel")}</span></div>
      </section>
      <div class="notice" id="notice" role="alert"><span class="notice__tile" aria-hidden="true"><span class="tray-mark"><span class="bead bead--done"></span><span class="bead bead--active"></span><span class="bead"></span></span></span>
        <div class="notice__body"><div class="notice__head"><span class="notice__app">beads-board</span><span class="notice__time">now</span></div><div class="notice__text" data-notice-body></div>
          <div class="notice__actions"><button class="btn btn--secondary btn--sm" type="button" data-notice="open">Open</button><button class="btn btn--primary btn--sm" type="button" data-notice="claim">Claim</button></div></div></div>
      <div class="snackbar" id="snackbar" role="status" aria-live="polite"><span class="snackbar__message"></span><button class="snackbar__action" type="button" hidden></button>
        <button class="btn btn--icon btn--sm snackbar__close" type="button" aria-label="Dismiss" onclick="this.closest('.snackbar').classList.remove('snackbar--visible')">${icon("close")}</button></div>
      <div class="proto-switch"><label for="proto-scene">Scene</label>
        <span class="select"><select class="select__input" id="proto-scene">
          <option value="open">Shade open</option><option value="closed">Closed</option><option value="quiet">Closed, all quiet</option><option value="capture">Quick capture</option>
          <option value="notify">Notification</option><option value="loading">Loading</option><option value="empty">Empty workspace</option><option value="error">Database error</option></select>${icon("arrow_drop_down", "select__caret")}</span>
        <a class="btn btn--text btn--sm" href="macos.html" ${host === "macos" ? 'aria-current="page"' : ""}>macOS</a><a class="btn btn--text btn--sm" href="omarchy.html" ${host === "omarchy" ? 'aria-current="page"' : ""}>Omarchy</a></div>`);
  }

  // ---------- events ----------
  function wire() {
    const panel = $("#tray-host");

    $("#tray-item").addEventListener("click", () => go(isOpen() ? "closed" : state.lastOpen));
    NARROW.addEventListener("change", () => { if (isOpen()) { state.selected = inlineMode() ? null : listFor(state.tab)[0]?.id || null; render(); } });

    panel.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case "tab": state.tab = t.dataset.tab; state.selected = inlineMode() ? null : listFor(state.tab)[0]?.id || null; return render();
        case "select": if (e.target.closest(".tray-row__actions, .tray-row__detail, button, .bead-thread__item")) return; return select(t.dataset.id, { toggle: inlineMode() });
        case "jump": {
          const i = byId(id);
          const col = columnOf(i);
          state.q = "";
          if (TABS.some((x) => x[0] === col)) state.tab = col;
          else if (inlineMode()) return snack(`${mono(id)} is ${col}. Open the board to see it.`);
          state.selected = id;
          return render();
        }
        case "claim": e.stopPropagation(); return claim(id || state.selected);
        case "close": e.stopPropagation(); return closeIssue(id || state.selected);
        case "reclaim": e.stopPropagation(); return reclaim(id);
        case "reopen": return reopen(id);
        case "dismiss": state.unblocked = state.unblocked.filter((u) => u.id !== id); return render();
        case "create": return createFromQuery();
        case "sync": if (state.scene === "error") { state.lastOpen = "open"; return go("loading"); } state.syncing = true; render(); return setTimeout(() => { state.syncing = false; state.lastSync = Date.now(); render(); }, 700);
        case "retry": state.lastOpen = "open"; return go("loading");
        case "copy": return navigator.clipboard?.writeText(t.dataset.copy).then(() => snack(`Copied ${mono(esc(t.dataset.copy))}`), () => snack("Couldn't reach the clipboard."));
        case "board": return snack("Opens the full board window in the host app (prototype).");
        case "stub": return snack("Not part of this prototype.");
      }
    });

    panel.addEventListener("input", (e) => {
      if (e.target.id !== "tray-q") return;
      state.q = e.target.value;
      if (!inlineMode()) state.selected = listFor(state.tab)[0]?.id || null;
      refreshParts();
    });

    panel.addEventListener("keydown", (e) => {
      if (e.target.id === "tray-q") {
        if (e.key === "Enter") { e.preventDefault(); return createFromQuery(); }
        if (e.key === "Escape" && state.q) { e.stopPropagation(); state.q = ""; return render(); }
        if (e.key === "ArrowDown") { e.preventDefault(); const r = $("#tray-host .tray-row[tabindex='0']") || $("#tray-host .tray-row"); r?.focus(); }
        return;
      }
      const tab = e.target.closest(".tabs__tab");
      if (tab && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const i = TABS.findIndex((t) => t[0] === state.tab);
        state.tab = TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length][0];
        state.selected = inlineMode() ? null : listFor(state.tab)[0]?.id || null;
        render();
        $(`#tray-host [data-k="tab:${state.tab}"]`)?.focus();
        return;
      }
      const link = e.target.closest(".bead-thread__item--link");
      if (link && e.target === link && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); link.click(); return; }
      const row = e.target.closest(".tray-row");
      if (row && e.target === row) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(row.dataset.id, { toggle: inlineMode(), focus: true }); }
      }
    });
  }

  function moveRow(dir) {
    const rows = $$("#tray-host .tray-row[data-id]");
    if (!rows.length) return;
    const cur = document.activeElement?.closest?.(".tray-row");
    const i = rows.indexOf(cur) >= 0 ? rows.indexOf(cur) : rows.findIndex((r) => r.dataset.id === state.selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + dir))];
    if (!inlineMode()) select(next.dataset.id, { focus: true }); else next.focus();
  }

  function wireGlobal() {
    $("#proto-scene").addEventListener("change", (e) => go(e.target.value, { reset: true }));

    const cap = capEl();
    $("#capture-title").addEventListener("input", (e) => { state.cap.title = e.target.value; renderCapture(); });
    cap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "capture-title") { e.preventDefault(); submitCapture(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCapture(); }
      if (e.key === "Tab") {
        const f = $$("input, button", cap).filter((x) => !x.disabled);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    cap.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cap]");
      if (!b) return;
      const c = state.cap;
      const k = b.dataset.cap;
      if (k === "type") { const l = ["task", "bug", "feature", "chore"]; c.type = l[(l.indexOf(c.type) + 1) % l.length]; }
      if (k === "priority") c.priority = (c.priority + 1) % 5;
      if (k === "epic") { const l = [null, ...D.epics.map((x) => x.id)]; c.epic = l[(l.indexOf(c.epic) + 1) % l.length]; }
      if (k === "assignee") { const l = [null, ...Object.keys(D.people)]; c.assignee = l[(l.indexOf(c.assignee) + 1) % l.length]; }
      renderCapture();
      $(`.capture [data-cap="${k}"]`)?.focus();
    });

    $("#notice").addEventListener("click", (e) => {
      const b = e.target.closest("[data-notice]");
      if (!b) return;
      const id = $("#notice").dataset.id;
      if (b.dataset.notice === "open") { state.tab = "ready"; state.selected = id; go("open"); }
      else { hideNotice(); state.scene = "closed"; claim(id); }
    });

    document.addEventListener("keydown", (e) => {
      const typing = e.target.closest("input, textarea, select");
      if (e.key === "Escape" && !typing) { if (state.scene === "capture") closeCapture(); else if (isOpen() || state.scene === "notify") go("closed"); return; }
      if (e.key === "Escape" && isOpen() && e.target.id === "tray-q" && !state.q) return go("closed");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (state.scene === "capture") return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); return go("capture"); }
      if (!isOpen()) { if (e.key === "o" || e.key === "O") go("open"); return; }
      if (e.key === "/") { e.preventDefault(); $("#tray-q")?.focus(); }
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); moveRow(1); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); moveRow(-1); }
      if (["1", "2", "3"].includes(e.key)) { state.tab = TABS[Number(e.key) - 1][0]; state.selected = inlineMode() ? null : listFor(state.tab)[0]?.id || null; render(); }
      const id = currentId();
      if (id && byId(id) && state.scene !== "error") {
        if (e.key === "c" && columnOf(byId(id)) === "ready") claim(id);
        if (e.key === "x" && ["ready", "progress"].includes(columnOf(byId(id)))) closeIssue(id);
      }
    });

    // a click outside the shade or popover closes it, like a real menu
    document.addEventListener("pointerdown", (e) => {
      if (!isOpen()) return;
      if (e.target.closest("#tray-host, #tray-item, .proto-switch, .snackbar, .capture")) return;
      go("closed");
    });
    window.addEventListener("resize", () => { if (isOpen()) { place(); placeIndicator(); } });
  }

  // ---------- boot ----------
  inject();
  wire();
  wireGlobal();
  fresh("open");
  go("loading");
})();
