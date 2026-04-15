#!/usr/bin/env node
/**
 * swarf_probe.mjs — Claude's driveable test browser.
 *
 * Spins up headless Chrome via puppeteer-core (system Chrome, no download),
 * navigates to the swarf dev server, optionally clicks through the IMPORT ·
 * TOOLPATHS · PREVIEW · SIMULATE · EXPORT flow, and emits a structured JSON
 * report (console logs, errors, screenshots, final DOM markers) so Claude
 * can verify changes without pestering Phil for screenshots.
 *
 * Usage:
 *   node tools/swarf_probe.mjs                # boot-only probe (8s)
 *   node tools/swarf_probe.mjs --flow=sim     # boot + add op + preview + simulate
 *   node tools/swarf_probe.mjs --flow=sim --shot  # also write screenshots
 *   node tools/swarf_probe.mjs --seconds=15   # hold open longer
 *
 * Flags:
 *   --url=<path>       relative path on :8181 (default /kiri/)
 *   --flow=<name>      boot | sim | export  (default boot)
 *   --seconds=N        total run time (default 10)
 *   --shot             save PNG screenshots to /tmp/swarf-probe-*.png
 *   --headful          show the browser (for Phil to watch Claude work)
 *
 * Output: prints a JSON report to stdout on exit. Also writes to
 * /tmp/swarf-probe-<ts>.json for longer inspection.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap(a => {
    if (a.startsWith('--')) {
      const [k, v = true] = a.replace(/^--/, '').split('=');
      return [[k, v]];
    }
    return [];
  })
);

const URL_PATH = args.url || '/kiri/';
const FLOW     = args.flow || 'boot';
const SECONDS  = parseInt(args.seconds || '10', 10);
const SHOT     = !!args.shot;
const HEADFUL  = !!args.headful;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:8181';
const ts = Date.now();
const SHOT_DIR = '/tmp';

const report = {
  flow: FLOW,
  url: BASE + URL_PATH,
  startedAt: new Date().toISOString(),
  console: [],
  errors: [],
  screenshots: [],
  markers: {},
  events: [],
};

function log(kind, msg) {
  report.events.push({ t: Date.now() - ts, kind, msg });
  if (!HEADFUL) process.stderr.write(`[probe] ${kind}: ${msg}\n`);
}

async function shot(page, label) {
  if (!SHOT) return null;
  const p = `${SHOT_DIR}/swarf-probe-${ts}-${label}.png`;
  await page.screenshot({ path: p, fullPage: false });
  report.screenshots.push(p);
  log('shot', `${label} → ${p}`);
  return p;
}

async function waitFor(page, fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await page.evaluate(fn)) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  log('timeout', `wait-for ${label} after ${timeoutMs}ms`);
  return false;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADFUL ? false : 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: [
      '--enable-webgl',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page = await browser.newPage();
    page.on('console', m => {
      const entry = { type: m.type(), text: m.text(), location: m.location() };
      report.console.push(entry);
    });
    page.on('pageerror', e => {
      report.errors.push({ kind: 'pageerror', message: e.message, stack: e.stack });
    });
    page.on('requestfailed', r => {
      report.errors.push({ kind: 'requestfailed', url: r.url(), failure: r.failure() });
    });

    log('nav', `→ ${BASE + URL_PATH}`);
    await page.goto(BASE + URL_PATH, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await shot(page, 'bootloaded');

    // wait for kiri to finish booting — api.event is hung off window.kiri
    const kiriReady = await waitFor(page, () => {
      return !!(window.kiri && window.kiri.api && window.kiri.api.event);
    }, 8000, 'kiri.api');
    report.markers.kiriReady = kiriReady;

    if (FLOW === 'boot') {
      await new Promise(r => setTimeout(r, SECONDS * 1000));
      await shot(page, 'boot-end');
      return;
    }

    if (FLOW === 'sim' || FLOW === 'export') {
      // Add a rough op via the always-visible grid at #op-add-list
      const addedRough = await page.evaluate(() => {
        const grid = document.getElementById('op-add-list');
        if (!grid) return { ok: false, reason: 'no op-add-list' };
        const rough = [...grid.querySelectorAll('div')].find(d =>
          d.textContent.trim().toLowerCase() === 'rough'
        );
        if (!rough) return { ok: false, reason: 'no rough tile' };
        rough.click();
        return { ok: true };
      });
      log('op.add', JSON.stringify(addedRough));
      report.markers.addedRough = addedRough;
      await shot(page, 'op-added');

      // Click PREVIEW (act-preview)
      await page.evaluate(() => document.getElementById('act-preview')?.click());
      log('click', 'act-preview');
      // wait for preview complete via app state
      const previewed = await waitFor(page, () => {
        try { return window.kiri.api.view.is_preview && window.kiri.api.view.is_preview(); }
        catch { return false; }
      }, 20000, 'preview');
      report.markers.preview = previewed;
      await shot(page, 'previewed');

      if (FLOW === 'sim') {
        // Click SIMULATE (act-animate)
        await page.evaluate(() => document.getElementById('act-animate')?.click());
        log('click', 'act-animate');
        const animated = await waitFor(page, () => {
          try { return window.kiri.api.view.is_animate && window.kiri.api.view.is_animate(); }
          catch { return false; }
        }, 25000, 'animate');
        report.markers.animate = animated;
        await new Promise(r => setTimeout(r, 3000)); // let some chips fly
        await shot(page, 'simulating');
      }

      if (FLOW === 'export') {
        await page.evaluate(() => document.getElementById('act-export')?.click());
        log('click', 'act-export');
        await new Promise(r => setTimeout(r, 3000));
        await shot(page, 'exported');
      }
    }
  } catch (e) {
    report.errors.push({ kind: 'probe-threw', message: e.message, stack: e.stack });
  } finally {
    report.finishedAt = new Date().toISOString();
    const jsonPath = `/tmp/swarf-probe-${ts}.json`;
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    // brief stdout summary so shell callers see the headline
    const errorCount = report.errors.length;
    const warnCount = report.console.filter(c => c.type === 'warning' || c.type === 'error').length;
    const lastLogs = report.console.slice(-20).map(c => `  [${c.type}] ${c.text}`).join('\n');
    process.stdout.write(JSON.stringify({
      ok: errorCount === 0,
      flow: FLOW,
      markers: report.markers,
      errorCount,
      warnCount,
      report: jsonPath,
      screenshots: report.screenshots,
    }, null, 2) + '\n\n--- last 20 console lines ---\n' + lastLogs + '\n');
    await browser.close();
  }
}

main().catch(e => {
  console.error('probe fatal:', e);
  process.exit(1);
});
