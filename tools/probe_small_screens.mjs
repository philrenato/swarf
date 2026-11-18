// Small and scaled screens: the panels, cards and dialogs a student meets, in both skins, at the
// window sizes school laptops show (13" and 14" MacBooks at their scaled defaults, 1366 x 768,
// 1024 x 600 and that at 150 % zoom). Each view is saved as a picture and measured in the page:
//   - a control or text box running out of its panel or the window, sideways
//   - text cut off (wider than its box, with no way to scroll to it)
//   - text wrapped about one word to a line
//   - a button more than two lines tall
//   - a card or dialog whose buttons sit outside the window
//   node tools/probe_small_screens.mjs [url] [outdir]
//   SIZES=1280x720,1024x600 SKINS=glass  narrow the sweep; STRICT=1 exits 1 on any finding
import puppeteer from 'puppeteer-core';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.argv[3] || join(tmpdir(), `swarf-small-${Date.now()}`);
const ALL = [[1280, 720], [1280, 800], [1366, 768], [1440, 900], [1470, 956], [1512, 982], [1024, 600], [683, 400]];
const SIZES = process.env.SIZES ? process.env.SIZES.split(',').map(s => s.split('x').map(Number)) : ALL;
const SKINS = process.env.SKINS ? process.env.SKINS.split(',') : ['glass', 'classic'];
const wait = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const errors = [], findings = [];

