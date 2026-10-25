// server/tests/parser.test.js
import { describe, it, expect } from 'vitest';
import { parseBankStatement } from '../src/utils/parser.js';

describe('Parser — формат организаторов (test-data)', () => {
  const organizerCsv = [
    'company_id;operation_id;operation_date;amount;direction;counterparty_inn;counterparty_name;payment_purpose;balance_eod',
    'C001;C001-000001;2024-10-01;990.00;Списание;0068275202;ПАО «Банк»;Комиссия за ведение счета за сентябрь 2024 г. Без НДС;1244821.98',
    'C001;C001-000002;2024-10-02;170892.06;Поступление;0048401219;ООО «Элеватор-242»;Оплата по УПД № 279 от 19.08.2024. НДС не облагается;1527714.04',
    'C001;C001-000003;2024-10-02;5000.00;Списание;;;Единый налоговый платеж (ЕНП);1522714.04',
    // дубль второй строки
    'C001;C001-000002;2024-10-02;170892.06;Поступление;0048401219;ООО «Элеватор-242»;Оплата по УПД № 279 от 19.08.2024. НДС не облагается;1527714.04',
  ].join('\r\n');

  it('парсит BOM + ; + CRLF, сохраняет ведущие нули в ИНН', async () => {
    const buffer = Buffer.from('\uFEFF' + organizerCsv, 'utf-8');
    const { operations, meta } = await parseBankStatement(buffer, 'C001.csv');
    expect(meta.format).toBe('organizer');
    expect(meta.companyId).toBe('C001');
    expect(operations.length).toBe(3); // дубль отфильтрован
    expect(operations[0].counterpartyInn).toBe('0068275202');
    expect(operations[0].direction).toBe('out');
    expect(operations[0].category).toBe('payment'); // комиссия за счёт
    expect(operations[1].direction).toBe('in');
    expect(operations[1].category).toBe('income');
  });

  it('пустой ИНН и назначение: категория "tax" для ЕНП', async () => {
    const buffer = Buffer.from(organizerCsv, 'utf-8');
    const { operations } = await parseBankStatement(buffer, 'C001.csv');
    const tax = operations.find(o => o.externalId === 'C001-000003');
    expect(tax.counterpartyInn).toBe('');
    expect(tax.category).toBe('tax');
  });

  it('зарплата → salary (назначение из реальных данных C001)', async () => {
    const csv = [
      'company_id;operation_id;operation_date;amount;direction;counterparty_inn;counterparty_name;payment_purpose;balance_eod',
      'C001;C001-000038;2024-10-25;214600.00;Списание;0068275202;ПАО «Банк»;Перечисление заработной платы (аванс) за октябрь 2024 г. по реестру № 3;9000.00',
    ].join('\n');
    const { operations } = await parseBankStatement(Buffer.from(csv), 'C001.csv');
    expect(operations[0].category).toBe('salary');
  });

  it('даты и суммы — ISO/числа, externalId сохранён', async () => {
    const buffer = Buffer.from('\uFEFF' + organizerCsv, 'utf-8');
    const { operations } = await parseBankStatement(buffer, 'C001.csv');
    expect(operations[0].date).toBe('2024-10-01T00:00:00.000Z');
    expect(operations[0].amount).toBe(990);
    expect(operations[0].balanceEndOfDay).toBe(1244821.98);
    expect(operations[0].externalId).toBe('C001-000001');
  });
});

describe('Parser — легаси формат (7 колонок)', () => {
  it('корректно парсит CSV-буфер старой выписки', async () => {
    const mockCsv = "Дата;Сумма;Направление;Контрагент;ИНН;Назначение;Остаток\n2026-01-01;100000;in;ООО Ромашка;7701234567;Оплата по договору;600000";
    const result = await parseBankStatement(Buffer.from(mockCsv, 'utf-8'), 'statement.csv');
    expect(result.operations.length).toBe(1);
    expect(result.meta.format).toBe('legacy');
    expect(result.operations[0].amount).toBe(100000);
    expect(result.operations[0].direction).toBe('in');
    expect(result.operations[0].counterpartyName).toBe('ООО Ромашка');
  });

  it('пустой файл → пусто + warning', async () => {
    const result = await parseBankStatement(Buffer.from(''), 'empty.csv');
    expect(result.operations).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
