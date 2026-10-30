/*
 * swarf file — a .swarf project (Phil 10-30: "a superset filetype like .swarf that saved
 * everything and opened up with everything exactly the same, maybe on a different machine,
 * by drag and drop"). files › save project (.swarf), or ⌘S; open it with files › import, by
 * dropping it on the bed, or by double-clicking it when swarf is installed.
 *
 * A .swarf is a zip of three files:
 *   manifest.json   { format: 'swarf', version: 1, app, build, saved, units }
 *   workspace.json  Kiri's own workspace export, meshes included (the same as a .kmz holds):
 *                   every part with its place and its whole meta and anno, carried as they are —
 *                   DRAW's drawing (meta.svg, xf, c0, t, edge, engrave), TEX's marks (meta.tex),
 *                   tabs (anno.tab, anno.tabset: auto, pinned, by hand, and whatever a later
 *                   swarf adds there) — and the settings: steps in order with their numbers,
 *                   board (stock), bits (tool library), machine, units
 *   swarf.json      what swarf keeps outside Kiri's settings: the PROJECT keys below
 *
 * A .kmz stays Kiri's (files › save for Kiri:Moto): it opens in Kiri:Moto, less the steps Kiri
 * does not have (TEX's texture and pierce). .swarf keeps everything.
 *
 * What goes in the file and what stays on this computer:
 *
 *   in the file (the project)              | stays on this computer (preferences, the machine)
 *   ---------------------------------------+------------------------------------------------------
 *   parts, places, drawings, marks, tabs   | swarf-skin, swarf-sound, swarf_phone_mode
 *     (workspace.json, on each part)       | swarf.chips / .lightstream / .paths, swarf-run-ghost
 *   steps and their settings, board, bits, | swarf-markup-toolbar-pos / -collapsed (window layout)
 *     machine profile, units               | swarf-draw-thick / -engrave, swarf-tex-brush / -fill,
 *     (workspace.json settings)            |   swarf-shape-last, swarf-size-keep (a tool's last value)
 *   swarf.material.current  (material)     | swarf-lesson-board, swarf-test-results (test cuts)
 *   swarf.autotabs   (the tab card's rule) | swarf-shopbot-link / -anyport (connection, port)
 *   swarf-expert     (advanced or basic)   | swarf-origin-front-left, swarf.r14.…, swarf.082.…
 *                                          |   (install and upgrade steps), swarf-file-saved
 *                                          | camera, opacity, view toggles (Kiri's local + controller)
 *   NEVER, in either direction: a machine zero, position or jog state — swarf-run-zero,
 *   swarf-shopbot-origin / -home / -plate / -flip / -stop / -coast / -checked,
 *   swarf-plate-thickness, swarf-table-corner. A reopened job asks for zero as a new one does.
 */
