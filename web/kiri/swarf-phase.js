/**
 * swarf phase aura — adds a subtle workflow-phase indicator to the scene.
 * The body picks up one of swarf-phase-{idle,toolpaths,previewing,simulating,exported}
 * based on api.event signals; CSS paints the difference.
 *
 * Phases (matching the IMPORT · TOOLPATHS · PREVIEW · SIMULATE · EXPORT order):
 *   idle         — nothing happening, neutral tone
 *   toolpaths    — user is editing op params, faint warm breath under chrome
 *   previewing   — preview is computing or just completed
 *   simulating   — animation is running, warmer + chip physics active
 *   exported     — gcode has been exported, scene goes achromatic until the
 *                  user touches something again
 *
 * "Always demonstrate in some subtle way what part of the process it is in."
 * CSS does the heavy lifting — this file only owns the body-class state.
 */
(function () {
  'use strict';
  if (window.__swarfPhaseLoaded) return;
  window.__swarfPhaseLoaded = true;

  const body = document.body;
  const PHASES = ['idle', 'toolpaths', 'previewing', 'simulating', 'exported'];

  function setPhase(p) {
    for (const ph of PHASES) body.classList.remove('swarf-phase-' + ph);
    body.classList.add('swarf-phase-' + p);
  }
  setPhase('idle');

  // any user input clears the achromatic exported veil
  const wakeFromExport = () => {
    if (body.classList.contains('swarf-phase-exported')) setPhase('idle');
  };
  window.addEventListener('mousedown', wakeFromExport, { passive: true });
  window.addEventListener('keydown',   wakeFromExport, { passive: true });
  window.addEventListener('wheel',     wakeFromExport, { passive: true });

  const hook = () => {
    const api = window.kiri && window.kiri.api;
    if (!api || !api.event) return false;

    api.event.on('widget.add',        () => setPhase('toolpaths'));
    api.event.on('cam.op.add',        () => setPhase('toolpaths'));
    api.event.on('slice.begin',       () => setPhase('previewing'));
    api.event.on('slice.end',         () => setPhase('previewing'));
    api.event.on('function.animate',  () => setPhase('simulating'));
    api.event.on('animate',           () => setPhase('simulating'));
    api.event.on('animate.end',       () => setPhase('toolpaths'));
    api.event.on('function.export',   () => setPhase('exported'));
    return true;
  };
  let tries = 0;
  const poll = setInterval(() => {
    if (hook() || ++tries > 100) clearInterval(poll);
  }, 150);
})();
