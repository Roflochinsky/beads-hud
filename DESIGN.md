# Beads HUD design

## Direction

A quiet, local project workspace. The selected visual reference is https://louis-unpaid-invoice.vercel.app/: paper-white surfaces, a full-height neutral sidebar, thin dividers, restrained violet actions, compact rectangular controls and generous row spacing. This supersedes the previous floating Liquid Glass direction.

## System

- Inter remains self-hosted, including Cyrillic. JetBrains Mono marks IDs, priorities and dates.
- Light is the default; dark is an explicit toggle and does not follow OS changes.
- Neutral chrome: #fafafa. Reading surface: #ffffff. Primary text: #27272a. Secondary text: #606068. Muted text: #73737c.
- Accent: #6961e8. Status retains separate, subdued green, amber, red and grey indicators and visible text.
- Controls use 7px corners, cards 7–9px, outer workspace and overlays 12px. Borders provide separation; only overlay layers have substantial shadow.
- Desktop: 220px persistent sidebar (200px and 180px at narrower widths), 52px header, 54px view toolbar. The main workspace has an 8px outer inset.
- The sidebar contains project selection, tasks/documents, task kinds and epic filters, local-data context and theme toggle.
- Board, list and graph remain views over the same source data. List rows use 49px minimum height, small status badges and sortable column headers.
- Below 600px, the sidebar becomes a 52px icon rail. The folder control exposes project selection and all filters. Board and table scroll within the content area; persistent controls remain visible.
- Focus indicators and reduced-motion handling are retained.

## Implementation boundaries

`public/workspace.css` is the new visual skin over the existing component behavior stylesheet. `public/index.html` consolidates navigation. `public/beads-hud.js` adds a visible filtered count, a labeled theme state, responsive navigation and status classes; server/API and bd event flows are unchanged.

No hosted service, new integration, new persistence layer or production dependency is added. Existing document editing and task create/claim/close/reopen/release actions remain intact. Preview screenshots use an isolated demo fixture; they are not the owner's live task database.
