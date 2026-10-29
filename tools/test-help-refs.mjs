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
for (const q of ['windows', 'zadig', 'e-stop', 'router test', 'feed override', 'inch', 'disconnect', 'search down', 'kcad', 'quick start'])
  assert.ok(find(q).length, `help search "${q}" finds nothing`);
console.log('help refs: ok');
