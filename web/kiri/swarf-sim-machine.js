/*
 * swarf sim machine — the shop's ShopBot in cam's SIMULATE, as in CONTROL
 * (Phil 10-27: "an in control simulator that shows how the bed/machine will
 * move. Maybe that can also be in the simulate main view?").
 *
 * On this ShopBot the BED moves in X under a fixed gantry; the carriage rides
 * the beam in Y and the router rides the carriage in Z. Cam's simulator moves
 * the bit through its world group (stock, part, paths, chips, the light trail),
 * so here the whole world slides the other way in X by the bit's X travel: the
 * bit stays under a still gantry and everything on the bed moves with the bed.
 * The ghost gantry is drawn outside the world, the 4 x 8 ft bed inside it.
 *
 * "machine" in the simulate controls turns it on and off; the choice is the
 * same one CONTROL's "machine" chip keeps (localStorage swarf-run-ghost).
 */
(function () {
  'use strict';
  const KEY = 'swarf-run-ghost';
  const api = () => window.kiri && window.kiri.api;
  const space = () => window.moto && window.moto.space;
  let WORLD = null, gantry = null, rail = null, bed = null, chip = null, mr1 = null;
  let active = false, x0 = null, kind = null;
  // which machine: the ShopBot's bed slides under a fixed gantry ('bed'); the MR-1's
  // bed stays and the gantry, carriage and spindle move over it ('gantry', Phil 10-28)
  function machineKind() {
    let n = '';
    try { n = String(api().conf.get().device.deviceName || ''); } catch (e) { return null; }
    return /shopbot/i.test(n) ? 'bed' : /mr-1|langmuir/i.test(n) ? 'gantry' : null;
  }
  const TITLE = {
    bed: 'the ShopBot around the cut',
    gantry: 'Show the MR-1: its table stays still; the gantry moves in Y, the carriage in X and the spindle in Z'
  };

  // the bed slides, and cam's grid on it with it (Phil 10-29: the grid stood still, so the bed
  // seemed not to move). The grid is cam's own object in the scene, rebuilt at times: found by name.
  function slide(x) {
    if (!WORLD) return;
    WORLD.position.x = x;
    const g = gridView();
    if (g) g.position.x = x;
  }
  function gridView() { let r = WORLD; while (r && r.parent) r = r.parent; return r ? r.getObjectByName('swarf-grid-view') : null; }
  const wanted = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } };

  // the world group is private to space.js: it is the parent of anything space.world.add takes
  function world() {
    if (WORLD) return WORLD;
    const THREE = window.THREE, s = space();
    if (!THREE || !s || !s.world) return null;
    const g = new THREE.Group();
    s.world.add(g);
    WORLD = g.parent;
    WORLD.remove(g);
    return WORLD;
  }

  let model = null;
  function build() {
    const THREE = window.THREE, s = space();
    // one model for SIMULATE and CONTROL: swarf-shopbot-model.js (Phil 10-28, from photos)
    model = window.SwarfShopBotModel.build(THREE);
    // the gantry: in the scene (space.scene.add turns it to match the world), so it stays put
    gantry = new THREE.Group();
    rail = new THREE.Group(); gantry.add(rail);                        // model frame: z up
    rail.add(model.gantry);
    s.scene.add(gantry);
    // the bed: in the world, so it slides with the stock
    bed = model.bed;
    world().add(bed);
    gantry.visible = bed.visible = false;
  }

  // the job's front-left corner 50 mm in from the bed's, as CONTROL places it
  function placeBed() {
    const a = api();
    let x = Infinity, y = Infinity;
    const all = a.widgets.all(), cut = all.filter(w => !(w.meta && w.meta.disabled));
    for (const w of cut.length ? cut : all) {
      const g = w.mesh && w.mesh.geometry;
      if (!g) continue;
      g.computeBoundingBox();
      x = Math.min(x, g.boundingBox.min.x + w.track.pos.x);
      y = Math.min(y, g.boundingBox.min.y + w.track.pos.y);
    }
    if (!isFinite(x)) { x = 0; y = 0; }
    bed.position.set(x - 50, y - 50, 0);
    return { x: x - 50, y: y - 50 };
  }

  function buildMR1() {
    mr1 = window.SwarfMR1Model.build(window.THREE);
    world().add(mr1.root);                          // in the world: the table is where the stock is
    mr1.root.visible = false;
  }

  function start() {
    if (!world()) return;
    kind = machineKind();
    if (kind === 'bed' && !gantry) build();
    if (kind === 'gantry' && !mr1 && window.SwarfMR1Model) buildMR1();
    active = true; x0 = null;
    showChip();
    apply();
    if (!gridRaf) keepGrid();
  }
  // cam rebuilds its grid when the view changes (a zoom, simulate's framing): a new one starts at
  // x 0 while the bed has slid, so while simulate runs the grid is put back with the bed each frame
  // one loop, however many times simulate is pressed (review r093 A16)
  let gridRaf = 0;
  function keepGrid() {
    gridRaf = 0;
    if (!active) return;
    const g = gridView();
    if (g && WORLD && g.position.x !== WORLD.position.x) g.position.x = WORLD.position.x;
    // the gantry shows once the camera is far enough out, however it got there (review r093-ux B1:
    // only the wheel re-checked, so a zoom by fit or a pinch left the chip lit and no machine)
    if (wanted()) near();
    gridRaf = requestAnimationFrame(keepGrid);
  }
  function stop() {
    active = false; x0 = null; last = null;
    if (bedChip) bedChip.style.display = 'none';
    slide(0);
    if (gantry) gantry.visible = bed.visible = false;
    if (mr1) mr1.root.visible = false;
    try { space().refresh(); } catch (e) { /* gone */ }
  }
  function apply() {
    const on = active && wanted();
    if (gantry) gantry.visible = bed.visible = on && kind === 'bed';
    if (mr1) mr1.root.visible = on && kind === 'gantry';
    if (on) near();
    if (!on || kind !== 'bed') slide(0);
    if (on && kind === 'bed' && gantry) { const b = placeBed(); rail.position.set(0, b.y, 0); }
    showBedChip();
    if (chip) { chip.classList.toggle('on', wanted()); chip.classList.toggle('swarf-toggle-on', wanted()); chip.classList.toggle('swarf-toggle-off', !wanted()); chip.title = TITLE[kind] || 'Show the machine'; }
    try { space().refresh(); } catch (e) { /* gone */ }
  }

  // close in on the job the gantry would fill the view: only the bed shows until you zoom out (as in CONTROL)
  function near() {
    try {
      const d = space().internals().camera.position.length();
      if (kind === 'bed' && gantry) gantry.visible = active && wanted() && d > 1800;
      // the MR-1's gantry is small: it steps aside only when the camera is right at the job
      if (kind === 'gantry' && mr1) mr1.gantry.visible = active && wanted() && d > 650;
    } catch (e) { /* no camera */ }
  }
  // each step of the simulation: the world slides back by the bit's X travel
  let last = null;
  function onTool({ pos }) {
    if (!active || !pos) return;
    last = pos;
    // the MR-1: the table and the stock hold still; the axes go to the bit
    if (kind === 'gantry') {
      if (!mr1) return;
      slide(0);
      if (x0 === null) x0 = pos.x;
      if (wanted()) { mr1.set(pos.x, pos.y, pos.z); near(); }
      return;
    }
    if (!gantry) return;
    if (x0 === null) x0 = pos.x;
    const on = wanted(), still = bedStill();
    slide(on && !still ? -(pos.x - x0) : 0);
    if (!on) return;
    // the beam stands OFFSET mm behind the bit: still where the bed slides, with the bit where it holds
    gantry.position.x = (still ? pos.x : x0) + model.OFFSET;
    model.set(pos.y - rail.position.y, pos.z);
    near();
  }

  // the bed can hold still (Phil 11-01: "a toggle ... to stop bedslinger motion"): the gantry moves
  // over it instead, as on a gantry machine, which is easier to watch than the whole board sliding
  const STILL = 'swarf-sim-bed-still';
  const bedStill = () => { try { return localStorage.getItem(STILL) === '1'; } catch (e) { return false; } };
  let bedChip = null;
  function showBedChip() {
    if (!bedChip) {
      const host = document.getElementById('layer-animate');
      if (!host) return;
      bedChip = document.createElement('button');
      bedChip.id = 'swarf-sim-bed';
      bedChip.className = 'swarf-sim-extra swarf-toggle';
      bedChip.textContent = 'bed slides';
      bedChip.title = 'On: the bed slides under the gantry. Off: the gantry moves';
      bedChip.onclick = () => {
        try { localStorage.setItem(STILL, bedStill() ? '0' : '1'); } catch (e) { /* private window */ }
        showBedChip();
        // put the gantry and the bed where the bit is now
        if (gantry && last) onTool({ pos: last }); else apply();
        try { space().refresh(); } catch (e) { /* gone */ }
      };
      (chip && chip.nextSibling ? host.insertBefore(bedChip, chip.nextSibling) : host.append(bedChip));
    }
    const on = !bedStill();
    bedChip.style.display = active && kind === 'bed' && wanted() ? '' : 'none';
    bedChip.classList.toggle('on', on); bedChip.classList.toggle('swarf-toggle-on', on); bedChip.classList.toggle('swarf-toggle-off', !on);
  }

  function showChip() {
    const host = document.getElementById('layer-animate');
    if (!host || chip) return;
    chip = document.createElement('button');
    chip.id = 'swarf-sim-machine';
    chip.className = 'swarf-sim-extra swarf-toggle';   // (review r086 B5) the same pill as chips and lightstreams
    chip.textContent = 'machine';
    chip.title = TITLE[kind] || 'Show the machine';
    // turning it on steps back to show the machine; off comes back to the parts (review 10-28b #17)
    chip.onclick = () => {
      try { localStorage.setItem(KEY, wanted() ? '0' : '1'); } catch (e) { /* private window */ }
      apply();
      try {
        const s = space(), a = api();
        if (wanted() && kind === 'bed' && bed) s.view.fit(undefined, { padding: 0.9, visibleOnly: false, objects: [bed, model.gantry] });
        else if (wanted() && kind === 'gantry' && mr1) s.view.fit(undefined, { padding: 0.9, visibleOnly: false, objects: [mr1.root] });
        else if (a.frame) a.frame();
        setTimeout(near, 450);
      } catch (e) { /* no view */ }
    };
    host.append(chip);
  }

  let tries = 0;
  const t = setInterval(() => {
    const a = api();
    if ((a && a.event && space()) || ++tries > 200) {
      clearInterval(t);
      if (!a || !a.event) return;
      a.event.on('animate', () => setTimeout(start, 0));
      a.event.on('swarf.tool.move', onTool);
      window.addEventListener('wheel', () => { if (active && gantry) setTimeout(near, 0); }, { passive: true });
      // leaving simulate (to arrange or toolpaths) puts the world back
      a.event.on('view.set', v => { if (active && v !== 4) stop(); });
    }
  }, 150);

  window.__swarfSimMachine = { state: () => ({ active, x0, kind, still: bedStill(), worldX: WORLD ? WORLD.position.x : null, gridX: (WORLD && gridView() || { position: {} }).position.x ?? null, on: wanted(), gantryX: gantry ? gantry.position.x : null,
    mr1: mr1 ? { shown: mr1.root.visible, y: mr1.gantry.position.y, x: mr1.carriage.position.x, z: mr1.head.position.z } : null }), stop };
})();
