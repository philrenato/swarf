// .swarf projects (web/kiri/swarf-file.js): the manifest and its version, the split between the
// project's keys and this computer's, a merge that adds a missing machine or bit (never swaps
// one), a .kmz that keeps only Kiri:Moto's steps, and no machine zero or position ever written.
//   node tools/test-swarf-file.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).pathname;
const F = createRequire(import.meta.url)(root + 'web/kiri/swarf-file.js');
let n = 0;
const ok = (c, what) => { assert.ok(c, what); n++; };

// ── the manifest ──
const m = F.manifest({ app: 'v00000-085', build: 'b1', units: 'in', saved: '2026-10-30T00:00:00.000Z' });
assert.deepEqual(m, { format: 'swarf', version: 2, app: 'v00000-085', build: 'b1', saved: '2026-10-30T00:00:00.000Z', units: 'in' }); n++;
ok(F.manifest({ units: 'cm' }).units === 'mm', 'units are mm or in');
ok(F.checkManifest(m, 'v00000-085').ok && !F.checkManifest(m).newer, 'this version opens');
ok(!F.checkManifest(null).ok && /not a swarf project/.test(F.checkManifest(null).say), 'no manifest: not a project');
ok(!F.checkManifest({ format: 'kiri', version: 1 }).ok, 'another format: refused');
ok(!F.checkManifest({ format: 'swarf' }).ok, 'no version: refused');
const newer = F.checkManifest({ format: 'swarf', version: F.VERSION + 1, app: 'v00000-200' }, 'v00000-085');
ok(newer.ok && newer.newer && /newer swarf \(v00000-200\)/.test(newer.say) && /opened what it can/.test(newer.say), `a newer file opens, and says so plainly: ${newer.say}`);

// ── the split: every swarf localStorage key in the code is on one side ──
const src = readdirSync(root + 'web/kiri').filter(f => /^swarf-.*\.m?js$/.test(f)).map(f => readFileSync(root + 'web/kiri/' + f, 'utf8')).join('\n')
  + readFileSync(root + 'src/kiri/app/init/sync.js', 'utf8') + readFileSync(root + 'src/kiri/mode/cam/app/cl-autotab.js', 'utf8');
