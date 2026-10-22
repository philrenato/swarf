import { THREE } from '../ext/three.js';

/**
 * Hardware occlusion culling for large static meshes.
 *
 * A sliced part is mostly geometry you cannot see: every layer's infill sits
 * inside that layer's shells, and the GPU still pays for each of those
 * triangles. Depth testing throws the fragments away but only after the
 * vertices have been transformed and the primitives set up, which is exactly
 * what the frame budget goes on.
 *
 * For each registered mesh this keeps a sibling "probe" -- a bounding box drawn
 * after everything else with color and depth writes off, wrapped in a WebGL2
 * occlusion query. If no sample of the box survives the depth test then nothing
 * inside it could have been visible either, so the real mesh is skipped on the
 * following frames. The probe keeps being drawn, so the mesh comes straight
 * back the moment it is exposed again.
 *
 * Query results are read a frame or two late (never blocking on the GPU), so a
 * fast camera move can briefly show a stale decision. Probes are conservative
 * -- the box is always at least as large as its contents -- so the error is one
 * frame of drawing something that turned out to be hidden, never a frame of
 * missing geometry that should have been drawn.
 */

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

// boxGeometry's extent, used to test whether the camera sits inside a probe
const UNIT_BOX = new THREE.Box3(
    new THREE.Vector3(-0.5, -0.5, -0.5),
    new THREE.Vector3(0.5, 0.5, 0.5));

// draws nothing and disturbs nothing: it exists only to be counted by a query
const probeMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide
});

// probes must run after the geometry that occludes them
const PROBE_ORDER = 1000;

// how many consecutive hidden results before a mesh is actually skipped. one
// frame of hysteresis keeps a grazing camera from flickering the geometry
const HIDE_AFTER = 2;

// probes for never-yet-occluded geometry only run on one frame in this many,
// spread across meshes. must be a power of two
const PROBE_EVERY = 4;

export class Occluder {
    constructor() {
        this.entries = [];
        this.enabled = true;
        this.gl = null;
        this.target = null;
        this.stats = { tracked: 0, culled: 0 };
        this.frame = 0;
        this._box = new THREE.Box3();
        this._point = new THREE.Vector3();
    }

    /**
     * Binds to a renderer's context. WebGL1 has no occlusion queries, in which
     * case this stays inert and every mesh simply renders as before.
     */
    attach(renderer) {
        const gl = renderer.getContext();
        if (!gl || typeof gl.createQuery !== 'function') {
            this.enabled = false;
            return false;
        }
        this.gl = gl;
        this.target = gl.ANY_SAMPLES_PASSED_CONSERVATIVE ?? gl.ANY_SAMPLES_PASSED;
        return true;
    }

    /**
     * Track a mesh. `parent` receives the probe so the probe shares the mesh's
     * coordinate space. Returns the entry, or null if culling is unavailable.
     */
    add(mesh, parent = mesh.parent) {
        if (!this.enabled || !this.gl || !parent) return null;

        const geo = mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb || bb.isEmpty()) return null;

        const size = bb.getSize(new THREE.Vector3());
        const center = bb.getCenter(new THREE.Vector3());
        // a hair of padding so a probe face never lands exactly on the surface
        // it is being tested against
        const pad = 1.001;

        const probe = new THREE.Mesh(boxGeometry, probeMaterial);
        probe.scale.set(
            Math.max(size.x * pad, 1e-3),
            Math.max(size.y * pad, 1e-3),
            Math.max(size.z * pad, 1e-3));
        probe.position.copy(center).add(mesh.position);
        probe.rotation.copy(mesh.rotation);
        probe.renderOrder = PROBE_ORDER;
        probe.frustumCulled = false;
        probe.updateMatrix();
        probe.matrixAutoUpdate = false;
        parent.add(probe);

        const entry = {
            mesh, probe,
            query: null,
            hidden: 0,
            // set by the owner when the mesh should not draw for other reasons
            // (out of the visible layer range, layer type toggled off)
            wanted: true,
            phase: this.entries.length & (PROBE_EVERY - 1),
            world: new THREE.Box3()
        };

        probe.onBeforeRender = () => this._begin(entry);
        probe.onAfterRender = () => this._end(entry);

        this.entries.push(entry);
        return entry;
    }

    /** stop tracking every mesh whose probe hangs off `parent`'s subtree */
    removeUnder(root) {
        this.entries = this.entries.filter(e => {
            let p = e.probe;
            while (p) {
                if (p === root) {
                    e.probe.parent?.remove(e.probe);
                    if (e.query) this.gl.deleteQuery(e.query);
                    return false;
                }
                p = p.parent;
            }
            return true;
        });
    }

    _begin(entry) {
        const gl = this.gl;
        // one outstanding query per mesh; a second render of the same frame
        // (screenshots, the view cube) must not start a nested query
        if (entry.query || this._active) return;
        entry.query = gl.createQuery();
        this._active = entry;
        gl.beginQuery(this.target, entry.query);
    }

    _end(entry) {
        if (this._active !== entry) return;
        this.gl.endQuery(this.target);
        this._active = null;
    }

    /**
     * Called once per frame after rendering. Harvests whatever query results
     * are ready and decides what draws next frame.
     */
    update(camera) {
        if (!this.enabled || !this.gl) return;
        const gl = this.gl;
        let culled = 0;
        this.frame++;

        for (const entry of this.entries) {
            const { mesh, probe, query } = entry;

            if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
                const seen = gl.getQueryParameter(query, gl.QUERY_RESULT);
                gl.deleteQuery(query);
                entry.query = null;
                entry.hidden = seen ? 0 : entry.hidden + 1;
            }

            // a probe the camera is standing inside renders no front faces, so
            // its result means nothing -- always draw those
            let inside = false;
            if (camera && entry.hidden >= HIDE_AFTER) {
                probe.updateWorldMatrix(true, false);
                entry.world.copy(UNIT_BOX).applyMatrix4(probe.matrixWorld);
                inside = entry.world.containsPoint(
                    this._point.setFromMatrixPosition(camera.matrixWorld));
            }

            const show = entry.wanted && (entry.hidden < HIDE_AFTER || inside);
            mesh.visible = show;
            // no point testing a mesh that its owner has switched off anyway.
            // geometry that has never been occluded is also unlikely to become
            // occluded this instant, so stagger those probes instead of paying
            // for all of them every frame
            probe.visible = entry.wanted &&
                (entry.hidden > 0 || (this.frame & (PROBE_EVERY - 1)) === (entry.phase));
            if (entry.wanted && !show) culled++;
        }

        this.stats.tracked = this.entries.length;
        this.stats.culled = culled;
    }

    /** owner-driven visibility, independent of occlusion */
    setWanted(entry, wanted) {
        if (!entry) return;
        entry.wanted = wanted;
        if (!wanted) {
            entry.mesh.visible = false;
            entry.probe.visible = false;
            // forget history so it re-tests cleanly when switched back on
            entry.hidden = 0;
        }
    }
}

export const occluder = new Occluder();
