/**
 * swarf shopbot — the USB link to a ShopBot control box: WebUSB on the Mac, Web Serial on
 * Windows (ShopBotSerial, below).
 *
 * The box's USB side is a Silicon Labs CP210x bridge with ShopBot's own
 * product id (10C4:83C4). No OS driver claims that id on macOS, so Chrome's
 * WebUSB (and node's `usb` package, which exposes the same API) can open it
 * and run the UART with CP210x vendor requests (Silicon Labs AN571).
 *
 *   const link = await ShopBotUSB.request()      // Chrome: needs a click
 *   const link = await ShopBotUSB.known()        // a box this page was allowed before, or null
 *   await link.open({ baud: 921600 })   // 921600 8N1, no DTR/RTS
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
  // the deploy stamps every machine-control file; connect refuses a page that mixes two builds
  (typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS = Object.assign((typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS || {}, { 'swarf-shopbot-usb.js': '__SWARF_BUILD__' });

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
      return this.device.controlTransferOut(setup, data || new Uint8Array(0));   // node-usb needs a buffer; Chrome takes either
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

  /*
   * The same link over Web Serial, for Windows. There ShopBot's own install puts the Silicon Labs
   * driver on the box, which makes it a COM port (COM3 in the shop) and keeps WebUSB out. Chrome
   * and Edge open that COM port as it is: no driver change, so ShopBot 3 keeps working on the same
   * PC. A COM port has one owner at a time; while ShopBot 3 holds it, open() fails and says so.
   * Same interface as ShopBotUSB: open / write / onData / onClose / modem / close.
   */
  class ShopBotSerial {
    constructor(port) {
      this.port = port;
      this.onData = null;
      this.onClose = null;
      this.reading = false;
      this.reader = null;
      this.writer = null;
    }

    static serial() {
      if (root.navigator && root.navigator.serial) return root.navigator.serial;
      throw new Error('this browser has no Web Serial; use Chrome or Edge');
    }

    static isBox(port) {
      const i = port.getInfo ? port.getInfo() : {};
      return i.usbVendorId === VID && i.usbProductId === PID;
    }

    static async request(serial = ShopBotSerial.serial()) {
      return new ShopBotSerial(await serial.requestPort({ filters: [{ usbVendorId: VID, usbProductId: PID }] }));
    }

    static async known(serial = ShopBotSerial.serial()) {
      const p = (await serial.getPorts()).find(ShopBotSerial.isBox);
      return p ? new ShopBotSerial(p) : null;
    }

    async open({ baud = 921600, dtr = false, rts = false } = {}) {
      try {
        await this.port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
      } catch (e) {
        // Chrome's words for a port someone else holds: "Failed to open serial port."
        if (/failed to open|in use|access/i.test(e.message || '')) throw new Error('the COM port is in use (is ShopBot 3 open?)');
        throw e;
      }
      this.opened = true;
      await this.lines({ dtr, rts });
      this.baud = baud;
      this.writer = this.port.writable.getWriter();
      this.readLoop();
      return this;
    }

    lines({ dtr, rts }) {
      const s = {};
      if (dtr !== undefined) s.dataTerminalReady = !!dtr;
      if (rts !== undefined) s.requestToSend = !!rts;
      return this.port.setSignals(s);
    }

    async modem() {
      const s = await this.port.getSignals();
      return { cts: !!s.clearToSend, dsr: !!s.dataSetReady, ri: !!s.ringIndicator, dcd: !!s.dataCarrierDetect };
    }

    async readLoop() {
      if (this.reading) return;
      this.reading = true;
      while (this.reading && this.port.readable) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value && value.byteLength && this.onData) this.onData(value.slice());
          }
        } catch (e) {
          // a framing or buffer error leaves the port readable and the loop takes a new reader;
          // an unplug ends it
          if (this.reading && !this.port.readable) { this.reading = false; if (this.onClose) this.onClose(e); return; }
        } finally {
          try { this.reader.releaseLock(); } catch (e) { /* already released */ }
        }
      }
      if (this.reading) { this.reading = false; if (this.onClose) this.onClose(new Error('the COM port closed')); }
    }

    async write(bytes) {
      await this.writer.write(bytes);
      return bytes.length;
    }

    async close() {
      this.reading = false;
      try { if (this.reader) await this.reader.cancel(); } catch (e) { /* unplugged */ }
      try { if (this.writer) { this.writer.releaseLock(); this.writer = null; } } catch (e) { /* released */ }
      try { if (this.opened) await this.port.close(); } catch (e) { /* already closed */ }
      this.opened = false;
    }
  }

  // Which link this computer uses: Windows reaches the box through its COM port (ShopBot's driver
  // owns the USB device there); macOS has no driver for it, so WebUSB opens it directly.
  // Which link this computer uses. The Mac has no driver for the box, so WebUSB opens it directly.
  // Windows has two ways in (Phil 10-29): ShopBot's own driver makes it a COM port (the shop PC,
  // Web Serial); a student laptop without ShopBot's software can take the generic WinUSB driver
  // instead (Zadig, help › control), and then WebUSB opens it as on the Mac. Windows tries the COM
  // port first, then USB, and remembers which one worked.
  const PREF = 'swarf-shopbot-link';
  const pref = () => { try { return root.localStorage && root.localStorage.getItem(PREF); } catch (e) { return null; } };
  const ShopBotLink = {
    windows() {
      const n = root.navigator || {};
      const plat = (n.userAgentData && n.userAgentData.platform) || n.platform || n.userAgent || '';
      return /win/i.test(plat);
    },
    kind() {
      const n = root.navigator || {};
      if (ShopBotLink.windows() && n.serial) return 'serial';
      // elsewhere the box has no COM port: Web Serial would list nothing, so only WebUSB counts
      return n.usb ? 'usb' : null;
    },
    // the classes to try, in order
    order() {
      const n = root.navigator || {};
      if (!ShopBotLink.windows()) return n.usb ? [ShopBotUSB] : [];
      const list = [n.serial && ShopBotSerial, n.usb && ShopBotUSB].filter(Boolean);
      return pref() === 'usb' || ShopBotLink.usbNext ? list.reverse() : list;
    },
    supported() { return ShopBotLink.order().length > 0; },
    async known() {
      for (const C of ShopBotLink.order()) {
        const l = await C.known().catch(() => null);
        if (l) return l;
      }
      return null;
    },
    // a chooser per way in; one closed with nothing picked (NotFoundError) moves on to the next
    async request() {
      const list = ShopBotLink.order();
      let last = null;
      for (const C of list) {
        try { return await C.request(); } catch (e) {
          last = e;
          // no COM port picked: the next press opens the USB box first (Chrome may allow one box per click)
          if (C === ShopBotSerial && e.name === 'NotFoundError') ShopBotLink.usbNext = true;
          if (e.name !== 'NotFoundError') break;
        }
      }
      throw last || new Error('no way to reach USB here');
    },
    worked(link) { try { if (ShopBotLink.windows() && root.localStorage) root.localStorage.setItem(PREF, link instanceof ShopBotUSB ? 'usb' : 'serial'); } catch (e) { /* private window */ } }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign(ShopBotUSB, { ShopBotSerial, ShopBotLink });
  else { root.ShopBotUSB = ShopBotUSB; root.ShopBotSerial = ShopBotSerial; root.ShopBotLink = ShopBotLink; }
})(typeof window !== 'undefined' ? window : globalThis);
