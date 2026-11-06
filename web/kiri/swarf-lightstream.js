/**
 * swarf lightstream — the simulate trail: three overlaid flat ribbons (core / halo / bloom) along
 * the path the bit has cut, driven from the swarf.tool.move events the animators emit (non-indexed
 * CAM, swarf's mill mode, runs anim-2d.js, which has no path tracer of its own; Kiri's lineTracker
 * lives only in anim-3d.js, for indexed lathe ops).
 *
 *   - every tool-tip position appends to a growing polyline; a rapid or a lift breaks it
 *   - the trail is clipped to the board's top: above it the bit is in the air
 *   - each step's polylines can be hidden by its box in the toolpaths view's row
 *   - cleared on 'animate' / 'function.animate' / 'swarf.clear'; toolpaths fill it from the print stack
 */
(function () {
  'use strict';
  if (window.__swarfLightstreamLoaded) return;
  window.__swarfLightstreamLoaded = true;

  // ---- ribbon -----------------------------------------------------------
  let core = null, halo = null, bloom = null;
  let polylines = [[]], lastPos = null;
  let space = null;

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

  // The ribbons are drawn incrementally, so a texture's tens of thousands of moves stay cheap (review
  // r093-code A13). Each ribbon keeps one Float32Array, doubled when full; a move appends its new
  // segments (18 floats a ribbon), uploads only that range and moves the draw range to the end. The
  // whole trail is drawn again only where what is drawn changes behind the end: a step's box, the
  // print stack's fill at toolpaths.
  const CAP0 = 18 * 1024;       // floats a ribbon starts with (1024 segments)
  let ribbons = [];             // [{ obj, hw, uv }] bloom, halo, core, look
  // the skin's own look (Phil 11-02: "lightstreams in wet plastic should look like glass … in classic
  // a little like barber poles"): one more ribbon, drawn by a shader from where it is along the path
  // (s, mm) and across it (t, -1..1); swarf keeps its glowing light
  let look = null, sAcc = 0;
  const LOOK_WIDTH_MM = 1.8;
  let cap = 0;                  // floats each ribbon's array holds
  let drawn = 0;                // floats of it drawn
  let synced = true;            // what is drawn is the polylines' segments (a rebuild with none to draw keeps the last drawing)

  // one ribbon: a mesh of quads, one per segment (putSeg), additive so the centerline is brightest
  function buildRibbon(color, opacity, renderOrder) {
    const THREE = window.THREE;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const obj = new THREE.Mesh(newGeometry(new Float32Array(cap)), mat);
    obj.renderOrder = renderOrder;
    obj.frustumCulled = false;
    return obj;
  }
  // GLASS: a clear tube, its rims darker (seen edge-on), a white streak where the light catches it.
  // POLE: red, white and blue bands turning round it, shaded as a round rod
  function buildLook() {
    const THREE = window.THREE;
    const mat = new THREE.ShaderMaterial({
      uniforms: { mode: { value: 0 }, pitch: { value: 4.5 }, tint: { value: new THREE.Color(0xcfe3ea) }, rim: { value: new THREE.Color(0x4f5f68) } },
      vertexShader: 'attribute vec2 st; varying vec2 vSt; void main() { vSt = st; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform float mode; uniform float pitch; uniform vec3 tint; uniform vec3 rim; varying vec2 vSt;',
        'void main() {',
        '  float t = clamp(vSt.y, -1.0, 1.0), n = sqrt(max(0.0, 1.0 - t * t));',
        '  if (mode < 0.5) {',
        '    float edge = pow(1.0 - n, 2.0), streak = smoothstep(0.16, 0.0, abs(t + 0.42)) * 0.9 + smoothstep(0.1, 0.0, abs(t - 0.55)) * 0.35;',
        '    vec3 c = mix(mix(tint, rim, edge), vec3(1.0), streak);',
        // nearly opaque: the joins of a translucent ribbon double up into speckle; the glass is in the rims and streak
        '    gl_FragColor = vec4(c, min(1.0, 0.82 + 0.18 * edge + 0.3 * streak));',
        '  } else {',
        '    float band = fract(vSt.x / pitch + t * 0.9 / pitch);',
        '    vec3 c = band < 0.34 ? vec3(0.80, 0.10, 0.12) : band < 0.5 ? vec3(0.97) : band < 0.84 ? vec3(0.13, 0.27, 0.62) : vec3(0.97);',
        '    c *= 0.55 + 0.45 * n; c += vec3(0.35) * smoothstep(0.18, 0.0, abs(t + 0.4));',
        '    gl_FragColor = vec4(c, 1.0);',
        '  }',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    const obj = new THREE.Mesh(newGeometry(new Float32Array(cap), true), mat);
    obj.renderOrder = 1000;
    obj.frustumCulled = false;
    obj.visible = false;
    return obj;
  }
  function newGeometry(arr, uv, st) {
    const THREE = window.THREE, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    if (uv) geo.setAttribute('st', new THREE.BufferAttribute(st || new Float32Array(arr.length / 3 * 2), 2).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, drawn / 3);
    return geo;
  }
  // every ribbon's array at size floats, what is drawn carried over; the old geometry is disposed
  function resize(size) {
    for (const r of ribbons) {
      const arr = new Float32Array(size), old = r.obj.geometry;
      arr.set(old.attributes.position.array.subarray(0, drawn));
      let st = null;
      if (r.uv) { st = new Float32Array(size / 3 * 2); st.set(old.attributes.st.array.subarray(0, drawn / 3 * 2)); }
      r.obj.geometry = newGeometry(arr, r.uv, st);
      old.dispose();
    }
    cap = size;
  }

  // One A→B segment's flat-ribbon quads, appended to every ribbon.
  // The lateral normal is perpendicular to the full 3D tangent: for
  // XY-dominant moves the ribbon lies flat; for vertical (Z-dominant)
  // moves the ribbon stands upright so plunges and contour side-passes
  // are visible.
  function putSeg(a, b) {
    const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
    const len3 = Math.hypot(tx, ty, tz);
    if (len3 < 1e-4) return;
    const lenXY = Math.hypot(tx, ty);
    let nx, ny, nz;
    if (lenXY > 1e-4) {
      // XY component exists: lateral = tangent × Z_up → (ty, -tx, 0)
      nx = ty / lenXY;
      ny = -tx / lenXY;
      nz = 0;
    } else {
      // pure vertical move: widen along X, so the ribbon stands upright
      nx = 1;
      ny = 0;
      nz = 0;
    }
    if (drawn + 18 > cap) resize(Math.max(cap * 2, drawn + 18));
    for (const r of ribbons) {
      const v = r.obj.geometry.attributes.position.array, hw = r.hw, o = drawn;
      const dx = nx * hw, dy = ny * hw, dz = nz * hw;
      const aLx = a.x - dx, aLy = a.y - dy, aLz = a.z - dz;
      const aRx = a.x + dx, aRy = a.y + dy, aRz = a.z + dz;
      const bLx = b.x - dx, bLy = b.y - dy, bLz = b.z - dz;
      const bRx = b.x + dx, bRy = b.y + dy, bRz = b.z + dz;
      // tri 1: aL, aR, bR
      v[o]      = aLx; v[o + 1]  = aLy; v[o + 2]  = aLz;
      v[o + 3]  = aRx; v[o + 4]  = aRy; v[o + 5]  = aRz;
      v[o + 6]  = bRx; v[o + 7]  = bRy; v[o + 8]  = bRz;
      // tri 2: aL, bR, bL
      v[o + 9]  = aLx; v[o + 10] = aLy; v[o + 11] = aLz;
      v[o + 12] = bRx; v[o + 13] = bRy; v[o + 14] = bRz;
      v[o + 15] = bLx; v[o + 16] = bLy; v[o + 17] = bLz;
      if (r.uv) {
        const w = r.obj.geometry.attributes.st.array, q = o / 3 * 2, sa = sAcc, sb = sAcc + len3;
        // aL aR bR · aL bR bL: along, across
        w[q] = sa; w[q + 1] = -1; w[q + 2] = sa; w[q + 3] = 1; w[q + 4] = sb; w[q + 5] = 1;
        w[q + 6] = sa; w[q + 7] = -1; w[q + 8] = sb; w[q + 9] = 1; w[q + 10] = sb; w[q + 11] = -1;
      }
    }
    sAcc += len3;
    drawn += 18;
  }
  // floats [from, drawn) are new: upload them, draw to the end
  function show(from) {
    for (const r of ribbons) {
      const geo = r.obj.geometry, attr = geo.attributes.position;
      if (drawn > from && attr.addUpdateRange) attr.addUpdateRange(from, drawn - from);
      attr.needsUpdate = true;
      const st = geo.attributes.st;
      if (st) { if (drawn > from && st.addUpdateRange) st.addUpdateRange(from / 3 * 2, (drawn - from) / 3 * 2); st.needsUpdate = true; }
      geo.setDrawRange(0, drawn / 3);
      geo.boundingSphere = null;
    }
  }

  function ensure() {
    if (core) return true;
    if (!window.THREE || !space || !space.world) return false;
    cap = CAP0; drawn = 0; synced = true;
    bloom = buildRibbon(BLOOM_COLOR, BLOOM_OPAC, 997);
    halo  = buildRibbon(HALO_COLOR,  HALO_OPAC,  998);
    core  = buildRibbon(CORE_COLOR,  CORE_OPAC,  999);
    look  = buildLook();
    ribbons = [{ obj: bloom, hw: BLOOM_WIDTH_MM / 2 }, { obj: halo, hw: HALO_WIDTH_MM / 2 }, { obj: core, hw: CORE_WIDTH_MM / 2 }, { obj: look, hw: LOOK_WIDTH_MM / 2, uv: true }];
    space.world.add(bloom);
    space.world.add(halo);
    space.world.add(core);
    space.world.add(look);
    reskin();
    return true;
  }

  // skins (swarf-skin.js): the trail's colors, and normal blending where the sky is pale
  // (additive light adds nothing to white)
  function reskin() {
    const S = window.SwarfSkin, THREE = window.THREE;
    if (!core || !THREE) return;
    const add = !S || S.number('trail-additive', 1) > 0.5;
    const set = (o, key, base) => {
      o.material.color.setHex(S ? S.color(key, base) : base);
      o.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
      o.material.needsUpdate = true;
    };
    set(bloom, 'trail-bloom', BLOOM_COLOR); set(halo, 'trail-halo', HALO_COLOR); set(core, 'trail-core', CORE_COLOR);
    // wet plastic: glass; classic: a barber pole; swarf: the light alone
    look.material.uniforms.mode.value = skinNow() === 'classic' ? 1 : 0;
    applyVisibility();
  }
  window.addEventListener('swarf.skin', reskin);

  function clearTrail() {
    polylines = [[]]; lastPos = null;
    window.__swarfLSMoves = 0;
    window.__swarfLSPoints = 0;
    if (!core) return;
    drawn = 0; sAcc = 0; synced = true;
    // a long run's arrays go back to the start size
    if (cap > CAP0) resize(CAP0);
    show(0);
  }

  // The whole trail again, from every polyline whose step's box is ticked.
  function rebuild() {
    if (!core) return;
    const was = drawn;
    drawn = 0; sAcc = 0;
    for (const pl of polylines) {
      if (pl.length < 2 || hidden.has(pl.step)) continue;
      for (let i = 0; i < pl.length - 1; i++) putSeg(pl[i], pl[i + 1]);
    }
    if (drawn === 0) {
      // every step's box unticked: the trail empties (it kept the last drawing before)
      if (hidden.size) { window.__swarfLSPoints = 0; synced = true; show(0); }
      else { drawn = was; synced = was === 0; }
      return;
    }
    synced = true;
    window.__swarfLSPoints = drawn / 3;
    show(0);
  }
  // after a move: the segments it added (polylines[from] had `had` points before it, the ones after
  // it are new), appended to what is drawn
  function extend(from, had) {
    if (!synced) { rebuild(); return; }
    const was = drawn;
    for (let k = from; k < polylines.length; k++) {
      const pl = polylines[k];
      if (hidden.has(pl.step)) continue;
      for (let i = k === from ? Math.max(0, had - 1) : 0; i < pl.length - 1; i++) putSeg(pl[i], pl[i + 1]);
    }
    if (drawn === was) return;
    window.__swarfLSPoints = drawn / 3;
    show(was);
  }

  // Extract segment pairs from a Three.js BufferGeometry. Handles both
  // regular LineSegments (paired vertices in position attribute) and
  // LineSegments2 / LineSegmentsGeometry (instanceStart / instanceEnd).
  function extractSegments(geom) {
    const out = [];
    if (!geom || !geom.attributes) return out;
    const a = geom.attributes.instanceStart;
    const b = geom.attributes.instanceEnd;
    if (a && b && a.array && b.array) {
      const aa = a.array, ba = b.array;
      const n = Math.min(aa.length, ba.length);
      for (let i = 0; i + 2 < n; i += 3) {
        out.push([
          { x: aa[i], y: aa[i+1], z: aa[i+2] },
          { x: ba[i], y: ba[i+1], z: ba[i+2] },
        ]);
      }
      return out;
    }
    const pos = geom.attributes.position;
    if (!pos || !pos.array) return out;
    const arr = pos.array;
    for (let i = 0; i + 5 < arr.length; i += 6) {
      out.push([
        { x: arr[i],   y: arr[i+1], z: arr[i+2] },
        { x: arr[i+3], y: arr[i+4], z: arr[i+5] },
      ]);
    }
    return out;
  }

  // the trail from the rendered print stack at preview.end, so the toolpaths view shows the cut
  // before any simulate (r15c); simulate clears it and draws from swarf.tool.move. Long segments
  // are dropped as rapids.
  function populateFromPrintStack() {
    if (!ensure()) return;
    const api = window.kiri && window.kiri.api;
    const stack = api && api.stacks && api.stacks.getStack && api.stacks.getStack('print');
    if (!stack || !stack.obj) { clearTrail(); return; }
    polylines = [[]];
    const top = boardTop();
    const meshes = stack.obj.meshes || [];
    let kept = 0;
    for (const m of meshes) {
      if (!m || !m.geometry) continue;
      for (const seg of extractSegments(m.geometry)) {
        const a = seg[0], b = seg[1];
        const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (d < 1e-4 || d > BREAK_3D_MM) continue;
        const c = clip(a, b, top);
        if (!c) continue;
        polylines.push(c);
        kept++;
      }
    }
    window.__swarfLSPrePop = kept;
    rebuild();
  }

  // The trail is where the bit cuts, not where it travels: above the board's top it is in the air
  // (lifts to clearance, hops between dots), and drawn there, a texture's thousands of lifts stood
  // as a gray fence over the part that read as material puffed out of it (Phil 11-01). Every
  // segment is clipped to just under the top (riding the top cuts nothing); what is wholly above it
  // is not drawn.
  function boardTop() {
    try {
      const st = window.kiri.api.conf.get().stock;
      if (st && st.z > 0) return (st.center && st.center.z != null ? st.center.z + st.z / 2 : st.z) - 0.02;
    } catch (e) { /* no stock yet */ }
    return Infinity;
  }
  const at = (a, b, z) => { const t = (z - a.z) / (b.z - a.z); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z }; };
  // a segment a→b clipped to z <= top, or null when it is all in the air
  function clip(a, b, top) {
    const ai = a.z <= top, bi = b.z <= top;
    if (ai && bi) return [a, b];
    if (!ai && !bi) return null;
    return ai ? [a, at(a, b, top)] : [at(a, b, top), b];
  }

  function onMove(evt) {
    window.__swarfLSMoves = (window.__swarfLSMoves || 0) + 1;
    // a move still on its way when simulate was left does not start a new trail
    const v = window.kiri?.api?.view;
    if (v?.is_animate && !v.is_animate()) return;
    if (!ensure()) return;
    const pos = (evt && evt.detail) ? evt.detail.pos : (evt && evt.pos);
    if (!pos) return;
    if (!polylines.length) polylines.push([]);
    const from = polylines.length - 1, had = polylines[from].length;
    const p = { x: pos.x, y: pos.y, z: pos.z }, top = boardTop(), prev = lastPos;
    lastPos = p;
    // a new step starts its own line (from where the last one ended), so its box hides only its own cut
    const step = evt.step;
    if (step != null) { addStepBox(step); const a = polylines[polylines.length - 1]; if (a.step !== step) { if (a.length > 1) polylines.push([a[a.length - 1]]); polylines[polylines.length - 1].step = step; } }
    const active = polylines[polylines.length - 1];
    if (prev) {
      const d3 = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      const c = d3 > BREAK_3D_MM ? null : clip(prev, p, top);
      if (!c) { if (active.length) newLine(step); return; }
      // into the board from the air: a new line from where it entered
      if (prev.z > top) { newLine(step).push(c[0]); }
      polylines[polylines.length - 1].push(c[1]);
      // out of the board: the line ends at the top
      if (p.z > top) newLine(step);
    } else if (p.z <= top) active.push(p);
    extend(from, had);
  }
  // for the probes: each step's drawn segments, and whether its box hides them
  // which look draws the trail now (probe_skin_trail.mjs)
  window.__swarfLSLook = () => ({ light: !!(core && core.visible), look: !!(look && look.visible), mode: look ? look.material.uniforms.mode.value : null });
  window.__swarfLSSteps = () => { const o = {}; for (const pl of polylines) { const k = String(pl.step); o[k] = o[k] || { segs: 0, hidden: hidden.has(pl.step) }; o[k].segs += Math.max(0, pl.length - 1); } return o; };
  function newLine(step) { const l = []; l.step = step; polylines.push(l); return l; }

  // ---- each step's paths on and off (Phil 11-01: "when simulate is done can we allow the visible
  // toolpaths to be turned on and off with checkboxes like toolpaths already does?") -------------
  // The boxes are Kiri's own layer toggles (api.uc.newBoolean in #layers, the toolpaths view's bit ·
  // direction · moves · cuts row), one per step named as the step list names it, raised above the
  // sim bar. They work while it plays too: a step's box appears when its cut begins. Every run
  // starts with all of them ticked, so a hidden step is never carried into the next simulate.
  const hidden = new Set();   // steps whose trail is off
  let boxes = {};             // step -> its checkbox
  function stepLabel(i) {
    let rec;
    try { rec = (window.kiri.api.conf.get().process.ops || [])[i]; } catch (e) { /* no settings */ }
    if (!rec || Array.isArray(rec)) return `step ${i + 1}`;
    // as init-ui.js opRender names the step: DRAW's engrave, TEX's mark, else its type (and #note)
    if (rec.engrave) return 'engrave';
    if (rec.type === 'texture' || rec.type === 'pierce' || rec.type === 'inlay') return String(rec.texlabel || rec.type).replace(/^(\w+): (.+?) on .*$/, '$1 · $2');
    const tag = rec.note ? rec.note.split(' ').find(v => v.charAt(0) === '#') : null;
    return (rec.mode ? rec.type + ' ' + rec.mode : rec.type) + (tag ? ` (${tag.slice(1)})` : '');
  }
  function addStepBox(step) {
    if (boxes[step] && boxes[step].isConnected) return;
    const api = window.kiri && window.kiri.api, uc = api && api.uc, row = document.getElementById('layers');
    if (!uc || !row) return;
    // two steps of one name are told apart by a number, as "outline 2"
    const base = stepLabel(step), used = new Set(Object.values(boxes).filter(b => b.isConnected).map(b => b.swarfLabel));
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
    const cp = uc.checkpoint();
    uc.setGroup(row);
    const box = uc.newBoolean(name, () => { if (box.checked) hidden.delete(step); else hidden.add(step); rebuild(); api.space && api.space.update && api.space.update(); }, { title: `show or hide the paths of the ${name} step` });
    uc.restore(cp);
    box.checked = !hidden.has(step);
    box.swarfLabel = name; box.dataset.step = String(step);
    box.parentNode.classList.add('swarf-sim-path');
    boxes[step] = box;
    showBoxes();
  }
  // the row shows in simulate, above its bar, while the trail is on (with it off there is nothing to toggle)
  function showBoxes() {
    const api = window.kiri && window.kiri.api, row = document.getElementById('layers'), bar = document.getElementById('layer-animate');
    if (!row) return;
    const anim = !!(api && api.view && api.view.is_animate && api.view.is_animate());
    const on = anim && window.__swarfLightstream !== false && !!row.querySelector('.swarf-sim-path');
    document.body.classList.toggle('swarf-sim-paths', on);
    if (bar && bar.offsetHeight) document.documentElement.style.setProperty('--swarf-simbar-h', bar.offsetHeight + 'px');
    if (on) row.style.display = 'flex';
    else if (anim) row.style.display = 'none';
  }
  // a new simulate (or leaving it) takes the boxes away and ticks every step again
  function dropBoxes() {
    hidden.clear(); boxes = {};
    for (const r of document.querySelectorAll('#layers .swarf-sim-path')) r.remove();
    showBoxes();
  }

  const skinNow = () => document.documentElement.getAttribute('data-skin') || 'swarf';
  function applyVisibility() {
    const on = window.__swarfLightstream !== false, styled = skinNow() === 'glass' || skinNow() === 'classic';
    if (core)  core.visible  = on && !styled;
    if (halo)  halo.visible  = on && !styled;
    if (bloom) bloom.visible = on && !styled;
    if (look)  look.visible  = on && styled;
  }

  function attach() {
    space = window.moto && window.moto.space;
    const api = window.kiri && window.kiri.api;
    if (!space || !space.world || !api || !api.event) return false;
    api.event.on('swarf.tool.move', ({ pos, step }) => onMove({ pos, step }));
    api.event.on('animate',          () => { ensure(); clearTrail(); applyVisibility(); });
    // every step has its box from the start, so a step can be hidden before it runs (review r093-ux B7)
    const allBoxes = () => { let ops = []; try { ops = window.kiri.api.conf.get().process.ops || []; } catch (e) { /* no settings */ }
      ops.forEach((o, i) => { if (o && !Array.isArray(o) && o.type !== '|' && !o.disabled) addStepBox(i); }); };
    api.event.on('function.animate', () => { ensure(); clearTrail(); applyVisibility(); dropBoxes(); setTimeout(allBoxes, 0); });
    api.event.on('view.set', () => { if (!(api.view.is_animate && api.view.is_animate())) dropBoxes(); });
    window.addEventListener('swarf.lightstream.toggle', showBoxes);
    window.addEventListener('resize', showBoxes);
    window.addEventListener('swarf.clear', clearTrail);
    // the sim bar's lightstreams pill
    window.addEventListener('swarf.lightstream.toggle', applyVisibility);
    // leaving simulate leaves no partial trail behind (r10-d, Phil: "one tiny weird stream")
    api.event.on('animate.end',   clearTrail);
    api.event.on('preview.begin', clearTrail);
    api.event.on('preview.end',   populateFromPrintStack);
    return true;
  }

  let tries = 0;
  const poll = setInterval(() => {
    if (attach() || ++tries > 200) clearInterval(poll);
  }, 100);
})();
