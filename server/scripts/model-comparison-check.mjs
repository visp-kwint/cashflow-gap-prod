// server/scripts/model-comparison-check.mjs — приёмка WP-2 (Гейт G24):
// docs/MODEL_COMPARISON.md + docs/model-comparison.json содержат сравнение:
// 7 базовых подходов + ≥ 6 строк абляции + 2 строки налогового эксперимента.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const JSONP = path.join(REPO_ROOT, 'docs', 'model-comparison.json');
const MDP = path.join(REPO_ROOT, 'docs', 'MODEL_COMPARISON.md');
for (const p of [JSONP, MDP]) if (!existsSync(p)) fail(`нет файла ${path.relative(REPO_ROOT, p)} (запуск: npm run backtest -- <csv> --models all)`);

const cmp = JSON.parse(readFileSync(JSONP, 'utf8'));
const nApproaches = cmp.params?.approaches?.length ?? 0;
const nAblations = cmp.params?.ablations?.length ?? 0;
const nTax = cmp.params?.taxExperiment?.length ?? 0;
if (nApproaches !== 7) fail(`подходов ${nApproaches} (ожидается 7)`);
if (nAblations < 6) fail(`абляций ${nAblations} (нужно ≥ 6)`);
if (nTax !== 2) fail(`строк налогового эксперимента ${nTax} (нужно 2)`);
const nRows = cmp.rows?.length ?? 0;
if (nRows !== nApproaches + nAblations + nTax) fail(`строк в отчёте ${nRows} (ожидается ${nApproaches + nAblations + nTax})`);
if (!(cmp.evaluatedCuts > 0)) fail('нет оценённых точек (evaluatedCuts = 0)');
if (cmp.params?.note == null) fail('нет честности-заметки о неподобранных константах (params.note)');

const md = readFileSync(MDP, 'utf8');
for (const section of ['## Подходы', '## Налоговый эксперимент', '## Ограничения']) {
  if (!md.includes(section)) fail(`в MODEL_COMPARISON.md нет раздела «${section}»`);
}
const dataRows = md.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('| ---') && !l.startsWith('| Подход') && !l.startsWith('| Строка')).length;
if (dataRows < nApproaches + nAblations + 2) fail(`строк таблиц в MD: ${dataRows} (нужно ≥ ${nApproaches + nAblations + 2})`);
if (/C:\\\\Users|C:\/Users/.test(JSON.stringify(cmp))) fail('в model-comparison.json абсолютные локальные пути (нарушение чистоты репозитория)');

console.log(`MODELCOMP-OK: ${nRows} строк (7 подходов + ${nAblations} абляций + 2 строки эксперимента), ${cmp.evaluatedCuts} точек`);
