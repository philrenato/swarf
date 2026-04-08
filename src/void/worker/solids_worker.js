/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { ensureKernel } from '../solid/kernel.js';
import { rebuildGeneratedSolidsFromSnapshot } from '../solid/rebuild.js';

let kernelReady = false;

async function ensureReady() {
    if (kernelReady) return;
    await ensureKernel();
    kernelReady = true;
}

function serializeMeshCache(meshCache) {
    const meshes = [];
    const transfer = [];
    for (const [id, mesh] of meshCache.entries()) {
        if (!id || !mesh?.positions?.length || !mesh?.indices?.length) continue;
        const positions = mesh.positions instanceof Float32Array
            ? mesh.positions
            : new Float32Array(mesh.positions);
        const indices = mesh.indices instanceof Uint32Array
            ? mesh.indices
            : new Uint32Array(mesh.indices);
        meshes.push({ id, positions, indices });
        transfer.push(positions.buffer, indices.buffer);
        const optionalUint = ['mergeFromVert', 'mergeToVert', 'runIndex', 'runOriginalID', 'faceID'];
        for (const key of optionalUint) {
            if (!mesh?.[key]?.length) continue;
            const arr = mesh[key] instanceof Uint32Array ? mesh[key] : new Uint32Array(mesh[key]);
            meshes[meshes.length - 1][key] = arr;
            transfer.push(arr.buffer);
        }
        const optionalFloat = ['halfedgeTangent', 'runTransform'];
        for (const key of optionalFloat) {
            if (!mesh?.[key]?.length) continue;
            const arr = mesh[key] instanceof Float32Array ? mesh[key] : new Float32Array(mesh[key]);
            meshes[meshes.length - 1][key] = arr;
            transfer.push(arr.buffer);
        }
        if (mesh?.run_source_solid_ids && typeof mesh.run_source_solid_ids === 'object') {
            meshes[meshes.length - 1].run_source_solid_ids = mesh.run_source_solid_ids;
        }
        if (Array.isArray(mesh?.source_solid_ids)) {
            meshes[meshes.length - 1].source_solid_ids = mesh.source_solid_ids;
        }
    }
    return { meshes, transfer };
}

self.onmessage = async (event) => {
    const msg = event?.data || {};
    const id = msg?.id ?? null;
    const type = msg?.type || '';
    if (type !== 'rebuild') {
        self.postMessage({ id, ok: false, error: `unknown message type: ${type}` });
        return;
    }
    try {
        await ensureReady();
        const result = await rebuildGeneratedSolidsFromSnapshot(msg.snapshot || {}, {
            reason: msg.reason || 'worker'
        });
        const { meshes, transfer } = serializeMeshCache(result?.meshCache || new Map());
        self.postMessage({
            id,
            ok: true,
            solids: result?.solids || [],
            meshes
        }, transfer);
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            error: error?.message || String(error || 'unknown worker error')
        });
    }
};
