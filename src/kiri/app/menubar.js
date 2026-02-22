/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $ } from '../../moto/webui.js';

const MENUBAR_HTML = `
    <div class="menubar-appname">Kiri:Moto</div>
    <div class="menubar-separator"></div>
    <div class="f-row top-menu grow">
        <span>
            <label lk="fe_menu">files</label>
            <div class="top-menu-drop top-menu-left">
                <div class="content">
                    <div id="file-new">
                        <label lk="new">new</label>
                        <span><i class="fas fa-file"></i></span>
                    </div>
                    <hr>
                    <div id="file-recent">
                        <label lk="recent">recent</label>
                        <span><i class="fas fa-list"></i></span>
                    </div>
                    <div id="file-import">
                        <label lk="import">import</label>
                        <span><i class="fas fa-file-upload"></i></span>
                        <input id="load-file" type="file" name="loadme" style="display:none" accept=".km,.kmz,.stl,.obj,.svg,.png,.jpg,.jpeg,.gcode,.nc">
                    </div>
                    <hr>
                    <div id="app-export">
                        <label lk="export-ws">export work</label>
                        <span><i class="fas fa-download"></i></span>
                    </div>
                    <hr>
                    <div id="app-quit" class="hide">
                        <label lk="quit">quit</label>
                    </div>
                </div>
            </div>
        </span>
        <span>
            <label lk="vu_menu">view</label>
            <div class="top-menu-drop top-menu-left">
                <div class="content">
                    <div id="view-fit">
                        <label lk="contents">contents</label>
                        <span><i class="fas fa-arrows-to-circle"></i></span>
                    </div>
                    <div id="view-home">
                        <label lk="home">home</label>
                        <span><i class="fas fa-home"></i></span>
                    </div>
                    <div id="view-top">
                        <label lk="top">top</label>
                        <span><i class="fas fa-square"></i></span>
                    </div>
                    <hr>
                    <div id="app-xpnd">
                        <label lk="fullscreen">fullscreen</label>
                        <span><i class="fas fa-maximize"></i></span>
                    </div>
                </div>
            </div>
        </span>
        <span>
            <label lk="al_menu">Align</label>
            <div class="top-menu-drop top-menu-left">
                <div class="content">
                    <div id="context-setfocus">
                        <label lk="focus">focal point</label>
                        <span><i class="fas fa-eye"></i></span>
                    </div>
                    <div id="context-layflat">
                        <label lk="face-down">face down</label>
                        <span><i class="fas fa-home"></i></span>
                    </div>
                    <div id="context-lefty">
                        <label lk="face-left">face left</label>
                        <span><i class="fas fa-maximize"></i></span>
                    </div>
                </div>
            </div>
        </span>
        <span>
            <label lk="re_menu">render</label>
            <div class="top-menu-drop top-menu-left">
                <div class="content">
                    <div id="render-solid">
                        <label xlk="focus">solid</label>
                        <span><i class="fas fa-square"></i></span>
                    </div>
                    <div id="render-wire">
                        <label xlk="face-down">wireframe</label>
                        <span><i class="fas fa-border-all"></i></span>
                    </div>
                    <div id="render-ghost">
                        <label xlk="face-left">transparent</label>
                        <span><i class="fas fa-border-none"></i></span>
                    </div>
                    <hr>
                    <div id="render-edges">
                        <label xlk="face-left">toggle edges</label>
                        <span><i class="fa-regular fa-square"></i></span>
                    </div>
                </div>
            </div>
        </span>
        <span>
            <label lk="sx_menu">selection</label>
            <div class="top-menu-drop top-menu-left">
                <div class="content">
                    <div id="context-mirror">
                        <label xlk="rc_mirr-left">mirror</label>
                        <span><i class="fas fa-arrows-left-right-to-line"></i></span>
                    </div>
                    <div id="context-duplicate">
                        <label xlk="rc_dupl">duplicate</label>
                        <span><i class="fas fa-copy"></i></span>
                    </div>
                    <hr>
                    <div id="mesh-merge">
                        <label xlk="rc_merg">merge meshes</label>
                    </div>
                    <div id="mesh-split">
                        <label xlk="rc_splt-down">isolate meshes</label>
                    </div>
                    <hr>
                    <div id="mesh-export-obj">
                        <label lk="export-obj">save as OBJ</label>
                        <span><i class="fas fa-dice-d20"></i></span>
                    </div>
                    <div id="mesh-export-stl">
                        <label lk="export-stl">save as  STL</label>
                        <span><i class="fas fa-dice-d20"></i></span>
                    </div>
                </div>
            </div>
        </span>
        <div class="menubar-separator"></div>
        <div class="f-row top-menu">
            <span id="tool-nozzle"><i class="fas fa-location-pin" title="extruder"></i>
                <div id="ft-nozzle" class="f-col pop"></div>
            </span>
            <span id="tool-rotate"><i class="fas fa-rotate-right" title="rotate selection"></i>
                <div id="ft-rotate" class="grid pop">
                    <div id="rot_x_lt"><i class="fas fa-chevron-left"></i></div>
                    <label>X</label>
                    <div id="rot_x_gt"><i class="fas fa-chevron-right"></i></div>
                    <input id="rot_x" class="value center" size="6" value="90">
                    <div id="rot_y_lt"><i class="fas fa-chevron-left"></i></div>
                    <label>Y</label>
                    <div id="rot_y_gt"><i class="fas fa-chevron-right"></i></div>
                    <input id="rot_y" class="value center" size="6" value="90">
                    <div id="rot_z_lt"><i class="fas fa-chevron-left"></i></div>
                    <label>Z</label>
                    <div id="rot_z_gt"><i class="fas fa-chevron-right"></i></div>
                    <input id="rot_z" class="value center" size="6" value="90">
                    <div class="buttons f-row">
                        <button id="unrotate" class="grow" lk="reset">reset</button>
                    </div>
                </div>
            </span>
            <span id="tool-scale"><i class="fas fa-expand" title="scale or resize selection"></i>
                <div id="ft-scale" class="grid pop">
                    <div><label>X</label><input id="lock_x" type="checkbox" checked></div>
                    <div><label>Y</label><input id="lock_y" type="checkbox" checked></div>
                    <div><label>Z</label><input id="lock_z" type="checkbox" checked></div>
                    <label id="lab-axis" lk="axis">axis</label>
                    <input id="size_x" size="8" class="value">
                    <input id="size_y" size="8" class="value">
                    <input id="size_z" size="8" class="value">
                    <label id="lab-size" lk="size">size</label>
                    <input id="scale_x" size="8" class="value" value="1">
                    <input id="scale_y" size="8" class="value" value="1">
                    <input id="scale_z" size="8" class="value" value="1">
                    <label id="lab-scale" lk="scale">scale</label>
                    <div class="buttons f-row">
                        <button id="scale-reset" class="grow j-center">reset</button>
                    </div>
                </div>
            </span>
        </div>
        <div class="grow"></div>
        <div class="menubar-mode" id="app-mode"></div>
        <div class="menubar-separator"></div>
        <span class="menu-right">
            <label lk="mo_menu">mode</label>
            <div class="top-menu-drop top-menu-right">
                <div class="content">
                    <div id="mode-fdm">
                        <label title="3D Additive Printing Processes">FDM</label>
                        <span><i class="fas fa-layer-group"></i></span>
                    </div>
                    <div id="mode-cam">
                        <label title="CNC Mills and Subtractive Processes">CNC</label>
                        <span><i class="fas fa-bore-hole"></i></span>
                    </div>
                    <div id="mode-sla">
                        <label title="mSLA Resin Printing">SLA</label>
                        <span><i class="fas fa-cube"></i></span>
                    </div>
                    <hr>
                    <div id="mode-laser">
                        <label title="Laser Cutting and Engraving">Laser</label>
                        <span><i class="fas fa-bolt"></i></span>
                    </div>
                    <div id="mode-wjet">
                        <label title="WaterJet Cutting">Water</label>
                        <span><i class="fas fa-location-pin"></i></span>
                    </div>
                    <div id="mode-wedm">
                        <label title="Wire EDM Cutting">Wire</label>
                        <span><i class="fas fa-ellipsis-vertical"></i></span>
                    </div>
                    <div id="mode-drag">
                        <label title="Drag Knife Cutting">Drag</label>
                        <span><i class="fas fa-caret-left"></i></span>
                    </div>
                </div>
            </div>
        </span>
        <span class="menu-right">
            <label lk="info">info</label>
            <div class="top-menu-drop top-menu-right">
                <div class="content">
                    <div id="app-help">
                        <label lk="help">help</label>
                    </div>
                    <div id="app-don8">
                        <label lk="donate">donate</label>
                    </div>
                    <hr>
                    <div>
                        <label id="app-info">version</label>
                    </div>
                </div>
            </div>
        </span>
        <span class="menu-right">
            <label lk="su_menu">setup</label>
            <div class="top-menu-drop top-menu-right">
                <div class="content">
                    <div id="set-device">
                        <label lk="machines">machines</label>
                        <span><i class="fas fa-cube"></i></span>
                    </div>
                    <div id="set-profs">
                        <label lk="profs">profiles</label>
                        <span><i class="fas fa-sliders-h"></i></span>
                    </div>
                    <div id="set-tools">
                        <label lk="tools">tools</label>
                        <span><i class="fas fa-tools"></i></span>
                    </div>
                    <div id="set-prefs">
                        <label lk="prefs">prefs</label>
                        <span><i class="fa-solid fa-square-check"></i></span>
                    </div>
                    <hr>
                    <div id="install">
                        <label lk="install">install</label>
                    </div>
                    <div id="uninstall" class="hide">
                        <label lk="uninstall">uninstall</label>
                    </div>
                </div>
            </div>
        </span>
        <span class="menu-right">
            <i class="fas fa-language"></i>
            <div class="top-menu-drop top-menu-right">
                <div class="content">
                    <div><label id="lset-zh">简体中文</label></div>
                    <div><label id="lset-da">dansk</label></div>
                    <div><label id="lset-de">deutsch</label></div>
                    <div><label id="lset-en">english</label></div>
                    <div><label id="lset-es">español</label></div>
                    <div><label id="lset-fr">français</label></div>
                    <div><label id="lset-pl" class="nocap">polski</label></div>
                    <div><label id="lset-pt">português</label></div>
                </div>
            </div>
        </span>
    </div>
`;

export const menubar = {
    build() {
        const node = $('menubar');
        if (!node) {
            return;
        }
        node.innerHTML = MENUBAR_HTML;
    }
};
