/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $ } from '../../../moto/webui.js';
import { api } from '../api.js';
import { settings as set_ctrl } from './manager.js';

function export_device(exp, name) {
    name = (name || "device")
        .toLowerCase()
        .replace(/ /g,'_')
        .replace(/\./g,'_');
    api.uc.prompt("Export Device Filename", name).then(name => {
        if (name) {
            api.util.download(exp, `${name}.km`);
        }
    });
}

function export_objects(format = "stl") {
    // return selection.export();
    api.uc.confirm("Export Filename", {ok:true, cancel: false}, `selected.${format}`).then(name => {
        if (!name) return;
        if (name.toLowerCase().indexOf(`.${format}`) < 0) {
            name = `${name}.${format}`;
        }
        api.util.download(api.selection.export(format), name);
    });
}

function export_profile() {
    const opt = {pre: [
        "<div class='f-col a-center gap5 mlr10'>",
        "  <h3>Save for Kiri:Moto (.kmz)</h3>",
        "  <label>the parts, machine and settings, as Kiri:Moto opens them.</label>",
        "  <label>.swarf keeps everything; .kmz opens in Kiri:Moto.</label>",
        "  <span class='mt10'><input id='excwork' type='checkbox'>&nbsp;Exclude meshes</span>",
        "</div>"
    ]};
    let suggestion = "workspace";
    let file = api.widgets.all()[0]?.meta.file || '';
    if (file) {
        suggestion = `${suggestion}_${file.split('.')[0]}`.replaceAll(' ','_');
    };
    api.uc.confirm("Filename", {ok:true, cancel: false}, suggestion, opt).then(name => {
        if (!name) return;

        let work = !$('excwork').checked;
        let json = api.conf.export({work, clear:true});
        // swarf: a .kmz is for Kiri:Moto, which has no texture or pierce step (TEX's): those
        // stay out of it, and a .swarf keeps them (web/kiri/swarf-file.js)
        let dropped = self.SwarfFile ? self.SwarfFile.kmzSafe(json.settings) : 0;
        if (dropped) api.show.alert(`${dropped} TEX step${dropped === 1 ? ' was' : 's were'} left out: Kiri:Moto has no texture step. Save a project (.swarf) to keep everything.`, 10);

        api.client.zip([
            {name:"workspace.json", data:JSON.stringify(json)}
        ], progress => {
            api.show.progress(progress.percent/100, "compressing workspace");
        }, output => {
            api.show.progress(0);
            api.util.download(output, `${name}.kmz`);
        });
    });
}

function new_workspace() {
    // swarf: a running job is never cleared out from under the machine
    if (self.__swarfRun?.state?.machine?.state?.running) {
        api.show.alert('The machine is running. End the job, then start a new one.', 6);
        return;
    }
    // nor are toolpaths still being made: their worker carries on with the parts it was given
    if (!api.ui.progressOverlay?.classList.contains('hide')) {
        api.show.alert('swarf is still working. Start a new job when it finishes.', 6);
        return;
    }
    const n = api.widgets.all().length;
    const pre = ["<div class='f-col a-center swarf-shape'><h3>Start a new job?</h3>",
        `<p class='swarf-shape-why' style='color:inherit;max-width:300px;margin:0 auto'>${n ? `${n === 1 ? 'The part' : `The ${n} parts`}, every step and the toolpaths come off the bed. ` : 'Every step comes off the bed. '}Your bits, material and machine stay.</p></div>`];
    api.uc.confirm(undefined, { 'keep it': false, clear: true }, undefined, { pre }).then(value => {
        if (value !== true) return;
        // the same leaving as opening a .swarf: quiet deletes, TEX and DRAW shut, control forgets its job
        self.__swarfRestoring = true;
        setTimeout(() => { self.__swarfRestoring = false; }, 2000);
        self.SwarfFile?.fresh?.();
        api.animate?.clear?.();
        api.view.set_arrange();
        const proc = set_ctrl.proc();
        proc.ops && (proc.ops.length = 0);
        proc.op2 && (proc.op2.length = 0);
        api.platform.clear();
        api.platform.update_origin();
        api.event.emit('cam.op.render');
        self.dispatchEvent(new CustomEvent('swarf.clear'));
    });
}

function settings_save(ev, name) {
    if (ev) {
        ev.stopPropagation();
        ev.preventDefault();
    }

    api.dialog.hide();
    let mode = api.mode.get(),
        s = api.conf.get(),
        def = "default",
        cp = s.process,
        pl = s.sproc[mode],
        lp = s.cproc[mode],
        saveAs = (name) => {
            if (!name) {
                return;
            }
            let np = pl[name] = {};
            cp.processName = name;
            pl[name] = Object.clone(cp);
            for (let k in cp) {
                if (!cp.hasOwnProperty(k)) continue;
                np[k] = cp[k];
            }
            s.cproc[mode] = name;
            s.devproc[s.device.deviceName] = name;
            api.conf.save();
            api.conf.update();
            api.event.settings();
            api.settings.sync.put();
        };

    if (name) {
        saveAs(name);
    } else {
        api.uc.prompt("Save Settings As", cp ? lp || def : def).then(saveAs);
    }
}

function settings_load() {
    api.conf.show();
}

function update_platform_size() {
    api.conf.update();
    api.platform.update_size();
    api.platform.update_origin();
}

export const settingsOps = {
    export_device,
    export_objects,
    export_profile,
    new_workspace,
    settings_save,
    settings_load,
    update_device: update_platform_size,
};
