/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { THREE } from '../ext/three.js';

const CDH = 'Content-Disposition';
const { Vector3, computeFaceNormal } = THREE;

/**
 * Encode vertex array(s) to binary STL format
 * Automatically computes normals from triangle vertices
 * @param {Array} recs - array of {file: string, varr: Float32Array} records
 * @param {String} header - optional header text (max 80 chars)
 * @returns {Uint8Array} binary STL data
 */
export function encode(recs, header = '') {
    // Calculate total triangles with strict validation.
    let triCount = 0;
    for (let rec of recs || []) {
        const varr = rec?.varr;
        const len = Number(varr?.length || 0);
        if (!Number.isFinite(len) || len <= 0) continue;
        if (len % 9 !== 0) {
            // Ignore malformed record instead of corrupting output sizing.
            continue;
        }
        triCount += Math.floor(len / 9);
    }

    const byteLen = 84 + triCount * 50;
    if (!Number.isFinite(byteLen) || byteLen <= 84 || byteLen > 0x7fffffff) {
        throw new RangeError(`invalid STL byte length: ${byteLen}`);
    }

    // Create STL buffer: 80 byte header + 4 byte count + (50 bytes per triangle)
    let stl = new Uint8Array(byteLen);
    let dat = new DataView(stl.buffer);
    let pos = 84;

    // Write header text (first 80 bytes)
    if (header) {
        header.substring(0, 80).split('').forEach((c, i) => {
            dat.setUint8(i, c.charCodeAt(0));
        });
    }

    // Write triangle count at byte 80
    dat.setUint32(80, triCount, true);

    // Write triangles
    for (let rec of recs) {
        let { varr } = rec;
        if (!varr || (varr.length % 9) !== 0) continue;
        for (let i = 0, l = varr.length; i < l;) {
            // Read three vertices
            let p0 = new Vector3(varr[i++], varr[i++], varr[i++]);
            let p1 = new Vector3(varr[i++], varr[i++], varr[i++]);
            let p2 = new Vector3(varr[i++], varr[i++], varr[i++]);

            // Compute face normal
            let norm = computeFaceNormal(p0, p1, p2);

            // Write normal (3 floats)
            dat.setFloat32(pos +  0, norm.x, true);
            dat.setFloat32(pos +  4, norm.y, true);
            dat.setFloat32(pos +  8, norm.z, true);

            // Write vertices (9 floats)
            dat.setFloat32(pos + 12, p0.x, true);
            dat.setFloat32(pos + 16, p0.y, true);
            dat.setFloat32(pos + 20, p0.z, true);
            dat.setFloat32(pos + 24, p1.x, true);
            dat.setFloat32(pos + 28, p1.y, true);
            dat.setFloat32(pos + 32, p1.z, true);
            dat.setFloat32(pos + 36, p2.x, true);
            dat.setFloat32(pos + 40, p2.y, true);
            dat.setFloat32(pos + 44, p2.z, true);

            // Attribute byte count (2 bytes) - typically 0
            dat.setUint16(pos + 48, 0, true);

            pos += 50;
        }
    }

    return stl;
}

/**
 * Encode STL as chunked Blob to avoid large contiguous TypedArray allocation.
 * Useful when JS heap is fragmented or under pressure.
 * @param {Array} recs
 * @param {String} header
 * @param {Number} trisPerChunk
 * @returns {Blob}
 */
