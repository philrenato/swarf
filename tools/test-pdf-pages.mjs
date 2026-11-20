// node tools/test-pdf-pages.mjs — an .ai/.pdf import says how many pages it has (only the first is
// read): the page tree found in the open file and inside a compressed object stream; a real
// one-page file from swarf's own writer; and the counts toSVG hands the import.
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
globalThis.window = globalThis;
await import('../web/kiri/swarf-vector.mjs');
const V = globalThis.SwarfVector;
const enc = s => new TextEncoder().encode(s);
let n = 0;
const ok = async (what, fn) => { await fn(); n++; console.log('ok  ', what); };

const page = id => `${id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 9 0 R >>\nendobj\n`;
const box = 'q 10 10 m 100 10 l 100 100 l 10 100 l h f Q';
const plain = enc(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n${page(3)}${page(4)}${page(5)}9 0 obj\n<< /Length ${box.length} >>\nstream\n${box}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);

await ok('three pages in the open file', async () => {
  assert.equal(await V.pdfPages(plain), 3);
});
await ok('a page tree only inside a compressed object stream', async () => {
  const objs = ['<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R >>', '<< /Type /Page /Parent 2 0 R >>'];
  let head = '', body = '';
  [2, 3, 4].forEach((id, i) => { head += `${id} ${body.length} `; body += objs[i] + '\n'; });
  const raw = Buffer.from(head + body), z = deflateSync(raw);
  const pre = Buffer.from(`%PDF-1.5\n7 0 obj\n<< /Type /ObjStm /N 3 /First ${head.length} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`);
  const post = Buffer.from('\nendstream\nendobj\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF\n');
  assert.equal(await V.pdfPages(new Uint8Array(Buffer.concat([pre, z, post]))), 2);
});
await ok("swarf's own PDF: one page", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50"><path d="M0 0H40V40H0Z"/></svg>';
  assert.equal(await V.pdfPages(enc(V.write('pdf', svg))), 1);
});
await ok('not a PDF: 0 (nothing said)', async () => {
  assert.equal(await V.pdfPages(enc('hello')), 0);
});
await ok('toSVG of the three-page file: its square, pages 3', async () => {
  const r = await V.toSVG('three.pdf', plain);
  assert.equal(r.pages, 3); assert.equal(r.closed, 1, JSON.stringify({ closed: r.closed, open: r.open, note: r.note }));
  assert.equal(r.text, 0); assert.equal(r.images, 0);
});
console.log(`test-pdf-pages: all ${n} passed`);
