/**
 * ТЗ-доработка WP-1, приёмка п.3: тесты функций метрик бэктеста на примерах с ручным ответом.
 * Файл: server/tests/backtest.metrics.test.js
 */
import { describe, it, expect } from 'vitest';
import {
  mae,
  rmse,
  bias,
  skill,
  brierScore,
  constantBrier,
  prf1,
  calibrationBins,
  percentile,
  leadTimeStats,
} from '../src/utils/backtestMetrics.js';

describe('backtest metrics (ТЗ §2 п.6–8)', () => {
  it('mae: средняя абсолютная ошибка', () => {
    expect(mae([-1, 2, 3])).toBe(2);
    expect(Number.isNaN(mae([]))).toBe(true);
  });

  it('rmse: корень средней квадратичной ошибки', () => {
    expect(rmse([1, -1, 2])).toBeCloseTo(Math.sqrt(6 / 3), 10);
    expect(Number.isNaN(rmse([]))).toBe(true);
  });

  it('bias: средний (прогноз − факт)', () => {
    expect(bias([1, -2, 3])).toBeCloseTo(2 / 3, 10);
  });

  it('skill = 1 − MAE_модели / MAE_наивного; деление на ноль — null', () => {
    expect(skill(10, 25)).toBeCloseTo(0.6, 10);
    expect(skill(0, 0)).toBeNull();
    expect(skill(5, Number.NaN)).toBeNull();
  });

  it('brierScore: средняя квадратичная ошибка вероятности', () => {
    expect(brierScore([{ p: 0.5, act: 0 }, { p: 0.8, act: 1 }])).toBeCloseTo((0.25 + 0.04) / 2, 10);
    expect(brierScore([])).toBeNull();
  });

  it('constantBrier: m·(1−m) по доле фактов', () => {
    expect(constantBrier([0, 0, 1, 1])).toBeCloseTo(0.25, 10);
    expect(constantBrier([])).toBeNull();
  });

  it('prf1 для правила «предупреждение при p ≥ 0.5»', () => {
    // p: 0.6(act 1) → TP; 0.4(act 0) → верно отрицательное; 0.5(act 1) → TP; 0.9(act 0) → FP
    const r = prf1([{ p: 0.6, act: 1 }, { p: 0.4, act: 0 }, { p: 0.5, act: 1 }, { p: 0.9, act: 0 }], 0.5);
    expect(r.tp).toBe(2);
    expect(r.fp).toBe(1);
    expect(r.fn).toBe(0);
    expect(r.precision).toBeCloseTo(2 / 3, 10);
    expect(r.recall).toBe(1);
    expect(r.f1).toBeCloseTo(0.8, 10);
  });

  it('calibrationBins: бины по 10 п.п., только непустые', () => {
    const bins = calibrationBins([{ p: 0.45, act: 1 }, { p: 0.46, act: 0 }]);
    expect(bins).toHaveLength(1);
    expect(bins[0].bin).toBe('40–50');
    expect(bins[0].meanProbPct).toBeCloseTo(45.5, 10);
    expect(bins[0].actualFreq).toBeCloseTo(0.5, 10);
    expect(bins[0].n).toBe(2);
  });

  it('percentile: линейная интерполяция', () => {
    expect(percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75, 10);
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it('leadTimeStats: медиана и P25 заблаговременности', () => {
    const s = leadTimeStats([10, 20, 30]);
    expect(s.median).toBe(20);
    expect(s.p25).toBeCloseTo(15, 10);
    expect(s.n).toBe(3);
    expect(leadTimeStats([])).toEqual({ median: null, p25: null, n: 0 });
  });
});
