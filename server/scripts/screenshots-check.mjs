// server/scripts/screenshots-check.mjs — приёмка WP-9 (ТЗ-доработка п.5):
// docs/img/ содержит 4 PNG (dashboard, plan-fact, scenario, history)
// шириной ≥ 1280 px, и README на них ссылается.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const NAMES = ['dashboard.png', 'plan-fact.png', 'scenario.png', 'history.png'];
const dir = path.join(REPO_ROOT, 'docs', 'img');
if (!existsSync(dir)) fail('нет каталога docs/img/');

for (const n of NAMES) {
  const p = path.join(dir, n);
  if (!existsSync(p)) fail(`нет ${n}`);
  const b = readFileSync(p);
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) fail(`${n}: не PNG (магик не совпадает)`);
  const w = b.readUInt32BE(16);
  if (w < 1280) fail(`${n}: ширина ${w}px < 1280px`);
}

const readme = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
for (const n of NAMES) {
  if (!readme.includes(`docs/img/${n}`)) fail(`README не ссылается на docs/img/${n}`);
}

console.log('SHOTS-OK: 4 PNG в docs/img (≥ 1280px), ссылки в README');
