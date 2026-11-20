/*
 * swarf file — a .swarf project (a superset filetype that saves
 * everything and opens with everything exactly the same, maybe on a different machine,
 * by drag and drop). file › save project (.swarf), or ⌘S; open it with file › import, by
 * dropping it on the bed, or by double-clicking it when swarf is installed.
 *
 * A .swarf is a zip of three files and one binary file per part:
 *   manifest.json   { format: 'swarf', version: 2, app, build, saved, units }
 *   workspace.json  Kiri's own workspace export (the same as a .kmz holds, less the meshes):
 *                   every part with its place and its whole meta and anno, carried as they are —
 *                   DRAW's drawing (meta.svg, xf, c0, t, edge, engrave), TEX's marks (meta.tex),
 *                   tabs (anno.tab, anno.tabset: auto, pinned, by hand, and whatever a later
 *                   swarf adds there) — and the settings: steps in order with their numbers,
 *                   board (stock), bits (tool library), machine, units
 *   swarf.json      what swarf keeps outside Kiri's settings: the PROJECT keys below
 *   parts/<id>.f32  each part's vertices, little-endian float32 (x, y, z per corner, 3 corners a
 *                   triangle); its workspace.json entry names it in geof32 and has no geo. A version 1
 *                   file has each part's vertices in workspace.json as a JSON number array (geo,
 *                   json: true): it opens as before. LIMIT caps the sizes, the same at save and open.
 *
 * A .kmz stays Kiri's (file › save for Kiri:Moto): it opens in Kiri:Moto, less the steps Kiri
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
 *   swarf-plate-thickness, swarf-table-corner, swarf-grbl-zero. A reopened job asks for zero as a new one does.
 */
