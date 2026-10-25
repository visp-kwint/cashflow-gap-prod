// server/tests/dataQuality.test.js — ТЗ-доработка WP-7 §1, §8–§13: качество выписки, asOf, категоризация
import { describe, it, expect } from 'vitest';
import { findGaps, analyzeStatement, summarizeByDay } from '../src/utils/dataQuality.js';
import { calculateForecast } from '../src/services/forecast.service.js';
import { getAsOfDate } from '../src/utils/asOf.js';
import { categorize, categorizeStatement, SUBCATEGORIES, legacyForSub, resolveSubcategory } from '../src/services/categorizer.service.js';

const D = (s) => new Date(s + 'T00:00:00Z');
const dayIdx = (s) => Math.floor(D(s).getTime() / 86_400_000);
const op = (date, amount, direction = 'out', extra = {}) => ({
  date: D(date).toISOString(),
  amount,
  direction,
  counterpartyName: 'Контрагент',
  counterpartyInn: '1234567890',
  purpose: '',
  balanceEndOfDay: 0,
  ...extra,
});

describe('findGaps (ТЗ-доработка §8)', () => {
  it('пустые дни без прыжка остатка — не пропуск', () => {
    const ops = [
      op('2024-10-01', 100, 'in', { balanceEndOfDay: 100 }),
      op('2024-10-04', 50, 'out', { balanceEndOfDay: 50 }),
      op('2024-10-05', 10, 'out', { balanceEndOfDay: 40 }),
    ];
    const { gaps, gapDaySet } = findGaps(ops);
    // 1-е (100) → 4-е (50): ожидаемый 100 + net(4-е) = 100 − 50 = 50 — совпадает, пропусков нет
    expect(gaps.length).toBe(0);
    expect(gapDaySet.has(dayIdx('2024-10-02'))).toBe(false);
  });

  it('день с прыжком остатка в пустом участке — пропуск', () => {
    const ops = [
      op('2024-10-01', 100, 'in', { balanceEndOfDay: 100 }),
      op('2024-10-10', 10, 'out', { balanceEndOfDay: 1500 }), // остаток вырос на 1400, а net(10-е) = −10
      op('2024-10-11', 5, 'out', { balanceEndOfDay: 1495 }),
    ];
    const { gaps, gapDaySet } = findGaps(ops);
    expect(gaps.length).toBe(1);
    expect(gaps[0].from).toBe('2024-10-02');
    expect(gaps[0].to).toBe('2024-10-09');
    expect(gapDaySet.size).toBe(8);
    expect(gapDaySet.has(dayIdx('2024-10-05'))).toBe(true);
  });

  it('missingNet: 5-дневная дыра, missingNet = (остаток_до + net_после) − остаток_после', () => {
    const ops = [
      op('2024-10-01', 100, 'in', { balanceEndOfDay: 100 }),
      op('2024-10-08', 10, 'out', { balanceEndOfDay: 500 }),
    ];
    const { gaps } = findGaps(ops);
    expect(gaps.length).toBe(1);
    expect(gaps[0].from).toBe('2024-10-02');
    expect(gaps[0].to).toBe('2024-10-07');
    expect(gaps[0].missingNet).toBe(-410); // (100 − 10) − 500
  });
});

describe('summarizeByDay', () => {
  it('агрегирует net и остаток конца дня', () => {
    const ops = [op('2024-10-01', 100, 'in', { balanceEndOfDay: 300 }), op('2024-10-01', 40, 'out', { balanceEndOfDay: 260 })];
    const s = summarizeByDay(ops);
    const e = s.get(dayIdx('2024-10-01'));
    expect(e.net).toBe(60);
    expect(e.balance).toBe(300); // остаток дня = максимум по операции
  });
});

