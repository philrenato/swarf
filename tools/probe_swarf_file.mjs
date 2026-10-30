// .swarf projects (web/kiri/swarf-file.js), end to end: a project — a DRAW part with a hole, an
// imported SVG part, a TEX mark, auto tabs and a tab by hand, several steps, inches, MDF — saved
// as .swarf (the real download), dropped on the bed of a FRESH browser profile, and compared:
// part places, drawings, marks, tabs, steps, material, board, bits, units, and the ShopBot file
// byte for byte but its date lines. Control after reopening asks for zero, here and there; no
// zero is in the file. The .kmz still loads through Kiri's own import, with Kiri's steps only.
//   node tools/probe_swarf_file.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { CHROME } from './chrome-path.mjs';
import { VIEW } from './view-check.mjs';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const F = require('../web/kiri/swarf-file.js');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-file';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
// downloads stay in the test browser's own folder (never ~/Downloads)
const DL = join(homedir(), 'Library/Caches/ChromeForTesting-Downloads', `swarf-file-probe-${process.pid}`);
mkdirSync(DL, { recursive: true });
const profiles = [];
async function launch() {
  const dir = mkdtempSync(join(tmpdir(), 'swarf-file-profile-'));
  profiles.push(dir);
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: dir, args: ['--window-size=1440,900'] });
  const cdp = await b.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
  const page = await b.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.__swarfTex && window.SwarfTexCore && window.SwarfFile && window.__swarfSetMaterial && document.getElementById('swarf-step-draw') && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  return { b, page };
}
async function download(page, start, ext) {
  const before = new Set(readdirSync(DL));
  await start();
  for (let i = 0; i < 200; i++) {
    await wait(150);
    const f = readdirSync(DL).find(n => !before.has(n) && n.endsWith(ext));
    if (f && statSync(join(DL, f)).size > 0) { await wait(300); return join(DL, f); }
  }
  return null;
}
const px = (page, x, y) => page.evaluate((x, y) => { const B = window.__swarfTex.state() || window.__swarfDraw.state(), r = document.querySelector('#swarf-draw svg').getBoundingClientRect(); return [r.left + B.ox + x * B.k, r.top + B.oy - y * B.k]; }, x, y);
async function drag(page, a, b, n = 10) {
  const [x0, y0] = await px(page, ...a), [x1, y1] = await px(page, ...b);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= n; i++) { await page.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); await wait(15); }
  await page.mouse.up(); await wait(120);
}
const setField = (page, id, v) => page.evaluate((id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, id, v);
const addStep = (page, name) => page.evaluate(n => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === n); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }, name);
// everything a reopened project must match
const snapshot = page => page.evaluate(() => {
  const a = window.kiri.api, s = a.conf.get();
  const used = new Set([...(s.process.ops || []), ...(s.process.op2 || [])].map(o => o.tool));
  return {
    parts: a.widgets.all().map(w => ({ id: w.id, file: w.meta.file, pos: w.track.pos, verts: w.vertices ? w.vertices.length : 0, meta: JSON.stringify(w.meta), anno: JSON.stringify(w.anno) })).sort((p, q) => (p.id < q.id ? -1 : 1)),
    ops: JSON.stringify(s.process.ops), op2: JSON.stringify(s.process.op2 || []),
    stock: JSON.stringify(Object.fromEntries(Object.entries(s.process).filter(([k]) => /^camStock|^camOrigin|^camZ/.test(k)))),
    material: window.__swarfMaterial && window.__swarfMaterial.id, select: document.getElementById('swarf-material-select').value,
    bits: JSON.stringify(s.tools.filter(t => used.has(t.id)).map(t => ({ ...t })).sort((p, q) => p.id - q.id)),
    device: s.filter.CAM, bed: [s.device.bedWidth, s.device.bedDepth], units: s.controller.units, unitScale: a.view.unit_scale(),
    expert: document.body.classList.contains('swarf-expert'), autotabs: localStorage.getItem('swarf.autotabs'),
  };
});
async function toolpaths(page) {
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); window.kiri.api.event.on('preview.error', e => res('preview.error ' + e)); setTimeout(() => res('timeout'), 180000); }));
  const gc = await page.evaluate(() => new Promise(res => { try { window.kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))); } catch (e) { res(''); } setTimeout(() => res(''), 60000); }));
  return { pv, gc };
}
// Kiri's end-of-steps marker ('|', cam puts it back whenever it is missing) is not a step
const stepTypes = ops => JSON.parse(ops).map(o => o.type).filter(t => t !== '|');
const undated = gc => gc.split(/\r?\n/).filter(l => !/\b(19|20)\d\d[-/.]\d\d?[-/.]\d\d?\b|\b\d\d?[-/.]\d\d?[-/.](19|20)\d\d\b|\b\d\d?:\d\d(:\d\d)?\b|\b(date|time|generated|saved)\b/i.test(l));
// a drawing as DRAW holds it on its board: each part's curves' control points
const drawBoard = async page => {
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 8000 });
  const r = await page.evaluate(() => window.__swarfDraw.state().parts.map(p => ({ name: p.name, curves: p.curves.map(c => c.crv.ctrlPts.map(q => q.map(v => +v.toFixed(4)))) })));
  await page.evaluate(() => window.__swarfDraw.close(false));
  await wait(300);
  return JSON.stringify(r);
};
// control: what its checklist asks of the student about zero
const controlZero = async page => {
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog, { timeout: 60000 }).catch(() => {});
  await wait(400);
  const z = await page.evaluate(() => { const S = window.__swarfRun.state; return { prog: !!S.prog, xy: !!S.zeroXY, z: !!S.zeroZ, traced: !!S.traced, stored: localStorage.getItem('swarf-run-zero') }; });
  await page.evaluate(() => window.__swarfRun.close());
  await wait(300);
  return z;
};

