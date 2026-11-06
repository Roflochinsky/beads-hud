# Tern: native Beads plugin

Beads runs as a genuine **`beads.board` plugin block** inside Tern. It does not launch a browser, translate tasks into `TODO.md`, or rely on Tern's unrelated built-in Markdown board.

## Supported surface and implementation

The integration was authored against the installed **Tern 0.9.12 (`e498b49`)** CLI and the definitions emitted by `tern plugin types`. The minimum compatible API is the API shipped by that build; other versions need the checks below rather than an assumed compatibility guarantee.

- `integrations/tern/plugin.toml` is a schema-1 Tern manifest declaring host entry `host.luau` and block `board`.
- `host.luau` uses real `tern.block.define`, native node builders, native input events, `tern.process.run`, `tern.timer`, and the pane lifecycle API. The palette automatically offers **New Beads block**.
- `src/tern/bridge.ts` is the TypeScript process entry. It receives one shared RPC request on stdin, invokes the common `src/core/service.ts` handler, and emits one JSON envelope on stdout. Tern starts it with an argv array, not a shell command.
- The workspace is the native block's `cx.cwd`. The bridge registers only `{id: "workspace", path: process.cwd()}`; RPC callers cannot select an arbitrary filesystem path. Open one Beads block per project. No project discovery or secret configuration is read by this adapter.
- Task data, readiness and blockers come from the shared core's actual `bd` commands. Successful mutations trigger an authoritative snapshot refresh. No speculative status updates, fake success messages or automatic issue closure are used.

### Features

Native board and table views, Ready / Active / Blocked / All filters, priority ordering, issue selection and details, dependency navigation, and real create / edit / claim / reclaim / close / reopen / dependency link / unlink / add comment / read comments actions. Edit supports title, description, priority, assignee, status, notes, acceptance and design. Create also supports type and labels. Comments are displayed as the authoritative JSON records rather than assuming an undocumented comment schema.

Edit captures each field's initial value and submits only fields whose final value differs from that baseline. An unrelated title edit does not resend stale status, assignee, or other untouched fields; restoring a field to its baseline omits it, and saving an unchanged form sends no mutation. This is not atomic same-field conflict protection: if another actor changes a field that the user also edits, the native update may overwrite that actor's value.

All issues includes an **Other** board group for `pinned`, `hooked`, and custom statuses. Grouping keeps closed issues in Closed, then gives explicit `blocked` status or native `blockedIds` precedence over In progress and Deferred. Active and Blocked filters use that same classification. Ready uses only native `readyIds`; it is not inferred from status or missing blockers. Board, table, and `j`/`k` selection share the same filtered issue set.

Refresh runs every five seconds without overlapping requests and pauses while editing. There is also a Refresh button. Closing the block stops further polling and ignores in-flight completions; a process already launched can finish, bounded by its timeout. The host SDK does not expose a process cancellation handle. Plugin/daemon reload recreates the polling loop and reloads live tasks. Only view/filter preferences are persisted; tasks, errors and drafts are not cached to disk.

| Key | Action |
| --- | --- |
| `1`, `2`, `3` | Ready, Active, Blocked |
| `j` / `k`, arrows | Select next / previous issue |
| `c` | Claim selected issue |
| `x` | Open close form, or reopen a closed issue |
| `n` | New issue |
| `r` | Refresh |
| `Escape` | Cancel form or deselect issue |
| `Tab`, `Shift Tab` | Next / previous form field |
| `Ctrl Enter` / `Cmd Enter` | Submit form |

Fields support paste, IME text, Unicode-aware caret movement, Home/End and deletion. Native selection/caret editing is enabled when Tern's **Native composer editing** preference is enabled. Enter inserts a newline; Save submits. Pending operations disable actions, editing, and issue selection, including table select/activate events and `j`/`k`. A comments request keeps its selected issue until completion; selecting another issue afterwards clears the displayed comments. Failures remain visible in the block. After a timeout, refresh before retrying a mutation: the underlying operation might already have succeeded.

### Proven API limitations

These are native-host constraints, not a substituted browser implementation:

