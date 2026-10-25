import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G4 oracle: TZ gaps closed — threshold T config + statement template.
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

const api = read('src/api/index.ts');
assert(/user:\s*\{[\s\S]{0,240}?\/user/.test(api), 'api: user.update -> PATCH /user');
assert(api.includes('minBalance'), 'api: minBalance in user.update');

const dash = read('src/pages/Dashboard.tsx');
assert(
  dash.includes('ThresholdEditor') && /api\.user\.update\(\{\s*minBalance/.test(dash),
  'Dashboard: threshold T editor saves via user.update',
);

const auth = read('src/pages/Auth.tsx');
assert(
  auth.includes('statement-template.csv') && auth.includes('Скачать шаблон выписки'),
  'Auth: template download link on registration',
);

const csvPath = path.join(clientDir, 'public/statement-template.csv');
assert(existsSync(csvPath), 'public/statement-template.csv exists');
if (existsSync(csvPath)) {
  const raw = readFileSync(csvPath);
  const header = raw.toString('utf8').replace(/^\uFEFF/, '').split('\n', 1)[0];
  assert(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf, 'CSV: BOM for Excel');
  assert(
    header.includes('Дата') &&
      header.includes('Контрагент') &&
      header.includes('ИНН') &&
      header.includes('Назначение') &&
      header.includes('Сумма'),
    'CSV: header has Дата/Контрагент/ИНН/Назначение/Сумма',
  );
}

const contract = readRepo('docs/api-contract.md');
assert(
  contract.includes('PATCH /user') && contract.includes('Шаблон выписки'),
  'contract: PATCH /user + statement template documented',
);

if (failed) {
  console.error('tz gap checks FAILED');
  process.exit(1);
}
console.log('tz gap fixes verified');
