/** swarf: the texture step — a mark made in TEX, cut into its part's top */

import { CamOp } from '../core/op.js';
import { newPolygon } from '../../../../geo/polygon.js';
import { newSlice } from '../../../core/slice.js';
import { newPoint } from '../../../../geo/point.js';
import TEX from '../../../../../web/kiri/swarf-tex-core.mjs';

// One step per mark (op.texmark). TEX fills op.marks[widget.id] on the main thread when the
// toolpaths are made (swarf-tex.js, slice.begin): the mark in its part's frame, the part's top
// and its thickness. The core's drop cutter makes the moves; each run of cutting is emitted as
// it is, and the travel between runs goes up to safe height and over, never across the board.
class OpTexture extends CamOp {
    constructor(state, op) {
        super(state, op);
    }

    weight() {
        return 4;
    }

    async slice(progress) {
        let { op, state } = this;
        let { widget, addSlices, color, updateToolDiams, tool } = state;
        let list = (op.marks && op.marks[widget.id]) || [];
        let runs = this.runs = [];
        if (!list.length) return;
        if (tool && updateToolDiams) updateToolDiams(tool.fluteDiameter());
        let top = 0;
        for (let i = 0; i < list.length; i++) {
            let { mark, thick, part } = list[i];
            top = list[i].top;
            // on its part's top, full to its edges, the bit reaching past them (swarf-tex-core clipToPart)
            let path = TEX.markToolpath(mark, { maxDepth: thick, stepDown: op.down > 0 ? op.down : 0, part });
            for (let run of TEX.feedRuns(path.moves)) {
                runs.push(run.map(([x, y, z]) => newPoint(x, y, top + z)));
            }
            progress((i + 1) / list.length, 'texture');
        }
        if (!runs.length) return;
        let polys = runs.map(run => {
            let poly = newPolygon().setOpen();
            for (let p of run) poly.add(p.x, p.y, p.z);
            return poly;
        });
        let slice = newSlice(top);
        slice.camLines = polys;
        slice.output()
            .setLayer(state.layername, { line: color }, false)
            .addPolys(polys);
        addSlices(slice);
    }

    prepare(ops, progress) {
        let { runs } = this;
        if (!(runs && runs.length)) return;
        let { camOut, clearTravelBounds, getLastPoint, toWidgetCoords, zSafe } = ops;
        // the last op's travel boundaries say nothing about these moves
        clearTravelBounds();
        clearTravelBounds();
        let safe = toWidgetCoords(newPoint(0, 0, zSafe)).z;
        for (let i = 0; i < runs.length; i++) {
            let run = runs[i], first = run[0], last = getLastPoint();
            if (last.z < safe) camOut(newPoint(last.x, last.y, safe), 0);
            camOut(newPoint(first.x, first.y, safe), 0);
            for (let p of run) camOut(p, 1);
            progress((i + 1) / runs.length, 'texture');
        }
        let end = getLastPoint();
        camOut(newPoint(end.x, end.y, safe), 0);
    }
}

export { OpTexture };
