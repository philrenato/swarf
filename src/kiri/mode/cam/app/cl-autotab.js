/**
 * swarf auto tabs: one press puts a starting set of tabs on the selected parts' outlines, sized
 * for the material, the outline bit, the board's thickness and the machine (the rule is in
 * autotab-rule.js). Two sliders move it: how many (fewer .. more) and size (smaller .. larger).
 *
 * The press shows a preview first (orange); "apply" makes them ordinary tabs in the existing tab
 * system (the widget's `tab` annotation, drawn by cl-tab.js), so each one is still deleted by
 * clicking it with tabs › + and more are added the same way. Each record carries `auto: true`:
 * applying again replaces only the auto ones, and never a tab placed by hand. An auto tab that
 * would land on a hand-placed one is left out.
 *
 * Parametric (Phil 10-29: "make all the tab attributes parametric and editable"): every number
 * the rule uses has a field: length, height, reach, how many, from corners, big hole, in each
 * hole, and whether big holes get tabs at all. An empty field is automatic and shows the rule's
 * value in grey; a typed value is pinned. A part that has auto tabs keeps its settings
 * (annotation `tabset`), so its tabs follow them:
 *   - change a field and the selected parts' tabs are placed again at once
 *   - scale a part, or change its material, bit, board or machine, and its auto tabs are
 *     placed again (after a scale at once, otherwise when it is next sliced)
 *   - length, height and reach also resize the tabs placed by hand on the selected parts
 * The trash button takes every tab away and forgets the settings.
 */

import { api } from '../../../app/api.js';
import { env } from './init-ui.js';
import { addbox, delbox } from '../../../app/boxes.js';
import { addWidgetTab } from './cl-tab.js';
import { tabRule, planTabs, sliceLoops, tabRecord, holeMinFor, inside } from './autotab-rule.js';
import { space as SPACE } from '../../../../moto/space.js';

const PREVIEW_COLOR = 0xff8800;
const STORE = 'swarf.autotabs';
let preview = null;   // { names: [], plans: [] }
let els = {};
// the settings the panel shows and edits: sliders, and the pinned values (absent = automatic)
let cur = { density: 0, scale: 0, pin: {} };

// every attribute a tab set has; len = a length (mm inside, the cam units on screen)
export const FIELDS = [
    { key: 'width',     label: 'length',       kind: 'len', title: 'how long each tab is, along the edge' },
    { key: 'height',    label: 'height',       kind: 'len', title: 'how tall each tab is, up from the bottom of the cut (less than the board)' },
    { key: 'depth',     label: 'reach',        kind: 'len', title: 'how far each tab reaches across the cut; at least the bit' },
    { key: 'count',     label: 'count',        kind: 'int', title: 'how many tabs around each part\'s outside edge' },
    { key: 'corner',    label: 'from corners', kind: 'len', title: 'how far the middle of a tab stays from a corner' },
    { key: 'holes',     label: 'hold inside pieces', kind: 'bool', title: 'put tabs in holes too, so the piece cut out of a hole stays put and cannot fly' },
    { key: 'holeMin',   label: 'holes from',   kind: 'len', title: 'a hole at least this wide across gets tabs (automatic: any hole that leaves a loose piece)' },
    { key: 'holeCount', label: 'in each hole', kind: 'int', title: 'tabs in each big hole' },
];

const SL = () => window.SwarfLength;
const say = mm => (SL() ? SL().say(mm) : `${(+mm).toFixed(2)} mm`);
const clone = o => JSON.parse(JSON.stringify(o));

function toolMm(tool) {
    if (!tool) return 0;
    const d = tool.flute_diam || tool.shaft_diam || 0;
    return tool.metric ? d : d * 25.4;
}

// the bit that cuts the outline: the outline step's tool, else the first step's, else 1/4 in
function outlineBit(settings) {
    const ops = (settings.process && settings.process.ops) || [];
    const tools = settings.tools || [];
    const op = ops.find(o => o && o.type === 'outline') || ops.find(o => o && o.tool !== undefined);
    const tool = op ? tools.find(t => t.id == op.tool) : null;
    return { mm: toolMm(tool) || 6.35, name: tool ? tool.name : '' };
}

