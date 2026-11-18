#!/usr/bin/env bash
# swarf deploy — rebuild web bundles and ship to renato.design/swarf-app/
# Usage: tools/deploy.sh "commit message"
#
# FORKING: this UPDATES an existing static copy of the app (a git repo that serves
# swarf at /swarf-app/, with its own index.html); it does not create one, it uses
# macOS sed, and it pushes that repo. Set SWARF_WEB_REPO=/path/to/your/site.
#
# What this does (in order):
#   1. esbuild prod mode rebuild  → src/pack/kiri-main.js + kiri-work.js + kiri-pool.js
#   2. copy prod bundles          → philrenato-web/swarf-app/lib/...
#   3. rewrite 4 absolute/relative paths to /swarf-app/ (relative ../lib, rooted /wasm and /obj
#      paths all have to point under /swarf-app/ or the worker and wasm 404)
#   4. stamp swarf-sw.js's cache version so this deploy invalidates the
#      previous offline cache instead of a lab tab serving a stale engine; stamp the
#      build into the engine files and their URLs (?b=); write the offline file list
#      (tools/precache-list.mjs) into swarf-sw.js
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
# the worker starts its helpers from ./minion.js; they run the same toolpath code, so they ship with it
cp src/pack/kiri-pool.js "$WEB_APP/lib/kiri/run/minion.js"
# the GPU raster helper the worker starts (../../gpu/ from it); src/gpu links it from @gridspace/raster-path (MIT)
mkdir -p "$WEB_APP/lib/gpu"
cp -L src/gpu/raster-worker.js "$WEB_APP/lib/gpu/raster-worker.js"
# the stylesheet sits at the site's root, beside moto/, not one folder down as in the source
sed 's|\.\./moto/|moto/|g' web/kiri/index.css > "$WEB_APP/index.css"
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
# the site carries the notices without the author's email (the publish gate keeps addresses off the web)
sed -i '' -E 's/ <[A-Za-z0-9._%+-]+@gmail\.com>//g' "$WEB_APP/license.md" "$WEB_APP/THIRD_PARTY_NOTICES.txt"
# index.html is never copied whole (see the note below), but its body must follow the source: 107's help page
# edits stopped here and never reached the site. Head and the analytics tail stay the site's own.
node - "$WEB_APP/index.html" <<'SYNC'
const fs = require('fs'), site = process.argv[2];
const src = fs.readFileSync('web/kiri/index.html', 'utf8'), dst = fs.readFileSync(site, 'utf8');
const END = '<script src="swarf-install.js"></script>';
const body = t => { const a = t.indexOf('</head>'), b = t.indexOf(END); if (a < 0 || b < 0) throw new Error('deploy: index.html markers missing'); return [a + 7, b]; };
const [sa, sb] = body(src), [da, db] = body(dst);
fs.writeFileSync(site, dst.slice(0, da) + src.slice(sa, sb) + dst.slice(db));
SYNC
echo "[3/5] rewrite worker + wasm + asset paths to /swarf-app/ absolutes"
# worker + wasm (fatal — toolpaths break without these)
sed -i '' 's|"\.\./lib/kiri/run/worker\.js"|"/swarf-app/lib/kiri/run/worker.js"|g' "$WEB_APP/lib/main/kiri.js"
sed -i '' 's|"\.\./wasm/manifold\.wasm"|"/swarf-app/lib/kiri/wasm/manifold.wasm"|g' "$WEB_APP/lib/main/kiri.js"
sed -i '' 's|"\.\./wasm/manifold\.wasm"|"/swarf-app/lib/kiri/wasm/manifold.wasm"|g' "$WEB_APP/lib/kiri/run/worker.js"
sed -i '' 's|"/wasm/kiri-geo\.wasm"|"/swarf-app/lib/kiri/wasm/kiri-geo.wasm"|g' "$WEB_APP/lib/kiri/run/worker.js" "$WEB_APP/lib/kiri/run/minion.js"
sed -i '' 's|"\.\./wasm/manifold\.wasm"|"/swarf-app/lib/kiri/wasm/manifold.wasm"|g' "$WEB_APP/lib/kiri/run/minion.js"
# seed/sample STL paths (fatal — init_input waits on platform.load_stl's
# callback; a 404 here leaves the callback unfired, init hangs, curtain
# never lifts. We learned this the hard way with /obj/cube.stl).
sed -i '' "s|'/obj/|'/swarf-app/obj/|g" "$WEB_APP/lib/main/kiri.js"
sed -i '' 's|"/obj/|"/swarf-app/obj/|g' "$WEB_APP/lib/main/kiri.js"

