/*
 * Contact sheet for a torture run: one row per case, verdict beside the
 * toolpath and simulation screenshots.   node tools/torture/report.mjs [--out dir]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : new URL('./out', import.meta.url).pathname;
const results = JSON.parse(readFileSync(join(OUT, 'report.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const rows = results.map(r => {
    const tag = r.fail.length ? 'fail' : r.warn.length ? 'warn' : 'ok';
    const notes = [...r.fail.map(f => `<li class="f">${esc(f)}</li>`), ...r.warn.map(w => `<li class="w">${esc(w)}</li>`)].join('');
    const i = r.info || {};
    return `<tr class="${tag}"><td><b>${esc(r.id)}</b><br><span class="t">${tag}</span>
<div class="m">removed ${i.removed ?? '-'} · sim Δ ${i.sim?.meanAbs ?? '-'} mm · ${i.moves ?? '-'} moves · ${i.dialect ?? ''}</div><ul>${notes}</ul></td>
<td><img loading="lazy" src="${r.id}/paths.png"></td><td><img loading="lazy" src="${r.id}/sim.png"></td></tr>`;
}).join('\n');

writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>swarf torture run</title>
<style>body{font:13px/1.4 ui-monospace,monospace;background:#111;color:#ddd;margin:16px}table{border-collapse:collapse;width:100%}
td{vertical-align:top;border-bottom:1px solid #333;padding:6px}img{width:420px;display:block}.t{font-weight:bold}
tr.fail .t{color:#ff5a4a}tr.warn .t{color:#e0b040}tr.ok .t{color:#6c6}li.f{color:#ff8a7a}li.w{color:#e0c070}.m{color:#999}ul{padding-left:16px;margin:4px 0}</style>
<h1>swarf torture run</h1><p>${results.length} cases · ${results.filter(r => r.fail.length).length} failing · ${results.filter(r => !r.fail.length && r.warn.length).length} warnings</p>
<table>${rows}</table>`);
console.log(join(OUT, 'index.html'));
