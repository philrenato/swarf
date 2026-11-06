/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $ } from '../../../../moto/webui.js';
import { api } from '../../../app/api.js';
import { animate as anim_2d, animate_clear as anim_2d_clear } from './anim-2d.js';
import { animate2 as anim_3d, animate_clear2 as anim_3d_clear } from './anim-3d.js';
import { createPopOps } from './cl-ops.js';
import { helicalOn, helicalDone } from './cl-helical.js';
import { holeSelOn, selectHolesDone, clearHolesRec } from './cl-hole.js';
import { load } from '../../../../load/file.js';
import { Layers } from '../../../app/layers.js';
import { originSelectDone } from './cl-origin.js';
import { recreateTabs } from './cl-tab.js';
import { showZTop, showZBottom, updateStock } from './cl-stock.js';
import { space as SPACE } from '../../../../moto/space.js';
import { space } from '../../../../moto/space.js';
import { Stack } from '../../../app/stack.js';
import { surfaceOn, surfaceDone } from './cl-surface.js';
import { tabAdd, tabDone, tabClear, restoreTabs, rotateTabs, updateTabs, clearTabs, mirrorTabs } from './cl-tab.js';
import { autoRefresh, autoForget, autoHold, autoHeld, tabSnap, tabUndo } from './cl-autotab.js';
import { tabEditInit } from './cl-tabedit.js';
import { traceOn, traceDone, unselectTraces } from './cl-trace.js';
import { toolOrder } from './tools.js';
import { Widget, newWidget } from '../../../app/widget.js';
import { zPlaneStart, zPlaneDone, zPlaneSelecting } from './cl-zplane.js';

// a step's label can carry a file name (TEX's marks): text, never markup (deep review 10-31 M1)
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const { BufferGeometryUtils } = THREE;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const { VIEWS, STACKS } = api.const;
const { noop } = api;
const { ui: UI, uc: UC } = api;
const { widgets: WIDGETS } = api;

class Client {
    animVer = 0;
    camStock;
    showStock = true;
    current;
    currentIndex;
    flipping;
    func = {};
    hoveredOp;
    hover = noop;
    hoverUp = noop;
    isAnimate;
    isArrange;
    isPreview;
    isCamMode;
    isIndexed;
    isParsed;
    lastMode;
    popOp = {};
    poppedRec;
    zaxis = { x: 0, y: 0, z: 1 };
}

export const env = new Client();

// a TEX step's row: "texture · ocean waves", the parts it is on in its tooltip (review r093-ux T3:
// "texture: ocean waves on circle 2" ran out of the panel)
const texShort = t => String(t).replace(/^([\w-]+): (.+?) on .*$/, '$1 · $2');

export function isDark() {
    return api.space.is_dark()
}

export function clearPops() {
    if (env.func.unpop) env.func.unpop();
    helicalDone();
    originSelectDone();
    selectHolesDone();
    surfaceDone();
    tabDone();
    traceDone();
    zPlaneDone();
    // unbind
    hoverDone();
}

export function hoverStart(onhover, onhoverup) {
    clearPops();
    env.hover = onhover;
    env.hoverUp = onhoverup;
    api.feature.hover = true;
}

export function hoverDone() {
    env.hover = noop;
    env.hoverUp = noop;
    api.feature.hover = false;
}

function animFn() {
    return [{
        animate: anim_2d,
        animate_clear: anim_2d_clear
    }, {
        animate: anim_3d,
        animate_clear: anim_3d_clear
    }][env.animVer];
}

function updateIndex() {
    let oplist = env.current.process.ops;
    if (!(env.isCamMode && oplist) || env.lastMode === VIEWS.ANIMATE) {
        return;
    }
    let index = 0;
    for (let op of oplist) {
        if (op.type === '|') {
            break;
        }
        if (op.type === 'index' && !op.disabled) {
            if (op.absolute) {
                index = op.degrees
            } else {
                let numloop = op._numloop ?? 1;
                index += (op.degrees * numloop);
            }
        }
    }
    WIDGETS.setAxisIndex(env.isPreview || !env.isIndexed ? 0 : -index);
    env.currentIndex = env.isIndexed && !env.isPreview ? index * DEG2RAD : 0;
}

function updateAxisMode(refresh) {
    const { camStockIndexGrid, camStockIndexed } = env.current.process;
    let newIndexed = camStockIndexed;
    let changed = refresh || env.isIndexed !== newIndexed;
    env.isIndexed = newIndexed;
    if (!env.isIndexed || !env.isCamMode) {
        WIDGETS.setAxisIndex(0);
    }
    if (!env.isCamMode) {
        return;
    }
    if (env.isIndexed) {
        env.current.process.camZAnchor = "middle";
    }
    env.animVer = env.isIndexed ? 1 : 0;
    SPACE.platform.setVisible(!env.isIndexed);
    SPACE.platform.showGrid2(!env.isIndexed || camStockIndexGrid);
    const showIndexed = env.isIndexed ? '' : 'none';
    const showNonIndexed = env.isIndexed ? 'none' : '';
    $('cam-index').style.display = showIndexed;
    $('cam-lathe').style.display = showIndexed;
    $('cam-loop').style.display = showIndexed;
    $('cam-flip').style.display = showNonIndexed;
    $('cam-reg').style.display = showNonIndexed;
    if (!changed) {
        return;
    }
    WIDGETS.setIndexed(env.isIndexed ? true : false);
    api.platform.update_bounds();
    // add or remove clock op depending on indexing
    const cp = env.current.process;
    if (!cp.ops) {
        return;
    }
    const clockOp = cp.ops.filter(op => op.type === '|')[0];
    if (!clockOp) {
        opAdd(env.popOp['|'].new());
    } else {
        opRender();
    }
    updateStock();
}

const opAddLaserOn = () => {
    opAdd(env.popOp['laser on'].new());
};

const opAddLaserOff = () => {
    opAdd(env.popOp['laser off'].new());
};

const opAddGCode = () => {
    opAdd(env.popOp.gcode.new());
};

const opAddIndex = () => {
    opAdd(env.popOp.index.new());
};

const opAddLevel = () => {
    opAdd(env.popOp.level.new());
};

const opAddLoop = () => {
    opAdd(env.popOp.loop.new());
};

const opAddRough = () => {
    opAdd(env.popOp.rough.new());
};

const opAddOutline = () => {
    opAdd(env.popOp.outline.new());
};

const opAddPocket = () => {
    traceDone();
    surfaceDone();
    let rec = env.popOp.pocket.new();
    rec.surfaces = { /* widget.id: [ faces... ] */ };
    opAdd(rec);
};

const opAddHelical = () => {
    traceDone();
    surfaceDone();
    let rec = env.popOp.helical.new();
    rec.cylinders = { /* widget.id: [ faces... ] */ };
    opAdd(rec);
};

const opAddArea = () => {
    traceDone();
    surfaceDone();
    let rec = env.popOp.area.new();
    rec.areas = { /* widget.id: [ polygons... ] */ };
    rec.surfaces = { /* widget.id: [ faces... ] */ };
    opAdd(rec);
};