// the inputs the rule reads, for one part
export function autoInputs(widget, opt = {}) {
    const settings = api.conf.get();
    const mat = window.__swarfMaterial || {};
    const bit = outlineBit(settings);
    const box = widget.track.box || {};
    return {
        materialId: mat.id || 'plywood', materialName: mat.name || mat.id || 'plywood', metal: !!mat.metal,
        bitMm: bit.mm, bitName: bit.name,
        thicknessMm: box.d,
        deviceName: (settings.device && settings.device.deviceName) || '',
        density: opt.density ?? 0, scale: opt.scale ?? 0,
        pin: opt.pin || {},
    };
}

// the center height of a tab record, as cl-tab.js computes it for a clicked tab
function tabZ(widget, height) {
    const { stock, bounds, process } = api.conf.get();
    const { camTabsMidline, camZBottom, camStockIndexed } = process;
    const track = widget.track;
    const sz = stock.z || bounds.max.z;
    const zto = sz - track.top;
    const zp = (camZBottom || camStockIndexed ? camZBottom : sz - track.box.d - zto) + (camTabsMidline ? 0 : height / 2);
    return stock.z ? zp + track.pos.z + (env.isIndexed ? 0 : track.tzoff) : height / 2;
}

// what a part's tabs depend on: when this changes, its auto tabs are placed again
function signature(widget, set) {
    const i = autoInputs(widget, set);
    const { stock, process } = api.conf.get();
    const b = widget.track.box || {};
    return JSON.stringify([i.materialId, i.metal, i.bitMm, i.thicknessMm, i.deviceName, set.density, set.scale, set.pin,
        stock.z, process.camZBottom, process.camTabsMidline, b.w, b.h, b.d].map(v => typeof v === 'number' ? +v.toFixed(4) : v));
}

const setOf = widget => api.widgets.annotate(widget.id).tabset;

function targets() {
    const sel = api.selection.widgets(true).filter(w => w && !w.track.synth);
    return sel.length ? sel : api.widgets.all().filter(w => !w.track.synth);
}

/** Plan one part with one set of settings. */
function planOne(widget, set, id) {
    const inputs = autoInputs(widget, set);
    const rule = tabRule(inputs);
    const pos = widget.getGeoVertices({ unroll: true });
    let zmin = Infinity;
    for (let i = 2; i < pos.length; i += 3) zmin = Math.min(zmin, pos[i]);
    const loops = sliceLoops(pos, zmin + Math.min(rule.height / 2, rule.thickness / 2));
    const plan = planTabs(loops, rule, set.pin || {});
    // keep clear of tabs placed by hand
    const hand = (api.widgets.annotate(widget.id).tab || []).filter(r => !r.auto);
    const near = t => hand.some(h => Math.hypot(h.pos.x - t.x, h.pos.y - t.y) < (h.dim.y + rule.width) / 2 + rule.bit + (h.dim.x || 0) / 2);
    const kept = plan.tabs.filter(t => !near(t));
    const z = tabZ(widget, rule.height);
    const records = kept.map(t => tabRecord(t, rule, z, id.next++));
    return { widget, set, rule, inputs, plan, kept, records, hand: hand.length, dropped: plan.tabs.length - kept.length };
}

/**
 * Plan auto tabs for parts (default: the selected ones, or every part when none is selected).
 * @param {Array} widgets
 * @param {Object} opt { density, scale, pin } (default: the panel's)
 * @returns {Array<{ widget, rule, inputs, plan, records }>}
 */
export function autoPlan(widgets, opt) {
    widgets = widgets || targets();
    const set = normal(opt || cur);
    const id = { next: Date.now() };
    return widgets.filter(w => w && !w.track.synth).map(w => planOne(w, set, id));
}

// sliders in range, pins only where they are numbers (or holes: false)
function normal(o) {
    const pin = {};
    for (const f of FIELDS) {
        const v = o.pin && o.pin[f.key];
        if (f.kind === 'bool') { if (v === false) pin[f.key] = false; }
        else if (+v > 0) pin[f.key] = f.kind === 'int' ? Math.round(+v) : +v;
    }
    return { density: +o.density || 0, scale: +o.scale || 0, pin };
}

export function autoCancel() {
    if (preview) for (const n of preview.names) delbox(n);
    preview = null;
    showButtons(false);
}

