/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { CamOp } from '../core/op.js';
import { Tool } from '../core/tool.js';
import { generate as Topo } from './topo3.js';
import { newPoint } from '../../../../geo/point.js';
import { newPolygon } from '../../../../geo/polygon.js';
import { newSlice } from '../../../core/slice.js';
import { tip2tipEmit } from '../../../../geo/paths.js';

// swarf: the contour's pattern. lines run one way (lineAngle: 0 along X, 90 along Y, any angle
// between), cross runs them twice at right angles, perimeter follows the part's edge in rings that
// step inward. Lines along X or Y are Kiri's own contour walk; any other angle, and the rings, are
// paths of their own sampled on the same raster (topo3 paths2d), with the same clip, tabs and floor.
export function contourPlan(op) {
    const pattern = ['cross', 'perimeter'].includes(op.pattern) ? op.pattern : 'lines';
    let angle = Number.isFinite(+op.lineAngle) && op.lineAngle !== null && op.lineAngle !== '' ? +op.lineAngle : (String(op.axis).toUpperCase() === 'Y' ? 90 : 0);
    angle = ((angle % 180) + 180) % 180;
    const square = a => Math.abs(a) < 1e-6 ? 'X' : Math.abs(a - 90) < 1e-6 ? 'Y' : null;
    if (pattern === 'perimeter') return [{ kind: 'rings' }];
    const angles = pattern === 'cross' ? [angle, (angle + 90) % 180] : [angle];
    return angles.map(a => square(a) ? { kind: 'topo', axis: square(a) } : { kind: 'lines', angle: a });
}

function createFilter(op, origin, axis) {
    // console.log({ origin, axis });
    let ok = () => true;
    let filter = slices => slices;
    let filterString = op.filter?.map(l => l.trim()).join('\n');
    if (filterString) {
        try {
            const obj = eval(`( ${filterString} )`);
            let box = obj?.box;
            let slice_fn = obj?.slices;
            let index = 0;
            const accept = [];
            filter = function (slices) {
                for (let slice of slices.filter(s => s.camLines)) {
                    if (slice_fn && slice_fn(slice, index++)) {
                        accept.push(slice);
                    } else if (box) {
                        // slice.z = x when axis = y
                        // slice.z = y when axis = x
                        let { x, y, z } = box;
                        x = x ?? [ -Infinity, Infinity ];
                        y = y ?? [ -Infinity, Infinity ];
                        z = z ?? [ -Infinity, Infinity ];
                        let ok = false;
                        if (axis === 'x') {
                            let sy = slice.z + origin.y;
                            if (sy >= y[0] && sy <= y[1]) {
                                ok = true;
                                for (let p of slice.camLines) {
                                    p.points = p.points.filter(p =>
                                        p.x - origin.x >= x[0] && p.x - origin.x <= x[1] &&
                                        p.z - origin.z >= z[0] && p.z - origin.z <= z[1]
                                    );
                                }
                            }
                        } else {
                            let sx = slice.z - origin.x;
                            if (sx >= x[0] && sx <= x[1]) {
                                ok = true;
                                for (let p of slice.camLines) {
                                    p.points = p.points.filter(p =>
                                        p.y + origin.y >= y[0] && p.y + origin.y <= y[1] &&
                                        p.z - origin.z >= z[0] && p.z - origin.z <= z[1]
                                    );
                                }
                            }
                        }
                        if (ok) {
                            slice.camLines = slice.camLines.map(p => {
                                if (p.points.length > 1) {
                                    return newPolygon(p.points).setOpen(true);
                                } else {
                                    return undefined;
                                }
                            }).filter(p => p);
                            accept.push(slice);
                        }
                    }
                }
                return accept;
            };
        } catch (e) {
            console.log('filter parse error', e, op.filter);
        }
    }
    return filter;
}

class OpContour extends CamOp {
    constructor(state, op) {
        super(state, op);
    }

