// server/scripts/docs-consistency-check.mjs
// Oracle G12 (WP-7, отчёт §12): документация консистентна с кодом:
//   - демо-вход во всех документах: demo@cashflow.ru / demo1234 (seed + контракт),
//     старое demo@example.com / demo12345 нигде нет;
//   - FORECAST_AS_OF описан как override ТОЛЬКО для демо-учётки;
//   - скрипты/документы не содержат локальных путей C:\Users\... (portability);
//   - test-data/README не утверждает «парсер принимает только ;» (парсер автоопределяет
//     разделители и кодировки).
// Сеть и БД не нужны.
//
// Запуск: node server/scripts/docs-consistency-check.mjs  (из корня репозитория)
// Успех:  DOCS-CONSISTENT-OK

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(REPO_ROOT, p), 'utf8');

let fail = 0;
const check = (ok, note) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${note}`); if (!ok) fail++; };

// --- 1) устаревшие демо-креды в ключевых файлах ---
const docFiles = ['README.md', 'docs/ARCHITECTURE.md', 'test-data/README.md', 'test-data/demo/README.md'];
for (const p of docFiles) {
  let t;
  try { t = read(p); } catch { continue; } // файла нет — пропускаем
  check(!t.includes('demo@example.com'), `${p}: нет demo@example.com`);
  check(!t.includes('demo12345'), `${p}: нет демо-пароля demo12345`);
}

// --- 2) FORECAST_AS_OF = только демо-учётка; актуальные демо-креды ---
const readme = read('README.md');
check(/FORECAST_AS_OF[\s\S]{0,260}(только для демо|демо-учётки)/.test(readme),
  'README.md: FORECAST_AS_OF описан как override только для демо-учётки');
check(/demo@cashflow\.ru/.test(readme) && /demo1234(?!\d)/.test(readme), 'README.md: демо-вход demo@cashflow.ru / demo1234');
const arch = read('docs/ARCHITECTURE.md');
check(/demo@cashflow\.ru/.test(arch) && /demo1234(?!\d)/.test(arch),
  'docs/ARCHITECTURE.md: демо-вход demo@cashflow.ru / demo1234');
const testdata = read('test-data/README.md');
check(/demo@cashflow\.ru/.test(testdata) && /demo1234(?!\d)/.test(testdata),
  'test-data/README.md: демо-вход demo@cashflow.ru / demo1234');
check(/demo@cashflow\.ru/.test(read('test-data/demo/README.md')),
  'test-data/demo/README.md: демо-вход demo@cashflow.ru');

// --- 3) portability: без локальных путей C:\Users\... (скрипты, docs, README, test-data) ---
function listFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) {
      if (f === 'node_modules' || f.startsWith('.')) continue;
      out.push(...listFiles(full));
    } else if (/\.(mjs|js|md|sh|ps1)$/.test(f)) {
      out.push(full);
    }
  }
  return out;
}
const scanned = [
  ...listFiles(path.join(REPO_ROOT, 'server/scripts')),
  ...listFiles(path.join(REPO_ROOT, 'docs')),
  path.join(REPO_ROOT, 'README.md'),
  path.join(REPO_ROOT, 'test-data/README.md'),
];
const hits = [];
for (const f of scanned) {
  const text = path.isAbsolute(f) ? readFileSync(f, 'utf8') : read(f);
  text.split('\n').forEach((l, i) => {
    // Само-ссылки оракулов (docs-consistency-check / clean-repo-check) — это ШАБЛОНЫ проверки,
    // а не хардкод путей: не нарушение (маскируем)
    if (/C:[\\/]Users/.test(l) && !(f.includes('docs-consistency-check.mjs') || f.includes('clean-repo-check.mjs'))) {
      hits.push(`${path.relative(REPO_ROOT, f)}:${i + 1}: ${l.trim().slice(0, 100)}`);
    }
  });
}
check(hits.length === 0, `нет локальных путей C:\\Users\\... в server/scripts/docs/README (совпадений: ${hits.length})`);
if (hits.length) console.log(hits.slice(0, 10).join('\n'));

// --- 4) описание парсера в test-data/README ---
check(!/принимает только/.test(testdata), 'test-data/README.md: нет «парсер принимает только ;»');
check(/автоопределяет разделитель/.test(testdata), 'test-data/README.md: описано автоопределение разделителей');

if (fail) { console.log(`DOCS-CONSISTENT-FAIL (${fail})`); process.exit(1); }
console.log('DOCS-CONSISTENT-OK');