/** Show the plan as orange boxes and say it in words; nothing is changed until apply. */
export function autoPreview(opt) {
    autoCancel();
    if (!env.isCamMode) return null;
    if (api.conf.get().process.camStockIndexed) {
        sayLine('Auto tabs are for a flat board, not the rotary.');
        return null;
    }
    if (opt) cur = normal(Object.assign(clone(cur), opt));
    const plans = autoPlan(null, cur);
    const names = [];
    for (const p of plans) {
        p.records.forEach((rec, i) => {
            const name = `autotab-${p.widget.id}-${i}`;
            const rot = new THREE.Quaternion(...rec.rot);
            addbox(rec.pos, PREVIEW_COLOR, name, rec.dim, { group: p.widget.mesh, rotate: rot, opacity: 0.55 });
            names.push(name);
        });
    }
    preview = { names, plans };
    sayLine(describe(plans));
    showButtons(plans.some(p => p.records.length));
    showFields(plans[0]);
    try { window.dispatchEvent(new CustomEvent('swarf.autotabs.preview', { detail: summary(plans) })); } catch (e) {}
    return summary(plans);
}

// a quaternion from any of the shapes a tab record's rot takes (array, THREE clone, plain)
function quat(rot) {
    if (Array.isArray(rot)) return new THREE.Quaternion(...rot);
    if (rot && '_x' in rot) return new THREE.Quaternion(rot._x, rot._y, rot._z, rot._w);
    if (rot && 'x' in rot) return new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    return new THREE.Quaternion();
}

function dropLive(widget, rec) {
    const live = widget.tabs && widget.tabs[rec.id];
    if (live && live.box) {
        widget.adds.remove(live.box);
        widget.mesh.remove(live.box);
    }
    if (widget.tabs) delete widget.tabs[rec.id];
}

function addLive(widget, rec) {
    const live = Object.clone(rec);
    live.rot = quat(rec.rot);
    addWidgetTab(widget, live);
}

// a hand-placed tab takes a pinned length, height or reach; it keeps its place on the edge
function resizeHand(widget, rule, pin) {
    if (!(pin.width || pin.height || pin.depth) || api.conf.get().process.camStockIndexed) return 0;
    const anno = api.widgets.annotate(widget.id);
    let n = 0;
    for (const rec of (anno.tab || []).filter(r => !r.auto)) {
        const dim = { x: pin.depth ? rule.depth : rec.dim.x, y: pin.width ? rule.width : rec.dim.y, z: pin.height ? rule.height : rec.dim.z };
        if (dim.x === rec.dim.x && dim.y === rec.dim.y && dim.z === rec.dim.z) continue;
        // the box is centered half a reach out from the edge, along the tab's own x
        const q = quat(rec.rot);
        const a = 2 * Math.atan2(q.z, q.w);
        const shift = (dim.x - rec.dim.x) / 2;
        dropLive(widget, rec);
        rec.pos = { x: rec.pos.x + Math.cos(a) * shift, y: rec.pos.y + Math.sin(a) * shift, z: dim.z === rec.dim.z ? rec.pos.z : tabZ(widget, dim.z) };
        rec.dim = dim;
        addLive(widget, rec);
        n++;
    }
    return n;
}

/** Put these plans' tabs on their parts: their earlier auto tabs go, hand-placed ones stay. */
function place(plans) {
    let placed = 0, replaced = 0, resized = 0;
    for (const p of plans) {
        const { widget } = p;
        const anno = api.widgets.annotate(widget.id);
        const list = (anno.tab = anno.tab || []);
        for (const rec of list.filter(r => r.auto)) {
            dropLive(widget, rec);
            replaced++;
        }
        anno.tab = list.filter(r => !r.auto);
        resized += resizeHand(widget, p.rule, p.set.pin);
        for (const rec of p.records) {
            anno.tab.push(Object.clone(rec));
            addLive(widget, rec);
            placed++;
        }
        anno.tabset = Object.assign(clone(p.set), { sig: signature(widget, p.set) });
        widget.saveState();
    }
    // a tab added by hand next matches these (the panel's width / height / depth)
    const last = plans.find(p => p.records.length);
    if (last) {
        const proc = api.conf.get().process;
        proc.camTabsWidth = last.rule.width;
        proc.camTabsHeight = last.rule.height;
        proc.camTabsDepth = last.rule.depth;
        try { api.conf.update_fields(); } catch (e) {}
    }
    api.conf.save();
    SPACE.update();
    return { placed, replaced, resized };
}

