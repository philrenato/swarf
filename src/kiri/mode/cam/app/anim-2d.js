/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

// UI FRONT END ANIMATION CODE for 2D

import { api } from '../../../app/api.js';
import { space } from '../../../../moto/space.js';

const { client } = api;

const asLines = false;
const asPoints = false;

let meshes = {},
    button = {},
    label = {},
    unitScale = 1,
    // swarf r6: more speed options (Phil markup)
    speedValues = [ 0.5, 1, 2, 4, 8, 16, 32 ],
    speedPauses = [  40, 30, 20, 10, 5,  2,  0 ],
    speedNames  = [ "½×","1×","2×","4×","8×","16×","!!" ],
    speedMax = speedValues.length - 1,
    speedIndex = 0,
    speed,
    color = 0,
    material,
    origin,
    posOffset = { x:0, y:0, z:0 };

export function animate_clear(api) {
    let { anim } = api.ui;
    space.platform.showGridBelow(true);
    client.animate_cleanup();
    Object.keys(meshes).forEach(id => deleteMesh(id));
    toggleStock(undefined,true,false);
    api.uc.setVisible(anim.laba, false);
    api.uc.setVisible(anim.vala, false);
}

export function animate(api, delay) {
    console.log('[swarf anim-2d] animate() called');
    api.show.busy("building animation");
    let settings = api.conf.get();
    // swarf r12: add a thin skin of material around the part for the
    // simulation mesh so the tool visibly cuts through something.
    // Skin thickness = tool diameter (just enough to see the cut).
    // Toolpaths themselves assume zero padding (cutout mode).
    try {
        const proc = settings.process;
        const w = api.widgets.all()[0];
        const bb = w && w.getBoundingBox();
        if (bb && settings.stock) {
            // find the active tool diameter
            let toolDiam = 6.35; // fallback 1/4"
            const ops = proc.ops || [];
            const firstOp = ops.find(o => o && o.type && o.type !== '|');
            if (firstOp && firstOp.tool) {
                const tool = (settings.tools || []).find(t => t.id === firstOp.tool || t.number === firstOp.tool);
                if (tool) {
                    toolDiam = tool.metric
                        ? (tool.flute_diam || tool.shaft_diam || 6.35)
                        : (tool.flute_diam || tool.shaft_diam || 0.25) * 25.4;
                }
            }
            // skin = tool radius per side so the tool at the part outline
            // cuts exactly to the outer wall of the stock
            const skin = toolDiam; // radius per side × 2 sides = diameter total per axis
            settings.stock.x = Math.max(settings.stock.x, bb.dim.x + skin);
            settings.stock.y = Math.max(settings.stock.y, bb.dim.y + skin);
            settings.stock.z = Math.max(settings.stock.z, bb.dim.z + toolDiam * 0.5);
        }
    } catch (e) {}
    let sawMeshAdd = false;
    client.animate_setup(settings, data => {
        try {
            console.log('[swarf anim-2d] animate_setup callback', {
                hasData: !!data,
                keys: data ? Object.keys(data) : null
            });
        } catch (e) {}
        try { checkMeshCommands(data); } catch (e) { console.error('[swarf anim-2d] checkMeshCommands threw', e); }
        if (!(data && data.mesh_add)) {
            if (!sawMeshAdd) {
                console.warn('[swarf anim-2d] callback fired without mesh_add — animation cannot start', data);
            }
            return;
        }
        sawMeshAdd = true;
        console.log('[swarf anim-2d] mesh_add received, setting up UI');

        let { anim } = api.ui;
        Object.assign(button, {
            replay: anim.replay,
            play: anim.play,
            step: anim.step,
            pause: anim.pause,
            speed: anim.speed,
            trans: anim.trans,
            model: anim.model,
            shade: anim.shade
        });
        Object.assign(label, {
            progress: anim.progress,
            speed: anim.labspd,
            x: anim.valx,
            y: anim.valy,
            z: anim.valz,
        });

        origin = settings.origin;
        // swarf r6: default to 1× (index 1) — index 0 is now ½× which is
        // surprisingly slow for first-time users
        // swarf v010 r6: default speed is 1× (not 0.5×). speedValues[1] = 1.
        const stored = api.local.getInt('cam.anim.speed');
        speedIndex = (stored == null || stored < 0 || stored >= speedValues.length) ? 1 : stored;
        updateSpeed();
        // swarf r6: auto-play when SIMULATE fires. Upstream just runs ONE
        // step and waits for the user to click play — confusing because
        // clicking SIMULATE should make the simulation run. play({}) gives
        // Infinity steps and chips fly.
        setTimeout(() => play({}), delay || 0);

        button.replay.onclick = replay;
        button.play.onclick = play;
        button.step.onclick = step;
        button.pause.onclick = pause;
        button.speed.onclick = fast;
        button.trans.onclick = toggleTrans;
        button.model.onclick = toggleModel;
        button.shade.onclick = toggleStock;
        button.play.style.display = '';
        button.pause.style.display = 'none';

        api.event.emit('animate', 'CAM');
        api.show.busy(false);
        space.platform.showGridBelow(false);
        toggleTrans(0,api.local.getBoolean('cam.anim.trans', true));
        toggleModel(0,api.local.getBoolean('cam.anim.model', false));
        toggleStock(0,api.local.getBoolean('cam.anim.stock', false));
    });
}

