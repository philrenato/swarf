// DRAW text in the computer's own fonts (Local Font Access, stubbed here with Inter as the one
// font "installed"). The font list starts with the built-in Russo One; "this computer's fonts…"
// asks, then lists them; picking one sets the words in it. A word set in that font keeps it when
// its words are changed after another font was picked (it used to take the last font read). A
// browser that refuses keeps the built-in font and font files; one without the API never offers it.
//   node tools/probe_fonts.mjs [url]
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-fonts';
const INTER = readFileSync(fileURLToPath(new URL('./fixtures-2d/Inter-Regular.ttf', import.meta.url))).toString('base64');
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
const setInput = (page, id, v) => page.evaluate((id, v) => { const i = document.getElementById(id); i.focus(); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); }, id, v);
const pick = (page, v) => page.evaluate(v => { const s = document.getElementById('sd-fontsel'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
const options = page => page.evaluate(() => [...document.querySelectorAll('#sd-fontsel option')].map(o => [o.value, o.textContent]));
const said = page => page.evaluate(() => document.getElementById('sd-say').textContent);
const width = page => page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; let a = Infinity, b = -Infinity; for (const c of p.curves) for (const q of c.crv.ctrlPts) { a = Math.min(a, q[0]); b = Math.max(b, q[0]); } return { w: +(b - a).toFixed(2), font: p.text && p.text.font, str: p.text && p.text.str }; });
// how wide a word is in a font, as DRAW sets it (capitals h mm tall)
const ref = (page, font, str, h) => page.evaluate((font, str, h) => { const f = window.__swarfDraw.fonts.get(font), os2 = f.tables.os2; const cap = (os2 && os2.sCapHeight) || f.unitsPerEm * 0.7; const b = f.getPath(str, 0, 0, h * f.unitsPerEm / cap).getBoundingBox(); return +(b.x2 - b.x1).toFixed(2); }, font, str, h);
async function boot(stub) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  if (stub) await page.evaluateOnNewDocument(stub, INTER);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfVector && document.getElementById('swarf-step-draw')), { timeout: 90000, polling: 200 });
  await wait(1200);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(300);
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 3; S.ox = r.width / 2 - 100; S.oy = r.height / 2; });
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__swarfDraw.text.font, { timeout: 15000 });
  await wait(100);
  return page;
}
async function place(page, x, y) {
  const [cx, cy] = await px(page, x, y);
  await page.mouse.move(cx + 30, cy + 30); await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy);
  await wait(200);
}
try {
  // ── the computer has fonts and shares them ──
  const page = await boot(b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    window.__asked = 0;
    window.queryLocalFonts = async () => { window.__asked++; return [
      { fullName: 'Inter Test', postscriptName: 'InterTest', family: 'Inter Test', style: 'Regular', blob: async () => new Blob([bytes]) },
      { fullName: 'Broken Face', postscriptName: 'BrokenFace', family: 'Broken Face', style: 'Regular', blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])]) }
    ]; };
  });
  let O = await options(page);
  check(O[0] && O[0][1] === 'Russo One (built in)' && O.some(o => o[0] === 'ask') && O.some(o => o[0] === 'file'), `the font list: the built-in font first, then this computer's fonts… and a font file… (${O.map(o => o[1]).join(' | ')})`);
  await pick(page, 'ask');
  await wait(300);
  O = await options(page);
  check(O.some(o => o[1] === 'Inter Test') && O.some(o => o[1] === 'Broken Face') && (await page.evaluate(() => window.__asked)) === 1, `asked once: the computer's fonts are listed (${O.map(o => o[1]).join(' | ')})`);
  await pick(page, 'local:BrokenFace');
  await wait(300);
  check(/could not be read/.test(await said(page)) && (await page.evaluate(() => window.__swarfDraw.text.name)) === 'Russo One', `a font that cannot be read says so and keeps Russo One ("${await said(page)}")`);
  await pick(page, 'local:InterTest');
  await page.waitForFunction(() => window.__swarfDraw.text.name === 'Inter Test', { timeout: 5000 }).catch(() => {});
  check((await page.evaluate(() => window.__swarfDraw.text.name)) === 'Inter Test', 'picking Inter Test from the list sets the letters in it');
  await setInput(page, 'sd-str', 'HI');
  await setInput(page, 'sd-th', '40');
  await place(page, -100, 0);
  let p = await width(page);
  const interHI = await ref(page, 'Inter Test', 'HI', 40), russoHI = await ref(page, 'Russo One', 'HI', 40);
  check(p.font === 'Inter Test' && Math.abs(p.w - interHI) < 0.3 && Math.abs(interHI - russoHI) > 1, `"HI" placed in Inter Test: ${p.w} mm wide (Inter ${interHI}, Russo ${russoHI})`);
  await page.screenshot({ path: `${OUT}-board.png` });
  // another word in Russo One: the last font read is Russo now
  await page.keyboard.press('t');
  await pick(page, 'font:Russo One');
  await wait(150);
  await place(page, -100, -60);
  p = await width(page);
  check(p.font === 'Russo One' && Math.abs(p.w - russoHI) < 0.3, `a second "HI" in Russo One (${p.w} mm)`);
  // back to the Inter word: change its words. It stays in Inter.
  const [hx, hy] = await px(page, -100 + interHI / 2, 20);
  await page.mouse.click(hx, hy);
  await wait(150);
  p = await width(page);
  check(p.font === 'Inter Test', `the Inter word picked again (${JSON.stringify(p)})`);
  await setInput(page, 'sd-str', 'HIM');
  await wait(150);
  p = await width(page);
  const interHIM = await ref(page, 'Inter Test', 'HIM', 40), russoHIM = await ref(page, 'Russo One', 'HIM', 40);
  check(p.font === 'Inter Test' && p.str === 'HIM' && Math.abs(p.w - interHIM) < 0.3, `its words changed to HIM, still in Inter Test: ${p.w} mm (Inter ${interHIM}, Russo ${russoHIM})`);
  // the picked word's font list shows its own font
  const shown = await page.evaluate(() => { const s = document.getElementById('sd-fontsel'); return s.options[s.selectedIndex].textContent; });
  check(shown === 'Inter Test', `its card shows its own font (${shown})`);
  await page.click('#sd-done');
  await wait(1500);
  const n = await page.evaluate(() => window.kiri.api.widgets.all().length);
  check(n >= 4, `done: the letters are parts (${n})`);
  await page.close();

  // ── the browser refuses ──
  const p2 = await boot(() => { window.queryLocalFonts = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  await pick(p2, 'ask');
  await wait(300);
  O = await options(p2);
  check(/private/.test(await said(p2)) && O[0][1] === 'Russo One (built in)' && O.some(o => o[0] === 'file') && !O.some(o => o[0] === 'ask'), `refused: said, and the list keeps the built-in font and font files (${O.map(o => o[1]).join(' | ')})`);
  await place(p2, -100, 0);
  p = await width(p2);
  check(p && p.font === 'Russo One', `text still sets in Russo One (${p && p.font})`);
  await p2.close();

  // ── a browser without the API ──
  const p3 = await boot(() => { delete window.queryLocalFonts; Object.defineProperty(window, 'queryLocalFonts', { value: undefined, configurable: true }); });
  O = await options(p3);
  check(!O.some(o => o[0] === 'ask') && O[0][1] === 'Russo One (built in)', `no Local Font Access: no "this computer's fonts" offered (${O.map(o => o[1]).join(' | ')})`);
  await p3.close();
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `fonts: ${bad.length} failed, ${errors.length} page errors` : 'fonts: ok');
process.exit(bad.length || errors.length ? 1 : 0);
