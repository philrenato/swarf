// Run mode in Chrome with a fake WebUSB ShopBot (stub-card.cjs behind a fake
// CP210x): the page finds the box, connects over "USB", jogs, zeroes, loads a
// part file and traces it. Screenshots to $OUT.
//   node probe_direct_ui.mjs [url] file.sbp
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
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
    go: [...document.querySelectorAll('.sr-goto button')].filter(b => b.offsetParent).map(b => b.textContent) }));
  check(dflt.step === '1' && dflt.speed === '2500' && !dflt.go.some(t => /go to/.test(t)), `defaults: step ${dflt.step}, speed ${dflt.speed}, shown [${dflt.go}]`);
  // machine check card: opens from its button (10-27: no longer by itself)
  check(await page.evaluate(() => !document.querySelector('#swarf-run .sr-sheet.on')), 'check card stays shut on connect');
  // machine setup is press-and-hold (teacher only): a click does nothing, 1.5 s opens it
  const setupBtn = () => page.evaluateHandle(() => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent === 'machine setup (hold)'));
  await (await setupBtn()).click();
  await new Promise(r => setTimeout(r, 300));
  check(await page.evaluate(() => !document.querySelector('#swarf-run .sr-sheet.on')), 'a click on machine setup does not open it');
  await page.evaluate(() => { const b = [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent === 'machine setup (hold)'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 1700));
  await page.waitForFunction(() => document.querySelector('#swarf-run .sr-sheet.on .sr-chk'), { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/0-check.png` });
  const chk = (axis, label) => page.evaluate((axis, label) => {
    const row = [...document.querySelectorAll('#swarf-run .sr-chk')].find(r => r.querySelector('b').textContent === axis);
    [...row.querySelectorAll('button')].find(b => b.textContent.startsWith(label)).click();
  }, axis, label);
  const idle = () => page.waitForFunction(() => !window.__swarfRun.state.machine.busy(), { timeout: 10000 }).then(() => new Promise(r => setTimeout(r, 200)));
  const cardX = () => page.evaluate(() => window.__stub.state.pos[0]);
  await chk('X', '+20 mm'); await idle();
  const x1 = await cardX();
  await chk('X', 'wrong way'); await chk('X', '+20 mm'); await idle();
  const x2 = await cardX(), dro = await page.$eval('.sr-axis .v', e => e.textContent);
  check(x1 === 1444 && x2 === 0 && Math.abs(parseFloat(dro) - 20) < 0.02, `X flip: card ${x1} → ${x2} steps, DRO ${dro}`);
  await chk('X', 'wrong way');
  check(await page.evaluate(() => !window.__swarfRun.state.machine.flip.x), 'X flipped back');
  await page.evaluate(() => { window.__stub.state.inputs[0] = 0x7E & ~(1 << 2); });
  await page.waitForFunction(() => [...document.querySelectorAll('#swarf-run .sr-dots i.on')].map(d => d.textContent).join() === '3', { timeout: 3000 }).then(() => check(true, 'input 3 lights when P6.2 drops'), () => check(false, 'input 3 lights when P6.2 drops'));
  await page.evaluate(() => { window.__stub.state.inputs[0] = 0x7E; });
  // home sensors: cover X (input 2 -> 0), take it; then Y (input 3 -> 0)
  const take = async (bit, label) => {
    await page.evaluate(b => { window.__stub.state.inputs[0] = 0x7E & ~(1 << b); }, bit);
    await page.waitForFunction(b => [...document.querySelectorAll('#swarf-run .sr-dots i.on')].map(d => d.textContent).join() === String(b + 1), { timeout: 3000 }, bit);
    await page.evaluate(l => [...document.querySelectorAll('#swarf-run .sr-card button')].find(b => b.textContent === l).click(), label);
    await page.evaluate(() => { window.__stub.state.inputs[0] = 0x7E; });
    await new Promise(r => setTimeout(r, 500));
  };
  await take(1, "that's X home");
  await take(2, "that's Y home");
  const homeText = await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-card p')].map(p => p.textContent).find(t => t.startsWith('X home')));
  check(homeText === 'X home: input 2 · Y home: input 3', `home sensors: "${homeText}"`);
  // Z plate: touching it raises input 1
  await page.evaluate(() => { window.__stub.state.inputs[0] = 0x7F; });
  await page.waitForFunction(() => [...document.querySelectorAll('#swarf-run .sr-dots i.on')].map(d => d.textContent).join() === '1', { timeout: 3000 });
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-card button')].find(b => b.textContent === "that's the Z plate").click());
  await page.evaluate(() => { window.__stub.state.inputs[0] = 0x7E; });
  const plateText = await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-card p')].map(p => p.textContent).find(t => t.startsWith('Z plate')));
  check(plateText === 'Z plate: input 1', `Z plate: "${plateText}"`);
  const seen = [];
  const watch = setInterval(async () => seen.push(await page.evaluate(() => window.__stub.state.outs).catch(() => -1)), 100);
  await page.evaluate(() => document.querySelector('#swarf-run .sr-card .sr-out').click());
  const armed = await page.$eval('#swarf-run .sr-card .sr-out', e => e.textContent);
  await page.evaluate(() => document.querySelector('#swarf-run .sr-card .sr-out').click());
  await new Promise(r => setTimeout(r, 2600));
  clearInterval(watch);
  check(seen.includes(9) && seen[seen.length - 1] === 0, `output test: "${armed}" then outputs ${[...new Set(seen)].join(' → ')}`);
  const log = await page.evaluate(() => window.__swarfRun.state.machine.logText());
  check(log.split('\n').length > 20 && /> e0 ff ff ff ff ff/.test(log), `log: ${log.split('\n').length} lines`);
  await page.screenshot({ path: `${OUT}/0-check-done.png` });
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-card .row button')].find(b => b.textContent === 'done').click());
  check(await page.evaluate(() => !document.querySelector('#swarf-run .sr-sheet.on') && localStorage.getItem('swarf-shopbot-checked') === '1'), 'done closes the card and remembers');
  // home: sensors 500 / 400 steps toward -X / -Y from here
  const at = await page.evaluate(() => {
    const st = window.__stub.state;
    st.switches = [{ port: 0, bit: 1, axis: 0, at: st.pos[0] - 500, hit: 0 }, { port: 0, bit: 2, axis: 1, at: st.pos[1] - 400, hit: 0 }];
    return [st.pos[0] - 500, st.pos[1] - 400];
  });
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent === 'home').click());
  // 10-28: home asks first ("The machine is about to home")
  await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').click());
  await page.waitForFunction(() => /^hom(ed|ing (stopped|failed))/.test(window.__swarfRun.state.machine.state.note), { timeout: 30000 });
  const homed = await page.evaluate(() => ({ note: window.__swarfRun.state.machine.state.note, pos: window.__swarfRun.state.machine.state.pos, card: window.__stub.state.pos.slice(0, 2), dro: [...document.querySelectorAll('.sr-axis .v')].map(e => e.textContent) }));
  const u = 72.183661;
  check(homed.note.startsWith('homed') && Math.abs(homed.card[0] - (at[0] + 12.7 * u)) <= 20 && Math.abs(homed.card[1] - (at[1] + 12.7 * u)) <= 20 && homed.dro[0] === '0.000',
    `home: ${homed.note}; card ${homed.card} vs expected ~${Math.round(at[0] + 12.7 * u)},${Math.round(at[1] + 12.7 * u)}; DRO ${homed.dro.join(' ')}`);
  await page.screenshot({ path: `${OUT}/0-homed.png` });
  await page.evaluate(() => { window.__stub.state.switches = []; });
  await page.evaluate(() => window.__swarfRun.state.machine.zero('xyz'));
  await page.screenshot({ path: `${OUT}/1-connected.png` });
  const x0 = await page.evaluate(() => window.__stub.state.pos[0]);
  await page.evaluate(() => [...document.querySelectorAll('.sr-modes button')].find(b => b.textContent === '10').click());
  const labels = await page.$$eval('.sr-pad button', bs => bs.map(b => b.dataset.axis));
  await (await page.$$('.sr-pad button'))[labels.indexOf('+X')].click();
  await page.waitForFunction(() => !window.__swarfRun.state.machine.busy(), { timeout: 10000 });
  await new Promise(r => setTimeout(r, 300));
  const x = await page.$eval('.sr-axis .v', e => e.textContent);
  const dx = await page.evaluate(() => window.__stub.state.pos[0]) - x0;
  check(Math.abs(parseFloat(x) - 10) < 0.02 && dx === 722, `jog +X 10 → DRO ${x}; card X +${dx} steps`);
  // 10-27 controls: keys, speed presets, typed work position, hold stops on release/blur/space
  const card = () => page.evaluate(() => [...window.__stub.state.pos]);
  const pick = (row, label) => page.evaluate((row, label) => [...document.querySelectorAll('.sr-modes')[row].querySelectorAll('button')].find(b => b.textContent === label).click(), row, label);
  await pick(0, '1'); await pick(1, '500');
  let c0 = await card();
  await page.keyboard.press('ArrowRight'); await idle();
  await page.keyboard.press('PageDown'); await idle();
  let c1 = await card();
  check(c1[0] - c0[0] === 72 && c1[2] - c0[2] === -90, `keys: → X +${c1[0] - c0[0]} steps, PageDown Z ${c1[2] - c0[2]} steps`);
  check(await page.evaluate(() => Math.abs(window.__swarfRun.state.machine.cfg.jog.xy - 500 / 60) < 1e-9), 'speed 500 mm/min reaches the jog');
  await page.click('.sr-axis .v');
  await page.keyboard.type('5'); await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 300));
  const typed = await page.$eval('.sr-axis .v', e => e.textContent), c2 = await card();
  check(typed === '5.000' && c2[0] === c1[0], `typed X 5 → DRO ${typed}, card did not move`);
  await pick(0, 'continuous');
  await page.evaluate(() => { window.__stub.state.realtime = true; });   // ticks take their real time, so a hold has a length
  for (const [how, release] of [['blur', () => page.evaluate(() => window.dispatchEvent(new Event('blur')))], ['space', () => page.keyboard.press(' ')], ['key up', () => page.keyboard.up('ArrowUp')]]) {
    const y0 = (await card())[1];
    await page.keyboard.down('ArrowUp');
    await new Promise(r => setTimeout(r, 600));
    await release();
    if (how !== 'key up') await page.keyboard.up('ArrowUp');
    const stopped = await page.waitForFunction(() => !window.__swarfRun.state.machine.busy(), { timeout: 5000 }).then(() => true, () => false);
    const dy = (await card())[1] - y0;
    check(stopped && dy > 72 * 2 && dy < 72 * 15, `hold ↑ then ${how}: stopped=${stopped}, Y +${(dy / 72.18).toFixed(1)} mm`);
  }
  await page.evaluate(() => { window.__stub.state.realtime = false; });
  await pick(0, '10'); await pick(1, 'max');
  // Z zero on the plate: contact 300 steps below here
  const zat = await page.evaluate(() => { const st = window.__stub.state; st.switches = [{ port: 0, bit: 0, axis: 2, at: st.pos[2] - 300, hit: 1 }]; return st.pos[2] - 300; });
  // the plate card (10-27): thickness, three checks, a touch proves the circuit, then touch off, then put away
  const sheetGo = () => page.evaluate(() => { const g = document.querySelector('#swarf-run .sr-sheet.on .go'); const t = g.textContent; g.click(); return t; });
  const goState = () => page.evaluate(() => { const g = document.querySelector('#swarf-run .sr-sheet.on .go'); return { t: g.textContent, d: g.disabled }; });
  await new Promise(r => setTimeout(r, 600));   // one poll: the plate reads open before the guide starts
  // a first touch-off: the plate's input not yet known (a fresh browser)
  await page.evaluate(() => { const m = window.__swarfRun.state.machine; m.plateCfg.confirmed = false; });
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent === 'z plate').click());
  const shut0 = await goState();
  await page.evaluate(() => { for (const c of [...document.querySelectorAll('#swarf-run .sr-sheet.on .sr-plate input[type=checkbox]')].slice(0, 3)) c.click(); });
  const shut1 = await goState();
  const circ = await page.evaluate(() => document.querySelector('#swarf-run .sr-circuit').textContent);
  check(shut0.d && shut1.d && shut1.t === 'touch off' && /Touch the plate to the bit/.test(circ), `plate card: touch off shut until the checks (${shut0.d}) and the circuit (${shut1.d}): "${circ}"`);
  await page.evaluate(() => { const w = window.__stub.state.switches[0]; w.at0 = w.at; w.at = window.__stub.state.pos[2] + 5; });   // the hand touches the plate to the bit
  await new Promise(r => setTimeout(r, 900));
  await page.evaluate(() => { const w = window.__stub.state.switches[0]; w.at = w.at0; });                                        // and takes it away
  await page.waitForFunction(() => { const g = document.querySelector('#swarf-run .sr-sheet.on .go'); return g && !g.disabled && /works/.test(document.querySelector('#swarf-run .sr-circuit').textContent); }, { timeout: 5000 })
    .then(() => check(true, 'plate card: the touch proved the circuit, touch off opens'), () => check(false, 'plate card: the touch proved the circuit, touch off opens'));
  await sheetGo();
  await page.waitForFunction(() => /^Z ze/.test(window.__swarfRun.state.machine.state.note), { timeout: 30000 });
  await page.waitForFunction(() => /put\saway/.test(document.querySelector('#swarf-run .sr-sheet.on .sr-plate')?.textContent || ''), { timeout: 5000 });
  const putLocked = await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').disabled);
  await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on input[type=checkbox]').click());
  const last = await sheetGo();
  check(putLocked && last === 'done' && await page.evaluate(() => !document.querySelector('#swarf-run .sr-sheet.on')), 'plate guide: done waits for "put away"');
  { // 10-29 (Phil: no touch step): the plate's input now known, the next card has the checks only
    await page.evaluate(() => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent === 'z plate').click());
    await page.evaluate(() => { for (const c of [...document.querySelectorAll('#swarf-run .sr-sheet.on .sr-plate input[type=checkbox]')].slice(0, 3)) c.click(); });
    const again = await page.evaluate(() => { const c = document.querySelector('#swarf-run .sr-sheet.on .sr-circuit'); const g = document.querySelector('#swarf-run .sr-sheet.on .go'); return { shown: !!c && getComputedStyle(c).display !== 'none', open: g && !g.disabled && g.textContent === 'touch off' }; });
    check(!again.shown && again.open, `second touch-off: no touch step, touch off opens with the checks (${JSON.stringify(again)})`);
    // 10-29: search down, 60 mm by default, raised by hand and kept
    const reach = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#swarf-run .sr-sheet.on .sr-plate-t')].find(r => /search down/.test(r.textContent));
      const inp = row && row.querySelector('input'); const was = inp && inp.value;
      if (inp) { inp.value = '100'; inp.dispatchEvent(new Event('change')); }
      const m = window.__swarfRun.state.machine;
      return { was, now: m.plateCfg.travel, kept: JSON.parse(localStorage.getItem('swarf-shopbot-plate') || '{}').travel, over: document.querySelector('#swarf-run .sr-sheet.on .sr-plate label span').textContent };
    });
    check(reach.was === '60' && reach.now === 100 && reach.kept === 100 && /less than 100 mm/.test(reach.over), `search down: 60 by default, 100 typed and kept (${JSON.stringify(reach)})`);
    await page.evaluate(() => { const m = window.__swarfRun.state.machine; m.setPlateTravel(60); });
    await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === 'cancel').click());
  }
  const pz = await page.evaluate(() => ({ note: window.__swarfRun.state.machine.state.note, origin: window.__swarfRun.state.machine.origin.z, card: window.__stub.state.pos[2], dro: document.querySelectorAll('.sr-axis .v')[2].textContent }));
  const zexp = Math.round(zat - 3.0734 * 90.229567);
  check(/^Z zeroed/.test(pz.note) && Math.abs(pz.origin - zexp) <= 20 && Math.abs(parseFloat(pz.dro) - 25.4) < 0.02, `plate: ${pz.note}; Z origin ${pz.origin} vs ~${zexp}; DRO Z ${pz.dro}`);
  await page.evaluate(() => { window.__stub.state.switches = []; });
  {
    // review 10-27: tool change reopens zero; a dropout is never "Finished"; a moved card drops the zero
    const sbp = ["'UNITS:MM", "&Tool =1             'Load 6 mm flat end mill", "C9", "TR,12000", "C6", "J3,0,0,5",
      "M3,0,0,-1", "M3,40,0,-1", "M3,40,40,-1", "M3,0,40,-1", "M3,0,0,-1",
      "C7", "&Tool =2             'Load 3 mm ball end mill", "C9", "C6", "M3,0,0,-1", "M3,40,0,-1", "M3,40,40,-1", "J3,0,0,5", "C7", "END"].join('\n');
    const btn = t => page.evaluate(t => { const b = [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t && b.offsetParent); if (!b) throw new Error('no button ' + t); b.click(); }, t);
    const ui = () => page.evaluate(() => ({ say: document.querySelector('.sr-say').textContent, step: (document.querySelector('.sr-step.now') || {}).dataset?.step,
      from: document.querySelector('.sr-from').style.display !== 'none', go: [...document.querySelectorAll('.sr-goto button')].filter(b => b.offsetParent).map(b => b.textContent),
      plan: document.querySelector('.sr-plan').textContent, z: parseFloat(document.querySelectorAll('.sr-axis .v')[2].textContent) }));
    const runCut = async (label) => {
      await btn(label);
      await page.waitForFunction(() => document.querySelector('#swarf-run .sr-sheet.on .go'), { timeout: 5000 });
      await page.evaluate(() => { for (const c of document.querySelectorAll('.sr-sheet.on input[type=checkbox]')) c.click(); });
      return page.evaluate(() => [...document.querySelectorAll('.sr-sheet.on label span')].map(s => s.textContent));
    };
    await page.evaluate(t => window.__swarfRun.loadProgram('two-bits.sbp', t, 'file'), sbp);
    await btn('zero x y'); await btn('zero z');
    let u = await ui();
    check(/bit +6 mm flat end mill, then 3 mm ball end\smill/.test(u.plan) && /the file asked 12,000/.test(u.plan) && /router/.test(u.plan) && /✓ millimeters/.test(u.plan) && u.go.includes('go to x y 0'), `plan names the bits, rpm, checks; go-to shown after zero [${u.go}]`);
    // 10-28: trace asks first, like cut
    await runCut('trace'); await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').click()); await idle();
    await new Promise(r => setTimeout(r, 300));
    const items = await runCut('cut');
    check(items.some(t => /6 mm flat end mill/.test(t)) && items.some(t => /setting 2 \(13,000 rpm; the file asked 12,000\)/.test(t)), `checklist names the bit and the router speed [${items.join(' | ')}]`);
    const goSheet = () => page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').click());
    await goSheet();
    await page.waitForFunction(() => !window.__swarfRun.state.machine.state.running && window.__swarfRun.state.machine.state.toolChange, { timeout: 20000 });
    await idle();
    u = await ui();
    check(u.step === 'zero' && /Tool change at line \d+: put in the 3 mm ball end mill/.test(u.say) && Math.abs(u.z - 50) < 0.05 && u.from, `tool change: step ${u.step}, Z ${u.z}, "${u.say.slice(0, 70)}…"`);
    // Phil 10-29: the router's own switch stays on; swarf switches it, tool changes included
    check(/stopped turning/.test(u.say) && !/off at its own switch/.test(u.say), 'tool change: wait for the bit, never switch the router off');
    await btn('zero z');
    u = await ui();
    check(u.step === 'cut' && u.from, `after zero z: step ${u.step} (trace kept), continue shown`);
    // dropout mid-cut
    await page.evaluate(() => { window.__stub.state.realtime = true; });
    const line = await page.evaluate(() => document.querySelector('.sr-from input').value);
    await runCut(`continue from line ${line}`);
    await goSheet();
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.running, { timeout: 5000 });
    // 10-29 (Phil): the feed override shows while a job runs; +5% raises it, cuts only
    await new Promise(r => setTimeout(r, 300));
    const ov = await page.evaluate(() => { const r = document.querySelector('#swarf-run .sr-ovr'); const shown = r && getComputedStyle(r).display !== 'none'; const up = [...r.querySelectorAll('button')].find(b => b.textContent === '+5%'); if (up) up.click(); return { shown, after: window.__swarfRun.state.machine.state.override, plan: window.__swarfRun.state.machine.planner.override }; });
    check(ov.shown && ov.after === 105 && Math.abs(ov.plan - 1.05) < 1e-9, `feed override while running: +5% → ${ov.after}% (${JSON.stringify(ov)})`);
    // any key pauses a running job, router off, all of control greyed (10-27)
    await page.keyboard.press('k');
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.paused, { timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    const pv = await page.evaluate(() => ({ veil: document.querySelector('#swarf-run .sr-veil').classList.contains('on'),  outs: window.__stub.state.outs & 1, paused: window.__swarfRun.state.machine.state.paused, way: (document.querySelector('#swarf-run .sr-veil .sr-way') || {}).textContent || '', btn: [...document.querySelectorAll('#swarf-run .sr-veil button')].map(b => b.textContent).join('|') }));
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/veil-resume.png` });
    // the resume is a plan of its own, shown before it runs (third review #5)
    check(/^The way back in: up to 25 mm, (the router on, )?(slowly down to Z|over to)/.test(pv.way), `the veil shows the way back in: "${pv.way}"`);
    check(/router on/.test(pv.way) === /start the router/.test(pv.btn), `the resume button says what it does: ${pv.btn}`);
    await page.keyboard.press('Enter');   // no key resumes
    await new Promise(r => setTimeout(r, 200));
    const still = await page.evaluate(() => window.__swarfRun.state.machine.state.paused);
    check(pv.veil && pv.paused && pv.outs === 0 && still, `any key pauses: veil ${pv.veil}, router bit ${pv.outs}, Enter leaves it paused ${still}`);
    await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-veil button')].find(b => /resume/.test(b.textContent) && b.offsetParent).click());
    await page.waitForFunction(() => !window.__swarfRun.state.machine.state.paused, { timeout: 5000 }).catch(async () => { console.log('not resumed:', await page.evaluate(() => window.__swarfRun.state.machine.state.note)); });
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => window.__unplug());
    await page.waitForFunction(() => !window.__swarfRun.state.machine.state.running, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 300));
    u = await ui();
    check(/USB link dropped at line \d+/.test(u.say) && !/Finished/.test(u.say) && u.from, `dropout: "${u.say.slice(0, 80)}…"`);
    await page.evaluate(() => { window.__stub.state.realtime = false; window.__replug(); });
    await btn('connect');
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.connected, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 300));
    u = await ui();
    // 10-28 follow-up review #4: an unmoved count is not proof; the zero comes back only when the student says so
    const offer = await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-keepzero'); return b && b.offsetParent ? b.textContent : ''; });
    check(u.step === 'zero' && /have not moved since the link dropped/.test(offer), `reconnect, card unmoved: zero offered, not taken (step ${u.step}; "${offer.slice(0, 60)}")`);
    await page.evaluate(() => document.querySelector('#swarf-run .sr-keepzero').click());
    await new Promise(r => setTimeout(r, 200));
    u = await ui();
    check(u.step === 'cut' && u.from, `the student vouches for the zero: step ${u.step}, continue shown`);
    // unplug again, card position moves (a restart): zero must go
    await page.evaluate(() => window.__unplug());
    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate(() => { window.__stub.state.pos[0] += 5000; window.__replug(); });
    await btn('connect');
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.connected, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 300));
    // 051: a dropped link latches a fault; the four checks and "all clear" come before anything else
    const latched = await page.evaluate(() => !!window.__swarfRun.state.fault);
    await page.evaluate(() => { window.__swarfRun.state.hold = null; });
    await page.click('#swarf-run .sr-actions .cut'); await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => /all clear/.test(b.textContent)).click()); await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => { for (const c of document.querySelectorAll('#swarf-run .sr-sheet.on input[type=checkbox]')) c.click(); [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === 'all clear').click(); });
    await page.evaluate(() => { window.__swarfRun.state.hold = null; window.__swarfRun.card(null); }); await new Promise(r => setTimeout(r, 300));
    check(latched && await page.evaluate(() => !window.__swarfRun.state.fault), 'a dropped link latches a fault; all clear clears it');
    u = await ui();
    check(u.step === 'zero' && /lost its position/.test(u.say) && !u.go.some(t => /go to/.test(t)), `reconnect, card moved: "${u.say.slice(0, 60)}…", go-to hidden`);
    await page.screenshot({ path: `${OUT}/5-review.png` });
    // 10-29: disconnect lets go of the box (Windows: ShopBot 3 can then open its COM port); connect comes back
    await btn('zero x y'); await btn('zero z');   // a zero to keep across the reconnect
    const disc = await page.evaluate(() => { const b = [...document.querySelectorAll('#swarf-run .sr-conn button')].find(b => b.textContent === 'disconnect'); return b && getComputedStyle(b).display !== 'none' ? (b.click(), true) : false; });
    await new Promise(r => setTimeout(r, 400));
    const after = await page.evaluate(() => ({ c: window.__swarfRun.state.machine.state.connected, btns: [...document.querySelectorAll('#swarf-run .sr-conn button')].filter(b => getComputedStyle(b).display !== 'none').map(b => b.textContent) }));
    check(disc && !after.c && after.btns.join() === 'connect', `disconnect: shown while connected, lets go, connect comes back [${after.btns}]`);
    // 10-29 (Phil): not connected, everything that needs the machine greys out
    const grey = await page.evaluate(() => ({ jog: document.querySelector('#swarf-run .sr-jog').classList.contains('offline'), op: getComputedStyle(document.querySelector('#swarf-run .sr-pad')).opacity, cut: document.querySelector('#swarf-run .sr-actions .cut').disabled, conn: getComputedStyle(document.querySelector('#swarf-run .sr-conn')).opacity }));
    check(grey.jog && +grey.op < 0.5 && grey.cut && +grey.conn > 0.9, `offline: jog greyed, cut off, connect live (${JSON.stringify(grey)})`);
    await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-conn button')].find(b => b.textContent === 'connect').click());
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.connected, { timeout: 8000 }).then(() => check(true, 'connects again after disconnect'), () => check(false, 'connects again after disconnect'));
    // 10-29 (Phil: "just confirm that 0 is right"): the zero is offered back, not thrown away
    await new Promise(r => setTimeout(r, 500));
    const kz = await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-keepzero'); return b && getComputedStyle(b).display !== 'none' ? b.textContent : ''; });
    check(/since you disconnected: use the zero from/.test(kz), `after a reconnect swarf asks to keep the zero ("${kz.slice(0, 70)}")`);
    if (kz) { await page.evaluate(() => document.querySelector('#swarf-run .sr-keepzero').click()); await new Promise(r => setTimeout(r, 300)); }
    check(await page.evaluate(() => window.__swarfRun.state.zeroXY && window.__swarfRun.state.zeroZ), 'one press keeps it');
  }
  { // 10-29 (Phil): the e-stop lets go of the machine; connect clears it, no all-clear checklist
    const pre = await page.evaluate(() => { const m = window.__swarfRun.state.machine; const r = { c: m.state.connected, note: m.state.note, busy: m.busy() }; m.jog('x', 150); return r; });
    const mv = await page.waitForFunction(() => window.__swarfRun.state.machine.state.moving, { timeout: 5000 }).then(() => true, () => false);
    await page.evaluate(() => { const s = window.__stub.state; s.inputs[0] ^= 0x80; setTimeout(() => { s.inputs[0] ^= 0x80; }, 120); });
    await page.waitForFunction(() => !window.__swarfRun.state.machine.state.connected, { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    const e1 = await page.evaluate(() => ({ c: window.__swarfRun.state.machine.state.connected, say: document.querySelector('.sr-say').textContent, fault: window.__swarfRun.state.fault, note: window.__swarfRun.state.machine.state.note, est: window.__swarfRun.state.machine.state.estopped, x: window.__swarfRun.state.machine.state.pos.x }));
    check(!e1.c && /e-stop stopped the machine[\s\S]*press\sconnect/.test(e1.say) && !e1.fault, `e-stop: swarf lets go and says so ("${e1.say.slice(0, 90)}")`);
    await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-conn button')].find(b => b.textContent === 'connect').click());
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.connected, { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    const e2 = await page.evaluate(() => ({ c: window.__swarfRun.state.machine.state.connected, fault: window.__swarfRun.state.fault, say: document.querySelector('.sr-say').textContent }));
    check(e2.c && !e2.fault && !/e-stop/.test(e2.say), `connect after the e-stop clears it ("${e2.say.slice(0, 70)}")`);
    await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-keepzero'); if (b && getComputedStyle(b).display !== 'none') b.click(); });
  }
  { // 10-29 (Phil): the router button sits outside the jog grid, in the corner
    const where = await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-router'); return { inPad: !!b.closest('.sr-pad'), row: !!b.closest('.sr-keyrow') }; });
    check(!where.inPad && where.row, `router button out of the jog grid (${JSON.stringify(where)})`);
  }
  { // 10-29 (Phil): the router test button: asks, red while on, one press off
    const vis = await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-router'); return b && getComputedStyle(b).display !== 'none'; });
    await page.evaluate(() => document.querySelector('#swarf-run .sr-router').click());
    const ask = await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on h2')?.textContent || '');
    await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').click());
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.routerTest, { timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 600));   // the skin's color transition
    const on = await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-router'); return { cls: b.classList.contains('on'), bg: getComputedStyle(b).backgroundColor,  outs: window.__stub.state.outs & 1 }; });
    await page.evaluate(() => document.querySelector('#swarf-run .sr-router').click());
    await page.waitForFunction(() => !window.__swarfRun.state.machine.state.routerTest, { timeout: 5000 }).catch(() => {});
    const off = await page.evaluate(() => ({ cls: document.querySelector('#swarf-run .sr-router').classList.contains('on'),  outs: window.__stub.state.outs & 1 }));
    check(vis && /router\sis\sabout\sto\sstart/.test(ask) && on.cls && on.outs === 1 && /179, 38, 30/.test(on.bg) && !off.cls && off.outs === 0, `router button: asks ("${ask}"), red while on (${on.bg}), off on the next press (${JSON.stringify(off)})`);
  }
  { // 10-29: an inch file (VCarve's ShopBot post) runs; the cut checklist has the size in inches and mm
    const inch = ["'UNITS:INCHES", 'IF %(25)=1 THEN GOTO UNIT_ERROR', 'SA', 'CN, 90', '&PWZorigin = Material Surface', '&Tool = 1', 'C9', 'TR,18000', 'C6', 'MS,1.0,0.5',
      'JZ,0.2', 'J3,1,1,0.2', 'M3,1,1,-0.125', 'M3,3,1,-0.125', 'M3,3,2,-0.125', 'JZ,0.2', 'C7', 'END', 'UNIT_ERROR:', 'CN, 91', 'END'].join('\n');
    await page.evaluate(() => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === 'zero x y').click());
    await page.evaluate(() => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === 'zero z').click());
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate((t) => window.__swarfRun.loadProgram('vcarve-inch.sbp', t, 'file'), inch);
    await new Promise(r => setTimeout(r, 400));
    // 10-29 (Phil): a new file keeps the board's zero with one press, no re-zeroing
    const kz2 = await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-keepzero'); return b && getComputedStyle(b).display !== 'none' ? b.textContent : ''; });
    if (kz2) await page.evaluate(() => document.querySelector('#swarf-run .sr-keepzero').click());
    await new Promise(r => setTimeout(r, 200));
    const kept = await page.evaluate(() => ({ xy: window.__swarfRun.state.zeroXY, z: window.__swarfRun.state.zeroZ }));
    check(/use the zero you set at .* \(X Y and Z\)/.test(kz2) && kept.xy && kept.z, `a new file: one press keeps the zero ("${kz2.slice(0, 60)}", ${JSON.stringify(kept)})`);
    for (const t of ['zero x y', 'zero z']) {
      await page.evaluate(t => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t); if (b) b.click(); }, t);
      await new Promise(r => setTimeout(r, 300));
    }
    await page.evaluate(() => { window.__swarfRun.state.traced = true; window.__swarfRun.card && window.__swarfRun.card(null); });
    const r = await page.evaluate(() => {
      const c = document.querySelector('#swarf-run .sr-actions .cut'); if (c && !c.disabled) c.click();
      const items = [...document.querySelectorAll('#swarf-run .sr-sheet.on label span')].map(e => e.textContent);
      const bad = document.querySelector('#swarf-run .sr-sheet.on .sr-way.bad');
      const out = { items, bad: bad && bad.textContent, blocked: c && c.disabled, title: c && c.title };
      const no = [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === 'not yet'); if (no) no.click();
      return out;
    });
    check(!r.blocked && !r.bad && r.items.some(t => /in inches: its cut is 2 × 1 in \(50\.8 × 25\.4 mm\), 0\.125 in \(3\.2 mm\) deep/.test(t)), `inch file: runs, checklist in both units [${r.items.find(t => /inches/.test(t)) || r.bad || r.title}]`);
  }
  if (FILE) {
    await page.evaluate((t) => window.__swarfRun.loadProgram('part.sbp', t, 'file'), readFileSync(FILE, 'latin1'));
    await new Promise(r => setTimeout(r, 500));
    for (const t of ['zero x y', 'zero z']) {
      await page.evaluate(t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t).click(), t);
      await new Promise(r => setTimeout(r, 300));
    }
    await page.screenshot({ path: `${OUT}/2-loaded.png` });
    const p7before = await page.evaluate(() => window.__stub.state.outs);
    await page.evaluate(() => document.querySelector('.sr-actions .trace').click());
    await page.evaluate(() => { for (const c of document.querySelectorAll('.sr-sheet.on input[type=checkbox]')) c.click(); document.querySelector('#swarf-run .sr-sheet.on .go').click(); });
    await page.waitForFunction(() => window.__swarfRun.state.machine.state.running, { timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}/3-tracing.png` });
    await page.waitForFunction(() => !window.__swarfRun.state.machine.state.running, { timeout: 120000 });
    const end = await page.evaluate(() => ({ note: window.__swarfRun.state.machine.state.note,  outs: window.__stub.state.outs, say: document.querySelector('.sr-say').textContent }));
    check(end.note === 'program finished', `trace: ${end.note} — "${end.say}"`);
    check(end.outs === p7before, `trace left outputs alone (outputs ${p7before} → ${end.outs})`);
    await page.screenshot({ path: `${OUT}/4-traced.png` });
  }
} finally {
  await browser.close();
}
for (const p of problems) console.log('PROBLEM', p);
console.log(fail || problems.length ? `direct ui: ${fail} failed, ${problems.length} page problems` : 'direct ui: ok');
process.exit(fail || problems.length ? 1 : 0);
