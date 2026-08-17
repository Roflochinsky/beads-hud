<p align="center">
  <strong>Language:</strong>
  <a href="README.md">Русский</a> |
  English
</p>

<div align="center">

```
██████╗ ███████╗ █████╗ ██████╗ ███████╗    ██╗  ██╗██╗   ██╗██████╗
██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔════╝    ██║  ██║██║   ██║██╔══██╗
██████╔╝█████╗  ███████║██║  ██║███████╗    ███████║██║   ██║██║  ██║
██╔══██╗██╔══╝  ██╔══██║██║  ██║╚════██║    ██╔══██║██║   ██║██║  ██║
██████╔╝███████╗██║  ██║██████╔╝███████║    ██║  ██║╚██████╔╝██████╔╝
╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝    ╚═╝  ╚═╝ ╚═════╝ ╚═════╝
```

**A board for your [beads](https://github.com/gastownhall/beads) issues and project documents on `localhost` — and a Claude Code status line that keeps a live link to it.**

<a href="https://www.npmjs.com/package/@roflochinsky/beads-hud"><img src="https://img.shields.io/npm/v/@roflochinsky/beads-hud?color=0071e3&label=npm" alt="npm" /></a>
<img src="https://img.shields.io/badge/node-%E2%89%A522-0071e3" alt="Node ≥22" />
<img src="https://img.shields.io/badge/license-MIT-0071e3" alt="MIT" />

<img src="https://raw.githubusercontent.com/Roflochinsky/beads-hud/main/assets/board.png" alt="The beads-hud board" width="100%" />

</div>

> [!NOTE]
> The interface itself is in Russian. This page documents it in English; the product's own labels use beads' vocabulary translated to Russian (открыто / в работе / заблокировано / закрыто).

## What this is

A terminal answers two questions badly: *what does this project's written thinking say* and *how do its tracked issues relate to each other*. `bd list` prints a flat list, and the link between an issue and its epic is the first thing lost in it.

beads-hud answers both, and puts the answer where you are already looking:

- **the status line** is always in view — how many issues are ready, how many are waiting, how much context and money is spent, and a live link to the board;
- **the board** behind that link — issues as a kanban, a sortable table, or a dependency graph, and every `.md` file of the project, readable and editable in place.

The two need each other: the line knows the board is up for this folder, and a hook brings it up on session start.

```
⏽ beads-hud http://127.0.0.1:7777 │ bd 20 готово · 2 в работе · 5 ждут │ ctx 43% │ 5ч 38% 1ч19м │ нед 8% │ $34.34 │ Opus 5·1M xhigh
```

| Segment | Meaning |
|---|---|
| `⏽ beads-hud <url>` | The board is up; the URL is a real hyperlink (OSC 8). A dim `⏻` with no URL means the server is not running |
| `bd 20 готово` | Issues from the nearest `.beads` upwards. «в работе» (in progress) and «ждут» (blocked) appear only when non-zero |
| `ctx 43%` | Context window usage |
| `5ч 38% 1ч19м` | Five-hour limit and time to reset |
| `нед 8%` | Weekly limit |
| `$34.34` | Session cost |
| `Opus 5·1M xhigh` | Model and effort level |

Green below 60%, amber from 60%, red from 85%. Every number except the beads ones is fed to the line by Claude Code itself — nothing is guessed and nothing is polled.

## Install

```bash
npm i -g @roflochinsky/beads-hud
beads-hud install
```

The second command writes the status line and the autostart hook into `~/.claude/settings.json`. It prints what it will change, leaves a copy of the previous file next to it, and **never takes over someone else's status line silently**: if one is already set and it isn't ours, it stops and says so. Existing hooks are left alone; ours is appended beside them.

```
beads-hud install --dry-run    # print the change and exit
beads-hud install --project    # into .claude/settings.json of the current project
beads-hud install --force      # replace a foreign status line
beads-hud uninstall            # remove only what we added
```

The line appears in the **next** session: Claude Code reads settings at startup. To check the script itself without leaving the current one:

```bash
echo '{"model":{"display_name":"Opus 5"},"context_window":{"used_percentage":10},"cost":{"total_cost_usd":0},"cwd":"'"$PWD"'"}' | beads-hud-statusline
```

<details>
<summary><strong>Editing the settings by hand</strong></summary>

Both settings live in `~/.claude/settings.json` (or in `.claude/settings.json` inside a single project):

```json
{
  "statusLine": {
    "type": "command",
    "command": "beads-hud-statusline"
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "beads-hud-up", "timeout": 10 }
        ]
      }
    ]
  }
}
```

> [!NOTE]
> The file may not exist — create it. If it does, add the missing keys rather than overwriting: Claude Code has exactly one `statusLine`, and this replaces whatever you had.

</details>

## The board

Opens from the link in the status line. The address is always the same — **http://127.0.0.1:7777**. One server serves every project: the folder is chosen in the interface, not by port.

### Issues

<img src="https://raw.githubusercontent.com/Roflochinsky/beads-hud/main/assets/task.png" alt="Issue panel with description and links" width="100%" />

Columns follow beads' own statuses: open, in progress, blocked, closed. A card can be dragged: into "in progress" claims it, into "closed" closes it, back into "open" reopens it. The blocked column refuses drops — blocking comes from dependencies, not from a hand.

Clicking a card opens the issue: description, design, and clickable links — what holds it, what it holds, its children, and which documents cite it.

The left rail splits work by kind: all issues, no epic, epics (each on its own row), features, bugs, verification, everything else. A kind is itself a destination: every bug in one place, every feature in one.

Above the board sits a view switcher: **board**, **list**, **graph**. The list is a table sortable by any column — status, id, type, priority, epic, what it waits for, when it changed. A row opens the issue, same as a card.

<img src="https://raw.githubusercontent.com/Roflochinsky/beads-hud/main/assets/table.png" alt="List: sortable issue table" width="100%" />

The graph is a map of the whole project: the epic tree with its children, and red blocker arrows on top — both beads relationships on one screen.

<img src="https://raw.githubusercontent.com/Roflochinsky/beads-hud/main/assets/graph.png" alt="Graph: epic tree and blocker arrows" width="100%" />

### Documents

<img src="https://raw.githubusercontent.com/Roflochinsky/beads-hud/main/assets/docs.png" alt="Documents as a kanban by folder" width="100%" />

Every `.md` in the project, laid out as a kanban — **by folder**, or **by the work** that cites it. A green light on a card means at least one issue points at that document; a grey one means nothing does.

### Reading and editing

<img src="https://raw.githubusercontent.com/Roflochinsky/beads-hud/main/assets/read.png" alt="Reading a document" width="100%" />

A document opens with real typography — a measure capped at 760px, tables, code, quotes, images.

It is edited in place: clicking a paragraph turns it into its own markdown source.

<img src="https://raw.githubusercontent.com/Roflochinsky/beads-hud/main/assets/edit.png" alt="Editing a paragraph in place" width="100%" />

`Ctrl+Enter` saves, `Esc` cancels, an empty edit deletes the block. Everything outside the edited paragraph stays byte for byte: the server splits the document into blocks with their exact offsets and splices the edit in by them.

<details>
<summary><strong>Dark theme</strong></summary>

Light by default, dark from the button at the bottom of the rail. Both are built from one set of tokens.

<img src="https://raw.githubusercontent.com/Roflochinsky/beads-hud/main/assets/board-dark.png" alt="Dark theme" width="100%" />

</details>

<details>
<summary><strong>Keys</strong></summary>

| Key | Action |
|---|---|
| `n` | New issue |
| `Ctrl+Enter` | Save the paragraph |
| `Esc` | Close the dialog, cancel the edit, close the issue, leave the document |

</details>

## How it works

| Part | Role |
|---|---|
| `beads-hud` | The board server. Runs until stopped |
| `beads-hud-up` | The `SessionStart` hook. If the server is alive it stays quiet and duplicates nothing |
| `beads-hud-statusline` | The status line. Plain `sh` plus `jq`, about 20 ms per repaint |
| `beads-hud-open` | Opens the browser: `wslview`, then `xdg-open`, then `powershell.exe` |
| `beads-hud install` | Writes the status line and the hook into Claude Code settings; `uninstall` removes only what we added |
| `~/.cache/beads-hud/server.json` | Server state: address and pid |
| `~/.cache/beads-hud/bd-*.json` | Cached beads numbers for the line |

The single source of truth is the beads database. beads-hud keeps no state of its own. It writes only through `bd`: create, close, claim, reopen. It writes `.md` files directly, strictly inside the selected project.

<details>
<summary><strong>What it reads</strong></summary>

| Source | What it takes |
|---|---|
| `bd list --json` | Issues, statuses, priorities, types |
| `bd graph --all --json` | Relations: `parent-child` and `blocks` |
| `bd stats --json` | The numbers for the status line |
| The project's `.md` files | Documents; skips `node_modules`, `.git`, `dist` and hidden directories |

Projects are discovered in `~/code` and in the home directory: a folder makes the list if it holds `.git`, `.beads`, or at least one `.md`. The server never goes outside the home directory.

</details>

<details>
<summary><strong>Why the line does not wait for bd</strong></summary>

`bd stats` takes about 0.4 seconds — far too long for something that repaints every turn. The line prints a cache and, if that cache is older than 30 seconds, kicks a refresh off behind itself. There is no daemon: the refresh lives exactly as long as one command. Until a cache exists there is no segment, rather than a zero standing in for a number.

</details>

<details>
<summary><strong>Why the board does not wait for bd</strong></summary>

Documents and issues arrive separately. On a large project (384 issues, 174 files) the documents are open after 0.6 seconds while the issues take another fourteen — and all of that time is readable rather than blank. Until the issues land, the board says so plainly.

</details>

<details>
<summary><strong>Running it by hand, and variables</strong></summary>

```bash
cd /path/to/project
beads-hud            # or: node /path/to/beads-hud/server.mjs
```

| Variable | Effect |
|---|---|
| `BEADS_HUD_PORT` | Port instead of 7777 |
| `BEADS_HUD_NO_OPEN=1` | Do not open the browser on autostart |

The browser opens by itself when the hook actually started the server; if the server was already running, no tab opens. By hand — `beads-hud-open`.

Do not click the link in the status line: Claude Code's own interface draws it, while VS Code looks for links in ordinary terminal output.

</details>

## Requirements

- **Node ≥ 22**
- **[`bd`](https://github.com/gastownhall/beads)** on `PATH` — the source of issues
- **`jq`** on `PATH` — the status line is drawn by a shell, not by Node: an empty Node start costs 36 ms, the whole `sh` repaint costs 20 ms
- **A POSIX shell**: Linux, macOS, WSL

> [!WARNING]
> On native Windows the status line will not work — `beads-hud-statusline` is a shell script. The board and the server run anywhere Node does.

One runtime dependency: `marked`. Fonts live in `public/fonts` and are served locally, so no internet is needed: **Inter** for the interface (the closest free stand-in for SF Pro with full Cyrillic), **JetBrains Mono** for identifiers and code.

## Known limitation

`bd graph --all --json` returns relations for open issues only. So a closed issue shows no blockers, and an epic whose children are all closed loses its children in the interface.

## License

MIT
