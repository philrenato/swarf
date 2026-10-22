// A quick stand-in for the ShopBot card, for page-wiring probes: answers
// commands, acks blocks, decodes the item stream into step counts and
// outputs, and sends the end report. The real card is the authority.
(function (root) {
  function StubCard() {
    const s = { inputs: [0x7E, 0x0F],   // inputs 1-8, 9-12; bit 7 = input 8, the shop's e-stop, off at rest (10-29)
      switches: [], acked: 0, pos: [0, 0, 0, 0, 0, 0], dirs: 0, line: 0, size: 340, buf: [], need: 0, item: [],  outs: 5, blocks: 0, ticks: 0 };
    const stub = { onData: null, state: s };
    const send = (b, ms = 2) => setTimeout(() => stub.onData && stub.onData(Uint8Array.from(b)), ms);
    // realtime: a block's ack waits for its ticks to play (a 7.3728 MHz tick clock), one block after another
    let busyUntil = 0, blockSec = 0;
    const tickSec = () => (0x10000 - (s.reload || 0xFF00)) / 7372800;
    // switches: { port 0 = inputs 1-8 / 1 = inputs 9-12, bit, axis, at, hit } — reads `hit` at or below `at`
    const inputs = () => {
      const v = s.inputs.slice();
      for (const w of s.switches) {
        const level = s.pos[w.axis] <= w.at ? w.hit : 1 - w.hit;
        v[w.port] = level ? v[w.port] | (1 << w.bit) : v[w.port] & ~(1 << w.bit);
      }
      return v;
    };
    const report = () => {
      const r = new Array(50).fill(0);
      const iv = inputs(); r[0] = 0xD4; r[1] = iv[0]; r[2] = iv[1]; r[5] = s.blocks & 0xFF; r[6] = s.line & 0xFF; r[7] = s.line >> 8 & 0xFF;
      r[16] = r[17] = 0xFF;
      s.pos.forEach((v, i) => { for (let k = 0; k < 4; k++) r[18 + 4 * i + k] = (v >>> (24 - 8 * k)) & 0xFF; });
      return r;
    };
    const dataLen = b => !(b & 0x40) ? (b & 1) : b < 0x60 ? 5 : b < 0x70 ? 1 : b < 0x74 ? 2 : b < 0x78 ? 1 : (b & 2) ? 1 : 0;
    let ended = false;
    function item(it) {
      const b = it[0];
      if (!(b & 0x40)) { s.ticks++; blockSec += tickSec(); for (let a = 0; a < 5; a++) if (b >> (a + 1) & 1) s.pos[a] += (s.dirs >> a & 1) ? 1 : -1; }
      else if (b < 0x60) { s.dirs = it[1]; s.line = it[2] << 8 | it[3]; s.reload = it[4] << 8 | it[5]; }
      else if (b < 0x70) s.reload = 0xF000 | (b & 0xF) << 8 | it[1];
      else if (b >= 0x70 && b < 0x74) s.outs = it[1];
      else if (b === 0x78) ended = true;
    }
    // Like the card's receiver: a byte >= 0x80 where an item
    // would start, outside a block, is a 6-byte command; anything else
    // starts a block of size + 1 bytes.
    let pending = [], need = 0;
    s.dbg = () => ({ pending: pending.length, need, size: s.size, head: pending.slice(0, 8) });
    stub.write = bytes => {
      for (const x of bytes) pending.push(x);
      for (;;) {
        if (!pending.length) break;
        if (!need && pending[0] >= 0x80) {
          if (pending.length < 6) break;
          const c = pending.splice(0, 6);
          if (c[0] === 0xF9) s.size = c[2] << 8 | c[3];
          if (c[0] === 0xF0) s.outs = c[1];
          if (c[0] === 0x80) { send(new Array(c[1]).fill(0)); continue; }
          send(report());
          continue;
        }
        if (pending.length < s.size + 1) break;
        const blk = pending.splice(0, s.size + 1);
        s.blocks++;
        let sum = 0; for (let i = 0; i < s.size; i++) sum += blk[i];
        if ((sum & 0xFF) !== blk[s.size]) { send([0xFF, 0, 0, 0, 0, 0]); continue; }
        ended = false; blockSec = 0;
        for (let i = 0; i < s.size && !ended; i++) {
          const b = blk[i];
          if (need) { s.item.push(b); if (--need === 0) item(s.item); continue; }
          s.item = [b]; need = dataLen(b);
          if (!need) item(s.item);
        }
        const iv = inputs(), d = s.ticks - s.acked; s.acked = s.ticks;
        let wait = 2;
        if (s.realtime) { const now = Date.now(); busyUntil = Math.max(now, busyUntil) + blockSec * 1000; wait = Math.max(2, busyUntil - now); }
        // noAckOnEnd: like the card with its window full, END stops the
        // stack before the held ack goes out — only the report arrives
        if (!(ended && s.noAckOnEnd)) send([3, s.blocks & 0xFF, iv[0], iv[1], d & 0xFF, d >> 8 & 0xFF], wait);
        if (ended) { need = 0; send(report(), wait + 1); }
      }
      return Promise.resolve(bytes.length);
    };
    return stub;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = StubCard; else root.StubCard = StubCard;
})(typeof window !== 'undefined' ? window : globalThis);
