/**
 * swarf grid fade — adds a soft distance-based fog to the 3D scene so the
 * grid (and the floor numbers) gently fade as they get further from the
 * loaded part. Tied to the part's bounding-box size: small parts get a
 * tight fade radius (Phil's note: a 25mm cube should look crisp near the
 * part, ~50% more translucent at the edges of the bed); large parts get
 * a wider radius so the workspace doesn't disappear.
 *
 * Implementation: Three.js Fog (linear) on space.world.scene. Most of
 * Kiri's grid + label materials honor fog by default. The fog near/far
 * is recomputed whenever a widget is added or simulation fires, so fade
 * scales with the part actually on the bed.
 */
(function () {
  'use strict';
  if (window.__swarfGridFadeLoaded) return;
  window.__swarfGridFadeLoaded = true;

  const FAR_MULT  = 6;   // fade ends at FAR_MULT × max-bbox-dim away
  const NEAR_MULT = 1.5; // fade starts at NEAR_MULT × max-bbox-dim away
  const FOG_COLOR = 0x0a0808;

  function widgetSize(api) {
    try {
      const widgets = api.widgets.all();
      let maxDim = 0;
      for (const w of widgets) {
        const m = w.mesh;
        if (!m || !m.geometry) continue;
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        if (!bb) continue;
        const dx = bb.max.x - bb.min.x;
        const dy = bb.max.y - bb.min.y;
        const dz = bb.max.z - bb.min.z;
        maxDim = Math.max(maxDim, dx, dy, dz);
      }
      return maxDim;
    } catch (e) { return 0; }
  }

  function applyFog(api, space) {
    if (!space || !space.scene || !space.scene.setFog) return;
    // mult is the ratio of fog.far / fog.near. Smaller mult = sharper fade.
    // We pick mult by part size: small parts get mult=2 (tight, dramatic
    // fade past the cube); larger parts get mult=5 (gentle, doesn't hide
    // the workspace).
    const size = widgetSize(api) || 25.4;
    const mult = size < 60 ? 2.2 : (size < 200 ? 3.5 : 5);
    space.scene.setFog(mult, FOG_COLOR);
    try { space.refresh && space.refresh(); } catch (e) {}
  }

  let tries = 0;
  const poll = setInterval(() => {
    const space = window.moto && window.moto.space;
    const api   = window.kiri && window.kiri.api;
    if (space && api && api.event) {
      clearInterval(poll);
      applyFog(api, space);
      api.event.on('widget.add',    () => setTimeout(() => applyFog(api, space), 50));
      api.event.on('widget.delete', () => setTimeout(() => applyFog(api, space), 50));
      // recompute when entering simulate so chips and tool can fade with depth
      api.event.on('animate',          () => applyFog(api, space));
      api.event.on('function.animate', () => applyFog(api, space));
    }
    if (++tries > 200) clearInterval(poll);
  }, 150);
})();
