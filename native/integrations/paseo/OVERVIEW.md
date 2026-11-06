# Beads

Beads brings a ready-first issue board into Paseo workspace tabs and the sidebar. Switch between a board and a compact table, search issues, see blockers and dependents, and create, edit, claim, close, reopen or link issues. Comments and stale-lease reclaim use the same Beads backend.

The daemon machine needs `bd` on its PATH and an initialized Beads database in each workspace you use. Projects come from Paseo's registered workspaces, including their worktree directories. The plugin does not initialize databases or change daemon configuration.

Open **Beads** in the sidebar, choose **Open Beads board** in the workspace Command Center, or submit `/beads` in the workspace composer. An interactive agent session also receives a `beads` tool scoped to its workspace. Tool availability depends on the agent provider's Paseo tool support; refresh an existing session to pick up newly registered tools.

The plugin uses Paseo's cross-platform React Native panel API and requires Paseo 0.14.x. Its warm monochrome surfaces, density and type sizes follow the supplied Beads design. Fonts use the native host's installed font; the plugin does not inject browser CSS or pretend to load a custom native font.

Code is trusted and unsandboxed. RPC handlers execute the shared Beads service on the daemon machine using fixed `bd` argument lists, not a shell. Requests select registered workspace IDs, never caller-supplied directories. Backend failures remain visible. Mutations refresh authoritative data and agent lifecycle events never automatically close issues.
