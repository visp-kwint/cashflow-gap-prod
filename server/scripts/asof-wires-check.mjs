// server/scripts/asof-wires-check.mjs
// Oracle G8 (WP-7, ТЗ-доработка §9): опорная дата (asOf) передана во все вызовы
// calculateForecast: calendar.service.js, bank.service.js, taxCalendar.service.js,
// sandbox.service.js, dashboard.controller.js + utils/asOf.js (getAsOfDate).
// Статическая проверка + node --check (синтаксис). Сеть и БД не нужны.
//
// Запуск: node server/scripts/asof-wires-check.mjs  (из корня репозитория)
// Успех:  ASOF-WIRED-OK  (нет строки = fail)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRV = (p) => path.join(REPO_ROOT, 'server', p);

let fail = 0;
const need = (file, pattern, note) => {
  const text = readFileSync(SRV(file), 'utf8');
  if (pattern.test(text)) console.log(`OK  ${file}: ${note}`);
  else { console.log(`FAIL ${file}: не найдено — ${note}`); fail++; }
};
const absent = (file, pattern, note) => {
  const text = readFileSync(SRV(file), 'utf8');
  if (!pattern.test(text)) console.log(`OK  ${file}: ${note}`);
  else { console.log(`FAIL ${file}: есть то, чего быть не должно — ${note}`); fail++; };
};

// utils/asOf.js — базовая функция (ТЗ §9): поведение на границах (детерминированно, «now» фиксирован)
const { getAsOfDate } = await import(pathToFileURL(SRV('src/utils/asOf.js')));
{
  const NOW = new Date('2026-10-25T00:00:00Z');
  const checks = [
    [getAsOfDate('2026-10-25', NOW) === '2026-10-25', 'сегодня → сегодня'],
    [getAsOfDate('2026-10-22', NOW) === '2026-10-25', 'граница ≤ 3 дн. (3 дня назад) → сегодня'],
    [getAsOfDate('2026-10-21', NOW) === '2026-10-21', '4 дня назад → последняя дата'],
    [getAsOfDate(null, NOW) === null, 'нет операций → null'],
  ];
  for (const [ok, note] of checks) {
    if (ok) console.log(`OK  asOf.js: ${note}`);
    else { console.log(`FAIL asOf.js: ${note}`); fail++; }
  }
}
// Правило 30 дней живёт в dashboard.controller.js: окно итогов (asOf − 30 дн … asOf]
need('src/controllers/dashboard.controller.js', /asOfMs/, 'окно итогов от asOf (asOfMs)');

// Все вызовы calculateForecast пропущены через asOf
need('src/services/calendar.service.js', /getAsOfDate/, 'getAsOfDate импортирован');
need('src/services/calendar.service.js', /today: asOf/, 'опция today: asOf передана');
need('src/services/bank.service.js', /today: getAsOfDate/, 'опция today из getAsOfDate');
need('src/services/taxCalendar.service.js', /toUtcDay\(fromDate\)/, 'привязка к опорной дате (fromDate), а не new Date()');
absent('src/services/taxCalendar.service.js', /toUtcDay\(new Date\(\)\)/, 'нет «полётного» new Date()');
need('src/services/sandbox.service.js', /today: asOf/, 'опция today: asOf передана');
need('src/controllers/dashboard.controller.js', /today: asOf/, 'опция today: asOf передана');

// Синтаксис всех затронутых файлов
for (const f of [
  'src/utils/asOf.js',
  'src/services/calendar.service.js',
  'src/services/bank.service.js',
  'src/services/taxCalendar.service.js',
  'src/services/sandbox.service.js',
  'src/controllers/dashboard.controller.js',
]) {
  try {
    execFileSync(process.execPath, ['--check', SRV(f)], { stdio: 'pipe', cwd: REPO_ROOT });
    console.log(`OK  ${f}: node --check`);
  } catch (e) {
    console.log(`FAIL ${f}: node --check: ${String(e.message).slice(0, 160)}`);
    fail++;
  }
}

if (fail) {
  console.log(`ASOF-WIRED-FAIL (${fail})`);
  process.exit(1);
}
console.log('ASOF-WIRED-OK');
