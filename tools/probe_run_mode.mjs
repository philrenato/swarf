// Run mode, end to end on the simulator: load a ShopBot file, zero, trace,
// cut with the checklist. Screenshots to $OUT (default /tmp/swarf-run).
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = process.argv[2] || 'http://localhost:8080/kiri/';
const FILE = process.argv[3];
const OUT = process.env.OUT || '/tmp/swarf-run';
mkdirSync(OUT, { recursive: true });
const text = readFileSync(FILE, 'latin1');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900', '--use-angle=metal'] });
const problems = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  // analytics (gc.zgo.at) is not the app
  page.on('console', m => { if (m.type() === 'error' && !/gc\.zgo\.at/.test((m.location() || {}).url || '')) problems.push('console: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__swarfRun && window.kiri && window.kiri.api, { timeout: 60000 });
  const shot = async n => page.screenshot({ path: `${OUT}/${n}.png` });
  const say = () => page.$eval('.sr-say', e => e.textContent);
  const step = () => page.$eval('.sr-step.now, .sr-step.blocked', e => e.dataset.step).catch(() => 'none');
  const dis = sel => page.$eval(sel, e => e.disabled);
  await page.evaluate(() => window.__swarfRun.open());
  await new Promise(r => setTimeout(r, 800));
  // a real-machine connection first proves the link in preview; wait it out
  await page.waitForFunction(() => !window.__swarfRun.state.checking, { timeout: 20000 });
  const kind = await page.evaluate(() => window.__swarfRun.state.machine.state.kind + (window.__swarfRun.state.linkBad ? ' LINK BAD' : ''));
  console.log('machine:', kind);
  const log = [];
  log.push(['empty', await step(), await say()]); await shot('1-empty');
  await page.evaluate((t) => window.__swarfRun.loadProgram('birdhouse.sbp', t, 'file'), text);
  await new Promise(r => setTimeout(r, 500));
  log.push(['loaded', await step(), await say(), 'cut disabled=' + await dis('.sr-actions .cut'), 'trace disabled=' + await dis('.sr-actions .trace')]); await shot('2-loaded');
  // jog: +X 10 mm step
  await page.evaluate(() => [...document.querySelectorAll('.sr-modes button')].find(b => b.textContent === '10').click());
  const px = await page.$$eval('.sr-pad button', bs => bs.map(b => b.dataset.axis));
  const bx = (await page.$$('.sr-pad button'))[px.indexOf('+X')];
  await bx.click(); await new Promise(r => setTimeout(r, 600));
  log.push(['jog +X 10', await page.$eval('.sr-axis .v', e => e.textContent)]);
  await page.evaluate(() => [...document.querySelectorAll('.sr-zrow button')].find(b => b.textContent === 'zero x y').click());
  log.push(['zero xy', await step(), await say()]);
  await page.evaluate(() => [...document.querySelectorAll('.sr-zrow button')].find(b => b.textContent === 'zero z').click());
  log.push(['zero z', await step(), await say(), 'trace disabled=' + await dis('.sr-actions .trace'), 'cut disabled=' + await dis('.sr-actions .cut')]);
  await page.click('.sr-actions .trace');
  await new Promise(r => setTimeout(r, 400));
  log.push(['tracing', await step(), await say(), 'jog locked=' + await page.$eval('.sr-jog', e => e.classList.contains('locked'))]); await shot('3-tracing');
  await page.waitForFunction(() => !window.__swarfRun.state.machine.state.running, { timeout: 60000 });
  await new Promise(r => setTimeout(r, 300));
  log.push(['traced', await step(), await say(), 'cut disabled=' + await dis('.sr-actions .cut')]);
  await page.click('.sr-actions .cut');
  await new Promise(r => setTimeout(r, 300));
  log.push(['checklist', 'go disabled=' + await page.$eval('.sr-card .go', e => e.disabled)]); await shot('4-checklist');
  for (const c of await page.$$('.sr-card input[type=checkbox]')) await c.click();
  log.push(['ticked', 'go disabled=' + await page.$eval('.sr-card .go', e => e.disabled)]);
  await page.evaluate(() => { window.__swarfRun.state.simRate = 50; });
  await page.click('.sr-card .go');
  await new Promise(r => setTimeout(r, 1500));
  log.push(['cutting', await say()]); await shot('5-cutting');
  await page.click('.sr-actions .pause'); await new Promise(r => setTimeout(r, 300));
  log.push(['paused', await say()]);
  await page.click('.sr-actions .stop'); await new Promise(r => setTimeout(r, 400));
  log.push(['stopped', await step(), await say(), 'jog locked=' + await page.$eval('.sr-jog', e => e.classList.contains('locked'))]); await shot('6-stopped');
  // inch file must block at check
  await page.evaluate(() => window.__swarfRun.loadProgram('inch.sbp', "IF %(25)=1 THEN GOTO UNIT_ERROR\nM3,1,1,-0.1\nM3,2,1,-0.1\n", 'file'));
  log.push(['inch file', await step(), await say(), 'trace disabled=' + await dis('.sr-actions .trace')]); await shot('7-inch');
  for (const l of log) console.log(l.join(' | '));
} finally {
  await browser.close();
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no page errors');
}
