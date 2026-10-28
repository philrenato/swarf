#!/usr/bin/env bash
# swarf deploy — rebuild web bundles and ship to renato.design/swarf-app/
# Usage: tools/deploy.sh "commit message"
#
# FORKING: this UPDATES an existing static copy of the app (a git repo that serves
# swarf at /swarf-app/, with its own index.html); it does not create one, it uses
# macOS sed, and it pushes that repo. Set SWARF_WEB_REPO=/path/to/your/site.
#
# What this does (in order):
#   1. esbuild prod mode rebuild  → src/pack/kiri-main.js + kiri-work.js
#   2. copy prod bundles          → philrenato-web/swarf-app/lib/...
#   3. rewrite 4 absolute/relative paths to /swarf-app/ (relative ../lib, rooted /wasm and /obj
#      paths all have to point under /swarf-app/ or the worker and wasm 404)
#   4. stamp swarf-sw.js's cache version so this deploy invalidates the
#      previous offline cache instead of a lab tab serving a stale engine
#   5. stage + commit the WEB repo only — commit the source repo yourself
#   6. push only the web repo (live site); leaves the source commit local
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

SRC_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_REPO="${SWARF_WEB_REPO:-$SRC_REPO/../../philrenato-web}"
if [ ! -d "$WEB_REPO/swarf-app" ]; then
  echo "deploy: no site to update at $WEB_REPO/swarf-app. Set SWARF_WEB_REPO to a repo that serves swarf at /swarf-app/." >&2
  exit 1
fi
WEB_REPO="$(cd "$WEB_REPO" && pwd)"
WEB_APP="$WEB_REPO/swarf-app"

cd "$SRC_REPO"

echo "[1/5] esbuild prod rebuild"
npm run webpack-src prod

echo "[2/5] copy bundles + swarf assets → $WEB_APP/"
cp src/pack/kiri-main.js "$WEB_APP/lib/main/kiri.js"
cp src/pack/kiri-work.js "$WEB_APP/lib/kiri/run/worker.js"
# swarf overlay scripts + stylesheet live at /swarf-app/ root (flattened from
# /kiri/). Sync any that changed — fast and harmless when they're already current.
for f in web/kiri/swarf*.js web/kiri/swarf*.mjs web/kiri/swarf*.css web/kiri/swarf-materials.json \
         web/kiri/swarf-icon-*.png web/kiri/manifest.json; do
  [ -f "$f" ] || continue
  dst="$WEB_APP/$(basename "$f")"
  cp "$f" "$dst"
done

# r36: Unreason's 2D readers/writers (swarf-vector.mjs imports them); r40: opentype.js (DRAW text)
mkdir -p "$WEB_APP/vendor" && cp -R web/kiri/vendor/. "$WEB_APP/vendor/"
# the licenses travel with the copy (MIT, Apache, Boost and OFL all ask for it); the About panel links them
node tools/make_notices.mjs >/dev/null
cp license.md THIRD_PARTY_NOTICES.txt "$WEB_APP/"
echo "[3/5] rewrite worker + wasm + asset paths to /swarf-app/ absolutes"
# worker + wasm (fatal — toolpaths break without these)
sed -i '' 's|"\.\./lib/kiri/run/worker\.js"|"/swarf-app/lib/kiri/run/worker.js"|g' "$WEB_APP/lib/main/kiri.js"
sed -i '' 's|"\.\./wasm/manifold\.wasm"|"/swarf-app/lib/kiri/wasm/manifold.wasm"|g' "$WEB_APP/lib/main/kiri.js"
sed -i '' 's|"\.\./wasm/manifold\.wasm"|"/swarf-app/lib/kiri/wasm/manifold.wasm"|g' "$WEB_APP/lib/kiri/run/worker.js"
sed -i '' 's|"/wasm/kiri-geo\.wasm"|"/swarf-app/lib/kiri/wasm/kiri-geo.wasm"|g' "$WEB_APP/lib/kiri/run/worker.js"
# seed/sample STL paths (fatal — init_input waits on platform.load_stl's
# callback; a 404 here leaves the callback unfired, init hangs, curtain
# never lifts. We learned this the hard way with /obj/cube.stl).
sed -i '' "s|'/obj/|'/swarf-app/obj/|g" "$WEB_APP/lib/main/kiri.js"
sed -i '' 's|"/obj/|"/swarf-app/obj/|g' "$WEB_APP/lib/main/kiri.js"

# Hard-fail if any of the broken forms remain — catches bundler changes that
# introduce new path shapes we haven't taught the script about yet.
bad=$(grep -oE '"\.\./lib/[^"]*\.js"|"\.\./wasm/[^"]*\.wasm"|"/wasm/[^"]*\.wasm"|"/obj/[^"]*"|'"'"'/obj/[^'"'"']*'"'"'' "$WEB_APP/lib/main/kiri.js" "$WEB_APP/lib/kiri/run/worker.js" || true)
if [[ -n "$bad" ]]; then
  echo "[3/5] FAIL — broken paths remain after rewrite. Investigate before shipping:"
  echo "$bad"
  exit 1
fi
echo "      ok — no broken paths remain"

echo "[4/6] stamp swarf-sw.js cache version"
STAMP="$(date +%Y%m%d%H%M%S)-$(git -C "$SRC_REPO" rev-parse --short HEAD)"
sed -i '' "s|__SWARF_DEPLOY_STAMP__|$STAMP|g" "$WEB_APP/swarf-sw.js"
remaining=$(grep -l '__SWARF_DEPLOY_STAMP__' "$WEB_APP/swarf-sw.js" || true)
if [[ -n "$remaining" ]]; then
  echo "[4/6] FAIL — cache-stamp placeholder still present, offline cache won't invalidate"
  exit 1
fi
echo "      ok — cache version: $STAMP"

echo "[5/6] commit web repo"
cd "$WEB_REPO"
git add swarf-app/lib/main/kiri.js swarf-app/lib/kiri/run/worker.js \
  swarf-app/swarf*.js swarf-app/swarf*.mjs swarf-app/vendor swarf-app/swarf*.css swarf-app/swarf-materials.json \
  swarf-app/swarf-icon-*.png swarf-app/manifest.json swarf-app/index.html \
  swarf-app/license.md swarf-app/THIRD_PARTY_NOTICES.txt 2>/dev/null || true
# NOTE: index.html is staged but NEVER copied from source. The deploy copy has
# its own SEO metadata and RELATIVE css/font paths (moto/palette.css, not
# /moto/palette.css) — copying source over it breaks every stylesheet on the
# live site. Edit the deploy copy directly, or teach this script a targeted
# patch, but do not add it to the copy loop above.
git -c commit.gpgsign=false commit -m "$MSG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || echo "      nothing to commit"

echo "[6/6] push web repo → renato.design/swarf-app/"
git push

if [[ "$PUSH_SRC" == "1" ]]; then
  echo "[extra] push src repo"
  cd "$SRC_REPO"
  git push
fi

echo
echo "deployed. give GitHub Pages ~60s, then hard-reload renato.design/swarf-app/"
