# Tern moved to beads-tern

The native Tern plugin is maintained and released independently in **[Roflochinsky/beads-tern](https://github.com/Roflochinsky/beads-tern)**.

- [Installation and requirements](https://github.com/Roflochinsky/beads-tern#install)
- [Native SDK, behavior and verification](https://github.com/Roflochinsky/beads-tern/blob/main/docs/tern.md)
- [Approved OMP-only roadmap](https://github.com/Roflochinsky/beads-tern/blob/main/docs/product-scope.md)

This checkout no longer builds or packages Tern. Paseo, Omarchy and Linux/macOS applications remain in `native/`; the browser HUD remains at the repository root.

The historical `native-v0.1.2` release and its Tern archive are preserved. They are not rewritten, and their recorded checks in [verification.md](verification.md) remain historical evidence. New Tern releases start at 0.1.0 in the independent repository. The installed plugin identity stays `beads` / `beads.board`; follow the new README's migration instructions to replace an installed copy.
