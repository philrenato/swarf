// The small ones from review 105. F16: DRAW's sentence goes once a step is added. F21: cut is not the darkest pill
// while it waits. P3/P4: the size strip, the objects list and concerns name a drawing's pieces the same way. m2: a
// material change that replaces a typed feed says so. m3: the file ends lifted clear, no XY move, and control's
// parser and plan accept it, a stored profile too. m1: export's remake is the same file as a press of toolpaths.
//   node tools/probe_105_small.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const rect = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`;
const two = `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="40mm" viewBox="0 0 120 40"><rect width="50" height="40"/><rect x="70" width="50" height="40"/></svg>`;
const ell = `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="80mm" viewBox="0 0 80 80"><path d="M0 0H30V50H80V80H0Z"/></svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-small-')), args: ['--window-size=1440,900'] });
const steps = {
  async F16(page, h) {
    await h.fresh();
    await page.click('#swarf-step-draw');
    await page.waitForFunction(() => window.__swarfDraw.state?.(), { timeout: 10000 }); await wait(500);
    await page.keyboard.press('r');
    await page.mouse.move(600, 300); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(600 + 20 * i, 300 + 12 * i); await wait(15); }
    await page.mouse.up(); await wait(200);
    await page.click('#sd-done'); await wait(1600);
    const said = () => page.evaluate(() => /Next: a step/.test(document.body.innerText));
    check(await said(), "DRAW's done says what comes next");
    await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(500);
    check(!(await said()), 'the sentence goes once a step is added');
  },
  async F21(page, h) {
    await h.fresh(); await h.part(rect(100, 60), 'p');
    await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(400);
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 60000); }));
    await page.click('#swarf-step-run');
    await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.machine && !window.__swarfRun.state.camBusy, { timeout: 90000 }); await wait(800);
    const lum = () => page.evaluate(() => {
      const L = b => { const c = getComputedStyle(b).backgroundColor.match(/[\d.]+/g).map(Number); const a = c[3] === undefined ? 1 : c[3]; return { lum: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], color: getComputedStyle(b).backgroundColor, sat: Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]), a }; };
      const R = {}; for (const k of ['trace', 'air', 'cut']) { const b = document.querySelector(`#swarf-run .sr-actions .${k}`) || [...document.querySelectorAll('#swarf-run .sr-actions button')].find(x => x.textContent.includes(k)); R[k] = b ? { ...L(b), wait: b.classList.contains('wait'), text: b.textContent } : null; }
      return R; });
    const skin0 = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
    for (const skin of ['', 'glass', 'classic']) {
      if (skin) await page.evaluate(s => { document.documentElement.setAttribute('data-skin', s); }, skin);
      await wait(300);
      const l = await lum();
      const others = [l.trace, l.air].filter(Boolean).map(x => x.lum);
      check(l.cut?.wait && l.cut.lum >= Math.min(...others) - 1, `${skin || 'as it opens'}: cut waiting is not the darkest pill (cut ${l.cut?.color}, trace ${l.trace?.color}, air ${l.air?.color})`);
    }
    await page.evaluate(s => { if (s) document.documentElement.setAttribute('data-skin', s); else document.documentElement.removeAttribute('data-skin'); }, skin0); await wait(200);
    // and once it can go, it stands out: the same button with nothing to wait for
    const paint = () => page.evaluate(() => { const c = getComputedStyle(document.querySelector('#swarf-run .sr-actions .cut')); return c.backgroundColor + ' ' + c.backgroundImage.slice(0, 60); });
    const waitC = await paint();
    await page.evaluate(() => document.querySelector('#swarf-run .sr-actions .cut').classList.remove('wait')); await wait(500);
    const readyC = await paint();
    await page.evaluate(() => document.querySelector('#swarf-run .sr-actions .cut').classList.add('wait'));
    console.log(`note: cut ready ${readyC}, waiting ${waitC}`);
    check(readyC !== waitC, 'ready, it looks different from waiting');
  },
  async P34(page, h) {
    await h.fresh(); await h.part(two, 'shapes');
    await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); a.platform.select(a.widgets.all()[0], false); }); await wait(300);
    const row = await page.evaluate(() => document.querySelector('#ws-widgets')?.innerText.trim());
    const strip = await page.evaluate(() => document.querySelector('#swarf-size .n')?.textContent);
    check(/shapes \(2 pieces\)/.test(row), `objects: "${row}"`);
    check(/shapes \(2 pieces\)/.test(strip), `the size strip the same: "${strip}"`);
    await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(700);
    const titles = await page.evaluate(() => [...document.querySelectorAll('#swarf-concerns-body .swarf-concern strong')].map(s => s.textContent));
    // the pieces of one drawing fold into one line (sync.js)
    check(titles.some(t => /^shapes: 2 pieces are cut free/.test(t)), `concerns the same: ${titles.join(' | ')}`);
    check(!titles.some(t => /shapes-2/.test(t)), 'no "shapes-2" to puzzle over');
    // two things picked count as two things
    await h.part(rect(40, 40), 'other');
    await page.evaluate(() => window.kiri.api.platform.select_all()); await wait(300);
    const both = await page.evaluate(() => document.querySelector('#swarf-size .n')?.textContent);
    check(/^2 parts/.test(both), `a drawing and a part picked: "${both}"`);
  },
  async m2(page, h) {
    await h.fresh(); await h.part(rect(100, 60), 'p');
    await page.evaluate(() => { document.getElementById('swarf-material-select').value = 'hardwood'; document.getElementById('swarf-material-select').dispatchEvent(new Event('change', { bubbles: true })); }); await wait(500);
    await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(500);
    // no typing: no word
    await page.evaluate(() => window.kiri.api.event.alerts?.(true)); await wait(200);
    await page.evaluate(() => { document.getElementById('swarf-material-select').value = 'softwood'; document.getElementById('swarf-material-select').dispatchEvent(new Event('change', { bubbles: true })); }); await wait(600);
    check(!/has its own numbers/.test(await page.evaluate(() => document.body.innerText)), 'a material change over untouched numbers says nothing');
    // a typed feed
    await page.evaluate(() => { const a = window.kiri.api, op = a.conf.get().process.ops.find(o => o.type === 'outline'); op.rate = 1234; a.conf.save(); a.event.emit('cam.op.render'); }); await wait(300);
    await page.evaluate(() => { document.getElementById('swarf-material-select').value = 'plywood'; document.getElementById('swarf-material-select').dispatchEvent(new Event('change', { bubbles: true })); }); await wait(600);
    const after = await page.evaluate(() => ({ rate: window.kiri.api.conf.get().process.ops.find(o => o.type === 'outline').rate, said: document.body.innerText.match(/[^\n]*has its own numbers[^\n]*/)?.[0] }));
    check(after.rate !== 1234, `the feed is replaced, by design (${after.rate})`);
    check(/feed you typed on outline, 1234 mm\/min, is now/.test(after.said || ''), `and it says so: "${after.said}"`);
  },
  async m3(page, h) {
    await h.fresh(); await h.part(rect(100, 60), 'p');
    await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(500);
    const text = await h.file();
    const parsed = P.parse(text, { machineUnits: 'mm' });
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const end = lines.indexOf('END');
    const jz = lines.findIndex(l => /^JZ,/.test(l));
    const c7 = lines.lastIndexOf('C7', end);
    check(jz > 0 && jz < end, `the file lifts before it ends: ${lines[jz]}`);
    check(jz < c7, 'the lift comes with the router still on, then C7');
    const last = parsed.moves[parsed.moves.length - 1], prior = parsed.moves[parsed.moves.length - 2];
    check(last.z === 25.4, `the last move ends at the safe height, Z ${last.z}`);
    check(last.x === prior.x && last.y === prior.y && last.x0 === last.x && last.y0 === last.y, `no XY move in it (${last.x0},${last.y0} to ${last.x},${last.y})`);
    check(last.rapid, 'it is a rapid, upward, out of the wood');
    check(!(parsed.errors || []).length, `control's parser takes it (${(parsed.errors || []).length} errors)`);
    check(!parsed.moves.some(m => m.rapid && m.z < 0 && (m.x !== m.x0 || m.y !== m.y0)), 'no rapid across below the top');
    check(!P.routerOffCut(parsed), 'no cut with the router off');
    // the plan and the checks in control: through the real page
    await page.click('#swarf-step-run');
    await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.machine && !window.__swarfRun.state.camBusy, { timeout: 90000 }); await wait(800);
    const ctl = await page.evaluate(() => { const S = window.__swarfRun.state; return { text: S.prog.text, needs: document.querySelector('#swarf-run .sr-need')?.innerText, problems: document.querySelector('#swarf-run')?.innerText.match(/Blocked[^\n]*/)?.[0] }; });
    check(ctl.text.includes('JZ,25.4') && !ctl.problems, `control loads it, nothing blocked (${ctl.problems || 'clear'})`);
    await page.evaluate(() => window.__swarfRun.close?.()); await wait(400);
    // a profile stored before this: its saved post still gets the lift
    await page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(), strip = p => p.filter(l => !/^JZ,|Lifting clear/.test(l)); s.device.gcodePost = strip(s.device.gcodePost); s.cdev.CAM.gcodePost = strip(s.cdev.CAM.gcodePost); a.conf.save(); });
    await wait(400);
    await page.reload({ waitUntil: 'domcontentloaded' }); await h.ready();
    const post = await page.evaluate(() => window.kiri.api.conf.get().device.gcodePost);
    check(post.includes('JZ,25.4') && post.indexOf('JZ,25.4') < post.indexOf('C7'), `a stored profile gets the lift (${post.slice(0, 4).join(' / ')})`);
  },
  async m1(page, h) {
    const compare = async (name, change) => {
      await h.fresh();
      await h.part(ell, 'L'); await h.part(rect(70, 70), 'S'); await h.part(rect(60, 90), 'T');
      await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(500);
      await page.evaluate(() => { for (const b of [...document.querySelectorAll('button')]) if (/^auto tabs$/i.test(b.textContent.trim()) && b.offsetParent) { b.click(); break; } }); await wait(600);
      await h.paths();
      await page.evaluate(() => document.getElementById('act-animate').click()); await wait(1500);
      await page.evaluate(() => document.getElementById('act-clear')?.click()); await wait(500);
      await page.evaluate(() => { const a = window.kiri.api; a.view.set_arrange(); const w = a.widgets.all().find(w => w.meta.file === 'T'); a.platform.deselect(); a.platform.select(w, false); }); await wait(300);
      await page.evaluate(change); await wait(800);
      const remade = await page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 90000); window.kiri.api.function.export(s => { clearTimeout(t); res(s); }); }));
      await page.evaluate(() => window.kiri.api.view.set_arrange()); await wait(500);
      await h.paths();
      const pressed = await page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 90000); window.kiri.api.function.export(s => { clearTimeout(t); res(s); }); }));
      const n = s => s.split('\n').length;
      check(remade && remade === pressed, `${name}: export's remake is the file a press of toolpaths makes (${n(remade)} and ${n(pressed)} lines)`);
      await page.evaluate(() => window.kiri.api.view.set_arrange()); await wait(400);
    };
    await compare('mirrored', () => window.kiri.api.selection.mirror());
    await compare('turned over', () => window.kiri.api.selection.rotate(0, Math.PI, 0));
    // nothing changed and a part picked: toolpaths the same picked or not
    await h.fresh(); await h.part(rect(70, 70), 'A'); await h.part(rect(60, 90), 'B'); await h.part(rect(50, 50), 'C');
    await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(500);
    await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); }); await wait(200);
    await h.paths();
    const none = await h.fileNow();
    await page.evaluate(() => { const a = window.kiri.api; a.view.set_arrange(); a.platform.deselect(); a.platform.select(a.widgets.all().find(w => w.meta.file === 'C'), false); }); await wait(300);
    await h.paths();
    const picked = await h.fileNow();
    check(none === picked, `what is picked does not reorder the file (${none.split('\n').length} and ${picked.split('\n').length} lines)`);
    await page.evaluate(() => window.kiri.api.view.set_arrange()); await wait(400);
  }
};
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  const ready = () => page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun && window.__swarfDraw), { timeout: 90000, polling: 200 }).then(() => wait(1800));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await ready();
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const h = {
    ready,
    fresh: () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.view.set_arrange(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500)),
    part: (svg, name) => page.evaluate((svg, name) => { window.kiri.api.platform.load_svg(svg, name, { depth: 12, soup: true, dpi: 0, place: true }); }, svg, name).then(() => wait(900)),
    paths: () => page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 90000); })).then(() => wait(500)),
    file: () => page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 90000); window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(s => { clearTimeout(t); res(s); }); })),
    fileNow: () => page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 90000); window.kiri.api.function.export(s => { clearTimeout(t); res(s); }); }))
  };
  for (const [name, fn] of Object.entries(steps)) {
    console.log(`-- ${name}`);
    try { await fn(page, h); } catch (e) { check(false, `${name} stopped: ${e.message}`); }
    await page.evaluate(() => { try { window.__swarfRun.close?.(); } catch (e) {} });
    await wait(300);
  }
  check(!errors.length, `no page errors: ${errors.slice(0, 3).join(' | ')}`);
} catch (e) { check(false, `the probe stopped: ${e.message}`); }
await browser.close();
console.log(bad.length ? `FAILED ${bad.length}` : 'ALL OK');
process.exit(bad.length ? 1 : 0);
