// server/scripts/readme-check.mjs — приёмка WP-9 (ТЗ-доработка § п.2):
// README.md: запуск ≤ 5 шагов, таблица env, команды dev/test/backtest/lint/build,
// ссылки на docs (файл существует ИЛИ помечен планом — (WP-2)/(WP-4)/скриншоты G21),
// раздел «Ограничения и допущения» ≥ 5 пунктов.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const doc = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

// 1. Запуск ≤ 5 шагов
const launch = doc.slice(doc.indexOf('## Запуск'), doc.indexOf('## ', doc.indexOf('## Запуск') + 10));
const steps = launch.match(/^\d+\.\s/gm) || [];
if (!launch) fail('нет раздела «## Запуск»');
if (steps.length > 5) fail(`в «Запуск» ${steps.length} шагов (требуется ≤ 5)`);
if (steps.length === 0) fail('в «Запуск» нет нумерованных шагов');

// 2. Переменные окружения (таблица)
if (!/## Переменные окружения/.test(doc)) fail('нет раздела «Переменные окружения»');
const envSection = doc.slice(doc.indexOf('## Переменные окружения'), doc.indexOf('## ', doc.indexOf('## Переменные окружения') + 10));
if (!envSection.includes('| `PORT`') || !envSection.includes('| `JWT_SECRET`')) fail('таблица env не содержит PORT/JWT_SECRET');

// 3. Команды
for (const cmd of ['dev', 'test', 'backtest', 'lint', 'build', 'setup']) {
  if (!doc.includes(`npm run ${cmd}`) && !(cmd === 'test' && doc.includes('npm test'))) fail(`нет команды npm run ${cmd}`);
}

// 4. Ссылки на docs: файл существует, либо строка помечена планом
//    (WP-2/WP-4/«создаётся»/G21-скриншоты — ожидаемые артефакты следующих волн)
const PENDING_MARKERS = ['(WP-2', '(WP-4', '(WP-8', '(WP-9', 'создаётся'];
for (const m of doc.matchAll(/\]\((docs\/[^)\s]+)\)/g)) {
  const target = m[1];
  const line = doc.slice(doc.lastIndexOf('\n', m.index) + 1, doc.indexOf('\n', m.index));
  const p = path.join(REPO_ROOT, target);
  try {
    readFileSync(p);
  } catch {
    if (!PENDING_MARKERS.some((k) => line.includes(k))) {
      fail(`ссылка ${target} без файла и без пометки плана (строка: ${line.trim()})`);
    }
  }
}

// 5. Ограничения ≥ 5
const limits = doc.slice(doc.indexOf('## Ограничения'));
const items = (limits.match(/^\d+\.\s/gm) || []).length;
if (!limits) fail('нет раздела «Ограничения и допущения»');
if (items < 5) fail(`в «Ограничения и допущения» ${items} пунктов (требуется ≥ 5)`);
if (!/заглуш/i.test(limits)) fail('в ограничениях не упомянуто, что интеграции — заглушки');
if (!/зашитые ставки|зашитым|статк/i.test(limits)) fail('в ограничениях не упомянуты зашитые ставки налогового календаря');

console.log('README-OK: запуск ≤ 5 шагов, env, команды, ссылки, ограничения ≥ 5');
