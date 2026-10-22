/*
 * Torture-test cases: parts x ops x tools x machines x setup. Each op lists
 * only what differs from the app's own defaults for that op.
 */
const rough = (tool = 'end 1/4', o = {}) => ({ type: 'rough', tool, ...o });
const contour = (tool = 'ball 1/8', o = {}) => ({ type: 'contour', tool, ...o });
const outline = (tool = 'end 1/4', o = {}) => ({ type: 'outline', tool, ...o });
const pocket = (tool = 'end 1/8', o = {}) => ({ type: 'pocket', tool, ...o });

const one = name => [{ name }];
export const CASES = [];
const add = (id, parts, ops, extra = {}) => CASES.push({ id, parts, ops, ...extra });

// every part through the default student flow (rough, cutout, 1/4)
const ALL = ['seed_cube', 'iso_stack', 'pocket_islands', 'open_slots', 'thin_walls', 'narrow_grooves', 'holes',
    'pins', 'dome', 'egg_crate', 'chamfers', 'mushroom', 'sphere', 'tiny', 'tall_tower', 'engraving',
    'big_plate', 'stairs', 'torus'];
for (const p of ALL) add(`rough-${p}`, one(p), [rough()]);

// rough variants
add('rough-all-flats-inside-1_8-pocket_islands', one('pocket_islands'), [rough('end 1/8', { all: true, flats: true, inside: true })]);
add('rough-inside-iso_stack', one('iso_stack'), [rough('end 1/4', { inside: true })]);
add('rough-leave-0.5-dome', one('dome'), [rough('end 1/4', { leave: 0.5, leavez: 0.3 })]);
add('rough-1_2-pins', one('pins'), [rough('end 1/2')]);
add('rough-1_16-engraving', one('engraving'), [rough('end 1/16')]);
add('rough-3mm-metric-holes', one('holes'), [rough('end 3mm', { all: true, inside: true })]);
add('rough-conventional-chamfers', one('chamfers'), [rough('end 1/4', { direction: 'conventional' })]);
add('rough-omitthru-holes', one('holes'), [rough('end 1/8', { inside: true, all: true, omitthru: true })]);

// contour (finishing) on freeform, both axes, ball and flat
add('rough+contourX-ball-dome', one('dome'), [rough(), contour('ball 1/8', { axis: 'X' })]);
add('rough+contourY-ball-egg_crate', one('egg_crate'), [rough(), contour('ball 1/8', { axis: 'Y' })]);
add('contourX-flat-chamfers', one('chamfers'), [contour('end 1/4', { axis: 'X' })]);
add('contour-ball6mm-sphere', one('sphere'), [contour('ball 6mm', { axis: 'X' })]);
add('contour-curves-torus', one('torus'), [rough(), contour('ball 1/8', { axis: 'X', curves: true })]);
add('contour-inside-mushroom', one('mushroom'), [contour('ball 1/4', { axis: 'Y', inside: true })]);

// outline
add('outline-out-iso_stack', one('iso_stack'), [outline('end 1/4', { outside: true, inside: false })]);
add('outline-in-holes', one('holes'), [outline('end 1/8', { inside: true, outside: false })]);
add('outline-wide-thin_walls', one('thin_walls'), [outline('end 1/8', { outside: true, wide: true, steps: 3 })]);
add('outline-dogbones-pocket_islands', one('pocket_islands'), [outline('end 1/8', { inside: true, outside: false, dogbones: true })]);
add('outline-tiny-1_2', one('tiny'), [outline('end 1/2', { outside: true })]);

// pocket on tagged floors
add('pocket-pocket_islands', one('pocket_islands'), [pocket('end 1/8')]);
add('pocket-contour-pocket_islands', one('pocket_islands'), [pocket('end 1/8', { contour: true })]);
add('pocket-open_slots-1_8', one('open_slots'), [pocket('end 1/8')]);
add('pocket-holes-blind', one('holes'), [pocket('end 1/16')]);
add('pocket-big_plate', one('big_plate'), [pocket('end 1/4')]);

// full programs: rough + pocket + outline + contour with tool changes
add('program-pocket_islands', one('pocket_islands'), [rough('end 1/4'), pocket('end 1/8'), outline('end 1/8', { inside: true, outside: false }), contour('ball 1/8')]);
add('program-iso_stack', one('iso_stack'), [rough('end 3/8'), outline('end 1/4'), contour('ball 1/4', { axis: 'Y' })]);

// many parts, mixed, rotated, scaled
add('multi-3-mixed', [{ name: 'seed_cube' }, { name: 'pins' }, { name: 'pocket_islands' }], [rough()]);
add('multi-8-cubes', [{ name: 'seed_cube', copies: 8 }], [rough()]);
add('multi-12-tiny+cubes', [{ name: 'tiny', copies: 6 }, { name: 'seed_cube', copies: 6 }], [rough('end 1/8')]);
add('multi-rotated-30', [{ name: 'open_slots', rotate: [0, 0, 30] }, { name: 'chamfers', rotate: [0, 0, -45] }], [rough(), contour('ball 1/8')]);
add('multi-scaled', [{ name: 'iso_stack', scale: 0.5 }, { name: 'dome', scale: 1.5 }], [rough()]);
add('multi-pockets-2', [{ name: 'pocket_islands', copies: 2 }], [rough(), pocket('end 1/8')]);
add('rotated-on-side', [{ name: 'chamfers', rotate: [90, 0, 0] }], [rough(), contour('ball 1/8')]);

// machines, units, origins, materials
add('shopbot-rough-iso_stack', one('iso_stack'), [rough()], { device: 'ShopBot.Basic' });
add('shopbot-program-pocket_islands', one('pocket_islands'), [rough(), pocket('end 1/8'), contour('ball 1/8')], { device: 'ShopBot.Basic' });
add('inches-rough-dome', one('dome'), [rough(), contour('ball 1/8')], { units: 'in' });
add('origin-corner-bottom-holes', one('holes'), [rough(), outline('end 1/8', { inside: true, outside: false })], { origin: { center: false, top: false } });
add('origin-corner-top-multi', [{ name: 'seed_cube' }, { name: 'stairs' }], [rough()], { origin: { center: false, top: true } });
add('aluminum-rough-pocket_islands', one('pocket_islands'), [rough('end 1/8'), pocket('end 1/8')], { material: 'aluminum_6061' });
add('steel-rough-iso_stack', one('iso_stack'), [rough('end 1/4')], { material: 'mild_steel' });
add('foam-rough-1_2-sphere', one('sphere'), [rough('end 1/2')], { material: 'foam' });

// stock bigger than the part: extra material on top and around
const level = (tool = 'end 1/2', o = {}) => ({ type: 'level', tool, ...o });
add('stockpad-rough-seed_cube', one('seed_cube'), [rough()], { stockPad: { x: 10, y: 10, z: 3 } });
add('stockpad-level+rough-iso_stack', one('iso_stack'), [level(), rough()], { stockPad: { x: 6, y: 6, z: 2 } });
add('stockpad-program-pocket_islands', one('pocket_islands'), [rough(), pocket('end 1/8'), contour('ball 1/8')], { stockPad: { x: 8, y: 8, z: 4 } });
add('stockpad-multi-4', [{ name: 'pins' }, { name: 'dome' }, { name: 'holes' }, { name: 'tiny' }], [rough()], { stockPad: { x: 5, y: 5, z: 2 } });
add('level-big_plate', one('big_plate'), [level('end 1/2')], { stockPad: { x: 0, y: 0, z: 1.5 } });
