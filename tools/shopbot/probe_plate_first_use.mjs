// The Z plate on a browser that has never seen this machine (no machine setup, nothing saved):
// touch off says why it is shut, says so when no touch is seen, proves the circuit from a touch,
// shows a refusal on the card, then zeroes Z.
//   node probe_plate_first_use.mjs [url]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { CHROME } from '../chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const FILE = process.argv[3];
const OUT = process.env.OUT || '/tmp/swarf-direct';
mkdirSync(OUT, { recursive: true });
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
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900', '--use-angle=metal'] });
const problems = [];
let fail = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail++; };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  // load failures are reported by URL below; analytics (gc.zgo.at) is not the app
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !/gc\.zgo\.at/.test(r.url())) problems.push(`response ${r.status()}: ${r.url()}`); });
  page.on('requestfailed', r => /gc\.zgo\.at/.test(r.url()) || problems.push('request: ' + r.url() + ' ' + r.failure().errorText));
  await page.evaluateOnNewDocument(stub + fakeUsb);
  await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__swarfRun && window.kiri && window.kiri.api, { timeout: 60000 });
  await page.evaluate(() => window.__swarfRun.open());
  await page.waitForFunction(() => { const m = window.__swarfRun.state.machine; return m && m.state.connected; }, { timeout: 10000 });
  const conn = await page.evaluate(() => ({ cls: window.__swarfRun.state.machine.constructor.name, note: window.__swarfRun.state.machine.state.note, text: document.querySelector('.sr-conn').textContent }));
  check(conn.cls === 'DirectMachine', `machine: ${conn.cls} — ${conn.note} — "${conn.text.trim()}"`);
  // review 10-27: first-timer defaults, go-to hidden until zero is set this session
  const dflt = await page.evaluate(() => ({ step: document.querySelectorAll('.sr-modes')[0].querySelector('button.on').textContent,
    speed: document.querySelectorAll('.sr-modes')[1].querySelector('button.on').textContent,
    go: [...document.querySelectorAll('.sr-goto button')].filter(b => b.offsetParent && !b.disabled).map(b => b.textContent) }));
  const S = () => page.evaluate(() => { const m = window.__swarfRun.state.machine; const g = document.querySelector('#swarf-run .sr-sheet.on .go'); const c = document.querySelector('#swarf-run .sr-sheet.on .sr-circuit'); const w = document.querySelector('#swarf-run .sr-sheet.on .sr-why');
    return { note: m.state.note, confirmed: m.plateCfg.confirmed, go: g && { t: g.textContent, d: g.disabled }, circ: c && c.textContent, why: w && w.style.display !== 'none' ? w.textContent : '', sheet: !!document.querySelector('#swarf-run .sr-sheet.on') }; });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  check(await page.evaluate(() => !localStorage.getItem('swarf-shopbot-plate')), 'a fresh browser: no plate saved');
  await page.evaluate(() => { const st = window.__stub.state; st.switches = [{ port: 0, bit: 0, axis: 2, at: st.pos[2] - 300, hit: 1 }]; });
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent === 'z plate').click());
  await wait(300);
  await page.evaluate(() => { for (const c of [...document.querySelectorAll('#swarf-run .sr-sheet.on .sr-plate input[type=checkbox]')].slice(0, 3)) c.click(); });
  let s = await S();
  check(s.go.d && /sees the plate touch the bit/.test(s.why), `touch off shut, and the card says why: "${s.why}"`);
  await wait(9500);
  s = await S();
  check(/has not seen the plate touch the bit/.test(s.why) && /clip/.test(s.why), `no touch for a while: the card says check the clip and wire ("${s.why}")`);
  await page.evaluate(() => { const w = window.__stub.state.switches[0]; w.at0 = w.at; w.at = window.__stub.state.pos[2] + 5; });
  await wait(900);
  s = await S();
  check(/touch seen/.test(s.circ) && !s.why, `touching: "${s.circ}", no warning`);
  await page.evaluate(() => { const w = window.__stub.state.switches[0]; w.at = w.at0; });
  await wait(900);
  s = await S();
  check(s.confirmed && !s.go.d && /circuit works/.test(s.circ), `let go: circuit proved, touch off open (${JSON.stringify(s.go)})`);
  await page.evaluate(() => { window.__swarfRun.state.machine.state.routerUnknown = true; document.querySelector('#swarf-run .sr-sheet.on .go').click(); });
  await wait(1500);
  s = await S();
  check(s.sheet && /router/.test(s.why), `a refused touch off keeps the card open with the reason ("${s.why}")`);
  await page.evaluate(() => { window.__swarfRun.state.machine.state.routerUnknown = false; document.querySelector('#swarf-run .sr-sheet.on .go').click(); });
  await page.waitForFunction(() => /^Z ze/.test(window.__swarfRun.state.machine.state.note), { timeout: 30000 }).catch(() => {});
  await wait(500);
  s = await S();
  check(/^Z zeroed/.test(s.note) && s.sheet && !s.why, `then touch off zeroes Z: "${s.note}"`);
} catch (e) { check(false, 'probe ran: ' + e.message); } finally { await browser.close(); }
console.log(problems.length ? problems.slice(0, 5) : '');
console.log(fail ? `plate first use: ${fail} failed` : 'plate first use: ok');
process.exit(fail ? 1 : 0);
