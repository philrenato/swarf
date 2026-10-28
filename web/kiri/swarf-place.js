/*
 * swarf place — a part that arrives never lands on another (review 10-28b #5: an
 * SVG import sat inside the board, and toolpaths cut both). A new part (or group,
 * such as a word) that would overlap the parts already on the bed moves to their
 * right, 12 mm clear (the layout's gap), and the sentence says so. DRAW's done is
 * left alone: there a part is where it was drawn, and DRAW marks overlaps itself.
 */
(function () {
  'use strict';
  const api = () => window.kiri && window.kiri.api;
  const GAP = 12;
  const born = Date.now();

  // a widget's footprint on the bed (x, y), from its mesh and position
  function box(w) {
    const g = w.mesh && w.mesh.geometry;
    if (!g) return null;
    g.computeBoundingBox();
    const b = g.boundingBox, p = w.track.pos;
    return [b.min.x + p.x, b.min.y + p.y, b.max.x + p.x, b.max.y + p.y];
  }
  const union = list => list.reduce((u, b) => b ? (u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b) : u, null);
  const hits = (a, b) => a && b && a[0] < b[2] - 0.01 && b[0] < a[2] - 0.01 && a[1] < b[3] - 0.01 && b[1] < a[3] - 0.01;

  function arrived(payload) {
    const a = api();
    // a project being restored keeps its layout; DRAW keeps what was drawn
    if (Date.now() - born < 4000 || document.body.classList.contains('swarf-draw-open')) return;
    const list = (Array.isArray(payload) ? payload : [payload]).filter(Boolean);
    setTimeout(() => {
      const fresh = new Set();
      for (const w of list) for (const g of (w.group && w.group.length ? w.group : [w])) fresh.add(g);
      const others = a.widgets.all().filter(w => !fresh.has(w));
      if (!others.length || !fresh.size) return;
      const mine = union([...fresh].map(box)), theirs = others.map(box);
      if (!theirs.some(b => hits(mine, b))) return;
      const all = union(theirs);
      // to the right of everything, its front edge in line with theirs; else behind them;
      // if neither fits on the bed, it stays and the sentence says so
      const d = a.conf.get().device, W = d.bedWidth / 2, D = d.bedDepth / 2;
      const w = mine[2] - mine[0], h = mine[3] - mine[1];
      let dx, dy;
      if (all[2] + GAP + w <= W) { dx = all[2] + GAP - mine[0]; dy = all[1] - mine[1]; }
      else if (all[3] + GAP + h <= D) { dx = all[0] - mine[0]; dy = all[3] + GAP - mine[1]; }
      else {
        try { a.event.alerts(true); a.show.alert('This part overlaps another and there is no room beside them on the bed: move one, or the toolpaths will cut them as one.', 9); } catch (e) { /* no alerts */ }
        return;
      }
      const moved = new Set();
      for (const w of fresh) { const lead = w.group && w.group.length ? w.group[0] : w; if (moved.has(lead)) continue; moved.add(lead); lead.move(dx, dy, 0); }
      try { a.space.auto_save(); } catch (e) { /* no save */ }
      try { window.moto.space.refresh(); } catch (e) { /* no view */ }
      const name = ([...fresh][0].meta && [...fresh][0].meta.file) || 'the new part';
      try { a.event.alerts(true); a.show.alert(`${name} would have landed on another part, so it sits beside them, ${GAP} mm clear.`, 7); } catch (e) { /* no alerts */ }
      try { a.reveal && a.reveal([...fresh]); } catch (e) { /* no view */ }
    }, 120);
  }

  let tries = 0;
  const t = setInterval(() => {
    const a = api();
    if ((a && a.event && a.widgets) || ++tries > 200) {
      clearInterval(t);
      if (a && a.event) a.event.on('widget.add', arrived);
    }
  }, 150);
})();
