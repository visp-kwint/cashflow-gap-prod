// server/tests/contract.test.js — приёмка WP-9 (ТЗ §9.5): docs/api-contract.md
// соответствует маршрутам из src/routes/*.js (собираются через src/app.js,
// express 4: app._router), обязательные поля/коды присутствуют в документе.
// Без БД и сети: только import app + чтение файла.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/app.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function prefixOf(layer) {
  const s = (layer.regexp?.source ?? '').replace(/^\^/, '');
  const parts = s.split('\\'); // ['' , '/api', '', '/?(?=/$)', …]
  return parts[1] || '';
}
function collectRoutes() {
  const routes = new Set();
  (function walk(router, prefix) {
    for (const layer of router.stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) {
          let p = prefix + layer.route.path;
          if (p.startsWith('/api/')) p = p.slice(4); // документ описывает пути относительно /api
          if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
          routes.add(`${m.toUpperCase()} ${p}`);
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle, prefix + prefixOf(layer));
      }
    }
  })(app._router, '');
  return routes;
}
function collectDocRoutes() {
  const doc = readFileSync(path.join(REPO_ROOT, 'docs/api-contract.md'), 'utf8');
  const routes = new Set();
  for (const line of doc.split('\n')) {
    const m = line.match(/^#{2,4}\s+(GET|POST|PATCH|DELETE|PUT)\s+(\S+)/i);
    if (m) routes.add(`${m[1].toUpperCase()} ${m[2].replace(/`/g, '').split('?')[0]}`);
  }
  return routes;
}

describe('API-контракт (docs/api-contract.md)', () => {
  const codeRoutes = collectRoutes();
  const docRoutes = collectDocRoutes();

  it('каждый маршрут в коде описан в документе', () => {
    const missing = [...codeRoutes].filter((r) => !docRoutes.has(r)).sort();
    expect(missing, `нет в документе: ${missing.join(', ')}`).toEqual([]);
  });

  it('в документе нет секций про несуществующие маршруты', () => {
    const orphans = [...docRoutes].filter((r) => !codeRoutes.has(r)).sort();
    expect(orphans, `орфаны в документе: ${orphans.join(', ')}`).toEqual([]);
  });

  it('документ содержит обязательные поля и коды ошибок', () => {
    const doc = readFileSync(path.join(REPO_ROOT, 'docs/api-contract.md'), 'utf8');
    for (const field of ['dataQuality', 'asOf', 'overdraftDays', 'meta.computed', 'INVALID_CREDENTIALS', 'RATE_LIMITED']) {
      expect(doc, `отсутствует: ${field}`).toContain(field);
    }
  });
});
