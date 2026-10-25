/**
 * G2-оракел: качество категоризации на C001 по приёмке WP-3 (ТЗ §4) и отчёту:
 * ≥ 8 разных подкатегорий, other_*+unknown ≤ 10 %, 0 операций с несовместимым
 * направлением, все «ЕНП / единый налоговый платеж» → tax.
 * Выход: CATEGORIZE-OK (exit 0) или CATEGORIZE-FAIL (exit 1) с цифрами.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseBankStatement } from '../src/utils/parser.js';
import { categorizeStatement } from '../src/services/categorizer.service.js';
import { SUBCATEGORY_BY_ID } from '../src/config/categories.config.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const buf = fs.readFileSync(path.join(REPO_ROOT, 'test-data', 'C001.csv'));
const { operations } = await parseBankStatement(buf, 'C001.csv', null);
const cat = categorizeStatement(operations, null);

const counts = {};
for (const o of cat) counts[o.subcategory] = (counts[o.subcategory] ?? 0) + 1;
const distinct = Object.keys(counts).filter((c) => c !== 'unknown').length;
const other = (counts.other_in ?? 0) + (counts.other_out ?? 0) + (counts.unknown ?? 0);
const otherPct = (100 * other) / cat.length;
let mismatch = 0;
for (const o of cat) {
  const meta = SUBCATEGORY_BY_ID[o.subcategory];
  if (meta && o.subcategory !== 'unknown' && meta.direction !== o.direction) mismatch += 1;
}
const enp = cat.filter((o) => /енп|еднп|единый налог/i.test(o.purpose ?? ''));
const enpTax = enp.filter((o) => o.subcategory === 'tax').length;

console.log(
  JSON.stringify(
    {
      total: cat.length,
      distinct,
      counts,
      otherPct: Number(otherPct.toFixed(2)),
      directionMismatch: mismatch,
      enpTotal: enp.length,
      enpTax,
    },
    null,
    1,
  ),
);

const problems = [];
if (distinct < 8) problems.push(`distinct=${distinct} < 8`);
if (otherPct > 10) problems.push(`other+unknown=${otherPct.toFixed(1)}% > 10%`);
if (mismatch > 0) problems.push(`directionMismatch=${mismatch} > 0`);
if (enp.length && enpTax < enp.length) problems.push(`енп→tax: ${enpTax}/${enp.length}`);

if (problems.length) {
  console.error(`CATEGORIZE-FAIL: ${problems.join('; ')}`);
  process.exit(1);
}
console.log('CATEGORIZE-OK');
