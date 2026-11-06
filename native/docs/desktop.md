# Desktop: Linux and macOS

Beads Board is an Electron tray application backed by the same Beads service as the other hosts. It reads and changes real issues by running `bd` in the selected project directories. It does not initialize a project, invent issue data, or use the current directory as an implicit project. Install a compatible `bd` and make sure the graphical session can find it on `PATH`; initialize the Beads project separately before opening it here.

## Install and start

### Build and run from a checkout

Install Node.js 24 or newer and npm, then run these commands from `native/` in the beads-hud checkout (not the browser HUD repository root):

```sh
npm ci
npm exec -- install-electron
npm run build
npm start -- --project "$HOME/src/your-project"
```

`install-electron` downloads the Electron runtime; installing the npm package alone does not. The `--project` argument may be repeated. Paths containing spaces must be quoted in your shell. Start without `--project` to use **Manage projects** in the popover, or choose **Choose projects…** from the tray menu. The native folder picker replaces the selected project set and can select several directories. Project selections are held in memory only: no project list is written to user configuration, and a picker selection must be made again after quitting unless supplied with `--project`. Starting a second instance with explicit project arguments replaces the running instance's selection; without them it retains the selection.

Click the tray item to toggle the popover. Its header opens the full board and the project picker; right-click the macOS item for the native menu. Linux tray activation varies with the desktop environment: the native menu also contains **Toggle Beads**, **Open board**, **Quick capture**, **Choose projects…**, and **Quit Beads**. Closing the board or popover leaves the tray process running; use **Quit Beads** to exit.

The global quick-capture shortcut is **Command+Shift+Space** on macOS and **Control+Shift+Space** on Linux. It opens the same create-issue flow as the `n` key in the tray UI. If registration reports failure, the app remains usable and the tray menu marks the shortcut unavailable; **Quick capture** in the menu still works. A Wayland portal can also deny a binding without reporting that denial to the app. Command-line `--quick-capture` also opens that flow in the running app. If no project is selected, choose one first.

The icon's three monochrome beads represent an issue closed within the last seven days, an in-progress issue, and a non-empty ready queue; inactive states are dimmed. The count is the sum of real `bd ready` IDs across selected projects. macOS shows the count beside the tray icon; Linux shows it in the tooltip and in the optional Waybar module. A missing project, an in-progress load, or a Beads error is shown as unknown/loading/error rather than a fabricated zero. If any selected project's snapshot fails, no partial aggregate is presented as the total; inspect the tray tooltip or open the affected project in the UI for the error.

### Package a standalone app

From `native/` with the dependencies and Electron runtime installed as above:

```sh
npm run build
npm run package:desktop -- --linux   # build on Linux
# or, on a macOS machine:
npm run package:desktop -- --mac
```

Artifacts are written under `release/`. The Linux targets are AppImage and tar.gz; the macOS targets are DMG and ZIP. For example, install the generated Linux AppImage under a user-owned directory, then run it (replace the artifact name with the one actually built):

```sh
mkdir -p "$HOME/.local/bin"
install -m 755 "release/beads-board-<version>-linux-<arch>.AppImage" "$HOME/.local/bin/beads-board.AppImage"
"$HOME/.local/bin/beads-board.AppImage" --project "$HOME/src/your-project"
```

On macOS open the generated DMG, drag **Beads Board.app** to Applications, and start it. To pass initial projects from Terminal:

```sh
open -a "Beads Board" --args --project "$HOME/src/your-project"
```

Packaging does **not** supply an Apple Developer ID, signing certificate, provisioning credentials, or notarization. An unsigned/unnotarized build can be blocked or warned about by Gatekeeper on other Macs; distribution outside your own machine requires the appropriate Apple signing and notarization workflow. Do not disable Gatekeeper system-wide to run it. macOS security and privacy controls may prompt for system permissions depending on OS version and environment. Approve only permissions you intend to grant. The app does not request accessibility access itself.