const opAddContour = (axis) => {
    let rec = env.popOp.contour.new();
    rec.axis = axis.toUpperCase();
    opAdd(rec);
};

const opAddLathe = (axis) => {
    let rec = env.popOp.lathe.new();
    rec.axis = axis.toUpperCase();
    opAdd(rec);
};

const opAddTrace = () => {
    let rec = env.popOp.trace.new();
    rec.areas = { /* widget.id: [ polygons... ] */ };
    opAdd(rec);
};

const opAddDrill = () => {
    let rec = env.popOp.drill.new();
    rec.drills = {};
    opAdd(rec);
};

const opAddRegister = (axis, points) => {
    let rec = env.popOp.register.new();
    rec.axis = axis.toUpperCase();
    rec.points = points;
    opAdd(rec);
};

const opAddFlip = () => {
    opAdd(env.popOp.flip.new());
};

const traceClear = () => {
    traceDone();
    api.widgets.all().forEach(widget => {
        unselectTraces(widget);
    });
    api.conf.save();
};

export const opAdd = (rec) => {
    if (!env.isCamMode) return;
    clearPops();
    let oplist = env.current.process.ops;
    if (oplist.indexOf(rec) < 0) {
        if (oplist.length && oplist[oplist.length - 1].type === '|') {
            oplist.splice(oplist.length - 1, 0, rec);
        } else {
            oplist.push(rec);
        }
        let fpos = oplist.findWith(rec => rec.type === 'flip');
        if (fpos >= 0 && oplist.length > 1) {
            let oprec = oplist.splice(fpos, 1);
            oplist.push(oprec[0]);
        }
        api.conf.save();
        opRender();
    }
};

const opDel = (rec) => {
    if (!env.isCamMode) return;
    clearPops();
    let oplist = env.current.process.ops;
    let pos = oplist.indexOf(rec);
    if (pos >= 0) {
        oplist.splice(pos, 1);
        api.conf.save();
        opRender();
        // swarf: a step taken away by hand (TEX takes a texture step's mark with it)
        api.event.emit('cam.op.deleted', rec);
    }
};

