// Phil 11-09: "when I go to CAM and back it shouldn't make me re-zero. There needs to be a dead simple way
// to confirm that zero has been set from almost any situation." In the simulator: zero X Y and Z, go to
// cam, change the part, make toolpaths, come back: still zeroed, no press. Zero at center instead: X Y is
// another place on the board, so it is neither kept nor offered; Z (the board's top) is kept. A bit change in
// the job: Z is the old bit's, so neither the remake nor the button brings Z back. A file that starts on
// another bit keeps X Y and asks for Z.
//   node tools/probe_keep_zero.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-zero-')), args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'plate', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(600);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  const paths = () => page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('ok')); document.getElementById('act-paths')?.click(); setTimeout(() => res('timeout'), 60000); }));
  const toControl = async () => {
    await page.click('#swarf-step-run');
    await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.machine && !window.__swarfRun.state.camBusy, { timeout: 60000 });
    await wait(800);
  };
  const toCam = async () => { await page.evaluate(() => window.__swarfRun.close()); await wait(500); };
  const btn = t => page.evaluate(t => { const b = [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t && b.offsetParent); if (b) b.click(); return !!b; }, t);
  const zero = () => page.evaluate(() => { const S = window.__swarfRun.state; const b = document.querySelector('#swarf-run .sr-keepzero'); return { xy: !!S.zeroXY, z: !!S.zeroZ, offer: b && getComputedStyle(b).display !== 'none' ? b.textContent : '', name: S.prog && S.prog.name, len: S.prog && S.prog.text.length, text: S.prog && S.prog.text }; });
  const resize = (w, h) => page.evaluate((w, h) => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); const b = a.widgets.all()[0].getBoundingBox(); a.selection.scale(w / (b.max.x - b.min.x), h / (b.max.y - b.min.y), 1); }, w, h);

  check(await paths() === 'ok', 'toolpaths');
  await toControl();
  await page.evaluate(() => { window.__swarfRun.state.machine.timeScale = 50; });
  check(await btn('zero x y') && await btn('zero z'), 'zero x y and zero z pressed');
  await wait(300);
  const z0 = await zero(); const t0 = z0.text;
  check(z0.xy && z0.z, `zeroed: ${JSON.stringify({ ...z0, text: undefined })}`);

  // 1. cam and back with a changed part: the same corner, the same bit -> kept, no press
  await toCam();
  await resize(140, 80); await wait(400);
  check(await paths() === 'ok', 'toolpaths again, bigger part');
  await toControl();
  const z1 = await zero();
  check(z1.text !== t0, 'a new program came back (the bigger part)'); delete z0.text; delete z1.text;
  check(z1.xy && z1.z && !z1.offer, `cam and back: still zeroed, nothing to press ${JSON.stringify(z1)}`);
  const said = await page.evaluate(() => document.querySelector('.sr-say').textContent);
  check(/Using the earlier zero \(X Y and Z\)/.test(said), `and it says so: "${said.slice(0, 80)}"`);

  // 2. cam and back with zero at center: X Y is another place on the board, so not kept; one press
  await toCam();
  await page.evaluate(() => { const b = [...document.querySelectorAll('button, span, div')].find(e => e.childElementCount === 0 && e.textContent.trim() === 'center' && e.offsetParent); b && b.click(); });
  await wait(400);
  check(await paths() === 'ok', 'toolpaths zeroed at center');
  await toControl();
  const z2 = await zero(); delete z2.text;
  // the corner zero is another place on the board: never offered to a center file; Z (the board's top) is kept
  check(!z2.xy && z2.z && !/X Y/.test(z2.offer), `zero at center: X Y neither kept nor offered, Z kept (${JSON.stringify(z2)})`);
  check(await btn('zero x y'), 'zero x y at the center'); await wait(200);
  const z2b = await zero(); delete z2b.text;
  check(z2b.xy && z2b.z && !z2b.offer, `zeroed at the center ${JSON.stringify(z2b)}`);

  // 3. a file on another bit (and the corner again, so X Y is not this zero's either): Z asked for (it was set with the old bit); the button offers no Z
  const other = ["&Tool = 7   'Load 3 mm ball end mill", 'C9', 'TR,18000', 'C6', 'JZ,5', 'J2,0,0', 'M3,0,0,-1', 'M3,10,0,-1', 'JZ,5', 'C7', 'END'].join('\n');
  await page.evaluate(t => window.__swarfRun.loadProgram('other-bit.sbp', t, 'file'), other);
  await wait(400);
  const z3 = await zero(); delete z3.text;
  const want3 = z3.z === false;
  // a 10 mm stub reads as both corner and center: its place is unknown, so X Y is offered, naming where it was
  check(want3 && !z3.xy && !/Z\)/.test(z3.offer) && /X Y at the center/.test(z3.offer), `another bit: Z neither kept nor offered; X Y offered, saying it was the center (${JSON.stringify(z3)})`);

  // 4. a tool change in the job: Z is stale; the button does not bring it back
  await page.evaluate(() => { const S = window.__swarfRun.state; S.toolChange = 'Tool change at line 3: put in the end 1/4.'; S.zeroZ = false; S.zStale = true; S.zeroHad = { xy: true, z: true }; });
  await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-keepzero'); if (b && getComputedStyle(b).display !== 'none') b.click(); });
  await wait(200);
  const z4 = await zero(); delete z4.text;
  check(!z4.z, `after a bit change Z stays unset until zeroed for the new bit (${JSON.stringify(z4)})`);
  // 5. (review 11-09) a Z-only zero leaves where X Y was zeroed alone; the place and the bit survive a reload,
  // so after one a center file is not offered a corner zero
  const sbp = (pts, tool) => [`&Tool = 1   'Load ${tool}`, 'C9', 'TR,18000', 'C6', 'JZ,5', `J2,${pts[0][0]},${pts[0][1]}`, ...pts.map(([x, y]) => `M3,${x},${y},-1`), 'JZ,5', 'C7', 'END'].join('\n');
  const corner = sbp([[0, 0], [80, 0], [80, 50], [0, 50], [0, 0]], 'end 1/4'), center = sbp([[-40, -25], [40, -25], [40, 25], [-40, 25], [-40, -25]], 'end 1/4');
  await page.evaluate(t => window.__swarfRun.loadProgram('corner.sbp', t, 'file'), corner); await wait(300);
  await btn('zero x y'); await btn('zero z'); await wait(300);
  const at0 = await page.evaluate(() => window.__swarfRun.state.zeroAt);
  await page.evaluate(t => window.__swarfRun.loadProgram('center.sbp', t, 'file'), center); await wait(300);
  await btn('zero z'); await wait(300);
  const at1 = await page.evaluate(() => window.__swarfRun.state.zeroAt);
  check(at0 === 'corner' && at1 === 'corner', `a Z-only zero keeps the X Y place (${at0} -> ${at1})`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('swarf-run-zero') || 'null'));
  check(saved && saved.where === 'corner' && saved.bit && saved.bit.name === 'end 1/4', `saved with its place and bit (${JSON.stringify(saved && { where: saved.where, bit: saved.bit })})`);
  // the simulator's machine restarts with the page, so its own entry is cleared on reload (by design); write
  // the entry a real box's session leaves (its card count too) and reload onto it, to test the restore
  await page.evaluate(sv => localStorage.setItem('swarf-run-zero', JSON.stringify({ ...sv, steps: sv.steps || { x: 1, y: 1, z: 1 } })), saved);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.__swarfRun.open()); await wait(1500);
  await page.evaluate(t => window.__swarfRun.loadProgram('center.sbp', t, 'file'), center); await wait(500);
  const z5 = await zero(); delete z5.text;
  check(!/X Y/.test(z5.offer), `after a reload a center file is not offered the corner X Y ("${z5.offer.slice(0, 120)}")`);
  await page.evaluate(t => window.__swarfRun.loadProgram('corner.sbp', t, 'file'), corner); await wait(500);
  const z6 = await zero(); delete z6.text;
  check(/X Y and Z.*X Y at the front-left corner.*Z with the end 1\/4/.test(z6.offer), `a corner file is, and the button says where and with which bit ("${z6.offer.slice(0, 160)}")`);
  check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