const keys = new Set();
// a key read or written by its own words, or through a constant (NAME = 'swarf…' … Item(NAME)
for (const mm of src.matchAll(/(?:get|set|remove)Item\(\s*'(swarf[\w.-]*)'/g)) keys.add(mm[1]);
for (const mm of src.matchAll(/\b([A-Za-z_][\w]*)\s*=\s*'(swarf[\w.-]*)'/g)) {
  const [, name, k] = mm;
  if (new RegExp(`Item\\(\\s*${name}\\b`).test(src) || /KEY$|^key$|STORE|PREF|^MIG/.test(name)) keys.add(k);
}
const known = new Set([...Object.keys(F.PROJECT_KEYS), ...F.LOCAL_KEYS, ...F.NEVER_KEYS]);
// one-time install and upgrade marks (swarf-sky.js) are this computer's by their names
const stray = [...keys].filter(k => !known.has(k) && !/^swarf\.(r\d+|0\d\d)\./.test(k));
if (process.env.KEYS) console.log([...keys].sort().join(" "));
ok(keys.size >= 25, `the storage keys were found (${keys.size})`);
ok(!stray.length, `every swarf storage key is put on one side of the split (project / this computer / never): ${stray.join(', ')}`);
for (const k of Object.keys(F.PROJECT_KEYS)) ok(!F.LOCAL_KEYS.includes(k) && !F.NEVER_KEYS.includes(k), `${k} is on one side only`);
for (const k of F.NEVER_KEYS) ok(!F.LOCAL_KEYS.includes(k), `${k}: never, not a preference`);
ok(['swarf-skin', 'swarf-sound', 'swarf-shopbot-link'].every(k => F.LOCAL_KEYS.includes(k)), 'skin, sounds, the connection stay local');
ok(['swarf.material.current', 'swarf.autotabs', 'swarf-expert'].every(k => F.PROJECT_KEYS[k]), 'material, tab settings, advanced go in the file');

// ── what a file writes: project keys only, never a zero ──
const store = {
  'swarf.material.current': 'softwood', 'swarf.autotabs': '{"density":1,"scale":0,"pin":{}}', 'swarf-expert': '1',
  'swarf-skin': 'glass', 'swarf-sound': '0.2', 'swarf-run-zero': '{"had":{"xy":true,"z":true},"at":1,"steps":{"x":1}}',
  'swarf-shopbot-origin': '{"x":100}', 'swarf-shopbot-home': '{"x":0}', 'swarf-table-corner': '[1,2]', 'swarf-plate-thickness': '3',
};
const local = F.projectLocal(k => (k in store ? store[k] : null));
assert.deepEqual(Object.keys(local).sort(), ['swarf-expert', 'swarf.autotabs', 'swarf.material.current']); n++;
const sj = F.swarfJson({ local: { ...local, ...store }, material: 'softwood', units: 'in', expert: true, app: 'v1' });
ok(Object.keys(sj.local).every(k => F.PROJECT_KEYS[k]), 'swarf.json carries project keys only, even when handed others');
const flat = JSON.stringify(sj);
ok(!F.zeroKeys(sj).length && !F.NEVER_KEYS.some(k => flat.includes(k)), 'no zero or position key in swarf.json');
ok(!Object.keys(sj).some(k => F.NEVER_RE.test(k)) && !Object.keys(sj.local).some(k => F.NEVER_RE.test(k)), 'no key of swarf.json names a zero, origin, home, plate, jog or position');
ok(sj.units === 'in' && sj.material === 'softwood' && sj.expert === true && sj.mode === 'cam', 'units, material, advanced and the mode');
// and what a reader takes from a file someone made by hand: never a zero, never a preference
const read = F.readLocal({ 'swarf-run-zero': '{"had":{"xy":true}}', 'swarf-shopbot-origin': '{}', 'swarf-skin': 'classic', 'swarf.material.current': 'mdf', 'swarf-expert': 1 });
assert.deepEqual(read, { 'swarf.material.current': 'mdf' }); n++;
ok(F.zeroKeys({ a: { 'swarf-run-zero': 1 }, b: [{ 'swarf-shopbot-home': 2 }] }).length === 2, 'zeroKeys finds a zero anywhere');

// ── the merge: the file's job, this computer's preferences; add, never swap ──
const tool = (id, name, dia) => ({ id, number: id - 1000, name, type: 'endmill', flute_diam: dia, metric: false });
const here = {
  mode: 'CAM', device: { deviceName: 'ShopBot.Basic', bedWidth: 2438.4 }, cdev: { CAM: { deviceName: 'ShopBot.Basic' } }, filter: { CAM: 'ShopBot.Basic' },
  devices: { 'Shop router': { internal: 0, bedWidth: 1000, deviceName: 'Shop router' } }, devproc: {}, cproc: { CAM: 'default' }, sproc: { CAM: { default: { ops: [] }, mine: { ops: [{ type: 'rough' }] } } },
  process: { ops: [] }, tools: [tool(1001, 'quarter', 0.25), tool(1002, 'eighth', 0.125)],
  controller: { units: 'mm', dark: true, zoomSpeed: 2, view: { left: 1 } }, local: { 'model.opacity': 0.4 }, widget: { old: { tab: [] } },
};
const proc = { processName: 'default', camStockX: 300, ops: [
  { type: 'outline', tool: 1001, rate: 1000, preset: 'softwood:1001:Shop router:6.350:1,2,3,4' },
  { type: 'texture', tool: 1003, preset: 'softwood:1003:Shop router:3.175:1,2,3,4' },
  { type: 'pocket', tool: 1002, preset: 'softwood:1002:Shop router:3.175:' },
], op2: [] };
const file = {
  mode: 'CAM', device: { internal: 0, deviceName: 'Shop router', bedWidth: 1200 }, filter: { CAM: 'Shop router' }, cdev: {},
  devices: { 'Shop router': { internal: 0, bedWidth: 1200, deviceName: 'Shop router' } },
  process: proc, cproc: { CAM: 'default' }, tools: [tool(1001, 'quarter', 0.25), tool(1002, 'eighth (theirs)', 0.12), tool(1003, 'v-bit', 0.5), tool(1009, 'unused', 1)],
  controller: { units: 'in', dark: false, zoomSpeed: 9, view: { left: 9 } }, local: { 'model.opacity': 1 }, widget: { w1: { tab: [{ pos: 1 }], tabset: { pin: { count: 3 } } } },
};
const before = JSON.stringify(here);
const { settings: out, notes } = F.mergeSettings(here, file, { name: 'chair.swarf', builtin: n => n === 'ShopBot.Basic' });
ok(JSON.stringify(here) === before, 'the merge does not change this computer\'s settings object');
ok(out.controller.units === 'in' && out.controller.zoomSpeed === 2 && out.controller.dark === true && out.controller.view.left === 1, 'units from the file; zoom, dark, camera stay this computer\'s');
ok(out.local['model.opacity'] === 0.4, 'view preferences stay this computer\'s');
ok(out.devices['Shop router'].bedWidth === 1000, 'this computer\'s own machine of that name is not swapped');
ok(out.devices['Shop router (chair)'] && out.devices['Shop router (chair)'].bedWidth === 1200, 'the file\'s machine comes in under a new name');
ok(out.filter.CAM === 'Shop router (chair)' && out.device.deviceName === 'Shop router (chair)' && out.device.bedWidth === 1200 && out.cdev.CAM.bedWidth === 1200, 'and the job is on it');
ok(notes.some(t => /set up differently/.test(t) && /Shop router \(chair\)/.test(t)), `and says so: ${notes[0]}`);
ok(out.tools.find(t => t.id === 1003 && t.name === 'v-bit'), 'a missing bit the steps use is added');
ok(!out.tools.find(t => t.id === 1009), 'a bit no step uses is not added');
ok(out.tools.find(t => t.id === 1002).name === 'eighth', 'this computer\'s bit 1002 stays');
const theirs = out.tools.find(t => t.name === 'eighth (theirs)');
ok(theirs && theirs.id !== 1002 && theirs.number === 2, 'the file\'s different bit 1002 comes in under a new id, its number (the T in the program) kept');
ok(out.process.ops[2].tool === theirs.id && out.sproc.CAM.default.ops[2].tool === theirs.id, 'its step uses it');
ok(out.process.ops[2].preset === `softwood:${theirs.id}:Shop router (chair):3.175:`, `its material stamp follows, so its numbers are kept (${out.process.ops[2].preset})`);
ok(out.process.ops[0].preset === 'softwood:1001:Shop router (chair):6.350:1,2,3,4', 'every stamp follows the machine\'s new name');
ok(notes.some(t => /"v-bit"/.test(t) && /added/.test(t)) && notes.some(t => /eighth \(theirs\)/.test(t)), `bits: said (${notes.join(' | ')})`);
ok(out.process.ops.map(o => o.type).join() === 'outline,texture,pocket' && out.process.camStockX === 300, 'the steps in order, the board');
ok(out.sproc.CAM.mine.ops[0].type === 'rough', 'this computer\'s other saved processes stay');
ok(out.widget.w1.tabset.pin.count === 3 && !out.widget.old, 'the parts\' annotations are the file\'s, carried whole');
ok(notes.some(t => /^Units are now inches, as the file was saved\.$/.test(t)), 'units that change are said');
ok(!F.mergeSettings(here, { ...file, controller: { units: 'mm' } }).notes.some(t => /Units are now/.test(t)), 'units that stay are not');
// a machine that comes with swarf: nothing added, nothing said
const m2 = F.mergeSettings(here, { ...file, controller: { units: 'mm' }, device: { deviceName: 'ShopBot.Basic', internal: 0, bedWidth: 2438.4 }, filter: { CAM: 'ShopBot.Basic' }, devices: {}, tools: here.tools, process: { ops: [{ type: 'outline', tool: 1001 }] } }, { builtin: n => n === 'ShopBot.Basic' });
ok(!m2.notes.length && Object.keys(m2.settings.devices).length === 1 && m2.settings.filter.CAM === 'ShopBot.Basic', 'the ShopBot that comes with swarf: no note, nothing added');
// a machine made elsewhere and never seen here: added
const m3 = F.mergeSettings({ ...here, devices: {} }, file, { name: 'x.swarf' });
ok(m3.settings.devices['Shop router'] && m3.settings.filter.CAM === 'Shop router' && m3.notes.some(t => /was not on this computer/.test(t)), 'a machine this computer lacks is added, by its own name');
ok(m3.settings.process.ops[0].preset === proc.ops[0].preset, 'same machine name: stamps untouched');

// ── a .kmz for Kiri:Moto: only Kiri's own steps ──
const kset = JSON.parse(JSON.stringify({ process: proc, sproc: { CAM: { default: proc, other: { ops: [{ type: 'pierce' }, { type: 'drill' }] } } } }));
const dropped = F.kmzSafe(kset);
ok(dropped === 1, `the live steps' texture step is counted (${dropped})`);
ok(kset.process.ops.every(o => F.KIRI_OPS.includes(o.type)) && kset.sproc.CAM.other.ops.map(o => o.type).join() === 'drill', 'no swarf-only step left anywhere in a .kmz');
const kclock = { process: { ops: [{ type: 'outline' }, { type: 'texture' }, { type: '|' }] } };
F.kmzSafe(kclock);
ok(kclock.process.ops.map(o => o.type).join() === 'outline,|', 'Kiri\'s end-of-steps marker stays in a .kmz');
// a tab's rot stays Kiri:Moto's own array (its loader destructures it)
const kt = { process: { ops: [] }, widget: { w1: { tab: [{ rot: [0, 0, 0.5, 0.866] }] } } };
F.kmzSafe(kt);
ok(Array.isArray(kt.widget.w1.tab[0].rot), 'a .kmz keeps each tab\'s rot as the array Kiri:Moto reads');
ok(F.KIRI_OPS.length === 19 && !F.KIRI_OPS.includes('texture') && !F.KIRI_OPS.includes('pierce') && !F.KIRI_OPS.includes('inlay') && !F.KIRI_OPS.includes('vcarve'), 'Kiri:Moto\'s step list');
// Kiri's own op list (src/kiri/mode/cam/core/ops.js) less swarf's: the list here matches it
const ops = readFileSync(root + 'src/kiri/mode/cam/core/ops.js', 'utf8');
const types = [...ops.slice(ops.indexOf('export const ops')).matchAll(/^\s+"([a-z ]+)":/gm)].map(x => x[1]);
assert.deepEqual(types.filter(t => !['texture', 'pierce', 'inlay', 'vcarve'].includes(t)).sort(), [...F.KIRI_OPS].sort()); n++;

// ── fingerprint ──
ok(F.fingerprint([{ id: 'a', pos: { x: 1 } }], { ops: [{ type: 'outline' }] }, 'mdf') === F.fingerprint([{ pos: { x: 1 }, id: 'a' }], { ops: [{ type: 'outline' }] }, 'mdf'), 'fingerprint ignores key order');
ok(F.fingerprint([{ id: 'a', pos: { x: 1 } }], { ops: [] }, 'mdf') !== F.fingerprint([{ id: 'a', pos: { x: 2 } }], { ops: [] }, 'mdf'), 'a moved part is a change');
// a save keeps the board, the depth and the bits: a change to any of them is a change
{
  const fp = (proc, tools) => F.fingerprint([{ id: 'a', pos: { x: 1 } }], proc, 'mdf', { process: proc, tools });
  const base = { ops: [], camStockZ: 19.05, camZBottom: 0 };
  ok(fp(base, [{ id: 1003, flute_diam: 0.25 }]) !== fp({ ...base, camStockZ: 12.7 }, [{ id: 1003, flute_diam: 0.25 }]), 'a thinner board is a change');
  ok(fp(base, [{ id: 1003, flute_diam: 0.25 }]) !== fp({ ...base, camZBottom: 5 }, [{ id: 1003, flute_diam: 0.25 }]), 'a cut depth is a change');
  ok(fp(base, [{ id: 1003, flute_diam: 0.25 }]) !== fp(base, [{ id: 1003, flute_diam: 0.5 }]), 'an edited bit is a change');
  ok(F.fingerprint([{ id: 'a', scale: { x: 1 } }], base, 'mdf') !== F.fingerprint([{ id: 'a', scale: { x: 1.5 } }], base, 'mdf'), 'a resized part is a change');
}
// a bit renumbered on open: the marks that cut with it follow it
{
  const file = { tools: [{ id: 1018, number: 18, name: 'ball 1/4', type: 'ballmill', flute_diam: 0.25, metric: false }],
    process: { processName: 'p', ops: [{ type: 'texture', texmark: 'm1', tool: 1018 }] } };
  const local = { tools: [{ id: 1018, number: 18, name: 'end 1/2', type: 'endmill', flute_diam: 0.5, metric: false }], process: { ops: [] } };
  const merged = F.mergeSettings(local, file, { name: 'job.swarf' });
  const step = merged.settings.process.ops[0].tool;
  ok(step !== 1018, 'the step uses the file bit under a new number');
  const work = [{ meta: { tex: [{ id: 'm1', fill: { tool: 1018 } }, { id: 'm2', fill: { tool: 1003 } }] } }, { meta: {} }];
  ok(F.remapMarks(work, merged.remap) === 1, 'one mark re-pointed');
  ok(work[0].meta.tex[0].fill.tool === step, 'the mark cuts with the same bit as its step');
  ok(work[0].meta.tex[1].fill.tool === 1003, 'a mark on another bit stays');
}
ok(F.restamp('a:1:Dev:Name:with:colons:6.350:1,2', 7, 'New') === 'a:7:New:6.350:1,2', 'a stamp with colons in the machine name');
ok(F.restamp('old-style-stamp', 7, 'New') === 'old-style-stamp', 'a stamp it cannot read stays');

// ── meshes as bytes: parts/<id>.f32, read back exactly; version 1 files (JSON numbers) still open ──
{
  const JSZip = createRequire(import.meta.url)(root + 'node_modules/jszip');
  const zipOf = files => { const z = new JSZip(); for (const f of files) z.file(f.name, f.data); return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }); };
  const man = name => ({ name: 'manifest.json', data: JSON.stringify(F.manifest({ app: name })) });
  const tri = k => { const f = new Float32Array(k * 9); for (let i = 0; i < f.length; i++) f[i] = Math.fround(Math.sin(i * 0.37) * 300 + i * 1e-3); return f; };
  const settings = { process: { ops: [{ type: 'outline' }] }, tools: [], controller: { units: 'mm' } };

  const fa = tri(5), fb = [0.1, 0.2, 0.3, 1, 2, 3, -4.5, 5.25, 1e-7];
  const ws = { settings, work: [{ type: 100, id: 'w a/1', json: false, geo: fa, meta: { file: 'a' } }, { type: 100, id: 'w a/1', json: true, geo: fb, meta: { file: 'b' } }] };
  const p = F.pack(ws, [man('t')]);
  ok(p.ok && p.triangles === 6, `pack: ${p.triangles} triangles`);
  const names = p.files.map(f => f.name);
  ok(names.join() === 'manifest.json,workspace.json,parts/w-a-1.f32,parts/w-a-1-2.f32', `entries: ${names}`);
  const wj = JSON.parse(p.files[1].data);
  ok(wj.work.every(w => !('geo' in w) && w.json === false && /^parts\//.test(w.geof32)), 'workspace.json names each part\'s bytes, no numbers in it');
  ok(ws.work[0].geo === fa && ws.work[1].geo === fb, 'pack leaves the export as it was');
  const back = await F.readZip(await zipOf(p.files), JSZip);
  const g0 = back.workspace.work[0].geo, g1 = back.workspace.work[1].geo;
  ok(g0 instanceof Float32Array && g0.length === fa.length && g0.every((v, i) => Object.is(v, fa[i])), 'binary round trip: the same vertices, bit for bit');
  ok(g1 instanceof Float32Array && g1.every((v, i) => v === Math.fround(fb[i])), 'a JSON-number part is stored as float32 too');
  ok(back.workspace.work.every(w => w.json === false && !('geof32' in w)) && back.workspace.work[0].meta.file === 'a', 'read back as Kiri\'s decoder takes a typed array');
  ok(F.checkManifest(back.manifest).ok && !F.checkManifest(back.manifest).newer, 'this version reads its own files');

  // a version 1 project: workspace.json with JSON number arrays, opened unchanged
  const old = { settings, work: [{ type: 100, id: 'old', json: true, geo: Array.from(fa), meta: { file: 'old' }, anno: { tab: [] } }] };
  const oldZip = await zipOf([{ name: 'manifest.json', data: JSON.stringify({ format: 'swarf', version: 1, app: 'v00000-130', build: '', saved: '2026-01-01T00:00:00.000Z', units: 'mm' }) },
    { name: 'workspace.json', data: JSON.stringify(old) }, { name: 'swarf.json', data: JSON.stringify({ format: 'swarf', version: 1, local: {} }) }]);
  const ob = await F.readZip(oldZip, JSZip);
  const ochk = F.checkManifest(ob.manifest, 'v00000-132');
  ok(ochk.ok && !ochk.newer, 'a version 1 file opens without a "newer" note');
  ok(JSON.stringify(ob.workspace) === JSON.stringify(old) && ob.swarf.version === 1, 'a version 1 file reads exactly as written (json: true, geo numbers)');

  // a missing part file: a plain refusal
  const torn = await zipOf(p.files.filter(f => f.name !== 'parts/w-a-1-2.f32'));
  const tornErr = await F.readZip(torn, JSZip).then(() => '', e => e.message);
  ok(/mesh \(parts\/w-a-1-2\.f32\) is missing/.test(tornErr), `a missing part says so (${tornErr})`);

  // a damaged part refuses the file before anything on the bed changes
  for (const [label, geo] of [['one number', new Float32Array([7])], ['two numbers', new Float32Array([1, 2])], ['a torn triangle', new Float32Array(12)],
    ['no points', new Float32Array(0)], ['NaN', Object.assign(tri(2), { 4: NaN })], ['Infinity', Object.assign(tri(2), { 7: Infinity })]]) {
    const bp = F.pack({ settings, work: [{ type: 100, id: 'bad', json: false, geo }] }, [man('t')]);
    const err = await F.readZip(await zipOf(bp.files), JSZip).then(() => '', e => e.message);
    ok(/a part in it is damaged/.test(err), `${label}: refused (${err})`);
  }
  const nullV1 = await zipOf([{ name: 'workspace.json', data: JSON.stringify({ settings, work: [{ type: 100, id: 'o', json: true, geo: [0, 0, 0, 1, null, 0, 0, 1, 0] }] }) }]);
  ok(/damaged/.test(await F.readZip(nullV1, JSZip).then(() => '', e => e.message)), 'a version 1 part with a null point: refused');
  ok(F.checkParts(back.workspace.work) === '' && F.checkParts(ob.workspace.work) === '', 'good parts, binary and version 1, pass');
  ok(/mesh is missing/.test(F.checkParts([{ type: 100, id: 'd' }])), 'a part with no mesh at all: refused (Kiri writes geo for every part)');
  ok(/not a part/.test(F.checkParts([null])) && /not a part/.test(F.checkParts([7])) && /not a part/.test(F.checkParts([{ type: 'camera', geo: tri(1) }])), 'null, a number, an unknown record: refused');
  ok(/list of parts is damaged/.test(F.checkParts({ 0: {} })) && F.checkParts(undefined) === '' && F.checkParts([]) === '', 'work not a list: refused; none: nothing to judge');
  ok(F.checkParts([{ type: 'widget', geo: Array.from(tri(1)) }]) === '', 'a really old part (type "widget", numbers) passes');
  for (const [label, work] of [['no mesh', [{ type: 100, id: 'x', json: false, meta: {} }]], ['a null part', [null]], ['work an object', { a: 1 }]]) {
    const z = await zipOf([man('t'), { name: 'workspace.json', data: JSON.stringify({ settings, work }) }]);
    ok(/damaged/.test(await F.readZip(z, JSZip).then(() => '', e => e.message)), `${label}: the file is refused at read`);
  }

  // one limit, at save and at open
  const save0 = F.LIMIT.mesh;
  const huge = { settings, work: [{ type: 100, id: 'scan', json: true, geo: { length: (F.maxTriangles() + 1) * 9 } }] };
  const hp = F.pack(huge);
  ok(!hp.ok && hp.say === F.tooBig(F.maxTriangles() + 1) && !hp.files, `too big refuses at save, before writing: "${hp.say}"`);
  ok(/too big to save/.test(hp.say) && /million triangles/.test(hp.say) && /simpler mesh/.test(hp.say), 'and says it plainly');
  F.LIMIT.mesh = 36 * 5;                 // 5 triangles: the 6-triangle project above is over it
  ok(!F.pack(ws).ok, 'the same limit, lowered: save refuses');
  const openErr = await F.readZip(await zipOf(p.files), JSZip).then(() => '', e => e.message);
  ok(/its parts have 6 triangles, more than a project holds \(5\)/.test(openErr), `and open refuses the same project (${openErr})`);
  F.LIMIT.mesh = save0;
  ok(F.maxTriangles() > 7e6, `a project holds ${F.maxTriangles()} triangles`);
  ok(F.couldNot(new Error('Array buffer allocation failed')) === "Couldn't save: Array buffer allocation failed. Your parts are still here.", 'a failed save says why');

  // a big scan saves and reopens (2 M triangles, 1 M if this node is short of memory)
  for (const k of [2e6, 1e6]) {
    let big;
    try { big = new Float32Array(k * 9); } catch (e) { continue; }
    for (let i = 0; i < big.length; i++) big[i] = (i % 9973) * 0.125 - (i % 7);
    const t0 = Date.now();
    const bp = F.pack({ settings, work: [{ type: 100, id: 'scan', json: false, geo: big }] }, [man('t')]);
    const bz = await zipOf(bp.files);
    const bb = await F.readZip(bz, JSZip);
    const g = bb.workspace.work[0].geo;
    ok(bp.ok && g.length === big.length && Buffer.compare(Buffer.from(g.buffer, g.byteOffset, g.byteLength), Buffer.from(big.buffer)) === 0,
      `${k / 1e6} M triangles save and reopen identical (${Math.round(bz.length / 1048576)} MB file, ${Date.now() - t0} ms)`);
    break;
  }
}

console.log(`swarf file: ok (${n} checks)`);
