// r46 (v00000-045):
//  - the ShopBot offers no metals; a metal chosen on the MR-1 falls back to hardwood on the
//    ShopBot and the sentence says why; the MR-1 offers metals again
//  - the machine's name lies ghosted in the bed's front left corner and follows the machine
//  - SHAPE names a part by what it is: "rectangle", then "rectangle 2"
//  - the SVG import dialog speaks swarf: thickness, holes stay holes, make parts
//   node tools/probe_r46.mjs [url]
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const alertText = page => page.evaluate(() => { const d = window.kiri.api.ui.alert; return d && d.dialog.style.display !== 'none' ? d.text.textContent : ''; });
const options = page => page.evaluate(() => [...document.getElementById('swarf-material-select').options].map(o => o.value));
const METALS = ['aluminum_6061', 'brass', 'mild_steel'];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && document.getElementById('swarf-material-select') && window.__swarfBedName && window.__swarfShape), { timeout: 90000, polling: 200 });
  await wait(1500);

  // MR-1: metals offered; pick brass
  await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
  await wait(900);
  let o = await options(page);
  check(METALS.every(m => o.includes(m)), `the MR-1 offers metals [${o}]`);
  check(/MR-1/.test((await page.evaluate(() => window.__swarfBedName()))?.text || ''), 'the bed names the MR-1');
  await page.select('#swarf-material-select', 'brass');
  await wait(300);

  // ShopBot: no metals, brass falls back to hardwood, the sentence says why
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(900);
  o = await options(page);
  check(!METALS.some(m => o.includes(m)) && o.includes('hardwood') && o.includes('foam'), `the ShopBot offers no metals [${o}]`);
  check(await page.evaluate(() => window.__swarfMaterial.id) === 'hardwood' && await page.$eval('#swarf-material-select', s => s.value) === 'hardwood', 'brass fell back to hardwood');
  const said = await alertText(page);
  check(/not metal/.test(said) && /hard ?wood, not brass/.test(said), `the sentence says why ("${said}")`);
  const bn = await page.evaluate(() => window.__swarfBedName());
  const dev = await page.evaluate(() => { const d = window.kiri.api.conf.get().device; return [d.bedWidth, d.bedDepth]; });
  check(bn && bn.text === 'ShopBot Basic' && bn.visible, `the bed names the ShopBot (${bn && bn.text})`);
  check(bn && bn.x < -dev[0] / 2 + dev[0] * 0.25 && bn.y < -dev[1] / 2 + dev[1] * 0.15, `the name sits in the front left corner (${bn && [bn.x | 0, bn.y | 0]})`);
  await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});

  // a stored metal on the ShopBot, after a reload, is not kept
  await page.evaluate(() => localStorage.setItem('swarf.material.current', 'mild_steel'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(document.getElementById('swarf-material-select') && window.__swarfMaterial), { timeout: 90000, polling: 200 });
  await wait(1500);
  check(await page.evaluate(() => window.__swarfMaterial.id) !== 'mild_steel', 'a stored metal is not kept on the ShopBot after a reload');

  // SHAPE names
  const names = await page.evaluate(() => { const S = window.__swarfShape; return [S.nameFor('rect')]; });
  check(names[0] === 'rectangle' || /^rectangle \d+$/.test(names[0]), `a rectangle is named "rectangle" (${names[0]})`);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.load_svg(window.__swarfShape.svgFor('rect', { w: 50, h: 30 }), window.__swarfShape.nameFor('rect'), { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(400);
  const second = await page.evaluate(() => window.__swarfShape.nameFor('rect'));
  check(/^rectangle \d+$/.test(second), `the next one is "rectangle 2" (${second})`);

  // SVG import dialog words
  const svgPath = join(tmpdir(), 'swarf-r46-plate.svg');
  writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><rect width="40" height="20"/></svg>');
  await (await page.$('#load-file')).uploadFile(svgPath);
  await page.waitForFunction(() => [...document.querySelectorAll('#dialog button')].some(b => /make parts/.test(b.textContent)), { timeout: 15000 });
  const words = await page.evaluate(() => document.getElementById('dialog').textContent);
  check(/make parts from a drawing/.test(words) && /thickness/.test(words) && /holes stay holes/.test(words) && !/Extrude|z height/i.test(words), 'the SVG dialog speaks swarf');
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
if (errors.length) console.log('page errors:', errors.slice(0, 4));
console.log(bad.length ? `r46: ${bad.length} FAILED` : 'r46: ok');
process.exit(bad.length ? 1 : 0);