// swarf (review r086 F4): the step card's numbers in the student's unit. Ops keep mm, mm/min and
// stepover as a fraction of the bit; only the card's words and fields change.
function opInch() {
    const L = window.SwarfLength;
    return L ? L.unit() === 'in' : api.view.unit_scale() === 25.4;
}
function opShow(f, v) {
    v = +v;
    if (!Number.isFinite(v)) return '';
    const L = window.SwarfLength, inch = opInch();
    if (f === 'rate' || f === 'plunge') return String(inch ? +(v / 25.4).toFixed(1) : Math.round(v));
    if (f === 'step') return String(+(v * 100).toFixed(1));
    if (f === 'down' || f === 'texstep' || f === 'leave') return L ? (L.field || L.show)(v) : String(+(v / (inch ? 25.4 : 1)).toFixed(inch ? 4 : 3));
    return String(v);
}
function opParse(f, text) {
    const L = window.SwarfLength, inch = opInch();
    const n = parseFloat(String(text).replace(',', '.'));
    // a feed is a number per minute, not a length: read its fractions (1 1/2) as a plain number
    // (Phil 11-01) a feed may name its unit: 1500 mm/min or 60 in/min (ipm) whatever the setting
    if (f === 'rate' || f === 'plunge') {
        const m = String(text).trim().match(/^(.*?)\s*(mm\/min|mm|in\/min|ipm|in|")?$/i);
        const u = m && m[2] ? (/^mm/i.test(m[2]) ? 1 : 25.4) : (inch ? 25.4 : 1), num = m ? m[1] : '';
        const k = L ? L.parse(num, 'in') / 25.4 : parseFloat(num), v = k * u;
        return /[a-z"]/i.test(num) ? NaN : v > 0 ? v : NaN;
    }
    // a share of the bit: 40 or 40 %; past 100 % the passes leave ridges between them (refused)
    if (f === 'step') { const p = parseFloat(String(text).replace(',', '.').replace('%', '')); return p > 0 && p <= 100 ? p / 100 : p > 100 ? Infinity : NaN; }
    if (f === 'down' || f === 'texstep' || f === 'leave') {
        const mm = L ? L.parse(text) : n * (inch ? 25.4 : 1);
        return mm >= 0 ? mm : NaN;
    }
    return n;
}
let opUnitsHooked = false;

export function opRender() {
    if (!opUnitsHooked && api.event) {
        opUnitsHooked = true;
        api.event.on('units.set', () => setTimeout(opRender, 0));
        for (const ev of ['widget.add', 'widget.delete', 'selection.scale', 'settings.saved']) api.event.on(ev, () => setTimeout(paintStepLines, 0));
        // (whole-app review r086 C4) strategy's machinist rows (tool init, first z max, force z
        // max, engage factor) are advanced's; a student's strategy is ease down, depth first,
        // inner first and the ease angle
        for (const k of ['camToolInit', 'camFirstZMax', 'camForceZMax', 'camFullEngage']) {
            const row = api.ui[k] && api.ui[k].closest && api.ui[k].closest('.var-row');
            if (row) row.classList.add('swarf-adv-row');
        }
    }
    let oplist = env.current?.process?.ops;
    if (!(env.isCamMode && oplist)) {
        return;
    }
    oplist = oplist.filter(rec => !Array.isArray(rec));
    // swarf: a re-render (material re-derive, op edit) keeps open drawers open
    const wasOpen = new Set([...document.querySelectorAll('.swarf-params-open')].map(el => el.rec));
    let mark = Date.now();
    let html = [];
    let bind = {};
    let notime = false;
    let inloop = 0;
    let numloop;
    oplist.forEach((rec, i) => {
        let title = '';
        let clock = rec.type === '|';
        let isLoop = rec.type === 'loop';
        let label = clock ? `` : (rec.mode ? rec.type + ' ' + rec.mode : rec.type);
        let clazz = notime ? ["draggable", "notime"] : ["draggable"];

        // Loop operation label and styling
        if (isLoop) {
            label = `loop ${rec.repeat || 2}x`;
            clazz.push('loop');
            title = ` title="loop: repeat next ${rec.count || 1} operation(s) ${rec.repeat || 2} time(s)"`;
            inloop = rec.count;
            numloop = rec.repeat;
        } else if (inloop && !clock) {
            clazz.push('in-loop');
            rec._numloop = numloop;
            inloop--;
        }

        let notable = rec.note ? rec.note.split(' ').filter(v => v.charAt(0) === '#') : undefined;
        if (clock) { clazz.push('clock'); title = ` title="end of ops chain\ndrag/drop like an op\nops after this are disabled"` }
        if (notable?.length) {
            rec.rename = notable[0].slice(1);
            label += ` (${rec.rename})`;
        } else {
            delete rec.rename;
        }
        // swarf: DRAW's engrave step is a trace that follows the parts' engraved lines
        if (rec.engrave) {
            label = 'engrave';
            title = ` title="cuts the lines drawn in DRAW into their parts, the bit's center on each line, to each line's engrave depth"`;
        }
        // swarf: a mark made in TEX, textured into its part's top (web/kiri/swarf-tex.js)
        if (rec.type === 'pierce') {
            const full = esc(rec.texlabel || 'pierce');
            label = texShort(rec.texlabel || 'pierce');
            const est = rec.texest > 0 && window.SwarfTexCore ? `, about ${window.SwarfTexCore.formatTime(rec.texest)}` : '';
            title = ` title="${full}: the mark made in TEX, cut through the part (or to its skin) by its straight bit${est}. A starting point: cut a test strip. Open tex to change it."`;
            clazz.push('tex-step');
        } else if (rec.type === 'inlay') {
            const full = esc(rec.texlabel || 'inlay');
            label = texShort(rec.texlabel || 'inlay');
            const est = rec.texest > 0 && window.SwarfTexCore ? `, about ${window.SwarfTexCore.formatTime(rec.texest)}` : '';
            title = ` title="${full}: the mark made in TEX, sunk as a flat pocket by its straight bit${est}; its plug is a part of its own on the bed. Open tex to change it."`;
            clazz.push('tex-step');
        } else if (rec.type === 'vcarve') {
            const full = esc(rec.texlabel || 'v-carve');
            label = texShort(rec.texlabel || 'v-carve');
            const est = rec.texest > 0 && window.SwarfTexCore ? `, about ${window.SwarfTexCore.formatTime(rec.texest)}` : '';
            title = ` title="${full}: cut in by a V-bit along the middle of the shape, as deep as the shape is wide${est}. Change the words in draw, the bit and flat depth in draw or tex."`;
            clazz.push('tex-step');
        } else if (rec.type === 'texture') {
            const full = esc(rec.texlabel || 'texture');
            label = texShort(rec.texlabel || 'texture');
            const est = rec.texest > 0 && window.SwarfTexCore ? `, about ${window.SwarfTexCore.formatTime(rec.texest)}` : '';
            title = ` title="${full}: the mark made in TEX, cut into the part's top by its bit and path${est}. Open tex to change it."`;
            clazz.push('tex-step');
        }
        const SWARF_OP_FIELDS = {
            rough:   ['tool','rate','down','step','inside'],
            outline: ['tool','rate','down','step','inside','outside','leave','lastpass'],
            pocket:  ['tool','rate','down','step'],
            contour: ['tool','rate','step','inside'],
            lathe:   ['tool','rate','down','step'],
            trace:   ['tool','rate','down'],
            drill:   ['tool','rate','down'],
            area:    ['tool','rate','down','step'],
            // the mark's bit, path, finish and stepover (set in TEX, tuned here too: one value), and the
            // step's own feed, plunge and step-down (Phil 11-01: "just like other toolpaths")
            texture: ['tool','path','finish','texstep','down','rate','plunge'],
            pierce:  ['tool','down','rate','plunge'],
            inlay:   ['tool','texstep','down','rate','plunge'],
            vcarve:  ['tool','down','rate','plunge'],
        };
        // boolean fields render as checkboxes
        const BOOL_FIELDS = { inside: true, outside: true, all: true, flats: true, curves: true, lastpass: true };
        const swarfFields = (!clock && SWARF_OP_FIELDS[rec.type]) || null;
        let drawerHtml = '';
        if (swarfFields) {
            const tex = rec.texmark && window.__swarfTex && window.__swarfTex.stepCard ? window.__swarfTex.stepCard(rec.texmark) : null;
            const labels = { tool: 'tool', rate: 'feed', down: 'stepdown', step: 'stepover', plunge: 'plunge', path: 'path', finish: 'finish', texstep: 'stepover',
                             inside: 'inside only', outside: 'outside only', all: 'clear all',
                             flats: 'flats', curves: 'curves', leave: 'leave', lastpass: 'last pass' };
            // a drill's feed is how fast it goes down, and its step-down a peck
            if (rec.type === 'drill') { labels.rate = 'plunge'; labels.down = 'peck'; }
            // (review r086 F4) every number says its unit and follows mm | in: feed in mm/min or
            // in/min, step-down a length (fractions typed), stepover a share of the bit's width
            const inch = opInch();
            const tips = {
                tool: 'which bit cuts this step',
                rate: `feed: how fast the bit moves through the wood, in ${inch ? 'inches' : 'mm'} per minute`,
                down: `step-down: how deep each pass cuts, in ${inch ? 'inches (3/4, 1/8 and 3 mm work too)' : 'mm (1/8 in works too)'}`,
                step: 'stepover: how far apart the passes are, as a share of the bit\'s width (40 means 40 %)',
                plunge: `plunge: how fast the bit goes down into the wood, in ${inch ? 'inches' : 'mm'} per minute`,
                path: 'how the bit goes over the texture: best picks one plunge per dot or a V along each groove where it can, else raster',
                finish: 'how close the raster\'s passes run: smoother takes longer; ridged and bold leave them showing. Typing a stepover makes it custom',
                texstep: rec.type === 'inlay' ? `stepover: how far apart the pocket's rings are, in ${inch ? 'inches' : 'mm'}; 40% of the bit unless you type your own` : `stepover: how far apart the raster's passes are, in ${inch ? 'inches' : 'mm'}; a finish sets it, or type your own`,
                inside: 'cut only inside the part outline',
                outside: 'cut only outside the part outline',
                leave: `leave: wood the first passes leave on the part, in ${inch ? 'inches' : 'mm'}. 0 leaves none. Without a last pass the part stays that much oversize`,
                lastpass: 'last pass: one more time round at the whole depth, at the true size, for a clean edge. Tabs stay. Give it a leave of about 1/2 mm',
            };
            if (rec.type === 'drill') {
                tips.rate = `plunge: how fast the bit goes down into the wood, in ${inch ? 'inches' : 'mm'} per minute`;
                tips.down = `peck: how deep the bit goes before it lifts to clear the chips, in ${inch ? 'inches' : 'mm'}. 0 goes down in one`;
            }
            const units = { rate: inch ? 'in/min' : 'mm/min', plunge: inch ? 'in/min' : 'mm/min', down: inch ? 'in' : 'mm', step: '% of bit', texstep: inch ? 'in' : 'mm', leave: inch ? 'in' : 'mm' };
            const rows = swarfFields.map(f => {
                const tip = tips[f] ? ` title="${tips[f]}"` : '';
                if (f === 'tool') {
                    return `<label class="swarf-op-row"${tip}><span>${labels[f]}</span><select data-swarf-field="tool" data-op="${mark + i}"></select></label>`;
                }
                // a TEX step's path and finish: the mark's, as TEX lists them
                if ((f === 'path' || f === 'finish') && tex) {
                    const opts = f === 'path' ? tex.paths : tex.finishes, cur = f === 'path' ? tex.path : tex.finish;
                    return `<label class="swarf-op-row"${tip}><span>${labels[f]}</span><select data-swarf-field="${f}" data-op="${mark + i}">${opts.map(([k, w]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select></label>`;
                }
                if ((f === 'path' || f === 'finish' || f === 'texstep') && !tex) return '';
                if (BOOL_FIELDS[f]) {
                    return `<label class="swarf-op-row swarf-op-bool"${tip}><input type="checkbox" data-swarf-field="${f}" data-op="${mark + i}"${rec[f] ? ' checked' : ''}/><span>${labels[f]}</span></label>`;
                }
                return `<label class="swarf-op-row swarf-op-num"${tip}><span>${labels[f]}</span><input type="text" inputmode="decimal" data-swarf-field="${f}" data-op="${mark + i}"/><em class="swarf-op-unit">${units[f] || ''}</em></label>`;
            }).join('');
            drawerHtml = `<div id="${mark + i}-p" class="swarf-op-params" data-op="${mark + i}">${rows}</div>`;
        }
        html.appendAll([
            `<div id="${mark + i}" class="${clazz.join(' ')}${swarfFields ? ' has-params' : ''}"${title}>`,
            `<label class="label">${esc(label)}</label>`,
            // swarf: this step's share of the time on the ShopBot (web/kiri/swarf-estimate.js)
            clock ? '' : `<em class="swarf-op-time" data-step="${env.current.process.ops.indexOf(rec)}"></em>`,
            clock ? '' :
                `<label id="${mark + i}-x" class="del"><i class="fa-solid fa-xmark"></i></label>`,
            swarfFields ? `<label id="${mark + i}-c" class="swarf-op-chevron" title="edit parameters"><i class="fa-solid fa-chevron-down"></i></label>` : '',
            // swarf: what the step does, in a line: its bit, how deep, how fast (review 105 F6, F18, M3)
            clock ? '' : `<div class="swarf-op-sum" data-step="${env.current.process.ops.indexOf(rec)}"></div>`,
            drawerHtml,
            `</div>`
        ]);
        bind[mark + i] = rec;
        notime = notime || clock;
    });
    let listel = $('oplist');
    listel.innerHTML = html.join('');
    if (window.SwarfEstimateUI) window.SwarfEstimateUI.paint();
    paintStepLines();
    let bounds = [];
    let unpop = null;
    let index = 0;
    let indexing = true;
    // drag and drop re-ordering
    for (let [id, rec] of Object.entries(bind)) {
        let type = rec.type;
        let clock = type === '|';
        if (!clock) {
            $(`${id}-x`).onmousedown = (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                surfaceDone();
                traceDone();
                tabDone();
                opDel(rec);
            };
            const drawerEl = $(`${id}-p`);
            const chevEl = $(`${id}-c`);
            if (drawerEl && chevEl) {
                const tools = (api.conf.get().tools || []).slice().sort(toolOrder);
                const T = window.__swarfTex, card = rec.texmark && T && T.stepCard ? T.stepCard(rec.texmark) : null;
                drawerEl.querySelectorAll('[data-swarf-field]').forEach(inp => {
                    const f = inp.dataset.swarfField;
                    // a TEX step's mark fields: the mark's values, written back to the mark (every copy),
                    // then the card again so a finish and its stepover say each other
                    if (card && (f === 'tool' || f === 'path' || f === 'finish' || f === 'texstep')) {
                        if (f === 'tool') for (const [v, w] of card.bits) { const o = document.createElement('option'); o.value = v; o.textContent = w; if (v === card.tool) o.selected = true; inp.appendChild(o); }
                        if (f === 'texstep') { inp.value = opShow('texstep', card.stepover); inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); }); }
                        inp.addEventListener('change', () => {
                            if (f === 'texstep') {
                                const typed = inp.value.trim(), v = opParse('texstep', typed), most = card.bitWidth || 25.4;
                                const say = mm => window.SwarfLength ? window.SwarfLength.say(mm) : `${+mm.toFixed(2)} mm`;
                                if (!(v > 0)) { if (typed) api.show.alert(`swarf could not read "${typed}" as a stepover: it stays as it was.`, 6); inp.value = opShow('texstep', card.stepover); return; }
                                if (v > most) { api.show.alert(card.inlay ? `A pocket's stepover goes up to half the bit's width (${say(most)}): past that a post is left standing in the middle. It stays as it was.` : `A stepover goes up to the bit's width (${say(most)}): past that the passes leave uncut ridges. It stays as it was.`, 6); inp.value = opShow('texstep', card.stepover); return; }
                                T.setStepCard(rec.texmark, 'stepover', v);
                            } else T.setStepCard(rec.texmark, f, inp.value);
                            api.event.emit('cam.op.render');
                        });
                        for (const ev of ['mousedown', 'click']) inp.addEventListener(ev, e => e.stopPropagation());
                        return;
                    }
                    if (f === 'tool') {
                        for (const t of tools) {
                            const o = document.createElement('option');
                            o.value = t.id;
                            o.textContent = t.name || `#${t.number}`;
                            if (t.id === rec.tool) o.selected = true;
                            inp.appendChild(o);
                        }
                    } else if (inp.type !== 'checkbox') {
                        // a step saved before leave existed leaves none
                        if (f === 'leave' && rec.leave == null) inp.value = opShow(f, 0);
                        if (rec[f] !== undefined && rec[f] !== null) inp.value = opShow(f, rec[f]);
                        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); });
                    }
                    inp.addEventListener('change', () => {
                        if (f === 'tool') {
                            // a select yields a string; tool ids are numbers and
                            // every strict lookup (sync.js, anim-2d.js, the
                            // material system) misses a string id
                            rec.tool = Number(inp.value);
                        } else if (inp.type === 'checkbox') {
                            rec[f] = inp.checked;
                        } else {
                            // (deep review 10-31 S1/S2) a value swarf cannot use is refused out loud and
                            // the old one stays: unreadable, a step-down of 0 (drill's 0 is "no peck"),
                            // or a feed past the machine's own top speed
                            const typed = inp.value.trim(), v = opParse(f, typed);
                            const set = api.conf.get(), dev = set.device || {};
                            const top = dev.feedMax > 0 ? dev.feedMax : (set.process && set.process.camFastFeed) || 0;
                            const rateWords = mm => `${Math.round(mm / (opInch() ? 25.4 : 1))} ${opInch() ? 'in' : 'mm'}/min`;
                            let no = null;
                            const lenWords = mm => window.SwarfLength ? window.SwarfLength.say(mm) : `${mm} mm`;
                            if (f === 'step' && v === Infinity) no = 'Stepover goes up to 100 % of the bit: past that the passes leave ridges between them. It stays as it was.';
                            else if (!Number.isFinite(v)) no = typed ? `swarf could not read "${typed}" there: it stays as it was.` : null;
                            else if (f === 'down' && v > 150) no = `A step-down goes up to ${lenWords(150)}, the most this machine cuts: it stays as it was.`;
                            else if (f === 'down' && v === 0 && rec.type !== 'drill') no = 'A step-down of 0 cuts nothing, or the whole depth at once: give it a depth above 0. It stays as it was.';
                            else if (f === 'leave' && v > toolWidth(rec)) no = `An allowance goes up to the bit's width (${lenWords(toolWidth(rec))}): it stays as it was.`;
                            else if (f === 'rate' && top > 0 && v > top) no = `That is faster than this machine moves (${rateWords(top)} at most): the feed stays as it was.`;
                            if (no) api.show.alert(no, 6);
                            else if (Number.isFinite(v)) rec[f] = v;
                            inp.value = opShow(f, rec[f]);
                        }
                        api.conf.save();
                    });
                    inp.addEventListener('mousedown', ev => ev.stopPropagation());
                    inp.addEventListener('click', ev => ev.stopPropagation());
                });
                chevEl.addEventListener('mousedown', ev => {
                    ev.stopPropagation();
                    ev.preventDefault();
                });
                chevEl.addEventListener('click', ev => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    $(id).classList.toggle('swarf-params-open');
                });
                // swarf r5: also toggle from clicking the op label itself so
                // Phil doesn't have to aim at a small chevron.
                const labelEl = $(id) && $(id).querySelector('.label');
                if (labelEl) {
                    labelEl.addEventListener('click', ev => {
                        ev.stopPropagation();
                        ev.preventDefault();
                        $(id).classList.toggle('swarf-params-open');
                    });
                }
            }
        } else {
            indexing = false;
        }
        let el = $(id);
        if (wasOpen.has(rec)) el.classList.add('swarf-params-open');
        if (!env.isIndexed && type === 'lathe') {
            rec.disabled = true;
        }
        if (!env.isIndexed && (type === 'loop' || rec._numloop)) {
            rec.disabled = true;
        }
        if (rec.disabled) {
            el.classList.add("disabled");
        }
        bounds.push(el);
        let parent = $('camops');
        let timer = null;
        let inside = true;
        let popped = false;
        let poprec = env.popOp[rec.type];
        if (type === 'index' && indexing && !rec.disabled) {
            let numloop = rec._numloop ?? 1;
            index = rec.absolute ? rec.degrees : index + (rec.degrees * numloop);
        }
        el.rec = rec;
        el.unpop = () => {
            let pos = [...parent.childNodes].indexOf(poprec.div);
            if (pos >= 0) {
                parent.removeChild(poprec.div);
            }
            popped = false;
        };
        function onEnter(ev) {
            if ((clock || surfaceOn || traceOn) && env.poppedRec != rec) {
                return;
            }
            if (popped && env.poppedRec != rec) {
                surfaceDone();
                traceDone();
            }
            if (unpop) unpop();
            env.func.unpop = unpop = el.unpop;
            inside = true;
            // pointer to current rec for trace editing
            env.poppedRec = rec;
            popped = true;
            poprec.use(rec);
            env.hoveredOp = el;
            // offset Y position of pop div by % of Y screen location of button
            parent.appendChild(poprec.div);
            poprec.addNote();
            const { innerHeight } = window;
            const brect = ev.target.getBoundingClientRect();
            const prect = parent.getBoundingClientRect();
            const Prect = poprec.div.getBoundingClientRect();
            const topmv = brect.top - prect.top - Math.min(50, Prect.height/5);
            const topnu = prect.top + topmv;
            const botof = innerHeight - (topnu + Prect.height);
            const offpx = botof < 0 ? topmv + botof : topmv;
            poprec.div.style.transform = `translateY(${offpx}px)`;
            poprec.div.onmouseenter = () => { inside = true };
            poprec.div.onmouseleave = onLeave;
            // option click event appears latent
            // and overides the sticky settings
            setTimeout(() => {
                UC.setSticky(false);
            }, 10);
        }
        function onLeave(ev) {
            inside = false;
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (!inside && poprec.using(rec) && !UC.isSticky()) {
                    el.unpop();
                }
            }, 250);
        }
        function onDown(ev) {
            if (!ev.target.rec) {
                // only trigger on operation buttons bound to recs
                return;
            }
            let mobile = ev.touches;
            surfaceDone();
            traceDone();
            let target = ev.target, clist = target.classList;
            if (!clist.contains("draggable")) {
                return;
            }
            // toggle enable / disable
            if (!clock && (ev.ctrlKey || ev.metaKey)) {
                ev.preventDefault();
                ev.stopPropagation();
                rec.disabled = !rec.disabled;
                for (let op of ev.shiftKey ? oplist : [rec]) {
                    if (op !== rec) {
                        op.disabled = op.type !== '|' ? !rec.disabled : false;
                    }
                }
                for (let el of bounds) {
                    if (el.rec.disabled) {
                        el.classList.add("disabled");
                    } else {
                        el.classList.remove("disabled");
                    }
                }
                if (env.isIndexed) {
                    updateIndex();
                }
                return true;
            }
            // duplicate op
            if (!clock && ev.shiftKey) {
                ev.preventDefault();
                ev.stopPropagation();
                oplist = env.current.process.ops;
                oplist.push(Object.clone(rec));
                api.conf.save();
                opRender();
                return true;
            }
            clist.add("drag");
            ev.stopPropagation();
            ev.preventDefault();
            let tracker = UI.tracker;
            tracker.style.display = 'block';
            let cancel = tracker.onmouseup = (ev) => {
                oplist = env.current.process.ops;
                clist.remove("drag");
                tracker.style.display = 'none';
                if (ev) {
                    ev.stopPropagation();
                    ev.preventDefault();
                }
                oplist.length = 0;
                for (let child of listel.childNodes) {
                    oplist.push(child.rec);
                }
                api.conf.save();
                opRender();
                if (mobile) {
                    el.ontouchmove = onDown;
                    el.ontouchend = undefined;
                }
            };
            function onMove(ev) {
                ev.stopPropagation();
                ev.preventDefault();
                if (ev.buttons === 0) {
                    return cancel();
                }
                for (let el of bounds) {
                    if (el === target) continue;
                    let rect = el.getBoundingClientRect();
                    let top = rect.top;
                    let bottom = rect.bottom;// + rect.height;
                    let tar = mobile ? ev.touches[0] : ev;
                    if (tar.pageY >= top && tar.pageY <= bottom) {
                        let mid = (top + bottom) / 2;
                        try { listel.removeChild(target); } catch (e) { }
                        el.insertAdjacentElement(tar.pageY < mid ? "beforebegin" : "afterend", target);
                    }
                }
            }
            tracker.onmousemove = onMove;
            if (mobile) {
                el.ontouchmove = onMove;
                el.ontouchend = cancel;
            }
        }
        if (SPACE.info.mob) {
            let touched = false;
            el.ontouchstart = (ev) => {
                touched = true;
                if (env.poppedRec === rec && popped) {
                    onLeave(ev);
                } else {
                    onEnter(ev);
                }
            };
            el.ontouchmove = onDown;
            el.onmouseenter = (ev) => {
                if (touched) {
                    // touches block mouse events on touchscreen PCs
                    // which are often sent along with touch events
                    // but when not touched, allow the mouse to work
                    return;
                }
                el.onmousedown = onDown;
                el.onmouseleave = onLeave;
                onEnter(ev);
            };
        } else {
            el.onmousedown = onDown;
            el.onmouseenter = onEnter;
            el.onmouseleave = onLeave;
        }
    }
    if (env.lastMode !== VIEWS.ANIMATE) {
        // update widget rotations from timeline marker
        WIDGETS.setAxisIndex(env.isPreview || !env.isIndexed ? 0 : -index);
    }
    env.currentIndex = env.isIndexed && !env.isPreview ? index * DEG2RAD : 0;
    updateStock();
}

