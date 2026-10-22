/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { occluder } from '../../moto/occlude.js';

/*
 * converts `layers.js` output data structures into three.js meshes for display
 */

// merged layer geometry is split into bands so that buried ones can be culled
// independently. more bands means finer culling but more draw calls
const MAX_CHUNKS = 12;
// don't split below this many vertices/indices per band
const MIN_CHUNK_DRAWS = 60000;
// below this a band is cheaper to just draw than to test
const MIN_CULL_DRAWS = 20000;
export class Stack {
    constructor(view, freeMem, shiny) {
        this._view = view;
        this.view = view.newGroup();
        this.slices = [];
        this.meshes = [];
        this.freeMem = freeMem;
        // every layer of every slice used to allocate its own material even when
        // the parameters were identical. that defeats three's material/program
        // sort, so each of the hundreds of draw calls paid a full setProgram +
        // uniform refresh. cache per stack so identical layers share one material.
        this.matCache = new Map();
        newMat = shiny ? createPhongMaterial : createLambertMaterial;
    }

    size() {
        return this.slices.length;
    }

    hide() {
        this.view.visible = false;
    }

    show() {
        this.view.visible = true;
    }

    rotate(set) {
        this.view.rotation.x = -set.angle * (Math.PI/180);
        this.view.position.y = -set.dy;
        this.view.position.z = -set.dz;
    }

    destroy() {
        if (!this.view) return;
        occluder.removeUnder(this.view);
        this._view.remove(this.view);
        THREE.dispose(this.view);
        // shared materials are owned by the stack, so they have to go with it
        for (const mat of this.matCache.values()) mat.dispose();
        this.matCache.clear();
        this.view = this.slices = this.meshes = null;
    }

    setFreeMem(bool) {
        this.freeMem = bool;
    }

    setVisible(newMin, newMax) {
        this.show();
        for (let i=0, s=this.slices, len=s.length; i<len; i++) {
            s[i].visible = i >= newMin && i <= newMax;
            if (s[i].visible) this.lastVis = s[i];
        }
        this.visMin = newMin;
        this.visMax = newMax;
        this.applyMergedRange(1);
    }

    setLastFraction(frac = 1) {
        if (this.lastVis)
        for (let mesh of this.lastVis.children) {
            let geo = mesh.geometry;
            let pos = geo.attributes.position;
            let len = frac === 1 ? Infinity : Math.round(pos.count * frac);
            geo.setDrawRange(0, len);
        }
        this.applyMergedRange(frac);
    }

    /**
     * translates the visible slice range into a draw range on each merged
     * geometry. slices were concatenated in order, so any contiguous run of
     * them is a contiguous run of vertices (or indices).
     */
    applyMergedRange(frac = 1) {
        const merged = this.merged;
        if (!merged) return;
        const last = this.slices.length - 1;
        const lo = Math.max(0, Math.min(last, this.visMin ?? 0));
        const hi = Math.max(lo, Math.min(last, this.visMax ?? last));
        for (const b of merged) {
            const start = b.startAt[lo];
            let end = b.endAt[hi];
            if (frac !== 1) {
                // taper off inside the topmost visible slice
                const from = b.startAt[hi];
                end = from + Math.round((end - from) * frac);
                // never leave a partial triangle or line segment
                end -= (end - start) % b.stride;
            }
            for (const c of b.chunks) {
                // clip the stack-wide draw range against this chunk's slot
                const cs = Math.max(start, c.base);
                const ce = Math.min(end, c.base + c.count);
                const on = ce > cs;
                c.mesh.geometry.setDrawRange(cs - c.base, on ? ce - cs : 0);
                if (c.occ) {
                    occluder.setWanted(c.occ, on);
                } else {
                    c.mesh.visible = on;
                }
            }
        }
    }

