// A TEX step is tuned in the steps panel as any step is (Phil 11-01: "we still give them the parameters in
// tex, but then we can also change or tune them here, just like other toolpaths"): its card shows the mark's
// bit, path, finish and stepover with the step's own step-down, feed and plunge; what is changed there is
// the mark's (one value: TEX shows it), a typed stepover makes the finish custom, a wider one than the bit
// is refused.
//   node tools/probe_tex_step.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const errors = [];
process.argv[2] = process.argv[2] || 'http://localhost:8080/kiri/';
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(600);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'b', { depth: 19, soup: true, dpi: 0 }); });
  await wait(1500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0]; const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5); C.paintWhere(g, () => true, 1); p.marks.push({ id: 'sc', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('waves'), ver: 1 }); S.sel = 0; S.mark = 0; p.dirty = true; });
  await page.click('#tx-done'); await wait(1500);
  // open the texture step's card
  await page.evaluate(() => { const row = [...document.querySelectorAll('#oplist > div')].find(r => /^texture/.test(r.querySelector('.label')?.textContent || '')); row?.querySelector('.label')?.click(); }); await wait(500);
  const read = () => page.evaluate(() => { const d = document.querySelector('#oplist .swarf-params-open .swarf-op-params'); if (!d) return null; const o = {}; for (const e of d.querySelectorAll('[data-swarf-field]')) o[e.dataset.swarfField] = e.tagName === 'SELECT' ? e.value + ' (' + e.options.length + ')' : e.value; o.mark = JSON.stringify((() => { const w = window.kiri.api.widgets.all()[0], f = w.meta.tex[0].fill; return { tool: f.tool, path: f.path, finish: f.finish, stepover: f.stepover }; })()); return o; });
  let c = await read();
  check(c && /^\d+ /.test(c.tool) && c.finish.startsWith('standard') && +c.texstep > 0 && c.rate && c.plunge && c.down, `the texture step's card: bit, path, finish, stepover, step-down, feed, plunge (${JSON.stringify(c)})`);
  const bit = await page.evaluate((id) => { const t = window.kiri.api.conf.get().tools.find(t => String(t.id) === id); return t && t.name; }, c.tool.split(' ')[0]);
  check(bit === 'ball 1/4', `the card names the mark's own bit (${bit})`);
  const setf = (f, v) => page.evaluate((f, v) => { const e = document.querySelector(`#oplist .swarf-params-open [data-swarf-field="${f}"]`); e.value = v; e.dispatchEvent(new Event('change')); }, f, v);
  const st0 = +c.texstep;
  await setf('finish', 'fine'); await wait(600); c = await read();
  check(c.finish.startsWith('fine') && +c.texstep < st0 && /"finish":"fine"/.test(c.mark), `a finish picked here is the mark's, and closes the passes (${st0} → ${c.texstep})`);
  await setf('texstep', '2.5'); await wait(600); c = await read();
  check(c.finish.startsWith('custom') && c.texstep === '2.5' && /"stepover":2.5/.test(c.mark), `a stepover typed here makes the finish custom (${c.finish}, ${c.texstep})`);
  await setf('texstep', '30'); await wait(600); c = await read();
  check(c.texstep === '2.5', `a stepover wider than the bit is refused (${c.texstep})`);
  await setf('finish', 'ridged'); await wait(600); c = await read();
  check(c.finish.startsWith('ridged') && !/"stepover"/.test(c.mark) && +c.texstep > 0, `a finish picked again drops the typed stepover (${c.texstep})`);
  await setf('path', 'crosshatch'); await wait(600); c = await read();
  check(/"path":"crosshatch"/.test(c.mark), 'the path picked here is the mark\'s');
  await setf('down', '1/16'); await wait(600);
  const dn = await page.evaluate(() => window.kiri.api.conf.get().process.ops.find(o => o.type === 'texture').down);
  check(Math.abs(dn - 1.5875) < 1e-6, `step-down typed as 1/16 is ${dn} mm`);
  // TEX shows it
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await setf('texstep', '1.2'); await wait(600);
  await page.click('#swarf-step-tex'); await wait(1500);
  const tf = await page.evaluate(() => { const s = document.getElementById('tx-finish'); return s ? s.value + ' / ' + s.options[s.selectedIndex].textContent : 'none'; });
  check(/^custom \/ custom: 1.2 mm apart$/.test(tf), `TEX shows the stepover typed in the step (${tf})`);
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally { await browser.close(); }
console.log(bad.length ? `tex step: ${bad.length} failed` : 'tex step: ok');
process.exit(bad.length ? 1 : 0);
