# Paseo Beads plugin

## Supported runtime and surfaces

This is a trusted, unsandboxed **Paseo 0.14.x plugin**.

The implementation uses the published `@getpaseo/plugin@0.14.0` contract:

- `addWorkspacePanel`: a real Beads workspace/explorer tab.
- `addScreen` and `addSidebarHeaderItem`: a multi-workspace Beads screen.
- `addCommandCenterItem`: **Open Beads board** in workspace context.
- `addSlashCommand`: `/beads` opens the workspace board; arguments are rejected, not executed.
- `defineRpc` / `server.handle` / `useRpc`: schema-validated `beads.request` RPC.
- `server.before("agent.session_open")` and `defineAgentTool`: a `beads` tool for interactive agent sessions with a workspace. Tool requests cannot choose another workspace. Providers must support Paseo's agent tools; historical sessions receive no tools and existing interactive sessions need their normal explicit refresh/resume to pick up a newly installed plugin.

The panel provides board/table views, text/assignee/label search, status/ready/blocked filters, issue details, create/edit, claim, close/reopen, stale-lease reclaim, dependencies/dependents, link/unlink and comments. The screen pins its initially chosen workspace instead of following activity-based list reordering. If that selection disappears, writes are disabled and drafts are retained until the workspace returns or the user selects another. While a mutation is pending, issue and workspace selection are disabled so its outcome remains visible. Edits submit only changed fields; there is no same-field conflict detection, so concurrent changes to an edited field can still be overwritten. The Blocked group includes non-closed issues with explicit `blocked` status or native blocked membership. Mutation results are not guessed; successful mutations invalidate and refresh the authoritative snapshot. The UI shows pending states and raw backend failures. There is no automatic completion, automatic database initialization, arbitrary shell command, or agent spawning.

The detail panel renders each native comment as author, local timestamp and selectable text. The underlying RPC and agent-tool comment records remain unchanged.

### Shared code and native design

All database operations use the same `src/core/service.ts` as the other Beads integrations. Paseo's client is React Native, including on desktop/web, and its documented plugin contract prohibits DOM elements and DOM-library imports. Consequently this plugin implements native components rather than attempting a fake embedded `src/ui.mount` panel.

The native surface follows the authoritative `design-reference/PRODUCT.md` and `DESIGN.md`: warm `#fdfbfa` ground, `#27251e` ink, `#271a00` primary, 12/14/16px hierarchy, 4px spacing scale, restrained lines and rounded controls. Desktop shows horizontal board columns; compact layouts stack them. No synthetic tasks or desktop chrome are shipped. Native fonts use the host's installed font: this SDK contract does not expose a custom font registration API, so **Onest loading is not claimed**. No external font stylesheet, DOM injection or substitute webview is used.

## Source and build boundary

`integrations/paseo/` contains the manifest, the two supported runtime entries, native client code, runtime-neutral RPC schemas and server adapter. The `native/` package build must:

1. Stage `integrations/paseo/` into `dist/paseo/`.
2. Bundle `src/core/service.ts` as Node ESM into `dist/paseo/server/core.js`, retaining Node built-ins as external imports.
3. Ship the complete `dist/paseo/` directory, including `paseo-plugin.json`, both entries, `client/`, `server/`, `shared/`, `package.json` and `OVERVIEW.md`.

`server/core.d.ts` describes that generated module for source typechecking. It is not a fallback implementation. **Install the staged `dist/paseo`, not the unbuilt source directory.** A Git install pointing directly at `integrations/paseo` is not a built release and lacks the service bundle. Preparation never installs packages or invokes a host reload behind the user's back.

Paseo compiles the TypeScript runtime entries itself and supplies these runtime modules: `@getpaseo/plugin`, its client/server/UI subpaths, React, React Native, TanStack Query and Zod. No runtime dependencies are downloaded by this plugin. Development dependencies include SDK 0.14.0, React 19.1.0, React Native 0.81.5, TanStack Query ^5.90.11, Zod ^4.4.3, TypeScript and React/Node types for typechecking. The server bundle uses the common service's `bd` executable.

### Workspace authorization

The server asks `context.paseo.workspaces.list` for all pages on each request with `filter: { includeBackground: true }`, so registered background workspaces appear in the plugin's project list and remain available to their panels and agents. Inclusive discovery requires the host's `backgroundWorkspaces` capability. Workspace IDs are mapped to the host-owned `workspaceDirectory` (worktree) or `projectRootPath`; requests never supply a filesystem path. An unregistered ID is rejected before invoking the service. A missing continuation cursor is an explicit error rather than a silently incomplete project list. Workspaces without initialized Beads remain visible and report the real service error when opened.

The public RPC permits only `projects`, `snapshot`, `issue`, `create`, `update`, `claim`, `close`, `reopen`, `reclaim`, `link`, `unlink`, `comment`, and `comments`. The core validates each operation's fields and executes fixed `bd` argv without a shell. The agent tool excludes `projects` and fixes the selected workspace to `context.agent.workspaceId` at execution time.

The agent tool's text is the JSON serialization of the original service result (`"null"` for a null result). Its MCP `structuredContent` is always an object: object results are preserved as-is, while arrays, `null`, and other non-object results are wrapped as `{ "result": <original value> }`. For example, `comments` returns the original JSON array as text and `{ "result": [...] }` as structured content.

## Installation and manual smoke

Installing or reloading changes trusted daemon configuration and must be explicitly authorized. If plugins are disabled, obtain permission before enabling them; this plugin never writes `~/.paseo/config.json`.

Run `npm ci` and `npm run build` from `native/` in the beads-hud checkout. After that build has produced `dist/paseo`, run on the daemon machine from the same directory:

