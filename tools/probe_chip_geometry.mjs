/**
 * Probe: count the triangles the chip layer submits, old shape vs new.
 *
 * The chip cost cannot be measured through SIMULATE in headless Chrome —
 * the spawn gate needs real tool motion and never opens — and frame time is
 * vsync-clamped anyway, so a cost that fits inside the budget is invisible.
 * Triangle count per flavor is deterministic, so measure that directly:
 * build both the old tube geometry and the shipped ribbon in the page's own
 * THREE and count.
 *
 * Usage: node tools/probe_chip_geometry.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:8080/kiri/';

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => !!(window.THREE && window.__swarfChipStats?.pools?.length), { timeout: 60000 });

const out = await page.evaluate(() => {
    const T = window.THREE;
    const tris = g => (g.index ? g.index.count : g.attributes.position.count) / 3;

    // --- the shape that shipped before: tubes ---
    const oldCurl = (() => {
        const pts = [];
        for (let i = 0; i <= 8; i++) {
            const t = i / 8, a = t * 1.6 * Math.PI * 2;
            pts.push(new T.Vector3(Math.cos(a) * (0.6 - t * 0.3), t * 2.4 - 1.2, Math.sin(a) * (0.6 - t * 0.3)));
        }
        return new T.TubeGeometry(new T.CatmullRomCurve3(pts), 8, 0.12, 3, false);
    })();
    const oldCoil = (() => {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
            const a = (i / 6) * Math.PI * 1.3;
            pts.push(new T.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5));
        }
        return new T.TubeGeometry(new T.CatmullRomCurve3(pts), 6, 0.10, 3, false);
    })();

    // --- what ships now: the live pools, reported by the chip layer ---
    const pools = (window.__swarfChipStats && window.__swarfChipStats.pools) || [];

    return { oldCurlTris: tris(oldCurl), oldCoilTris: tris(oldCoil), pools };
});
await browser.close();

// weights from swarf-chips.js: curl .55, flake .18, coil .20, grit .07
const W = { curl: 0.55, flake: 0.18, coil: 0.20, grit: 0.07 };
// pools are built in flavor order: curl, flake, coil, grit
const air = out.pools.filter(p => p.kind === 'airborne');
const newCurl = air[0] ? air[0].tris : null;
const newCoil = air[2] ? air[2].tris : null;

const oldMean = W.curl * out.oldCurlTris + W.flake * 1 + W.coil * out.oldCoilTris + W.grit * 12;
const newMean = newCurl != null && newCoil != null
    ? W.curl * newCurl + W.flake * 1 + W.coil * newCoil + W.grit * 12 : null;

console.log(JSON.stringify({
    perChip: { oldCurl: out.oldCurlTris, newCurl, oldCoil: out.oldCoilTris, newCoil },
    weightedMeanTrisPerChip: { before: +oldMean.toFixed(1), after: newMean && +newMean.toFixed(1),
        reduction: newMean && `${(100 - newMean / oldMean * 100).toFixed(0)}%` },
    atFullLoad_1340chips: { before: Math.round(oldMean * 1340), after: newMean && Math.round(newMean * 1340) },
    pools: out.pools,
}, null, 2));
