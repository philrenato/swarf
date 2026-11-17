// runs swarf's cam_export and the app's per-bit split over hand-made toolpaths (node, no browser)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
globalThis.self = globalThis;
const threePath = join(dirname(createRequire(join(ROOT, 'package.json')).resolve('three')), 'three.module.js');
globalThis.THREE = await import(threePath);
await import(join(SRC, 'add/array.js'));
await import(join(SRC, 'add/class.js'));
const { cam_export } = await import(join(SRC, 'kiri/mode/cam/work/export.js'));
export const MR1 = JSON.parse(readFileSync(join(SRC, 'kiri/dev/cam/Langmuir.MR-1.json'), 'utf8'));
export const SB = JSON.parse(readFileSync(join(SRC, 'kiri/dev/cam/ShopBot.Basic.json'), 'utf8'));
export function tool(id, number, name) {
  return { getID: () => id, getNumber: () => number, getName: () => name, tool: { number, flute_diam: 0.25, flute_len: 1, metric: false } };
}
// app/export.js bitFiles(), taken from the source as it stands
const appSrc = readFileSync(join(SRC, 'kiri/app/export.js'), 'utf8');
const body = appSrc.slice(appSrc.indexOf('function bitFiles()'), appSrc.indexOf('// the lines in one chunk'));
const bitFiles = new Function(body + '; return bitFiles;')();
export function runFiles(device, process, stock, origin, levels) {
  const bits = bitFiles(), all = [];
  const print = { widgets: [{}], settings: { device, process, stock, origin, filter: { CAM: 'x' }, mode: 'CAM' }, output: levels,
    constReplace(str, consts) { return str.replace(/\{(\w+)\}/g, (m, k) => consts[k] ?? m); } };
  cam_export(print, line => { bits.take(line); if (typeof line === 'string') all.push(line); });
  return { text: all.join('\r\n'), files: bits.files() };
}
export function level(pts, tool, spindle, step, type = 'outline') {
  const a = pts.map(([x, y, z, e, s]) => ({ point: { x, y, z }, emit: e, speed: s, tool }));
  a.mode = { type, _swarfStep: step }; a.spindle = spindle; return a;
}
