// Anything swarf tells a student to look up in help must be findable there (Phil 10-29). Every
// 'help, then search "X"' (and 'search "X"' / '&ldquo;X&rdquo;' after "help") in swarf's own code
// is run through help's own matching (sync.js render: the query as one phrase, in a name, body or
// tags) against help's index, and must find at least one entry.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).pathname;
const sync = readFileSync(root + 'src/kiri/app/init/sync.js', 'utf8');
// the index entries: { kind, name, body, tags }
const INDEX = [];
for (const m of sync.matchAll(/\{ kind:'(\w+)', name:(['"])((?:\\.|(?!\2).)*)\2, body:(['"])((?:\\.|(?!\4).)*)\4, tags:'([^']*)' \}/g))
  INDEX.push({ name: m[3].replace(/\\(.)/g, '$1'), body: m[5].replace(/\\(.)/g, '$1'), tags: m[6] });
assert.ok(INDEX.length > 50, `help's index read (${INDEX.length} entries)`);
const find = q => INDEX.filter(e => [e.name, e.body, e.tags].some(t => t.toLowerCase().includes(q.toLowerCase())));
const files = readdirSync(root + 'web/kiri').filter(f => /^swarf-.*\.(m?js)$/.test(f)).map(f => 'web/kiri/' + f).concat(['src/kiri/app/init/sync.js', 'web/kiri/index.html']);
const refs = [];
for (const f of files) {
  const s = readFileSync(root + f, 'utf8');
  for (const m of s.matchAll(/help[^.\n]{0,40}?search\s*(?:"|&ldquo;|“)([^"&”<>\n]{2,40})(?:"|&rdquo;|”)/gi)) refs.push([f, m[1]]);
}
assert.ok(refs.length >= 3, `found the help pointers (${refs.length})`);
for (const [f, q] of refs) {
  const hits = find(q);
  console.log(`${f}: help search "${q}" → ${hits.length ? hits.map(h => h.name).slice(0, 3).join(', ') : 'NOTHING'}`);
  assert.ok(hits.length, `${f} points to help search "${q}", which finds nothing`);
}
// and the features that help is told about stay findable by their plain names
for (const q of ['save project', '.swarf', 'import a part', 'y up', 'kmz', 'windows', 'zadig', 'e-stop', 'router test', 'feed override', 'inch', 'disconnect', 'search down', 'kcad', 'quick start',
  // TEX (swarf-tex.js): the mode, its tools and its step
  'tex', 'brush', 'erase', 'mark', 'soft edge', 'patterns', 'ocean waves', 'texture step', 'v-bit', 'plunge', 'points', 'pierce', 'kerf', 'test strip', 'make it a part', 'make it a hole', 'save as a mesh'])
  assert.ok(find(q).length, `help search "${q}" finds nothing`);
// what changed at the machine stays said (106/107): jog's default, new, the router-off refusal, carving
for (const q of ['continuous', 'file › new', 'router off', 'carve', 'v-carve', 'carve into', 'engrave', 'letters', 'flat depth', '60° V-bit', '90° V-bit'])
  assert.ok(find(q).length, `help search "${q}" finds nothing`);
// the outline's allowance and last pass, the basic drill step, the pocket's way to tex (108)
for (const q of ['last pass', 'allowance', 'drill step', 'bigger than the bit', 'pocket in tex'])
  assert.ok(find(q).length, `help search "${q}" finds nothing`);
// the right-click's three board jobs, and which mode owns each (115, review 11-13 #10)
for (const q of ['carve words', 'pocket a shape', 'texture an area', 'carve, pocket or texture'])
  assert.ok(find(q).length, `help search "${q}" finds nothing`);
// every menu item says what it does when hovered (quit is hidden)
const menu = readFileSync(root + 'src/kiri/app/init/menu.js', 'utf8');
const bare = [...menu.matchAll(/menuItem\(actions, \{ id: '([\w-]+)'[^\n]*/g)].filter(m => !/\btitle:/.test(m[0]) && m[1] !== 'app-quit').map(m => m[1]);
assert.deepEqual(bare, [], `menu items with no tooltip: ${bare}`);
// a tooltip names the thing and one consequence, twelve words at most (family rule); the why lives in help
const long = [];
for (const f of [...readdirSync(root + 'web/kiri').filter(f => /^swarf-.*\.js$/.test(f) && !/markup-inject/.test(f)).map(f => 'web/kiri/' + f), 'web/kiri/index.html', 'src/kiri/app/init/menu.js', 'src/kiri/mode/cam/app/init-ui.js',
    // swarf's cards written in Kiri's own files too (hygiene 11-13: the export card's project button ran to 19 words)
    'src/kiri/app/export.js', 'src/kiri/app/platform.js', 'src/kiri/app/init/sync.js', 'src/kiri/mode/cam/app/cl-autotab.js', 'src/kiri/mode/cam/app/cl-tabedit.js'])
  for (const m of readFileSync(root + f, 'utf8').matchAll(/\btitle\s*[:=]\s*(?:"([^"\n]{20,})"|'((?:\\.|[^'\\\n]){20,})'|`((?:\\.|[^`\\\n]){20,})`)/g)) {
    let t = m[1] || m[2] || m[3], was;
    do { was = t; t = t.replace(/\$\{[^{}]*\}/g, 'X'); } while (t !== was);
    if (t.trim().split(/\s+/).length > 12) long.push(`${f}: ${t}`);
  }
// a tooltip chosen by a condition (title: x ? '…' : '…') hid four long ones from the scan above (Interfacing audit 11-13)
for (const f of files.concat(['src/kiri/app/export.js', 'src/kiri/app/platform.js', 'src/kiri/mode/cam/app/cl-autotab.js', 'src/kiri/mode/cam/app/cl-tabedit.js']))
  for (const m of readFileSync(root + f, 'utf8').matchAll(/\btitle\s*[:=]\s*[^'"`\n,;]*\?\s*(?:'((?:\\.|[^'\\\n])*)'|`((?:\\.|[^`\\\n])*)`)\s*:\s*(?:'((?:\\.|[^'\\\n])*)'|`((?:\\.|[^`\\\n])*)`)/g))
    for (let t of [m[1] || m[2], m[3] || m[4]]) {
      if (!t || t.length < 20) continue;
      let was;
      do { was = t; t = t.replace(/\$\{[^{}]*\}/g, 'X'); } while (t !== was);
      if (t.trim().split(/\s+/).length > 12) long.push(`${f}: ${t}`);
    }
assert.deepEqual(long, [], 'tooltips over twelve words');
console.log('help refs: ok');