/** Make the previewed tabs real: replace this part's earlier auto tabs, keep hand-placed ones. */
export function autoApply() {
    const plans = preview ? preview.plans : autoPlan(null, cur);
    autoCancel();
    const { placed, replaced } = place(plans);
    sayLine(placed ? `${placed} tab${placed === 1 ? '' : 's'} placed${replaced ? `, replacing ${replaced} auto tab${replaced === 1 ? '' : 's'}` : ''}. Change a number below and they follow. Click one with + to remove it, or click the edge to add one.` : 'No tabs placed.');
    showFields(plans[0]);
    return { placed, replaced };
}

/**
 * Place again the auto tabs of every part whose settings, size, material, bit, board or machine
 * changed since. `force`: every part with settings (a scale took its tabs away).
 * @returns {number} parts placed again
 */
export function autoRefresh(force) {
    if (!env.isCamMode || api.conf.get().process.camStockIndexed) return 0;
    const id = { next: Date.now() };
    const plans = [];
    for (const w of api.widgets.all()) {
        if (w.track.synth) continue;
        const set = setOf(w);
        if (!set) continue;
        if (!force && set.sig === signature(w, set)) continue;
        plans.push(planOne(w, normal(set), id));
    }
    if (plans.length) place(plans);
    return plans.length;
}

// distance from a point to a closed loop
function toLoop(p, loop) {
    let d = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
        d = Math.min(d, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return d;
}

const audits = new Map();   // widget id -> { key, out }

/**
 * What would come loose when this part is cut through (Phil 10-29: "anything that could fly off
 * the machine"): its outside with no tab, and every hole that leaves a loose piece with no tab.
 * @returns {{ outerTabs: number, loose: Array<{ across: number, tabs: number }>, holeMin: number }}
 */
export function autoAudit(widget, opt = {}) {
    const list = api.widgets.annotate(widget.id).tab || [];
    const b = widget.track.box || {};
    const bit = autoInputs(widget).bitMm;
    const key = JSON.stringify([b.w, b.h, b.d, bit, opt.holes, list.map(r => [r.id, r.pos.x, r.pos.y, r.dim.x])]);
    const was = audits.get(widget.id);
    if (was && was.key === key) return was.out;
    const pos = widget.getGeoVertices({ unroll: true });
    let zmin = Infinity;
    for (let i = 2; i < pos.length; i += 3) zmin = Math.min(zmin, pos[i]);
    const loops = sliceLoops(pos, zmin + Math.min(1, (b.d || 2) / 4));
    const holeMin = holeMinFor(bit);
    // which loop each tab sits on: the nearest, within its reach
    const on = list.map(r => {
        let best = -1, bd = Infinity;
        loops.forEach((l, i) => { const d = toLoop(r.pos, l); if (d < bd) { bd = d; best = i; } });
        return bd <= (r.dim.x || 0) / 2 + 2 ? best : -1;
    });
    let outerTabs = 0;
    const loose = [];
    loops.forEach((loop, li) => {
        const depth = loops.reduce((c, other, oi) => c + (oi !== li && inside(loop[0], other) ? 1 : 0), 0);
        const tabs = on.filter(i => i === li).length;
        if (depth % 2 === 0) { outerTabs += tabs; return; }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of loop) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        const across = Math.min(x1 - x0, y1 - y0);
        if (across >= holeMin) loose.push({ across: Math.round(across * 10) / 10, tabs });
    });
    const out = { outerTabs, loose, holeMin, loops: loops.length };
    audits.set(widget.id, { key, out });
    return out;
}

/** Forget every part's settings (the trash button took every tab away). */
export function autoForget() {
    for (const w of api.widgets.all()) delete api.widgets.annotate(w.id).tabset;
    autoCancel();
    sayLine('');
    showFields();
}

