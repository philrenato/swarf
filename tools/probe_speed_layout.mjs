// The speed control can be seen and used: in every skin, at 1280 x 720 and 1024 x 600, on both
// machines and with each machine's longest material name, the speed select and the material select
// lie inside every ancestor that clips them and inside the window, the point at the middle of each
// is that select (nothing covers it), its label is "speed", and the numbers under it are in view.
// Then a real click focuses it, and real keys choose a level: Tab from the material select reaches
// it, a typed "m" picks max and the step's numbers change.
//   node tools/probe_speed_layout.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8793/swarf-app/';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'swarf-speed-layout-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// an element's box against the window and every ancestor whose overflow clips; and what is at its middle
const BOUNDS = ids => {
  const out = {};
  for (const id of ids) {
    const e = document.getElementById(id);
    if (!e) { out[id] = { missing: true }; continue; }
    const r = e.getBoundingClientRect(), clips = [];
    for (let a = e.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY) || a === document.documentElement) {
        const q = a.getBoundingClientRect();
        const inside = r.left >= q.left - 0.5 && r.right <= q.right + 0.5 && (/(auto|scroll)/.test(cs.overflowY) || (r.top >= q.top - 0.5 && r.bottom <= q.bottom + 0.5));
        if (!inside) clips.push(`${a.id || a.className || a.tagName} ${Math.round(q.left)}..${Math.round(q.right)} x ${Math.round(q.top)}..${Math.round(q.bottom)}`);
      }
    }
    const inWin = r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    out[id] = { box: [r.left, r.right, r.top, r.bottom].map(Math.round), w: Math.round(r.width), clips, inWin, hit: !!hit && (hit === e || e.contains(hit)) };
  }
  return out;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-speedl-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && document.getElementById('swarf-speed-select') && window.SwarfSkin), { timeout: 90000, polling: 200 });
  await wait(1500);
  const part = async () => {
    await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); });
    await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'board', { depth: 19, resolution: 2, soup: true, dpi: 0 }));
    await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 15000 });
    await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await wait(600);
  };
  for (const device of ['ShopBot.Basic', 'Langmuir.MR-1']) {
    await page.evaluate(d => window.kiri.api.devices.select(d), device); await wait(800);
    await part();
    // this machine's longest material name
    const longest = await page.evaluate(() => [...document.getElementById('swarf-material-select').options].sort((a, b) => b.textContent.length - a.textContent.length)[0].value);
    await page.evaluate(m => window.__swarfSetMaterial(m), longest); await wait(400);
    for (const skin of ['glass', 'classic', 'swarf']) {
      await page.evaluate(s => window.SwarfSkin.set(s), skin); await wait(400);
      for (const [W, H] of [[1280, 720], [1024, 600]]) {
        await page.setViewport({ width: W, height: H }); await wait(600);
        // the row scrolled into its panel, as a person would
        await page.evaluate(() => document.getElementById('swarf-speed-row').scrollIntoView({ block: 'nearest' }));
        await wait(200);
        const b = await page.evaluate(BOUNDS, ['swarf-speed-select', 'swarf-material-select', 'swarf-speed-numbers']);
        const tag = `${device} ${skin} ${W}x${H} (${longest})`;
        for (const id of ['swarf-speed-select', 'swarf-material-select']) {
          const x = b[id];
          check(x && !x.missing && !x.clips.length && x.inWin && x.hit && x.w >= 60, `${tag}: ${id} whole and on top ${JSON.stringify(x)}`);
        }
        const n = b['swarf-speed-numbers'];
        check(n && !n.missing && !n.clips.length, `${tag}: the numbers under the speed are not clipped ${JSON.stringify(n)}`);
        await page.screenshot({ path: join(OUT, `speed-${device}-${skin}-${W}x${H}.png`) });
      }
    }
  }
  // real pointer and keys, MR-1, glass, 1024 x 600
  await page.evaluate(() => window.SwarfSkin.set('glass'));
  const label = await page.evaluate(() => { const s = document.getElementById('swarf-speed-select'); return document.getElementById(s.getAttribute('aria-labelledby'))?.textContent; });
  check(label === 'speed', `the select is labelled "speed" (${label})`);
  const rate = () => page.evaluate(() => window.kiri.api.conf.get().process.ops.find(o => o.type === 'outline').rate);
  const r0 = await rate();
  const sel = await page.$('#swarf-speed-select');
  const bb = await sel.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await wait(200);
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'swarf-speed-select'), 'a click on the speed focuses it');
  await page.keyboard.press('Escape');   // the native list, if it opened (Esc also leaves the field)
  await page.focus('#swarf-material-select');
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'swarf-speed-select'), 'Tab from the material reaches the speed');
  await page.keyboard.type('m');
  await wait(800);
  const v = await page.evaluate(() => document.getElementById('swarf-speed-select').value);
  const r4 = await rate();
  check(v === '4' && r4 > r0, `a typed "m" picks max and the step follows (${r0} → ${r4} mm/min)`);
  const words = await page.evaluate(() => document.getElementById('swarf-speed-numbers').innerText);
  check(new RegExp(`feed ${r4} · `).test(words), `the line under it says the feed it set ("${words}")`);
  // a custom step and a preset step: one line each, full width, stacked (the base style made every
  // div a flex row: on a 14" screen the custom line went one word per row beside a tall button)
  const stack = await page.evaluate(() => {
    const api = window.kiri.api, proc = api.conf.get().process, tool = (api.conf.get().tools || [])[0];
    proc.ops = [{ type: 'rough', tool: tool.id, spindle: 1, rate: 1, plunge: 1, down: 1 }, { type: 'outline', tool: tool.id, spindle: 1, rate: 1, plunge: 1, down: 1 }];
    window.__swarfSpeed.set(1);
    proc.ops[0].spindle = 14000; proc.ops[0].rate = 2280;
    window.dispatchEvent(new Event('swarf.material.change'));
    const box = document.getElementById('swarf-speed-numbers'), r = e => e.getBoundingClientRect();
    const [a, b] = box.children, btn = box.querySelector('button');
    return { n: box.children.length, custom: !!btn, full: !!a && !!b && r(a).width > r(box).width - 2 && r(b).width > r(box).width - 2, below: !!b && r(b).top >= r(a).bottom - 1, btnH: btn ? Math.round(r(btn).height) : 0 };
  });
  check(stack.n === 2 && stack.custom && stack.full && stack.below && stack.btnH < 40, `a custom line and a preset line stack, full width (${JSON.stringify(stack)})`);
} catch (e) {
  check(false, e.message);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(`screenshots: ${OUT}`);
console.log(bad.length || errors.length ? `speed layout: ${bad.length} failed, ${errors.length} page errors` : 'speed layout: ok');
process.exit(bad.length || errors.length ? 1 : 0);
