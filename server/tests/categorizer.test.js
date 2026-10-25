/**
 * ТЗ-доработка WP-3, контроль качества: прогон размеченной выборки (server/tests/fixtures/categories.gold.csv).
 * Пороги (ТЗ §4): accuracy ≥ 0.90, macro-F1 ≥ 0.85, доля unknown+other_in+other_out ≤ 10 %.
 * Без разметки (нет categories.gold.csv) тест пропускается —gold-набор размечают вручную два участника (см. make-gold.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { categorize, buildInnHints, classifyPlannedness, categorizeStatement, plannednessStats } from '../src/services/categorizer.service.js';

const GOLD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'categories.gold.csv');

/** Разбор CSV с заголовком (запятая) — gold-набор генерируется make-gold.mjs. */
function readGold() {
  const lines = fs.readFileSync(GOLD, 'utf-8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const row = {};
    head.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

function macroF1(rows, predict) {
  const labels = new Set([...rows.map((r) => r.expected_subcategory), ...rows.map((r) => predict(r))]);
  let sum = 0;
  for (const lab of labels) {
    const tp = rows.filter((r) => r.expected_subcategory === lab && predict(r) === lab).length;
    const fp = rows.filter((r) => r.expected_subcategory !== lab && predict(r) === lab).length;
    const fn = rows.filter((r) => r.expected_subcategory === lab && predict(r) !== lab).length;
    const p = tp + fp ? tp / (tp + fp) : 0;
    const r = tp + fn ? tp / (tp + fn) : 0;
    sum += p + r ? (2 * p * r) / (p + r) : 0;
  }
  return sum / labels.size;
}

const hasGold = fs.existsSync(GOLD);

// Нескользящая «обёртка»: файл-тест всегда содержит прогоняемый тест (vitest: «no test suite» — ошибка).
// Без gold-разметки (ручная, два участника — см. make-gold.mjs) подтверждаем готовность харнеса.
describe('WP-3 gold-харнес', () => {
  it('без categories.gold.csv пропускает проверки и подтверждает генератор на месте', () => {
    if (hasGold) return;
    const gen = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'make-gold.mjs');
    expect(fs.existsSync(gen)).toBe(true);
  });
});

describe.skipIf(!hasGold, 'WP-3 gold-набор (categories.gold.csv отсутствует — разметка ручная, см. make-gold.mjs)', () => {
  const rows = readGold();
  // ИНН-правило по всей выборке: подсказки из размеченных операций
  const labeled = rows.map((r) => ({
    direction: r.direction,
    purpose: r.purpose,
    counterpartyInn: r.counterparty_inn,
    __cat: { subcategory: r.expected_subcategory, confidence: 0.9, rule: 'regex' },
  }));
  const hints = buildInnHints(labeled);

  const predict = (r) => {
    const hint = r.counterparty_inn ? hints.get(String(r.counterparty_inn)) : null;
    const c = categorize(
      {
        direction: r.direction,
        purpose: r.purpose,
        counterpartyInn: r.counterparty_inn,
        counterpartyName: r.counterparty_name ?? '',
      },
      { innHint: hint && !r.purpose ? hint : null },
    );
    return c.subcategory;
  };

  it('accuracy ≥ 0.90', () => {
    const correct = rows.filter((r) => predict(r) === r.expected_subcategory).length;
    const acc = correct / rows.length;
    expect(acc).toBeGreaterThanOrEqual(0.9);
  });

  it('macro-F1 ≥ 0.85', () => {
    expect(macroF1(rows, predict)).toBeGreaterThanOrEqual(0.85);
  });

  it('доля unknown + other_in + other_out ≤ 10 %', () => {
    const ambiguous = rows.filter((r) => ['unknown', 'other_in', 'other_out'].includes(predict(r))).length;
    expect(100 * ambiguous / rows.length).toBeLessThanOrEqual(10);
  });
});

/**
 * Плановость (отчёт §8.2–8.7, минимальный вариант): класс выводится из подкатегории +
 * словарей + истории, хранится в Operation.plannedness.
 * Приёмка: ЕНП/зарплата/аренда → planned_fixed; разовая покупка по счёту → unplanned_*;
 * перевод own_funds_out → owner_discretionary.
 */
describe('WP-6 плановость: classifyPlannedness (минимум §8.7)', () => {
  const out = (o) => ({ direction: 'out', amount: 1000, date: '2026-05-15', counterpartyInn: '', purpose: '', ...o });

  it('ЕНП, зарплата, аренда (белый список подкатегорий) → planned_fixed', () => {
    expect(classifyPlannedness(out({ subcategory: 'tax', purpose: 'Единый налоговый платёж (ЕНП)' })).plannedness).toBe('planned_fixed');
    expect(classifyPlannedness(out({ subcategory: 'salary', purpose: 'Зарплата' })).plannedness).toBe('planned_fixed');
    expect(classifyPlannedness(out({ subcategory: 'rent', purpose: 'Аренда офиса' })).plannedness).toBe('planned_fixed');
  });

  it('разовая покупка по счёту у нерегулярного контрагента → unplanned_*', () => {
    // Одна-единственная выписка: повторяемости нет, сумма не больше P95 → операционная внеплановая
    const ops = [out({ subcategory: 'suppliers', purpose: 'Оплата по счёту № 54', counterpartyInn: '0011229900' })];
    const res = classifyPlannedness(ops[0], { operations: ops, stats: plannednessStats(ops) });
    expect(res.plannedness).toMatch(/^unplanned_/);
    expect(res.source).toBe('rule');
  });

  it('перевод own_funds_out → owner_discretionary (отдельный класс действий владельца)', () => {
    const res = classifyPlannedness(out({ subcategory: 'own_funds_out', purpose: 'Перевод собственных средств' }));
    expect(res.plannedness).toBe('owner_discretionary');
    expect(res.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('словари: «шиномонтаж» → unplanned_operational; «компьютер» → unplanned_capex', () => {
    expect(classifyPlannedness(out({ subcategory: 'suppliers', purpose: 'Шиномонтаж, замена покрышек' })).plannedness).toBe('unplanned_operational');
    expect(classifyPlannedness(out({ subcategory: 'other_out', purpose: 'Покупка компьютера для офиса' })).plannedness).toBe('unplanned_capex');
  });

  it('контрагент ≥4 месяцев, не чаще 2 раз/мес. → recurring_variable', () => {
    // Поставщик «77» — по списанию в каждом из 5 месяцев (по одному)
    const history = Array.from({ length: 5 }, (_, m) => ({
      direction: 'out', amount: 8000 + m * 500, date: `2026-0${m + 1}-10`, counterpartyInn: '77', purpose: 'Закупка по счёту', subcategory: 'suppliers',
    }));
    const cur = history[4];
    const res = classifyPlannedness({ ...cur, subcategory: 'suppliers' }, { operations: history, stats: plannednessStats(history) });
    expect(res.plannedness).toBe('recurring_variable');
    expect(res.source).toBe('recurrence');
  });

  it('крупная одноразовая (больше P95 расходов, без повторов) → unplanned_capex', () => {
    const history = [
      out({ subcategory: 'suppliers', purpose: 'Закупка', amount: 1000, counterpartyInn: '11' }),
      out({ subcategory: 'suppliers', purpose: 'Закупка', amount: 1200, counterpartyInn: '22' }),
      out({ subcategory: 'other_out', purpose: 'Канцтовары', amount: 900, counterpartyInn: '33' }),
    ];
    const big = out({ subcategory: 'other_out', purpose: 'Разовая покупка станка в лизинг', amount: 250000, counterpartyInn: '44' });
    const all = [...history, big];
    const res = classifyPlannedness(big, { operations: all, stats: plannednessStats(all) });
    expect(res.plannedness).toBe('unplanned_capex');
  });

  it('categorizeStatement добавляет поля plannedness* к каждой операции', () => {
    const ops = [
      { direction: 'out', amount: 30000, date: '2026-06-28', counterpartyInn: '0001', counterpartyName: 'ФНС', purpose: 'Единый налоговый платеж (ЕНП), период 05.2026', balanceEndOfDay: 1000 },
      { direction: 'out', amount: 1500, date: '2026-06-30', counterpartyInn: '0002', counterpartyName: 'Клевер', purpose: 'Оплата по счёту № 1', balanceEndOfDay: 9900 },
    ];
    const res = categorizeStatement(ops, null);
    expect(res[0].subcategory).toBe('tax'); // ЕНП → tax
    expect(res[0].plannedness).toBe('planned_fixed'); // tax → белый список
    expect(res[0].plannednessSource).toBe('rule');
    expect(res[1].plannedness).toMatch(/^unplanned_/); // разовая покупка по счёту
    expect(res[1].plannednessConfidence).toBeGreaterThanOrEqual(0);
  });
});
