// server/scripts/scenarios-doc-check.mjs — ТЗ-доработка WP-4 (гейт G32):
// docs/SCENARIOS.md содержит 4 типа сценариев, параметры-диапазоны и формулы применения.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const docPath = resolve(here, '../../docs/SCENARIOS.md');

let doc;
try {
  doc = readFileSync(docPath, 'utf8');
} catch {
  console.error('SCEN-DOC-FAIL: docs/SCENARIOS.md не найден');
  process.exit(1);
}

const mustHave = [
  // 4 типа
  'client_delay',
  'revenue_drop',
  'unplanned_expense',
  'fixed_costs_growth',
  // параметры-диапазоны
  '14', // days 14–28
  '30', // revenue_drop 0–30
  '50', // fixed_costs_growth 0–50
  'percent',
  'days',
  // формулы
  '(1 − percent/100)',
  '(1 + percent/100)',
  // подкатегории
  'revenue_clients',
  'rent',
  'suppliers',
  // API
  'POST /api/scenarios/simulate',
  'GET /api/scenarios/clients',
];

const missing = mustHave.filter((s) => !doc.includes(s));
if (missing.length) {
  console.error(`SCEN-DOC-FAIL: не найдено в docs/SCENARIOS.md: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('SCENARIOS-DOC-OK');
