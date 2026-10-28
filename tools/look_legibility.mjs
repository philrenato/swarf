// Legibility of every visible piece of text, in every skin (Phil 10-28: "make sure legibility is
// never compromised"). For each element that carries its own text, the background is read from
// the screenshot behind it (glass, gradients and the 3D scene included: the commonest color in
// its box), the text color from its computed style and opacity, and the WCAG contrast ratio is
// checked: 4.5 for body text, 3 for large text (24 px, or 18.66 px bold).
//   node tools/look_legibility.mjs [url] [outdir] [skin ...]
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { writeFileSync } from 'fs';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://127.0.0.1:8139/swarf-app/';
const OUT = process.argv[3] || '/tmp';
const SKINS = process.argv.slice(4).length ? process.argv.slice(4) : ['glass', 'classic', 'swarf'];
const wait = ms => new Promise(r => setTimeout(r, ms));
const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

async function audit(page, skin, screen, found) {
  const shot = await page.screenshot({ type: 'png' });
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const dpr = W / (await page.evaluate(() => innerWidth));
  const items = await page.evaluate(() => {
    const out = [];
    const vis = e => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return 0; } return 1; };
    const op = e => { let o = 1; for (let n = e; n && n !== document.documentElement; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
    for (const e of document.querySelectorAll('body *')) {
      if (/^(SCRIPT|STYLE|SVG|PATH|CANVAS|OPTION)$/i.test(e.tagName)) continue;
      const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      const val = (e.tagName === 'INPUT' && /^(text|number|)$/.test(e.type) && e.value) || (e.tagName === 'SELECT' && e.selectedOptions[0] && e.selectedOptions[0].textContent) || '';
      const text = (own || val).replace(/\s+/g, ' ').slice(0, 60);
      if (!text || !/[A-Za-z0-9]/.test(text)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 6 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      if (!vis(e)) continue;
      // the topmost element at the box's center must be this one or inside it (not covered)
      const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== e && !e.contains(top) && !top.contains(e)) continue;
      const s = getComputedStyle(e);
      const m = s.color.match(/[\d.]+/g).map(Number);
      const id = e.id ? '#' + e.id : e.className && typeof e.className === 'string' ? e.tagName.toLowerCase() + '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase();
      const path = [e.parentElement && (e.parentElement.id ? '#' + e.parentElement.id : e.parentElement.tagName.toLowerCase()), id].join(' > ');
      out.push({ text, path, rect: [r.left, r.top, r.width, r.height], color: m.slice(0, 3), alpha: (m[3] ?? 1) * op(e), size: parseFloat(s.fontSize), weight: +s.fontWeight || 400, disabled: !!(e.disabled || e.closest('[disabled]') || e.classList.contains('wait')) });
    }
    return out;
  });
  for (const it of items) {
    const [x, y, w, h] = it.rect.map(v => Math.round(v * dpr));
    const counts = new Map();
    const step = Math.max(1, Math.floor(Math.min(w, h) / 12));
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy += step) for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += step) {
      const i = (yy * W + xx) * C, k = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | data[i + 2] >> 3;
      const c = counts.get(k); if (c) c.n++; else counts.set(k, { n: 1, rgb: [data[i], data[i + 1], data[i + 2]] });
    }
    if (!counts.size) continue;
    // the background is the commonest color that is not the text's own (big bold letters can
    // fill most of their box)
    const a = Math.min(1, it.alpha);
    const sorted = [...counts.values()].sort((p, q) => q.n - p.n);
    const bg = (sorted.find(c => ratio(c.rgb, it.color.map((v, i) => v * a + c.rgb[i] * (1 - a))) > 1.25) || sorted[0]).rgb;
    const fg = it.color.map((c, i) => c * a + bg[i] * (1 - a));
    const r = ratio(fg, bg);
    const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
    const need = large ? 3 : 4.5;
    if (r < need) found.push({ skin, screen, text: it.text, path: it.path, ratio: +r.toFixed(2), need, size: it.size, disabled: it.disabled, fg: fg.map(Math.round), bg });
  }
  await page.screenshot({ path: `${OUT}/${skin}-${screen}.png` });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 180000, args: ['--window-size=1440,900'] });
