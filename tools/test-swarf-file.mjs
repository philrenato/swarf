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
assert.deepEqual(m, { format: 'swarf', version: 1, app: 'v00000-085', build: 'b1', saved: '2026-10-30T00:00:00.000Z', units: 'in' }); n++;
ok(F.manifest({ units: 'cm' }).units === 'mm', 'units are mm or in');
ok(F.checkManifest(m, 'v00000-085').ok && !F.checkManifest(m).newer, 'this version opens');
ok(!F.checkManifest(null).ok && /not a swarf project/.test(F.checkManifest(null).say), 'no manifest: not a project');
ok(!F.checkManifest({ format: 'kiri', version: 1 }).ok, 'another format: refused');
ok(!F.checkManifest({ format: 'swarf' }).ok, 'no version: refused');
const newer = F.checkManifest({ format: 'swarf', version: 2, app: 'v00000-200' }, 'v00000-085');
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
ok(notes.some(t => /set up differently/.test(t) && /Shop router \(chair\.swarf\)/.test(t)), `and says so: ${notes[0]}`);
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
// a machine that comes with swarf: nothing added, nothing said
const m2 = F.mergeSettings(here, { ...file, device: { deviceName: 'ShopBot.Basic', internal: 0, bedWidth: 2438.4 }, filter: { CAM: 'ShopBot.Basic' }, devices: {}, tools: here.tools, process: { ops: [{ type: 'outline', tool: 1001 }] } }, { builtin: n => n === 'ShopBot.Basic' });
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
// a tab's turn as Kiri:Moto reads it ({ x, y, z, w }), in the settings' copy and the parts' own
const tabs = () => ({ tab: [{ pos: { x: 1, y: 2, z: 3 }, dim: { x: 4, y: 5, z: 6 }, rot: [0, 0, 0.5, 0.866] }, { rot: { x: 0, y: 0, z: 0, w: 1 } }] });
const kt = { process: { ops: [] }, widget: { w1: tabs() } }, kw = [{ id: 'w1', anno: tabs() }, { id: 'w2' }];
F.kmzSafe(kt, kw);
ok([kt.widget.w1, kw[0].anno].every(a => a.tab[0].rot.z === 0.5 && a.tab[0].rot.w === 0.866 && !Array.isArray(a.tab[0].rot) && a.tab[1].rot.w === 1), 'a .kmz\'s tabs turn as { x, y, z, w }, in both copies');
ok(F.KIRI_OPS.length === 19 && !F.KIRI_OPS.includes('texture') && !F.KIRI_OPS.includes('pierce'), 'Kiri:Moto\'s step list');
// Kiri's own op list (src/kiri/mode/cam/core/ops.js) less swarf's: the list here matches it
const ops = readFileSync(root + 'src/kiri/mode/cam/core/ops.js', 'utf8');
const types = [...ops.slice(ops.indexOf('export const ops')).matchAll(/^\s+"([a-z ]+)":/gm)].map(x => x[1]);
assert.deepEqual(types.filter(t => !['texture', 'pierce'].includes(t)).sort(), [...F.KIRI_OPS].sort()); n++;

// ── fingerprint ──
ok(F.fingerprint([{ id: 'a', pos: { x: 1 } }], { ops: [{ type: 'outline' }] }, 'mdf') === F.fingerprint([{ pos: { x: 1 }, id: 'a' }], { ops: [{ type: 'outline' }] }, 'mdf'), 'fingerprint ignores key order');
ok(F.fingerprint([{ id: 'a', pos: { x: 1 } }], { ops: [] }, 'mdf') !== F.fingerprint([{ id: 'a', pos: { x: 2 } }], { ops: [] }, 'mdf'), 'a moved part is a change');
ok(F.restamp('a:1:Dev:Name:with:colons:6.350:1,2', 7, 'New') === 'a:7:New:6.350:1,2', 'a stamp with colons in the machine name');
ok(F.restamp('old-style-stamp', 7, 'New') === 'old-style-stamp', 'a stamp it cannot read stays');

console.log(`swarf file: ok (${n} checks)`);
