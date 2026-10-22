// A WebUSB device that behaves like the ShopBot box's CP210x: it answers the
// vendor requests the link sends and hands the UART bytes to `peer`
// (anything with write(bytes) and an onData callback, e.g. the card emulator).
export class FakeCP210x {
  constructor(peer, { powered = true } = {}) {
    this.vendorId = 0x10c4; this.productId = 0x83c4;
    this.opened = false; this.configuration = null;
    this.peer = peer; this.powered = powered;
    this.uart = { enabled: false, baud: 0, lineCtl: 0, dtr: false, rts: false };
    this.log = [];
    this.inbox = []; this.waiters = [];
    if (peer) peer.onData = b => this.deliver(b);
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async selectConfiguration() {
    this.configuration = { interfaces: [{ interfaceNumber: 0, alternate: { endpoints: [
      { endpointNumber: 1, direction: 'in', type: 'bulk' }, { endpointNumber: 1, direction: 'out', type: 'bulk' }] } }] };
  }
  async claimInterface() {}
  async releaseInterface() {}
  async clearHalt() {}
  async controlTransferOut(s, data) {
    this.log.push({ req: s.request, value: s.value, data: data && [...data] });
    const u = this.uart;
    if (s.request === 0x00) u.enabled = !!s.value;
    if (s.request === 0x1e) u.baud = new DataView(data.buffer, data.byteOffset).getUint32(0, true);
    if (s.request === 0x03) u.lineCtl = s.value;
    if (s.request === 0x07) {
      if (s.value & 0x100) u.dtr = !!(s.value & 1);
      if (s.value & 0x200) u.rts = !!(s.value & 2);
    }
    return { status: 'ok', bytesWritten: data ? data.length : 0 };
  }
  async controlTransferIn(s) {
    const u = this.uart;
    const v = (u.dtr ? 1 : 0) | (u.rts ? 2 : 0) | (this.powered ? 0x30 : 0);
    return { status: 'ok', data: new DataView(new Uint8Array([v]).buffer) };
  }
  async transferOut(ep, bytes) {
    if (!this.uart.enabled) return { status: 'stall', bytesWritten: 0 };
    if (this.peer && this.powered) this.peer.write(Uint8Array.from(bytes));
    return { status: 'ok', bytesWritten: bytes.length };
  }
  deliver(b) {
    const w = this.waiters.shift();
    if (w) w(b); else this.inbox.push(b);
  }
  transferIn() {
    const b = this.inbox.shift();
    const wrap = x => ({ status: 'ok', data: new DataView(x.buffer, x.byteOffset, x.byteLength) });
    if (b) return Promise.resolve(wrap(b));
    return new Promise(r => this.waiters.push(x => r(wrap(x))));
  }
}
export const fakeUSB = dev => ({ getDevices: async () => [dev], requestDevice: async () => dev });
