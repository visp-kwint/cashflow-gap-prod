/**
 * Генератор gold-набора для теста категоризации (ТЗ WP-3, контроль качества).
 *
 * Выборка: 300 операций из папки выписок (дефолт ../../test-data/statements),
 * ≥ 10 компаний, стратифицированно по направлению (50/50), фиксированный seed —
 * воспроизводимо. В столбцах expected_subcategory ставится «по умолчанию»
 * результат текущего категоризатора — его ПЕРЕПИСЫВАЮТ два участника вручную
 * (сверка, расхождения — обсуждением), затем файл коммитится.
 *
 * Запуск (из server/): node scripts/make-gold.mjs [папка-с-выписками]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseBankStatement } from '../src/utils/parser.js';
import { categorize } from '../src/services/categorizer.service.js';

const SEED = 42;
const SIZE = 300;
const SERVER_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(SERVER_DIR, 'tests', 'fixtures', 'categories.gold.csv');

/** Детерминированный ГПСЧ (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadCompany(file) {
  const buf = fs.readFileSync(file);
  const { operations } = await parseBankStatement(buf, path.basename(file), null);
  return { file: path.basename(file), operations };
}

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(SERVER_DIR, '..', 'test-data', 'statements');
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  if (files.length === 0) {
    console.error(`Выписки не найдены: ${dir}. Подставьте датасет организаторов (ТЗ WP-1 п.3).`);
    process.exit(1);
  }

  // Компании: не менее 10 разных (если датасет меньше — все доступные, с предписанием)
  const nCompanies = Math.min(10, files.length);
  const rnd = rng(SEED);
  const picked = files
    .map((f) => ({ f, k: rnd() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, nCompanies)
    .map((x) => x.f);

  const companies = await Promise.all(picked.map(loadCompany));
  const ins = companies.flatMap((c) => c.operations.map((o) => ({ ...o, company_id: c.file })))
    .filter((o) => o.direction === 'in');
  const outs = companies.flatMap((c) => c.operations.map((o) => ({ ...o, company_id: c.file })))
    .filter((o) => o.direction === 'out');

  const takeStratified = (pool, n) => {
    const keys = [...new Set(pool.map((o) => o.company_id))];
    const per = Math.floor(n / keys.length);
    const picked2 = [];
    for (const k of keys) {
      const ops = pool.filter((o) => o.company_id === k);
      for (let i = 0; i < per && i < ops.length; i++) picked2.push(ops[Math.floor(rnd() * ops.length)]);
    }
    // добор до n из остатка пула
    let i = 0;
    while (picked2.length < n && pool.length) picked2.push(pool[(Math.floor(rnd() * pool.length) + i++) % pool.length]);
    return picked2.slice(0, n);
  };

  const rows = [
    ...takeStratified(ins, Math.floor(SIZE / 2)),
    ...takeStratified(outs, SIZE - Math.floor(SIZE / 2)),
  ];

  // Столбец expected_subcategory — стартовое приближение (текущий категоризатор);
  // оба участника перепроверяют и правят значения руками.
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['company_id,operation_id,direction,purpose,counterparty_inn,expected_subcategory'];
  rows.forEach((o, i) => {
    const cat = categorize(
      { direction: o.direction, purpose: o.purpose, counterpartyInn: o.counterpartyInn, counterpartyName: o.counterpartyName, amount: o.amount },
      {},
    );
    lines.push(
      [q(o.company_id), q(`row-${i}`), q(o.direction), q(o.purpose), q(o.counterpartyInn ?? ''), q(cat.subcategory)].join(','),
    );
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`Создано ${rows.length} строк из ${nCompanies} компаний: ${OUT}`);
  console.log('expected_subcategory — стартовое приближение; перепроверьте вручную (ТЗ: разметка двумя участниками).');
  if (nCompanies < 10) console.log(`Предупреждение: доступно только ${nCompanies} компаний (ТЗ требует ≥ 10).`);
}

main().catch((e) => {
  console.error('Ошибка make-gold:', e.message);
  process.exit(1);
});
