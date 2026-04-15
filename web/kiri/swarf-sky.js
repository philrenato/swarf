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
    try {
      const MIG = 'swarf.r5.drawers-closed';
      if (!localStorage.getItem(MIG) && api.conf && api.conf.get) {
        const s = api.conf.get();
        if (s && s.controller) {
          s.controller.hidden = s.controller.hidden || {};
          s.controller.hidden['cam-tabs']   = true;
          s.controller.hidden['cam-output'] = true;
          if (api.uc && api.uc.setHidden) api.uc.setHidden(s.controller.hidden);
          if (api.conf.save) api.conf.save();
        }
        localStorage.setItem(MIG, '1');
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

    // swarf r5: camera-aware fog. We replace the mouse-drag parallax with
    // real camera-orbit awareness by polling moto.space.view.save() for the
    // camera's azimuth ('left') and elevation ('up') angles. When those
    // change, drive --swarf-sky-parallax-x/y so the sky counter-rotates
    // like a backdrop at infinity.
    try {
      const space = window.moto && window.moto.space;
      if (space && space.view && space.view.save) {
        let lastL = null, lastU = null;
        let cx = 0, cy = 0;
        const TAU = Math.PI * 2;
        const sign = v => v < 0 ? -1 : 1;
        const shortestDelta = (a, b) => {
          let d = a - b;
          if (d >  Math.PI) d -= TAU;
          if (d < -Math.PI) d += TAU;
          return d;
        };
        const tick = () => {
          try {
            const p = space.view.save();
            if (p && typeof p.left === 'number' && typeof p.up === 'number') {
              if (lastL !== null) {
                const dL = shortestDelta(p.left, lastL);
                const dU = p.up - lastU;
                // azimuth → horizontal parallax; elevation → vertical
                // scale: 1 rad ≈ 500px of sky shift, damped to match the
                // old mouse parallax feel.
                cx += dL * 500;
                cy += dU * 300;
                cx = ((cx % 1024) + 1024) % 1024;
                cy = ((cy % 1024) + 1024) % 1024;
                body.style.setProperty('--swarf-sky-parallax-x', cx.toFixed(1) + 'px');
                body.style.setProperty('--swarf-sky-parallax-y', cy.toFixed(1) + 'px');
              }
              lastL = p.left;
              lastU = p.up;
            }
          } catch (e) {}
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    } catch (e) {}

    return true;
  };
  let tries = 0;
  const poll = setInterval(() => {
    if (hook() || ++tries > 50) clearInterval(poll);
  }, 200);
})();
