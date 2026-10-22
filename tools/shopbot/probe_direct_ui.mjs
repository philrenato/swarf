// Run mode in Chrome with a fake WebUSB ShopBot (stub-card.cjs behind a fake
// CP210x): the page finds the box, connects over "USB", jogs, zeroes, loads a
// part file and traces it. Screenshots to $OUT.
//   node probe_direct_ui.mjs [url] file.sbp
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
  card.onData = b => { const w = waiters.shift(); if (w) w(b); else inbox.push(b); };
  const dv = b => ({ status: 'ok', data: new DataView(b.buffer, b.byteOffset, b.byteLength) });
  const dev = {
    vendorId: 0x10c4, productId: 0x83c4, productName: 'fake ShopBot', opened: false, configuration: null,
    async open() { this.opened = true; }, async close() { this.opened = false; },
    async selectConfiguration() { this.configuration = { interfaces: [{ interfaceNumber: 0, alternate: { endpoints: [
      { endpointNumber: 1, direction: 'in', type: 'bulk' }, { endpointNumber: 1, direction: 'out', type: 'bulk' }] } }] }; },
    async claimInterface() {}, async releaseInterface() {}, async clearHalt() {},
    async controlTransferOut(s, d) { return { status: 'ok', bytesWritten: d ? d.length : 0 }; },
    async controlTransferIn() { return dv(new Uint8Array([0x30])); },
    async transferOut(ep, b) { await card.write(Uint8Array.from(b)); return { status: 'ok', bytesWritten: b.length }; },
    transferIn() { const b = inbox.shift(); return b ? Promise.resolve(dv(b)) : new Promise(r => waiters.push(x => r(dv(x)))); }
  };
  Object.defineProperty(navigator, 'usb', { value: { getDevices: async () => [dev], requestDevice: async () => dev } });
})();`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900', '--use-angle=metal'] });
const problems = [];
let fail = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail++; };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/NotSameOriginAfterDefaultedToSameOriginByCoep/.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('requestfailed', r => /gc\.zgo\.at/.test(r.url()) || problems.push('request: ' + r.url() + ' ' + r.failure().errorText));
  await page.evaluateOnNewDocument(stub + fakeUsb);
  await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__swarfRun && window.kiri && window.kiri.api, { timeout: 60000 });
  await page.evaluate(() => window.__swarfRun.open());
  await page.waitForFunction(() => { const m = window.__swarfRun.state.machine; return m && m.state.connected; }, { timeout: 10000 });
  const conn = await page.evaluate(() => ({ cls: window.__swarfRun.state.machine.constructor.name, note: window.__swarfRun.state.machine.state.note, text: document.querySelector('.sr-conn').textContent }));
  check(conn.cls === 'DirectMachine', `machine: ${conn.cls} — ${conn.note} — "${conn.text.trim()}"`);
  await page.screenshot({ path: `${OUT}/1-connected.png` });
  await page.evaluate(() => [...document.querySelectorAll('.sr-modes button')].find(b => b.textContent === '10').click());
  const labels = await page.$$eval('.sr-pad button', bs => bs.map(b => b.textContent));
  await (await page.$$('.sr-pad button'))[labels.indexOf('+X')].click();
  await page.waitForFunction(() => !window.__swarfRun.state.machine.busy(), { timeout: 10000 });
  await new Promise(r => setTimeout(r, 300));
  const x = await page.$eval('.sr-axis .v', e => e.textContent);
  check(Math.abs(parseFloat(x) - 10) < 0.02, `jog +X 10 → DRO ${x}; card X steps ${await page.evaluate(() => window.__stub.state.pos[0])}`);
  if (FILE) {
    await page.evaluate((t) => window.__swarfRun.loadProgram('part.sbp', t, 'file'), readFileSync(FILE, 'latin1'));
    await new Promise(r => setTimeout(r, 500));
    for (const t of ['zero x y', 'zero z']) {
      await page.evaluate(t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t).click(), t);
      await new Promise(r => setTimeout(r, 300));
    }
    await page.screenshot({ path: `${OUT}/2-loaded.png` });
    const p7before = await page.evaluate(() => window.__stub.state.p7);
    await page.evaluate(() => document.querySelector('.sr-actions .trace').click());
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.running, { timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}/3-tracing.png` });
    await page.waitForFunction(() => !window.__swarfRun.state.machine.state.running, { timeout: 120000 });
    const end = await page.evaluate(() => ({ note: window.__swarfRun.state.machine.state.note, p7: window.__stub.state.p7, say: document.querySelector('.sr-say').textContent }));
    check(end.note === 'program finished', `trace: ${end.note} — "${end.say}"`);
    check(end.p7 === p7before, `trace left outputs alone (P7 ${p7before} → ${end.p7})`);
    await page.screenshot({ path: `${OUT}/4-traced.png` });
  }
} finally {
  await browser.close();
}
for (const p of problems) console.log('PROBLEM', p);
console.log(fail || problems.length ? `direct ui: ${fail} failed, ${problems.length} page problems` : 'direct ui: ok');
process.exit(fail || problems.length ? 1 : 0);
