---
name: beads board
description: A warm-monochrome kanban for beads that reads dependencies, not just statuses.
colors:
  bg: "#fdfbfa"
  surface: "#ffffff"
  wash: "#f6f3ef"
  wash-strong: "#efebe5"
  wash-deep: "#e9e4dc"
  ink: "#27251e"
  ink-strong: "#000000"
  ink-2: "#6a6860"
  ink-3: "#9a978e"
  accent: "#271a00"
  on-accent: "#fdfbfa"
  line: "rgba(39, 26, 0, 0.1)"
  line-strong: "rgba(39, 26, 0, 0.2)"
  hover: "rgba(0, 0, 0, 0.03)"
  subtle: "rgba(0, 0, 0, 0.05)"
  pressed: "rgba(0, 0, 0, 0.08)"
  selected: "rgba(39, 26, 0, 0.07)"
  ripple: "rgba(39, 37, 30, 0.14)"
  scrim: "rgba(39, 37, 30, 0.24)"
typography:
  title:
    fontFamily: "Onest, PingFang SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "24px"
  body:
    fontFamily: "Onest, PingFang SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Onest, PingFang SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  caption:
    fontFamily: "Onest, PingFang SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  caption-strong:
    fontFamily: "Onest, PingFang SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
    fontSize: "12px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-6: "24px"
  space-8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.pressed}"
  button-outlined:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-outlined-hover:
    backgroundColor: "{colors.wash}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  button-text-hover:
    backgroundColor: "{colors.hover}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.full}"
    size: "36px"
  button-icon-hover:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink}"
  button-sm:
    typography: "{typography.caption-strong}"
    padding: "0 12px"
    height: "32px"
  chip-filter:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  chip-filter-hover:
    backgroundColor: "{colors.wash}"
  chip-filter-selected:
    backgroundColor: "{colors.selected}"
  chip-label:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
    height: "20px"
  chip-priority-p0:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-accent}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.xs}"
    height: "20px"
  chip-priority-p1:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.xs}"
    height: "20px"
  chip-priority-p2:
    backgroundColor: "{colors.wash-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.xs}"
    height: "20px"
  chip-priority-p3:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.xs}"
    height: "20px"
  chip-priority-p4:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    height: "20px"
  field-outlined:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "20px 12px 6px"
    height: "48px"
  field-dense:
    padding: "0 12px"
    height: "36px"
  search:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 44px 0 40px"
    height: "40px"
  search-focus:
    backgroundColor: "{colors.surface}"
  issue-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px"
  issue-card-compact:
    padding: "8px 12px"
  issue-card-closed:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
  column:
    backgroundColor: "{colors.wash}"
    rounded: "{rounded.xl}"
    width: "304px"
  column-drop-valid:
    backgroundColor: "{colors.wash-strong}"
  column-drop-over:
    backgroundColor: "{colors.wash-deep}"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  rail-item-current:
    backgroundColor: "{colors.subtle}"
    typography: "{typography.label}"
  tab:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "44px"
  segmented-option-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-accent}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.sm}"
    height: "28px"
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "4px"
  menu-item:
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-accent}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
  snackbar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 8px 4px 16px"
    height: "48px"
  dialog:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    width: "560px"
  drawer:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    width: "480px"
  avatar:
    backgroundColor: "{colors.wash-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.full}"
    size: "24px"
  avatar-agent:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    size: "24px"
  glyph:
    textColor: "{colors.ink}"
    size: "20px"
  glyph-lg:
    size: "24px"
  table-view:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
  table-header:
    textColor: "{colors.ink-2}"
    typography: "{typography.caption-strong}"
    height: "40px"
  table-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    height: "52px"
  table-row-hover:
    backgroundColor: "{colors.hover}"
  table-row-selected:
    backgroundColor: "{colors.selected}"
  tray-panel:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    width: "400px"
  tray-panel-shade:
    backgroundColor: "{colors.bg}"
    rounded: "{rounded.xl}"
    width: "760px"
  tray-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px"
  tray-row-hover:
    backgroundColor: "{colors.hover}"
  tray-row-selected:
    backgroundColor: "{colors.selected}"
  tray-attention:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 4px 4px 12px"
    height: "48px"
  tray-create:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  capture:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    width: "560px"
