/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { codec } from '../../../core/codec.js';
import { newPoint } from '../../../../geo/point.js';
import { newPolygon } from '../../../../geo/polygon.js';
import { newSlice } from '../../../core/slice.js';
import { Slicer as topo_slicer } from './slicer-topo.js';
import { polygons as POLY } from '../../../../geo/polygons.js';
import { Tool } from '../core/tool.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const SharedOrArrayBuffer = globalThis.SharedArrayBuffer || ArrayBuffer;
const hasSharedArrays = globalThis.SharedArrayBuffer ? true : false;

export class Topo {
    constructor() { }

    async generate(opt = {}) {
        let { state, contour, onupdate, ondone } = opt;
        let { widget, settings, shadow, tabs } = opt.state;

        let { controller, process } = settings,
            { webGPU } = controller,
            { workarea } = state,
            animesh = parseInt(controller.animesh || 100) * 2500,
            axis = contour.axis.toLowerCase(),
            contourX = axis === "x",
            contourY = axis === "y",
            bounds = widget.getBoundingBox().clone(),
            tolerance = contour.tolerance,
            flatness = contour.flatness || (tolerance / 100),
            minX = bounds.min.x,
            maxX = bounds.max.x,
            minY = bounds.min.y,
            maxY = bounds.max.y,
            zBottom = contour.bottom ? workarea.bottom_z : 0,
            zMin = zBottom + 0.0001,
            boundsX = maxX - minX,
            boundsY = maxY - minY,
            inside = contour.inside,
            density = 1 + (contour.reduction || 0),
            resolution = (tolerance ? tolerance : 1 / Math.sqrt(animesh / (boundsX * boundsY))).round(5),
            tool = new Tool(settings, contour.tool),
            toolOffset = tool.generateProfile(resolution).profile,
            toolDiameter = tool.fluteDiameter(),
            toolStep = toolDiameter * contour.step,
            leave = contour.leave || 0,
            maxangle = contour.angle,
            curvesOnly = contour.curves,
            bridge = contour.bridging || 0,
            stepsX = Math.ceil(boundsX / resolution),
            stepsY = Math.ceil(boundsY / resolution),
            widtopo = widget.topo,
            topoCache = widtopo
                && widtopo.tolerance === tolerance
                && widtopo.diameter === toolDiameter
                ? widtopo : undefined,
            topo = widget.topo = topoCache || {
                axis,
                data: new Float32Array(new SharedOrArrayBuffer(stepsX * stepsY * 4)),
                stepsX,
                stepsY,
                bounds,
                diameter: toolDiameter,
                resolution,
                tolerance,
                profile: toolOffset,
                widget,
                raster: true,
                slices: null
            },
            data = topo.data,
            newslices = [],
            tabsMax = tabs ? Math.max(...tabs.map(tab => tab.dim.z / 2 + tab.pos.z)) : 0,
            tabsOn = tabs,
            tabHeight = Math.max(process.camTabsHeight + zBottom, tabsMax),
            clipTab = tabsOn ? [] : null,
            clipTo = inside ? shadow.base : POLY.expand(shadow.base, toolDiameter / 2 + resolution * 3),
            partOff = inside ? 0 : toolDiameter / 2 + resolution,
            gridDelta = Math.floor(partOff / resolution),
            debug_clips = true;

        // swarf: a stepover of 0 (a file saved with one) would lay passes without end
        if (!(toolStep > 0)) {
            throw 'contour: the stepover must be more than 0';
        }

        if (contour.clipto) {
            let { stock } = settings;
            let { center, x, y } = stock;
            clipTo.push(newPolygon().centerRectangle(center, x, y));
        }

        if (tolerance === 0 && !topoCache) {
            console.log(widget.id, 'topo auto tolerance', resolution.round(4));
        }

        // console.log({ resolution, flatness });
        // used by Pocket -> Contour
        this.tolerance = resolution;

        if (tabsOn) {
            clipTab.appendAll(tabs.map(tab => {
                let ctab = POLY.expand([tab.poly], toolDiameter / 2);
                ctab.forEach(ct => ct.z = tab.dim.z / 2 + tab.pos.z);
                return ctab;
            }).flat());
        }

        // debug clipTab and clipTo
        if (debug_clips) {
            const debug = newSlice(-1);
            const output = debug.output();
            if (clipTab) output.setLayer("clip.tab", { line: 0xff0000 }).addPolys(clipTab);
            if (clipTo) output.setLayer("clip.to", { line: 0x00dd00 }).addPolys(clipTo);
            newslices.push(debug);
        }

        // swarf: paths of its own (contour.trace2d) are sampled on the CPU raster below
        if (webGPU && !contour.nogpu && !contour.trace2d) {
            // invert tool Z offset for gpu code
            let toolBounds = new THREE.Box3()
                .expandByPoint({ x: -toolDiameter/2, y: -toolDiameter/2, z: 0 })
                .expandByPoint({ x: toolDiameter/2, y: toolDiameter/2, z: 0 });
            let toolPos = tool.profile.slice();
            for (let i=0; i<toolPos.length; i+= 3) {
                // toolPos[i+2] = -toolPos[i+2];
                toolBounds.expandByPoint({ x: toolPos[i], y: toolPos[i+1], z: toolPos[i+2] });
            }
            let toolData = { positions: toolPos, bounds: toolBounds };

            let vertices = widget.getGeoVertices({ unroll: true, translate: true });
            let wbounds = bounds.clone();
            if (!inside) {
                wbounds.expandByVector({ x: toolDiameter/2 + resolution, y: toolDiameter/2 + resolution, z: 0 });
            }

            // swap XY vertices (unswap later after polylines generated)
            if (contourY) {
                vertices = vertices.slice();
                for (let i=0; i<vertices.length; i+= 3) {
                    let tmp = vertices[i+1];
                    vertices[i+1] = vertices[i+0];
                    vertices[i+0] = tmp;
                }
                ['min','max'].forEach(ext => {
                    ext = wbounds[ext];
                    let tmp = ext.x;
                    ext.x = ext.y;
                    ext.y = tmp;
                });
            }

            let trace = contour.trace;
            let gpu = await self.get_raster_gpu({
                mode: trace ? "tracing" : "planar",
                resolution
            });
            let xStep = density;
            let yStep = Math.ceil(toolStep / resolution);
            let epsilon = 10e-4;
            // load the pre-generated tool profile
            await gpu.loadTool({
                sparseData: toolData
            });
            // rasterize the terrain to the same resolution
            let terrain = await gpu.loadTerrain({
                triangles: vertices,
                boundsOverride: wbounds
            });
            let { gridWidth, positions } = terrain;
            // generate all scanline points passing tool over terrain
            let output = await gpu.generateToolpaths({
                xStep,
                yStep,
                zFloor: zBottom === 0 ? zBottom - 1 : zBottom,
                onProgress(pct) { console.log({ pct }); onupdate(pct/100, 100) }
            });
            gpu.mode = 'tracing';
            // create coastline path around part for tip-to-tip travels
            // convert shadow/clip poly lines to raster float32 array groups
            let paths = POLY.flatten(clipTo).map(poly => poly.points.map(p => [ p.x, p.y ]).flat().toFloat32());
            let coastline = await gpu.generateToolpaths({
                paths,
                step: 1,
                zFloor: zBottom
            });
            this.coastline = coastline.paths.map(arr => newPolygon().fromArray([0,...arr]));
            gpu.terminate();

            let { numScanlines, pointsPerLine, pathData } = output;
            let xmult = xStep * resolution;
            let ymult = yStep * resolution;
            let xoff = wbounds.min.x;
            let yoff = wbounds.min.y;
            let slices = [];
            function calcPoint(x, y, z, tx, ty) {
                let p = newPoint(x, y, z);
                p.tx = tx;
                p.ty = ty;
                return p;
            }
            // for each toolpath, return a point in part space coordinated
            // attach to a polyline, and annotate with terrain coordinates
            // so we can later dertermine if the point is on or off the part
            for (let i=0; i<numScanlines; i++) {
                let lineStart = i * pointsPerLine;
                let lineData = pathData.slice(lineStart, lineStart + pointsPerLine);
                let points = Array.from(lineData).map((v,j) => calcPoint(j * xmult + xoff, i * ymult + yoff, v, j * xStep, i * yStep));
                let slice = newSlice(i);
                let poly = newPolygon().setOpen();
                let lines = [ ];
                // track z co-planar skipped points for latent emission
                let skip = 0;
                let lp;
                for (let p of points) {
                    // detect points where no rays intersect the part (off part)
                    if (inside && positions[p.ty * gridWidth + p.tx] < zBottom - epsilon) {
                        if (poly.length > 1) {
                            lines.push(poly);
                            poly = newPolygon().setOpen();
                        } else if (poly.length === 1) {
                            poly = newPolygon().setOpen();
                        }
                        lp = undefined;
                        skip = 0;
                        continue;
                    }
                    // off part but we want to return zBottom (outside)
                    if (p.z < zBottom - epsilon) {
                        lp = p;
                        if (poly.length === 0) {
                            skip++;
                            continue;
                        }
                        if (poly.length > 1) {
                            skip = 0;
                            p.z = zBottom;
                            poly.push(p);
                            lines.push(poly);
                            poly = newPolygon().setOpen();
                            continue;
                        }
                    } else if (lp && skip && poly.length === 0) {
                        // latent/last point output
                        lp.z = zBottom;
                        poly.push(lp);
                    }
                    poly.push(lp = p);
                    skip = 0;
                }
                // require two points or more
                if (poly.length > 1) {
                    lines.push(poly);
                }
                // fixup/swap when contouring along Y
                if (contourY) {
                    for (let poly of lines)
                    for (let p of poly.points) {
                        p.swapXY();
                    }
                }
                // enforce z-bottom on emitted GPU contour points
                if (contour.bottom && zBottom !== 0)
                for (let poly of lines) {
                    for (let p of poly.points) {
                        p.z = Math.max(p.z, zBottom);
                    }
                }
                // raise output points when inside tab boundaries
                if (tabsOn && clipTab.length)
                for (let poly of lines) {
                    for (let p of poly.points) {
                        for (let clip of clipTab) {
                            if (p.z < clip.z && p.isInPolygon(clip)) {
                                p.z = clip.z;
                                break;
                            }
                        }
                    }
                }
                // drop interior points along a continuous slope
                for (let poly of lines) {
                    let { points } = poly;
                    if (points.length < 2) continue;
                    let merged = [ points[0] ];
                    let lastP = points[0];
                    let latent = null;
                    let lastSlope = undefined;
                    for (let i=1; i<points.length; i++) {
                        let newP = points[i];
                        const dl = (newP.x - lastP.x) || (newP.y - lastP.y);
                        const dz = newP.z - lastP.z;
                        const slope = Math.atan2(dz, dl);
                        if (curvesOnly && Math.abs(dz) < flatness) {
                            // end current segment with latent if present
                            if (latent) {
                                merged.push(latent);
                                latent = null;
                            }
                            // add empty points as path separators
                            merged.push(undefined);
                            lastSlope = undefined;
                        } else if (lastSlope !== undefined && Math.abs(lastSlope - slope) < flatness) {
                            latent = newP;
                        } else {
                            if (latent) {
                                merged.push(latent);
                                latent = null;
                            }
                            merged.push(newP);
                            lastSlope = slope;
                        }
                        lastP = newP;
                    }
                    // add final latent point if present
                    if (latent && merged.peek() !== latent) {
                        merged.push(latent);
                    }
                    poly.points = merged;
                }
                // drop flat regions when enabled
                if (curvesOnly) {
                    let nulines = [];
                    for (let poly of lines) {
                        let { points } = poly;
                        let newp = [];
                        for (let p of points) {
                            if (p) {
                                newp.push(p);
                            } else if (newp.length) {
                                nulines.push(newPolygon(newp).setOpen());
                                newp = [];
                            }
                        }
                        nulines.push(newPolygon(newp).setOpen());
                    }
                    lines = nulines.filter(p => p.perimeter() > toolStep);
                }
                slice.camLines = lines;
                slices.push(slice);
                if (inside) {
                    onupdate(i, numScanlines);
                }
            }
            ondone(slices);
            return this;
        }

        const probe = this.probe = new Probe({
            profile: toolOffset,
            data,
            stepsX,
            stepsY,
            boundsX,
            boundsY,
            minX,
            minY,
            zMin
        });

        const { toolAtZ, toolAtXY, zAtXY } = probe;

        this.toolAtZ = toolAtZ;
        this.toolAtXY = toolAtXY;
        this.zAtXY = zAtXY;

        const trace = this.trace = new Trace(probe, {
            curvesOnly,
            maxangle,
            flatness,
            bridge,
            contourX
        });

        if (topo.raster) {
            const box = topo.box = new THREE.Box2();

            const params = {
                resolution,
                curvesOnly,
                flatness,
                stepsY,
                minY,
                maxY,
                zMin,
                data,
                box
            };

            onupdate(0, 1, "raster");
            await this.raster(widget, params, (i, l, p) => {
                onupdate(i / 2, l, p);
            });
            topo.raster = false;
        }

        if (contour.trace2d) {
            await this.paths2d({
                pass: contour.trace2d,
                box: topo.box.clone().expandByVector(new THREE.Vector3(partOff, partOff, 0)),
                clipTo,
                clipTab,
                tabHeight,
                resolution,
                density,
                toolStep,
                leave,
                newslices
            }, (i, l, p) => {
                onupdate(l / 2 + i / 2, l, p);
            });
            ondone(newslices);
            return this;
        }

        await this.contour({
            box: topo.box,
            minX,
            maxX,
            minY,
            maxY,
            stepsX,
            stepsY,
            boundsX,
            boundsY,
            partOff,
            gridDelta,
            resolution,
            toolStep,
            contourX,
            contourY,
            density,
            clipTo,
            clipTab,
            clipTabZ: clipTab ? clipTab.map(t => t.z) : undefined,
            tabHeight,
            newslices,
            leave
        }, (i, l, p) => {
            onupdate(l / 2 + i / 2, l, p);
        });

        ondone(newslices);

        return this;
    }

