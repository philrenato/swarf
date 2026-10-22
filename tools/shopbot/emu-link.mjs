// A byte link to the ShopBot card firmware running in the 8051 emulator
// (shopbot_probe/re/emu/card_server.py). Same shape as the USB link:
// write(bytes), onData. close() resolves with the emulator's port report.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
export const EMU = process.env.SHOPBOT_EMU || path.join(os.homedir(), 'Documents/claude/shopbot_probe/re/emu');
export function emuLink({ python = 'pypy3.11' } = {}) {
  const p = spawn(python, ['card_server.py'], { cwd: EMU, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  const link = {
    onData: null,
    write(b) { p.stdin.write(Buffer.from(b)); return Promise.resolve(b.length); },
    close() {
      return new Promise(r => { p.on('close', () => { const l = err.trim().split('\n').pop(); try { r(JSON.parse(l)); } catch { r({ error: err }); } }); p.stdin.end(); });
    }
  };
  p.stdout.on('data', d => link.onData && link.onData(new Uint8Array(d)));
  p.stderr.on('data', d => { err += d; });
  return link;
}
