// every bit start lifts to the first point's height before the router lines, on both machines
import assert from 'node:assert/strict';
import { runFiles, MR1, SB, tool, level } from './harness.mjs';
const T1 = tool(1, 1, '1/4 flat'), T2 = tool(2, 2, '1/8 flat');
const proc = { camFastFeed: 6000, camFastFeedZ: 300, camFirstZMax: true, camOriginTop: true, camToolInit: true };
const levels = () => [
  level([[0, 0, 25, 0, 0], [10, 10, 25, 0, 0], [10, 10, 15, 1, 300], [20, 10, 15, 1, 2280]], T1, 8000, 0),
  level([[20, 10, 25, 0, 0], [30, 30, 25, 0, 0], [30, 30, 10, 1, 300], [40, 30, 10, 1, 1000]], T2, 8000, 1),
];
const spindleOn = { MR1: /^M0?3\b/, SB: /^C6\b/ };
for (const [name, dev] of [['MR1', MR1], ['SB', SB]]) {
  const r = runFiles(dev, proc, { x: 100, y: 100, z: 19.05 }, { x: -50, y: 50, z: 19.06 }, levels());
  const texts = r.files && r.files.length ? r.files.map(f => f.text) : [r.text];
  let starts = 0;
  for (const t of texts) {
    const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let lifted = false;
    for (const l of lines) {
      if (/^G0 Z[\d.]+/.test(l)) lifted = true;
      if (spindleOn[name].test(l)) { starts++; assert.ok(lifted, `${name}: router on before the lift\n${t}`); }
      if (/^(C7|M0?5\b|&Tool|C9|T\d)/.test(l)) lifted = false;
      if (/^G[01] .*Z-/.test(l)) lifted = false;
    }
  }
  assert.ok(starts >= 2, `${name}: ${starts} router starts, wanted one per bit`);
  console.log(`${name}: ${texts.length} file(s), ${starts} router starts, each after the lift`);
}
console.log('bit start: lift before the router: ok');
