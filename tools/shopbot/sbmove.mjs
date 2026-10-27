// Drive the real box from Node via DirectMachine.  node sbmove.mjs [axis dist speed]
import fs from 'node:fs'; import vm from 'node:vm'; import { createRequire } from 'node:module';
const K = new URL('../../web/kiri/', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { WebUSB } = require('usb');
// Saved settings (flip, home, origin) live in a JSON file, like the app's localStorage.
const STORE = process.env.SBSTORE || new URL('./sbmove-store.json', import.meta.url).pathname;
const store = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : {};
const win = { navigator: { usb: new WebUSB({ allowAllDevices: true }) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); fs.writeFileSync(STORE, JSON.stringify(store, null, 1)); } } };
win.window = win; vm.createContext(win);
for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
  vm.runInContext(fs.readFileSync(K + f, 'utf8'), win, { filename: f });
const m = new win.SwarfRunMachine.DirectMachine({});
const t0 = Date.now();
const ok = await m.connect(false);
console.log('connect:', ok, '|', m.state.note);
const show = () => console.log('pos', JSON.stringify(m.state.pos), 'inputs lo', (m.state.inputs?.lo ?? 0).toString(2).padStart(8, '0'), 'hi', (m.state.inputs?.hi ?? 0).toString(2).padStart(4, '0'));
if (ok) {
  show();
  const [axis, dist, speed] = process.argv.slice(2);
  if (axis === 'circle') {
    // circle D mm/s: clockwise seen from above, starting and ending here, centre D/2 toward +X.
    // Optional 4th arg: Z drop in mm before the circle, raised again after (at 5 mm/s).
    const r = Number(dist) / 2, f = Number(speed), p0 = { ...m.state.pos }, c = { x: p0.x + r, y: p0.y }, n = 120, ops = [];
    const drop = Number(process.argv[5] || 0), zc = p0.z - drop;
    if (drop) ops.push(Object.assign(m.machine({ x: p0.x, y: p0.y, z: zc }), { feed: 5, line: 0 }));
    for (let i = 1; i <= n; i++) {
      const a = Math.PI - 2 * Math.PI * i / n;         // from the -X side, angle decreasing = clockwise
      ops.push(Object.assign(m.machine({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), z: zc }), { feed: f, line: i }));
    }
    if (drop) ops.push(Object.assign(m.machine({ x: p0.x, y: p0.y, z: p0.z }), { feed: 5, line: n + 1 }));
    console.log(`circle ${dist} mm diameter at ${f} mm/s, ${n} segments, centre`, JSON.stringify(c));
    const t = Date.now();
    try { await m.stack(ops); } catch (e) { console.log('move error', e.message); }
    console.log(`took ${((Date.now() - t) / 1000).toFixed(1)} s`); show(); console.log(m.state.note);
  } else if (axis) {
    const t = { ...m.state.pos }; t[axis] += Number(dist);
    console.log(`moving ${axis} by ${dist} mm at ${speed} mm/s`);
    try { await m.stack([Object.assign(m.machine(t), { feed: Number(speed), line: 0 })]); } catch (e) { console.log('move error', e.message); }
    show(); console.log(m.state.note);
  }
}
fs.writeFileSync(process.env.SBLOG || 'traffic.txt', m.logText ? m.logText() : '');
if (m.link) await m.link.close();
process.exit(0);
