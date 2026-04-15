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

  const AIRBORNE_MAX = 240;
  const SETTLED_MAX  = 1600;
  const GRAVITY      = 180;   // mm/s² (Three.js mm units)
  const DRAG         = 0.85;
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
    // all are small, bruised-metal colored, with a faint rust rim
    const chipMat = new THREE.MeshPhongMaterial({
      color: 0x8a5a42,
      emissive: 0x2a0a08,
      shininess: 40,
      flatShading: true,
      side: THREE.DoubleSide,
    });

    // curl: a thin helical ribbon — the characteristic "long chip" from ductile cuts
    function curlGeometry() {
      const pts = [];
      const turns = 1.8;
      const steps = 18;
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
      return new THREE.TubeGeometry(curve, 18, 0.12, 4, false);
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
    // coil: tight C-shape — aluminum-style short curl
    function coilGeometry() {
      const pts = [];
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 1.3;
        pts.push(new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      return new THREE.TubeGeometry(curve, 10, 0.10, 4, false);
    }
    // grit: tiny cube — fine powder / MDF dust
    function gritGeometry() {
      return new THREE.BoxGeometry(0.18, 0.18, 0.18);
    }

    const flavors = [curlGeometry(), flakeGeometry(), coilGeometry(), gritGeometry()];
    // rough mix weights — curl dominates for the "real chip" feel
    const weights = [0.55, 0.18, 0.20, 0.07];

    // Separate airborne + settled pools per flavor, all InstancedMesh
    const airborne = flavors.map(geo => {
      const m = new THREE.InstancedMesh(geo, chipMat, Math.ceil(AIRBORNE_MAX / 2));
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 5;
      world.add(m);
      return m;
    });
    const settled = flavors.map(geo => {
      const m = new THREE.InstancedMesh(geo, chipMat, Math.ceil(SETTLED_MAX / 2));
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 4;
      world.add(m);
      return m;
    });

    // active airborne chip records (one per instance slot)
    const chips = []; // { flavor, slot, pos, vel, rot, spin, life }
    const settledSlots = flavors.map(() => 0); // next write index per flavor (ring)
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

    function spawnChip(pos) {
      if (chips.length >= AIRBORNE_MAX) return;
      const flavor = pickFlavor();
      const pool = airborne[flavor];
      if (pool.count >= pool.instanceMatrix.count) return;
      const slot = pool.count++;

      // tool-spin tangent at a random point on the tool perimeter
      const theta = Math.random() * Math.PI * 2;
      // angular velocity → linear tangent velocity at perimeter
      const omega = (SPIN_RPM * Math.PI * 2) / 60; // rad/s
      const tanMag = omega * TOOL_R * 0.004; // scaled down; raw would be explosive
      // tangent direction in XY plane
      const tx = -Math.sin(theta) * tanMag;
      const ty =  Math.cos(theta) * tanMag;
      // add a small feed-direction kick
      const fx = toolVel.x * 0.3;
      const fy = toolVel.y * 0.3;
      // upward pop so they arc visibly
      const vz = 8 + Math.random() * 10;

      // start position at random point around the cutter perimeter
      const startX = pos.x + Math.cos(theta) * TOOL_R;
      const startY = pos.y + Math.sin(theta) * TOOL_R;
      const startZ = Math.max(pos.z, 0.2);

      chips.push({
        flavor, slot,
        pos: { x: startX, y: startY, z: startZ },
        vel: { x: tx + fx, y: ty + fy, z: vz },
        rot: { x: Math.random() * 6.28, y: Math.random() * 6.28, z: Math.random() * 6.28 },
        spin: { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
        life: CHIP_LIFE,
        scale: 0.7 + Math.random() * 0.7,
      });
      writeMatrix(pool, slot, chips[chips.length - 1]);
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
    function tick() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i];
        c.life -= dt;
        // integrate
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
          // settle: flatten rotation toward horizontal, tiny random tilt
          const restRot = {
            x: (Math.random() - 0.5) * 0.4,
            y: Math.random() * 6.28,
            z: (Math.random() - 0.5) * 0.4,
          };
          const restPos = { x: c.pos.x, y: c.pos.y, z: 0.12 };
          writeSettled(c.flavor, restPos, restRot, c.scale);
          // remove from airborne — O(1) swap-remove
          const pool = airborne[c.flavor];
          const last = chips[chips.length - 1];
          if (i !== chips.length - 1) {
            chips[i] = last;
            // rewrite the swapped-in chip at the vacated slot
            writeMatrix(airborne[last.flavor], c.slot, last);
            last.slot = c.slot;
          }
          chips.pop();
          // shrink airborne count if this was the top slot
          if (pool.count > 0) pool.count--;
          pool.instanceMatrix.needsUpdate = true;
        } else {
          writeMatrix(airborne[c.flavor], c.slot, c);
          airborne[c.flavor].instanceMatrix.needsUpdate = true;
        }
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // ---- hooks via api.event --------------------------------------------
    const hookApi = () => {
      const api = window.kiri && window.kiri.api;
      if (!api || !api.event) return false;

      api.event.on('swarf.tool.move', ({ id, pos }) => {
        const t = performance.now() / 1000;
        if (lastToolPos) {
          const dt = Math.max(0.001, t - lastToolTime);
          toolVel.x = (pos.x - lastToolPos.x) / dt;
          toolVel.y = (pos.y - lastToolPos.y) / dt;
          toolVel.z = (pos.z - lastToolPos.z) / dt;
        }
        lastToolPos = { x: pos.x, y: pos.y, z: pos.z };
        lastToolTime = t;

        // only spawn while "cutting": XY motion present and Z at/below stock top.
        // stockTopZ is set from cam.stock events when available; fallback 0.
        const cuttingZ = pos.z <= (stockTopZ + 0.1);
        const moving = Math.hypot(toolVel.x, toolVel.y) > 1;
        if (simulating && cuttingZ && moving) {
          // spawn 1–3 chips per move event, rate ~feed-dependent
          const n = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) spawnChip(pos);
        }
      });

      api.event.on('animate', () => { simulating = true; });
      api.event.on('animate.end', () => { simulating = false; });
      api.event.on('function.animate', () => { simulating = true; });

      // IMPORT a new part → clear the workshop floor
      api.event.on('widget.add', () => {
        chips.length = 0;
        for (const p of airborne) { p.count = 0; p.instanceMatrix.needsUpdate = true; }
        for (let i = 0; i < settled.length; i++) {
          settled[i].count = 0;
          settledCount[i] = 0;
          settledSlots[i] = 0;
          settled[i].instanceMatrix.needsUpdate = true;
        }
      });

      return true;
    };
    let hookTries = 0;
    const hookPoll = setInterval(() => {
      if (hookApi() || ++hookTries > 100) clearInterval(hookPoll);
    }, 150);
  }
})();
