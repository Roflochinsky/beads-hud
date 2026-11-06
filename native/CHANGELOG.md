# Changelog

## 0.1.1 — repository split

- Moved native Tern/Paseo/Omarchy and Linux/macOS delivery into the independent `native/` package in beads-hud; the root browser HUD remains 0.6.0 with its existing Node.js 22 contract.
- Removed the separate IDE plugin adapter, transport, build output and release archive from this package.
- Added root-level native CI, a browser HUD test gate, `native-v*` version checks and an exact native release asset contract.
- Updated package identities, public documentation and generated-output exclusions. Migration checks are pending; earlier runtime evidence below predates this move.

## 0.1.0 — 2026-11-06, before migration

- Added Beads integrations for Tern and Paseo, plus desktop tray/menu-bar applications for Linux and macOS.
- Added a native Omarchy Quickshell widget and an optional Waybar adapter.
- Implemented real Beads create, update, claim, close, reopen, reclaim, dependency and comment operations through the installed CLI.
- Added board/table views, native readiness filters, dependency details, keyboard actions and guarded close undo using the supplied warm monochrome design.
- Preserved native dependency edges for singleton queries and suppressed directory-default list filtering without changing project configuration.
- Preserved unrelated concurrent issue changes in edited-field updates; pending native-host actions retain their selected issue.
- Added bounded authenticated loopback development transport and constrained desktop IPC.
- Added Linux/macOS CI packaging, version-tagged releases, checksum verification and optional Apple signing/notarization through Actions secrets.
- Verified packaged Linux and macOS renderer startup, isolated real database writes and popup dimensions in CI.
- Fixed search focus during synchronous input/change events and kept close undo above the detail drawer.
- Fixed native Tern surface painting by leaving its overlay transparent; enabled scrolling to clipped details and top-aligned board columns.
- Rendered native Paseo comments as author, timestamp and text.

Known runtime limits and exercised checks are recorded in [docs/verification.md](docs/verification.md).
