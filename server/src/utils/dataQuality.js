// server/src/utils/dataQuality.js
// Анализ качества выписки (ТЗ-доработка WP-7 §7): пропуски, пустые назначения/ИНН,
// овердрафт, уровень истории. Чистые функции без БД.

const DAY_MS = 86_400_000;
const GAP_TOLERANCE_RUB = 1; // пропуск фиксируется при расхождении остатка больше 1 ₽

const dayIndex = (dateValue) => {
  const t = dateValue instanceof Date ? dateValue.getTime() : new Date(dateValue).getTime();
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
};
const isoOf = (dayIdx) => new Date(dayIdx * DAY_MS).toISOString().slice(0, 10);

/**
 * Сводка по дням: lastBalance (остаток конца дня) и net (поступления − списания).
 */
export function summarizeByDay(operations) {
  const byDay = new Map();
  for (const op of operations ?? []) {
    const day = dayIndex(op?.date);
    if (day === null) continue;
    const amount = Math.abs(Number(op?.amount)) || 0;
    const e = byDay.get(day) ?? { net: 0, balance: null };
    e.net += op.direction === 'in' ? amount : -amount;
    if (Number.isFinite(op?.balanceEndOfDay) && (e.balance === null || op.balanceEndOfDay > e.balance)) {
      e.balance = Number(op.balanceEndOfDay);
    }
    byDay.set(day, e);
  }
  return byDay;
}

/**
 * Пропуски (ТЗ-доработка WP-7 §7): между двумя соседними датами операций d1 < d2
 * с gap > 1 дня, если |остаток(d1) + net(d2) − остаток(d2)| > 1 ₽ — дни d1+1…d2−1
 * «пропали» (остаток «скачет», данные за эти дни отсутствуют).
 * @returns {{ gaps: Array<{from: string, to: string, missingNet: number}>, gapDaySet: Set<number> }}
 *   gaps — ISO-даты пропущенных дней (from = первый, to = последний день пропущенного отрезка);
 *   gapDaySet — множество day-индексов (UTC-дни) с пропущенными данными.
 */
export function findGaps(operations) {
  const byDay = summarizeByDay(operations);
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const gaps = [];
  const gapDaySet = new Set();
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const cur = days[i];
    if (cur - prev < 2) continue;
    const prevBal = byDay.get(prev).balance;
    const curBal = byDay.get(cur).balance;
    if (prevBal === null || curBal === null) continue; // без остатков пропуск не детектируется
    const expected = prevBal + byDay.get(cur).net;
    const missingNet = expected - curBal;
    if (Math.abs(missingNet) > GAP_TOLERANCE_RUB) {
      const from = prev + 1;
      const to = cur - 1;
      gaps.push({ from: isoOf(from), to: isoOf(to), missingNet });
      for (let d = from; d <= to; d++) gapDaySet.add(d);
    }
  }
  return { gaps, gapDaySet };
}

/**
 * analyzeStatement (ТЗ-доработка WP-7 §7).
 * @param operations строки выписки (поля: date, amount, direction, purpose, counterpartyInn, balanceEndOfDay)
 * @returns {{ historyDays: number, firstOpDate: string|null, lastOpDate: string|null,
 *   gaps: Array, emptyPurposeCount: number, emptyInnCount: number, overdraftDays: number,
 *   warnings: string[], level: 'insufficient'|'low'|'medium'|'high' }}
 */
export function analyzeStatement(operations) {
  const ops = operations ?? [];
  if (ops.length === 0) {
    return {
      historyDays: 0,
      firstOpDate: null,
      lastOpDate: null,
      gaps: [],
      emptyPurposeCount: 0,
      emptyInnCount: 0,
      overdraftDays: 0,
      warnings: ['Операций нет — данных недостаточно для прогноза'],
      level: 'insufficient',
    };
  }

  let minDay = Infinity;
  let maxDay = -Infinity;
  let emptyPurposeCount = 0;
  let emptyInnCount = 0;
  const eodByDay = new Map();
  for (const op of ops) {
    const day = dayIndex(op.date);
    if (day === null) continue;
    minDay = Math.min(minDay, day);
    maxDay = Math.max(maxDay, day);
    if (String(op.purpose ?? '').trim() === '') emptyPurposeCount++;
    if (String(op.counterpartyInn ?? '').trim() === '') emptyInnCount++;
    const bal = Number(op.balanceEndOfDay);
    if (Number.isFinite(bal)) {
      const prev = eodByDay.get(day);
      if (prev === undefined || bal > prev) eodByDay.set(day, bal);
    }
  }
  if (minDay === Infinity) minDay = maxDay = dayIndex(ops[0].date) ?? 0;

  const { gaps } = findGaps(ops);
  let overdraftDays = 0;
  for (const bal of eodByDay.values()) if (bal < 0) overdraftDays++;

  const historyDays = maxDay - minDay + 1;
  const warnings = [];
  if (historyDays < 14) warnings.push('История короче 14 дней — данных недостаточно для прогноза');
  else if (historyDays < 90) warnings.push('История короче 90 дней — прогноз ориентировочный');
  else if (historyDays < 180) warnings.push('История короче 6 месяцев — сезонность и регулярность оцениваются неточно');
  if (gaps.length) {
    const total = gaps.reduce((sum, g) => sum + (dayIndex(g.to) - dayIndex(g.from) + 1), 0);
    warnings.push(`Обнаружены пропуски в данных: ${gaps.length} отрезков на ${total} дн. (остаток «скачет») — пропущенные дни исключены из статистики`);
  }
  if (emptyPurposeCount) warnings.push(`${emptyPurposeCount} операций без назначения платежа`);
  if (emptyInnCount) warnings.push(`${emptyInnCount} операций без ИНН контрагента`);
  if (overdraftDays) warnings.push(`Остаток ниже нуля в ${overdraftDays} дн. (овердрафт)`);

  const level = historyDays < 14 ? 'insufficient' : historyDays < 90 ? 'low' : historyDays < 180 ? 'medium' : 'high';
  return {
    historyDays,
    firstOpDate: isoOf(minDay),
    lastOpDate: isoOf(maxDay),
    gaps,
    emptyPurposeCount,
    emptyInnCount,
    overdraftDays,
    warnings,
    level,
  };
}
