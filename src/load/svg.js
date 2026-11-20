/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { newPolygon } from '../geo/polygon.js';
import { newPoint } from '../geo/point.js';
import { polygons } from '../geo/polygons.js';
import { THREE } from '../ext/three.js';

// points per curve at most: a huge circle is drawn in chords that grow, not in more of them
const SEG_MAX = 4096;

// swarf: what the reader leaves out or gets wrong in an SVG, put right before it reads it. A <use>
// (and the <symbol> it shows) becomes a copy of what it points at; anything hidden (display none or
// visibility hidden, by attribute, style or a one-class/one-id <style> rule) and the shapes that only
// clip, mask or decorate come out. Text is counted, never read. Returns the drawing (unchanged when
// there was nothing to do) and the counts the import says.
const SVGNS = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';
const NOT_DRAWN = new Set(['clipPath', 'mask', 'pattern', 'marker', 'filter', 'script']);
const DRAWN = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const USE_DEPTH = 8;
const kids = n => { const a = []; for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) a.push(c); return a; };
const tag = n => (n.localName || n.nodeName || '').replace(/^.*:/, '');
const walk = (n, fn) => { for (const c of kids(n)) if (fn(c) !== false) walk(c, fn); };
const drawnIn = n => { let k = DRAWN.has(tag(n)) ? 1 : 0; walk(n, c => { if (DRAWN.has(tag(c))) k++; }); return k; };

export function tidy(text) {
    const out = { svg: text, hidden: 0, text: 0, uses: 0, missing: 0, images: 0, clipped: 0 };
    let doc;
    try {
        doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    } catch (e) { return out; }
    const root = doc && doc.documentElement;
    if (!root || tag(root) !== 'svg' || doc.getElementsByTagName('parsererror').length) return out;
    // the <style> rules that hide a whole class or id: a rule's selector read by its last compound
    // part (g.off, .a.b, #id); a selector with a descendant step is not read
    const cls = [], ids = new Set();
    for (const st of Array.from(doc.getElementsByTagName('style'))) {
        const css = (st.textContent || '').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
            if (!/display\s*:\s*none|visibility\s*:\s*hidden/i.test(m[2])) continue;
            for (const sel of m[1].split(',').map(s => s.trim())) {
                const c = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)+)$/.exec(sel);
                if (c) cls.push({ tag: c[1] || null, all: c[2].split('.').filter(Boolean) });
                else if (/^[a-zA-Z]*#[\w-]+$/.test(sel)) ids.add(sel.replace(/^[a-zA-Z]*#/, ''));
            }
        }
    }
    const hiddenByClass = el => {
        if (!cls.length) return false;
        const has = new Set((el.getAttribute('class') || '').split(/\s+/).filter(Boolean));
        return has.size > 0 && cls.some(r => (!r.tag || r.tag === tag(el)) && r.all.every(c => has.has(c)));
    };
    const hidden = el => {
        const style = el.getAttribute('style') || '';
        return el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden'
            || /(^|;)\s*display\s*:\s*none/i.test(style) || /(^|;)\s*visibility\s*:\s*hidden/i.test(style)
            || hiddenByClass(el) || ids.has(el.getAttribute('id'));
    };
    let changed = false;
    const drop = (el, count) => { if (count) out.hidden += drawnIn(el); el.parentNode.removeChild(el); changed = true; };
    // hidden things and what only clips or masks, everywhere (a <use> could point into them)
    const gone = [];
    walk(root, el => {
        if (NOT_DRAWN.has(tag(el))) { gone.push([el, false]); return false; }
        if (hidden(el)) { gone.push([el, true]); return false; }
    });
    for (const [el, count] of gone) drop(el, count && !inSource(el));
    // every <use> outside <defs>/<symbol>, deepest copies last: a use inside a copied group expands too
    const byId = new Map();
    walk(root, el => { const id = el.getAttribute('id'); if (id && !byId.has(id)) byId.set(id, el); });
    const expand = (scope, depth, stack) => {
        const uses = [];
        walk(scope, el => { const t = tag(el); if (t === 'defs' || t === 'symbol') return false; if (t === 'use') { uses.push(el); return false; } });
        for (const u of uses) {
            const href = u.getAttribute('href') || u.getAttributeNS(XLINK, 'href') || u.getAttribute('xlink:href') || '';
            const ref = href.startsWith('#') ? byId.get(href.slice(1)) : null;
            if (!ref || depth >= USE_DEPTH || stack.includes(ref)) { out.missing++; u.parentNode.removeChild(u); changed = true; continue; }
            const g = doc.createElementNS(SVGNS, 'g');
            const x = parseFloat(u.getAttribute('x')) || 0, y = parseFloat(u.getAttribute('y')) || 0;
            const t = tag(ref);
            // a symbol (or svg) with a viewBox shown at the use's own width and height: scaled to fit,
            // centred, as the default preserveAspectRatio (xMidYMid meet) draws it
            let fit = '';
            const vb = (t === 'symbol' || t === 'svg') && (ref.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
            const uw = parseFloat(u.getAttribute('width')), uh = parseFloat(u.getAttribute('height'));
            if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0 && (uw > 0 || uh > 0)) {
                const sx = uw > 0 ? uw / vb[2] : uh / vb[3], sy = uh > 0 ? uh / vb[3] : sx, k = Math.min(sx, sy);
                const ox = (uw > 0 ? uw - vb[2] * k : 0) / 2, oy = (uh > 0 ? uh - vb[3] * k : 0) / 2;
                fit = `translate(${ox} ${oy}) scale(${k}) translate(${-vb[0]} ${-vb[1]})`;
            }
            const tf = [u.getAttribute('transform') || '', x || y ? `translate(${x} ${y})` : '', fit].filter(Boolean).join(' ');
            if (tf) g.setAttribute('transform', tf);
            for (const a of Array.from(u.attributes)) {
                const n = a.name.replace(/^.*:/, '');
                if (!['href', 'x', 'y', 'width', 'height', 'transform', 'id'].includes(n)) g.setAttribute(a.name, a.value);
            }
            for (const c of (t === 'symbol' || t === 'svg') ? kids(ref) : [ref]) {
                const copy = c.cloneNode(true);
                if (copy.removeAttribute) copy.removeAttribute('id');
                g.appendChild(copy);
            }
            u.parentNode.replaceChild(g, u);
            out.uses++; changed = true;
            expand(g, depth + 1, [...stack, ref]);
        }
    };
    expand(root, 0, []);
    // the sources the copies came from are never drawn themselves
    for (const el of Array.from(doc.getElementsByTagName('symbol'))) { el.parentNode.removeChild(el); changed = true; }
    for (const el of Array.from(doc.getElementsByTagName('text'))) if (!inSource(el)) out.text++;
    for (const el of Array.from(doc.getElementsByTagName('image'))) if (!inSource(el)) out.images++;
    // a clipping mask or mask is not read: the shapes under it come in whole
    walk(root, el => { const t = tag(el); if (t === 'defs' || t === 'symbol') return false; if (el.getAttribute('clip-path') || el.getAttribute('mask')) { out.clipped++; return false; } });
    if (changed) out.svg = new XMLSerializer().serializeToString(doc);
    return out;
}
// inside a <defs> or a <symbol>: only ever drawn through a <use>
function inSource(el) {
    for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) { const t = tag(p); if (t === 'defs' || t === 'symbol') return true; }
    return false;
}

