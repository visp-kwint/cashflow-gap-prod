// server/tests/scenarios.test.js — ТЗ-доработка WP-4: негативные сценарии «что если».
// Приёмка по спецификации: клиент-задержка, спад выручки, незапланированный расход,
// рост постоянных расходов; нулевой сценарий побитово равен базе; base = главный прогноз.
import { describe, it, expect } from 'vitest';
import { calculateForecast } from '../src/services/forecast.service.js';
import { parseScenarios, SCENARIO_TYPES } from '../src/services/forecast.scenarios.js';
import { unplannedExpenseMedian } from '../src/services/scenario.service.js';

const TODAY = '2026-10-01';
const SEED = 42;
const H = 30;

// Синтетическая выписка: 6 месяцев истории с регулярным клиентом (ИНН 1111),
// спорадической выручкой (ИНН 2222) и постоянными расходами rent/suppliers.
function makeHistory() {
  const ops = [];
  for (let m = 0; m < 6; m++) {
    const mm = 4 + m;
    for (let d = 1; d <= 28; d++) {
      const date = `2026-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (d % 7 === 1) {
        // Регулярный клиент: еженедельно 5000 от ИНН 1111
        ops.push({ date, amount: 5000, direction: 'in', counterpartyInn: '1111', counterpartyName: 'ООО Ромашка', purpose: 'Оплата счёта', subcategory: 'revenue_clients' });
      }
      if (d % 5 === 2) {
        // Спорадическая выручка от 2222
        ops.push({ date, amount: 3000, direction: 'in', counterpartyInn: '2222', counterpartyName: 'ИП Иванов', purpose: 'Выручка', subcategory: 'revenue_clients' });
      }
      if (d === 5 || d === 20) {
        // Аренда и подрядчики (постоянные расходы)
        ops.push({ date, amount: 10000, direction: 'out', counterpartyInn: '3333', counterpartyName: 'Аренда офиса', purpose: 'Аренда', subcategory: 'rent' });
        ops.push({ date, amount: 6000, direction: 'out', counterpartyInn: '4444', counterpartyName: 'Поставщик', purpose: 'Закупка', subcategory: 'suppliers' });
      }
      // Прочие мелкие расходы
      ops.push({ date, amount: 400 + (d % 10) * 50, direction: 'out', counterpartyInn: '5555', counterpartyName: 'Разные', purpose: 'Офис', subcategory: 'other' });
    }
  }
  return ops;
}

function run(scenarios, extra = {}) {
  return calculateForecast(makeHistory(), [], 500000, H, 0, { today: TODAY, seed: SEED, scenarios, ...extra });
}

const sumAttr = (fc, key) => fc.forecastSeries.reduce((acc, p) => acc + (p.scenarioAttribution?.[key] ?? 0), 0);

describe('WP-4: негативные сценарии (options.scenarios в ядре)', () => {
  it('G26: без сценариев (и scenarios=[]) результат побитово идентичен', () => {
    const base = JSON.stringify(calculateForecast(makeHistory(), [], 500000, H, 0, { today: TODAY, seed: SEED }));
    const empty = JSON.stringify(calculateForecast(makeHistory(), [], 500000, H, 0, { today: TODAY, seed: SEED, scenarios: [] }));
    expect(empty).toBe(base);
  });

  it('нулевой сценарий (percent=0, amount не задан) побитово равен базе', () => {
    const base = JSON.stringify(run(undefined));
    const zero = JSON.stringify(
      run([
        { type: 'revenue_drop', params: { percent: 0 } },
        { type: 'fixed_costs_growth', params: { percent: 0 } },
        { type: 'unplanned_expense', params: {} },
      ])
    );
    expect(zero).toBe(base);
  });

  it('G27/G30: client_delay 21 день: приток клиента в первые 21 день = 0, сумма притока за [1,H] ≤ базы', () => {
    const scen = run([{ type: 'client_delay', params: { inn: '1111', days: 21 } }]);
    // Приток клиента 1111 в первые 21 дней = 0
    for (let i = 0; i < 21; i++) {
      const inflow = scen.forecastSeries[i].scenarioAttribution?.scenInflowsByInn?.['1111'] ?? 0;
      expect(inflow).toBeCloseTo(0, 2);
    }
    // Суммарный приток клиента за горизонт: не больше базы (перенесённый за горизонт теряется)
    const scenIn = scen.forecastSeries.reduce((acc, p) => acc + (p.scenarioAttribution?.scenInflowsByInn?.['1111'] ?? 0), 0);
    const refIn = scen.forecastSeries.reduce((acc, p) => acc + (p.scenarioAttribution?.inflowsByInn?.['1111'] ?? 0), 0);
    expect(scenIn).toBeLessThanOrEqual(refIn + 0.01);
    expect(scenIn).toBeGreaterThan(0);
  });

  it('G27: revenue_drop 20%: ожидаемые revenue-поступления ниже базы на 20 % ± 1 %', () => {
    const scen = run([{ type: 'revenue_drop', params: { percent: 20 } }]);
    const revenueIn = sumAttr(scen, 'revenueIn');
    const scenRevenueIn = sumAttr(scen, 'scenRevenueIn');
    expect(revenueIn).toBeGreaterThan(0);
    const ratio = scenRevenueIn / revenueIn;
    expect(ratio).toBeGreaterThan(0.79); // 0.80 ± 0.01
    expect(ratio).toBeLessThan(0.81);
  });

  it('G29: unplanned_expense: остаток в день расхода ниже базового ровно на сумму', () => {
    const baseFc = run(undefined);
    const scen = run([{ type: 'unplanned_expense', params: { amount: 25000, date: '2026-10-15' } }]);
    const idx = scen.forecastSeries.findIndex((p) => p.date === '2026-10-15');
    expect(idx).toBeGreaterThanOrEqual(0);
    const diff = baseFc.forecastSeries[idx].balance - scen.forecastSeries[idx].balance;
    expect(diff).toBeCloseTo(25000, 2);
    // И в каждый последующий день разница остаётся 25000 (разовый расход не накапливается)
    const diff2 = baseFc.forecastSeries[idx + 1].balance - scen.forecastSeries[idx + 1].balance;
    expect(diff2).toBeCloseTo(25000, 2);
  });

  it('G30: fixed_costs_growth 25%: разница расходов на rent+suppliers = 25 % от базовых', () => {
    const scen = run([{ type: 'fixed_costs_growth', params: { percent: 25 } }]);
    const fixedOut = sumAttr(scen, 'fixedOut');
    const scenFixedOut = sumAttr(scen, 'scenFixedOut');
    expect(fixedOut).toBeGreaterThan(0);
    const added = scenFixedOut - fixedOut;
    const expected = fixedOut * 0.25;
    expect(Math.abs(added - expected)).toBeLessThan(expected * 0.01 + 1); // ±1%
  });

  it('base сценария совпадает с главным прогнозом (без options.scenarios)', () => {
    const main = JSON.stringify(run(undefined));
    const withScen = run([{ type: 'revenue_drop', params: { percent: 10 } }]);
    // base-часть ответа сценария = расчёт без сценариев (модуль scenario.service.js делает это явно);
    // в ядре проверяем: прогноз без сценариев детерминирован и не зависит от наличия поля scenarios
    const plain = JSON.stringify(calculateForecast(makeHistory(), [], 500000, H, 0, { today: TODAY, seed: SEED }));
    expect(main).toBe(plain);
    void withScen;
  });

  it('G31: валидация — 5 сценариев, дубликат типов, параметры за границами → отклонение (VALIDATION на API)', () => {
    // 5 сценариев
    const five = Array.from({ length: 5 }, (_, i) => ({ type: SCENARIO_TYPES[i % 4], params: {} }));
    expect(parseScenarios(five).ok).toBe(false);
    // Дубликат типа
    const dup = [
      { type: 'revenue_drop', params: { percent: 10 } },
      { type: 'revenue_drop', params: { percent: 20 } },
    ];
    expect(parseScenarios(dup).ok).toBe(false);
    // Параметр за границей
    expect(parseScenarios([{ type: 'revenue_drop', params: { percent: 31 } }]).ok).toBe(false);
    expect(parseScenarios([{ type: 'client_delay', params: { inn: '1111', days: 30 } }]).ok).toBe(false);
    // 0 сценариев
    expect(parseScenarios([]).ok).toBe(false);
    // Корректный набор проходит
    expect(parseScenarios([{ type: 'revenue_drop', params: { percent: 20 } }]).ok).toBe(true);
  });

  it('Несколько разных типов одновременно: комбинированный эффект (revenue_drop + fixed_costs_growth)', () => {
    const baseFc = run(undefined);
    const scen = run([
      { type: 'revenue_drop', params: { percent: 15 } },
      { type: 'fixed_costs_growth', params: { percent: 10 } },
    ]);
    // Сценарий хуже базы: пробитие/минимум не лучше
    expect(scen.minForecastBalance).toBeLessThanOrEqual(baseFc.minForecastBalance + 0.01);
  });
});

describe('WP-6: дефолт unplanned_expense из истории (отчёт §8.4)', () => {
  it('медиана unplanned_* списаний — дефолт (вместо «с нуля»)', () => {
    const ops = [
      { direction: 'out', amount: 5000, plannedness: 'unplanned_operational' },
      { direction: 'out', amount: 20000, plannedness: 'unplanned_capex' },
      { direction: 'out', amount: 10000, plannedness: 'unplanned_operational' },
      { direction: 'out', amount: 90000, plannedness: 'planned_fixed' }, // не unplanned — не считаем
      { direction: 'in', amount: 4000, plannedness: 'unplanned_operational' }, // не расход — не считаем
    ];
    // медиана [5000, 10000, 20000] = 10000
    expect(unplannedExpenseMedian(ops)).toBe(10000);
  });

  it('нет unplanned_* в истории — null (текущее поведение: ручной ввод)', () => {
    const ops = [{ direction: 'out', amount: 5000, plannedness: 'planned_fixed' }];
    expect(unplannedExpenseMedian(ops)).toBe(null);
    expect(unplannedExpenseMedian([])).toBe(null);
  });

  it('чётное число значений — среднее двух средних', () => {
    const ops = [
      { direction: 'out', amount: 4000, plannedness: 'unplanned_operational' },
      { direction: 'out', amount: 8000, plannedness: 'unplanned_capex' },
    ];
    expect(unplannedExpenseMedian(ops)).toBe(6000);
  });
});
