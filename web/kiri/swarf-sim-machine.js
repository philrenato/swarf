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
  const BED = { x: 2438.4, y: 1219.2, t: 38 }, BEAM_Z = 260, REACH = 120;
  const api = () => window.kiri && window.kiri.api;
  const space = () => window.moto && window.moto.space;
  let WORLD = null, gantry = null, rail = null, carriage = null, bed = null, chip = null;
  let active = false, x0 = null;

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

  function build() {
    const THREE = window.THREE, s = space();
    const fill = new THREE.MeshBasicMaterial({ color: 0x8fa6c0, transparent: true, opacity: 0.05, depthWrite: false });
    const edge = new THREE.LineBasicMaterial({ color: 0xb8c8da, transparent: true, opacity: 0.16 });
    for (const m of [fill, edge]) m.fog = false;
    const box = (sx, sy, sz, x, y, z, parent) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      const o = new THREE.Group();
      o.add(new THREE.Mesh(g, fill), new THREE.LineSegments(new THREE.EdgesGeometry(g), edge));
      o.position.set(x, y, z); parent.add(o); return o;
    };
    // the gantry: in the scene (space.scene.add turns it to match the world), so it stays put
    gantry = new THREE.Group();
    rail = new THREE.Group(); gantry.add(rail);                        // model frame: z up
    box(110, BED.y + 2 * REACH, 140, 0, BED.y / 2, BEAM_Z + 70, rail);
    box(110, 60, BEAM_Z + 340, 0, -REACH + 30, (BEAM_Z + 140) / 2 - 100, rail);
    box(110, 60, BEAM_Z + 340, 0, BED.y + REACH - 30, (BEAM_Z + 140) / 2 - 100, rail);
    carriage = new THREE.Group(); rail.add(carriage);
    box(150, 170, 260, -110, 0, BEAM_Z - 10, carriage);                // carriage + Z slide
    box(95, 95, 170, -110, 0, 85, carriage);                          // router body, bit tip at z 0
    s.scene.add(gantry);
    // the bed: in the world, so it slides with the stock
    bed = new THREE.Group();
    box(BED.x, BED.y, BED.t, BED.x / 2, BED.y / 2, -BED.t / 2, bed);
    world().add(bed);
    gantry.visible = bed.visible = false;
  }

  // the job's front-left corner 50 mm in from the bed's, as CONTROL places it
  function placeBed() {
    const a = api();
    let x = Infinity, y = Infinity;
    for (const w of a.widgets.all()) {
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

  function start() {
    if (!world()) return;
    if (!gantry) build();
    active = true; x0 = null;
    showChip();
    apply();
  }
  function stop() {
    active = false; x0 = null;
    if (WORLD) WORLD.position.x = 0;
    if (gantry) gantry.visible = bed.visible = false;
    try { space().refresh(); } catch (e) { /* gone */ }
  }
  function apply() {
    const on = active && wanted();
    if (!gantry) return;
    gantry.visible = bed.visible = on;
    if (on) near();
    if (!on && WORLD) WORLD.position.x = 0;
    if (on) { const b = placeBed(); rail.position.set(0, b.y, 0); }
    if (chip) chip.classList.toggle('on', wanted());
    try { space().refresh(); } catch (e) { /* gone */ }
  }

  // close in on the job the gantry would fill the view: only the bed shows until you zoom out (as in CONTROL)
  function near() {
    try { gantry.visible = active && wanted() && space().internals().camera.position.length() > 1800; } catch (e) { /* no camera */ }
  }
  // each step of the simulation: the world slides back by the bit's X travel
  function onTool({ pos }) {
    if (!active || !gantry || !pos) return;
    if (x0 === null) x0 = pos.x;
    const on = wanted();
    WORLD.position.x = on ? -(pos.x - x0) : 0;
    if (!on) return;
    gantry.position.x = x0 + 110;                 // the carriage hangs 110 mm behind the bit
    carriage.position.set(0, pos.y - rail.position.y, pos.z);
    near();
  }

  function showChip() {
    const host = document.getElementById('layer-animate');
    if (!host || chip) return;
    chip = document.createElement('button');
    chip.id = 'swarf-sim-machine';
    chip.textContent = 'machine';
    chip.title = 'Show the ShopBot: its 4 × 8 ft bed slides in X under the gantry, as it does in the shop';
    // turning it on steps back to show the machine; off comes back to the parts (review 10-28b #17)
    chip.onclick = () => {
      try { localStorage.setItem(KEY, wanted() ? '0' : '1'); } catch (e) { /* private window */ }
      apply();
      try {
        const s = space(), a = api();
        if (wanted() && bed) s.view.fit(undefined, { padding: 0.9, objects: [bed] });
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

  window.__swarfSimMachine = { state: () => ({ active, x0, worldX: WORLD ? WORLD.position.x : null, on: wanted(), gantryX: gantry ? gantry.position.x : null }), stop };
})();