    /**
     * Collapses the per-slice meshes into one mesh per material. Each slice
     * used to cost its own draw call, and at ~3us of driver overhead apiece a
     * few hundred layers alone blow the frame budget -- with the geometry
     * itself accounting for almost none of it. Call once, after every layer of
     * the stack has been added.
     */
    compact() {
        if (this.merged || !this.view) return;

        // group by everything that has to match for a single draw call
        const buckets = new Map();
        for (let i=0, sl=this.slices; i<sl.length; i++) {
            for (const obj of sl[i].children) {
                const geo = obj.geometry;
                const mat = obj.material;
                // instanced fat lines and multi-color layers keep their own
                // draw calls -- neither concatenates cleanly
                if (geo.isLineSegmentsGeometry) continue;
                if (Array.isArray(mat) && mat.length !== 1) continue;
                if (geo.groups.length > 1) continue;
                if (!geo.attributes.position) continue;
                const single = Array.isArray(mat) ? mat[0] : mat;
                const norms = !!geo.attributes.normal;
                const key = `${single.id}|${obj.type}|${norms}|${obj.renderOrder}`;
                let b = buckets.get(key);
                if (!b) buckets.set(key, b = {
                    mat: single,
                    line: obj.type === 'LineSegments',
                    order: obj.renderOrder,
                    norms,
                    items: []
                });
                b.items.push({ slice: i, obj });
            }
        }

        const merged = [];
        for (const b of buckets.values()) {
            // nothing gained by merging a single mesh
            if (b.items.length < 2) continue;
            merged.push(this.mergeBucket(b));
        }
        if (!merged.length) return;

        // drop slice groups that no longer hold anything -- three walks every
        // node in the graph on every frame, empty or not
        for (const group of this.slices) {
            if (group.children.length === 0) this.view.remove(group);
        }

        this.merged = merged;
        this.meshes = merged.flatMap(b => b.chunks.map(c => c.mesh))
            .concat(this.slices.flatMap(g => g.children));
        this.applyMergedRange(1);
    }

    mergeBucket(b) {
        const { items } = b;
        let vTotal = 0, iTotal = 0, indexed = false;
        for (const { obj } of items) {
            const geo = obj.geometry;
            vTotal += geo.attributes.position.count;
            iTotal += geo.index ? geo.index.count : geo.attributes.position.count;
            indexed ||= !!geo.index;
        }

        const position = new Float32Array(vTotal * 3);
        const normal = b.norms ? new Float32Array(vTotal * 3) : null;
        const index = indexed
            ? new (vTotal > 65535 ? Uint32Array : Uint16Array)(iTotal)
            : null;

        // draw offset at the start of / just past each slice, so a visible
        // slice range maps to a draw range with no searching
        const slices = this.slices.length;
        const startAt = new Uint32Array(slices + 1);
        const endAt = new Uint32Array(slices + 1);

        const IDENTITY = new THREE.Matrix4();
        const nmat = new THREE.Matrix3();
        const vec = new THREE.Vector3();
        let vOff = 0, iOff = 0, next = 0;

        for (const { slice, obj } of items) {
            // slices between this one and the last contributor are empty here
            for (; next <= slice; next++) {
                startAt[next] = endAt[next] = indexed ? iOff : vOff;
            }
            const geo = obj.geometry;
            const pos = geo.attributes.position;
            const nrm = geo.attributes.normal;
            const count = pos.count;
            const identity = obj.matrix.equals(IDENTITY);

            if (identity) {
                position.set(pos.array.subarray(0, count * 3), vOff * 3);
            } else {
                for (let i=0; i<count; i++) {
                    vec.fromBufferAttribute(pos, i).applyMatrix4(obj.matrix);
                    vec.toArray(position, (vOff + i) * 3);
                }
            }
            if (normal && nrm) {
                if (identity) {
                    normal.set(nrm.array.subarray(0, count * 3), vOff * 3);
                } else {
                    nmat.getNormalMatrix(obj.matrix);
                    for (let i=0; i<count; i++) {
                        vec.fromBufferAttribute(nrm, i).applyMatrix3(nmat).normalize();
                        vec.toArray(normal, (vOff + i) * 3);
                    }
                }
            }
            if (index) {
                const src = geo.index;
                if (src) {
                    for (let i=0, il=src.count; i<il; i++) {
                        index[iOff + i] = src.array[i] + vOff;
                    }
                    iOff += src.count;
                } else {
                    for (let i=0; i<count; i++) {
                        index[iOff + i] = vOff + i;
                    }
                    iOff += count;
                }
            }
            vOff += count;
            endAt[slice] = indexed ? iOff : vOff;

            // release the source now so both copies aren't resident at once
            obj.parent?.remove(obj);
            geo.dispose();
        }
        for (; next <= slices; next++) {
            startAt[next] = endAt[next] = indexed ? iOff : vOff;
        }

        // one mesh for the whole bucket would be a single draw call, but it
        // would also be a single all-or-nothing unit for occlusion culling.
        // splitting it into bands of layers lets the buried ones drop out.
        const total = indexed ? iOff : vOff;
        const bands = Math.max(1, Math.min(MAX_CHUNKS,
            Math.ceil(total / MIN_CHUNK_DRAWS)));
        const perBand = Math.ceil(slices / bands);
        const chunks = [];

        for (let first = 0; first < slices; first += perBand) {
            const last = Math.min(slices - 1, first + perBand - 1);
            const base = startAt[first];
            const count = endAt[last] - base;
            if (count <= 0) continue;
            chunks.push(this.makeChunk(b, {
                position, normal, index, indexed,
                base, count, first, last,
                // vertex span backing this band, needed for the attribute views
                vFrom: indexed ? null : base,
                vTo: indexed ? null : base + count
            }));
        }

        return { chunks, startAt, endAt, stride: b.line ? 2 : 3 };
    }