On Linux an AppImage may require a working FUSE setup; use the tar.gz build or the AppImage's documented extraction option if FUSE is unavailable. A system tray / StatusNotifierItem host is required for the tray icon, and tray click semantics depend on that host. Under Wayland, the compositor may refuse arbitrary window positioning or focus, so the popover can appear away from the tray. If your session has XWayland, you may choose `--ozone-platform=x11` when starting the app to allow X11-style placement; the application does not force XWayland or disable sandboxing.

Wayland global shortcuts depend on the compositor and `xdg-desktop-portal`'s GlobalShortcuts support, a valid `dev.roflochinsky.beads.desktop` application identity, and any system consent. Registration can be unavailable or a portal can deny it; see your desktop's shortcut/portal settings. X11 and macOS can also refuse a shortcut claimed by another application. For example, on the development build an optional XWayland launch is:

```sh
npm start -- --ozone-platform=x11 --project "$HOME/src/your-project"
```

## Omarchy shell widget

Current Omarchy uses a Quickshell-based bar. The `dev.roflochinsky.beads` third-party bar widget displays the three monochrome Beads states and the real ready count. It polls the same bundled TypeScript readiness helper and core service as the desktop app; left-click launches or toggles the real Electron popover, and middle-click refreshes the count. On a vertical bar the compact three-bead mark omits the number, which remains available in the tooltip. A failed snapshot produces an error indicator and tooltip, never a fabricated count.

Build the app and helper first, then **explicitly** install the widget with the paths and projects you want it to use:

```sh
bash integrations/omarchy/install-shell.sh \
  --app "$HOME/.local/bin/beads-board.AppImage" \
  --helper "$PWD/dist/desktop/waybar.js" \
  --project "$HOME/src/your-project"
```

For the development Electron executable, replace the `--app` argument with `--app "$PWD/node_modules/.bin/electron" --app-dir "$PWD"`. Repeat `--project` for more projects. The installer resolves paths and writes its manifest, QML widget, and argv-preserving launchers to the new directory `~/.config/omarchy/plugins/dev.roflochinsky.beads`; it refuses to overwrite an existing directory. `--node /absolute/path/to/node` selects a Node 24+ runtime, and `--directory NEW_DIRECTORY` writes a staging copy elsewhere. Omarchy discovers third-party plugins only under `~/.config/omarchy/plugins/`, so a staging copy must be placed there explicitly before enabling it. A packaged Linux app also provides `resources/waybar.mjs` outside `app.asar`, which can be used as the helper.

The installer does **not** edit `shell.json`, enable the widget, or touch existing bar configuration. After reviewing the generated files, rescan and use Omarchy's explicit configuration commands:

```sh
omarchy-shell shell rescanPlugins
omarchy plugin list
# Once dev.roflochinsky.beads appears:
omarchy plugin enable dev.roflochinsky.beads
omarchy bar move dev.roflochinsky.beads --section right
```

The last two commands intentionally update your user-owned shell configuration; they are not run by the installer. `omarchy bar move` is optional if the widget's default right-hand placement is suitable. For manual configuration, add `{ "id": "dev.roflochinsky.beads" }` to the desired existing `bar.layout` section instead of replacing the rest of the layout. On current Omarchy the user's `shell.json` is canonical rather than deep-merged with defaults, so preserve the existing file and all unrelated entries. The generated launchers retain absolute paths; reinstall into a new directory when the app, Node, helper, or projects move.

The widget's configured projects are independent of temporary picker changes in the running app; clicking the widget selects its configured projects. The shell's environment must be able to find `bd` on `PATH`. If a Wayland shortcut portal needs an application identity and the packaged app did not already install one, review the generated `~/.config/omarchy/plugins/dev.roflochinsky.beads/dev.roflochinsky.beads.desktop`, then explicitly install it without replacing an existing entry:

```sh
mkdir -p "$HOME/.local/share/applications"
entry="$HOME/.local/share/applications/dev.roflochinsky.beads.desktop"
if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then
  install -m 644 "$HOME/.config/omarchy/plugins/dev.roflochinsky.beads/dev.roflochinsky.beads.desktop" "$entry"
else
  printf 'Existing desktop entry left unchanged: %s\n' "$entry"
fi
```

