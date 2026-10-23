// A quick stand-in for the ShopBot card, for page-wiring probes: answers
// commands, acks blocks, decodes the item stream into step counts and
// outputs, and sends the end report. The firmware in the emulator is the
// authority; this only mirrors what was measured there (re/PROTOCOL.md).
(function (root) {
  function StubCard() {
    const s = { inputs: [0xFE, 0x0F], switches: [], acked: 0, pos: [0, 0, 0, 0, 0, 0], dirs: 0, line: 0, size: 340, buf: [], need: 0, item: [], p7: 5, blocks: 0, ticks: 0 };
    const stub = { onData: null, state: s };
    const send = b => setTimeout(() => stub.onData && stub.onData(Uint8Array.from(b)), 2);
    // switches: { port 0 = P6 / 1 = P2, bit, axis, at, hit } — reads `hit` at or below `at`
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
      if (!(b & 0x40)) { s.ticks++; for (let a = 0; a < 5; a++) if (b >> (a + 1) & 1) s.pos[a] += (s.dirs >> a & 1) ? 1 : -1; }
      else if (b < 0x60) { s.dirs = it[1]; s.line = it[2] << 8 | it[3]; }
      else if (b >= 0x70 && b < 0x74) s.p7 = it[1];
      else if (b === 0x78) ended = true;
    }
    // Like the firmware's receiver (0x1C85): a byte >= 0x80 where an item
    // would start, outside a block, is a 6-byte command; anything else
    // starts a block of size + 1 bytes.
    let pending = [], need = 0;
    stub.write = bytes => {
      for (const x of bytes) pending.push(x);
      for (;;) {
        if (!pending.length) break;
        if (!need && pending[0] >= 0x80) {
          if (pending.length < 6) break;
          const c = pending.splice(0, 6);
          if (c[0] === 0xF9) s.size = c[2] << 8 | c[3];
          if (c[0] === 0xF0) s.p7 = c[1];
          if (c[0] === 0x80) { send(new Array(c[1]).fill(0)); continue; }
          send(report());
          continue;
        }
        if (pending.length < s.size + 1) break;
        const blk = pending.splice(0, s.size + 1);
        s.blocks++;
        let sum = 0; for (let i = 0; i < s.size; i++) sum += blk[i];
        if ((sum & 0xFF) !== blk[s.size]) { send([0xFF, 0, 0, 0, 0, 0]); continue; }
        ended = false;
        for (let i = 0; i < s.size && !ended; i++) {
          const b = blk[i];
          if (need) { s.item.push(b); if (--need === 0) item(s.item); continue; }
          s.item = [b]; need = dataLen(b);
          if (!need) item(s.item);
        }
        const iv = inputs(), d = s.ticks - s.acked; s.acked = s.ticks;
        // noAckOnEnd: like the firmware with its window full, END stops the
        // stack before the held ack goes out — only the report arrives
        if (!(ended && s.noAckOnEnd)) send([3, s.blocks & 0xFF, iv[0], iv[1], d & 0xFF, d >> 8 & 0xFF]);
        if (ended) { need = 0; send(report()); }
      }
      return Promise.resolve(bytes.length);
    };
    return stub;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = StubCard; else root.StubCard = StubCard;
})(typeof window !== 'undefined' ? window : globalThis);
