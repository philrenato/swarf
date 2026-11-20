// Control for the MR-1 in Chrome, against a fake Web Serial port backed by the stub GRBL
// (stub-grbl.cjs) inside the page: an MR-1 job from cam, control, connect, the machine check
// card, home, jog each axis, zero x y and z, trace, air cut, a cut with no trace (its tick),
// pause and resume, and a stop that keeps the position. Screenshots and the saved capture go to
// $OUT, never to ~/Downloads.
//   node tools/grbl/probe_grbl_ui.mjs [url]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from '../chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8794/swarf-app/';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'swarf-grbl-'));
mkdirSync(OUT, { recursive: true });
const stubSrc = readFileSync(new URL('./stub-grbl.cjs', import.meta.url), 'utf8');
// a Web Serial port whose far end is the stub: open restarts it, bytes go both ways, unplug drops it
const fakeSerial = `
(() => {
  const stub = StubGrbl({ timeFactor: 5, phys: { x: 250, y: -250, z: -60 } });
  window.__stub = stub;
  let granted = false, ctrl = null;
  const port = {
    readable: null, writable: null,
    getInfo: () => ({ usbVendorId: 0x16D0, usbProductId: 0x103E }),
    async open(o) {
      if (this.readable) throw new DOMException('The port is already open.', 'InvalidStateError');
      window.__openOpts = o;
      this.readable = new ReadableStream({ start: c => { ctrl = c; }, cancel: () => { ctrl = null; } });
      this.writable = new WritableStream({ write: chunk => { stub.write(chunk); } });
      stub.onData = b => { if (ctrl) try { ctrl.enqueue(b); } catch (e) { /* closed */ } };
      stub.onClose = () => { try { if (ctrl) ctrl.error(new Error('The device has been lost.')); } catch (e) { /* closed */ } ctrl = null; this.readable = null; };
      stub.open();
    },
    async close() { try { if (ctrl) ctrl.close(); } catch (e) { /* cancelled */ } ctrl = null; this.readable = null; this.writable = null; stub.close(); },
    async setSignals() {}, async getSignals() { return {}; }
  };
  Object.defineProperty(navigator, 'serial', { value: { getPorts: async () => granted ? [port] : [], requestPort: async () => { granted = true; return port; } } });
})();`;

