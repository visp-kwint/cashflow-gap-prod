// server/tests/dashboard.test.js — аудит §3.6: валидация параметра horizon.
// Ранее ?horizon=abc → RangeError в calculateForecast → 500 INTERNAL;
// теперь контроллер проверяет параметр и отвечает 400 VALIDATION.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let app, server, base, token;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const mod = await import('../src/app.js');
  app = mod.default;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `dash-${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`,
      password: 'TestPass123!',
      companyName: 'Dash Test Co',
      inn: '7700005555',
    }),
  });
  expect(reg.status).toBe(201);
  token = (await reg.json()).token;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

const get = (path) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

describe('GET /api/dashboard — валидация horizon (аудит §3.6)', () => {
  it('?horizon=abc → 400 VALIDATION (не 500)', async () => {
    const r = await get('/api/dashboard?horizon=abc');
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe('VALIDATION');
  });

  it('некорректные значения (пустое, 0, 1000) → 400', async () => {
    for (const h of ['', '0', '1000']) {
      const r = await get(`/api/dashboard?horizon=${h}`);
      expect(r.status, `horizon=${h}`).toBe(400);
      expect((await r.json()).error.code).toBe('VALIDATION');
    }
  });

  it('корректный horizon на пустом аккаунте → 200 с опорной датой asOf', async () => {
    const r = await get('/api/dashboard?horizon=30');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.dataQuality.asOf).toBe(body.asOf);
  });

  it('horizon=366 — граница, принимается', async () => {
    const r = await get('/api/dashboard?horizon=366');
    expect(r.status).toBe(200);
  });
});
