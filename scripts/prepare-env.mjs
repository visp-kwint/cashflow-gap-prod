// scripts/prepare-env.mjs — создаёт server/.env из шаблона, если его нет (fresh clone).
// JWT_SECRET генерируется (>= 32 символов): без секрета сервер не стартует (см. ТЗ WP-6).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const envPath = path.join(root, 'server', '.env');

if (fs.existsSync(envPath)) {
  console.log('server/.env уже существует — пропускаю');
  process.exit(0);
}

const example = fs.readFileSync(path.join(root, 'server', '.env.example'), 'utf8');
const lines = example
  .split(/\r?\n/)
  .map((line) => {
    if (!line.startsWith('JWT_SECRET')) return line;
    return `JWT_SECRET="${crypto.randomBytes(32).toString('hex')}"`;
  })
  .join('\n');

fs.writeFileSync(envPath, lines + '\n', 'utf8');
console.log('server/.env создан из .env.example (JWT_SECRET сгенерирован)');
