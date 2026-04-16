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
    const make = TEXMAP[name];
    if (!make) return null;
    const src = make();
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
      // swarf v010 r2: RESTRAINED lighting. Previous pass flooded the scene
      // with rim+fill+hemi, washing out face contrast so a cube read as a
      // silhouette blob. Now a single strong key from above-front-right, a
      // gentle warm hemisphere fill, and nothing else — form reads first,
      // env reflections read second.
      try {
        // swarf v010 r8 b: tone down the shop lights — grid was reading
        // too bright; Phil wants floor back to prior scumble/matte finish.
        const hemi = new window.THREE.HemisphereLight(0xcfc0a0, 0x1a1a1a, 0.32);
        scene.add(hemi);
        const key = new window.THREE.DirectionalLight(0xfff4e0, 0.85);
        key.position.set(220, 280, 160);
        scene.add(key);
        const fill = new window.THREE.DirectionalLight(0x9bb4d0, 0.18);
        fill.position.set(-180, 120, -140);
        scene.add(fill);
      } catch (e) {}
      // swarf v010 r8 b: no tonemapping / colorspace override. Earlier
      // ACES + SRGB reinterpretation made the mill-red grid read as hot
      // orange. Keep Kiri's defaults so the floor scumble returns.
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
    const m = materials.find(x => x.id === id) || materials[0];
    if (!m) return;
    current = m;
    window.__swarfMaterial = m;
    try { localStorage.setItem(STORAGE_KEY, m.id); } catch (e) {}
    applyToStock();
    applyFeedsToOps();
    notify();
  }

  // Apply a material preset to a single op record.
  function applyPresetToOp(op, tools, byTool, diameters) {
    // find the tool diameter for this op — convert inches to mm
    const tool = tools.find(t => t.id === op.tool || t.number === op.tool);
    let toolDiam = tool
      ? (tool.flute_diam || tool.shaft_diam || 0.25)
      : 0.25;
    // KM stores imperial tools in inches; by_tool is keyed in mm
    const isMetric = tool && tool.metric;
    if (!isMetric) toolDiam *= 25.4;
    // find closest diameter match in by_tool
    let best = diameters[0];
    let bestDist = Math.abs(toolDiam - best);
    for (const d of diameters) {
      const dist = Math.abs(toolDiam - d);
      if (dist < bestDist) { best = d; bestDist = dist; }
    }
    const preset = byTool[String(best)];
    if (!preset) return;
    if (preset.feed !== undefined)     op.rate    = preset.feed;
    if (preset.plunge !== undefined)   op.plunge  = preset.plunge;
    if (preset.spindle !== undefined)  op.spindle = preset.spindle;
    if (preset.stepdown !== undefined) op.down    = preset.stepdown;
    if (preset.stepover !== undefined) op.step    = preset.stepover;
  }

  // Push the material's by_tool feed/speed/stepdown/stepover into all
  // current ops. Picks the closest tool diameter match from by_tool.
  function applyFeedsToOps() {
    if (!current || !current.by_tool) return;
    const api = window.kiri && window.kiri.api;
    if (!api || !api.conf) return;
    const settings = api.conf.get();
    if (!settings || !settings.process || !settings.process.ops) return;
    const tools = settings.tools || [];
    const byTool = current.by_tool;
    const diameters = Object.keys(byTool).map(Number).sort((a, b) => a - b);
    if (!diameters.length) return;

    for (const op of settings.process.ops) {
      if (!op || !op.type || op.type === '|') continue;
      applyPresetToOp(op, tools, byTool, diameters);
    }
    try { api.conf.save(); } catch (e) {}
    // re-render the entire op list so drawers pick up new values
    try { api.event.emit('cam.op.render'); } catch (e) {}
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
      // swarf v010 r3: do NOT swap material class. Kiri tracks its own
      // material instances (color cache in platform.js, etc.) — replacing
      // the material leaves stale references that repaint the widget black
      // on the next selection change. Just set properties on whatever
      // material Kiri gave us. Fields the material doesn't support (e.g.
      // transmission on MeshPhong) are silently ignored.
      for (const w of widgets) {
        const mesh = w.mesh;
        if (!mesh) continue;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (mat && mat.color) applyAppearance(mat, a);
        }
      }
      // swarf v010: also re-tint the SIMULATE stock mesh material if live
      const animMat = window.__swarfAnimStockMaterial;
      if (animMat) applyAppearance(animMat, a);
      try { window.moto.space.refresh && window.moto.space.refresh(); } catch (e) {}
    } catch (e) { console.warn('swarf-material: applyToStock failed', e); }
  }

  // ---- material dropdown UI -------------------------------------------
  function injectDropdown() {
    const camops = document.getElementById('camops');
    if (!camops || camops.querySelector('#swarf-material-row')) return;
    const row = document.createElement('div');
    row.id = 'swarf-material-row';
    row.style.cssText = 'display:flex; gap:8px; padding:8px 6px; align-items:center; border-bottom:1px solid var(--swarf-accent, #7a2a1a); background:rgba(208,32,32,0.04); margin-bottom:6px;';
    const label = document.createElement('span');
    label.textContent = 'material';
    label.style.cssText = 'font-size:13px; letter-spacing:0.18em; text-transform:uppercase; color:var(--swarf-accent-hi, #ff3a2a); font-weight:600; flex:0 0 auto;';
    const select = document.createElement('select');
    select.id = 'swarf-material-select';
    select.title = 'stock material — sets PBR surface, chip physics, and starting feeds/speeds';
    select.style.cssText = 'flex:1; font-size:13px; padding:6px 8px; background:rgba(0,0,0,0.55); border:1px solid var(--swarf-accent, #7a2a1a); color:#fff; border-radius:2px; font-family:"JetBrains Mono","IBM Plex Mono",ui-monospace,monospace;';
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
            // apply material feeds after slice (incl. auto-inject) and when ops change
            try { window.kiri.api.event.on('slice.end', () => setTimeout(applyFeedsToOps, 100)); } catch (e) {}
            try { window.kiri.api.event.on('preview.end', () => setTimeout(applyFeedsToOps, 100)); } catch (e) {}
            // when a new op is added via the UI, apply material feeds to it
            try { window.kiri.api.event.on('cam.op.add', () => setTimeout(applyFeedsToOps, 50)); } catch (e) {}
            try { window.kiri.api.event.on('cam.op.list', () => setTimeout(applyFeedsToOps, 50)); } catch (e) {}
            // swarf v010 debt: re-apply after slice/view rebuilds the mesh
            try { window.kiri.api.event.on('slice.end', () => setTimeout(applyToStock, 30)); } catch (e) {}
            try { window.kiri.api.event.on('view.set',  () => setTimeout(applyToStock, 30)); } catch (e) {}
            try { window.kiri.api.event.on('animate',   () => setTimeout(applyToStock, 30)); } catch (e) {}
            // swarf v010 r3: Kiri's platform.js overrides widget.mesh.material.color
            // on hover/select/disable. Re-apply our appearance after any
            // selection state change so materials can't drift to stale colors.
            try { window.kiri.api.event.on('selection.*',      () => setTimeout(applyToStock, 10)); } catch (e) {}
            try { window.kiri.api.event.on('widget.select',    () => setTimeout(applyToStock, 10)); } catch (e) {}
            try { window.kiri.api.event.on('widget.deselect',  () => setTimeout(applyToStock, 10)); } catch (e) {}
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
  window.__swarfApplyAppearance = applyAppearance;
})();
