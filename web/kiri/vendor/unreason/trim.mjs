// The two 2D polygon helpers arrangement.mjs imports, copied unchanged from
// unreason3d-web/kernel/trim.mjs (the rest of that module is surface trimming
// swarf does not use).

// Shoelace signed area — the standard winding-direction test the
// "outer loops one winding direction, hole loops the other" rule needs.
// Positive = counter-clockwise in (u,v).
export function signedArea2D(loop) {
  let a = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const [u0, v0] = loop[i], [u1, v1] = loop[(i + 1) % n];
    a += u0 * v1 - u1 * v0;
  }
  return a / 2;
}

// Standard ray-casting point-in-polygon test (even-odd rule) against a UV
// trim loop, implicitly closed. A point exactly on the boundary is reported
// separately (within `tol`) rather than forced arbitrarily inside/outside —
// callers doing tessellation classification (the "fully-inside /
// fully-outside / boundary-crossing" cell test) need that third state.
export function pointInUVPolygon(loop, u, v, tol = 1e-9) {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const [u0, v0] = loop[i], [u1, v1] = loop[(i + 1) % n];
    const du = u1 - u0, dv = v1 - v0;
    const segLenSq = du * du + dv * dv;
    if (segLenSq < 1e-18) continue;
    const t = ((u - u0) * du + (v - v0) * dv) / segLenSq;
    if (t >= -1e-12 && t <= 1 + 1e-12) {
      const px = u0 + du * t, py = v0 + dv * t;
      if (Math.hypot(px - u, py - v) < tol) return 'boundary';
    }
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ui, vi] = loop[i], [uj, vj] = loop[j];
    const crosses = (vi > v) !== (vj > v);
    if (crosses) {
      const uAtV = ui + (v - vi) * (uj - ui) / (vj - vi);
      if (u < uAtV) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}
