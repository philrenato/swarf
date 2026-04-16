#!/usr/bin/env bash
# swarf deploy — rebuild web bundles and ship to renato.design/swarf-app/
# Usage: tools/deploy.sh "commit message"
#
# What this does (in order):
#   1. esbuild prod mode rebuild  → src/pack/kiri-main.js + kiri-work.js
#   2. copy prod bundles          → philrenato-web/swarf-app/lib/...
#   3. rewrite 4 absolute/relative paths to /swarf-app/ (see feedback_swarf_deploy_paths.md)
#   4. stage + commit both repos
#   5. push only the web repo (live site); leaves the source commit local
#      unless you add --push-src.
#
# Why this script exists: r14 shipped with broken worker/wasm paths because
# the manual deploy used sed rewrites only on absolute /lib/ paths and missed
# "../lib/..." (relative) and "/wasm/..." (rooted-but-not-/lib). This script
# is the canonical path. Every future bundle redeploy should run through it.

set -euo pipefail

MSG="${1:-swarf-app: redeploy prod bundles}"
PUSH_SRC=0
for arg in "$@"; do
  if [[ "$arg" == "--push-src" ]]; then PUSH_SRC=1; fi
done

SRC_REPO="$HOME/Documents/claude/swarf/swarf_repo"
WEB_REPO="$HOME/Documents/claude/philrenato-web"
WEB_APP="$WEB_REPO/swarf-app"

cd "$SRC_REPO"

echo "[1/5] esbuild prod rebuild"
npm run webpack-src prod

echo "[2/5] copy bundles + swarf assets → $WEB_APP/"
cp src/pack/kiri-main.js "$WEB_APP/lib/main/kiri.js"
cp src/pack/kiri-work.js "$WEB_APP/lib/kiri/run/worker.js"
# swarf overlay scripts + stylesheet live at /swarf-app/ root (flattened from
# /kiri/). Sync any that changed — fast and harmless when they're already current.
for f in web/kiri/swarf*.js web/kiri/swarf.css web/kiri/swarf-materials.json; do
  [ -f "$f" ] || continue
  dst="$WEB_APP/$(basename "$f")"
  cp "$f" "$dst"
done

echo "[3/5] rewrite worker + wasm paths to /swarf-app/ absolutes"
sed -i '' 's|"\.\./lib/kiri/run/worker\.js"|"/swarf-app/lib/kiri/run/worker.js"|g' "$WEB_APP/lib/main/kiri.js"
sed -i '' 's|"\.\./wasm/manifold\.wasm"|"/swarf-app/lib/kiri/wasm/manifold.wasm"|g' "$WEB_APP/lib/main/kiri.js"
sed -i '' 's|"\.\./wasm/manifold\.wasm"|"/swarf-app/lib/kiri/wasm/manifold.wasm"|g' "$WEB_APP/lib/kiri/run/worker.js"
sed -i '' 's|"/wasm/kiri-geo\.wasm"|"/swarf-app/lib/kiri/wasm/kiri-geo.wasm"|g' "$WEB_APP/lib/kiri/run/worker.js"

# Hard-fail if any of the broken forms remain — catches bundler changes that
# introduce new path shapes we haven't taught the script about yet.
bad=$(grep -oE '"\.\./lib/[^"]*\.js"|"\.\./wasm/[^"]*\.wasm"|"/wasm/[^"]*\.wasm"' "$WEB_APP/lib/main/kiri.js" "$WEB_APP/lib/kiri/run/worker.js" || true)
if [[ -n "$bad" ]]; then
  echo "[3/5] FAIL — broken paths remain after rewrite. Investigate before shipping:"
  echo "$bad"
  exit 1
fi
echo "      ok — no broken paths remain"

echo "[4/5] commit web repo"
cd "$WEB_REPO"
git add swarf-app/lib/main/kiri.js swarf-app/lib/kiri/run/worker.js \
  swarf-app/swarf*.js swarf-app/swarf.css swarf-app/swarf-materials.json 2>/dev/null || true
git -c commit.gpgsign=false commit -m "$MSG

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" || echo "      nothing to commit"

echo "[5/5] push web repo → renato.design/swarf-app/"
git push

if [[ "$PUSH_SRC" == "1" ]]; then
  echo "[extra] push src repo"
  cd "$SRC_REPO"
  git push
fi

echo
echo "deployed. give GitHub Pages ~60s, then hard-reload renato.design/swarf-app/"
