---
name: beads-hud
description: A macOS Liquid Glass desktop for reading a project — floating glass slabs over an aurora wallpaper, one Apple-blue tint, status carried by small coloured lamps.
colors:
  apple-blue: "#0071e3"
  apple-blue-lift: "#005bb8"
  accent-ink: "#0064d2"
  on-accent: "#ffffff"
  accent-tint: "rgba(0,113,227,.12)"
  ink: "#1c1c22"
  slate-dim: "#494d61"
  slate-faint: "#5b5e72"
  glass-chrome: "rgba(255,255,255,.5)"
  glass-reading: "rgba(255,255,255,.66)"
  glass-panel: "rgba(255,255,255,.32)"
  card-white: "rgba(255,255,255,.74)"
  raise-white: "rgba(255,255,255,.92)"
  sunk-well: "rgba(70,80,130,.07)"
  hairline: "rgba(30,35,70,.1)"
  hairline-strong: "rgba(30,35,70,.2)"
  wall-sky: "#a4c4fa"
  wall-lavender: "#dcc0f6"
  wall-pink: "#f7bcd4"
  wall-mint: "#a9e4cd"
  ok-text: "#188038"
  work-text: "#b25000"
  stop-text: "#d70015"
  idle-text: "#6e6e7a"
  ok-lamp: "#2eb84e"
  work-lamp: "#ff9500"
  stop-lamp: "#ff3b30"
  idle-lamp: "#98989f"
  shadow-ink-contact: "rgba(20,25,60,.07)"
  shadow-ink-button: "rgba(20,25,60,.08)"
  shadow-ink-hover: "rgba(20,25,60,.09)"
  shadow-ink-far: "rgba(20,25,60,.12)"
  shadow-ink-thumb: "rgba(20,25,60,.18)"
  table-row-dark: "rgba(32,34,52,.55)"
  table-hover-dark: "rgba(56,58,80,.75)"
  table-selected: "rgba(213,231,252,.85)"
  table-selected-dark: "rgba(38,66,110,.6)"
typography:
  display:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  display-narrow:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  reading:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.06em"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "-0.01em"
rounded:
  focus: "6px"
  in: "10px"
  card: "14px"
  toast: "18px"
  panel: "22px"
  slab: "26px"
  pill: "999px"
spacing:
  gap: "12px"
  bar-h: "52px"
  rail-w: "60px"
components:
  button-accent:
    backgroundColor: "{colors.apple-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    padding: "7px 15px"
  button-accent-hover:
    backgroundColor: "{colors.apple-blue-lift}"
  button-default:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "7px 15px"
  button-default-hover:
    backgroundColor: "{colors.raise-white}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.slate-dim}"
    rounded: "{rounded.pill}"
    padding: "7px 15px"
  button-quiet-hover:
    backgroundColor: "{colors.sunk-well}"
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.sunk-well}"
    textColor: "{colors.slate-dim}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "11px 13px 10px"
  card-hover:
    backgroundColor: "{colors.raise-white}"
  input-field:
    backgroundColor: "{colors.sunk-well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.in}"
    padding: "9px 12px"
---

# Design System: beads-hud

## Overview

**Creative North Star: "The Liquid Glass Desk"**

beads-hud is a macOS Liquid Glass promo scene turned into a working surface. The ground is an aurora wallpaper — four soft radial pools of sky blue, lavender, pink, and mint over a pale linear wash — and everything the user touches is a floating glass slab hovering above it: a capsule rail on the left, a capsule toolbar above, translucent columns, a frosted drawer. Nothing is edge-to-edge; every layer keeps a 12px air gap from the viewport and from its neighbours. The world is calm, light-first, and deliberately Apple: one blue tint, capsule controls, specular top edges, and status told by tiny coloured lamps rather than coloured panels.

The build refuses the category defaults it was directed against: no opaque white tracker page, no edge-to-edge sidebar. Depth comes from the material itself — backdrop blur and saturation over the colorful wallpaper — so the palette of the interface is mostly white-at-varying-opacity, and the wallpaper supplies all the colour a screen needs. The dark scene exists only behind a manual toggle; it swaps the wallpaper to deep night hues and the glass to smoked panes, but changes no geometry and no accent hue.

