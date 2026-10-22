/*
 * Torture-test judge. For each case written by run.mjs:
 *   - parse the exported program (G-code or ShopBot SBP) into world-frame moves
 *   - re-simulate it independently on a fine heightmap (exact flat-endmill
 *     sweep per segment, sampled ball sweep) and check, in program order:
 *       GOUGE   material removed below the part's top surface
 *       RAPID   a rapid move through material that is still there
 *       BED     cuts below the bed
 *       LIMITS  bed travel, feed and spindle inside the machine
 *       FLUTE   cutting deeper into material than the flute is long
 *   - compare the app's own SIMULATE heightmap against that re-simulation
 *   - measure what was left uncut (informational)
 *
 *   node tools/torture/check.mjs [filter] [--out dir]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const f32 = file => { const b = readFileSync(file); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : new URL('./out', import.meta.url).pathname;
const filter = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

const GOUGE_TOL = 0.05;     // mm below the surface before a cut counts as a gouge
const WALL_TOL = 0.12;      // mm a cut may graze past a wall (raster edge + facet chords)
const RAPID_TOL = 0.05;     // mm of material a rapid may graze
const SIM_TOL = 0.35;       // mm the app's sim may differ from ours (its grid + tool pixels)

// ---------------------------------------------------------------- grid
class Grid {
    constructor(x0, y0, x1, y1, cell) {
        this.cell = cell;
        this.x0 = x0; this.y0 = y0;
        this.nx = Math.ceil((x1 - x0) / cell) + 1;
        this.ny = Math.ceil((y1 - y0) / cell) + 1;
        this.z = new Float32Array(this.nx * this.ny);
    }
    ix(x) { return Math.round((x - this.x0) / this.cell); }
    iy(y) { return Math.round((y - this.y0) / this.cell); }
    cx(i) { return this.x0 + i * this.cell; }
    cy(j) { return this.y0 + j * this.cell; }
    at(x, y) {
        const i = this.ix(x), j = this.iy(y);
        if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return NaN;
        return this.z[j * this.nx + i];
    }
}

// top-down z-buffer of the part triangles (the 3-axis silhouette)
function rasterParts(grid, tris) {
    grid.z.fill(-Infinity);
    const g = grid;
    for (let t = 0; t < tris.length; t += 9) {
        const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
        const bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5];
        const cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
        const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - g.x0) / g.cell));
        const i1 = Math.min(g.nx - 1, Math.floor((Math.max(ax, bx, cx) - g.x0) / g.cell));
        const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - g.y0) / g.cell));
        const j1 = Math.min(g.ny - 1, Math.floor((Math.max(ay, by, cy) - g.y0) / g.cell));
        if (Math.abs(det) < 1e-12) {
            // vertical triangle: mark the cells it passes over with its max z
            const zt = Math.max(az, bz, cz);
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const px = g.cx(i), py = g.cy(j);
                if (distSegment(px, py, ax, ay, bx, by) < g.cell * 0.5 || distSegment(px, py, bx, by, cx, cy) < g.cell * 0.5 || distSegment(px, py, cx, cy, ax, ay) < g.cell * 0.5) {
                    const k = j * g.nx + i;
                    if (zt > g.z[k]) g.z[k] = zt;
                }
            }
            continue;
        }
        for (let j = j0; j <= j1; j++) {
            const py = g.cy(j);
            for (let i = i0; i <= i1; i++) {
                const px = g.cx(i);
                const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
                const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
                const l3 = 1 - l1 - l2;
                if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
                const z = l1 * az + l2 * bz + l3 * cz;
                const k = j * g.nx + i;
                if (z > g.z[k]) g.z[k] = z;
            }
        }
    }
}

function distSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// ---------------------------------------------------------------- program
function parseProgram(text, frame, toolSeq = []) {
    const moves = [];
    const lines = text.split(/\r?\n/);
    const sbp = lines.some(l => /^(J[23Z]|M[23Z]|MS|TR),/.test(l.trim()));
    let unit = 1, x = 0, y = 0, z = 0, mode = 0, feed = 0, tool = null, spindle = 0, known = false;
    const issues = [];
    let lineNo = 0, change = -1, spindleOn = false;
    const push = (rapid, nx, ny, nz) => {
        const w = { x: nx * unit + frame.x, y: ny * unit + frame.y, z: nz * unit + frame.z };
        if (![w.x, w.y, w.z].every(Number.isFinite)) { issues.push(`line ${lineNo}: non-finite coordinate`); return; }
        moves.push({ rapid, x: w.x, y: w.y, z: w.z, feed: feed * unit, tool, spindle, spindleOn, line: lineNo, first: !known });
        known = true;
    };
    for (const raw of lines) {
        lineNo++;
        const line = raw.replace(/\(.*?\)/g, '').trim();
        if (!line) continue;
        const tm = raw.match(/\bT(\d+)\b/) || raw.match(/&Tool\s*=\s*(\d+)/);
        if (tm && !/^;?\s*(Stock|Tool|layer)/i.test(line)) tool = +tm[1];
        else if (/^(M0?0|M0?6|C6)\b/.test(line)) tool = toolSeq[++change] ?? tool;
        if (line.startsWith(';') || line.startsWith("'")) continue;
        // spindle state: on before any cut, off at every tool-change pause
        if (/^M0?3\b|^M0?4\b/.test(line) || /^(TR|C6)\b/.test(line)) spindleOn = true;
        if (/^M0?5\b/.test(line) || /^C7\b/.test(line)) spindleOn = false;
        if ((/^(M0?0|M0?6)\b/.test(line)) && spindleOn) issues.push(`line ${lineNo}: tool-change pause with the spindle running`);
        if (/NaN|undefined|Infinity/.test(line)) issues.push(`line ${lineNo}: "${line.slice(0, 60)}"`);
        if (sbp) {
            const parts = line.split(',').map(s => s.trim());
            const cmd = parts[0];
            const v = parts.slice(1).map(s => s === '' ? undefined : parseFloat(s));
            if (cmd === 'IF' || cmd.startsWith('&')) continue;
            if (cmd === 'VD' || cmd === 'SA' || cmd === 'SR') continue;
            if (cmd === 'TR') { spindle = v[0]; continue; }
            if (cmd === 'MS') { feed = v[0] * 60; continue; }
            if (cmd === 'JS') continue;
            const rapid = cmd[0] === 'J';
            if (cmd === 'J2' || cmd === 'M2') { x = v[0] ?? x; y = v[1] ?? y; push(rapid, x, y, z); }
            else if (cmd === 'J3' || cmd === 'M3') { x = v[0] ?? x; y = v[1] ?? y; z = v[2] ?? z; push(rapid, x, y, z); }
            else if (cmd === 'JZ' || cmd === 'MZ') { z = v[0] ?? z; push(rapid, x, y, z); }
            else if (cmd === 'JX' || cmd === 'MX') { x = v[0] ?? x; push(rapid, x, y, z); }
            else if (cmd === 'JY' || cmd === 'MY') { y = v[0] ?? y; push(rapid, x, y, z); }
            continue;
        }
        const words = [...line.replace(/;.*$/, '').matchAll(/([A-Z])\s*(-?[\d.]+)/g)].map(m => [m[1], parseFloat(m[2])]);
        let nx = x, ny = y, nz = z, motion = false, ij = {};
        for (const [k, v] of words) {
            if (k === 'G') {
                if (v === 20) unit = 25.4; else if (v === 21) unit = 1;
                else if (v === 0 || v === 1 || v === 2 || v === 3) mode = v;
                else if (v === 90 || v === 4 || v === 17) {} else if (v === 91) issues.push(`line ${lineNo}: G91 relative mode`);
            }
            else if (k === 'X') { nx = v; motion = true; }
            else if (k === 'Y') { ny = v; motion = true; }
            else if (k === 'Z') { nz = v; motion = true; }
            else if (k === 'F') feed = v;
            else if (k === 'S') spindle = v;
            else if (k === 'I' || k === 'J') ij[k] = v;
        }
        if (!motion) continue;
        if (mode === 2 || mode === 3) {
            const cxp = x + (ij.I || 0), cyp = y + (ij.J || 0), r = Math.hypot(x - cxp, y - cyp);
            let a0 = Math.atan2(y - cyp, x - cxp), a1 = Math.atan2(ny - cyp, nx - cxp);
            if (mode === 2 && a1 >= a0) a1 -= Math.PI * 2;
            if (mode === 3 && a1 <= a0) a1 += Math.PI * 2;
            const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r / 0.2));
            for (let s = 1; s <= n; s++) {
                const a = a0 + (a1 - a0) * s / n;
                push(false, cxp + r * Math.cos(a), cyp + r * Math.sin(a), z + (nz - z) * s / n);
            }
        } else push(mode === 0, nx, ny, nz);
        x = nx; y = ny; z = nz;
    }
    return { moves, issues, sbp, unit };
}

// ---------------------------------------------------------------- cutter
function toolShape(t) {
    if (!t) return null;
    const d = (t.flute_diam || t.shaft_diam || 0.25) * (t.metric ? 1 : 25.4);
    return { r: d / 2, ball: t.type === 'ballmill', vee: t.type === 'tapermill', flute: (t.flute_len || 0.5) * (t.metric ? 1 : 25.4), name: t.name };
}

// lowest cutter surface over a cell at horizontal distance d from the axis
function cutterZ(tip, d, sh) {
    if (sh.ball) return tip + sh.r - Math.sqrt(Math.max(0, sh.r * sh.r - d * d));
    return tip;
}

// visit cells under the swept cutter for segment a->b; cb(k, lowestCutterZ)
function sweep(grid, a, b, sh, cb) {
    const g = grid, r = sh.r;
    const minx = Math.min(a.x, b.x) - r, maxx = Math.max(a.x, b.x) + r;
    const miny = Math.min(a.y, b.y) - r, maxy = Math.max(a.y, b.y) + r;
    const i0 = Math.max(0, Math.ceil((minx - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.floor((maxx - g.x0) / g.cell));
    const j0 = Math.max(0, Math.ceil((miny - g.y0) / g.cell)), j1 = Math.min(g.ny - 1, Math.floor((maxy - g.y0) / g.cell));
    if (i0 > i1 || j0 > j1) return;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy;
    if (sh.ball && (Math.abs(dz) > 1e-6)) {
        // sloped ball move: sample
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / (g.cell * 0.5)));
        for (let s = 0; s <= n; s++) {
            const p = { x: a.x + dx * s / n, y: a.y + dy * s / n, z: a.z + dz * s / n };
            sweep(grid, p, p, { ...sh }, cb);
        }
        return;
    }
    for (let j = j0; j <= j1; j++) {
        const py = g.cy(j);
        for (let i = i0; i <= i1; i++) {
            const px = g.cx(i);
            let low;
            if (l2 < 1e-12) {
                const d = Math.hypot(px - a.x, py - a.y);
                if (d > r) continue;
                low = cutterZ(Math.min(a.z, b.z), d, sh);
            } else if (Math.abs(dz) < 1e-9 || sh.ball) {
                const d = distSegment(px, py, a.x, a.y, b.x, b.y);
                if (d > r) continue;
                low = cutterZ(a.z, d, sh);
            } else {
                // flat endmill on a sloped segment: lowest z over the t-interval in reach
                const ex = px - a.x, ey = py - a.y;
                const tc = (ex * dx + ey * dy) / l2;
                const perp2 = ex * ex + ey * ey - tc * tc * l2;
                if (perp2 > r * r) continue;
                const half = Math.sqrt((r * r - perp2) / l2);
                const t0 = Math.max(0, tc - half), t1 = Math.min(1, tc + half);
                if (t0 > t1) continue;
                low = Math.min(a.z + dz * t0, a.z + dz * t1);
            }
            cb(j * g.nx + i, low);
        }
    }
}

// ---------------------------------------------------------------- judge one case
function judge(dir) {
    const rec = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
    const res = { id: rec.id, fail: [], warn: [], info: {} };
    if (rec.errors?.length) res.fail.push(...rec.errors.map(e => 'app error: ' + e));
    if (rec.preview !== 'end') res.fail.push(`toolpaths: ${rec.preview}`);
    if (!existsSync(join(dir, 'program.nc'))) { res.fail.push('no program'); return res; }
    const text = readFileSync(join(dir, 'program.nc'), 'utf8');
    if (/EXPORT (THREW|TIMEOUT)/.test(text)) { res.fail.push(text.slice(0, 120)); return res; }

    const { stock, origin, process: proc, device } = rec;
    const top = proc.camOriginTop;
    const frame = { x: origin.x, y: -origin.y, z: top ? origin.z : origin.z };
    const opToolSeq = (rec.opsSet || []).map(op => rec.tools.find(t => t.id === op.tool)?.number).filter((n, i, a) => n !== a[i - 1]);
    const prog = parseProgram(text, frame, opToolSeq);
    res.info.dialect = prog.sbp ? 'sbp' : 'gcode';
    res.info.moves = prog.moves.length;
    if (prog.issues.length) res.fail.push(...prog.issues.slice(0, 5).map(s => 'program: ' + s));
    if (!prog.moves.some(m => !m.rapid)) res.fail.push('program has no cutting moves');

    // part triangles, world frame
    const tris = [];
    for (const w of rec.widgets) {
        const f = join(dir, `widget-${w.id}.bin`);
        if (existsSync(f)) tris.push(f32(f));
    }
    const all = new Float32Array(tris.reduce((n, t) => n + t.length, 0));
    let o = 0; for (const t of tris) { all.set(t, o); o += t.length; }

    // tools by number
    const toolByNum = Object.fromEntries(rec.tools.map(t => [t.number, t]));
    const opTools = [...new Set((rec.opsSet || []).map(op => op.tool))].map(id => rec.tools.find(t => t.id === id));
    const maxR = Math.max(...opTools.map(t => toolShape(t)?.r || 3));

    const sx0 = stock.center.x - stock.x / 2, sx1 = stock.center.x + stock.x / 2;
    const sy0 = stock.center.y - stock.y / 2, sy1 = stock.center.y + stock.y / 2;
    const sz1 = stock.center.z + stock.z / 2, sz0 = stock.center.z - stock.z / 2;
    const area = (sx1 - sx0 + 2 * maxR) * (sy1 - sy0 + 2 * maxR);
    const cell = area > 60000 ? 0.25 : area > 15000 ? 0.15 : 0.1;
    const pad = maxR + 2;
    const H = new Grid(sx0 - pad, sy0 - pad, sx1 + pad, sy1 + pad, cell);
    rasterParts(H, all);
    const S = new Grid(sx0 - pad, sy0 - pad, sx1 + pad, sy1 + pad, cell);
    for (let j = 0; j < S.ny; j++) for (let i = 0; i < S.nx; i++) {
        const x = S.cx(i), y = S.cy(j);
        S.z[j * S.nx + i] = (x >= sx0 - 1e-6 && x <= sx1 + 1e-6 && y >= sy0 - 1e-6 && y <= sy1 + 1e-6) ? sz1 : -Infinity;
    }
    res.info.cell = cell;

    // walk the program
    let prev = null, sh = null, curTool = Symbol();
    let rapidHits = 0, rapidWorst = 0, rapidFirst = null, fluteWorst = 0, fluteFirst = null;
    let feedMax = 0, feedZMax = 0, spindleMax = 0, spindleMin = Infinity, spindleOffCut = null;
    const travel = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    const unknownTools = new Set();
    for (const m of prog.moves) {
        if (m.tool !== curTool) {
            curTool = m.tool;
            const t = toolByNum[m.tool] || (opTools.length === 1 ? opTools[0] : null);
            if (!t) unknownTools.add(m.tool);
            sh = toolShape(t || opTools[0]);
        }
        if (!prev || m.first) { prev = m; continue; }
        travel.x0 = Math.min(travel.x0, m.x); travel.x1 = Math.max(travel.x1, m.x);
        travel.y0 = Math.min(travel.y0, m.y); travel.y1 = Math.max(travel.y1, m.y);
        travel.z0 = Math.min(travel.z0, m.z); travel.z1 = Math.max(travel.z1, m.z);
        if (m.rapid) {
            // a rapid must not pass through material that is still there
            let worst = 0;
            sweep(S, prev, m, sh, (k, low) => { const d = S.z[k] - low; if (d > worst) worst = d; });
            if (worst > RAPID_TOL) {
                rapidHits++;
                if (worst > rapidWorst) rapidWorst = worst;
                rapidFirst ??= `line ${m.line}: rapid ${worst.toFixed(2)} mm into material`;
            }
            // and it still removes what it touches (a crash cuts too)
            sweep(S, prev, m, sh, (k, low) => { if (low < S.z[k]) S.z[k] = low; });
        } else {
            const dz = Math.abs(m.z - prev.z), dxy = Math.hypot(m.x - prev.x, m.y - prev.y);
            if (m.feed) { if (dxy > 1e-6) feedMax = Math.max(feedMax, m.feed); else if (dz > 0) feedZMax = Math.max(feedZMax, m.feed); }
            if (m.spindle) { spindleMax = Math.max(spindleMax, m.spindle); spindleMin = Math.min(spindleMin, m.spindle); }
            let depth = 0;
            sweep(S, prev, m, sh, (k, low) => {
                if (low < S.z[k]) {
                    const d = (S.z[k] === -Infinity ? 0 : S.z[k] - low);
                    if (d > depth) depth = d;
                    S.z[k] = low;
                }
            });
            if (depth > 0.01 && !m.spindleOn && !spindleOffCut) spindleOffCut = `line ${m.line}: cuts ${depth.toFixed(2)} mm with the spindle off`;
            if (sh && depth > sh.flute + 0.01) {
                if (depth > fluteWorst) { fluteWorst = depth; fluteFirst = `line ${m.line}: ${depth.toFixed(1)} mm deep with a ${sh.flute.toFixed(1)} mm flute (${sh.name})`; }
            }
        }
        prev = m;
    }
    if (unknownTools.size) res.warn.push(`moves under unknown tool numbers ${[...unknownTools]}`);
    if (spindleOffCut) res.fail.push(`SPINDLE ${spindleOffCut}`);
    if (rapidHits) res.fail.push(`RAPID through material x${rapidHits}, worst ${rapidWorst.toFixed(2)} mm (${rapidFirst})`);
    if (fluteWorst) res.warn.push(`FLUTE exceeded: ${fluteFirst}`);
    // machine limits
    const bedW = device.bedWidth, bedD = device.bedDepth;
    res.info.travel = Object.fromEntries(Object.entries(travel).map(([k, v]) => [k, +v.toFixed(2)]));
    if (device.feedMax && feedMax > device.feedMax + 0.5) res.fail.push(`LIMITS feed ${feedMax} > machine ${device.feedMax}`);
    if (device.feedMaxZ && feedZMax > device.feedMaxZ + 0.5) res.fail.push(`LIMITS plunge feed ${feedZMax} > machine ${device.feedMaxZ}`);
    if (device.spindleMax && spindleMax > device.spindleMax) res.fail.push(`LIMITS spindle ${spindleMax} > machine ${device.spindleMax}`);
    if (travel.x1 - travel.x0 > bedW || travel.y1 - travel.y0 > bedD) res.fail.push(`LIMITS travel ${(travel.x1 - travel.x0).toFixed(0)}x${(travel.y1 - travel.y0).toFixed(0)} exceeds bed ${bedW}x${bedD}`);
    res.info.feed = { xy: feedMax, z: feedZMax, spindle: [spindleMin === Infinity ? 0 : spindleMin, spindleMax] };

    // gouge, bed, uncut. A wall is allowed WALL_TOL of horizontal graze:
    // compare against the lowest part height within that radius.
    const kr = Math.ceil(WALL_TOL / cell);
    const Hlow = new Float32Array(H.z.length);
    for (let j = 0; j < H.ny; j++) for (let i = 0; i < H.nx; i++) {
        let m = H.z[j * H.nx + i];
        for (let dj = -kr; dj <= kr && m > -Infinity; dj++) for (let di = -kr; di <= kr; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= H.nx || jj >= H.ny) { m = -Infinity; break; }
            if (di * di + dj * dj > kr * kr) continue;
            const v = H.z[jj * H.nx + ii];
            if (v < m) m = v;
        }
        Hlow[j * H.nx + i] = m;
    }
    let gouge = 0, gougeWorst = 0, gougeAt = null, bed = 0, bedWorst = 0, inStock = 0, removable = 0, removed = 0;
    for (let j = 0; j < S.ny; j++) for (let i = 0; i < S.nx; i++) {
        const k = j * S.nx + i, s = S.z[k], h = H.z[k];
        if (Hlow[k] > -Infinity && s < Hlow[k] - GOUGE_TOL) {
            gouge++;
            if (h - s > gougeWorst) { gougeWorst = h - s; gougeAt = [S.cx(i).toFixed(1), S.cy(j).toFixed(1), h.toFixed(2), s.toFixed(2)]; }
        }
        if (s > -Infinity && s < sz0 - 0.5) { bed++; bedWorst = Math.max(bedWorst, sz0 - s); }
        const x = S.cx(i), y = S.cy(j);
        if (x >= sx0 && x <= sx1 && y >= sy0 && y <= sy1) {
            inStock++;
            const floor = h > -Infinity ? h : sz0;
            if (sz1 > floor) { removable += sz1 - floor; removed += Math.max(0, Math.min(sz1, sz1 - Math.max(s, floor))); }
        }
    }
    const ca = cell * cell;
    if (process.env.TORTURE_DEBUG) {
        // horizontal intrusion of each gouge cell: distance to the nearest cell the part leaves open
        const pts = [];
        for (let j = 0; j < S.ny; j++) for (let i = 0; i < S.nx; i++) {
            const k = j * S.nx + i, s = S.z[k], h = H.z[k];
            if (Hlow[k] > -Infinity && s < Hlow[k] - GOUGE_TOL) {
                let best = Infinity;
                for (let r = 1; r < 40 && best === Infinity; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
                    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                    const kk = (j + dj) * S.nx + (i + di);
                    if (H.z[kk] <= s + GOUGE_TOL) best = Math.min(best, Math.hypot(di, dj) * cell);
                }
                pts.push(best);
            }
        }
        pts.sort((a, b) => a - b);
        const q = f => pts[Math.floor(f * (pts.length - 1))];
        if (pts.length) console.log(`  [debug] ${pts.length} gouge cells, intrusion mm p50 ${q(0.5)?.toFixed(2)} p90 ${q(0.9)?.toFixed(2)} max ${q(1)?.toFixed(2)}`);
    }
    if (gouge) res.fail.push(`GOUGE ${(gouge * ca).toFixed(1)} mm² cut below the part, worst ${gougeWorst.toFixed(2)} mm at x${gougeAt[0]} y${gougeAt[1]} (surface ${gougeAt[2]}, cut to ${gougeAt[3]})`);
    if (bed) res.warn.push(`BED ${(bed * ca).toFixed(0)} mm² cut more than 0.5 mm below the stock bottom, worst ${bedWorst.toFixed(2)} mm`);
    res.info.removed = removable ? +(removed / removable).toFixed(3) : 1;
    if (process.env.TORTURE_DEBUG) {
        const probe = [[0, 0], [sx0 + 2, sy0 + 2], [(sx0 + sx1) / 2 + 7, (sy0 + sy1) / 2]];
        for (const [x, y] of probe) console.log(`  [debug] at ${x.toFixed(1)},${y.toFixed(1)}: part ${H.at(x, y)}, ours ${S.at(x, y)}, stock top ${sz1} bottom ${sz0}`);
    }

    // app sim vs ours
    if (existsSync(join(dir, 'sim.bin'))) {
        const sim = f32(join(dir, 'sim.bin'));
        let n = 0, bad = 0, worst = 0, worstAt = null, sum = 0;
        for (let p = 0; p < sim.length; p += 3) {
            const x = sim[p], y = sim[p + 1], z = sim[p + 2];
            // the heightmap's own perimeter drops to z=0 by construction
            if (x < sx0 + 0.5 || x > sx1 - 0.5 || y < sy0 + 0.5 || y > sy1 - 0.5) continue;
            const ours = S.at(x, y);
            if (!Number.isFinite(ours)) continue;
            // compare against the lowest of our cells within one app-grid pixel
            const d = z - ours;
            n++; sum += Math.abs(d);
            if (Math.abs(d) > SIM_TOL) {
                // tolerate edges where our grid steps within one cell
                const near = [S.at(x + cell, y), S.at(x - cell, y), S.at(x, y + cell), S.at(x, y - cell), S.at(x + 2 * cell, y), S.at(x - 2 * cell, y), S.at(x, y + 2 * cell), S.at(x, y - 2 * cell)];
                if (near.some(v => Math.abs(z - v) <= SIM_TOL)) continue;
                bad++;
                if (Math.abs(d) > Math.abs(worst)) { worst = d; worstAt = [x.toFixed(1), y.toFixed(1), z.toFixed(2), ours.toFixed(2)]; }
            }
        }
        res.info.sim = { points: n, meanAbs: n ? +(sum / n).toFixed(3) : null, off: n ? +(bad / n).toFixed(4) : null, progress: rec.simProgress };
        if (rec.simProgress < 100) res.fail.push(`SIM stopped at ${rec.simProgress}%`);
        if (n && bad / n > 0.005) res.fail.push(`SIM disagrees with the program on ${(100 * bad / n).toFixed(1)}% of the stock, worst ${worst.toFixed(2)} mm at x${worstAt[0]} y${worstAt[1]} (sim ${worstAt[2]}, program ${worstAt[3]})`);
        else if (n && bad) res.info.simOutliers = bad;
    } else res.fail.push('SIM produced no heightmap');

    res.info.timings = rec.timings;
    return res;
}

const dirs = readdirSync(OUT).filter(d => existsSync(join(OUT, d, 'case.json')) && (!filter || d.includes(filter))).sort();
const results = [];
for (const d of dirs) {
    let r;
    try { r = judge(join(OUT, d)); } catch (e) { r = { id: d, fail: ['checker threw: ' + e.stack.split('\n').slice(0, 2).join(' ')], warn: [], info: {} }; }
    results.push(r);
    const tag = r.fail.length ? 'FAIL' : r.warn.length ? 'warn' : 'ok  ';
    console.log(`${tag} ${r.id.padEnd(40)} removed ${String(r.info.removed ?? '-').padEnd(6)} sim ${r.info.sim ? r.info.sim.meanAbs : '-'}`);
    for (const f of r.fail) console.log('       ✗ ' + f);
    for (const w of r.warn) console.log('       ~ ' + w);
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 1));
const nf = results.filter(r => r.fail.length).length;
console.log(`\n${results.length} cases, ${nf} failing, ${results.filter(r => !r.fail.length && r.warn.length).length} with warnings`);
process.exit(nf ? 1 : 0);
