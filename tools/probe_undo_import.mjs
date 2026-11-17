// Getting parts in and working on them, and what undo does after:
//   - an STL saved in meters (0.3 x 0.2 x 0.019) comes in at 300 x 200 x 19 mm, and its card offers meters
//   - an empty or broken STL makes no part and says so; the good file dropped with it is still laid out
//   - right-click a part of a group while another part is picked: only the group is picked after
//   - a group turned a quarter and undone is back where it was (turned once, not once per piece)
//   - a lay flat on a face undoes to where it was, and redoes to flat again
//   - undo of a drag is saved and moves the stock with it
//   - duplicate is one undo, and the steps before it stay undoable
//   - mirror on a group of two flips it (once per group, not once per piece)
//   - a delete in cam leaves the other parts where they were, and the undo history whole
//   - leaving simulate says so (animate.end)
//   node tools/probe_undo_import.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const box = (x, y, z, ox = 0) => {
  const v = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]].map(([a, b, c]) => [a + ox, b, c]);
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.map(t => ` facet normal 0 0 0\n  outer loop\n${t.map(i => `   vertex ${v[i].join(' ')}`).join('\n')}\n  endloop\n endfacet`).join('\n');
};
const stl = body => `solid b\n${body}\nendsolid b\n`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-undo-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_files && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-units button')].find(b => b.textContent === 'mm')?.click());
  await wait(500);
  const load = files => page.evaluate(fs => { const a = window.kiri.api; a.platform.clear(); a.platform.load_files(fs.map(([t, n]) => new File([t], n))); }, files).then(() => wait(2500));
  const closeCards = () => page.evaluate(() => { for (const b of document.querySelectorAll('.swarf-stl-units button, .swarf-obj-up button')) if (b.textContent === 'done') b.click(); }).then(() => wait(400));
  const sizes = () => page.evaluate(() => window.kiri.api.widgets.all().map(w => { const s = w.getBoundingBox().getSize(new window.THREE.Vector3()); return [s.x, s.y, s.z].map(v => +v.toFixed(2)); }));
  const alerts = () => page.evaluate(() => document.body.innerText);

  // meters
  await load([[stl(box(0.3, 0.2, 0.019)), 'plank.stl']]);
  check(JSON.stringify(await sizes()) === '[[300,200,19]]', `meters: 300 x 200 x 19 mm (${JSON.stringify(await sizes())})`);
  const card = await page.evaluate(() => document.querySelector('.swarf-stl-units')?.innerText || '');
  check(/came in as meters/.test(card) && /meters:/.test(card), `the card says meters and offers it (${card.replace(/\s+/g, ' ').slice(0, 140)})`);
  await page.evaluate(() => document.querySelector('.swarf-stl-units input[value="mm"]').click());
  await wait(600);
  check(JSON.stringify(await sizes()) === '[[0.3,0.2,0.02]]', `millimeters pressed: / 1000 (${JSON.stringify(await sizes())})`);
  await closeCards();

  // an empty file and a broken one beside a good one
  await load([[new Uint8Array(0), 'empty.stl'], [new Uint8Array(40), 'short.stl'], [stl(box(50, 40, 10)), 'good.stl']]);
  await closeCards();
  const s2 = await sizes();
  check(JSON.stringify(s2) === '[[50,40,10]]', `only the good file makes a part (${JSON.stringify(s2)})`);
  check(/empty\.stl: nothing in this file/.test(await alerts()), 'the empty file is said');
  const placed = await page.evaluate(() => { const w = window.kiri.api.widgets.all()[0]; return [w.track.pos.x, w.track.pos.y].every(Number.isFinite); });
  check(placed, 'the good part is laid out on the bed');

  // a group of three and a single part
  await page.evaluate(() => { const a = window.kiri.api; a.platform.clear(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="40mm" viewBox="0 0 200 40"><rect x="0" y="0" width="30" height="40"/><rect x="60" y="0" width="30" height="40"/><path d="M120 0 L170 0 L120 40 Z"/></svg>', 'three', { depth: 10, soup: true, dpi: 0 }); });
  await wait(1500);
  await page.evaluate(t => window.kiri.api.platform.load_files([new File([t], 'lone.stl')]), stl(box(40, 40, 10)));
  await wait(2500);
  await closeCards();
  const ids = await page.evaluate(() => window.kiri.api.widgets.all().map(w => ({ id: w.id, n: w.group.length, file: w.meta.file })));
  const lone = ids.find(w => w.n === 1), member = ids.find(w => w.n === 3);
  check(!!lone && !!member, `a group of three and one part (${JSON.stringify(ids)})`);
  // right-click a member while the lone part is picked (swarf-menu.js partItems picks it)
  const after = await page.evaluate((lid, mid) => {
    const a = window.kiri.api, W = id => a.widgets.all().find(w => w.id === id);
    a.platform.deselect(); a.platform.select(W(lid), false);
    window.__swarfMenu.open(400, 300, W(mid));
    const rows = window.__swarfMenu.rows();
    window.__swarfMenu.close();
    return { ids: a.selection.widgets().map(w => w.id), rows };
  }, lone.id, member.id);
  check(after.ids.length === 3 && !after.ids.includes(lone.id), `right-click a group member: the group alone is picked (${after.ids.length} picked)`);
  check(after.rows.includes('separate the parts'), `and separate the parts is offered for the drawn group (${after.rows.join(' · ')})`);

  // separating the drawn group: each part's drawing stays on it (meta.t + its place is unchanged), and undo too
  const drawnAt = () => page.evaluate(ids => ids.map(id => { const w = window.kiri.api.widgets.all().find(w => w.id === id); return [w.meta.t[0] + w.track.pos.x, w.meta.t[1] + w.track.pos.y].map(v => +v.toFixed(3)); }), ids.filter(r => r.n === 3).map(r => r.id));
  const d0 = await drawnAt();
  const sep = await page.evaluate(mid => window.kiri.api.selection.separate(window.kiri.api.widgets.all().find(w => w.id === mid)).n, member.id);
  const d1 = await drawnAt();
  await page.evaluate(() => window.kiri.api.doit.undo());
  const d2 = await drawnAt();
  check(sep === 3 && JSON.stringify(d1) === JSON.stringify(d0) && JSON.stringify(d2) === JSON.stringify(d0), `separate keeps each drawing on its part, and undo too (${JSON.stringify(d0)} / ${JSON.stringify(d1)} / ${JSON.stringify(d2)})`);

  // group turn and its undo
  const pts = () => page.evaluate(mid => { const a = window.kiri.api, w = a.widgets.all().find(w => w.id === mid); const b = w.getBoundingBox(); return [b.max.x - b.min.x, b.max.y - b.min.y].map(v => +v.toFixed(1)); }, member.id);
  const before = await pts();
  await page.evaluate(() => window.kiri.api.selection.rotate(0, 0, Math.PI / 2));
  await wait(400);
  const turned = await pts();
  await page.evaluate(() => window.kiri.api.doit.undo());
  await wait(400);
  check(JSON.stringify(await pts()) === JSON.stringify(before) && JSON.stringify(turned) !== JSON.stringify(before), `group turn undone once is back (${before} -> ${turned} -> ${await pts()})`);

  // lay flat with a quaternion, undo, redo
  const top = () => page.evaluate(lid => { const w = window.kiri.api.widgets.all().find(w => w.id === lid); const b = w.getBoundingBox(); return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(1)); }, lone.id);
  await page.evaluate(lid => { const a = window.kiri.api, w = a.widgets.all().find(w => w.id === lid); a.platform.deselect(); a.platform.select(w, false); }, lone.id);
  const t0 = await top();
  await page.evaluate(() => { const T = window.THREE; window.kiri.api.selection.rotate(new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), new T.Vector3(0, 0, -1))); });
  await wait(400);
  const t1 = await top();
  await page.evaluate(() => window.kiri.api.doit.undo());
  await wait(400);
  const t2 = await top();
  await page.evaluate(() => window.kiri.api.doit.redo());
  await wait(400);
  const t3 = await top();
  check(JSON.stringify(t2) === JSON.stringify(t0) && JSON.stringify(t3) === JSON.stringify(t1), `lay flat: undo back, redo flat again (${t0} / ${t1} / ${t2} / ${t3})`);

  // undo of a drag: saved and the bounds follow
  const drag = await page.evaluate(lid => {
    const a = window.kiri.api, w = a.widgets.all().find(w => w.id === lid);
    a.platform.deselect(); a.platform.select(w, false);
    const x0 = w.track.pos.x;
    a.selection.move(25, 0, 0); a.event.emit('selection.drag', { x: 25, y: 0 }); a.event.emit('mouse.drag.done');
    const moved = w.track.pos.x, bmax1 = a.conf.get().bounds.max.x;
    let saved = 0; const was = a.space.auto_save; a.space.auto_save = () => { saved++; was(); };
    a.doit.undo();
    a.space.auto_save = was;
    return { x0, moved, back: w.track.pos.x, saved, bmax1, bmax2: a.conf.get().bounds.max.x };
  }, lone.id);
  check(drag.back === drag.x0 && drag.moved === drag.x0 + 25, `undo of a drag puts it back (${JSON.stringify(drag)})`);
  check(drag.saved > 0, 'undo of a drag is saved');
  check(Math.abs(drag.bmax1 - drag.bmax2 - 25) < 0.01 || drag.bmax1 !== drag.bmax2, 'the bounds follow the undo');

  // duplicate: one undo, history kept
  const dup = await page.evaluate(lid => {
    const a = window.kiri.api, w = a.widgets.all().find(w => w.id === lid);
    a.platform.deselect(); a.platform.select(w, false);
    a.selection.move(10, 0, 0);
    a.event.emit('selection.drag', { x: 10, y: 0 }); a.event.emit('mouse.drag.done');
    const n0 = a.widgets.all().length;
    a.selection.duplicate();
    const n1 = a.widgets.all().length;
    a.doit.undo();
    const n2 = a.widgets.all().length;
    const x = w.track.pos.x;
    a.doit.undo();
    return { n0, n1, n2, movedBack: w.track.pos.x === x - 10 };
  }, lone.id);
  check(dup.n1 === dup.n0 + 1 && dup.n2 === dup.n0, `duplicate is undone (${JSON.stringify(dup)})`);
  check(dup.movedBack, 'the step before the duplicate is still undoable');

  // mirror a group of two
  const mir = await page.evaluate(() => {
    const a = window.kiri.api; a.platform.clear();
    a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="40mm" viewBox="0 0 100 40"><path d="M0 0 L30 0 L0 40 Z"/><path d="M60 0 L90 0 L60 40 Z"/></svg>', 'pair', { depth: 10, soup: true, dpi: 0 });
    return true;
  });
  await wait(1500);
  const flags = await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); a.platform.select(a.widgets.all()[0], false); try { a.selection.mirror(); } catch (e) { return [e.message]; } return a.widgets.all().map(w => !!w.track.mirror); });
  check(mir && flags.length === 2 && flags.every(Boolean), `mirror on a group of two flips both once (${flags})`);

  // delete in cam: the others stay, undo history whole
  const del = await page.evaluate(() => {
    const a = window.kiri.api; a.platform.clear();
    return true;
  });
  await page.evaluate(t => window.kiri.api.platform.load_files([new File([t[0]], 'a.stl'), new File([t[1]], 'b.stl'), new File([t[2]], 'c.stl')]), [stl(box(30, 30, 10)), stl(box(40, 30, 10)), stl(box(50, 30, 10))]);
  await wait(2500);
  await closeCards();
  const keep = await page.evaluate(() => {
    const a = window.kiri.api, all = a.widgets.all();
    a.platform.deselect(); a.platform.select(all[0], false);
    a.selection.move(0, 150, 0);
    const where = () => a.widgets.all().map(w => [w.id, +w.track.pos.x.toFixed(2), +w.track.pos.y.toFixed(2)]);
    const w1 = where().filter(r => r[0] !== all[1].id);
    a.platform.delete(all[1]);
    const w2 = where();
    a.doit.undo();
    const back = a.widgets.all().length;
    a.doit.undo();
    return { same: JSON.stringify(w1) === JSON.stringify(w2), back, w1, w2 };
  });
  check(del && keep.same, `a delete leaves the others where they were (${JSON.stringify(keep.w1)} / ${JSON.stringify(keep.w2)})`);
  check(keep.back === 3, 'undo brings the part back');

  // animate.end on leaving simulate
  const ended = await page.evaluate(() => { const a = window.kiri.api; let n = 0; a.event.on('animate.end', () => n++); a.view.set(4); a.view.set_arrange(); return n; });
  check(ended === 1, `leaving simulate says animate.end (${ended})`);
  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
