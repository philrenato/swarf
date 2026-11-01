// swarf-tex-worker.mjs — TEX's card asks here, off the page's own thread, what a mark will cut:
// the checks (what the bit cannot make), the path the core picks and the cut time; and it writes
// the part's mesh files. The same core calls run on the page when there is no worker.
// Lengths come back as ⟦mm⟧ tokens for the page to say in its own units (swarf-length.js).
import C from './swarf-tex-core.mjs';

self.onmessage = (e) => {
  const { id } = e.data;
  try {
    if (e.data.kind === 'mesh') {
      // the part as a mesh with its marks, written as STL, OBJ or GLB
      const r = C.meshFile(e.data);
      self.postMessage({ id, ...r }, r.buf ? [r.buf] : []);
      return;
    }
    const { mark, thickness, part, down, rate, plunge } = e.data;
    self.postMessage({ id, ...C.markReport(mark, { thickness, part, down, rate, plunge, len: (v) => `⟦${+v}⟧` }) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
