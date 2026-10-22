/**
 * swarf grid fade — adds a soft distance-based fog to the 3D scene so the
 * grid (and the floor numbers) gently fade as they get further from the
 * loaded part. Tied to the part's bounding-box size: small parts get a
 * tight fade radius (Phil's note: a 25mm cube should look crisp near the
 * part, ~50% more translucent at the edges of the bed); large parts get
 * a wider radius so the workspace doesn't disappear.
 *
 * Implementation: linear Three.js fog on the scene. Most of Kiri's grid +
 * label materials honor fog by default. The band is set from part size on
 * widget add/delete only, never from the camera, so switching modes (which
 * moves the camera) leaves the floor unchanged.
 */
(function () {
  'use strict';
  if (window.__swarfGridFadeLoaded) return;
  window.__swarfGridFadeLoaded = true;

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
  // three.js fog is measured from the camera. The auto-fit camera sits about
  // 4.2x the part's largest dimension from it, so the clear band runs past the
  // fitted camera plus the part's own depth; the grid fades beyond that.
  // space.js keeps the THREE.Scene private: reach it through a widget mesh.
  function sceneOf(api) {
    for (const w of api.widgets.all()) {
      let o = w.mesh;
      while (o && !o.isScene) o = o.parent;
      if (o) return o;
    }
    return null;
  }

  function applyFog(api, space) {
    if (!space || !space.scene) return;
    const size = widgetSize(api) || 25.4;
    const near = Math.max(size * 5.5, 140);
    const far  = near * 4;
    // neutralise Kiri's camera-relative recompute first, so setFog's own
    // update cannot move the band; then pin it. Idempotent.
    if (!space.scene.__swarfFogPinned) {
      space.scene.updateFog = function () { /* swarf: fog band fixed by part size */ };
      space.scene.__swarfFogPinned = true;
    }
    try { space.scene.setFog && space.scene.setFog(3, FOG_COLOR); } catch (e) {}
    const scene = sceneOf(api);
    if (scene && scene.fog) {
      scene.fog.near = near;
      scene.fog.far  = far;
      scene.fog.color && scene.fog.color.setHex(FOG_COLOR);
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
