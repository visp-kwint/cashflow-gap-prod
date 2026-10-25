// server/scripts/baselines-check.mjs — приёмка WP-2 (Гейт G23):
// 1) forecast.baselines.js — 7 чистых подходов, только относительные импорты (без новых зависимостей);
// 2) Holt-Winters реализован вручную (нет внешнего hw-пакета), параметры в forecast.config.js;
// 3) тесты forecast.baselines.test.js существуют.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const SRC = path.join(REPO_ROOT, 'server', 'src', 'services', 'forecast.baselines.js');
const CFG = path.join(REPO_ROOT, 'server', 'src', 'config', 'forecast.config.js');
const TEST = path.join(REPO_ROOT, 'server', 'tests', 'forecast.baselines.test.js');
for (const p of [SRC, CFG, TEST]) if (!existsSync(p)) fail(`нет файла ${path.relative(REPO_ROOT, p)}`);

const src = readFileSync(SRC, 'utf8');
// 1. Семь подходов и реестр
for (const id of ['naive', 'mean90', 'weekday', 'last30', 'holtwinters', 'core', 'full']) {
  if (!src.includes(`'${id}'`)) fail(`нет подхода ${id}`);
}
if (!/export const BASELINE_IDS/.test(src)) fail('нет экспорта BASELINE_IDS');
// 2. Только относительные импорты — без новых npm-зависимостей
const imports = [...src.matchAll(/^import .*? from '([^']+)';/gm)].map((m) => m[1]);
for (const i of imports) {
  if (!i.startsWith('.')) fail(`внешняя зависимость в forecast.baselines.js: ${i}`);
}
if (!imports.some((i) => i.includes('forecast.service.js'))) fail('нет импорта calculateForecast (core/full подходы)');
// 3. Параметры Holt-Winters в конфиге
const cfg = readFileSync(CFG, 'utf8');
for (const key of ['holtwintersPeriod', 'holtwintersAlpha', 'holtwintersBeta', 'holtwintersGamma', 'holtwintersTrainWeeks']) {
  if (!cfg.includes(key)) fail(`в forecast.config.js нет параметра ${key}`);
}
console.log('BASELINES-OK: 7 чистых подходов, без новых зависимостей, параметры HW в конфиге');
