/**
 * swarf sky animator.
 * Procedural cloud drift + working-state fog speedup + camera parallax.
 *
 * What this does (all driven off the body background defined in swarf.css):
 *   - Always-on slow drift (CSS keyframe via .swarf-sky-drift on body).
 *   - Speeds up (.swarf-sky-working) during slice / prepare / animate so the
 *     fog visibly churns while swarf is computing toolpaths or simulating.
 *   - Camera rotation parallax: hooks mouse-drag in the 3D viewport and
 *     nudges --swarf-sky-parallax-x on body; CSS uses that to shift the
 *     cloud layer's background-position, giving the sky a subtle lag
 *     relative to the scene.
 *
 * The cloud layer is already procedural (SVG feTurbulence is computed by the
 * browser, not a raster). We leave the turbulence as-is and animate the
 * background-position so the clumps appear to drift over time.
 */
(function () {
  'use strict';
  if (window.__swarfSkyLoaded) return;
  window.__swarfSkyLoaded = true;

  const body = document.body;
  if (!body.classList.contains('swarf-sky-drift')) {
    body.classList.add('swarf-sky-drift');
  }

  // ---- parallax on viewport drag ----------------------------------------
  // We don't have a clean camera-rotate event, so we track mouse drag deltas
  // over #container and accumulate into two CSS custom properties. CSS
  // consumes them as a background-position offset.
  let parX = 0, parY = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;
  const container = document.getElementById('container') || document.body;
  const setParallax = () => {
    body.style.setProperty('--swarf-sky-parallax-x', parX.toFixed(1) + 'px');
    body.style.setProperty('--swarf-sky-parallax-y', parY.toFixed(1) + 'px');
  };
  setParallax();
  // swarf r5: mouse-drag parallax retired in favor of camera-orbit polling
  // below (works with trackpad pinch, keyboard orbit, programmatic moves).
  // Kept here as a commented fallback for reference only.
  // container.addEventListener('mousedown', ...);
  // window.addEventListener('mousemove', ...);
  // window.addEventListener('mouseup', ...);
  void dragging; void lastX; void lastY; void parX; void parY; void setParallax; void container;

  // ---- working-state fog speedup ----------------------------------------
  // Hook via api.event when available (Kiri exposes it on window.kiri after boot).
  // Polling wait until kiri.api is wired, then subscribe.
  const hook = () => {
    const kiri = window.kiri;
    const api = kiri && kiri.api;
    if (!api || !api.event) return false;
    const setWorking = (on) => {
      if (on) body.classList.add('swarf-sky-working');
      else body.classList.remove('swarf-sky-working');
    };
    // swarf r6: force the default seed cube to read "Kiri_Cube" in the
    // OBJECTS panel — checkSeed's rename only runs for fresh empty profiles;
    // catalog-loaded widgets or reloads need this hook to catch up.
    const renameSeed = (added) => {
      try {
        const list = Array.isArray(added) ? added : [added];
        for (const w of list) {
          if (!w) continue;
          const isSeed = (w.meta && w.meta.swarfSeed) ||
                         (w.mesh && w.mesh.userData && w.mesh.userData.swarfSeed) ||
                         (w.meta && (w.meta.file === 'cube' || !w.meta.file));
          if (isSeed) {
            w.meta = w.meta || {};
            w.meta.file = 'Kiri_Cube';
            w.meta.swarfSeed = true;
          }
        }
        // patch the already-rendered OBJECTS panel directly — platform.js
        // calls changed() BEFORE widget.add emits, so the panel shows the
        // old name by the time our hook runs. Rewrite matching DOM text.
        try {
          const nameBtns = document.querySelectorAll('#ws-widgets button.name');
          for (const btn of nameBtns) {
            const t = btn.textContent.trim();
            if (t === 'no name' || t === 'cube' || !t) btn.textContent = 'Kiri_Cube';
          }
        } catch (e) {}
        try { api.event.emit('widget.rename'); } catch (e) {}
      } catch (e) { console.warn('swarf: renameSeed failed', e); }
    };
    try {
      const all = api.widgets && api.widgets.all && api.widgets.all();
      if (all && all.length) renameSeed(all);
    } catch (e) {}
    api.event.on('widget.add', renameSeed);

    api.event.on('slice.begin',   () => setWorking(true));
    api.event.on('slice.end',     () => setTimeout(() => setWorking(false), 400));
    api.event.on('slice.error',   () => setWorking(false));
    // animate / simulate start: Kiri emits 'preview' + 'animate' events;
    // hook cautiously — unknown events are no-ops.
    try { api.event.on('animate', () => setWorking(true)); } catch (e) {}
    try { api.event.on('animate.end', () => setWorking(false)); } catch (e) {}

    // swarf r5: one-shot migration — force TAGS (cam-tabs) and STRATEGY
    // (cam-output) drawers to start closed for existing profiles that had
    // them open from earlier builds.
    // swarf r6: force TAGS (cam-tabs) + STRATEGY (cam-output) drawers closed.
    // settings.hidden is top-level, NOT under controller — earlier r5 migration
    // wrote to the wrong path. Run every load (cheap) until we know profiles
    // are consistent, then gate via localStorage.
    try {
      const MIG = 'swarf.r6.drawers-closed';
      if (api.conf && api.conf.get) {
        const s = api.conf.get();
        if (s) {
          s.hidden = s.hidden || {};
          s.hidden['cam-tabs']   = true;
          s.hidden['cam-output'] = true;
          if (api.uc && api.uc.setHidden) api.uc.setHidden(s.hidden);
          if (api.conf.save) api.conf.save();
        }
        if (!localStorage.getItem(MIG)) localStorage.setItem(MIG, '1');
      }
    } catch (e) { console.warn('swarf: drawers migration failed', e); }

    // swarf r6: force MR-1 as the selected CAM device on first load (Phil
    // markup). Selection lives in `filter.CAM` (a string device name);
    // `cdev.CAM` is the expanded device CONFIG object and must not be a
    // string — earlier attempt set it to "Langmuir.MR-1" and broke load.
    try {
      const MIG_MR1 = 'swarf.r6.filter-mr1';
      if (!localStorage.getItem(MIG_MR1) && api.conf && api.conf.get) {
        const s = api.conf.get();
        if (s && s.filter) {
          s.filter.CAM = 'Langmuir.MR-1';
          if (api.conf.save) api.conf.save();
        }
        localStorage.setItem(MIG_MR1, '1');
      }
    } catch (e) {}

    // swarf r5: force animation-mesh density down for stored profiles. Upstream
    // Kiri defaults animesh to "800"; swarf r5 lowers it to "500" (grid density
    // is (animesh · stockArea)² so this ~2× speeds up "building animation").
    // defaults.js only helps fresh profiles — this migration catches everyone.
    try {
      const MIG2 = 'swarf.r5.animesh-500';
      if (!localStorage.getItem(MIG2) && api.conf && api.conf.get) {
        const s = api.conf.get();
        if (s && s.controller) {
          const cur = parseInt(s.controller.animesh || '0');
          if (!cur || cur > 500) {
            s.controller.animesh = '500';
            if (api.conf.save) api.conf.save();
          }
        }
        localStorage.setItem(MIG2, '1');
      }
    } catch (e) {}

    return true;
  };

  // swarf r6: camera-aware fog — run independently of api.event so we retry
  // until window.moto.space is populated. Earlier we gated this inside hook()
  // and returned true unconditionally, meaning if moto.space came online late
  // the camera poll never started. Now it has its own poller and sets up once.
  let cameraAttached = false;
  let cameraTries = 0;
  const TAU = Math.PI * 2;
  const shortestDelta = (a, b) => {
    let d = a - b;
    if (d >  Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  const attachCameraParallax = () => {
    if (cameraAttached) return true;
    const space = window.moto && window.moto.space;
    if (!space || !space.view || typeof space.view.save !== 'function') return false;
    cameraAttached = true;
    let lastL = null, lastU = null, lastScale = null;
    let cx = 0, cy = 0;
    let logged = false;
    const tick = () => {
      try {
        const p = space.view.save();
        if (p && typeof p.left === 'number' && typeof p.up === 'number') {
          if (!logged) {
            console.log('swarf-sky: camera parallax online', p);
            logged = true;
          }
          if (lastL !== null) {
            const dL = shortestDelta(p.left, lastL);
            const dU = p.up - lastU;
            // 1 rad orbit = ~900px sideways shift, ~600px vertical
            cx += dL * 900;
            cy += dU * 600;
            // zoom also nudges sky — feeling of 3D depth response
            if (typeof p.scale === 'number' && lastScale !== null) {
              const dS = p.scale - lastScale;
              cy -= dS * 400;
            }
            cx = ((cx % 1024) + 1024) % 1024;
            cy = ((cy % 1024) + 1024) % 1024;
            body.style.setProperty('--swarf-sky-parallax-x', cx.toFixed(1) + 'px');
            body.style.setProperty('--swarf-sky-parallax-y', cy.toFixed(1) + 'px');
          }
          lastL = p.left;
          lastU = p.up;
          if (typeof p.scale === 'number') lastScale = p.scale;
        }
      } catch (e) {}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  };
  const camPoll = setInterval(() => {
    if (attachCameraParallax() || ++cameraTries > 200) clearInterval(camPoll);
  }, 100);
  let tries = 0;
  const poll = setInterval(() => {
    if (hook() || ++tries > 50) clearInterval(poll);
  }, 200);
})();