(function (root) {
  'use strict';
  const FORMAT = 'swarf', VERSION = 2, MODE = 'CAM';
  // the swarf keys that are the project's, and what each is (the only ones a file writes or reads)
  const PROJECT_KEYS = {
    'swarf.material.current': 'material',
    'swarf.autotabs': 'tab settings',
    'swarf-expert': 'advanced or basic',
  };
  // this computer's: written down so a new key has to be put on one side (tools/test-swarf-file.mjs)
  const LOCAL_KEYS = [
    'swarf-skin', 'swarf-sound', 'swarf_phone_mode', 'swarf.chips', 'swarf.lightstream', 'swarf.paths', 'swarf-run-ghost', 'swarf-sim-bed-still',
    'swarf-markup-toolbar-pos', 'swarf-markup-toolbar-collapsed', 'swarf-draw-thick', 'swarf-draw-engrave',
    'swarf-tex-brush', 'swarf-tex-fill', 'swarf-shape-last', 'swarf-size-keep', 'swarf-lesson-board', 'swarf-test-results',
    'swarf-shopbot-link', 'swarf-shopbot-anyport', 'swarf-origin-front-left', 'swarf-file-saved', 'swarf.help.pos', 'swarf-build-reload',
  ];
  // the machine's zero and where it is: never in a file, never taken from one
  const NEVER_KEYS = [
    'swarf-run-zero', 'swarf-shopbot-origin', 'swarf-shopbot-home', 'swarf-shopbot-plate', 'swarf-shopbot-flip',
    'swarf-shopbot-stop', 'swarf-shopbot-coast', 'swarf-shopbot-checked', 'swarf-plate-thickness', 'swarf-table-corner',
    'swarf-grbl-zero',
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
    // a name that is an object's own key (__proto__, constructor) cannot be a map's key
    if (typeof devName !== 'string' || devName in Object.prototype) devName = '';
    const oldDev = devName;
    if (fdev && devName) {
      const fileCode = file.devices && file.devices[devName];
      const mine = out.devices[devName];
      const builtin = !!(opt.builtin && opt.builtin(devName));
      if (fileCode) {
        if (!mine && !builtin) { out.devices[devName] = clone(fileCode); notes.push(`The machine "${devName}" was not on this computer: swarf added it ${from}.`); }
        else if (mine && !same(mine, fileCode)) {
          const proj = String(opt.name || 'file').replace(/\.swarf$/i, '').replace(/\./g, ' ');
          let n = `${devName} (${proj})`, i = 2;
          while (out.devices[n]) n = `${devName} (${proj} ${i++})`;
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
    let pname = proc.processName || (file.cproc && file.cproc[MODE]) || 'default';
    if (typeof pname !== 'string' || pname in Object.prototype) pname = 'default';
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
    return { settings: out, notes, remap };
  }

  // the parts' own bit numbers follow the bits mergeSettings renumbered: each TEX mark's fill bit
  // (texture, v-carve, pierce, inlay steps take it from there, and DRAW's carving reads it too).
  // `work` is the file's encoded parts; changed in place. Returns how many marks were re-pointed.
  function remapMarks(work, remap) {
    let n = 0;
    if (!remap || !Object.keys(remap).length || !Array.isArray(work)) return n;
    for (const w of work) {
      const tex = w && w.meta && Array.isArray(w.meta.tex) ? w.meta.tex : [];
      for (const m of tex) {
        if (m && m.fill && m.fill.tool !== undefined && remap[m.fill.tool] !== undefined) { m.fill.tool = remap[m.fill.tool]; n++; }
      }
    }
    return n;
  }

  // a .kmz's settings, for Kiri:Moto: swarf's own steps (TEX's) left out. Changes `set` in place
  // (it is the export's own copy); returns how many steps were left out. A tab's rot stays the
  // array Kiri:Moto writes and reads itself (cl-tab.js: let [x, y, z, w] = rec.rot).
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
  // (more: the rest of what a save keeps, such as the whole process, the bits and the machine)
  function fingerprint(parts, proc, material, more) {
    const s = JSON.stringify(canon({ parts, ops: (proc && proc.ops) || [], op2: (proc && proc.op2) || [], material: material || null, ...(more ? { more } : {}) }));
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${s.length}:${(h >>> 0).toString(36)}`;
  }

  // ── sizes: one limit for save and open ──
  // bytes each entry may unpack to; mesh is all parts' vertex bytes together (12 bytes a corner,
  // 36 a triangle). workspace.json is the cap a version 1 file (meshes as JSON) also meets.
  const LIMIT = { 'manifest.json': 1 << 16, 'swarf.json': 1 << 22, 'workspace.json': 1 << 28, mesh: 1 << 28 };
  const TRI_BYTES = 36;
  const maxTriangles = () => Math.floor(LIMIT.mesh / TRI_BYTES);
  const PART_RE = /^parts\/[\w.-]+\.f32$/;
  const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const millions = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} million` : String(n));
  const couldNot = e => `Couldn't save: ${String((e && e.message) || e || 'something went wrong').replace(/\.$/, '')}. Your parts are still here.`;
  const tooBig = tri => `This project is too big to save: its parts have ${millions(tri)} triangles, and a project holds at most ${millions(maxTriangles())}. Use a simpler mesh (fewer triangles), then save.`;

  // a Float32Array as little-endian bytes (a view of the same memory on a little-endian computer)
  function f32bytes(f) {
    if (LE) return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    const out = new Uint8Array(f.byteLength), dv = new DataView(out.buffer);
    for (let i = 0; i < f.length; i++) dv.setFloat32(i * 4, f[i], true);
    return out;
  }
  // little-endian bytes back to a Float32Array (copied when the bytes are not 4-aligned)
  function bytesf32(u) {
    if (u.byteLength % 4) throw new Error('a part in it is damaged');
    if (LE) return u.byteOffset % 4 ? new Float32Array(u.slice().buffer) : new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4);
    const out = new Float32Array(u.byteLength / 4), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
    return out;
  }

  // a workspace export (its work[] geo a Float32Array or a number array) to the zip's entries:
  // { ok, files: [{ name, data }], triangles } or { ok: false, say } when it is over LIMIT
  function pack(ws, extra = []) {
    const work = (ws && ws.work) || [];
    let bytes = 0;
    for (const w of work) if (w && w.geo) bytes += w.geo.length * 4;
    const triangles = Math.round(bytes / TRI_BYTES);
    if (bytes > LIMIT.mesh) return { ok: false, say: tooBig(triangles), triangles };
    const parts = [], used = new Set();
    const out = { ...ws, work: work.map((w, i) => {
      if (!w || !w.geo) return w;
      let base = String(w.id || `part-${i}`).replace(/[^\w.-]+/g, '-') || `part-${i}`, name = `parts/${base}.f32`;
      for (let k = 2; used.has(name); k++) name = `parts/${base}-${k}.f32`;
      used.add(name);
      const f = w.geo instanceof Float32Array ? w.geo : new Float32Array(w.geo);
      parts.push({ name, data: f32bytes(f) });
      const { geo, ...rest } = w;
      return { ...rest, json: false, geof32: name };
    }) };
    const text = JSON.stringify(out);
    if (text.length > LIMIT['workspace.json']) return { ok: false, say: `This project is too big to save: its drawings and settings come to ${Math.round(text.length / 1048576)} MB, more than a project holds.`, triangles };
    return { ok: true, triangles, files: [...extra, { name: 'workspace.json', data: text }, ...parts] };
  }

  // every part's mesh is whole triangles of real numbers, checked before anything on the bed
  // changes: a damaged part refuses the whole file and the parts there now stay
  function checkParts(work) {
    if (work === undefined || work === null) return '';
    if (!Array.isArray(work)) return 'its list of parts is damaged';
    for (const w of work) {
      if (!w || typeof w !== 'object' || (w.type !== 100 && w.type !== 'widget')) return 'a part in it is damaged: it is not a part swarf knows';
      if (!('geo' in w)) return 'a part in it is damaged: its mesh is missing';
      const g = w.geo, n = g && g.length;
      if (!(n > 0) || n % 9) return 'a part in it is damaged: its mesh is not whole triangles';
      for (let i = 0; i < n; i++) if (!Number.isFinite(g[i])) return 'a part in it is damaged: its mesh has a point that is not a number';
    }
    return '';
  }

  // a .swarf's bytes to { manifest, workspace, swarf }, each part's vertices a Float32Array
  function readZip(data, JSZip) {
    const Z = JSZip || (typeof window !== 'undefined' && window.JSZip);
    if (!Z) return Promise.reject(new Error('the zip reader is not loaded'));
    return new Z().loadAsync(data).then(zip => {
      // sizes checked before inflating: a tiny file that unpacks to gigabytes would take the tab
      const size = f => (f && f._data && f._data.uncompressedSize) || 0;
      const over = (what, n) => new Error(`its ${what} unpacks to ${Math.round(n / 1048576)} MB, more than a project holds`);
      const get = n => {
        const f = zip.files[n];
        if (!f) return Promise.resolve(null);
        if (size(f) > LIMIT[n]) return Promise.reject(over(n, size(f)));
        return f.async('string').then(t => JSON.parse(t));
      };
      let mesh = 0;
      for (const n of Object.keys(zip.files)) if (PART_RE.test(n)) mesh += size(zip.files[n]);
      if (mesh > LIMIT.mesh) return Promise.reject(new Error(`its parts have ${millions(Math.round(mesh / TRI_BYTES))} triangles, more than a project holds (${millions(maxTriangles())})`));
      return Promise.all([get('manifest.json'), get('workspace.json'), get('swarf.json')]).then(([manifest, workspace, swarf]) => {
        const raw = workspace ? workspace.work : undefined;
        if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new Error(checkParts(raw));
        const work = Array.isArray(raw) ? raw : [];
        return Promise.all(work.map(w => {
          if (!w || !w.geof32) return w;
          const f = PART_RE.test(w.geof32) && zip.files[w.geof32];
          if (!f) throw new Error(`a part's mesh (${w.geof32}) is missing from it`);
          return f.async('uint8array').then(u => { const { geof32, ...rest } = w; return { ...rest, json: false, geo: bytesf32(u) }; });
        })).then(list => {
          const bad = checkParts(list);
          if (bad) throw new Error(bad);
          if (workspace && Array.isArray(workspace.work)) workspace.work = list;
          return { manifest, workspace, swarf };
        });
      });
    });
  }

  const core = { FORMAT, VERSION, PROJECT_KEYS, LOCAL_KEYS, NEVER_KEYS, NEVER_RE, KIRI_OPS, manifest, checkManifest, projectLocal, readLocal, swarfJson, zeroKeys, mergeSettings, remapMarks, kmzSafe, usedTools, restamp, fingerprint, same, LIMIT, maxTriangles, tooBig, couldNot, pack, readZip, checkParts };
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
  const say = (t, s) => { try { api().show.alert(t, s || 8); } catch (e) { console.warn(t); } };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function current() {
    const a = api();
    // each part where it sits, its size, turn and mirror; the board, the depth, every bit and the machine
    const parts = a.widgets.all().map(w => {
      const t = w.track || {};
      return { id: w.id, pos: t.pos, scale: t.scale, rot: t.rot, mirror: !!t.mirror, meta: w.meta, anno: w.anno, n: (w.meta && w.meta.vertices) || 0 };
    });
    const mat = window.__swarfMaterial && window.__swarfMaterial.id;
    const set = a.conf.get();
    return fingerprint(parts, set.process, mat, { process: set.process, tools: set.tools, device: set.device && set.device.deviceName, units: set.controller && set.controller.units });
  }
  const remember = () => { try { localStorage.setItem(SAVED, current()); } catch (e) { /* private window */ } };
  function unsaved() {
    const a = api();
    if (!a || !a.widgets.all().length) return false;
    try { return localStorage.getItem(SAVED) !== current(); } catch (e) { return true; }
  }

  // DRAW or TEX open: leave as done does, so what is on the board goes in the file
  // a save never leaves the mode or drops work: an outline still being
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
      // a stroke still under the mouse is not cut short by a save
      if (apply && st.drag) {
        if (M.say) M.say('Let go of the mouse, then save.');
        return false;
      }
      // back on the same tool, part and mark once the save has the marks (S3: it came back on select)
      const was = { tool: st.tool, sel: st.sel, mark: st.mark };
      M.close(apply);
      if (M.state()) return false;
      if (apply) setTimeout(() => {
        if (M.state()) return;
        M.open();
        const now = M.state();
        if (!now) return;
        if (was.sel >= 0 && now.parts && was.sel < now.parts.length) { now.sel = was.sel; now.mark = was.mark; }
        if (was.tool && M.setTool) M.setTool(was.tool);
        if (M.render) M.render();
      }, 0);
    }
    return true;
  }

  // the steps a student sees: Kiri's '|' end-of-steps divider is not one
  const stepCount = () => { try { return (api().conf.get().process.ops || []).filter(o => o && o.type !== '|').length; } catch (e) { return 0; } };

  function nameFor() {
    const a = api();
    const w = a.widgets.all()[0];
    const base = (w && w.meta && w.meta.file) || 'project';
    return String(base).replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  }

  // file › save project (.swarf). opt.name skips the name card (the probe).
  let saves = 0;
  // which bed this is: opening a project or file › new makes another
  let bedGen = 0;
  function save(opt = {}) {
    const a = api();
    if (!a || !a.client || !a.client.zip) return Promise.resolve(false);
    if (!leaveModes(true)) { say('Finish the drawing first (it says what is wrong), then save the project.'); return Promise.resolve(false); }
    if (!a.widgets.all().length) { say('Nothing to save yet: make or import a part first.', 6); return Promise.resolve(false); }
    const ask = opt.name ? Promise.resolve(opt.name) : a.uc.prompt('Save the project as', nameFor());
    return ask.then(name => {
      if (!name) return false;
      name = String(name).replace(/\.swarf$/i, '').replace(/[\\/:*?"<>|]+/g, '-');
      // each part's vertices stay a Float32Array and go in as bytes (pack), not JSON numbers
      const ws = a.conf.export({ work: true, clear: true, binary: true });
      // what this file holds: edits made while it is written stay unsaved
      const fp = current(), nParts = a.widgets.all().length, nSteps = stepCount(), seq = ++saves, gen = bedGen;
      const local = projectLocal(k => localStorage.getItem(k));
      const mat = window.__swarfMaterial && window.__swarfMaterial.id;
      const sj = swarfJson({ local, material: mat, units: units(), expert: document.body.classList.contains('swarf-expert'), app: app() });
      const man = manifest({ app: app(), build: window.SWARF_BUILD || '', units: units() });
      const packed = pack(ws, [
        { name: 'manifest.json', data: JSON.stringify(man, null, 1) },
        { name: 'swarf.json', data: JSON.stringify(sj, null, 1) },
      ]);
      if (!packed.ok) { say(packed.say, 14); return false; }
      return new Promise(resolve => {
        const fail = e => {
          try { a.show.progress(0); } catch (x) { /* no progress bar */ }
          console.warn('swarf save', e);
          say(couldNot(e), 12);
          resolve(false);
        };
        try {
          a.client.zip(packed.files, progress => { a.show.progress(progress.percent / 100, 'saving the project'); }, output => {
            if (!output || output.error) return fail(output && output.error);
            try {
              a.show.progress(0);
              a.util.download(output, `${name}.swarf`);
            } catch (e) { return fail(e); }
            // an older save finishing after a newer one, or after another project took the bed, does
            // not stand for the bed: neither its name nor its saved mark
            if (seq === saves && gen === bedGen) {
              project = name;
              try { localStorage.setItem(SAVED, fp); } catch (e) { /* private window */ }
            }
            say(`Saved ${name}.swarf: ${nParts} part${nParts === 1 ? '' : 's'} and ${nSteps} step${nSteps === 1 ? '' : 's'}. Drop it on swarf's bed, on this computer or another, to carry on.`, 8);
            resolve(true);
          });
        } catch (e) { fail(e); }
      });
    }).catch(e => { console.warn('swarf save', e); say(couldNot(e), 12); return false; });
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

  // open a .swarf (an ArrayBuffer), from file › import, a drop on the bed or the installed app
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
    // a zip library's words (and its web link) mean nothing to a student: the file is not a project
    }).catch(e => { console.warn('swarf open', name, e); say(/central directory|is this a zip|corrupted zip|signature/i.test(e.message || '') ? `swarf could not open ${name}: it is not a swarf project file.` : `swarf could not open ${name}: ${e.message}`, 8); return false; })
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
    remapMarks(ws.work, merged.remap);
    // the material is the file's before its steps come in, so no step's numbers are made again
    window.__swarfMaterialHold = true;
    const local = readLocal(sj.local);
    // what the bed, its settings and these keys were, to put back if the import fails part way
    // (Kiri clears the bed and keeps the file's settings before it reads the first part)
    let back = null;
    try { back = a.conf.export({ work: true, clear: true, binary: true }); } catch (e) { /* nothing to keep */ }
    const wasLocal = {}, wasExpert = document.body.classList.contains('swarf-expert');
    for (const k of Object.keys(local)) { try { wasLocal[k] = localStorage.getItem(k); } catch (e) { /* private window */ } }
    const putBack = () => {
      for (const [k, v] of Object.entries(wasLocal)) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ } }
      document.body.classList.toggle('swarf-expert', wasExpert);
      const t = $('swarf-expert-toggle'); if (t) t.classList.toggle('selected', wasExpert);
      if (!back) return false;
      try { a.conf.import({ settings: back.settings, work: back.work || [], view: back.view, version: back.version, time: back.time }, false); return true; }
      catch (e) { console.warn('swarf open: putting the bed back', e); return false; }
    };
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
      // a file Kiri cannot take (a bad part) lets go of the holds, or feeds stay frozen till a reload;
      // the throw rejects, and open() says swarf could not open it
      try { a.conf.import({ settings: merged.settings, work: ws.work || [], view: ws.view, version: ws.version, time: ws.time || Date.now() }, false); }
      catch (e) {
        const ok = putBack();
        window.__swarfMaterialHold = false;
        setTimeout(() => { window.__swarfRestoring = false; }, ok ? 400 : 0);
        throw new Error(`${e && e.message ? e.message : e}. ${ok ? 'The parts on the bed are as they were.' : 'Reopen your last saved .swarf to get your parts back.'}`);
      }
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
        // the saved camera, unless it shows no part whole (a file saved looking from inside a
        // part): then the parts are framed
        try { if (a.reveal) a.reveal(); } catch (e) { /* no view */ }
        remember();
        window.__swarfRestoring = false;
        bedGen++;
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

  // file › save project, and ⌘S (Ctrl+S): swarf has no other use for it, and the browser's own
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

  // the browser keeps the parts between visits (IndexedDB); ask it once not to clear them when
  // the disk runs low
  try {
    const S = navigator.storage;
    if (S && S.persisted && S.persist) S.persisted().then(yes => (yes ? true : S.persist())).catch(() => {});
  } catch (e) { /* no storage manager */ }
  // a part the browser could not keep (widget.js, kiri.store.failed): say so, and offer the file;
  // asked again only after a quiet spell, so a run of failed writes is one question
  let storeAsked = 0;
  window.addEventListener('kiri.store.failed', ev => {
    const a = api();
    if (!a || !a.uc || Date.now() - storeAsked < 120000) return;
    storeAsked = Date.now();
    const why = /quota/i.test((ev.detail && ev.detail.error) || '') ? 'This browser is out of room' : 'This browser could not keep your parts';
    const pre = ["<div class='f-col a-center swarf-shape'><h3>Your work is not kept</h3>",
      `<p class='swarf-shape-why' style='color:inherit;max-width:340px'>${why}: if this page closes, the parts on the bed are lost. Save the project as a .swarf file to keep them.</p></div>`];
    try {
      a.uc.confirm(undefined, { 'save project': 'save', later: false }, undefined, { pre }).then(v => { if (v === 'save') save(); });
    } catch (e) { say(`${why}. Save the project (⌘S) to keep your parts.`, 12); }
  });

  // file › new: TEX and DRAW shut with nothing kept, control forgets its job, the next save asks for a name
  function fresh() {
    leaveModes(false);
    try { if (window.__swarfRun && window.__swarfRun.forget) window.__swarfRun.forget(); } catch (e) { /* control not loaded */ }
    project = null;
    bedGen++;
  }
  window.SwarfFile = Object.assign({ save, open, unsaved, remember, projectName, fresh }, core);
})(typeof window !== 'undefined' ? window : globalThis);
