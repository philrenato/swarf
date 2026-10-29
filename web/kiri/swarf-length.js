/*
 * swarf length — one way to read and show a length in swarf's own cards (shape, size, draw),
 * following cam's units setting (setup › preferences › units). Phil 10-29: a woodshop that
 * thinks in inches types 3/4, 1 1/2", 0.75 in or 19 mm anywhere and gets what it typed.
 *
 *   SwarfLength.unit()           'mm' or 'in', cam's setting
 *   SwarfLength.parse(text)      mm, or NaN: "3/4", "1 1/2", "1-1/2\"", "0.75 in", "19.05 mm", "2 cm";
 *                                a bare number is in unit()
 *   SwarfLength.show(mm)         the number for a field in unit(): 19.05 or 0.75 (never a fraction,
 *                                so a field read back is the same length)
 *   SwarfLength.say(mm)          words: "19.05 mm", or "3/4 in" when it is an exact 64th, else "0.7874 in"
 *
 * Everything inside swarf stays in millimeters; only the cards' words and fields change.
 */
(function (root) {
  'use strict';
  const IN = 25.4;
  const SUFFIX = { '': null, mm: 1, millimeter: 1, millimeters: 1, cm: 10, in: IN, inch: IN, inches: IN, '"': IN, '″': IN };

  function unit() {
    try {
      const a = root.kiri && root.kiri.api;
      return a && a.view && a.view.unit_scale && a.view.unit_scale() === IN ? 'in' : 'mm';
    } catch (e) { return 'mm'; }
  }

  // a number, a fraction, or a whole number and a fraction; then an optional unit
  function parse(text, def) {
    let s = String(text == null ? '' : text).trim().toLowerCase();
    // 1,000 or 2,438.4: commas between groups of three are thousands (an American shop); any
    // other comma is a decimal point, 1,5 = 1.5 (torture test 10-29: 1,000 read as 1)
    s = /^[-+]?\d{1,3}(,\d{3})+(\.\d*)?(\s*[a-z"″]*)?$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
    if (!s) return NaN;
    const um = s.match(/(mm|millimeters?|cm|inches|inch|in|"|″)$/);
    const u = um ? um[1] : '';
    if (um) s = s.slice(0, -u.length).trim();
    let sign = 1;
    if (/^[-+]/.test(s)) { if (s[0] === '-') sign = -1; s = s.slice(1).trim(); }
    let v;
    let m;
    if ((m = s.match(/^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/))) v = +m[1] + (+m[3] ? +m[2] / +m[3] : NaN);
    else if ((m = s.match(/^(\d+)\s*\/\s*(\d+)$/))) v = +m[2] ? +m[1] / +m[2] : NaN;
    else if (/^(\d+\.?\d*|\.\d+)$/.test(s)) v = +s;
    else return NaN;
    const k = SUFFIX[u] || ((def || unit()) === 'in' ? IN : 1);
    return sign * v * k;
  }

  // a field's number: inches to 4 places hold a 64th exactly enough to read back within 0.0013 mm
  function show(mm, u) {
    if (!Number.isFinite(+mm)) return '';
    return (u || unit()) === 'in' ? String(+(mm / IN).toFixed(4)) : String(+(+mm).toFixed(3));
  }

  function frac(inches) {
    const n = Math.round(Math.abs(inches) * 64);
    if (Math.abs(Math.abs(inches) * 64 - n) > 1e-6 || !n) return null;
    let a = n, b = 64;
    while (a % 2 === 0 && b > 1) { a /= 2; b /= 2; }
    const whole = Math.floor(a / b), rest = a % b, sg = inches < 0 ? '-' : '';
    return sg + (whole && rest ? `${whole} ${rest}/${b}` : whole ? `${whole}` : `${rest}/${b}`);
  }

  function say(mm, u) {
    if (!Number.isFinite(+mm)) return '';
    if ((u || unit()) !== 'in') return `${+(+mm).toFixed(2)} mm`;
    return `${frac(mm / IN) || +(mm / IN).toFixed(4)} in`;
  }

  const api = { unit, parse, show, say, IN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SwarfLength = api;
})(typeof window !== 'undefined' ? window : globalThis);
