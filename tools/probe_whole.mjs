// The whole-app review r086 (one product, first open to a finished cut): the right rail keeps its
// panels' headers and the concerns pill clear of them at 1440×900 and 1280×720 in every skin (F2);
// the page is the window and Space never scrolls it (F3); with inches set, the step card, control,
// the plate card and the start card say inches (F4); Delete with nothing picked does nothing,
// never acts inside control, and a part's delete comes back with ⌘Z (F1); export is one swarf card
// that saves <name>.sbp (B1); the hidden letter keys stay quiet in cam (F6); the mode row and the
// menu bar are in the Tab order (F7); the file and edit menus carry one save, export, undo, redo,
// delete and select all (C1/C2); advanced never stacks Kiri's panels over the rail and offers no
// laser/lathe/index steps on the ShopBot (C3); reset profile is a swarf card, not a browser dialog.
//   node tools/probe_whole.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

async function open(W, H, skin) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-whole-')), args: [`--window-size=${W},${H}`] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  const dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { dialogs.push(d.type() + ': ' + d.message()); await d.dismiss().catch(() => {}); });
  await page.goto(PAGE + (PAGE.includes('?') ? '&' : '?') + 'skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.SwarfLength && window.SwarfSkin && document.getElementById('swarf-step-shape') && document.getElementById('swarf-material-select') && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(2000);
  await page.evaluate(() => { window.kiri.api.devices.select('ShopBot.Basic'); for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(800);
  return { browser, page, dialogs };
}
const units = (page, u) => page.evaluate(u => { const b = [...document.querySelectorAll('#swarf-units button')].find(b => b.textContent.trim() === u); b.click(); }, u).then(() => wait(600));
const shape = async page => {
  await page.click('#swarf-step-shape'); await wait(600);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /^make$/i.test(b.textContent.trim()) && b.offsetParent).click());
  await page.waitForFunction(() => window.kiri.api.widgets.all().length >= 1, { timeout: 10000 }); await wait(800);
};
const pick = page => page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
const addOp = (page, op) => page.evaluate(op => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === op); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }, op);
const toolpaths = async page => { await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 60000); })); await wait(800); };
const alerts = page => page.evaluate(() => [...document.querySelectorAll('#alert-area, #alert-text')].filter(e => e.offsetParent).map(e => e.innerText.replace(/\s+/g, ' ').trim()).join(' | '));

