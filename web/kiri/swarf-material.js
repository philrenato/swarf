/**
 * swarf material system — loads swarf-materials.json, owns the "current
 * material" state, and applies it to the 3D scene:
 *   - stock mesh (the part widget): color + roughness + metalness + opacity
 *   - chip particles (via global tint that swarf-chips.js reads)
 *   - tool mesh: subtle helical flute pattern via procedural canvas texture
 *   - small "MATERIAL" dropdown injected into the TOOLPATHS panel header
 *
 * Procedural textures (no binary assets) — generated on-the-fly with a
 * 2D canvas: brushed-metal streaks for aluminum, wood grain rings for
 * hardwood, foam pores for foam, scaled steel for mild_steel, clear for
 * polycarbonate.
 */
(function () {
  'use strict';
  if (window.__swarfMaterialLoaded) return;
  window.__swarfMaterialLoaded = true;

  let materials = [];
  let current = null;
  const STORAGE_KEY = 'swarf.material.current';

  // ---- procedural textures ---------------------------------------------
  function makeBrushedMetal() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c8ccd0';
    ctx.fillRect(0, 0, 512, 512);
    // horizontal brush streaks
    for (let i = 0; i < 1800; i++) {
      const y = Math.random() * 512;
      const x0 = Math.random() * 512;
      const len = 40 + Math.random() * 250;
      const a = 0.03 + Math.random() * 0.08;
      const v = Math.random() < 0.5 ? 0 : 255;
      ctx.strokeStyle = `rgba(${v},${v},${v},${a})`;
      ctx.lineWidth = 0.5 + Math.random() * 0.6;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + len, y);
      ctx.stroke();
    }
    return c;
  }
  function makeWoodGrain() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(0, 0, 512, 512);
    // concentric rings biased horizontally
    const cx = -200 + Math.random() * 200;
    const cy = 256;
    for (let r = 5; r < 1200; r += 6 + Math.random() * 14) {
      const dark = Math.random() < 0.4;
      ctx.strokeStyle = dark ? 'rgba(40,22,10,0.45)' : 'rgba(140,90,55,0.20)';
      ctx.lineWidth = dark ? 1.2 : 0.6;
      ctx.beginPath();
      // wavy ring
      for (let a = 0; a <= Math.PI * 2; a += 0.05) {
        const wob = Math.sin(a * 6 + r * 0.05) * 4;
        const x = cx + (r + wob) * Math.cos(a);
        const y = cy + (r + wob) * 0.55 * Math.sin(a);
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // a few longitudinal scratches
    for (let i = 0; i < 30; i++) {
      ctx.strokeStyle = 'rgba(20,10,5,0.20)';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      const y = Math.random() * 512;
      ctx.moveTo(0, y);
      ctx.lineTo(512, y + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
    return c;
  }
  function makeFoamPores() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d8d2c0';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 1 + Math.random() * 3;
      const v = 80 + Math.random() * 100;
      ctx.fillStyle = `rgba(${v},${v - 5},${v - 12},${0.15 + Math.random() * 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }
  function makeScaledSteel() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5a5e62';
    ctx.fillRect(0, 0, 512, 512);
    // diagonal mill scale
    for (let y = 0; y < 600; y += 12) {
      for (let x = 0; x < 600; x += 12) {
        const ox = x + (y % 24 ? 6 : 0);
        const v = 70 + Math.random() * 50;
        ctx.fillStyle = `rgba(${v},${v + 4},${v + 8},${0.5 + Math.random() * 0.3})`;
        ctx.beginPath();
        ctx.ellipse(ox, y, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return c;
  }
  function makeClear() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c8e0e8';
    ctx.fillRect(0, 0, 32, 32);
    return c;
  }
  function makeFlutes(diameter, flutes = 2) {
    // helical flute pattern as a tiling texture wrapped around the tool cylinder
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#a8a8a8';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(20,20,20,0.65)';
    ctx.lineWidth = 18;
    // diagonal flute grooves
    for (let f = 0; f < flutes; f++) {
      const offset = (256 / flutes) * f;
      ctx.beginPath();
      ctx.moveTo(offset - 100, 0);
      ctx.lineTo(offset + 350, 256);
      ctx.stroke();
    }
    // shaft highlight
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    return c;
  }

  const TEXMAP = {
    'wood-grain':    makeWoodGrain,
    'brushed-metal': makeBrushedMetal,
    'foam-pores':    makeFoamPores,
    'scaled-steel':  makeScaledSteel,
    'clear':         makeClear,
  };
  const _texCache = {};
  function getTexture(name) {
    if (!window.THREE) return null;
    if (_texCache[name]) return _texCache[name];
    const make = TEXMAP[name];
    if (!make) return null;
    const tex = new window.THREE.CanvasTexture(make());
    tex.wrapS = tex.wrapT = window.THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    _texCache[name] = tex;
    return tex;
  }
  let _fluteTex = null;
  function getFluteTexture() {
    if (!window.THREE) return null;
    if (_fluteTex) return _fluteTex;
    _fluteTex = new window.THREE.CanvasTexture(makeFlutes());
    _fluteTex.wrapS = _fluteTex.wrapT = window.THREE.RepeatWrapping;
    _fluteTex.repeat.set(1, 4); // wrap around with flutes spiraling vertically
    return _fluteTex;
  }

  // ---- material state --------------------------------------------------
  function setCurrent(id) {
    const m = materials.find(x => x.id === id) || materials[0];
    if (!m) return;
    current = m;
    window.__swarfMaterial = m;
    try { localStorage.setItem(STORAGE_KEY, m.id); } catch (e) {}
    applyToStock();
    notify();
  }
  function notify() {
    try { window.dispatchEvent(new CustomEvent('swarf.material.change', { detail: current })); } catch (e) {}
  }
  function applyToStock() {
    if (!current || !window.kiri || !window.kiri.api) return;
    try {
      const widgets = window.kiri.api.widgets.all();
      const a = current.appearance;
      if (!a) return;
      const THREE = window.THREE;
      for (const w of widgets) {
        const mesh = w.mesh;
        if (!mesh || !mesh.material) continue;
        const mat = mesh.material;
        try { mat.color.set(a.color); } catch (e) {}
        if ('roughness' in mat) mat.roughness = a.roughness ?? 0.6;
        if ('metalness' in mat) mat.metalness = a.metalness ?? 0;
        mat.transparent = (a.opacity || 1) < 1;
        mat.opacity     = a.opacity ?? 1;
        const tex = getTexture(a.texture);
        if (tex && 'map' in mat) mat.map = tex;
        mat.needsUpdate = true;
      }
      try { window.moto.space.refresh && window.moto.space.refresh(); } catch (e) {}
    } catch (e) { console.warn('swarf-material: applyToStock failed', e); }
  }

  // ---- material dropdown UI -------------------------------------------
  function injectDropdown() {
    const camops = document.getElementById('camops');
    if (!camops || camops.querySelector('#swarf-material-row')) return;
    const row = document.createElement('div');
    row.id = 'swarf-material-row';
    row.style.cssText = 'display:flex; gap:6px; padding:4px 0; align-items:center;';
    const label = document.createElement('span');
    label.textContent = 'material';
    label.style.cssText = 'font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--swarf-text-3); flex:1';
    const select = document.createElement('select');
    select.id = 'swarf-material-select';
    select.style.cssText = 'font-size:11px; padding:3px 6px; background:rgba(0,0,0,0.4); border:1px solid var(--swarf-line, #2a2a2a); color:var(--swarf-text-1, #ddd); border-radius:2px;';
    for (const m of materials) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      if (current && current.id === m.id) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => setCurrent(select.value));
    row.appendChild(label);
    row.appendChild(select);
    // insert above the existing tool-library row if present, else at top
    const toolsRow = camops.querySelector('#swarf-tools-row');
    if (toolsRow) camops.insertBefore(row, toolsRow);
    else camops.insertBefore(row, camops.firstChild);
  }

  // ---- bootstrap -------------------------------------------------------
  function bootstrap() {
    fetch('/kiri/swarf-materials.json')
      .then(r => r.json())
      .then(data => {
        materials = (data.materials || []).filter(m => m.appearance);
        if (!materials.length) return;
        const stored = localStorage.getItem(STORAGE_KEY);
        const initialId = stored && materials.find(m => m.id === stored)
          ? stored : materials[0].id;
        setCurrent(initialId);
        // apply when widgets arrive (seed cube etc.)
        const apiPoll = setInterval(() => {
          if (window.kiri && window.kiri.api && window.kiri.api.event) {
            clearInterval(apiPoll);
            window.kiri.api.event.on('widget.add', () => setTimeout(applyToStock, 50));
            applyToStock();
            injectDropdown();
            // keep trying in case camops renders late
            const dropPoll = setInterval(() => {
              injectDropdown();
              if (document.getElementById('swarf-material-row')) clearInterval(dropPoll);
            }, 400);
          }
        }, 150);
      })
      .catch(e => console.warn('swarf-material: failed to load materials', e));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else bootstrap();

  // expose for chips + tool tinting
  window.__swarfGetTexture = getTexture;
  window.__swarfGetFluteTexture = getFluteTexture;
})();
