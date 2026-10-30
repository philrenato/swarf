// AUTO TABS in the app: a 300 x 200 part of 3/4 in plywood on the ShopBot and a 150 x 100 part
// of 1 in aluminum on the MR-1 get different starting tabs; the preview changes nothing; apply
// makes ordinary tabs (in the widget's tab list, each box clickable by the tab tool, one deleted
// by a real click with tabs › +); a tab placed by hand survives a second apply; the outline's
// toolpath lifts over every tab.
//   node tools/probe_autotabs.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.platform?.load_svg && window.__swarfShape && window.__swarfAutoTabs && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);

  // one part on a machine in a material: clear the bed, draw a rectangle, add an outline
  const setup = async (device, material, w, h, t) => {
    await page.evaluate(() => window.kiri.api.platform.clear());
    await wait(300);
    await page.evaluate(d => window.kiri.api.devices.select(d), device);
    await wait(900);
    await page.evaluate(m => { const s = document.getElementById('swarf-material-select'); s.value = m; s.dispatchEvent(new Event('change', { bubbles: true })); }, material);
    await wait(300);
    await page.evaluate((w, h, t) => {
      const a = window.kiri.api;
      a.platform.load_svg(window.__swarfShape.svgFor('rect', { w, h }), 'rectangle', { depth: t, resolution: 2, segmin: 48, soup: true, dpi: 0, edge: { kind: 'straight', size: 0 } });
    }, w, h, t);
    await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
    await wait(600);
    await page.evaluate(() => {
      const a = window.kiri.api, s = a.conf.get();
      s.process.ops = [];
      const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline');
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      a.platform.select(a.widgets.all()[0]);
    });
    await wait(500);
    return page.evaluate(() => ({ mat: window.__swarfMaterial?.id, dev: window.kiri.api.conf.get().device.deviceName, ops: window.kiri.api.conf.get().process.ops.map(o => o.type) }));
  };
  const tabs = () => page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; return { anno: (a.widgets.annotate(w.id).tab || []).map(r => ({ id: r.id, auto: !!r.auto, w: r.dim.y, h: r.dim.z })), boxes: Object.keys(w.tabs || {}).length }; });

  // ---- 3/4 in plywood, 1/4 in bit, ShopBot -------------------------------------------------
  let s = await setup('ShopBot.Basic', 'plywood', 300, 200, 19.05);
  check(s.mat === 'plywood' && /ShopBot/.test(s.dev) && s.ops.includes('outline'), `ShopBot, plywood, an outline: ${JSON.stringify(s)}`);
  const bitSB = await page.evaluate(() => window.__swarfAutoTabs.inputs(window.kiri.api.widgets.all()[0]));
  let pv = await page.evaluate(() => { const p = window.__swarfAutoTabs.preview(); return { p, say: document.getElementById('swarf-autotabs-say').textContent, apply: getComputedStyle(document.getElementById('swarf-autotabs-apply')).display }; });
  const ply = pv.p && pv.p[0];
  console.log('   plywood/ShopBot:', JSON.stringify({ bit: bitSB.bitMm, ...ply }), '\n   says:', pv.say);
  check(ply && ply.count === 4 && ply.width === +(2 * bitSB.bitMm).toFixed(2) && Math.abs(ply.height - 4.76) < 0.01, `3/4 in plywood on the ShopBot: 4 tabs ${ply?.width} mm x ${ply?.height} mm`);
  check(pv.apply !== 'none' && /4 tabs/.test(pv.say), 'the preview says what it will do, and offers apply');
  let t = await tabs();
  check(t.anno.length === 0 && t.boxes === 0, 'the preview places nothing yet');
  // a slider moves the preview
  const more = await page.evaluate(() => { const i = document.getElementById('swarf-autotabs-density'); i.value = 2; i.dispatchEvent(new Event('input', { bubbles: true })); return window.__swarfAutoTabs.preview()[0].count; });
  check(more > 4, `"more" gives more tabs (${more})`);
  await page.evaluate(() => { const i = document.getElementById('swarf-autotabs-density'); i.value = 0; i.dispatchEvent(new Event('input', { bubbles: true })); window.__swarfAutoTabs.preview(); });
  await page.evaluate(() => document.getElementById('swarf-autotabs-apply').click());
  await wait(300);
  t = await tabs();
  check(t.anno.length === 4 && t.anno.every(r => r.auto) && t.boxes === 4, `apply: 4 ordinary tabs in the tab list, 4 drawn (${JSON.stringify(t)})`);
  const fields = await page.evaluate(() => { const p = window.kiri.api.conf.get().process; return [p.camTabsWidth, p.camTabsHeight]; });
  check(fields[0] === ply.width && fields[1] === ply.height, `the panel's width/height now match, so a tab added by hand matches (${fields})`);

  // editable: tabs › +, a real click on one tab's box deletes it (the existing tool)
  const target = await page.evaluate(() => {
    // the tab nearest the camera, so the part does not hide it
    const a = window.kiri.api, w = a.widgets.all()[0], cam = window.moto.space.internals().camera;
    const at = r => r.box.getWorldPosition(new window.THREE.Vector3());
    const rec = Object.values(w.tabs).sort((p, q) => at(p).distanceTo(cam.position) - at(q).distanceTo(cam.position))[0];
    const v = at(rec);
    return { id: rec.box.tab.id, world: [v.x, v.y, v.z] };
  });
  const xy = await page.evaluate(w => {
    // project through the scene's camera: find it on the renderer's last render
    const I = window.moto?.space?.internals?.();
    if (!I || !I.camera) return null;
    const cam = I.camera, r = I.renderer.domElement.getBoundingClientRect();
    const v = new window.THREE.Vector3(...w).project(cam);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, target.world);
  if (xy) {
    await page.evaluate(() => document.getElementById('swarf-autotabs-go') && window.kiri.api.event.emit('cam.tabs.add'));
    await wait(200);
    await page.mouse.move(xy.x - 3, xy.y - 3); await wait(100);
    await page.mouse.move(xy.x, xy.y); await wait(150);
    await page.mouse.down(); await page.mouse.up(); await wait(300);
    await page.evaluate(() => window.kiri.api.event.emit('cam.tabs.done'));
    t = await tabs();
    check(t.anno.length === 3 && !t.anno.some(r => r.id === target.id), `a click with tabs › + deletes an auto tab like any other (${t.anno.length} left)`);
  } else {
    console.log('   (no camera handle to project a click; checked the tab boxes are the tool\'s instead)');
    const tool = await page.evaluate(() => Object.values(window.kiri.api.widgets.all()[0].tabs).every(r => r.box.tab && r.box.tab.id && r.box.tab.widget));
    check(tool, 'every auto tab box carries the tab tool\'s handle (clicking it with + deletes it)');
    await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0], l = a.widgets.annotate(w.id).tab; l.splice(0, 1); });
  }

  // a hand-placed tab survives a second apply; the auto ones are replaced, not added to
  await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0], l = a.widgets.annotate(w.id).tab;
    const a0 = l.find(r => r.auto);
    l.push({ pos: { x: -a0.pos.x, y: -a0.pos.y, z: a0.pos.z }, dim: a0.dim, rot: a0.rot, id: 42 });   // the hand tab, opposite one auto tab
  });
  await page.evaluate(() => { window.__swarfAutoTabs.preview(); document.getElementById('swarf-autotabs-apply').click(); });
  await wait(300);
  t = await tabs();
  const hand = t.anno.filter(r => !r.auto), auto = t.anno.filter(r => r.auto);
  check(hand.length === 1 && hand[0].id === 42 && auto.length === 3, `again: the hand tab stays, the auto tab under it is left out, ${auto.length} auto (${JSON.stringify(t.anno.map(r => r.auto ? 'a' : 'h'))})`);

  // the toolpath lifts over the tabs: cut moves at the tab top, in 4 places around the part
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const done = await page.evaluate(() => new Promise(res => {
    window.kiri.api.event.on('preview.end', () => res('ok'));
    window.kiri.api.event.on('preview.error', e => res('error ' + e));
    setTimeout(() => res('timeout'), 60000);
  }));
  const gc = done === 'ok' ? await page.evaluate(() => new Promise(res => { try { window.kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))); } catch (e) { res(''); } setTimeout(() => res(''), 30000); })) : '';
  const lifted = (() => {
    if (!gc) return null;
    const k = /G20/.test(gc) ? 25.4 : 1;
    let x = 0, y = 0, z = 0;
    const pts = [];
    for (const line of gc.split(/\r?\n/)) {
      if (!/^G0?1\b/.test(line)) { const mx = line.match(/X(-?[\d.]+)/), my = line.match(/Y(-?[\d.]+)/), mz = line.match(/Z(-?[\d.]+)/); if (mx) x = +mx[1] * k; if (my) y = +my[1] * k; if (mz) z = +mz[1] * k; continue; }
      const mx = line.match(/X(-?[\d.]+)/), my = line.match(/Y(-?[\d.]+)/), mz = line.match(/Z(-?[\d.]+)/);
      if (mx) x = +mx[1] * k; if (my) y = +my[1] * k; if (mz) z = +mz[1] * k;
      pts.push({ x, y, z });
    }
    const zmin = Math.min(...pts.map(p => p.z));
    const top = pts.filter(p => Math.abs(p.z - (zmin + 0)) > 0.01 && p.z < zmin + ply.height + 0.3 && p.z > zmin + ply.height - 0.3);
    const groups = [];
    for (const p of top) { const g = groups.find(g => Math.hypot(g.x - p.x, g.y - p.y) < 40); if (!g) groups.push({ x: p.x, y: p.y }); }
    return { zmin: +zmin.toFixed(2), atTop: top.length, places: groups.length };
  })();
  console.log('   toolpath:', done, JSON.stringify(lifted));
  check(lifted && lifted.places >= 4, `the outline lifts to the tab top (${ply.height} mm above the bottom) in ${lifted?.places} places`);

  // ---- 1 in aluminum, MR-1 ---------------------------------------------------------------
  s = await setup('Langmuir.MR-1', 'aluminum_6061', 150, 100, 25.4);
  check(s.mat === 'aluminum_6061' && /MR-1/.test(s.dev), `MR-1, aluminum: ${JSON.stringify(s)}`);
  const inA = await page.evaluate(() => window.__swarfAutoTabs.inputs(window.kiri.api.widgets.all()[0]));
  pv = await page.evaluate(() => { const p = window.__swarfAutoTabs.preview(); return { p, say: document.getElementById('swarf-autotabs-say').textContent }; });
  const alu = pv.p && pv.p[0];
  console.log('   aluminum/MR-1:', JSON.stringify({ bit: inA.bitMm, ...alu }), '\n   says:', pv.say);
  check(alu && alu.material === 'metal' && alu.machine === 'mill' && Math.abs(alu.height - 2.54) < 0.01 && alu.width === +Math.max(3, Math.min(8, inA.bitMm)).toFixed(2) && alu.count === 4,
    `1 in aluminum on the MR-1: ${alu?.count} tabs ${alu?.width} mm x ${alu?.height} mm`);
  check(alu && ply && (alu.height !== ply.height || alu.width !== ply.width), 'the two cases land on different defaults');
  await page.evaluate(() => window.__swarfAutoTabs.cancel());
} finally {
  await browser.close();
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(bad.length ? `FAIL (${bad.length})\n` + bad.join('\n') : 'auto tabs: ok');
  process.exitCode = errors.length || bad.length ? 1 : 0;
}