// F2 + F3: rail and page, three skins at two sizes
for (const [W, H] of [[1440, 900], [1280, 720]]) for (const skin of ['glass', 'classic', 'swarf']) {
  const { browser, page } = await open(W, H, skin);
  const tag = `${skin} ${W}×${H}`;
  try {
    await shape(page); await pick(page);
    await page.evaluate(() => { for (const id of ['cam-tabs', 'cam-output']) { const d = document.querySelector(`#${id} details`); if (d) d.open = true; else document.querySelector(`#${id} .set-header`)?.click(); } });
    await wait(600);
    const r = await page.evaluate(() => {
      const rail = document.getElementById('swarf-right-rail'), rr = rail.getBoundingClientRect();
      const kids = [...rail.children].filter(k => k.offsetParent && k.getBoundingClientRect().height > 4);
      const squashed = kids.filter(k => k.scrollHeight > k.clientHeight + 1).map(k => `${k.id || k.className}: ${k.clientHeight} of ${k.scrollHeight}`);
      const heads = kids.map(k => k.querySelector('summary.set-header, .set-header')).filter(Boolean).map(hd => ({ t: hd.innerText.trim(), h: Math.round(hd.getBoundingClientRect().height) }));
      const c = document.getElementById('swarf-concerns').getBoundingClientRect();
      const hit = kids.filter(k => { const b = k.getBoundingClientRect(); const top = Math.max(b.top, rr.top), bot = Math.min(b.bottom, rr.bottom); return bot > top && c.left < b.right && c.right > b.left && c.top < bot && c.bottom > top; }).map(k => k.id || k.className);
      return { squashed, heads, hit, pill: [c.top, c.bottom].map(Math.round), inWin: c.bottom <= innerHeight && c.top >= 0, railBottom: Math.round(rr.bottom), scrolls: rail.scrollHeight > rail.clientHeight ? getComputedStyle(rail).overflowY : 'fits' };
    });
    check(!r.squashed.length, `${tag}: no rail panel squashed [${r.squashed}] (rail ${r.scrolls})`);
    check(r.heads.length >= 3 && r.heads.every(x => x.t && x.h >= 14), `${tag}: every rail header shows its word [${r.heads.map(x => `${x.t}:${x.h}`)}]`);
    check(!r.hit.length && r.inWin, `${tag}: the concerns pill (${r.pill}) is on screen and over no rail panel (rail ends ${r.railBottom}) [${r.hit}]`);
    const pg = await page.evaluate(() => ({ docH: document.documentElement.scrollHeight, win: innerHeight, ov: getComputedStyle(document.documentElement).overflow + '/' + getComputedStyle(document.body).overflow }));
    check(pg.ov.startsWith('hidden') && pg.ov.endsWith('hidden'), `${tag}: html and body do not scroll (${pg.ov}; document ${pg.docH} in ${pg.win})`);
    if (skin === 'glass') {
      await addOp(page, 'outline'); await toolpaths(page);
      const bar0 = await page.evaluate(() => Math.round(document.getElementById('menubar').getBoundingClientRect().top));
      await page.evaluate(() => document.getElementById('act-animate').click()); await wait(2500);
      await page.mouse.click(Math.round(W / 2), Math.round(H / 2)); await wait(200);
      for (let i = 0; i < 3; i++) { await page.keyboard.press('Space'); await wait(250); }
      await page.mouse.wheel({ deltaY: 600 }); await wait(300);
      const s = await page.evaluate(() => ({ y: window.scrollY, html: document.documentElement.scrollTop, body: document.body.scrollTop, bar: Math.round(document.getElementById('menubar').getBoundingClientRect().top) }));
      check(s.y === 0 && s.html === 0 && s.body === 0 && s.bar === bar0, `${tag}: Space and a wheel in simulate scroll nothing (scrollY ${s.y}, menubar top ${s.bar}, was ${bar0})`);
    }
  } finally { await browser.close(); }
}