Object.assign(client, {
    animate(data, ondone) {
        client.send("animate", data, ondone);
    },

    animate_setup(settings, ondone) {
        unitScale = settings.controller.units === 'in' ? 1/25.4 : 1;
        // swarf r7: stock mesh uses the CURRENT swarf material (PBR) so the
        // block being cut looks like the chips, not Kiri's default blue.
        const sm = window.__swarfMaterial;
        const a = sm && sm.appearance;
        const side = THREE.DoubleSide;
        if (a) {
            material = a.physical && THREE.MeshPhysicalMaterial
                ? new THREE.MeshPhysicalMaterial({ color: a.color, side })
                : new THREE.MeshStandardMaterial({ color: a.color, side });
            if (window.__swarfApplyAppearance) window.__swarfApplyAppearance(material, a);
            color = new THREE.Color(a.color).getHex();
        } else {
            color = settings.controller.dark ? 0x48607B : 0x607FA4;
            material = new THREE.MeshPhongMaterial({
                flatShading: true,
                transparent: true,
                opacity: 0.9,
                color,
                side,
            });
        }
        add_red_neg_z(material);
        // expose so swarf-material.js can re-tint live on material switch
        window.__swarfAnimStockMaterial = material;
        // swarf v010 r6: compute lightstream ribbon width from stepover × tool Ø
        // × 0.5 (world units/mm). Phil: wide stepover → wider ribbon.
        try {
            const ops = (settings.process && settings.process.ops) || [];
            const tools = settings.tools || [];
            let bestDia = 0, bestStep = 0;
            for (const op of ops) {
                const t = tools.find(tt => tt.id === op.tool) || tools[0];
                if (!t) continue;
                const dia = (t.flute_diam || t.fluteDiameter || t.dia || 3.175);
                const step = (op.step || op.stepover || settings.process.camContourOver || 0.4);
                if (dia * step > bestDia * bestStep) { bestDia = dia; bestStep = step; }
            }
            if (!bestDia) bestDia = 3.175;
            if (!bestStep) bestStep = 0.4;
            // swarf v010 r8 c: ribbon width now tracks tool DIAMETER, not
            // stepover distance. Stepover for prosumer endmills is 0.2–0.8mm
            // — rendering that in world units gives a 1-px wire, not a
            // ribbon. Tool-Ø × 0.9 gives the actual material-cut band that
            // the tool leaves behind.
            window.__swarfRibbonWidth = Math.max(2.5, bestDia * 0.9);
        } catch (e) { window.__swarfRibbonWidth = 0.8; }
        client.send("animate_setup", {settings}, ondone);
    },

    animate_cleanup(data, ondone) {
        client.send("animate_cleanup", data, ondone);
    }
});

