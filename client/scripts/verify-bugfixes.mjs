import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G2 oracle: all 4 bug fixes are present in source.
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(clientDir, rel), 'utf8');

let failed = false;
function assert(cond, name) {
  if (cond) console.log(`ok: ${name}`);
  else {
    console.error(`FAIL: ${name}`);
    failed = true;
  }
}

const app = read('src/App.tsx');
assert(app.includes('useLocation()'), 'App.tsx: protected redirect reads current location');
assert(/state=\{\{ from:/.test(app), 'App.tsx: Navigate to /auth carries state.from');

const cal = read('src/pages/Calendar.tsx');
assert(
  /function changeMonth[\s\S]{0,160}?setSelected\(null\)/.test(cal),
  'Calendar.tsx: month switch closes the day modal',
);

const dash = read('src/pages/Dashboard.tsx');
assert(
  /dashboard\.error[\s\S]{0,400}?Ошибка обновления данных/.test(dash),
  'Dashboard.tsx: refresh-error banner shown when stale data is on screen',
);

const pay = read('src/pages/Payments.tsx');
assert(pay.includes('pullError'), 'Payments.tsx: pull-from-bank has its own error state');

if (failed) {
  console.error('bugfix checks FAILED');
  process.exit(1);
}
console.log('bugfix verification passed');
