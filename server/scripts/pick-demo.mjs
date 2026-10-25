// server/scripts/pick-demo.mjs
// ТЗ-доработка §13: выбор трёх демо-выписок из датасета организаторов.
//
// Правила выбора (ТЗ):
//   1) история выписки не менее 18 месяцев;
//   2) при asOf = последней дате выписки модель даёт gapProbabilityPct ≥ 30
//      на горизонте 30 дней при T = P10 (10-й перцентиль остатков balance_eod до asOf);
//   3) виды бизнеса разные (поле из companies.csv рядом с выписками, если есть).
//
// Результат: выписки копируются в test-data/demo/ (statement-demo-<COMPANY>.csv)
// вместе с соседними файлами tax-calendar-<COMPANY>.csv и counterparties-<COMPANY>.json,
// если они есть. Скрипт детерминирован: фиксированный порядок обхода (лексический)
// и фиксированный seed Монте-Карло (FORECAST_CONFIG.monteCarloSeed).
//
// Запуск (из корня репозитория):
//   node server/scripts/pick-demo.mjs [папка с выписками] [--demo-dir <папка вывода>]
// Папка по умолчанию: test-data/statements (запуск из корня репозитория: node server/scripts/pick-demo.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBankStatement } from '../src/utils/parser.js';
import { calculateForecast } from '../src/services/forecast.service.js';
import { FORECAST_CONFIG } from '../src/config/forecast.config.js';

// ------------------------------- параметры -------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_STATEMENTS_DIR = path.join(REPO_ROOT, 'test-data', 'statements');
const MIN_HISTORY_MONTHS = 18; // ТЗ §13
const HORIZON_DAYS = 30; // ТЗ §13
const MIN_GAP_PROBABILITY_PCT = 30; // ТЗ §13
const DEMO_COUNT = 3; // ТЗ §13: три компании, разные виды бизнеса
const SEED = FORECAST_CONFIG.monteCarloSeed; // детерминированность (ТЗ §3)

const args = process.argv.slice(2);
let statementsDir = DEFAULT_STATEMENTS_DIR;
let demoDirOverride = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--demo-dir') demoDirOverride = args[++i];
  else if (!String(args[i]).startsWith('-')) statementsDir = String(args[i]);
}
statementsDir = path.resolve(statementsDir);
const demoDir = demoDirOverride ? path.resolve(demoDirOverride) : path.join(statementsDir, '..', 'demo');

// ------------------------------- утилиты -------------------------------

/** Число полных месяцев между датами ГГГГ-ММ-ДД (+1, если конечный день месяца позже начального). */
function monthsBetween(aIso, bIso) {
  const [ay, am, ad] = aIso.split('-').map(Number);
  const [by, bm, bd] = bIso.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am) + (bd > ad ? 1 : 0);
}

/** Ближайший квантиль (nearest-rank), как в forecast.service.js (quantile). */
function quantile(sorted, q) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
}

/** Разбирает CSV-строку с учётом кавычек, разделитель ';'. */
function splitLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ';') { fields.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  fields.push(cur.trim());
  return fields;
}

/** companies.csv рядом с выписками (иначе — в родительской папке датасета): Map company_id → вид бизнеса. */
function loadBusinessTypes(dir) {
  const map = new Map();
  let notes = [];
  const candidates = [path.join(dir, 'companies.csv'), path.join(path.dirname(dir), 'companies.csv')];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    notes.push('companies.csv не найден — вид бизнеса считается «не указан» (проверка «разные виды бизнеса» по факту не выполняется)');
    return { map, notes };
  }
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { map, notes: ['companies.csv пуст — вид бизнеса «не указан»'] };
  const header = splitLine(lines[0]);
  const idCol = header.findIndex((h) => /company_?id|^id$/i.test(h));
  const bizCol = header.findIndex((h) => /вид|business|activity|отрасл|industry/i.test(h));
  if (idCol === -1 || bizCol === -1) {
    notes.push(`companies.csv: не распознаны заголовки (колонки id/вид бизнеса) в «${header.join('|')}» — вид бизнеса «не указан»`);
    return { map, notes };
  }
  for (const line of lines.slice(1)) {
    const parts = splitLine(line);
    const cid = (parts[idCol] || '').trim();
    const biz = (parts[bizCol] || '').trim();
    if (cid) map.set(cid.toUpperCase(), biz || 'не указан');
  }
  notes.push(`вид бизнеса: companies.csv → колонки id=${header[idCol]}, вид=${header[bizCol]}`);
  return { map, notes };
}