export function encodeBlob(recs, header = '', trisPerChunk = 4096) {
    let triCount = 0;
    for (let rec of recs || []) {
        const len = Number(rec?.varr?.length || 0);
        if (!Number.isFinite(len) || len <= 0 || (len % 9) !== 0) continue;
        triCount += Math.floor(len / 9);
    }
    const parts = [];
    const head = new Uint8Array(84);
    const headView = new DataView(head.buffer);
    if (header) {
        header.substring(0, 80).split('').forEach((c, i) => {
            headView.setUint8(i, c.charCodeAt(0));
        });
    }
    headView.setUint32(80, triCount, true);
    parts.push(head);

    const maxTris = Math.max(1, Math.floor(Number(trisPerChunk) || 4096));
    const p0 = new Vector3();
    const p1 = new Vector3();
    const p2 = new Vector3();
    for (let rec of recs || []) {
        const varr = rec?.varr;
        if (!varr || (varr.length % 9) !== 0) continue;
        let i = 0;
        while (i < varr.length) {
            const tris = Math.min(maxTris, Math.floor((varr.length - i) / 9));
            const buf = new Uint8Array(tris * 50);
            const dat = new DataView(buf.buffer);
            let pos = 0;
            for (let t = 0; t < tris; t++) {
                p0.set(varr[i++], varr[i++], varr[i++]);
                p1.set(varr[i++], varr[i++], varr[i++]);
                p2.set(varr[i++], varr[i++], varr[i++]);
                const norm = computeFaceNormal(p0, p1, p2);
                dat.setFloat32(pos +  0, norm.x, true);
                dat.setFloat32(pos +  4, norm.y, true);
                dat.setFloat32(pos +  8, norm.z, true);
                dat.setFloat32(pos + 12, p0.x, true);
                dat.setFloat32(pos + 16, p0.y, true);
                dat.setFloat32(pos + 20, p0.z, true);
                dat.setFloat32(pos + 24, p1.x, true);
                dat.setFloat32(pos + 28, p1.y, true);
                dat.setFloat32(pos + 32, p1.z, true);
                dat.setFloat32(pos + 36, p2.x, true);
                dat.setFloat32(pos + 40, p2.y, true);
                dat.setFloat32(pos + 44, p2.z, true);
                dat.setUint16(pos + 48, 0, true);
                pos += 50;
            }
            parts.push(buf);
        }
    }
    return new Blob(parts, { type: 'application/sla' });
}

export function encodeASCII(recs, name = 'solid') {
    const out = [`solid ${String(name || 'solid').replace(/\s+/g, '_')}`];
    const p0 = new Vector3();
    const p1 = new Vector3();
    const p2 = new Vector3();
    for (const rec of recs || []) {
        const varr = rec?.varr;
        if (!varr || (varr.length % 9) !== 0) continue;
        for (let i = 0; i < varr.length;) {
            p0.set(varr[i++], varr[i++], varr[i++]);
            p1.set(varr[i++], varr[i++], varr[i++]);
            p2.set(varr[i++], varr[i++], varr[i++]);
            const n = computeFaceNormal(p0, p1, p2);
            out.push(`facet normal ${n.x} ${n.y} ${n.z}`);
            out.push('  outer loop');
            out.push(`    vertex ${p0.x} ${p0.y} ${p0.z}`);
            out.push(`    vertex ${p1.x} ${p1.y} ${p1.z}`);
            out.push(`    vertex ${p2.x} ${p2.y} ${p2.z}`);
            out.push('  endloop');
            out.push('endfacet');
        }
    }
    out.push(`endsolid ${String(name || 'solid').replace(/\s+/g, '_')}`);
    return out.join('\n');
}

export class STL {
    constructor() {
        this.vertices = null;
        this.normals = null;
        this.colors = null;
    }

    load(url, callback, formdata, scale, credentials, headers) {
        const stl = this;

        fetch(url, {
            method: formdata ? 'POST' : 'GET',
            credentials: credentials ? credentials : 'same-origin',
            body: formdata,
            ...(headers ? { headers: headers } : {})
        }).then(response => {
            if (response.status === 200 || response.status === 0) {
                response.arrayBuffer().then(buffer => {
                    stl.parse(buffer, scale);

                    let cdhVal = response.headers.get(CDH);
                    if (typeof cdhVal === "string") {
                        cdhVal = cdhVal.split(';').map(v => v.trim()).filter(v => {
                            return v.indexOf('filename=') === 0;
                        }).map(v => {
                            return v.substring(10, v.length - 1);
                        })[0];
                    }
                    if (callback) callback(stl.vertices, cdhVal);
                });
            } else {
                if (callback) callback(null, response.statusText);
            }
        }).catch(err => {
            if (callback) callback(null, err)
        });
    }

    encode(vertices, normals) {
        if (!(vertices && vertices.length % 3 === 0)) throw "invalid vertices";

        let vc = vertices.length / 3,
            bs = (vc * 16) + (vc * (2 / 3)) + 84,
            bin = new ArrayBuffer(bs),
            writer = new DataView(bin),
            i = 0,
            j = 0,
            pos = 80;

        function writeInt16(val) {
            writer.setUint16(pos, val, true);
            pos += 2;
        }

        function writeInt32(val) {
            writer.setUint32(pos, val, true);
            pos += 4;
        }

        function writeFloat(val) {
            writer.setFloat32(pos, val, true);
            pos += 4;
        }

        function writeVertex() {
            writeFloat(vertices[i++]); // x
            writeFloat(vertices[i++]); // y
            writeFloat(vertices[i++]); // z
        }

        writeInt32(vc / 3);
        while (i < vertices.length) {
            writeFloat(normals ? normals[j++] : 0); // norm x
            writeFloat(normals ? normals[j++] : 0); // norm y
            writeFloat(normals ? normals[j++] : 0); // norm z
            writeVertex(); // p1
            writeVertex(); // p2
            writeVertex(); // p3
            writeInt16(0); // attributes
        }

        return bin;
    }

