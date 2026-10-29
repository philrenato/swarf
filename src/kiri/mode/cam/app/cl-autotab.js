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
 */

import { api } from '../../../app/api.js';
import { env } from './init-ui.js';
import { addbox, delbox } from '../../../app/boxes.js';
import { addWidgetTab } from './cl-tab.js';
import { tabRule, planTabs, sliceLoops, tabRecord } from './autotab-rule.js';
import { space as SPACE } from '../../../../moto/space.js';

const PREVIEW_COLOR = 0xff8800;
const STORE = 'swarf.autotabs';
let preview = null;   // { names: [], plans: [] }
let els = {};

const say = mm => (window.SwarfLength ? window.SwarfLength.say(mm) : `${(+mm).toFixed(2)} mm`);

function sliders() {
    const v = el => (el ? +el.value || 0 : 0);
    return { density: v(els.density), scale: v(els.scale) };
}

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

/**
 * Plan auto tabs for parts (default: the selected ones, or every part when none is selected).
 * @returns {Array<{ widget, rule, inputs, plan, records }>}
 */
export function autoPlan(widgets, opt = {}) {
    widgets = widgets || api.selection.widgets(true);
    const out = [];
    let id = Date.now();
    for (const widget of widgets) {
        if (!widget || widget.track.synth) continue;
        const inputs = autoInputs(widget, opt);
        const rule = tabRule(inputs);
        const pos = widget.getGeoVertices({ unroll: true });
        let zmin = Infinity;
        for (let i = 2; i < pos.length; i += 3) zmin = Math.min(zmin, pos[i]);
        const loops = sliceLoops(pos, zmin + Math.min(rule.height / 2, rule.thickness / 2));
        const plan = planTabs(loops, rule);
        // keep clear of tabs placed by hand
        const hand = (api.widgets.annotate(widget.id).tab || []).filter(r => !r.auto);
        const near = t => hand.some(h => Math.hypot(h.pos.x - t.x, h.pos.y - t.y) < (h.dim.y + rule.width) / 2 + rule.bit + (h.dim.x || 0) / 2);
        const kept = plan.tabs.filter(t => !near(t));
        const z = tabZ(widget, rule.height);
        const records = kept.map(t => tabRecord(t, rule, z, id++));
        out.push({ widget, rule, inputs, plan, kept, records, hand: hand.length, dropped: plan.tabs.length - kept.length });
    }
    return out;
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
    const plans = autoPlan(null, opt || sliders());
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
    try { window.dispatchEvent(new CustomEvent('swarf.autotabs.preview', { detail: summary(plans) })); } catch (e) {}
    return summary(plans);
}

/** Make the previewed tabs real: replace this part's earlier auto tabs, keep hand-placed ones. */
export function autoApply() {
    const plans = preview ? preview.plans : autoPlan(null, sliders());
    autoCancel();
    let placed = 0, replaced = 0;
    for (const p of plans) {
        const { widget } = p;
        const anno = api.widgets.annotate(widget.id);
        const list = (anno.tab = anno.tab || []);
        // out with the earlier auto tabs, boxes and records
        for (const rec of list.filter(r => r.auto)) {
            const live = widget.tabs && widget.tabs[rec.id];
            if (live && live.box) {
                widget.adds.remove(live.box);
                widget.mesh.remove(live.box);
            }
            if (widget.tabs) delete widget.tabs[rec.id];
            replaced++;
        }
        anno.tab = list.filter(r => !r.auto);
        for (const rec of p.records) {
            anno.tab.push(Object.clone(rec));
            const live = Object.clone(rec);
            live.rot = new THREE.Quaternion(...rec.rot);
            addWidgetTab(widget, live);
            placed++;
        }
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
    sayLine(placed ? `${placed} tab${placed === 1 ? '' : 's'} placed${replaced ? `, replacing ${replaced} auto tab${replaced === 1 ? '' : 's'}` : ''}. Click one with + to remove it, or click the edge to add one.` : 'No tabs placed.');
    return { placed, replaced };
}

function summary(plans) {
    return plans.map(p => ({
        widget: p.widget.id, count: p.records.length, outer: p.plan.outer, holes: p.plan.holes,
        holeTabs: p.kept.filter(t => t.hole).length,
        width: p.rule.width, height: p.rule.height, depth: p.rule.depth, spacing: p.rule.spacing,
        material: p.rule.material, machine: p.rule.machine, bit: p.rule.bit, thickness: p.rule.thickness,
        hand: p.hand, dropped: p.dropped, small: p.plan.small, skipped: p.plan.skipped,
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
    if (!n) line = 'No straight enough edge for a tab here: place them by hand with +.';
    return line;
}

function sayLine(text) {
    if (els.say) els.say.textContent = text;
}

function showButtons(on) {
    if (els.apply) els.apply.style.display = on ? '' : 'none';
    if (els.cancel) els.cancel.style.display = preview ? '' : 'none';
}

function remember() {
    try { localStorage.setItem(STORE, JSON.stringify(sliders())); } catch (e) {}
}

function recall() {
    try {
        const v = JSON.parse(localStorage.getItem(STORE) || 'null');
        if (v && els.density) els.density.value = v.density || 0;
        if (v && els.scale) els.scale.value = v.scale || 0;
    } catch (e) {}
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
    input.addEventListener('input', () => { remember(); if (preview) autoPreview(); });
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
    const apply = button('swarf-autotabs-apply', 'apply', 'place these tabs; tabs you placed by hand stay', autoApply);
    const cancel = button('swarf-autotabs-cancel', 'cancel', 'take the preview away', () => { autoCancel(); sayLine(''); });
    const say = document.createElement('div');
    say.className = 'swarf-autotabs-say';
    say.id = 'swarf-autotabs-say';
    say.setAttribute('aria-live', 'polite');
    const btns = document.createElement('div');
    btns.className = 'swarf-autotabs-btns';
    btns.append(go, apply, cancel);
    els = { density: density.input, scale: scale.input, say, apply, cancel };
    apply.style.display = cancel.style.display = 'none';
    recall();
    const box = document.createElement('div');
    box.className = 'swarf-autotabs';
    box.append(what, btns, density.wrap, scale.wrap, say);
    // the preview never outlives a slice, a mode change or esc
    setTimeout(() => {
        try {
            api.event.on(['slice.begin', 'key.esc', 'mode.set', 'widget.delete', 'selection.scale'], () => { if (preview) { autoCancel(); sayLine(''); } });
            api.event.on('cam.tabs.auto', () => autoPreview());
        } catch (e) {}
    }, 0);
    window.__swarfAutoTabs = { plan: autoPlan, preview: autoPreview, apply: autoApply, cancel: autoCancel, inputs: autoInputs, rule: tabRule };
    return [box];
}
