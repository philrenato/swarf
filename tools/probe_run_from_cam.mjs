// CAM -> Run on the ShopBot profile: toolpaths made in swarf arrive in Run
// mode through the CONTROL step, read back as millimeters with real moves,
// and can be traced. Simulator back end (no box on USB in the probe).
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = process.argv[2] || 'http://localhost:8080/kiri/';
const stlB64 = readFileSync(process.argv[3] || 'web/obj/cube.stl').toString('base64');
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(5000);
  await page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.new && window.kiri.api.platform), { timeout: 60000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(b64 => {
    const bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const dv = new DataView(buf.buffer), n = dv.getUint32(80, true), verts = new Float32Array(n * 9);
    let vi = 0;
    for (let i = 0; i < n; i++) { const off = 84 + i * 50 + 12; for (let v = 0; v < 9; v++) verts[vi++] = dv.getFloat32(off + v * 4, true); }
    const w = window.kiri.api.new.widget(); w.loadVertices(verts); window.kiri.api.platform.add(w);
  }, stlB64);
  await wait(1500);
  await page.evaluate(() => {
    const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'contour');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(400);
  // RUN is the last step in cam's row (r32), after export
  const entry = await page.evaluate(() => { const r = document.getElementById('swarf-step-run'), row = r && r.parentElement;
    const steps = row ? [...row.querySelectorAll('.swarf-step')].filter(x => x.offsetParent).map(x => x.textContent.trim().toLowerCase()) : [];
    return { last: steps[steps.length - 1], off: r ? r.classList.contains('swarf-step-off') : null, steps }; });
  console.log('run step on ShopBot profile:', JSON.stringify(entry));
  if (entry.last !== 'control' || entry.off) bad.push('CONTROL is not the last, live step on the ShopBot');
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => {
    window.kiri.api.event.on('preview.end', () => res('preview.end'));
    window.kiri.api.event.on('preview.error', e => res('preview.error ' + e));
    setTimeout(() => res('timeout'), 60000);
  }));
  console.log('toolpaths:', pv);
  await page.click('#swarf-step-run');   // one click: Run opens with the cam toolpaths
  await page.waitForFunction(() => window.__swarfRun.state.prog, { timeout: 30000 }).catch(() => bad.push('RUN did not bring the cam toolpaths'));
  const r = await page.evaluate(() => {
    const p = window.__swarfRun.state.prog;
    return { name: p.name, source: p.source, units: p.parsed.units, moves: p.parsed.moves.length, unsupported: p.parsed.unsupported.slice(0, 3), warnings: p.parsed.warnings.slice(0, 3), head: p.text.split(/\r?\n/).slice(0, 8), say: document.querySelector('.sr-say').textContent, step: document.querySelector('.sr-step.now, .sr-step.blocked')?.dataset.step };
  });
  console.log(JSON.stringify(r, null, 1));
  await page.screenshot({ path: (process.env.OUT || '/tmp') + '/run-from-cam.png' });
  await page.evaluate(() => window.__swarfRun.close());
  await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
  await wait(600);
  const mr1 = await page.evaluate(() => { const r = document.getElementById('swarf-step-run'); r.click(); return { off: r.classList.contains('swarf-step-off'), open: window.__swarfRun.state.open }; });
  console.log('run step on MR-1 profile:', JSON.stringify(mr1));
  if (!mr1.off || mr1.open) bad.push('RUN on the MR-1 should be faded and not open Run');
} finally {
  await browser.close();
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(bad.length ? 'FAIL\n' + bad.join('\n') : 'run from cam: ok');
  process.exitCode = errors.length || bad.length ? 1 : 0;
}
