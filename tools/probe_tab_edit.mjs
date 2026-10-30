// ONE TAB AT A TIME (Phil 10-30: "would still like to be able to move/delete/change them
// individually"): on a 300 x 200 part of 3/4 in plywood on the ShopBot, auto tabs place at once
// (no apply), then with real mouse presses and keys: pick a tab, drag it along the edge (it stays
// on the edge, turned to it, and stops short of another tab), delete another with Delete (the part
// stays), resize a third in its card (inches typed as a fraction too); a field change keeps the
// moved and resized ones and the deleted one does not come back; undo steps back through each
// change; a reload, a turn, a scale, a mirror and a duplicate keep it all; back to automatic lets
// go; the concerns' count follows; the trash clears pins and spots (and undo brings them back);
// the picked tab lights up in all three skins.
//   node tools/probe_tab_edit.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  const ready = () => page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.platform?.load_svg && window.__swarfShape && window.__swarfAutoTabs && window.__swarfTabEdit && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready();
  await wait(1500);
  await page.evaluate(() => window.kiri.api.platform.clear());
  await wait(300);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(900);
  await page.evaluate(() => { const s = document.getElementById('swarf-material-select'); s.value = 'plywood'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(300);
  await page.evaluate(() => window.kiri.api.platform.load_svg(window.__swarfShape.svgFor('rect', { w: 300, h: 200 }), 'rectangle', { depth: 19.05, resolution: 2, segmin: 48, soup: true, dpi: 0, edge: { kind: 'straight', size: 0 } }));
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
  await wait(600);
  await page.evaluate(() => {
    const a = window.kiri.api, s = a.conf.get();
    s.process.ops = [];
    const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    a.platform.select(a.widgets.all()[0]);
    window.__swarfAutoTabs.set({ density: 0, scale: 0, pin: {} });
  });
  await wait(300);
  await page.evaluate(() => window.moto.space.view.top());
  await wait(1200);

  // the tabs as data: edge point (center less half the reach), size, flags; and the part's spots
  const tabs = (i = 0) => page.evaluate(i => {
    const a = window.kiri.api, parts = a.widgets.all().filter(w => !w.track.synth), w = parts[i], an = a.widgets.annotate(w.id);
    const ang = r => { const q = r.rot; const z = Array.isArray(q) ? q[2] : (q._z ?? q.z), ww = Array.isArray(q) ? q[3] : (q._w ?? q.w); return 2 * Math.atan2(z, ww); };
    const list = (an.tab || []).map(r => { const t = ang(r); return { id: r.id, auto: !!r.auto, pinned: !!r.pinned, ex: r.pos.x - Math.cos(t) * r.dim.x / 2, ey: r.pos.y - Math.sin(t) * r.dim.x / 2, a: t, x: r.dim.x, y: r.dim.y, z: r.dim.z }; });
    return { list, boxes: Object.keys(w.tabs || {}).length, set: an.tabset || null, box: w.track.box, parts: parts.length, id: w.id };
  }, i);
  // a point of the part's frame on the screen
  const screen = (x, y, z = 2) => page.evaluate((x, y, z) => {
    const a = window.kiri.api, w = a.widgets.all()[0], I = window.moto.space.internals();
    w.mesh.updateMatrixWorld();
    const v = new window.THREE.Vector3(x, y, z); w.mesh.localToWorld(v); v.project(I.camera);
    const r = I.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, x, y, z);
  const tabScreen = id => page.evaluate(id => {
    const a = window.kiri.api, w = a.widgets.all()[0], I = window.moto.space.internals();
    const box = w.tabs[id].box, v = box.getWorldPosition(new window.THREE.Vector3()).project(I.camera);
    const r = I.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, id);
  const click = async p => { await page.mouse.move(p.x - 4, p.y - 4); await wait(60); await page.mouse.move(p.x, p.y); await wait(60); await page.mouse.down(); await wait(40); await page.mouse.up(); await wait(250); };
  const picked = () => page.evaluate(() => window.__swarfTabEdit.picked);
  const cardOn = () => page.evaluate(() => { const c = document.getElementById('swarf-tabcard'); return !!c && getComputedStyle(c).display !== 'none'; });
  const undo = async () => { await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await wait(300); };
  const redo = async () => { await page.keyboard.down('Meta'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Meta'); await wait(300); };
  // distance from an edge point to the 300 x 200 outline (centered)
  const offEdge = (t, W = 150, H = 100) => Math.min(Math.abs(Math.abs(t.ex) - W) + Math.max(0, Math.abs(t.ey) - H), Math.abs(Math.abs(t.ey) - H) + Math.max(0, Math.abs(t.ex) - W));

  // ---- auto tabs place at once: no apply -------------------------------------------------------
  const noApply = await page.evaluate(() => !document.getElementById('swarf-autotabs-apply') && !document.getElementById('swarf-autotabs-cancel'));
  check(noApply, 'there is no apply or cancel button');
  await page.evaluate(() => document.getElementById('swarf-autotabs-go').click());
  await wait(400);
  let t = await tabs();
  check(t.list.length === 4 && t.boxes === 4 && t.list.every(r => r.auto && !r.pinned) && t.set, `the press places 4 auto tabs at once (${t.list.length}, ${t.boxes} drawn)`);
  const sayNow = await page.evaluate(() => document.getElementById('swarf-autotabs-say').textContent);
  check(/click a tab/i.test(sayNow) && !/apply/i.test(sayNow), `and says how to change one ("${sayNow.slice(-90)}")`);
  // which is which: A on the bottom side (y = -100), B on the top, C on the right, D on the left
  const side = r => Math.abs(r.ey + 100) < 1 ? 'bottom' : Math.abs(r.ey - 100) < 1 ? 'top' : r.ex > 0 ? 'right' : 'left';
  const A = t.list.find(r => side(r) === 'bottom'), B = t.list.find(r => side(r) === 'top'), C = t.list.find(r => side(r) === 'right'), D = t.list.find(r => side(r) === 'left');
  check(A && B && C && D, `one on each side (${t.list.map(side)})`);
  await undo();
  t = await tabs();
  check(t.list.length === 0 && !t.set, `undo takes them back (${t.list.length})`);
  await redo();
  t = await tabs();
  check(t.list.length === 4 && t.list.some(r => r.id === A.id), `redo puts the same 4 back (${t.list.length})`);

  // ---- pick A with a click; it lights up and its card shows ------------------------------------
  await click(await tabScreen(A.id));
  let p = await picked();
  const lit = await page.evaluate(id => { const w = window.kiri.api.widgets.all()[0]; return { c: w.tabs[id].box.material.color.getHex(), want: window.__swarfTabEdit.color() }; }, A.id);
  check(p && p.id === A.id && lit.c === lit.want, `a click picks the tab and lights it (${p && p.id === A.id}, ${lit.c.toString(16)})`);
  check(await cardOn(), 'its card shows');
  const card = await page.evaluate(() => ({ len: document.getElementById('swarf-tab-width').value, h: document.getElementById('swarf-tab-height').value, reach: document.getElementById('swarf-tab-depth').value, size: getComputedStyle(document.getElementById('swarf-size')).display }));
  check(near(+card.len, 12.7) && near(+card.h, 4.76, 0.01) && near(+card.reach, 6.35) && card.size === 'none', `the card says 12.7 long, 4.76 tall, reach 6.35, in the size card's place (${JSON.stringify(card)})`);
  const sel = await page.evaluate(() => window.kiri.api.selection.widgets(true).length);
  check(sel === 1, 'the part stays as it was (still picked, not moved)');

  // ---- drag A 50 mm along the bottom edge --------------------------------------------------------
  const from = await tabScreen(A.id);
  const to = await screen(A.ex + 50, A.ey - 3);
  await page.mouse.move(from.x, from.y); await wait(50);
  await page.mouse.down(); await wait(50);
  for (let k = 1; k <= 10; k++) { await page.mouse.move(from.x + (to.x - from.x) * k / 10, from.y + (to.y - from.y) * k / 10); await wait(30); }
  await page.mouse.up(); await wait(400);
  t = await tabs();
  let a1 = t.list.find(r => r.id === A.id);
  check(a1 && near(a1.ex, A.ex + 50, 2) && near(a1.ey, -100, 0.01) && near(a1.a, A.a, 1e-6) && a1.pinned, `dragged: 50 mm along the edge, on it, turned the same way, pinned (${a1 && [a1.ex.toFixed(1), a1.ey.toFixed(2), a1.pinned]})`);
  const partMoved = await page.evaluate(() => { const p = window.kiri.api.widgets.all()[0].track.pos; return Math.hypot(p.x, p.y); });
  check(partMoved < 0.01, `the part did not move (${partMoved})`);
  // drag A around the corner onto the right side: it follows the outline
  const cornerTo = await screen(150 + 3, -40);
  const f2 = await tabScreen(A.id);
  await page.mouse.move(f2.x, f2.y); await page.mouse.down();
  for (let k = 1; k <= 12; k++) { await page.mouse.move(f2.x + (cornerTo.x - f2.x) * k / 12, f2.y + (cornerTo.y - f2.y) * k / 12); await wait(30); }
  await page.mouse.up(); await wait(400);
  t = await tabs();
  a1 = t.list.find(r => r.id === A.id);
  check(a1 && near(a1.ex, 150, 0.01) && near(a1.ey, -40, 2) && near(Math.cos(a1.a), 1, 1e-6), `dragged round the corner: on the right side, turned to it (${a1 && [a1.ex.toFixed(2), a1.ey.toFixed(1), Math.cos(a1.a).toFixed(3)]})`);
  // and on toward C: it stops short instead of overlapping
  const onC = await screen(150 + 3, C.ey);
  const f3 = await tabScreen(A.id);
  await page.mouse.move(f3.x, f3.y); await page.mouse.down();
  for (let k = 1; k <= 12; k++) { await page.mouse.move(f3.x + (onC.x - f3.x) * k / 12, f3.y + (onC.y - f3.y) * k / 12); await wait(30); }
  await page.mouse.up(); await wait(400);
  t = await tabs();
  a1 = t.list.find(r => r.id === A.id);
  const gapAC = a1 ? Math.hypot(a1.ex - C.ex, a1.ey - C.ey) : 0;
  check(a1 && gapAC >= (a1.y + C.y) / 2 && offEdge(a1) < 0.01, `pushed at C it stops short: ${gapAC.toFixed(1)} mm apart, at least a tab length (${a1 && a1.y})`);
  // back below the corner to a clear spot for the rest
  const back = await screen(150 + 3, -60);
  const f4 = await tabScreen(A.id);
  await page.mouse.move(f4.x, f4.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(f4.x + (back.x - f4.x) * k / 8, f4.y + (back.y - f4.y) * k / 8); await wait(30); }
  await page.mouse.up(); await wait(400);
  t = await tabs();
  a1 = t.list.find(r => r.id === A.id);
  const Apos = { ex: a1.ex, ey: a1.ey };
  await undo();
  t = await tabs();
  const au = t.list.find(r => r.id === A.id);
  check(au && Math.hypot(au.ex - Apos.ex, au.ey - Apos.ey) > 5, `undo puts the last drag back (${au && [au.ex.toFixed(1), au.ey.toFixed(1)]})`);
  await redo();
  t = await tabs();
  a1 = t.list.find(r => r.id === A.id);
  check(a1 && near(a1.ex, Apos.ex, 0.01) && near(a1.ey, Apos.ey, 0.01), 'redo moves it again');

  // ---- delete B with the Delete key: the tab goes, the part stays --------------------------------
  await click(await tabScreen(B.id));
  p = await picked();
  check(p && p.id === B.id, 'a click on another tab picks that one');
  await page.keyboard.press('Delete');
  await wait(400);
  t = await tabs();
  check(t.parts === 1 && t.list.length === 3 && !t.list.some(r => r.id === B.id), `Delete takes the tab, not the part (${t.parts} part, ${t.list.length} tabs)`);
  check(t.set && t.set.spots && t.set.spots.length === 1 && near(t.set.spots[0].y, 100, 0.01), `and leaves a "no tab here" spot where it was (${JSON.stringify(t.set && t.set.spots)})`);
  check(!(await picked()) && !(await cardOn()), 'nothing is picked after');
  // Backspace with a field focused types, it does not delete
  await click(await tabScreen(D.id));
  await page.click('#swarf-tab-width');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await wait(200);
  t = await tabs();
  check(t.list.length === 3, `Backspace in a field deletes no tab (${t.list.length})`);
  await page.keyboard.press('Escape');
  await wait(100);
  await page.keyboard.press('Escape');
  await wait(100);

  // ---- resize C in its card ---------------------------------------------------------------------
  await click(await tabScreen(C.id));
  p = await picked();
  check(p && p.id === C.id, 'C picked');
  const typeCard = async (key, text) => {
    await page.click(`#swarf-tab-${key}`, { clickCount: 3 });
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await wait(300);
  };
  await typeCard('width', '20');
  t = await tabs();
  let c1 = t.list.find(r => r.id === C.id);
  check(c1 && near(c1.y, 20) && c1.pinned && near(c1.ex, C.ex, 0.01) && near(c1.ey, C.ey, 0.01), `length 20: C is 20 long, in the same place, pinned (${c1 && [c1.y, c1.pinned]})`);
  await typeCard('height', '30');
  t = await tabs();
  c1 = t.list.find(r => r.id === C.id);
  const noteNow = await page.evaluate(() => document.querySelector('#swarf-tabcard .note').textContent);
  check(c1 && near(c1.z, 17.15, 0.02) && /held/.test(noteNow), `height 30 on a 19.05 board is held under it (${c1 && c1.z}, "${noteNow}")`);
  await typeCard('height', '6');
  await typeCard('depth', '9');
  t = await tabs();
  c1 = t.list.find(r => r.id === C.id);
  check(c1 && near(c1.z, 6) && near(c1.x, 9) && near(c1.ex, C.ex, 0.01) && near(c1.ey, C.ey, 0.01), `height 6, reach 9: still meets the edge at the same point (${c1 && [c1.z, c1.x, c1.ex.toFixed(2)]})`);
  await typeCard('width', '400');
  t = await tabs();
  c1 = t.list.find(r => r.id === C.id);
  const note2 = await page.evaluate(() => document.querySelector('#swarf-tabcard .note').textContent);
  check(c1 && near(c1.y, 20) && /runs into/.test(note2), `length 400 would run into the next tab: refused ("${note2}")`);
  // inches: 3/4 typed, 19.05 mm underneath
  await page.evaluate(() => { const s = window.kiri.api.ui.units; s.value = 'in'; s.onchange(); s.dispatchEvent(new Event('change')); });
  await wait(500);
  await typeCard('width', '3/4');
  t = await tabs();
  c1 = t.list.find(r => r.id === C.id);
  const inCard = await page.evaluate(() => ({ v: document.getElementById('swarf-tab-width').value, u: document.querySelector('#swarf-tabcard .mm').textContent }));
  check(c1 && near(c1.y, 19.05, 0.01) && inCard.v === '0.75' && inCard.u === 'in', `in inches: 3/4 makes it 19.05 mm, the card says ${inCard.v} ${inCard.u}`);
  await page.evaluate(() => { const s = window.kiri.api.ui.units; s.value = 'mm'; s.onchange(); s.dispatchEvent(new Event('change')); });
  await wait(500);
  const Cnow = { y: c1.y, z: c1.z, x: c1.x, ex: c1.ex, ey: c1.ey };
  await page.keyboard.press('Escape');
  await wait(200);
  check(!(await picked()), 'esc lets it go');

  // ---- a field change: A and C stay, B does not come back ------------------------------------------
  const keep = async (what) => {
    const t = await tabs();
    const a = t.list.find(r => r.id === A.id), c = t.list.find(r => r.id === C.id);
    const bBack = t.list.some(r => Math.hypot(r.ex - B.ex, r.ey - B.ey) < 20);
    const okA = a && near(a.ex, Apos.ex, 0.01) && near(a.ey, Apos.ey, 0.01);
    const okC = c && near(c.y, Cnow.y) && near(c.z, Cnow.z) && near(c.x, Cnow.x) && near(c.ex, Cnow.ex, 0.01) && near(c.ey, Cnow.ey, 0.01);
    check(okA && okC && !bBack, `${what}: the moved and resized tabs stay, the deleted one stays gone (${t.list.length} tabs: A ${!!okA}, C ${!!okC}, B back ${bBack})`);
    return t;
  };
  await page.evaluate(() => { const el = document.getElementById('swarf-autotabs-height'); el.focus(); el.value = '5'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(400);
  t = await keep('height 5 in the panel');
  check(t.list.length === 3 && t.list.filter(r => !r.pinned).every(r => near(r.z, 5)), `the auto one (D) follows the field: 5 tall (${t.list.filter(r => !r.pinned).map(r => r.z)})`);
  await page.evaluate(() => { const el = document.getElementById('swarf-autotabs-count'); el.focus(); el.value = '8'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(400);
  t = await keep('how many 8');
  check(t.list.length === 7, `8 slots: the spot keeps one empty, so 7 tabs (${t.list.length})`);
  await undo();
  t = await tabs();
  check(t.list.length === 3 && t.set.pin.count === undefined, `undo: back to 3 tabs and no pinned count (${t.list.length}, ${t.set.pin.count})`);
  const fieldBack = await page.evaluate(() => document.getElementById('swarf-autotabs-count').value);
  check(fieldBack === '', `and the field shows it (count "${fieldBack}")`);

  // ---- the concerns count every tab there is ------------------------------------------------------
  const au1 = await page.evaluate(() => window.__swarfAutoTabs.audit(window.kiri.api.widgets.all()[0]));
  check(au1.outerTabs === 3, `the loose-part check counts 3 tabs on the outside (${au1.outerTabs})`);

  // ---- reload ----------------------------------------------------------------------------------------
  await page.evaluate(() => { const a = window.kiri.api; a.space.auto_save && a.space.auto_save(); });
  await wait(5000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 90000 }).catch(() => {});
  await wait(1500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await wait(500);
  t = await keep('after a reload');
  check(t.list.length === 3 && t.boxes === 3 && t.set.spots.length === 1 && t.list.filter(r => r.pinned).length === 2, `after a reload: 3 tabs drawn, 2 pinned, 1 spot (${t.list.length}, ${t.boxes}, ${t.set.spots.length})`);
  await page.evaluate(() => { const el = document.getElementById('swarf-autotabs-height'); el.focus(); el.value = '4'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(400);
  await keep('a field change after the reload');
  await page.evaluate(() => window.moto.space.view.top());
  await wait(1200);

  // ---- turn, slice, scale, mirror, duplicate ---------------------------------------------------------
  const spotFree = (t, sp) => !t.list.some(r => Math.hypot(r.ex - sp.x, r.ey - sp.y) < 20);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); a.selection.rotate(0, 0, Math.PI / 2); });
  await wait(400);
  await page.evaluate(() => { const a = window.kiri.api, v = a.view.get(); a.event.emit('slice.begin', 'CAM'); a.event.emit('view.set', v); });
  await wait(400);
  t = await tabs();
  let sp = t.set.spots[0];
  check(near(Math.abs(sp.x), 100, 0.5) && near(sp.y, 0, 0.5) && spotFree(t, sp) && t.list.length === 3 && t.list.filter(r => r.pinned).length === 2 && t.list.every(r => offEdge(r, 100, 150) < 0.05),
    `turned 90 degrees and sliced: the spot turned with it (${JSON.stringify(sp)}), still empty, 3 tabs on the edge, 2 pinned (${t.list.length})`);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); a.selection.scale(1.5, 1, 1); });
  await wait(800);
  t = await tabs();
  sp = t.set.spots[0];
  check(t.list.filter(r => r.pinned).length === 2 && spotFree(t, sp) && t.list.every(r => offEdge(r, t.box.w / 2, t.box.h / 2) < 0.05) && near(Math.abs(sp.x), 150, 0.5),
    `scaled 1.5 wide: the 2 pinned tabs stay (on the new edge), the spot scaled to ${JSON.stringify(sp)} and stays empty (${t.list.length} tabs)`);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); a.selection.mirror(); });
  await wait(400);
  await page.evaluate(() => { const a = window.kiri.api, v = a.view.get(); a.event.emit('slice.begin', 'CAM'); a.event.emit('view.set', v); });
  await wait(400);
  const tm = await tabs();
  const spm = tm.set.spots[0];
  check(near(spm.x, -sp.x, 0.01) && spotFree(tm, spm) && tm.list.filter(r => r.pinned).length === 2 && tm.list.every(r => offEdge(r, tm.box.w / 2, tm.box.h / 2) < 0.05) && tm.boxes === tm.list.length,
    `mirrored: the spot mirrors (${JSON.stringify(spm)}), stays empty, the tabs stay on the edge and drawn (${tm.list.length}, ${tm.boxes})`);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); a.selection.duplicate(); });
  await wait(600);
  const t2 = await tabs(1);
  check(t2.parts === 2 && t2.list.length === tm.list.length && t2.list.filter(r => r.pinned).length === 2 && t2.set.spots.length === 1 && t2.boxes === t2.list.length,
    `a duplicate keeps its tabs, pins and spot (${t2.list.length} tabs, ${t2.boxes} drawn)`);
  await page.evaluate(() => { const a = window.kiri.api; const ps = a.widgets.all().filter(w => !w.track.synth); a.platform.delete(ps[1]); a.platform.select(ps[0]); });
  await wait(400);

  // ---- back to automatic --------------------------------------------------------------------------
  await page.evaluate(() => window.moto.space.view.top());
  await wait(1200);
  t = await tabs();
  const pin1 = t.list.find(r => r.pinned);
  await click(await tabScreen(pin1.id));
  const autoBtn = await page.evaluate(() => getComputedStyle(document.getElementById('swarf-tab-auto')).display);
  check(autoBtn !== 'none', 'a pinned auto tab offers back to automatic');
  await page.evaluate(() => document.getElementById('swarf-tab-auto').click());
  await wait(400);
  t = await tabs();
  check(!t.list.some(r => r.id === pin1.id) && t.list.filter(r => r.pinned).length === 1 && t.list.length === tm.list.length, `back to automatic: it is planned again with the others (${t.list.length} tabs, ${t.list.filter(r => r.pinned).length} pinned)`);

  // ---- tabs › + still works, and removing an auto tab there leaves a spot too ------------------------
  const plain = t.list.find(r => !r.pinned);
  await page.evaluate(() => window.kiri.api.event.emit('cam.tabs.add'));
  await wait(200);
  const ps = await tabScreen(plain.id);
  await page.mouse.move(ps.x - 3, ps.y - 3); await wait(100);
  await page.mouse.move(ps.x, ps.y); await wait(150);
  await page.mouse.down(); await page.mouse.up(); await wait(300);
  await page.evaluate(() => window.kiri.api.event.emit('cam.tabs.done'));
  t = await tabs();
  check(!t.list.some(r => r.id === plain.id) && t.set.spots.length === 2 && !(await picked()), `tabs › + removes a tab with a click, as before, and the place stays empty (${t.set.spots.length} spots)`);
  await undo();
  t = await tabs();
  check(t.list.some(r => r.id === plain.id) && t.set.spots.length === 1, 'undo brings that one back');

  // ---- the trash clears pins and spots; undo brings them back -----------------------------------------
  const beforeTrash = await tabs();
  await page.evaluate(() => window.kiri.api.event.emit('cam.tabs.clear'));
  await wait(300);
  t = await tabs();
  check(t.list.length === 0 && !t.set, `trash: no tabs, no settings, no spots (${t.list.length}, ${!!t.set})`);
  await undo();
  t = await tabs();
  check(t.list.length === beforeTrash.list.length && t.set && t.set.spots.length === 1 && t.boxes === t.list.length, `undo after the trash: every tab, pin and spot back (${t.list.length})`);
  await redo();
  await page.evaluate(() => document.getElementById('swarf-autotabs-go').click());
  await wait(400);
  t = await tabs();
  const fresh = await page.evaluate(() => window.__swarfAutoTabs.plan()[0].records.length);
  check(t.list.length === fresh && t.list.length >= 4 && !t.list.some(r => r.pinned) && !(t.set.spots || []).length, `after the trash, auto tabs start over: the plain plan, none pinned, no spots (${t.list.length})`);

  // ---- the picked tab lights up in every skin -----------------------------------------------------------
  await page.evaluate(() => window.moto.space.view.top());
  await wait(1200);
  const q = t.list[0];
  for (const skin of ['glass', 'classic', 'swarf']) {
    await page.evaluate(s => window.SwarfSkin.set(s), skin);
    await wait(500);
    await click(await tabScreen(q.id));
    const c = await page.evaluate(id => {
      const a = window.kiri.api, w = a.widgets.all()[0];
      const other = Object.values(w.tabs).find(l => l.box.tab.id !== id).box.material.color;
      return { picked: w.tabs[id].box.material.color.getHex(), other: other.getHex(), want: window.__swarfTabEdit.color() };
    }, q.id);
    const diff = (a, b) => Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
    check(c.picked === c.want && diff(c.picked, c.other) > 150, `${skin}: the picked tab is ${c.picked.toString(16)}, the others ${c.other.toString(16)}`);
    await page.keyboard.press('Escape');
    await wait(150);
  }
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `tab edit: ${bad.length} failed, ${errors.length} page errors` : 'tab edit: ok');
process.exit(bad.length || errors.length ? 1 : 0);
