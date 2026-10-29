/*
 * swarf quick start — the shop poster ("Run ShopBot with Swarf", KCAD woodshop) as a
 * walk-through in help (Phil 10-28: "Make a quick setup/tutorial feature in help with
 * something adapted from the poster"). Twelve pages: the opening line, five steps of file
 * prep, what to do before you touch the machine, five steps at the machine, and the
 * emergency. A page can carry a "show me" that does or opens the thing it names.
 * Words in <b> are what the student presses or reads in swarf, as on the poster.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = () => window.kiri && window.kiri.api;
  const click = id => { const e = $(id); if (e) e.click(); return !!e; };
  const PAGES = [
    { n: '', h: 'Run ShopBot with Swarf', p: ['From a vector file to a cut part, in ten steps.', 'Open renato.design/swarf in Chrome or Edge: Safari and Firefox can design and export, but only Chrome and Edge can run the ShopBot.', 'Words in <b>bold</b> are what you press or read in swarf.'] },
    { n: 1, h: 'Open Swarf, pick the ShopBot', p: ['<b>setup › machine › ShopBot Basic</b>. The empty bed shows its name and size.'], show: ['use the ShopBot', () => { api().devices.select('ShopBot.Basic'); }] },
    { n: 2, h: 'Open your drawing', p: ['<b>import</b> your .ai, enter your board\'s measured thickness in mm, <b>make parts</b>.', 'Boards ¼ to 2½ in thick; thinner sheet goes to the laser. SVG, DXF, PDF, STL and OBJ open too.'], show: ['open a file', () => click('load-file')] },
    { n: 3, h: 'Check the size', p: ['The size card should match your drawing. If not, type the right size into the card.'], show: ['pick the part', () => { const a = api(), w = a.widgets.all()[0]; if (w) a.platform.select(w); }] },
    { n: 4, h: 'Outline and four tabs', p: ['<b>outline</b> cuts around the outside, right through. <b>tabs › +</b>, click the edge four times, <b>✓</b>.', 'Zero: <b>front-left corner</b>, the default. Material: <b>plywood</b>.'], show: ['add an outline', () => { const el = [...(($('op-add-list') || {}).children || [])].find(c => c.innerText.trim().toLowerCase() === 'outline'); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); const s = $('swarf-material-select'); if (s && [...s.options].some(o => o.value === 'plywood')) { s.value = 'plywood'; s.dispatchEvent(new Event('change', { bubbles: true })); } }] },
    { n: 5, h: 'Toolpaths, then simulate', p: ['<b>toolpaths</b> shows where the bit goes; <b>simulate</b> and watch it cut. Mistakes cost nothing to fix here.'], show: ['make the toolpaths', () => click('act-paths')] },
    { n: '!', h: 'Before you touch the machine', list: ['Faculty or technician permission.', 'Eye and ear protection on; hair, sleeves and cords tied back.', 'Your board labeled, flat, and screwed down clear of the cut.', 'Laptop plugged in and awake; the floor e-stop within reach of your foot.'] },
    { n: 6, h: 'Fit the bit, connect, zero X Y', p: ['Switch the router off at its own switch, then fit the bit swarf names. USB in, <b>connect</b>.', 'No homing: jog the bit to your board\'s front-left corner and press <b>zero x y</b>.'], show: ['open control', () => click('swarf-step-run')] },
    { n: 7, h: 'Zero Z with the plate', p: ['Clip on the black Allen screw in the router\'s side, the plate under the bit, <b>touch off</b>. Then put the plate and clip away.'], show: ['open control', () => click('swarf-step-run')] },
    { n: 8, h: 'Trace, then air cut', p: ['<b>trace</b> runs the outline, <b>air cut</b> the whole file 5 mm up, the bit not spinning. Neither checks clamps: watch.'] },
    { n: 9, h: 'Cut and stay with it', p: ['Dust collection on. <b>cut</b>, tick only what\'s true, then <b>cut</b> again.', 'Any key pauses: router off, bit held. Not an emergency stop.'] },
    { n: 10, h: 'Finish safely', p: ['At <b>Finished</b>: vacuum, raise the bit, unscrew the board. Cut the tabs away from the machine.', 'Bit changed? Zero Z again. More in <b>help › search</b> (the ShopBot at KCAD), or ask the technician.'] },
    { n: '', h: 'Emergency: step on the red floor e-stop', p: ['Keep clear until everything has stopped. Get the technician before restarting.', 'USB lost, e-stop used, or the position unsure? swarf holds everything until you check the machine and press <b>all clear</b>.'], last: true }
  ];
  let at = 0, root = null;
  function build() {
    root = document.createElement('div');
    root.id = 'swarf-tutorial';
    root.innerHTML = '<div class="st-card" role="dialog" aria-modal="true" aria-labelledby="st-h"><div class="st-top"><span class="st-title">ShopBot quick start</span><span class="st-count"></span><button class="st-x" title="close (Esc)">close</button></div><div class="st-body"></div><div class="st-dots"></div><div class="st-row"><button class="st-back">back</button><span class="st-grow"></span><button class="st-show"></button><button class="st-next st-go"></button></div></div>';
    (document.getElementById('app') || document.body).append(root);
    root.querySelector('.st-x').onclick = close;
    root.querySelector('.st-back').onclick = () => go(at - 1);
    root.querySelector('.st-next').onclick = () => (PAGES[at].last ? close() : go(at + 1));
    root.addEventListener('click', e => { if (e.target === root) close(); });
    window.addEventListener('keydown', e => {
      if (!root.classList.contains('on')) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' && !PAGES[at].last) { e.stopPropagation(); go(at + 1); }
      else if (e.key === 'ArrowLeft' && at) { e.stopPropagation(); go(at - 1); }
    }, true);
  }
  function go(i) {
    at = Math.max(0, Math.min(PAGES.length - 1, i));
    const P = PAGES[at];
    const body = root.querySelector('.st-body');
    body.innerHTML = `<div class="st-n${P.n === '!' ? ' warn' : ''}">${P.n}</div><h3 id="st-h">${P.h}</h3>` +
      (P.p ? P.p.map(t => `<p>${t}</p>`).join('') : '') + (P.list ? `<ul>${P.list.map(t => `<li>${t}</li>`).join('')}</ul>` : '');
    root.querySelector('.st-count').textContent = `${at + 1} of ${PAGES.length}`;
    root.querySelector('.st-dots').innerHTML = PAGES.map((_, k) => `<i class="${k === at ? 'on' : ''}"></i>`).join('');
    root.querySelector('.st-back').style.visibility = at ? '' : 'hidden';
    const next = root.querySelector('.st-next');
    next.textContent = P.last ? 'done' : at ? 'next' : 'start';
    const show = root.querySelector('.st-show');
    if (P.show) { show.style.display = ''; show.textContent = P.show[0]; show.onclick = () => { try { P.show[1](); } catch (e) { /* not ready yet */ } close(true); }; }
    else show.style.display = 'none';
    next.focus();
  }
  // "show me" closes the card so the student can do the step; open it again at the same page
  function open(page) {
    if (!root) build();
    root.classList.add('on');
    go(page === undefined ? at : page);
  }
  function close(keepPage) { if (root) root.classList.remove('on'); if (keepPage !== true) { /* the next open starts where it left off */ } }

  const t = setInterval(() => {
    const item = $('swarf-quickstart');
    if (!item) return;
    clearInterval(t);
    item.addEventListener('click', e => { e.stopPropagation(); open(); });
  }, 200);
  window.__swarfTutorial = { open, close, PAGES, page: () => at };
})();
