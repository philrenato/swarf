// The browser every swarf gate and probe launches: CHROME if set; else the test launcher
// (~/.local/bin/chrome-for-testing, which keeps test downloads out of ~/Downloads, then starts
// Chrome for Testing); else Chrome for Testing itself, on a machine without the launcher.
import { existsSync } from 'node:fs';
const WRAPPER = (process.env.HOME || '') + '/.local/bin/chrome-for-testing';
const REAL = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
export const CHROME = process.env.CHROME || (existsSync(WRAPPER) ? WRAPPER : REAL);
export default CHROME;