    // swarf: the contour along 2D paths: lines at any angle across the part, or rings that step in
    // from the clip outline (around every hole as well, outside in). Each point is the tool's height
    // on the same raster as the X / Y walk, with the same rules: off the clip outline the path ends,
    // inside a tab it rides at the tab's top, and it never goes below the raster's floor (zMin).
    // Points are kept every raster cell and merged only where the path runs straight in 3D, so a
    // curve or a wall is followed as closely as the raster allows.
    async paths2d(params, onupdate) {
        const { pass, box, clipTo, clipTab, tabHeight, resolution, density, toolStep, leave, newslices } = params;
        const { toolAtZ, params: pp } = this.probe;
        const step = resolution * density;
        // the tool's height at a point between raster cells: the highest of the four cells around it,
        // so a path at an angle rests on the surface, never in it. The raster's cells are resolution
        // apart from its corner (raster_slice), and the paths run past the part, so the scale is
        // the resolution itself: steps over bounds is a little more, and drifts with distance
        const rx = 1 / resolution, ry = 1 / resolution;
        // a cell's tool height is read by every sample beside it: each is worked out once (the
        // tool's profile is many cells on a fine raster, a small part's above all)
        const cells = new Map();
        const cellZ = (ix, iy) => {
            const key = ix * 4194304 + iy;
            let z = cells.get(key);
            if (z === undefined) {
                if (cells.size > 4e6) cells.clear();
                cells.set(key, z = toolAtZ(ix, iy));
            }
            return z;
        };
        const toolAt = (x, y) => {
            const fx = rx * (x - pp.minX), fy = ry * (y - pp.minY);
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            return Math.max(cellZ(x0, y0), cellZ(x0 + 1, y0), cellZ(x0, y0 + 1), cellZ(x0 + 1, y0 + 1));
        };
        const flat = Math.min(0.02, resolution / 4);
        const at = newPoint(0, 0);
        const inside = (polys, x, y) => { at.x = x; at.y = y; return polys.some(p => at.isInPolygon(p)); };
        const tabTop = (x, y, z) => {
            at.x = x; at.y = y;
            let top = -Infinity;
            for (const t of clipTab) if (z <= t.z && at.isInPolygon(t)) top = Math.max(top, t.z);
            return top;
        };
        // the cut height at a point: the surface (or a tab's top) plus leave
        const zAt = (x, y) => {
            let z = toolAt(x, y);
            if (clipTab && clipTab.length && z < tabHeight) { const top = tabTop(x, y, z); if (top > z) z = top; }
            return z + leave;
        };
        const rings = pass.kind === 'rings';
        const loops = rings ? this.ringPaths(clipTo, resolution, toolStep) : [];
        if (!rings) {
            // parallel lines toolStep apart across the box, every other one run back
            const a = (pass.angle || 0) * DEG2RAD, dx = Math.cos(a), dy = Math.sin(a);
            const corners = [[box.min.x, box.min.y], [box.max.x, box.min.y], [box.max.x, box.max.y], [box.min.x, box.max.y]];
            const along = corners.map(([x, y]) => x * dx + y * dy), across = corners.map(([x, y]) => -x * dy + y * dx);
            const a0 = Math.min(...along) - step, a1 = Math.max(...along) + step;
            const c0 = Math.min(...across), c1 = Math.max(...across);
            let k = 0;
            for (let c = c0 + toolStep / 2; c < c1; c += toolStep, k++) {
                const p0 = [a0 * dx - c * dy, a0 * dy + c * dx], p1 = [a1 * dx - c * dy, a1 * dy + c * dx];
                loops.push(k % 2 ? [p1, p0] : [p0, p1]);
            }
        }
        // a straight hop from a line's end to the next line's start stays on the surface when it is
        // short and inside the clip outline all the way, so a slanted edge is followed, not lifted over
        const reach = toolStep * 4;
        const hop = (a, b) => {
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (!(len <= reach)) return null;
            const n = Math.max(1, Math.ceil(len / step)), pts = [];
            for (let j = 1; j < n; j++) {
                const x = a.x + (b.x - a.x) * j / n, y = a.y + (b.y - a.y) * j / n;
                if (clipTo && !inside(clipTo, x, y)) return null;
                pts.push(newPoint(x, y, zAt(x, y)));
            }
            return pts;
        };
        let lastLine;
        const total = loops.length || 1;
        const label = rings ? 'contour rings' : 'contour lines';
        onupdate(0, total, label);
        for (let li = 0; li < loops.length; li++) {
            const path = loops[li];
            const lines = [];
            let seg = [], run = [];
            const end = () => { if (seg.length > 1) lines.push(newPolygon().setOpen().addPoints(seg)); seg = []; run = []; };
            // off the straight line from a to p by more than flat (or past its ends)
            const off = (a, p, b) => {
                const ux = p.x - a.x, uy = p.y - a.y, uz = p.z - a.z, uu = ux * ux + uy * uy + uz * uz;
                if (!(uu > 0)) return true;
                const t = ((b.x - a.x) * ux + (b.y - a.y) * uy + (b.z - a.z) * uz) / uu;
                const ex = a.x + ux * t - b.x, ey = a.y + uy * t - b.y, ez = a.z + uz * t - b.z;
                return !(t > 0 && t < 1 && ex * ex + ey * ey + ez * ez < flat * flat);
            };
            // a point is dropped only while every point dropped since the last kept one stays on the
            // straight line to the new one (a long run is cut every 64 points)
            const keep = (x, y, z) => {
                const p = newPoint(x, y, z);
                const n = seg.length;
                if (n >= 2 && run.length < 64) {
                    const a = seg[n - 2], b = seg[n - 1];
                    if (!off(a, p, b) && run.every(q => !off(a, p, q))) { run.push(b); seg[n - 1] = p; return; }
                }
                run = [];
                seg.push(p);
            };
            for (let i = 1; i < path.length; i++) {
                const [x0, y0] = path[i - 1], [x1, y1] = path[i];
                const len = Math.hypot(x1 - x0, y1 - y0);
                const n = Math.max(1, Math.ceil(len / step));
                for (let j = (i === 1 ? 0 : 1); j <= n; j++) {
                    const x = x0 + (x1 - x0) * j / n, y = y0 + (y1 - y0) * j / n;
                    if (clipTo && !inside(clipTo, x, y)) { end(); continue; }
                    keep(x, y, zAt(x, y));
                }
            }
            end();
            if (!rings && lines.length && lastLine) {
                const link = hop(lastLine.last(), lines[0].first());
                if (link) lastLine.addPoints([...link, ...lines.shift().points]);
            }
            if (lines.length) {
                const slice = newSlice(li);
                slice.camLines = lines;
                newslices.push(slice);
            }
            if (!rings) lastLine = lines.length ? lines[lines.length - 1] : lastLine;
            if (li % 16 === 0) onupdate(li, total, label);
        }
    }

