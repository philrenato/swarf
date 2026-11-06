/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { CamOp } from '../core/op.js';
import { Tool } from '../core/tool.js';
import { newPolygon } from '../../../../geo/polygon.js';
import { newSlice } from '../../../core/slice.js';
import { newPoint } from '../../../../geo/point.js';
import { roundHoles, holeFit } from '../app/round-holes.js';

class OpDrill extends CamOp {
    constructor(state, op) {
        super(state, op);
    }

    async slice(progress) {
        let { op, state } = this;
        let { color, settings, addSlices, widget, updateToolDiams, zBottom } = state;
        let { drills } = op

        let drillTool = new Tool(settings, op.tool),
            drillToolDiam = drillTool.fluteDiameter(),
            sliceOut = this.sliceOut = [];

        // swarf: with no holes picked on this part, the step drills the round holes the bit fits
        // (review 105 B0c: a student who drew circles got an empty step)
        const allDrills = drills[widget.id] ?? this.found(drillToolDiam);
        if (allDrills.length === 0) return;

        updateToolDiams(drillToolDiam);

        // drill points to use center (average of all points) of the polygon
        allDrills.forEach((drill) => {
            if (!drill.selected) {
                return
            }

            let slice = newSlice(0);
            if (op.mark) {
                // replace depth with single down peck
                drill.depth = op.down
            }

            drill.zBottom = drill.z - drill.depth;

            // honor zBottom when set
            if (zBottom) drill.zBottom = Math.max(zBottom, drill.zBottom);

            // for thru holes, follow z thru when set
            if (op.thru > 0 && !op.mark && !drill.found) {
                drill.zBottom -= op.thru;
            }

            const poly = newPolygon()
            poly.points.push(newPoint(drill.x, drill.y, drill.z))
            poly.points.push(newPoint(drill.x, drill.y, drill.zBottom))

            slice.camTrace = { tool: op.tool, rate: op.feed, plunge: op.rate };
            slice.camLines = [poly];
            slice.travelBounds = newPolygon().centerCircle(drill, drillToolDiam, 10);
            slice.output()
                .setLayer(state.layername, { face: color, line: color })
                .addPolys(slice.camLines);

            addSlices(slice);
            sliceOut.push(slice);
        });
    }

    // the holes this bit drills, from the top of the board down to the board's bottom or a blind
    // hole's floor, where an outline ends too (no spoilboard allowance)
    found(bit) {
        const { widget, workarea } = this.state;
        const { holes, zmax } = roundHoles(widget.getGeoVertices({ unroll: true, translate: true }));
        return holes.filter(h => holeFit(h.d, bit) === 'fits').map(h => {
            const bottom = h.floor === null ? workarea.bottom_z : Math.max(workarea.bottom_z, workarea.top_part - (zmax - h.floor));
            return { x: h.x, y: h.y, z: workarea.top_z, depth: workarea.top_z - bottom, selected: true, found: true };
        });
    }

    prepare(ops, progress) {
        let { op, sliceOut } = this;
        let { setTool, setSpindle, setDrill, emitDrills, setTravelBoundary } = ops;

        if (sliceOut.length === 0) return;

        setTool(op.tool, undefined, op.rate);
        setDrill(op.down, op.lift, op.dwell);
        setTravelBoundary(sliceOut.map(slice => slice.travelBounds));
        emitDrills(sliceOut.map(slice => slice.camLines).flat());
    }
}

export { OpDrill };
