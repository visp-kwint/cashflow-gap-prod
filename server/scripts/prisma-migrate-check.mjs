/**
 * G1-оракел: миграция WP-3 (subcategory/categoryConfidence/categorySource + PlannedEvent)
 * применяется через `prisma migrate deploy` и на пустой БД, и на загруженной (seed).
 * dev.db сбрасывается и пересидится (файл в .gitignore, seed детерминирован).
 * Выход: MIGRATE-OK (exit 0) или ошибка (exit 1).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const run = (args, opts = {}) => execFileSync('cmd.exe', ['/c', 'npx', ...args], { cwd: SERVER_DIR, stdio: 'pipe', ...opts }).toString();

const COLS = ['subcategory', 'categoryConfidence', 'categorySource'];
const EMPTY_DB = path.join(SERVER_DIR, 'prisma', 'empty-check.db');

function columnsOf(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const names = db.prepare("SELECT name FROM pragma_table_info('Operation')").all().map((r) => r.name);
  db.close();
  return names;
}
function countDemoOps(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const [r] = db.prepare(
    "SELECT COUNT(*) AS n FROM Operation WHERE userId IN (SELECT id FROM User WHERE email='demo@cashflow.ru')",
  ).all();
  db.close();
  return r.n;
}

// 1) Пустая БД: fresh файл + migrate deploy
if (fs.existsSync(EMPTY_DB)) fs.rmSync(EMPTY_DB);
fs.writeFileSync(EMPTY_DB, '');
const env = { ...process.env, DATABASE_URL: `file:${EMPTY_DB}` };
run(['prisma', 'migrate', 'deploy'], { env });
const emptyCols = columnsOf(EMPTY_DB);
for (const c of COLS) if (!emptyCols.includes(c)) {
  console.error(`MIGRATE-FAIL: пустая БД, нет столбца ${c} (получено: ${emptyCols.join(', ')})`);
  process.exit(1);
}
console.log(`пустая БД: migrate deploy применил ${COLS.join(', ')} — ok`);

// 2) Загруженная БД: dev.db сбрасываем (в .gitignore, seed детерминирован), deploy, seed, проверка данных
const DEV_DB = path.join(SERVER_DIR, 'prisma', 'dev.db');
if (fs.existsSync(DEV_DB)) fs.rmSync(DEV_DB);
run(['prisma', 'migrate', 'deploy']); // default DATABASE_URL из .env (dev.db)
execFileSync('node', ['prisma/seed/index.js'], { cwd: SERVER_DIR, stdio: 'inherit' });
const populatedCols = columnsOf(DEV_DB);
for (const c of COLS) if (!populatedCols.includes(c)) {
  console.error(`MIGRATE-FAIL: загруженная БД, нет столбца ${c}`);
  process.exit(1);
}
const demoOps = countDemoOps(DEV_DB);
if (demoOps === 0) {
  console.error('MIGRATE-FAIL: demo-операции после seed не найдены');
  process.exit(1);
}
fs.rmSync(EMPTY_DB, { force: true });
console.log(`загруженная БД: seed + ${demoOps} demo-операций, колонки на месте — ok`);
console.log('MIGRATE-OK');