    // swarf: rings in from the clip outline, each offset's outlines and holes, the outermost first.
    // A ring runs all the way round, then on along itself while it eases in to the ring inside, and
    // that ring starts where the ease ends: the step-ins spiral round the part instead of lining up.
    // The paths are returned in cutting order and are cut as they run (op-contour.js prepare).
    ringPaths(clipTo, resolution, toolStep) {
        const levels = [];
        let ring = POLY.expand(clipTo, -resolution);
        for (let n = 0; ring && ring.length && n < 100000; n++) {
            const level = [];
            // an outline runs clockwise and a hole's ring counterclockwise, so the surface still to
            // cut is on the bit's right all the way (climb)
            const add = (poly, hole) => {
                const pts = poly.points.map(q => [q.x, q.y]);
                if (pts.length < 3) return;
                let area = 0;
                for (let i = 0; i < pts.length; i++) {
                    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
                    area += x0 * y1 - x1 * y0;
                }
                if (area > 0 !== hole) pts.reverse();
                level.push({ pts, hole, start: 0 });
            };
            for (const poly of ring) {
                add(poly, false);
                for (const inner of poly.inner || []) add(inner, true);
            }
            levels.push(level);
            ring = toolStep > 0 ? POLY.expand(ring, -toolStep) : null;
        }
        const ease = Math.max(toolStep * 8, 4);
        // the point on a loop nearest (x, y), as [segment index, t, distance]
        const nearest = (pts, x, y) => {
            let best = [0, 0, Infinity];
            for (let i = 0; i < pts.length; i++) {
                const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
                const ux = bx - ax, uy = by - ay, uu = ux * ux + uy * uy;
                const t = uu > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / uu)) : 0;
                const d = Math.hypot(ax + ux * t - x, ay + uy * t - y);
                if (d < best[2]) best = [i, t, d];
            }
            return best;
        };
        const at = (pts, i, t) => {
            const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
            return [ax + (bx - ax) * t, ay + (by - ay) * t];
        };
        const out = [];
        // one ring's path; returns the ring of the next level its ease lands on, if any
        const cut = (loop, n) => {
            loop.done = true;
            // the loop from its start round to its start again
            const pts = loop.pts.slice(loop.start).concat(loop.pts.slice(0, loop.start));
            const path = [...pts, pts[0]];
            out.push(path);
            // on along the loop for the ease, drifting in to the nearest loop of the next level
            const head = [];
            let walked = 0;
            for (let i = 1; i <= pts.length && walked < ease; i++) {
                const [x0, y0] = pts[i - 1], [x1, y1] = pts[i % pts.length];
                const len = Math.hypot(x1 - x0, y1 - y0);
                const k = Math.max(1, Math.ceil(len / Math.max(resolution, 0.1)));
                for (let j = 1; j <= k && walked < ease; j++) {
                    walked += len / k;
                    head.push([x0 + (x1 - x0) * j / k, y0 + (y1 - y0) * j / k, walked]);
                }
            }
            if (head.length < 2 || !(walked > 0)) return null;
            const [ex, ey] = head[head.length - 1];
            let into = null, hit;
            for (const cand of levels[n + 1] || []) {
                if (cand.done || cand.hole !== loop.hole) continue;
                const h = nearest(cand.pts, ex, ey);
                if (h[2] <= toolStep * 1.6 && (!hit || h[2] < hit[2])) { into = cand; hit = h; }
            }
            if (!into) return null;
            // where the ring runs on past the next one (a neck or a spike the next level lost) the
            // nearest point of the next ring is far off, and the drift toward it would cut across
            // the gap: then the next ring starts on its own
            const drift = [];
            for (const [x, y, w] of head) {
                const [i, t, d] = nearest(into.pts, x, y);
                if (d > toolStep * 1.6) return null;
                const [qx, qy] = at(into.pts, i, t), f = w / walked;
                drift.push([x + (qx - x) * f, y + (qy - y) * f]);
            }
            path.push(...drift);
            // the next loop starts where the ease lands
            const [i, t] = hit;
            if (t < 1e-6) into.start = i;
            else if (t > 1 - 1e-6) into.start = (i + 1) % into.pts.length;
            else { into.pts.splice(i + 1, 0, at(into.pts, i, t)); into.start = i + 1; }
            return into;
        };
        // each ring is followed through the rings it eases into, so the paths come out in the order
        // they are cut: one run of rings level by level (an outline's inward, a hole's outward), then
        // the next run
        for (let n = 0; n < levels.length; n++) {
            for (const first of levels[n]) {
                for (let loop = first.done ? null : first, k = n; loop; k++) loop = cut(loop, k);
            }
        }
        return out;
    }

    async raster(widget, params, onupdate) {
        const { resolution } = params;
        const { box } = params;
        const { dispatch, minions } = self.kiri_worker;

        const vertices = widget.getGeoVertices({ unroll: true, translate: true }).toShared();
        const range = { min: Infinity, max: -Infinity };

        // swap XZ in shared array
        for (let i = 0, l = vertices.length; i < l; i += 3) {
            const x = vertices[i];
            const z = vertices[i + 2];
            vertices[i] = z;
            vertices[i + 2] = x;
            range.min = Math.min(range.min, x);
            range.max = Math.max(range.max, x);
        }

        const shards = Math.ceil(Math.min(25, vertices.length / 27000));
        const step = (range.max - range.min) / shards;

        let slices = [];
        let index = 0;
        let slice = { min: range.min, max: range.min + step, index };
        for (let z = range.min; z < range.max; z += resolution) {
            if (z > slice.max) {
                slices.push(slice);
                slice = { min: z, max: z + step, index };
            }
            index++;
        }
        slices.push(slice);
        // console.log({ shards, range, step, slices });

        let complete = 0;
        // define sharded ranges
        if (hasSharedArrays && minions.running > 1) {

            dispatch.putCache({ key: widget.id, data: vertices }, {
                done: data => {
                    // console.log({ put_cache_done: data });
                }
            });

            let promises = slices.map(slice => {
                return new Promise(resolve => {
                    minions.queue({
                        cmd: "topo_raster",
                        id: widget.id,
                        params,
                        slice
                    }, data => {
                        resolve(data);
                        onupdate(++complete, slices.length, "raster");
                    });
                });
            });

            // merge boxes for all rasters for contouring clipping
            (await Promise.all(promises))
                .map(rec => rec.box)
                .map(box => new THREE.Box2(
                    new THREE.Vector2(box.min.x, box.min.y),
                    new THREE.Vector2(box.max.x, box.max.y)
                ))
                .map(box2 => {
                    box.union(box2);
                    return box2;
                });

            dispatch.clearCache({}, {
                done: data => {
                    // console.log({ clear_cache_done: data });
                }
            });

        } else {

            // iterate over shards, merge output
            // const output = [];
            for (let slice of slices) {
                new topo_slicer(slice.index)
                    .setFromArray(vertices, slice)
                    .slice(resolution)
                    .map(rec => {

                        const slice = newSlice(rec.z);
                        slice.index = rec.index;
                        slice.lines = rec.lines;
                        for (let line of rec.lines) {
                            const { p1, p2 } = line;
                            if (!p1.swapped) { p1.swapXZ(); p1.swapped = true }
                            if (!p2.swapped) { p2.swapXZ(); p2.swapped = true }
                        }

                        raster_slice({
                            ...params,
                            box,
                            lines: rec.lines,
                            gridx: rec.index,
                            slice
                        });

                        return slice;
                    });
                onupdate(++complete, slices.length, "raster");
            }

        }
    }

    async contour(params, onupdate) {
        const trace = this.trace;
        const concurrent = hasSharedArrays ? self.kiri_worker.minions.running : 0;

        const { minX, maxX, minY, maxY, boundsX, boundsY, stepsX, stepsY } = params;
        const { gridDelta, resolution, density, partOff, toolStep, contourX, contourY } = params;
        const { clipTo, clipTab, clipTabZ, tabHeight, newslices, leave } = params;

        let stepsTaken = 0,
            stepsTotal = 0;

        if (contourX) {
            stepsTotal += ((maxY - minY + partOff * 2) / toolStep) | 0;
        }

        if (contourY) {
            stepsTotal += ((maxX - minX + partOff * 2) / toolStep) | 0;
        }

        if (stepsTotal === 0) {
            return;
        }

        const box = params.box.clone().expandByVector(new THREE.Vector3(
            partOff, partOff, 0
        ));

        trace.init({
            box,
            leave,
            clipTo,
            clipTab,
            clipTabZ,
            tabHeight,
            resolution,
            concurrent,
            density
        });

        let resolver;
        let pcount = 0;
        let slicesY = [];
        let slicesX = [];
        let promise = new Promise(resolve => {
            resolver = () => {
                // sort output slices (required for async)
                slicesY.sort((a, b) => a.z - b.z);
                slicesX.sort((a, b) => a.z - b.z);
                newslices.appendAll(slicesY);
                newslices.appendAll(slicesX);
                resolve();
            }
        });
        let inc = () => { pcount++ };
        let dec = () => { if (--pcount === 0 && concurrent) resolver() };

        if (contourY) {
            onupdate(0, stepsTotal, "contour y");
            // emit slice per X
            for (let x = minX - partOff; x <= maxX + partOff; x += toolStep) {
                if (x < box.min.x || x > box.max.x) continue;
                const gridx = Math.round(((x - minX) / boundsX) * stepsX);
                const gridy = -gridDelta;
                inc();
                trace.crossY({
                    from: minY - partOff,
                    to: maxY + partOff,
                    x,
                    gridx,
                    gridy
                }, segments => {
                    if (segments.length > 0) {
                        let slice = newSlice(x);
                        slice.camLines = segments;
                        slicesY.push(slice);
                    }
                    onupdate(++stepsTaken, stepsTotal, "contour y");
                    dec();
                });
            }
        }

        if (contourX) {
            // emit slice per Y
            onupdate(0, stepsTotal, "contour x");
            for (let y = minY - partOff; y <= maxY + partOff; y += toolStep) {
                if (y < box.min.y || y > box.max.y) continue;
                const gridy = Math.round(((y - minY) / boundsY) * stepsY);
                const gridx = -gridDelta;
                inc();
                trace.crossX({
                    from: minX - partOff,
                    to: maxX + partOff,
                    y,
                    gridx,
                    gridy
                }, segments => {
                    if (segments.length > 0) {
                        let slice = newSlice(y);
                        slice.camLines = segments;
                        slicesX.push(slice);
                    }
                    onupdate(++stepsTaken, stepsTotal, "contour x");
                    dec();
                });
            }
        }

        if (!concurrent) resolver();

        await promise;

        // const lines = newslices.map(s => (s.camLines || []).map(p => p.length));
        // const points = lines.flat().reduce((a,b) => a+b);
        // console.log({ lines, points });

        trace.cleanup();
    }

}

