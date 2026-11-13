/*
 * swarf length — one way to read and show a length in swarf's own cards (shape, size, draw),
 * following cam's units setting (setup › preferences › units). Phil 10-29: a woodshop that
 * thinks in inches types 3/4, 1 1/2", 0.75 in or 19 mm anywhere and gets what it typed.
 *
 *   SwarfLength.unit()           'mm' or 'in', cam's setting
 *   SwarfLength.parse(text)      mm, or NaN: "3/4", "1 1/2", "1-1/2\"", "0.75 in", "19.05 mm", "2 cm";
 *                                a bare number is in unit()
 *   SwarfLength.show(mm)         the number for a field in unit(): 19.05 or 0.75 (never a fraction;
 *                                in: 3 places, 4 for a 64th; mm: 2 places, 3 under 1 mm or for an inch size)
 *   SwarfLength.field(mm)        a design field's text: "3/16" or "0.079" in inches (TEX, tabs)
 *   SwarfLength.say(mm)          words: "19.05 mm", or "3/4 in" when it is an exact 64th, else "0.7874 in"
 *   SwarfLength.note(text)       a sentence when a bare fraction in mm mode is read as inches, else ''
 *   SwarfLength.prose(mm, u, dp) a length in a sentence: in inches the nearest 16th ("2 9/16 in", what a
 *                                tape measure reads; under 1/8 the nearest 32nd), under a 64th in
 *                                thousandths ("0.012 in");
 *                                in mm to dp places (default 1), as the sentences always said it
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
    let v, frac = true;
    let m;
    if ((m = s.match(/^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/))) v = +m[1] + (+m[3] ? +m[2] / +m[3] : NaN);
    else if ((m = s.match(/^(\d+)\s*\/\s*(\d+)$/))) v = +m[2] ? +m[1] / +m[2] : NaN;
    else if (/^(\d+\.?\d*|\.\d+)$/.test(s)) { v = +s; frac = false; }
    else return NaN;
    // a fraction with no unit is inches whatever the setting: nobody means 3/4 of a millimeter
    // (deep review 10-31 S3: 3/4 in mm mode made a 0.75 mm part)
    const k = SUFFIX[u] || (frac || (def || unit()) === 'in' ? IN : 1);
    // to a billionth of a mm, so 3/4 in is 19.05 and not 19.049999999999997 (Phil 11-01)
    return Math.round(sign * v * k * 1e9) / 1e9;
  }

  // a field's number in the scene's precision (Phil 11-01: no 12.700000001): inches to 3 places,
  // or 4 when it is a 64th that needs them (1/64 = 0.0156), so a 64th reads back within 0.0013 mm;
  // mm to 2 places, 3 under 1 mm (a stepover, a tolerance) or for an inch size (3.175, a 1/8 in bit)
  function show(mm, u) {
    if (!Number.isFinite(+mm)) return '';
    mm = +mm;
    const in64 = Math.abs(mm / IN * 64 - Math.round(mm / IN * 64)) < 1e-6;
    if ((u || unit()) === 'in') return String(+(mm / IN).toFixed(in64 ? 4 : 3));
    return String(+mm.toFixed(Math.abs(mm) < 1 || in64 ? 3 : 2));
  }

  // a design field's text (TEX, the tab card, auto tabs; review 10-30 B8): in inches the nearest
  // 32nd as a fraction when it is within half a thousandth ("3/16", "1 1/2"), else three decimals
  // ("0.079"); parse() reads either back to within 0.013 mm. In mm, as show().
  function field(mm, u) {
    if (!Number.isFinite(+mm)) return '';
    if ((u || unit()) !== 'in') return show(mm, 'mm');
    const v = mm / IN, n = Math.round(v * 32);
    if (n && Math.abs(v - n / 32) <= 0.0005) return frac(n / 32);
    return String(+v.toFixed(3));
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

  // a length in a sentence (r086 check S3): a student bends plywood with a tape measure, not a
  // rule in 64ths, so a pitch of 71 mm is "2 13/16 in" wherever it is said, never "2 51/64" in one
  // line and "2 13/16" in the next.
  function prose(mm, u, dp) {
    if (!Number.isFinite(+mm)) return '';
    if ((u || unit()) !== 'in') return `${+(+mm).toFixed(dp == null ? 1 : dp)} mm`;
    // under an eighth (a skin, a texture's depth) a 16th is twice too coarse: the nearest 32nd
    const v = mm / IN, d = Math.abs(v) < 0.125 - 1 / 64 ? 32 : 16, n = Math.round(v * d);
    if (!n && Math.abs(v) > 1e-9) return `${+v.toFixed(3)} in`;
    return `${frac(n / d) || 0} in`;
  }

  // a bare fraction typed while the units are mm is read as inches (parse, above). Two readings of
  // the same text are both plausible, so say which one was taken (review 11-13 #5): '' when there is
  // nothing to say (inches, a unit typed, a decimal)
  function note(text, def) {
    const s = String(text == null ? '' : text).trim().toLowerCase();
    if ((def || unit()) === 'in' || !/^[-+]?\d*(\s+|\s*-\s*)?\d+\s*\/\s*\d+$/.test(s)) return '';
    const mm = parse(s, 'mm');
    if (!Number.isFinite(mm)) return '';
    return `${s} is read as inches: ${+mm.toFixed(2)} mm. For ${s} of a millimeter type ${+(mm / IN).toFixed(3)} or ${s} mm.`;
  }

  const api = { unit, parse, show, field, say, prose, note, IN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.SwarfLength = api;
    // swarf's own length fields (data-len: tex, draw) say a fraction's reading as it is committed;
    // Kiri's fields say it in inputs.js unitsValue
    if (root.document) root.document.addEventListener('change', ev => {
      const t = ev.target;
      if (!t || !t.matches || !t.matches('input[data-len]')) return;
      const n = note(t.value);
      if (!n) return;
      try { root.kiri.api.show.alert(n, 8); } catch (e) { /* no alert yet */ }
    }, true);
  }
})(typeof window !== 'undefined' ? window : globalThis);
