// server/scripts/dashboard-asof-check.mjs
// Oracles G7–G11 (WP-7, ТЗ-доработка §9–§10):
//   G7: FORECAST_AS_OF применяется ТОЛЬКО к демо-учётке (demo@cashflow.ru из seed/контракта);
//       обычные пользователи берут asOf из своих данных.
//   G9: итоги «за 30 дней» считаются от опорной даты asOf, а не от new Date().
//   G10: в ответе GET /api/dashboard есть top-level поле asOf.
//   G11: при истории < 14 дней Монте-Карло не запускать (mcDisabled: historyDays < 14).
// Живая проверка через API: поднимает server на порту 5098 (свой env), демо-логин,
// регистрация временного пользователя + импорт 2-строчной выписки за сегодня, сравнение asOf.
//
// Запуск: node server/scripts/dashboard-asof-check.mjs  (из корня репозитория; sqlite dev.db обязателен)
// Успех:  DASH-ASOF-OK

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 5098;
const BASE = `http://127.0.0.1:${PORT}`;
const OVERRIDE = '2026-09-29'; // значение FORECAST_AS_OF из server/.env (seed)
const DEMO_EMAIL = 'demo@cashflow.ru';

// --- env: читаем server/.env (секреты не печатаем) ------------------------------
const env = { ...process.env };
const envFile = readFileSync(path.join(REPO_ROOT, 'server', '.env'), 'utf8');
for (const line of envFile.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
}
env.PORT = String(PORT);
env.FORECAST_AS_OF = OVERRIDE;

let fail = 0;
const check = (ok, note) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${note}`);
  if (!ok) fail++;
};

// --- поднимаем сервер -----------------------------------------------------------
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: path.join(REPO_ROOT, 'server'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  try { await fetch(`${BASE}/api`); ready = true; break; } catch { /* ещё поднимается */ }
}
if (!ready) {
  console.log(`FAIL сервер на ${PORT} не поднялся\n${serverOut.slice(-800)}`);
  child.kill();
  process.exit(1);
}

try {
  // --- G10 + G7 (демо-учётка): asOf = override, поле top-level -----------------
  const login = await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: 'demo1234' }),
  })).json();
  check(!!login.token, `демо-логин ${DEMO_EMAIL}`);
  const dashDemo = await (await fetch(`${BASE}/api/dashboard`, {
    headers: { authorization: `Bearer ${login.token}` },
  })).json();
  check(dashDemo.asOf === OVERRIDE, `G10: top-level asOf в ответе dashboard (${dashDemo.asOf ?? 'отсутствует'})`);
  check(dashDemo.asOf === OVERRIDE, `G7: FORECAST_AS_OF применён к демо-учётке (${OVERRIDE})`);
  check(dashDemo.dataQuality?.asOf === OVERRIDE, `G10: dataQuality.asOf согласован (${dashDemo.dataQuality?.asOf ?? '—'})`);

  // --- G7 (обычный пользователь): asOf из своих данных, override игнорируется ----
  const today = new Date().toISOString().slice(0, 10);
  const email = `asof-check-${Date.now()}@example.ru`;
  const reg = await (await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'AsOfCheck1234!', companyName: 'AsOf Check Co', inn: '001234567890' }),
  })).json();
  check(!!reg.token, 'G7: регистрация временного пользователя');
  const csv =
    '\uFEFFДата;Сумма;Направление;Контрагент;ИНН контрагента;Назначение;Остаток\r\n' +
    `${today};50000.00;in;Поставщик А;001234567890;Оплата счёта;150000.00\r\n` +
    `${today};12000.00;out;Поставщик Б;001234567891;Платёж;138000.00\r\n`;
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(csv, 'utf8')], { type: 'text/csv' }), 'asof-check.csv');
  const imp = await fetch(`${BASE}/api/operations/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${reg.token}` },
    body: fd,
  });
  const impBody = await imp.json();
  check(imp.ok, `G7: импорт выписки (${impBody.imported ?? imp.status}) операций`);
  const dashNew = await (await fetch(`${BASE}/api/dashboard`, {
    headers: { authorization: `Bearer ${reg.token}` },
  })).json();
  check(dashNew.asOf === today, `G7: у обычного пользователя asOf = сегодня (${dashNew.asOf ?? '—'}), override проигнорирован`);
  check(dashNew.asOf !== OVERRIDE, 'G7: обычный пользователь не получает demo-override');

  // --- G9 (статика): окно итогов от asOf, не от new Date() ----------------------
  const dashCtrl = readFileSync(path.join(REPO_ROOT, 'server/src/controllers/dashboard.controller.js'), 'utf8');
  check(/asOfMs/.test(dashCtrl) && /asOf/.test(dashCtrl) && !/thirtyDaysAgo/.test(dashCtrl),
    'G9: контроллер дашборда считает окно итогов от asOf (asOfMs-окно), без thirtyDaysAgo');

  // --- G11 (статика + поведение): MC не запускается при истории < 14 дней --------
  const dashSvc = readFileSync(path.join(REPO_ROOT, 'server/src/services/sandbox.service.js'), 'utf8');
  check(/historyDays < 14/.test(dashCtrl), 'G11: dashboard — mcDisabled: historyDays < 14');
  check(/historyDays < 14/.test(dashSvc), 'G11: sandbox — mcDisabled: historyDays < 14');
  const fc = await import(pathToFileURL(path.join(REPO_ROOT, 'server/src/services/forecast.service.js')));
  const twoOps = [
    { date: today, amount: 50000, direction: 'in', balanceEndOfDay: 50000 },
    { date: today, amount: 10000, direction: 'out', balanceEndOfDay: 40000 },
  ];
  const mcOn = fc.calculateForecast(twoOps, [], 40000, 30, 0, { today: new Date() });
  const mcOff = fc.calculateForecast(twoOps, [], 40000, 30, 0, { today: new Date(), mcDisabled: true });
  check(mcOn.gapProbabilityPct != null, `G11: MC включён по умолчанию (gapProbabilityPct=${mcOn.gapProbabilityPct})`);
  check(mcOff.gapProbabilityPct === null, 'G11: mcDisabled — Монте-Карло не запускается (gapProbabilityPct = null)');
} finally {
  child.kill();
}

if (fail) {
  console.log(`DASH-ASOF-FAIL (${fail})\n--- server tail ---\n${serverOut.slice(-600)}`);
  process.exit(1);
}
console.log('DASH-ASOF-OK');
