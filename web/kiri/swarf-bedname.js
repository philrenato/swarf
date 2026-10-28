/*
 * swarf bed name — the machine you are designing for, ghosted into the front
 * left corner of the bed, as a printer's build plate carries its maker's name
 * (Phil 10-28: "make sure someone can see clearly what machine they are
 * designing for"). It lies flat on the bed in bed units, so it scales with the
 * bed and a part placed over it covers it; it follows every machine change.
 */
(function () {
  'use strict';
  if (window.__swarfBedNameLoaded) return;
  window.__swarfBedNameLoaded = true;

  let mesh = null, shown = '';

  function label(d) {
    return String(d.deviceName || 'machine').replace(/\./g, ' ');
  }

  function draw() {
    const THREE = window.THREE, space = window.moto && window.moto.space, a = window.kiri && window.kiri.api;
    if (!THREE || !space || !space.world || !a || !a.conf) return false;
    let d;
    try { d = a.conf.get().device; } catch (e) { return false; }
    if (!d || !(d.bedWidth > 0) || !(d.bedDepth > 0)) return false;
    const S = window.SwarfSkin, skin = S ? S.get() : 'swarf';
    const text = label(d), key = `${text}|${d.bedWidth}|${d.bedDepth}|${d.originCenter}|${skin}`;
    if (key === shown && mesh) return true;
    shown = key;
    if (mesh) { space.world.remove(mesh); mesh = null; }

    // the letters are a sixteenth of the bed's depth tall, inset by one letter
    const h = Math.max(8, d.bedDepth / 16), inset = h;
    const px = 96, font = `600 ${px}px "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace`;
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = font;
    const tw = Math.ceil(g.measureText(text).width) + 8;
    c.width = tw; c.height = Math.ceil(px * 1.25);
    g.font = font;
    g.textBaseline = 'middle';
    g.fillStyle = '#' + (S ? S.color('bedname', 0xe8e0d2) : 0xe8e0d2).toString(16).padStart(6, '0');
    g.fillText(text, 4, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const w = h * 1.25 * c.width / c.height;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: S ? S.number('bedname-opacity', 0.4) : 0.4, depthWrite: false, fog: false });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 1.25), mat);
    mesh.name = 'swarf-bed-name';
    mesh.renderOrder = 1;
    // the bed runs from -W/2..W/2 in world x and y (the platform is centered on
    // the scene whatever the machine's origin), front left = least x and y
    mesh.position.set(-d.bedWidth / 2 + inset + w / 2, -d.bedDepth / 2 + inset + h * 0.625, 0.3);
    mesh.raycast = () => {};
    space.world.add(mesh);
    try { space.refresh(); } catch (e) { /* no view */ }
    return true;
  }
  window.__swarfBedName = () => mesh && { text: shown.split('|')[0], x: mesh.position.x, y: mesh.position.y, visible: mesh.visible };

  let tries = 0;
  const t = setInterval(() => {
    const a = window.kiri && window.kiri.api;
    if ((a && a.event && draw()) || ++tries > 200) {
      clearInterval(t);
      if (!a || !a.event) return;
      for (const ev of ['device.selected', 'device.select', 'settings', 'settings.saved'])
        try { a.event.on(ev, () => setTimeout(draw, 80)); } catch (e) { /* no event */ }
      window.addEventListener('swarf.skin', () => setTimeout(draw, 30));
    }
  }, 150);
})();
