// The view a student lands in, measured in the page: the parts' box projected through the camera
// (every corner inside the window, in front of the camera) and the camera above the bed and outside
// the parts (r086 check M1: after DRAW's done the camera sat inside the board, a wall of orange).
//   const v = await page.evaluate(VIEW);   check(v.ok, `... ${v.say}`)
export const VIEW = () => {
  const THREE = window.THREE || (window.kiri && window.kiri.api && window.kiri.api.THREE);
  const space = window.moto.space, cam = space.internals().camera;
  const ms = window.kiri.api.widgets.all().map(w => w.mesh).filter(Boolean);
  if (!ms.length) return { ok: true, say: 'no parts' };
  cam.updateMatrixWorld();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, front = true, lo = Infinity;
  const p = new THREE.Vector3(), W = innerWidth, H = innerHeight;
  for (const m of ms) {
    m.geometry.computeBoundingBox();
    m.updateMatrixWorld();
    const b = m.geometry.boundingBox;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
      lo = Math.min(lo, p.y);
      p.project(cam);
      if (p.z > 1 || p.z < -1) front = false;
      const sx = (p.x + 1) / 2 * W, sy = (1 - p.y) / 2 * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); z0 = Math.min(z0, p.z);
    }
  }
  const fits = front && x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= H;
  const above = cam.position.y > lo;
  const r = v => Math.round(v);
  return { ok: fits && above, fits, above, say: `parts span x ${r(x0)}–${r(x1)}, y ${r(y0)}–${r(y1)} of ${W} × ${H}, camera (${[cam.position.x, cam.position.y, cam.position.z].map(r).join(', ')}), bed at ${r(lo)}` };
};
