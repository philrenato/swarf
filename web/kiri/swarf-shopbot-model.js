/*
 * swarf shopbot model — the shop's ShopBot as a ghost, one model for SIMULATE and
 * CONTROL (Phil 10-28, from three photos of the machine: proportions right, the
 * angled front edge of the blue end supports, a round router, a cable chain that
 * rolls as Y moves). Kept to boxes, a few low cylinders and lines: under 2,000
 * triangles in all.
 *
 * Frame: z up, mm. The bed's top is z 0. In the gantry group, y 0 is the bed's front
 * edge and x 0 the beam's centre line; the router hangs OFFSET mm in front of it
 * (toward -x), so a caller puts the gantry at the bit's x + OFFSET.
 *
 *   const m = SwarfShopBotModel.build(THREE)
 *   m.gantry   the fixed machine: supports, frame rails, beam, chain, carriage
 *   m.bed      the sliding bed: spoilboard on its plywood frame, top at z 0, x 0..BED.x
 *   m.set(y, z)  the carriage to y along the beam (gantry frame), the router to z
 */
(function (root) {
  'use strict';
  const BED = { x: 2438.4, y: 1219.2 };
  const OFFSET = 200;                    // beam centre to bit, in x
  const REACH = 120;                     // beam past the bed's edge at each end
  const BEAM = { d: 120, z0: 230, z1: 470 };
  const CHAIN = { x: -20, w: 56, z: BEAM.z1 + 6, r: 80, fixed: BED.y / 2, len: 900 };

  function build(THREE) {
    const mat = (c, o, e, eo) => {
      const f = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
      const l = new THREE.LineBasicMaterial({ color: e, transparent: true, opacity: eo });
      f.fog = l.fog = false;
      return { f, l };
    };
    const M = {
      steel: mat(0x2c3aa8, 0.12, 0x7286f0, 0.42),     // the blue powder-coated steel
      alu: mat(0xc4ccd6, 0.06, 0xc8d2de, 0.30),       // extrusions
      router: mat(0x26262a, 0.16, 0xa8a8b2, 0.34),
      white: mat(0xf2f2f0, 0.14, 0xffffff, 0.36),     // the dust shoe
      brush: mat(0x111111, 0.10, 0x8a8a8a, 0.30),
      hose: mat(0xd6dee6, 0.04, 0xd6dee6, 0.16),
      mdf: mat(0xc9a77a, 0.07, 0xd8bb90, 0.22),
      ply: mat(0xb8935e, 0.05, 0xc9a26c, 0.16)
    };
    // a solid as a faint fill and its creases: an edge shows only where faces turn
    // more than 25°, so a cylinder draws as its two rims, not as every facet
    const solid = (g, m, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Group();
      o.add(new THREE.Mesh(g, m.f), new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), m.l));
      o.position.set(x, y, z); parent.add(o); return o;
    };
    // a box by its extents
    const box = (x0, x1, y0, y1, z0, z1, m, parent) =>
      solid(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m, parent, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    // an upright cylinder from z0 to z1
    const cyl = (r, z0, z1, m, parent, x, y, seg = 24, open = false) => {
      const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg, 1, open);
      g.rotateX(Math.PI / 2);
      return solid(g, m, parent, x, y, (z0 + z1) / 2);
    };

    // ---- the bed: spoilboard on a plywood deck, riding the frame rails in x
    const bed = new THREE.Group();
    box(0, BED.x, 0, BED.y, -38, 0, M.mdf, bed);
    box(0, BED.x, 40, BED.y - 40, -150, -38, M.ply, bed);

    // ---- the fixed machine
    const gantry = new THREE.Group();
    // the end supports: a blue steel plate from the frame rail up past the beam,
    // upright at the back, its front edge raked down and forward (the photos'
    // angled left side), and under it a leg to the floor that leans the same way
    const plate = new THREE.Shape();
    plate.moveTo(95, -160); plate.lineTo(95, 540); plate.lineTo(-95, 540); plate.lineTo(-330, -160); plate.closePath();
    const hole = new THREE.Path();                       // the lightening window in the plate
    hole.moveTo(45, -90); hole.lineTo(45, 170); hole.lineTo(-55, 170); hole.lineTo(-140, -90); hole.closePath();
    plate.holes.push(hole);
    const leg = new THREE.Shape();
    leg.moveTo(40, -240); leg.lineTo(-90, -240); leg.lineTo(-250, -860); leg.lineTo(-120, -860); leg.closePath();
    const flat = sh => { const g = new THREE.ExtrudeGeometry(sh, { depth: 14, bevelEnabled: false }); g.rotateX(Math.PI / 2); return g; };   // shape y → z, extruded toward -y
    const plateG = flat(plate), legG = flat(leg);
    for (const y of [-REACH + 14, BED.y + REACH]) { solid(plateG, M.steel, gantry, 0, y, 0); solid(legG, M.steel, gantry, 0, y, 0); }
    // the frame's far legs, at the rails' ends
    for (const x of [-1440, 1440]) for (const y of [-60, BED.y + 60]) box(x - 30, x + 30, y - 30, y + 30, -860, -240, M.steel, gantry);
    // the frame rails the bed rides on, through both supports
    for (const y of [-60, BED.y + 60]) box(-1500, 1500, y - 45, y + 45, -240, -160, M.alu, gantry);
    // the beam: a deep extrusion with its two rails on the front face
    box(-BEAM.d / 2, BEAM.d / 2, -REACH, BED.y + REACH, BEAM.z0, BEAM.z1, M.alu, gantry);
    for (const z of [BEAM.z0 + 18, BEAM.z1 - 30]) box(-BEAM.d / 2 - 6, -BEAM.d / 2, -REACH, BED.y + REACH, z, z + 12, M.alu, gantry);
    // the maker's name on the outer face of the near support, as on the machine
    try {
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const g = c.getContext('2d');
      g.font = 'italic 700 84px "Helvetica Neue", Arial, sans-serif'; g.fillStyle = '#ffffff'; g.textBaseline = 'middle';
      g.fillText('ShopBot', 24, 66);
      const t = new THREE.CanvasTexture(c);
      const name = new THREE.Mesh(new THREE.PlaneGeometry(300, 75), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
      name.material.fog = false;
      name.rotation.x = Math.PI / 2;                       // face -y (the near side), upright
      name.position.set(-40, -REACH - 1, 330);
      gantry.add(name);
    } catch (e) { /* no canvas */ }

    // ---- the carriage, riding the beam in y
    const carriage = new THREE.Group(); gantry.add(carriage);
    box(-82, -66, -130, 170, 200, 540, M.steel, carriage);            // carriage plate
    box(-182, -82, 77, 163, 300, 386, M.router, carriage);            // the Y motor, its face forward
    box(CHAIN.x - 20, CHAIN.x + 20, -20, 20, 540, CHAIN.z + 2 * CHAIN.r, M.steel, carriage);   // chain bracket

    // ---- the router, riding the carriage in z; its origin is the bit's tip
    const head = new THREE.Group(); carriage.add(head);
    const ax = -OFFSET;
    box(-140, -82, -50, 50, 150, 620, M.alu, head);                  // Z slide
    box(-136, -86, -32, 32, 620, 705, M.router, head);                // Z motor on top
    box(ax + 45, -140, -40, 40, 120, 220, M.steel, head);             // router clamp
    cyl(3, 0, 26, M.alu, head, ax, 0, 6);                             // bit
    cyl(22, 26, 72, M.alu, head, ax, 0, 16);                          // collet nose
    cyl(55, 72, 205, M.alu, head, ax, 0, 24);                         // router body, round
    cyl(58, 205, 300, M.router, head, ax, 0, 24);                     // its motor housing
    cyl(105, 28, 46, M.white, head, ax, 0, 28);                       // dust shoe
    cyl(103, 0, 28, M.brush, head, ax, 0, 28, true);                  // its brush skirt
    // the clear hose: up out of the shoe and over toward the beam's far end
    const hose = new THREE.CatmullRomCurve3([
      [ax + 78, 0, 46], [ax + 92, 0, 260], [ax + 70, 40, 560], [ax + 40, 200, 650], [ax + 60, 420, 600]
    ].map(p => new THREE.Vector3(...p)));
    solid(new THREE.TubeGeometry(hose, 28, 46, 8), M.hose, head);

    // ---- the cable chain: fixed on the beam's top at its middle, rolling over a
    // bend toward -y and back along the top to the carriage's bracket. Its length
    // is fixed, so the bend sits halfway between the two ends less the slack.
    const N = 56, RUNGS = 22;
    const chainPos = new Float32Array(((N - 1) * 2 + RUNGS) * 2 * 3);
    const chainG = new THREE.BufferGeometry();
    chainG.setAttribute('position', new THREE.BufferAttribute(chainPos, 3));
    const chainM = new THREE.LineBasicMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.5 });
    chainM.fog = false;
    const chain = new THREE.LineSegments(chainG, chainM);
    chain.frustumCulled = false;
    gantry.add(chain);
    const C = CHAIN, arc = Math.PI * C.r;
    function chainAt(yc) {
      const yb = (C.fixed + yc + arc - C.len) / 2, low = C.fixed - yb;
      // a point s along the chain from the fixed end: the lower run, the bend, the upper run
      return s => {
        if (s <= low) return [C.fixed - s, C.z];
        if (s <= low + arc) { const p = (s - low) / C.r; return [yb - C.r * Math.sin(p), C.z + C.r - C.r * Math.cos(p)]; }
        return [yb + (s - low - arc), C.z + 2 * C.r];
      };
    }
    function setChain(yc) {
      const at = chainAt(yc);
      let k = 0;
      const put = (x, yz) => { chainPos[k++] = x; chainPos[k++] = yz[0]; chainPos[k++] = yz[1]; };
      const x0 = C.x - C.w / 2, x1 = C.x + C.w / 2;
      for (const x of [x0, x1]) for (let i = 0; i < N - 1; i++) { put(x, at(C.len * i / (N - 1))); put(x, at(C.len * (i + 1) / (N - 1))); }
      for (let i = 0; i < RUNGS; i++) { const p = at(C.len * (i + 0.5) / RUNGS); put(x0, p); put(x1, p); }
      chainG.attributes.position.needsUpdate = true;
    }

    function set(y, z) {
      carriage.position.set(0, y, 0);
      head.position.set(0, 0, z);
      setChain(Math.min(BED.y, Math.max(0, y)));
    }
    set(0, 0);
    return { gantry, bed, carriage, head, set, OFFSET, BED };
  }

  root.SwarfShopBotModel = { build, OFFSET, BED, REACH };
})(window);
