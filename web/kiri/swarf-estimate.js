/*
 * swarf estimate — how long a machine file takes on the ShopBot, worked out the way control runs it
 * (Phil 11-02: "a machining time estimate for all paths being simulated ... and make sure the
 * estimate that goes in export is accurate as well").
 *
 * The file is read as control reads it (swarf-run-parse.js), each move gets the speed the job plan
 * gives it (swarf-run-plan.js: the machine's own XY and Z limits, rapids at the jog speed), and each
 * run of moves between two switches is timed with the card's own speed profile
 * (swarf-shopbot-card.js Planner.profile: speed rises 3 mm/s per mm, slows by angle at bends, comes
 * to the ramp speed at every switch). Distance over feed alone came out short on rasters and
 * textures, where the bit spends its time speeding up and slowing down.
 *
 *   const e = SwarfEstimate.of(text, { sections: [{ step, line }] })
 *   e.seconds            the whole file, the router's spin-ups and timed pauses included
 *   e.cut / e.air        seconds cutting / moving in the air
 *   e.changes            bit changes (each as long as the person takes; not in seconds)
 *   e.steps              { step index: seconds } when the export said where each step starts
 *   SwarfEstimate.words(s)  "about 14 min"
 */
(function (root) {
  'use strict';

  // the shop's ShopBot as swarf-shopbot-direct.js drives it (rapids at the jog speed)
  const SHOP = {
    move: { xy: 76.2, z: 25.4 }, rapid: { xy: 100, z: 100 },
    rampSpeed: 10.16, rampRate: 5.08, spinUp: 3,
    unit: { x: 72.183661, y: 72.183661, z: 90.229567 }
  };

  // seconds for one segment of a profile: up from vStart at k per mm, at most the feed, down to vEnd
  function segSeconds(s, k) {
    const L = s.len, F = Math.max(1e-3, s.feed);
    const a = Math.max(1e-3, Math.min(s.vStart, F)), b = Math.max(1e-3, Math.min(s.vEnd, F));
    const vp = Math.max(a, b, Math.min(F, (a + b + k * L) / 2));
    const s1 = (vp - a) / k, s3 = (vp - b) / k, s2 = Math.max(0, L - s1 - s3);
    return Math.log(vp / a) / k + Math.log(vp / b) / k + s2 / vp;
  }

  function of(text, opts = {}) {
    const P = root.SwarfRunParse || (typeof require === 'function' && require('./swarf-run-parse.js'));
    const Card = root.ShopBotCard || (typeof require === 'function' && require('./swarf-shopbot-card.js'));
    const cfg = Object.assign({}, SHOP, opts.cfg || {});
    const out = { seconds: 0, cut: 0, air: 0, dwell: 0, changes: 0, steps: {}, moves: 0 };
    if (!P || !Card || !text) return out;
    const parsed = typeof text === 'string' ? P.parse(text, { machineUnits: 'mm' }) : text;
    const planner = new Card.Planner({ unit: cfg.unit, rampSpeed: cfg.rampSpeed, rampRate: cfg.rampRate });
    const k = planner.k;
    // the step each line belongs to, from where the export said each step starts
    const secs = (opts.sections || []).filter(s => s && s.step != null).slice().sort((a, b) => a.line - b.line);
    const stepOf = line => { let st = null; for (const s of secs) { if (s.line <= line) st = s.step; else break; } return st; };
    const add = (step, t, kind) => {
      out.seconds += t; out[kind] += t;
      if (step != null) out.steps[step] = (out.steps[step] || 0) + t;
    };
    const events = parsed.events.slice().sort((a, b) => a.line - b.line);
    const M = parsed.moves;
    if (!M.length) return out;
    // the job starts over its first point at the safe height (the plan's entry lifts and goes over)
    let from = { x: M[0].x0, y: M[0].y0, z: M[0].z0 }, run = [];
    const flush = () => {
      if (!run.length) return;
      const segs = planner.profile(run, from);
      for (const s of segs) add(s.mv.step, segSeconds(s, k), s.mv.air ? 'air' : 'cut');
      from = run[run.length - 1];
      run = [];
    };
    let router = false, e = 0, moved = false;
    const event = ev => {
      const kk = ev.kind, step = stepOf(ev.line);
      const say = on => { if (on === router) return; flush(); router = on; if (on) add(step, cfg.spinUp, 'dwell'); };
      if (kk === 'spindle-on') say(true);
      else if (kk === 'spindle-off') say(false);
      else if (kk === 'output' && ev.value[0] === 1) say(ev.value[1] === 1);
      else if (kk === 'output' && ev.value[0] >= 2 && ev.value[0] <= 12) flush();
      else if (kk === 'pause' && ev.value > 0) { flush(); add(step, ev.value, 'dwell'); }
      // the first bit's load, before anything has moved, is not a change (control holds only after a move)
      else if (kk === 'tool-change') { flush(); if (moved) out.changes++; }
    };
    for (const m of M) {
      while (e < events.length && events[e].line < m.line) event(events[e++]);
      // the plan's speed for this move (swarf-run-plan.js build)
      let feed = m.rapid ? (m.z !== m.z0 && m.x === m.x0 && m.y === m.y0 ? cfg.rapid.z : cfg.rapid.xy) : (m.feed || cfg.move.xy);
      if (!m.rapid) {
        const L = Math.hypot(m.x - m.x0, m.y - m.y0, m.z - m.z0), dz = Math.abs(m.z - m.z0);
        feed = Math.min(feed, cfg.move.xy);
        if (dz > 1e-9 && L > 0) feed = Math.min(feed, cfg.move.z * L / dz);
      }
      run.push({ x: m.x, y: m.y, z: m.z, feed, step: stepOf(m.line), air: !!m.rapid });
      moved = true;
      out.moves++;
    }
    while (e < events.length) event(events[e++]);
    flush();
    return out;
  }

  // "under a minute", "about 14 min", "about 1 h 05 min"
  function words(sec) {
    const t = Math.round(sec || 0);
    if (t < 60) return 'under a minute';
    const m = Math.round(t / 60);
    if (m < 60) return `about ${m} min`;
    return `about ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  }
  // short, for a step card or the bar: "40 s", "14 min", "1 h 05"
  function short(sec) {
    const t = Math.round(sec || 0);
    if (t < 60) return `${Math.max(1, t)} s`;
    const m = Math.round(t / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  }

  const api = { of, words, short, segSeconds, SHOP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SwarfEstimate = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---- on the page: the sim bar's time, each step card's share, and export's (same number) ----
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const E = window.SwarfEstimate;
  const S = { sig: null, est: null, busy: false, frac: 0, again: false };
  const api = () => window.kiri && window.kiri.api;
  const current = () => { const a = api(); try { return !!(S.est && a && a.function.workSig && S.sig === a.function.workSig()); } catch (e) { return false; } };

  // the machine file, made quietly from the toolpaths on screen, then timed
  function request() {
    const a = api();
    if (!a || !a.function || !a.function.estimateFile) return;
    if (S.busy) { S.again = true; return; }
    S.busy = true;
    a.function.estimateFile((text, starts, sig) => {
      // the timing waits for a quiet moment: a texture's file can be long
      const go = () => {
        S.busy = false;
        if (text) { S.est = E.of(text, { sections: starts || [] }); S.sig = sig; S.frac = 0; }
        paint();
        if (S.again) { S.again = false; request(); }
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 800 }); else setTimeout(go, 0);
    });
  }

  function breakdown(est) {
    const m = s => E.short(s);
    const parts = [`cutting ${m(est.cut)}`, `in the air ${m(est.air)}`];
    if (est.dwell >= 1) parts.push(`the router starting ${m(est.dwell)}`);
    let t = `How long the ShopBot takes for the ticked parts and steps: ${parts.join(', ')}. It counts the bit speeding up and slowing at bends, as control runs it.`;
    if (est.changes) t += ` Plus ${est.changes} bit change${est.changes > 1 ? 's' : ''}, as long as you take.`;
    return t;
  }

  let el = null;
  function bar() {
    const row = document.getElementById('layer-animate');
    if (!row) return null;
    if (!el || !el.isConnected) {
      el = document.createElement('span');
      el.className = 'swarf-sim-extra swarf-sim-time';
      el.setAttribute('aria-live', 'off');
    }
    // after the bar's last toggle (machine is added after this file runs)
    const extras = row.querySelectorAll('.swarf-sim-extra:not(.swarf-sim-time)');
    const after = extras[extras.length - 1];
    if (after && after.nextSibling !== el) after.after(el);
    else if (!after && !el.isConnected) row.appendChild(el);
    return el;
  }

  function paint() {
    const ok = current(), est = ok ? S.est : null;
    const b = bar();
    if (b) {
      if (!est) { b.textContent = ''; b.title = ''; b.hidden = true; }
      else {
        b.hidden = false;
        const left = S.frac > 0.001 && S.frac < 0.999 ? ` · ${E.short(est.seconds * (1 - S.frac))} left` : '';
        b.textContent = E.words(est.seconds) + (est.changes ? ` + ${est.changes} bit change${est.changes > 1 ? 's' : ''}` : '') + left;
        b.title = breakdown(est);
      }
    }
    for (const t of document.querySelectorAll('#oplist .swarf-op-time')) {
      const sec = est ? est.steps[t.dataset.step] : undefined;
      t.textContent = sec > 0 ? E.short(sec) : '';
      t.title = sec > 0 ? `about ${E.short(sec)} on the ShopBot` : '';
    }
  }

  window.SwarfEstimateUI = {
    paint,
    request,
    // export timed the file itself: the same number, kept for the bar and the cards
    fromExport(est) { const a = api(); try { S.sig = a.function.workSig(); S.est = est; S.frac = 0; paint(); } catch (e) { /* no cam */ } },
    simAt(frac) { const was = S.frac; S.frac = frac; if (Math.abs(frac - was) > 0.002 || frac >= 0.999) paint(); },
    state: () => ({ sig: S.sig, est: S.est, current: current(), frac: S.frac, text: el ? el.textContent : '' })
  };

  const hook = () => {
    const a = api();
    if (!a || !a.event) return false;
    a.event.on('preview.end', () => setTimeout(request, 250));
    for (const ev of ['slice.begin', 'function.animate', 'animate.end']) a.event.on(ev, () => { S.frac = 0; setTimeout(paint, 0); });
    // an edit (a step, a part moved or left out) makes the toolpaths old: the time goes with them
    setInterval(() => { if (S.est) paint(); }, 1500);
    return true;
  };
  let tries = 0;
  const poll = setInterval(() => { if (hook() || ++tries > 100) clearInterval(poll); }, 150);
})();