describe('analyzeStatement (ТЗ-доработка §1)', () => {
  it('считает пустые ИНН, овердрафт и уровень истории', () => {
    const ops = [
      op('2024-01-05', 50, 'out', { counterpartyInn: '' }),
      op('2024-01-06', 50, 'out', { balanceEndOfDay: -5 }),
      op('2024-01-07', 50, 'out', { balanceEndOfDay: 45 }),
    ];
    const q = analyzeStatement(ops);
    expect(q.emptyInnCount).toBe(1);
    expect(q.overdraftDays).toBe(1);
    expect(q.level).toBe('insufficient'); // 3 дня
    expect(q.gaps.length).toBe(0);
  });

  it('пустая выписка — уровень insufficient', () => {
    const q = analyzeStatement([]);
    expect(q.level).toBe('insufficient');
    expect(q.historyDays).toBe(0);
  });

  it('история 10 дней (меньше 14) — insufficient', () => {
    const ops = [];
    for (let i = 1; i <= 10; i += 1) ops.push(op(`2024-01-${String(i).padStart(2, '0')}`, 10, 'in', { balanceEndOfDay: 10 * i }));
    expect(analyzeStatement(ops).level).toBe('insufficient');
  });
});

describe('getAsOfDate (ТЗ-доработка §9)', () => {
  it('свежая выписка (≤ 3 дн.) — текущая дата', () => {
    expect(getAsOfDate(D('2025-01-02'), D('2025-01-04'))).toBe('2025-01-04');
  });

  it('старая выписка — последняя дата операции', () => {
    expect(getAsOfDate(D('2024-10-01'), D('2025-01-01'))).toBe('2024-10-01');
  });

  it('без операций — null', () => {
    expect(getAsOfDate(null, D('2025-01-01'))).toBe(null);
  });

  it('границы: ровно 3 дня — свежая, 4 дня — старая (ТЗ WP-7 §9)', () => {
    expect(getAsOfDate(D('2025-01-01'), D('2025-01-04'))).toBe('2025-01-04');
    expect(getAsOfDate(D('2025-01-01'), D('2025-01-05'))).toBe('2025-01-01');
  });
});

describe('categorize (ТЗ-доработка §2)', () => {
  it('возвраты: «возврат» в назначении → refund_in/refund_out (conf 0.9)', () => {
    const out = categorize({ ...op('2024-05-01', 100, 'out'), purpose: 'Возврат по договору 12' });
    expect(out.subcategory).toBe('refund_out');
    expect(out.confidence).toBe(0.9);
    expect(out.rule).toBe('regex');

    const inn = categorize({ ...op('2024-05-01', 100, 'in'), counterpartyName: 'ВОЗВРАТ СЧЁТА', purpose: 'возврат средств' });
    expect(inn.subcategory).toBe('refund_in');
  });

  it('24-ч окно: исходящий тот же контрагент после refund_in → refund_out (refund-24h)', () => {
    const inn = op('2024-05-01', 100, 'in', { purpose: 'возврат средств', counterpartyInn: '555' });
    const out = op('2024-05-01', 50, 'out', { purpose: 'оплата товара', counterpartyInn: '555' });
    const r = categorize(out, { operations: [inn, out] });
    expect(r.subcategory).toBe('refund_out');
    expect(r.rule).toBe('refund-24h');
  });

  it('зарплата / налоги / аренда / кредит / поставщик', () => {
    expect(categorize(op('2024-05-01', 100, 'out', { purpose: 'Зарплата июнь' })).subcategory).toBe('salary');
    expect(categorize(op('2024-05-01', 100, 'out', { purpose: 'Налог за 2 кв.' })).subcategory).toBe('tax');
    expect(categorize(op('2024-05-01', 100, 'out', { purpose: 'Аренда офиса' })).subcategory).toBe('rent');
    expect(categorize(op('2024-05-01', 100, 'out', { purpose: 'Платёж по кредиту' })).subcategory).toBe('loan_payment');
    expect(categorize(op('2024-05-01', 100, 'out', { purpose: 'Оплата поставщику' })).subcategory).toBe('suppliers');
    // «перевод на 30 дней» — НЕ налог (приёмка p.2.3)
    expect(categorize(op('2024-05-01', 100, 'out', { purpose: 'Перевод на 30 дней' })).subcategory).toBe('other_out');
  });

  it('выручка: клиенты / эквайринг / маркетплейс', () => {
    expect(categorize(op('2024-05-01', 100, 'in', { purpose: 'Оплата по договору' })).subcategory).toBe('revenue_clients');
    expect(categorize(op('2024-05-01', 100, 'in', { purpose: 'эквайринг мерч' })).subcategory).toBe('revenue_acquiring');
    expect(categorize(op('2024-05-01', 100, 'in', { purpose: 'маркетплейс авито' })).subcategory).toBe('revenue_marketplace');
  });

  it('свои средства по ИНН владельца', () => {
    const r = categorize({ ...op('2024-05-01', 100, 'out'), counterpartyInn: '111' }, { userInn: '111' });
    expect(r.subcategory).toBe('own_funds_out');
    const rin = categorize({ ...op('2024-05-01', 100, 'in'), counterpartyInn: '111' }, { userInn: '111' });
    expect(rin.subcategory).toBe('own_funds_in');
  });

  it('ИНН-правило §4 п.5: ≥3 вхождений + ≥80 % размеченных в одной категории → hint (conf 0.6)', () => {
    // Контрагент 999: 3 операции, 2 из них размечены как revenue_clients (0.9) → 100 % одной категории
    const ops = [
      op('2024-05-01', 100, 'in', { purpose: 'оплата по договору', counterpartyInn: '999' }), // revenue_clients (regex)
      op('2024-05-05', 100, 'in', { purpose: 'оплата по акту', counterpartyInn: '999' }), // revenue_clients (regex)
      op('2024-05-10', 100, 'in', { purpose: '', counterpartyInn: '999' }), // пустое назначение → hint
    ];
    const res = categorizeStatement(ops, null);
    expect(res[2].subcategory).toBe('revenue_clients');
    expect(res[2].categorizeRule).toBe('inn-rule');
    expect(res[2].categoryConfidence).toBe(0.6);
  });

  it('категория выводится из подкатегории (legacy)', () => {
    expect(legacyForSub('salary', 'out')).toBe('salary');
    expect(legacyForSub('refund_in', 'in')).toBe('income');
    expect(legacyForSub('loan_payment', 'out')).toBe('payment');
  });

  it('статический список подкатегорий §2.1 (17 шт.)', () => {
    expect(SUBCATEGORIES.length).toBe(17);
    for (const sc of SUBCATEGORIES) expect(['in', 'out']).toContain(sc.direction);
    expect(resolveSubcategory('salary', 'out')).toBe('salary');
    expect(resolveSubcategory('salary', 'in')).toBeNull();
    expect(resolveSubcategory('nope')).toBeNull();
  });
});