1. **No TypeScript plugin entry or DOM mount.** [Manifest reference](https://docs.stencil.so/tern/reference/manifest.html) requires `.luau` or `.lua` host/window entries. [Views](https://docs.stencil.so/tern/guides/views.md) are native node trees. Consequently the shared browser `mount(HTMLElement, transport)` UI cannot be mounted in this block. The small Luau adapter is necessary; all Beads command semantics remain in the shared TypeScript core.
2. **Cannot bundle Onest into the native renderer.** [Supported CSS, `@font-face`](https://docs.stencil.so/tern/styles/css.md#font-face) explicitly says it is parsed then ignored: plugins cannot load fonts. This plugin uses `font = "sans"`, Tern's UI face, while preserving the supplied warm monochrome palette, density, spacing and rounded surfaces. The native UI face can be changed by the user in Tern; this package does not change host preferences.
3. **A native host block has a pane workspace, not the browser application's multi-project shell.** Open it beside the project's shell. Remote panes require this plugin, Node and `bd` on the remote host. Attached desktop/web/iOS clients render the host block; executing the bridge on an iOS-only host is not supported (`tern.process.run` raises there).
4. **Headless `tern shot` and `tern serve` are not arbitrary-plugin acceptance tests.** [Scripts](https://docs.stencil.so/tern/scripts/index.md) states that headless sessions load no user plugins; `plugins fixtures` loads Tern's own fixtures. Use a normal `--control` window to exercise this package. A successful manifest-only `plugin list` without a daemon does not prove native execution.

Native actions and form fields are implemented, not marked unavailable merely because the DOM UI cannot be reused. Browser-specific styling and drag/drop behavior are not claimed as native parity.

## Build and install

Prerequisites on the machine running the panes:

- Tern with the API above, available to the user (Tern is a closed beta).
- Node.js 24 or newer and `bd` 1.3.2 on the daemon's PATH.
- An initialized project with `.beads`; this plugin never initializes or migrates production projects.

The `native/` package build owns staging. It copies the package files from `integrations/tern/` to **`dist/tern/`** and bundles `src/tern/bridge.ts` as ESM to **`dist/tern/bridge.mjs`**, including the common core. No generated bridge belongs in `integrations/tern/`. There are no Tern-specific npm runtime dependencies or separate npm-link steps.

Run from `native/` in the beads-hud checkout:

```sh
npm run build
tern plugin install "$PWD/dist/tern"
tern plugin list --json
```

Alternatively, from `native/`, explicitly authorize `tern plugin link "$PWD/dist/tern"` for development. Install/link changes Tern's plugin directory and automatically reloads plugins; do not run either against someone's host without approval. Use `tern plugin dir` to discover the actual destination, never assume `~/.config/tern`. Tern names an installed copy after manifest ID `beads`. Updating an installed copy requires `tern plugin install "$PWD/dist/tern" --force`; this will not replace a linked package. Uninstall with `tern plugin remove beads` (or `tern plugin unlink beads` for a link).

Open a shell in the initialized project, then choose **New Beads block** in the command palette. No window entry, HTTP server, authentication token, port or browser executable is needed. If Node is not on the daemon PATH, set **`BEADS_TERN_NODE` to an absolute Node executable path before starting the daemon**. This is a program path, not a shell command; do not append arguments. Changes to the launching shell's environment do not modify an already-running daemon.

## Verification

Recorded pre-migration native runs are listed in [verification.md](verification.md). The commands below run from `native/` and reproduce checks against a disposable database.

### Type and boundary checks

```sh
npm run build
npm run typecheck
npm test
types_dir="$(mktemp -d)"
tern plugin types "$types_dir"
luau-lsp analyze --platform=standard --definitions="@tern=$types_dir/tern.d.luau" integrations/tern/host.luau
```

`luau-lsp` was not present on the author's PATH. Do not install it implicitly. The TypeScript test `src/tern/bridge.test.ts` exercises the built process's public stdin/stdout boundary: host project identity, rejection of RPC-supplied paths, and malformed-request errors. Native behavior is exercised by `integrations/tern/smoke.txt`, not mocked registration calls.

### Genuine native smoke

Use an **empty disposable Beads project**, never a production database. The integration owner should create it under their existing isolated fixture setup: unset inherited `BEADS_*` / `DOLT_*` database-routing variables, isolate HOME/XDG directories for `bd`, initialize a temporary git repository, and use the documented command:

```sh
bd init --prefix=smoke --non-interactive --skip-agents --skip-hooks
```

Run in the fixture directory, with the same clean environment for both initialization and the test daemon. No global/shared database flags. The installed `bd 1.3.2` documents embedded Dolt as the default and only supported storage backend; do not invent `--backend sqlite`.

Point Tern at an isolated config and daemon socket, install **the built package**, and open a real window in that fixture. For example, with absolute paths assigned to `TERN_CONFIG_DIR`, `TERN_DAEMON_SOCKET`, `STENCIL_LOG_DIR`, `FIXTURE`, `PACKAGE`, and `CONTROL` by the fixture owner:

```sh
export TERN_CONFIG_DIR TERN_DAEMON_SOCKET STENCIL_LOG_DIR
tern plugin install "$PACKAGE"
tern --control "$CONTROL" "$FIXTURE"
```

Run the following from another terminal with the same isolation environment:

```sh
tern plugin list --json
tern plugin reload beads --json
tern ctl --control "$CONTROL" --file integrations/tern/smoke.txt
tern ctl --control "$CONTROL" tree "[data-surface='plugin.beads.board']"
tern ctl --control "$CONTROL" state
```

The scenario opens the real palette block, waits for an authoritative empty snapshot, creates a real issue through native input, then claims, closes and reopens it. It asserts the corresponding live native surface text after each mutation. Retain raw CLI responses and daemon logs. Compare with `bd list --all --json` in the fixture and independently exercise two issues linked/unlinked through the native forms, checking Ready and Blocked after each. Test UTF-16 editing with non-ASCII and supplementary characters, narrow/wide panes, table selection, comments, invalid input, missing `bd`, and reload recovery. Check logs for `plugin handler failed` and `plugin style sheet has errors`.

If the isolated profile cannot open a window because the beta requires sign-in, report that runtime prerequisite rather than copying credentials or claiming a headless fixture run proved this plugin. `tern plugin list` alone is insufficient evidence. Closing the test window does not necessarily stop its daemon: the integration owner must manage the isolated daemon's lifetime.

### Correction regression assertions

The comments appended to `integrations/tern/smoke.txt` are a manual continuation, not executable assertions or recorded passes. In the isolated native window above, the integration owner should retain the native tree and fixture CLI output for each case:

1. **Untouched concurrent values:** select an open, unassigned issue A and open Edit. Change only its title. Before Save, use a second actor in the same disposable fixture to claim A and change its description, priority, notes, acceptance and design. Save in Tern, wait for the authoritative refresh, then inspect A through the native details and `bd show A --json` (substitute the fixture ID). The new title must coexist with the second actor's in-progress status, assignee and all other changed fields. The update boundary's expected input is exactly `{id: A, title: "<new title>"}`. Repeat after changing then restoring an unrelated field in the form; it must remain omitted. Saving an unchanged form must close the form without an update request.
2. **Comments stay with their issue:** create A and B with distinct comment text. Load A's comments and, while the request is visibly pending, attempt table row selection and activation of B, `j`/`k`, and (in board view on a repeated request) card/dependency navigation. The selected issue and details must remain A until completion. Only A's comment text may appear. After selecting B, no A comments may remain; requesting B's comments must show B's text. A run where the request completed before selection was attempted does not exercise the race.
3. **All includes every status:** seed separate unblocked `pinned`, `hooked`, and fixture-supported custom-status issues, plus an in-progress issue blocked by an open dependency and an explicit blocked issue. Choose All issues. The nonstandard statuses must appear in Other, and the blocked issues in Blocked, not In progress. Cycle through issues with `j`/`k` and verify each selected ID has a visible card; Table must expose the same IDs. Active must exclude the native-blocked in-progress issue; Blocked must include it and the explicit blocked issue. Compare Ready IDs with native `bd ready --json`, not an inferred open-status list. Do not alter production status configuration to prepare this case.
4. **Visible, scrollable surface:** capture the ordinary window with `tern ctl shot`, not just its element tree. The empty `.sf-layer` must remain transparent. At a normal window height, use the wheel over `.sf-main` to reveal a dependency below the fold and click it without resizing. Background and padding belong only to main/dock regions.


## Discovery evidence (raw excerpts)

Before migration, commands were limited to help/version and SDK type generation outside the repository. Selected unchanged excerpts:

```text
$ tern --version
tern 0.9.12 (e498b49)

$ tern plugin --help
tern plugin list                          plugins, how they loaded, problems
tern plugin reload [ID]                   load every plugin again, or only ID
tern plugin dir                           where plugins are installed
tern plugin install SRC [--force]         from a git URL or a directory
tern plugin remove ID
tern plugin link DIR | unlink ID          use a plugin where it is
tern plugin types DIR                     writes DIR/tern.d.luau for luau-lsp
      every verb also takes [--json] [--window KEY]

$ bd --version
bd version 1.3.2 (9b65b9e19)
```

Other primary sources: [SDK overview](https://docs.stencil.so/tern/), [block lifecycle and liveness](https://docs.stencil.so/tern/guides/blocks.md), [input/UTF-16 editing](https://docs.stencil.so/tern/elements/input.md), [API reference](https://docs.stencil.so/tern/reference/api.md), and [driving a real plugin window](https://docs.stencil.so/tern/guides/debugging.md#driving-a-window-from-a-script).
