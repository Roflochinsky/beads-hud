#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash integrations/omarchy/install.sh --app EXECUTABLE --helper WAYBAR_JS \
  --project DIRECTORY [--project DIRECTORY ...] [--app-dir ELECTRON_APP] \
  [--node NODE] [--directory NEW_DIRECTORY]

Creates a new, self-contained snippet directory; never edits Waybar or any
existing files. Use --app-dir only when EXECUTABLE is a development Electron
binary that needs a project directory argument. Then add the generated module
to your own Waybar configuration explicitly. Node 24 or newer is required.
USAGE
}

app=''
helper=''
app_dir=''
node=''
destination="${XDG_CONFIG_HOME:-$HOME/.config}/beads-waybar"
projects=()
while (($#)); do
  case "$1" in
    --app|--helper|--app-dir|--node|--directory|--project)
      option=$1
      if (($# < 2)) || [[ -z $2 || $2 == --* ]]; then printf 'Missing value for %s\n' "$option" >&2; exit 2; fi
      case "$option" in
        --app) app=$2 ;;
        --helper) helper=$2 ;;
        --app-dir) app_dir=$2 ;;
        --node) node=$2 ;;
        --directory) destination=$2 ;;
        --project) projects+=("$2") ;;
      esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done
if [[ -z $app || -z $helper || ${#projects[@]} -eq 0 ]]; then usage >&2; exit 2; fi
if [[ -z $node ]]; then node=$(command -v node || true); fi
if [[ ! -x $app || ! -f $helper || -z $node || ! -x $node ]]; then
  printf 'The app and Node must be executable, and the built Waybar helper must exist.\n' >&2; exit 1
fi
if [[ -n $app_dir && ! -d $app_dir ]]; then printf 'Electron app directory does not exist: %s\n' "$app_dir" >&2; exit 1; fi
app=$(realpath -e -- "$app")
helper=$(realpath -e -- "$helper")
node=$(realpath -e -- "$node")
if [[ -n $app_dir ]]; then app_dir=$(realpath -e -- "$app_dir"); fi
for index in "${!projects[@]}"; do
  if [[ ! -d ${projects[index]} ]]; then printf 'Project directory does not exist: %s\n' "${projects[index]}" >&2; exit 1; fi
  projects[index]=$(realpath -e -- "${projects[index]}")
done
mkdir -p -- "$(dirname -- "$destination")"
if ! mkdir -- "$destination"; then
  printf 'Refusing to replace the existing destination: %s\n' "$destination" >&2; exit 1
fi
destination=$(realpath -e -- "$destination")

# %q is interpreted by the generated Bash scripts, never by Waybar's /bin/sh.
{
  printf '#!/usr/bin/env bash\nexec %q %q' "$node" "$helper"
  for project in "${projects[@]}"; do printf ' --project %q' "$project"; done
  printf '\n'
} > "$destination/count.sh"
{
  printf '#!/usr/bin/env bash\nexec %q' "$app"
  if [[ -n $app_dir ]]; then printf ' %q' "$app_dir"; fi
  for project in "${projects[@]}"; do printf ' --project %q' "$project"; done
  printf ' --toggle\n'
} > "$destination/toggle.sh"
chmod 755 -- "$destination/count.sh" "$destination/toggle.sh"

# JSON and desktop-entry quoting are distinct from shell quoting. Generate both
# from the original argv, not from a reconstructed shell command.
"$node" - "$destination" "$app" "$app_dir" "${projects[@]}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [destination, app, appDir, ...projects] = process.argv.slice(2);
const shellQuote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const moduleConfig = {
  'custom/beads': {
    format: '{}',
    'return-type': 'json',
    exec: shellQuote(path.join(destination, 'count.sh')),
    interval: 30,
    'on-click': shellQuote(path.join(destination, 'toggle.sh')),
    tooltip: true,
  },
};
fs.writeFileSync(path.join(destination, 'module.jsonc'), JSON.stringify(moduleConfig, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(destination, 'module.css'), '#custom-beads { padding: 0 8px; }\n#custom-beads.error, #custom-beads.unconfigured { opacity: 0.75; }\n', { flag: 'wx' });
// Desktop Entry Exec values are not shell commands. Escape the field-code
// percent sign and the four characters requiring escapes in quoted arguments.
const desktopQuote = (s) => {
  if (/[\r\n]/.test(s)) throw new Error('A desktop-entry path cannot contain a newline');
  return '"' + s.replaceAll('%', '%%').replace(/["`$\\]/g, '\\$&') + '"';
};
const args = [app, ...(appDir ? [appDir] : []), ...projects.flatMap((project) => ['--project', project])];
const entry = '[Desktop Entry]\nType=Application\nName=Beads Board\nExec=' + args.map(desktopQuote).join(' ') + '\nTerminal=false\nCategories=Development;\n';
fs.writeFileSync(path.join(destination, 'dev.roflochinsky.beads.desktop'), entry, { flag: 'wx' });
NODE
printf '\nCreated %s\n' "$destination"
printf 'Review module.jsonc and module.css; merge them into your existing Waybar config yourself.\n'
printf 'Review the generated desktop entry before explicitly installing it for portal identity.\n'
