/**
 * swarf-phone.js — phone/narrow-viewport takeover.
 *
 * swarf is a desktop CAM interface: 3D orbit, precise pointer, drag-to-pan
 * toolpaths, keyboard nudging. None of it survives on a phone. Rather than
 * ship a broken experience, we detect narrow viewports and render a direct
 * "desktop only" takeover with a link back to the marketing page.
 *
 * Pattern borrowed from interfacing's phone-edition banner (see
 * philrenato-web/interfacing/play/js/global-palette.js). Same url-param
 * escape hatches (?phone=1 forces on, ?full=1 forces off), persisted in
 * localStorage so Phil can preview on desktop / override on phone.
 */
(function () {
  'use strict';
  const KEY = 'swarf_phone_mode'; // "auto" | "on" | "off"
  const params = new URLSearchParams(location.search);
  if (params.get('phone') === '1') localStorage.setItem(KEY, 'on');
  if (params.get('full') === '1') localStorage.setItem(KEY, 'off');
  const pref = localStorage.getItem(KEY) || 'auto';

  const MQ = '(max-width: 820px), (pointer: coarse) and (max-width: 1000px)';
  function isNarrow() { return window.matchMedia(MQ).matches; }
  function shouldBlock() {
    if (pref === 'off') return false;
    if (pref === 'on') return true;
    return isNarrow();
  }

  function buildURL(flag) {
    const u = new URL(location.href);
    u.searchParams.delete('phone');
    u.searchParams.delete('full');
    u.searchParams.set(flag, '1');
    return u.pathname + '?' + u.searchParams.toString();
  }

  function mount() {
    if (!document.body) return;
    const block = shouldBlock();
    document.body.classList.toggle('swarf-phone', block);
    if (!block) return;
    if (document.getElementById('swarf-phone-wall')) return;

    const wall = document.createElement('div');
    wall.id = 'swarf-phone-wall';
    wall.innerHTML = [
      '<div class="swarf-phone-inner">',
      '  <div class="swarf-phone-mark">',
      '    <span class="swarf-phone-sw">sw</span>',
      '    <span class="swarf-phone-arf">arf</span>',
      '    <sup class="swarf-phone-tm">\u2122</sup>',
      '  </div>',
      '  <div class="swarf-phone-sub">subtractive workshop for resourceful folks</div>',
      '  <div class="swarf-phone-headline">this interface needs a laptop.</div>',
      '  <div class="swarf-phone-body">',
      '    swarf is a CAM workbench &mdash; 3D orbit, precise pointer, drag-to-pan toolpaths, keyboard nudging. ',
      '    none of it survives on a phone screen, so rather than hand you a broken tool, we won&rsquo;t hand you one at all.',
      '  </div>',
      '  <div class="swarf-phone-body">',
      '    come back on a desktop or laptop. the machine-shop interface is waiting there.',
      '  </div>',
      '  <div class="swarf-phone-actions">',
      '    <a class="swarf-phone-primary" href="https://renato.design/swarf/">read about swarf</a>',
      '    <a class="swarf-phone-secondary" href="https://renato.design/">renato.design</a>',
      '  </div>',
      '  <div class="swarf-phone-escape">',
      '    <a href="' + buildURL('full') + '">show the interface anyway</a>',
      '    <span class="swarf-phone-escape-note">(it will not work right)</span>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(wall);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
  // re-evaluate on orientation changes only if the user hasn't overridden
  window.addEventListener('resize', () => {
    if ((localStorage.getItem(KEY) || 'auto') === 'auto') {
      const block = isNarrow();
      document.body.classList.toggle('swarf-phone', block);
      if (block) mount();
      else {
        const w = document.getElementById('swarf-phone-wall');
        if (w) w.remove();
      }
    }
  });
})();