const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-grbl-ud-')), args: ['--window-size=1440,900'] });
const problems = [];
let fail = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail++; };
try {
  // downloads land in OUT
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !/gc\.zgo\.at/.test(r.url())) problems.push(`response ${r.status()}: ${r.url()}`); });
  await page.evaluateOnNewDocument(stubSrc + fakeSerial);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun && window.SwarfGrbl), { timeout: 90000, polling: 200 });
  await wait(1500);

  const S = expr => page.evaluate(new Function(`const S = window.__swarfRun.state, m = S.machine, st = m && m.state, stub = window.__stub; return (${expr});`));
  const until = async (expr, ms = 20000, what = expr) => {
    try { await page.waitForFunction(new Function(`const S = window.__swarfRun.state, m = S.machine, st = m && m.state, stub = window.__stub; return (${expr});`), { timeout: ms, polling: 50 }); return true; }
    catch (e) { check(false, `timed out: ${what}`); throw e; }
  };
  const btn = t => page.evaluate(t => { const b = [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t && b.offsetParent); if (b) b.click(); return !!b; }, t);
  const shown = t => page.evaluate(t => !![...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t && b.offsetParent), t);
  const sheetGo = () => page.evaluate(() => { const g = document.querySelector('#swarf-run .sr-sheet.on .go'); const t = g.textContent; g.click(); return t; });
  const say = () => page.evaluate(() => document.querySelector('#swarf-run .sr-say').textContent);
  const stubPos = () => page.evaluate(() => window.__stub.mpos());

  // an MR-1 job: a 20 mm square, an outline, toolpaths
  await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>', 'square', { depth: 3, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(600);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  const paths = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('ok')); document.getElementById('act-paths')?.click(); setTimeout(() => res('timeout'), 60000); }));
  check(paths === 'ok', 'toolpaths for the MR-1');
  const stepShown = await page.evaluate(() => { const s = document.getElementById('swarf-step-run'); return s && s.style.display !== 'none' ? s.title : ''; });
  check(/Control the MR-1/.test(stepShown), `control is offered for the MR-1: "${stepShown}"`);
  await page.click('#swarf-step-run');
  await until('S.prog && m && !S.camBusy', 60000, 'control with the toolpaths');
  const prog = await S('({ name: S.prog.name, problems: [...document.querySelectorAll("#swarf-run .sr-plan .b")].map(e => e.textContent), head: S.prog.text.split(/\\n/).slice(0, 12).join(" | ") })');
  console.log('     file head:', prog.head);
  check(prog.problems.length === 0, `the MR-1 file reads clean (${prog.problems.join(' / ') || 'no blocks'})`);
  check(await S('st.kind') === 'sim', 'no port allowed yet: the simulator until connect');

  // connect: Chrome's chooser (the fake grants), the restart banner, the lock
  check(await btn('connect'), 'connect pressed');
  await until('st && st.kind === "grbl" && st.connected', 15000, 'connected to the MR-1');
  const conn = await page.evaluate(() => ({ target: document.querySelector('#swarf-run .sr-target').textContent, baud: window.__openOpts && window.__openOpts.baudRate, say: document.querySelector('#swarf-run .sr-say').textContent }));
  check(conn.target === 'MR-1' && conn.baud === 115200, `target chip "${conn.target}", ${conn.baud} baud`);
  check(/Press home/.test(conn.say), `the line says home first: "${conn.say.slice(0, 90)}"`);
  const hidden = await page.evaluate(() => ['z plate', 'table corners', 'machine setup (hold)'].map(t => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t)).map(b => !b || !b.offsetParent));
  const routerHidden = await page.evaluate(() => !document.querySelector('#swarf-run .sr-router').offsetParent);
  check(hidden.every(Boolean) && routerHidden, 'z plate, table corners, machine setup and the router test are not shown on the MR-1');
  const traceWait = await page.evaluate(() => document.querySelector('#swarf-run .sr-actions .trace').dataset.why);
  check(/press home/.test(traceWait), `trace waits for home: "${traceWait}"`);

  // the machine check: settings, live inputs, the capture saved; nothing moves
  const before = await stubPos();
  check(await btn('machine check'), 'machine check opened');
  await until('document.querySelector("#swarf-run .sr-sheet.on .sr-mr1chk")', 5000, 'the check card');
  const card = await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .sr-card').innerText.replace(/\s+/g, ' '));
  console.log('     card:', card.slice(0, 400));
  check(/16d0:103e/.test(card) && /Grbl 1\.1h/.test(card) && /inches \(\$13=1\)/.test(card) && /X 580 · Y 550 · Z 150 mm/.test(card) && /9000 rpm/.test(card) && /homing \(\$22\) on/.test(card), 'the card shows port, banner, units, travel, spindle top, homing');
  await page.evaluate(() => window.__stub.fault.stuckProbe(true));
  await until('document.querySelector("#swarf-run .sr-sheet.on .sr-dots i.on") && document.querySelector("#swarf-run .sr-sheet.on .sr-dots i.on").textContent === "P"', 3000, 'P lights when the probe input closes');
  check(true, 'the tool setter / probe input lights P live');
  await page.evaluate(() => window.__stub.fault.stuckProbe(false));
  await until('!document.querySelector("#swarf-run .sr-sheet.on .sr-dots i.on")', 3000, 'P goes out');
  await page.screenshot({ path: `${OUT}/1-check.png` });
  const had = new Set(readdirSync(OUT));
  check(await btn('save the capture'), 'save the capture');
  await wait(1500);
  const saved = readdirSync(OUT).filter(f => /^mr1-check-.*\.txt$/.test(f) && !had.has(f));
  const capText = saved.length ? readFileSync(join(OUT, saved[0]), 'utf8') : '';
  check(saved.length === 1 && /\$130=580/.test(capText) && /\[G54:/.test(capText) && /> \$\$/.test(capText), `the capture saved in ${OUT} (${saved[0] || 'none'})`);
  await sheetGo();
  const after = await stubPos();
  check(JSON.stringify(before) === JSON.stringify(after), 'nothing moved during the check');

  // home: the card first, then the board's own homing
  check(await btn('home'), 'home pressed');
  const homeCard = await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on h2').textContent);
  check(/MR-1 is about to\shome/.test(homeCard), `asks first: "${homeCard}"`);
  await sheetGo();
  await until('st.homed', 20000, 'homed');
  check((await stubPos()).every(v => v === 0), 'the board is at machine 0, 0, 0');

  // jog 10 mm on each axis, by the step buttons
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-modes')[0].querySelectorAll('button')].find(b => b.textContent === '10').click());
  const jog = async label => { await page.click(`#swarf-run .sr-pad button[data-axis="${label}"]`); await wait(100); await until('!m.busy() && st.grbl === "Idle"', 10000, `jog ${label}`); await wait(300); };
  await jog('+X'); await jog('−Y'); await jog('−Z');
  const j1 = await stubPos();
  check(Math.abs(j1[0] - 10) < 0.01 && Math.abs(j1[1] + 10) < 0.01 && Math.abs(j1[2] + 10) < 0.01, `jogged 10 mm X+, Y-, Z-: ${j1.map(v => v.toFixed(3))}`);
  await jog('+Y');
  const j2 = await stubPos();
  check(Math.abs(j2[1] + 2) < 0.01, `Y+ 10 from Y -10 stops 2 mm short of the end of travel: ${j2[1].toFixed(3)}`);
  await jog('+Y');
  const j3 = await stubPos();
  check(Math.abs(j3[1] + 2) < 0.01 && /end of its travel/.test(await S('st.note')), 'Y+ again: refused, nothing sent');
  // over the board: 50 mm steps
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-modes')[0].querySelectorAll('button')].find(b => b.textContent === '50').click());
  for (const l of ['+X', '+X', '−Y', '−Y', '−Z']) await jog(l);
  // a zero pressed mid-move is refused (and says so); the bit's place is read once it has stopped
  await until('!m.busy() && !st.moving', 5000, 'still after the jogs');
  const over = await stubPos();
  console.log('     over the board at machine', over.map(v => v.toFixed(3)).join(', '));

  // zero x y, zero z (paper)
  check(await btn('zero x y'), 'zero x y');
  await until('S.zeroXY && !m.busy()', 5000, 'X Y zeroed');
  check(await btn('zero z'), 'zero z');
  await until('S.zeroZ && !m.busy()', 5000, 'Z zeroed');
  const g54 = await page.evaluate(() => window.__stub.eeprom.coords[54]);
  check(g54.every((v, i) => Math.abs(v - over[i]) < 0.01), `G54 on the board is where the bit is: ${g54.map(v => v.toFixed(3))}`);
  const dro = await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-axis .v')].map(e => e.textContent));
  check(dro.every(t => Math.abs(+t) < 0.01), `readout at 0: ${dro}`);

  // trace
  const runJob = async (label, expectGo) => {
    check(await btn(label), `${label} pressed`);
    await until('document.querySelector("#swarf-run .sr-sheet.on .go")', 5000, `${label} card`);
    await page.evaluate(() => { for (const c of document.querySelectorAll('#swarf-run .sr-sheet.on input[type=checkbox]')) c.click(); });
    const go = await sheetGo();
    if (expectGo) check(expectGo.test(go), `its button: "${go}"`);
    await until('st.running', 5000, `${label} running`);
  };
  await runJob('trace');
  await until('!st.running', 60000, 'trace done');
  check(await S('S.traced && st.done'), `traced: ${await S('st.note')}`);
  // air cut: the spindle stays off, the air speed slider is the ShopBot's only
  await runJob('air cut');
  check(await page.evaluate(() => !document.querySelector('#swarf-run .sr-airspeed').offsetParent), 'no air-speed slider on the MR-1');
  let spun = false;
  while (await S('st.running')) { if (await page.evaluate(() => window.__stub.state.spindle.on)) spun = true; await wait(50); }
  check(!spun && await S('st.done'), `air cut done, spindle never on: ${await S('st.note')}`);
  // a cut with no trace: zero Z again (a new trace would be owed), then cut with the extra tick
  check(await btn('zero z'), 'zero z again');
  await until('S.zeroZ && !S.traced && !m.busy()', 5000, 'Z zeroed, the trace owed again');
  const items = async () => page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on label')].map(l => l.textContent));
  check(await btn('cut'), 'cut pressed');
  await until('document.querySelector("#swarf-run .sr-sheet.on .go")', 5000, 'cut card');
  const list = await items();
  check(list.some(t => /^no trace/.test(t)) && list.some(t => /spindle will run at/.test(t)), `the cut card asks for the no-trace tick and names the spindle speed (${list.length} ticks)`);
  await page.evaluate(() => { for (const c of document.querySelectorAll('#swarf-run .sr-sheet.on input[type=checkbox]')) c.click(); });
  const go = await sheetGo();
  check(/without a trace/.test(go), `its button: "${go}"`);
  const why = await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-way.bad, #swarf-run .sr-say')].map(e => e.textContent).join(' | '));
  if (why) console.log('     card and line:', why.slice(0, 400));
  await until('st.running', 5000, 'cut running');
  await page.waitForFunction(() => window.__stub.state.spindle.on && window.__stub.state.state === 'Run', { timeout: 20000, polling: 20 });
  const rpm = await page.evaluate(() => window.__stub.state.spindle.S);
  check(rpm > 0 && rpm <= 8000, `the spindle on at S${rpm}`);
  // pause: the spindle stops once the bit is still, and the veil says so; resume starts it, then carries on
  await wait(300);
  check(await btn('pause'), 'pause');
  await page.waitForFunction(() => window.__stub.state.state === 'Hold' && window.__stub.state.sub === 0, { timeout: 5000, polling: 20 });
  await page.waitForFunction(() => window.__stub.state.spinStop === 2, { timeout: 5000, polling: 20 });
  const veilText = () => page.evaluate(() => document.querySelector('#swarf-run .sr-veil h2').textContent + ' ' + document.querySelector('#swarf-run .sr-veilcard p').textContent);
  // the board says 0 at once; the card keeps "stopping" while the spindle runs down, then says off
  const early = await veilText();
  check(/Spindle stopping/.test(early) && /Keep clear/.test(early), `the spindle running down: "${early}"`);
  await page.waitForFunction(() => /Spindle off/.test(document.querySelector('#swarf-run .sr-veil h2').textContent), { timeout: 8000, polling: 50 }).catch(() => {});
  const veil = await veilText();
  check(/Spindle off/.test(veil) && /starts it here/.test(veil), `paused, spindle off: "${veil}"`);
  const held = await stubPos(); await wait(300);
  check(JSON.stringify(held) === JSON.stringify(await stubPos()), 'nothing moves while paused');
  await page.screenshot({ path: `${OUT}/2-paused.png` });
  check(await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-veil .go'); const t = b.textContent; b.click(); return t === 'start the spindle and resume'; }), 'start the spindle and resume');
  // while it comes back the card says so, and has no resume to press
  await page.waitForFunction(() => /Starting the spindle/.test(document.querySelector('#swarf-run .sr-veil h2').textContent), { timeout: 4000, polling: 20 }).catch(() => {});
  const starting = await page.evaluate(() => ({ t: document.querySelector('#swarf-run .sr-veil h2').textContent, hidden: getComputedStyle(document.querySelector('#swarf-run .sr-veil .go')).visibility === 'hidden', moving: window.__stub.state.state }));
  check(/Starting the spindle/.test(starting.t) && starting.hidden && starting.moving !== 'Run', `the spindle starting: "${starting.t}", resume hidden ${starting.hidden}, board ${starting.moving}`);
  await page.waitForFunction(() => window.__stub.state.state === 'Run', { timeout: 8000, polling: 20 });
  check(await page.evaluate(() => window.__stub.state.spinStop === 0 && window.__stub.state.spindle.on && !window.__stub.state.restarts), 'the spindle back on before it moved');
  // stop: hold, rest, reset; the position kept and still homed
  await wait(300);
  check(await btn('stop'), 'stop');
  await until('!st.running && !m.stopping', 10000, 'stopped');
  await wait(400);
  const stopped = await S('({ note: st.note, homed: st.homed, alarm: st.alarm, pos: st.mpos, at: S.stoppedAt })');
  const sp = await stubPos();
  check(stopped.homed && !stopped.alarm && ['x', 'y', 'z'].every((a, i) => Math.abs(stopped.pos[a] - sp[i]) < 0.003), `stop kept the position and the homing: ${JSON.stringify(stopped)}`);
  check(await page.evaluate(() => window.__stub.state.state === 'Idle' && !window.__stub.state.spindle.on), 'the board idle, the spindle off');
  const tail = await page.evaluate(() => window.__stub.state.received.slice(-5));
  check(JSON.stringify(tail) === JSON.stringify(['G21', 'G90', 'G94', 'G17', 'G54']), `the preamble went again after the reset: ${tail}`);
  check(stopped.at > 0, `"continue from line ${stopped.at}" is offered`);
  await page.screenshot({ path: `${OUT}/3-stopped.png` });
  check(problems.length === 0, `no page errors ${problems.length ? JSON.stringify(problems.slice(0, 5)) : ''}`);
} catch (e) {
  console.log('FAIL', e.message);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `probe_grbl_ui: ${fail} failed` : 'probe_grbl_ui: all passed', '· out', OUT);
process.exit(fail ? 1 : 0);
