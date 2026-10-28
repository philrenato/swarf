/*
 * swarf lessons — test cuts for learning the ShopBot (Phil 10-28: "devise a couple of
 * test/training parts that have someone screwing say a piece of small plywood to the bed,
 * having them 0 off the front left corner and then tells you what bit they have and then
 * guide them through a test cut … have me measure the result"; then "allow user to tell
 * you how big the test board is").
 *
 * Two parts, both sized to the scrap the student has:
 *   1  the square and the circle: a groove 3 mm deep, a square and a circle inside it. The
 *      groove's outer and inner edges, measured across, average to the bit's own path, so
 *      the bit's width drops out: what is left is how true each axis runs.
 *   2  cut out a square: through the board with four tabs, the part to its drawn size.
 * The card sequence: the board (its size, screwed down), the bit, then control's own steps
 * (zero on the board's front-left corner, z plate, trace, cut), then measure.
 */
(function () {
  'use strict';
  const R = () => window.__swarfRun;
  const KEY = 'swarf-lesson-board', RESULTS = 'swarf-test-results';
  const BITS = [
    { id: 'e38', name: '3/8 in flat end mill', d: 9.525 },   // the shop's (Phil 10-28)
    { id: 'e14', name: '1/4 in flat end mill', d: 6.35 },
    { id: 'e6', name: '6 mm flat end mill', d: 6 },
    { id: 'e18', name: '1/8 in flat end mill', d: 3.175 },
    { id: 'e3', name: '3 mm flat end mill', d: 3 }
  ];
  const RPM = 16000;                       // the 7518's setting 3
  const SAFE = 25.4, MARGIN = 20;          // clear of the screws in the board's corners
  const LESSONS = [
    { id: 'square', name: 'the square and the circle', what: 'A groove 3 mm deep: a square with a circle inside it. Measured with calipers, it says how true each axis of the machine runs.' },
    { id: 'cutout', name: 'cut out a square', what: 'A square cut right through the board, held by four small tabs. It teaches a through cut and says how close a part comes to its drawn size.' }
  ];
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'text') e.textContent = tag === 'button' ? attrs[k] : tie(attrs[k]);
      else if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  };
  // no orphans: a sentence's last two words stay together (Phil 10-28)
  const tie = t => typeof t === 'string' && t.trim().split(/\s+/).length > 3 ? t.replace(/ (\S+)\s*$/, '\u00a0$1') : t;
  const num = (v, d) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : d; };
  const f3 = v => (Math.round(v * 1000) / 1000).toString();
  let L = null;   // the lesson in hand: { lesson, board, bit, size, depth, … }

  function board() { try { return JSON.parse(localStorage.getItem(KEY)) || { w: 200, d: 150, t: 12, bit: 'e38' }; } catch (e) { return { w: 200, d: 150, t: 12, bit: 'e38' }; } }
  const row = (...kids) => el('div', { class: 'row' }, ...kids);
  const btn = (text, fn, cls) => el('button', { text, class: cls || '', onclick: fn });
  const tick = text => { const c = el('input', { type: 'checkbox' }); return [c, el('label', {}, c, el('span', { text }))]; };

  // ---- 1: which test cut ----
  function choose() {
    const r = R(); if (!r) return;
    if (!r.state.open) r.open();
    r.card([el('h2', { text: 'A test cut' }),
      el('p', { text: 'Learn the machine on a scrap of plywood before your own part: screw it down, zero on its front-left corner, trace, cut, then measure what you made.' }),
      ...LESSONS.map(l => el('div', { class: 'sr-needrow' }, el('b', { text: l.id === 'square' ? '1' : '2' }),
        el('span', {}, el('strong', { text: l.name }), el('small', { text: l.what })), btn('choose', () => boardCard(l)))),
      row(btn('not now', () => r.card(null)))]);
  }

  // ---- 2: the board: its size, screwed down ----
  function boardCard(lesson) {
    const r = R(), b = board();
    const inp = (v, title) => el('input', { type: 'text', inputmode: 'decimal', value: String(v), title, style: 'width:72px;text-align:right' });
    const w = inp(b.w, 'left to right'), d = inp(b.d, 'front to back'), t = inp(b.t, 'thickness: measure it');
    for (const i of [w, d, t]) i.addEventListener('keydown', e => e.stopPropagation());
    const checks = [
      tick('the board lies flat, its front-left corner toward the table\'s front-left corner'),
      tick('four screws, one in each corner of the board, no more than 10 mm in from its edges'),
      tick('the screw heads sit below the top of the board')];
    const say = el('p', { class: 'sr-circuit' });
    const go = btn('next: the bit', () => {
      const W = num(w.value, 0), D = num(d.value, 0), T = num(t.value, 0);
      const min = lesson.id === 'square' ? 2 * MARGIN + 40 : 2 * MARGIN + 40;
      if (!(W >= min && D >= min)) { say.textContent = `The board needs to be at least ${min} × ${min} mm for this test.`; return; }
      if (!(T >= 3 && T <= 40)) { say.textContent = 'Measure the board\'s thickness with calipers: between 3 and 40 mm.'; return; }
      Object.assign(b, { w: W, d: D, t: T });
      try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) { /* private */ }
      bitCard(lesson, b);
    }, 'go');
    const update = () => { go.disabled = !checks.every(([c]) => c.checked); };
    checks.forEach(([c]) => c.addEventListener('change', update)); update();
    r.card([el('h2', { text: `Test cut: ${lesson.name}` }),
      el('p', { text: 'A scrap of plywood, 12 mm or so, about 200 × 150 mm (any size from 80 mm square up). How big is yours?' }),
      el('div', { class: 'sr-plate-t' }, el('span', { text: 'width' }), w, el('span', { text: '× depth' }), d, el('span', { text: '× thick' }), t, el('span', { text: 'mm' })),
      ...checks.map(c => c[1]), say,
      row(btn('back', choose), go)]);
  }

  // ---- 3: the bit ----
  function bitCard(lesson, b) {
    const r = R();
    let pick = BITS.find(x => x.id === b.bit) || BITS[0];
    const opts = BITS.map(x => { const o = el('label', {}, el('input', { type: 'radio', name: 'sr-lesson-bit' }), el('span', { text: x.name })); const i = o.querySelector('input'); i.checked = x === pick; i.addEventListener('change', () => { pick = x; }); return o; });
    r.card([el('h2', { text: 'Which bit is in the router?' }),
      el('p', { text: 'A flat end mill for these tests. Measure it if you are not sure: a 3/8 in bit reads 9.53 mm across, a 1/4 in 6.35 mm.' }),
      ...opts,
      el('p', { text: 'Set the router\'s dial to 3 (16,000 rpm). swarf only switches it on and off.' }),
      row(btn('back', () => boardCard(lesson)), btn('make the test cut', () => { b.bit = pick.id; try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) {} load(lesson, b, pick); }, 'go'))]);
  }

  // ---- the programs ----
  function feeds(bit) {
    // plywood, conservative: the student's first cut should sound easy
    return bit.d >= 9 ? { feed: 1500, plunge: 300, pass: 2.0 } : bit.d >= 6 ? { feed: 1500, plunge: 300, pass: 1.5 } : { feed: 900, plunge: 240, pass: 1.0 };
  }
  function sbp(name, bit, paths) {
    const fd = feeds(bit), out = [`'${name} - a swarf test cut`, "'UNITS:MM", 'IF %(25)=0 THEN GOTO UNIT_ERROR', 'SA',
      `&Tool =1   'Load ${bit.name}`, `TR,${RPM}`, `MS,${f3(fd.feed / 60)},${f3(fd.plunge / 60)}`, `JS,60,15`, `JZ,${SAFE}`];
    for (const p of paths) {
      out.push(`J2,${f3(p[0][0])},${f3(p[0][1])}`, `JZ,2`);
      for (const q of p) out.push(`M3,${f3(q[0])},${f3(q[1])},${f3(q[2])}`);
      out.push(`JZ,${SAFE}`);
    }
    out.push('J2,0,0', 'END', "'", 'UNIT_ERROR:', 'CN, 91', 'END');
    return out.join('\r\n');
  }
  const passes = (depth, pass) => { const n = Math.max(1, Math.ceil(depth / pass - 1e-9)), z = []; for (let i = 1; i <= n; i++) z.push(-depth * i / n); return z; };
  function lesson1(b, bit) {
    // the square: as big as the board allows (up to 100 mm), centred; the circle 60% of it
    const S = Math.floor(Math.min(100, Math.min(b.w, b.d) - 2 * MARGIN - bit.d) / 10) * 10;
    const C = Math.round(S * 0.6), cx = b.w / 2, cy = b.d / 2, depth = Math.min(3, b.t / 2);
    const zs = passes(depth, feeds(bit).pass);
    const sq = [], ci = [];
    for (const z of zs) {
      const x0 = cx - S / 2, y0 = cy - S / 2, x1 = cx + S / 2, y1 = cy + S / 2;
      sq.push([x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z], [x0, y0, z]);
    }
    const N = 180;
    for (const z of zs) for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 - (i / N) * 2 * Math.PI; ci.push([cx + C / 2 * Math.cos(a), cy + C / 2 * Math.sin(a), z]); }
    return { size: S, circle: C, depth, paths: [sq, ci], what: `a ${S} mm square and a ${C} mm circle, ${depth} mm deep` };
  }
  function lesson2(b, bit) {
    // the part to its drawn size: the bit's centre runs r outside it, clockwise (conventional), four tabs
    const P = Math.floor(Math.min(80, Math.min(b.w, b.d) - 2 * MARGIN - 2 * bit.d) / 10) * 10;
    const r = bit.d / 2, cx = b.w / 2, cy = b.d / 2, depth = b.t + 0.3, tabTop = -(b.t - 2), tabW = 8 + bit.d;
    const h = P / 2 + r;
    const corners = [[cx - h, cy - h], [cx - h, cy + h], [cx + h, cy + h], [cx + h, cy - h], [cx - h, cy - h]];
    const path = [];
    for (const z of passes(depth, feeds(bit).pass)) {
      for (let s = 0; s < 4; s++) {
        const [ax, ay] = corners[s], [bx, by] = corners[s + 1], len = Math.hypot(bx - ax, by - ay);
        const at = t => [ax + (bx - ax) * t / len, ay + (by - ay) * t / len];
        if (s === 0) path.push([ax, ay, z]);
        if (z < tabTop) {
          const t0 = len / 2 - tabW / 2, t1 = len / 2 + tabW / 2;
          path.push([...at(t0), z], [...at(t0), tabTop], [...at(t1), tabTop], [...at(t1), z]);
        }
        path.push([bx, by, z]);
      }
    }
    return { size: P, depth, paths: [path], what: `a ${P} mm square, cut through with four tabs` };
  }

  function load(lesson, b, bit) {
    const r = R();
    const g = lesson.id === 'square' ? lesson1(b, bit) : lesson2(b, bit);
    const name = lesson.id === 'square' ? 'square-and-circle' : 'cut-out-square';
    L = { lesson, board: { ...b }, bit, ...g, at: Date.now() };
    r.loadProgram(name + '.sbp', sbp(name, bit, g.paths), 'lesson', {
      origin: { xy: 'the front-left corner of your plywood (not the table\'s)', z: 'the top of your board' }, lesson: lesson.id });
    r.card([el('h2', { text: 'The test cut is loaded' }),
      el('p', { text: `${g.what}, centred on your ${b.w} × ${b.d} mm board.` }),
      el('p', { text: 'Now control\'s own steps, the sentence at the top says each one: jog over the front-left corner of the plywood and press zero x y; zero Z on top with the z plate; trace (the bit must stay over the plywood and clear every screw); then cut.' }),
      row(btn('start', () => r.card(null), 'go'))]);
  }

  // ---- 4: measure ----
  function measureCard() {
    const r = R(); if (!r || !L) return;
    const fields = L.lesson.id === 'square'
      ? [['ox', 'square, outer edges, left to right'], ['ix', 'square, inner edges, left to right'], ['oy', 'square, outer edges, front to back'], ['iy', 'square, inner edges, front to back'], ['dp', 'groove depth'], ['cx', 'circle, outer edges, left to right (optional)'], ['cy', 'circle, outer edges, front to back (optional)']]
      : [['px', 'the part, left to right'], ['py', 'the part, front to back'], ['tb', 'a tab, its height (optional)']];
    const ins = {};
    const rows = fields.map(([k, t]) => { ins[k] = el('input', { type: 'text', inputmode: 'decimal', style: 'width:84px;text-align:right' }); ins[k].addEventListener('keydown', e => e.stopPropagation()); return el('div', { class: 'sr-plate-t' }, el('span', { text: t, style: 'flex:1' }), ins[k], el('span', { text: 'mm' })); });
    const out = el('div', {});
    const calc = () => {
      const v = {}; for (const k in ins) v[k] = num(ins[k].value, NaN);
      const res = analyse(v);
      out.innerHTML = '';
      for (const line of res.lines) out.append(el('p', { text: line }));
      if (res.lines.length) {
        const all = JSON.stringify({ test: L.lesson.id, bit: L.bit.name, board: L.board, size: L.size, circle: L.circle, depth: L.depth, measured: v, result: res.data, at: new Date().toISOString() });
        try { const list = JSON.parse(localStorage.getItem(RESULTS) || '[]'); list.push(JSON.parse(all)); localStorage.setItem(RESULTS, JSON.stringify(list.slice(-20))); } catch (e) { /* private */ }
        out.append(row(btn('copy the numbers', () => { try { navigator.clipboard.writeText(all); r.tell('The numbers are copied.'); } catch (e) {} })));
      }
    };
    r.card([el('h2', { text: 'Measure what you made' }),
      el('p', { text: L.lesson.id === 'square'
        ? `With calipers, before you unscrew the board. The square was drawn ${L.size} mm (the bit's centre), the circle ${L.circle} mm, ${L.depth} mm deep.`
        : `Unscrew the board, cut the tabs, sand them flush. The part was drawn ${L.size} × ${L.size} mm.` }),
      ...rows, out, row(btn('later', () => r.card(null)), btn('work it out', calc, 'go'))]);
  }
  function analyse(v) {
    const lines = [], data = {};
    const pct = (got, want) => (got / want - 1) * 100;
    const say = (axis, mean, want) => { const e = pct(mean, want); data[axis] = +e.toFixed(3); lines.push(`${axis}: ${mean.toFixed(2)} mm where ${want} was drawn, ${e >= 0 ? '+' : ''}${e.toFixed(2)}% (${(mean - want >= 0 ? '+' : '') + (mean - want).toFixed(2)} mm).`); };
    if (L.lesson.id === 'square') {
      // the groove's outer and inner edges average to the bit's own path: the bit's width drops out
      if (isFinite(v.ox) && isFinite(v.ix)) { say('X', (v.ox + v.ix) / 2, L.size); data.widthX = +((v.ox - v.ix) / 2).toFixed(3); }
      if (isFinite(v.oy) && isFinite(v.iy)) { say('Y', (v.oy + v.iy) / 2, L.size); data.widthY = +((v.oy - v.iy) / 2).toFixed(3); }
      const wd = [data.widthX, data.widthY].filter(isFinite);
      if (wd.length) { const w = wd.reduce((a, b) => a + b) / wd.length; data.width = +w.toFixed(3); lines.push(`The groove is ${w.toFixed(2)} mm wide; the bit is ${L.bit.d} mm (${(w - L.bit.d >= 0 ? '+' : '') + (w - L.bit.d).toFixed(2)} mm: runout, or the bit's real size).`); }
      if (isFinite(v.dp)) { data.Z = +(v.dp - L.depth).toFixed(3); lines.push(`Z: ${v.dp.toFixed(2)} mm deep where ${L.depth} was asked (${(data.Z >= 0 ? '+' : '') + data.Z.toFixed(2)} mm: the zero, or Z's travel).`); }
      if (isFinite(v.cx) && isFinite(v.cy)) { data.round = +(v.cx - v.cy).toFixed(3); lines.push(`The circle is ${Math.abs(data.round).toFixed(2)} mm out of round (${v.cx.toFixed(2)} left to right, ${v.cy.toFixed(2)} front to back): a difference over 0.2 mm is play in an axis.`); }
    } else {
      if (isFinite(v.px)) say('X', v.px, L.size);
      if (isFinite(v.py)) say('Y', v.py, L.size);
      if (isFinite(v.tb)) lines.push(`The tab stood ${v.tb.toFixed(2)} mm, 2 was drawn.`);
    }
    if (!lines.length) lines.push('Type at least one pair of numbers.');
    return { lines, data };
  }

  window.addEventListener('swarf.run.finished', e => {
    const d = e.detail || {};
    if (L && (d.job === 'cut' || d.job === 'from') && d.prog && d.prog.source === 'lesson') setTimeout(measureCard, 400);
  });
  window.__swarfLessons = { choose, measure: measureCard, lesson1, lesson2, sbp, analyse: v => analyse(v), state: () => L };
})();
