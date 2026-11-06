// Drill out of advanced (review 105 B0c, B4), read from the exported file: circles drawn in DRAW are
// found and drilled, peck by peck, at their X Y, to the board's bottom, router on, no rapid in the
// wood. A step with no holes says so and writes no bit change. A hole bigger than the bit is not
// drilled and a concern says what it needs. Holes picked by hand are left as picked. With DUMP=dir set,
// a hand-picked job's file is written there, to compare byte for byte against another build.
//   node tools/probe_drill.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const DUMP = process.env.DUMP;
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const near = (a, b, tol = 0.1) => Math.abs(a - b) <= tol;
const circle = (x, y, d) => `M${x - d / 2} ${y}a${d / 2} ${d / 2} 0 1 0 ${d} 0a${d / 2} ${d / 2} 0 1 0 ${-d} 0Z`;
const board = (w, h, holes) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><path fill-rule="evenodd" d="M0 0H${w}V${h}H0Z${holes.map(c => circle(...c)).join('')}"/></svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-drill-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.__swarfDraw && document.getElementById('swarf-step-draw')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500));
  const part = (svg, name, depth) => page.evaluate((svg, name, depth) => { window.kiri.api.platform.load_svg(svg, name, { depth, soup: true, dpi: 0, place: true }); }, svg, name, depth).then(() => wait(900));
  const add = (type, patch) => page.evaluate((type, patch) => {
    [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === type).click();
    const a = window.kiri.api, ops = a.conf.get().process.ops, op = ops.filter(o => o.type === type).pop(), tools = a.conf.get().tools;
    if (patch?.tool) op.tool = tools.find(t => t.name === patch.tool).id;
    if (patch?.inside != null) op.inside = patch.inside;
    if (patch?.down != null) op.down = patch.down;
    a.conf.save(); a.event.emit('cam.op.render');
  }, type, patch || null).then(() => wait(500));
  const file = () => page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 120000); window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(text => { clearTimeout(t); res(text); }); }));
  const concerns = () => page.evaluate(() => window.__swarfConcernsNow().map(c => ({ title: c.title, body: c.body, hint: c.hint })));
  const dump = (name, text) => { if (!DUMP) return; mkdirSync(DUMP, { recursive: true }); writeFileSync(join(DUMP, name + '.sbp'), text); };
  // where the bit goes down in the wood: X Y, the depths it reaches, and any sideways cut below the top
  const plunges = parsed => {
    const by = [];
    for (const m of parsed.moves) {
      if (m.rapid || m.z >= m.z0 || m.z >= -0.01 || Math.hypot(m.x - m.x0, m.y - m.y0) > 0.001) continue;
      const h = by.find(b => near(b.x, m.x, 0.01) && near(b.y, m.y, 0.01));
      if (h) { h.pecks++; h.z = Math.min(h.z, m.z); } else by.push({ x: m.x, y: m.y, z: m.z, pecks: 1 });
    }
    return by;
  };
  const sideways = parsed => parsed.moves.filter(m => !m.rapid && Math.min(m.z, m.z0) < -0.01 && Math.hypot(m.x - m.x0, m.y - m.y0) > 0.001);
  const changes = text => text.split('\n').filter(l => /^C9\b/.test(l)).length;

  // ── a basic step, with a tooltip ──
  const button = await page.evaluate(() => { const d = [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'drill'); return d && { seen: !!d.offsetParent, title: d.title, expert: document.body.classList.contains('swarf-expert') }; });
  check(button && button.seen && !button.expert && button.title.length > 20, `drill is in add a step, not advanced, and says what it does (${JSON.stringify(button)})`);

  // every basic step in sight, with a list of steps open above them, not cut off by the panel
  const inSight = () => page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].filter(d => d.offsetParent).map(d => { const r = d.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [d.textContent.trim(), hit === d]; }));
  await part(board(120, 80, [[30, 40, 6]]), 'board', 19);
  for (const t of ['pocket', 'drill', 'outline']) await add(t);
  await page.evaluate(() => { for (const c of document.querySelectorAll('#oplist .swarf-op-chevron')) c.click(); }); await wait(500);
  const sight = await inSight();
  check(sight.length === 5 && sight.every(s => s[1]), `all five steps in sight under three open steps (${JSON.stringify(sight)})`);

  // ── circles drawn in DRAW, with the mouse ──
  await fresh();
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 5; S.ox = r.width / 2 - 250; S.oy = r.height / 2 + 150; });
  const px = (x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
  const drag = async (a, b) => { const [x0, y0] = await px(...a), [x1, y1] = await px(...b); await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await wait(15); } await page.mouse.up(); await wait(120); };
  await page.keyboard.press('r');
  await drag([0, 0], [100, 60]);
  const drawn = [[20, 15], [80, 15], [20, 45], [80, 45]];
  for (const [x, y] of drawn) { await page.keyboard.press('e'); await drag([x - 3, y - 3], [x + 3, y + 3]); }
  const curves = await page.evaluate(() => window.__swarfDraw.state().parts.filter(p => !p.gone).map(p => p.curves.length));
  check(curves.join() === '5', `four circles drawn inside a rectangle are four holes in it (curves ${curves})`);
  await page.evaluate(() => document.getElementById('sd-done').click()); await wait(2500);
  const box = await page.evaluate(() => { const b = window.kiri.api.widgets.all()[0].getBoundingBox(); return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]; });
  const thick = box[2];
  check(near(box[0], 100) && near(box[1], 60) && thick > 1, `DRAW made the part (${box.map(v => v.toFixed(2))})`);
  await add('drill', { tool: 'drill 1/4', down: 5 });
  await add('outline', { tool: 'end 1/8', inside: false });
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select_all?.(); window.__swarfAutoTabs.place(); }); await wait(900);
  const sum = await page.evaluate(() => [...document.querySelectorAll('#oplist .swarf-op-sum')].map(e => e.textContent));
  check(sum.some(s => /4 holes/.test(s)), `the step's line counts them (${sum})`);
  let open = await concerns();
  check(!open.some(c => /drill step|hole/.test(c.title)), `no concern about holes the step drills (${open.map(c => c.title)})`);
  let text = await file(); dump('draw-holes', text);
  let parsed = P.parse(text, { machineUnits: 'mm' });
  check(!P.routerOffCut(parsed), `router on for every cut (${JSON.stringify(P.routerOffCut(parsed))})`);
  check(!P.rapidAcross(parsed), `no rapid across in the wood (${JSON.stringify(P.rapidAcross(parsed))})`);
  const lines = text.split('\n');
  const firstCut = parsed.moves.find(m => !m.rapid && Math.min(m.z, m.z0) < -0.01);
  const firstOn = lines.findIndex(l => /^C6\b/.test(l)) + 1;
  check(firstOn > 0 && firstCut && firstOn < firstCut.line, `the router starts before the first cut (line ${firstOn}, first cut ${firstCut && firstCut.line})`);
  // the outline on the other bit gives the part's corner in the file's own numbers
  const all = plunges(parsed);
  const side = sideways(parsed);
  const x0 = Math.min(...side.map(m => m.x)) + 3.175 / 2, y0 = Math.min(...side.map(m => m.y)) + 3.175 / 2;
  const holes = all.filter(h => drawn.some(([x, y]) => near(h.x - x0, x, 0.15) && near(h.y - y0, y, 0.15)));
  check(holes.length === 4, `four plunges at the drawn X Y: ${holes.map(h => `${(h.x - x0).toFixed(2)},${(h.y - y0).toFixed(2)}`).join(' ')}`);
  check(holes.length && holes.every(h => near(h.z, -thick, 0.02)), `each to the board's bottom, Z ${(-thick).toFixed(2)} (${holes.map(h => h.z)})`);
  const wanted = Math.ceil(thick / 5);
  check(holes.length && holes.every(h => h.pecks >= Math.min(2, wanted)), `each in pecks (${holes.map(h => h.pecks)}, ${thick.toFixed(1)} mm at 5 mm a peck)`);
  // the drill's own block has nothing sideways in the wood: every cut on the drill's XY is straight down
  const atHole = parsed.moves.filter(m => holes.some(h => near(h.x, m.x, 0.01) && near(h.y, m.y, 0.01)) && Math.min(m.z, m.z0) < -0.01);
  check(atHole.length && atHole.every(m => Math.hypot(m.x - m.x0, m.y - m.y0) < 0.001), `nothing moves sideways in a hole (${atHole.length} moves)`);
  check(changes(text) === 2, `one bit change a bit (${changes(text)})`);

  // ── a drawing brought in, a 1/4 in hole typed as 6 mm, and one the bit's exact size ──
  await fresh();
  await part(board(100, 60, [[25, 30, 6], [75, 30, 6.35]]), 'plate', 12);
  await add('drill', { tool: 'drill 1/4', down: 5 });
  text = await file(); parsed = P.parse(text, { machineUnits: 'mm' });
  let found = plunges(parsed);
  check(found.length === 2 && found.every(h => near(h.z, -12, 0.02)), `an imported drawing's 6 and 6.35 mm circles are drilled too (${JSON.stringify(found)})`);

  // ── no round holes at all ──
  await fresh();
  await part(board(100, 60, []), 'plain', 12);
  await add('drill', { tool: 'drill 1/4' });
  open = await concerns();
  let say = open.find(c => /drill step has no holes/.test(c.title));
  check(!!say && /no round holes/.test(say.body), `a step that finds none says so (${say && say.body})`);
  await add('outline', { tool: 'end 1/8', inside: false });
  text = await file();
  check(changes(text) === 1 && !/drill 1\/4/.test(text.split('\n').filter(l => /Load/.test(l)).join()), `and writes no bit change for it (${changes(text)})`);

  // ── a square hole is not round ──
  await fresh();
  await part('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><path fill-rule="evenodd" d="M0 0H100V60H0ZM40 25H46V31H40Z"/></svg>', 'square', 12);
  await add('drill', { tool: 'drill 1/4' });
  open = await concerns();
  check(open.some(c => /drill step has no holes/.test(c.title)), `a square hole of the bit's width is not a round one (${open.map(c => c.title)})`);

  // ── a hole bigger than the bit ──
  await fresh();
  await part(board(100, 60, [[25, 30, 6], [70, 30, 20]]), 'plate', 12);
  await add('drill', { tool: 'drill 1/4', down: 5 });
  open = await concerns();
  say = open.find(c => /1 hole in plate bigger than/.test(c.title));
  check(!!say && /outline or a pocket/.test(say.hint), `the 20 mm hole is said, and what it needs (${say && say.title}: ${say && say.hint})`);
  text = await file(); parsed = P.parse(text, { machineUnits: 'mm' });
  found = plunges(parsed);
  check(found.length === 1, `the file drills the 6 mm hole and not the 20 (${JSON.stringify(found)})`);
  check(!P.routerOffCut(parsed) && !P.rapidAcross(parsed), 'still router on, no rapid in the wood');
  // an outline whose bit fits cuts that hole: nothing is left to say about it
  await add('outline', { tool: 'end 1/8', inside: false });
  open = await concerns();
  check(!open.some(c => /bigger than/.test(c.title)), `with an outline that cuts it, no concern about it (${open.map(c => c.title)})`);

  // ── a hole smaller than the bit ──
  await fresh();
  await part(board(100, 60, [[25, 30, 3]]), 'plate', 12);
  await add('drill', { tool: 'drill 1/4' });
  open = await concerns();
  check(open.some(c => /1 hole in plate smaller than/.test(c.title)), `a 3 mm hole and a 1/4 in bit is said (${open.map(c => c.title)})`);
  text = await file(); parsed = P.parse(text, { machineUnits: 'mm' });
  check(plunges(parsed).length === 0, 'and not drilled');

  // ── the outline's "too small" concern knows a drilled hole ──
  await fresh();
  await part(board(100, 60, [[25, 30, 6]]), 'plate', 12);
  await add('outline', { tool: 'end 1/4', inside: false });
  await wait(500);
  open = await concerns();
  check(open.some(c => /too small for the bit/.test(c.title)), `an outline alone says the 6 mm hole is left out (${open.map(c => c.title)})`);
  await add('drill', { tool: 'drill 1/4' });
  open = await concerns();
  check(!open.some(c => /too small for the bit/.test(c.title)), `with a drill step that drills it, it does not (${open.map(c => c.title)})`);

  // ── a blind hole in a mesh: down to its floor, not through ──
  await fresh();
  await page.evaluate(() => {
    // a 60 x 60 x 20 block with a 6.35 mm round hole 8 mm deep, from the top
    const L = 60, T = 20, F = 12, R = 3.175, N = 32, v = [];
    const tri = (a, b, c) => v.push(...a, ...b, ...c);
    const ring = z => Array.from({ length: N }, (_, i) => [L / 2 + R * Math.cos(2 * Math.PI * i / N), L / 2 + R * Math.sin(2 * Math.PI * i / N), z]);
    const top = ring(T), bot = ring(F);
    const c = [[0, 0], [L, 0], [L, L], [0, L]];
    // the top: a fan from each corner to its quarter of the ring
    for (let q = 0; q < 4; q++) {
      const a = [...c[q], T], b = [...c[(q + 1) % 4], T], start = (N * 5 / 8 + q * N / 4) % N;
      for (let i = 0; i < N / 4; i++) tri(a, top[(start + i + 1) % N], top[(start + i) % N]);
      tri(a, b, top[(start + N / 4) % N]);
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      tri(top[i], top[j], bot[j]); tri(top[i], bot[j], bot[i]);
      tri([L / 2, L / 2, F], bot[i], bot[j]);
    }
    for (let q = 0; q < 4; q++) {
      const a = c[q], b = c[(q + 1) % 4];
      tri([...a, 0], [...b, 0], [...b, T]); tri([...a, 0], [...b, T], [...a, T]);
    }
    tri([0, 0, 0], [L, L, 0], [L, 0, 0]); tri([0, 0, 0], [0, L, 0], [L, L, 0]);
    const w = window.kiri.api.new.widget(); w.loadVertices(new Float32Array(v)); window.kiri.api.platform.add(w);
  }); await wait(1200);
  await add('drill', { tool: 'drill 1/4', down: 5 });
  text = await file(); parsed = P.parse(text, { machineUnits: 'mm' });
  found = plunges(parsed);
  check(found.length === 1 && near(found[0].z, -8, 0.05), `a blind hole stops at its floor, Z -8 (${JSON.stringify(found)})`);

  // ── holes picked by hand stay as picked ──
  await fresh();
  await part(board(100, 60, [[25, 30, 6.35], [75, 30, 6.35]]), 'plate', 12);
  await add('drill', { tool: 'drill 1/4', down: 5 });
  await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0], op = a.conf.get().process.ops.find(o => o.type === 'drill');
    op.drills = { [w.id]: [{ x: -25, y: 0, z: 12, depth: 12, selected: true }, { x: 25, y: 0, z: 12, depth: 12, selected: false }] };
    a.conf.save();
  }); await wait(300);
  text = await file(); dump('picked', text); parsed = P.parse(text, { machineUnits: 'mm' });
  found = plunges(parsed);
  check(found.length === 1, `one picked of two: one hole (${JSON.stringify(found)})`);
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0], op = a.conf.get().process.ops.find(o => o.type === 'drill'); op.drills[w.id].forEach(d => { d.selected = false; }); a.conf.save(); }); await wait(300);
  open = await concerns();
  say = open.find(c => /drill step has no holes/.test(c.title));
  check(!!say && /picked/.test(say.body), `none picked is said (${say && say.body})`);
  // holes before the cut-out, however they were added (review of 109)
  const order = await page.evaluate(() => { const a = window.kiri.api, ops = a.conf.get().process.ops; ops.length = 0; a.conf.save(); const add = t => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === t).click(); add('outline'); add('drill'); return ops.filter(o => o.type !== '|').map(o => o.type); });
  check(order.join() === 'drill,outline', `drill added after outline runs first (${order})`);
  check(!errors.length, `no page errors (${errors.join(' | ')})`);
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `drill: ${bad.length} failed` : 'drill: ok');
process.exit(bad.length ? 1 : 0);
