import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8181/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    const input = await page.$('input[type=file]');
    await input.uploadFile('/Users/philrenato/Desktop/1.obj');
    await new Promise(r => setTimeout(r, 4000));

    const dbg = await page.evaluate(() => {
        const w = window.kiri.api.widgets.all()[0];
        const mesh = w.mesh;
        // walk parent chain
        const chain = [];
        let n = mesh;
        while (n) {
            chain.push({
                name: n.name || n.constructor?.name || 'anon',
                visible: n.visible,
                isParented: !!n.parent
            });
            n = n.parent;
        }
        // now do a fit call with visibleOnly:false, no objects
        const sp = window.moto.space;
        // capture camera state before and after
        const camBefore = sp.view.camera ? { x:sp.view.camera.position.x, y:sp.view.camera.position.y, z:sp.view.camera.position.z } : null;
        // no-objects / visibleOnly:false
        sp.view.fit(undefined, { padding: 1.8, visibleOnly: false });
        const camAfter1 = sp.view.camera ? { x:sp.view.camera.position.x, y:sp.view.camera.position.y, z:sp.view.camera.position.z } : null;
        // with objects
        sp.view.fit(undefined, { padding: 1.8, visibleOnly: true, objects: [mesh] });
        const camAfter2 = sp.view.camera ? { x:sp.view.camera.position.x, y:sp.view.camera.position.y, z:sp.view.camera.position.z } : null;
        return { chain, camBefore, camAfter1, camAfter2 };
    });
    console.log(JSON.stringify(dbg, null, 2));
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: '/tmp/fit-debug.png' });
} finally { await browser.close(); }