---

# Design System: beads board

## Overview

**Creative North Star: "The Bead Thread"**

A board of warm paper and one ink. Every issue is a bead; dependencies are the thread that strings them. The system has no hue at all: urgency, state and selection are carried by how much ink a mark holds (solid fill, a 1.5px ring, a faint wash, bare text) and by line weight, never by color. The paper ground (#fdfbfa) holds columns laid on a faint ink wash, and white cards sit on that wash with a hairline of ink-alpha. Nothing casts a shadow until it lifts.

Density is calm and high. Body text runs at 14px, titles reach only 16px, and the whole interface lives inside three sizes and two weights, so hierarchy comes from weight, ink strength (ink, ink-2, ink-3) and the wash layers rather than from scale. Components follow Material patterns (outlined fields with floating labels, filter chips, tabs with a sliding ink indicator, an ink ripple, a side sheet, a snackbar with Undo) rendered in this monochrome. Class names are BEM (`block__element--modifier`); blocks never style each other's internals.

The visual language is pinned by the user's own design reference (a Perplexity design-system analysis); Onest stands in for the proprietary pplxSans by the user's choice. Where the build departs from the reference, this file records the build.

**Key Characteristics:**
- Warm monochrome: paper, white, three washes, three inks, one near-black accent; zero hue.
- Ink weight as the only status language (the priority scale, error fields, selection).
- Onest at 400/500 in 12/14/16; mono only for issue IDs and `bd` commands.
- Flat at rest; one soft shadow (with a 1px line) for anything raised or overlaid.
- Nested radii: column 16, card 12, inner strip 6, tag 4; pills only for round controls.
- The bead: an 8px ink ring that is hollow (open), dotted (active) or filled (done), strung on a 1px thread.

## Colors

A warm monochrome: paper and white grounds, faint ink washes for layering, and ink in three strengths; the only "accent" is a near-black brown.

### Primary
- **Burnt Umber Ink** (accent): the ground of the primary button and nothing else. At this darkness it reads as black with warmth; its rarity is what makes New issue findable. Text on it is Paper (on-accent).

### Neutral
- **Warm Paper** (bg): the app ground, app bar, rail, dialogs and the drawer. Overlays use paper, not white, so they feel like the same sheet.
- **White** (surface): cards, fields, filter chips, menus, outlined buttons. White on wash is how a card separates from its column.
- **Ink Wash** (wash): column ground, blocker and lease strips inside cards, the command preview, the rail's workspace switcher, outlined-button hover.
- **Strong Wash** (wash-strong): P2 priority fill, avatars, switch track, progress track, valid drop target.
- **Deep Wash** (wash-deep): the column directly under a dragged card.
- **Warm Ink** (ink): all primary text, the P0 chip, the selected segment, tooltip and snackbar grounds, the tab indicator, bead strokes, every focus ring's outer band.
- **Pure Black** (ink-strong): error only; error fields go to a 1.5px black ring with black helper text, not to red.
- **Graphite** (ink-2): secondary text, counts, metadata, resting icons in controls (5.4:1 on paper).
- **Pebble** (ink-3): resting help icons, disabled items, muted beads. Never body text.
- **Hairline** (line) and **Strong Hairline** (line-strong): ink-alpha strokes. Line separates bars, cards at rest and overlays; strong line outlines chips, fields, selects, outlined buttons and the bead thread.
- **State layers** (hover, subtle, pressed, selected): black or ink alpha over whatever ground they sit on, Material style. Hover 3%, subtle/fill 5%, pressed 8%, selected ink 7%.
- **Ripple** and **Scrim**: warm-ink alpha for touch feedback and the dialog backdrop.

### Named Rules
**The Ink-Only Rule.** No hue anywhere: not for status, priority, error, success or links. Meaning is carried by ink amount and line weight; if a new state needs distinguishing, find it on the ink ladder (bare text, hairline, wash, 1.5px ring, solid ink).

**The One Dark Button Rule.** The accent ground belongs to the primary button. Other solid-ink grounds (P0 chip, selected segment, tooltip, snackbar, agent avatar) use Warm Ink, not the accent.

## Typography

**Body Font:** Onest (with PingFang SC, Microsoft YaHei, system UI fallbacks), weights 400 and 500 only. Self-hosted from `fonts/` (SIL OFL 1.1, licence in `fonts/OFL.txt`), split by script with `unicode-range` so a page loads only the subsets it renders: Latin, Latin Extended, Vietnamese, Cyrillic, Cyrillic Extended, plus symbols and math. No Greek, Arabic, Hebrew, CJK or Indic scripts; those fall back to the system stack. Onest lacks `↵` and `⌘`, so key legends are written as words (`Ctrl Enter`).
**Label/Mono Font:** ui-monospace system stack at 12px with tabular figures, for issue IDs and `bd` command text only.

**Character:** One quiet, slightly rounded grotesque doing everything; the mono is a functional tag for machine strings, not a voice.

### Hierarchy
- **Title** (500, 16px, 24px): page title, dialog and drawer titles, empty-state titles, the brand word. The largest text on the board.
- **Document Title** (500, 24px, 32px, `--text-title`): only the title of documentation pages such as `components.html`. The board itself never uses it.
- **Label** (500, 14px, 20px): buttons, tabs, card titles, column titles, section titles, the current rail item.
- **Body** (400, 14px, 20px): the default for everything else, including rail items, menu items, field text and drawer prose (prose capped at 65ch).
- **Caption** (400, 12px, 16px): metadata, card footers, labels on cards, helper text, tooltips, counts beside controls.
- **Caption Strong** (500, 12px, 16px): group headings in the rail, menus, dialogs and columns (sentence case, Graphite), priority chips, small buttons.
- **Mono** (400, 12px): issue IDs and commands, always with tabular figures.

### Named Rules
**The Three Sizes Rule.** 12, 14 and 16px are the whole ramp on the board (documentation pages add the 24px document title). Hierarchy above 16px is not expressed with size; it is expressed with weight, ink strength and layout.

**The Two Weights Rule.** 400 and 500. Emphasis is 500; nothing is set at 600 or bold.

**The Mono-for-Machines Rule.** Monospace marks strings a machine owns (issue IDs, `bd` commands). It never sets prose, headings or numbers that are not identifiers; counts use tabular figures in Onest.

## Layout

An application shell on a CSS grid: a 56px app bar across the top, a 240px rail at left, and a main area holding a title row, a filter bar and a horizontally scrolling board. Columns are flexible at a 304px basis, capped at 380px, separated by 12px; a collapsed column (Deferred) is a 48px vertical rail with a vertical title. The issue drawer is a 480px floating side sheet inset 8px from the viewport edges below the bar; when it is open on wide screens the board gains right padding so it stays readable beside it.

Spacing is a 4px scale (4, 8, 12, 16, 24, 32). 24px is the horizontal gutter of the main head, the board, dialogs and the drawer; 16px is the inner rhythm of dialog bodies and the gap of the app bar; 8px separates cards in a column and chips in the filter bar; 4px separates tokens and label chips. Cards pad 12px (compact density: 8px by 12px).

Responsive steps: at 1279px and below the drawer overlays the board instead of reserving space; at 1023px and below the app bar collapses New issue to an icon and hides the sync label; at 767px and below the rail becomes an off-canvas sheet, the drawer goes full-screen and square, columns take 86vw with scroll snap, the filter bar scrolls horizontally, and the snackbar spans the viewport.

**The Ready-First Rule.** Column order is fixed: Ready, In progress, Blocked, Closed, then the collapsed Deferred rail. Ready leads because it is computed, not filed.

## Elevation & Depth

Depth is tonal first. Paper, wash and white make three flat layers (ground, column, card); a card at rest has only a 1px Hairline. There is exactly one shadow in the system, a soft 1px-2px ambient lift, and it appears on hover, on lifted or chained cards, and on every overlay. Overlays (menus, dialog, drawer, off-canvas rail, snackbar) pair that shadow with a 1px Hairline border; the dialog adds a warm scrim.

### Shadow Vocabulary
- **Raised** (`box-shadow: rgba(0, 0, 0, 0.08) 0px 1px 2px 0px`): hovered, selected-and-hovered and spotlit cards; the prototype state picker.
- **Overlay** (same value, aliased): menus, dialogs, the drawer, the mobile rail, the snackbar, the drag ghost. Kept as its own token so overlays can diverge later without touching cards.
- **Focus ring** (`box-shadow: 0 0 0 2px #fdfbfa, 0 0 0 4px #27251e`): composite paper-then-ink ring on every `:focus-visible`, stacked after any inset outline. On the dark snackbar the action uses a 2px paper ring instead.
- **Unblocked halo** (`0 0 0 4px rgba(39, 26, 0, 0.12)` with a 1.5px ink ring, fading over 1600ms): the one-time flash when a card becomes ready.

### Named Rules
**The Flat-At-Rest Rule.** Resting cards and columns cast nothing. A shadow means "this is lifted or floating", and it is always the same shadow.

**The Inset Outline Rule.** Control and card outlines are inset ink-alpha box-shadows, not borders, so outline weight can step (1px, 1.5px, 2px) without shifting layout and can stack with the focus ring.

## Shapes

Gently rounded, nested by depth: the column is 16px (xl), the card inside it 12px (lg), strips inside the card 6px (sm), tags and priority chips 4px (xs). Overlays follow the same ladder: drawer and dialog 16px, menus, banner, search and empty-state tiles 12px, buttons, chips, fields and selects 8px, menu items, tabs and tooltips 6px. Full rounding (9999px) is reserved for things that are round by nature: icon buttons, avatars, the switch, progress bars and beads. The agent avatar is the deliberate exception, a 6px rounded square, so agents read as machines beside round human avatars.

Strokes come in three weights: 1px Hairline for rest, 1.5px ink for selected, chained, error and active input, 2px ink for the current bead and the tab indicator.

**The Nesting Rule.** An inner shape is always a step smaller in radius than its container (16 > 12 > 6 > 4).

## Components

### Buttons
Restrained and solid, Material proportions in monochrome.
- **Shape:** gently curved (8px), 36px tall, 16px side padding; small size 32px with 12px padding and 12px text.
- **Primary:** Burnt Umber ground, Paper text, 500 weight; hover drops opacity to 0.9, active 0.8. May carry a keyboard hint on a 14% paper chip.
- **Secondary:** 5% black fill, deepening to 8% on hover. **Outlined:** white with a strong inset hairline, wash on hover. **Text:** transparent, 3% hover.
- **Icon:** 36px circle (32px small), Graphite glyph that darkens to ink on hover; pressed state uses the selected tint.
- **Press:** every button scales to 0.98 (icon buttons 0.95) and spawns an ink ripple (paper ripple on primary), 450ms.
- **Disabled:** 0.5 opacity, no press scale.

### Chips
- **Filter chip:** 32px, 8px radius, white with strong inset hairline; a leading Graphite icon, a 500-weight value and a caret. Selected gets the 7% ink tint, a 32% ink outline and an ink icon.
- **Label chip:** 20px, 4px radius, 5% fill, Graphite caption, no outline; non-interactive, on cards.
- **Priority chip:** 20px, 4px radius, tabular 500 caption. P0 solid ink, P1 white with a 1.5px ink ring, P2 strong wash, P3 hairline only, P4 bare Graphite text at 400.

### Cards / Containers
- **Issue card:** 12px radius, white, 1px inset Hairline, 12px padding and 8px internal gap. Top row: type icon, mono ID, overflow menu that appears on hover or focus. Title is Label weight clamped to three lines. Footer in Caption: stats, assignee with avatar.
- **States:** hover adds the strong hairline plus Raised; selected is a 1.5px ink ring; closed goes transparent with a struck-through Graphite title; dragging fades to 0.4; the ghost tilts 1.5deg with Overlay.
- **Column:** 16px radius on Ink Wash, a header with a bead or icon glyph, title and count; drop valid steps to Strong Wash with a 1.5px ink ring and a white hint, the column under the pointer to Deep Wash, invalid targets fade to 0.55.
- **Table view:** the second layout, switched with the Board/Table segmented control in the title row (or `V`) and remembered in `localStorage`. One white surface with a 16px radius and a Hairline border holds a sticky header (Caption Strong, Graphite, 40px, hairline underline) and one row per issue (52px, 36px compact; hairline between rows, 3% hover, 7% ink tint when open in the drawer). Columns: Status (bead or icon plus label), ID (mono), Title (500, two-line clamp), Priority chip, Blocked by (lock plus open blocker IDs), Assignee, Type, Epic, Labels, Updated, row menu. Sortable headers are buttons with `aria-sort`; the arrow shows on hover and stays on the sorted column; default sort is status (Ready first), then priority. The footer states the count and the current sort and holds Add issue. The chain spotlight works on rows (tint plus a Warm Ink relation tag after the title; the rest dim to 50%). Rows take a 2px ink outline at -2px offset for keyboard focus, an exception to the composite ring because box-shadow does not paint reliably on table rows. Columns drop out by container width, least important first (labels, epic, updated, type, assignee name, blocked by), so the table stays usable beside the 480px drawer.
- **Banner:** 12px radius, white with strong hairline, ink icon, 500 title over Graphite detail.

### Inputs / Fields
- **Outlined field:** 48px, 8px radius, white, strong inset hairline; the label floats from 14px to 12px on focus or value. Multi-line fields start at 112px.
- **Focus:** 1px ink outline plus the composite focus ring; hover deepens the outline to 36% ink.
- **Error:** 1.5px Pure Black outline, black label and 500-weight helper with an icon. No red.
- **Search:** 40px, 12px radius, 5% fill with a `/` key hint; on focus it turns white with an ink outline and ring.
- **Select, switch, checkbox, radio:** 8px-radius select on white; switch and checkbox fill with ink when on; 1.5px Graphite rings at rest.

### Navigation
- **App bar:** 56px Paper bar with a bottom Hairline: three-bead brand mark and wordmark, centered search, sync status in Caption, New issue at right.
- **Rail:** 240px Paper sheet with a right Hairline. Items are 36px, 6px radius, Body at rest, 3% hover; the current item takes the 5% fill, 500 weight and an ink icon. Epics carry a 3px progress bar. Group headings are Caption Strong in Graphite, sentence case.
- **Tabs:** 44px Label tabs in Graphite that turn ink when selected, over a 1px bottom hairline, with a 2px ink indicator sliding at 200ms.
- **Segmented button:** white with strong hairline and 2px inner padding; the selected option is solid ink with Paper text.

### Overlays
- **Menu:** white popover, 12px radius, 4px padding, Hairline border and Overlay shadow; 36px items at 6px radius, Caption Strong headings, ink check squares. Opens with a 4px rise and 0.98 scale at 150ms.
- **Tooltip:** ink ground, Paper caption, 6px radius.
- **Snackbar:** ink ground, 8px radius, 48px tall, centered 24px from the bottom, with a 500-weight text action (Undo).
- **Dialog:** Paper, 16px radius, 560px (420px small), 24px gutters, actions above a top Hairline; rises 8px from 0.98 at 200ms over the warm scrim.
- **Drawer:** a floating 480px Paper side sheet with 16px radius, slid in from the right at 200ms on the ease-out curve.

### The Bead and the Bead Thread (signature)
The bead is the system's own mark. An 8px circle with a 1.5px ink ring: hollow for open, ringed with a center dot for active, solid for done, Pebble ring for muted. It appears as column glyphs, as the three-bead brand mark, and in a card's blocker strip (a wash strip with beads and the names of open blockers). In the drawer the bead thread lists blockers and dependents as 12px beads strung on a 1px strong-hairline thread; the current issue is a 16px bead with a 2px ring and a paper gap halo.

**The Chain Spotlight.** Hovering or focusing a card dims every unrelated card to 0.5 opacity and lifts its blockers and dependents with a 1.5px ink ring, Raised, and a small ink relation tag on the card's top edge. Spotlight is how a dependency is traced on the board; do not replace it with lines drawn across columns.

### Hosts (the tray plugin)
The same board as a drop-down from the system bar, drawn inside a depiction of two desktops (`hosts/macos.html`, `hosts/omarchy.html`; blocks in `hosts/tray.css`, behaviour in `hosts/tray.js`). The plugin is the board's world with nothing added: Paper panel, Hairline rows, 12/14/16 Onest, ink-only priority chips, square ink agent tiles, the one shadow. Only the host chrome around it differs.
- **Panel:** `tray-panel`, Paper, 1px Hairline, Overlay shadow, 12px radius. Header (workspace switcher, sync, board and settings icons), capture field (search pattern), an attention strip (white, strong hairline, 48px; stale lease or newly unblocked issue, with Claim or Reclaim), Ready / Active / Blocked tabs, the list, and a Wash footer showing the live `bd` command beside the key legend. Rows (`tray-row`) are 8px padded, 8px radius: priority chip, two-line Label title over a Caption meta line, assignee avatar that swaps for hover actions; the selected row takes the 7% ink tint. `tray-create` (44px, ink tint) offers "create from query".
- **macOS menu bar extra:** a 28px menu bar, status item at right, a 400px popover below it (`--shade` off). The selected row expands in place to show its detail and actions; the popover opens with a 4px rise and 0.98 scale.
- **Omarchy shade:** a 32px Waybar with the module at right; a 760px `tray-panel--shade` hangs from the bar with square top corners and 16px bottom corners, revealed by a downward clip. Grid of a 360px list column and a detail column (`tray-detail`: title, properties, bead thread, actions) with header and footer spanning both. Below 900px it collapses to the 400px inline popover.
- **Capture and notice:** `capture` is a 560px, 16px-radius palette over the desktop for the global hotkey (56px input, chips for type, priority and assignee, a `bd create` preview). `notice` is a 360px host notification banner with a 32px ink tile.
- **Backdrop:** `term` is a mono terminal on the desktop, Paper on ink, showing `bd ready`.

**The Three Beads Rule.** The bar item is the signature: three beads (`tray-mark`) show queue state. Done (closed this week, solid), active (something in progress, dotted), open (ready count above zero, hollow), each dimmed to 35% when its state is empty, all dimmed on error or empty database; the ready count sits beside them in tabular Onest. `tray-dot`, an 8px solid ink dot with a 2px bar-coloured gap, marks that something needs attention. The open bead pulses (700ms) when an issue becomes ready. Never replace the mark with a hue or a badge colour.

**The Keyboard Rule.** The shade is drivable without a pointer: `j` / `k` (or arrows) move the selection, `1` `2` `3` switch tabs, `c` claims a ready issue, `x` closes a ready or active one, `n` opens capture, `/` focuses the field, `o` opens from the closed bar item, `Esc` backs out one layer (capture, then query, then the panel). Every key shows as a `kbd` hint in the footer.

**The CLI Parity Rule.** Every action names the `bd` command it runs: button and icon `title`s read `Claim: bd update <id> --claim`, `Close: bd close <id>`, `Reclaim lease: bd reclaim <id>`; the footer shows the command behind the current tab (`bd ready`, `bd list -s in_progress`, `bd blocked`); the capture preview and the detail's command line show `bd create ...` and the selected issue's next command, in 12px mono.

**Documented host exceptions.** The depiction is allowed to look like its host where the OS, not the plugin, draws the pixels:
- OS-drawn chrome keeps host faces: the system face (`-apple-system`) on the macOS menu bar, window bar and notification; monospace on Waybar and the Omarchy notice. The plugin itself stays in Onest.
- The macOS desktop is a flat mid-grey (`ink-3`); a light cream ground read as a cream page. The macOS menu bar is Paper at 84% with a blur, the one backdrop filter in the system, scoped to the host bar.
- The Omarchy desktop is pure black (`ink-strong`) with ink windows, 2px `ink-2` / `ink-3` window borders and a 4px-radius notice with a 2px `ink-3` border and no shadow. Beyond error fields and selected text, this is the only use of `ink-strong`.
- Table rows (above) and the tray's focus use outlines or the composite ring as noted; Waybar modules take a paper ring because their ground is ink.

## Do's and Don'ts

### Do:
- **Do** express every state on the ink ladder: bare Graphite text, Hairline, wash fill, 1.5px ink ring, solid ink.
- **Do** keep type to 12/14/16px and weights 400/500; reach for 500 or Warm Ink before reaching for size.
- **Do** outline controls and cards with inset ink-alpha box-shadows and stack the composite focus ring (`0 0 0 2px #fdfbfa, 0 0 0 4px #27251e`) after them.
- **Do** nest radii one step down per layer (16 > 12 > 6 > 4) and keep pills for round controls.
- **Do** put every leading bead or icon in a fixed slot (`glyph`, 20px; `glyph--lg`, 24px in the drawer) so labels in a list share one text edge, whether the lead is an 8px bead or a 16px icon. In menus the lead sits in `menu__lead`.
- **Do** show agents as a square Warm Ink tile carrying the agent's one-ink logo (`js/agents.js`: Claude, Codex, omp, Grok, DeepSeek, Z.ai for GLM), never in brand colour.
- **Do** use Material Symbols Outlined at weight 300, unfilled, as inline SVG from the sprite in `js/icons.js` (Apache 2.0, licence in `icons/LICENSE`): `<svg class="icon"><use href="#i-NAME"></use></svg>`. Size icons with `--icon-size` (20px default, 16 to 18px inside controls), never with `font-size`. A new icon is added to the sprite, not loaded as a font.
- **Do** set issue IDs and `bd` commands in the 12px mono, and mark every action with the command it maps to where a preview exists.
- **Do** write class names in BEM, one block per component, and use the existing state layers (3% hover, 5% fill, 8% pressed, 7% ink selected).
- **Do** keep the tray plugin on the board's tokens and put host-specific chrome in the host file (`macos.css`, `omarchy.css`), never in `tray.css`; show queue state in the bar item with the three beads and give every tray action its `bd` command and a key.
- **Do** animate with the ease-out curve at 150ms for state and 200ms for movement, and collapse motion under reduced-motion.

### Don't:
- **Don't** introduce any hue: no red errors, green success, colored priorities or blue links.
- **Don't** put a shadow on a resting card or column, and don't add a second shadow value; lifted and floating things share the one soft shadow.
- **Don't** use the Burnt Umber accent for anything but the primary button.
- **Don't** set type above 16px, at 600 or bolder, or in tracked uppercase; group headings stay sentence-case Caption Strong.
- **Don't** set prose, headings or counts in mono.
- **Don't** use Pebble (ink-3) for readable text; it is for resting icons and disabled items.
- **Don't** draw dependencies as connector lines across the board; use beads, the blocker strip, the drawer thread and the chain spotlight.
- **Don't** carry host faces, host radii or host colours (system face, monospace chrome, ink-3 or pure-black desktops) into the plugin panel, the board or any new surface; they belong to the depicted OS chrome only.
