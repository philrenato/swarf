// swarf skins: the color layer, generated (Phil 10-28: "two alternate skin packs for
// the entire app"). Every color in every stylesheet the app loads, in load order,
// becomes a role token: a neutral by its lightness (n0 darkest .. n9 lightest), a
// shadow or a glint inside shadows, or a hue family (accent red, warn amber, ok
// green, info blue, violet). A skin (swarf-skin-*.css) gives each token its own
// color, as "r g b", and may scale its alpha (--sk-a-<role>). The rules keep their
// selectors, properties and !important; each is scoped under html[data-skin], so the
// default look (no data-skin attribute) is untouched.
//
// Inline styles written by scripts are not here: the skin files cover those by hand.
//   node tools/make_skins.mjs        → web/kiri/swarf-skin-map.css
import { readFileSync, writeFileSync } from 'fs';
import postcss from 'postcss';

const SOURCES = [
  'web/moto/palette.css', 'web/moto/theme.css', 'web/moto/menubar.css',
  'web/kiri/index.css', 'web/kiri/swarf.css',
  // the loading curtain's own block in the page
  ['web/kiri/index.html', s => { const i = s.indexOf('<style>', s.indexOf('<body')); return i < 0 ? '' : s.slice(i + 7, s.indexOf('</style>', i)); }],
  // CONTROL's stylesheet lives in its script
  // (and scoped under #swarf-run at run time, as swarf-run.js scoped() does)
  ['web/kiri/swarf-run.js', s => s.slice(s.indexOf('const CSS = `') + 13, s.indexOf('\n`;', s.indexOf('const CSS = `'))), sel => sel.split(',').map(x => {
    const t = x.trim();
    return !t || t.startsWith('#swarf-run') || t.startsWith('body') ? t : '#swarf-run ' + t;
  }).join(', ')],
];

const NAMED = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], grey: [128, 128, 128], gray: [128, 128, 128],
  silver: [192, 192, 192], yellow: [255, 255, 0], orange: [255, 165, 0], green: [0, 128, 0], blue: [0, 0, 255], lightgray: [211, 211, 211],
  darkgray: [169, 169, 169], whitesmoke: [245, 245, 245], gainsboro: [220, 220, 220] };
const COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^()]*\)|hsla?\([^()]*\)|(?<![-\w.#])(?:white|black|red|grey|gray|silver|yellow|orange|green|blue|lightgray|darkgray|whitesmoke|gainsboro)(?![-\w])/g;
const COLOR_PROPS = /^(--|color$|background|border|outline|box-shadow|text-shadow|fill$|stroke$|caret-color|accent-color|scrollbar-color|stop-color|text-decoration-color|column-rule|filter$|-webkit-text-fill-color|-webkit-text-stroke)/;

function parse(c) {
  c = c.trim();
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length <= 4) h = [...h].map(x => x + x).join('');
    const n = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    return [...n, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  if (NAMED[c]) return [...NAMED[c], 1];
  const m = c.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!m) return null;
  const p = m[2].split(/[\s,/]+/).filter(Boolean);
  if (p.some(x => /var\(|calc/.test(x))) return null;
  let a = p[3] !== undefined ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
  if (m[1].startsWith('rgb')) return [...p.slice(0, 3).map(x => x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)), a];
  const H = parseFloat(p[0]) / 360, S = parseFloat(p[1]) / 100, L = parseFloat(p[2]) / 100;
  const f = n => { const k = (n + H * 12) % 12, q = S * Math.min(L, 1 - L); return 255 * (L - q * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4), a];
}

// the role of one color, from its hue, chroma and lightness; ctx 'shadow' inside shadows
function role([r, g, b], ctx) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), chroma = (mx - mn) / 255, L = (mx + mn) / 510;
  if (chroma < 0.2 || (chroma < 0.28 && L < 0.18)) {
    if (ctx === 'shadow') return L < 0.5 ? 'shadow' : 'glint';
    const bands = [0.07, 0.11, 0.16, 0.24, 0.34, 0.46, 0.58, 0.72, 0.86];
    const i = bands.findIndex(t => L < t);
    return 'n' + (i < 0 ? 9 : i);
  }
  let h;
  const d = mx - mn;
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 340 || h < 18) return L < 0.3 ? 'acc-dim' : L < 0.52 ? 'acc' : 'acc-hi';
  if (h < 62) return 'warn';
  if (h < 170) return 'ok';
  if (h < 262) return 'info';
  return 'violet';
}

const tokenFor = (c, ctx) => {
  const v = parse(c);
  if (!v) return c;
  const R = role(v, ctx), a = +v[3].toFixed(3);
  return `rgb(var(--sk-${R}) / calc(${a} * var(--sk-a-${R}, 1)))`;
};

function remap(prop, value) {
  if (!COLOR_PROPS.test(prop)) return null;
  if (prop.startsWith('--') && !COLOR.test(value)) return null;
  COLOR.lastIndex = 0;
  if (!COLOR.test(value)) return null;
  COLOR.lastIndex = 0;
  const ctx = /shadow/.test(prop) || /drop-shadow/.test(value) ? 'shadow' : '';
  // a url(data:…) carries its own colors: leave it whole
  const parts = value.split(/(url\([^)]*\))/);
  return parts.map((p, i) => i % 2 ? p : p.replace(COLOR, c => tokenFor(c, ctx))).join('');
}

function scope(sel) {
  return sel.split(',').map(s => {
    s = s.trim();
    if (/^:root\b/.test(s)) return s.replace(/^:root/, 'html[data-skin]');
    if (/^html\b/.test(s)) return s.replace(/^html/, 'html[data-skin]');
    return 'html[data-skin] ' + s;
  }).join(',\n');
}

const out = [];
let count = 0;
for (const src of SOURCES) {
  const [file, pick, prefix = x => x] = Array.isArray(src) ? src : [src, s => s];
  const css = pick(readFileSync(file, 'utf8')).replace(/@import[^;]*;/g, '');
  const root = postcss.parse(css, { from: file });
  const acc = postcss.root();
  root.walkRules(rule => {
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
    const decls = [];
    rule.walkDecls(d => {
      const v = remap(d.prop.toLowerCase(), d.value);
      if (v) decls.push(postcss.decl({ prop: d.prop, value: v, important: d.important }));
    });
    if (!decls.length) return;
    const r = postcss.rule({ selector: scope(prefix(rule.selector)) });
    r.append(decls);
    count += decls.length;
    // keep @media / @supports wrappers
    let p = rule.parent, node = r;
    while (p && p.type === 'atrule') { const w = postcss.atRule({ name: p.name, params: p.params }); w.append(node); node = w; p = p.parent; }
    acc.append(node);
  });
  out.push(`/* ---- from ${file} ---- */\n` + acc.toString());
}
const head = `/* swarf-skin-map.css — GENERATED by tools/make_skins.mjs; do not edit by hand.
   Every color the app's stylesheets set, as a role token a skin (swarf-skin-*.css)
   defines. Scoped under html[data-skin]: the default look never reads it. */\n`;
writeFileSync('web/kiri/swarf-skin-map.css', head + out.join('\n\n') + '\n');
console.log(`swarf-skin-map.css: ${count} declarations from ${SOURCES.length} sources`);
