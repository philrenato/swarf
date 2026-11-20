// node tools/test-contour-plan.mjs — which passes a contour step's pattern makes (op-contour.js
// contourPlan): lines along X or Y stay Kiri's contour, any other angle and the rings are area passes.
import assert from 'node:assert/strict';
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js'); globalThis.THREE = THREE;
await import('../src/add/array.js'); await import('../src/add/three.js');
await import('../src/kiri/mode/cam/core/ops.js');   // as the app loads it: the op list first
const { contourPlan } = await import('../src/kiri/mode/cam/work/op-contour.js');
const eq = (op, want, what) => { assert.deepEqual(contourPlan(op), want, what); console.log('ok  ', what); };
eq({ axis: 'X' }, [{ kind: 'topo', axis: 'X' }], 'a step saved before patterns, axis X: as it was');
eq({ axis: 'Y' }, [{ kind: 'topo', axis: 'Y' }], 'axis Y: as it was');
eq({ pattern: 'lines', lineAngle: 90, axis: 'X' }, [{ kind: 'topo', axis: 'Y' }], 'the angle wins over the axis');
eq({ pattern: 'lines', lineAngle: 45 }, [{ kind: 'lines', angle: 45 }], 'lines at 45: an area pass');
eq({ pattern: 'lines', lineAngle: 180 }, [{ kind: 'topo', axis: 'X' }], '180 runs as 0');
eq({ pattern: 'lines', lineAngle: -30 }, [{ kind: 'lines', angle: 150 }], '-30 runs as 150');
eq({ pattern: 'cross', lineAngle: 0 }, [{ kind: 'topo', axis: 'X' }, { kind: 'topo', axis: 'Y' }], 'cross at 0: X then Y');
eq({ pattern: 'cross', lineAngle: 30 }, [{ kind: 'lines', angle: 30 }, { kind: 'lines', angle: 120 }], 'cross at 30: 30 then 120');
eq({ pattern: 'cross', lineAngle: 135 }, [{ kind: 'lines', angle: 135 }, { kind: 'lines', angle: 45 }], 'cross at 135 wraps');
eq({ pattern: 'perimeter', lineAngle: 45 }, [{ kind: 'rings' }], 'perimeter: rings, no angle');
eq({ pattern: 'nonsense', axis: 'Y' }, [{ kind: 'topo', axis: 'Y' }], 'an unknown pattern is lines');
console.log('test-contour-plan: all passed');
process.exit(0);   // the geometry module's wasm loads on its own after; nothing here needs it
