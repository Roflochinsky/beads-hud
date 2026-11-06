// Synthetic demo workspace. Every issue, person and agent here is invented
// to exercise the board; replace with `bd export --json` output when wired up.
(function () {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const now = Date.now();
  const ago = (ms) => now - ms;

  const people = {
    mira: { id: "mira", name: "Mira Holt", initials: "MH", kind: "human", me: true },
    dev: { id: "dev", name: "Dev Okafor", initials: "DO", kind: "human" },
    // brand picks the logo in the avatar tile (see js/agents.js)
    claude: { id: "claude", name: "claude-1", kind: "agent", brand: "claude" },
    codex: { id: "codex", name: "codex-2", kind: "agent", brand: "codex" },
    omp: { id: "omp", name: "omp-1", kind: "agent", brand: "omp" },
    grok: { id: "grok", name: "grok-1", kind: "agent", brand: "grok" },
    deepseek: { id: "deepseek", name: "deepseek-1", kind: "agent", brand: "deepseek" },
    glm: { id: "glm", name: "glm-1", kind: "agent", brand: "glm" },
  };

  const epics = [
    { id: "bb-e1a0", title: "Board MVP" },
    { id: "bb-e2b4", title: "Issue drawer and dependencies" },
    { id: "bb-e3c9", title: "Sync and storage" },
  ];

  // deps: ids this issue depends on (they block it)
  const issues = [
    { id: "bb-a3f8", title: "Compute the Ready column from open blockers", type: "feature", priority: 1, status: "in_progress", epic: "bb-e1a0", assignee: "claude", labels: ["board"], deps: ["bb-4e1c"], heartbeat: ago(4 * MIN), estimate: 120, comments: 3, created: ago(3 * DAY), updated: ago(4 * MIN),
      description: "Ready means status `open` and no dependency of type `blocks` that is still open. Match `bd ready` exactly, including deferred issues being hidden until their date.",
      acceptance: [["Same set as bd ready --json", true], ["Sorted by priority, then age", false], ["Recomputed after every move", false]] },
    { id: "bb-4e1c", title: "Read issues from Dolt through bd export --json", type: "task", priority: 0, status: "closed", epic: "bb-e3c9", assignee: "dev", labels: ["storage"], deps: [], closed: ago(2 * HOUR), created: ago(5 * DAY), updated: ago(2 * HOUR), comments: 5, closeReason: "Shipped in the board loader" },
    { id: "bb-9c3e", title: "Dropping a card on Blocked asks which issue blocks it", type: "feature", priority: 2, status: "open", epic: "bb-e1a0", labels: ["board", "dnd"], deps: ["bb-a3f8"], related: ["bb-2b7a"], created: ago(2 * DAY), updated: ago(6 * HOUR), comments: 1,
      description: "Blocked is computed, so the drop cannot just set a status. Open a picker, create a `blocks` dependency, and refuse links that would form a cycle." },
    { id: "bb-71d2", title: "Crash when a workspace has no issues yet", type: "bug", priority: 0, status: "open", epic: "bb-e3c9", labels: ["crash"], deps: [], discoveredFrom: "bb-4e1c", created: ago(5 * HOUR), updated: ago(5 * HOUR), comments: 2,
      description: "`bd export --json` prints nothing for an empty database and the loader calls `JSON.parse('')`. Treat empty output as an empty list and show the empty board." },
    { id: "bb-2b7a", title: "Keyboard move: M opens a Move to menu on the focused card", type: "feature", priority: 2, status: "open", epic: "bb-e1a0", labels: ["a11y"], deps: [], related: ["bb-9c3e"], estimate: 60, created: ago(2 * DAY), updated: ago(1 * DAY), comments: 0 },
    { id: "bb-58e0", title: "Draw the dependency chain in the issue drawer", type: "feature", priority: 1, status: "in_progress", epic: "bb-e2b4", assignee: "mira", labels: ["drawer"], deps: [], heartbeat: ago(12 * MIN), estimate: 180, created: ago(4 * DAY), updated: ago(12 * MIN), comments: 4 },
    { id: "bb-c41f", title: "Detect dependency cycles before linking", type: "task", priority: 1, status: "open", epic: "bb-e2b4", labels: ["deps"], deps: ["bb-58e0"], created: ago(3 * DAY), updated: ago(3 * DAY), comments: 0,
      description: "Run the same check as `bd dep cycles` on the candidate edge and explain which path would loop." },
    { id: "bb-0d93", title: "Show who holds the lease on in-progress cards", type: "task", priority: 2, status: "in_progress", epic: "bb-e1a0", assignee: "codex", labels: ["agents"], deps: [], heartbeat: ago(47 * MIN), created: ago(2 * DAY), updated: ago(47 * MIN), comments: 1 },
    { id: "bb-6a2e", title: "Undo in the snackbar for move, close and defer", type: "feature", priority: 2, status: "in_progress", epic: "bb-e1a0", assignee: "omp", labels: ["board"], deps: [], heartbeat: ago(6 * MIN), estimate: 90, created: ago(1 * DAY), updated: ago(1 * DAY), comments: 0 },
    { id: "bb-e5b1", title: "Filter chips for type, priority, assignee and label", type: "feature", priority: 2, status: "closed", epic: "bb-e1a0", assignee: "glm", labels: ["board"], deps: [], closed: ago(1 * DAY), created: ago(6 * DAY), updated: ago(1 * DAY), comments: 2 },
    { id: "bb-3f6c", title: "Comment composer posts through bd comment", type: "task", priority: 3, status: "open", epic: "bb-e2b4", labels: ["drawer"], deps: [], created: ago(2 * DAY), updated: ago(2 * DAY), comments: 0 },
    { id: "bb-8d27", title: "Sync indicator and manual refresh", type: "task", priority: 2, status: "open", epic: "bb-e3c9", labels: ["storage"], deps: ["bb-4e1c", "bb-1e9a"], created: ago(3 * DAY), updated: ago(2 * HOUR), comments: 0 },
    { id: "bb-1e9a", title: "Poll bd for changes every 10 seconds", type: "spike", priority: 2, status: "in_progress", epic: "bb-e3c9", assignee: "grok", labels: ["storage"], deps: [], heartbeat: ago(9 * MIN), estimate: 60, created: ago(3 * DAY), updated: ago(3 * DAY), comments: 1 },
    { id: "bb-b70c", title: "Empty state when no beads database is found", type: "task", priority: 3, status: "open", epic: "bb-e3c9", labels: ["onboarding"], deps: [], created: ago(1 * DAY), updated: ago(1 * DAY), comments: 0 },
    { id: "bb-47fa", title: "Priority scale must read without colour", type: "decision", priority: 2, status: "closed", epic: "bb-e1a0", assignee: "dev", labels: ["a11y"], deps: [], closed: ago(3 * DAY), created: ago(7 * DAY), updated: ago(3 * DAY), comments: 6 },
    { id: "bb-d218", title: "Long titles wrap to three lines on the card, then clamp, and the full title stays available in the drawer and on hover", type: "chore", priority: 4, status: "open", epic: "bb-e1a0", labels: ["board"], deps: [], created: ago(4 * DAY), updated: ago(4 * DAY), comments: 0 },
    { id: "bb-5c80", title: "Reclaim stale leases from the board", type: "feature", priority: 1, status: "open", epic: "bb-e1a0", labels: ["agents"], deps: ["bb-0d93"], created: ago(2 * DAY), updated: ago(2 * DAY), comments: 1,
      description: "When an agent stops sending heartbeats, offer Reclaim on its card. Same effect as `bd reclaim`: the issue goes back to ready and loses its assignee." },
    { id: "bb-90ab", title: "Quick capture at the bottom of Ready", type: "feature", priority: 3, status: "open", epic: "bb-e1a0", labels: ["board"], deps: [], created: ago(1 * DAY), updated: ago(1 * DAY), comments: 0 },
    { id: "bb-f3d4", title: "Federated workspaces in the workspace switcher", type: "feature", priority: 4, status: "deferred", labels: ["federation"], deps: [], deferUntil: now + 27 * DAY, created: ago(9 * DAY), updated: ago(9 * DAY), comments: 0 },
    { id: "bb-2a61", title: "Export the board as markdown", type: "chore", priority: 4, status: "deferred", labels: [], deps: [], deferUntil: now + 6 * DAY, created: ago(5 * DAY), updated: ago(5 * DAY), comments: 0 },
    { id: "bb-77c5", title: "Typo in the Blocked column tooltip", type: "bug", priority: 3, status: "closed", epic: "bb-e1a0", assignee: "claude", labels: [], deps: [], closed: ago(5 * HOUR), created: ago(1 * DAY), updated: ago(5 * HOUR), comments: 0 },
    { id: "bb-ab19", title: "Drawer tabs: details, dependencies, activity", type: "feature", priority: 2, status: "closed", epic: "bb-e2b4", assignee: "deepseek", labels: ["drawer"], deps: [], closed: ago(1 * DAY), created: ago(5 * DAY), updated: ago(1 * DAY), comments: 1 },
    { id: "bb-6e3b", title: "Closing asks for an optional reason", type: "task", priority: 3, status: "open", epic: "bb-e2b4", labels: ["drawer"], deps: ["bb-6a2e"], created: ago(1 * DAY), updated: ago(1 * DAY), comments: 0 },
    { id: "bb-c9d0", title: "Agent avatars read differently from people", type: "chore", priority: 3, status: "in_progress", epic: "bb-e1a0", assignee: "dev", labels: ["agents"], deps: [], heartbeat: ago(2 * MIN), created: ago(1 * DAY), updated: ago(2 * MIN), comments: 0 },
  ];

  const activity = {
    "bb-a3f8": [
      { kind: "event", who: "claude", when: ago(3 * HOUR), text: "claimed the issue and moved it to In progress" },
      { kind: "comment", who: "mira", when: ago(2 * HOUR), text: "Deferred issues must stay out of Ready until their date, same as the CLI." },
      { kind: "comment", who: "claude", when: ago(40 * MIN), text: "Done. Ready now matches `bd ready --json` on the demo database: 7 issues." },
      { kind: "event", who: "claude", when: ago(4 * MIN), text: "sent a heartbeat" },
    ],
  };

  window.BEADS_DEMO = { people, epics, issues, activity, prefix: "bb", workspace: { name: "beads-board", path: "~/code/beads-board/.beads" } };
})();
