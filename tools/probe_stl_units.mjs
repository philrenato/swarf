// An STL has no units. swarf reads its numbers as mm or as inches, whichever fits the bed (both:
// the units switch), and a card says which, with one press to switch and one undo to go back.
//   - a 120 x 80 x 20 box with swarf in inches: read as mm (as inches it would be 3 m across)
//   - a 2 x 3 x 0.75 box with swarf in mm: read as inches (as mm it is under 1 mm thick)
//   - the card switches the reading (x 25.4), undo puts it back
//   node tools/probe_stl_units.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const box = (x, y, z) => {
  const v = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return 'solid b\n' + f.map(t => ` facet normal 0 0 0\n  outer loop\n${t.map(i => `   vertex ${v[i].join(' ')}`).join('\n')}\n  endloop\n endfacet`).join('\n') + '\nendsolid b\n';
};
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-stlu-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_files && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  const units = u => page.evaluate(u => [...document.querySelectorAll('#swarf-units button')].find(b => b.textContent === u).click(), u).then(() => wait(800));
  const load = (text, name) => page.evaluate((t, n) => { const a = window.kiri.api; a.platform.clear(); a.platform.load_files([new File([t], n)]); }, text, name).then(() => wait(2500));
  const size = () => page.evaluate(() => { const w = window.kiri.api.widgets.all()[0]; const s = w.getBoundingBox().getSize(new window.THREE.Vector3()); return [s.x, s.y, s.z].map(v => +v.toFixed(2)); });
  const card = () => page.evaluate(() => { const c = document.querySelector('.swarf-stl-units'); return c && c.offsetParent ? c.innerText : ''; });
  const closeCard = () => page.evaluate(() => [...document.querySelectorAll('.swarf-stl-units button')].find(b => b.textContent === 'done')?.click()).then(() => wait(400));

  await units('in');
  await load(box(120, 80, 20), 'frame.stl');
  check(JSON.stringify(await size()) === '[120,80,20]', `inches set, a 120 x 80 x 20 box comes in as mm (${await size()})`);
  const c1 = await card();
  check(/which units/.test(c1) && /came in as millimeters/.test(c1), `the card says it came in as millimeters ("${c1.replace(/\s+/g, ' ').slice(0, 120)}")`);
  // switch to inches and back by undo
  await page.evaluate(() => document.querySelector('.swarf-stl-units input[value="in"]').click());
  await wait(800);
  check(JSON.stringify(await size()) === '[3048,2032,508]', `inches pressed: x 25.4 (${await size()})`);
  await closeCard();
  await page.evaluate(() => window.kiri.api.doit.undo());
  await wait(800);
  check(JSON.stringify(await size()) === '[120,80,20]', `undo: back to mm (${await size()})`);

  await units('mm');
  await load(box(2, 3, 0.75), 'block.stl');
  check(JSON.stringify(await size()) === '[50.8,76.2,19.05]', `mm set, a 2 x 3 x 0.75 box comes in as inches (${await size()})`);
  check(/came in as inches/.test(await card()), 'the card says it came in as inches');
  await closeCard();
  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