export function zPlaneShow({ which, value }) {
    if (!value) return;
    if (which === 'top') showZTop(value); else
    if (which === 'bottom') showZBottom(value);
}

export function zPlaneHide({ which }) {
    updateStock();
}

export function zPlaneSelect({ which, onselect }) {
    if (zPlaneSelecting()) {
        return zPlaneDone();
    }
    clearPops();
    zPlaneStart(which, value => {
        onselect(parseFloat(value) / api.view.unit_scale());
    });
}

export function init() {

    // swarf: click a tab to pick it, drag it along the edge, Delete, its card (cl-tabedit.js)
    tabEditInit();

    api.event.on('tool.mesh.face-normal', normal => {
        env.poppedRec.degrees = (Math.atan2(normal.y, normal.z) * RAD2DEG).round(2);
        env.poppedRec.absolute = true;
        opRender();
        updateStock();
    });

    api.event.on("cam.trace.clear", traceClear);

    api.event.on("cam.parse.gerber", opts => {
        const { data, mesh } = opts;
        const { open, closed, circs, rects } = load.GBR.parse(data);
        const stack = new Stack(mesh || SPACE.world.newGroup());
        const layers = new Layers();
        for (let poly of open) {
            layers.setLayer("open", { line: 0xff8800 }, false).addPoly(poly);
            let diam = poly.tool?.shape?.diameter;
            if (diam) {
                const exp = poly.offset_open(diam, 'round');
                layers.setLayer("open-exp", { line: 0xff5555 }, false).addPolys(exp);
            }
        }
        for (let poly of closed) {
            layers.setLayer("close", { line: 0xff0000 }, false).addPoly(poly);
        }
        for (let poly of circs) {
            layers.setLayer("circs", { line: 0x008800 }, false).addPoly(poly);
        }
        for (let poly of rects) {
            layers.setLayer("rects", { line: 0x0000ff }, false).addPoly(poly);
        }
        stack.addLayers(layers);
    });

    api.event.on("widget.add", widget => {
        if (env.isCamMode && !Array.isArray(widget)) {
            updateAxisMode(true);
            widget.setIndexed(env.isIndexed ? true : false);
            api.platform.update_bounds();
        }
    });

    // wire up animate button in ui
    api.event.on("function.animate", (mode) => {
        if (env.isAnimate || !env.isCamMode) {
            return;
        }
        api.function.prepare(() => {
            if (env.isCamMode) {
                animate();
            }
        });
    });

    api.event.on("function.export", (mode) => {
        if (env.isAnimate) {
            env.isAnimate = false;
            animFn().animate_clear(api);
        }
    });

    api.event.on("mode.set", (mode) => {
        env.isIndexed = undefined;
        env.isCamMode = mode === 'CAM';
        SPACE.platform.setColor(env.isCamMode ? 0xeeeeee : 0xcccccc);
        api.uc.setVisible(UI.func.animate, env.isCamMode);
        // hide/show cam mode elements
        for (let el of [...document.getElementsByClassName('mode-cam')]) {
            api.uc.setClass(el, 'hide', !env.isCamMode);
        }
        if (!env.isCamMode) {
            clearPops();
            tabClear();
        }
        // do not persist traces across page reloads
        traceClear();
        opRender();
        updateStock();
    });

    api.event.on("view.set", (mode) => {
        env.lastMode = mode;
        env.isArrange = (mode === VIEWS.ARRANGE);
        env.isPreview = (mode === VIEWS.PREVIEW);
        env.isAnimate = (mode === VIEWS.ANIMATE);
        animFn().animate_clear(api);
        clearPops();
        if (env.isCamMode && env.isPreview) {
            WIDGETS.setAxisIndex(0);
        }
        updateStock();
        opRender();
        api.uc.setVisible($('layer-animate'), env.isAnimate && env.isCamMode);

        if (!env.isCamMode) {
            return;
        }

        // remove tab synth
        api.widgets.filter((widget) => {
            if (widget.track.synth) {
                space.world.remove(widget.mesh);
                Widget.Groups.remove(widget);
            }
            return !widget.track.synth
        });

    });

    api.event.on("settings.saved", (settings) => {
        validateTools(settings.tools);
        env.current = settings;
        let proc = settings.process;
        let hasTabs = false;
        let hasTraces = false;
        if (env.isCamMode && proc.ops) {
            proc.ops = proc.ops.filter(v => v);
        }
        // for any tabs or traces to set markers
        for (let widget of api.widgets.all()) {
            let wannot = widget.anno;
            if (wannot.tab && wannot.tab.length) hasTabs = true;
            if (wannot.trace && wannot.trace.length) hasTraces = true;
        }
        api.platform.update_bounds();
        updateIndex();
        updateStock();
        updateAxisMode();
        if (!env.poppedRec) {
            opRender();
        }
    });

    api.event.on("settings.load", (settings) => {
        opRender();
        if (!env.isCamMode) return;
        validateTools(settings.tools);
        restoreTabs(api.widgets.all());
        updateAxisMode();
    });

    api.event.on("cam.stock.toggle", (bool) => {
        env.showStock = bool ?? !env.showStock;
        updateStock();
    });

    api.event.on("boolean.click", api.platform.update_bounds);

    api.event.on([
        "init-done",
        "view.set",
        // update stock when modes change?
        "slice.end",
        "preview.end",
        // update stock when preferences change
        // "boolean.click",
        "boolean.update",
        // update stock when objects move
        "platform.layout",
        "selection.drag",
        "selection.move",
        // force bounds update, too
        "selection.scale",
        "selection.rotate"
    ], updateStock);

    // invalidate trace and drill ops on scale or rotate
    api.event.on([
        "selection.scale",
        "selection.rotate"
    ], () => {
        if (!env.isCamMode) return;
        for (let op of env.current.process.ops) {
            if (op.type === 'trace' && !env.flipping) {
                op.areas = {};
            }
            else if (op.type === 'drill' && !env.flipping) {
                op.drills = {};
            }
        }
    });

    // invalidate tabs when scaleds
    api.event.on([
        "selection.scale",
    ], () => {
        // swarf: said, not silent (torture test 10-29: a resize left the part with no tabs and only
        // "Resized to ..."); auto tabs come back by themselves at the new size (cl-autotab.js),
        // and the ones moved or resized by hand (pinned) stay, scaled with their part
        let hand = 0, auto = 0;
        for (const w of api.widgets.all()) for (const r of (w.anno && w.anno.tab) || []) { if (r.auto) auto++; else hand++; }
        const held = autoHold();
        tabClear();
        autoHeld(held);
        // after the size card's own "Resized to ..." (a 120 ms debounce), so this is the line left showing
        if (hand) setTimeout(() => api.show.alert(`the resize took away ${hand} tab${hand === 1 ? '' : 's'} you placed by hand: place ${hand === 1 ? 'it' : 'them'} again (tabs › +)${auto ? '; the auto tabs are placed again' : ''}`, 10), 400);
    });

    api.event.on([
        // update tab color/opacity on dark/light change
        "boolean.update"
    ], updateTabs);

    api.event.on("preview.end", () => {
        env.isParsed = false;
        if (env.isCamMode) {
            let bounds = STACKS.getStack("bounds");
            if (bounds) bounds.button("animate", animate);
        }
    });

    api.event.on("code.loaded", (info) => {
        if (env.isCamMode) {
            env.isParsed = true;
            let parse = STACKS.getStack("parse", SPACE.world);
            if (parse) parse.button("animate", animate);
        }
    });

    $('op-add').onmouseenter = () => {
        if (env.func.unpop) env.func.unpop();
    };

    // drill is a basic step (review 105 B4). Done here as well as in index.html: the site's page is its
    // own copy of that file and deploy.sh does not overwrite it
    {
        const list = $('op-add-list'), kids = [...list.children], word = t => kids.find(c => c.textContent.trim() === t);
        const drill = word('drill'), pocket = word('pocket');
        if (drill && pocket) {
            drill.classList.remove('swarf-expert-only');
            drill.title = 'drills the round holes in the part that are the size of its bit: peck by peck, down to the bottom of the board';
            pocket.after(drill);
        }
    }

    $('op-add-list').onclick = (ev) => {
        switch (ev.target.innerText.toLowerCase()) {
            case "index": return opAddIndex();
            case "laser on": return opAddLaserOn();
            case "laser off": return opAddLaserOff();
            case "gcode": return opAddGCode();
            case "level": return opAddLevel();
            case "loop": return opAddLoop();
            case "rough": return opAddRough();
            case "outline": return opAddOutline();
            case "contour":
                let caxis = "X";
                for (let op of env.current.process.ops) {
                    if (op.type === "contour" && op.axis === "X") {
                        caxis = "Y";
                    }
                }
                return opAddContour(caxis);
            case "lathe":
                let laxis = "X";
                for (let op of env.current.process.ops) {
                    if (op.type === "lathe" && op.axis === "X") {
                        laxis = "Y";
                    }
                }
                return opAddLathe(laxis);
            case "register": return opAddRegister('X', 2);
            case "drill": return opAddDrill();
            case "trace": return opAddTrace();
            case "pocket": return opAddPocket();
            case "helical": return opAddHelical();
            case "area": return opAddArea();
            case "flip":
                // only one flip op permitted
                for (let op of env.current.process.ops) {
                    if (op.type === 'flip') {
                        return;
                    }
                }
                return opAddFlip();
        }
    };

    // TAB/TRACE BUTTON HANDLERS
    api.event.on("button.click", target => {
        let { process, stock } = api.conf.get();
        switch (target) {
            case api.ui.stockPlace:
                api.uc.prompt("stock x,y,z position", "").then(csv => {
                    if (csv) {
                        let [x,y,z] = csv.split(',').map(v => parseInt(v) || 0);
                        let center = {
                            x: x ?? 0,
                            y: y ?? 0,
                            z: z ?? 0
                        }
                        // move widgets based on postion
                        // more complex than just moving stock
                        // because stock is based on contents, not the other way
                        console.log({ x,y,z });
                    }
                });
                return;
            case api.ui.tabAdd:
                return tabAdd();
            case api.ui.tabDun:
                return tabDone();
            case api.ui.tabClr:
                // no yes/no box: undo brings them back, and that is said (review r093-ux B5: Kiri's
                // "clear tabs?" ignored Esc and stayed up across modes)
                { const before = tabSnap(); tabClear(); autoForget(); tabUndo(before, 'clear tabs');
                  api.show.alert('Removed every tab. ⌘Z brings them back.', 5); }
                break;
        }
    });

    api.event
        .on("cam.op.add", opAdd)
        .on("cam.op.del", opDel)
        .on("cam.op.render", opRender);

    api.event
        .on("cam.tabs.add", tabAdd)
        .on("cam.tabs.done", tabDone)
        .on("cam.tabs.clear", () => { const before = tabSnap(); tabClear(); autoForget(); tabUndo(before, 'clear tabs'); });

    api.event
        .on("cam.zplane.show", zPlaneShow)
        .on("cam.zplane.hide", zPlaneHide)
        .on("cam.zplane.select", zPlaneSelect);

    // COMMON TAB/TRACE EVENT HANDLERS
    api.event.on("slice.begin", () => {
        if (!env.isCamMode) {
            return;
        }
        clearPops();
        // swarf: auto tabs follow their part's settings, size, material, bit, board and machine
        try { autoRefresh(); } catch (e) { console.warn('auto tabs', e); }
        recreateTabs();
        for (let group of Widget.Groups.list()) {
            for (let widget of group) {
                if (widget.tabs)
                for (let tab of Object.values(widget.tabs)) {
                    let geo = tab.box.geometry.clone();
                    if (geo.index) geo = geo.toNonIndexed();
                    geo.translate(tab.x, tab.y, tab.z);
                    let bbg = BufferGeometryUtils.mergeGeometries([ geo ]);
                    let sw = newWidget(null, group);
                    let fwp = widget.track.pos;
                    sw.loadGeometry(bbg);
                    sw._move(fwp.x, fwp.y, fwp.z);
                    api.widgets.add(sw);
                    sw.track.synth = true;
                    sw.track.indexed = widget.track.indexed;
                    sw.track.tabOwner = widget.id;
                }
            }
        }
    });

    api.event.on("key.esc", () => {
        if (env.isCamMode) {
            clearPops();
        }
    });

    api.event.on("selection.scale", () => {
        if (env.isCamMode) {
            clearPops();
        }
    });

    api.event.on("widget.duplicate", (widget, oldwidget) => {
        if (!env.isCamMode) {
            return;
        }
        if (traceOn) {
            traceDone();
        }
        if(helicalOn){
            helicalDone();
        }
        unselectTraces(widget);
        if (env.flipping) {
            return;
        }
        let ann = api.widgets.annotate(widget.id);
        if (ann.tab) {
            ann.tab.forEach((tab, i) => {
                tab.id = Date.now() + i;
            });
            restoreTabs([widget]);
        }
    });

    api.event.on("widget.mirror", rec => {
        if (!env.isCamMode) {
            return;
        }
        // swarf: widget.js emits { widget }; the handlers below want the widget itself
        const widget = rec && rec.widget ? rec.widget : rec;
        if (traceOn) {
            traceDone();
        }
        if (holeSelOn) {
            selectHolesDone();
        }
        if(helicalOn){
            helicalDone();
        }
        clearHolesRec(widget)
        unselectTraces(widget);
        if (env.flipping) {
            return;
        }
        mirrorTabs(widget);
    });

    api.event.on("widget.rotate", rot => {
        if (!env.isCamMode) {
            return;
        }
        let { widget, x, y, z } = rot;
        if (traceOn) {
            traceDone();
        }
        unselectTraces(widget);
        if (holeSelOn) {
            selectHolesDone();
        }
        if(helicalOn){
            helicalDone();
        }
        if (env.flipping) {
            return;
        }
        clearHolesRec(widget)
        if (x || y) {
            clearTabs(widget);
        } else {
            rotateTabs(widget, x, y, z);
        }
    });

    api.event.on("mouse.hover.up", rec => {
        if (!env.isCamMode) {
            return;
        }
        let { object, event } = rec;
        env.hoverUp(object, event);
    });

    api.event.on("mouse.hover", data => {
        if (!env.isCamMode) {
            return;
        }
        env.hover(data);
    });

    createPopOps();
}

