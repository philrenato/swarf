// The light skins paint nothing dark first, and each card has one frame.
//   node tools/probe_no_dark_flash.mjs [url] [skin ...]   (skins default: glass classic)
// For each skin:
//   load: Kiri's dark palette (the one every skin is drawn from) is on from the first frame
//   menus: every frame from a click on the menu's name, through the pointer crossing the list and
//          resting on rows, has no dark fill in the list but the row under the pointer
//   cards: the export card, the machine, help and about cards, the STL units card, the bits list,
//          concerns and a step open for editing: no dark fill in any frame from the click on
//          (a small control with light text on it, a chosen or primary button, is meant)
//   frames: no card has a frame inside its frame (two framed boxes, one filling the other)
//   the open step's "editing" badge reads (4.5:1), and bits sits on the steps' "add a step" line
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
import { darkFills } from './skin_contrast.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const SKINS = process.argv.slice(3).length ? process.argv.slice(3) : ['glass', 'classic'];
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const errors = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });

// in the page: records dark fills under a selector on every frame until stopped
const startFrames = (scope, allow) => {
  window.__frames = { list: [], n: 0, run: true };
  const darkFillsFn = new Function('return ' + window.__darkFillsSrc)();
  const tick = () => {
    const F = window.__frames;
    if (!F.run) return;
    F.n++;
    for (const d of darkFillsFn(scope, allow)) if (!F.list.includes(d)) F.list.push(`frame ${F.n}: ${d}`);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const stopFrames = () => { const F = window.__frames; F.run = false; return { n: F.n, list: F.list.filter((d, i, a) => a.findIndex(x => x.replace(/^frame \d+: /, '') === d.replace(/^frame \d+: /, '')) === i) }; };

// in the page: framed boxes inside a framed box of the card, the inner filling most of the outer
const nestedFrames = scope => {
  const framed = el => {
    const cs = getComputedStyle(el);
    if (!el.checkVisibility()) return false;
    const bg = cs.backgroundColor.match(/[\d.]+/g) || [0, 0, 0, 0];
    const fill = (bg.length > 3 ? +bg[3] : 1) > 0.25 || /gradient/.test(cs.backgroundImage);
    const edge = ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && !/rgba\([^)]*, 0\)|transparent/.test(cs['border' + s + 'Color']));
    const lift = cs.boxShadow !== 'none' || cs.backdropFilter !== 'none' || parseFloat(cs.borderTopLeftRadius) >= 8;
    return fill && (edge || lift) && cs.clipPath !== 'inset(0px)';
  };
  const out = [];
  for (const host of document.querySelectorAll(scope)) {
    if (!host.checkVisibility()) continue;
    const boxes = [host, ...host.querySelectorAll('div, section, form')].filter(framed);
    for (const inner of boxes) {
      // the nearest framed box around it (boxes run in document order: the last holder is the nearest)
      const outer = boxes.filter(o => o !== inner && o.contains(inner)).pop();
      if (!outer) continue;
      const a = inner.getBoundingClientRect(), b = outer.getBoundingClientRect();
      if (a.width * a.height > 0.5 * b.width * b.height) out.push(`${outer.id || outer.className} holds ${inner.id || inner.className}`);
    }
  }
  return out;
};

