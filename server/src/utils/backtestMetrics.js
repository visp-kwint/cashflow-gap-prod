/**
 * ТЗ-доработка WP-1: чистые функции метрик бэктеста (без БД и без расчёта прогноза).
 * Примеры из тестов: server/tests/backtest.metrics.test.js.
 */

/** Средняя абсолютная ошибка. Пустой массив → NaN. */
export function mae(errors) {
  if (!errors.length) return NaN;
  return errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
}

/** Корневая средняя квадратичная ошибка. */
export function rmse(errors) {
  if (!errors.length) return NaN;
  return Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
}

/** Смещение (bias): среднее (прогноз − факт). */
export function bias(errors) {
  if (!errors.length) return NaN;
  return errors.reduce((s, e) => s + e, 0) / errors.length;
}

/** skill = 1 − MAE_модели / MAE_наивного (наивный лучше или равен → ≤ 0; деляться на 0 нельзя → null). */
export function skill(maeModel, maeNaive) {
  if (!Number.isFinite(maeModel) || !Number.isFinite(maeNaive) || maeNaive === 0) return null;
  return 1 - maeModel / maeNaive;
}

/**
 * Brier score по парам { p — вероятность модели 0..1, act — факт 0/1 }.
 * @returns {number | null} null, если пар нет
 */
export function brierScore(pairs) {
  if (!pairs.length) return null;
  return pairs.reduce((s, { p, act }) => s + (p - act) ** 2, 0) / pairs.length;
}

/** Brier константного прогноза: m·(1−m), где m — доля фактов-разрывов. */
export function constantBrier(facts) {
  if (!facts.length) return null;
  const m = facts.reduce((s, a) => s + a, 0) / facts.length;
  return m * (1 - m);
}

/**
 * Precision / recall / F1 для правила «предупреждение, если p ≥ 0.5».
 * @param {Array<{ p: number, act: 0|1 }>} pairs
 */
export function prf1(pairs, warnThresholdP = 0.5) {
  let tp = 0, fp = 0, fn = 0;
  for (const { p, act } of pairs) {
    if (p >= warnThresholdP && act === 1) tp += 1;
    else if (p >= warnThresholdP && act === 0) fp += 1;
    else if (p < warnThresholdP && act === 1) fn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

/**
 * Таблица калибровки: бины вероятности по 10 п.п.
 * Возвращает только непустые бины: { bin: '40–50', meanProbPct, actualFreq, n }.
 * @param {Array<{ p: number, act: 0|1 }>} pairs — p в долях (0..1)
 */
export function calibrationBins(pairs, binSizePct = 10) {
  const bins = [];
  for (let lo = 0; lo < 100; lo += binSizePct) {
    const inBin = pairs.filter(({ p }) => p * 100 >= lo && p * 100 < lo + binSizePct);
    if (!inBin.length) continue;
    const meanProbPct = (inBin.reduce((s, { p }) => s + p, 0) / inBin.length) * 100;
    const actualFreq = inBin.reduce((s, { act }) => s + act, 0) / inBin.length;
    bins.push({ bin: `${lo}–${lo + binSizePct}`, meanProbPct, actualFreq, n: inBin.length });
  }
  return bins;
}

/** k-й перцентиль (0..100) с линейной интерполяцией; пустой массив → NaN. */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Медиана и 25-й перцентиль набора чисел (пусто → null). */
export function leadTimeStats(days) {
  if (!days.length) return { median: null, p25: null, n: 0 };
  return { median: percentile(days, 50), p25: percentile(days, 25), n: days.length };
}