export class Probe {

    constructor(params) {

        const { data, profile } = params;
        const { stepsX, stepsY, boundsX, zMin, minX, minY } = params;

        this.params = params;

        // return the touching z given topo x,y and a tool profile
        const toolAtZ = this.toolAtZ = function (x, y) {
            let sx = stepsX,
                sy = stepsY,
                xl = sx - 1,
                yl = sy - 1;

            let gv, i = 0, mz = -Infinity;

            while (i < profile.length) {
                // tool profile point x, y, and z offsets
                const tx = profile[i++] + x;
                const ty = profile[i++] + y;
                const tz = profile[i++];
                if (tx < 0 || tx > xl || ty < 0 || ty > yl) {
                    // if outside max topo steps, use zMin
                    gv = zMin;
                } else {
                    // lookup grid value @ tx, ty
                    gv = data[tx * sy + ty] || zMin;
                }
                // update the rest
                mz = Math.max(tz + gv, mz);
            }

            return Math.max(mz, zMin);
        }

        // export z probe function
        const rx = stepsX / boundsX;
        const ry = stepsX / boundsX;
        const toolAtXY = this.toolAtXY = function (px, py) {
            px = Math.round(rx * (px - minX));
            py = Math.round(ry * (py - minY));
            return toolAtZ(px, py);
        };

        const zAtXY = this.zAtXY = function (px, py) {
            let ix = Math.round(rx * (px - minX));
            let iy = Math.round(ry * (py - minY));
            return data[ix * stepsY + iy] || zMin;
        };
    }

}