describe('calculateForecast (ТЗ-доработка WP-7 §9/§11)', () => {
  it('пустая выписка — 200-сценарий: insufficient, Monte Carlo отключён, разрыва нет', () => {
    const fc = calculateForecast([], [], 0, 30, 0, { today: D('2025-01-10'), mcDisabled: true });
    expect(fc.dataQuality.level).toBe('insufficient');
    expect(fc.gapProbabilityPct).toBe(null);
    expect(fc.alreadyBelowThreshold).toBe(false);
    expect(fc.gapDate).toBe(null);
    expect(fc.forecastSeries.length).toBe(30);
  });

  it('alreadyBelowThreshold: остаток на asOf < T — разрыв «сейчас», gapAmount = T − остаток (§11)', () => {
    const fc = calculateForecast([], [], 50, 30, 100, { today: D('2025-01-10'), mcDisabled: true });
    expect(fc.alreadyBelowThreshold).toBe(true);
    expect(fc.gapDate).toBe('2025-01-10');
    expect(fc.gapAmount).toBe(50);
  });

  it('контроль: остаток ≥ T — alreadyBelowThreshold false', () => {
    const fc = calculateForecast([], [], 1000, 30, 100, { today: D('2025-01-10'), mcDisabled: true });
    expect(fc.alreadyBelowThreshold).toBe(false);
    expect(fc.gapDate).toBe(null);
  });

  it('короткая история (≤ 14 дней) — без Monte Carlo: gapProbabilityPct = null', () => {
    const ops = [];
    for (let i = 1; i <= 10; i += 1) ops.push(op(`2024-01-${String(i).padStart(2, '0')}`, 100, 'in'));
    const fc = calculateForecast(ops, [], 5000, 30, 0, { today: D('2024-01-12'), mcDisabled: true });
    expect(fc.dataQuality.historyDays).toBe(12);
    expect(fc.dataQuality.level).toBe('insufficient');
    expect(fc.gapProbabilityPct).toBe(null);
    expect(fc.gapAmountMedian).toBe(null);
  });
});
