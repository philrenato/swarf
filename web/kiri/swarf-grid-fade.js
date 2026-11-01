/**
 * swarf grid fade: a linear THREE.Fog on the scene so the grid and floor numbers fade with
 * distance from what the camera looks at, its band sized by the parts on the bed. Re-applied
 * on widget.add / widget.delete and when the skin changes.
 */
(function () {
  'use strict';
  if (window.__swarfGridFadeLoaded) return;
  window.__swarfGridFadeLoaded = true;

  // the color the grid fades into: the skin's background (swarf-skin.js), the red sky's warm black by default
  const fogColor = () => window.SwarfSkin ? window.SwarfSkin.color('fog', 0x0a0808) : 0x0a0808;

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

  // the band past the camera's target distance (see updateFog below)
  const FOG = { near: 120, far: 480 };
  // space keeps its THREE.Scene private: the platform's root is it
  const scenes = space => {
    const out = [space.world && space.world.scene, space.scene && (space.scene.scene || space.scene._scene)].filter(Boolean);
    try { let o = space.internals().platform; while (o && o.parent) o = o.parent; if (o && o.isScene && !out.includes(o)) out.push(o); } catch (e) { /* not built yet */ }
    return out;
  };
  function applyFog(api, space) {
    if (!space || !space.scene) return;
    const THREE = window.THREE;
    if (!THREE) return;
    const size = widgetSize(api) || 25.4;
    // near: a generous crisp radius around the part; far: where the grid is gone
    const near = Math.max(size * 4, 120);
    const far  = Math.max(size * 18, near * 4);
    // setFog works through space's API; then we pin near/far ourselves.
    try { space.scene.setFog && space.scene.setFog(3, fogColor()); } catch (e) {}
    try {
      const all = scenes(space);
      for (const s of all) {
        if (s && s.fog) {
          s.fog.near = near;
          s.fog.far  = far;
          s.fog.color && s.fog.color.setHex(fogColor());
        }
      }
    } catch (e) {}
    // 10-27 (Phil: "when done drawing and we zoom away things are too dark"):
    // three's fog counts from the CAMERA, so a fixed near/far fogged the whole
    // view, part and all, once you zoomed out past it. Kiri's own recompute
    // puts fog.near at the camera-to-target distance; ride on that and add our
    // band, so the fade sits the same distance from what you are looking at
    // at any zoom (and the floor still reads the same in every mode).
    FOG.near = near; FOG.far = far;
    if (space.scene && !space.scene.__swarfFogPinned) {
      const kiri = space.scene.updateFog;
      space.scene.updateFog = function () {
        try { kiri.call(this); } catch (e) { /* no camera yet */ }
        for (const s of scenes(space)) {
          if (!s.fog) continue;
          const dist = s.fog.near;               // kiri: the camera's distance to its target
          s.fog.near = dist + FOG.near;
          s.fog.far = dist + FOG.far;
        }
      };
      space.scene.__swarfFogPinned = true;
    }
    try { space.scene.updateFog(); } catch (e) {}
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
      window.addEventListener('swarf.skin', () => applyFog(api, space));
      // not on animate: Phil (v010-r10), "the floor must be IDENTICAL across modes"
    }
    if (++tries > 200) clearInterval(poll);
  }, 150);
})();
