# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML, CSS and vanilla JavaScript for the design prototype (standalone web page). The plugin host and production stack are undecided.

## Users

Developers and AI coding agents' human supervisors who track work in beads (`bd`), a git-backed issue tracker with first-class dependencies. They open the board beside their terminal to see what is ready, what is in progress, and what is blocked.

## Product Purpose

A kanban board for a beads workspace. Success: in a few seconds the user sees what can be picked up now (`bd ready`), what is blocked and by what, and can move, create, claim, close and link issues without dropping to the CLI.

## Positioning

Beads issues are chained by dependencies. The board makes those chains visible: the ready queue is computed from open blockers, and any issue's blockers and dependents can be traced on the board.

## Operating Context

Beads data model (bd 1.3): hash IDs with a project prefix (e.g. `bb-a3f8`); statuses open, in_progress, blocked, deferred, closed; priorities P0 (highest) to P4; types bug, feature, task, epic, chore, decision, spike, story, milestone; dependency kinds blocks, parent-child, related, discovered-from; labels, assignee, estimate, due/defer dates, comments, notes, acceptance criteria. Work is often claimed by agents holding an in_progress lease with heartbeats; stale leases can be reclaimed.

## Capabilities and Constraints

- Interface copy is English.
- The prototype uses synthetic demo issues; it is not wired to a real database.
- No dedicated host application yet; designed as a standalone page that could later sit in a panel.

## Brand Commitments

The user supplied a design reference (Perplexity design-system analysis) that pins the visual language: warm monochrome palette (#fdfbfa ground, #27251e ink, #271a00 primary), one sans family at 400/500, sizes 12/14/16, 4px spacing scale, radii 4/6/8/12/16/9999, a single subtle shadow for raised layers, thin line icons. The proprietary pplxSans is replaced by Onest (user's choice). Components follow Material UI patterns and BEM class naming.

## Evidence on Hand

None. All issues, people and agents shown are synthetic demo data.

## Product Principles

1. Ready first: what can be done now is always the most visible thing.
2. Dependencies are first-class: a blocked issue always says what blocks it.
3. CLI parity: every board action maps to a `bd` command, and the board never invents states beads does not have.
4. Calm density: many issues on screen without visual noise.