    parse(data, scale) {
        let binData = this.convertToBinary(data);
        let len = binData.byteLength;
        this.reason = undefined;

        // too short for a binary header: only text can hold a triangle here
        if (len < 84) {
            return this.said(this.parseASCII(this.convertToString(data), scale), 'text');
        }

        let reader = new DataView(binData),
            stated = reader.getUint32(80, true),
            fit = Math.floor((len - 84) / 50);

        // the stated count matches the size exactly: binary
        if (84 + stated * 50 === len) {
            return this.said(this.parseBinary(binData, scale, stated), 'binary');
        }

        let kind = stlKind(new Uint8Array(binData, 0, Math.min(len, 65536)));
        if (kind === 'utf16') {
            this.reason = 'text saved as UTF-16: save it as UTF-8 text or binary';
            return this.empty();
        }
        // binary reads no more triangles than the file holds (a count of 0, as some writers
        // leave it, reads all of them)
        return kind === 'text'
            ? this.said(this.parseASCII(this.convertToString(data), scale), 'text')
            : this.said(this.parseBinary(binData, scale, stated > 0 ? Math.min(stated, fit) : fit), 'binary');
    }

    // why a parse holds no triangle, kept on this.reason
    said(vertices, kind) {
        if (!stlHasTriangle(vertices)) {
            this.reason = kind === 'text'
                ? 'no whole triangle in this text STL'
                : 'no triangle with real numbers in this binary STL';
        }
        return vertices;
    }

    empty() {
        this.vertices = new Float32Array(0);
        this.normals = new Float32Array(0);
        this.colors = null;
        return this.vertices;
    }

    parseAsync(data, scale) {
        return new Promise((resolve, reject) => {
            resolve(this.parse(data, scale));
        });
    }

    parseBinary(data, scale = 1, count) {
        let reader = new DataView(data),
            faces = count ?? Math.min(reader.getUint32(80, true), Math.floor((data.byteLength - 84) / 50)),
            r, g, b, hasColors = false, colors,
            defaultR, defaultG, defaultB, alpha;

        // check for default color in STL header ("COLOR=rgba" sequence).
        for (let index = 0; index < 80 - 10; index++) {
            if ((reader.getUint32(index, false) == 0x434F4C4F /*COLO*/) &&
                (reader.getUint8(index + 4) == 0x52 /*'R'*/) &&
                (reader.getUint8(index + 5) == 0x3D /*'='*/)) {
                hasColors = true;
                colors = new Float32Array(faces * 3 * 3);
                defaultR = reader.getUint8(index + 6) / 255;
                defaultG = reader.getUint8(index + 7) / 255;
                defaultB = reader.getUint8(index + 8) / 255;
                alpha = reader.getUint8(index + 9) / 255;
            }
        }

        let offset = 0,
            dataOffset = 84,
            faceLength = 12 * 4 + 2,
            vertices = new Float32Array(faces * 3 * 3),
            normals = new Float32Array(faces * 3 * 3);

        colors = hasColors ? new Uint16Array(faces * 3 * 3) : null;

        for (let face = 0; face < faces; face++) {

            let start = dataOffset + face * faceLength,
                normalX = reader.getFloat32(start, true),
                normalY = reader.getFloat32(start + 4, true),
                normalZ = reader.getFloat32(start + 8, true);

            if (hasColors) {
                let packedColor = reader.getUint16(start + 48, true);
                if ((packedColor & 0x8000) === 0) { // facet has its own unique color
                    r = (packedColor & 0x1F) / 31;
                    g = ((packedColor >> 5) & 0x1F) / 31;
                    b = ((packedColor >> 10) & 0x1F) / 31;
                } else {
                    r = defaultR;
                    g = defaultG;
                    b = defaultB;
                }
            }

            let i = 1, vertexstart;

            while (i <= 3) {
                vertexstart = start + (i++) * 12;
                vertices[offset] = reader.getFloat32(vertexstart, true) * scale;
                vertices[offset + 1] = reader.getFloat32(vertexstart + 4, true) * scale;
                vertices[offset + 2] = reader.getFloat32(vertexstart + 8, true) * scale;
                normals[offset] = normalX;
                normals[offset + 1] = normalY;
                normals[offset + 2] = normalZ;
                if (hasColors) {
                    colors[offset] = r;
                    colors[offset + 1] = g;
                    colors[offset + 2] = b;
                }
                offset += 3;
            }
        }

        this.vertices = vertices;
        this.normals = normals;
        this.colors = colors;

        return vertices;
    }

