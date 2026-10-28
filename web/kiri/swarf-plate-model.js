/*
 * swarf plate model — the Z plate, its lead, and the ground clip on the router, for the
 * plate card and the shop poster (Phil 10-28, from a photo of the shop's setup: an
 * aluminium strip on a coiled black lead, a copper alligator clip biting the black Allen
 * screw in the side of the router's clamp (Phil 10-28), the bit hanging between them).
 * Same drawing as the ShopBot model: a faint fill and its creases, boxes and low
 * cylinders, a few hundred triangles.
 *
 * Frame: z up, mm. The board's top is z 0; the bit sits over x 0, y 0.
 *
 *   const m = SwarfPlateModel.build(THREE, { style: 'ghost' | 'ink' })
 *   m.group                 add it to a scene
 *   m.set({ bitZ, plate })  the bit's tip to bitZ over the board; the plate 'flat' (on the
 *                           board under the bit), 'test' (held up against the bit: the
 *                           circuit check) or 'away' (put back, off to the side)
 *   m.anchors()             world points for labels: bit, clip, collar, plate, leads
 *   m.reskin(colors)        repaint from a { part: [fill, edge] } map (skins)
 *
 * Not wired in yet. For the plate card: 'test' while it waits for the circuit check,
 * 'flat' once the check passes, the bit lowering on touch off, 'away' when the card asks
 * for the plate and clip to be put back. Load it beside swarf-shopbot-model.js.
 */