function validateTools(tools) {
    if (tools) {
        let max = 0;
        for (let t of tools) {
            if (Number.isInteger(t.number)) {
                max = Math.max(max, t.number);
            }
        }
        for (let t of tools) {
            if (!Number.isInteger(t.number)) {
                t.number = ++max;
                console.log('added tool #', t);
            }
        }
    }
}

function animate() {
    env.isAnimate = true;
    api.widgets.setOpacity(env.isParsed ? 0 : 0.75);
    api.hide.slider();
    STACKS.clear();
    animFn().animate(api);
    api.view.set_animate();
}

// swarf: the line under a step: its bit, how deep it goes and in how many passes, and the speed its
// full-width pass really runs at when that is not the number on the card (prepare.js polyEmit)
function toolWidth(rec) {
    const t = (api.conf.get().tools || []).find(t => t.id == rec.tool);
    return t ? t.flute_diam * (t.metric ? 1 : 25.4) : Infinity;
}
// the round holes in the parts a drill step cuts: how many its bit drills, and the deepest
function drillCount(rec) {
    const H = self.__swarfHoles;
    if (!H) return null;
    const bit = toolWidth(rec), parts = api.widgets.all().filter(w => !w.track.synth && !w.meta.disabled);
    let n = 0, deep = 0;
    for (const w of parts) {
        const picked = rec.drills?.[w.id];
        if (picked) { n += picked.filter(d => d.selected).length; continue; }
        const { holes, zmin, zmax } = H.of(w);
        for (const h of holes) if (H.fit(h.d, bit) === 'fits') { n++; deep = Math.max(deep, zmax - (h.floor ?? zmin)); }
    }
    return { n, deep };
}
function stepLine(rec) {
    const { process, tools, device } = api.conf.get();
    const tool = (tools || []).find(t => t.id == rec.tool);
    if (!tool) return '';
    const L = self.SwarfLength, inch = opInch();
    const len = mm => L ? L.say(mm) : `${+mm.toFixed(2)} mm`;
    const bits = [tool.name || `bit #${tool.number}`];
    const parts = api.widgets.all().filter(w => !w.track.synth && !w.meta.disabled);
    const thick = Math.max(0, ...parts.map(w => { const b = w.getBoundingBox(); return b.max.z - b.min.z; }));
    if (thick > 0 && (rec.type === 'outline' || rec.type === 'rough')) {
        const passes = rec.down > 0 ? Math.ceil((thick + 0.01) / rec.down) : 1;
        bits.push(`${len(thick)} deep, ${passes} pass${passes === 1 ? '' : 'es'}`);
    }
    if (rec.type === 'outline' && rec.leave > 0) bits.push(`leaves ${len(rec.leave)}${rec.lastpass ? '' : ', no last pass: stays oversize'}`);
    if (rec.type === 'outline' && rec.lastpass) bits.push('last pass at the whole depth');
    if (rec.type === 'drill') {
        const c = drillCount(rec);
        if (c) bits.push(c.n ? `${c.n} hole${c.n === 1 ? '' : 's'}${c.deep > 0 ? `, ${len(c.deep)} deep` : ''}` : 'no hole this bit fits');
    }
    if (rec.type === 'pocket') bits.push('down to the floor you pick');
    if (rec.rate > 0 && rec.type === 'outline' && !(process.camFullEngage >= 1)) {
        const band = /shopbot/i.test(device?.deviceName || '') ? 1500 : 0;
        const slow = rec.rate * (process.camFullEngage || 0.8), real = rec.rate >= band ? Math.max(slow, band) : slow;
        if (real < rec.rate - 0.5) bits.push(`full-width pass at ${inch ? `${Math.round(real / 25.4)} in/min` : `${Math.round(real)} mm/min`}`);
    }
    return bits.join(' · ');
}
// A pocket clears down to a floor in the part (op-pocket.js): a flat part has none, and a floor cannot
// be typed. TEX's inlay cuts a flat pocket from a mark at a typed depth: the card sends the student there.
function pocketRoute(rec) {
    const H = self.__swarfHoles, parts = api.widgets.all().filter(w => !w.track.synth && !w.meta.disabled);
    if (rec.type !== 'pocket' || !H || !self.__swarfTex?.openPocket || !parts.length) return false;
    if (Object.values(rec.surfaces || {}).some(l => l && l.length)) return false;
    return !parts.some(w => H.recess(w));
}
function paintStepLines() {
    const ops = env.current?.process?.ops || [];
    for (const el of document.querySelectorAll('#oplist .swarf-op-sum')) {
        const rec = ops[el.dataset.step], say = rec ? stepLine(rec) : '';
        if (el.textContent !== say) el.textContent = say;
        const card = el.parentElement, was = card.querySelector('.swarf-op-route'), want = !!rec && pocketRoute(rec);
        if (want && !was) {
            const box = document.createElement('div');
            box.className = 'swarf-op-route';
            box.textContent = 'This part has no recess to clear. For a flat pocket at a depth you type, mark its shape in tex.';
            const go = document.createElement('button');
            go.type = 'button';
            go.textContent = 'pocket in tex';
            go.title = 'opens tex with inlay picked: drag a shape on the part and type its depth. Done adds an inlay step and a plug part left out of the run. This empty step goes.';
            for (const ev of ['mousedown', 'click']) go.addEventListener(ev, e => e.stopPropagation());
            go.addEventListener('click', () => {
                const cur = (env.current?.process?.ops || [])[el.dataset.step];
                if (cur && cur.type === 'pocket') opDel(cur);
                self.__swarfTex.openPocket();
            });
            box.appendChild(go);
            el.after(box);
        } else if (!want && was) was.remove();
    }
}