# Hard-fail if any of the broken forms remain — catches bundler changes that
# introduce new path shapes we haven't taught the script about yet.
# "/lib/..." is rooted at the site, not the app: it 404s under /swarf-app/
bad=$(grep -oE '"\.\./lib/[^"]*\.js"|"\.\./wasm/[^"]*\.wasm"|"/wasm/[^"]*\.wasm"|"/lib/[^"]*"|'"'"'/lib/[^'"'"']*'"'"'|"/obj/[^"]*"|'"'"'/obj/[^'"'"']*'"'"'' "$WEB_APP/lib/main/kiri.js" "$WEB_APP/lib/kiri/run/worker.js" "$WEB_APP/lib/kiri/run/minion.js" || true)
if [[ -n "$bad" ]]; then
  echo "[3/5] FAIL — broken paths remain after rewrite. Investigate before shipping:"
  echo "$bad"
  exit 1
fi
echo "      ok — no broken paths remain"

echo "[4/6] stamp swarf-sw.js cache version"
STAMP="$(date +%Y%m%d%H%M%S)-$(git -C "$SRC_REPO" rev-parse --short HEAD)"
sed -i '' "s|__SWARF_DEPLOY_STAMP__|$STAMP|g" "$WEB_APP/swarf-sw.js"
# every machine-control file and the version stamp carry the same build (connect checks they agree)
for f in swarf-version.js swarf-run.js swarf-run-plan.js swarf-run-parse.js swarf-run-machine.js swarf-grbl.js swarf-shopbot-usb.js swarf-shopbot-card.js swarf-shopbot-direct.js; do sed -i '' "s|__SWARF_BUILD__|$STAMP|g" "$WEB_APP/$f"; done
remaining=$(grep -l '__SWARF_DEPLOY_STAMP__' "$WEB_APP/swarf-sw.js" || true)
if [[ -n "$remaining" ]]; then
  echo "[4/6] FAIL — cache-stamp placeholder still present, offline cache won't invalidate"
  exit 1
fi
echo "      ok — cache version: $STAMP"

# the CAM engine carries the build too (it reports it; the page reloads once on a mismatch), and the
# page asks for its files by build (?b=), so an open tab never pairs a cached copy of one with another
ENGINE_FILES=("$WEB_APP/lib/main/kiri.js" "$WEB_APP/lib/kiri/run/worker.js" "$WEB_APP/lib/kiri/run/minion.js")
sed -i '' "s|__SWARF_BUILD__|$STAMP|g" "$WEB_APP/lib/kiri/run/worker.js" "$WEB_APP/lib/kiri/run/minion.js"
sed -i '' "s|\"/swarf-app/lib/kiri/run/worker\\.js\"|\"/swarf-app/lib/kiri/run/worker.js?b=$STAMP\"|g" "$WEB_APP/lib/main/kiri.js"
sed -i '' "s|\"\\./minion\\.js\"|\"./minion.js?b=$STAMP\"|g" "$WEB_APP/lib/kiri/run/worker.js"
sed -i '' "s|\"\\.\\./\\.\\./gpu/raster-worker\\.js\"|\"../../gpu/raster-worker.js?b=$STAMP\"|g" "$WEB_APP/lib/kiri/run/worker.js"
sed -i '' -E "s#\"(/swarf-app/lib/kiri/wasm/[a-z-]+\\.wasm)\"#\"\\1?b=$STAMP\"#g" "${ENGINE_FILES[@]}"
for want in "lib/main/kiri.js:/swarf-app/lib/kiri/run/worker.js?b=$STAMP" \
            "lib/kiri/run/worker.js:./minion.js?b=$STAMP" \
            "lib/kiri/run/worker.js:../../gpu/raster-worker.js?b=$STAMP" \
            "lib/kiri/run/worker.js:/swarf-app/lib/kiri/wasm/kiri-geo.wasm?b=$STAMP" \
            "lib/kiri/run/minion.js:/swarf-app/lib/kiri/wasm/kiri-geo.wasm?b=$STAMP" \
            "lib/kiri/run/worker.js:\"$STAMP\"" \
            "lib/kiri/run/minion.js:\"$STAMP\""; do
  if ! grep -qF "${want#*:}" "$WEB_APP/${want%%:*}"; then
    echo "[4/6] FAIL — ${want%%:*} lacks ${want#*:}: the engine would not carry this build"
    exit 1
  fi
done
if grep -lF '__SWARF_BUILD__' "${ENGINE_FILES[@]}"; then
  echo "[4/6] FAIL — a build placeholder is left in the engine files above"
  exit 1
fi
echo "      ok — engine files carry the build"

# the offline cache's list: every file the page and the engine load, read from the site as it now is
PRECACHE="$(mktemp -t swarf-precache)"
if ! node tools/precache-list.mjs "$WEB_APP" /swarf-app/ > "$PRECACHE"; then
  echo "[4/6] FAIL — the offline file list could not be built (above)"
  rm -f "$PRECACHE"; exit 1
