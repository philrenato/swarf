// Help floats beside the work (Interfacing deviation #2, Phil 11-13): help › search help opens a
// non-modal card, not Kiri's blocking dialog. With it open the bed still takes a click (a part is
// picked); its top bar drags it; a reload puts it back where it was left; a concern's help button
// opens that concern's entry in it; Escape inside it closes it, gives focus back and leaves the part
// picked; × closes it; a narrow window keeps it on screen. Preferences stay a dialog.
//   node tools/probe_help_float.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-help-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  const boot = async () => {
    await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfHelp && window.moto?.space), { timeout: 90000, polling: 200 });
    await wait(1500);
  };
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await boot();
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  // a 3 mm board: thinner than the shop's 1/4 in, so one concern ("sign is 3.0 mm thick")
  const board = async () => {
    await page.evaluate(() => { const a = window.kiri.api; a.platform.clear(); a.conf.get().process.ops = []; a.conf.save(); });
    await wait(400);
    await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="120mm" viewBox="0 0 200 120"><rect width="200" height="120"/></svg>', 'sign', { depth: 3, soup: true, dpi: 0 }));
    await wait(1200);
    await page.evaluate(() => { window.kiri.api.platform.deselect?.(); window.moto.space.view.top(); });
    await wait(1200);
  };
  await board();
  const centre = () => page.evaluate(() => {
    const THREE = window.THREE, w = window.kiri.api.widgets.all()[0], { camera, renderer } = window.moto.space.internals();
    const b = new THREE.Box3().setFromObject(w.mesh), c = b.getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height };
  });
  const picked = () => page.evaluate(() => window.kiri.api.selection.widgets().map(w => w.meta.file || w.id));
  const card = () => page.evaluate(() => {
    const c = document.getElementById('swarf-help-float'), r = c.getBoundingClientRect(), i = document.getElementById('swarf-search-input');
    return { shown: !c.hidden && getComputedStyle(c).display !== 'none', left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
      role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), label: c.getAttribute('aria-label'), focusIn: c.contains(document.activeElement),
      q: i.value, first: document.querySelector('#swarf-search-results .swarf-result strong')?.textContent || '', hit: document.querySelector('#swarf-search-results .swarf-result-hit strong')?.textContent || '',
      n: document.querySelectorAll('#swarf-search-results .swarf-result').length, kiriModal: window.kiri.api.modal.visible() };
  });

  // ── open from the menu ──
  await page.evaluate(() => document.getElementById('swarf-help-search').click());
  await wait(500);
  let c = await card();
  check(c.shown && !c.kiriModal, `help › search help opens the floating card, no Kiri dialog (${JSON.stringify({ shown: c.shown, kiriModal: c.kiriModal })})`);
  check(c.role === 'dialog' && c.modal === 'false' && c.label === 'help', `role=dialog, aria-modal=false, aria-label=help (${c.role}/${c.modal}/${c.label})`);
  check(c.focusIn, 'focus moves into help on open');
  check(c.n > 50 && c.q === '', `every entry listed before a search (${c.n})`);
  // search works
  await page.type('#swarf-search-input', 'auto tabs');
  await wait(300);
  c = await card();
  check(c.first === 'auto tabs', `typing "auto tabs" puts that entry first (${c.first})`);

  // ── the bed takes a click with help open ──
  const at = await centre();
  const over = await page.evaluate(p => { const e = document.elementFromPoint(p.x, p.y); return e && e.closest('#swarf-help-float') ? 'help' : e?.tagName; }, at);
  check(over === 'CANVAS', `the part's middle is bed, not help (${over} at ${Math.round(at.x)},${Math.round(at.y)}; help ${c.left}-${c.right})`);
  await page.mouse.move(at.x + 5, at.y + 5); await page.mouse.move(at.x, at.y); await page.mouse.click(at.x, at.y);
  await wait(700);
  check((await picked()).join() === 'sign', 'a click on the part picks it while help is open');
  check((await card()).shown, 'help stays open after the bed click');

  // ── drag by the top bar ──
  c = await card();
  const g = await page.evaluate(() => { const r = document.getElementById('swarf-help-grip').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
  await page.mouse.move(g.x, g.y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(g.x - 25 * k, g.y - 15 * k); await wait(30); }
  await page.mouse.up();
  await wait(300);
  const moved = await card();
  check(Math.abs(moved.left - c.left + 150) <= 2 && Math.abs(moved.top - c.top + 90) <= 2, `dragging the bar moves it by -150,-90 (${c.left},${c.top} → ${moved.left},${moved.top})`);
  check((await picked()).join() === 'sign', 'the drag leaves the part picked');
  // past the window's edge it stops at the edge
  const g2 = await page.evaluate(() => { const r = document.getElementById('swarf-help-grip').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
  await page.mouse.move(g2.x, g2.y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(g2.x + 200 * k, g2.y); await wait(30); }
  await page.mouse.move(g2.x + 1200, g2.y); await page.mouse.up(); await wait(300);
  const edge = await card();
  check(edge.right <= 1440 && edge.right >= 1420, `dragged past the right edge it stays on screen (right ${edge.right})`);
  // and back to the place the reload must remember
  const g3 = await page.evaluate(() => { const r = document.getElementById('swarf-help-grip').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
  await page.mouse.move(g3.x, g3.y); await page.mouse.down(); await page.mouse.move(g3.x - (edge.left - moved.left), g3.y, { steps: 5 }); await page.mouse.up(); await wait(300);
  const stored = await page.evaluate(() => { try { return localStorage.getItem('swarf.help.pos'); } catch (e) { return 'throws'; } });
  check(!!stored && JSON.parse(stored).left === moved.left, `the place is kept in this browser (${stored})`);

  // ── close with × ──
  await page.click('#swarf-help-close');
  await wait(300);
  check(!(await card()).shown, '× closes help');

  // ── a reload remembers the place ──
  await page.reload({ waitUntil: 'domcontentloaded' });
  await boot();
  await page.evaluate(() => document.getElementById('swarf-help-search').click());
  await wait(500);
  c = await card();
  check(c.shown && c.left === moved.left && c.top === moved.top, `after a reload help opens where it was left (${c.left},${c.top} vs ${moved.left},${moved.top})`);
  await page.click('#swarf-help-close');
  await wait(300);

  // ── a concern's help button opens its entry ──
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(500);
  await board();
  const cs = await page.evaluate(() => [...document.querySelectorAll('#swarf-concerns-body .swarf-concern')].map(d => ({ t: d.querySelector('strong')?.textContent, h: d.querySelector('.swarf-concern-help')?.getAttribute('data-swarf-help') || '' })));
  console.log('   concerns:', JSON.stringify(cs));
  const thin = cs.find(x => / thick$/.test(x.t || ''));
  check(!!thin && thin.h === 'your board', `the thin-board concern carries a help button for "your board" (${JSON.stringify(thin)})`);
  // pick the part, open the concerns, and press the help button from the keyboard (focus to return to it)
  const at2 = await centre();
  await page.mouse.move(at2.x + 5, at2.y + 5); await page.mouse.move(at2.x, at2.y); await page.mouse.click(at2.x, at2.y);
  await wait(600);
  await page.click('#swarf-concerns-tab');
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-concerns-body .swarf-concern')].find(d => / thick$/.test(d.querySelector('strong').textContent)).querySelector('.swarf-concern-help').focus());
  await page.keyboard.press('Enter');
  await wait(500);
  c = await card();
  check(c.shown && c.q === 'your board' && c.first === 'your board' && c.hit === 'your board', `the concern's help opens help on "your board", marked (${JSON.stringify({ shown: c.shown, q: c.q, first: c.first, hit: c.hit })})`);
  check(c.focusIn, 'focus is inside help after the concern opens it');
  const concernsOpen = await page.evaluate(() => document.getElementById('swarf-concerns').classList.contains('open'));
  check(concernsOpen, 'the concerns list stays open beside help');

  // ── Escape inside help closes it, focus goes back, the part stays picked ──
  check((await picked()).join() === 'sign', 'the part is picked before Escape');
  await page.keyboard.press('Escape');
  await wait(500);
  c = await card();
  const back = await page.evaluate(() => document.activeElement?.classList.contains('swarf-concern-help') ? 'concern help button' : (document.activeElement?.id || document.activeElement?.tagName));
  check(!c.shown, 'Escape inside help closes it');
  check(back === 'concern help button', `focus goes back to what opened it (${back})`);
  check((await picked()).join() === 'sign', 'Escape in help leaves the part picked');
  check(await page.evaluate(() => document.getElementById('swarf-concerns').classList.contains('open')), "help's Escape leaves the concerns open");

  // ── Delete typed in help never deletes the part ──
  await page.evaluate(() => window.__swarfHelp.open());
  await wait(300);
  await page.focus('#swarf-help-close');
  await page.keyboard.press('Backspace');
  await wait(300);
  check(await page.evaluate(() => window.kiri.api.widgets.all().length) === 1, 'Backspace on help\'s close button deletes no part');
  await page.keyboard.press('Escape');
  await wait(300);

  // ── preferences stay a dialog ──
  await page.evaluate(() => document.getElementById('set-prefs').click());
  await wait(500);
  check(await page.evaluate(() => window.kiri.api.modal.is('prefs')), 'preferences still open in the dialog');
  await page.evaluate(() => window.kiri.api.modal.hide());
  await wait(400);

  // ── a narrow window keeps it on screen (narrower is the phone page, which hides the app and help with it) ──
  await page.setViewport({ width: 900, height: 600 });
  await wait(600);
  await page.evaluate(() => window.__swarfHelp.open('tab'));
  await wait(400);
  c = await card();
  check(c.shown && c.left >= 0 && c.top >= 0 && c.right > c.left && c.right <= 900 && c.bottom <= 600, `in a 900 x 600 window help is all on screen (${c.left},${c.top} → ${c.right},${c.bottom})`);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 900, `no sideways page scroll (${sw})`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(bad.length ? `probe_help_float: FAIL (${bad.length})` : 'probe_help_float: PASS');
process.exit(bad.length ? 1 : 0);
