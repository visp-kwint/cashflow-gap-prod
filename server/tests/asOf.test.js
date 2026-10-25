// server/tests/asOf.test.js — ТЗ-доработка WP-7 §9: границы «свежая/старая» выписки (3 и 4 дня)
import { describe, it, expect } from 'vitest';
import { getAsOfDate } from '../src/utils/asOf.js';

const D = (s) => new Date(s + 'T00:00:00Z');

describe('getAsOfDate — границы (ТЗ-доработка WP-7 §9)', () => {
  it('ровно 3 дня — свежая выписка, опорная дата = текущая', () => {
    expect(getAsOfDate(D('2025-01-01'), D('2025-01-04'))).toBe('2025-01-04');
  });

  it('4 дня — старая выписка, опорная дата = последняя дата операции', () => {
    expect(getAsOfDate(D('2025-01-01'), D('2025-01-05'))).toBe('2025-01-01');
  });

  it('те же границы для строк ISO', () => {
    expect(getAsOfDate('2025-01-01T00:00:00.000Z', D('2025-01-04'))).toBe('2025-01-04');
    expect(getAsOfDate('2025-01-01T00:00:00.000Z', D('2025-01-05'))).toBe('2025-01-01');
  });

  it('без операций — null', () => {
    expect(getAsOfDate(null, D('2025-01-01'))).toBeNull();
    expect(getAsOfDate(undefined, D('2025-01-01'))).toBeNull();
  });
});