    async slice(progress) {
        const plan = contourPlan(this.op);
        // one pass of Kiri's own contour, as it always was
        if (plan.length === 1 && plan[0].kind === 'topo' && !this.sub) {
            this.op = { ...this.op, axis: plan[0].axis };
            return this.sliceTopo(progress);
        }
        // otherwise each pass is its own contour, in order
        const { op, state } = this;
        const parts = this.parts = [];
        for (const pass of plan) {
            const sub = pass.kind === 'topo'
                ? new OpContour(state, { ...op, pattern: 'lines', lineAngle: pass.axis === 'Y' ? 90 : 0, axis: pass.axis })
                : new OpContour(state, { ...op, axis: 'X', trace2d: pass, layer: pass.kind === 'rings' ? 'contour rings' : `contour ${Math.round(pass.angle)}°` });
            sub.sub = true;
            parts.push(sub);
        }
        const per = 1 / parts.length;
        let base = 0;
        for (const part of parts) {
            await part.sliceTopo(pct => progress(base + pct * per));
            base += per;
        }
    }

    async sliceTopo(progress) {
        let { op, state } = this;
        let { color, addSlices, settings, updateToolDiams } = state;

        let conTool = new Tool(settings, op.tool);
        let filter = createFilter(op, settings.origin, op.axis.toLowerCase());
        let toolDiam = this.toolDiam = conTool.fluteDiameter();
        this.toolStep = conTool.getStepSize(op.step);

        updateToolDiams(toolDiam);

        // we need topo for safe travel moves when roughing and outlining
        // not generated when drilling-only. then all z moves use bounds max.
        // also generates x and y contouring when selected
        let topo = this.topo = await Topo({
            // onupdate: (update, msg) => {
            onupdate: (index, total, msg) => {
                progress(index / total, msg);
            },
            ondone: (slices) => {
                slices = filter(slices);
                this.sliceOut = slices;
                addSlices(slices);
                for (let slice of slices) {
                    slice.output()
                        .setLayer(op.layer || `contour ${op.axis}`, { face: color, line: color })
                        .addPolys(slice.camLines);
                }
            },
            contour: op,
            state
        });

        if (this.debug && topo.coastline) {
            console.log('coastline', topo.coastline);
            const dbs = newSlice(-1);
            const dbo = dbs.output();
            dbo.setLayer("coastline", { line: 0x0000dd }).addPolys(topo.coastline);
            addSlices([ dbs ])
        }

        // computed if set to 0
        this.tolerance = topo.tolerance;
    }

    async prepare(ops, progress) {
        if (this.parts) {
            const per = 1 / this.parts.length;
            let base = 0;
            for (const part of this.parts) {
                await part.prepare(ops, pct => progress(base + pct * per));
                base += per;
                ops.setChangeOp && ops.setChangeOp();
            }
            return;
        }
        let { op, sliceOut, state, toolStep, topo } = this;
        let { settings } = state;
        let { process } = settings;

        let { polyEmit, setContouring, setTolerance, setTool } = ops;
        let { widget, newLayer, zmax } = ops;

        let bounds = widget.getBoundingBox();
        let depthData = [];

        setTool(op.tool, op.rate, process.camFastFeedZ);
        setContouring(true, toolStep * 1.5, topo.coastline);
        setTolerance(this.tolerance);

        let printPoint = newPoint(bounds.min.x, bounds.min.y, zmax);

        for (let slice of sliceOut) {
            // ignore debug slices
            if (!slice.camLines) {
                continue;
            }
            let polys = [], poly;
            slice.camLines.forEach((poly) => {
                poly = poly.clone(true).annotate({ slice: slice.index + 1 });
                polys.push({ first: poly.first(), last: poly.last(), poly: poly });
            });
            depthData.appendAll(polys);
        }

        tip2tipEmit(depthData, printPoint, (el, point) => {
            let poly = el.poly;
            if (poly.last() === point) {
                poly.reverse();
            }
            polyEmit(poly);
            newLayer();
        });
    }
}

export { OpContour };