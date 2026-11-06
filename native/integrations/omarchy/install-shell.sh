#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash integrations/omarchy/install-shell.sh --app EXECUTABLE --helper WAYBAR_JS \
  --project DIRECTORY [--project DIRECTORY ...] [--app-dir ELECTRON_APP] \
  [--node NODE] [--directory NEW_DIRECTORY]

Explicitly installs a manifest-backed Omarchy shell widget into a new directory.
It never overwrites existing files or changes the bar configuration. Use
--app-dir only with a development Electron binary. After reviewing the files,
rescan and enable dev.roflochinsky.beads using Omarchy's plugin commands.
USAGE
}

app=''
helper=''
app_dir=''
node=''
destination="$HOME/.config/omarchy/plugins/dev.roflochinsky.beads"
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
  printf 'The app and Node must be executable, and the built readiness helper must exist.\n' >&2; exit 1
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
source_dir=$(dirname -- "$(realpath -e -- "${BASH_SOURCE[0]}")")
mkdir -p -- "$(dirname -- "$destination")"
if ! mkdir -- "$destination"; then
  printf 'Refusing to replace the existing destination: %s\n' "$destination" >&2; exit 1
fi
destination=$(realpath -e -- "$destination")
cp -- "$source_dir/shell/manifest.json" "$source_dir/shell/Widget.qml" "$destination/"

# Each generated launcher uses Bash's %q representation of the original argv.
# The QML widget executes the launcher directly; it never builds a shell command.
{
  printf '#!/usr/bin/env bash\nexec %q %q --format=omarchy' "$node" "$helper"
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

# The portal identity is optional and is not installed into the user's
# applications directory without a separate explicit step.
"$node" - "$destination" "$app" "$app_dir" "${projects[@]}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [destination, app, appDir, ...projects] = process.argv.slice(2);
const desktopQuote = (s) => {
  if (/[\r\n]/.test(s)) throw new Error('A desktop-entry path cannot contain a newline');
  return '"' + s.replaceAll('%', '%%').replace(/["`$\\]/g, '\\$&') + '"';
};
const args = [app, ...(appDir ? [appDir] : []), ...projects.flatMap((project) => ['--project', project])];
const entry = '[Desktop Entry]\nType=Application\nName=Beads Board\nExec=' + args.map(desktopQuote).join(' ') + '\nTerminal=false\nCategories=Development;\n';
fs.writeFileSync(path.join(destination, 'dev.roflochinsky.beads.desktop'), entry, { flag: 'wx' });
NODE
printf '\nInstalled widget files in %s\n' "$destination"
printf 'No bar configuration was changed. Review the files, then rescan and explicitly enable dev.roflochinsky.beads.\n'
printf 'A non-default --directory is a staging path; Omarchy discovers plugins only in ~/.config/omarchy/plugins/.\n'
