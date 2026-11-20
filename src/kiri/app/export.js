/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $ } from '../../moto/webui.js';
import { api } from './api.js';
import { client } from './workers.js';
import { local } from '../../data/local.js';
import { util } from '../../geo/base.js';
import { MODES } from './consts.js';
// swarf: laser + SLA modes deleted in fork audit; stubs keep exportFile dispatcher compilable
const laser_driver = { exportSVG:()=>'', exportDXF:()=>'', exportOBJ:()=>'', exportGCode:()=>'' };
const sla_client = { printDownload:()=>{} };
import { hash } from '../../ext/md5.js';
import { asciiNote } from '../core/ascii.js';

/**
 * Sequential print counter for generating unique export filenames.
 * Increments with each export and persists in local storage.
 */
// swarf: the first file on a computer is -001, never -002
let printSeq = parseInt(local['kiri-print-seq'] || local['print-seq'] || "0");

function localGet(key) {
    return api.local.get(key);
}

function localSet(key, val) {
    return api.local.set(key, val);
}

/**
 * Main export entry point. Dispatches to mode-specific export handlers.
 * Extracts widget filenames to use for export filename suggestions.
 * @param {object} options - Export options (mode-specific)
 * @returns {*} Result from mode-specific export handler
 */
export function exportFile(options) {
    let mode = api.mode.get();
    let names = api.widgets.all().map(w => w.meta ? w.meta.file : undefined)
        .filter(v => v)
        .map(v => v.replace(/ /g,'-'))
        .map(v => v.substring(0,20))
        .map(v => v.split('.')[0]);
    // swarf: a project saved or opened as a .swarf names the export after itself
    const project = window.SwarfFile && window.SwarfFile.projectName && window.SwarfFile.projectName();
    if (project) names.unshift(String(project).replace(/ /g, '-').substring(0, 40));
    // the project's name goes bare (cutting-board.swarf exports cutting-board.sbp);
    // a sequence number only when there is no project, to keep two exports of "rectangle" apart
    names.project = !!project;
    api.event.emit('export', mode);
    switch (mode) {
        case 'WEDM':
        case 'WJET':
        case 'DRAG':
        case 'LASER': return callExportLaser(options, names);
        case 'FDM': return callExport(options, mode, names);
        case 'CAM': return callExport(options, mode, names);
        case 'SLA': return callExportSLA(options, names);
    }
}

/**
 * Export gcode for FDM or CAM modes.
 * Calls worker to generate gcode, then presents dialog or invokes callback.
 * @param {function} callback - Optional callback(gcode_string, output_info), or callback(null, error)
 * @param {string} mode - Current mode ('FDM' or 'CAM')
 * @param {string[]} names - Widget filenames for export naming
 */
function callExport(callback, mode, names) {
    // swarf: code that asks for the file (control building its program) says its
    // own words, so no notice; the export card's wait is said in swarf's words, not Kiri's
    let alert = api.feature.work_alerts && !callback ? api.show.alert("Making the machine file…") : null;
    let gcode = [];
    let section = [];
    let sections = { };
    // swarf: where each step starts in the file (1-based lines), for the time estimate's shares.
    // The worker sends its lines in chunks of up to a thousand, so the lines are counted.
    let starts = [], count = 0;
    const bits = bitFiles();
    client.export(api.conf.get(), (line) => {
        bits.take(line);
        if (typeof line !== 'string') {
            if (line.section) {
                sections[line.section] = section = [];
                starts.push({ step: line.step, line: count + 1 });
            }
            if (line.bit) starts.push({ bit: line.bit.order, line: count + 1 });
            return;
        }
        count += lineCount(line);
        gcode.push(line);
        section.push(line);
    }, (output, error) => {
        api.hide.alert(alert);
        if (output) output.swarfStarts = starts;
        if (output) output.swarfBitFiles = bits.files();
        if (error) {
            api.show.alert(error, 5);
            api.event.emit('export.error', error);
            // code waiting for the file hears why there is none
            if (callback) callback(null, error);
        } else if (callback) {
            callback(gcode.join('\r\n'), output);
        } else {
            exportGCodeDialog(gcode, mode === 'CAM' ? sections : undefined, output, names);
        }
    });
}

/**
 * swarf: one file per bit, for a machine that takes no bit change inside a file (the MR-1: its
 * controller cannot jog or set a new bit's length while a program is held). The worker marks where
 * each bit starts (cam/work/export.js perBit); each file is the start lines, that bit's cutting and
 * the end lines, so each one runs alone after its own Z zero. files() is null for a one-bit job.
 */
