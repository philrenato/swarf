/*
 * swarf MR-1 model — Langmuir's MR-1 as a ghost, for SIMULATE (Phil 10-28: "the mr-1
 * machine is a stationary bed machine. It needs its own basic model to show ... the
 * axes in motion over a fixed bed where work happens"). From Langmuir's product
 * render (~/Documents/claude/swarf/reference_shopbot_photos/MR-1_reference.png):
 * a black splayed-leg stand, a blue-grey slotted table, two black side rails with
 * silver rods running front to back, a gantry beam riding them in Y, the carriage
 * crossing it in X, and the tall black "MR-1" column carrying the spindle in Z.
 * Work envelope 22.8 × 21.8 × 6 in (579 × 554 × 152 mm).
 *
 * Frame: z up, mm, the table's top at z 0, the work envelope centred on x 0, y 0
 * (as cam's platform is), so set(x, y, z) takes the bit's own position.
 *
 *   const m = SwarfMR1Model.build(THREE)
 *   m.root      the whole machine; the table and rails stay, the rest moves
 *   m.set(x, y, z)  the gantry to y, the carriage to x, the spindle to z
 */
(function (root) {
  'use strict';
  const ENV = { x: 579, y: 554, z: 152 };
  const RAIL_X = ENV.x / 2 + 110;          // the side rails' centre lines
  const BEAM_Y = 135;                      // the beam stands behind the bit
  const TABLE = { x: 900, y: 820 };

  function build(THREE) {
    const mat = (c, o, e, eo) => {
      const f = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
      const l = new THREE.LineBasicMaterial({ color: e, transparent: true, opacity: eo });
      f.fog = l.fog = false;
      return { f, l, base: { o, eo } };
    };
    const M = {
      black: mat(0x1a1a1e, 0.16, 0x9a9aa4, 0.40),     // the powder-coated stand, rails, beam and column
      table: mat(0x6f8a94, 0.14, 0xa8c4cc, 0.36),     // the slotted table
      rod: mat(0xd8dce2, 0.20, 0xe8ecf0, 0.44),       // the linear rods
      orange: mat(0xff6a1a, 0.30, 0xff8a40, 0.60),    // the end blocks
      spindle: mat(0x3a3a40, 0.18, 0xb0b0ba, 0.40),
      cable: mat(0x111111, 0.1, 0x6a6a72, 0.34)
    };
    const solid = (g, m, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Group();
      o.add(new THREE.Mesh(g, m.f), new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), m.l));
      o.position.set(x, y, z); parent.add(o); return o;
    };
    const box = (x0, x1, y0, y1, z0, z1, m, parent) =>
      solid(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m, parent, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    // a cylinder along an axis ('x', 'y' or 'z'), centred at (x, y, z)
    const rod = (r, len, axis, m, parent, x, y, z, seg = 12) => {
      const g = new THREE.CylinderGeometry(r, r, len, seg);
      if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
      return solid(g, m, parent, x, y, z);
    };

    const machine = new THREE.Group();
    // ---- the stand and the table: they never move
    box(-TABLE.x / 2, TABLE.x / 2, -TABLE.y / 2, TABLE.y / 2, -22, 0, M.table, machine);
    // the table's T-slots, as lines along X
    const slots = [];
    for (let i = -3; i <= 3; i++) { const y = i * 90; slots.push(new THREE.Vector3(-ENV.x / 2 - 40, y, 0.5), new THREE.Vector3(ENV.x / 2 + 40, y, 0.5)); }
    machine.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(slots), M.table.l));
    box(-TABLE.x / 2 - 20, TABLE.x / 2 + 20, -TABLE.y / 2 - 20, TABLE.y / 2 + 20, -90, -22, M.black, machine);   // the top's skirt
    // four legs, splayed outward as they go down
    const leg = new THREE.BoxGeometry(70, 70, 820);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const o = solid(leg, M.black, machine, sx * (TABLE.x / 2 - 40), sy * (TABLE.y / 2 - 40), -90 - 400);
      o.rotation.set(sy * 0.07, -sx * 0.07, 0);
    }
    // ---- the side rails, front to back, a silver rod along each inner top edge
    for (const sx of [-1, 1]) {
      const x = sx * RAIL_X;
      box(x - 45, x + 45, -TABLE.y / 2 + 20, TABLE.y / 2 - 20, 0, 95, M.black, machine);
      rod(11, TABLE.y - 60, 'y', M.rod, machine, x - sx * 32, 0, 106);
      // the round boss on each end cap
      rod(24, 30, 'y', M.black, machine, x, -TABLE.y / 2 + 10, 70, 16);
      rod(24, 30, 'y', M.black, machine, x, TABLE.y / 2 - 10, 70, 16);
    }

    // ---- the gantry, riding the rails in Y
    const gantry = new THREE.Group(); machine.add(gantry);
    for (const sx of [-1, 1]) {
      const x = sx * RAIL_X;
      box(x - 55, x + 55, BEAM_Y - 70, BEAM_Y + 70, 95, 300, M.black, gantry);           // the trucks and uprights
      box(x - sx * 55 - 14, x - sx * 55 + 14, BEAM_Y - 82, BEAM_Y - 60, 118, 146, M.orange, gantry);   // the orange end blocks
    }
    box(-RAIL_X - 55, RAIL_X + 55, BEAM_Y - 55, BEAM_Y + 55, 210, 340, M.black, gantry);  // the beam
    rod(10, 2 * RAIL_X, 'x', M.rod, gantry, 0, BEAM_Y - 62, 330);                         // its rods
    rod(10, 2 * RAIL_X, 'x', M.rod, gantry, 0, BEAM_Y - 62, 222);

    // ---- the carriage, crossing the beam in X
    const carriage = new THREE.Group(); gantry.add(carriage);
    box(-80, 80, BEAM_Y - 80, BEAM_Y - 62, 190, 360, M.black, carriage);

    // ---- the column and spindle, riding the carriage in Z; the head's origin is the bit's tip
    const head = new THREE.Group(); carriage.add(head);
    box(-65, 65, -55, 55, 150, 540, M.black, head);                 // the "MR-1" column
    rod(34, 100, 'z', M.spindle, head, 0, 0, 100, 20);              // the spindle, round
    rod(14, 26, 'z', M.rod, head, 0, 0, 37, 12);                    // its collet nut
    rod(3, 24, 'z', M.rod, head, 0, 0, 12, 6);                      // the bit
    // the cables, up out of the column's top toward the ceiling boom
    const cable = [];
    for (const dx of [-30, 0, 30]) cable.push(new THREE.Vector3(dx, 20, 540), new THREE.Vector3(dx * 1.6, 160, 1150));
    head.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cable), M.cable.l));
    // the name on the column's front face
    try {
      const c = document.createElement('canvas'); c.width = 256; c.height = 512;
      const g = c.getContext('2d');
      g.translate(128, 256); g.rotate(-Math.PI / 2);
      g.font = '500 110px system-ui, "Helvetica Neue", Arial, sans-serif';   // plain words, not the maker's logo g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('MR-1', 0, 0);
      const name = new THREE.Mesh(new THREE.PlaneGeometry(60, 120), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
      name.material.fog = false;
      name.rotation.x = Math.PI / 2;                    // on the -y (front) face, upright
      name.position.set(0, -56, 420);
      head.add(name);
    } catch (e) { /* no canvas */ }

    function set(x, y, z) {
      gantry.position.set(0, y, 0);
      carriage.position.set(x, 0, 0);
      head.position.set(0, 0, z);
    }
    // skins (swarf-skin.js): the same fill and edge alpha scales the ShopBot model reads
    function recolor() {
      const S = window.SwarfSkin;
      const fa = S ? S.number('m-fill-a', 1) : 1, ea = S ? S.number('m-edge-a', 1) : 1;
      for (const k in M) { M[k].f.opacity = Math.min(1, M[k].base.o * fa); M[k].l.opacity = Math.min(1, M[k].base.eo * ea); }
    }
    recolor();
    window.addEventListener('swarf.skin', recolor);
    set(0, 0, 50);
    return { root: machine, gantry, carriage, head, set, recolor, ENV };
  }

  root.SwarfMR1Model = { build, ENV };
})(window);
