/*
 * swarf modes — cam, draw, tex and control as modes of one step row (Phil 10-28: "When
 * control is active, make the rest of the tools in that row … collapse into a new CAM
 * button … Mirror this in all modes so they are focused on their task but allow user to
 * switch"). In cam the row is cam's steps, then draw, tex and control. In draw, tex or
 * control the row folds to those four with cam, the one you are in lit. Pressing another one
 * leaves this mode the way its own buttons would: draw and tex keep their changes (as done
 * does), control will not leave while a job runs.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const body = document.body;
  // TEX (swarf-tex.js) wears DRAW's board and its body class too, so it is asked first
  function mode() {
    return body.classList.contains('swarf-run-open') ? 'control' : body.classList.contains('swarf-tex-open') ? 'tex' : body.classList.contains('swarf-draw-open') ? 'draw' : 'cam';
  }
  // DRAW sits under the step row, as control does, so the row can switch modes
  function placeDraw() {
    const d = $('swarf-draw'), tools = $('mode-tools');
    if (!d || !tools) return;
    d.style.top = Math.round(tools.getBoundingClientRect().bottom) + 'px';   // no band of the 3D scene between (Fable review 3 #18)
  }
  let last = '';
  function sync() {
    const m = mode();
    // DRAW builds a new sheet every time it opens: place each one, even when a close and an
    // open land in one batch and the mode never seems to change (the sheet sat under the row)
    if (m === 'draw' || m === 'tex') { placeDraw(); requestAnimationFrame(placeDraw); }
    if (m === last) return;
    last = m;
    body.classList.toggle('swarf-focus', m !== 'cam');
    body.dataset.swarfMode = m;
    const draw = $('swarf-step-draw'), tex = $('swarf-step-tex');
    if (draw) draw.classList.toggle('swarf-step-on', m === 'draw');
    if (tex) tex.classList.toggle('swarf-step-on', m === 'tex');
  }
  // leaving draw: as done does. A drawing that can't be made (a crossing) keeps draw open and says why.
  function leaveDraw() {
    const D = window.__swarfDraw;
    if (!D || !D.state()) return true;
    D.close(true);
    return !D.state();
  }
  // leaving tex: as done does (it always closes)
  function leaveTex() {
    const X = window.__swarfTex;
    if (!X || !X.state()) return true;
    X.close(true);
    return !X.state();
  }
  let tries = 0;
  const t = setInterval(() => {
    const tools = $('mode-tools'), cam = $('swarf-step-cam');
    if ((tools && cam && body) || ++tries > 200) {
      clearInterval(t);
      if (!tools || !cam) return;
      new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ['class'], childList: true });
      window.addEventListener('resize', () => { if (mode() === 'draw' || mode() === 'tex') placeDraw(); });
      // first in the capture order: draw or tex closes before control or cam take the press
      tools.addEventListener('click', e => {
        const step = e.target.closest('#mode-tools > span');
        const m = mode();
        if (!step || (m !== 'draw' && m !== 'tex')) return;
        if (step.id === `swarf-step-${m}`) { e.stopPropagation(); return; }
        if (!(m === 'tex' ? leaveTex() : leaveDraw())) { e.stopPropagation(); e.preventDefault(); }
      }, true);
      cam.addEventListener('click', () => {
        if (mode() === 'control' && window.__swarfRun) window.__swarfRun.close();   // refuses, and says so, while a job runs
      });
      sync();
    }
  }, 150);
  window.__swarfModes = { mode };
})();