function bitFiles() {
    let where = '', head = [], foot = [], pre = [], runs = [], now = null;
    const name = v => String(v || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 40);
    return {
        take(line) {
            if (typeof line !== 'string') {
                if (line && line.section) where = line.section === 'header' || line.section === 'footer' ? line.section : 'step';
                // a step's lines before its first bit (a comment) go with that bit
                if (line && line.bit) { runs.push(now = { bit: line.bit, lines: pre }); pre = []; }
                return;
            }
            if (where === 'header') head.push(line);
            else if (where === 'footer') foot.push(line);
            else if (now) now.lines.push(line);
            else pre.push(line);
        },
        files() {
            if (runs.length < 2) return null;
            return runs.map((r, i) => ({
                name: `${i + 1}-${name(r.bit.name) || 'bit-' + r.bit.number}`,
                bit: r.bit.name,
                text: [...head, ...r.lines, ...foot].join('\r\n') + '\r\n'
            }));
        }
    };
}

// the lines in one chunk the worker sent (joined with \r\n)
function lineCount(chunk) {
    let n = 1;
    for (let i = chunk.indexOf('\n'); i >= 0; i = chunk.indexOf('\n', i + 1)) n++;
    return n;
}

/**
 * swarf: the machine file made quietly for the time estimate (web/kiri/swarf-estimate.js): no
 * notice, no export event (that event ends a simulate), the steps' starts with it.
 * @param {function} callback - callback(text, starts) or callback(null) on an error
 */
export function exportQuiet(callback) {
    let gcode = [], starts = [], count = 0;
    client.export(api.conf.get(), (line) => {
        if (typeof line !== 'string') {
            if (line && line.section) starts.push({ step: line.step, line: count + 1 });
            if (line && line.bit) starts.push({ bit: line.bit.order, line: count + 1 });
            return;
        }
        count += lineCount(line);
        gcode.push(line);
    }, (output, error) => callback(error ? null : gcode.join('\r\n'), starts));
}

/**
 * Export laser/waterjet/drag knife toolpaths.
 * Worker generates output, then presents export dialog with SVG/DXF/STL/GCode options.
 * @param {object} options - Export options
 * @param {string[]} names - Widget filenames for export naming
 */
function callExportLaser(options, names) {
    client.export(api.conf.get(), (line) => {
        // engine export uses lines
        // console.log({unexpected_line: line});
    }, (output, error) => {
        // UI export uses output
        if (error) {
            api.show.alert(error, 5);
        } else {
            exportLaserDialog(output, names);
        }
    });
}

/**
 * Export SLA print data.
 * Worker generates layer images, then delegates to SLA client for download.
 * @param {object} options - Export options
 * @param {string[]} names - Widget filenames for export naming
 */
function callExportSLA(options, names) {
    client.export(api.conf.get(), (line) => {
        api.show.progress(line.progress, "exporting");
    }, (output, error) => {
        api.show.progress(0);
        if (error) {
            api.show.alert(error, 5);
        } else {
            sla_client.printDownload(output, api, names);
        }
    });
}

/**
 * Present laser export dialog with format options (SVG, DXF, STL, GCode).
 * Sets up UI handlers for downloading in each supported format.
 * @param {Array} data - Layer data from export worker
 * @param {string[]} names - Widget filenames for naming suggestion
 */
function exportLaserDialog(data, names) {
    localSet('kiri-print-seq', ++printSeq);

    const fileroot = names[0] || "laser";
    const filename = names.project ? fileroot : `${fileroot}-${(printSeq.toString().padStart(3,"0"))}`;
    const settings = api.conf.get();
    const driver = laser_driver;
    const { process } = settings;
    if (process.ctOutStack) {
        $('print-obj').classList.remove('hide');
    } else {
        $('print-obj').classList.add('hide');
    }

    function download_svg() {
        api.util.download(
            driver.exportSVG(settings, data),
            $('print-filename-laser').value + ".svg"
        );
    }

    function download_dxf() {
        api.util.download(
            driver.exportDXF(settings, data),
            $('print-filename-laser').value + ".dxf"
        );
    }

    function download_obj() {
        api.util.download(
            driver.exportOBJ(settings, data),
            $('print-filename-laser').value + ".obj"
        );
    }

    function download_gcode() {
        api.util.download(
            driver.exportGCode(settings, data),
            $('print-filename-laser').value + ".gcode"
        );
    }

    api.modal.show('xlaser');

    let segments = 0;
    data.forEach(layer => { segments += layer.length });

    $('print-filename-laser').value = filename;
    $('print-lines').value = util.comma(segments);
    $('print-svg').onclick = download_svg;
    $('print-dxf').onclick = download_dxf;
    $('print-obj').onclick = download_obj;
    $('print-lg').onclick = download_gcode;
}