export function parseAsync(text, opt) {
    return new Promise((resolve,reject) => {
        resolve(parse(text, opt));
    });
}

export function parse(text, opt = { }) {
    const justPoly = opt.flat || false;
    const fromSoup = opt.soup !== false || justPoly;
    const rez = (opt.resolution || 1);
    const dpi = (opt.dpi || 0);
    const segmin = Math.max(1, opt.segmin || 10);
    const objs = [];
    const polys = [];
    let data;
    try {
        data = new THREE.SVGLoader().parse(text);
    } catch (e) {
        // a drawing the reader cannot follow (a path that starts with an arc, not a move) makes nothing
        return objs;
    }
    const paths = data.paths;
    const xmlat = data.xml?.attributes || {};
    const isinch = xmlat.width?.value.endsWith('in');
    const scale = isinch ? 25.4 : (dpi ? 1 / (dpi / 25.4) : 1);
    const depth = parseFloat(opt.depth || xmlat['data-km-extrude']?.value
        || xmlat['extrude']?.value
        || 5);

    for (let i = 0; i < paths.length; i++) {
        let path = paths[i];
        let type = path.userData?.node?.nodeName;
        let width = path.userData?.style?.strokeWidth;
        let miter = path.userData?.style?.strokeMiterLimit;
        for (let sub of path.subPaths) {
            let points = sub.curves.map(curve => {
                if (curve.type === 'LineCurve') {
                    return curve.getPoints(1);
                }
                let segs = Math.ceil(curve.getLength() * rez);
                segs = Number.isFinite(segs) ? Math.min(Math.max(segs, segmin), SEG_MAX) : segmin;
                return curve.getPoints(segs);
            }).flat();
            if (points.length < 3 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
                continue;
            }
            let poly = newPolygon().addPoints(points.map(p => newPoint(p.x, -p.y, 0))).clean();
            const a0 = points[0], a1 = points[points.length - 1];
            const meets = poly.appearsClosed() || Math.hypot(a0.x - a1.x, a0.y - a1.y) < 1e-6;
            if (poly.appearsClosed()) poly.points.pop();
            // a path drawn without "z" whose ends don't meet is an open line, as a polyline is: it is
            // left out of the parts (and counted as such), never closed by a straight chord
            if (type === 'polyline' || (type === 'path' && !sub.autoClose && !meets)) poly.setOpen(true);
            poly._svg = { width, miter };
            polys.push(poly);
            if (scale !== 1) {
                poly.scale({ x: scale, y: scale, z: 1 });
            }
        }
    }

    // open lines make no part (the import counts them as left out); the flat outline keeps them
    const usable = justPoly ? polys : polys.filter(p => !p.open);
    const sub = fromSoup ? polygons.nest(usable) : usable;
    const nest = sub.filter(p => {
        for (let pc of usable) {
            if (pc === p) {
                return true;
            } else {
                return !pc.isEquivalent(p);
            }
        }
    });

    if (justPoly) {
        return nest;
    }

    for (let poly of nest) {
        let obj = poly.extrude(depth);
        objs.push(obj);
    }

    return objs;
}
