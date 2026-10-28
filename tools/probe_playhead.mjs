// CONTROL's playhead (Phil 10-27: "the bed isn't moving when I scrub this
// playhead. Also: can it just play like the simulate button in CAM?").
// Scrubbing puts the bit and the ghost machine at the end of that line; ▶ plays
// the program through (the bit moves, the playhead runs, it stops at the end);
// ❚❚ pauses; the X/Y/Z numbers stay the machine's own.
//   node tools/probe_playhead.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-playhead';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000"/></svg>', 'disc', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(600);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 60000); }));
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog && document.querySelector('.sr-play'), { timeout: 60000 });
  await wait(800);
  // the bit in the job's frame (the work slides under the gantry when the machine shows)
  const tool = () => page.evaluate(() => { const v = window.__swarfRun.view(), p = v.tool.position, w = v.work.position; return { x: +(p.x - w.x).toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), wx: +w.x.toFixed(2), dro: document.querySelector('.sr-dro .v').textContent, line: +document.querySelector('.sr-scrub input').value }; });
  // the machine shown, so the bed moves
  await page.evaluate(() => { const v = window.__swarfRun.view(); if (!v.ghost.visible) document.querySelector('.sr-vtools button:last-child').click(); });
  // scrub to the middle: the bit goes to that line's end
  const mid = await page.evaluate(() => {
    const M = window.__swarfRun.state.prog.parsed.moves, m = M[Math.floor(M.length / 2)], s = document.querySelector('.sr-scrub input');
    s.value = String(m.line); s.dispatchEvent(new Event('input', { bubbles: true }));
    return { line: m.line, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2) };
  });
  let t = await tool();
  check(t.x === mid.x && t.y === mid.y && t.z === mid.z && t.dro === '0.000', `scrubbed to line ${mid.line}: the bit is at its end (${t.x}, ${t.y}, ${t.z}), the numbers stay the machine's (${t.dro})`);
  // the shop's ShopBot: the bed (with the job) slides in X, the gantry stands still, the carriage takes Y and Z
  const g = await page.evaluate(() => { const v = window.__swarfRun.view(), G = v.ghostParts; return { gx: +G.gantry.position.x.toFixed(2), tx: +v.tool.position.x.toFixed(2), wx: +v.work.position.x.toFixed(2), cy: +(G.carriage.position.y + G.gantry.position.y).toFixed(2), cz: +G.carriage.position.z.toFixed(2) }; });
  check(g.gx === 110 && g.tx === 0 && g.wx === -mid.x && g.cy === mid.y && g.cz === mid.z, `the bed slides ${g.wx} mm in X under a still gantry; the carriage is at Y ${g.cy}, Z ${g.cz}`);
  // play from the top at 200×
  await page.evaluate(() => { const s = document.querySelector('.sr-scrub input'); s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  while ((await page.evaluate(() => document.querySelector('.sr-rate').textContent)) !== '200×') await page.click('.sr-rate');
  await page.click('.sr-play');
  const a = await tool(); await wait(700); const b = await tool();
  check(b.line > a.line && (a.x !== b.x || a.y !== b.y || a.z !== b.z) && (a.x === b.x || a.wx !== b.wx) && (await page.evaluate(() => document.querySelector('.sr-play').textContent)) === '❚❚', `▶ plays: line ${a.line} → ${b.line}, the bit moves`);
  await page.screenshot({ path: `${OUT}-playing.png` });
  // pause holds it
  await page.click('.sr-play');
  const c = await tool(); await wait(500); const d = await tool();
  check(c.line === d.line && c.x === d.x && c.y === d.y, `❚❚ pauses at line ${c.line}`);
  // play to the end: it stops by itself at the last line
  await page.click('.sr-play');
  const last = await page.evaluate(() => { const M = window.__swarfRun.state.prog.parsed.moves; return M[M.length - 1].line; });
  await page.waitForFunction(l => +document.querySelector('.sr-scrub input').value === l && document.querySelector('.sr-play').textContent === '▶', { timeout: 120000 }, last).then(() => check(true, `plays to the end (line ${last}) and stops`), () => check(false, 'plays to the end and stops'));
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `playhead: ${bad.length} failed, ${errors.length} page errors` : 'playhead: ok');
process.exit(bad.length || errors.length ? 1 : 0);
