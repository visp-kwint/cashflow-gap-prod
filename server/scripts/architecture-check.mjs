// server/scripts/architecture-check.mjs — приёмка: docs/ARCHITECTURE.md соответствует репозиторию.
// Аудит §3.5: старая версия «самообманывала» — исключала forecast.state/ForecastState как
// «будущие блоки (WP-2)» и проверяла только короткий жёсткий список. Теперь:
//   1) обязательные блоки Mermaid-диаграммы (ТЗ-доработка п.1);
//   2) цельность Mermaid-диаграммы (subgraph/end);
//   3) обязательные файлы реально существуют;
//   4) НОВЫЙ автоскан: все ссылки вида `server/src/…` / `client/src/…` в доке → файл существует,
//      БЕЗ каких-либо исключений (несуществующий файл, напечатанный в доке → падение);
//   5) НОВЫЙ автоскан: «голые» имена файлов в тилах (`forecast.state.js`, `CashflowChart.tsx`,
//      `TZ_*.md`…) ищем по basename в ограниченных каталогах репо — не нашли → ошибка.
// Запуск: node server/scripts/architecture-check.mjs [путь-к-доку] (self-test; по умолчанию
// docs/ARCHITECTURE.md). Успех: ARCH-OK
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const docPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO_ROOT, 'docs/ARCHITECTURE.md');
let doc;
try { doc = readFileSync(docPath, 'utf8'); } catch { console.error(`✗ нет файла: ${docPath}`); process.exit(2); }

const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

// 1. Обязательные блоки диаграммы (ТЗ-доработка п.1, таблица)
const requiredBlocks = {
  'Клиент (страницы)': ['Dashboard', 'Payments', 'History', 'Sandbox', 'Calendar', 'Support', 'BankStub'],
  'API-цепочка': ['routes', 'middleware', 'controllers'],
  'Расчётное ядро (чистые функции)': ['forecast.service', 'categorizer', 'planFact', 'taxCalendar', 'чистые функции без БД'],
  'Импорт': ['parser', 'dataQuality', 'categorizer', 'Prisma'],
  'Данные Prisma + SQLite': ['User, Operation, Risk', 'SupportTicket', 'SandboxScenario'],
  'Интеграции (заглушка)': ['1c', 'edo', 'tax-calendar', 'marketplace', 'bank', 'заглушка'],
  'Четыре потока': ['Импорт', 'Прогноз', 'План-факт', 'что если'],
};
for (const [label, tokens] of Object.entries(requiredBlocks)) {
  for (const t of tokens) {
    if (!doc.includes(t)) fail(`диаграмма не содержит блок/токен «${t}» (${label})`);
  }
}

// 2. Mermaid-блок есть и синтаксически цельный (balanced subgraph/end)
const mmd = [...doc.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
if (mmd.length === 0) fail('в ARCHITECTURE.md нет Mermaid-диаграммы');
const diag = mmd.join('\n');
if ((diag.match(/subgraph/g) || []).length !== (diag.match(/\bend\b/g) || []).length) {
  fail('несбалансированные subgraph/end в Mermaid-диаграмме');
}

// 3. Обязательные файлы существуют (положительные требования: в доке и в репо)
const server = (p) => path.join(REPO_ROOT, 'server', p);
const client = (p) => path.join(REPO_ROOT, 'client', p);
const mustExist = [
  [server('src/services/forecast.service.js'), 'forecast.service'],
  [server('src/services/categorizer.service.js'), 'categorizer.service'],
  [server('src/services/planFact.service.js'), 'planFact.service'],
  [server('src/services/taxCalendar.service.js'), 'taxCalendar.service'],
  [server('src/services/sandbox.service.js'), 'sandbox.service'],
  [server('src/utils/dataQuality.js'), 'dataQuality'],
  [server('src/integrations-stub/adapter.interface.js'), 'adapter.interface'],
  [client('src/pages/Dashboard.tsx'), 'page Dashboard'],
  [client('src/pages/Payments.tsx'), 'page Payments'],
  [client('src/pages/History.tsx'), 'page History'],
  [client('src/pages/Sandbox.tsx'), 'page Sandbox'],
  [client('src/pages/Calendar.tsx'), 'page Calendar'],
  [client('src/pages/Support.tsx'), 'page Support'],
  [client('src/pages/BankStub.tsx'), 'page BankStub'],
];
for (const [p, label] of mustExist) {
  if (!existsSync(p)) fail(`mentioned-but-missing: ${path.relative(REPO_ROOT, p)} (${label})`);
}
// 4. Автоскан путей: `server/src/…` | `client/src/…` (и server/…, client/…) → файл существует.
// Исключений НЕТ (аудит §3.5: «самообман в чекере»): напечатанный в доке несуществующий
// файл (например, server/src/services/forecast.state.js) — падение.
const pathRefs = [...doc.matchAll(/(?:server|client)\/[A-Za-z0-9_.\-/]+\.[A-Za-z]{1,5}/g)];
for (const m of pathRefs) {
  const p = path.join(REPO_ROOT, m[0]);
  if (!existsSync(p)) fail(`путь из дока не существует: ${m[0]} (строка ${doc.slice(0, m.index).split('\n').length})`);
}

// 5. Автоскан «голых» имён файлов в тилах: `имя.ext` → basename/относительный путь в репо
// (поиск по ограниченным каталогам, без node_modules).
const exts = ['js', 'mjs', 'ts', 'tsx', 'md', 'css'];
const searchDirs = [
  REPO_ROOT,
  path.join(REPO_ROOT, 'docs'),
  path.join(REPO_ROOT, 'docs/internal'),
  path.join(REPO_ROOT, 'server/scripts'),
  path.join(REPO_ROOT, 'server/tests'),
  path.join(REPO_ROOT, 'server/prisma/seed'),
  path.join(REPO_ROOT, 'test-data'),
];
const index = []; // [basename, relativePath]
for (const dir of searchDirs) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir, { recursive: true })) {
    const full = path.join(dir, f);
    if (!statSync(full).isFile()) continue;
    if (!exts.includes(path.extname(f).slice(1))) continue;
    index.push([path.basename(full), path.relative(REPO_ROOT, full).split(path.sep).join('/')]);
  }
}
const relMatch = (cand) => index.some(([b, rel]) => cand === b || cand === rel || rel.endsWith('/' + cand));
for (const m of doc.matchAll(/`([A-Za-z0-9_\-./]+\.(?:js|mjs|ts|tsx|md|css))`/g)) {
  if (!relMatch(m[1])) fail(`имя файла в доке не найдено в репо: \`${m[1]}\``);
}
console.log('ARCH-OK: блоки диаграммы, обязательные и упомянутые файлы соответствуют репозиторию');