(function (root) {
  'use strict';
  const FORMAT = 'swarf', VERSION = 1, MODE = 'CAM';
  // the swarf keys that are the project's, and what each is (the only ones a file writes or reads)
  const PROJECT_KEYS = {
    'swarf.material.current': 'material',
    'swarf.autotabs': 'tab settings',
    'swarf-expert': 'advanced or basic',
  };
  // this computer's: written down so a new key has to be put on one side (tools/test-swarf-file.mjs)
  const LOCAL_KEYS = [
    'swarf-skin', 'swarf-sound', 'swarf_phone_mode', 'swarf.chips', 'swarf.lightstream', 'swarf.paths', 'swarf-run-ghost',
    'swarf-markup-toolbar-pos', 'swarf-markup-toolbar-collapsed', 'swarf-draw-thick', 'swarf-draw-engrave',
    'swarf-tex-brush', 'swarf-tex-fill', 'swarf-shape-last', 'swarf-size-keep', 'swarf-lesson-board', 'swarf-test-results',
    'swarf-shopbot-link', 'swarf-shopbot-anyport', 'swarf-origin-front-left', 'swarf-file-saved',
  ];
  // the machine's zero and where it is: never in a file, never taken from one
  const NEVER_KEYS = [
    'swarf-run-zero', 'swarf-shopbot-origin', 'swarf-shopbot-home', 'swarf-shopbot-plate', 'swarf-shopbot-flip',
    'swarf-shopbot-stop', 'swarf-shopbot-coast', 'swarf-shopbot-checked', 'swarf-plate-thickness', 'swarf-table-corner',
  ];
  const NEVER_RE = /zero|origin|home|plate|jog|position|corner|flip|e-?stop|coast|checked/i;
  // Kiri:Moto's own steps; any other type is swarf's and is left out of a .kmz
  const KIRI_OPS = ['area', 'contour', 'drill', 'flip', 'gcode', 'helical', 'index', 'laser off', 'laser on', 'lathe', 'level',
    'loop', 'outline', 'pocket', 'register', 'rough', 'shadow', 'trace', 'xray'];

  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  // equal as saved: key order does not matter
  function canon(o) {
    if (Array.isArray(o)) return o.map(canon);
    if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o).sort()) if (o[k] !== undefined) r[k] = canon(o[k]); return r; }
    return o;
  }
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

  function manifest({ app, build, units, saved } = {}) {
    return { format: FORMAT, version: VERSION, app: app || '', build: build || '', saved: saved || new Date().toISOString(), units: units === 'in' ? 'in' : 'mm' };
  }

  // what this swarf can do with a file's manifest: { ok, newer, say }
  function checkManifest(m, app) {
    if (!m || m.format !== FORMAT) return { ok: false, say: 'That is not a swarf project: it has no swarf manifest.' };
    const v = +m.version;
    if (!(v >= 1)) return { ok: false, say: 'That swarf project has no version swarf can read.' };
    if (v > VERSION) return { ok: true, newer: true, say: `This project was saved by a newer swarf (${m.app || `file version ${v}`}) than this one (${app || `file version ${VERSION}`}). swarf opened what it can read: check the parts and steps, or open it in the newer swarf.` };
    return { ok: true, newer: false, say: '' };
  }

  // the project's swarf keys, from a getItem — the ones listed above and no other
  function projectLocal(getItem) {
    const out = {};
    for (const k of Object.keys(PROJECT_KEYS)) {
      let v = null;
      try { v = getItem(k); } catch (e) { /* private window */ }
      if (v !== null && v !== undefined) out[k] = String(v);
    }
    return out;
  }
  // the keys of a file's swarf.json a reader takes: project keys only, never a zero
  function readLocal(local) {
    const out = {};
    for (const [k, v] of Object.entries(local || {})) if (PROJECT_KEYS[k] && !NEVER_KEYS.includes(k) && typeof v === 'string') out[k] = v;
    return out;
  }

  function swarfJson({ local, material, units, expert, app }) {
    return { format: FORMAT, version: VERSION, app: app || '', mode: 'cam', material: material || null, units: units === 'in' ? 'in' : 'mm', expert: !!expert, local: readLocal(local) };
  }

  // every key path in o that names a zero or a position of the machine (for the tests)
  function zeroKeys(o, path = '') {
    const hits = [];
    if (o && typeof o === 'object') for (const k of Object.keys(o)) {
      const p = path ? `${path}.${k}` : k;
      if (NEVER_KEYS.includes(k)) hits.push(p);
      hits.push(...zeroKeys(o[k], p));
    }
    return hits;
  }

  // the tool ids a process's steps use
  function usedTools(proc) {
    const ids = new Set();
    for (const op of [...((proc && proc.ops) || []), ...((proc && proc.op2) || [])]) if (op && op.tool !== undefined && op.tool !== null) ids.add(op.tool);
    for (const [k, v] of Object.entries(proc || {})) if (/^cam.*Tool$/.test(k) && v !== undefined && v !== null && typeof v !== 'object') ids.add(v);
    return ids;
  }
  // a step's material stamp (swarf-material.js applyFeedsToOps) names its bit and machine:
  // rewrite those when a bit or the machine takes a new name here, so its numbers are kept
  function restamp(preset, toolId, devName) {
    const m = typeof preset === 'string' && preset.match(/^([^:]*):([^:]*):(.*):(-?[\d.]+):([^:]*)$/);
    if (!m) return preset;
    return `${m[1]}:${toolId}:${devName}:${m[4]}:${m[5]}`;
  }
  function eachOp(set, fn) {
    const procs = [set.process];
    for (const p of Object.values((set.sproc && set.sproc[MODE]) || {})) procs.push(p);
    for (const p of procs) for (const op of [...((p && p.ops) || []), ...((p && p.op2) || [])]) if (op) fn(op, p);
  }

  // This computer's settings with a file's project laid over them. Its machine and bits are
  // added here when this computer has none like them (a different one with the same name or
  // id comes in under a new one, never swapped for this computer's). Everything else in the
  // settings — the camera, view toggles, other machines and saved processes — stays this
  // computer's. Returns { settings, notes: [plain sentences] }.
  function mergeSettings(local, file, opt = {}) {
    const out = clone(local) || {};
    const notes = [];
    const from = opt.name ? `from ${opt.name}` : 'from the file';
    file = file || {};
    out.mode = MODE;
    for (const k of ['devices', 'devproc', 'cproc', 'filter', 'cdev', 'widget', 'controller']) out[k] = out[k] || {};
    out.sproc = out.sproc || {}; out.sproc[MODE] = out.sproc[MODE] || {};
    out.tools = Array.isArray(out.tools) ? out.tools : [];
    // the machine
    const fdev = clone(file.device || (file.cdev && file.cdev[MODE]) || null);
    let devName = (file.filter && file.filter[MODE]) || (fdev && fdev.deviceName) || '';
    const oldDev = devName;
    if (fdev && devName) {
      const fileCode = file.devices && file.devices[devName];
      const mine = out.devices[devName];
      const builtin = !!(opt.builtin && opt.builtin(devName));
      if (fileCode) {
        if (!mine && !builtin) { out.devices[devName] = clone(fileCode); notes.push(`The machine "${devName}" was not on this computer: swarf added it ${from}.`); }
        else if (mine && !same(mine, fileCode)) {
          let n = `${devName} (${from.replace(/^from /, '')})`, i = 2;
          while (out.devices[n]) n = `${devName} (${from.replace(/^from /, '')} ${i++})`;
          out.devices[n] = clone(fileCode);
          notes.push(`This computer has its own "${devName}", set up differently: the file's comes in as "${n}", so the job is made for the machine it was made for.`);
          devName = n;
        }
      } else if (!builtin && !mine) {
        out.devices[devName] = clone(fdev);
        notes.push(`The machine "${devName}" was not on this computer: swarf added it ${from}.`);
      }
      fdev.deviceName = devName;
      out.device = fdev;
      out.cdev[MODE] = clone(fdev);
      out.filter[MODE] = devName;
    }
    // the bits the steps use
    const remap = {};
    const ftools = Array.isArray(file.tools) ? file.tools : [];
    const used = usedTools(file.process);
    const added = [], renamed = [];
    let next = Math.max(1000, ...out.tools.map(t => +t.id || 0), ...ftools.map(t => +t.id || 0)) + 1;
    for (const t of ftools) {
      if (!used.has(t.id)) continue;
      const mine = out.tools.find(x => x.id === t.id);
      if (!mine) { out.tools.push(clone(t)); added.push(t.name || `bit ${t.id}`); }
      else if (!same(mine, t)) {
        const c = clone(t); c.id = next++; remap[t.id] = c.id;
        out.tools.push(c); renamed.push(t.name || `bit ${t.id}`);
      }
    }
    if (added.length) notes.push(`${added.length === 1 ? 'A bit' : `${added.length} bits`} the steps use ${added.length === 1 ? 'was' : 'were'} not in this computer's tool library: swarf added ${added.map(n => `"${n}"`).join(', ')}.`);
    if (renamed.length) notes.push(`This computer's tool library has ${renamed.length === 1 ? 'a different bit' : 'different bits'} under the same number as ${renamed.map(n => `"${n}"`).join(', ')}: the file's ${renamed.length === 1 ? 'comes' : 'come'} in as ${renamed.length === 1 ? 'a new bit' : 'new bits'}, and the steps use ${renamed.length === 1 ? 'it' : 'them'}.`);
    // the steps, the board, and every other process number
    const proc = clone(file.process || {});
    const pname = proc.processName || (file.cproc && file.cproc[MODE]) || 'default';
    out.process = proc;
    out.sproc[MODE][pname] = clone(proc);
    out.cproc[MODE] = pname;
    if (devName) out.devproc[devName] = pname;
    const fix = op => {
      const t0 = op.tool;
      if (remap[t0] !== undefined) op.tool = remap[t0];
      if (op.preset && (remap[t0] !== undefined || devName !== oldDev)) op.preset = restamp(op.preset, op.tool, devName);
    };
    for (const op of [...(proc.ops || []), ...(proc.op2 || [])]) if (op) fix(op);
    for (const op of [...(out.sproc[MODE][pname].ops || []), ...(out.sproc[MODE][pname].op2 || [])]) if (op) fix(op);
    for (const p of [proc, out.sproc[MODE][pname]]) for (const k of Object.keys(p)) if (/^cam.*Tool$/.test(k) && remap[p[k]] !== undefined) p[k] = remap[p[k]];
    // the parts' legacy annotations (Kiri's import moves them onto the parts) and the units
    out.widget = clone(file.widget || {});
    if (file.controller && file.controller.units) out.controller.units = file.controller.units === 'in' ? 'in' : 'mm';
    return { settings: out, notes };
  }

  // a .kmz's settings, for Kiri:Moto: swarf's own steps (TEX's) left out. Changes `set` in place
  // (it is the export's own copy); returns how many steps were left out.
  function kmzSafe(set) {
    let dropped = 0;
    const keep = (list, count) => {
      // '|' is Kiri's own end-of-steps marker (cam's step list keeps one last), not a step
      const k = list.filter(op => !op || KIRI_OPS.includes(op.type) || op.type === '|');
      if (count) dropped += list.length - k.length;
      return k;
    };
    const live = set && set.process;
    const procs = [live];
    for (const m of Object.keys((set && set.sproc) || {})) for (const p of Object.values(set.sproc[m] || {})) procs.push(p);
    for (const p of procs) {
      if (!p) continue;
      if (Array.isArray(p.ops)) p.ops = keep(p.ops, p === live);
      if (Array.isArray(p.op2)) p.op2 = keep(p.op2, p === live);
    }
    return dropped;
  }

  // a short fingerprint of a project, to know whether the bed holds what was last saved or opened
  function fingerprint(parts, proc, material) {
    const s = JSON.stringify(canon({ parts, ops: (proc && proc.ops) || [], op2: (proc && proc.op2) || [], material: material || null }));
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${s.length}:${(h >>> 0).toString(36)}`;
  }

  const core = { FORMAT, VERSION, PROJECT_KEYS, LOCAL_KEYS, NEVER_KEYS, NEVER_RE, KIRI_OPS, manifest, checkManifest, projectLocal, readLocal, swarfJson, zeroKeys, mergeSettings, kmzSafe, usedTools, restamp, fingerprint, same };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  if (typeof window === 'undefined') { root.SwarfFileCore = core; return; }

  // ------------------------------------------------------------------ in the app
  const api = () => window.kiri && window.kiri.api;
  const $ = id => document.getElementById(id);
  const SAVED = 'swarf-file-saved';
  // the name the project was last saved or opened as, while the bed is still that project: the
  // export's file name starts with it (cutting-board.sbp, not rectangle-1-002.sbp)
  let project = null;
  const projectName = () => (project && api() && api().widgets.all().length ? project : null);
  const app = () => window.SWARF_VERSION || '';
  const units = () => { try { return api().conf.get().controller.units === 'in' ? 'in' : 'mm'; } catch (e) { return 'mm'; } };
  const say = (t, s) => { try { api().show.alert(t, s || 8); } catch (e) { console.log(t); } };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function current() {
    const a = api();
    const parts = a.widgets.all().map(w => ({ id: w.id, pos: w.track && w.track.pos, meta: w.meta, anno: w.anno, n: w.vertices ? w.vertices.length : 0 }));
    const mat = window.__swarfMaterial && window.__swarfMaterial.id;
    return fingerprint(parts, a.conf.get().process, mat);
  }
  const remember = () => { try { localStorage.setItem(SAVED, current()); } catch (e) { /* private window */ } };
  function unsaved() {
    const a = api();
    if (!a || !a.widgets.all().length) return false;
    try { return localStorage.getItem(SAVED) !== current(); } catch (e) { return true; }
  }

  // DRAW or TEX open: leave as done does, so what is on the board goes in the file
  // (whole-app review r086 F5) a save never leaves the mode or drops work: an outline still being
  // drawn refuses the save, in DRAW's own line, saying why; otherwise the mode keeps its changes
  // as done does, the file is written, and the mode comes straight back, as it was left
  function leaveModes(apply) {
    for (const M of [window.__swarfTex, window.__swarfDraw]) {
      const st = M && M.state && M.state();
      if (!st) continue;
      if (apply && Array.isArray(st.pen) && st.pen.length) {
        if (M.say) M.say('Finish the outline first (click its first point to close it, or press Esc to drop it), then save.');
        return false;
      }
      M.close(apply);
      if (M.state()) return false;
      if (apply) setTimeout(() => { if (!M.state()) M.open(); }, 0);
    }
    return true;
  }

  // the steps a student sees: Kiri's '|' end-of-steps divider is not one (review 10-30 F3)
  const stepCount = () => { try { return (api().conf.get().process.ops || []).filter(o => o && o.type !== '|').length; } catch (e) { return 0; } };

  function nameFor() {
    const a = api();
    const w = a.widgets.all()[0];
    const base = (w && w.meta && w.meta.file) || 'project';
    return String(base).replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  }

  // files › save project (.swarf). opt.name skips the name card (the probe).
  function save(opt = {}) {
    const a = api();
    if (!a || !a.client || !a.client.zip) return Promise.resolve(false);
    if (!leaveModes(true)) { say('Finish the drawing first (it says what is wrong), then save the project.'); return Promise.resolve(false); }
    if (!a.widgets.all().length) { say('Nothing to save yet: make or import a part first.', 6); return Promise.resolve(false); }
    const ask = opt.name ? Promise.resolve(opt.name) : a.uc.prompt('Save the project as', nameFor());
    return ask.then(name => {
      if (!name) return false;
      name = String(name).replace(/\.swarf$/i, '').replace(/[\\/:*?"<>|]+/g, '-');
      const ws = a.conf.export({ work: true, clear: true });
      const local = projectLocal(k => localStorage.getItem(k));
      const mat = window.__swarfMaterial && window.__swarfMaterial.id;
      const sj = swarfJson({ local, material: mat, units: units(), expert: document.body.classList.contains('swarf-expert'), app: app() });
      const man = manifest({ app: app(), build: window.SWARF_BUILD || '', units: units() });
      return new Promise(resolve => {
        a.client.zip([
          { name: 'manifest.json', data: JSON.stringify(man, null, 1) },
          { name: 'workspace.json', data: JSON.stringify(ws) },
          { name: 'swarf.json', data: JSON.stringify(sj, null, 1) },
        ], progress => { a.show.progress(progress.percent / 100, 'saving the project'); }, output => {
          a.show.progress(0);
          a.util.download(output, `${name}.swarf`);
          project = name;
          remember();
          say(`Saved ${name}.swarf: ${a.widgets.all().length} part${a.widgets.all().length === 1 ? '' : 's'} and ${stepCount()} step${stepCount() === 1 ? '' : 's'}. Drop it on swarf's bed, on this computer or another, to carry on.`, 8);
          resolve(true);
        });
      });
    });
  }

  function confirmReplace(name) {
    const a = api();
    if (!unsaved()) return Promise.resolve(true);
    const n = a.widgets.all().length;
    const pre = ["<div class='f-col a-center swarf-shape'><h3>Open " + esc(name) + '?</h3>',
      `<p class='swarf-shape-why' style='color:inherit;max-width:340px'>It takes the place of the ${n} part${n === 1 ? '' : 's'} and the steps on the bed now, which are not saved in a .swarf file.</p></div>`];
    return a.uc.confirm(undefined, { 'open it': 'open', 'save mine first': 'save', cancel: false }, undefined, { pre }).then(v => {
      if (v === 'save') return save().then(ok => ok);
      return v === 'open';
    });
  }

  function readZip(data, JSZip) {
    const Z = JSZip || window.JSZip;
    if (!Z) return Promise.reject(new Error('the zip reader is not loaded'));
    return new Z().loadAsync(data).then(zip => {
      const get = n => (zip.files[n] ? zip.files[n].async('string').then(t => JSON.parse(t)) : Promise.resolve(null));
      return Promise.all([get('manifest.json'), get('workspace.json'), get('swarf.json')]).then(([manifest, workspace, swarf]) => ({ manifest, workspace, swarf }));
    });
  }

  // open a .swarf (an ArrayBuffer), from files › import, a drop on the bed or the installed app
  let busy = false;
  function open(data, name, JSZip) {
    const a = api();
    name = String(name || 'project.swarf');
    const R = window.__swarfRun;
    if (R && R.state && R.state.machine && R.state.machine.state && R.state.machine.state.running) {
      say('A job is running in control. Let it finish, or stop it, then open the project.', 8);
      return Promise.resolve(false);
    }
    if (busy) return Promise.resolve(false);
    busy = true;
    return readZip(data, JSZip).then(f => {
      const chk = checkManifest(f.manifest, app());
      if (!chk.ok) { say(chk.say, 8); return false; }
      if (!f.workspace || !f.workspace.settings) { say(`${name} has no parts or settings in it: swarf could not open it.`, 8); return false; }
      return confirmReplace(name).then(go => go ? restore(f, name, chk) : false);
    }).catch(e => { say(`swarf could not open ${name}: ${e.message}`, 8); return false; })
      .finally(() => { busy = false; });
  }

  function restore(f, name, chk) {
    const a = api();
    const ws = f.workspace, sj = f.swarf || {};
    // DRAW and TEX shut without keeping what was on their boards (the file takes its place);
    // control forgets the job it held, so the reopened one asks for its zero as a new one does
    leaveModes(false);
    try { if (window.__swarfRun && window.__swarfRun.forget) window.__swarfRun.forget(); } catch (e) { /* control not loaded */ }
    const merged = mergeSettings(a.conf.get(), ws.settings, { name, builtin: n => !!(a.devices && a.devices.builtin && a.devices.builtin(n)) });
    // the material is the file's before its steps come in, so no step's numbers are made again
    window.__swarfMaterialHold = true;
    const local = readLocal(sj.local);
    for (const [k, v] of Object.entries(local)) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }
    const expert = local['swarf-expert'] === '1' || (local['swarf-expert'] === undefined && !!sj.expert);
    document.body.classList.toggle('swarf-expert', expert);
    const tog = $('swarf-expert-toggle'); if (tog) tog.classList.toggle('selected', expert);
    const notes = chk.newer ? [chk.say] : [];
    notes.push(...merged.notes);
    // the parts the file replaces go quietly: no "Deleted … ⌘Z brings it back" for each (the
    // size card's notice reads this flag), and the old toolpaths leave the bed with them
    window.__swarfRestoring = true;
    setTimeout(() => { window.__swarfRestoring = false; }, 5000);   // never left on by a throw
    try { if (a.view && a.view.set_arrange) a.view.set_arrange(); } catch (e) { /* no view yet */ }
    return new Promise(resolve => {
      a.conf.import({ settings: merged.settings, work: ws.work || [], view: ws.view, version: ws.version, time: ws.time || Date.now() }, false);
      // Kiri adds the parts in a batch (150 ms); then the material, the tab card, the camera
      setTimeout(() => {
        const want = sj.material || local['swarf.material.current'];
        let got = want;
        try { if (want && window.__swarfSetMaterial) got = window.__swarfSetMaterial(want); } catch (e) { /* materials loading */ }
        window.__swarfMaterialHold = false;
        try { if (window.__swarfApplyFeeds) window.__swarfApplyFeeds(); } catch (e) { /* none */ }
        if (want && got && got !== want) notes.push(`The file's material (${want}) cannot be used on this machine here: swarf picked ${got}, and the steps' speeds follow it.`);
        try { if (window.__swarfAutoTabs && window.__swarfAutoTabs.reload) window.__swarfAutoTabs.reload(); } catch (e) { /* none */ }
        try { if (ws.view && window.moto && window.moto.space) window.moto.space.view.load(ws.view); } catch (e) { /* camera */ }
        try { a.conf.update_fields(); a.platform.update_size(); a.platform.update_origin(); } catch (e) { /* none */ }
        try { a.event.emit('cam.op.render'); } catch (e) { /* none */ }
        remember();
        window.__swarfRestoring = false;
        project = String(name).replace(/\.swarf$/i, '');
        const n = a.widgets.all().length, ops = stepCount();
        say([`Opened ${name}: ${n} part${n === 1 ? '' : 's'}, ${ops} step${ops === 1 ? '' : 's'}.`, ...notes].join(' '), notes.length ? 14 : 6);
        try { window.dispatchEvent(new CustomEvent('swarf.file.opened', { detail: { name, notes } })); } catch (e) { /* none */ }
        resolve({ name, notes });
      }, 400);
    });
  }

  // a double-click on a .swarf, when swarf is installed (manifest.json file_handlers)
  try {
    if ('launchQueue' in window) window.launchQueue.setConsumer(params => {
      const files = (params && params.files) || [];
      if (!files.length) return;
      const go = () => Promise.all(files.map(h => h.getFile())).then(list => {
        const a = api();
        if (a && a.platform && a.platform.load_files) a.platform.load_files(list.filter(f => /\.swarf$/i.test(f.name)).slice(0, 1));
      });
      let tries = 0;
      const t = setInterval(() => { const a = api(); if ((a && a.platform && a.widgets && a.conf && document.getElementById('swarf-step-file')) || ++tries > 200) { clearInterval(t); setTimeout(go, 1500); } }, 150);
    });
  } catch (e) { /* no file handling here */ }

  // files › save project, and ⌘S (Ctrl+S): swarf has no other use for it, and the browser's own
  // "save page" is never what a student means
  let tries = 0;
  const t = setInterval(() => {
    const b = $('swarf-file-save');
    if (b || ++tries > 200) clearInterval(t);
    if (b && !b.dataset.wired) { b.dataset.wired = '1'; b.addEventListener('click', ev => { ev.stopPropagation(); save(); }); }
  }, 150);
  window.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 's') return;
    e.preventDefault();
    const a = api();
    if (!a || (a.modal && a.modal.visible && a.modal.visible())) return;
    save();
  }, true);

  window.SwarfFile = Object.assign({ save, open, unsaved, remember, readZip, projectName }, core);
})(typeof window !== 'undefined' ? window : globalThis);
