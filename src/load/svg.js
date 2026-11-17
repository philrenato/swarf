/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { newPolygon } from '../geo/polygon.js';
import { newPoint } from '../geo/point.js';
import { polygons } from '../geo/polygons.js';
import { THREE } from '../ext/three.js';

// points per curve at most: a huge circle is drawn in chords that grow, not in more of them
const SEG_MAX = 4096;

export function parseAsync(text, opt) {
    return new Promise((resolve,reject) => {
        resolve(parse(text, opt));
    });
}

export function parse(text, opt = { }) {
    const justPoly = opt.flat || false;
    const fromSoup = opt.soup !== false || justPoly;
    const rez = (opt.resolution || 1);
    const dpi = (opt.dpi || 0);
    const segmin = Math.max(1, opt.segmin || 10);
    const objs = [];
    const polys = [];
    let data;
    try {
        data = new THREE.SVGLoader().parse(text);
    } catch (e) {
        // a drawing the reader cannot follow (a path that starts with an arc, not a move) makes nothing
        return objs;
    }
    const paths = data.paths;
    const xmlat = data.xml?.attributes || {};
    const isinch = xmlat.width?.value.endsWith('in');
    const scale = isinch ? 25.4 : (dpi ? 1 / (dpi / 25.4) : 1);
    const depth = parseFloat(opt.depth || xmlat['data-km-extrude']?.value
        || xmlat['extrude']?.value
        || 5);

    for (let i = 0; i < paths.length; i++) {
        let path = paths[i];
        let type = path.userData?.node?.nodeName;
        let width = path.userData?.style?.strokeWidth;
        let miter = path.userData?.style?.strokeMiterLimit;
        for (let sub of path.subPaths) {
            let points = sub.curves.map(curve => {
                if (curve.type === 'LineCurve') {
                    return curve.getPoints(1);
                }
                let segs = Math.ceil(curve.getLength() * rez);
                segs = Number.isFinite(segs) ? Math.min(Math.max(segs, segmin), SEG_MAX) : segmin;
                return curve.getPoints(segs);
            }).flat();
            if (points.length < 3 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
                continue;
            }
            let poly = newPolygon().addPoints(points.map(p => newPoint(p.x, -p.y, 0))).clean();
            if (poly.appearsClosed()) poly.points.pop();
            if (type === 'polyline') poly.setOpen(true);
            poly._svg = { width, miter };
            polys.push(poly);
            if (scale !== 1) {
                poly.scale({ x: scale, y: scale, z: 1 });
            }
        }
    }

    const sub = fromSoup ? polygons.nest(polys) : polys;
    const nest = sub.filter(p => {
        for (let pc of polys) {
            if (pc === p) {
                return true;
            } else {
                return !pc.isEquivalent(p);
            }
        }
    });

    if (justPoly) {
        return nest;
    }

    for (let poly of nest) {
        let obj = poly.extrude(depth);
        objs.push(obj);
    }

    return objs;
}