function meshAdd(id, ind, pos, sab) {
    const geo = new THREE.BufferGeometry();
    if (sab) {
        // use array buffer shared with worker
        pos = new Float32Array(sab);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (ind.length) {
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(ind), 1));
    }
    let mesh;
    if (asPoints) {
        const mat = new THREE.PointsMaterial({
            transparent: true,
            opacity: 0.75,
            color: 0x888888,
            size: 0.3
        });
        mesh = new THREE.Points(geo, mat);
    } else if (asLines) {
        const mat = new THREE.LineBasicMaterial({
            transparent: true,
            opacity: 0.75,
            color
        });
        mesh = new THREE.LineSegments(geo, mat);
    } else {
        geo.computeVertexNormals();
        // swarf r6: tool meshes (id != 0) get a fluted mill-style material
        // so the cutter doesn't read as a plain cylinder. Stock grid (id=0)
        // keeps Kiri's translucent material.
        if (id !== 0) {
            // swarf r6: tool is ALWAYS metallic silver — never tinted by the
            // stock material. PBR (MeshStandardMaterial) so it reads as real
            // brushed steel under any light/sky color.
            const fluteTex = window.__swarfGetFluteTexture && window.__swarfGetFluteTexture();
            const toolMat = new THREE.MeshStandardMaterial({
                color:     0xd4d8de,
                emissive:  0x161820,
                roughness: 0.28,
                metalness: 0.92,
                map:       fluteTex || null,
                flatShading: false,
                side:      THREE.DoubleSide,
            });
            try { geo.computeBoundingBox(); } catch (e) {}
            mesh = new THREE.Mesh(geo, toolMat);
            mesh.renderOrder = 1;
            // expose so swarf-spin.js can rotate it during sim
            window.__swarfToolMeshes = window.__swarfToolMeshes || [];
            window.__swarfToolMeshes.push(mesh);
        } else {
            mesh = new THREE.Mesh(geo, material);
            mesh.renderOrder = -10;
            // swarf v010 r4: generate box-projection UVs on the stock mesh so
            // the material's brushed/grain/foam/scratch texture actually shows
            // up. Kiri's stock geometry ships without UVs because upstream
            // never intended the stock to be textured.
            try { buildStockUVs(geo); } catch (e) {}
        }
    }
    space.world.add(mesh);
    meshes[id] = mesh;
}