Restart the desktop app and approve portal consent if prompted. To remove the widget, explicitly run `omarchy plugin disable dev.roflochinsky.beads` and remove the dedicated plugin directory; remove the desktop entry only if you installed it for Beads and no longer need it.

## Optional legacy Waybar module

If you use Waybar instead of the current Omarchy shell bar, the following separate integration provides a Waybar module. It does not install a Quickshell plugin or modify any existing bar configuration.

The module runs the bundled Node helper against the same Beads core service as the app, with the explicit project arguments given to the installer. It emits one Waybar JSON result per poll, every 30 seconds. Clicking invokes the real Electron app with the same project arguments and `--toggle`; no separate demo backend is involved. The module's project list is independent of temporary picker changes in an already-running app; clicking it selects the projects configured for the module. An error is shown instead of an invented count.

After building as above, explicitly generate a new snippet directory:

```sh
bash integrations/omarchy/install.sh \
  --app "$HOME/.local/bin/beads-board.AppImage" \
  --helper "$PWD/dist/desktop/waybar.js" \
  --project "$HOME/src/your-project"
```

For a development Electron launch instead, supply the Electron executable and the checkout as its app directory:

```sh
bash integrations/omarchy/install.sh \
  --app "$PWD/node_modules/.bin/electron" --app-dir "$PWD" \
  --helper "$PWD/dist/desktop/waybar.js" \
  --project "$HOME/src/your-project"
```

Repeat `--project` for additional directories. The Node executable defaults to the `node` found on the installer's `PATH`; use `--node /absolute/path/to/node` to choose another Node 24+ executable. The generated launchers retain absolute paths, so rebuild/regenerate them if the checkout, Node, app, or project moves. A packaged Linux app also includes `resources/waybar.mjs` outside `app.asar`; an unpacked installation's helper can be passed to `--helper` instead of the checkout's `dist/desktop/waybar.js`.

The default output is `${XDG_CONFIG_HOME:-$HOME/.config}/beads-waybar`; `--directory NEW_DIRECTORY` chooses another path. The installer refuses an existing output directory and does not modify any existing Waybar config. Review its generated `module.jsonc` and `module.css`, then manually merge the `custom/beads` object into your existing Waybar configuration, add `"custom/beads"` to the desired existing `modules-left`, `modules-center`, or `modules-right` array, and merge the CSS into your user-owned Waybar stylesheet. Do not replace your current config with the snippet. Reload Waybar using your normal session procedure.

For a portal identity when the app has not already installed one, the generated `dev.roflochinsky.beads.desktop` is also only a **candidate**: review it, then explicitly install it without overwriting an existing application entry:

```sh
mkdir -p "$HOME/.local/share/applications"
entry="$HOME/.local/share/applications/dev.roflochinsky.beads.desktop"
if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then
  install -m 644 "${XDG_CONFIG_HOME:-$HOME/.config}/beads-waybar/dev.roflochinsky.beads.desktop" "$entry"
else
  printf 'Existing desktop entry left unchanged: %s\n' "$entry"
fi
```

If `--directory` was used, substitute that directory in the source path. Restart the app after installing the entry, then grant any portal consent in your desktop environment. This entry is not automatically installed or modified. Delete the dedicated generated snippet directory and remove only the manually-added module lines to uninstall the Waybar integration; remove the desktop entry only if you installed it for Beads and no longer want it.

## Security and paths

The renderer runs with `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. A sandbox-compatible preload exposes only the typed Beads request transport and fixed host actions; no generic Node, shell, or IPC API is exposed. The main process checks the sending window and bundled document, allows only the shared Beads methods and input fields, and confines requests to the explicitly selected project IDs. A local `beads://app` origin serves only bundled UI resources; navigation, popup creation, and permission requests are denied. The core service invokes `bd` with argument vectors rather than interpolating commands into a shell.

Electron tray, shortcut, and placement behavior is platform-dependent. See [Electron Tray](https://www.electronjs.org/docs/latest/api/tray), [globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut), and [BrowserWindow's Wayland notices](https://www.electronjs.org/docs/latest/api/browser-window#platform-notices).
