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
// in plywood the shop's bit cuts with the shop's own numbers (10-29): 120 in/min, 1/8 in a pass, 12,000 rpm
const b = derive(ply, 6.35, lim, up);
assert.equal(b.feed, 3050, `shop feed (${b.feed})`); assert.equal(b.stepdown, 3.15, `shop pass, rounded down (${b.stepdown})`); assert.equal(b.spindle, 12000);
assert.ok(b.plunge <= b.feed && b.plunge <= lim.feedMaxZ);
assert.ok(Math.abs(b.shop.feed - 3048) < 1e-9 && Math.abs(b.shop.pass - 3.175) < 1e-9, 'the shop numbers in mm');
// any other bit in wood: at least 1500 mm/min where it can take it, above the motors' rough band
const g = derive(ply, 6.35, lim);
assert.equal(g.feed, 1500, `generic 1/4 in floor (${g.feed})`);
const tiny = derive(ply, 1.5875, lim);
assert.ok(tiny.feed < 1500 && tiny.feed > 1000, `a 1/16 in bit keeps under its own chip limit (${tiny.feed})`);
const hot = { ...ply, cut: { ...ply.cut, chip: 0.05, down: 0.9 } };
// not wood: the shop library says nothing
const acr = { id: 'acrylic', cut: { ...hot.cut } };
assert.ok(derive(acr, 6.35, lim, up).feed > 3050 && derive(acr, 6.35, lim, up).shop === null);
// a down-cut: half its diameter a pass at most, in any material
const deep = { id: 'foam', cut: { vc: 120, flutes: 2, chip: 0.017, down: 0.9, downMax: 0, stepover: 0.45 } };
assert.ok(derive(deep, 6.35, lim, shop[2]).stepdown <= 3.175 + 0.025, `down-cut pass ${derive(deep, 6.35, lim, shop[2]).stepdown}`);
assert.ok(derive(deep, 6.35, lim, up).stepdown > 3.2, 'an up-cut keeps the deeper pass');
console.log('shop bits: ok');