// the measures, run in the page; returns one line per problem
const MEASURE = () => {
  const W = innerWidth, H = innerHeight, out = [];
  const seen = e => { if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; for (let a = e; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; } return true; };
  const name = e => { const id = e.id ? '#' + e.id : ''; const c = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; const t = (e.innerText || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 40); return `${e.tagName.toLowerCase()}${id}${c}${t ? ` "${t}"` : ''}`; };
  const scrolls = cs => /(auto|scroll)/.test(cs.overflowX + cs.overflowY);
  const clipper = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(cs.overflowX)) return a; } return null; };
  const inScroller = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 2) return a; } return null; };
  const skip = e => e.closest('#container, canvas, svg, #swarf-phone-wall, #layer-slider, #stats, .swarf-sky, #swarf-watermark') || (e.closest('#mod-x-any') && !e.closest('.swarf-x-card'));
  // cards and menus that float over the page on purpose: what they cover, and what scrolls under their own sticky rows, is not a fault
  const FLOAT = '#swarf-start, dialog, #modal, .mdialog, #swarf-help-float, #swarf-concerns, .sr-sheet, .swarf-ctx, .top-menu-drop, #swarf-bits, #alert-area, .selection-panel';
  const all = [...document.querySelectorAll('body *')].filter(e => !skip(e) && seen(e));
  for (const e of all) {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    const leaf = /^(BUTTON|INPUT|SELECT|LABEL|TEXTAREA|A)$/.test(e.tagName) || [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!leaf) continue;
    // sideways out of its panel or the window
    if (r.right > W + 1 || r.left < -1) out.push(`off the window sideways: ${name(e)} [${Math.round(r.left)}..${Math.round(r.right)} of ${W}]`);
    else { const c = clipper(e); if (c) { const q = c.getBoundingClientRect(); if ((r.right > q.right + 2 || r.left < q.left - 2) && !(/(auto|scroll)/.test(getComputedStyle(c).overflowX) && c.scrollWidth > c.clientWidth)) out.push(`runs out of ${name(c).slice(0, 40)}: ${name(e)} [${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(q.left)}..${Math.round(q.right)}]`); } }
    // cut-off text
    if (!scrolls(cs) && e.tagName !== 'INPUT' && e.tagName !== 'SELECT' && e.tagName !== 'TEXTAREA' && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && /(hidden|clip)/.test(cs.overflowX)) out.push(`text cut off: ${name(e)} [${e.scrollWidth} in ${e.clientWidth}]`);
    // one word to a line
    const tn = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    const words = tn.map(n => n.textContent.trim()).join(' ').split(/\s+/).filter(Boolean).length;
    if (words >= 3) {
      const rg = document.createRange(), tops = new Set();
      for (const n of tn) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width > 1) tops.add(Math.round(q.top / 4)); }
      if (tops.size >= 3 && words / tops.size < 1.6) out.push(`one word a line (${words} words on ${tops.size} lines, ${Math.round(r.width)} px wide): ${name(e)}`);
    }
    // a button over two lines tall
    if (e.tagName === 'BUTTON' || e.getAttribute('role') === 'button') {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const rg = document.createRange(), tops = new Set(); rg.selectNodeContents(e);
      for (const q of rg.getClientRects()) if (q.width > 1 && q.height > 4) tops.add(Math.round(q.top / Math.max(8, lh * 0.8)));
      if (tops.size > 2 && r.height - pad > lh * 2.4) out.push(`button ${tops.size} lines tall: ${name(e)} [${Math.round(r.width)}×${Math.round(r.height)}]`);
    }
    // a control another one sits on (a full-window cover, a card's backdrop, is not counted)
    if (/^(BUTTON|INPUT|SELECT)$/.test(e.tagName) || e.classList.contains('swarf-step')) {
      const x = Math.min(Math.max(r.left + r.width / 2, 0), W - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), H - 1);
      let shown = true;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)) { const q = a.getBoundingClientRect(); if (x < q.left || x > q.right || y < q.top || y > q.bottom) shown = false; } }
      const hit = shown && document.elementFromPoint(x, y);
      if (hit && hit !== e && !e.contains(hit) && !hit.contains(e) && !skip(hit) && (!hit.closest(FLOAT) && !e.closest(FLOAT) || (hit.closest(FLOAT) && e.closest(FLOAT) && !hit.closest(FLOAT).contains(e) && !e.closest(FLOAT).contains(hit)))) {
        const hr = hit.getBoundingClientRect();
        let big = hr.width * hr.height > W * H * 0.4;
        for (let a = hit; a && !big; a = a.parentElement) { const q = a.getBoundingClientRect(); if (getComputedStyle(a).position === 'fixed' || getComputedStyle(a).position === 'absolute') big = q.width * q.height > W * H * 0.4 && !a.contains(e); }
        if (!big && !(hit.closest('label') && hit.closest('label').contains(e))) out.push(`covered by ${name(hit).slice(0, 50)}: ${name(e)}`);
      }
    }
    // a control outside the window with no scrolling to reach it
    if (/^(BUTTON|INPUT|SELECT)$/.test(e.tagName) && (r.bottom > H + 1 || r.top < -1) && !inScroller(e)) out.push(`out of the window, no scroll reaches it: ${name(e)} [${Math.round(r.top)}..${Math.round(r.bottom)} of ${H}]`);
  }
  return [...new Set(out)];
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 240000, userDataDir: mkdtempSync(join(tmpdir(), 'swarf-smallp-')), args: ['--window-size=1600,1000'] });
try {
  for (const skin of SKINS) for (const [W, H] of SIZES) {
    const tag = `${skin}-${W}x${H}`;
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.evaluateOnNewDocument(s => { try { localStorage.setItem('swarf_phone_mode', 'off'); localStorage.setItem('swarf-skin', s); } catch (e) {} }, skin);
    let n = 0;
    const shot = async (what, scope) => {
      await wait(450);
      const file = `${tag}-${String(++n).padStart(2, '0')}-${what}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const got = await page.evaluate(MEASURE);
      for (const g of got) findings.push(`${file}: ${g}`);
      console.log(`${file}${got.length ? `  ${got.length} findings` : ''}`);
    };
    const click = sel => page.evaluate(s => { const e = document.querySelector(s); e && e.click(); return !!e; }, sel);
    const press = (text, root = 'body') => page.evaluate((t, root) => { const b = [...document.querySelectorAll(`${root} button`)].find(b => b.offsetParent && b.textContent.trim() === t); b && b.click(); return !!b; }, text, root);
    const closeAll = async () => {
      await page.keyboard.press('Escape'); await wait(150);
      await page.evaluate(() => { try { window.kiri.api.modal.hide(); } catch (e) {} const d = document.getElementById('dialog'); if (d && d.open) d.close(); document.body.click();
        for (const m of document.querySelectorAll('#menubar .swarf-open')) m.classList.remove('swarf-open'); document.body.classList.remove('swarf-menu-open'); });
      await wait(300);
    };
    try {
      // a first load in a fresh profile can stall while the service worker installs: one more go
      for (let tries = 2; tries--;) {
        try {
          await page.goto(PAGE + (PAGE.includes('?') ? '&' : '?') + 'skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.SwarfSkin && window.__swarfRun && window.__swarfHelp && document.getElementById('swarf-material-select')), { timeout: 60000, polling: 200 });
          break;
        } catch (e) { if (!tries) throw e; console.log(`${tag}: slow first load, again`); }
      }
      await wait(2000);
      await page.evaluate(() => { const a = window.kiri.api; a.devices.select('ShopBot.Basic'); for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.util.download = () => {}; });
      await wait(800);
      await shot('empty');

      // the menus
      const heads = await page.evaluate(() => [...document.querySelectorAll('#menubar .top-menu > span')].filter(m => m.offsetParent && m.querySelector(':scope > .top-menu-drop')).map(m => (m.querySelector(':scope > label')?.textContent || '').trim()));
      for (const h of heads) {
        const at = await page.evaluate(h => { const m = [...document.querySelectorAll('#menubar .top-menu > span')].find(s => (s.querySelector(':scope > label')?.textContent || '').trim() === h); const b = m.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, h);
        await page.mouse.click(at.x, at.y);
        await shot(`menu-${h}`);
        await page.mouse.move(W / 2, H - 20);
        await closeAll();
      }

      // an SVG coming in: its size card
      await page.evaluate(() => window.kiri.api.platform.load_files([new File(['<svg xmlns="http://www.w3.org/2000/svg" width="8in" height="5in" viewBox="0 0 203.2 127"><path d="M0 0H203.2V127H0Z"/><path d="M20 20 L80 20 L80 60" fill="none" stroke="#000"/></svg>'], 'sign.svg', { type: 'image/svg+xml' })]));
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.offsetParent && b.textContent.trim() === 'make parts'), { timeout: 15000 }).catch(() => {});
      await shot('svg-size');
      await closeAll();
      await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); });

      // a part with a rough and an outline; the rough on a feed typed by hand
      await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'board', { depth: 19, resolution: 2, soup: true, dpi: 0 }));
      await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 15000 });
      await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); for (const k of ['rough', 'outline']) { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === k); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
      await wait(800);
      await page.evaluate(() => { const ops = window.kiri.api.conf.get().process.ops; const r = ops.find(o => o.type === 'rough'); if (r) { r.rate = 2000; r.spindle = 15000; } window.dispatchEvent(new Event('swarf.material.change')); });
      await wait(500);
      await shot('steps');
      // each step's card, open
      const nsteps = await page.evaluate(() => document.querySelectorAll('#oplist .draggable .swarf-op-chevron').length);
      for (let i = 0; i < nsteps; i++) {
        await page.evaluate(i => { for (const d of document.querySelectorAll('#oplist .swarf-params-open .swarf-op-chevron')) d.click(); const c = document.querySelectorAll('#oplist .draggable .swarf-op-chevron')[i]; c && c.click(); }, i);
        await wait(500);
        await page.evaluate(i => { const d = document.querySelectorAll('#oplist .draggable')[i]; d && d.scrollIntoView({ block: 'start' }); }, i);
        await shot(`step-${i + 1}-open`);
        await page.evaluate(() => { const d = document.querySelector('#oplist .swarf-params-open'); if (d) { d.scrollIntoView({ block: 'end' }); } });
        await shot(`step-${i + 1}-open-foot`);
      }
      await page.evaluate(() => { for (const d of document.querySelectorAll('#oplist .swarf-params-open .swarf-op-chevron')) d.click(); document.querySelector('#camops')?.scrollTo(0, 0); });
      // board size card
      await page.evaluate(() => [...document.querySelectorAll('#swarf-board-row button, #camops button')].find(b => /board size/i.test(b.textContent))?.click());
      await wait(500); await shot('board-size'); await closeAll();
      // the bits list
      if (await click('#swarf-open-tools')) { await wait(500); await shot('bits'); await closeAll(); }
      // the right rail: each panel open, scrolled to its foot
      await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); for (const id of ['cam-tabs', 'cam-output']) { const d = document.querySelector(`#${id} details`); if (d) d.open = true; } });
      await wait(400);
      await shot('rail');
      await page.evaluate(() => { const r = document.getElementById('swarf-right-rail'); r && (r.scrollTop = r.scrollHeight); });
      await shot('rail-foot');
      await page.evaluate(() => { const r = document.getElementById('swarf-right-rail'); r && (r.scrollTop = 0); });
      if (await click('#swarf-concerns-tab')) { await wait(400); await shot('concerns'); await click('#swarf-concerns-tab'); await wait(300); }
      // the right-click menu on the part
      const at = await page.evaluate(() => { const THREE = window.THREE, w = window.kiri.api.widgets.all()[0], { camera, renderer } = window.moto.space.internals(); const b = new THREE.Box3().setFromObject(w.mesh), c = b.getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height }; });
      await page.mouse.move(at.x, at.y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
      await shot('right-click'); await closeAll();
      // help
      await page.evaluate(() => window.__swarfHelp.open('tab')); await wait(400);
      await shot('help'); await page.evaluate(() => window.__swarfHelp.close());
      // toolpaths and control with the practice machine
      await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths')?.click(); setTimeout(res, 60000); }));
      await wait(500);
      await shot('toolpaths');
      await page.evaluate(() => { const b = document.getElementById('act-export'); b && b.click(); });
      await page.waitForFunction(() => { const c = document.querySelector('#mod-x-any.swarf-x .swarf-x-card'); return c && c.offsetParent; }, { timeout: 30000 }).catch(() => {});
      await shot('export'); await closeAll();
      await page.click('#swarf-step-run').catch(() => {});
      await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.machine, { timeout: 60000 }).catch(() => {});
      await wait(1200);
      await shot('control');
      const shut = async () => { await page.evaluate(() => { const s = document.querySelector('#swarf-run .sr-sheet.on'); const b = s && [...s.querySelectorAll('button')].find(b => /^(cancel|not now|back|close|done|×)$/i.test(b.textContent.trim())); if (b) b.click(); else if (s) s.classList.remove('on'); }); await wait(300); };
      for (const [t, what] of [['trace', 'card-trace'], ['air cut', 'card-air'], ['cut', 'card-cut'], ['z plate', 'card-plate']]) {
        if (await press(t, '#swarf-run')) { await wait(700); await shot(what); await shut(); }
      }
      await page.evaluate(() => window.__swarfRun.close && window.__swarfRun.close());
      await wait(500);
      // TEX's card
      await page.evaluate(() => { const a = window.kiri.api; a.view.set_arrange && a.view.set_arrange(); a.platform.select(a.widgets.all()[0]); });
      await wait(500);
      if (await click('#swarf-step-draw')) { await wait(1500); await shot('draw'); await page.evaluate(() => [...document.querySelectorAll('#swarf-draw button')].find(b => /^cancel$/i.test(b.textContent.trim()))?.click()); await closeAll(); }
      await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
      if (await click('#swarf-step-tex')) { await wait(1500); await shot('tex'); await page.evaluate(() => document.getElementById('tx-cancel')?.click()); await closeAll(); }
    } catch (e) {
      errors.push(`${tag}: ${e.message}`); console.log('ERROR', tag, e.message);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
writeFileSync(join(OUT, `findings-${SKINS.join('-')}.txt`), findings.join('\n') + '\n');
for (const e of errors) console.log('PAGE ERROR', e);
console.log(`small screens: ${findings.length} findings (${join(OUT, `findings-${SKINS.join('-')}.txt`)}), shots in ${OUT}`);
process.exit(process.env.STRICT && findings.length ? 1 : 0);
