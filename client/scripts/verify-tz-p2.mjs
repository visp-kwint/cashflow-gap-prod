import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G5 oracle: remaining TZ mismatches fixed (nav 4+menu, flame icon, loan rate, /history/:id).
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(clientDir, rel), 'utf8');
const readRepo = (rel) => readFileSync(path.resolve(clientDir, '..', rel), 'utf8');

let failed = false;
function assert(cond, name) {
  if (cond) console.log(`ok: ${name}`);
  else {
    console.error(`FAIL: ${name}`);
    failed = true;
  }
}

const nav = read('src/components/layout/BottomNav.tsx');
assert(
  !/['"]\/sandbox['"]/.test(nav) && !/['"]\/calendar['"]/.test(nav) && nav.includes('grid-cols-4'),
  'BottomNav: 4 items, sandbox/calendar removed (ТЗ §5.2.6)',
);

const dash = read('src/pages/Dashboard.tsx');
assert(
  dash.includes("navigate('/sandbox')") && dash.includes("navigate('/calendar')"),
  'Dashboard: menu items Песочница/Календарь on main page',
);

const cal = read('src/pages/Calendar.tsx');
assert(cal.includes('Flame'), 'Calendar: flame icon on danger days (ТЗ §5.11)');

const types = read('src/types/api.ts');
assert(types.includes('loanRatePct'), 'types: loanRatePct in DashboardResponse');

const stub = read('src/pages/BankStub.tsx');
assert(
  stub.includes('loanRatePct') && stub.includes('константа'),
  'BankStub: loan rate shown in form (ТЗ §5.7)',
);

const contract = readRepo('docs/api-contract.md');
assert(contract.includes('loanRatePct'), 'contract: loanRatePct documented');

assert(read('src/App.tsx').includes('history/:id'), 'route /history/:id (ТЗ §5.5)');
assert(read('src/pages/History.tsx').includes('/history/'), 'History: links to /history/:id');

if (failed) {
  console.error('tz p2 checks FAILED');
  process.exit(1);
}
console.log('tz p2 mismatches fixed');