    /**
     * Builds one band of a merged bucket. The attributes are views onto the
     * bucket's arrays rather than copies, so the extra meshes cost nothing in
     * memory and three still uploads one GPU buffer per band.
     */
    makeChunk(b, spec) {
        const { position, normal, index, indexed, base, count, first, last } = spec;

        const geo = new THREE.BufferGeometry();
        let vFrom, vTo;
        if (indexed) {
            // find the vertex span this band's indices refer to
            vFrom = Infinity; vTo = 0;
            for (let i = base; i < base + count; i++) {
                const v = index[i];
                if (v < vFrom) vFrom = v;
                if (v >= vTo) vTo = v + 1;
            }
            if (!(vFrom < vTo)) { vFrom = 0; vTo = 0; }
            const idx = index.subarray(base, base + count);
            // rebase onto the band's own vertex window. bands never overlap so
            // rewriting in place is safe
            for (let i = 0; i < idx.length; i++) idx[i] -= vFrom;
            geo.setIndex(new THREE.BufferAttribute(idx, 1));
        } else {
            vFrom = base;
            vTo = base + count;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(
            position.subarray(vFrom * 3, vTo * 3), 3));
        if (normal) geo.setAttribute('normal', new THREE.BufferAttribute(
            normal.subarray(vFrom * 3, vTo * 3), 3));

        const mesh = b.line ?
            new THREE.LineSegments(geo, b.mat) :
            new THREE.Mesh(geo, b.mat);
        if (b.order !== undefined) mesh.renderOrder = b.order;
        // three sorts opaque objects by their origin, so an origin at the band's
        // own center is what lets it be drawn front to back with its neighbours
        geo.computeBoundingBox();
        const center = geo.boundingBox.getCenter(new THREE.Vector3());
        const pos = geo.attributes.position.array;
        for (let i = 0; i < pos.length; i += 3) {
            pos[i] -= center.x;
            pos[i + 1] -= center.y;
            pos[i + 2] -= center.z;
        }
        geo.boundingBox.min.sub(center);
        geo.boundingBox.max.sub(center);
        mesh.position.copy(center);
        freeze(mesh);
        this.view.add(mesh);

        const chunk = { mesh, base, count, first, last };
        // only worth probing bands heavy enough to pay for the extra draw
        if (count >= MIN_CULL_DRAWS) {
            chunk.occ = occluder.add(mesh, this.view);
        }
        return chunk;
    }

    addLayers(layers) {
        // each slice gets a group so the slice can be toggled efficiently
        let group = this.view.newGroup();
        // slice groups are never transformed after creation. leaving three's
        // per-frame matrix recompose on costs a compose + multiply per group
        // per frame, which adds up fast across hundreds of slices
        group.matrixAutoUpdate = false;
        this.slices.push(group);
        let map = this.renderLayers(layers, group);
        // by default release memory after layers are rendered
        if (this.freeMem) {
            layers.init();
        }
        // return map of layers to materials (so they can be toggled on/off)
        return map;
    }

    renderLayers(layers, group) {
        const map = {}
        for (const [label, layer] of Object.entries(layers.layers)) {
            map[label] = this.renderLayer(layer, group, label);
        }
        return map;
    }

