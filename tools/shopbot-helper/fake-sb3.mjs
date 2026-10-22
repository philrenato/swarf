// Pretend ShopBot 3 on the far side of ShopBotHelper.ps1's test mode: watches
// the UserData JSON file, takes uCommand like Sb3 does (then clears it), and
// updates Loc_1..3 / Status. Moves are instant; a file "runs" for 1.5 s.
//   node fake-sb3.mjs /path/userdata.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const F = process.argv[2];
if (!existsSync(F)) writeFileSync(F, JSON.stringify({ Status: ' 0', uCommand: '', uResponse: '', uMsgBoxCaption: '', uMsgBoxMessage: '', Loc_1: '0', Loc_2: '0', Loc_3: '25.4', SpindleStatus: ' 0' }));
let mode = 'SM';
const taken = [];
setInterval(() => {
  let o; try { o = JSON.parse(readFileSync(F, 'utf8')); } catch { return; }
  const c = String(o.uCommand || '').trim();
  if (!c) return;
  taken.push(c); console.log('Sb3 took:', c);
  const [k, ...a] = c.split(',');
  const v = i => a[i] === undefined || a[i] === '' ? undefined : String(+a[i]);
  switch (k.toUpperCase()) {
    case 'JX': o.Loc_1 = v(0) ?? o.Loc_1; break;
    case 'JY': o.Loc_2 = v(0) ?? o.Loc_2; break;
    case 'JZ': o.Loc_3 = v(0) ?? o.Loc_3; break;
    case 'J2': o.Loc_1 = v(0) ?? o.Loc_1; o.Loc_2 = v(1) ?? o.Loc_2; break;
    case 'Z2': o.Loc_1 = '0'; o.Loc_2 = '0'; break;
    case 'ZZ': o.Loc_3 = '0'; break;
    case 'SP': case 'SM': mode = k.toUpperCase(); break;
    case 'FP':
      o.Status = String(mode === 'SP' ? 3 : 1);
      setTimeout(() => { const p = JSON.parse(readFileSync(F, 'utf8')); p.Status = ' 0'; writeFileSync(F, JSON.stringify(p)); console.log('Sb3: file done'); }, 1500);
      break;
  }
  o.uCommand = '';
  writeFileSync(F, JSON.stringify(o));
}, 60);