(function (root) {
  'use strict';
  const COLLAR = { r: 52, z0: 46, z1: 112 };   // the router's clamp ring, from the bit's tip
  const PLATE = { x: 150, y: 28, t: 3 };
  const BOARD = { x: 320, y: 220, t: 19 };

  function build(THREE, opts = {}) {
    const ink = opts.style === 'ink';
    const mat = (c, o, e, eo) => {
      const f = new THREE.MeshBasicMaterial({ color: c, transparent: !ink, opacity: ink ? 1 : o, depthWrite: ink, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const l = new THREE.LineBasicMaterial({ color: ink ? 0x1a1a1a : e, transparent: !ink, opacity: ink ? 1 : eo });
      f.fog = l.fog = false;
      return { f, l };
    };
    // ink: an illustration on white (poster); ghost: the faint look of swarf's 3D views
    const M = ink ? {
      alu: mat(0xe4e8ee), dark: mat(0x3a3a40), bit: mat(0xb9c0c8), copper: mat(0xd08a52),
      lead: mat(0x1c1c1c), plate: mat(0xd5dbe2), board: mat(0xe8d2ae)
    } : {
      alu: mat(0xc4ccd6, 0.10, 0xd0d8e2, 0.45), dark: mat(0x26262a, 0.18, 0xa8a8b2, 0.40),
      bit: mat(0xc4ccd6, 0.30, 0xe0e6ee, 0.70), copper: mat(0xd08a52, 0.45, 0xf0a870, 0.85),
      lead: mat(0x111111, 0.55, 0x666666, 0.6), plate: mat(0xc4ccd6, 0.25, 0xe6ecf2, 0.75),
      board: mat(0xc9a77a, 0.07, 0xd8bb90, 0.25)
    };
    const solid = (g, m, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Group();
      o.add(new THREE.Mesh(g, m.f), new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), m.l));
      o.position.set(x, y, z); parent.add(o); return o;
    };
    const box = (sx, sy, sz, m, parent, x, y, z) => solid(new THREE.BoxGeometry(sx, sy, sz), m, parent, x, y, z);
    const cyl = (r, z0, z1, m, parent, seg = 24, r1 = r) => {
      const g = new THREE.CylinderGeometry(r1, r, z1 - z0, seg); g.rotateX(Math.PI / 2);
      return solid(g, m, parent, 0, 0, (z0 + z1) / 2);
    };
    const tube = (pts, r, m, parent) => solid(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 48, r, 6), m, parent);

    const group = new THREE.Group();

    // ---- the board, top at z 0
    box(BOARD.x, BOARD.y, BOARD.t, M.board, group, 0, 0, -BOARD.t / 2);

    // ---- the router, its origin the bit's tip
    const head = new THREE.Group(); group.add(head);
    cyl(3.175, 0, 30, M.bit, head, 8);                          // a 1/4 in bit
    const flute = [];                                             // its flute, a helix line
    for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 6, z = 2 + i / 60 * 22; flute.push(new THREE.Vector3(3.3 * Math.cos(a), 3.3 * Math.sin(a), z)); }
    head.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(flute), M.lead.l));
    cyl(9, 30, 38, M.alu, head, 12, 13);                          // collet nut, tapered
    cyl(14, 38, COLLAR.z0, M.alu, head, 16);
    const collar = cyl(COLLAR.r, COLLAR.z0, COLLAR.z1, M.alu, head, 32);   // the clamp ring
    box(26, 22, 50, M.alu, head, 0, -COLLAR.r - 8, COLLAR.z0 + 30);        // its clamp ear and slot
    box(2, 24, 52, M.dark, head, 0, -COLLAR.r - 8, COLLAR.z0 + 30);
    cyl(COLLAR.r + 2, COLLAR.z1, COLLAR.z1 + 26, M.dark, head, 32);       // the motor above, cut short

    // ---- the black Allen screw in the side of the clamp ear (Phil 10-28: the clip "needs to go
    // on the black allen head screw in the side of the housing for the router"), and the ground
    // clip biting its head, the clip's levers hanging out and down to the side
    const EAR = { x: 13, y: -COLLAR.r - 8, z: COLLAR.z0 + 30 };
    const screw = new THREE.Group(); head.add(screw);
    screw.position.set(EAR.x, EAR.y, EAR.z);
    { const g = new THREE.CylinderGeometry(5.5, 5.5, 5.5, 20); g.rotateZ(Math.PI / 2); solid(g, M.dark, screw, 2.75, 0, 0); }   // the socket head
    { const hex = []; for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI * 2; hex.push(new THREE.Vector3(5.6, 2.6 * Math.cos(a), 2.6 * Math.sin(a))); }
      screw.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hex), M.alu.l)); }   // its hex socket
    const SCREW_HEAD = new THREE.Vector3(EAR.x + 3, EAR.y, EAR.z);
    const clip = new THREE.Group(); head.add(clip);
    const tilt = 0.45, dir = new THREE.Vector3(Math.cos(tilt), 0, -Math.sin(tilt));
    clip.position.copy(SCREW_HEAD).addScaledVector(dir, 13);    // the jaw tips (clip x -13: the jaws run -13 to 33 from the pin at 14) on the screw head
    clip.rotation.set(0, tilt, 0);
    // two stampings on a pin at x 14: the tips meet on the lip, the levers spread behind the spring
    const jaw = (dz, tilt) => {
      const j = new THREE.Group(); j.position.set(14, 0, dz); j.rotation.y = tilt; clip.add(j);
      box(46, 8, 2.4, M.copper, j, -4, 0, 0);
      box(4, 9.4, 4, M.copper, j, 16, 0, dz > 0 ? 2 : -2);          // the lever's rolled end
      for (let k = 0; k < 5; k++) box(1.6, 8, 1.6, M.copper, j, -25 + k * 3.6, 0, dz > 0 ? -1.8 : 1.8);   // teeth
      return j;
    };
    jaw(4.4, -0.11); jaw(-4.4, 0.11);
    solid(new THREE.CylinderGeometry(3.4, 3.4, 12, 12), M.copper, clip, 14, 0, 0);   // spring on its pin
    const clipEnd = new THREE.Vector3(32, 0, -4);                  // the lead leaves the lower lever

    // the clip's lead, coiled, drops to the board and runs off right toward the controller;
    // rebuilt in set() because it hangs from the moving head down to the still board
    let clipLead = null;
    function hangLead() {
      if (clipLead) { group.remove(clipLead); clipLead.traverse(o => o.geometry && o.geometry.dispose()); }
      group.updateMatrixWorld(true);
      const a = clip.localToWorld(clipEnd.clone());
      const pts = [[a.x, a.y, a.z], [a.x + 8, a.y - 4, a.z * 0.55], [a.x + 16, a.y - 10, 8]];
      const c0 = new THREE.Vector3(a.x + 26, a.y - 16, 7);            // a coil lying on the board
      for (let i = 0; i <= 64; i++) { const t = i / 64, an = t * Math.PI * 2 * 7; pts.push([c0.x + t * 110 + 6 * Math.sin(an), c0.y - t * 30, c0.z + 6 * Math.cos(an)]); }
      pts.push([c0.x + 150, c0.y - 40, 3], [c0.x + 230, c0.y - 60, 2]);
      const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
      clipLead = solid(new THREE.TubeGeometry(curve, 400, 1.6, 6), M.lead, group);
    }

    // ---- the plate and its thin lead
    const plate = new THREE.Group(); group.add(plate);
    box(PLATE.x, PLATE.y, PLATE.t, M.plate, plate, -PLATE.x / 2 + 30, 0, PLATE.t / 2);
    cyl(3, PLATE.t, PLATE.t + 3, M.plate, plate, 10).position.set(-PLATE.x + 42, 0, PLATE.t + 1.5);   // the screw holding its lead
    tube([[-PLATE.x + 42, 0, PLATE.t + 3], [-PLATE.x + 30, -8, 4], [-PLATE.x + 15, -30, 1.2], [-PLATE.x - 5, -60, 1.2], [-PLATE.x + 5, -100, 1.2]], 1, M.lead, plate);

    const POSE = {
      flat: { p: [0, 0, 0], r: [0, 0, -0.25] },
      test: { p: [-4, 0, 0], r: [0, -0.5, -0.25] },              // held up, its end against the bit
      away: { p: [0, -150, 0], r: [0, 0, -0.25] }
    };
    function set({ bitZ = 25, plate: pose = 'flat' } = {}) {
      head.position.set(0, 0, bitZ);
      const P = POSE[pose] || POSE.flat;
      plate.position.set(...P.p); plate.rotation.set(...P.r);
      if (pose === 'test') plate.position.z = bitZ - PLATE.t;    // held up so its top meets the bit's tip
      hangLead();
    }
    set();

    function anchors() {
      group.updateMatrixWorld(true);
      const w = (o, v) => o.localToWorld(v.clone());
      return {
        bit: w(head, new THREE.Vector3(0, 0, 14)),
        collar: w(head, new THREE.Vector3(-COLLAR.r * 0.7, -COLLAR.r * 0.7, (COLLAR.z0 + COLLAR.z1) / 2)),
        clip: w(clip, new THREE.Vector3(14, 0, 0)),
        screw: w(head, SCREW_HEAD),
        plate: w(plate, new THREE.Vector3(-PLATE.x / 2, 0, PLATE.t)),
        plateLead: w(plate, new THREE.Vector3(-PLATE.x - 60, 52, 3))
      };
    }
    function reskin(colors = {}) {
      for (const [k, v] of Object.entries(colors)) if (M[k]) { M[k].f.color.set(v[0]); M[k].l.color.set(v[1]); }
    }
    return { group, set, anchors, reskin, COLLAR, PLATE };
  }

  const api = { build, COLLAR, PLATE, BOARD };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SwarfPlateModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