const found = [];
try {
  for (const skin of SKINS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(PAGE + '?skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(5000);
    await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfSkin && document.getElementById('swarf-step-shape') && window.__swarfRun), { timeout: 90000, polling: 200 });
    await page.evaluate(s => { localStorage.setItem('swarf-skin', s); window.SwarfSkin.set(s); window.kiri.api.devices.select('ShopBot.Basic'); for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); }, skin);
    await wait(1500);
    await audit(page, skin, '01-empty', found);
    await page.evaluate(() => { const m = [...document.querySelectorAll('#menubar .top-menu > span')].find(s => /view/i.test(s.textContent.split('\n')[0])); m && m.click(); });
    await wait(400); await audit(page, skin, '02-menu', found);
    await page.keyboard.press('Escape'); await page.mouse.click(720, 600); await wait(300);
    await page.click('#swarf-step-shape');
    await page.waitForFunction(() => document.getElementById('dialog').open, { timeout: 5000 }).catch(() => {});
    await wait(400); await audit(page, skin, '03-shape', found);
    await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim()))?.click());
    await wait(1500);
    await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; w && a.platform.select(w); });
    await wait(500); await audit(page, skin, '04-part', found);
    await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await wait(400);
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 60000); }));
    await wait(500); await audit(page, skin, '05-toolpaths', found);
    await page.evaluate(() => { const c = document.getElementById('swarf-concerns-tab'); c && c.click(); });
    await wait(300); await audit(page, skin, '05b-concerns', found);
    await page.mouse.click(720, 700); await wait(200);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
    await wait(2500); await audit(page, skin, '06-simulate', found);
    await page.evaluate(() => window.kiri.api.view.set_arrange()); await wait(800);
    await page.click('#swarf-step-draw').catch(() => {}); await wait(1200);
    await audit(page, skin, '07-draw', found);
    await page.evaluate(() => [...document.querySelectorAll('#swarf-draw button')].find(b => /cancel/i.test(b.textContent))?.click()); await wait(800);
    await page.evaluate(() => window.__swarfTutorial && window.__swarfTutorial.open(4)); await wait(500);
    await audit(page, skin, '07b-quickstart', found);
    await page.keyboard.press('Escape'); await wait(300);
    await page.evaluate(() => window.kiri.api.modal.show('prefs')); await wait(600);
    await audit(page, skin, '08-prefs', found);
    await page.evaluate(() => { try { window.kiri.api.modal.hide(); } catch (e) {} }); await page.keyboard.press('Escape'); await wait(400);
    // CONTROL: the program, the needs card, the cut card, the plate card
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 30000); }));
    await page.click('#swarf-step-run').catch(() => {});
    await page.waitForFunction(() => window.__swarfRun && window.__swarfRun.state.prog, { timeout: 30000 }).catch(() => {});
    await wait(1500); await audit(page, skin, '09-control', found);
    await page.click('#swarf-run .sr-actions .cut').catch(() => {}); await wait(500);
    await audit(page, skin, '10-needs-card', found);
    await page.keyboard.press('Escape'); await wait(300);
    const press = t => page.evaluate(t => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t && b.offsetParent)?.click(), t);
    await press('zero x y'); await press('zero z'); await wait(300);
    await page.evaluate(() => { window.__swarfRun.state.traced = true; window.__swarfRun.card(null); }); await wait(300);
    await page.click('#swarf-run .sr-actions .cut').catch(() => {}); await wait(600);
    await audit(page, skin, '11-cut-card', found);
    await page.keyboard.press('Escape'); await wait(300);
    await press('z plate'); await wait(900);
    await audit(page, skin, '12-plate-card', found);
    await page.keyboard.press('Escape'); await wait(300);
    await page.click('#swarf-run .sr-actions .air').catch(() => {}); await wait(600);
    await page.evaluate(() => { for (const c of document.querySelectorAll('#swarf-run .sr-sheet.on input[type=checkbox]')) c.click(); document.querySelector('#swarf-run .sr-sheet.on .go')?.click(); });
    await wait(1500); await audit(page, skin, '13-running', found);
    await page.keyboard.press('k'); await wait(800);
    await audit(page, skin, '14-paused', found);
    await page.evaluate(() => window.__swarfRun.state.machine.stop()); await wait(500);
    await page.close();
  }
} finally { await browser.close(); }
// one line per problem: text and where, worst first; repeats across screens folded
const key = f => `${f.skin}|${f.path}|${f.text}`;
const fold = new Map();
for (const f of found) { const k = key(f); const o = fold.get(k); if (!o || f.ratio < o.ratio) fold.set(k, { ...f, screens: [...new Set([...(o ? o.screens : []), f.screen])] }); else o.screens.push(f.screen); }
const list = [...fold.values()].sort((a, b) => a.ratio - b.ratio);
writeFileSync(`${OUT}/legibility.json`, JSON.stringify(list, null, 1));
for (const f of list) console.log(`${f.skin.padEnd(7)} ${String(f.ratio).padStart(5)} / ${f.need}${f.disabled ? ' (off)' : ''}  ${f.size}px  "${f.text}"  ${f.path}  [${f.screens.join(',')}]  fg ${f.fg} bg ${f.bg}`);
console.log(`legibility: ${list.length} below the line (${list.filter(f => !f.disabled).length} on live controls)`);
