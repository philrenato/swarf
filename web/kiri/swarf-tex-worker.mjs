// swarf-tex-worker.mjs — TEX's card asks here, off the page's own thread, what a mark will cut:
// the checks (what the bit cannot make), the path the core picks and the cut time.
// Lengths come back as ⟦mm⟧ tokens for the page to say in its own units (swarf-length.js).
import C from './swarf-tex-core.mjs';

self.onmessage = (e) => {
  const { id, mark, thickness, part, down, rate, plunge } = e.data;
  try {
    const len = (v) => `⟦${+v}⟧`;
    const chk = C.markChecks(mark, { thickness, len, part });
    let seconds = 0, strategy = 'raster';
    if (chk.tex || chk.cuts) {
      const p = C.markToolpath(mark, { maxDepth: thickness, stepDown: down > 0 ? down : 0, res: 0.6, part });
      seconds = C.estimateTime(p.moves, { feed: rate / 60, plunge: plunge / 60 }).seconds;
      strategy = p.strategy;
    }
    self.postMessage({ id, warnings: chk.warnings, notes: chk.notes, strategy, seconds });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
