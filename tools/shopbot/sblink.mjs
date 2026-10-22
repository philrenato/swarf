// Check the ShopBot box's USB link from a Mac: find it, open the UART, say
// whether the box is powered and reset (CTS/DSR), log what it sends.
// Sends nothing.
//   node sblink.mjs [seconds=5] [--dtr]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { WebUSB } = require('usb');
const ShopBotUSB = require('../../web/kiri/swarf-shopbot-usb.js');

const secs = Number(process.argv.find(a => /^\d+(\.\d+)?$/.test(a)) || 5);
const dtr = process.argv.includes('--dtr');
const link = await ShopBotUSB.known(new WebUSB({ allowAllDevices: true }));
if (!link) { console.log('No ShopBot box on USB. Check the cable; the box can be off, the USB chip runs from the Mac.'); process.exit(1); }
const d = link.device;
console.log(`found ${d.manufacturerName || ''} ${d.productName || ''} ${d.serialNumber || ''}`.trim());
await link.open({ dtr, rts: dtr });
const m = await link.modem();
console.log(m.cts || m.dsr ? 'box is powered and reset' : 'USB is up but the box is not answering its lines: power on, release E-stops, press the blue reset');
console.log(`lines CTS=${+m.cts} DSR=${+m.dsr} DCD=${+m.dcd} RI=${+m.ri} (raw 0x${m.raw.toString(16)})`);
const log = fs.createWriteStream(`sblink_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const t0 = performance.now();
let n = 0;
link.onData = b => {
  n += b.length;
  const line = `${((performance.now() - t0) / 1000).toFixed(3)} ${[...b].map(x => x.toString(16).padStart(2, '0')).join(' ')}`;
  console.log(line); log.write(line + '\n');
};
await new Promise(r => setTimeout(r, secs * 1000));
await link.close();
log.end();
console.log(`${n} bytes in ${secs}s`);
process.exit(0);