/**
 * Bind an input field to persist its value to local storage on blur.
 * @param {string} field - Element ID of the input field
 * @param {string} varname - Local storage key to save value under
 */
function bindField(field, varname) {
    $(field).onblur = function() {
        console.log('save', field, 'to', varname);
        localSet(varname, $(field).value.trim());
    };
    $(field).onchange = $(field).onblur;
}

/**
 * swarf: the export dialog as a swarf card. One name field, one line of
 * what the file is ("about 3 min · 71 KB · end 1/4 · hard wood"), one button that saves the file
 * the machine runs ("save circle.sbp"), a quiet "also save the project". Kiri's own rows (gcode
 * preview, one file per step) stay reachable in advanced. Outside cam the dialog is Kiri's.
 */
/**
 * swarf: what swarf knew when it saved the file goes into the file, as comments the
 * machine skips: one line that swarf saved it, and each concern still open. Control reads them back
 * (swarf-run.js fileNotes) when the file is opened on its own, so a technician sees the missing tabs
 * the student saw. The comment mark is the file's own: ' in a ShopBot file, else ; or ( ).
 */
function swarfFileNote(text, open, ext) {
    const t = String(text || '');
    const sbp = /^sbp$/i.test(ext) || /^\s*'/m.test(t);
    const paren = !sbp && !/^\s*;/m.test(t) && /^\s*\(/m.test(t);
    // plain ASCII (core/ascii.js), each line ended as the file ends its own, and short: some
    // controllers refuse lines over 255. A concern is its title on one line and its hint on the next
    // (swarf hint:), each whole: a long one wraps at a space onto swarf more: lines (control joins them)
    const eol = /\r\n/.test(t) ? '\r\n' : '\n';
    const one = v => sbp ? `' ${v}${eol}` : paren ? `(${v})${eol}` : `; ${v}${eol}`;
    const line = (key, v) => {
        const words = asciiNote(v).split(' '), rows = [];
        let row = `${key}:`;
        for (const w of words) {
            if (row.length + 1 + w.length > 100 && !/:$/.test(row)) { rows.push(row); row = 'swarf more:'; }
            row += ' ' + w;
        }
        rows.push(row);
        return rows.map(one).join('');
    };
    const day = new Date().toISOString().slice(0, 10);
    let head = line('swarf saved', `${day}, ${open.length ? open.length + ' concern' + (open.length === 1 ? '' : 's') + ' open' : 'no concerns open'}`);
    for (const c of open) {
        head += line('swarf concern', c.title);
        if (c.hint) head += line('swarf hint', c.hint);
    }
    // the board size, so control names the zero on it for a file opened alone
    const pr = api.conf.get().process || {};
    if (pr.swarfBoardOn && pr.swarfBoardX > 0 && pr.swarfBoardY > 0 && pr.swarfBoardZ > 0)
        head += one(`swarf board: ${+pr.swarfBoardX.toFixed(2)} x ${+pr.swarfBoardY.toFixed(2)} x ${+pr.swarfBoardZ.toFixed(2)} mm, X 0 Y 0 at its ${pr.camOriginCenter ? 'center' : 'front-left corner'}`);
    return head;
}

function swarfExportCard(on, { filename, fileext, info, download, downloadBits, sections, gcodeText }) {
    const box = $('mod-x-any');
    if (!box) return;
    box.classList.toggle('swarf-x', !!on);
    let card = box.querySelector('.swarf-x-card');
    if (card) card.remove();
    if (!on) return;
    const ext = String(fileext || 'gcode').replace(/^\./, '');
    const set = api.conf.get();
    const dev = (set.device && set.device.deviceName) || '';
    const shopbot = /shopbot/i.test(dev);
    const machine = shopbot ? 'ShopBot' : (dev.replace(/^[^.]*\./, '').replace(/\./g, ' ') || 'machine');
    const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    // what the file is, in one line
    // the time as the ShopBot takes it (swarf-estimate.js: its speed-ups, slow-downs at bends,
    // the router's spin-up), the same number simulate and the step cards show; Kiri's own
    // distance-over-feed time is a quarter short on a texture
    const E = window.SwarfEstimate;
    const est = E && gcodeText ? E.of(gcodeText, { sections: info.swarfStarts || [], cfg: E.cfgFor ? E.cfgFor(set.device) : undefined }) : null;
    if (est) info.time = est.seconds;   // Kiri's time row in advanced says the same
    if (est && window.SwarfEstimateUI) window.SwarfEstimateUI.fromExport(est);
    const t = Math.round(est ? est.seconds : info.time || 0);
    const time = (E ? E.words(t) : t < 60 ? 'under a minute' : `about ${Math.round(t / 60)} min`)
        + (est && est.changes ? ` + ${est.changes} bit change${est.changes > 1 ? 's' : ''}` : '');
    const b = info.bytes || 0;
    const size = b < 1024 ? `${b} bytes` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
    const ops = ((set.process && set.process.ops) || []).filter(op => op && op.type !== '|' && !op.disabled);
    const bits = [];
    for (const op of ops) {
        const tool = (set.tools || []).find(tl => tl.id == op.tool);
        const nm = tool && (tool.name || `bit #${tool.number}`);
        if (nm && !bits.includes(nm)) bits.push(nm);
    }
    const msel = document.getElementById('swarf-material-select');
    const mat = msel && msel.selectedOptions[0] ? msel.selectedOptions[0].textContent.trim() : '';
    const facts = [time, size, bits.length > 2 ? `${bits.length} bits` : bits.join(', then '), mat].filter(Boolean).join(' · ');
    const expert = document.body.classList.contains('swarf-expert');
    // what is still wrong travels with the file: in the concerns' own words, the save says it knows.
    // A file with no cutting at all has nothing to save (m6).
    let open = [];
    try { open = window.__swarfConcernsNow ? window.__swarfConcernsNow() : []; } catch (e) { /* not ready */ }
    const nothing = gcodeText && !/^\s*(G0?1|G0?2|G0?3|M[23XYZ]|C[WC])\b/m.test(gcodeText);
    // a job the machine cannot do is refused here too, in the concern's own words
    const big = open.find(c => c.block);
    // a machine that takes one bit a file: a job with several bits saves one file per bit, in a .zip
    const perBit = info.swarfBitFiles && info.swarfBitFiles.length > 1 ? info.swarfBitFiles : null;
    const saveExt = perBit ? 'zip' : ext;
    const sayOpen = open.length ? `<div class="swarf-x-concerns"><b>${open.length === 1 ? 'One concern is' : `${open.length} concerns are`} still open</b><ul>${open.slice(0, 4).map(c => `<li>${esc(c.title)}<em>${esc(c.hint || '')}</em></li>`).join('')}</ul>${open.length > 4 ? `<p>and ${open.length - 4} more, under concerns.</p>` : ''}</div>` : '';
    card = document.createElement('div');
    card.className = 'swarf-x-card';
    card.innerHTML = `<h3>Save the ${esc(machine)} file</h3>`
        + `<p class="swarf-x-why">${shopbot ? 'To cut now, press <b>control</b>: it needs no file. Save this to cut later or on another computer.' : perBit ? `${perBit.length} files, one for each bit, run in order: zero Z again for each bit.` : `The file the ${esc(machine)} runs: take it to the machine.`}</p>`
        + `<label class="swarf-x-name"><span>name</span><input type="text" spellcheck="false" autocomplete="off"/><em>.${esc(saveExt)}</em></label>`
        + `<p class="swarf-x-facts">${esc(facts)}</p>`
        + (big ? `<p class="swarf-x-nothing">${esc(big.title)}: ${esc(big.body)}</p>` : nothing ? `<p class="swarf-x-nothing">This file cuts nothing: every step is empty or left out. Check the steps and the ticks in objects.</p>` : sayOpen)
        + `<div class="swarf-x-row"><button class="swarf-x-proj" type="button" title="parts, steps and settings to reopen in swarf; not the machine file">save the project too (.swarf)</button>`
        + (expert && sections ? `<button class="swarf-x-zip" type="button" title="a separate file for each step, in one .zip">one file per step (.zip)</button>` : '')
        + `<span class="grow"></span><button class="swarf-x-go" type="button"></button></div>`;
    box.prepend(card);
    const name = card.querySelector('input');
    const go = card.querySelector('.swarf-x-go');
    const kiriName = $('print-filename');
    const clean = v => String(v || '').trim().replace(/\.(sbp|nc|gcode|tap|txt)$/i, '').replace(/[\\/:*?"<>|]+/g, '-') || filename;
    const paint = () => { go.textContent = big ? 'too big to save' : `${open.length ? 'save anyway' : 'save'} ${clean(name.value)}.${saveExt}`; };
    go.disabled = !!(nothing || big);
    name.value = filename;
    paint();
    name.addEventListener('input', paint);
    name.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') go.click(); });
    // two files, two buttons, each says what it saved ("also save the project" must not close the
    // card and save only the project, or a student could reach the machine without the machine file)
    let projSaved = '';
    go.onclick = () => {
        if (go.disabled) return;
        if (kiriName) kiriName.value = clean(name.value);
        if (perBit) downloadBits(swarfFileNote(gcodeText, open, ext));
        else download(swarfFileNote(gcodeText, open, ext));
        api.modal.hide();
        const both = projSaved ? ` and the project ${projSaved}` : '';
        api.show.alert(`Saved ${clean(name.value)}.${saveExt}${both}${shopbot ? ': open it in control to cut it.' : '.'}`, 6);
    };
    const proj = card.querySelector('.swarf-x-proj');
    proj.onclick = () => {
        if (!window.SwarfFile) return;
        window.SwarfFile.save({ name: clean(name.value) });
        projSaved = `${clean(name.value)}.swarf`;
        proj.textContent = `project saved (${projSaved}): now save the machine file`;
        proj.disabled = true;
        go.focus();
    };
    const zip = card.querySelector('.swarf-x-zip');
    if (zip) zip.onclick = () => { if (kiriName) kiriName.value = clean(name.value); $('print-zip').onclick(); };
    setTimeout(() => { try { name.focus(); name.select(); } catch (e) { /* closed */ } }, 50);
}

/**
 * Present gcode export dialog with download/send options.
 * Complex UI setup that handles:
 * - Local download of gcode, zip (CAM operations), or 3MF (FDM)
 * - OctoPrint integration for remote printing
 * - Bambu printer integration (via api.bambu)
 * - Print statistics (time, filament, weight)
 * - Gcode preview
 * @param {string[]} gcode - Array of gcode lines
 * @param {object} [sections] - CAM operation sections for zip export
 * @param {object} info - Export metadata (time, distance, bytes, etc.)
 * @param {string[]} names - Widget filenames for naming suggestion
 */
function exportGCodeDialog(gcode, sections, info, names) {
    localSet('kiri-print-seq', ++printSeq);

    let settings = api.conf.get(),
        MODE = api.mode.get_id(),
        name = names[0] || (MODE === MODES.CAM ? "cnc" : "print"),
        pre = names.project ? name : `${name}-${(printSeq.toString().padStart(3,"0"))}`,
        filename = pre,// + (new Date().getTime().toString(36)),
        fileext = settings.device.gcodeFExt || "gcode",
        codeproc = settings.device.gcodeProc,
        octo_host,
        octo_apik,
        octo_type;

    // join gcode array into a string
    gcode = gcode.join('\r\n') + '\r\n';

    // run gcode post processor function (when supplied and valid)
    if (codeproc && self[codeproc]) {
        gcode = self[codeproc](gcode);
    }

    function getBlob() {
        return new Blob(
            [gcode],
            {type:"application/octet-stream"});
    }

    function printToHost() {
        sendToHost(true);
    }

    function sendToHost(start) {
        if (!(octo_host && octo_apik && octo_type)) return;

        let form = new FormData(),
            ajax = new XMLHttpRequest(),
            host = octo_host.value.toLowerCase(),
            apik = octo_apik.value,
            type = octo_type.value,
            targetLocal = !api.util.isSecure(host),
            siteSecure = api.const.SECURE,
            proxy = targetLocal && api.feature.proxy ? host : undefined;

        if (host.indexOf("http") !== 0) {
            api.show.alert("host missing protocol (http:// or https://)");
            return;
        }
        if (siteSecure && targetLocal && !proxy) {
            api.show.alert("host must begin with 'https' on a secure site");
            return;
        }

        localSet('octo-host', host.trim());
        localSet('octo-apik', apik.trim());
        localSet('octo-type', type.trim());

        if (proxy) {
            console.log('proxying request to', host);
            host = 'http://127.0.0.1:5309';
        }

        filename = $('print-filename').value + "." + fileext;
        form.append("file", getBlob(), filename);
        ajax.onreadystatechange = function() {
            console.log({ ajax_readyState: ajax.readyState });
            if (ajax.readyState === 4) {
                let status = ajax.status;
                api.stats.add(`ua_${api.mode.get_lower()}_print_send_${status}`);
                if (status >= 200 && status < 300) {
                    api.modal.hide();
                } else {
                    api.show.alert("send error\nstatus: "+status+"\nmessage: "+ajax.responseText);
                }
                api.show.progress(0);
                if (start && type === 'moonraker') {
                    fetch(`${host}/printer/print/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename })
                    })
                    .then(r => r.json())
                    .then(data => console.log('print start', data))
                    .catch(err => console.error('print start error', err))
                }
            }
            api.show.progress(0);
        };
        ajax.upload.addEventListener('progress', (evt) => {
            console.log({ ajax_progress: evt });
            api.show.progress(evt.loaded/evt.total, "sending");
        });
        if (type === 'moonraker') {
            ajax.open("POST", host + "/server/files/upload");
        } else {
            ajax.open("POST", host + "/api/files/local");
        }
        if (proxy) {
            ajax.setRequestHeader("X-Host", proxy);
        }
        if (apik) {
            ajax.setRequestHeader("X-Api-Key", apik);
        }
        ajax.send(form);
    }

    function download(head) {
        filename = $('print-filename').value;
        // swarf: a device extension written with its dot (".sbp") saved "name..sbp"
        api.util.download((head || '') + gcode, filename + "." + String(fileext).replace(/^\./, ''));
        // saveAs(getBlob(), filename + "." + fileext);
    }

    // swarf: a job with several bits on a one-bit-a-file machine: each bit's file, named for its
    // order and its bit, in one .zip. Each carries what swarf knew when it saved (head).
    function downloadBits(head) {
        filename = $('print-filename').value;
        const ext = String(fileext).replace(/^\./, '');
        const files = info.swarfBitFiles.map(f => ({ name: `${filename}-${f.name}.${ext}`, data: (head || '') + f.text }));
        client.zip(files, progress => {
            api.show.progress(progress.percent/100, "making the files");
        }, output => {
            api.show.progress(0);
            api.util.download(output, `${filename}.zip`);
        });
    }

    function pad(v) {
        v = v.toString();
        return v.length < 2 ? '0' + v : v;
    }

    function calcWeight() {
        try {
        let density = $('print-density');
        info.weight = (
            (Math.PI * util.sqr(
                info.settings.device.extruders[0].extFilament / 2
            )) *
            info.distance *
            (parseFloat(density.value) || 1.25) /
            1000
        ).round(2);
        $('print-weight').value = info.weight.toFixed(2);
        density.onkeyup = (ev) => {
            if (ev.key === 'Enter') calcWeight();
        };
        } catch (e) { }
    }

    function calcTime() {
        let floor = Math.floor,
            time = floor(info.time),
            hours = floor(time / 3600),
            newtime = time - hours * 3600,
            mins = floor(newtime / 60),
            secs = newtime - mins * 60;

        $('output-time').value = [pad(hours),pad(mins),pad(secs)].join(':');
    }

    api.modal.show('xany');
        // swarf: in cam the dialog is one swarf card, the file the machine runs
        swarfExportCard(MODE === MODES.CAM, { filename, fileext, info, download, downloadBits, sections, gcodeText: gcode });
        let set = api.conf.get();
        let fdm = MODE === MODES.FDM;
        let cam = MODE === MODES.CAM;
        let octo = set.controller.exportOcto && !cam;
        let preview = set.controller.exportPreview;
        $('code-preview-head').style.display = preview ? '' : 'none';
        $('code-preview').style.display = preview ? '' : 'none';
        // one file holding several bits never leaves on a one-bit-a-file machine, from advanced either
        $('print-download').onclick = info.swarfBitFiles && info.swarfBitFiles.length > 1 ? () => downloadBits() : download;
        $('print-filament').style.display = fdm ? '' : 'none';
        $('print-filename').value = filename;
        $('print-filesize').value = util.comma(info.bytes);
        $('print-length').value = Math.round(info.distance);
        if ((fdm || cam) && preview && set.controller.devel) {
            document.body.classList.add('devel');
        }
        calcTime();
        if (fdm) {
            calcWeight();
        }

        // persist fields when changed
        bindField('octo-host', 'octo-host');
        bindField('octo-apik', 'octo-apik');
        bindField('octo-type', 'octo-type');

        // in cam mode, show zip file option
        let downloadZip = $('print-zip');
        downloadZip.style.display = sections ? 'flex' : 'none';
        downloadZip.onclick = function() {
            let files = [];
            for (let [ name, data ] of Object.entries(sections)) {
                if (name.indexOf('op-') === 0) {
                    let head = sections.header || [];
                    let foot = sections.footer || [];
                    files.push({
                        name: `${name}.${fileext}`,
                        data: [ ...head, ...data, ...foot ].join('\r\n')
                    })
                }
            }
            client.zip(files, progress => {
                api.show.progress(progress.percent/100, "generating zip files");
            }, output => {
                api.show.progress(0);
                api.util.download(output, `${$('print-filename').value}.zip`);
            })
        };

        // in fdm mode, show 3mf file option
        let nozzle0 = set.device?.extruders?.[0]?.extNozzle || 0.4;
        let download3MF = $('print-3mf');
        download3MF.style.display = fdm ? 'flex' : 'none';
        download3MF.onclick = function() {
            gen3mf(zip => api.util.download(zip, `${$('print-filename').value}.3mf`));
        };

        // present bambu print options when selected device is bambu; the hook
        // drives the page's bambu-output panel, so a page without it skips the hook
        if (api.bambu && $('bambu-output')) {
            api.bambu.prep_export(gen3mf, gcode, info, settings);
        }

        // let wids = api.widgets.all();
        // let bnds = settings.bounds;
        // console.log({ wids, bnds });

        /**
         * Generate 3MF file for Bambu/BambuStudio printers.
         * Creates ZIP archive with gcode, thumbnails, and metadata.
         * @param {function} then - Callback to receive generated 3MF blob
         * @param {string} [ptype='unknown'] - Printer type identifier
         * @param {number[]} [ams=[0]] - AMS (filament) slot assignments
         */
        function gen3mf(then, ptype = 'unknown', ams = [0]) {
            let now = new Date();
            let ymd = [
                now.getFullYear(),
                (now.getMonth() + 1).toString().padStart(2,0),
                now.getDate().toString().padStart(2,0),
            ].join('-');
            let files = [{
                name: `[Content_Types].xml`,
                data: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
                    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
                    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
                    ' <Default Extension="gcode" ContentType="application/octet-stream"/>',
                    '</Types>'
                ].join('\n')
            },{
                name: `_rels/.rels`,
                data: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
                    ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
                    '</Relationships>'
                ].join('\n')
            },{
                name: `3D/3dmodel.model`,
                data: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">',
                    ' <metadata name="Application">Kiri:Moto</metadata>',
                    ' <metadata name="Copyright"></metadata>',
                    ` <metadata name="CreationDate">${ymd}</metadata>`,
                    ' <metadata name="Description"></metadata>',
                    ' <metadata name="Designer"></metadata>',
                    ' <metadata name="DesignerCover"></metadata>',
                    ' <metadata name="License"></metadata>',
                    ` <metadata name="ModificationDate">${ymd}</metadata>`,
                    ' <metadata name="Origin"></metadata>',
                    ' <metadata name="Title"></metadata>',
                    ' <resources>',
                    ' </resources>',
                    ' <build/>',
                    '</model>'
                ].join('\n')
            },{
                name: `Metadata/_rels/model_settings.config.rels`,
                data: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
                    ' <Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/gcode"/>',
                    '</Relationships>'
                ].join('\n')
            // },{
            //     name: `Metadata/plate_1.json`,
            //     data: JSON.stringify({
            //         "bbox_all": [ 100, 100, 200, 200 ],
            //         "bbox_objects": (info.labels || []).map(label => {
            //             return {
            //                 area: 600,
            //                 bbox: [ 100, 100, 200, 200 ],
            //                 id: label,
            //                 layer_height: 0.2,
            //                 name: "Object"
            //             }
            //         }),
            //         "bed_type": "textured_plate",
            //         "filament_colors": ["#FFFFFF"],
            //         "filament_ids": ams,
            //         "first_extruder": ams[0],
            //         "is_seq_print": false,
            //         "nozzle_diameter": 0.6,
            //         "version": 2
            //     })
            },{
                name: `Metadata/model_settings.config`,
                data: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    '<config>',
                    '  <plate>',
                    '    <metadata key="plater_id" value="1"/>',
                    '    <metadata key="plater_name" value=""/>',
                    '    <metadata key="locked" value="false"/>',
                    '    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>',
                    '    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>',
                    '    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>',
                    '    <metadata key="top_file" value="Metadata/top_1.png"/>',
                    '    <metadata key="pick_file" value="Metadata/pick_1.png"/>',
                    '  </plate>',
                    '</config>'
                ].join('\n')
            },{
                name: `Metadata/slice_info.config`,
                data: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    '<config>',
                    '  <header>',
                    '    <header_item key="X-BBL-Client-Type" value="slicer"/>',
                    '    <header_item key="X-BBL-Client-Version" value="01.10.01.50"/>',
                    '  </header>',
                    '  <plate>',
                    '    <metadata key="index" value="1"/>',
                    // setting this value allows for the printer to error out if
                    // the gcode / 3mf was intended for a different target type.
                    // leaving it blank bypasses the check
                    // `    <metadata key="printer_model_id" value="${ptype}"/>`,
                    `    <metadata key="nozzle_diameters" value="${nozzle0}"/>`,
                    '    <metadata key="timelapse_type" value="0"/>',
                    `    <metadata key="prediction" value="${Math.round(info.time)}"/>`,
                    `    <metadata key="weight" value="${info.weight}"/>`,
                    '    <metadata key="outside" value="false"/>',
                    '    <metadata key="support_used" value="false"/>',
                    '    <metadata key="label_object_enabled" value="false"/>',
                    // (info.labels || []).map(label =>
                    // `    <object identify_id="${label}" name="Object" skipped="false" />`),
                    // '    <filament id="1" tray_info_idx="GFL96" type="PLA" color="#FFFFFF" used_m="0.17" used_g="0.50" />',
                    // '    <warning msg="bed_temperature_too_high_than_filament" level="1" error_code ="1000C001"  />',
                    '  </plate>',
                    '</config>'
                ].filter(v => v).flat().join('\n')
            },{
                name: `Metadata/project_settings.config`,
                data: JSON.stringify({},undefined,4)
            },{
                name: `Metadata/plate_1.gcode`,
                data: gcode
            },{
                name: `Metadata/plate_1.gcode.md5`,
                data: hash(gcode)
            },{
                name: `Metadata/plate_1_small.png`,
                data: api.view.bambu.s128.png
            },{
                name: `Metadata/plate_no_light_1.png`,
                data: api.view.bambu.s512.png
            },{
                name: `Metadata/plate_1.png`,
                data: api.view.bambu.s512.png
            },{
                name: `Metadata/pick_1.png`,
                data: api.view.bambu.s512.png
            },{
                name: `Metadata/top_1.png`,
                data: api.view.bambu.s512.png
            }];
            client.zip(files, progress => {
                api.show.progress(progress.percent/100, "generating 3mf");
            }, output => {
                api.show.progress(0);
                then(output);
            })
        };

        // remote host (klipper fluidd / octoprint)
        $('send-remote-head').style.display = octo ? '' : 'none';
        $('send-remote-print').style.display = octo ? '' : 'none';
        if (octo) try {
            $('send-remote').onclick = sendToHost;
            $('print-remote').onclick = printToHost;
            octo_host = $('octo-host');
            octo_apik = $('octo-apik');
            octo_type = $('octo-type');
            if (MODE === MODES.CAM) {
                $('send-remote-head').style.display = 'none';
                $('send-remote-print').style.display = 'none';
            } else {
                $('send-remote-head').style.display = '';
                $('send-remote-print').style.display = '';
            }
            // hide remote host option when hard-coded in the url
            if (api.const.OCTO) {
                $('ophost').style.display = 'none';
                $('opapik').style.display = 'none';
                $('oph1nt').style.display = 'none';
            }
            octo_host.value = localGet('octo-host') || '';
            octo_apik.value = localGet('octo-apik') || '';
            octo_type.value = localGet('octo-type') || '';
        } catch (e) { console.log(e) }

        // preview of the generated GCODE (first 64k max)
        if (preview && gcode) $('code-preview-textarea').value = gcode.substring(0,65535);
}