// a field or slider changed: the preview follows, or the selected parts' tabs do
function edited() {
    remember();
    if (preview) return autoPreview();
    const ws = targets();
    const withSet = ws.filter(w => setOf(w));
    const handOnly = ws.filter(w => !setOf(w) && (api.widgets.annotate(w.id).tab || []).length);
    let n = 0, resized = 0, capped = null;
    if (withSet.length) {
        const plans = autoPlan(withSet, cur);
        const r = place(plans);
        n = r.placed; resized += r.resized;
        capped = plans.find(p => p.rule.capped);
    }
    for (const w of handOnly) {
        resized += resizeHand(w, tabRule(autoInputs(w, cur)), cur.pin);
        w.saveState();
    }
    // the next tab placed by hand takes the pinned sizes
    const proc = api.conf.get().process, pin = cur.pin;
    if (pin.width) proc.camTabsWidth = pin.width;
    if (pin.height) proc.camTabsHeight = pin.height;
    if (pin.depth) proc.camTabsDepth = pin.depth;
    api.conf.save();
    SPACE.update();
    if (withSet.length || resized) sayLine(`${withSet.length ? `${n} tab${n === 1 ? '' : 's'} placed again` : ''}${withSet.length && resized ? ', ' : ''}${resized ? `${resized} of your own resized` : ''}.`
        + (capped ? ` Height held to ${say(capped.rule.height)}, under the board's thickness.` : ''));
    showFields();
}

function summary(plans) {
    return plans.map(p => ({
        widget: p.widget.id, count: p.records.length, outer: p.plan.outer, holes: p.plan.holes,
        holeTabs: p.kept.filter(t => t.hole).length,
        width: p.rule.width, height: p.rule.height, depth: p.rule.depth, spacing: p.rule.spacing,
        material: p.rule.material, machine: p.rule.machine, bit: p.rule.bit, thickness: p.rule.thickness,
        hand: p.hand, dropped: p.dropped, small: p.plan.small, skipped: p.plan.skipped,
        pinned: Object.keys(p.set.pin), capped: p.rule.capped,
    }));
}

function describe(plans) {
    if (!plans.length) return 'Add a part first.';
    const n = plans.reduce((a, p) => a + p.records.length, 0);
    const p = plans[0], r = p.rule, i = p.inputs;
    const parts = plans.length > 1 ? ` on ${plans.length} parts` : '';
    const holes = plans.reduce((a, p) => a + p.kept.filter(t => t.hole).length, 0);
    let line = `${n} tab${n === 1 ? '' : 's'}${parts}, ${say(r.width)} long and ${say(r.height)} tall`
        + ` (${i.materialName}, ${say(r.thickness)} thick, ${say(r.bit)} bit).`;
    if (holes) line += ` ${holes} of them hold the piece inside a big hole.`;
    if (plans.some(p => p.hand)) line += ' Your own tabs stay.';
    if (plans.some(p => p.plan.small)) line += ' A small part: fewer tabs fit.';
    if (plans.some(p => p.rule.capped)) line += ` Height held to ${say(r.height)}, under the board's thickness.`;
    // what it could not do, said, not left to a success line (codex review 10-29)
    const skipped = plans.reduce((a, p) => a + (p.plan.skipped || 0), 0);
    if (skipped) line += ` ${skipped} tab${skipped === 1 ? '' : 's'} did not fit: add ${skipped === 1 ? 'it' : 'them'} by hand with + where the part needs holding.`;
    if (plans.some(p => !p.rule.pinned.height && p.rule.height < p.rule.heightFloor - 0.01)) line += ` The board is thin, so the tabs are only ${say(r.height)} tall (under the usual ${say(r.heightFloor)}): check they hold.`;
    if (!n) line = 'No straight enough edge for a tab here: place them by hand with +.';
    else line += ' A starting layout: look at every part and every cutout before you cut.';
    return line;
}

function sayLine(text) {
    if (els.say) els.say.textContent = text;
}

function showButtons(on) {
    if (els.apply) els.apply.style.display = on ? '' : 'none';
    if (els.cancel) els.cancel.style.display = preview ? '' : 'none';
}