/** Имя файла демо для компании: statement-demo-C012.csv. */
const demoName = (cid, prefix, ext) => `${prefix}-demo-${cid}.${ext}`;

// ------------------------------- основной поток -------------------------------

function fail(msg) {
  console.error(`\nОшибка: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(statementsDir) || !fs.statSync(statementsDir).isDirectory()) {
  fail([
    `каталог выписок не найден: ${statementsDir}`,
    'Куда положить файлы: датасет организаторов (из чата с менторами: 20+ компаний, 8+ видов бизнеса,',
    'выписки C001.csv… + companies.csv) распакуйте в эту папку. В репозиторий датасет НЕ коммитится',
    '(test-data/statements/ в .gitignore), пример формата — test-data/C001.csv, детали — test-data/README.md.',
    'После загрузки запустите: node server/scripts/pick-demo.mjs',
  ].join('\n'));
}

const files = fs.readdirSync(statementsDir)
  .filter((f) => f.toLowerCase().endsWith('.csv'))
  .filter((f) => !/^companies\.csv$/i.test(f)) // справочник — не выписка
  .sort(); // фиксированный лексический порядок → детерминированный результат

if (files.length === 0) {
  fail([
    `в ${statementsDir} нет ни одного *.csv (кроме companies.csv)`,
    'Куда положить файлы: датасет организаторов (из чата с менторами) — папку statements/ с выписками',
    'C001.csv… и companies.csv. В репозиторий датасет НЕ коммитится (test-data/statements/ в .gitignore);',
    'описание формата — test-data/README.md, пример — test-data/C001.csv.',
  ].join('\n'));
}

const { map: bizTypes, notes: bizNotes } = loadBusinessTypes(statementsDir);

const candidates = [];
const skipped = [];

for (const file of files) {
  const sourcePath = path.join(statementsDir, file);
  const cid = file.replace(/\.csv$/i, '').toUpperCase();

  let parsed;
  try {
    parsed = await parseBankStatement(fs.readFileSync(sourcePath), file);
  } catch (err) {
    skipped.push({ file, reason: `не распарсено: ${err.message}` });
    continue;
  }
  if (parsed.operations.length === 0) {
    skipped.push({ file, reason: 'пустая выписка (0 операций)' });
    continue;
  }

  const dates = parsed.operations.map((o) => o.date.slice(0, 10)).sort();
  const minDate = dates[0];
  const maxDate = dates.at(-1);
  const months = monthsBetween(minDate, maxDate);
  if (months < MIN_HISTORY_MONTHS) {
    skipped.push({ file, reason: `история ${months} мес. < ${MIN_HISTORY_MONTHS}` });
    continue;
  }

  // asOf = последняя дата выписки; T = P10 остатков (balance_eod) до asOf (ТЗ §13, §7 backtest)
  const asOf = maxDate;
  const balances = parsed.operations.filter((o) => o.date.slice(0, 10) <= asOf && Number.isFinite(o.balanceEndOfDay))
    .map((o) => o.balanceEndOfDay).sort((a, b) => a - b);
  const threshold = quantile(balances, 0.1);
  const lastOp = parsed.operations.filter((o) => o.date.slice(0, 10) === asOf).at(-1);
  const currentBalance = lastOp?.balanceEndOfDay;
  if (!Number.isFinite(currentBalance)) {
    skipped.push({ file, reason: 'остаток на asOf не получен из выписки' });
    continue;
  }

  let forecast;
  try {
    forecast = calculateForecast(parsed.operations, [], currentBalance, HORIZON_DAYS, threshold, { today: asOf, seed: SEED });
  } catch (err) {
    skipped.push({ file, reason: `прогноз не рассчитан: ${err.message}` });
    continue;
  }

  const gap = forecast.gapProbabilityPct;
  const business = bizTypes.get(cid) || 'не указан';
  if (gap < MIN_GAP_PROBABILITY_PCT) {
    skipped.push({ file, reason: `gapProbabilityPct ${gap} < ${MIN_GAP_PROBABILITY_PCT} (asOf ${asOf}, T=P10=${threshold})` });
    continue;
  }
  candidates.push({
    file,
    sourcePath,
    cid,
    business,
    asOf,
    threshold,
    gap,
    months,
    rows: parsed.operations.length,
  });
}

console.log(`Обход: ${files.length} выписок, кандидатов по правилам — ${candidates.length}`);
for (const n of bizNotes) console.log(`Примечание: ${n}`);
for (const s of skipped) console.log(`  пропущено: ${s.file} — ${s.reason}`);

// Жадный выбор: в лексическом порядке, разные виды бизнеса
const picked = [];
for (const c of candidates) {
  if (picked.length >= DEMO_COUNT) break;
  if (picked.some((p) => p.business === c.business)) continue;
  picked.push(c);
}
if (picked.length < DEMO_COUNT) {
  fail([
    `не удалось выбрать ${DEMO_COUNT} компании с РАЗНЫМИ видами бизнеса:`,
    `кандидатов по правилам (история ≥ ${MIN_HISTORY_MONTHS} мес, gapProbabilityPct ≥ ${MIN_GAP_PROBABILITY_PCT} при T=P10, asOf) найдено: ${candidates.length}`,
    candidates.map((c) => `  - ${c.file} (вид: ${c.business}, gap ${c.gap}%, asOf ${c.asOf})`).join('\n'),
    'Требуется датасет шире (разные виды бизнеса), либо правила ТЗ не выполнены на этом датасете — сообщите менторам.',
  ].join('\n'));
}

// Копирование в test-data/demo/
fs.mkdirSync(demoDir, { recursive: true });
const copied = [];
for (const c of picked) {
  const targets = [
    { from: c.sourcePath, to: path.join(demoDir, demoName(c.cid, 'statement', 'csv')) },
  ];
  // Соседние файлы по компании (если есть в папке выписок или в корне датасета);
  // ищем оба обозначения: tax-calendar-C002.csv / tax-calendar-demo-C002.csv
  for (const dir of [statementsDir, path.dirname(statementsDir)]) {
    for (const [prefix, ext] of [['tax-calendar', 'csv'], ['counterparties', 'json']]) {
      const found =
        [`${prefix}-${c.cid}.${ext}`, `${prefix}-demo-${c.cid}.${ext}`]
          .map((n) => path.join(dir, n))
          .find((p) => fs.existsSync(p));
      if (found) targets.push({ from: found, to: path.join(demoDir, demoName(c.cid, prefix, ext)) });
    }
  }
  for (const t of targets) {
    fs.copyFileSync(t.from, t.to);
    copied.push({ ...t, size: fs.statSync(t.to).size });
  }
}

// ------------------------------- отчёт -------------------------------

console.log(`\nВыбрано ${picked.length} компаний (виды бизнеса: ${[...new Set(picked.map((p) => p.business))].join(', ')})`);
for (const c of picked) {
  const rows = copied.filter((r) => r.to.includes(c.cid));
  for (const r of rows) {
    console.log(`  ${path.relative(REPO_ROOT, r.to)} (${r.size} Б)  <-  ${path.relative(REPO_ROOT, r.from)}`);
  }
  console.log(`  ${c.cid}: asOf=${c.asOf}  T(P10)=${Math.round(c.threshold)} ₽  gapProbabilityPct=${c.gap}%  история=${c.months} мес  строк=${c.rows}  вид=${c.business}`);
}
console.log(`\nГотово: ${copied.length} файлов скопировано в ${demoDir}`);
console.log('Демо-данные загружаются кнопкой «Использовать демо-данные» и npm run seed (ТЗ §13).');
