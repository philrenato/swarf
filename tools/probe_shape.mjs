// SHAPE -> toolpaths -> CONTROL on the ShopBot profile: a 100 mm circle 6 mm
// thick made with the shape tool is a 100 x 100 x 6 part, takes an outline
// step, and arrives in control as real moves. Bad numbers keep "make" shut
// with a reason. Simulator back end.
//   node tools/probe_shape.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-shape';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.platform?.load_svg && window.__swarfShape), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  const dialog = () => page.evaluate(() => {
    const why = document.getElementById('shape-why');
    const make = [...document.querySelectorAll('button')].find(b => /^make$/i.test(b.textContent.trim()) && b.offsetParent);
    return { open: !!why, why: why ? why.textContent : '', make: make ? !make.disabled : null };
  });
  const setv = (id, v) => page.evaluate((id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, id, v);
  await page.click('#swarf-step-shape');
  await wait(500);
  let d = await dialog();
  check(d.open && d.make, `SHAPE opens the dialog, make on (${JSON.stringify(d)})`);
  // bad numbers: a ring whose hole is bigger than it, a corner too round, bigger than the bed
  await setv('shape-kind', 'ring'); await setv('shape-d', '50'); await setv('shape-di', '60'); await wait(100);
  d = await dialog(); check(!d.make && /hole must be smaller/.test(d.why), `ring hole too big: "${d.why}"`);
  await setv('shape-kind', 'rounded'); await setv('shape-w', '40'); await setv('shape-h', '30'); await setv('shape-r', '20'); await wait(100);
  d = await dialog(); check(!d.make && /at most 15 mm/.test(d.why), `corner too round: "${d.why}"`);
  await setv('shape-kind', 'rect'); await setv('shape-w', '3000'); await setv('shape-h', '100'); await wait(100);
  d = await dialog(); check(!d.make && /bigger than the bed/.test(d.why), `bigger than the bed: "${d.why}"`);
  // a star and an ellipse are offered and fine at their defaults
  await setv('shape-kind', 'star'); await wait(100);
  d = await dialog(); check(d.make && !d.why, 'a star is fine');
  await setv('shape-kind', 'ellipse'); await setv('shape-w', '150'); await wait(100);
  d = await dialog(); check(d.make && !d.why, 'an ellipse is fine');
  // the real one
  await setv('shape-kind', 'circle'); await setv('shape-d', '100'); await setv('shape-t', '6'); await wait(100);
  d = await dialog(); check(d.make && !d.why, 'a 100 mm circle is fine');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /^make$/i.test(b.textContent.trim()) && b.offsetParent).click());
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
  await wait(800);
  const size = await page.evaluate(() => {
    const w = window.kiri.api.widgets.all()[0];
    const b = new window.THREE.Box3().setFromObject(w.mesh);
    return { name: w.meta.file, x: +(b.max.x - b.min.x).toFixed(2), y: +(b.max.y - b.min.y).toFixed(2), z: +(b.max.z - b.min.z).toFixed(2) };
  });
  // three.js stands the part's Z up as Y here; the sizes in any order are 100, 100, 6
  const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
  check(Math.abs(dims[0] - 6) < 0.05 && Math.abs(dims[1] - 100) < 0.6 && Math.abs(dims[2] - 100) < 0.6, `the part is ${size.x} x ${size.y} x ${size.z} mm ("${size.name}")`);
  // the size card: selected part's size in mm; width 200 with keep proportions -> 200 x 200, still 6 thick
  await page.evaluate(() => window.kiri.api.platform.select(window.kiri.api.widgets.all()[0]));
  await wait(500);
  const card = () => page.evaluate(() => { const c = document.getElementById('swarf-size'); return { on: c && c.classList.contains('on'), v: c ? [...c.querySelectorAll('.ax input')].map(i => i.value) : [] }; });
  let sc = await card();
  check(sc.on && sc.v.join() === '100,100,6', `size card on selection: ${JSON.stringify(sc)}`);
  await page.evaluate(() => { const i = document.querySelectorAll('#swarf-size .ax input')[0]; i.focus(); i.value = '200'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(800);
  sc = await card();
  const big = await page.evaluate(() => { const w = window.kiri.api.widgets.all()[0], b = new window.THREE.Box3().setFromObject(w.mesh); return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(1)).sort((a, b) => a - b); });
  check(sc.v.join() === '200,200,6' && Math.abs(big[0] - 6) < 0.05 && Math.abs(big[2] - 200) < 1, `width 200 keeps proportions, thickness stays: card ${sc.v} part ${big.join(' x ')}`);
  // save drawing as DXF while it is 200 mm: read back, it is a 200 mm circle
  await page.evaluate(() => { window.__saved = null; const o = URL.createObjectURL; URL.createObjectURL = b => { b.text().then(t => { window.__saved = t; }); return o(b); }; });
  await page.evaluate(() => window.__swarfShape.saveDrawing());
  // the dialog shows 150 ms after its buttons exist (cam's confirm): click once it is open
  await page.waitForFunction(() => document.getElementById('dialog').open && [...document.querySelectorAll('#dialog button')].some(b => b.textContent.trim() === 'dxf'), { timeout: 5000 });
  await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => b.textContent.trim() === 'dxf').click());
  await page.waitForFunction(() => window.__saved, { timeout: 5000 }).catch(() => {});
  const dxf = await page.evaluate(() => window.__saved);
  const { parseDXF } = await import(new URL('../web/kiri/vendor/unreason/exchange-2d-read.mjs', import.meta.url));
  const { buildShapes } = await import(new URL('../web/kiri/vendor/unreason/exchange-2d.mjs', import.meta.url));
  const back = dxf ? buildShapes(parseDXF(dxf).curves).box : null;
  const dw = back ? +(back[2] - back[0]).toFixed(2) : 0, dh = back ? +(back[3] - back[1]).toFixed(2) : 0;
  check(dxf && /\$INSUNITS/.test(dxf) && Math.abs(dw - 200) < 0.05 && Math.abs(dh - 200) < 0.05, `saved DXF reads back ${dw} x ${dh} mm`);
  await page.evaluate(() => { const i = document.querySelectorAll('#swarf-size .ax input')[0]; i.focus(); i.value = '100'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(800);
  sc = await card();
  check(sc.v.join() === '100,100,6', `back to 100: ${sc.v}`);
  await page.evaluate(() => window.kiri.api.platform.deselect());
  await wait(300);
  check(!(await card()).on, 'card hides with nothing selected');
  // a star is a real part too (5 points, 80 mm across, 4 mm thick)
  await page.click('#swarf-step-shape');
  const opened = await page.waitForFunction(() => document.getElementById('shape-kind') && document.getElementById('dialog').open, { timeout: 5000 }).then(() => true, () => false);
  check(opened, 'SHAPE opens again after a save');
  await setv('shape-kind', 'star'); await setv('shape-d', '80'); await setv('shape-p', '5'); await setv('shape-i', '44'); await setv('shape-t', '4'); await wait(100);
  await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim())).click());
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 2, { timeout: 10000 }).then(() => check(true, 'a star becomes a second part'), () => check(false, 'a star becomes a second part'));
  const star = await page.evaluate(() => { const w = window.kiri.api.widgets.all()[1], b = new window.THREE.Box3().setFromObject(w.mesh); return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(1)).sort((a, b) => a - b); });
  check(Math.abs(star[0] - 4) < 0.05 && star[2] <= 80.1 && star[2] > 75, `star size ${star.join(' x ')} mm`);
  await page.evaluate(() => { const ws = window.kiri.api.widgets.all(); window.kiri.api.platform.delete(ws[1]); });
  await wait(400);
  // outline step, toolpaths, control
  await page.evaluate(() => {
    const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => {
    window.kiri.api.event.on('preview.end', () => res('preview.end'));
    window.kiri.api.event.on('preview.error', e => res('preview.error ' + e));
    setTimeout(() => res('timeout'), 60000);
  }));
  check(pv === 'preview.end', `toolpaths: ${pv}`);
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog, { timeout: 60000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const p = window.__swarfRun.state.prog;
    if (!p) return null;
    const b = window.SwarfRunParse.cutBounds(p.parsed);
    return { name: p.name, source: p.source, units: p.parsed.units, moves: p.parsed.moves.length, w: b && +(b.max.x - b.min.x).toFixed(1), h: b && +(b.max.y - b.min.y).toFixed(1), deep: b && +(-b.min.z).toFixed(2), say: document.querySelector('.sr-say').textContent };
  });
  // an outline cuts outside the part: the path is the circle plus the bit
  check(r && r.source === 'cam' && r.units === 'mm' && r.moves > 20 && r.w > 100 && r.w < 115 && r.deep >= 5.9, `in control: ${JSON.stringify(r)}`);
  await page.screenshot({ path: `${OUT}-control.png` });
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `shape: ${bad.length} failed, ${errors.length} page errors` : 'shape: ok');
process.exit(bad.length || errors.length ? 1 : 0);
