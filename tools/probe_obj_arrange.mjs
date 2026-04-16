import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8181/kiri/';
const OBJ = '/Users/philrenato/Desktop/1.obj';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    const input = await page.$('input[type=file]');
    await input.uploadFile(OBJ);
    await new Promise(r => setTimeout(r, 4000));

    // screenshot BEFORE any manual fit, to see auto-fit state
    await page.screenshot({ path: '/tmp/obj-arrange-1-autofit.png' });

    // log camera position
    const camInfo = await page.evaluate(() => {
        const sp = window.moto?.space;
        const cam = sp?.view?.camera || sp?.platform?.camera;
        const w = window.kiri.api.widgets.all()[0];
        return {
            camPos: cam ? { x: cam.position.x, y: cam.position.y, z: cam.position.z } : null,
            widgetBounds: w ? (() => { const b=w.getBoundingBox(); return { min:[b.min.x,b.min.y,b.min.z], max:[b.max.x,b.max.y,b.max.z] }; })() : null,
            meshVisible: w ? w.mesh.visible : null,
            meshInScene: w ? !!w.mesh.parent : null
        };
    });
    console.log(JSON.stringify(camInfo, null, 2));

    // manual fit
    await page.evaluate(() => {
        const meshes = window.kiri.api.widgets.all().map(w => w.mesh);
        if (meshes.length) window.moto.space.view.fit(undefined, { padding: 1.8, visibleOnly: true, objects: meshes });
    });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: '/tmp/obj-arrange-2-manualfit.png' });

} finally { await browser.close(); }
