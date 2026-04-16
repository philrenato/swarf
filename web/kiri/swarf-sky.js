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
  // swarf-sky-drift class removed in r12 — sky animation now only runs
  // during swarf-sky-working (simulate/slice). No always-on drift.

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
    // swarf v010 r8: working-sky accelerated drift ("smoke/fog") only in
    // expert mode. Default users don't see it.
    const setWorking = (on) => {
      const expert = body.classList.contains('swarf-expert');
      if (on && expert) body.classList.add('swarf-sky-working');
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
          // swarf v010: tightened — ONLY rename to Kiri_Cube if the widget is
          // explicitly flagged as the seed (via meta.swarfSeed or
          // mesh.userData.swarfSeed). An imported STL with no name is NOT the
          // seed and must not be clobbered.
          const isSeed = (w.meta && w.meta.swarfSeed) ||
                         (w.mesh && w.mesh.userData && w.mesh.userData.swarfSeed);
          if (isSeed) {
            w.meta = w.meta || {};
            w.meta.file = 'Kiri_Cube';
            w.meta.swarfSeed = true;
          }
        }
        // patch the already-rendered OBJECTS panel directly — platform.js
        // calls changed() BEFORE widget.add emits, so the panel shows the
        // old name by the time our hook runs. Rewrite matching DOM text.
        // swarf v010: DOM patch only runs when we actually renamed a seed
        // widget this call — not on every widget.add, or a fresh unnamed
        // STL import gets relabeled Kiri_Cube.
        const renamedAny = list.some(w => w && w.meta && w.meta.swarfSeed);
        if (renamedAny) try {
          const nameBtns = document.querySelectorAll('#ws-widgets button.name');
          for (const btn of nameBtns) {
            const t = btn.textContent.trim();
            if (t === 'no name' || !t) btn.textContent = 'Kiri_Cube';
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

    // swarf r12+: profile reset. Wipe ws-settings AND IndexedDB, then
    // reload so the delete completes before Kiri re-opens the DB.
    // BUMPED r14: stale profiles from r12/r13 carried over ops/settings
    // that defeated r14's rough-op auto-add (user clicked TOOLPATHS,
    // nothing rendered). Fresh profile forces the r14 code path.
    try {
      const MIG_R12 = 'swarf.r14.profile-reset-v8';
      if (!localStorage.getItem(MIG_R12)) {
        localStorage.removeItem('ws-settings');
        // mark BEFORE reload so we don't loop
        localStorage.setItem(MIG_R12, '1');
        // delete the IDB and reload — deleteDatabase won't complete
        // while the current page holds an open connection, so we
        // must reload to close it and let the delete land.
        const req = indexedDB.deleteDatabase('kiri');
        req.onsuccess = req.onerror = req.onblocked = () => {
          console.log('swarf r12: IDB deleted, reloading');
          location.reload();
        };
        // if callbacks don't fire within 500ms, reload anyway
        setTimeout(() => location.reload(), 500);
        return true; // skip remaining hook() work
      }
    } catch (e) { console.warn('swarf: r12 profile reset failed', e); }

    // expose a manual reset for Help → Reset Profile
    window.__swarfResetProfile = function () {
      localStorage.removeItem('ws-settings');
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('swarf.')) localStorage.removeItem(k);
      });
      const req = indexedDB.deleteDatabase('kiri');
      req.onsuccess = req.onerror = req.onblocked = () => location.reload();
      setTimeout(() => location.reload(), 500);
    };

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
    let parallaxRunning = false;
    const tick = () => {
      if (!parallaxRunning) return;
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
            cx += dL * 900;
            cy += dU * 600;
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
      setTimeout(() => requestAnimationFrame(tick), 33);
    };
    // only run the parallax loop during simulate — saves CPU when idle.
    // swarf-phase.js sets body classes; listen for simulate start/stop.
    const startParallax = () => { if (!parallaxRunning) { parallaxRunning = true; requestAnimationFrame(tick); } };
    const stopParallax  = () => { parallaxRunning = false; };
    try {
      const api = window.kiri && window.kiri.api;
      if (api && api.event) {
        api.event.on('animate',       startParallax);
        api.event.on('animate.end',   stopParallax);
        api.event.on('slice.begin',   startParallax);
        api.event.on('slice.end',     stopParallax);
      }
    } catch (e) {}
    window.addEventListener('swarf.clear', stopParallax);
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
