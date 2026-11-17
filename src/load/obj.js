/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

'use strict';

import { util } from '../geo/base.js';

/**
 * Export vertex array(s) to OBJ format string
 * @param {Array} recs - array of {file: string, varr: Float32Array} records
 * @param {String} header - optional header comment
 * @returns {String} OBJ format text
 */
export function encode(recs, header = '# Generated @ https://grid.space') {
    let p = 1;
    let obj = [header];
    for (let rec of recs) {
        let { file, varr } = rec;
        obj.push(`g ${file || 'unnamed'}`);
        for (let i=0; i<varr.length; p += 3) {
            // swarf: written Y up, as parse() reads it (x, z, -y)
            for (let k = 0; k < 3; k++, i += 3) obj.push(`v ${varr[i]} ${varr[i+2]} ${-varr[i+1]}`);
            obj.push(`f ${p} ${p+1} ${p+2}`);
        }
    }
    return obj.join('\n');
}

/**
 * @param {String} text
 * @returns {Array} vertex face array
 */
export function parseAsync(text) {
    return new Promise((resolve,reject) => {
        resolve(parse(text));
    });
}

/**
 * Read an OBJ's faces as triangles, one vertex array per group (g).
 * Faces of four or more corners are triangulated in their own plane. A face
 * that points at a missing vertex is left out; the returned list says how many
 * were (refused). Groups with no triangles are not returned.
 * @param {String} text
 * @returns {Array} vertex face arrays, with .refused
 */
export function parse(text) {
    const lines = String(text).split(/\r?\n/);
    const verts = [];
    const objs = [];
    let faces = [];
    let refused = 0;

    objs.push(faces);

    // a 1-based index, or a negative one counted back from the last vertex read
    const corner = tok => {
        const n = parseInt(tok.split('/')[0], 10);
        const i = n > 0 ? n - 1 : n < 0 ? verts.length + n : -1;
        return i >= 0 && i < verts.length ? verts[i] : null;
    };

    for (let line of lines) {
        const toks = line.trim().split(/\s+/);
        switch (toks.shift()) {
            case 'v': {
                const v = toks.slice(0, 3).map(t => parseFloat(t));
                // an OBJ is Y up (the format's habit; Rhino and Blender export it so):
                // turned to Z up, a part comes in lying as it was drawn
                const ok = v.length === 3 && v.every(Number.isFinite);
                verts.push(ok ? [v[0], -v[2], v[1]] : null);
                break;
            }
            case 'f': {
                const pts = toks.filter(t => t).map(corner);
                if (pts.length < 3 || pts.some(p => !p)) {
                    refused++;
                    break;
                }
                if (pts.length === 3) {
                    for (const p of pts) faces.push(p[0], p[1], p[2]);
                    break;
                }
                for (const i of util.triangulate(pts.flat(), [], 3, true)) {
                    const p = pts[i];
                    faces.push(p[0], p[1], p[2]);
                }
                break;
            }
            case 'g':
                if (faces.length) {
                    objs.push(faces = []);
                }
                if (toks[0]) {
                    faces.name = toks.join(' ');
                }
                break;
        }
    }
    const out = objs.filter(f => f.length >= 9);
    out.refused = refused;
    return out;
}