fi
node - "$WEB_APP/swarf-sw.js" "$PRECACHE" <<'LIST'
const fs = require('fs'), [sw, listFile] = process.argv.slice(2);
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const text = fs.readFileSync(sw, 'utf8');
if (!text.includes('[/*__SWARF_PRECACHE__*/]')) { console.error('[4/6] FAIL — swarf-sw.js has no PRECACHE placeholder'); process.exit(1); }
fs.writeFileSync(sw, text.replace('[/*__SWARF_PRECACHE__*/]', JSON.stringify(list)));
console.log(`      ok — offline cache lists ${list.length} files`);
LIST

# every file the page loads (its scripts and stylesheets, and the offline cache's list) that comes from
# web/kiri must be on the site as the source has it (after the rewrites above): a file left out of the
# copy keeps an old build live with nothing said
REFS="$(mktemp -t swarf-refs)"
node - "$WEB_APP" "$STAMP" "$REFS" "$PRECACHE" <<'CHECK'
const fs = require('fs'), path = require('path');
const [site, stamp, refsOut, precacheFile] = process.argv.slice(2);
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const precache = JSON.parse(fs.readFileSync(precacheFile, 'utf8'));
const refs = new Set(['swarf-sw.js', 'swarf-sw-core.js']);
for (const m of html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"]*)?"/g)) refs.add(m[1]);
for (const u of precache) refs.add(u.replace(/[?#].*$/, ''));
const skip = new Set(['index.html', 'license.md', 'THIRD_PARTY_NOTICES.txt']);
const bad = [];
for (const r of refs) {
  if (/^(https?:|\/|\.\.?$|data:)/.test(r) || skip.has(r)) continue;
  const src = path.join('web/kiri', r);
  if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) continue;
  const dst = path.join(site, r);
  if (!fs.existsSync(dst)) { bad.push(`missing on the site: ${r}`); continue; }
  let want = fs.readFileSync(src, 'utf8');
  if (r === 'index.css') want = want.replace(/\.\.\/moto\//g, 'moto/');
  want = want.split('__SWARF_DEPLOY_STAMP__').join(stamp).split('__SWARF_BUILD__').join(stamp);
  if (r === 'swarf-sw.js') want = want.replace('[/*__SWARF_PRECACHE__*/]', JSON.stringify(precache));
  if (fs.readFileSync(dst, 'utf8') !== want) bad.push(`differs from its source: ${r}`);
}
if (bad.length) { console.error('[4/6] FAIL — the site would serve files the deploy did not copy:\n  ' + bad.join('\n  ')); process.exit(1); }
fs.writeFileSync(refsOut, [...refs, 'lib/main/kiri.js', 'lib/kiri/run/worker.js', 'lib/kiri/run/minion.js', 'index.css'].join('\n') + '\n');
console.log(`      ok — ${refs.size} files the page loads match their source`);
CHECK

echo "[5/6] commit web repo"
cd "$WEB_REPO"
# every path below exists after the copy step; a failed add stops the deploy
# files the web repo ignores on purpose (dev-only tools) are left out of the add
STAGE=()
for f in swarf-app/lib/main/kiri.js swarf-app/lib/kiri/run/worker.js swarf-app/lib/kiri/run/minion.js swarf-app/lib/gpu/raster-worker.js swarf-app/index.css \
  swarf-app/swarf*.js swarf-app/swarf*.mjs swarf-app/vendor swarf-app/swarf*.css swarf-app/swarf-materials.json \
  swarf-app/swarf-icon-*.png swarf-app/manifest.json swarf-app/index.html \
  swarf-app/license.md swarf-app/THIRD_PARTY_NOTICES.txt; do
  if git check-ignore -q "$f"; then
    # an ignored file the page loads would stay old on the live site with nothing said: stop
    if grep -qxF "${f#swarf-app/}" "$REFS"; then echo "[5/6] FAIL — the site repo ignores $f, which the page loads"; rm -f "$REFS"; exit 1; fi
    echo "      left out (the site repo ignores it): $f"
  else
    STAGE+=("$f")
  fi
done
rm -f "$REFS" "$PRECACHE"
git add "${STAGE[@]}"
# NOTE: index.html is staged but NEVER copied from source. The deploy copy has
# its own SEO metadata and RELATIVE css/font paths (moto/palette.css, not
# /moto/palette.css) — copying source over it breaks every stylesheet on the
# live site. Edit the deploy copy directly, or teach this script a targeted
# patch, but do not add it to the copy loop above.
if git diff --cached --quiet; then
  echo "      nothing to commit"
else
  git -c commit.gpgsign=false commit -m "$MSG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
fi

echo "[6/6] push web repo → renato.design/swarf-app/"
git push

if [[ "$PUSH_SRC" == "1" ]]; then
  echo "[extra] push src repo"
  cd "$SRC_REPO"
  git push
fi

echo
echo "deployed. give GitHub Pages ~60s, then hard-reload renato.design/swarf-app/"
