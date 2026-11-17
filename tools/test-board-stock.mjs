// the board under material sets the stock while it is on; off, the stock is the one set before it
// (an absolute stock or an offset padding), and the drill's point takes a through hole all the way
//   node tools/test-board-stock.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Tool } from '../src/kiri/mode/cam/core/tool.js';

const src = fs.readFileSync(new URL('../web/kiri/swarf-material.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('  function applyBoard()'), src.indexOf('  window.__swarfBoard ='));
assert.ok(body.length > 100, 'applyBoard found');
function board(p) {
  const window = { kiri: { api: { conf: { get: () => ({ process: p }), update_fields() {}, save() {} }, function: {}, event: { emit() {} } } } };
  return new Function('window', body + '; return applyBoard;')(window);
}
const stock = p => ({ o: p.camStockOffset, x: p.camStockX, y: p.camStockY, z: p.camStockZ, a: p.camZAnchor });
for (const start of [
  { camStockOffset: false, camStockX: 300, camStockY: 200, camStockZ: 20, camZAnchor: 'top' },
  { camStockOffset: true, camStockX: 5, camStockY: 5, camStockZ: 0, camZAnchor: 'middle' },
  { camStockOffset: true, camStockX: 0, camStockY: 0, camStockZ: 0, camZAnchor: 'bottom' }
]) {
  const p = { ...start }, apply = board(p), was = stock(p);
  Object.assign(p, { swarfBoardOn: true, swarfBoardX: 150, swarfBoardY: 100, swarfBoardZ: 19.05 }); apply();
  assert.deepEqual(stock(p), { o: false, x: 150, y: 100, z: 19.05, a: 'bottom' }, 'on: the board is the stock');
  p.swarfBoardX = 160; apply();             // a size changed while on keeps the first stock to go back to
  p.swarfBoardOn = false; apply();
  assert.deepEqual(stock(p), was, `off: the stock as it was ${JSON.stringify(was)}`);
}
// a board set before the stock was kept (an older project): off is the parts' own size
const old = { camStockOffset: false, camStockX: 150, camStockY: 100, camStockZ: 19.05, camZAnchor: 'bottom', swarfBoardOn: false, swarfBoardSet: true, swarfBoardAnchor: 'middle', swarfBoardStock: '' };
board(old)();
assert.deepEqual(stock(old), { o: true, x: 0, y: 0, z: 0, a: 'middle' }, 'off with nothing kept: the parts own size');

// the point below a bit's full width
const tool = t => new Tool({ tools: [{ id: 1, number: 1, metric: true, ...t }], controller: { units: 'mm' } }, 1);
assert.ok(Math.abs(tool({ type: 'drill', flute_diam: 6.35 }).pointLength() - 1.908) < 0.01, 'a 118 degree drill');
assert.equal(tool({ type: 'ballmill', flute_diam: 6 }).pointLength(), 3, 'a ball');
assert.equal(tool({ type: 'endmill', flute_diam: 6 }).pointLength(), 0, 'a flat end mill');
assert.equal(tool({ type: 'tapermill', flute_diam: 12.7, taper_tip: 0, flute_len: 6.35 }).pointLength(), 6.35, 'a V-bit');
console.log('board stock ok');
