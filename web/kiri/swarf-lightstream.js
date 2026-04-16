/**
 * swarf lightstream — event-driven ribbon for the 2D CAM animator.
 *
 * Root cause established 2026-04-15 evening: non-indexed CAM (mill mode,
 * the default for swarf) runs anim-2d.js, which has NO built-in path
 * tracer. Kiri's lineTracker lives only in anim-3d.js and only runs for
 * indexed lathe ops. So the ribbon HAS to be driven from the swarf.tool.move
 * event stream that both animators emit.
 *
 * Design:
 *   - Listen to swarf.tool.move for every tool-tip position
 *   - Append to a growing polyline; break on rapid/retract jumps
 *   - Render as a bright additive red LineSegments (one mesh, one material)
 *   - Clear on 'animate' / 'function.animate' / 'swarf.clear'
 *
 * Kept simple: no fat lines, no halo, no scene walking. Just a line.
 */
(function () {
  'use strict';
  if (window.__swarfLightstreamLoaded) return;
  window.__swarfLightstreamLoaded = true;

  // ---- ribbon -----------------------------------------------------------
  // Three overlaid flat quads (core / halo / bloom). All additive-blended so
  // the falloff is additive: centerline is brightest, edges soften smoothly.
  let core = null, halo = null, bloom = null;
  let polylines = [[]];
  let space = null;
  let usingFat = false;

  const CORE_COLOR  = 0xff2a1a;
  const HALO_COLOR  = 0xff8060;
  const BLOOM_COLOR = 0xff6040;
  // Three stacked flat quads — each wider and fainter than the last — so the
  // ribbon has a soft falloff edge and a broader bloom around the core,
  // without raising the peak brightness at the centerline.
  const CORE_WIDTH_MM  = 0.4;   // tight bright centerline
  const HALO_WIDTH_MM  = 1.4;   // mid glow
  const BLOOM_WIDTH_MM = 4.2;   // wide diffuse bloom (soft edge)
  const CORE_OPAC  = 0.58;      // dialed further down — Phil: still a touch bright
  const HALO_OPAC  = 0.18;
  const BLOOM_OPAC = 0.06;

  // Only break the polyline on obvious rapids / retracts.
  // Use 3D distance so legitimate vertical plunges (contour side-passes)
  // don't get split — only true rapid repositioning breaks the line.
  const BREAK_3D_MM = 50;

  function haveFat() {
    return !!(window.__swarfLine
      && window.__swarfLine.LineSegments2
      && window.__swarfLine.LineSegmentsGeometry
      && window.__swarfLine.LineMaterial);
  }

  function buildFat(color, widthPX, opacity, renderOrder) {
    const { LineSegments2, LineSegmentsGeometry, LineMaterial } = window.__swarfLine;
    const geo = new LineSegmentsGeometry();
    const mat = new LineMaterial({
      color,
      linewidth: widthPX,
      transparent: true,
      opacity,
      worldUnits: false,
      blending: window.THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    mat.resolution.set(window.innerWidth, window.innerHeight);
    const obj = new LineSegments2(geo, mat);
    obj.renderOrder = renderOrder;
    obj.frustumCulled = false;
    return obj;
  }

  // Flat horizontal ribbon mesh: builds a quad strip per segment. Each quad
  // is widened along the in-plane normal (tangent × Z-up) so the ribbon
  // always lays flat on the XY plane, thin in Z — like tape along the path.
  function buildRibbon(color, opacity, renderOrder) {
    const THREE = window.THREE;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const obj = new THREE.Mesh(geo, mat);
    obj.renderOrder = renderOrder;
    obj.frustumCulled = false;
    return obj;
  }

  // Generate flat-ribbon quad vertices for every segment in polylines.
  // For each A→B segment: compute a lateral normal perpendicular to the
  // full 3D tangent. For XY-dominant moves the ribbon lies flat; for
  // vertical (Z-dominant) moves the ribbon stands upright so plunges
  // and contour side-passes are visible.
  function buildQuads(width) {
    const verts = [];
    const hw = width / 2;
    for (const pl of polylines) {
      if (pl.length < 2) continue;
      for (let i = 0; i < pl.length - 1; i++) {
        const a = pl[i], b = pl[i + 1];
        const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
        const len3 = Math.hypot(tx, ty, tz);
        if (len3 < 1e-4) continue;
        const lenXY = Math.hypot(tx, ty);
        let nx, ny, nz;
        if (lenXY > 1e-4) {
          // XY component exists: lateral = tangent × Z_up → (ty, -tx, 0)
          nx = ty / lenXY;
          ny = -tx / lenXY;
          nz = 0;
        } else {
          // pure vertical move: lateral = tangent × X_axis → (0, -tz, ty)
          // simplified for vertical: ribbon faces camera (use X lateral)
          nx = 1;
          ny = 0;
          nz = 0;
        }
        const dx = nx * hw, dy = ny * hw, dz = nz * hw;
        const aL = [a.x - dx, a.y - dy, a.z - dz];
        const aR = [a.x + dx, a.y + dy, a.z + dz];
        const bL = [b.x - dx, b.y - dy, b.z - dz];
        const bR = [b.x + dx, b.y + dy, b.z + dz];
        // tri 1: aL, aR, bR
        verts.push(aL[0], aL[1], aL[2],
                   aR[0], aR[1], aR[2],
                   bR[0], bR[1], bR[2]);
        // tri 2: aL, bR, bL
        verts.push(aL[0], aL[1], aL[2],
                   bR[0], bR[1], bR[2],
                   bL[0], bL[1], bL[2]);
      }
    }
    return verts;
  }

  function ensure() {
    if (core) return true;
    if (!window.THREE || !space || !space.world) return false;
    bloom = buildRibbon(BLOOM_COLOR, BLOOM_OPAC, 997);
    halo  = buildRibbon(HALO_COLOR,  HALO_OPAC,  998);
    core  = buildRibbon(CORE_COLOR,  CORE_OPAC,  999);
    space.world.add(bloom);
    space.world.add(halo);
    space.world.add(core);
    return true;
  }

  function clearTrail() {
    polylines = [[]];
    window.__swarfLSMoves = 0;
    window.__swarfLSPoints = 0;
    if (!core) return;
    const empty = new Float32Array(0);
    core.geometry.setAttribute('position',  new window.THREE.BufferAttribute(empty, 3));
    halo.geometry.setAttribute('position',  new window.THREE.BufferAttribute(empty, 3));
    bloom.geometry.setAttribute('position', new window.THREE.BufferAttribute(empty, 3));
  }

  function rebuild() {
    if (!core) return;
    const coreVerts  = buildQuads(CORE_WIDTH_MM);
    if (coreVerts.length === 0) return;
    const haloVerts  = buildQuads(HALO_WIDTH_MM);
    const bloomVerts = buildQuads(BLOOM_WIDTH_MM);
    const corePos  = Float32Array.from(coreVerts);
    const haloPos  = Float32Array.from(haloVerts);
    const bloomPos = Float32Array.from(bloomVerts);
    window.__swarfLSPoints = corePos.length / 3;
    core.geometry.setAttribute('position',  new window.THREE.BufferAttribute(corePos,  3));
    halo.geometry.setAttribute('position',  new window.THREE.BufferAttribute(haloPos,  3));
    bloom.geometry.setAttribute('position', new window.THREE.BufferAttribute(bloomPos, 3));
    core.geometry.attributes.position.needsUpdate  = true;
    halo.geometry.attributes.position.needsUpdate  = true;
    bloom.geometry.attributes.position.needsUpdate = true;
    core.geometry.computeBoundingSphere();
    halo.geometry.computeBoundingSphere();
    bloom.geometry.computeBoundingSphere();
  }

  function onMove(evt) {
    window.__swarfLSMoves = (window.__swarfLSMoves || 0) + 1;
    if (!ensure()) return;
    const pos = (evt && evt.detail) ? evt.detail.pos : (evt && evt.pos);
    if (!pos) return;
    if (!polylines.length) polylines.push([]);
    const active = polylines[polylines.length - 1];
    const last = active.length ? active[active.length - 1] : null;
    if (last) {
      const d3 = Math.hypot(pos.x - last.x, pos.y - last.y, pos.z - last.z);
      if (d3 > BREAK_3D_MM) polylines.push([]);
    }
    polylines[polylines.length - 1].push({ x: pos.x, y: pos.y, z: pos.z });
    rebuild();
  }

  function applyVisibility() {
    const on = window.__swarfLightstream !== false;
    if (core)  core.visible  = on;
    if (halo)  halo.visible  = on;
    if (bloom) bloom.visible = on;
  }

  function attach() {
    space = window.moto && window.moto.space;
    const api = window.kiri && window.kiri.api;
    if (!space || !space.world || !api || !api.event) return false;
    api.event.on('swarf.tool.move', ({ pos }) => onMove({ pos }));
    api.event.on('animate',          () => { ensure(); clearTrail(); applyVisibility(); });
    api.event.on('function.animate', () => { ensure(); clearTrail(); applyVisibility(); });
    window.addEventListener('swarf.clear', clearTrail);
    // Respond to the sim-bar's lightstream on/off pill.
    window.addEventListener('swarf.lightstream.toggle', applyVisibility);
    // swarf r10-d: clear any residual ribbon when the user leaves simulate —
    // otherwise a partial trail from a previous run paints as a tiny stray
    // stream in TOOLPATHS view (Phil markup: "one tiny weird stream").
    api.event.on('animate.end',   clearTrail);
    api.event.on('preview.begin', clearTrail);
    api.event.on('preview.end',   clearTrail);
    return true;
  }

  let tries = 0;
  const poll = setInterval(() => {
    if (attach() || ++tries > 200) clearInterval(poll);
  }, 100);
})();
