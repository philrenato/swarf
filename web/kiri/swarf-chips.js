/**
 * swarf chip physics — small particle layer that spawns curled shavings from
 * the simulated tool while it cuts, throws them along the tool's spin tangent,
 * drops them under gravity, and lets them settle on the build platform.
 *
 * Runs as a plain <script> outside the ESM bundle. Gets the 3D scene via the
 * window.moto.space bridge exposed by swarf in src/kiri/app/init/input.js.
 *
 * Constraints:
 *   - Caps active airborne chips at AIRBORNE_MAX (cheap to animate)
 *   - Caps settled chips at SETTLED_MAX (oldest fall off so we don't grow
 *     unbounded over a long simulation)
 *   - Variety comes from four geometry flavors (curl, flake, coil, dot)
 *     sharing one InstancedMesh each for fast GPU submission
 *   - Chips only spawn while the tool is actually cutting (not during rapids),
 *     approximated as "XY motion AND Z near or below stock top"
 *
 * Not physics-accurate. Reads as "the machine is throwing chips."
 */
(function () {
  'use strict';
  if (window.__swarfChipsLoaded) return;
  window.__swarfChipsLoaded = true;

  // r6: kill switch. Append ?nochips=1 to the URL to isolate simulation
  // stalls — if SIMULATE works with nochips and not without, the physics
  // layer is the culprit.
  if (/[?&]nochips=1\b/.test(location.search)) {
    console.log('swarf-chips: disabled via ?nochips=1');
    return;
  }

  // swarf v010: cut caps ~40% — Phil reported Chrome at ~40% CPU, chip physics
  // was the biggest per-frame cost. Visual density barely changes.
  // r15: bump airborne cap + gravity + drag so we can spawn more chips that
  // stay closer to the tool (see spawn rate + velocity tweaks below).
  // r15b: Phil asked to double chip count + speed again. Cap doubled.
  const AIRBORNE_MAX = 440;
  const SETTLED_MAX  = 900;
  const GRAVITY      = 260;   // mm/s² (Three.js mm units)
  const DRAG         = 0.65;
  const SPIN_RPM     = 12000; // visual approximation, not read from tool
  const TOOL_R       = 3.0;   // mm, rough default until we read tool
  const CHIP_LIFE    = 3.0;   // seconds airborne max before settle forced

  // wait for space bridge
  const ready = () => {
    const space = window.moto && window.moto.space;
    if (!space || !space.world || !window.THREE) return false;
    init(space);
    return true;
  };
  let tries = 0;
  const poll = setInterval(() => {
    if (ready() || ++tries > 100) clearInterval(poll);
  }, 150);

  function init(space) {
    const THREE = window.THREE;
    const world = space.world;

    // ---- chip geometries: four flavors for visual variety ---------------
    // chip color tracks the current material (swarf-material.js) so wood
    // chips look like wood, aluminum like aluminum, etc.
    const chipMat = new THREE.MeshPhongMaterial({
      color: 0x8a5a42,
      emissive: 0x2a0a08,
      shininess: 40,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    function applyMaterialToChips() {
      const m = window.__swarfMaterial;
      if (!m || !m.appearance) return;
      const a = m.appearance;
      try {
        if (a.chipColor)    chipMat.color.set(a.chipColor);
        if (a.chipEmissive) chipMat.emissive.set(a.chipEmissive);
        chipMat.shininess  = a.metalness > 0.5 ? 80 : 30;
        chipMat.transparent = (a.opacity || 1) < 0.9;
        chipMat.opacity     = (a.opacity || 1) < 0.9 ? 0.6 : 1;
        chipMat.needsUpdate = true;
      } catch (e) {}
    }
    applyMaterialToChips();
    window.addEventListener('swarf.material.change', applyMaterialToChips);

    // curl: a thin helical ribbon — the characteristic "long chip" from
    // ductile cuts. swarf r6: poly-count cut ~4× from r5 (8 tubular × 3
    // radial = ~48 tris vs the prior 18×4 = ~144). Curl shape is preserved
    // because at chip scale the difference is invisible.
    function curlGeometry() {
      const pts = [];
      const turns = 1.6;
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * turns * Math.PI * 2;
        pts.push(new THREE.Vector3(
          Math.cos(a) * (0.6 - t * 0.3),
          t * 2.4 - 1.2,
          Math.sin(a) * (0.6 - t * 0.3)
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      return new THREE.TubeGeometry(curve, 8, 0.12, 3, false);
    }
    // flake: a small triangular shard — brittle-material chip
    function flakeGeometry() {
      const g = new THREE.BufferGeometry();
      const v = new Float32Array([
        -0.5, 0, -0.3,
         0.6, 0,  0.0,
        -0.3, 0,  0.5,
      ]);
      g.setAttribute('position', new THREE.BufferAttribute(v, 3));
      g.computeVertexNormals();
      return g;
    }
    // coil: tight C-shape — aluminum-style short curl. r6 reduced from
    // 10×4 = 80 tris to 6×3 = ~36 tris.
    function coilGeometry() {
      const pts = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 1.3;
        pts.push(new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      return new THREE.TubeGeometry(curve, 6, 0.10, 3, false);
    }
    // grit: tiny cube — fine powder / MDF dust
    function gritGeometry() {
      return new THREE.BoxGeometry(0.18, 0.18, 0.18);
    }

    const flavors = [curlGeometry(), flakeGeometry(), coilGeometry(), gritGeometry()];
    // rough mix weights — curl dominates for the "real chip" feel
    const weights = [0.55, 0.18, 0.20, 0.07];

    // Separate airborne + settled pools per flavor, all InstancedMesh
    // start invisible — only show once simulation begins, so empty pools
    // never interfere with Kiri's preview/animate setup or rendering
    const airborne = flavors.map(geo => {
      const m = new THREE.InstancedMesh(geo, chipMat, Math.ceil(AIRBORNE_MAX / 2));
      m.count = 0;
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 5;
      world.add(m);
      return m;
    });
    const settled = flavors.map(geo => {
      const m = new THREE.InstancedMesh(geo, chipMat, Math.ceil(SETTLED_MAX / 2));
      m.count = 0;
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 4;
      world.add(m);
      return m;
    });
    const setPoolVisible = (v) => {
      for (const p of airborne) p.visible = v;
      for (const p of settled)  p.visible = v || p.count > 0;
    };

    // active airborne chip records per flavor (one array per pool so swap-
    // remove stays within a single pool's slot-space — previous global
    // `chips[]` array was swap-removing across flavors and corrupting the
    // instance-slot bookkeeping, which meant chips either didn't render or
    // stuck at phantom positions).
    const chips = flavors.map(() => []); // chips[flavor][i] = {slot,pos,vel,...}
    const settledSlots = flavors.map(() => 0);
    const settledCount = flavors.map(() => 0);

    // ---- tool tracking ---------------------------------------------------
    let lastToolPos = null;
    let lastToolTime = 0;
    let toolVel = { x: 0, y: 0, z: 0 };
    let stockTopZ = 0; // updated on cam.stock events if available
    let simulating = false;

    function pickFlavor() {
      const r = Math.random();
      let cum = 0;
      for (let i = 0; i < weights.length; i++) {
        cum += weights[i];
        if (r <= cum) return i;
      }
      return 0;
    }

    function totalAirborne() {
      let n = 0;
      for (const arr of chips) n += arr.length;
      return n;
    }

    function spawnChip(pos) {
      if (window.__swarfChipsVisible === false) return;
      if (totalAirborne() >= AIRBORNE_MAX) return;
      const flavor = pickFlavor();
      const pool = airborne[flavor];
      if (pool.count >= pool.instanceMatrix.count) return;
      const slot = pool.count++;

      // tool-spin tangent at a random point on the tool perimeter
      const theta = Math.random() * Math.PI * 2;
      // angular velocity → linear tangent velocity at perimeter
      const omega = (SPIN_RPM * Math.PI * 2) / 60; // rad/s
      // r15: halved throw velocity so chips pile near the cutter instead of
      // flinging across the platform.
      const tanMag = omega * TOOL_R * 0.002;
      // tangent direction in XY plane
      const tx = -Math.sin(theta) * tanMag;
      const ty =  Math.cos(theta) * tanMag;
      // add a small feed-direction kick
      const fx = toolVel.x * 0.15;
      const fy = toolVel.y * 0.15;
      // upward pop so they arc visibly
      const vz = 4 + Math.random() * 6;

      // start position at random point around the cutter perimeter
      const startX = pos.x + Math.cos(theta) * TOOL_R;
      const startY = pos.y + Math.sin(theta) * TOOL_R;
      const startZ = Math.max(pos.z, 0.2);

      const chip = {
        flavor, slot,
        pos: { x: startX, y: startY, z: startZ },
        vel: { x: tx + fx, y: ty + fy, z: vz },
        rot: { x: Math.random() * 6.28, y: Math.random() * 6.28, z: Math.random() * 6.28 },
        spin: { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
        life: CHIP_LIFE,
        scale: 0.7 + Math.random() * 0.7,
      };
      chips[flavor].push(chip);
      writeMatrix(pool, slot, chip);
      pool.instanceMatrix.needsUpdate = true;
    }

    const tmpMat = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpQua = new THREE.Quaternion();
    const tmpEul = new THREE.Euler();
    const tmpScl = new THREE.Vector3();

    function writeMatrix(pool, slot, c) {
      tmpPos.set(c.pos.x, c.pos.y, c.pos.z);
      tmpEul.set(c.rot.x, c.rot.y, c.rot.z);
      tmpQua.setFromEuler(tmpEul);
      tmpScl.set(c.scale, c.scale, c.scale);
      tmpMat.compose(tmpPos, tmpQua, tmpScl);
      pool.setMatrixAt(slot, tmpMat);
    }

    function writeSettled(flavor, pos, rot, scale) {
      const pool = settled[flavor];
      const cap = pool.instanceMatrix.count;
      let idx;
      if (settledCount[flavor] < cap) {
        idx = settledCount[flavor]++;
      } else {
        idx = settledSlots[flavor] % cap;
      }
      settledSlots[flavor] = (settledSlots[flavor] + 1) % cap;
      tmpPos.set(pos.x, pos.y, pos.z);
      tmpEul.set(rot.x, rot.y, rot.z);
      tmpQua.setFromEuler(tmpEul);
      tmpScl.set(scale, scale, scale);
      tmpMat.compose(tmpPos, tmpQua, tmpScl);
      pool.setMatrixAt(idx, tmpMat);
      pool.count = Math.max(pool.count, idx + 1);
      pool.instanceMatrix.needsUpdate = true;
    }

    // ---- simulation tick -------------------------------------------------
    let lastTime = performance.now();
    let _toolSpinRate = 0; // rev/s, smoothed toward target based on tool velocity
    function tick() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // swarf r12: fully stop when nothing to animate. The old 8Hz heartbeat
      // still burned CPU. Now we park entirely and restart via api events.
      let anyAirborne = false;
      for (let f = 0; f < chips.length; f++) { if (chips[f].length) { anyAirborne = true; break; } }
      if (!simulating && !anyAirborne) {
        window.__swarfChipTickRunning = false;
        return;  // fully parked — restarted by simulate/tool.move events
      }

      // swarf v010 r5: tool spin with velocity-driven ramp. Spin speed
      // follows actual tool motion — spinning up when cutting, coasting
      // down quickly after the move ends. Looks like a real spindle that
      // idles between cuts rather than a cartoon prop that runs forever.
      if (window.__swarfToolMeshes) {
        // target RPM: scale with XY velocity (cutting); 0 when idle
        const speed = Math.hypot(toolVel.x, toolVel.y);
        const targetRevPerSec = simulating && speed > 0.2 ? 12 : 0;
        // smooth toward target — accelerate fast, decelerate faster
        const rate = targetRevPerSec > _toolSpinRate ? 6 : 9; // 1/e over ~0.11s decel
        _toolSpinRate += (targetRevPerSec - _toolSpinRate) * Math.min(1, dt * rate);
        const dRot = dt * Math.PI * 2 * _toolSpinRate;
        if (dRot !== 0) {
          for (const m of window.__swarfToolMeshes) {
            if (m && m.rotation) m.rotation.z += dRot;
          }
        }
      }

      // per-flavor loop so swap-remove stays within a single pool's slot space
      for (let f = 0; f < chips.length; f++) {
        const arr = chips[f];
        const pool = airborne[f];
        let dirty = false;
        for (let i = arr.length - 1; i >= 0; i--) {
          const c = arr[i];
          c.life -= dt;
          c.vel.z -= GRAVITY * dt;
          c.vel.x *= (1 - (1 - DRAG) * dt * 2);
          c.vel.y *= (1 - (1 - DRAG) * dt * 2);
          c.pos.x += c.vel.x * dt;
          c.pos.y += c.vel.y * dt;
          c.pos.z += c.vel.z * dt;
          c.rot.x += c.spin.x * dt;
          c.rot.y += c.spin.y * dt;
          c.rot.z += c.spin.z * dt;

          const landed = c.pos.z <= 0.05 || c.life <= 0;
          if (landed) {
            // write to settled pool
            const restRot = {
              x: (Math.random() - 0.5) * 0.4,
              y: Math.random() * 6.28,
              z: (Math.random() - 0.5) * 0.4,
            };
            writeSettled(f, { x: c.pos.x, y: c.pos.y, z: 0.12 }, restRot, c.scale);
            // swap-remove within this flavor's array + pool
            const last = arr[arr.length - 1];
            if (i !== arr.length - 1) {
              arr[i] = last;
              writeMatrix(pool, c.slot, last);
              last.slot = c.slot;
            }
            arr.pop();
            if (pool.count > 0) pool.count--;
            dirty = true;
          } else {
            writeMatrix(pool, c.slot, c);
            dirty = true;
          }
        }
        if (dirty) pool.instanceMatrix.needsUpdate = true;
      }

      requestAnimationFrame(tick);
    }
    window.__swarfChipTickRunning = true;
    requestAnimationFrame(tick);

    // restart the tick if it parked itself
    function ensureTickRunning() {
      if (!window.__swarfChipTickRunning) {
        window.__swarfChipTickRunning = true;
        requestAnimationFrame(tick);
      }
    }

    // ---- hooks via api.event --------------------------------------------
    const hookApi = () => {
      const api = window.kiri && window.kiri.api;
      if (!api || !api.event) return false;

      let firstSpawnLogged = false;
      api.event.on('swarf.tool.move', ({ id, pos }) => {
        ensureTickRunning();
        const t = performance.now() / 1000;
        if (lastToolPos) {
          const dt = Math.max(0.001, t - lastToolTime);
          toolVel.x = (pos.x - lastToolPos.x) / dt;
          toolVel.y = (pos.y - lastToolPos.y) / dt;
          toolVel.z = (pos.z - lastToolPos.z) / dt;
        }
        lastToolPos = { x: pos.x, y: pos.y, z: pos.z };
        lastToolTime = t;

        // r6: forgiving spawn gate — simulate + XY motion. Earlier we also
        // required Z near stock top, but that silently killed spawning when
        // the part origin wasn't at top, making chips look "broken".
        const moving = Math.hypot(toolVel.x, toolVel.y) > 0.2;
        // r15: Phil asked for more chips, closer to the tool. Spawn 1-2 per
        // hook fire (100% chance of 1, 70% chance of a second) — the shorter
        // throw distances below keep the visual busy near the cutter.
        // r15b: doubled again — 2 guaranteed + 70% for a 3rd + 40% for a 4th
        // (avg ~3.1 per event, vs. prior ~1.7). Throw velocities unchanged.
        if (simulating && moving) {
          spawnChip(pos);
          spawnChip(pos);
          if (Math.random() < 0.7) spawnChip(pos);
          if (Math.random() < 0.4) spawnChip(pos);
          if (!firstSpawnLogged) {
            console.log('swarf-chips: first spawn at', pos);
            firstSpawnLogged = true;
          }
        }
      });

      const updateVisible = () => setPoolVisible(simulating && window.__swarfChipsVisible !== false);
      api.event.on('animate', () => { simulating = true; updateVisible(); ensureTickRunning(); });
      api.event.on('animate.end', () => { simulating = false; });
      api.event.on('function.animate', () => { simulating = true; updateVisible(); ensureTickRunning(); });
      window.addEventListener('swarf.chips.toggle', updateVisible);

      // IMPORT a new part or CLEAR → wipe the workshop floor
      function clearAllChips() {
        for (let f = 0; f < chips.length; f++) chips[f].length = 0;
        for (const p of airborne) { p.count = 0; p.instanceMatrix.needsUpdate = true; }
        for (let i = 0; i < settled.length; i++) {
          settled[i].count = 0;
          settledCount[i] = 0;
          settledSlots[i] = 0;
          settled[i].instanceMatrix.needsUpdate = true;
        }
      }
      api.event.on('widget.add', clearAllChips);
      window.addEventListener('swarf.clear', clearAllChips);

      return true;
    };
    let hookTries = 0;
    const hookPoll = setInterval(() => {
      if (hookApi() || ++hookTries > 100) clearInterval(hookPoll);
    }, 150);
  }
})();
