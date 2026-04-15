#!/bin/bash
# swarf_console.sh — pull console logs + errors from a headless Chrome run
# against the live dev server. Writes the combined log to a file Claude can read.
#
# Usage:
#   tools/swarf_console.sh [url-path] [seconds]
#   tools/swarf_console.sh               # defaults to /kiri/ for 10s
#   tools/swarf_console.sh /kiri/ 20     # 20s run
#
# The script uses Chrome's remote-debugging protocol via `chrome --dump-dom`
# is NOT sufficient; instead we use a headless flag that logs console output
# to stderr and we capture it.
#
# IMPORTANT: Kills any existing headless Chrome first so we don't interfere
# with Phil's real browser.

set -u

URL_PATH="${1:-/kiri/}"
SECS="${2:-10}"
OUT="/tmp/swarf-console-$(date +%s).log"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="/tmp/swarf-headless-$$-$(date +%s)"

if [ ! -x "$CHROME" ]; then
  echo "error: Chrome not at $CHROME" >&2
  exit 1
fi

# safety: kill stale headless only
pkill -f 'Google Chrome.*headless' 2>/dev/null || true
sleep 1

URL="http://localhost:8181${URL_PATH}"
echo "swarf_console: capturing ${URL} for ${SECS}s → ${OUT}"

# --enable-logging=stderr --v=1 floods; use --enable-logging + --log-level=0
# combined with --headless=new which forwards console.log to stderr.
"$CHROME" \
  --headless=new \
  --disable-gpu \
  --enable-webgl \
  --use-gl=angle \
  --enable-unsafe-swiftshader \
  --window-size=1600,1000 \
  --virtual-time-budget=$((SECS * 1000)) \
  --user-data-dir="$DIR" \
  --enable-logging=stderr \
  --log-level=0 \
  --disable-web-security \
  "$URL" 2>"$OUT" 1>/dev/null

rm -rf "$DIR"

# filter down to console.log / error / warn output lines
FILTERED="${OUT%.log}-filtered.log"
grep -E 'CONSOLE|ERROR|Uncaught|swarf-|\[swarf|kiri \|' "$OUT" > "$FILTERED" 2>/dev/null || true

echo "swarf_console: raw log at $OUT"
echo "swarf_console: filtered (console+errors) at $FILTERED"
echo "--- last 80 lines of filtered output ---"
tail -80 "$FILTERED" 2>/dev/null || tail -80 "$OUT"
