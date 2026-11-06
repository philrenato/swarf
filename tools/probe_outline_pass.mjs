// An outline's allowance and last pass (review 105, VCarve's profile), read from the exported file:
// the first passes run wide by the allowance, the last goes once round at the whole depth at the true
// size, tabs lift in both; a hole too narrow for the allowance steps down instead of a full-depth slot;
// the two fields are on the card with tooltips. With DUMP=dir set, the default jobs' files are written
// there too, to compare byte for byte against another build.
//   node tools/probe_outline_pass.mjs [url]
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
const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;
const W = 120, H = 80, T = 12, BIT = 6.35, LEAVE = 0.5;
const rect = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}"/></svg>`;
// a 7 mm round hole: a 1/4 in bit fits, the bit plus 0.5 mm all round does not. And a 30 mm square one
const holed = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><path fill-rule="evenodd" d="M0 0H${W}V${H}H0ZM30 36.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0 -7ZM70 25H100V55H70Z"/></svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-outline-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500));
  const part = (svg, name, depth) => page.evaluate((svg, name, depth) => { window.kiri.api.platform.load_svg(svg, name, { depth, soup: true, dpi: 0, place: true }); }, svg, name, depth).then(() => wait(900));
  const add = (type, patch) => page.evaluate((type, patch) => {
    [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === type).click();
    const a = window.kiri.api, ops = a.conf.get().process.ops, op = ops.filter(o => o.type === type).pop(), tools = a.conf.get().tools;
    if (patch?.tool) op.tool = tools.find(t => t.name === patch.tool).id;
    for (const k of ['inside', 'outside', 'wide', 'down']) if (patch?.[k] != null) op[k] = patch[k];
    a.conf.save(); a.event.emit('cam.op.render');
  }, type, patch || null).then(() => wait(500));
  const tabs = () => page.evaluate(() => { const a = window.kiri.api; a.platform.select_all?.(); window.__swarfAutoTabs.place(); }).then(() => wait(900));
  const tabList = () => page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; return (a.widgets.annotate(w.id).tab || []).map(r => ({ x: r.pos.x, y: r.pos.y, top: r.pos.z + r.dim.z / 2 })); });
  const file = () => page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 120000); window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(text => { clearTimeout(t); res(text); }); }));
  const dump = (name, text) => { if (!DUMP) return; mkdirSync(DUMP, { recursive: true }); writeFileSync(join(DUMP, name + '.sbp'), text); };
  // where the moves arrive: a pass's first move comes from where the one before it ended
  const across = moves => { const xs = moves.map(m => m.x), ys = moves.map(m => m.y); return moves.length ? [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] : [0, 0]; };
  // the file's cuts in order: everything a run of the deepest level ends with is the last pass
  const passes = text => {
    const parsed = P.parse(text, { machineUnits: 'mm' });
    const cuts = parsed.moves.filter(m => !m.rapid);
    const flat = cuts.filter(m => Math.hypot(m.x - m.x0, m.y - m.y0) > 0.01);
    return { parsed, cuts, flat, deepest: Math.min(...cuts.map(m => m.z)) };
  };

  // ── the jobs a student already has: no allowance, no last pass, the same file ──
  await fresh(); await part(rect, 'plate', T);
  await add('outline', { tool: 'end 1/4', inside: false });
  await tabs();
  const plain = await file(); dump('outline-tabs', plain);
  let f = passes(plain);
  check(f.flat.length > 8 && near(across(f.flat)[0], W + BIT), `defaults: the outline runs at the true size (${across(f.flat).map(v => v.toFixed(2))})`);
  await fresh(); await part(holed, 'holed', T);
  await add('outline', { tool: 'end 1/8', inside: false });
  dump('outline-holes', await file());
  await fresh(); await part(holed, 'holed', T);
  await add('outline', { tool: 'end 1/8', inside: true });
  dump('outline-inside', await file());
  await fresh(); await part(rect, 'plate', T);
  await add('outline', { tool: 'end 1/4', inside: false, wide: true });
  dump('outline-wide', await file());
  await fresh(); await part(holed, 'holed', T);
  await add('outline', { tool: 'end 1/8', inside: true, outside: false });
  dump('outline-inside-only', await file());
  await fresh(); await part(rect, 'plate', T);
  await add('rough', { tool: 'end 1/4' }); await add('outline', { tool: 'end 1/8', inside: false });
  dump('rough-outline', await file());

  // ── the card ──
  await fresh(); await part(rect, 'plate', T);
  await add('outline', { tool: 'end 1/4', inside: false });
  await tabs();
  const card = await page.evaluate(() => {
    const row = f => { const i = document.querySelector(`#oplist [data-swarf-field="${f}"]`), l = i && i.closest('label'); return i && { value: i.value, checked: i.checked, type: i.type, tip: l.title, word: l.querySelector('span').textContent }; };
    return { leave: row('leave'), last: row('lastpass') };
  });
  check(card.leave && card.leave.word === 'leave' && card.leave.value === '0' && card.leave.tip.length > 20, `the card has leave, 0 by default, with a tooltip (${JSON.stringify(card.leave)})`);
  check(card.last && card.last.word === 'last pass' && card.last.type === 'checkbox' && !card.last.checked && card.last.tip.length > 20, `and last pass, off by default, with a tooltip (${JSON.stringify(card.last)})`);
  const type = (f, v) => page.evaluate((f, v) => { const i = document.querySelector(`#oplist [data-swarf-field="${f}"]`); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); return i.value; }, f, v);
  const leaveNow = () => page.evaluate(() => window.kiri.api.conf.get().process.ops.find(o => o.type === 'outline').leave);
  await type('leave', '-1'); check(!(await leaveNow() < 0), 'a negative leave is refused');
  await type('leave', String(LEAVE));
  check(await leaveNow() === LEAVE, `leave typed on the card lands on the step (${await leaveNow()})`);

  // ── leave alone: stays oversize, and the step's line says so ──
  let text = await file(); dump('leave-only', text);
  f = passes(text);
  check(near(across(f.flat)[0], W + BIT + 2 * LEAVE) && near(across(f.flat)[1], H + BIT + 2 * LEAVE), `leave alone: every pass ${LEAVE} mm off the part (${across(f.flat).map(v => v.toFixed(2))})`);
  const line = await page.evaluate(() => document.querySelector('#oplist .swarf-op-sum[data-step]')?.textContent);
  check(/oversize/.test(line || ''), `and the step's line says it stays oversize (${line})`);

  // ── leave + last pass ──
  await page.evaluate(() => { const i = document.querySelector('#oplist [data-swarf-field="lastpass"]'); i.click(); }); await wait(300);
  check(await page.evaluate(() => window.kiri.api.conf.get().process.ops.find(o => o.type === 'outline').lastpass === true), 'the last pass box lands on the step');
  const tl = await tabList();
  text = await file(); dump('leave-lastpass', text);
  f = passes(text);
  check(!P.routerOffCut(f.parsed), `router on for every cut (${JSON.stringify(P.routerOffCut(f.parsed))})`);
  check(!P.rapidAcross(f.parsed), `no rapid across in the wood (${JSON.stringify(P.rapidAcross(f.parsed))})`);
  check(near(f.deepest, -T), `down to the board's bottom (${f.deepest})`);
  // the path sits at the bit's half width + the allowance from the part, then at the half width alone:
  // the last pass is what the cuts do after the widest ring is last seen
  const xs = f.flat.map(m => m.x), ys = f.flat.map(m => m.y);
  const edge = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let lastWide = -1;
  f.flat.forEach((m, i) => { if (near(m.x, edge[0], 0.02) || near(m.x, edge[1], 0.02) || near(m.y, edge[2], 0.02) || near(m.y, edge[3], 0.02)) lastWide = i; });
  const first = f.flat.slice(0, lastWide + 1), last = f.flat.slice(lastWide + 1);
  check(near(across(first)[0], W + BIT + 2 * LEAVE) && near(across(first)[1], H + BIT + 2 * LEAVE), `the first passes leave ${LEAVE} mm: ${across(first).map(v => v.toFixed(2))} (the true path + ${2 * LEAVE})`);
  check(last.length > 3 && near(across(last)[0], W + BIT) && near(across(last)[1], H + BIT), `the last pass is at the true size: ${across(last).map(v => v.toFixed(2))} (part ${W} x ${H} + bit ${BIT})`);
  // tabs in both: at the tab's height the bit rides over each one, in the first passes' deepest ring and in the last
  check(tl.length >= 4, `the part has tabs (${tl.length})`);
  const tabTop = -T + (tl[0].top - Math.min(...tl.map(t => t.top)) + (await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0], r = (a.widgets.annotate(w.id).tab || [])[0]; return r.dim.z; })));
  const riding = list => list.filter(m => near(m.z, m.z0, 0.01) && m.z > -T + 0.5 && near(m.z, tabTop, 0.25));
  const lifts = list => { let n = 0, up = false; for (const m of list) { const hi = m.z > -T + 0.5; if (hi && !up) n++; up = hi; } return n; };
  check(riding(first).length >= tl.length, `the first passes ride over the tabs at Z ${tabTop.toFixed(2)} (${riding(first).length} moves)`);
  check(riding(last).length >= tl.length, `the last pass rides over them too (${riding(last).length} moves, ${tl.length} tabs)`);
  check(lifts(last) >= tl.length - 1, `the last pass lifts once a tab (${lifts(last)} lifts, ${tl.length} tabs)`);
  const levels = [...new Set(last.filter(m => near(m.z, m.z0, 0.001) && m.z < -T + 0.5).map(m => m.z.toFixed(2)))];
  check(levels.length === 1, `the last pass is one level, the whole depth (${levels})`);
  const firstLevels = [...new Set(first.filter(m => near(m.z, m.z0, 0.001)).map(m => m.z.toFixed(2)))];
  check(firstLevels.length > 2, `the first passes step down (${firstLevels.length} levels)`);

  // ── a hole the first passes cannot enter is not cut as one full-depth slot ──
  await fresh(); await part(holed, 'holed', T);
  await add('outline', { tool: 'end 1/4', inside: false });
  await page.evaluate(leave => { const a = window.kiri.api, o = a.conf.get().process.ops.find(o => o.type === 'outline'); o.leave = leave; o.lastpass = true; a.conf.save(); }, LEAVE);
  await tabs();
  text = await file(); dump('hole-lastpass', text);
  f = passes(text);
  check(!P.rapidAcross(f.parsed) && !P.routerOffCut(f.parsed), 'with holes: still no rapid in the wood, router on');
  // the file's frame: the part's left edge from the outer ring, then each hole at its place in the drawing
  const x0 = Math.min(...f.flat.map(m => m.x)) + BIT / 2 + LEAVE, y0 = Math.min(...f.flat.map(m => m.y)) + BIT / 2 + LEAVE;
  const inRound = m => Math.hypot(m.x - x0 - 30, m.y - y0 - 40) < 3.6, inSquare = m => m.x - x0 > 70 && m.x - x0 < 100 && m.y - y0 > 25 && m.y - y0 < 55;
  const zs = list => [...new Set(list.filter(m => near(m.z, m.z0, 0.001)).map(m => m.z.toFixed(2)))];
  const round = f.flat.filter(inRound), square = f.flat.filter(inSquare);
  check(zs(round).length > 2, `the 7 mm hole, which the first passes cannot enter, steps down in the last pass (${zs(round).length} levels)`);
  check(round.length && near(Math.min(...round.map(m => m.z)), -T), `and reaches the bottom (${round.length ? Math.min(...round.map(m => m.z)) : 'no cuts'})`);
  // first passes at 30 - 2 x (3.175 + 0.5) across, last at 30 - 2 x 3.175
  const sq = across(square);
  check(near(sq[0], 30 - BIT), `the square hole's last ring is at the true size (${sq[0].toFixed(2)})`);
  const firstRing = square.filter(m => m.x - x0 > 70 + BIT / 2 + LEAVE - 0.02 && m.x - x0 < 100 - BIT / 2 - LEAVE + 0.02 && m.y - y0 > 25 + BIT / 2 + LEAVE - 0.02 && m.y - y0 < 55 - BIT / 2 - LEAVE + 0.02);
  check(firstRing.length > 0 && near(across(firstRing)[0], 30 - BIT - 2 * LEAVE), `and its first passes leave ${LEAVE} mm (${across(firstRing)[0].toFixed(2)})`);

  // ── inside only: the last pass stays inside too ──
  await fresh(); await part(holed, 'holed', T);
  await add('outline', { tool: 'end 1/4', inside: true, outside: false });
  await page.evaluate(leave => { const a = window.kiri.api, o = a.conf.get().process.ops.find(o => o.type === 'outline'); o.leave = leave; o.lastpass = true; a.conf.save(); }, LEAVE);
  text = await file(); dump('inside-lastpass', text);
  f = passes(text);
  check(!P.rapidAcross(f.parsed) && !P.routerOffCut(f.parsed), 'inside only: no rapid in the wood, router on');
  const spanX = across(f.flat)[0];
  check(f.flat.length > 3 && spanX < W - 20, `inside only: it cuts the holes and not the outside (${spanX.toFixed(2)} across, part ${W})`);

  // ── no tabs: a last pass says what it would do ──
  await fresh(); await part(rect, 'plate', T);
  await add('outline', { tool: 'end 1/4', inside: false });
  await page.evaluate(() => { const a = window.kiri.api, o = a.conf.get().process.ops.find(o => o.type === 'outline'); o.leave = 0.5; o.lastpass = true; a.conf.save(); }); await wait(500);
  const open = await page.evaluate(() => window.__swarfConcernsNow().map(c => c.title));
  check(open.some(t => /last pass would skim plate loose/.test(t)), `with no tabs, a concern says the part is skimmed loose (${open})`);
  check(!errors.length, `no page errors (${errors.join(' | ')})`);
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `outline pass: ${bad.length} failed` : 'outline pass: ok');
process.exit(bad.length ? 1 : 0);
