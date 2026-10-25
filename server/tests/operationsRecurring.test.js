// server/tests/operationsRecurring.test.js — отчёт §8.2: фильтр «Повторяющиеся платежи».
// GET /api/operations?recurring=true → только операции с plannedness из RECURRING_PLANNEDNESS
// (planned_fixed / planned_scheduled / recurring_variable); без параметра — все операции.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/config/db.js';
import { RECURRING_PLANNEDNESS } from '../src/controllers/operations.controller.js';

let app, server, base, token, userId;

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
      email: `recurring-${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`,
      password: 'TestPass123!',
      companyName: 'Recurring Test Co',
      inn: '7700006666',
    }),
  });
  expect(reg.status).toBe(201);
  token = (await reg.json()).token;
  const me = await fetch(base + '/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
  userId = (await me.json()).user.id;

  // По одной операции на каждый класс плановости + одна без plannedness (ручная операция)
  const rows = ['planned_fixed', 'recurring_variable', 'planned_scheduled', 'unplanned_capex', null];
  let bal = 10000;
  for (const p of rows) {
    bal -= 100;
    await prisma.operation.create({
      data: {
        userId,
        date: new Date('2026-03-05T00:00:00Z'),
        amount: 100,
        direction: 'out',
        category: 'expense',
        plannedness: p,
        counterpartyName: 'Тест Контрагент',
        counterpartyInn: '0000000001',
        purpose: 'тестовая операция',
        balanceEndOfDay: bal,
        source: 'manual',
      },
    });
  }
});

afterAll(async () => {
  // Убираем тестового юзера (операции уходят каскадом)
  await prisma.user.delete({ where: { id: userId } });
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

const list = (qs = '') =>
  fetch(`${base}/api/operations${qs}`, { headers: { authorization: `Bearer ${token}` } });

describe('GET /api/operations — фильтр «Повторяющиеся платежи» (§8.2)', () => {
  it('?recurring=true — только классы RECURRING_PLANNEDNESS (3 из 5)', async () => {
    const r = await list('?recurring=true');
    expect(r.status).toBe(200);
    const items = await r.json();
    expect(items.length).toBe(3);
    for (const op of items) expect(RECURRING_PLANNEDNESS).toContain(op.plannedness);
  });

  it('без фильтра — все 5 операций, включая plannedness=null', async () => {
    const r = await list();
    expect(r.status).toBe(200);
    const items = await r.json();
    expect(items.length).toBe(5);
    expect(items.some((op) => op.plannedness === null)).toBe(true);
  });

  it('GET /api/history/summary?recurring=true — диаграмма только по RECURRING_PLANNEDNESS', async () => {
    const r = await fetch(`${base}/api/history/summary?month=2026-03&recurring=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const { items } = await r.json();
    expect(items.length).toBe(3);
    for (const op of items) expect(RECURRING_PLANNEDNESS).toContain(op.plannedness);
  });
});