// the fields: pinned values as typed, automatic ones as grey placeholders from the first part
function showFields(plan) {
    if (!els.fields) return;
    if (!plan) {
        const w = targets()[0];
        try { plan = w ? planOne(w, cur, { next: 0 }) : null; } catch (e) { plan = null; }
    }
    const unit = SL() ? SL().unit() : 'mm';
    const outer = plan ? plan.plan.per.find(l => !l.hole) : null;
    const hole = plan ? plan.plan.per.find(l => l.hole) : null;
    const auto = plan ? {
        width: plan.rule.auto.width, height: plan.rule.auto.height, depth: plan.rule.auto.depth,
        count: outer ? outer.count : '', corner: plan.rule.width / 2 + plan.rule.bit,
        holeMin: holeMinFor(plan.rule.bit), holeCount: hole ? hole.count : '–',
    } : {};
    for (const f of FIELDS) {
        const el = els.fields[f.key];
        if (!el) continue;
        const v = cur.pin[f.key];
        if (f.kind === 'bool') { el.checked = v !== false; continue; }
        const fmt = x => (x === '' || x == null ? '' : f.kind === 'len' ? (SL() ? SL().show(x) : String(+(+x).toFixed(2))) : String(x));
        if (document.activeElement !== el) el.value = v > 0 ? fmt(v) : '';
        el.placeholder = fmt(auto[f.key]);
        el.classList.toggle('pinned', v > 0);
        const u = el.parentNode.querySelector('.unit');
        if (u) u.textContent = f.kind === 'len' ? unit : '';
    }
    if (els.fields.holeMin) els.fields.holeMin.disabled = cur.pin.holes === false;
    if (els.fields.holeCount) els.fields.holeCount.disabled = cur.pin.holes === false;
    // a slider moves only automatic values: it rests when every value it moves is pinned
    const pin = cur.pin;
    for (const [el, off] of [[els.density, pin.count > 0], [els.scale, pin.width > 0 && pin.height > 0]]) {
        if (!el) continue;
        el.value = el === els.density ? cur.density : cur.scale;
        el.disabled = off;
        el.parentNode.classList.toggle('off', off);
    }
}

function remember() {
    try { localStorage.setItem(STORE, JSON.stringify(cur)); } catch (e) {}
}

function recall() {
    try {
        const v = JSON.parse(localStorage.getItem(STORE) || 'null');
        if (v) cur = normal(v);
    } catch (e) {}
}

// a selected part with settings shows its own
function follow() {
    const w = api.selection.widgets(true).find(w => w && setOf(w));
    if (w) cur = normal(setOf(w));
    showFields();
}

function slider(id, label, lo, hi, title) {
    const wrap = document.createElement('label');
    wrap.className = 'swarf-autotabs-slider';
    wrap.title = title;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    const l = document.createElement('span');
    l.className = 'end';
    l.textContent = lo;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = -2; input.max = 2; input.step = 1; input.value = 0;
    input.setAttribute('aria-label', `${label}: ${lo} to ${hi}`);
    const r = document.createElement('span');
    r.className = 'end';
    r.textContent = hi;
    wrap.append(name, l, input, r);
    return { wrap, input };
}

// one attribute's row: name, field (or box), unit
function field(f) {
    const wrap = document.createElement('label');
    wrap.className = 'swarf-autotabs-field';
    wrap.title = f.kind === 'bool' ? f.title : `${f.title}. Leave it empty for automatic.`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.label;
    const input = document.createElement('input');
    input.id = `swarf-autotabs-${f.key}`;
    input.setAttribute('aria-label', f.label);
    if (f.kind === 'bool') {
        input.type = 'checkbox';
        input.checked = true;
        input.addEventListener('change', () => {
            if (input.checked) delete cur.pin.holes; else cur.pin.holes = false;
            edited();
        });
        wrap.append(input, name);
        return { wrap, input };
    }
    input.type = 'text';
    input.inputMode = 'decimal';
    input.spellcheck = false;
    input.autocomplete = 'off';
    const unit = document.createElement('span');
    unit.className = 'unit';
    const commit = () => {
        const t = input.value.trim();
        let v = NaN;
        if (t) v = f.kind === 'len' ? (SL() ? SL().parse(t) : parseFloat(t)) : Math.round(parseFloat(t));
        if (!t) delete cur.pin[f.key];
        else if (Number.isFinite(v) && v > 0) cur.pin[f.key] = f.kind === 'len' ? Math.round(v * 1000) / 1000 : v;
        else {
            sayLine(`${f.label}: type a number above zero${f.kind === 'len' ? ', like 1/2 or 12 mm' : ''}, or leave it empty for automatic.`);
            input.blur();
            showFields();
            return;
        }
        input.blur();
        edited();
    };
    input.addEventListener('keydown', e => {
        e.stopPropagation();   // typing here never reaches cam's shortcuts
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); input.blur(); showFields(); }
    });
    input.addEventListener('keypress', e => e.stopPropagation());
    input.addEventListener('change', commit);
    wrap.append(name, input, unit);
    return { wrap, input };
}