```sh
paseo plugin install "$PWD/dist/paseo" --json
paseo plugin ls beads --json
paseo plugin logs beads
```

For an already-installed directory plugin, after an explicitly approved rebuild:

```sh
paseo plugin reload beads --json
```

The daemon must find `bd` 1.3.2 on its PATH. Use an **isolated temporary Git workspace** initialized with that version, never a production Beads database. The observed bd 1.3.2 initialization options are:

```sh
git config --local user.name "Paseo smoke"
git config --local user.email "paseo-smoke@example.invalid"
bd init --prefix=smoke --non-interactive --skip-agents --skip-hooks
```

Use a temporary `HOME` and `XDG_CONFIG_HOME`, clear inherited `BEADS_*`, `BD_*`, and `DOLT_*` routing variables, and set `BEADS_ACTOR=paseo-smoke` for the fixture process. Register/open that fixture workspace through the actual Paseo host before testing UI.

1. Open **Beads** in the sidebar and confirm the fixture workspace appears.
2. Open the workspace Command Center, choose **Open Beads board**, and confirm a native workspace tab appears. Confirm `/beads` opens the same panel.
3. Create an issue; verify it appears in an authoritative refreshed snapshot and in `bd list` in the fixture.
4. Claim, close, reopen and edit it. Add a second issue, link a blocking dependency, confirm blocked/ready behavior, then unlink it. Add a comment and confirm it persists.
5. Check search, board/table, empty filters, long descriptions and compact layout. Confirm a failed backend request appears as an error rather than empty success. In the multi-workspace screen, change activity order while a draft is open and confirm the selected workspace remains pinned; if it is removed, confirm writes are disabled and the draft retained. Confirm editing only a title does not revert a concurrently changed assignee or status.
6. In an explicitly refreshed/created interactive fixture agent session with tool support, invoke `beads` with `{"method":"snapshot"}` and `comments` for the fixture issue. Verify the tool's workspace cannot be overridden, the comments result is accepted by the MCP client, and unsupported methods fail. Repeat panel and agent access in an isolated registered background workspace.
7. Observe agent completion: it must not close or mutate any issue.

### Integration test

After installing development dependencies and building from `native/`, run the package tests, including the staged Paseo integration test:

```sh
npm test
```

The tests exercise the registered RPC and agent tool with the real common service: foreground/background workspace pagination, host-owned worktree paths, rejection of unknown IDs and paths, and tool output validation against `@modelcontextprotocol/sdk@1.29.0`'s actual `CallToolResultSchema`. Deterministic edge cases use fixture workspace responses and a temporary fake `bd` executable; a separate isolated Git/Beads fixture uses the real `bd` executable for comments and create → snapshot → claim → close → reopen. The fixture configures a repository-local Git identity, restores environment variables and removes only its own temporary directory. The MCP SDK is a native-package development dependency for the tests, not a plugin runtime dependency.

## Primary API evidence

Observed local executable: `/usr/bin/paseo`, launcher delegates to `/opt/Paseo/Paseo`; CLI logs report `version: '0.14.0'`, `platform: 'linux'`, `arch: 'x64'`.

Primary sources read during implementation:

- [Official plugin quickstart](https://github.com/getpaseo/paseo/blob/main/public-docs/plugins/index.md): generated structure, native workspace panels, runtime module ownership, unsandboxed installation and permission requirement.
- [Official plugin reference](https://github.com/getpaseo/paseo/blob/main/public-docs/plugins/reference.md): runtime directory boundaries, prohibition of DOM components/libraries, RPCs and panel/command interfaces. This page follows main; version-specific declarations below are the implementation authority.
- [Published 0.14.0 client contracts](https://unpkg.com/@getpaseo/plugin@0.14.0/dist/client/contracts.d.ts): `PluginClientContext`, `PluginWorkspacePanelProps`, screen/sidebar/command/slash registrations, cleanup.
- [Published 0.14.0 server contracts](https://unpkg.com/@getpaseo/plugin@0.14.0/dist/server/contracts.d.ts): handler receives `context.paseo` and shared RPC contract.
- [Published lifecycle declarations](https://unpkg.com/@getpaseo/plugin@0.14.0/dist/server/lifecycle.d.ts) and [agent tool declarations](https://unpkg.com/@getpaseo/plugin@0.14.0/dist/server/agent-tools.d.ts): session-open hook, provider tool definition, execution context.
- [Published client SDK](https://unpkg.com/@getpaseo/client@0.14.0/dist/index.d.ts) and [protocol declarations](https://unpkg.com/@getpaseo/protocol@0.14.0/dist/messages.d.ts): paged workspace entries, `workspaceDirectory`, `projectRootPath`, next cursor.
- [Paseo 0.14.0 workspace SDK guide](https://github.com/getpaseo/paseo/blob/v0.14.0/public-docs/sdk/workspaces.md): background visibility and `filter.includeBackground` pagination.
- [Paseo 0.14.0 plugin tool bridge](https://github.com/getpaseo/paseo/blob/v0.14.0/packages/server/src/server/agent/tools/plugin-tools.ts) and [MCP adapter](https://github.com/getpaseo/paseo/blob/v0.14.0/packages/server/src/server/agent/mcp-server.ts): plugin text becomes MCP content and structured content is passed through.
- [MCP SDK 1.29.0 result schema](https://unpkg.com/@modelcontextprotocol/sdk@1.29.0/dist/esm/types.js): `CallToolResultSchema` requires object-valued `structuredContent`.
- [NPM release metadata](https://registry.npmjs.org/@getpaseo/plugin/0.14.0): SDK version, host exports, peers, tarball shasum `88bf03da972a35589095b39523904d047aa99b14`.