    parseASCII(data, scale = 1) {
        // a number as STL writers print it: 1, -1.5, .5, 1., 2e-3 (never nan or inf)
        const NUM = '([-+]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?)';
        const SEP = '\\s+';
        let result,
            resultText,
            vertices = [],
            normals = [],
            patternNormal = new RegExp(`normal${SEP}${NUM}${SEP}${NUM}${SEP}${NUM}`, 'i'),
            patternVertex = new RegExp(`vertex${SEP}${NUM}${SEP}${NUM}${SEP}${NUM}(?![^\\s])`, 'gi'),
            patternFace = /facet([\s\S]*?)endfacet/gi;

        while ((result = patternFace.exec(data)) !== null) {
            resultText = result[0];
            // a facet is kept whole or left out whole, so one bad number never shifts the rest
            let verts = [], m;
            patternVertex.lastIndex = 0;
            while ((m = patternVertex.exec(resultText)) !== null) {
                verts.push(parseFloat(m[1]) * scale, parseFloat(m[2]) * scale, parseFloat(m[3]) * scale);
            }
            let says = (resultText.match(/vertex/gi) || []).length;
            if (verts.length !== 9 || says !== 3) continue;
            vertices.push(...verts);
            let n = patternNormal.exec(resultText);
            normals.push(n ? parseFloat(n[1]) : 0, n ? parseFloat(n[2]) : 0, n ? parseFloat(n[3]) : 0);
        }

        let vToFloat32 = new Float32Array(vertices.length),
            nToFloat32 = new Float32Array(normals.length),
            i;

        for (i = 0; i < vertices.length; i++) vToFloat32[i] = vertices[i];
        for (i = 0; i < normals.length; i++) nToFloat32[i] = normals[i];

        this.vertices = vToFloat32;
        this.normals = nToFloat32;

        return vToFloat32;
    }

    convertToString(buf) {
        if (typeof buf === "string") return buf.charCodeAt(0) === 0xFEFF ? buf.slice(1) : buf;
        // UTF-8 (ASCII is UTF-8): a solid name such as café reads as written; a BOM is dropped
        let bytes = new Uint8Array(buf);
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
        let str = '';
        for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
        return str;
    }

    convertToBinary(buf) {
        if (typeof buf === "string") {
            let array_buffer = new Uint8Array(buf.length);
            for (let i = 0; i < buf.length; i++) {
                array_buffer[i] = buf.charCodeAt(i) & 0xff;
            }
            return array_buffer.buffer || array_buffer;
        } else {
            return buf;
        }
    }
}

/**
 * What the start of an STL that is not exactly binary-sized holds: 'text', 'binary' or 'utf16'.
 * Text holds no NUL and no control byte but tab, line breaks and form feed; bytes over 126 are
 * UTF-8 (a solid name such as café or a BOM). A binary count or float holds NULs or control
 * bytes. Text that opens with solid and names a facet normal and a vertex is text even with a
 * stray control byte. UTF-16 text is named so it can be said, not read as binary.
 * @param {Uint8Array} b - the file's first bytes
 */
export function stlKind(b) {
    if ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF)) return 'utf16';
    let nul = 0, ctrl = 0, oddNul = 0, evenNul = 0;
    for (let i = 0; i < b.length; i++) {
        const c = b[i];
        if (c === 0) { nul++; if (i & 1) oddNul++; else evenNul++; }
        else if (c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) ctrl++;
    }
    if (!nul && !ctrl) return 'text';
    // UTF-16 with no BOM: every other byte NUL, the others spelling solid
    const half = b.length >> 1;
    if (half >= 5 && Math.max(oddNul, evenNul) >= half * 0.9) {
        let word = '';
        for (let i = oddNul > evenNul ? 0 : 1; i < b.length && word.length < 64; i += 2) word += String.fromCharCode(b[i]);
        if (/^\s*solid\b/i.test(word)) return 'utf16';
    }
    if (!nul) {
        let head = '';
        for (let i = 0; i < b.length; i++) head += String.fromCharCode(b[i]);
        if (/^(\xEF\xBB\xBF)?\s*solid\b/i.test(head) && /\bfacet\s+normal\b[\s\S]*?\bvertex\s/i.test(head)) return 'text';
    }
    return 'binary';
}

