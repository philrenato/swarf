/**
 * Probe: find UI that is clipped rather than scrollable.
 *
 * Walks the visible DOM and reports every element whose content is wider or
 * taller than its box while its own overflow is hidden or visible — i.e. the
 * content is unreachable, with no scrollbar to reach it. Opens the panels a
 * student actually meets, plus the device dialog, which is where the gcode
 * macro tab row was losing its last tab off the right edge.
 *
 * Usage: node tools/probe_overflow.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:8080/kiri/';
const SLOP = 2; // px — sub-pixel rounding is not a clip

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    defaultViewport: { width: 1400, height: 900 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 5000));
await page.waitForFunction(() => !!(window.kiri?.api?.conf), { timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));

const scan = () => {
    const bad = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('*')) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const dx = el.scrollWidth - el.clientWidth;
        const dy = el.scrollHeight - el.clientHeight;
        const okX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        const okY = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
        // a box whose only oversized children are absolutely positioned is
        // not clipping anything a user needs to see
        if ((dx > 2 && !okX) || (dy > 2 && !okY)) {
            const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
                (e.className && typeof e.className === 'string'
                    ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
            // name the child that actually sticks out, not just the box it
            // sticks out of — the container is never the thing to fix
            const box = el.getBoundingClientRect();
            let worst = null;
            for (const ch of el.children) {
                const ccs = getComputedStyle(ch);
                // an absolutely positioned badge placed outside its parent is
                // deliberate placement, not content that cannot be reached
                if (ccs.position === 'absolute' || ccs.position === 'fixed') continue;
                const cr = ch.getBoundingClientRect();
                if (cr.width < 4) continue;
                const over = Math.max(cr.right - box.right, box.left - cr.left,
                                      cr.bottom - box.bottom, box.top - cr.top);
                if (over > 2 && (!worst || over > worst.over)) {
                    worst = { sel: name(ch), over: Math.round(over),
                              text: (ch.innerText || '').trim().slice(0, 40).replace(/\s+/g, ' ') };
                }
            }
            bad.push({
                sel: name(el),
                overflowX: dx > 2 ? dx : 0,
                overflowY: dy > 2 ? dy : 0,
                overflow: cs.overflow,
                culprit: worst,
                text: (el.innerText || '').trim().slice(0, 60).replace(/\s+/g, ' '),
            });
        }
    }
    return bad;
};

const out = {};
out.main = await page.evaluate(scan);
// device dialog — where the macro tab row lives
await page.evaluate(() => { try { window.kiri.api.show.devices(); } catch (e) {} });
await new Promise(r => setTimeout(r, 1200));
out.deviceDialog = await page.evaluate(scan);
await page.evaluate(() => { try { window.kiri.api.modal.hide(); } catch (e) {} });
await new Promise(r => setTimeout(r, 500));
// toolpaths panel with ops present
await page.evaluate(() => {
    try {
        const l = document.getElementById('op-add-list');
        for (const n of ['rough', 'contour', 'outline']) {
            Array.from(l.children).find(c => c.innerText.trim().toLowerCase() === n)
                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    } catch (e) {}
});
await new Promise(r => setTimeout(r, 1200));
out.toolpaths = await page.evaluate(scan);
await browser.close();

const all = [];
for (const [where, list] of Object.entries(out)) for (const b of list) all.push({ where, ...b });
// the 3D canvas and the scene container legitimately exceed their box
const ignore = /canvas|#container|#context/i;
const real = all.filter(b => b.culprit)
    .filter(b => !ignore.test(b.sel))
    // the document root scrolling a few px is the page, not a clipped control
    .filter(b => !(/^html|^body/.test(b.sel) && b.overflowX === 0 && b.overflowY < 12));

console.log(JSON.stringify({ clipped: real.length, findings: real }, null, 2));
process.exit(real.length ? 1 : 0);
