// the speed control never offers a feed the file will not cut: at most the lower of the machine's top
// speed and the process cap (camFastFeed), and a plunge at most the lower Z limit
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'web/kiri/swarf-material.js'), 'utf8');
const body = src.slice(src.indexOf('const SHOP_WOODS'), src.indexOf('window.__swarfSpeeds = SPEEDS;'));
const atSpeed = new Function('window', body + '; return atSpeed;')({});
const dl = src.slice(src.indexOf('function deviceLimits'), src.indexOf('\n  }\n', src.indexOf('function deviceLimits')) + 4);
const deviceLimits = new Function(dl + '; return deviceLimits;')();
const mats = JSON.parse(readFileSync(join(ROOT, 'web/kiri/swarf-materials.json'), 'utf8'));
const list = Array.isArray(mats) ? mats : (mats.materials || Object.values(mats));
const proc = { camFastFeed: 6000, camFastFeedZ: 300 };
for (const devName of ['ShopBot.Basic', 'Langmuir.MR-1']) {
  const dev = JSON.parse(readFileSync(join(ROOT, `src/kiri/dev/cam/${devName}.json`), 'utf8'));
  const lim = deviceLimits({ device: dev, process: proc });
  const top = Math.min(dev.feedMax, proc.camFastFeed), topZ = Math.min(dev.feedMaxZ, proc.camFastFeedZ);
  assert.equal(lim.feedMax, top, `${devName}: the limit is the lower top speed`);
  let most = 0;
  for (const m of list) {
    for (const cutter of ['hss', 'carbide']) {
      const tool = { type: 'endmill', flute_diam: 0.25, metric: false, flute_len: 1, swarf: { cutter } };
      for (let level = 0; level <= 4; level++) {
        const r = atSpeed(m, 6.35, lim, tool, level);
        if (!r) continue;
        assert.ok(r.feed <= top, `${devName} ${m.id} ${cutter} level ${level}: feed ${r.feed} > ${top}`);
        assert.ok(r.plunge <= topZ, `${devName} ${m.id} ${cutter} level ${level}: plunge ${r.plunge} > ${topZ}`);
        most = Math.max(most, r.feed);
      }
    }
  }
  console.log(`${devName}: fastest offered feed ${most} mm/min (cap ${top}), plunge cap ${topZ}`);
}
console.log('feed caps: ok');