    /**
     * returns a material shared by every slice that renders the same label with
     * the same parameters. keyed on label so that toggling one layer type never
     * hides another that happens to use the same color.
     */
    shared(label, kind, color, make) {
        const key = `${label}|${kind}|${color.line}|${color.face}|` +
            `${color.opacity}|${color.lopacity}|${color.fat}`;
        let mat = this.matCache.get(key);
        if (!mat) {
            this.matCache.set(key, mat = make());
        }
        return mat;
    }

    renderLayer(layer, group, label) {
        // appends line-segment pairs directly as flat x,y,z triples. building
        // THREE.Vector3 objects here allocated two objects per segment and then
        // threw them all away in setFromPoints/setPositions
        function addPoly(vertices, poly) {
            let points = poly.points, len;
            if (poly.id) {
                // unroll native polys into a flat point list
                const src = points;
                len = src.length * 3;
                points = new Float32Array(len);
                for (let i=0, j=0; j<len; i++) {
                    const p = src[i];
                    points[j++] = p.x;
                    points[j++] = p.y;
                    points[j++] = p.z;
                }
            } else {
                len = points.length;
            }
            for (let i=3; i<len; i += 3) {
                vertices.push(
                    points[i-3], points[i-2], points[i-1],
                    points[i+0], points[i+1], points[i+2]
                );
            }
            if (!poly.open) {
                vertices.push(
                    points[0], points[1], points[2],
                    points[len-3], points[len-2], points[len-1]
                );
            }
        }

        const { polys, lines, faces, cface, paths, cpath } = layer;
        const { color, off, norms, rotation, position } = layer;
        const { fat, order, opacity } = color;
        const meshes = [];
        const defstate = !off;
        const mats = [];
        mats.state = defstate;

        if (polys.length || lines.length) {
            const vert = []; // flat x,y,z triples
            const mat = []; // materials
            const grp = []; // material groups
            const geo = fat ? new THREE.LineSegmentsGeometry() : new THREE.BufferGeometry();
            // map all the poly and line colors for re-use
            const cmap = {}
            let cidx = 0;
            let last = undefined;
            for (let i=0, il=polys.length; i<il; i++) {
                const vl = vert.length / 3; // group offsets are in vertices
                const poly = polys[i];
                addPoly(vert, poly);
                const pc = poly.color !== undefined ? { line: poly.color, opacity } : color;
                const pk = pc.line;
                let cc = cmap[pk];
                if (!cc) {
                    cc = cmap[pk] = { idx: cidx++ };
                    mat.push(this.shared(label, 'line', pc, () => createLineMaterial(pc)));
                }
                if (last !== pk) {
                    if (grp.length) {
                        // rewrite counts for last group
                        const prev = grp[grp.length - 1]
                        prev[1] = vl;
                    }
                    grp.push([vl, Infinity, cc.idx]);
                    last = pk;
                }
            }
            // for now, line segments inherit the last color
            for (let i=0, il=lines.length; i<il; i += 3) {
                vert.push(lines[i], lines[i+1], lines[i+2]);
            }
            // ensure at least one group using the default color settings
            if (grp.length === 0) {
                grp.push([0, Infinity, 0]);
                mat.push(this.shared(label, 'line', color, () => createLineMaterial(color)));
            }
            mat.forEach(m => m.visible = defstate);
            for (let i=0; i<grp.length; i++) {
                const g = grp[i];
                geo.addGroup(g[0], g[1], g[2]);
            }
            if (fat) {
                // LineSegmentsGeometry does not support setFromPoints()
                geo.setPositions(vert);
            } else {
                geo.setAttribute('position', new THREE.Float32BufferAttribute(vert, 3));
            }
            // LineSegments2 does not support multiple materials
            const segs = fat ?
                new THREE.LineSegments2(geo, mat[0]) :
                new THREE.LineSegments(geo, mat);
            if (rotation) segs.rotation.set(rotation.x, rotation.y, rotation.z);
            if (position) segs.position.set(position.x, position.y, position.z);
            if (order !== undefined) segs.renderOrder = order;
            freeze(segs);
            meshes.push(segs);
            group.add(segs);
            mats.appendAll(mat);
        }
        if (faces.length) {
            const mat = [];
            if (cface) {
                cface.forEach(c => { mat.push(this.shared(label, 'face', c, () => newMat(c, true))) });
            } else {
                mat.push(this.shared(label, 'face', color, () => newMat(color, true)));
            }
            mat.forEach(m => m.visible = defstate);
            const geo = new THREE.BufferGeometry();
            if (faces.toFloat32) {
                geo.setAttribute('position', new THREE.BufferAttribute(faces.toFloat32(), 3));
            } else {
                geo.setAttribute('position', new THREE.BufferAttribute(faces, 3));
            }
            if (norms) {
                geo.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
            } else {
                geo.computeVertexNormals();
            }
            if (cface) {
                cface.forEach((c, i) => geo.addGroup(c.start, c.count, i));
            } else {
                geo.addGroup(0, Infinity, 0);
            }
            const mesh = new THREE.Mesh(geo, mat);
            if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
            if (position) mesh.position.set(position.x, position.y, position.z);
            freeze(mesh);
            meshes.push(mesh);
            group.add(mesh);
            mats.appendAll(mat);
        }
        if (paths) {
            const mat = [];
            if (cpath) {
                cpath.forEach(c => { mat.push(this.shared(label, 'path', c, () => newMat(c))) });
            } else {
                mat.push(this.shared(label, 'path', color, () => newMat(color)));
            }
            mat.forEach(m => m.visible = defstate);
            const { index, faces, norms, z } = paths;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(faces, 3));
            if (index && index.length) {
                geo.setIndex(index);
            }
            if (norms) {
                geo.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
            } else {
                geo.computeVertexNormals();
            }
            if (cpath) {
                cpath.forEach((c, i) => geo.addGroup(c.start, c.count, i));
            } else {
                geo.addGroup(0, Infinity, 0);
            }
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.z = z;
            if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
            if (position) mesh.position.set(position.x, position.y, position.z);
            freeze(mesh);
            meshes.push(mesh);
            group.add(mesh);
            mats.appendAll(mat);
        }