function button(id, text, title, fn) {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'swarf-autotabs-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
}

/** The auto tabs block for the tabs panel (init-menu.js puts it in a row). */
export function autoTabRow() {
    const what = document.createElement('div');
    what.className = 'swarf-autotabs-what';
    what.textContent = 'Tabs are small bridges the outline leaves uncut, so the part stays held to the board until the cut ends. Cut them off after.';
    const go = button('swarf-autotabs-go', 'auto tabs', 'show a starting set of tabs on the selected part, sized for its material, bit, thickness and machine', () => autoPreview());
    const density = slider('swarf-autotabs-density', 'how many', 'fewer', 'more', 'fewer or more tabs around each part');
    const scale = slider('swarf-autotabs-scale', 'size', 'smaller', 'larger', 'smaller or larger tabs: longer and taller');
    for (const [s, key] of [[density, 'density'], [scale, 'scale']]) {
        s.input.addEventListener('input', () => { cur[key] = +s.input.value || 0; edited(); });
    }
    const apply = button('swarf-autotabs-apply', 'apply', 'place these tabs; tabs you placed by hand stay', autoApply);
    const cancel = button('swarf-autotabs-cancel', 'cancel', 'take the preview away', () => { autoCancel(); sayLine(''); });
    const say = document.createElement('div');
    say.className = 'swarf-autotabs-say';
    say.id = 'swarf-autotabs-say';
    say.setAttribute('aria-live', 'polite');
    const btns = document.createElement('div');
    btns.className = 'swarf-autotabs-btns';
    btns.append(go, apply, cancel);
    const grid = document.createElement('div');
    grid.className = 'swarf-autotabs-fields';
    const fields = {};
    for (const f of FIELDS) {
        const r = field(f);
        fields[f.key] = r.input;
        grid.append(r.wrap);
    }
    const auto = button('swarf-autotabs-auto', 'all automatic', 'empty every field: each number goes back to the automatic one', () => {
        cur.pin = {};
        cur.density = cur.scale = 0;
        edited();
    });
    auto.classList.add('swarf-autotabs-reset');
    els = { density: density.input, scale: scale.input, say, apply, cancel, fields };
    apply.style.display = cancel.style.display = 'none';
    recall();
    const box = document.createElement('div');
    box.className = 'swarf-autotabs';
    box.append(what, btns, density.wrap, scale.wrap, grid, auto, say);
    // the preview never outlives a slice, a mode change or esc
    setTimeout(() => {
        try {
            api.event.on(['slice.begin', 'key.esc', 'mode.set', 'widget.delete', 'selection.scale'], () => { if (preview) { autoCancel(); sayLine(''); } });
            api.event.on('cam.tabs.auto', () => autoPreview());
            // a scale takes every tab away (cl-tab's tabClear); the parts with settings get theirs back
            api.event.on('selection.scale', () => setTimeout(() => {
                const n = autoRefresh(true);
                if (n) sayLine(`Tabs placed again on ${n} part${n === 1 ? '' : 's'} at the new size.`);
                showFields();
            }, 0));
            api.event.on(['widget.select', 'widget.deselect'], () => setTimeout(follow, 0));
            api.event.on('settings.load', () => setTimeout(showFields, 0));
            if (api.ui.units) api.ui.units.addEventListener('change', () => setTimeout(showFields, 0));
        } catch (e) {}
        showFields();
    }, 0);
    window.__swarfAutoTabs = {
        plan: autoPlan, preview: autoPreview, apply: autoApply, cancel: autoCancel, inputs: autoInputs, rule: tabRule,
        refresh: autoRefresh, forget: autoForget, audit: autoAudit, fields: FIELDS,
        get settings() { return clone(cur); },
        set(o) { cur = normal(Object.assign(clone(cur), o)); edited(); return clone(cur); },
    };
    return [box];
}
