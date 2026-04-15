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
        speedIndex = api.local.getInt('cam.anim.speed') ?? 1;
        if (speedIndex < 0 || speedIndex >= speedValues.length) speedIndex = 1;
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
        color = settings.controller.dark ? 0x48607B : 0x607FA4;
        unitScale = settings.controller.units === 'in' ? 1/25.4 : 1;
        let flatShading = true,
            transparent = true,
            opacity = 0.9,
            side = THREE.DoubleSide;
        material = new THREE.MeshPhongMaterial({
            flatShading,
            transparent,
            opacity,
            color,
            side
        });
        add_red_neg_z(material);
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
        }
    }
    space.world.add(mesh);
    meshes[id] = mesh;
}

function meshUpdates(id) {
    const mesh = meshes[id];
    if (!mesh) {
        return; // animate cancelled
    }
    mesh.geometry.attributes.position.needsUpdate = true;
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
        pause: speedPauses[speedIndex]
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
        pause: speedPauses[speedIndex]
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
