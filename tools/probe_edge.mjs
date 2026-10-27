// Shaped top edges: SHAPE makes a 100 x 60 rectangle 12 mm thick with a 3 mm
// chamfer, and a ring (100 / 50 mm, 10 thick) with a 4 mm round. Each mesh is
// closed (every edge shared by two faces), its volume is the solid's, its top
// face is inset by the edge size and its walls are straight below the edge.
// An edge too big for a curve, or taller than the part, keeps "make" shut with
// a reason. DRAW turns the rectangle's chamfer into a 2 mm round. Then a
// contour step shapes the edge in toolpaths and control.
//   node tools/probe_edge.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-edge';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// in the page: a part's mesh — closed?, volume, the xy box of its top, and of its vertices at a height
const MESH = name => {
  const w = window.kiri.api.widgets.all().find(w => w.meta.file.includes(name));
  if (!w) return null;
  const g = w.mesh.geometry.attributes.position.array;
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < g.length; i += 3) { zmin = Math.min(zmin, g[i]); zmax = Math.max(zmax, g[i]); }
  const key = i => `${g[i].toFixed(4)},${g[i + 1].toFixed(4)},${g[i + 2].toFixed(4)}`;
  const edges = new Map();
  let vol = 0;
  for (let i = 0; i < g.length; i += 9) {
    const k = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3], id = a < b ? a + '|' + b : b + '|' + a; edges.set(id, (edges.get(id) || 0) + 1); }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = g.slice(i, i + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  const open = [...edges.values()].filter(n => n !== 2).length;
  const boxAt = z => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (let i = 0; i < g.length; i += 3) if (Math.abs(g[i + 2] - z) < 1e-4) { b[0] = Math.min(b[0], g[i]); b[1] = Math.min(b[1], g[i + 1]); b[2] = Math.max(b[2], g[i]); b[3] = Math.max(b[3], g[i + 1]); } return [+(b[2] - b[0]).toFixed(2), +(b[3] - b[1]).toFixed(2)]; };
  return { t: +(zmax - zmin).toFixed(3), open, vol: +vol.toFixed(1), top: boxAt(zmax), foot: boxAt(zmin), edge: w.meta.edge };
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.edge_problem && window.__swarfShape && window.__swarfDraw), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(300);
  const setv = (id, v) => page.evaluate((id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, id, v);
  const dialog = () => page.evaluate(() => { const why = document.getElementById('shape-why'); const make = [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim())); return { why: why ? why.textContent : '', make: make ? !make.disabled : null }; });
  const make = async () => { await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim())).click()); await wait(800); };
  const openShape = async () => { await page.click('#swarf-step-shape'); await page.waitForFunction(() => document.getElementById('shape-edge') && document.getElementById('dialog').open, { timeout: 5000 }); };

  // refusals first
  await openShape();
  await setv('shape-kind', 'circle'); await setv('shape-d', '10'); await setv('shape-t', '6'); await setv('shape-edge', 'round'); await setv('shape-es', '6'); await wait(150);
  let d = await dialog();
  check(!d.make && /too big for this shape/.test(d.why), `a 6 mm round on a 10 mm circle: "${d.why}"`);
  await setv('shape-es', '8'); await wait(150);
  d = await dialog();
  check(!d.make && /at most the thickness/.test(d.why), `an 8 mm edge on a 6 mm part: "${d.why}"`);
  // the rectangle with a chamfer
  await setv('shape-kind', 'rect'); await setv('shape-w', '100'); await setv('shape-h', '60'); await setv('shape-t', '12'); await setv('shape-edge', 'chamfer'); await setv('shape-es', '3'); await wait(150);
  d = await dialog();
  check(d.make && !d.why, `a 3 mm chamfer on 100 x 60 x 12 is fine ("${d.why}")`);
  await make();
  let m = await page.evaluate(MESH, 'rectangle');
  // prismatoid: straight to 9 mm, then 100x60 → 94x54 over 3 mm (middle 97x57)
  const vChamfer = 9 * 6000 + 3 * (6000 + 94 * 54 + 4 * 97 * 57) / 6;
  check(m && m.open === 0 && m.t === 12 && Math.abs(m.vol - vChamfer) / vChamfer < 1e-4 && m.top.join() === '94,54' && m.foot.join() === '100,60' && m.edge.kind === 'chamfer',
    `chamfered rectangle: closed, ${m && m.vol} mm³ (want ${vChamfer.toFixed(1)}), top ${m && m.top}, foot ${m && m.foot}`);

  // the ring with a round
  await openShape();
  await setv('shape-kind', 'ring'); await setv('shape-d', '100'); await setv('shape-di', '50'); await setv('shape-t', '10'); await setv('shape-edge', 'round'); await setv('shape-es', '4'); await wait(150);
  d = await dialog();
  check(d.make && !d.why, `a 4 mm round on a ring is fine ("${d.why}")`);
  await make();
  m = await page.evaluate(MESH, 'ring');
  // a 4 mm quarter round off each top edge: each loses (1 − π/4)·4² mm² of section, its centroid
  // 0.2234·4 mm in from the corner, swept round the ring (Pappus) — within 1%:
  const kc = (10 - 3 * Math.PI) / (12 - 3 * Math.PI), lost = 16 * (1 - Math.PI / 4), cO = 50 - 4 * kc, cI = 25 + 4 * kc;
  const vRing = Math.PI * (50 * 50 - 25 * 25) * 10 - 2 * Math.PI * lost * (cO + cI);
  check(m && m.open === 0 && m.t === 10 && Math.abs(m.vol - vRing) / vRing < 0.01 && Math.abs(m.top[0] - 92) < 0.2 && Math.abs(m.foot[0] - 100) < 0.2,
    `rounded ring: closed, ${m && m.vol} mm³ (want ≈${vRing.toFixed(0)}), top ${m && m.top}, foot ${m && m.foot}`);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.delete(a.widgets.all().find(w => w.meta.file.includes('ring'))); });
  await wait(300);

  // DRAW: the rectangle's chamfer becomes a 2 mm round
  await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); a.platform.select(a.widgets.all()[0]); });
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => document.getElementById('sd-edge'), { timeout: 5000 });
  const e0 = await page.evaluate(() => document.getElementById('sd-edge').value);
  check(e0 === 'chamfer', `DRAW shows the part's edge (${e0})`);
  await page.evaluate(() => { const s = document.getElementById('sd-edge'); s.value = 'round'; s.dispatchEvent(new Event('change')); });
  await page.evaluate(() => { const i = document.getElementById('sd-es'); i.value = '2'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const said = await page.evaluate(() => document.getElementById('sd-say').textContent);
  check(/2 mm round fits/.test(said), `DRAW says the edge fits: "${said}"`);
  await page.screenshot({ path: `${OUT}-draw.png` });
  await page.click('#sd-done');
  await wait(1200);
  m = await page.evaluate(MESH, 'rectangle');
  check(m && m.open === 0 && m.edge && m.edge.kind === 'round' && m.edge.size === 2 && m.top.join() === '96,56' && m.foot.join() === '100,60', `after DRAW: round 2 mm, top ${m && m.top}`);

  // toolpaths: contour shapes the edge (many heights inside the 2 mm band), outline cuts it out
  for (const op of ['contour', 'outline']) {
    await page.evaluate(op => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === op); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, op);
    await wait(400);
  }
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => {
    window.kiri.api.event.on('preview.end', () => res('preview.end'));
    window.kiri.api.event.on('preview.error', e => res('preview.error ' + e));
    setTimeout(() => res('timeout'), 120000);
  }));
  check(pv === 'preview.end', `toolpaths: ${pv}`);
  await page.screenshot({ path: `${OUT}-paths.png` });
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog, { timeout: 60000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const p = window.__swarfRun.state.prog;
    if (!p) return null;
    const cut = p.parsed.moves.filter(m => !m.rapid);
    const zs = new Set(cut.filter(m => m.z < -0.05 && m.z > -1.95).map(m => m.z.toFixed(2)));
    const b = window.SwarfRunParse.cutBounds(p.parsed);
    return { moves: cut.length, band: zs.size, deep: +(-b.min.z).toFixed(2) };
  });
  check(r && r.band >= 8 && r.deep >= 11.9, `in control: the round is cut at ${r && r.band} heights in its 2 mm band, ${r && r.deep} mm deep, ${r && r.moves} moves`);
  await page.screenshot({ path: `${OUT}-control.png` });
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `edge: ${bad.length} failed, ${errors.length} page errors` : 'edge: ok');
process.exit(bad.length || errors.length ? 1 : 0);