export class Trace {

    constructor(probe, params) {

        const { curvesOnly, maxangle, flatness, bridge, contourX, leave } = params;

        this.params = params;
        this.probe = probe;

        let trace,
            slice,
            latent,
            lastPP,
            lastSlope;

        const newslice = this.newslice = () => {
            this.slice = slice = [];
        }

        const newtrace = this.newtrace = function () {
            trace = newPolygon().setOpen();
        }

        const end_poly = this.end_poly = function (point) {
            if (latent) {
                trace.push(latent);
            }
            if (trace.length > 0) {
                // add additional constraint on min perimeter()
                if (trace.length > 1) {
                    slice.push(trace);
                }
                newtrace();
            }
            lastPP = undefined;
            latent = undefined;
            lastSlope = undefined;
            if (point) {
                trace.push(point);
                lastPP = point;
            }
        }

        const log = function (map) {
            for (let key in map) {
                const val = map[key];
                if (typeof val === 'number') {
                    map[key] = val.round(4);
                }
            }
            console.log(...arguments);
        }

        this.push_point = function (x, y, z) {
            const newP = newPoint(x, y, z);
            const lastP = lastPP;

            if (lastP) {
                const dl = (x - lastP.x) || (y - lastP.y);
                const dz = z - lastP.z;
                const slope = Math.atan2(dz, dl);
                if (curvesOnly && Math.abs(dz) < flatness) {
                    end_poly(newP);
                } else if (lastSlope !== undefined && Math.abs(lastSlope - slope) < flatness) {
                    latent = newP;
                } else {
                    if (latent) {
                        trace.push(latent);
                        latent = undefined;
                    }
                    if (curvesOnly) {
                        const dv = contourX ? Math.abs(lastP.x - x) : Math.abs(lastP.y - y);
                        const angle = Math.atan2(Math.abs(dz), dv) * RAD2DEG;
                        if (angle > maxangle) {
                            end_poly();
                        }
                    }
                    trace.push(newP);
                }
                lastSlope = slope;
            } else {
                trace.push(newP);
            }

            lastPP = newP;
        }

        const object = this.object = this;

        this.inClip = function (clips, checkZ, point) {
            let ok = 0,
                tabZ = -Infinity;
            for (let i = 0; i < clips.length; i++) {
                let poly = clips[i];
                let zok = checkZ !== undefined ? checkZ <= poly.z : true;
                if (zok && point.isInPolygon(poly)) {
                    ok++;
                    tabZ = Math.max(tabZ, poly.z);
                }
            }
            if (ok > 0) {
                object.tabZ = tabZ;
            }
            return ok > 0;
        }

    }

