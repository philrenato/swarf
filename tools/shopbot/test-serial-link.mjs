// The Windows link (Web Serial, ShopBotSerial) against the stand-in card: on a Windows browser
// swarf picks the COM port, runs a cut through it, and a port ShopBot 3 holds is named as that.
// The Mac still picks WebUSB.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');

// A Web Serial port in front of the stub card, as Chrome on Windows shows the box's COM port.
function fakePort(card, { busy = false } = {}) {
  const port = { info: { usbVendorId: 0x10c4, usbProductId: 0x83c4 }, opts: null, signals: [], readable: null, writable: null, closed: false };
  port.getInfo = () => port.info;
  port.open = async opts => {
    if (busy) throw Object.assign(new Error('Failed to open serial port.'), { name: 'NetworkError' });
    port.opts = opts;
    let ctl;
    port.readable = new ReadableStream({ start(c) { ctl = c; } });
    card.onData = b => { try { ctl.enqueue(Uint8Array.from(b)); } catch (e) { /* closed */ } };
    port.writable = new WritableStream({ write(b) { card.write(Uint8Array.from(b)); } });
    port.ctl = ctl;
  };
  port.setSignals = async s => { port.signals.push(s); };
  port.getSignals = async () => ({ clearToSend: false, dataSetReady: false, ringIndicator: false, dataCarrierDetect: false });
  port.close = async () => { port.closed = true; port.readable = null; };
  return port;
}

function page(platform, nav) {
  const store = {};
  const win = { navigator: { platform, userAgent: platform, ...nav }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
    ReadableStream, WritableStream,
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  win.window = win;
  vm.createContext(win);
  for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
    vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
  return win;
}
const done = m => new Promise(r => { const t = setInterval(() => { if (!m.state.running) { clearInterval(t); r(); } }, 20); });

{ // Windows: the COM port, 921600 8N1, no flow control, DTR/RTS low; a cut runs through it
  const card = StubCard();
  const port = fakePort(card);
  const usbDev = new FakeCP210x(StubCard());
  const win = page('Win32', { serial: { getPorts: async () => [port], requestPort: async () => port }, usb: fakeUSB(usbDev) });
  assert.equal(win.ShopBotLink.kind(), 'serial', 'Windows picks Web Serial');
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.ok(await m.connect(false), `connects over the COM port (${m.state.note})`);
  assert.equal(usbDev.opened, false, 'WebUSB never touched on Windows');
  assert.deepEqual({ ...port.opts }, { baudRate: 921600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
  assert.deepEqual({ ...port.signals[0] }, { dataTerminalReady: false, requestToSend: false });
  const P = win.SwarfRunParse, R = win.SwarfRunPlan;
  const sbp = ['SA', 'C6', 'PAUSE 0.05', 'J3,0,0,5', 'M3,10,0,-1', 'M3,10,10,-1', 'J3,10,10,5', 'C7', 'END'].join('\n');
  m.zero('xyz');
  const parsed = P.parse(sbp);
  const plan = m.plan({ name: 'w', moves: parsed.moves, sbp, spindle: true });
  m.run(R.arm(plan));
  await done(m);
  console.log('windows cut:', m.state.note, '| pos', m.state.pos);
  assert.equal(m.state.note, 'program finished');
  assert.ok(Math.abs(m.state.pos.x - 10) < 0.02 && Math.abs(m.state.pos.y - 10) < 0.02 && Math.abs(m.state.pos.z - 5) < 0.02, 'ends where the file ends');
  assert.equal(card.state.outs & 1, 0, 'router off at the end');
  // disconnect lets go of the COM port (for ShopBot 3), outputs off; connect takes it back
  assert.ok(await m.disconnect(), m.state.note);
  assert.ok(port.closed && !m.state.connected && /free for another program/.test(m.state.note), 'disconnect closes the port');
  assert.equal(card.state.outs & 1, 0, 'outputs off at disconnect');
  port.closed = false;
  assert.ok(await m.connect(false), `connects again after a disconnect (${m.state.note})`);
  // an unplug ends the link and is a lost link, never a finish
  port.readable = null; port.ctl.error(new Error('The device has been lost.'));
  await new Promise(r => setTimeout(r, 50));
  assert.equal(m.state.connected, false, 'an unplugged COM port is a lost link');
}
{ // Windows, ShopBot 3 open: the port is held; swarf says to quit ShopBot 3, and nothing is sent
  const card = StubCard();
  let wrote = 0; const w = card.write; card.write = b => { wrote++; return w(b); };
  const port = fakePort(card, { busy: true });
  const win = page('Win32', { serial: { getPorts: async () => [port], requestPort: async () => port } });
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.equal(await m.connect(false), false);
  console.log('windows busy:', m.state.note);
  assert.match(m.state.note, /ShopBot 3/);
  assert.equal(wrote, 0, 'nothing reached the card');
}
{ // a COM port that is not the ShopBot is never picked
  const port = fakePort(StubCard());
  port.info = { usbVendorId: 0x10c4, usbProductId: 0xea60 };
  const win = page('Win32', { serial: { getPorts: async () => [port], requestPort: async () => port } });
  assert.equal(await win.ShopBotLink.known(), null);
}
{ // the Mac: WebUSB, as before, even though Chrome on the Mac has Web Serial too
  const dev = new FakeCP210x(StubCard());
  const win = page('MacIntel', { usb: fakeUSB(dev), serial: { getPorts: async () => [], requestPort: async () => null } });
  assert.equal(win.ShopBotLink.kind(), 'usb');
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.ok(await m.connect(false));
  assert.equal(dev.uart.baud, 921600);
}
{ // a student's Windows laptop: no ShopBot software, the box on WinUSB (Zadig): no COM port, WebUSB opens it
  const dev = new FakeCP210x(StubCard());
  const win = page('Win32', { serial: { getPorts: async () => [], requestPort: async () => { throw Object.assign(new Error('No port selected by the user.'), { name: 'NotFoundError' }); } }, usb: fakeUSB(dev) });
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.ok(await m.connect(false), `a known WinUSB box connects (${m.state.note})`);
  assert.equal(dev.uart.baud, 921600);
  assert.equal(win.localStorage.getItem('swarf-shopbot-link'), 'usb', 'remembers the USB way in');
  // first time: the COM port chooser finds nothing, then the USB chooser offers the box
  const dev2 = new FakeCP210x(StubCard());
  let asked = [];
  const win2 = page('Win32', { serial: { getPorts: async () => [], requestPort: async () => { asked.push('serial'); throw Object.assign(new Error('No port selected by the user.'), { name: 'NotFoundError' }); } },
    usb: { getDevices: async () => [], requestDevice: async () => { asked.push('usb'); return dev2; } } });
  const m2 = new win2.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.ok(await m2.connect(true), `asked: ${asked}`);
  assert.deepEqual(asked, ['serial', 'usb']);
}
console.log('serial link: ok');
process.exit(0);
