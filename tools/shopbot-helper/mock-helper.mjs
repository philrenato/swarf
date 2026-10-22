// Stand-in for ShopBotHelper.ps1 on a Mac: same endpoints and JSON, a pretend
// ShopBot behind them. For testing Run mode's bridge path without the laptop.
//   node tools/shopbot-helper/mock-helper.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../../web/kiri/swarf-run-parse.js');
const ORIGINS = ['https://renato.design', 'http://localhost:8080', 'http://127.0.0.1:8080'];
const sb = { pos: { x: 0, y: 0, z: 25.4 }, status: 0, spindle: false, dialog: null, queue: [], path: [], abs: true, preview: false, cmds: [] };
const speed = 400; // mm/s, fast so tests finish
setInterval(() => {
  let budget = speed * 0.05;
  while (budget > 0 && sb.path.length && !(sb.status & 8)) {
    const t = sb.path[0], p = sb.pos;
    const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
    if (d <= budget) { sb.pos = { ...t }; sb.path.shift(); budget -= d; }
    else { const f = budget / d; p.x += (t.x - p.x) * f; p.y += (t.y - p.y) * f; p.z += (t.z - p.z) * f; budget = 0; }
  }
  if (!sb.path.length) { sb.status &= ~(1 | 32); sb.spindle = false; }
  else sb.status |= 32;
  // take one command per tick, like ShopBot clearing uCommand
  if (sb.queue.length && !sb.dialog) exec(sb.queue.shift());
}, 50);
function exec(c) {
  sb.cmds.push(c);
  const [k, ...a] = c.split(',');
  const n = i => a[i] === undefined || a[i] === '' ? undefined : +a[i];
  const go = (x, y, z) => sb.path.push({ x: x ?? last().x, y: y ?? last().y, z: z ?? last().z });
  const last = () => sb.path.length ? sb.path[sb.path.length - 1] : sb.pos;
  switch (k.trim().toUpperCase()) {
    case 'SA': sb.abs = true; break;
    case 'JX': go(n(0)); break; case 'JY': go(undefined, n(0)); break; case 'JZ': go(undefined, undefined, n(0)); break;
    case 'J2': go(n(0), n(1)); break;
    case 'Z2': sb.pos.x = 0; sb.pos.y = 0; break; case 'ZX': sb.pos.x = 0; break; case 'ZY': sb.pos.y = 0; break;
    case 'ZZ': sb.pos.z = 0; break; case 'Z3': sb.pos = { x: 0, y: 0, z: 0 }; break;
    case 'C3': go(undefined, undefined, 25.4); go(0, 0); break;
    case 'SP': sb.preview = true; break; case 'SM': sb.preview = false; break;
    case 'FP': {
      const r = P.parse(sb.file || '');
      for (const m of r.moves) sb.path.push({ x: m.x, y: m.y, z: m.z });
      sb.status |= 1; if (sb.preview) sb.status |= 2; else sb.status &= ~2;
      sb.spindle = !sb.preview && r.events.some(e => e.kind === 'spindle-on');
      break;
    }
  }
}
function body(req) { return new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }
function status() {
  const st = sb.status;
  return { sb3: true, pos: sb.pos, status: st, running: !!(st & 1), preview: !!(st & 2), keypad: false, paused: !!(st & 8), moving: !!(st & 32), spindle: sb.spindle, queued: sb.queue.length, dialog: sb.dialog, note: '' };
}
http.createServer(async (req, res) => {
  const o = req.headers.origin;
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  if (o && ORIGINS.includes(o)) Object.assign(h, { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  if (o && !ORIGINS.includes(o)) { res.writeHead(403, h); return res.end('{"error":"origin not allowed"}'); }
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
  const send = (c, j) => { res.writeHead(c, h); res.end(JSON.stringify(j)); };
  const u = new URL(req.url, 'http://x').pathname;
  if (u === '/status') return send(200, status());
  if (u === '/log') { res.writeHead(200, { ...h, 'Content-Type': 'text/plain' }); return res.end(sb.cmds.join('\n')); }
  const b = await body(req);
  if (u === '/cmd') { for (const c of b.cmds || []) sb.queue.push(String(c)); return send(200, status()); }
  if (u === '/run') { sb.file = b.sbp; sb.queue.push(b.preview ? 'SP' : 'SM', `FP,C:\\SbParts\\swarf\\${b.name}.sbp,1,1,1,1,0`); return send(200, status()); }
  if (u === '/stop') { sb.path = []; sb.queue = []; sb.status = (sb.status & ~33) | 16; sb.spindle = false; if (b.quit) sb.dialog = null; else sb.dialog = { caption: 'Stopped. Continue?', message: '1 = continue; -1 = quit file' }; return send(200, status()); }
  if (u === '/answer') { sb.dialog = null; sb.status &= ~16; return send(200, status()); }
  send(404, { error: 'not found' });
}).listen(8139, 'localhost', () => console.log('mock ShopBot helper on http://localhost:8139'));
