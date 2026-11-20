// node tools/test-minion-fail.mjs — a toolpath helper (src/kiri/run/minion.js) always answers the
// work it was given: with the result, or with { seq, error } when the work throws, when its promise
// rejects, or when the code that packs the answer throws. One answer each, never two, and a message
// with no seq (a broadcast) answers nothing.
import assert from 'node:assert/strict';
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js'); globalThis.THREE = THREE;
const sent = [];
globalThis.postMessage = msg => sent.push(msg);
const quiet = console.log;
console.log = () => {};   // the helper logs each failure it answers
await import('../src/kiri/run/minion.js');
const say = (...a) => quiet(...a);
const tick = () => new Promise(r => setTimeout(r, 20));
const run = async data => { sent.length = 0; self.onmessage({ data }); await tick(); return sent.slice(); };
const one = (got, seq, what) => {
    assert.equal(got.length, 1, `${what}: one answer (${got.length})`);
    assert.equal(got[0].seq, seq, `${what}: for the work that asked (${got[0].seq})`);
};

let got = await run({ cmd: 'cam_slice', seq: 3, bucket: {}, opt: {} });
one(got, 3, 'work that throws'); assert.ok(got[0].error, 'work that throws: an error');
say('ok   work that throws answers with its error');

self.cache.slicer = { sliceBucket: () => Promise.reject(new Error('no memory')) };
got = await run({ cmd: 'cam_slice', seq: 4, bucket: {}, opt: {} });
one(got, 4, 'a promise that rejects'); assert.equal(got[0].error, 'no memory');
say('ok   work whose promise rejects answers with its error');

self.cache.slicer = { sliceBucket: () => Promise.resolve(null) };
got = await run({ cmd: 'cam_slice', seq: 5, bucket: {}, opt: {} });
one(got, 5, 'an answer that cannot be packed'); assert.ok(got[0].error);
say('ok   work whose answer cannot be packed answers with the error');

self.cache.slicer = { sliceBucket: () => Promise.resolve([]) };
got = await run({ cmd: 'cam_slice', seq: 6, bucket: {}, opt: {} });
one(got, 6, 'good work'); assert.ok(!got[0].error && Array.isArray(got[0].slices));
say('ok   good work answers once, with no error');

got = await run({ cmd: 'no_such_work', seq: 7 });
one(got, 7, 'unknown work'); assert.ok(/invalid command/.test(got[0].error));
say('ok   unknown work answers with an error');

got = await run({ cmd: 'trace_cleanup' });
assert.equal(got.length, 0, 'a broadcast answers nothing');
got = await run({ cmd: 'trace_y', params: {} });
assert.equal(got.length, 0, 'a broadcast that throws answers nothing (no work waits on it)');
say('ok   a message with no seq answers nothing, even when it throws');

got = await run({ cmd: 'trace_y', seq: 0, params: {} });
one(got, 0, 'work numbered 0'); assert.ok(got[0].error);
say('ok   the first work of a new engine (seq 0) is answered too');
quiet('test-minion-fail: all passed');
process.exit(0);