// F1, F4, B1 and the rest, wet plastic 1440×900
{
  const { browser, page, dialogs } = await open(1440, 900, 'glass');
  try {
    // F4 the start card in inches
    await units(page, 'in');
    const bed = await page.evaluate(() => document.querySelector('#swarf-start .bed')?.textContent || '');
    check(/96 × 48 in/.test(bed) && !/mm/.test(bed), `start card's bed in inches ("${bed}")`);
    // F6 hidden letter keys in cam: none opens Kiri's screens
    for (const k of ['r', 'e', 'p', 'x', '?']) {
      await page.mouse.click(720, 600); await page.keyboard.press(k); await wait(500);
      const m = await page.evaluate(() => [...document.querySelectorAll('.mdialog, #dialog')].filter(d => d.offsetParent && getComputedStyle(d).display !== 'none').map(d => d.id || d.className));
      check(!m.length, `key ${k} in cam opens nothing [${m}]`);
      await page.evaluate(() => { try { window.kiri.api.modal.hide(); } catch (e) {} });
    }
    // an import's dialog: Esc answers as cancel (nothing waits for good); an SVG says its open lines
    const esc = await page.evaluate(() => { window.__wholeEsc = 'waiting'; window.kiri.api.uc.confirm('a question?', { yes: true, cancel: false }).then(v => { window.__wholeEsc = v; }); return true; });
    await wait(600); await page.keyboard.press('Escape'); await wait(600);
    check(esc && await page.evaluate(() => window.__wholeEsc) === false, `Esc on a swarf card answers cancel (${await page.evaluate(() => String(window.__wholeEsc))})`);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect x="5" y="5" width="40" height="30"/><path d="M60 10 L90 10 L90 40" fill="none" stroke="#000"/></svg>';
    const loadSvg = () => page.evaluate(t => window.kiri.api.platform.load_files([new File([t], 'probe-open.svg', { type: 'image/svg+xml' })]), svg);
    await loadSvg();
    await page.waitForFunction(() => [...document.querySelectorAll('#dialog button')].some(b => /make parts/.test(b.textContent) && b.offsetParent), { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /cancel/.test(b.textContent)).click());
    await wait(800);
    check(await page.evaluate(() => window.kiri.api.widgets.all().length) === 0, 'cancel on the SVG dialog makes nothing');
    await loadSvg();
    await page.waitForFunction(() => [...document.querySelectorAll('#dialog button')].some(b => /make parts/.test(b.textContent) && b.offsetParent), { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /make parts/.test(b.textContent)).click());
    await page.waitForFunction(() => window.kiri.api.widgets.all().length >= 1, { timeout: 15000 }).catch(() => {});
    await wait(800);
    const said = await page.evaluate(() => document.getElementById('alert-area')?.innerText || '');
    check(/1 open line was left out/.test(said), `an SVG import says its open lines ("${said.replace(/\s+/g, ' ').slice(0, 120)}")`);
    await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
    await wait(600);
    await shape(page);
    // F1 Delete with nothing picked: no event, no words, nothing gone
    await page.evaluate(() => { window.kiri.api.platform.deselect(); window.__wholeDel = 0; window.kiri.api.event.on('widget.delete', () => window.__wholeDel++); try { window.kiri.api.event.alerts(true); } catch (e) {} });
    await page.mouse.click(720, 860); await wait(200);
    const before = await alerts(page);
    await page.keyboard.press('Delete'); await wait(500); await page.keyboard.press('Backspace'); await wait(500);
    const d0 = await page.evaluate(() => ({ n: window.kiri.api.widgets.all().length, ev: window.__wholeDel }));
    const after = await alerts(page);
    check(d0.n === 1 && d0.ev === 0 && !/Deleted/.test(after), `Delete with nothing picked: nothing gone, no event, no words (${d0.n} part, ${d0.ev} events, "${after.slice(0, 60)}" was "${before.slice(0, 40)}")`);
    // and a picked part's delete comes back with ⌘Z
    await pick(page); await page.mouse.move(720, 860); await page.keyboard.press('Delete'); await wait(600);
    const d1 = await page.evaluate(() => window.kiri.api.widgets.all().length);
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await wait(800);
    const d2 = await page.evaluate(() => window.kiri.api.widgets.all().length);
    check(d1 === 0 && d2 === 1, `a picked part's Delete goes (${d1} left) and ⌘Z brings it back (${d2})`);
    // F4 the step card in inches
    await pick(page); await addOp(page, 'outline'); await wait(500);
    await page.evaluate(() => { const op = [...document.querySelectorAll('#oplist .draggable.has-params')].pop(); op.classList.add('swarf-params-open'); });
    const card = await page.evaluate(() => {
      const op = [...document.querySelectorAll('#oplist .draggable.has-params')].pop();
      const row = f => { const i = op.querySelector(`[data-swarf-field="${f}"]`); return i ? { v: i.value, u: i.nextElementSibling?.textContent || '', tip: i.closest('label').title } : null; };
      const rec = window.kiri.api.conf.get().process.ops.filter(o => o.type === 'outline').pop();
      return { rate: row('rate'), down: row('down'), step: row('step'), rec: { rate: rec.rate, down: rec.down, step: rec.step } };
    });
    check(card.rate && card.rate.u === 'in/min' && Math.abs(+card.rate.v - card.rec.rate / 25.4) < 0.06 && /inches per minute/.test(card.rate.tip), `step card feed ${card.rate && card.rate.v} ${card.rate && card.rate.u} (= ${card.rec.rate} mm/min)`);
    check(card.down && card.down.u === 'in' && Math.abs(+card.down.v * 25.4 - card.rec.down) < 0.01 && !/\(mm\)/.test(card.down.tip), `step card step-down ${card.down && card.down.v} ${card.down && card.down.u} (= ${card.rec.down} mm)`);
    check(card.step && /% of bit/.test(card.step.u) && Math.abs(+card.step.v - card.rec.step * 100) < 0.1, `step card stepover ${card.step && card.step.v} ${card.step && card.step.u}`);
    // typing a fraction into step-down
    await page.evaluate(() => { const op = [...document.querySelectorAll('#oplist .draggable.has-params')].pop(); const i = op.querySelector('[data-swarf-field="down"]'); i.value = '1/8'; i.dispatchEvent(new Event('change')); });
    await wait(300);
    const down = await page.evaluate(() => window.kiri.api.conf.get().process.ops.filter(o => o.type === 'outline').pop().down);
    check(Math.abs(down - 3.175) < 0.001, `step-down typed 1/8 is 3.175 mm (${down})`);
    // B1 export: one swarf card
    await toolpaths(page);
    await page.evaluate(() => document.getElementById('act-export').click());
    await page.waitForFunction(() => { const c = document.querySelector('#mod-x-any.swarf-x .swarf-x-card'); return c && c.offsetParent; }, { timeout: 30000 }).catch(() => {});
    const x = await page.evaluate(() => {
      const box = document.getElementById('mod-x-any'), c = box && box.querySelector('.swarf-x-card');
      return c ? { h: c.querySelector('h3').textContent, go: c.querySelector('.swarf-x-go').textContent, facts: c.querySelector('.swarf-x-facts').textContent, kiri: !!document.getElementById('print-download').offsetParent, heads: [...box.querySelectorAll('.header')].filter(e => e.offsetParent).length } : null;
    });
    check(x && /^save .+\.sbp$/.test(x.go) && !x.go.includes('..'), `export is one swarf card: "${x && x.h}", button "${x && x.go}"`);
    check(x && /min|minute/.test(x.facts) && /KB|bytes|MB/.test(x.facts), `export says what the file is: "${x && x.facts}"`);
    check(x && !x.kiri && !x.heads, `Kiri's gcode button and ( job ) heads are hidden (${x && x.kiri}, ${x && x.heads})`);
    await page.evaluate(() => { const c = document.querySelector('.swarf-x-card input'); c.value = 'my part'; c.dispatchEvent(new Event('input')); });
    const go2 = await page.evaluate(() => document.querySelector('.swarf-x-go').textContent);
    check(go2 === 'save my part.sbp', `the button follows the name ("${go2}")`);
    await page.evaluate(() => window.kiri.api.modal.hide()); await wait(400);
    // F4 control in inches
    await page.click('#swarf-step-run');
    await page.waitForFunction(() => window.__swarfRun.state.prog, { timeout: 30000 }).catch(() => {});
    await wait(800);
    const ctl = await page.evaluate(() => ({ facts: document.querySelector('#swarf-run .sr-facts')?.textContent || '', goZ: [...document.querySelectorAll('#swarf-run button')].map(b => b.textContent).find(t => /above z 0/.test(t)) || '' }));
    check(/ in · /.test(ctl.facts) && / in deep/.test(ctl.facts) && !/mm/.test(ctl.facts), `control's size line in inches ("${ctl.facts}")`);
    check(/in above z 0/.test(ctl.goZ) && !/mm/.test(ctl.goZ), `control's "${ctl.goZ}"`);
    // F1 inside control: Delete never deletes
    await pick(page); await page.mouse.move(700, 500);
    await page.keyboard.press('Delete'); await wait(500);
    check(await page.evaluate(() => window.kiri.api.widgets.all().length) === 1, 'Delete inside control deletes nothing');
    // the plate card
    await page.evaluate(() => { const r = window.__swarfRun; r.state.zeroXY = true; });
    const plate = await page.evaluate(async () => { const b = [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === 'z plate'); if (b) { b.disabled = false; b.click(); } await new Promise(r => setTimeout(r, 600)); const s = document.querySelector('#swarf-run .sr-plate'); return s ? [...s.querySelectorAll('.sr-plate-t, label')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ') : ''; });
    check(plate && !/\bmm\b/.test(plate) && /in: measure/.test(plate), `the plate card in inches ("${plate.slice(0, 160)}")`);
    await page.keyboard.press('Escape'); await wait(300);
    await page.evaluate(() => window.__swarfRun.close()); await wait(300);
    await units(page, 'mm');
    // F7 the mode row and the menu bar take Tab
    const tab = await page.evaluate(() => ({ steps: [...document.querySelectorAll('#mode-tools > .swarf-step')].filter(s => s.offsetParent).map(s => s.tabIndex), menus: [...document.querySelectorAll('#menubar .top-menu > span')].filter(s => s.offsetParent).map(s => s.tabIndex) }));
    check(tab.steps.length >= 6 && tab.steps.every(t => t === 0) && tab.menus.length >= 4 && tab.menus.every(t => t === 0), `the mode row (${tab.steps}) and menus (${tab.menus}) are in the Tab order`);
    // C1/C2 the menus
    const menus = await page.evaluate(() => { const m = [...document.querySelectorAll('#menubar .top-menu > span')]; const words = w => { const s = m.find(x => x.querySelector(':scope > label')?.textContent.trim() === w); return s ? [...s.querySelectorAll('.top-menu-drop .content > div > label')].map(l => l.textContent.trim().toLowerCase()).join(' / ') : ''; }; return { file: words('file') || words('files'), edit: words('edit') }; });
    check(/undo/.test(menus.edit) && /redo/.test(menus.edit) && /delete/.test(menus.edit) && /select all/.test(menus.edit), `edit menu has undo, redo, delete, select all`);
    check(/save project/.test(menus.file) && /export/.test(menus.file) && /open project/.test(menus.file), `file menu has open project, save project, export`);
    // F10 reset profile asks in a swarf card
    const reset = await page.evaluate(async () => { const el = document.getElementById('swarf-reset-profile') || [...document.querySelectorAll('#menubar label')].find(l => /reset/.test(l.textContent))?.parentElement; if (!el) return 'none'; el.click(); await new Promise(r => setTimeout(r, 500)); const d = document.getElementById('dialog'); const t = d && d.open ? d.innerText.replace(/\s+/g, ' ').slice(0, 80) : ''; try { window.kiri.api.modal.hide(); } catch (e) {} const c = [...document.querySelectorAll('#dialog button')].find(b => /cancel|keep/i.test(b.textContent)); if (c) c.click(); return t; });
    check(!dialogs.some(d => /confirm/.test(d)) && /Start swarf over/.test(reset), `reset profile asks in a swarf card ("${reset}") [${dialogs}]`);
    check(await page.evaluate(() => !!window.kiri), 'and keep everything keeps everything (no reload)');
  } finally { await browser.close(); }
}

// C3 advanced on the ShopBot: no laser/lathe/index steps; Kiri's panels clear of the rail
{
  const { browser, page } = await open(1440, 900, 'glass');
  try {
    await page.evaluate(() => { localStorage.setItem('swarf-expert', '1'); document.getElementById('swarf-expert-toggle')?.click(); });
    await wait(600);
    await page.evaluate(() => { if (!document.body.classList.contains('swarf-expert')) document.getElementById('swarf-expert-toggle')?.click(); });
    await shape(page); await pick(page); await wait(600);
    const steps = await page.evaluate(() => [...document.getElementById('op-add-list').children].filter(c => c.offsetParent).map(c => c.innerText.trim().toLowerCase()));
    check(!steps.some(s => /laser|lathe|index|loop/.test(s)), `advanced on the ShopBot offers no laser/lathe/index/loop steps [${steps}]`);
    const ov = await page.evaluate(() => {
      const rail = [...document.getElementById('swarf-right-rail').children].filter(k => k.offsetParent).map(k => k.getBoundingClientRect());
      const left = document.getElementById('panel-left'); if (!left || !left.offsetParent) return [];
      const L = [...left.querySelectorAll('.set2-group')].filter(g => g.offsetParent).map(g => g.getBoundingClientRect());
      const out = [];
      for (const a of L) for (const b of rail) { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 4 && h > 4) out.push(`${Math.round(w)}×${Math.round(h)}`); }
      return out;
    });
    check(!ov.length, `advanced panels do not overlap the rail [${ov}]`);
  } finally { await browser.close(); }
}

check(!errors.length, `no page errors [${errors.slice(0, 3)}]`);
console.log(bad.length ? `FAIL ${bad.length}: ${bad.join(' · ')}` : 'whole-app review r086: all good');
process.exit(bad.length ? 1 : 0);
