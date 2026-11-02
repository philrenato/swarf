/*
 * swarf board — what DRAW (swarf-draw.js) and TEX (swarf-tex.js) share: the bed seen from above
 * (code review r093 D1: TEX's board was a copy of DRAW's).
 *
 * Plain functions, each taking the mode's own state S ({ bed: [w, d], k, ox, oy, whole }) and its
 * board's <svg> where they need them: the view (fit, wheel, toMM), the ground under the parts
 * (bed, grid, bed size, origin, scale bar), a turn read off cam's widget.rotate, the wiring poll,
 * and the small helpers both files used (api, $, esc, r3, clone, a closed curve, even-odd inside,
 * a curve as a polyline). What each mode does with them (its tools, keys, card, marks, parts)
 * stays in its own file.
 *
 * Loaded before swarf-draw.js and swarf-tex.js (index.html).
 */
(function () {
  'use strict';
  const api = () => window.kiri && window.kiri.api;
  const V = () => window.SwarfVector;
  const $ = id => document.getElementById(id);
  // a typed length is held to a thousandth of a mm; a field refuses one that rounds under its floor (torture test 10-29: 0.0004 became 0)
  const r3 = v => +(+v).toFixed(3);
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inch = () => !!(window.SwarfLength && window.SwarfLength.unit() === 'in');
  const say = v => (window.SwarfLength ? window.SwarfLength.say(v) : `${+(+v).toFixed(2)} mm`);

  // ── curves ──
  const isClosed = crv => { const P = crv.ctrlPts, a = P[0], b = P[P.length - 1]; return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6; };
  // even-odd: p inside the loop L ([[x, y]…])
  const inLoop = (p, L) => { let n = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) if ((L[i][1] > p[1]) !== (L[j][1] > p[1]) && p[0] < (L[j][0] - L[i][0]) * (p[1] - L[i][1]) / (L[j][1] - L[i][1]) + L[i][0]) n = !n; return n; };
  // a curve as a polyline: a point about every step mm along each Bézier piece, 4 to cap of them
  function flat(crv, step, cap) {
    const L = [];
    for (const b of V().cubics(crv)) {
      const est = Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) + Math.hypot(b[2][0] - b[1][0], b[2][1] - b[1][1]) + Math.hypot(b[3][0] - b[2][0], b[3][1] - b[2][1]);
      const n = Math.max(4, Math.min(cap, Math.ceil(est / step)));
      for (let i = L.length ? 1 : 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        L.push([u * u * u * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t * t * t * b[3][0],
                u * u * u * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t * t * t * b[3][1]]);
      }
    }
    return L;
  }

  // ── view: mm on the bed to px on the board ──
  // frame the box b ([x0, y0, x1, y1] on the bed; null: the whole bed), the card's room (right px,
  // on a board wider than 900 px) kept clear
  function view(S, svg, b, right, whole) {
    const r = svg.getBoundingClientRect();
    const W = r.width || window.innerWidth, H = r.height || window.innerHeight;
    const [bw, bd] = S.bed;
    if (!b) b = [-bw / 2, -bd / 2, bw / 2, bd / 2];
    const left = 16, top = 76, bottom = 50;
    if (!(W > 900)) right = 16;
    S.k = Math.max(0.02, Math.min((W - left - right) / (b[2] - b[0]), (H - top - bottom) / (b[3] - b[1])));
    S.ox = left + (W - left - right) / 2 - (b[0] + b[2]) / 2 * S.k;
    S.oy = top + (H - top - bottom) / 2 + (b[1] + b[3]) / 2 * S.k;
    S.whole = !!whole;
  }
  function toMM(S, svg, e) { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left - S.ox) / S.k, -(e.clientY - r.top - S.oy) / S.k]; }
  // the wheel: pinch or ⌘-wheel zooms about the cursor, two fingers slide (the caller redraws)
  function wheel(S, svg, e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = svg.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.01), k = Math.max(0.05, Math.min(200, S.k * f));
      S.ox = px - (px - S.ox) * k / S.k; S.oy = py - (py - S.oy) * k / S.k; S.k = k;
    } else { S.ox -= e.deltaX; S.oy -= e.deltaY; }
  }

  // the ground under the parts, as SVG strings: the bed and a 10 mm / 100 mm grid (big: the 100 mm
  // lines over the 10 mm ones too), and (review 10-28: "no bed, origin, scale or units") the bed's
  // size in its corner, the origin, and a scale bar of a round length about 100 px long
  function ground(S, svg, big) {
    const k = S.k, [bw, bd] = S.bed, out = [];
    const sx = x => S.ox + x * k, sy = y => S.oy - y * k;
    out.push(`<rect class="sd-bed" x="${sx(-bw / 2)}" y="${sy(bd / 2)}" width="${bw * k}" height="${bd * k}"/>`);
    const step = k * 10 > 6 ? 10 : 100;
    let g = '';
    for (let x = Math.ceil(-bw / 2 / step) * step; x <= bw / 2; x += step) g += `M${sx(x)},${sy(-bd / 2)}V${sy(bd / 2)}`;
    for (let y = Math.ceil(-bd / 2 / step) * step; y <= bd / 2; y += step) g += `M${sx(-bw / 2)},${sy(y)}H${sx(bw / 2)}`;
    out.push(`<path class="sd-grid${step === 100 ? ' big' : ''}" d="${g}"/>`);
    if (big && step === 10) {
      let G = '';
      for (let x = Math.ceil(-bw / 200) * 100; x <= bw / 2; x += 100) G += `M${sx(x)},${sy(-bd / 2)}V${sy(bd / 2)}`;
      for (let y = Math.ceil(-bd / 200) * 100; y <= bd / 2; y += 100) G += `M${sx(-bw / 2)},${sy(y)}H${sx(bw / 2)}`;
      out.push(`<path class="sd-grid big" d="${G}"/>`);
    }
    out.push(`<text class="sd-lab" x="${sx(-bw / 2) + 6}" y="${sy(bd / 2) + 14}">bed ${inch() ? `${+(bw / 25.4).toFixed(1)} × ${+(bd / 25.4).toFixed(1)} in` : `${Math.round(bw)} × ${Math.round(bd)} mm`}</text>`);
    out.push(`<path class="sd-origin" d="M${sx(0) - 8},${sy(0)}H${sx(0) + 8}M${sx(0)},${sy(0) - 8}V${sy(0) + 8}"/><text class="sd-lab" x="${sx(0) + 6}" y="${sy(0) + 14}">0, 0</text>`);
    {
      const r = svg.getBoundingClientRect(), want = 100 / k;
      // the scale bar in the units the switch says: round inches (1/8 in to 4 ft) or round mm
      const ins = inch();
      const len = ins ? 25.4 * ([0.125, 0.25, 0.5, 1, 2, 3, 6, 12, 24, 48].find(v => v * 25.4 >= want * 0.6) || 48)
        : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(v => v >= want * 0.6) || 2000;
      const x = 20, y = (r.height || window.innerHeight) - 46;
      out.push(`<path class="sd-scale" d="M${x},${y - 4}V${y}H${x + len * k}V${y - 4}"/><text class="sd-lab" x="${x}" y="${y - 8}">${ins ? say(len) : len >= 1000 ? len / 1000 + ' m' : len + ' mm'}</text>`);
    }
    return out;
  }

  // ── cam's widget.rotate as a 2D turn about Z: [c, −s, s, c], or null when the part tilts ──
  // (a quaternion from lay flat or the face tool turns about Z only if its x, y are nil)
  function rotationOf({ x, y, z }) {
    let t;
    if (typeof x !== 'number') {
      const q = x || {};
      if (Math.abs(q.x || 0) > 1e-9 || Math.abs(q.y || 0) > 1e-9) return null;
      t = 2 * Math.atan2(q.z || 0, q.w ?? 1);
    } else {
      if (Math.abs(x || 0) > 1e-9 || Math.abs(y || 0) > 1e-9) return null;
      t = z || 0;
    }
    return [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)];
  }

  // ── a turn in 3D, followed (Phil 11-02: a board flipped over X and then Y lies flat again, and TEX
  // still called it tipped over): each part keeps its whole rotation (meta.rq, a quaternion) and the one
  // it had when it last lay flat (meta.rflat). A turn that leaves it flat, top up or upside down, is a
  // 2D change since then, M (a turn, or a mirror when it is upside down); one that leaves it on its side
  // is { M: null }. Read once per event: DRAW and TEX both ask. ──
  const turns = new WeakMap();
  function turnOf(ev) {
    if (turns.has(ev)) return turns.get(ev);
    const THREE = window.THREE, w = ev.widget;
    const q = typeof ev.x === 'number' || ev.x == null
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(ev.x || 0, ev.y || 0, ev.z || 0))
      : new THREE.Quaternion(ev.x.x || 0, ev.x.y || 0, ev.x.z || 0, ev.x.w ?? 1);
    const lead = (w.group && w.group[0]) || w, m0 = lead.meta || {};
    const R = new THREE.Quaternion(...(m0.rq || [0, 0, 0, 1])).premultiply(q).normalize();
    const was = new THREE.Quaternion(...(m0.rflat || [0, 0, 0, 1]));
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(R), flat = Math.abs(up.z) > 1 - 1e-6;
    const tidy = v => (Math.abs(v) < 1e-9 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-9 ? Math.sign(v) : v);
    const two = Q => { const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(Q), ey = new THREE.Vector3(0, 1, 0).applyQuaternion(Q); return [ex.x, ey.x, ex.y, ey.y]; };
    let M = null;
    if (flat) {
      // since it last lay flat: A·Bᵀ (B is orthogonal)
      const A = two(R), B = two(was);
      M = [A[0] * B[0] + A[1] * B[1], A[0] * B[2] + A[1] * B[3], A[2] * B[0] + A[3] * B[1], A[2] * B[2] + A[3] * B[3]].map(tidy);
    }
    const back = flat && !!m0.tilted;
    for (const g of (w.group && w.group.length ? w.group : [w])) {
      if (!g.meta) continue;
      g.meta.rq = R.toArray();
      if (flat) { g.meta.rflat = R.toArray(); delete g.meta.tilted; } else g.meta.tilted = true;
    }
    const out = { M, flat, back, prev: m0.rq || [0, 0, 0, 1], rq: R.toArray() };
    turns.set(ev, out);
    return out;
  }

  // the part's own direction now on top (its body frame), for a rotation rq: Rᵀ·ẑ
  function bodyUp(rq) { const THREE = window.THREE; return new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...(rq || [0, 0, 0, 1])).invert()); }
  // a 3D turn seen from above: where it sends x and y, as [a, b, c, d]
  function twoOf(rq) { const THREE = window.THREE, Q = new THREE.Quaternion(...(rq || [0, 0, 0, 1])), ex = new THREE.Vector3(1, 0, 0).applyQuaternion(Q), ey = new THREE.Vector3(0, 1, 0).applyQuaternion(Q); return [ex.x, ey.x, ex.y, ey.y]; }
  // the turn from rotation `from` to rotation `to` (to·from⁻¹)
  function between(from, to) { const THREE = window.THREE; return new THREE.Quaternion(...(to || [0, 0, 0, 1])).multiply(new THREE.Quaternion(...(from || [0, 0, 0, 1])).invert()).toArray(); }

  // ── wiring: once cam's api and the mode's step button are there (30 s at most), fn(api, step) ──
  function wire(stepId, fn) {
    let tries = 0;
    const t = setInterval(() => {
      const a = api(), step = $(stepId);
      if ((a && a.event && step) || ++tries > 200) {
        clearInterval(t);
        if (!a || !a.event) return;
        fn(a, step);
      }
    }, 150);
  }

  // cam's own letter keys listen for keypress (r opened recent files, e the machine dialog): none of
  // them reach cam while a board is open; a prompt's Enter still lands (review r093 A3)
  const hush = e => { if (!/^(INPUT|SELECT|TEXTAREA)$/.test(e.target && e.target.tagName)) e.stopPropagation(); };

  window.SwarfBoard = { api, V, $, r3, clone, esc, isClosed, inLoop, flat, view, toMM, wheel, ground, rotationOf, turnOf, bodyUp, twoOf, between, wire, hush };
})();
