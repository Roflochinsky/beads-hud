# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Node without a bundler: one server file plus one HTML/CSS/JS page. Single dependency `marked` for markdown rendering. Chosen by the user over Astro and React/Vite because the surface must start instantly and be editable without a rebuild step. No deploy target: it runs on `localhost` only, on the owner's laptop.

## Users

One user: the owner of this machine, a solo developer who works with Claude Code agents in a terminal. He opens harness deliberately, as a reading session, to understand the state of a project before or between agent runs. He is not on a phone, not in a meeting, and not sharing the screen. He already knows `bd` and reads its output daily.

## Product Purpose

Harness answers two questions the terminal answers badly: *what does this project's written thinking say* and *how do its tracked tasks relate to each other*. It renders every `.md` file of the current project as readable prose, and renders the local beads issue database as a tree divided by epic, so the relationship between an epic and its children — the thing that gets lost in a flat list — is visible at a glance.

Success: the user stops losing the thread between agent sessions. He opens harness, sees which epic is where, sees what is blocked and by what, reads the relevant plan, and closes it.

## Positioning

Harness is scoped to the current folder, like `git`. It does not aggregate projects, does not host anything, and holds no data of its own — beads remains the single source of truth and `bd` remains the only writer. That scoping is the mechanism: a viewer with no state of its own can never disagree with the tracker, and never needs syncing.

## Operating Context

- Runs on `localhost`, laptop only, alongside a terminal running Claude Code.
- Scope is the working directory: the `.md` files under it, and the nearest `.beads` workspace that `bd` discovers.
- Data is read by shelling out to `bd list --json`; the three write actions shell out to `bd` as well.
- The user's beads workspaces today: `~/.beads` (prefix `nikitatrubaev`, 30 issues, currently mixing two unrelated efforts) and `~/code/workwatch-project-adr-ready/.beads`.
- Agents write to the same database concurrently while harness is open, so displayed state can go stale between refreshes.

## Capabilities and Constraints

- Reads: all `.md` files of the current folder as a navigable tree, rendered; beads issues as an epic-first tree.
- Writes, exactly three: create an issue, close an issue, claim an issue (take into work). No field editing, no dependency editing, no re-parenting.
- Task grouping is by epic: epic → children with progress, and everything parentless collected in an explicit "no epic" group so the junk-drawer problem stays visible rather than hidden.
- Blocked and ready states must be legible without opening anything.
- Terminology is beads' own terminology. No invented statuses, no renamed concepts — the user must not have to learn a second vocabulary.
- Out of scope, decided and closed: Telegram (bot or Mini App), any cloud deployment, mirrors, queues, and cross-machine synchronisation.

## Brand Commitments

Name: `harness`. No existing logo, palette, or typographic system — the project folder is empty.

## Evidence on Hand

Real data exists and must be used as design material: 30 issues in `~/.beads`, of which one is a six-child epic ("Epic: Customer feedback widget") and the rest are largely parentless, spanning an Astro personal-site effort and unrelated work; 5 are blocked, 14 are ready. Roughly 48 markdown files sit within three levels of `~/code`. No testimonials, metrics, users, or commercial claims exist and none may be invented.

## Product Principles

1. **The tracker is the truth; harness only looks at it.** No local state, no cache that can disagree, no second writer.
2. **Structure before status.** The relationship — epic to child, blocker to blocked — is the thing the terminal loses and the thing this surface exists to restore.
3. **Two densities, one surface.** Navigation is dense enough to hold a whole project at once; reading is calm enough to stay in for ten minutes.
4. **Speak beads.** Every label, status, and count matches what `bd` prints. Nothing to learn.
5. **Slower than the terminal is dead.** The alternative is one typed command, so the answer must already be on screen when the eye arrives.

## Accessibility & Inclusion

No user-specific requirement was established. Standard obligations apply: real text, keyboard reachability, and contrast that survives a long reading session.
