// server/scripts/clean-repo-check.mjs — приёмка WP-9 (ТЗ §9.6):
// 1) по репо (кроме node_modules/.git) нет вхождений локальных путей C:/Users;
// 2) устаревший GATES.md удалён; 3) TZ_файл лежит в docs/internal/ и не содержит
//    локальных Windows-путей; 4) в корне нет черновиков/локальных мусора
//    (известный список: TZ_*.md на корне, *.log, .bak).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.unlazy']); // .unlazy — gitignored локальное рабочее пространство
function walkSync(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkSync(p, out);
    else out.push(p);
  }
  return out;
}

const bad = [];
const SELF = path.join(REPO_ROOT, 'server/scripts/clean-repo-check.mjs'); // сам себе исключение (литералы проверок)
for (const p of walkSync(REPO_ROOT)) {
  if (p === SELF) continue;
  const rel = path.relative(REPO_ROOT, p);
  if (rel.startsWith('test-data') || p.endsWith('.csv') || p.endsWith('.xlsx')) continue; // данные — не код
  let content;
  try { content = readFileSync(p, 'utf8'); } catch { continue; } // бинарные
  // строки-комментарии оракулов/чекеров, цитирующие сам паттерн, не считаются нарушением
  const lines = content.split('\n').filter((l) => {
    const t = l.trim();
    const cites = t.startsWith('//') || t.startsWith('*') || t.startsWith('#');
    return !(cites && (t.includes('C:/Users') || t.includes('C:\\Users')));
  });
  const probe = lines.join('\n');
  if (probe.includes('C:/Users')) bad.push(rel);
  if (probe.includes('C:\\Users')) bad.push(`${rel} (backslash)`);
}
if (bad.length) {
  console.error('✗ локальные пути C:/Users найдены в:');
  bad.forEach((f) => console.error('  ' + f));
  process.exit(1);
}

if (existsSync(path.join(REPO_ROOT, 'GATES.md'))) {
  console.error('✗ GATES.md должен быть удалён (ТЗ §9.6, gates живут в .unlazy/)');
  process.exit(1);
}

const tzPath = path.join(REPO_ROOT, 'docs/internal/TZ_dorabotka_cashflow_gap.md');
if (!existsSync(tzPath)) {
  console.error('✗ docs/internal/TZ_dorabotka_cashflow_gap.md не найден (ТЗ-файл должен быть в docs/internal)');
  process.exit(1);
}
const tz = readFileSync(tzPath, 'utf8');
if (tz.includes('C:/Users') || tz.includes('C:\\Users')) {
  console.error('✗ docs/internal/TZ_dorabotka_cashflow_gap.md содержит локальные пути');
  process.exit(1);
}

// мусор в корне
const rootJunk = readdirSync(REPO_ROOT).filter((n) =>
  /\.(log|bak|tmp)$/.test(n) || n.startsWith('TZ_')
);
if (rootJunk.length) {
  console.error('✗ в корне лежат черновики/мусор: ' + rootJunk.join(', '));
  process.exit(1);
}

console.log('CLEAN-OK: нет локальных путей, GATES.md удалён, TZ-файл в docs/internal, корень чистый');
