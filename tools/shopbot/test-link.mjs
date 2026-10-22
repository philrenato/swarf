// The USB link against a fake CP210x with an echo peer: init sequence, modem
// lines, bytes both ways.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const ShopBotUSB = createRequire(import.meta.url)('../../web/kiri/swarf-shopbot-usb.js');

const echo = { write(b) { setTimeout(() => this.onData(b), 1); } };
const dev = new FakeCP210x(echo);
const link = await ShopBotUSB.known(fakeUSB(dev));
await link.open();
assert.deepEqual(dev.uart, { enabled: true, baud: 921600, lineCtl: 0x0800, dtr: false, rts: false });
assert.deepEqual(await link.modem().then(m => [m.cts, m.dsr]), [true, true]);
const got = [];
link.onData = b => got.push(...b);
await link.write(new Uint8Array([1, 2, 3, 0xe0]));
await new Promise(r => setTimeout(r, 20));
assert.deepEqual(got, [1, 2, 3, 0xe0]);
await link.close();
assert.equal(dev.uart.enabled, false);

const dead = new FakeCP210x(echo, { powered: false });
const l2 = await ShopBotUSB.known(fakeUSB(dead));
await l2.open();
assert.deepEqual(await l2.modem().then(m => [m.cts, m.dsr]), [false, false]);
await l2.close();
console.log('link: ok');
process.exit(0);
