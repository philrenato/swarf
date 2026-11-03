// The right-click menu (Phil 11-02: "consider what might be appropriate for right click features
// ala Unreason. Maybe people could get to rotate etc that way?"). With a real mouse: a right-click
// on a part lists its rows and picks it; turn right 90° swaps its width and length; turn it over
// keeps it on the bed; stand it on its side, then lay it flat; leave it out unticks it in objects;
// a press on a row runs it; Escape and a click away close the menu; a right-DRAG pans and opens
// nothing; the empty bed has its own rows. A touch long press opens it too.
//   node tools/probe_menu.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-menu';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfMenu), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="80mm" viewBox="0 0 200 80"><rect width="200" height="80" fill="#000"/></svg>', 'plank', { depth: 19, resolution: 2, soup: true, dpi: 0 }); a.platform.deselect && a.platform.deselect(); });
  await wait(1200);
  await page.evaluate(() => window.moto.space.view.top());
  await wait(1200);
  // the part's middle on screen
  const at = await page.evaluate(() => {
    const THREE = window.THREE, w = window.kiri.api.widgets.all()[0], { camera, renderer } = window.moto.space.internals();
    const b = new THREE.Box3().setFromObject(w.mesh), c = b.getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height, bedX: r.left + r.width * 0.15, bedY: r.top + r.height * 0.8 };
  });
  const size = () => page.evaluate(() => { const w = window.kiri.api.widgets.all()[0]; const b = w.getBoundingBox ? w.getBoundingBox() : w.mesh.geometry.boundingBox; return { x: +(b.max.x - b.min.x).toFixed(1), y: +(b.max.y - b.min.y).toFixed(1), z: +(b.max.z - b.min.z).toFixed(1), tilted: !!w.meta.tilted, disabled: !!w.meta.disabled, minz: +(w.track.pos.z - (b.max.z - b.min.z) / 2).toFixed(1) }; });
  const rightClick = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await wait(300); };
  const rows = () => page.evaluate(() => window.__swarfMenu.rows());
  // a row pressed the way a mouse does: down, up, click
  const press = async label => {
    const r = await page.evaluate(l => { const b = [...document.querySelectorAll('.swarf-ctx button')].find(b => b.textContent === l); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, label);
    if (!r) return false;
    await page.mouse.click(r.x, r.y); await wait(500); return true;
  };

  const s0 = await size();
  await rightClick(at.x, at.y);
  const r1 = await rows();
  console.log('   part rows:', r1.join(' · '));
  check(['turn left 90°', 'turn right 90°', 'turn it over', 'stand it on its side', 'mirror', 'duplicate', 'leave it out of this run', 'delete'].every(l => r1.includes(l)), 'a right-click on the part lists its rows');
  check(await page.evaluate(() => window.kiri.api.selection.widgets().length === 1), 'and picks it');
  check(await page.evaluate(() => document.activeElement && document.activeElement.closest('.swarf-ctx') !== null), 'the first row has the keyboard');
  await page.screenshot({ path: `${OUT}-part.png` });
  check(await press('turn right 90°'), 'a press on a row runs it');
  const s1 = await size();
  check(!(await page.evaluate(() => window.__swarfMenu.isOpen())), 'and the menu closes');
  check(Math.abs(s1.x - s0.y) < 0.5 && Math.abs(s1.y - s0.x) < 0.5, `turn right 90° swaps width and length (${s0.x}×${s0.y} → ${s1.x}×${s1.y})`);

  const at2 = await page.evaluate(() => { const THREE = window.THREE, w = window.kiri.api.widgets.all()[0], { camera, renderer } = window.moto.space.internals(); const b = new THREE.Box3().setFromObject(w.mesh), c = b.getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height }; });
  await rightClick(at2.x, at2.y); await press('turn it over');
  const s2 = await size();
  check(Math.abs(s2.z - s0.z) < 0.5 && Math.abs(s2.minz - s0.minz) < 0.5, `turned over it is as thick and still on the bed (${s2.z} mm, bottom at ${s2.minz} as before ${s0.minz})`);
  await rightClick(at2.x, at2.y); await press('stand it on its side');
  const s3 = await size();
  check(s3.tilted && Math.abs(s3.z - Math.min(s0.x, s0.y)) < 0.5, `stood on its long edge: tilted, as tall as it was wide (${s3.z} mm high)`);
  const at3 = await page.evaluate(() => { const THREE = window.THREE, w = window.kiri.api.widgets.all()[0], { camera, renderer } = window.moto.space.internals(); const b = new THREE.Box3().setFromObject(w.mesh), c = b.getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height }; });
  await rightClick(at3.x, at3.y);
  check((await rows()).includes('lay it flat'), 'a part on its side offers lay it flat');
  await press('lay it flat');
  const s4 = await size();
  check(!s4.tilted && Math.abs(s4.z - s0.z) < 0.5, `lay it flat: flat again, ${s4.z} mm thick`);
  await rightClick(at3.x, at3.y); await press('leave it out of this run');
  const s5 = await size();
  const tick = await page.evaluate(() => { const b = document.querySelector('#ws-widgets input[type=checkbox], .swarf-obj-cut, #objects input[type=checkbox]'); return b ? b.checked : null; });
  check(s5.disabled, `leave it out: the part is left out (objects tick ${tick})`);
  await rightClick(at3.x, at3.y);
  check((await rows()).includes('cut it in this run'), 'then the row says cut it in this run');
  await page.keyboard.press('Escape'); await wait(200);
  check(!(await page.evaluate(() => window.__swarfMenu.isOpen())), 'Escape closes it');
  await rightClick(at3.x, at3.y); await press('cut it in this run');
  check(!(await size()).disabled, 'cut it in this run ticks it again');

  // a right-drag pans and opens nothing
  const cam0 = await page.evaluate(() => window.moto.space.internals().camera.position.toArray().map(v => +v.toFixed(2)).join(','));
  await page.mouse.move(at.bedX, at.bedY); await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(at.bedX + i * 12, at.bedY - i * 6);
  await page.mouse.up({ button: 'right' }); await wait(400);
  const cam1 = await page.evaluate(() => window.moto.space.internals().camera.position.toArray().map(v => +v.toFixed(2)).join(','));
  check(!(await page.evaluate(() => window.__swarfMenu.isOpen())), 'a right-drag opens no menu');
  check(cam0 !== cam1, 'and the view moved');

  // the empty bed
  await page.evaluate(() => window.moto.space.view.top()); await wait(1000);
  await rightClick(at.bedX, at.bedY - 40);
  const r2 = await rows();
  console.log('   bed rows:', r2.join(' · '));
  check(['make a shape', 'draw a part', 'open a file', 'select all', 'look from above'].every(l => r2.includes(l)) && !r2.includes('delete'), 'the empty bed has its own rows');
  await page.screenshot({ path: `${OUT}-bed.png` });
  await page.mouse.click(at.bedX + 300, at.bedY - 300); await wait(300);
  check(!(await page.evaluate(() => window.__swarfMenu.isOpen())), 'a click away closes it');
  await press('select all');

  // a touch long press on the part
  const cdp = await page.target().createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at3.x, y: at3.y }] });
  await wait(800);
  const longOpen = await page.evaluate(() => window.__swarfMenu.isOpen());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(300);
  check(longOpen, 'a long press on a touch screen opens it');
  check(await page.evaluate(() => window.__swarfMenu.isOpen()), 'and it stays open as the finger lifts');
  await page.keyboard.press('Escape');
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `menu: ${bad.length} failed, ${errors.length} page errors` : 'menu: ok');
process.exit(bad.length || errors.length ? 1 : 0);