try {
  for (const skin of SKINS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', e => errors.push(`${skin}: ${e.message}`));
    // the palette on every frame from the first
    await page.evaluateOnNewDocument(() => {
      window.__themes = [];
      const tick = () => { window.__themes.push(document.documentElement.getAttribute('data-theme') || ''); if (window.__themes.length < 600) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await page.goto(PAGE + (PAGE.includes('?') ? '&' : '?') + 'skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(3000);   // the service worker may reload once
    await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.SwarfSkin && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
    const themes = await page.evaluate(() => window.__themes);
    const light = themes.findIndex(t => t !== 'dark');
    check(themes.length > 0 && light < 0, `${skin}: the dark palette from the first frame (${themes.length} frames${light >= 0 ? `, frame ${light} was "${themes[light]}"` : ''})`);
    await page.evaluate((s, src) => {
      localStorage.setItem('swarf-skin', s); window.SwarfSkin.set(s);
      window.__darkFillsSrc = src;
      const a = window.kiri.api; a.devices.select('ShopBot.Basic'); for (const w of a.widgets.all()) a.platform.delete(w);
      a.util.download = () => {};
    }, skin, darkFills.toString());
    await wait(1500);
    const begin = (scope, allow) => page.evaluate(startFrames, scope, allow || '');
    const end = () => page.evaluate(stopFrames);

    // menus
    const heads = await page.evaluate(() => [...document.querySelectorAll('#menubar .top-menu > span')].filter(m => m.querySelector(':scope > .top-menu-drop')).map(m => (m.querySelector(':scope > label')?.textContent || '').trim()));
    for (const h of heads) {
      const at = await page.evaluate(h => { const m = [...document.querySelectorAll('#menubar .top-menu > span')].find(s => (s.querySelector(':scope > label')?.textContent || '').trim() === h); const b = m.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, h);
      await begin('#menubar .top-menu > span.swarf-open .top-menu-drop', '.top-menu-drop .content > div:hover, .top-menu-drop .content > div:hover *');
      await page.mouse.click(at.x, at.y);
      await wait(120);
      const spots = await page.evaluate(() => { const c = document.querySelector('#menubar .swarf-open .top-menu-drop > .content'); if (!c) return []; const b = c.getBoundingClientRect(); const rows = [...c.children].filter(d => d.offsetParent && d.tagName === 'DIV'); const mid = rows[Math.floor(rows.length / 2)]?.getBoundingClientRect(); return [{ x: b.x + 3, y: b.y + 3 }, { x: b.x + b.width / 2, y: b.y + 2 }, ...(mid ? [{ x: mid.x + mid.width / 2, y: mid.y + mid.height / 2 }] : []), { x: b.x + b.width / 2, y: b.bottom - 3 }]; });
      for (const s of spots) { await page.mouse.move(s.x, s.y, { steps: 4 }); await wait(90); }
      const f = await end();
      check(spots.length && !f.list.length, `${skin}: menu ${h}, ${f.n} frames, no dark fill but the row under the pointer${f.list.length ? ': ' + f.list.slice(0, 3).join('; ') : ''}`);
      await page.mouse.move(at.x, at.y + 500);
      await page.keyboard.press('Escape'); await page.evaluate(() => document.body.click()); await wait(200);
    }

    // cards, from the click that opens them
    // framed: a card of its own, checked for a frame inside its frame (a step card sits in its list)
    const card = async (what, scope, open, close, framed = true) => {
      await begin(scope);
      const opened = await open();
      await wait(700);
      const f = await end();
      const nested = framed ? await page.evaluate(nestedFrames, scope) : [];
      // the card must really be on screen, or the frame checks below see nothing and pass
      const shown = await page.evaluate(sc => [...document.querySelectorAll(sc)].some(e => e.offsetParent && e.getBoundingClientRect().height > 20), scope);
      check(opened !== false && shown && f.n > 5, `${skin}: ${what} opens and shows (${f.n} frames${shown ? '' : ', not on screen'})`);
      check(!f.list.length, `${skin}: ${what}, no dark fill in any frame${f.list.length ? ': ' + f.list.slice(0, 3).join('; ') : ''}`);
      if (framed) check(!nested.length, `${skin}: ${what}, one frame${nested.length ? ': ' + nested.join('; ') : ''}`);
      if (close) await close();
      await page.keyboard.press('Escape'); await page.evaluate(() => { try { window.kiri.api.modal.hide(); } catch (e) {} }); await wait(300);
    };
    const press = id => () => page.evaluate(id => { const e = document.getElementById(id); e && e.click(); return !!e; }, id);
    await card('the machine card', '#modal', press('set-device'));
    await card('the about card', '#modal', press('app-help'));
    await card('every word in swarf', '#modal', press('swarf-concordance'));
    const stl = 'solid b\n' + [[[0, 0, 0], [50, 75, 0], [50, 0, 0]], [[0, 0, 0], [0, 75, 0], [50, 75, 0]], [[0, 0, 19], [50, 0, 19], [50, 75, 19]]].map(t => ` facet normal 0 0 0\n  outer loop\n${t.map(v => `   vertex ${v.join(' ')}`).join('\n')}\n  endloop\n endfacet`).join('\n') + '\nendsolid b\n';
    await card('the STL units card', '.swarf-stl-units', () => page.evaluate(t => { const a = window.kiri.api; a.platform.clear(); a.platform.load_files([new File([t], 'block.stl')]); }, stl).then(() => wait(1500)),
      () => page.evaluate(() => [...document.querySelectorAll('.swarf-stl-units button')].find(b => b.textContent === 'done')?.click()));
    await page.evaluate(() => { const a = window.kiri.api; a.platform.clear(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'plate', { depth: 12, resolution: 2, soup: true, dpi: 0 }); });
    await wait(1200);
    await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await wait(500);
    await card('a step open for editing', '#oplist', () => page.evaluate(() => { const c = document.querySelector('#oplist .draggable.has-params:not(.swarf-params-open) .swarf-op-chevron'); c && c.click(); return !!c; }), null, false);
    const badge = await page.evaluate(() => {
      const c = document.querySelector('#oplist .swarf-params-open .swarf-op-chevron');
      if (!c) return null;
      const n = s => (s.match(/[\d.]+/g) || []).map(Number);
      const cs = getComputedStyle(c), fg = n(cs.color);
      // a gradient fill (wet plastic) has no background colour: read its first colour stop
      const grad = cs.backgroundImage && cs.backgroundImage !== 'none' ? (cs.backgroundImage.match(/rgba?\([^)]*\)/) || [])[0] : null;
      const bg = n(grad || cs.backgroundColor);
      const L = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = x => 0.2126 * L(x[0]) + 0.7152 * L(x[1]) + 0.0722 * L(x[2]);
      const a = lum(fg), b = lum(bg);
      return { ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2), fg: cs.color, bg: grad || cs.backgroundColor, alpha: bg.length > 3 ? bg[3] : 1, grad: !!grad };
    });
    check(badge && (badge.alpha < 0.5 || badge.ratio >= 4.5), `${skin}: the "editing" badge reads (${JSON.stringify(badge)})`);
    const bits = await page.evaluate(() => { const b = document.getElementById('swarf-open-tools'), l = b && b.closest('.swarf-add-op-label'); return !!(l && l.textContent.includes('add a step') && b.offsetParent); });
    check(bits, `${skin}: bits sits on the "add a step" line`);
    await card('the bits list', '#swarf-bits', press('swarf-open-tools'));
    await card('concerns', '#swarf-concerns', press('swarf-concerns-tab'), press('swarf-concerns-tab'));
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths')?.click(); setTimeout(res, 60000); }));
    await card('the export card', '#modal', async () => { await press('act-export')(); await page.waitForFunction(() => { const c = document.querySelector('#mod-x-any.swarf-x .swarf-x-card'); return c && c.offsetParent; }, { timeout: 30000 }).catch(() => {}); });
    await page.close();
  }
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally { await browser.close(); }
console.log(bad.length ? `no dark flash: ${bad.length} failed` : 'no dark flash: ok');
process.exit(bad.length ? 1 : 0);
