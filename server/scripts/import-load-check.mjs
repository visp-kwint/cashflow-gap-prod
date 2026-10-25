// server/scripts/import-load-check.mjs
// Oracle G13 (WP-7, ТЗ-доработка §11): загрузка выписки на 10 000 строк
// (двухлетняя история) завершается ≤ 5 секунд (POST /api/operations/import).
// Генерирует CSV-выписку на 10 000 строк (формат шаблона: 7 русских колонок, `;`, BOM+CRLF),
// поднимает server на порту 5097 (свой env, dev.db), регистрирует временного
// пользователя, импортирует файл и замеряет время.
//
// Запуск: node server/scripts/import-load-check.mjs  (из корня репозитория; sqlite dev.db обязателен)
// Успех:  IMPORT-OK (время)  — иначе IMPORT-FAIL

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 5097;
const BASE = `http://127.0.0.1:${PORT}`;
const ROWS = 10_000;
const LIMIT_MS = 5_000;

// --- env: читаем server/.env (секреты не печатаем) ---
const env = { ...process.env };
for (const line of readFileSync(path.join(REPO_ROOT, 'server', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
}
env.PORT = String(PORT);

// --- генерация 10k-строчной выписки (2 года истории, ~13-14 строк/день) ---
function generateCsv(rows) {
  const lines = ['Дата;Сумма;Направление;Контрагент;ИНН контрагента;Назначение;Остаток'];
  const day = 1000 * 60 * 60 * 24;
  const today = new Date('2026-09-29T00:00:00Z').getTime(); // детерминированная «сейчас»
  let balance = 250_000;
  for (let i = 0; i < rows; i++) {
    const iso = new Date(today - (rows - 1 - i) * day).toISOString().slice(0, 10);
    const isIncome = i % 4 === 1; // ~25% поступлений
    const amount = Math.round((isIncome ? 40_000 + (i % 7) * 9_000 : 12_000 + (i % 5) * 6_500) * 100) / 100;
    balance = Math.round((balance + (isIncome ? amount : -amount)) * 100) / 100;
    const who = isIncome ? `Поставщик №${i % 40 + 1}` : `Подрядчик №${i % 60 + 1}`;
    const inn = String(10_000_000_000 + (i * 7919) % 10_000_000_000).padStart(12, '0');
    lines.push(`${iso};${amount.toFixed(2)};${isIncome ? 'in' : 'out'};${who};${inn};Оплата по счёту №${i};${balance.toFixed(2)}`);
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
const csv = generateCsv(ROWS);

// --- поднимаем сервер ---
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
  const email = `import-load-${Date.now()}@example.ru`;
  const reg = await (await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'ImportLoad1234!', companyName: 'Import Load Co', inn: '001234567890' }),
  })).json();
  const token = reg.token;
  if (!token) {
    console.log(`FAIL регистрация не вернула токен: ${JSON.stringify(reg).slice(0, 200)}`);
    process.exit(1);
  }

  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(csv, 'utf8')], { type: 'text/csv' }), 'import-load-10k.csv');

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/operations/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  const elapsedMs = Date.now() - t0;

  console.log(`Строк: ${ROWS}, HTTP ${res.status}, imported=${body.imported ?? '?'}, duration=${elapsedMs} мс (лимит ${LIMIT_MS} мс)`);
  const ok = res.ok && (body.imported ?? ROWS) >= ROWS && elapsedMs <= LIMIT_MS;
  if (!ok) {
    console.log(`IMPORT-FAIL\n${JSON.stringify(body).slice(0, 400)}\n--- server tail ---\n${serverOut.slice(-500)}`);
    process.exit(1);
  }
  console.log(`IMPORT-OK (${Math.round(elapsedMs)} мс ≤ ${LIMIT_MS} мс)`);
} finally {
  child.kill();
}
