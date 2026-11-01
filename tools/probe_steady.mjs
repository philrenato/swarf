// Nothing in a card moves when a slider moves (Phil 11-01: "make sure that the UI doesn't jump around when
// sliders etc are moved"). TEX: each slider of several patterns, at 720 and 900 tall, right after it is let
// go and again once the cut is worked out: every row stays where it was. Tabs: how many and size move the
// sentence, never the sliders or the fields.
//   node tools/probe_steady.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
async function texCard(H, PAT) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: H });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && document.getElementById('swarf-step-tex')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); try { localStorage.removeItem('swarf-tex-fill'); } catch (e) {} a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'b', { depth: 19, soup: true, dpi: 0 }); });
  await wait(1500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0]; const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5); C.paintWhere(g, () => true, 1); p.marks.push({ id: 'j', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('ribs'), ver: 1 }); S.sel = 0; S.mark = 0; p.dirty = true; });
  await page.keyboard.press('v'); await wait(800);
  await page.evaluate((P) => document.querySelector(`.tx-sw[data-pat="${P}"]`)?.click(), PAT); await wait(2500);
  const rows = () => page.evaluate(() => { const c = document.getElementById('tx-card'), o = {}; for (const e of c.querySelectorAll('input[id], select[id], button[id], summary')) { const r = e.getBoundingClientRect(); o[e.id || ('sum:' + e.textContent.trim().slice(0, 12))] = Math.round(r.top); } return o; });
  const sliders = await page.evaluate(() => [...document.querySelectorAll('#tx-card .sd-slide')].map(s => s.dataset.for));
  const report = [];
  for (const id of sliders) {
    const before = await rows();
    await page.evaluate((id) => { const s = document.querySelector(`#tx-card .sd-slide[data-for="${id}"]`); if (!s) return; const v = +s.min + (+s.max - +s.min) * (+s.value <= (+s.min + +s.max) / 2 ? 0.7 : 0.3); s.value = v; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); }, id);
    await wait(60); const now = await rows();
    await wait(2500); const later = await rows();
    const moved = (a, b) => Object.keys(a).filter(k => k in b && Math.abs(a[k] - b[k]) > 1).map(k => `${k} ${b[k] - a[k] > 0 ? '+' : ''}${b[k] - a[k]}`);
    report.push(`${id}: right after [${moved(before, now).join(', ')}]  after checks [${moved(before, later).join(', ')}]`);
  }
  return report;
  } finally { await browser.close(); }
}
async function tabsCard(H) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: H });
  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(600);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200"><path d="M10,100 C10,20 120,0 160,40 S290,10 290,100 S200,195 150,180 S10,180 10,100 Z"/></svg>', 'blob', { depth: 19, soup: true, dpi: 0 }); });
  await wait(1500);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await wait(500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); }); await wait(500);
  await page.evaluate(() => document.getElementById('swarf-autotabs-go')?.click()); await wait(2000);
  const rows = () => page.evaluate(() => { const o = {}; for (const id of ['swarf-autotabs-go', 'swarf-autotabs-density', 'swarf-autotabs-scale', 'swarf-autotabs-auto']) { const e = document.getElementById(id); if (e) o[id] = Math.round(e.getBoundingClientRect().top); } const say = document.getElementById('swarf-autotabs-say'); o.sayLines = say ? Math.round(say.getBoundingClientRect().height) : -1; const f = document.querySelector('.swarf-autotabs-fields input'); if (f) o.firstField = Math.round(f.getBoundingClientRect().top); return o; });
  const out = [];
  for (const [id, vals] of [['swarf-autotabs-density', [-3, 3, 0, 2]], ['swarf-autotabs-scale', [-2, 2, 0]]]) for (const v of vals) {
    const b = await rows();
    await page.evaluate((id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);
    await wait(1200); const a = await rows();
    const moved = Object.keys(b).filter(k => k !== 'sayLines' && Math.abs(a[k] - b[k]) > 1).map(k => `${k} ${a[k] - b[k]}`);
    out.push(`${id}=${v}: say ${b.sayLines}→${a.sayLines}px, moved [${moved.join(', ')}]`);
  }
  return out;
  } finally { await browser.close(); }
}
for (const H of [720, 900]) for (const p of ['ribs', 'blob', 'memphis', 'knurl']) {
  const lines = await texCard(H, p), moved = lines.filter(l => !/\[\]  after checks \[\]$/.test(l));
  check(!moved.length, `TEX ${p} at ${H} tall: no row moves as its ${lines.length} sliders move${moved.length ? ': ' + moved[0].slice(0, 160) : ''}`);
}
{
  const lines = await tabsCard(720), moved = lines.filter(l => !/moved \[\]$/.test(l));
  check(!moved.length, `tabs at 720 tall: how many and size move nothing${moved.length ? ': ' + moved[0] : ''}`);
}
console.log(bad.length ? `steady: ${bad.length} failed` : 'steady: ok');
process.exit(bad.length ? 1 : 0);
