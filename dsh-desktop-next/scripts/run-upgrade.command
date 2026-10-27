#!/bin/sh
# No user-name, task directory or developer dependency path is embedded here.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -d "$here/tools" ]; then scripts="$here/tools"; else scripts="$here"; fi
entry=upgrade-cli.mjs
if [ "${1:-}" = --entry ]; then entry=$2; shift 2; fi
case "$entry" in upgrade-cli.mjs|dsh-window.mjs) ;; *) echo 'Unsupported tool entry' >&2; exit 2 ;; esac
if [ "$entry" = upgrade-cli.mjs ] && [ "$#" -eq 0 ] && [ -f "$here/package.json" ]; then set -- install "$here"; fi
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  exec node "$scripts/$entry" "$@"
fi
app=''
record="$HOME/.local/share/dsh-next-upgrade/installation.json"
if [ -f "$record" ]; then app=$(/usr/bin/plutil -extract app raw -o - "$record" 2>/dev/null || true); fi
if [ -z "$app" ]; then
  for candidate in "$HOME/Applications/DSH NEXT.app" '/Applications/DSH NEXT.app'; do
    if [ -x "$candidate/Contents/MacOS/DSH NEXT" ]; then
      if [ -n "$app" ]; then echo 'Multiple apps found; install Node 22+ or set up an explicit application first.' >&2; exit 2; fi
      app=$candidate
    fi
  done
fi
if [ -z "$app" ] || [ ! -x "$app/Contents/MacOS/DSH NEXT" ]; then echo 'Install Node 22+ or DSH NEXT before using this tool.' >&2; exit 2; fi
ELECTRON_RUN_AS_NODE=1 exec "$app/Contents/MacOS/DSH NEXT" "$scripts/$entry" "$@"
