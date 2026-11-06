// A pocket with a depth (review 105 F6). A pocket clears down to a floor in the part, and a flat part
// has none: its card says so in a sentence and a button that opens TEX with inlay picked, where a shape
// and a typed depth make a flat pocket. Read from the exported file: the typed depth, the shape's
// width. The concern 'a pocket has nothing to clear' stays true throughout.
//   node tools/probe_pocket_route.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-route-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500));
  const addStep = type => page.evaluate(type => { [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === type).click(); }, type).then(() => wait(700));
  const route = () => page.evaluate(() => { const b = document.querySelector('#oplist .swarf-op-route'), g = b && b.querySelector('button'); return b && { say: b.firstChild.textContent, word: g && g.textContent, tip: g && g.title, seen: !!(g && g.offsetParent) }; });
  const titles = () => page.evaluate(() => window.__swarfConcernsNow().map(c => c.title));
  const NOTHING = 'a pocket has nothing to clear';

  // ── a flat part ──
  await fresh();
  await page.evaluate(() => { window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'board', { depth: 19, soup: true, dpi: 0, place: true }); }); await wait(1200);
  check(!(await route()), 'no pocket step, no sentence');
  await addStep('pocket');
  const r = await route();
  check(r && /no recess/.test(r.say) && /depth you type/.test(r.say), `the pocket card says it in a sentence (${r && r.say})`);
  check(r && r.word === 'pocket in tex' && r.seen && r.tip.length > 20, `with a button and a tooltip (${r && r.word}: ${r && r.tip})`);
  const cased = await page.evaluate(() => getComputedStyle(document.querySelector('#oplist .swarf-op-route')).textTransform);
  check(cased === 'none', `the sentence shows in sentence case (text-transform ${cased})`);
  check((await titles()).includes(NOTHING), 'and the concern stands: it does have nothing to clear');
  await page.evaluate(() => document.querySelector('#oplist .swarf-op-route button').click());
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 }); await wait(500);
  const ops = () => page.evaluate(() => window.kiri.api.conf.get().process.ops.map(o => o.type));
  check(!(await ops()).includes('pocket'), `the empty step goes (${await ops()})`);
  check(!(await titles()).includes(NOTHING), 'and with it the concern');
  check(/Pocket: drag/.test(await page.evaluate(() => document.querySelector('#sd-say, .tx-say, .sd-say')?.textContent || document.getElementById('swarf-draw').textContent)), 'tex says what to do');

  // a 50 x 30 rectangle on the board, with the mouse
  await page.evaluate(() => document.querySelector('#swarf-draw button[data-tool="rect"]').click()); await wait(200);
  const px = (x, y) => page.evaluate((x, y) => { const S = window.__swarfTex.state(), p = S.parts[0], r = document.getElementById('tx-svg').getBoundingClientRect(); return [r.left + S.ox + (p.pos[0] + x) * S.k, r.top + S.oy - (p.pos[1] + y) * S.k]; }, x, y);
  const [ax, ay] = await px(-25, -15), [bx, by] = await px(25, 15);
  await page.mouse.move(ax, ay); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(ax + (bx - ax) * i / 10, ay + (by - ay) * i / 10); await wait(15); }
  await page.mouse.up(); await wait(800);
  const fill = await page.evaluate(() => { const S = window.__swarfTex.state(), m = S.parts[0].marks[S.mark]; return m && m.fill.fill; });
  check(fill === 'inlay', `the mark starts as a flat pocket (${fill})`);
  await page.evaluate(() => { const e = document.getElementById('tx-depth'); e.value = '5'; e.dispatchEvent(new Event('change')); }); await wait(500);
  await page.click('#tx-done'); await wait(2500);
  const after = await ops();
  check(after.includes('inlay'), `done adds its step (${after})`);
  await page.evaluate(() => { const a = window.kiri.api, s = a.widgets.all().find(w => !w.meta.inlay); a.platform.select(s); });
  const text = await page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 120000); window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(text => { clearTimeout(t); res(text); }); }));
  const parsed = P.parse(text, { machineUnits: 'mm' }), cuts = parsed.moves.filter(m => !m.rapid && Math.min(m.z, m.z0) < -0.01);
  const deepest = cuts.length ? Math.min(...cuts.map(m => m.z)) : 0;
  check(Math.abs(deepest + 5) < 0.02, `the file cuts to the typed depth, Z -5 (${deepest})`);
  const across = cuts.length ? Math.max(...cuts.map(m => m.x)) - Math.min(...cuts.map(m => m.x)) : 0;
  check(across > 40 && across <= 50, `inside the 50 mm shape (${across.toFixed(2)} across)`);
  check(!P.routerOffCut(parsed) && !P.rapidAcross(parsed), 'router on, no rapid in the wood');

  // the next visit to tex is not a pocket visit
  check(await page.evaluate(() => { window.__swarfTex.open(); const was = !!window.__swarfTex.state(); window.__swarfTex.close(false, true); return was; }), 'tex still opens the plain way');

  // ── a part with a recess: the floor is there to pick, and the card leaves it at that ──
  await fresh();
  await page.evaluate(() => {
    // a 60 x 60 x 20 tray: a 40 x 40 recess 8 deep
    const L = 60, T = 20, F = 12, v = [];
    const q = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
    const o = [[0, 0], [L, 0], [L, L], [0, L]], i = [[10, 10], [50, 10], [50, 50], [10, 50]];
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      q([...o[k], T], [...o[n], T], [...i[n], T], [...i[k], T]);   // the rim
      q([...o[k], 0], [...o[n], 0], [...o[n], T], [...o[k], T]);   // outside
      q([...i[n], F], [...i[k], F], [...i[k], T], [...i[n], T]);   // inside
    }
    q([...i[0], F], [...i[1], F], [...i[2], F], [...i[3], F]);     // the floor
    q([...o[3], 0], [...o[2], 0], [...o[1], 0], [...o[0], 0]);     // the bottom
    const w = window.kiri.api.new.widget(); w.loadVertices(new Float32Array(v)); window.kiri.api.platform.add(w);
  }); await wait(1200);
  await addStep('pocket');
  check(!(await route()), 'a part with a recess: no sentence');
  check((await titles()).includes(NOTHING), 'and the concern still says so until a floor is picked');
  // a floor picked: the concern goes
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0], o = a.conf.get().process.ops.find(o => o.type === 'pocket'); o.surfaces = { [w.id]: [0] }; a.conf.save(); }); await wait(400);
  check(!(await titles()).includes(NOTHING), 'a floor picked: the concern goes');
  check(!errors.length, `no page errors (${errors.join(' | ')})`);
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `pocket route: ${bad.length} failed` : 'pocket route: ok');
process.exit(bad.length ? 1 : 0);