// swarf v010 r4: triplanar-ish UV projection based on vertex normal. Picks
// whichever cardinal plane the face points along and uses its world-space
// coordinates. Scale: 1 UV = 80mm, so default textureRepeat ~6 reads at
// approx the size of real brushing.
function buildStockUVs(geo) {
    const pos = geo.attributes.position;
    if (!pos) return;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const count = pos.count;
    const uvs = new Float32Array(count * 2);
    const SCALE = 1 / 80;
    for (let i = 0; i < count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
        let u, v;
        if (nz >= nx && nz >= ny) { u = x; v = y; }
        else if (nx >= ny)        { u = y; v = z; }
        else                      { u = x; v = z; }
        uvs[i * 2]     = u * SCALE;
        uvs[i * 2 + 1] = v * SCALE;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

function meshUpdates(id) {
    const mesh = meshes[id];
    if (!mesh) {
        return; // animate cancelled
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    // swarf v010 r4: per-frame UV + normal rebuild made the tool lag behind
    // the cut. Initial UVs (built once in meshAdd) stay close enough as the
    // tool carves — slight texture stretch in cut regions is acceptable.
    // Kiri's shader derives surface normals from derivatives, so no recompute
    // is needed for correct specular.
    space.update();
}

function deleteMesh(id) {
    const m = meshes[id];
    space.world.remove(m);
    delete meshes[id];
    // swarf r6: drop deleted tool meshes from the spin registry
    if (m && window.__swarfToolMeshes) {
        const i = window.__swarfToolMeshes.indexOf(m);
        if (i >= 0) window.__swarfToolMeshes.splice(i, 1);
    }
}

function toggleModel(ev,bool) {
    api.local.toggle('cam.anim.model', bool);
    api.widgets.all().forEach(w => w.toggleVisibility(bool));
}

function toggleStock(ev,bool,set) {
    set !== false && api.local.toggle('cam.anim.stock', bool);
    return api.event.emit('cam.stock.toggle', bool ?? undefined);
}

function toggleTrans(ev,bool) {
    bool = api.local.toggle('cam.anim.trans', bool);
    material.transparent = bool;
    material.needsUpdate = true;
}

function step() {
    updateSpeed();
    client.animate({speed, steps: 1}, handleGridUpdate);
}

function play(opts) {
    const { steps } = opts;
    updateSpeed();
    if (steps !== 1) {
        button.play.style.display = 'none';
        button.pause.style.display = '';
    }
    client.animate({
        speed,
        steps: steps || Infinity,
        pause: pauseFor(speed)
    }, handleGridUpdate);
}

function fast(opts) {
    const { steps } = opts;
    updateSpeed(1);
    button.play.style.display = 'none';
    button.pause.style.display = '';
    client.animate({
        speed,
        steps: steps || Infinity,
        pause: pauseFor(speed)
    }, handleGridUpdate);
}

function pause() {
    button.play.style.display = '';
    button.pause.style.display = 'none';
    client.animate({speed: 0}, handleGridUpdate);
}

function handleGridUpdate(data) {
    checkMeshCommands(data);
    if (data && data.progress) {
        label.progress.value = (data.progress * 100).toFixed(1);
    }
}

// swarf v010 r6: derive ms-pause from any speed multiplier (incl. user
// custom values outside the built-in cycle). 30 ms ≈ 1× baseline. Min 0.
function pauseFor(mul) {
    if (!Number.isFinite(mul) || mul <= 0) return 30;
    return Math.max(0, Math.round(30 / mul));
}

// swarf v010 r6: when the user sets a custom speed via the sim bar button,
// push the new speed+pause to the worker without waiting for a cycle click.
if (typeof window !== 'undefined') {
    window.addEventListener('swarf.speed.custom', () => {
        try {
            const v = window.__swarfCustomSpeed;
            if (!Number.isFinite(v) || v <= 0) return;
            client.animate({ speed: v, steps: Infinity, pause: pauseFor(v) }, () => {});
        } catch (e) {}
    });
}

function updateSpeed(inc = 0) {
    // swarf r6: any user click on a speed cycle clears any custom override
    if (inc !== 0) window.__swarfCustomSpeed = null;
    if (inc === Infinity) {
        speedIndex = speedMax;
    } else if (inc > 0) {
        speedIndex = (speedIndex + inc) % speedValues.length;
    }
    api.local.set('cam.anim.speed', speedIndex);
    // honor user-typed custom multiplier from the simulate bar
    if (typeof window.__swarfCustomSpeed === 'number' && window.__swarfCustomSpeed > 0) {
        speed = window.__swarfCustomSpeed;
        label.speed.value = `${window.__swarfCustomSpeed}×`;
    } else {
        speed = speedValues[speedIndex];
        label.speed.value = speedNames[speedIndex];
    }
}

function replay() {
    animate_clear(api);
    setTimeout(() => {
        animate(api, 50);
    }, 250);
}

function checkMeshCommands(data) {
    if (!data) {
        return;
    }
    if (data.mesh_add) {
        const { id, ind, pos, offset, sab } = data.mesh_add;
        meshAdd(id, ind, pos, sab);
        space.refresh();
        if (offset) {
            posOffset = offset;
        }
    }
    if (data.mesh_del) {
        deleteMesh(data.mesh_del);
    }
    if (data.mesh_move) {
        const { id, pos } = data.mesh_move;
        const mesh = meshes[id];
        if (mesh) {
            mesh.position.x = pos.x;
            mesh.position.y = pos.y;
            mesh.position.z = pos.z;
            space.update();
        }
        label.x.value = (pos.x - origin.x).toFixed(2);
        label.y.value = (pos.y + origin.y).toFixed(2);
        label.z.value = (pos.z - origin.z).toFixed(2);
        // swarf r6: broadcast tool position for chip physics. In 2D-mode CAM,
        // the tool mesh has POSITIVE id (toolID starts at 2); in 3D-indexed
        // mode it's negative. Stock grid is id=0 and never moves after init,
        // so emit for any non-zero mesh_move.
        if (id !== 0 && id !== undefined) {
            try { api.event.emit('swarf.tool.move', { id, pos }); } catch (e) {}
        }
    }
    if (data.mesh_update) {
        meshUpdates(data.id);
    }
}

// SHADER: tint points below z=0 with red
function add_red_neg_z(material) {
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            `#include <worldpos_vertex>`,
            `
            #include <worldpos_vertex>
            vWorldPosition = vec3(transformed);
            `
        );

        shader.vertexShader = `
            varying vec3 vWorldPosition;
        ` + shader.vertexShader;

        shader.fragmentShader = `
            varying vec3 vWorldPosition;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            `#include <dithering_fragment>`,
            `
            #include <dithering_fragment>
            if (vWorldPosition.z < 0.0) {
                gl_FragColor.rgb += vec3(0.5, 0.0, 0.0); // Add red tint
            }
            `
        );
    };
    return material;
}