    init(params) {
        this.cross = params;
        const { minions } = self.kiri_worker ?? {};
        const { clipTab, clipTabZ } = params;

        // because codec does not encode arbitrary fields
        // in this case, z is appended to clip tabs in topo constructor
        // we pass it as a side-channel and re-consitute here
        if (clipTab)
            for (let i = 0, l = clipTab.length; i < l; i++) {
                clipTab[i].z = clipTabZ[i];
            }

        if (minions && this.cross.concurrent) {
            minions.broadcast("trace_init", codec.encode({
                probe: this.probe.params,
                trace: this.params,
                cross: params,
            }));
        }
    }

    cleanup() {
        const { minions } = self.kiri_worker;

        if (minions && this.cross.concurrent) {
            minions.broadcast("trace_cleanup");
        }
    }

    crossY(params, then) {
        const { minions } = self.kiri_worker;

        if (minions && this.cross.concurrent) {
            minions.queue({
                cmd: "trace_y",
                params
            }, data => {
                then(codec.decode(data.slice));
            });
        } else {
            this.crossY_sync(params, then);
        }
    }

    crossX(params, then) {
        const { minions } = self.kiri_worker;

        if (minions && this.cross.concurrent) {
            minions.queue({
                cmd: "trace_x",
                params
            }, data => {
                then(codec.decode(data.slice));
            });
        } else {
            this.crossX_sync(params, then);
        }
    }

