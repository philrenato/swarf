/**
 * swarf material system — loads swarf-materials.json, owns the "current
 * material" state, and applies it to the 3D scene:
 *   - stock mesh (the part widget): color + roughness + metalness + opacity
 *   - chip particles (via global tint that swarf-chips.js reads)
 *   - tool mesh: subtle helical flute pattern via procedural canvas texture
 *   - op feeds/speeds and the global ease-down ramp
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
  let machines = {}, defaultId = null;
  const STORAGE_KEY = 'swarf.material.current';

  // A machine marked soft in swarf-materials.json `machines` (the ShopBot: a
  // wood router) never offers a metal. Matched on the device name, so a
  // renamed copy of the profile ("ShopBot Basic (mine)") keeps the rule.
  function softRule() {
    let name = '';
    try { name = String(window.kiri.api.conf.get().device.deviceName || ''); } catch (e) { return null; }
    const key = Object.keys(machines).find(k => machines[k].soft && name.toLowerCase().includes(k.toLowerCase()));
    return key ? machines[key] : null;
  }
  const offered = () => softRule() ? materials.filter(m => !m.metal) : materials;

  // ---- procedural textures ---------------------------------------------
  function makeBrushedMetal() {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const ctx = c.getContext('2d');
    // base mid-gray
    ctx.fillStyle = '#b8bcc2';
    ctx.fillRect(0, 0, 1024, 1024);
    // dense horizontal brushing — thousands of fine streaks, high contrast
    for (let i = 0; i < 16000; i++) {
      const y = Math.random() * 1024;
      const x0 = Math.random() * 1024;
      const len = 60 + Math.random() * 500;
      const dark = Math.random() < 0.5;
      const a = 0.08 + Math.random() * 0.22;
      if (dark) ctx.strokeStyle = `rgba(40,44,52,${a})`;
      else      ctx.strokeStyle = `rgba(240,244,250,${a})`;
      ctx.lineWidth = 0.35 + Math.random() * 0.6;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + len, y + (Math.random() - 0.5) * 0.6);
      ctx.stroke();
    }
    // coarse scratches across
    for (let i = 0; i < 80; i++) {
      const y = Math.random() * 1024;
      ctx.strokeStyle = `rgba(30,34,42,${0.25 + Math.random() * 0.25})`;
      ctx.lineWidth = 0.8 + Math.random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y + (Math.random() - 0.5) * 2);
      ctx.stroke();
    }
    // micro highlights along brushing
    for (let i = 0; i < 2500; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      ctx.fillStyle = `rgba(255,255,255,${0.12 + Math.random() * 0.18})`;
      ctx.fillRect(x, y, 1 + Math.random() * 3, 0.5);
    }
    return c;
  }
  function makeWoodGrain() {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const ctx = c.getContext('2d');
    // base: warm mid brown
    ctx.fillStyle = '#7a4a24';
    ctx.fillRect(0, 0, 1024, 1024);
    // quarter-sawn horizontal grain: long vertical streaks, heavy variation
    for (let y = 0; y < 1024; y += 1) {
      const n = Math.sin(y * 0.11) + Math.sin(y * 0.37) * 0.6 + Math.sin(y * 1.3) * 0.3;
      const v = 100 + n * 40 + (Math.random() - 0.5) * 28;
      ctx.fillStyle = `rgba(${v | 0},${(v * 0.62) | 0},${(v * 0.35) | 0},0.55)`;
      ctx.fillRect(0, y, 1024, 1);
    }
    // cathedral-arch grain lines (the "V" shapes you see on plainsawn)
    for (let pass = 0; pass < 6; pass++) {
      const cy = Math.random() * 1024;
      const amp = 60 + Math.random() * 120;
      ctx.strokeStyle = `rgba(${30 + Math.random() * 30},${15 + Math.random() * 15},5,${0.4 + Math.random() * 0.35})`;
      ctx.lineWidth = 0.8 + Math.random() * 1.8;
      ctx.beginPath();
      for (let x = 0; x <= 1024; x += 3) {
        const y = cy + Math.sin(x * 0.012 + pass) * amp + Math.sin(x * 0.04) * 8;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // knots
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const r = 6 + Math.random() * 18;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(25,12,4,0.9)');
      grad.addColorStop(0.6, 'rgba(60,30,12,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // pore flecks along the grain
    for (let i = 0; i < 4000; i++) {
      const y = Math.random() * 1024;
      const x = Math.random() * 1024;
      ctx.fillStyle = `rgba(20,10,4,${0.08 + Math.random() * 0.14})`;
      ctx.fillRect(x, y, 1 + Math.random() * 3, 0.6);
    }
    return c;
  }
  function makeFoamPores() {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const ctx = c.getContext('2d');
    // base off-white EPS / rigid PU
    ctx.fillStyle = '#e2ddcc';
    ctx.fillRect(0, 0, 1024, 1024);
    // big cells — visible beads
    for (let i = 0; i < 600; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const r = 10 + Math.random() * 24;
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
      grad.addColorStop(0, 'rgba(255,252,240,0.55)');
      grad.addColorStop(0.7, 'rgba(120,115,100,0.0)');
      grad.addColorStop(1, 'rgba(40,36,28,0.45)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // small pores / grit
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const r = 0.8 + Math.random() * 2.4;
      const v = 50 + Math.random() * 90;
      ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.18 + Math.random() * 0.32})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // micro highlights
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      ctx.fillStyle = `rgba(255,250,235,${0.08 + Math.random() * 0.12})`;
      ctx.fillRect(x, y, 1, 1);
    }
    return c;
  }
  function makeScaledSteel() {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const ctx = c.getContext('2d');
    // warm steel gray
    ctx.fillStyle = '#6a6e74';
    ctx.fillRect(0, 0, 1024, 1024);
    // diagonal mill scale / brushed
    for (let i = 0; i < 5000; i++) {
      const y = Math.random() * 1024;
      const x0 = Math.random() * 1024;
      const len = 80 + Math.random() * 500;
      const v = 90 + Math.random() * 90;
      ctx.strokeStyle = `rgba(${v},${v + 6},${v + 14},${0.10 + Math.random() * 0.16})`;
      ctx.lineWidth = 0.4 + Math.random() * 0.9;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + len, y + (Math.random() - 0.5) * 1.5);
      ctx.stroke();
    }
    // subtle mill scale dots
    for (let i = 0; i < 1600; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const v = 50 + Math.random() * 80;
      ctx.fillStyle = `rgba(${v},${v},${v + 6},${0.18 + Math.random() * 0.22})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + Math.random() * 5, 2 + Math.random() * 3, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // rare rust flecks
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      ctx.fillStyle = `rgba(140,50,20,${0.15 + Math.random() * 0.25})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
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
  function getTexture(name, repeat) {
    if (!window.THREE) return null;
    const key = name + '@' + (repeat || 2);
    if (_texCache[key]) return _texCache[key];
    const make = TEXMAP[name];
    if (!make) return null;
    const tex = new window.THREE.CanvasTexture(make());
    tex.wrapS = tex.wrapT = window.THREE.RepeatWrapping;
    const r = repeat || 2;
    tex.repeat.set(r, r);
    _texCache[key] = tex;
    return tex;
  }

  // swarf v010 r4: derive a tangent-space normal map from a grayscale canvas.
  // Sobel-ish height→normal pass. Gives real per-pixel lighting response
  // without authoring bespoke normal maps.
  const _normalCache = {};
  function getNormalMap(name, repeat, strength) {
    if (!window.THREE) return null;
    const key = name + '@' + (repeat || 2) + ':N';
    if (_normalCache[key]) return _normalCache[key];
    // the color map's own canvas: a second make() is another random texture (review r093 A12)
    const src = (getTexture(name, repeat) || {}).image;
    if (!src) return null;
    const w = src.width, h = src.height;
    const sctx = src.getContext('2d');
    const data = sctx.getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const octx = out.getContext('2d');
    const od = octx.createImageData(w, h);
    const s = strength || 1.2;
    const lum = (x, y) => {
      const xi = (x + w) % w, yi = (y + h) % h;
      const idx = (yi * w + xi) * 4;
      return (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (lum(x + 1, y) - lum(x - 1, y)) * s;
        const dy = (lum(x, y + 1) - lum(x, y - 1)) * s;
        const nx = -dx, ny = -dy, nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const i = (y * w + x) * 4;
        od.data[i    ] = ((nx / len) * 0.5 + 0.5) * 255;
        od.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        od.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
        od.data[i + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    const tex = new window.THREE.CanvasTexture(out);
    tex.wrapS = tex.wrapT = window.THREE.RepeatWrapping;
    const r = repeat || 2;
    tex.repeat.set(r, r);
    _normalCache[key] = tex;
    return tex;
  }
  // swarf v010: a cheap procedural environment so metalness-1 aluminum actually
  // reflects something (warm sky up, ember horizon, deep red below).
  let _envInstalled = false;
  function installEnvironment() {
    if (_envInstalled || !window.THREE) return;
    try {
      const space = window.moto && window.moto.space;
      const scene = space && space.scene;
      if (!scene) return;
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 512;
      const g = c.getContext('2d');
      // equirect-ish: vertical gradient from warm zenith through ember to floor
      const grad = g.createLinearGradient(0, 0, 0, 512);
      // swarf v010 r4: proper studio/shop env. Metals reflect most of what
      // they see — a dim env makes metal look like painted plastic. Bright
      // cool ceiling, warm rim accent at horizon, mid-gray floor.
      grad.addColorStop(0.00, '#e8ecf2');   // cool shop ceiling — pure white-ish
      grad.addColorStop(0.25, '#c8cfd8');   // wall upper
      grad.addColorStop(0.48, '#8a7a78');   // warm wall mid
      grad.addColorStop(0.55, '#c87048');   // ember rim at horizon (swarf palette)
      grad.addColorStop(0.62, '#6a4838');   // warm floor near
      grad.addColorStop(0.85, '#303236');   // mid-gray floor
      grad.addColorStop(1.00, '#1a1c20');   // dim floor far
      g.fillStyle = grad;
      g.fillRect(0, 0, 1024, 512);
      // overhead shop lights — bright circular hot spots across the ceiling
      // strip so aluminum and steel get discrete specular highlights.
      for (let i = 0; i < 12; i++) {
        const x = (i + 0.5) * (1024 / 12);
        const y = 60 + Math.random() * 120;
        const r = 50 + Math.random() * 70;
        const h = g.createRadialGradient(x, y, 0, x, y, r);
        h.addColorStop(0, 'rgba(255,255,255,0.95)');
        h.addColorStop(0.4, 'rgba(240,240,220,0.35)');
        h.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = h;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // warm horizon accents
      for (let i = 0; i < 20; i++) {
        const x = Math.random() * 1024;
        const y = 260 + Math.random() * 40;
        const r = 80 + Math.random() * 120;
        const h = g.createRadialGradient(x, y, 0, x, y, r);
        h.addColorStop(0, 'rgba(255,160,100,0.35)');
        h.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = h;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const tex = new window.THREE.CanvasTexture(c);
      tex.mapping = window.THREE.EquirectangularReflectionMapping;
      tex.colorSpace = window.THREE.SRGBColorSpace || tex.colorSpace;
      let renderer = space.renderer || (window.moto && window.moto.space && window.moto.space.renderer);
      try { if (!renderer && space.internals) renderer = space.internals().renderer; } catch (e) {}
      // swarf v010 r8 c: DO NOT set scene.environment — that globally
      // reinterprets every material's reflection (incl. the red grid
      // which then reads hot orange). Instead stash the PMREM texture
      // on window.__swarfEnvMap so applyAppearance can set it per-
      // material — metals still reflect, grid/platform stay untouched.
      if (renderer && window.THREE.PMREMGenerator) {
        const pmrem = new window.THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const envRT = pmrem.fromEquirectangular(tex);
        window.__swarfEnvMap = envRT.texture;
        pmrem.dispose();
      } else {
        window.__swarfEnvMap = tex;
      }
      // restrained lighting (v010 r2/r8b): one key from above-front-right, a warm hemisphere and a
      // faint fill, so form reads first and the floor keeps its matte finish
      try {
        const hemi = new window.THREE.HemisphereLight(0xcfc0a0, 0x1a1a1a, 0.32);
        scene.add(hemi);
        const key = new window.THREE.DirectionalLight(0xfff4e0, 0.85);
        key.position.set(220, 280, 160);
        scene.add(key);
        const fill = new window.THREE.DirectionalLight(0x9bb4d0, 0.18);
        fill.position.set(-180, 120, -140);
        scene.add(fill);
      } catch (e) {}
      // no tonemapping or colorspace override: ACES + sRGB made the mill-red grid read orange (r8b)
      _envInstalled = true;
    } catch (e) { console.warn('swarf-material: env install failed', e); }
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
    const list = offered();
    const m = list.find(x => x.id === id) || list.find(x => x.id === defaultId) || list[0];
    if (!m) return;
    current = m;
    window.__swarfMaterial = m;
    try { localStorage.setItem(STORAGE_KEY, m.id); } catch (e) {}
    applyToStock();
    applyRamp();
    applyFeedsToOps();
    notify();
  }

  // Push the material's ramp preset into the process. Ease-down is global
  // (prepare.js reads camEaseDown / camEaseAngle off the process, not off an
  // op), so this is a settings write, not an op write. Shallow angles for
  // metal, steep for foam: a hard material wants the tool to walk down into
  // the cut rather than drill in on a flute that may not cut at center.
  function applyRamp() {
    if (!current || !current.ramp) return;
    const api = window.kiri && window.kiri.api;
    if (!api || !api.conf) return;
    const settings = api.conf.get();
    const proc = settings && settings.process;
    if (!proc) return;
    const ease = current.ramp.ease !== false;
    const angle = current.ramp.angle;
    if (proc.camEaseDown === ease && proc.camEaseAngle === angle) return;
    proc.camEaseDown = ease;
    if (typeof angle === 'number') proc.camEaseAngle = angle;
    try { api.conf.save(); } catch (e) {}
    // repaint the expert-panel inputs so they don't show the stale angle
    try { api.conf.update_fields(); } catch (e) {}
  }

  // One material record, one tool diameter, one device: the numbers an op
  // gets. Pure, so tools/check_materials.mjs runs this exact function over
  // the whole tool library. lim = { spindleMin, spindleMax, feedMax, feedMaxZ }
  // in rpm and mm/min, 0 = no limit.
  // the woods the shop's ShopBot library was written for (10-29: its bits' numbers cap swarf's here)
  const SHOP_WOODS = new Set(['plywood', 'mdf', 'hardwood', 'osb', 'hardboard']);
  // A V-bit is as wide as it is deep, not as wide as its shank: its tip does the cutting and its full
  // 1/2 in is seldom in the wood. It takes the numbers of the width it has at one pass's depth, and that
  // pass goes down until it is 1/4 in wide (90°: 3.2 mm, 60°: 5.5 mm), or as the material allows.
  const V_WIDTH = 6.35;
  function vBitPass(c, tool) {
    const half = tool && tool.type === 'tapermill' && tool.taper_angle > 0 ? tool.taper_angle : 0;
    if (!half) return 0;
    const byWidth = V_WIDTH / 2 / Math.tan(half * Math.PI / 180);
    return Math.min(byWidth, c.down * V_WIDTH * 2, c.downMax > 0 ? c.downMax : Infinity);
  }
  function derive(m, diamMm, lim, tool) {
    const c = m && m.cut;
    if (!c || !(diamMm > 0)) return null;
    lim = lim || {};
    const vPass = vBitPass(c, tool);
    if (vPass) diamMm = Math.min(diamMm, V_WIDTH);
    let rpm = c.vc * 1000 / (Math.PI * diamMm);
    if (lim.spindleMax > 0) rpm = Math.min(rpm, lim.spindleMax);
    if (lim.spindleMin > 0) rpm = Math.max(rpm, lim.spindleMin);
    rpm = Math.floor(rpm / 50) * 50;
    let feed = rpm * c.flutes * c.chip * diamMm;
    if (lim.feedMax > 0) feed = Math.min(feed, lim.feedMax);
    feed = Math.round(feed / 10) * 10;
    let plunge = feed * 0.35;
    if (lim.feedMaxZ > 0) plunge = Math.min(plunge, lim.feedMaxZ);
    plunge = Math.round(plunge / 5) * 5;
    let down = c.down * diamMm;
    if (c.downMax > 0) down = Math.min(down, c.downMax);
    if (vPass) down = vPass;
    // a down-cut packs its chips into the slot it cuts: no deeper than half its diameter a pass
    const sw = tool && tool.swarf;
    let capped = false;
    if (sw && sw.cut === 'down' && down > diamMm / 2) { down = diamMm / 2; capped = true; }
    // the shop's own numbers for its own bit: a computed number well above them (half again) gives
    // way to the shop's, which are cautious by design. Inches and in/s there; mm and mm/min here.
    let shop = null;
    if (sw && sw.shop && SHOP_WOODS.has(m.id)) {
      // the shop's own numbers for its own bit (Phil 10-29: they are what ShopBot 3 cuts with here,
      // and swarf's own sat in the motors' rough band and rubbed more than it cut)
      const S = sw.shop, sf = S.feed * 25.4 * 60, sp = S.plunge * 25.4 * 60, sd = S.pass * 25.4;
      feed = Math.round(Math.min(sf, lim.feedMax > 0 ? lim.feedMax : sf) / 10) * 10;
      plunge = Math.round(Math.min(sp, feed, lim.feedMaxZ > 0 ? lim.feedMaxZ : sp) / 5) * 5;
      down = sd; capped = true;
      if (S.rpm) rpm = Math.max(lim.spindleMin || 0, Math.min(lim.spindleMax || S.rpm, S.rpm));
      shop = { feed: sf, plunge: sp, pass: sd };
    } else if (SHOP_WOODS.has(m.id)) {
      // any other bit in wood: at least 1500 mm/min, above the rough band (~25 mm/s), when the bit
      // can take it (a chip of 2% of its diameter a tooth at most)
      const most = rpm * c.flutes * 0.02 * diamMm;
      const floor = Math.min(1500, most);
      if (feed < floor) { feed = Math.round(floor / 10) * 10; plunge = Math.round(Math.min(feed * 0.35, lim.feedMaxZ > 0 ? lim.feedMaxZ : feed) / 5) * 5; }
      // on the ShopBot, what the shop's Vectric files cut wood at (Phil 11-04, its 1/4 in up-cut:
      // 1.5 in/s at 14,000 rpm, the same bite a tooth as 1500 mm/min at 10,000). Plywood stays
      // until a test cut says so.
      if (lim.shopbot && m.id !== 'plywood') {
        rpm = Math.max(lim.spindleMin || 0, Math.min(lim.spindleMax || 14000, 14000));
        const fast = Math.min(2290, Math.max(rpm * c.flutes * 0.0128 * diamMm, Math.min(1500, rpm * c.flutes * 0.02 * diamMm)));
        feed = Math.round(Math.min(fast, lim.feedMax > 0 ? lim.feedMax : fast) / 10) * 10;
        plunge = Math.round(Math.min(feed * 0.35, lim.feedMaxZ > 0 ? lim.feedMaxZ : feed) / 5) * 5;
      }
    }
    // a cap rounds down, never past itself
    down = capped ? Math.floor(down * 20 + 1e-9) / 20 : Math.round(down * 20) / 20;
    return {
      shop,
      spindle: rpm,
      feed,
      plunge,
      stepdown: down,
      stepover: c.stepover,
      // the cutting speed the tool actually sees once the spindle clamps
      vc: Math.round(Math.PI * diamMm * rpm / 1000),
    };
  }
  window.__swarfDerive = derive;
  // a material's record by id (the test cuts take plywood's: 10-29, one speed rule everywhere)
  // ---- bits: the list (review 105 F17) ----
  const BIT_KIND = { endmill: 'flat', ballmill: 'ball', tapermill: 'V', taperball: 'V, ball tip', drill: 'drill' };
  function bitsCard() {
    let card = null;
    const a = () => window.kiri.api;
    const L = () => window.SwarfLength;
    const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props || {}); e.append(...kids); return e; };
    const close = () => { if (card) { card.remove(); card = null; document.removeEventListener('keydown', onKey, true); } };
    const onKey = e => { if (e.key === 'Escape' && card) { close(); e.stopPropagation(); e.preventDefault(); } };
    const widthOf = t => (t.flute_diam || 0) * (t.metric ? 1 : 25.4);
    const rowFor = t => {
      const carving = t.type === 'tapermill' || t.type === 'taperball';
      const part = (t.swarf && t.swarf.part) || '';
      return el('tr', {}, el('td', { textContent: t.name }), el('td', { textContent: L() ? L().say(widthOf(t)) : `${widthOf(t)} mm` }),
        el('td', { textContent: (BIT_KIND[t.type] || t.type) + (carving ? ', for carving' : '') }), el('td', { textContent: part }));
    };
    function list() {
      const tools = (a().conf.get().tools || []).slice();
      const rank = t => (t.type === 'tapermill' || t.type === 'taperball' ? 0 : 1);
      const order = new Map(tools.map((t, i) => [t, i]));
      tools.sort((x, y) => rank(x) - rank(y) || order.get(x) - order.get(y));
      return el('table', {}, el('thead', {}, el('tr', {}, ...['name', 'width', 'kind', 'part number'].map(w => el('th', { textContent: w })))), el('tbody', {}, ...tools.map(rowFor)));
    }
    function addForm(host, wrap) {
      const name = el('input', { title: 'what the steps call it', placeholder: 'name' });
      const width = el('input', { title: 'how wide it cuts: 1/4, 6.35 mm', placeholder: 'width' });
      const reach = el('input', { title: 'how deep its flutes reach: 1/2, 12.7 mm', placeholder: 'cuts how deep' });
      const kind = el('select', { title: 'flat, ball or drill; a V-bit is added in the tool library' }, ...[['endmill', 'flat'], ['ballmill', 'ball'], ['drill', 'drill']].map(([value, textContent]) => el('option', { value, textContent })));
      const part = el('input', { title: 'its part number, if it has one', placeholder: 'part number' });
      const why = el('p', { className: 'swarf-bits-why' });
      const add = el('button', { type: 'button', textContent: 'add', title: 'Put this bit on the list' });
      const cancel = el('button', { type: 'button', textContent: 'cancel', title: 'Close this without adding a bit' });
      for (const i of [name, width, reach, part]) i.addEventListener('keydown', e => e.stopPropagation());
      cancel.onclick = () => { host.innerHTML = ''; host.append(addButton(host, wrap)); };
      add.onclick = () => {
        const s = a().conf.get(), w = L() ? L().parse(width.value) : parseFloat(width.value), r = reach.value.trim() ? (L() ? L().parse(reach.value) : parseFloat(reach.value)) : Math.max(12.7, w * 2);
        const n = name.value.trim();
        const no = !n ? 'Give the bit a name.' : s.tools.some(t => t.name === n) ? 'A bit already has that name.' : !(w > 0 && w <= 50) ? 'Give the width as a length, above 0 and up to 50 mm.' : !(r > 0 && r <= 150) ? 'Give how deep it cuts as a length, above 0 and up to 150 mm.' : '';
        why.textContent = no;
        if (no) return;
        const tool = { id: Date.now(), number: Math.max(0, ...s.tools.map(t => t.number || 0)) + 1, name: n, type: kind.value, taper_tip: 0, metric: true, shaft_diam: w, shaft_len: Math.max(25.4, r), flute_diam: w, flute_len: r };
        if (part.value.trim()) tool.swarf = { part: part.value.trim() };
        s.tools.push(tool);
        a().conf.save(); a().conf.update_fields(); a().event.settings();
        wrap.innerHTML = ''; wrap.append(list());
        host.innerHTML = ''; host.append(addButton(host, wrap));
        a().show.alert(`Added ${n}. Pick it on a step's tool row.`, 6);
      };
      host.innerHTML = '';
      host.append(el('div', { className: 'swarf-bits-form' }, name, width, reach, kind, part), why, el('div', { className: 'swarf-bits-row' }, add, cancel));
      name.focus();
    }
    const addButton = (host, wrap) => el('button', { type: 'button', textContent: 'add a bit', title: 'Add a flat, ball or drill bit to the list', onclick: () => addForm(host, wrap) });
    function open() {
      close();
      const wrap = el('div', { className: 'swarf-bits-list' }, list());
      const foot = el('div', { className: 'swarf-bits-row' });
      foot.append(addButton(foot, wrap));
      const lib = el('button', { type: 'button', textContent: 'edit in tool library', className: 'swarf-expert-only', title: 'Change or remove a bit, or add a V-bit: the full editor', onclick: () => { close(); a().show.tools(); } });
      const shut = el('button', { type: 'button', textContent: '×', className: 'swarf-bits-x', title: 'Close the list (Esc)', onclick: close });
      card = el('div', { id: 'swarf-bits' }, el('div', { className: 'swarf-bits-head' }, el('b', { textContent: 'bits' }), shut), wrap, el('div', { className: 'swarf-bits-foot' }, foot, lib));
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'bits');
      document.body.append(card);
      document.addEventListener('keydown', onKey, true);
    }
    return { open, close, toggle: () => (card ? close() : open()), isOpen: () => !!card };
  }
  window.__swarfBits = bitsCard();

  window.__swarfMaterialById = id => materials.find(m => m.id === id) || null;

  function toolDiamMm(tool) {
    if (!tool) return 6.35;
    const d = tool.flute_diam || tool.shaft_diam || 0;
    return tool.metric ? d : d * 25.4;
  }
  function deviceLimits(settings) {
    const dev = settings.device || {};
    const proc = settings.process || {};
    const zcaps = [dev.feedMaxZ, proc.camFastFeedZ].filter(v => v > 0);
    return {
      spindleMin: dev.spindleMin || 0,
      spindleMax: dev.spindleMax || 0,
      feedMax: dev.feedMax || 0,
      feedMaxZ: zcaps.length ? Math.min(...zcaps) : 0,
      shopbot: /shopbot/i.test(dev.deviceName || ''),
    };
  }

  // Ops keep the student's edits. An op is re-derived only when its stamp
  // no longer matches — the material, the op's tool or the device changed —
  // or when it has no stamp yet (a new op, or the auto-added rough).
  const OP_TYPES = ['rough', 'outline', 'contour', 'pocket', 'drill', 'texture', 'pierce', 'inlay', 'vcarve'];
  function opValues(type, p) {
    // a drill's `rate` is its plunge (cl-ops.js maps it to camDrillDownSpeed)
    if (type === 'drill') return { spindle: p.spindle, rate: p.plunge, down: p.stepdown };
    if (type === 'contour') return { spindle: p.spindle, rate: p.feed, step: p.stepover };
    // a texture's stepover comes from its scallop (TEX), not the material
    if (type === 'texture' || type === 'pierce' || type === 'inlay' || type === 'vcarve') return { spindle: p.spindle, rate: p.feed, plunge: p.plunge, down: p.stepdown };
    return { spindle: p.spindle, rate: p.feed, plunge: p.plunge, down: p.stepdown, step: p.stepover };
  }
  let applying = false;
  function applyFeedsToOps() {
    // held while a .swarf opens (swarf-file.js): its steps come in with their own numbers
    if (applying || window.__swarfMaterialHold || !current || !current.cut) return;
    const api = window.kiri && window.kiri.api;
    if (!api || !api.conf) return;
    const settings = api.conf.get();
    const proc = settings && settings.process;
    if (!proc) return;
    const tools = settings.tools || [];
    const lim = deviceLimits(settings);
    const devName = (settings.device && settings.device.deviceName) || '';
    const findTool = id => tools.find(t => t.id == id);
    let changed = false;
    const replaced = [];

    for (const op of proc.ops || []) {
      if (!op || !OP_TYPES.includes(op.type)) continue;
      // the stamp carries what the numbers came from (design review 10-28 #9): the tool's own
      // diameter and the machine's limits, so editing either re-derives, not only a new id
      const tool = findTool(op.tool), dia = toolDiamMm(tool);
      const stamp = `${current.id}:${op.tool}:${devName}:${(+dia || 0).toFixed(3)}:${lim ? [lim.spindleMin, lim.spindleMax, lim.feedMax, lim.feedMaxZ].join(',') : ''}`;
      if (op.preset === stamp) continue;
      // a stamp from before carries no geometry: take it as matching once, so a student's edits survive the upgrade
      if (op.preset === `${current.id}:${op.tool}:${devName}`) { op.preset = stamp; changed = true; continue; }
      const p = derive(current, dia, lim, tool);
      if (!p) continue;
      const now = opValues(op.type, p);
      // (review 105 m2) this step had numbers of its own under the last material: they are replaced, by
      // design (the stamp rule above), and said. Only the material changed: its stamp says so.
      const [wasId, wasTool, wasDev] = String(op.preset || '').split(':');
      const was = wasId && wasId !== current.id && wasTool == op.tool && wasDev === devName && window.__swarfMaterialById(wasId);
      const before = was && derive(was, dia, lim, tool);
      if (before) {
        const prior = opValues(op.type, before);
        const differs = k => prior[k] > 0 && op[k] > 0 && Math.abs(op[k] - prior[k]) > prior[k] * 0.01;
        if (differs('rate')) replaced.push({ type: op.type, from: op.rate, to: now.rate });
        else if (Object.keys(prior).some(differs)) replaced.push({ type: op.type });
      }
      Object.assign(op, now);
      op.preset = stamp;
      changed = true;
    }
    if (!changed) return;
    applying = true;
    try { api.conf.save(); } catch (e) {}
    try { api.event.emit('cam.op.render'); } catch (e) {}
    applying = false;
    if (replaced.length) {
      const speed = v => window.SwarfLength && window.SwarfLength.unit() === 'in' ? `${+(v / 25.4).toFixed(1)} in/min` : `${Math.round(v)} mm/min`;
      const r = replaced[0];
      const text = replaced.length > 1 ? `${current.name || current.id} has its own numbers: what you typed on ${replaced.length} steps was replaced.`
        : r.from ? `${current.name || current.id} has its own numbers: the feed you typed on ${r.type}, ${speed(r.from)}, is now ${speed(r.to)}.`
        : `${current.name || current.id} has its own numbers: what you typed on ${r.type} was replaced.`;
      try { api.event.alerts(true); api.show.alert(text, 8); } catch (e) { /* no alerts */ }
    }
  }
  function notify() {
    try { window.dispatchEvent(new CustomEvent('swarf.material.change', { detail: current })); } catch (e) {}
  }
  // swarf v010: single place to map appearance JSON onto a THREE material.
  function applyAppearance(mat, a) {
    if (!mat || !a) return;
    try { mat.color.set(a.color); } catch (e) {}
    if (mat.emissive && a.emissive) { try { mat.emissive.set(a.emissive); } catch (e) {} }
    if ('roughness' in mat)        mat.roughness        = a.roughness ?? 0.6;
    if ('metalness' in mat)        mat.metalness        = a.metalness ?? 0;
    if ('envMapIntensity' in mat)  mat.envMapIntensity  = a.envIntensity ?? 1.0;
    // swarf v010 r8 c: per-material envMap, ONLY on MeshStandardMaterial or
    // MeshPhysicalMaterial. Phong's envMap path is different and renders
    // blown-out when fed PMREM output.
    if (window.__swarfEnvMap
        && window.THREE
        && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) {
      mat.envMap = window.__swarfEnvMap;
    }
    if ('clearcoat' in mat)        mat.clearcoat        = a.clearcoat ?? 0;
    if ('clearcoatRoughness' in mat) mat.clearcoatRoughness = a.clearcoatRoughness ?? 0;
    if ('sheen' in mat)            mat.sheen            = a.sheen ?? 0;
    if ('sheenRoughness' in mat)   mat.sheenRoughness   = a.sheenRoughness ?? 0.5;
    if (mat.sheenColor && a.sheenColor) { try { mat.sheenColor.set(a.sheenColor); } catch (e) {} }
    if ('transmission' in mat)     mat.transmission     = a.transmission ?? 0;
    if ('ior' in mat && a.ior)     mat.ior              = a.ior;
    if ('thickness' in mat && a.thickness) mat.thickness = a.thickness;
    mat.transparent = ((a.opacity || 1) < 1) || !!a.transmission;
    mat.opacity     = a.opacity ?? 1;
    const tex = getTexture(a.texture, a.textureRepeat);
    if (tex && 'map' in mat) mat.map = tex;
    // swarf v010 r4: prefer normal map over bump map — tangent-space normals
    // give proper specular falloff instead of flat luminance tweaks.
    if (tex && 'normalMap' in mat && a.normalScale) {
      const n = getNormalMap(a.texture, a.textureRepeat, a.normalStrength || 1.2);
      mat.normalMap = n;
      if (mat.normalScale && mat.normalScale.set) mat.normalScale.set(a.normalScale, a.normalScale);
    } else if ('normalMap' in mat && !a.normalScale) {
      mat.normalMap = null;
    }
    if (tex && 'bumpMap' in mat && a.bumpScale && !a.normalScale) {
      mat.bumpMap = tex;
      mat.bumpScale = a.bumpScale;
    } else if ('bumpMap' in mat && (!a.bumpScale || a.normalScale)) {
      mat.bumpMap = null;
    }
    mat.needsUpdate = true;
  }

  function applyToStock() {
    if (!current || !window.kiri || !window.kiri.api) return;
    try {
      installEnvironment();
      const widgets = window.kiri.api.widgets.all();
      const a = current.appearance;
      if (!a) return;
      const THREE = window.THREE;
      // set properties on Kiri's own material, never swap it: Kiri caches its instances, and a
      // replaced one repainted the part black on the next selection change (v010 r3)
      // the picked parts glow warm (review 10-28: "a picked part looks exactly like an
      // unpicked one": the appearance wrote over cam's selection color)
      let picked = new Set();
      try { picked = new Set(window.kiri.api.selection.widgets()); } catch (e) { /* none */ }
      let arranging = true;
      try { arranging = window.kiri.api.view.is_arrange(); } catch (e) { /* no view yet */ }
      for (const w of widgets) {
        const mesh = w.mesh;
        if (!mesh) continue;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (mat && mat.color) applyAppearance(mat, a);
          // a part left out of this run (unticked in objects) shows through (Phil 11-02), while the
          // parts are arranged: toolpaths and simulate show the parts their own way
          const out = !!(w.meta && w.meta.disabled) && arranging;
          if (mat && (out || mat.userData.swarfOut)) {
            if (out) { if (!mat.userData.swarfOut) mat.userData.swarfOut = { opacity: mat.opacity, transparent: mat.transparent }; mat.transparent = true; mat.opacity = 0.28; mat.depthWrite = false; }
            // out of arranging, the view has set its own opacity already: only the note goes
            else { if (arranging) Object.assign(mat, mat.userData.swarfOut); mat.depthWrite = true; delete mat.userData.swarfOut; }
            mat.needsUpdate = true;
          }
          // and only the picked: a part let go loses its glow
          if (mat && mat.emissive) { mat.emissive.set(picked.has(w) ? '#6a5638' : (a.emissive || '#000000')); mat.needsUpdate = true; }
          // the part is never fogged: the fade is for the floor (swarf-grid-fade.js)
          if (mat && mat.fog !== false) { mat.fog = false; mat.needsUpdate = true; }
        }
      }
      // swarf v010: also re-tint the SIMULATE stock mesh material if live
      const animMat = window.__swarfAnimStockMaterial;
      if (animMat) { applyAppearance(animMat, a); if (animMat.fog !== false) { animMat.fog = false; animMat.needsUpdate = true; } }   // far out it went black (review 10-28b #17)
      try { window.moto.space.refresh && window.moto.space.refresh(); } catch (e) {}
    } catch (e) { console.warn('swarf-material: applyToStock failed', e); }
  }

  // ---- material dropdown UI -------------------------------------------
  function fillOptions(select) {
    select.textContent = '';
    for (const m of offered()) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      if (current && current.id === m.id) opt.selected = true;
      select.appendChild(opt);
    }
    const rule = softRule();
    select.title = 'your board's material: its look and its starting speeds' + (rule ? `. ${rule.why}` : '');
  }

  // after a machine change: a metal on a soft-only machine falls back to the
  // default (hardwood) and the sentence says why; the list follows the machine
  function machineChanged() {
    const rule = softRule();
    if (rule && current && current.metal) {
      const was = current.name;
      setCurrent(defaultId);
      try {
        const a = window.kiri.api;
        a.event.alerts(true);
        a.show.alert(`${rule.why} The material is now ${current.name}, not ${was}.`, 8);
      } catch (e) { /* no alerts */ }
    }
    const select = document.getElementById('swarf-material-select');
    if (select) fillOptions(select);
  }
  // a .swarf's material (swarf-file.js): the one it names when this machine offers it; returns the one picked
  window.__swarfSetMaterial = id => { setCurrent(id); const sel = document.getElementById('swarf-material-select'); if (sel && current) sel.value = current.id; return current && current.id; };
  window.__swarfApplyFeeds = () => applyFeedsToOps();

  function injectDropdown() {
    const camops = document.getElementById('camops');
    if (!camops || camops.querySelector('#swarf-material-row')) return;
    const row = document.createElement('div');
    row.id = 'swarf-material-row';
    row.style.cssText = 'display:flex; gap:8px; padding:8px 6px; align-items:center; border-bottom:1px solid var(--swarf-accent, #7a2a1a); background:rgba(208,32,32,0.04); margin-bottom:6px;';
    const label = document.createElement('span');
    label.textContent = 'material';
    label.style.cssText = 'font-size:13px; letter-spacing:0.02em; text-transform:none; color:var(--swarf-accent-hi, #ff3a2a); font-weight:600; flex:0 0 auto;';
    const select = document.createElement('select');
    select.id = 'swarf-material-select';
    select.title = 'your board's material: its look and its starting speeds';
    select.style.cssText = 'flex:1; font-size:13px; padding:6px 8px; background:rgba(0,0,0,0.55); border:1px solid var(--swarf-accent, #7a2a1a); color:#fff; border-radius:2px; font-family:"IBM Plex Mono",ui-monospace,monospace;';
    fillOptions(select);
    select.addEventListener('change', () => setCurrent(select.value));
    row.appendChild(label);
    row.appendChild(select);
    // insert above the existing tool-library row if present, else at top
    const toolsRow = camops.querySelector('#swarf-tools-row');
    if (toolsRow) camops.insertBefore(row, toolsRow);
    else camops.insertBefore(row, camops.firstChild);
    camops.insertBefore(originRow(label.style.cssText), row.nextSibling);
  }

  // where X 0, Y 0 sits on the stock (Phil 10-28): its front-left corner by default; the
  // center for something round. Kiri's own camOriginCenter, through its own checkbox.
  function originRow(labelCss) {
    const api = window.kiri && window.kiri.api;
    const row = document.createElement('div');
    row.id = 'swarf-origin-row';
    row.style.cssText = 'display:flex; gap:6px; padding:4px 6px 8px; align-items:center; margin-bottom:6px;';
    const label = document.createElement('span');
    label.textContent = 'zero at';
    label.style.cssText = labelCss;
    row.append(label);
    const btns = {};
    const show = () => { const c = !!(api && api.conf.get().process.camOriginCenter); btns.corner.classList.toggle('selected', !c); btns.center.classList.toggle('selected', c); };
    const pick = center => {
      try {
        const box = api.ui && api.ui.camOriginCenter;
        if (box && box.checked !== center) { box.checked = center; if (box.onclick) box.onclick(); else { api.conf.get().process.camOriginCenter = center; api.conf.save(); } }
        if (api.function.clear_progress) api.function.clear_progress();   // toolpaths made for the other zero are stale
        // one line, so the move of the zero is never silent (Fable review 3 #20)
        if (box && api.show && api.show.alert) api.show.alert(center ? 'Zero at the center: in control, put the bit on the center of your board.' : 'Zero at the front-left corner: in control, put the bit on that corner of your board.', 6);
      } catch (e) { /* cam not ready */ }
      show();
    };
    for (const [k, word, title, center] of [['corner', 'front-left corner', 'X 0, Y 0 at the front-left corner of the stock: zero the bit on that corner of your board', false],
      ['center', 'center', 'X 0, Y 0 at the center of the stock: for something round, zero the bit on its center', true]]) {
      const b = document.createElement('button');
      b.textContent = word; b.title = title; b.style.cssText = 'flex:1; font-size:12px; padding:5px 6px;';
      b.addEventListener('click', () => pick(center));
      btns[k] = b; row.append(b);
    }
    show();
    try { for (const ev of ['settings.load', 'settings.saved', 'device.selected']) api.event.on(ev, show); } catch (e) {}
    return row;
  }

  // ---- bootstrap -------------------------------------------------------
  function bootstrap() {
    // relative: the deployed site flattens to one root (/swarf-app/), where an absolute
    // /kiri/ path 404s and leaves no materials at all
    fetch('swarf-materials.json')
      .then(r => r.json())
      .then(data => {
        materials = (data.materials || []).filter(m => m.appearance);
        machines = data.machines || {};
        defaultId = data.default;
        if (!materials.length) return;
        let stored = null; try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage blocked */ }
        // `default` is declared in the JSON so the dropdown can be ordered
        // for reading (hardest first) without that order deciding what a
        // first-time student lands on.
        const fallback = materials.find(m => m.id === data.default) || materials[0];
        const initialId = stored && materials.find(m => m.id === stored)
          ? stored : fallback.id;
        setCurrent(initialId);
        // apply when widgets arrive (seed cube etc.)
        const apiPoll = setInterval(() => {
          if (window.kiri && window.kiri.api && window.kiri.api.event) {
            clearInterval(apiPoll);
            window.kiri.api.event.on('widget.add', () => { setTimeout(applyToStock, 50); setTimeout(applyToStock, 400); });
            try { window.kiri.api.event.on('widget.duplicate', () => setTimeout(applyToStock, 50)); } catch (e) {}
            try { window.kiri.api.event.on('widget.cut', () => setTimeout(applyToStock, 10)); } catch (e) {}
            // every op add/edit and device change lands in conf.save
            // ('settings.saved') or the device dialog ('settings'); run
            // synchronously so an auto-added rough carries the material's
            // numbers before act-paths reads the process
            try { window.kiri.api.event.on('settings.saved', applyFeedsToOps); } catch (e) {}
            try { window.kiri.api.event.on('settings', applyFeedsToOps); } catch (e) {}
            // re-apply after slice/view rebuilds the mesh
            try { window.kiri.api.event.on('slice.end', () => setTimeout(applyToStock, 30)); } catch (e) {}
            try { window.kiri.api.event.on('view.set',  () => setTimeout(applyToStock, 30)); } catch (e) {}
            try { window.kiri.api.event.on('animate',   () => setTimeout(applyToStock, 30)); } catch (e) {}
            // Kiri's platform.js recolors a part on select: put the material back after
            try { window.kiri.api.event.on('widget.select',    () => setTimeout(applyToStock, 10)); } catch (e) {}
            try { window.kiri.api.event.on('widget.deselect',  () => setTimeout(applyToStock, 10)); } catch (e) {}
            // the list depends on the machine (no metals on the ShopBot)
            try { window.kiri.api.event.on('device.selected', () => setTimeout(machineChanged, 50)); } catch (e) {}
            try { window.kiri.api.event.on('device.select', () => setTimeout(machineChanged, 50)); } catch (e) {}
            machineChanged();
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

  // for the animators' tool and flute tinting
  window.__swarfGetFluteTexture = getFluteTexture;
  window.__swarfApplyAppearance = applyAppearance;
})();
