// In-page checks the skin probes share (each runs whole inside the page: page.evaluate(fn, ...)).
//
// lowContrast(): the visible text that reads poorly on what is behind it, one line each:
// "<where> "<text>" <ratio>:1 (<text color> on <background>)". The background is found by
// compositing each ancestor's background color over the next, and a gradient counts as the
// average of its stops (the glass jelly and graphite fills are gradients). The 3D scene behind
// everything counts as the skin's fog color.
export function lowContrast(min = 3) {
  const rgba = s => { const m = String(s).match(/rgba?\(([^)]*)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const stops = img => { const all = String(img).match(/rgba?\([^)]*\)/g); if (!all) return null; const c = all.map(rgba); const n = c.length; return [0, 1, 2, 3].map(i => c.reduce((s, x) => s + x[i], 0) / n); };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const root = getComputedStyle(document.documentElement);
  const fogHex = root.getPropertyValue('--sk3d-fog').trim();
  const fog = /^#[0-9a-f]{6}$/i.test(fogHex) ? [1, 3, 5].map(i => parseInt(fogHex.slice(i, i + 2), 16)).concat(1) : document.documentElement.hasAttribute('data-skin') ? [239, 239, 239, 1] : [20, 14, 13, 1];
  const behind = el => {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const op = parseFloat(cs.opacity);
      const bg = rgba(cs.backgroundColor);
      const img = cs.backgroundImage && cs.backgroundImage !== 'none' ? stops(cs.backgroundImage) : null;
      if (img && img[3] > 0.02) layers.push(img);
      if (bg && bg[3] > 0.02) layers.push(bg);
      if (op < 1 && layers.length) break;
      if (layers.length && layers[layers.length - 1][3] >= 0.98) break;
    }
    let c = fog;
    for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return c;
  };
  const name = el => { let s = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''); const p = el.closest('[id]'); return p && p !== el ? `${p.tagName.toLowerCase()}#${p.id} ${s}` : s; };
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = t.textContent.trim();
    if (!text) continue;
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('svg, canvas, script, style, option, .hide')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    // the element on top at its middle must be it or inside it, else it is covered (a closed card under a sheet)
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2));
    if (hit && !el.contains(hit) && !hit.contains(el)) continue;
    let fg = rgba(cs.color);
    if (!fg || fg[3] < 0.1 || parseFloat(cs.fontSize) === 0) continue;   // text drawn another way (a glyph in ::before)
    let a = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) a *= parseFloat(getComputedStyle(e).opacity);
    if (a < 0.5) continue;   // a deliberately faded row (disabled)
    const bg = behind(el);
    fg = over(fg, bg);
    const k = ratio(fg, bg);
    if (k < min) out.push(`${name(el)} "${text.slice(0, 30)}" ${k.toFixed(2)}:1 (rgb ${fg.slice(0, 3).map(Math.round)} on rgb ${bg.slice(0, 3).map(Math.round)})`);
  }
  return out;
}

// darkFills(scope, allow): the elements under scope (a CSS selector) painted with a dark fill, as
// "<where> L=<lightness> a=<alpha>". Used for the light skins, where a dark fill is a mistake unless
// it is meant: elements matching allow, and any small control with light text on its fill (a
// chosen pill, the primary button).
export function darkFills(scope, allow) {
  const rgba = s => { const m = String(s).match(/rgba?\(([^)]*)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const light = c => c && (Math.max(c[0], c[1], c[2]) + Math.min(c[0], c[1], c[2])) / 510 > 0.8;
  const out = [];
  for (const host of document.querySelectorAll(scope)) {
    for (const el of [host, ...host.querySelectorAll('*')]) {
      if (allow && el.matches(allow)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      if (r.width * r.height < 40000 && light(rgba(getComputedStyle(el).color))) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const cs = getComputedStyle(el);
      const fills = [rgba(cs.backgroundColor)];
      // a field's image is its arrow or check glyph, not its fill
      if (!/^(SELECT|INPUT)$/.test(el.tagName)) for (const s of String(cs.backgroundImage).match(/rgba?\([^)]*\)/g) || []) fills.push(rgba(s));
      for (const c of fills) {
        if (!c || c[3] < 0.35) continue;
        const L = (Math.max(c[0], c[1], c[2]) + Math.min(c[0], c[1], c[2])) / 510;
        if (L < 0.35) { out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''} L=${L.toFixed(2)} a=${c[3]}`); break; }
      }
    }
  }
  return out;
}