**Key Characteristics:**
- Floating glass slabs over an aurora wallpaper; 12px gaps, never edge-to-edge
- One tint (Apple blue #0071e3); all other colour is wallpaper or status lamps
- Capsule controls everywhere; concentric radius ladder 10/14/22/26
- Light is the surface; dark is a manual exception, never an OS preference
- Russian UI voice speaking bd's own vocabulary; machine strings in monospace

## Colors

The interface itself is nearly colourless — white glass at graded opacities over a four-hue wallpaper — with a single blue tint and a small family of status lamps.

### Primary
- **Apple Blue** (#0071e3): the only tint in the product. Fills the primary capsule button, the selection ring on open cards, focus outlines, drag-target dashes, and the project dot. `apple-blue-lift` (#005bb8) is its hover state; **Accent Ink** (#0064d2) is the same voice for text and links, dark enough to read on glass. The selection wash `accent-tint` (rgba(0,113,227,.12)) marks the current rail tab and kind.

### Neutral
- **Ink** (#1c1c22): primary text everywhere.
- **Cool Slate Dim** (#494d61) and **Cool Slate Faint** (#5b5e72): secondary and tertiary text. Deliberately slate, not gray — tinted toward the wallpaper's cool temperature — and dark enough to hold ≥4.5:1 on the translucent surfaces over the wallpaper's warm quadrants.
- **Glass Chrome** (rgba(255,255,255,.5)): the standard slab material for rail, toolbar, and segmented controls.
- **Glass Reading** (rgba(255,255,255,.66)): the stronger pane for the table, reading view, drawer, dialog, and toast.
- **Glass Panel** (rgba(255,255,255,.32)): the lightest pane, for board columns and the graph field.
- **Card White** (rgba(255,255,255,.74)) and **Raise White** (rgba(255,255,255,.92)): the most opaque layer, for cards and their hover state.
- **Sunk Well** (rgba(70,80,130,.07)): the recessed fill for hover wells, chips, code, and inputs.
- **Hairlines** (rgba(30,35,70,.1) / .2): dividers and quiet borders.
- **Wallpaper** — Sky (#a4c4fa), Lavender (#dcc0f6), Pink (#f7bcd4), Mint (#a9e4cd): the aurora ground, painted as radial gradients on `body`. Never used as component fills.

### Status
- Text variants, accessible on glass: **OK** (#188038), **Work** (#b25000), **Stop** (#d70015), **Idle** (#6e6e7a).
- Lamp variants, vivid Apple system colors: **OK Lamp** (#2eb84e), **Work Lamp** (#ff9500), **Stop Lamp** (#ff3b30), **Idle Lamp** (#98989f). Lamps are 8px dots with a 3px halo of the same hue at 22%.

### Named Rules
**The One Tint Rule.** Apple blue is the only interface tint. Every other hue on screen is either the wallpaper or a status lamp. No second accent, ever.

**The Lamps Are Graphics Rule.** Status colour splits into two token families: vivid `*-lamp` values for the 8px dots (graphics), and darker `ok/work/stop/idle` values for any status-coloured text (must hold 4.5:1). Never put a lamp colour on text.

## Typography

**UI Font:** Inter (with -apple-system, system-ui fallback) — self-hosted woff2, weights 400/500/600, latin + cyrillic subsets
**Mono Font:** JetBrains Mono (with ui-monospace fallback) — weights 400/500

**Character:** Inter is the deliberate closest-obtainable stand-in for SF Pro (which is not redistributable, and the Russian UI needs full Cyrillic); JetBrains Mono stands in for SF Mono. The pairing reads as a native macOS app that happens to speak Russian.

### Hierarchy
- **Display** (600, 30px, 1.2, -0.02em): reading-view h1 only; drops to 24px under 860px.
- **Headline** (600, 22px, 1.3, -0.02em): the task title in the drawer; `text-wrap: balance`.
- **Title** (600, 17px, 1.3, -0.01em): view titles and dialog headings.
- **Body** (400, 14px, 1.5): the base set on `body`. Cards and controls run slightly denser at 13–13.5px, weight 500 for titles and button labels.
- **Reading** (400, 15px, 1.75): document prose, in a centered column of max 760px with 40px padding.
- **Label** (600, 11px, 0.06em, uppercase): section labels in the kind rail, table headers, drawer section heads, graph group labels — always in `slate-faint`.
- **Mono** (400–500, 10.5–12px, -0.01em): every machine string — issue ids, counts, priorities (P0–P4), file paths, dates, task types — matching bd's terminal output.

### Named Rules
**The Speak-bd Rule.** Statuses and UI copy are bd's vocabulary in Russian; task types (`task`, `feature`, `bug`, `epic`) and ids stay latin and monospace. If bd prints it, the HUD prints it the same way.

**The Machine-String Rule.** Anything a terminal would print — id, count, path, date, priority — is set in JetBrains Mono at 10.5–12px. Prose never goes mono; machine strings never go Inter.

## Layout

The viewport is a fixed desktop scene, `overflow: hidden` on body. Slabs are position-fixed with a shared **12px gap** (`--gap`) between each slab and the viewport edge: a 60px-wide capsule rail on the left (radius = half its width), a 52px toolbar across the top (fully capsule), and the canvas filling the remainder as a flex row. Inside the canvas: a 232px kind rail, then the active view. Board columns flex between 242px and 360px (basis 268px) and scroll internally; the board scrolls horizontally when columns overflow. The task drawer floats over the right edge at min(560px, 46vw), top-aligned under the toolbar. Density is compact throughout — 8px card gaps, 10px column padding, 13px control type.

Responsive is three honest steps, not a mobile redesign: at 1080px the kind rail and drawer narrow; at 860px the canvas stacks (kind rail becomes a wrapping horizontal band, drawer goes full-width); at 640px button and segment labels fold into their icons (the control keeps its place), the status word yields to the lamp, and the rail slims to 48px.

**The Floating Slab Rule.** No chrome surface ever touches the viewport edge or another slab; the 12px wallpaper gap between layers is part of the material.

## Elevation & Depth

Depth is material, not shadow-stacked: the primary depth cue is backdrop blur + saturation revealing the wallpaper through each pane, plus a 1px specular top edge that reads as light hitting glass. Shadows exist but are soft and supporting.

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgba(20,25,60,.06), 0 10px 28px -10px rgba(20,25,60,.16)` = `--shadow`): every glass slab at rest.
- **Lift** (`0 30px 80px -20px rgba(20,25,60,.4), 0 4px 16px rgba(20,25,60,.12)` = `--lift`): overlay layers only — drawer, dialog, toast.
- **Specular** (`inset 0 1px 0 rgba(255,255,255,.75)` = `--specular`; .12 in dark): the signature 1px inner top highlight, applied to every glass slab, card, and button.
- **Card** (`0 1px 3px rgba(20,25,60,.07), 0 6px 16px -8px rgba(20,25,60,.12)`): cards and graph nodes; deepens slightly on hover with a -1px translateY.

### Named Rules
**The Blur-Lives-On-Panels Rule.** Backdrop-filter belongs to panels and chrome (blur 26–40px, saturate 1.6–1.8). Cards are the most opaque layer and carry no backdrop-filter of their own — dozens of cards must never each pay for a blur pass.

**The Paper Rule.** Glass is chrome; a document is paper. Dense reading surfaces — table rows, the reading view — take near-opaque fields (`glass-reading` and above) so long text never fights the wallpaper.

**The Specular Edge Rule.** Every glass slab gets the 1px inset top highlight. A pane without its specular edge is not this world's glass.

## Shapes

Capsules and concentric rounded rectangles. Interactive controls — buttons, chips, segmented controls, counts, the rail and toolbar themselves — are full capsules (999px). Containers follow a concentric radius ladder: **10px** (`in`) for inputs, inline blocks, and nested list rows; **14px** (`card`) for cards, sheets, and graph nodes; **22px** (`panel`) for board columns, the table, and the graph field; **26px** (`slab`) for the outermost layers — kind rail, reading view, drawer, dialog. Borders are 1px throughout: glass panes take the bright glass edge (rgba(255,255,255,.62)), cards a near-white edge, dividers the dark hairline. Dashed 1px hairline-strong marks empty states and the add-block affordance; a dashed accent outline marks a drag target. Icons are a hand-drawn 20px stroke sprite (1.5px, round caps) — outline SVG, single colour via currentColor.

**The Capsule Ladder Rule.** If it's pressable and small, it's a capsule (999px); if it's a container, it takes the next radius up the 10/14/22/26 ladder so nested corners stay concentric.

## Components

### Buttons
- **Shape:** capsule (999px), 13px/500 label with optional 16px stroke icon.
- **Primary (`button-accent`):** Apple blue fill, white text, blue glow shadow (`0 2px 10px -2px rgba(0,113,227,.5)`) plus a 25%-white specular inset; hover deepens to #005bb8. Exactly one per screen region (e.g. "Новая задача").
- **Default:** card-white fill, 1px card edge, specular inset; hover raises to raise-white.
- **Quiet:** transparent, dim text, no shadow; hover gets the sunk well.
- **Icon button:** 30px circle, transparent, faint icon; hover sunk well + ink.
- **Focus:** global `:focus-visible` — 2px Apple blue outline, 2px offset.
- **Disabled:** opacity .45.

### Chips
- **Style:** capsule, sunk-well fill, 11.5px dim text, optional 16px icon or lamp; no border. Used for task meta in the drawer; the same recipe at 11px mono makes count badges (`col__n`, `card__type`).

### Cards / Containers
- **Corner Style:** 14px (cards, sheets, graph nodes); 22px panels; 26px slabs.
- **Background:** cards `card-white` (the opaque layer); columns `glass-panel` with blur 26 / saturate 1.7; chrome `glass-chrome` with blur 28 / saturate 1.8.
- **Shadow Strategy:** rest shadow + specular; card hover lifts -1px with a deeper card shadow.
- **Border:** 1px — glass edge on panes, card edge on cards.
- **Internal Padding:** columns 10px; cards 11px 13px 10px; drawer body 24px 28px.
- **States:** open card/row gets a 2px Apple-blue ring; dragging card fades to .35; closed tasks strike the title in dim with a hairline-strong line.

### Inputs / Fields
- **Style:** sunk-well fill, transparent 1px border, 10px radius, 9px 12px padding; 12px dim label above.
- **Focus:** border turns Apple blue (no glow).
- **Error:** message line in `stop-text` at 12.5px.

### Navigation
- **Rail:** fixed 60px capsule of icon-only 40px round tabs; faint at rest, ink-on-sunk on hover, accent-ink-on-tint when current (`aria-current`). Theme toggle sits at the foot.
- **Kind rail:** 232px glass slab; uppercase 11px group labels, 13px rows at 10px radius, mono counts right-aligned; current row takes tint + accent-ink; children indent 24px.
- **Table header:** sticky, near-opaque `--thead`, uppercase 11px labels; sorted column reads accent-ink with a rotating 12px chevron.

### Segmented Control (signature)
A glass capsule (chrome material, 3px inner padding) whose raised white thumb slides between segments — **the one authored motion of the product**: `transform .32s cubic-bezier(.3,1.22,.36,1)`, a ~5% spring overshoot, driven by `--seg-i`/`--seg-n` custom properties. Segments are 13px/500, dim at rest, ink when hovered or pressed. Heads the task view (Доска / Список / Граф) and the docs view.

### Status Lamp (signature)
An 8px dot with a 3-px halo (`0 0 0 3px color-mix(in srgb, <lamp> 22%, transparent)`). Idle gray, doing orange, blocked red, closed green. The lamp carries status everywhere — cards, table rows, graph nodes, sheets — so panels never need status-coloured backgrounds.

### Graph View (signature)
Panel-glass field; nodes are fixed **260×70px** cards (the CSS mirrors the `NW`/`NH` layout constants in `renderGraph` so edge anchors hit node midlines). Epic-tree skeleton edges are 1.5px hairline-strong curves; blocker edges are `stop-text` red at .75 opacity with arrowheads. Epic node titles go weight 600; closed nodes fade to .5; parentless tasks flow below as a grid under an uppercase label. A sticky legend of glass capsule keys floats top-right.

### Motion
The segmented thumb spring and `@starting-style` entrances (drawer slides 28px from the right over .38s `cubic-bezier(.32,.72,.28,1)`; dialog scales from .96; scrim and toast fade) are the entire motion budget; everything else is 120–200ms property transitions. `prefers-reduced-motion` collapses all of it to .01ms globally.

## Do's and Don'ts

### Do:
- **Do** build every new chrome surface from the `.glass` recipe: material fill + `backdrop-filter: blur(28px) saturate(1.8)` + 1px glass edge + rest shadow + specular inset.
- **Do** keep the 12px gap between every slab, and between slabs and the viewport edge.
- **Do** use the capsule (999px) for anything pressable and the 10/14/22/26 ladder for containers.
- **Do** carry status with the 8px lamp + halo, and set any status-coloured text in the dark accessible variants.
- **Do** set machine strings (ids, counts, paths, dates, types) in JetBrains Mono, and keep bd's vocabulary verbatim.
- **Do** give dense reading surfaces near-opaque fields (`glass-reading` or stronger); reserve the lightest glass for columns and chrome.

### Don't:
- **Don't** add a second tint. Apple blue #0071e3 (with its lift and ink variants) is the only interface accent.
- **Don't** put backdrop-filter on cards or any repeated small element; blur belongs to panels and chrome only.
- **Don't** add a `prefers-color-scheme` branch. Dark is `[data-theme='dark']` via the manual rail toggle only — a deliberate, user-confirmed decision.
- **Don't** paint panels or rows with status colours; the lamp is the status, the pane stays glass.
- **Don't** let any slab run edge-to-edge or turn the rail into a full-height sidebar; the floating-slab composition is the thesis.
- **Don't** author new easing or entrance motion outside the two existing grammars (seg-thumb spring, @starting-style entrance), and never bypass the reduced-motion collapse.