        this.new_meshes = meshes;
        this.meshes.appendAll(meshes);
        mats.forEach(mat => mat.visible = defstate);
        return mats;
    }
}

/**
 * layer meshes are positioned once and never move again. computing their local
 * matrix on every frame is pure overhead, so compose it now and opt out.
 */
function freeze(obj) {
    obj.updateMatrix();
    obj.matrixAutoUpdate = false;
}

let shininess = 15,
    specular = 0x444444,
    emissive = 0x101010,
    metalness = 0,
    roughness = 0.3,
    newMat = createPhongMaterial;

function createLineMaterial(color, array) {
    const opacity = color.lopacity || color.opacity || 1;
    const mat = color.fat ? new THREE.LineMaterial({
        // transparent: true,
        // opacity: opacity,
        color: color.line,
        linewidth: color.fat,
        alphaToCoverage: false
    }) : new THREE.LineBasicMaterial({
        // flagging a fully opaque material transparent moves it into the
        // back-to-front pass, which defeats early depth rejection and blends
        // every fragment for no visual difference at alpha 1
        transparent: opacity < 1,
        opacity: opacity,
        color: color.line
    });
    if (array) {
        array.push(mat);
    }
    return mat;
}

// `color.opacity` is frequently undefined, and `undefined != 1` marked those
// materials transparent even though they render fully opaque. that pushed the
// whole layer stack into the blended, back-to-front pass
function alpha(color) {
    return color.opacity || 1;
}

function createStandardMaterial(color, flat) {
    return new THREE.MeshMatcapMaterial({
        transparent: alpha(color) < 1,
        opacity: alpha(color),
        color: color.face,
        side: flat ? THREE.DoubleSide : THREE.FrontSide
    });
}

function createPhongMaterial(color, flat) {
    return new THREE.MeshPhongMaterial({
        shininess,
        specular,
        transparent: alpha(color) < 1,
        opacity: alpha(color),
        color: color.face,
        side: flat ? THREE.DoubleSide : THREE.FrontSide
    });
}

function createLambertMaterial(color, flat) {
    return new THREE.MeshLambertMaterial({
        transparent: alpha(color) < 1,
        opacity: alpha(color),
        color: color.face,
        side: flat ? THREE.DoubleSide : THREE.FrontSide
    });
}
