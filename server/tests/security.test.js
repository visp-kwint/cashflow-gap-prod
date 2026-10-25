// server/tests/security.test.js — приёмка WP-6 (TZ §7)
// helmet, CORS-allowlist, 429 RATE_LIMITED, env-guard, одинаковость 401, 404-изоляция.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- §1 env-guard: без JWT_SECRET / с коротким секретом сервер не стартует ----------
function envGuardExitStatus(mutate) {
  const e = { ...process.env };
  delete e.JWT_SECRET;
  e.DATABASE_URL = 'file:./dev.db';
  if (mutate) mutate(e);
  // Windows: ESM import только по file:// URL.
  const code = `await import(${JSON.stringify(pathToFileURL(path.join(serverDir, 'src', 'config', 'env.js')).href)});`;
  // cwd — каталог без .env, чтобы JWT_SECRET брался только из переданного env.
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: os.tmpdir(),
    env: e,
    stdio: 'pipe',
  });
  return r.status;
}

describe('WP-6 §1 env-guard', () => {
  it('не стартует без JWT_SECRET (exit 1)', () => {
    expect(envGuardExitStatus()).toBe(1);
  });

  it('не стартует с коротким JWT_SECRET (exit 1)', () => {
    expect(envGuardExitStatus((e) => (e.JWT_SECRET = 'short-secret'))).toBe(1);
  });

  it('стартует с длинным JWT_SECRET (exit 0)', () => {
    expect(envGuardExitStatus((e) => (e.JWT_SECRET = 'a'.repeat(40)))).toBe(0);
  });
});

// ---------- HTTP-тесты на живом app ----------
let app, server, base;

async function post(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function patch(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(base + p, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

async function del(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(base + p, { method: 'DELETE', headers });
}

let seq = 0;
function uniqEmail(prefix) {
  return `${prefix}${Date.now()}${seq++}${Math.random().toString(36).slice(2, 6)}@test.local`;
}

async function register(email) {
  const r = await post('/api/auth/register', {
    email,
    password: 'TestPass123!',
    companyName: 'Sec Co',
    inn: '7712345678',
  });
  expect(r.status).toBe(201);
  return r.json();
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const mod = await import('../src/app.js');
  app = mod.default;
  const rl = await import('../src/middleware/rate-limiter.js');
  globalThis.__resetAuth = () => rl.resetAuthRateLimiter();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe('WP-6 §2 заголовки и CORS', () => {
  it('ответ содержит заголовки helmet и X-Request-Id', async () => {
    const r = await fetch(base + '/api/risks');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toBeTruthy();
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });

  it('чужой Origin не получает access-control-allow-origin', async () => {
    const r = await fetch(base + '/api/risks', { headers: { Origin: 'https://attacker.example' } });
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('разрешённый Origin получает access-control-allow-origin', async () => {
    const r = await fetch(base + '/api/risks', { headers: { Origin: 'http://localhost:5173' } });
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});

describe('WP-6 §6 ошибки входа', () => {
  it('несуществующий email и неверный пароль дают одинаковые 401 INVALID_CREDENTIALS', async () => {
    const uniq = uniqEmail('sec');
    await register(uniq);
    const wrongUser = await post('/api/auth/login', { email: 'nobody@nobody.local', password: 'whatever123' });
    const wrongPass = await post('/api/auth/login', { email: uniq, password: 'wrongpass99' });
    expect(wrongUser.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    const a = await wrongUser.json();
    const b = await wrongPass.json();
    expect(a.error.code).toBe('INVALID_CREDENTIALS');
    expect(b).toEqual(a);
  });
});

describe('WP-6 §9 изоляция пользователей', () => {
  let a, b, opId, riskId, eventId;

  beforeAll(async () => {
    a = await register(uniqEmail('userA'));
    b = await register(uniqEmail('userB'));
    const op = await post('/api/operations', { amount: 1000, direction: 'in' }, a.token);
    opId = (await op.json()).id;
    const risk = await post(
      '/api/risks',
      { title: 'Риск A', type: 'unplanned_expense', amount: 500, dateFrom: '2026-11-01', probability: 0.5 },
      a.token,
    );
    riskId = (await risk.json()).id;
    const pe = await post(
      '/api/planned-events',
      { type: 'tax', title: 'Налог', amount: 100, direction: 'out', expectedDate: '2026-11-05' },
      a.token,
    );
    eventId = (await pe.json()).events[0].id;
  });

  it('чужая операция — 404', async () => {
    const r = await fetch(base + `/api/operations/${opId}`, {
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(r.status).toBe(404);
  });

  it('чужой риск: PATCH (в т.ч. пустой) и DELETE — 404', async () => {
    expect((await patch(`/api/risks/${riskId}`, {}, b.token)).status).toBe(404);
    expect((await patch(`/api/risks/${riskId}`, { active: false }, b.token)).status).toBe(404);
    expect((await del(`/api/risks/${riskId}`, b.token)).status).toBe(404);
  });

  it('чужое плановое событие — 404', async () => {
    const r = await patch(`/api/planned-events/${eventId}`, { active: false }, b.token);
    expect(r.status).toBe(404);
  });

  it('свои ресурсы доступны (контроль)', async () => {
    expect((await fetch(base + `/api/operations/${opId}`, { headers: { authorization: `Bearer ${a.token}` } })).status).toBe(200);
    expect((await patch(`/api/risks/${riskId}`, { active: false }, a.token)).status).toBe(200);
  });
});

describe('WP-6 §3 ограничение частоты', () => {
  it('11-й вход за минуту даёт 429 с кодом RATE_LIMITED', async () => {
    globalThis.__resetAuth();
    const statuses = [];
    let lastBody = null;
    for (let i = 0; i < 11; i++) {
      const r = await post('/api/auth/login', { email: 'rl@rl.local', password: 'nope12345' });
      statuses.push(r.status);
      if (i === 10) lastBody = await r.json();
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
    expect(lastBody.error.code).toBe('RATE_LIMITED');
  });
});
