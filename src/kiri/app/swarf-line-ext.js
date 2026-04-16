/**
 * swarf v010 r6 — expose three.js fat-line classes on window so
 * swarf-lightstream.js (served as a plain <script>, not bundled) can
 * draw actual wide ribbons instead of 1-px wires. Line2 / LineSegments2
 * use a screen-space shader that renders at any GPU linewidth.
 */
import { LineSegments2, LineSegmentsGeometry, LineMaterial } from '../../ext/three.js';

if (typeof window !== 'undefined') {
    window.__swarfLine = { LineSegments2, LineSegmentsGeometry, LineMaterial };
}
