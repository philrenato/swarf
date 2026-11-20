/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { CamOp } from '../core/op.js';
import { OpArea } from './op-area.js';

class OpOutline extends CamOp {
    constructor(state, op) {
        super(state, op);
    }

    async slice(progress) {
        let { op, state } = this;
        let { direction, dogbones, down, inside, omitthru, omitvoid, outside } = op;
        let { ov_botz, ov_topz, plunge, rate, rename, revbones, spindle, tool } = op;
        let { shadow, widget } = state;

        let shadow_base = shadow.base;
        if (!(shadow_base && shadow_base.length)) {
            throw 'missing shadow base';
        }

        let ops_list = this.ops_list = [ ];
        // swarf: an allowance left on these passes, and a last pass at the true size (VCarve's profile)
        let leave = op.leave > 0 ? { leave_xy: op.leave } : {};
        // swarf: a cut-out goes on past the board's bottom into the spoilboard (up to 2 mm), so a board a
        // little thicker than typed is still cut free. Not for holes alone, nor a step with its own bottom.
        let proc = state.settings.process;
        let past = 0;
        if ((outside || !inside) && !ov_botz && !proc.camZBottom && !proc.camStockIndexed) {
            past = Math.max(0, Math.min(2, +(op.thru ?? proc.camOutlineThru ?? 0) || 0));
        }
        let deep = past ? { past_z: past } : {};

        if (outside) {
            let areas = shadow.base.clone(true);
            ops_list.push(new OpArea(state, {
                areas: { [widget.id]: areas.map(p => p.toArray()) },
                ...leave,
                ...deep,
                // the card's feed for an outline already allows for a full-width pass
                fullFeed: true,
                base: true,
                direction,
                dogbones,
                down,
                drape: true,
                expand: 0,
                mode: 'trace',
                omitinner: omitvoid,
                omitthru,
                ov_botz,
                ov_topz,
                over: op.wide ? op.step : 0,
                plunge,
                rate,
                rename: rename ?? "outline",
                revbones,
                rotated: true,
                smooth: 0,
                spindle,
                steps: op.wide ? op.steps + 1 : 1,
                surfaces: {},
                tool,
                thru: true,
                tr_type: 'outside',
            }));
        } else {
            let areas = shadow.base.clone(true);
            ops_list.push(new OpArea(state, {
                ...leave,
                ...deep,
                // the card's feed for an outline already allows for a full-width pass
                fullFeed: true,
                areas: { [widget.id]: areas.map(p => p.toArray()) },
                direction,
                dogbones,
                down,
                drape: true,
                expand: 0,
                mode: 'trace',
                omitinner: omitvoid,
                omitouter: inside,
                omitthru,
                ov_botz,
                ov_topz,
                plunge,
                rate,
                rename: rename ?? "outline",
                revbones,
                rotated: true,
                smooth: 0,
                spindle,
                surfaces: {},
                tool,
                thru: true,
                tr_type: 'outside',
            }));
        }

        if (op.lastpass) {
            ops_list.push(new OpArea(state, {
                areas: { [widget.id]: shadow.base.clone(true).map(p => p.toArray()) },
                ...deep,
                // the card's feed for an outline already allows for a full-width pass
                fullFeed: true,
                base: outside ? true : undefined,
                direction,
                dogbones,
                down,
                drape: true,
                expand: 0,
                mode: 'trace',
                omitinner: omitvoid,
                omitouter: outside ? undefined : inside,
                omitthru,
                ov_botz,
                ov_topz,
                plunge,
                rate,
                rename: rename ?? "outline",
                revbones,
                rotated: true,
                skim: op.leave > 0 ? op.leave : 0,
                smooth: 0,
                spindle,
                surfaces: {},
                tool,
                thru: true,
                tr_type: 'outside',
            }));
        }

        for (let op of this.ops_list) {
            await op.slice(progress);
        }
    }

    async prepare(ops, progress) {
        for (let op of this.ops_list) {
            await op.prepare(ops, progress);
        }
    }
}

export { OpOutline };
