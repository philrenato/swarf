// bits in basic (review 105 F17): swarf's own read-only card, not Kiri's dark editor, and the menus stay free
// while it is open. Name, width, kind, part number, the V-bits marked for carving; edit in tool library only
// in advanced; adding a bit stays possible and the new bit reaches the steps.
//   node tools/probe_bits_basic.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || tmpdir();
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-bits-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && document.getElementById('swarf-open-tools')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const kiriOpen = () => page.evaluate(() => { const d = document.getElementById('tools') || document.querySelector('#modal'); const m = document.getElementById('modal'); return !!(m && getComputedStyle(m).display !== 'none' && document.getElementById('tool-select')?.offsetParent) || !!document.getElementById('tool-select')?.offsetParent; });
  check(await page.evaluate(() => !document.body.classList.contains('swarf-expert')), 'this is basic');
  await page.click('#swarf-open-tools'); await wait(600);
  check(!(await kiriOpen()), "bits does not open Kiri's editor");
  const card = await page.evaluate(() => { const c = document.getElementById('swarf-bits'); if (!c) return null; const heads = [...c.querySelectorAll('th')].map(t => t.textContent), rows = [...c.querySelectorAll('tbody tr')].map(r => [...r.children].map(t => t.textContent)); const r = c.getBoundingClientRect(); return { heads, rows, rect: [r.left, r.top, r.right, r.bottom], tools: window.kiri.api.conf.get().tools.length, inputs: c.querySelectorAll('input,select').length, buttons: [...c.querySelectorAll('button')].map(b => ({ t: b.textContent, title: b.title, shown: !!b.offsetParent })) }; });
  check(!!card, "bits opens swarf's own card");
  if (!card) throw new Error('no card');
  await page.screenshot({ path: join(OUT, 'bits-card.png') });
  check(['name', 'width', 'kind', 'part number'].every(h => card.heads.includes(h)), `its columns: ${card.heads}`);
  check(card.rows.length === card.tools, `every bit is listed (${card.rows.length} of ${card.tools})`);
  check(card.inputs === 0, 'the list only reads');
  const v = card.rows.filter(r => /V-bit|vee/i.test(r[0]));
  check(v.length >= 2 && v.every(r => /for carving/.test(r[2])), `V-bits say for carving: ${v.map(r => r[0] + ' ' + r[2]).join('; ')}`);
  check(card.rows.findIndex(r => /for carving/.test(r[2])) === 0, `V-bits come first (${card.rows[0][0]})`);
  check(card.rows.filter(r => !/V-bit|vee/i.test(r[0])).every(r => !/carving/.test(r[2])), 'nothing else does');
  check(card.rows.some(r => r[3] === '48-005'), 'a part number reads 48-005');
  check(card.rows.every(r => /\d/.test(r[1])), 'every width has a number');
  check(card.buttons.filter(b => b.shown).every(b => b.title), `every button has a tooltip (${card.buttons.filter(b => b.shown).map(b => b.t)})`);
  check(!card.buttons.find(b => /tool library/.test(b.t))?.shown, 'edit in tool library is not in basic');

  // the menus stay free: a real click on help opens it with the card up
  const helpAt = await page.evaluate(() => { const s = [...document.querySelectorAll('#menubar .top-menu > span')].find(x => /^help/i.test(x.textContent.trim())); const r = s.getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; });
  await page.mouse.click(...helpAt); await wait(300);
  check(await page.evaluate(() => [...document.querySelectorAll('#menubar .top-menu > span')].some(x => /^help/i.test(x.textContent.trim()) && x.classList.contains('swarf-open'))), 'help opens with the list up');
  await page.screenshot({ path: join(OUT, 'bits-help.png') });
  const dropOver = await page.evaluate(() => { const s = [...document.querySelectorAll('#menubar .top-menu > span')].find(x => /^help/i.test(x.textContent.trim())); const its = [...s.querySelectorAll('.top-menu-drop div')].filter(d => d.offsetParent && d.getBoundingClientRect().height > 0); const under = its.filter(it => { const r = it.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top && top.closest('#swarf-bits'); }); return { n: its.length, under: under.map(u => u.textContent.trim().slice(0, 30)), z: getComputedStyle(document.getElementById('menubar')).zIndex }; });
  check(dropOver.n > 0 && !dropOver.under.length, `its menu shows over the list, not under it (${dropOver.n} items, covered: ${dropOver.under})`);
  await page.keyboard.press('Escape'); await page.evaluate(() => document.body.click()); await wait(300);
  if (!(await page.evaluate(() => !!document.getElementById('swarf-bits')))) { await page.click('#swarf-open-tools'); await wait(400); }

  // adding a bit
  await page.evaluate(() => [...document.querySelectorAll('#swarf-bits button')].find(b => b.textContent === 'add a bit').click()); await wait(300);
  const form = await page.evaluate(() => [...document.querySelectorAll('#swarf-bits .swarf-bits-form input, #swarf-bits .swarf-bits-form select')].map(e => e.title));
  check(form.length === 5 && form.every(Boolean), `the form has its fields, each with a tooltip (${form.length})`);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-bits button')].find(b => b.textContent === 'add').click()); await wait(200);
  check(/name/i.test(await page.evaluate(() => document.querySelector('#swarf-bits .swarf-bits-why').textContent)), 'no name is refused, in words');
  const fields = await page.$$('#swarf-bits .swarf-bits-form input');
  await fields[0].type('my 3/16'); await fields[1].type('3/16'); await fields[3].type('99-123');
  await page.evaluate(() => [...document.querySelectorAll('#swarf-bits button')].find(b => b.textContent === 'add').click()); await wait(500);
  const after = await page.evaluate(() => { const a = window.kiri.api, t = a.conf.get().tools.find(t => t.name === 'my 3/16'); return { t, row: [...document.querySelectorAll('#swarf-bits tbody tr')].map(r => [...r.children].map(c => c.textContent)).find(r => r[0] === 'my 3/16') }; });
  check(after.t && Math.abs(after.t.flute_diam - 4.7625) < 0.01 && after.t.metric === true, `a 3/16 bit is in the library (${after.t?.flute_diam} mm)`);
  check(after.row && after.row[3] === '99-123', `and on the list, with its part number (${after.row})`);
  check(await page.evaluate(() => { const t = window.kiri.api.conf.get().tools, n = t.map(x => x.number); return new Set(n).size === n.length; }), 'its T number is its own');
  // the new bit can be cut with: a step on it, in the file
  await page.evaluate(() => { const a = window.kiri.api; a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50"><rect width="50" height="50"/></svg>', 'p', { depth: 6, soup: true, dpi: 0 }); }); await wait(900);
  await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(500);
  const onStep = await page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(), op = s.process.ops.find(o => o.type === 'outline'), t = s.tools.find(t => t.name === 'my 3/16'); op.tool = t.id; a.conf.save(); a.event.emit('cam.op.render'); return !!t; });
  const text = await page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 60000); window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(s => { clearTimeout(t); res(s); }); }));
  check(onStep && /my 3\/16/.test(text), 'the file loads the new bit by name');
  await page.evaluate(() => { const a = window.kiri.api; a.view.set_arrange(); }); await wait(500);
  // it stays after a reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && document.getElementById('swarf-open-tools')), { timeout: 90000, polling: 200 }); await wait(2500);
  check(await page.evaluate(() => window.kiri.api.conf.get().tools.some(t => t.name === 'my 3/16')), 'the new bit is there after a reload');
  // Esc closes; the button closes it too
  await page.click('#swarf-open-tools'); await wait(400);
  check(await page.evaluate(() => !!document.getElementById('swarf-bits')), 'bits opens again');
  await page.keyboard.press('Escape'); await wait(200);
  check(await page.evaluate(() => !document.getElementById('swarf-bits')), 'Esc closes it');

  // advanced: the route to Kiri's editor
  await page.evaluate(() => document.body.classList.add('swarf-expert'));
  await page.click('#swarf-open-tools'); await wait(400);
  const lib = await page.evaluate(() => { const b = [...document.querySelectorAll('#swarf-bits button')].find(b => /tool library/.test(b.textContent)); return b && { shown: !!b.offsetParent, title: b.title }; });
  check(lib?.shown && !!lib.title, 'in advanced, edit in tool library is there, with a tooltip');
  await page.evaluate(() => [...document.querySelectorAll('#swarf-bits button')].find(b => /tool library/.test(b.textContent)).click()); await wait(900);
  check(await kiriOpen(), "and it opens Kiri's editor");
  check(await page.evaluate(() => !document.getElementById('swarf-bits')), 'the list has closed');
  check(!errors.length, `no page errors: ${errors.slice(0, 3).join(' | ')}`);
} catch (e) { check(false, `the probe stopped: ${e.message}`); }
await browser.close();
console.log(bad.length ? `FAILED ${bad.length}` : 'ALL OK');
process.exit(bad.length ? 1 : 0);
