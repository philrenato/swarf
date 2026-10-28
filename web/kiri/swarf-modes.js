/*
 * swarf modes — cam, draw and control as three modes of one step row (Phil 10-28: "When
 * control is active, make the rest of the tools in that row … collapse into a new CAM
 * button … Mirror this in all modes so they are focused on their task but allow user to
 * switch"). In cam the row is cam's steps, then draw and control. In draw or control the
 * row folds to three: cam, draw, control, the one you are in lit. Pressing another one
 * leaves this mode the way its own buttons would: draw keeps its changes (as done does),
 * control will not leave while a job runs.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const body = document.body;
  function mode() {
    return body.classList.contains('swarf-run-open') ? 'control' : body.classList.contains('swarf-draw-open') ? 'draw' : 'cam';
  }
  // DRAW sits under the step row, as control does, so the row can switch modes
  function placeDraw() {
    const d = $('swarf-draw'), tools = $('mode-tools');
    if (!d || !tools) return;
    d.style.top = Math.round(tools.getBoundingClientRect().bottom) + 8 + 'px';
  }
  let last = '';
  function sync() {
    const m = mode();
    if (m === last) return;
    last = m;
    body.classList.toggle('swarf-focus', m !== 'cam');
    body.dataset.swarfMode = m;
    const draw = $('swarf-step-draw');
    if (draw) draw.classList.toggle('swarf-step-on', m === 'draw');
    if (m === 'draw') requestAnimationFrame(placeDraw);
  }
  // leaving draw: as done does. A drawing that can't be made (a crossing) keeps draw open and says why.
  function leaveDraw() {
    const D = window.__swarfDraw;
    if (!D || !D.state()) return true;
    D.close(true);
    return !D.state();
  }
  let tries = 0;
  const t = setInterval(() => {
    const tools = $('mode-tools'), cam = $('swarf-step-cam');
    if ((tools && cam && body) || ++tries > 200) {
      clearInterval(t);
      if (!tools || !cam) return;
      new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ['class'] });
      window.addEventListener('resize', () => { if (mode() === 'draw') placeDraw(); });
      // first in the capture order: draw closes before control or cam take the press
      tools.addEventListener('click', e => {
        const step = e.target.closest('#mode-tools > span');
        if (!step || mode() !== 'draw') return;
        if (step.id === 'swarf-step-draw') { e.stopPropagation(); return; }
        if (!leaveDraw()) { e.stopPropagation(); e.preventDefault(); }
      }, true);
      cam.addEventListener('click', () => {
        if (mode() === 'control' && window.__swarfRun) window.__swarfRun.close();   // refuses, and says so, while a job runs
      });
      sync();
    }
  }, 150);
  window.__swarfModes = { mode };
})();
