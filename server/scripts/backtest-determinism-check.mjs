/**
 * G6-оракел: бэктест запускается на доступных файлах, создаёт docs/backtest-results.json и
 * docs/BACKTEST.md; повторный запуск даёт идентичный JSON (кроме runAt/durationSec).
 * Выход: DETERM-OK (exit 0) или DETERM-FAIL (exit 1).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const TARGET = path.join(REPO_ROOT, 'test-data', 'C001.csv'); // доступный CSV; полный датасет — AB-1
const JSON_OUT = path.join(REPO_ROOT, 'docs', 'backtest-results.json');
const MD_OUT = path.join(REPO_ROOT, 'docs', 'BACKTEST.md');

function runBacktest() {
  execFileSync('node', ['scripts/backtest.mjs', TARGET], { cwd: SERVER_DIR, stdio: 'pipe' });
}

function strip(obj) {
  const clone = JSON.parse(JSON.stringify(obj));
  clone.runAt = null;
  clone.durationSec = null;
  return JSON.stringify(clone);
}

runBacktest();
if (!fs.existsSync(JSON_OUT) || !fs.existsSync(MD_OUT)) {
  console.error('DETERM-FAIL: файлы отчёта не созданы');
  process.exit(1);
}
const first = strip(JSON.parse(fs.readFileSync(JSON_OUT, 'utf-8')));
runBacktest();
const second = strip(JSON.parse(fs.readFileSync(JSON_OUT, 'utf-8')));
if (first !== second) {
  console.error('DETERM-FAIL: повторный запуск дал другой JSON (без runAt/durationSec)');
  process.exit(1);
}
const res = JSON.parse(second);
if (res.overall && !res.overall[30]?.balance) {
  console.error('DETERM-FAIL: в отчёте нет метрик для основного горизонта H=30');
  process.exit(1);
}
console.log(
  `H=30: точек ${res.overall[30].evaluatedCuts}, MAE ${res.overall[30].balance.mae.toFixed(0)}, skill ${res.overall[30].balance.skill}`,
);
console.log('DETERM-OK');
