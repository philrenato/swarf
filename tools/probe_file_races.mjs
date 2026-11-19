// .swarf save and open under pressure (web/kiri/swarf-file.js):
// 1. a part moved while the save is still being written: the file holds the old place, and the bed
//    stays unsaved (opening another project still asks)
// 2. two saves finishing in the wrong order: the older one does not mark the bed saved
// 3. a project whose part is damaged (one number, a torn triangle, NaN): refused with a plain
//    line, and the parts on the bed, their meshes and the saved mark are as they were
//   node tools/probe_file_races.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';

const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what, info) => { console.log(ok ? 'ok  ' : 'FAIL', what, info !== undefined ? JSON.stringify(info) : ''); if (!ok) bad.push(what); };
const dir = mkdtempSync(join(tmpdir(), 'swarf-races-profile-'));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: dir, protocolTimeout: 300000, args: ['--window-size=1280,800'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => !!(window.SwarfFile && window.kiri?.api?.platform?.load_svg), { timeout: 90000, polling: 300 });
  await wait(1800);
  await p.addScriptTag({ path: new URL('../node_modules/jszip/dist/jszip.min.js', import.meta.url).pathname });
  await p.evaluate(() => {
    const a = kiri.api;
    a.platform.clear();
    a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm" viewBox="0 0 40 30"><rect width="40" height="30"/></svg>', 'race', { depth: 4, soup: true, dpi: 0 });
  });
  await p.waitForFunction(() => kiri.api.widgets.all().length === 1, { timeout: 20000 });
  await wait(800);

  // the zip's finish held back until the page lets it go; downloads kept in the page
  await p.evaluate(() => {
    const a = kiri.api;
    window.__zip = a.client.zip; window.__dl = a.util.download;
    window.__saved = [];
    a.util.download = (data) => window.__saved.push(data);
    window.__held = [];
    a.client.zip = (files, progress, done) => window.__zip(files, progress, out => window.__held.push(() => done(out)));
  });

  // 1. moved while saving
  const r1 = await p.evaluate(async () => {
    const a = kiri.api, w = a.widgets.all()[0];
    const x0 = w.track.pos.x;
    const s = SwarfFile.save({ name: 'race' });
    for (let i = 0; i < 100 && !window.__held.length; i++) await new Promise(r => setTimeout(r, 50));
    w.move(100, 0, 0); a.platform.update_bounds(); a.conf.save();
    window.__held.shift()();
    await s;
    const zip = await new JSZip().loadAsync(window.__saved.pop());
    const ws = JSON.parse(await zip.file('workspace.json').async('string'));
    return { x0, now: w.track.pos.x, filed: ws.work[0].track.pos.x, unsaved: SwarfFile.unsaved() };
  });
  check(Math.abs(r1.filed - r1.x0) < 1e-6 && Math.abs(r1.now - r1.x0 - 100) < 1e-6, 'the file holds the part where it was when the save began', r1);
  check(r1.unsaved === true, 'a move made while saving stays unsaved', r1);

  // 2. two saves, the older finishing last
  const r2 = await p.evaluate(async () => {
    const a = kiri.api, w = a.widgets.all()[0];
    const s1 = SwarfFile.save({ name: 'one' });
    for (let i = 0; i < 100 && window.__held.length < 1; i++) await new Promise(r => setTimeout(r, 50));
    w.move(-30, 0, 0); a.platform.update_bounds(); a.conf.save();
    const s2 = SwarfFile.save({ name: 'two' });
    for (let i = 0; i < 100 && window.__held.length < 2; i++) await new Promise(r => setTimeout(r, 50));
    const [older, newer] = window.__held.splice(0, 2);
    newer(); await s2;
    const afterNewer = SwarfFile.unsaved();
    older(); await s1;
    return { afterNewer, afterOlder: SwarfFile.unsaved() };
  });
  check(r2.afterNewer === false && r2.afterOlder === false, 'the newer save marks the bed saved; the older finishing later does not undo it', r2);

  await p.evaluate(() => { const a = kiri.api; a.client.zip = window.__zip; a.util.download = window.__dl; });

  // 3. damaged parts
  for (const kind of ['one', 'torn', 'nan']) {
    const r3 = await p.evaluate(async (kind) => {
      const a = kiri.api;
      const ws = a.conf.export({ work: true, clear: true, binary: true });
      const g = ws.work[0].geo;
      ws.work[0].geo = kind === 'one' ? new Float32Array([7]) : kind === 'torn' ? g.slice(0, g.length - 4) : Object.assign(g.slice(), { 5: NaN });
      const packed = SwarfFile.pack(ws, [{ name: 'manifest.json', data: JSON.stringify(SwarfFile.manifest({ app: window.SWARF_VERSION, build: '', units: 'mm' })) }, { name: 'swarf.json', data: '{}' }]);
      const zip = new JSZip();
      for (const f of packed.files) zip.file(f.name, f.data);
      const data = await zip.generateAsync({ type: 'arraybuffer' });
      const before = a.widgets.all().map(w => ({ id: w.id, n: w.getGeoVertices().length, x: w.track.pos.x }));
      SwarfFile.remember();
      const mark = localStorage.getItem('swarf-file-saved');
      const opened = await SwarfFile.open(data, `broken-${kind}.swarf`, JSZip);
      await new Promise(r => setTimeout(r, 900));
      const after = a.widgets.all().map(w => ({ id: w.id, n: w.getGeoVertices().length, x: w.track.pos.x }));
      const said = [...document.querySelectorAll('#app-messages, .alert, [id*=alert]')].map(e => e.innerText).join(' ') || document.body.innerText;
      return { opened, same: JSON.stringify(before) === JSON.stringify(after), markKept: localStorage.getItem('swarf-file-saved') === mark, damaged: /a part in it is damaged/.test(said), before, after };
    }, kind);
    check(r3.opened === false && r3.same && r3.markKept && r3.damaged, `damaged part (${kind}): refused, says so, the bed unchanged`, { opened: r3.opened, same: r3.same, markKept: r3.markKept, damaged: r3.damaged });
  }

  // 4. the version stamp (update) is a button: Tab reaches it, Enter and Space press it
  await p.evaluate(() => { window.__clicks = 0; document.getElementById('ver').addEventListener('click', e => { window.__clicks++; e.stopImmediatePropagation(); }, true); document.activeElement && document.activeElement.blur(); });
  let tabs = -1;
  for (let i = 0; i < 400; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => document.activeElement && document.activeElement.id === 'ver')) { tabs = i + 1; break; } }
  await p.keyboard.press('Enter'); await wait(200);
  await p.keyboard.press('Space'); await wait(200);
  const k = await p.evaluate(() => ({ clicks: window.__clicks, role: document.getElementById('ver').tagName, name: document.getElementById('ver').getAttribute('aria-label'),
    ring: getComputedStyle(document.getElementById('ver')).outlineStyle }));
  check(tabs > 0 && k.clicks === 2 && k.role === 'BUTTON' && /check for an update/.test(k.name) && k.ring !== 'none', 'update stamp: Tab reaches it, Enter and Space press it, focus ring shows', { tabs, ...k });
  check(errors.length === 0, 'no page errors', errors.slice(0, 5));
} catch (e) {
  check(false, 'probe ran: ' + e.message);
} finally {
  await b.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(bad.length ? `file races: ${bad.length} FAIL` : 'file races: ok');
process.exit(bad.length ? 1 : 0);
