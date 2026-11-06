// A file that feeds a bit into the board with the router off is found (review 105, stop-ship), and
// a good file is left alone. No USB, no browser.
//   node tools/shopbot/test-router-cut.mjs
import fs from 'fs'; import vm from 'vm'; import assert from 'assert/strict';
const root = new URL('../../web/kiri/', import.meta.url).pathname;
const w = { console, performance }; w.window = w; vm.createContext(w);
vm.runInContext(fs.readFileSync(root + 'swarf-run-parse.js', 'utf8'), w);
const P = w.SwarfRunParse;
const dead = t => P.routerOffCut(P.parse("'UNITS:MM\nSA\n" + t, { machineUnits: 'mm' }));
const good = 'C6\nJZ,5\nJ2,0,0\nMS,20,5\nMZ,-3\nM2,50,0\nJZ,5\nC7';
assert.equal(dead(good), null, 'on, cut, off: fine');
assert.equal(dead('JZ,5\nJ2,0,0\nMS,20,5\nMZ,-3\nM2,50,0\nJZ,5'), null, 'a file that never switches the router says nothing');
const changed = dead('C6\nJZ,5\nMS,20,5\nMZ,-3\nJZ,5\nC7\nC9\nJ2,0,0\nMZ,-3\nJZ,5\nC7');
assert.ok(changed && changed.afterChange, 'a bit change with no restart is found');
assert.equal(dead('C6\nJZ,5\nMS,20,5\nMZ,-3\nJZ,5\nC7\nC9\nC6\nJ2,0,0\nMZ,-3\nJZ,5\nC7'), null, 'a bit change with a restart is fine');
assert.ok(dead('C6\nC7\nJZ,5\nMS,20,5\nMZ,-3'), 'switched off, then cut, is found');
assert.equal(dead('C7\nJZ,5\nMS,20,5\nMZ,3\nM2,10,0\nC6'), null, 'moves above the board with the router off are fine');
console.log('ok test-router-cut');
