// What undo covers, and the small words around parts and files:
//   - mirror, leave it out of this run, add a step, a number typed on a step card and a material
//     picked by hand are each one undo (and redo)
//   - a new part keeps the history before it; file › new empties it
//   - deleted parts kept for undo are capped (the latest few)
//   - the tabs line and the menu title name a part without its .stl
//   - the step list keeps the student's own capitals
//   - in the toolpaths view, Delete and a right-click on a part say how to change it
//   - in simulate the right rail's drawers fold, and open again after
//   - a resize says the tab height it re-made the tabs at
//   - memory: a delete keeps no slices on the part held for undo
//   node tools/probe_undo_words.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const box = (x, y, z) => {
  const v = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return `solid b\n${f.map(t => ` facet normal 0 0 0\n  outer loop\n${t.map(i => `   vertex ${v[i].join(' ')}`).join('\n')}\n  endloop\n endfacet`).join('\n')}\nendsolid b\n`;
};
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-undowords-')), args: ['--window-size=1440,900'] });
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
  const closeCards = () => page.evaluate(() => { for (const b of document.querySelectorAll('.swarf-stl-units button, .swarf-obj-up button')) if (b.textContent === 'done') b.click(); }).then(() => wait(400));
  const text = () => page.evaluate(() => document.body.innerText);
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.view.set_arrange(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); a.doit.clear(); }).then(() => wait(500));
  await fresh();
  await page.evaluate(t => window.kiri.api.platform.load_files([new File([t], 'frame.stl')]), box(120, 80, 12));
  await wait(2500);
  await closeCards();

  // mirror: undo and redo
  const mir = await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0];
    a.platform.deselect(); a.platform.select(w, false);
    a.selection.mirror();
    const m1 = !!w.track.mirror;
    a.doit.undo(); const m2 = !!w.track.mirror;
    a.doit.redo(); const m3 = !!w.track.mirror;
    a.doit.undo();
    return [m1, m2, m3];
  });
  check(JSON.stringify(mir) === '[true,false,true]', `mirror: undone and redone (${mir})`);

  // leave it out of this run
  const cut = await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0];
    a.platform.set_cut([w], false);
    const out = !!w.meta.disabled;
    a.doit.undo(); const back = !w.meta.disabled;
    a.doit.redo(); const again = !!w.meta.disabled;
    a.doit.undo();
    return [out, back, again];
  });
  check(cut.every(Boolean), `leave it out of this run: undone and redone (${cut})`);

  // add a step, then type a feed on it, then undo both
  const add = () => page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()).then(() => wait(400));
  const ops = () => page.evaluate(() => window.kiri.api.conf.get().process.ops.filter(o => o.type !== '|').map(o => `${o.type}:${Math.round(o.rate)}`));
  await add();
  const o1 = await ops();
  const typed = await page.evaluate(() => {
    const inp = document.querySelector('#oplist [data-swarf-field="rate"]');
    if (!inp) return 'no field';
    inp.value = '777'; inp.dispatchEvent(new Event('change'));
    return 'typed';
  });
  await wait(300);
  const o2 = await ops();
  await page.evaluate(() => window.kiri.api.doit.undo()); await wait(300);
  const o3 = await ops();
  await page.evaluate(() => window.kiri.api.doit.undo()); await wait(300);
  const o4 = await ops();
  await page.evaluate(() => window.kiri.api.doit.redo()); await wait(300);
  const o5 = await ops();
  check(o1.length === 1 && o2[0] === 'outline:777' && o3[0] === o1[0] && !o4.length && o5[0] === o1[0], `add a step and a typed feed: each one undo (${typed}: ${o1} / ${o2} / ${o3} / ${o4.length} / ${o5})`);

  // a material picked by hand: undone with the numbers it changed
  const mat = await page.evaluate(() => {
    const a = window.kiri.api, sel = document.getElementById('swarf-material-select');
    const was = sel.value, other = [...sel.options].map(o => o.value).find(v => v !== was);
    const rate0 = a.conf.get().process.ops.find(o => o.type === 'outline').rate;
    sel.value = other; sel.dispatchEvent(new Event('change'));
    const rate1 = a.conf.get().process.ops.find(o => o.type === 'outline').rate, now = window.__swarfMaterial.id;
    a.doit.undo();
    return { was, other, now, back: window.__swarfMaterial.id, shown: sel.value, rate0, rate1, rate2: a.conf.get().process.ops.find(o => o.type === 'outline').rate };
  });
  check(mat.now === mat.other && mat.back === mat.was && mat.shown === mat.was && mat.rate2 === mat.rate0, `material: undone, numbers and all (${JSON.stringify(mat)})`);

  // a new part keeps the history (placed by itself: auto layout re-packs the bed, which starts it over);
  // file › new empties it
  const keep = await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0], al = a.ui.autoLayout;
    if (al && al.checked) { al.checked = false; al.dispatchEvent(new Event('change')); }
    a.platform.deselect(); a.platform.select(w, false);
    const x0 = w.track.pos.x;
    a.selection.move(15, 0, 0); a.event.emit('selection.drag', { x: 15, y: 0 }); a.event.emit('mouse.drag.done');
    return x0;
  });
  await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40"><rect width="40" height="40"/></svg>', 'square', { depth: 10, soup: true, dpi: 0 }));
  await wait(1500);
  const after = await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all().find(w => w.meta.file === 'frame.stl'), al = a.ui.autoLayout;
    a.doit.undo();
    if (al && !al.checked) { al.checked = true; al.dispatchEvent(new Event('change')); }
    return w.track.pos.x;
  });
  check(after === keep, `a move before a new part is still undoable (${keep} -> ${after})`);

  // names without .stl: the tabs line and the part menu's title
  const names = await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all().find(w => w.meta.file === 'frame.stl');
    a.platform.deselect(); a.platform.select(w, false);
    window.__swarfMenu.open(400, 300, w);
    const title = document.querySelector('.swarf-ctx-title')?.textContent || '';
    window.__swarfMenu.close();
    return { title, placed: document.body.innerText.match(/\d+ tabs? placed on [^\n:]*/)?.[0] || '' };
  });
  check(names.title && !/\.stl/.test(names.title), `the part menu's title has no .stl (${names.title})`);
  check(!/\.stl/.test(names.placed), `the tabs line has no .stl (${names.placed || 'not shown'})`);

  // the step list keeps capitals
  const caps = await page.evaluate(() => getComputedStyle(document.querySelector('#oplist > div')).textTransform);
  check(caps === 'none', `the step list keeps the student's capitals (text-transform ${caps})`);

  // deleted parts kept for undo are capped, and hold no slices
  const cap = await page.evaluate(() => {
    const a = window.kiri.api;
    for (let i = 0; i < 12; i++) a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>', `d${i}`, { depth: 6, soup: true, dpi: 0 });
    return a.widgets.all().length;
  });
  await wait(1500);
  const capped = await page.evaluate(() => {
    const a = window.kiri.api, gone = a.widgets.all().filter(w => /^d\d+/.test(w.meta.file));
    for (const w of gone) { w.slices = [{ view: null }]; a.platform.delete(w); }
    let back = 0;
    for (let i = 0; i < 20; i++) { const n = a.widgets.all().length; a.doit.undo(); if (a.widgets.all().length > n) back++; }
    const held = a.widgets.all().filter(w => /^d\d+/.test(w.meta.file));
    return { made: gone.length, back, slices: held.filter(w => w.slices).length };
  });
  check(capped.made === 12 && capped.back === 8 && capped.slices === 0, `12 deletes: the latest 8 come back, with no slices held (${JSON.stringify(capped)})`);

  // file › new: nothing to undo after
  const nw = await page.evaluate(async () => {
    const a = window.kiri.api;
    self.__swarfRestoring = true;
    self.SwarfFile.fresh();
    a.platform.clear();
    self.__swarfRestoring = false;
    const n = a.widgets.all().length;
    a.doit.undo();
    return { n, after: a.widgets.all().length };
  });
  check(nw.n === 0 && nw.after === 0, `file › new: undo brings nothing back (${JSON.stringify(nw)})`);

  // the toolpaths view: Delete and a right-click on a part say how to change it
  await fresh();
  await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'plaque', { depth: 12, soup: true, dpi: 0 }));
  await wait(1200);
  await add();
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 60000); }));
  await wait(800);
  await page.evaluate(() => window.kiri.api.event.alerts(true));
  await page.keyboard.press('Delete');
  await wait(300);
  const t1 = await text();
  check(/Press clear to change the parts\./.test(t1) && await page.evaluate(() => window.kiri.api.widgets.all().length === 1), 'toolpaths view: Delete says press clear, and the part stays');
  const rc = await page.evaluate(() => { const a = window.kiri.api; a.event.alerts(true); const opened = window.__swarfMenu.open(400, 300, a.widgets.all()[0]); const rows = window.__swarfMenu.rows(); window.__swarfMenu.close(); return { opened, rows }; });
  check(!rc.rows.length && /Press clear to change the parts\./.test(await text()), `toolpaths view: a right-click on the part says the same, no bed menu (${rc.rows.join(' · ')})`);

  // simulate: the rail's drawers fold, and come back
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#swarf-right-rail .set2-group')].map(g => Math.round(g.getBoundingClientRect().height)));
  await page.evaluate(() => window.kiri.api.view.set_arrange()); await wait(400);
  await page.evaluate(() => { const hd = document.querySelector('#cam-tabs .set-header'), row = document.querySelector('#cam-tabs .swarf-autotabs-row'); if (hd && row && row.classList.contains('hide')) hd.click(); });
  await wait(300);
  const h0 = await shown();
  await page.evaluate(() => document.getElementById('act-animate').click());
  await page.waitForFunction(() => !!window.__swarfSimStock, { timeout: 90000, polling: 100 });
  await wait(1200);
  const h1 = await shown();
  await page.evaluate(() => window.kiri.api.view.set_arrange()); await wait(600);
  const h2 = await shown();
  const sum = h => h.reduce((a, b) => a + b, 0);
  check(sum(h1) < sum(h0) && h1.every(v => v < 60), `simulate folds the rail's drawers (${h0} -> ${h1})`);
  check(JSON.stringify(h2) === JSON.stringify(h0), `and they open again after (${h2})`);

  // a resize says the tab height it re-made the tabs at
  await fresh();
  await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="120mm" viewBox="0 0 200 120"><rect width="200" height="120"/></svg>', 'board', { depth: 12, soup: true, dpi: 0 }));
  await wait(1200);
  await add();
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0], false); window.__swarfAutoTabs.place(); });
  await wait(600);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0], false); a.selection.scale(1, 1, 25 / 12); });
  await wait(1200);
  const rs = await text();
  check(/Tabs placed again on 1 part at the new size, [\d.]+ mm tall\./.test(rs), `a resize says the new tab height (${(rs.match(/Tabs placed again[^\n]*/) || [''])[0]})`);

  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