    crossY_sync(params, then) {
        const { push_point, end_poly, newtrace, newslice, inClip } = this.object;
        const { clipTab, tabHeight, clipTo, box, resolution, density, leave } = this.cross;
        const { toolAtZ } = this.probe;

        let { from, to, x, gridx, gridy } = params;

        const step = resolution * density;
        const checkr = newPoint(0, 0);
        newslice();
        newtrace();
        for (let y = from; y < to; y += step) {
            if (y < box.min.y || y > box.max.y) {
                gridy += density;
                continue;
            }
            // find tool z at grid point
            let tv = toolAtZ(gridx, gridy);
            checkr.x = x;
            checkr.y = y;
            // when tabs are on and this point is inside the
            // tab polygon, ensure z is at least tabHeight
            if (clipTab && clipTab.length && tv < tabHeight && inClip(clipTab, tv, checkr)) {
                tv = this.tabZ;
            }
            // if the value is on the floor and inside the clip
            // poly (usually shadow), end the segment
            if (clipTo && !inClip(clipTo, undefined, checkr)) {
                end_poly();
                gridy += density;
                continue;
            }
            push_point(x, y, tv + leave);
            gridy += density;
        }
        end_poly();
        then(this.slice);
    }

    crossX_sync(params, then) {
        const { push_point, end_poly, newtrace, newslice, inClip } = this.object;
        const { clipTab, tabHeight, clipTo, box, resolution, density, leave } = this.cross;
        const { toolAtZ } = this.probe;
        let { from, to, y, gridx, gridy } = params;

        const step = resolution * density;
        const checkr = newPoint(0, 0);
        newslice();
        newtrace();
        for (let x = from; x < to; x += step) {
            if (x < box.min.x || x > box.max.x) {
                gridx += density;
                continue;
            }
            // find tool z at grid point
            let tv = toolAtZ(gridx, gridy);
            checkr.x = x;
            checkr.y = y;
            // when tabs are on and this point is inside the
            // tab polygon, ensure z is at least tabHeight
            if (clipTab && clipTab.length && tv < tabHeight && inClip(clipTab, tv, checkr)) {
                tv = this.tabZ;
            }
            // if the value is on the floor and inside the clip
            // poly (usually shadow), end the segment
            if (clipTo && !inClip(clipTo, undefined, checkr)) {
                end_poly();
                gridx += density;
                continue;
            }
            push_point(x, y, tv + leave);
            gridx += density;
        }
        end_poly();
        then(this.slice);
    }
}

