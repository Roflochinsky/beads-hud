#!/bin/sh
# beads-hud HUD — the whole status line, no OMC involved.
# Every number comes from the JSON Claude Code puts on stdin; nothing is guessed.
# ponytail: pure shell + jq, no node spawn — this runs on every repaint.

esc=$(printf '\033')
bel=$(printf '\007')
dim="$esc[2m"; off="$esc[0m"; bold="$esc[1m"
green="$esc[32m"; amber="$esc[33m"; red="$esc[31m"; blue="$esc[34m"
sep="$dim │ $off"

input=$(cat)
eval "$(printf '%s' "$input" | jq -r '
  @sh "model=\(.model.display_name // "")",
  @sh "effort=\(.effort.level // "")",
  @sh "ctx=\(.context_window.used_percentage // 0)",
  @sh "h5=\(.rate_limits.five_hour.used_percentage // 0)",
  @sh "h5r=\(.rate_limits.five_hour.resets_at // 0)",
  @sh "wk=\(.rate_limits.seven_day.used_percentage // 0)",
  @sh "cost=\(.cost.total_cost_usd // 0)",
  @sh "dir=\(.cwd // .workspace.current_dir // "")"
' 2>/dev/null)"
[ -n "$dir" ] || dir=$PWD

# Green while there is room, amber when it is worth noticing, red when it bites.
tone() {
  if [ "$1" -ge 85 ]; then printf '%s' "$red"
  elif [ "$1" -ge 60 ]; then printf '%s' "$amber"
  else printf '%s' "$green"; fi
}

left() { # seconds until a reset, as 2ч10м / 45м
  s=$(( $1 - $(date +%s) ))
  [ "$s" -le 0 ] && return
  h=$((s/3600)); m=$(((s%3600)/60))
  [ "$h" -gt 0 ] && printf '%sч%sм' "$h" "$m" || printf '%sм' "$m"
}

# ── beads-hud segment: one server, one address. OSC 8 makes it a real hyperlink
# where the terminal supports it; the URL stays visible text either way.
seg="${dim}⏻ beads-hud${off}"
f="$HOME/.cache/beads-hud/server.json"
if [ -f "$f" ]; then
  pid=$(jq -r '.pid // empty' "$f" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    url=$(jq -r '.url' "$f")
    link="${esc}]8;;${url}${bel}${blue}${url}${off}${esc}]8;;${bel}"
    seg="${green}⏽${off}${dim} beads-hud ${off}${link}"
  fi
fi

# ── beads segment: bd stats needs ~0.4s, which is far too long for something
# that repaints every turn. The line prints a cache and kicks the refresh off
# behind itself. No daemon: the refresh lives exactly as long as one command,
# and if bd goes away the numbers simply stop moving.
beads_root() { # nearest .beads upwards — the workspace bd would answer from
  d=$1
  while [ -n "$d" ]; do
    [ -d "$d/.beads" ] && { printf '%s' "$d"; return; }
    d=${d%/*}
  done
}

bdseg=''
ws=$(beads_root "$dir")
if [ -n "$ws" ]; then
  cdir="$HOME/.cache/beads-hud"
  cf="$cdir/bd-$(printf '%s' "$ws" | sha1sum | cut -c1-12).json"
  now=$(date +%s)
  age=$(( now - $( [ -f "$cf" ] && jq -r '.at // 0' "$cf" 2>/dev/null || echo 0 ) ))
  if [ "$age" -gt 30 ]; then
    # Detached, output thrown away: a child holding stdout would stall the repaint.
    (
      mkdir -p "$cdir"
      bd -C "$ws" stats --json 2>/dev/null |
        jq -c --argjson at "$now" '{at:$at,ready:.summary.ready_issues,doing:.summary.in_progress_issues,blocked:.summary.blocked_issues}' \
          > "$cf.tmp" 2>/dev/null &&
        mv "$cf.tmp" "$cf"
    ) >/dev/null 2>&1 &
  fi
  if [ -f "$cf" ]; then
    eval "$(jq -r '@sh "bready=\(.ready // 0)", @sh "bdoing=\(.doing // 0)", @sh "bblocked=\(.blocked // 0)"' "$cf" 2>/dev/null)"
    if [ -n "$bready" ]; then
      bdseg="${dim}bd${off} ${green}${bready}${off}${dim} готово${off}"
      [ "${bdoing:-0}" -gt 0 ] && bdseg="$bdseg${dim} · ${off}${amber}${bdoing}${off}${dim} в работе${off}"
      [ "${bblocked:-0}" -gt 0 ] && bdseg="$bdseg${dim} · ${off}${red}${bblocked}${off}${dim} ждут${off}"
    fi
  fi
fi

parts="$seg"
[ -n "$bdseg" ] && parts="$parts$sep$bdseg"
parts="$parts$sep${dim}ctx${off} $(tone "$ctx")${ctx}%${off}"

r5=$(left "$h5r")
parts="$parts$sep${dim}5ч${off} $(tone "$h5")${h5}%${off}"
[ -n "$r5" ] && parts="$parts ${dim}${r5}${off}"

parts="$parts$sep${dim}нед${off} $(tone "$wk")${wk}%${off}"
parts="$parts$sep${dim}\$${off}$(printf '%.2f' "$cost")"

short=$(printf '%s' "$model" | sed 's/ (1M context)/·1M/; s/ (.*)//')
parts="$parts$sep${bold}${short}${off}"
[ -n "$effort" ] && parts="$parts ${dim}${effort}${off}"

printf '%s' "$parts"
