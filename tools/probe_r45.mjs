// r45, fixes from the second 10-28 review (REVIEW_FABLE_2026-10-28b):
//  - a mouse click on a letter picks the whole word; OBJECTS lists the word as one row
//  - a click on the bare bed lets go
//  - duplicate leaves the original where it was; the copy is 12 mm to its right
//  - the sentence follows each act: resize, duplicate, delete; toolpaths clears it
//  - SHAPE says width × depth; its preview shows the edge band
//  - CONTROL: at the zero step the buttons say "zero X Y first"; the wheel cannot zoom past 6 m;
//    the "use the last zero" offer is not shown while zeroing
//   node tools/probe_r45.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
// a widget's middle on screen (top face)
const onScreen = (page, i) => page.evaluate(i => {
  const T = window.THREE, w = window.kiri.api.widgets.all()[i], c = window.moto.space.internals().camera, cv = document.querySelector('canvas');
  const b = new T.Box3().expandByObject(w.mesh), v = new T.Vector3((b.min.x + b.max.x) / 2, b.max.y - 0.2, (b.min.z + b.max.z) / 2).project(c), r = cv.getBoundingClientRect();
  return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
}, i);
const alertText = page => page.evaluate(() => { const d = window.kiri.api.ui.alert; return d && d.dialog.style.display !== 'none' ? d.text.textContent : ''; });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfStart && window.__swarfDraw && window.kiri.api.frame), { timeout: 90000, polling: 200 });
  await wait(2000);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  check(/ShopBot Basic · bed 2438 × 1219 mm/.test(await page.evaluate(() => document.querySelector('#swarf-start .bed').textContent)), 'the start card names the machine and its bed');

  // SHAPE: depth, and the edge in the preview
  await page.click('#swarf-step-shape');
  await page.waitForFunction(() => document.getElementById('shape-edge') && document.getElementById('dialog').open, { timeout: 5000 });
  const setv = (id, v) => page.evaluate((id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, id, v);
  await setv('shape-kind', 'rect'); await setv('shape-w', '100'); await setv('shape-h', '60'); await setv('shape-t', '12'); await setv('shape-edge', 'chamfer'); await setv('shape-es', '3'); await wait(150);
  const dlg = await page.evaluate(() => ({ h: document.querySelector('.swarf-shape tr[data-f="h"] th').textContent, band: !!document.querySelector('#shape-prev .band') }));
  check(dlg.h === 'depth' && dlg.band, `SHAPE says depth and shows the edge band (${dlg.h}, band ${dlg.band})`);
  await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim())).click());
  await wait(1500);
  await page.evaluate(() => window.kiri.api.frame());
  await wait(600);

  // resize: the sentence says so
  await page.evaluate(() => { const i = document.querySelector('#swarf-size .ax input'); i.value = '150'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
  await wait(600);
  let said = await alertText(page);
  check(/^Resized to 150 × 90 × 12 mm\./.test(said), `the sentence after a resize: "${said}"`);
  // duplicate: the original stays put
  const pos0 = await page.evaluate(() => { const p = window.kiri.api.widgets.all()[0].track.pos; return [p.x, p.y]; });
  await page.evaluate(() => [...document.querySelectorAll('#swarf-size .act')].find(b => b.textContent === 'duplicate').click());
  await wait(1000);
  const dup = await page.evaluate(() => window.kiri.api.widgets.all().map(w => { const p = w.track.pos; return [+p.x.toFixed(2), +p.y.toFixed(2)]; }));
  said = await alertText(page);
  check(dup.length === 2 && dup[0][0] === +pos0[0].toFixed(2) && dup[0][1] === +pos0[1].toFixed(2) && Math.abs(dup[1][0] - dup[0][0] - 162) < 0.01 && dup[1][1] === dup[0][1], `duplicate: the original stays at ${dup[0]}, the copy 12 mm to its right at ${dup[1]}`);
  check(/^Made a copy, .+-2, beside it\./.test(said), `the sentence after a duplicate: "${said}"`);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-size .act')].find(b => b.textContent === 'delete').click());
  await wait(500);
  said = await alertText(page);
  check(/^Deleted .+-2\. 1 part left\./.test(said), `the sentence after a delete: "${said}"`);
  // a click on the bare bed lets go
  await page.evaluate(() => window.kiri.api.platform.select(window.kiri.api.widgets.all()[0]));
  await wait(200);
  await page.mouse.click(720, 760); await wait(300);
  check(await page.evaluate(() => window.kiri.api.selection.count()) === 0, 'a click on the bare bed lets go of the part');

  // a word: one row in OBJECTS, a click on a letter picks the word
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(400);
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 3; S.ox = r.width / 2 - 100; S.oy = r.height / 2; });
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__swarfDraw.text.font, { timeout: 15000 });
  await page.evaluate(() => { const i = document.getElementById('sd-str'); i.value = 'HIM'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const [cx, cy] = await px(page, -100, 0);
  await page.mouse.move(cx + 20, cy + 20); await page.mouse.move(cx, cy); await page.mouse.click(cx, cy);
  await wait(300);
  // a rectangle drawn over the word is marked and named
  await page.keyboard.press('r');
  const [r0x, r0y] = await px(page, -110, -10), [r1x, r1y] = await px(page, -60, 20);
  await page.mouse.move(r0x, r0y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(r0x + (r1x - r0x) * i / 8, r0y + (r1y - r0y) * i / 8); await wait(10); }
  await page.mouse.up(); await wait(150);
  const ov = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return { over: p.over, say: document.getElementById('sd-say').textContent, amber: !!document.querySelector('#swarf-draw .sd-part.on.cross') }; });
  check(ov.over === 'HIM' && ov.amber && /overlaps HIM: move it/.test(ov.say), `a rectangle over the word is marked: "${ov.say}"`);
  await page.keyboard.press('Delete'); await wait(150);
  await page.click('#sd-done');
  await wait(2000);
  const n = await page.evaluate(() => window.kiri.api.widgets.all().length);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#ws-widgets button.name')].map(b => b.textContent));
  check(n === 3 && rows.length === 1 && rows[0] === "HIM (3 pieces)", `a word is one row in OBJECTS: ${JSON.stringify(rows)} (${n} letters)`);
  await page.evaluate(() => { window.kiri.api.platform.deselect(); window.kiri.api.frame(); });
  await wait(700);
  const [lx, ly] = await onScreen(page, 1);
  if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT }); console.log('click at', lx, ly, await page.evaluate((x, y) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 120), lx, ly)); }
  await page.mouse.click(lx, ly); await wait(300);
  const picked = await page.evaluate(() => window.kiri.api.selection.count());
  check(picked === 3, `a click on a letter picks the whole word (${picked} of 3)`);

  // an import that would land on the word moves beside it
  await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000"/></svg>', 'disc', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }));
  await wait(1200);
  const placed = await page.evaluate(() => {
    const bx = w => { const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox, p = w.track.pos; return [b.min.x + p.x, b.min.y + p.y, b.max.x + p.x, b.max.y + p.y]; };
    const ws = window.kiri.api.widgets.all(), disc = ws.find(w => /disc/.test(w.meta.file)), word = ws.filter(w => w !== disc).map(bx);
    const right = Math.max(...word.map(b => b[2])), d = bx(disc);
    const d0 = window.kiri.api.ui.alert.text.textContent;
    return { gap: +(d[0] - right).toFixed(2), clear: word.every(b => b[2] <= d[0] || b[0] >= d[2] || b[3] <= d[1] || b[1] >= d[3]), say: d0 };
  });
  check(placed.clear && Math.abs(placed.gap - 12) < 0.05 && /sits beside them, 12 mm clear/.test(placed.say), `an import that would land on the word sits beside it, ${placed.gap} mm clear: "${placed.say}"`);
  // toolpaths clears the sentence
  await page.evaluate(() => window.kiri.api.show.alert('stale words', 30));
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(300);
  await page.evaluate(() => document.getElementById('act-paths').click());
  await wait(300);
  said = await alertText(page);
  check(!/stale words/.test(said), `toolpaths clears the old sentence ("${said}")`);
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 60000); }));
  check(await page.evaluate(() => document.getElementById('act-paths').classList.contains('selected')), 'TOOLPATHS lights as the current step while its paths show');

  // CONTROL
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog && document.querySelector('.sr-play'), { timeout: 60000 });
  await wait(800);
  const why = await page.evaluate(() => document.querySelector('#swarf-run button.trace').title);
  check(why === 'trace: zero X Y first', `at the zero step trace says "${why}"`);
  const r = await page.evaluate(() => { const c = document.querySelector('#swarf-run canvas'); for (let i = 0; i < 40; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); return window.__swarfRun.view().sph.r; });
  check(r <= 6000, `the wheel stops at 6 m (r ${Math.round(r)})`);
  check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} catch (e) {
  check(false, `threw: ${e.message}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `r45: ${bad.length} FAILED` : 'r45: ok');
process.exit(bad.length ? 1 : 0);
