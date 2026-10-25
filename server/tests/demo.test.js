// server/tests/demo.test.js — ТЗ-доработка WP-7 §13: демо-выписки из test-data/demo/
// (кнопка + API вместо генератора): список файлов, подгрузка, замена, аутентификация.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let app, server, base, token;

async function jsonPost(p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

async function demoPost(body, headers) {
  const r = await fetch(base + '/api/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* 401 без тела */
  }
  return { status: r.status, body: json };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const mod = await import('../src/app.js');
  app = mod.default;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await jsonPost('/api/auth/register', {
    email: `demo-${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`,
    password: 'TestPass123!',
    companyName: 'Demo Co',
    inn: '7700004444',
  });
  expect(reg.status).toBe(201);
  token = reg.body.token;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe('/api/demo (ТЗ-доработка WP-7 §13)', () => {
  it('GET /api/demo/companies без токена — 401', async () => {
    const r = await fetch(base + '/api/demo/companies');
    expect(r.status).toBe(401);
  });

  it('GET /api/demo/companies со списком файлов из test-data/demo/', async () => {
    const r = await fetch(base + '/api/demo/companies', { headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.companies)).toBe(true);
    expect(body.companies.length).toBeGreaterThan(0);
    expect(body.companies.map((c) => c.file)).toContain('statement-demo-C096.csv');
  });

  it('POST /api/demo — загружает первую демо-выписку в аккаунт', async () => {
    const r = await demoPost({}, { authorization: `Bearer ${token}` });
    expect(r.status).toBe(201);
    expect(r.body.file).toBe('statement-demo-C096.csv');
    expect(r.body.operationsImported).toBeGreaterThan(500);
    expect(r.body.replaced).toBe(0);
    expect(r.body.asOf).toBe('2026-09-30');
    expect(r.body.rowErrors).toBe(0);
  });

  it('повторный POST заменяет демо-операции (source=demo)', async () => {
    const r = await demoPost({}, { authorization: `Bearer ${token}` });
    expect(r.status).toBe(201);
    expect(r.body.replaced).toBe(r.body.operationsImported);
  });

  it('POST /api/demo { company } — выбор по имени, неизвестная — 400', async () => {
    const ok = await demoPost({ company: 'statement-demo-C096' }, { authorization: `Bearer ${token}` });
    expect(ok.status).toBe(201);
    const bad = await demoPost({ company: 'nope' }, { authorization: `Bearer ${token}` });
    expect(bad.status).toBe(400);
  });
});
