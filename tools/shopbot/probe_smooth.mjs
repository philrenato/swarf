import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { CHROME } from '../chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const stub = readFileSync(new URL('./stub-card.cjs', import.meta.url), 'utf8');
const fakeUsb = `
(() => {
  const card = StubCard();
  window.__stub = card;
  const inbox = [], waiters = [];
  card.onData = b => { if (window.__gone) return; const w = waiters.shift(); if (w) w.ok(b); else inbox.push(b); };
  window.__gone = false;
  window.__unplug = () => { window.__gone = true; inbox.length = 0; for (const w of waiters.splice(0)) w.no(new Error('device unplugged')); };
  window.__replug = () => { window.__gone = false; dev.opened = false; };
  const dv = b => ({ status: 'ok', data: new DataView(b.buffer, b.byteOffset, b.byteLength) });
  const dev = {
    vendorId: 0x10c4, productId: 0x83c4, productName: 'fake ShopBot', opened: false, configuration: null,
    async open() { this.opened = true; }, async close() { this.opened = false; for (const w of waiters.splice(0)) w.no(new Error('The device was closed.')); },   // like Chrome: a pending read ends at close
    async selectConfiguration() { this.configuration = { interfaces: [{ interfaceNumber: 0, alternate: { endpoints: [
      { endpointNumber: 1, direction: 'in', type: 'bulk' }, { endpointNumber: 1, direction: 'out', type: 'bulk' }] } }] }; },
    async claimInterface() {}, async releaseInterface() {}, async clearHalt() {},
    async controlTransferOut(s, d) { return { status: 'ok', bytesWritten: d ? d.length : 0 }; },
    async controlTransferIn() { return dv(new Uint8Array([0x30])); },
    async transferOut(ep, b) { if (window.__gone) throw new Error('device unplugged'); await card.write(Uint8Array.from(b)); return { status: 'ok', bytesWritten: b.length }; },
    transferIn() { if (window.__gone) return Promise.reject(new Error('device unplugged')); const b = inbox.shift(); return b ? Promise.resolve(dv(b)) : new Promise((r, j) => waiters.push({ ok: x => r(dv(x)), no: j })); }
  };
  Object.defineProperty(navigator, 'usb', { value: { getDevices: async () => window.__gone ? [] : [dev], requestDevice: async () => dev } });
})();`;

// Does the bit run without stopping? (Phil 11-02 at the machine: "trace is unacceptably jerky"; "make sure
// air cut and cut are all tuned to work well, like the jog work".) The page drives the stub card in real
// time: it plays each block at its ticks' own length and holds as many as the card's window, and a block
// that arrives after the last one finished, mid-job, is a stall (the bit stopped and started). A trace of
// a 300 x 200 mm job at 50 mm/s, then an air cut of a circle in 2° chords at 25 mm/s and a raster of
// short moves, with the page's CPU slowed 4x (THROTTLE) as a busy laptop's would be.
//   node tools/shopbot/probe_smooth.mjs [url]
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900', '--use-angle=metal'] });
let fail = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(stub + fakeUsb);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__swarfRun && window.kiri && window.kiri.api, { timeout: 90000 });
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  await page.evaluate(() => window.__swarfRun.open());
  await page.waitForFunction(() => { const m = window.__swarfRun.state.machine; return m && m.state.connected; }, { timeout: 15000 });
  const cdp = await page.target().createCDPSession();
  const slow = +(process.env.THROTTLE || 4);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow });
  // the job: a 300 x 200 mm outline (the trace runs its box), an 80 mm circle in 2° chords, a raster
  const L = ["'UNITS:MM", "&Tool =1             'Load 6 mm flat end mill", "C9", "TR,12000", "C6", "MS,25,10", "J3,0,0,5", "M3,0,0,-1", "M3,300,0,-1", "M3,300,200,-1", "M3,0,200,-1", "M3,0,0,-1", "J3,150,100,5", "M3,190,100,-1"];
  for (let i = 1; i <= 180; i++) { const a = i / 180 * 2 * Math.PI; L.push(`M3,${(150 + 40 * Math.cos(a)).toFixed(3)},${(100 + 40 * Math.sin(a)).toFixed(3)},-1`); }
  L.push('J3,20,20,5', 'M3,20,20,-1');
  for (let r = 0; r < 12; r++) { const y = 20 + r * 2; for (let i = 0; i <= 60; i++) L.push(`M3,${(r % 2 ? 80 - i : 20 + i).toFixed(3)},${y.toFixed(3)},${(-1 - 0.4 * Math.sin(i / 3)).toFixed(3)}`); if (r < 11) L.push(`M3,${(r % 2 ? 20 : 80)},${y + 2},-1`); }
  L.push('J3,0,0,5', 'C7', 'END');
  await page.evaluate(t => window.__swarfRun.loadProgram('smooth.sbp', t, 'file'), L.join('\n'));
  const btn = t => page.evaluate(t => { const b = [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t && b.offsetParent); if (!b) throw new Error('no button ' + t); b.click(); }, t);
  await btn('zero x y'); await btn('zero z'); await wait(300);
  const idle = (ms) => page.waitForFunction(() => { const s = window.__swarfRun.state.machine.state; return !s.running && !s.moving; }, { timeout: ms, polling: 250 });
  const run = async (label) => {
    await page.evaluate(() => { window.__stub.state.realtime = true; window.__stub.state.starves = []; window.__stub.state.starveAt = []; window.__stub.state.b0 = window.__stub.state.blocks; });
    await btn(label);
    await page.waitForFunction(() => document.querySelector('#swarf-run .sr-sheet.on .go'), { timeout: 5000 });
    await page.evaluate(() => { for (const c of document.querySelectorAll('.sr-sheet.on input[type=checkbox]')) if (!c.checked) c.click(); document.querySelector('#swarf-run .sr-sheet.on .go').click(); });
    const t0 = Date.now();
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.running, { timeout: 10000 }).catch(() => {});
    await idle(400000);
    const r = await page.evaluate(() => ({ starves: window.__stub.state.starves.slice(), at: (window.__stub.state.starveAt || []).map(b => b - window.__stub.state.b0), n: window.__stub.state.blocks - window.__stub.state.b0, window: window.__stub.state.window }));
    await page.evaluate(() => { window.__stub.state.realtime = false; });
    const big = r.starves.filter(ms => ms > 5);
    console.log(`  ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s, window ${r.window}, stalls over 5 ms: ${big.length}${big.length ? ` (longest ${Math.max(...big).toFixed(0)} ms; at blocks ${r.at.join(',')} of ${r.n}; all ${r.starves.map(v => v.toFixed(0)).join(',')})` : ''}`);
    return big;
  };
  const tr = await run('trace');
  check(tr.length === 0, `trace at 50 mm/s, CPU ${slow}x slower: the bit never stops (${tr.length} stalls)`);
  await wait(500);
  const air = await run('air cut');
  check(air.length === 0, `air cut (curves, a raster): the bit never stops (${air.length} stalls)`);
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally { await browser.close(); }
console.log(fail ? `smooth: ${fail} failed` : 'smooth: ok');
process.exit(fail ? 1 : 0);