export function raster_slice(inputs) {
    const { lines, data, box, resolution, curvesOnly } = inputs;
    const { flatness, zMin, minY, maxY, stepsY, gridx } = inputs;
    const { slice } = inputs;

    let gridy,
        gridi, // index
        gridv, // value
        i, il, j, x, y, tv;

    // filter lines pairs to only surface "up-facing", "uncovered" lines
    let points = [];
    // emit an array of valid line-pairs
    const len = lines.length;

    outer: for (let i = 0; i < len; i++) {
        let l1 = lines[i], p1 = l1.p1, p2 = l1.p2;
        // eliminate vertical
        if (Math.abs(p1.y - p2.y) < flatness) continue;
        // eliminate if both points below cutoff
        if (p1.z < zMin && p2.z < zMin) continue;
        // sort p1,p2 by y for comparison
        if (p1.y > p2.y) { const tp = p1; p1 = p2; p2 = tp };
        // eliminate if points "under" other lines
        for (let j = 0; j < len; j++) {
            // skip self and adjacent
            if (j >= i - 1 && j <= i + 1) continue;
            let l2 = lines[j], p3 = l2.p1, p4 = l2.p2;
            // sort p3,p4 by y for comparison
            if (p3.y > p4.y) { const tp = p3; p3 = p4; p4 = tp };
            // it's under the other line
            if (Math.max(p1.z, p2.z) < Math.min(p3.z, p4.z)) {
                // it's inside the other line, too, so skip
                if (p1.y >= p3.y && p2.y <= p4.y) continue outer;
            }
        }
        points.push(p1, p2);
        box.expandByPoint(p1);
        box.expandByPoint(p2);
    }

    gridy = 0;
    // rasterize one x slice
    for (y = minY; y < maxY && gridy < stepsY; y += resolution) {
        gridi = gridx * stepsY + gridy;
        gridv = data[gridi] || zMin;
        // strategy using raw lines (faster slice, but more lines)
        for (i = 0, il = points.length; i < il; i += 2) {
            const p1 = points[i], p2 = points[i + 1];
            // one endpoint above grid
            const crossz = (p1.z > gridv || p2.z > gridv);
            // segment crosses grid y
            const spansy = (p1.y <= y && p2.y >= y);
            if (crossz && spansy) {
                // compute intersection of z ray up
                // and segment at this grid point
                const dy = p1.y - p2.y,
                    dz = p1.z - p2.z,
                    pct = (p1.y - y) / dy,
                    nz = p1.z - (dz * pct);
                // save if point is greater than existing grid point
                if (nz > gridv) {
                    gridv = data[gridi] = Math.max(nz, zMin);
                    if (slice) slice.output()
                        .setLayer("heights", { face: 0, line: 0 })
                        .addLine(
                            newPoint(p1.x, y, 0),
                            newPoint(p1.x, y, gridv)
                        );
                }
            }
        }
        gridy++;
    }

    // remove flat lines when curvesOnly
    if (curvesOnly) {
        let nup = [];
        for (let i = 0, p = points, l = p.length; i < l; i += 2) {
            const p1 = p[i];
            const p2 = p[i + 1];
            if (Math.abs(p1.z - p2.z) >= flatness) {
                nup.push(p1, p2);
            }
        }
        points = nup;
    }

    return points;
};

export async function generate(opt) {
    return new Topo().generate(opt);
}