let A, B, C;
try {
  // ── profile A: build the project ──
  A = await launch();
  let page = A.page;
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.clear(); const s = a.conf.get(); s.process.ops = []; a.conf.save(); });
  await wait(400);
  await page.evaluate(() => { const s = window.kiri.api.ui.units; s.value = 'in'; s.onchange(); });
  await page.evaluate(() => { const s = document.getElementById('swarf-material-select'); s.value = 'mdf'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(300);
  // a DRAW part with a hole: a rectangle, a circle inside it
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 8000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 150; S.oy = r.height / 2 + 100; });
  await page.keyboard.press('r');
  await setField(page, 'sd-pen-t', '0.75');
  await drag(page, [0, 0], [120, 80]);
  await page.keyboard.press('e');
  await drag(page, [80, 20], [105, 45]);
  await page.click('#sd-done');
  await wait(1500);
  // an imported SVG part, through the file input and its dialog
  const svgDir = mkdtempSync(join(tmpdir(), 'swarf-file-svg-'));
  const svgPath = join(svgDir, 'plate.svg');
  writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40"><path d="M0 0 L60 0 L60 40 L30 30 L0 40 Z"/></svg>');
  await (await page.$('#load-file')).uploadFile(svgPath);
  await page.waitForFunction(() => [...document.querySelectorAll('#dialog button')].some(b => /make parts/.test(b.textContent)), { timeout: 15000 });
  await page.evaluate(() => { document.getElementById('svg-depth').value = '1/2'; [...document.querySelectorAll('#dialog button')].find(b => /make parts/.test(b.textContent)).click(); });
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 2, { timeout: 15000 }).catch(() => {});
  await wait(1200);
  // pressed at once (before the dialog's own 150 ms show): it must not come back over the parts
  const again = await page.evaluate(() => document.getElementById('dialog').open);
  check(!again, 'the make parts dialog is gone once its parts are made');
  if (again) await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /cancel/.test(b.textContent))?.click());
  // move the imported part somewhere of its own
  await page.evaluate(() => { const w = window.kiri.api.widgets.all().find(w => /plate/.test(w.meta.file)); w.move(-150, 90, 0); w.saveState && w.saveState(); });
  let parts = await page.evaluate(() => window.kiri.api.widgets.all().map(w => ({ file: w.meta.file, svg: !!w.meta.svg })));
  check(parts.length === 2 && parts.every(p => p.svg), `two parts with drawings: ${JSON.stringify(parts)}`);
  // a TEX mark on the DRAW part
  await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); });
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 8000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(), r = document.getElementById('tx-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 150; S.oy = r.height / 2 + 100; });
  await page.keyboard.press('b');
  await setField(page, 'tx-bsize', '0.5');
  await drag(page, [15, 40], [60, 45], 20);
  await page.click('#tx-done');
  await wait(1200);
  // steps: TEX's texture, then a rough and an outline (its step-down changed by hand)
  check(await addStep(page, 'outline'), 'an outline step');
  await wait(400);
  await page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(), o = s.process.ops.find(o => o.type === 'outline'); if (o) o.down = 2.5; a.conf.save(); });
  // auto tabs on the DRAW part, and one by hand
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all().find(w => !/plate/.test(w.meta.file))); });
  await wait(300);
  // (086: the press places them at once, no apply step; one is resized, so pinned, and one
  // deleted, so its place is a "no tab here" spot in the part's tab settings)
  await page.evaluate(() => document.getElementById('swarf-autotabs-go').click());
  await wait(600);
  const edits = await page.evaluate(() => {
    const a = window.kiri.api, T = window.__swarfTabEdit, w = a.widgets.all().find(w => !/plate/.test(w.meta.file));
    const autos = (a.widgets.annotate(w.id).tab || []).filter(r => r.auto);
    if (autos.length < 3) return { autos: autos.length };
    T.pick(w, autos[0].id); const why = T.resize('width', 20); T.unpick && T.unpick();
    T.pick(w, autos[1].id); const del = T.delete();
    return { autos: autos.length, why, del };
  });
  check(edits.autos >= 3 && edits.why === '' && edits.del, `auto tabs placed, one resized and one deleted (${JSON.stringify(edits)})`);
  await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all().find(w => !/plate/.test(w.meta.file)), l = a.widgets.annotate(w.id).tab, a0 = l.find(r => r.auto && !r.pinned);
    l.push({ pos: { x: -a0.pos.x, y: -a0.pos.y, z: a0.pos.z }, dim: a0.dim, rot: a0.rot, id: 4242 });
    w.saveState && w.saveState();
  });
  await page.evaluate(() => window.kiri.api.platform.deselect());
  const a0 = await snapshot(page);
  const draw0 = await drawBoard(page);
  const tabs0 = JSON.parse(a0.parts.find(p => !/plate/.test(p.file)).anno);
  const texN = (JSON.parse(a0.parts.find(p => !/plate/.test(p.file)).meta).tex || []).length;
  check(texN === 1, `a TEX mark on the drawn part (${texN})`);
  check((tabs0.tab || []).filter(t => t.auto).length >= 2 && (tabs0.tab || []).some(t => t.id === 4242) && !!tabs0.tabset, `auto tabs, the hand tab and the part's tab settings (${(tabs0.tab || []).map(t => t.auto ? (t.pinned ? 'p' : 'a') : 'h').join('')})`);
  check((tabs0.tab || []).some(t => t.auto && t.pinned) && ((tabs0.tabset && tabs0.tabset.spots) || []).length === 1, `a pinned auto tab and a "no tab here" spot (${JSON.stringify(tabs0.tabset && tabs0.tabset.spots)})`);
  check(stepTypes(a0.ops).join() === 'texture,outline' && a0.units === 'in' && a0.material === 'mdf', `steps ${stepTypes(a0.ops)}, inches, MDF`);
  const tp0 = await toolpaths(page);
  check(tp0.pv === 'preview.end' && tp0.gc.length > 200, `toolpaths and a ShopBot file in A (${tp0.pv}, ${tp0.gc.length} bytes)`);
  // control zeroed in A (the simulator), then the project saved
  const zA = await controlZero(page);
  await page.evaluate(() => { const S = window.__swarfRun.state; S.zeroXY = S.zeroZ = true; S.zx = S.zy = true; S.zeroSetAt = Date.now(); S.traced = true; });
  // the project as saved: making toolpaths fills a texture step's marks from the parts, so the
  // file holds those (the comparison in B is against this, not against a0 before the toolpaths)
  const a1 = await snapshot(page);
  // ⌘S saves (the name card asks: the probe types it)
  const file = await download(page, async () => {
    await page.keyboard.down('Meta'); await page.keyboard.press('s'); await page.keyboard.up('Meta');
    await page.waitForFunction(() => [...document.querySelectorAll('#dialog input')].some(i => i.offsetParent), { timeout: 8000 });
    await page.evaluate(() => { const i = [...document.querySelectorAll('#dialog input')].find(i => i.offsetParent); i.value = 'probe-chair'; const ok = [...document.querySelectorAll('#dialog button')].find(b => /^ok$/i.test(b.textContent.trim())); ok ? ok.click() : i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); });
  }, '.swarf');
  check(!!file && /probe-chair\.swarf$/.test(file), `⌘S saved a .swarf (${file})`);
  const savedSay = await page.evaluate(() => [...document.querySelectorAll('#alert-text p')].map(p => p.textContent).find(t => /^Saved probe-chair/.test(t)) || '');
  check(/2 parts and 2 steps\./.test(savedSay), `the saved notice counts the steps without Kiri's divider ("${savedSay.slice(0, 60)}")`);
  const buf = readFileSync(file);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).sort();
  check(names.join() === 'manifest.json,swarf.json,workspace.json', `the zip: ${names}`);
  const man = JSON.parse(await zip.files['manifest.json'].async('string')), sj = JSON.parse(await zip.files['swarf.json'].async('string')), wsText = await zip.files['workspace.json'].async('string');
  check(man.format === 'swarf' && man.version === 1 && /^v\d/.test(man.app) && man.units === 'in' && !isNaN(Date.parse(man.saved)), `manifest ${JSON.stringify(man)}`);
  check(F.checkManifest(man, man.app).ok, 'its manifest reads');
  check(sj.material === 'mdf' && sj.units === 'in' && sj.local['swarf.material.current'] === 'mdf' && Object.keys(sj.local).every(k => F.PROJECT_KEYS[k]), `swarf.json: ${JSON.stringify(sj)}`);
  const zeroHit = [...F.NEVER_KEYS].filter(k => wsText.includes(k) || JSON.stringify(sj).includes(k));
  check(!zeroHit.length && !F.zeroKeys(sj).length && !/"zeroXY"|"zeroSetAt"|"zeroHad"/.test(wsText), `no machine zero or position in the file (${zeroHit})`);
  check(JSON.parse(wsText).work.length === 2, 'workspace.json has both parts with their meshes');
  const kmz = await download(page, async () => {
    await page.evaluate(() => document.getElementById('app-export').click());
    await page.waitForFunction(() => [...document.querySelectorAll('#dialog button')].some(b => /^ok$/i.test(b.textContent.trim()) && b.offsetParent), { timeout: 8000 });
    await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /^ok$/i.test(b.textContent.trim())).click());
  }, '.kmz');
  check(!!kmz, `save for Kiri:Moto wrote a .kmz (${kmz})`);
  const kz = await JSZip.loadAsync(readFileSync(kmz));
  const kws = JSON.parse(await kz.files['workspace.json'].async('string'));
  const ktypes = kws.settings.process.ops.map(o => o.type);
  check(Object.keys(kz.files).join() === 'workspace.json' && ktypes.every(t => F.KIRI_OPS.includes(t) || t === '|') && ktypes.filter(t => t !== '|').join() === 'outline' && ktypes.includes('|') && kws.work.length === 2, `the .kmz: Kiri's workspace.json only, Kiri's steps and its end-of-steps marker only (${ktypes})`);
  const allK = JSON.stringify(kws.settings.sproc || {});
  check(!/"type":"(texture|pierce)"/.test(allK), 'no swarf-only step in its saved processes either');
  // reopening in A itself: the same job, and control asks for zero again
  await page.evaluate(() => window.kiri.api.widgets.all()[0].move(5, 5, 0));
  // toolpaths on the bed before the open: they leave with the parts the file replaces
  const tpOld = await toolpaths(page);
  const reA = await page.evaluate(async b64 => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const f = new File([u], 'probe-chair.swarf');
    const dt = new DataTransfer(); dt.items.add(f);
    for (const p of document.querySelectorAll('#alert-text p')) p.remove();
    const seen = new Set(), t = setInterval(() => { for (const p of document.querySelectorAll('#alert-text p')) seen.add(p.textContent.trim()); }, 50);
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 900));
    const q = document.getElementById('dialog'), words = q ? q.textContent : '';
    const go = [...document.querySelectorAll('#dialog button')].find(b => /open it/.test(b.textContent));
    if (go) go.click();
    await new Promise(r => setTimeout(r, 3000));
    clearInterval(t);
    return { asked: !!go && /not saved in a \.swarf/.test(words), words: words.replace(/\s+/g, ' ').slice(0, 160), seen: [...seen], arrange: window.kiri.api.view.is_arrange() };
  }, buf.toString('base64'));
  check(reA.asked, `opening over a changed bed asks first ("${reA.words}")`);
  // review 10-30 F3: no delete notices from the parts it replaces, the steps counted without
  // Kiri's divider, and the old toolpaths gone
  check(tpOld.pv === 'preview.end' && !reA.seen.some(t => /Deleted|brings it back/.test(t)) && reA.seen.some(t => /Opened probe-chair\.swarf: 2 parts, 2 steps\./.test(t)) && reA.arrange, `opened over a bed with toolpaths: one notice, 2 steps, the old paths gone (${JSON.stringify(reA.seen)}, arrange ${reA.arrange})`);
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 2, { timeout: 20000 }).catch(() => {});
  await wait(1500);
  { const v = await page.evaluate(VIEW); check(v.ok, `after opening over a bed the parts are whole in the window, the camera above the bed (${v.say})`); }
  const zA2 = await controlZero(page);
  check(zA2.prog && !zA2.xy && !zA2.z && !zA2.traced, `control after reopening in the same browser: X Y and Z to zero, trace again (${JSON.stringify(zA2)})`);
  await A.b.close(); A = null;

  // ── profile B: fresh; drop the file on the bed ──
  B = await launch();
  page = B.page;
  const fresh = await page.evaluate(() => ({ n: window.kiri.api.widgets.all().length, mat: window.__swarfMaterial.id, units: window.kiri.api.conf.get().controller.units, zero: localStorage.getItem('swarf-run-zero') }));
  check(fresh.mat !== 'mdf' && fresh.units === 'mm' && !fresh.zero, `B starts fresh (${JSON.stringify(fresh)})`);
  const opened = await page.evaluate(async b64 => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'probe-chair.swarf'));
    let said = '';
    window.addEventListener('swarf.file.opened', e => { said = JSON.stringify(e.detail); }, { once: true });
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    for (let i = 0; i < 100 && !said; i++) await new Promise(r => setTimeout(r, 100));
    return { said, dialog: !!document.querySelector('#dialog button') && document.getElementById('dialog').offsetParent !== null };
  }, buf.toString('base64'));
  check(!!opened.said, `dropped on an empty bed, it opens without asking (${opened.said})`);
  await wait(1500);
  { const v = await page.evaluate(VIEW); check(v.ok, `after opening on an empty bed the parts are whole in the window, the camera above the bed (${v.say})`); }
  const b0 = await snapshot(page);
  check(b0.parts.length === 2, `two parts (${b0.parts.length})`);
  const firstDiff = (x, y) => { let i = 0; while (i < x.length && x[i] === y[i]) i++; return i < Math.max(x.length, y.length) ? ` (first difference at ${i}: "${x.slice(Math.max(0, i - 40), i + 60)}" vs "${y.slice(Math.max(0, i - 40), i + 60)}")` : ''; };
  for (const p of a1.parts) {
    const q = b0.parts.find(x => x.id === p.id);
    check(!!q && JSON.stringify(q.pos) === JSON.stringify(p.pos) && q.verts === p.verts, `${p.file}: same place ${JSON.stringify(p.pos)} and mesh (${q && JSON.stringify(q.pos)}, ${q && q.verts}/${p.verts})`);
    check(!!q && q.meta === p.meta, `${p.file}: its meta whole (drawing, marks) ${q && q.meta.length}/${p.meta.length} chars${q && q.meta !== p.meta ? firstDiff(p.meta, q.meta) : ''}`);
    check(!!q && q.anno === p.anno, `${p.file}: its anno whole (tabs, pins, "no tab here" spots, tab settings)${q && q.anno !== p.anno ? firstDiff(p.anno, q.anno) : ''}`);
  }
  check(b0.ops === a1.ops && b0.op2 === a1.op2, `the steps, in order, with every setting${b0.ops !== a1.ops ? firstDiff(a1.ops, b0.ops) : ''}`);
  check(b0.stock === a1.stock, `the board ${b0.stock}${b0.stock !== a1.stock ? ' vs ' + a1.stock : ''}`);
  check(b0.material === 'mdf' && b0.select === 'mdf', `the material (${b0.material}, card ${b0.select})`);
  check(b0.bits === a1.bits, 'the bits the steps use');
  check(b0.device === a1.device && JSON.stringify(b0.bed) === JSON.stringify(a1.bed), `the machine (${b0.device} ${b0.bed} vs ${a1.bed})`);
  check(b0.units === 'in' && b0.unitScale === 25.4, `inches (${b0.units}, ${b0.unitScale})`);
  check(b0.autotabs === a1.autotabs, `the tab card's rule (${b0.autotabs})`);
  const draw1 = await drawBoard(page);
  check(draw1 === draw0 && JSON.parse(draw0).some(p => p.curves.length === 2), `DRAW shows the same drawings, the hole still a hole (${draw0.length} chars)`);
  const tp1 = await toolpaths(page);
  const g0 = undated(tp0.gc), g1 = undated(tp1.gc);
  const diff = g0.findIndex((l, i) => l !== g1[i]);
  check(tp1.pv === 'preview.end' && g0.length === g1.length && diff < 0, `the ShopBot file is the same but its date lines (${g1.length} lines${diff >= 0 ? `; first difference line ${diff}: "${g0[diff]}" vs "${g1[diff]}"` : ''})`);
  check(tp0.gc.split(/\r?\n/).length - g0.length <= 3, `only ${tp0.gc.split(/\r?\n/).length - g0.length} date lines left out`);
  const zB = await controlZero(page);
  // control keeps its own record ({ had: null } = no zero); what matters is that none came in
  const zStored = (() => { try { return JSON.parse(zB.stored); } catch (e) { return null; } })();
  check(zB.prog && !zB.xy && !zB.z && !zB.traced && !(zStored && zStored.had), `control in B asks for zero like a new job (${JSON.stringify(zB)})`);
  await B.b.close(); B = null;

  // ── profile C: fresh; the .kmz through Kiri's own import (conf.import_zip, as Kiri:Moto reads it) ──
  C = await launch();
  page = C.page;
  const k = await page.evaluate(async b64 => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    window.kiri.api.conf.import_zip(u.buffer, false);
    for (let i = 0; i < 100 && window.kiri.api.widgets.all().length < 2; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 800));
    const a = window.kiri.api;
    return { n: a.widgets.all().length, pos: a.widgets.all().map(w => [w.id, w.track.pos]), ops: a.conf.get().process.ops.map(o => o.type) };
  }, readFileSync(kmz).toString('base64'));
  // swarf reading its own .kmz: the outline from the file, and TEX makes the texture step again
  // from the mark the part carries (Kiri:Moto itself has no TEX, so there it is the outline alone)
  check(k.n === 2 && k.ops.filter(t => t !== '|').join() === 'texture,outline', `the .kmz loads back through Kiri's import: ${k.n} parts, steps ${k.ops}`);
  for (const [id, pos] of k.pos) { const p = a0.parts.find(x => x.id === id); check(!!p && Math.abs(p.pos.x - pos.x) < 1e-6 && Math.abs(p.pos.y - pos.y) < 1e-6, `.kmz: ${p && p.file} in its place`); }
  await C.b.close(); C = null;
  check(zA.prog !== undefined, 'control opened in A');
} catch (e) { check(false, 'threw: ' + (e && e.stack || e)); }
for (const x of [A, B, C]) if (x) await x.b.close().catch(() => {});
for (const d of profiles) { try { rmSync(d, { recursive: true, force: true }); } catch (e) { /* */ } }
try { rmSync(DL, { recursive: true, force: true }); } catch (e) { /* */ }
const real = errors.filter(e => !/ResizeObserver|WebGPU|webgpu/i.test(e));
if (real.length) { console.log('page errors:', real.slice(0, 6)); }
check(!real.length, `no page errors (${real.length})`);
console.log(bad.length ? `FAIL (${bad.length})\n` + bad.join('\n') : 'swarf file: ok');
process.exit(bad.length ? 1 : 0);
