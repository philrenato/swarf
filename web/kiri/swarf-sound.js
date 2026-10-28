/*
 * swarf sound — four short cues for CONTROL, made by the browser (no files), on the real
 * machine only (Phil 10-28: ShopBot's own are "obnoxious"; a few where sound tells what the
 * screen cannot):
 *   move     a rising two-note cue: the machine is about to move (people near it, not only the
 *            one at the laptop, should know)
 *   router   a low double pulse: the router is about to start (after that, at ~90 dB, nobody
 *            hears a laptop anyway)
 *   fault    a falling three-note alert, repeated softly every 6 s until "all clear"
 *   done     one soft chime: the job finished, the student can walk over
 * Never for jogs, clicks, cam or the simulator. Volume and mute live in localStorage
 * (swarf-sound: 0 = off, else 0..1) and in the jog box's "sounds" chip.
 * A sound is a layer on top of the cards and the floor e-stop, never instead of them.
 */
(function (root) {
  'use strict';
  const KEY = 'swarf-sound';
  let ctx = null, faultT = 0;
  const level = () => { try { const v = localStorage.getItem(KEY); return v === null ? 0.6 : Math.max(0, Math.min(1, +v)); } catch (e) { return 0.6; } };
  function audio() {
    if (!ctx) { const A = root.AudioContext || root.webkitAudioContext; if (!A) return null; ctx = new A(); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // one soft tone: a triangle wave with a quick rise and an even fall, no clicks
  function tone(a, f, t0, dur, vol) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const SEQ = {
    move:   [[660, 0, 0.14], [880, 0.16, 0.22]],
    router: [[196, 0, 0.18], [196, 0.26, 0.24]],
    fault:  [[880, 0, 0.16], [740, 0.2, 0.16], [587, 0.4, 0.3]],
    done:   [[523, 0, 0.5], [784, 0.12, 0.7]]
  };
  function play(name) {
    const v = level();
    if (!v || !SEQ[name]) return false;
    const a = audio();
    if (!a) return false;
    const t = a.currentTime + 0.02, vol = 0.18 * v;
    for (const [f, dt, d] of SEQ[name]) tone(a, f, t + dt, d, vol);
    return true;
  }
  // the fault alert repeats until it is cleared
  function fault(on) {
    clearInterval(faultT); faultT = 0;
    if (on) { play('fault'); faultT = setInterval(() => play('fault'), 6000); }
  }
  function set(v) { try { localStorage.setItem(KEY, String(v)); } catch (e) { /* private window */ } }
  root.SwarfSound = { play, fault, level, set, faulting: () => !!faultT };
})(window);
