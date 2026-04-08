/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

function createGeometryStoreApi(getApi) {
    return {
        schemaVersion: 1,
        state: null,

        defaultState() {
            return {
                schema_version: this.schemaVersion,
                surfaces: [],
                boundaries: [],
                segments: [],
                points: [],
                regions: [],
                surface_patches: [],
                topology: {
                    surface_to_segments: {},
                    segment_to_surfaces: {},
                    patch_to_tris: {},
                    tri_to_patch: {}
                },
                meta: {
                    feature_count: 0,
                    generated_at: 0
                }
            };
        },

        normalize(raw) {
            const base = this.defaultState();
            const out = raw && typeof raw === 'object'
                ? { ...base, ...raw }
                : base;
            out.schema_version = Number(out.schema_version) || this.schemaVersion;
            out.surfaces = Array.isArray(out.surfaces) ? out.surfaces : [];
            out.boundaries = Array.isArray(out.boundaries) ? out.boundaries : [];
            out.segments = Array.isArray(out.segments) ? out.segments : [];
            out.points = Array.isArray(out.points) ? out.points : [];
            out.regions = Array.isArray(out.regions) ? out.regions : [];
            out.surface_patches = Array.isArray(out.surface_patches) ? out.surface_patches : [];
            out.topology = out.topology && typeof out.topology === 'object'
                ? out.topology
                : base.topology;
            out.topology.patch_to_tris = out.topology.patch_to_tris && typeof out.topology.patch_to_tris === 'object'
                ? out.topology.patch_to_tris
                : {};
            out.topology.tri_to_patch = out.topology.tri_to_patch && typeof out.topology.tri_to_patch === 'object'
                ? out.topology.tri_to_patch
                : {};
            out.meta = out.meta && typeof out.meta === 'object'
                ? out.meta
                : base.meta;
            out.meta.feature_count = Number(out.meta.feature_count) || 0;
            out.meta.generated_at = Number(out.meta.generated_at) || 0;
            return out;
        },

        hydrate(docLike) {
            const raw = docLike?.geometry_store || null;
            this.state = this.normalize(raw);
            return this.state;
        },

        attachToDocument(doc) {
            if (!doc || typeof doc !== 'object') return null;
            const state = this.normalize(doc.geometry_store);
            doc.geometry_store = state;
            this.state = state;
            return state;
        },

        snapshot() {
            const state = this.state || this.defaultState();
            return JSON.parse(JSON.stringify(state));
        },

        seedFromDocument(doc) {
            const api = getApi();
            const state = this.attachToDocument(doc) || this.defaultState();
            const features = Array.isArray(api.document?.current?.features)
                ? api.document.current.features
                : [];
            state.meta = state.meta || {};
            state.meta.feature_count = features.length;
            state.meta.generated_at = Date.now();
            return state;
        },

        applySolidSnapshot(doc, snapshot = {}) {
            const state = this.attachToDocument(doc) || this.defaultState();
            state.surfaces = Array.isArray(snapshot.surfaces) ? snapshot.surfaces : [];
            state.boundaries = Array.isArray(snapshot.boundaries) ? snapshot.boundaries : [];
            state.segments = Array.isArray(snapshot.segments) ? snapshot.segments : [];
            state.points = Array.isArray(snapshot.points) ? snapshot.points : [];
            state.regions = Array.isArray(snapshot.regions) ? snapshot.regions : [];
            state.surface_patches = Array.isArray(snapshot.surface_patches) ? snapshot.surface_patches : [];
            state.topology = snapshot.topology && typeof snapshot.topology === 'object'
                ? snapshot.topology
                : state.topology;
            state.meta = state.meta || {};
            state.meta.feature_count = Number(snapshot?.meta?.feature_count) || state.meta.feature_count || 0;
            state.meta.generated_at = Date.now();
            return state;
        }
    };
}

export { createGeometryStoreApi };
