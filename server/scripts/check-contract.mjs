// server/scripts/check-contract.mjs
// Oracle G15/G16 (WP-9, ТЗ §9.5): docs/api-contract.md соответствует коду.
// 1) собирает реальные маршруты из src/app.js (все routers: метод + путь);
// 2) парсит секции «### METHOD /path» из docs/api-contract.md;
// 3) каждый маршру в коде должен быть описан в документе и наоборот (без орфанных секций);
// 4) в документе присутствуют обязательные поля/коды (ТЗ §9.5):
//    alerts, asOf, dataQuality, import, meta.computed, INVALID_CREDENTIALS, RATE_LIMITED.
// Без сети и БД (только import app + чтение файла).
//
// Запуск: node server/scripts/check-contract.mjs
// Успех:  CONTRACT-OK

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appMod = await import(pathToFileURL(path.join(REPO_ROOT, 'server/src/app.js')));
const app = appMod.default;

// --- сборка реальных маршрутов (express 4: app._router) ---
function prefixOf(layer) {
  // regexp.source: «^\\/api\\/?($|^)» → сегмент между первым и вторым «\»: «/api»
  const s = (layer.regexp?.source ?? '').replace(/^\^/, '');
  const parts = s.split('\\'); // ['' , '/api', '', '/?(?=/$)', ...]
  return parts[1] || '';
}
const codeRoutes = new Set();
function walk(router, prefix) {
  for (const layer of router.stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) {
        let p = prefix + layer.route.path;
        if (p.startsWith('/api/')) p = p.slice(4); // документ описывает пути относительно /api
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1); // «/ops/» (монт + '/') = «/ops»
        codeRoutes.add(`${m.toUpperCase()} ${p}`);
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      walk(layer.handle, prefix + prefixOf(layer));
    }
  }
}
walk(app._router, '');

// --- секции договора: «### METHOD /path…» ---
const doc = readFileSync(path.join(REPO_ROOT, 'docs/api-contract.md'), 'utf8');
const docRoutes = new Set();
for (const line of doc.split('\n')) {
  const m = line.match(/^#{2,4}\s+(GET|POST|PATCH|DELETE|PUT)\s+(\S+)/i);
  if (m) docRoutes.add(`${m[1].toUpperCase()} ${m[2].replace(/`/g, '').split('?')[0]}`);
}

let fail = 0;
const missInDoc = [...codeRoutes].filter((r) => !docRoutes.has(r)).sort();
const orphans = [...docRoutes].filter((r) => !codeRoutes.has(r)).sort();

if (missInDoc.length) {
  fail++;
  console.log(`FAIL в коде, но нет в docs/api-contract.md (${missInDoc.length}):`);
  missInDoc.forEach((r) => console.log(`  ${r}`));
}
if (orphans.length) {
  fail++;
  console.log(`FAIL секции в docs/api-contract.md без маршрута в коде (${orphans.length}):`);
  orphans.forEach((r) => console.log(`  ${r}`));
}

// --- обязательные поля и коды ошибок в документе (ТЗ §9.5) ---
// «alerts» в API нет (пороговый алерт клиент рендерит сам из dataQuality.overdraftDays);
// проверяем существующие контрактные поля.
const mustHave = ['dataQuality', 'asOf', 'overdraftDays', 'import', 'meta.computed', 'INVALID_CREDENTIALS', 'RATE_LIMITED'];
const missingFields = mustHave.filter((f) => !doc.includes(f));
if (missingFields.length) {
  fail++;
  console.log(`FAIL в документе нет обязательных полей/кодов: ${missingFields.join(', ')}`);
}

// --- сводка ---
console.log(`Маршрутов в коде: ${codeRoutes.size}, секций в документе: ${docRoutes.size}`);
[...codeRoutes].sort().forEach((r) => console.log(`  ${r}`));

if (fail) {
  console.log(`CONTRACT-FAIL`);
  process.exit(1);
}
console.log('CONTRACT-OK');
