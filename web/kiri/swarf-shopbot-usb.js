/**
 * swarf shopbot — the USB link to a ShopBot control box, over WebUSB.
 *
 * The box's USB side is a Silicon Labs CP210x bridge with ShopBot's own
 * product id (10C4:83C4). No OS driver claims that id on macOS, so Chrome's
 * WebUSB (and node's `usb` package, which exposes the same API) can open it
 * and run the UART with CP210x vendor requests (Silicon Labs AN571).
 *
 *   const link = await ShopBotUSB.request()      // Chrome: needs a click
 *   const link = await ShopBotUSB.known()        // a box this page was allowed before, or null
 *   await link.open({ baud: 921600 })   // Sb3 3.8.4 opens at 921600 8N1, no DTR/RTS
 *   link.onData = bytes => ...                   // Uint8Array, as it arrives
 *   await link.write(bytes)
 *   await link.modem()  -> { cts, dsr, ri, dcd, dtr, rts }
 *   await link.close()
 *
 * Anything that wants a byte stream (the card protocol, a logger, a test
 * double) talks to this interface: open / write / onData / close.
 */
(function (root) {
  'use strict';

  const VID = 0x10c4, PID = 0x83c4;
  const REQ = {
    IFC_ENABLE: 0x00, SET_LINE_CTL: 0x03, SET_MHS: 0x07, GET_MDMSTS: 0x08,
    PURGE: 0x12, SET_BAUDRATE: 0x1e
  };
  const PACKET = 64;

  class ShopBotUSB {
    constructor(device) {
      this.device = device;
      this.iface = 0;
      this.epIn = 1;
      this.epOut = 1;
      this.onData = null;
      this.onClose = null;
      this.reading = false;
    }

    static usb() {
      if (root.navigator && root.navigator.usb) return root.navigator.usb;
      throw new Error('this browser has no WebUSB; use Chrome or Edge');
    }

    static async request(usb = ShopBotUSB.usb()) {
      const d = await usb.requestDevice({ filters: [{ vendorId: VID, productId: PID }] });
      return new ShopBotUSB(d);
    }

    static async known(usb = ShopBotUSB.usb()) {
      const list = await usb.getDevices();
      const d = list.find(x => x.vendorId === VID && x.productId === PID);
      return d ? new ShopBotUSB(d) : null;
    }

    ctl(request, value, data) {
      const setup = { requestType: 'vendor', recipient: 'interface', request, value, index: this.iface };
      return this.device.controlTransferOut(setup, data);
    }

    async open({ baud = 921600, dtr = false, rts = false } = {}) {
      const d = this.device;
      if (!d.opened) await d.open();
      if (!d.configuration) await d.selectConfiguration(1);
      const alt = d.configuration.interfaces[0].alternate;
      this.iface = d.configuration.interfaces[0].interfaceNumber;
      for (const ep of alt.endpoints) {
        if (ep.type !== 'bulk') continue;
        if (ep.direction === 'in') this.epIn = ep.endpointNumber;
        else this.epOut = ep.endpointNumber;
      }
      await d.claimInterface(this.iface);
      await this.ctl(REQ.IFC_ENABLE, 1);
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, baud, true);
      await this.ctl(REQ.SET_BAUDRATE, 0, b);
      await this.ctl(REQ.SET_LINE_CTL, 0x0800);             // 8 data bits, no parity, 1 stop
      await this.lines({ dtr, rts });
      await this.ctl(REQ.PURGE, 0x000f);                      // both FIFOs
      this.baud = baud;
      this.readLoop();
      return this;
    }

    // DTR = bit 0, RTS = bit 1; the high byte says which of them to change.
    lines({ dtr, rts }) {
      let v = 0;
      if (dtr !== undefined) v |= 0x0100 | (dtr ? 1 : 0);
      if (rts !== undefined) v |= 0x0200 | (rts ? 2 : 0);
      return this.ctl(REQ.SET_MHS, v);
    }

    async modem() {
      const setup = { requestType: 'vendor', recipient: 'interface', request: REQ.GET_MDMSTS, value: 0, index: this.iface };
      const r = await this.device.controlTransferIn(setup, 1);
      const s = r.data.getUint8(0);
      return { dtr: !!(s & 1), rts: !!(s & 2), cts: !!(s & 0x10), dsr: !!(s & 0x20), ri: !!(s & 0x40), dcd: !!(s & 0x80), raw: s };
    }

    async readLoop() {
      if (this.reading) return;
      this.reading = true;
      while (this.reading) {
        let r;
        try {
          r = await this.device.transferIn(this.epIn, PACKET);
        } catch (e) {
          if (this.reading) { this.reading = false; if (this.onClose) this.onClose(e); }
          return;
        }
        if (r.status === 'stall') { await this.device.clearHalt('in', this.epIn).catch(() => {}); continue; }
        if (r.data && r.data.byteLength && this.onData) {
          this.onData(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice());
        }
      }
    }

    async write(bytes) {
      const r = await this.device.transferOut(this.epOut, bytes);
      if (r.status !== 'ok') throw new Error(`USB write ${r.status}`);
      return r.bytesWritten;
    }

    async close() {
      this.reading = false;
      const d = this.device;
      try { await this.ctl(REQ.IFC_ENABLE, 0); } catch (e) { /* unplugged */ }
      try { await d.releaseInterface(this.iface); } catch (e) { /* not claimed */ }
      try { await d.close(); } catch (e) { /* already closed */ }
    }
  }

  ShopBotUSB.VID = VID;
  ShopBotUSB.PID = PID;

  if (typeof module !== 'undefined' && module.exports) module.exports = ShopBotUSB;
  else root.ShopBotUSB = ShopBotUSB;
})(typeof window !== 'undefined' ? window : globalThis);