/** at least one triangle whose nine numbers are all numbers */
export function stlHasTriangle(v) {
    if (!v || v.length < 9) return false;
    for (let t = 0; t + 8 < v.length; t += 9) {
        let ok = true;
        for (let k = 0; k < 9 && ok; k++) ok = Number.isFinite(v[t + k]);
        if (ok) return true;
    }
    return false;
}

/** how many millimeters one unit of each STL reading is */
export const STL_UNITS = { mm: 1, in: 25.4, m: 1000 };
export const STL_UNIT_NAMES = { mm: 'millimeters', in: 'inches', m: 'meters' };

/**
 * The likely units of an STL's numbers (an STL says none): 'mm', 'in' or 'm'.
 * @param {Float32Array} v - vertex coordinates
 * @param {object} opt - { bedWidth, bedDepth, inch } (inch: inches are preferred when both fit)
 * @returns {string} 'mm', 'in' or 'm'
 */
export function stlUnits(v, opt = {}) {
    return stlUnitsWhy(v, opt).reading;
}

/**
 * stlUnits with how sure it is: { reading, guess, why, byPref, readings }.
 * Only the part's size counts, never where its numbers sit, so a moved part reads the same.
 * readings holds each reading's state: 'off' (its footprint is off the bed), 'small' (on the bed,
 * longest side under 6 mm) or 'fits'. Meters are a reading only for a part under 1 unit long.
 * The pick: meters when they fit; else mm or inches, whichever fits (both: the units switch's,
 * byPref); else mm. why is 'one' (no other reading is on the bed), 'both' (another reading fits),
 * 'small' (another is on the bed only under 6 mm) or 'none' (the pick does not fit either).
 * guess is every why but 'one'.
 */
export function stlUnitsWhy(v, opt = {}) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < v.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const x = v[i + k];
            if (!Number.isFinite(x)) continue;
            if (x < lo[k]) lo[k] = x;
            if (x > hi[k]) hi[k] = x;
        }
    }
    const s = [0, 1, 2].map(k => hi[k] - lo[k]);
    if (!s.every(Number.isFinite)) {
        return { reading: 'mm', guess: true, why: 'none', byPref: false, readings: {} };
    }
    const long = Math.max(...s);
    const bw = opt.bedWidth || Infinity, bd = opt.bedDepth || Infinity;
    const state = k => (s[0] * k > bw + 0.5 || s[1] * k > bd + 0.5) ? 'off' : long * k >= 6 ? 'fits' : 'small';
    const readings = {};
    for (const u of ['mm', 'in', ...(long < 1 ? ['m'] : [])]) readings[u] = state(STL_UNITS[u]);

    let reading = 'mm', byPref = false;
    if (readings.m === 'fits') reading = 'm';
    else if (readings.mm === 'fits' && readings.in === 'fits') { reading = opt.inch ? 'in' : 'mm'; byPref = true; }
    else if (readings.in === 'fits') reading = 'in';

    const others = Object.keys(readings).filter(u => u !== reading).map(u => readings[u]);
    const why = readings[reading] !== 'fits' ? 'none'
        : others.includes('fits') ? 'both'
        : others.includes('small') ? 'small' : 'one';
    return { reading, guess: why !== 'one', why, byPref, readings };
}

/**
 * The sentence for a stlUnitsWhy result: the reading picked, then each reading as it is.
 * @param {object} r - stlUnitsWhy's result
 * @returns {string}
 */
export function stlUnitsSay(r) {
    const N = STL_UNIT_NAMES, head = `it came in as ${N[r.reading]}`;
    if (r.why === 'one') return `${head}, the only reading that fits the bed.`;
    const st = r.readings || {};
    const as = state => ['mm', 'in', 'm'].filter(u => st[u] === state).map(u => N[u]);
    const and = a => a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
    const bits = [];
    const fit = as('fits'), small = as('small'), off = as('off');
    if (fit.length) bits.push(`as ${and(fit)} it fits the bed`);
    if (small.length) bits.push(`as ${and(small)} it is under 6 mm long`);
    if (off.length) bits.push(`as ${and(off)} it is too big for the bed`);
    if (r.byPref) bits.push('the units switch chose');
    return `${head}. a guess: ${bits.join('; ') || 'its size is unknown'}. check the size.`;
}
