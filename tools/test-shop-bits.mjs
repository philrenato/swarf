// The shop's own bits (Phil 10-29, from the woodshop's ShopBot tool library): they are in the
// default tool list with their part numbers and kind; in wood, their library's numbers cap
// swarf's when swarf's are half again higher; a down-cut never takes more than half its
// diameter a pass.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const win = { localStorage: { getItem() { return null; }, setItem() {} }, console };
win.window = win; win.document = { readyState: 'loading', addEventListener() {} }; win.fetch = () => new Promise(() => {});
vm.runInNewContext(read('web/kiri/swarf-material.js'), win);
const derive = win.__swarfDerive;
const defaults = read('src/kiri/app/conf/defaults.js');
const src = defaults.slice(defaults.indexOf('tools:[', defaults.indexOf('template:')));
const tools = new Function(`return [${src.slice(7, src.indexOf('\n        ],'))}]`)();
const shop = tools.filter(t => t.swarf && t.swarf.part);
assert.deepEqual(shop.map(t => t.swarf.part), ['48-005', '52-910', '57-910', '48-072']);
assert.deepEqual(shop.map(t => t.swarf.cut), ['straight', 'up', 'down', 'straight']);
assert.ok(shop.every(t => t.type === 'endmill' && !t.metric), 'inch end mills');
assert.equal(new Set(tools.map(t => t.id)).size, tools.length, 'ids unique');
assert.equal(new Set(tools.map(t => t.number)).size, tools.length, 'T numbers unique');
const up = shop[1];
assert.equal(up.flute_diam, 0.25, 'the up-cut is 1/4 in (the shop library had the spoil-board cutter\'s 1 1/4 in)');
const lim = { spindleMin: 10000, spindleMax: 21000, feedMax: 15240, feedMaxZ: 2540 };
const mats = JSON.parse(read('web/kiri/swarf-materials.json'));
const ply = (Array.isArray(mats) ? mats : mats.materials).find(m => m.id === 'plywood');
// in plywood today swarf is under the shop's numbers: nothing changes
const a = derive(ply, 6.35, lim), b = derive(ply, 6.35, lim, up);
assert.equal(b.feed, a.feed); assert.equal(b.stepdown, a.stepdown);
assert.ok(Math.abs(b.shop.feed - 3048) < 1e-9 && Math.abs(b.shop.pass - 3.175) < 1e-9, 'the shop numbers in mm');
// a plywood record asking far more: the shop's numbers take over
const hot = { ...ply, cut: { ...ply.cut, chip: 0.05, down: 0.9 } };
const h = derive(hot, 6.35, lim, up);
assert.equal(h.feed, 3050, `feed capped to the shop's 120 in/min (${h.feed})`);
assert.equal(h.stepdown, 3.15, `pass capped under the shop's 1/8 in (${h.stepdown})`);
assert.ok(h.plunge <= h.feed);
assert.ok(derive(hot, 6.35, lim).feed > 3050, 'a generic bit is not capped');
// not wood: the shop library says nothing
const acr = { id: 'acrylic', cut: { ...hot.cut } };
assert.ok(derive(acr, 6.35, lim, up).feed > 3050 && derive(acr, 6.35, lim, up).shop === null);
// a down-cut: half its diameter a pass at most, in any material
const deep = { id: 'foam', cut: { vc: 120, flutes: 2, chip: 0.017, down: 0.9, downMax: 0, stepover: 0.45 } };
assert.ok(derive(deep, 6.35, lim, shop[2]).stepdown <= 3.175 + 0.025, `down-cut pass ${derive(deep, 6.35, lim, shop[2]).stepdown}`);
assert.ok(derive(deep, 6.35, lim, up).stepdown > 3.2, 'an up-cut keeps the deeper pass');
console.log('shop bits: ok');
