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

  // v010-r10: Phil — "the floor must be IDENTICAL across modes." Kiri's
  // Space.scene.updateFog() resets fog.near to camera-distance-to-target on
  // every camera move (space.js onCameraMove). Switching to SIMULATE shifts
  // the camera, which shifts the fog band, which paints the grid brighter
  // or darker. Pin fog to fixed world-space distances anchored on the part
  // size, and neutralise updateFog so camera motion can't repaint the floor.
  function applyFog(api, space) {
    if (!space || !space.scene) return;
    const THREE = window.THREE;
    if (!THREE) return;
    const size = widgetSize(api) || 25.4;
    // Near = generous "always crisp" radius around the part. Far = where the
    // grid fully fades to background. Both fixed in world units so the fade
    // pattern is the same regardless of camera position.
    const near = Math.max(size * 4, 120);
    const far  = Math.max(size * 18, near * 4);
    const sceneObj = space.scene.scene || space.scene._scene || null;
    // setFog works through space's API; then we pin near/far ourselves.
    try { space.scene.setFog && space.scene.setFog(3, FOG_COLOR); } catch (e) {}
    // Reach into the actual THREE.Scene and overwrite. setFog stores fog on
    // the underlying SCENE; we patch through space.world.scene if exposed,
    // else via the well-known global path moto.Space internals.
    try {
      const all = [
        space.world && space.world.scene,
        sceneObj
      ].filter(Boolean);
      for (const s of all) {
        if (s && s.fog) {
          s.fog.near = near;
          s.fog.far  = far;
          s.fog.color && s.fog.color.setHex(FOG_COLOR);
        }
      }
    } catch (e) {}
    // Neutralise Kiri's camera-relative fog recompute. Idempotent.
    if (space.scene && !space.scene.__swarfFogPinned) {
      space.scene.updateFog = function () { /* swarf: fog is world-anchored */ };
      space.scene.__swarfFogPinned = true;
    }
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
      // v010-r10: do NOT re-apply on animate/function.animate. Fog is now
      // world-anchored to part size; mode transitions must not change it.
    }
    if (++tries > 200) clearInterval(poll);
  }, 150);
})();
