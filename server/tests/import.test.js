// server/tests/import.test.js — ТЗ-доработка WP-7 §1, §4, §5:
// CSV с запятой / windows-1251 / BOM читаются одинаково; XLSX-ИНН (строка и число);
// нет колонки остатка — 422 со словом «остаток»; 5 % строк с ошибками — skipped совпадает,
// номера строк верны; ошибочный файл не создаёт пользователя.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import iconv from 'iconv-lite';
import XLSX from 'xlsx';
import { parseBankStatement } from '../src/utils/parser.js';

// ---------- Парсер: кодировки и разделители ----------

const orgHeader = 'company_id;operation_id;operation_date;amount;direction;counterparty_inn;counterparty_name;payment_purpose;balance_eod';
const orgRows = [
  'C001;T-001;2026-01-05;1000.50;Поступление;0012345678;ООО «Ромашка»;Оплата по УПД № 12 от 03.01.2026;5000.00',
  'C001;T-002;2026-01-06;100.00;Списание;0076543210;ООО «Вектор»;Комиссия за ведение счёта;4900.00',
  'C001;T-003;2026-01-08;300.00;Списание;;;Единый налоговый платеж (ЕНП);4600.00',
];
const orgCsv = [orgHeader, ...orgRows].join('\n');

const selected = (ops) =>
  ops.map((o) => ({
    date: o.date,
    amount: o.amount,
    direction: o.direction,
    inn: o.counterpartyInn,
    name: o.counterpartyName,
    purpose: o.purpose,
    balance: o.balanceEndOfDay,
    externalId: o.externalId,
    subcategory: o.subcategory,
  }));

describe('Parser — CSV: запятая / windows-1251 / BOM читаются одинаково (ТЗ WP-7 §1, §4)', () => {
  const cases = {
    'точка с запятой + BOM + UTF-8': Buffer.from('\uFEFF' + orgCsv, 'utf-8'),
    'запятая вместо точки с запятой': Buffer.from(orgCsv.replace(/;/g, ','), 'utf-8'),
    'windows-1251 без BOM': iconv.encode(orgCsv, 'windows-1251'),
  };

  const results = {};
  for (const [label, buffer] of Object.entries(cases)) {
    it(label + ': 3 операции, ведущие нули ИНН сохранены, ЕНП → tax', async () => {
      const { operations, meta } = await parseBankStatement(buffer, 'C001.csv');
      expect(meta.format).toBe('organizer');
      expect(operations.length).toBe(3);
      expect(operations[0].counterpartyInn).toBe('0012345678');
      expect(operations[0].amount).toBe(1000.5);
      expect(operations[0].direction).toBe('in');
      expect(operations[2].counterpartyInn).toBe('');
      expect(operations[2].subcategory).toBe('tax');
      results[label] = selected(operations);
    });
  }

  it('все три варианта дают идентичные операции', async () => {
    // ждём выполнения трёх кейсов выше (порядок it() в блоке)
    const labels = Object.keys(results);
    expect(labels).toHaveLength(3);
    const [first, ...rest] = labels.map((l) => results[l]);
    for (const other of rest) {
      expect(other).toEqual(first);
    }
  });
});

describe('Parser — XLSX: ИНН строкой и числом (ТЗ WP-7 §4)', () => {
  it('строка 0012345678 и числовая ячейка 12345678 дают 0012345678', async () => {
    const aoa = [
      ['Дата', 'Сумма', 'Направление', 'Контрагент', 'ИНН', 'Назначение', 'Остаток'],
      ['2026-01-01', 100000, 'in', 'ООО Ромашка', '0012345678', 'Оплата по договору', 600000],
      ['2026-01-02', 50000, 'out', 'ООО Ромашка', 12345678, 'Оплата поставщику', 550000],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'sheet');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const { operations } = await parseBankStatement(buffer, 'statement.xlsx');
    expect(operations.length).toBe(2);
    expect(operations[0].counterpartyInn).toBe('0012345678');
    expect(operations[1].counterpartyInn).toBe('0012345678');
    expect(operations[0].balanceEndOfDay).toBe(600000);
  });
});

// ---------- HTTP: импорта и регистрация на живом app ----------

let app, server, base, token;
const uniq = (p) => `${p}-${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

async function jsonPost(p, body, headers = {}) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

async function filePost(p, fileBuffer, filename, tokenOrHeaders, extraFields = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
  fd.append('file', new Blob([fileBuffer], { type: 'text/csv' }), filename);
  const headers = tokenOrHeaders ? { authorization: `Bearer ${tokenOrHeaders}` } : {};
  const r = await fetch(base + p, { method: 'POST', headers, body: fd });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* нет тела */
  }
  return { status: r.status, body };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const mod = await import('../src/app.js');
  app = mod.default;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe('HTTP импорта (ТЗ WP-7 §4, §5)', () => {
  beforeAll(async () => {
    const { prisma } = await import('../src/config/db.js');
    const reg = await jsonPost('/api/auth/register', {
      email: `${uniq('import')}@test.local`,
      password: 'TestPass123!',
      companyName: 'Import Co',
      inn: '7700001111',
    });
    expect(reg.status).toBe(201);
    token = reg.body.token;
    globalThis.__importPrisma = prisma;
  });

  it('нет колонки остатка — 422 со словом «остаток» в сообщении', async () => {
    const noBalanceCsv = [
      'Дата;Сумма;Направление;Контрагент;ИНН;Назначение',
      '2026-01-01;1000;in;ООО Ромашка;7701234567;Оплата по договору',
    ].join('\n');
    const r = await filePost('/api/operations/import', Buffer.from(noBalanceCsv, 'utf-8'), 'no-balance.csv', token);
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('остаток');
  });

  it('5 % строк с ошибками — импорт проходит, skipped совпадает, номера строк верны', async () => {
    // 20 строк, 1 битая (5 %): дата «2026-13-45» в строке 6 файла (строка 5 данных, заголовок — строка 1)
    const lines = ['Дата;Сумма;Направление;Контрагент;ИНН;Назначение;Остаток'];
    for (let i = 1; i <= 20; i += 1) {
      const date = i === 5 ? '2026-13-45' : `2026-01-0${String(i).padStart(2, '0').slice(0, 2)}`;
      lines.push(`${date};${i * 100};in;ООО Партнер;7700002222;Оплата № ${i};${100000 + i}`);
    }
    const r = await filePost('/api/operations/import', Buffer.from(lines.join('\n'), 'utf-8'), 'with-errors.csv', token);
    expect(r.status).toBe(201);
    expect(r.body.rowsTotal).toBe(20);
    expect(r.body.imported).toBe(19);
    expect(r.body.skipped).toBe(1);
    expect(r.body.warnings.length).toBe(1);
    expect(r.body.warnings[0]).toContain('Строка 6');
  });

  it('ошибочный файл не создаёт пользователя (ТЗ WP-7 §1: parse before write)', async () => {
    const { prisma } = await import('../src/config/db.js');
    const email = `${uniq('badreg')}@test.local`;
    const noBalanceCsv = ['Дата;Сумма;Направление;Контрагент;ИНН;Назначение'].join('\n');
    const r = await filePost(
      '/api/auth/register',
      Buffer.from(noBalanceCsv, 'utf-8'),
      'bad.csv',
      null,
      { email, password: 'TestPass123!', companyName: 'Bad Co', inn: '7700003333' },
    );
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('остаток');
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });
});
