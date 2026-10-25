// server/src/services/forecast.baselines.js — WP-2 (ТЗ-доработка п. 1–2)
// Чистые функции без БД: базовые подходы к прогнозу остатка для сравнения с основной моделью.
// Каждый принимает контекст { operations (≤ cut), currentBalance, horizonDays, threshold, today (cut), config? }
// и возвращает { id, label, forecastSeries: [{ date, balance }], gapDate }.
// Правило gapDate: первая дата горизонта, где balance < T; null, если таких дней нет.
// Подходы используют ТОЛЬКО переданные операции (дата ≤ cut) — без утечки будущих данных.
import { calculateForecast } from './forecast.service.js';
import { FORECAST_CONFIG } from '../config/forecast.config.js';

const DAY_MS = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const opDay = (op) => String(op.day ?? op.date).slice(0, 10);
const net = (op) => (op.direction === 'in' ? op.amount : -op.amount);

/** Дневные нетто-потоки по мапе день (ISO) → (поступления − списания). */
function dailyNet(operations) {
  const m = new Map();
  for (const op of operations) {
    const d = opDay(op);
    m.set(d, (m.get(d) ?? 0) + net(op));
  }
  return m;
}

/** Дата d − k дней (k ≥ 0). */
function shift(isoDate, k) {
  return iso(Date.parse(isoDate) - k * DAY_MS);
}

function buildSeries(ctx, dailyDelta) {
  // dailyDelta(i) — нетто-поток дня горизонта i (1-based)
  const { currentBalance: b0, horizonDays: H, today, threshold } = ctx;
  let balance = b0;
  let gapDate = null;
  const series = [];
  for (let i = 1; i <= H; i++) {
    balance += dailyDelta(i);
    const date = iso(Date.parse(today) + i * DAY_MS);
    series.push({ date, balance });
    if (gapDate === null && balance < threshold) gapDate = date;
  }
  // порог превышен уже на старте (B0 < T) — разрыв «сейчас», как в основной модели
  if (gapDate === null && b0 < threshold) gapDate = iso(Date.parse(today));
  return { forecastSeries: series, gapDate };
}

function withMeta(id, label, ctx, result) {
  return { id, label, ...result, hasProbability: false };
}

// --- 1. naive: остаток не меняется -------------------------------------------
export function naiveBaseline(ctx) {
  const out = buildSeries(ctx, () => 0);
  return withMeta('naive', 'Наивный: остаток не меняется (B0)', ctx, out);
}

// --- 2. mean90: среднее нетто за последние 90 дней ---------------------------
export function mean90Baseline(ctx) {
  const m = dailyNet(ctx.operations);
  const { today } = ctx;
  // последние 90 дней включительно с cut
  let sum = 0;
  for (let k = 0; k < 90; k++) sum += m.get(shift(today, k)) ?? 0;
  const avg = sum / 90;
  return withMeta('mean90', 'Среднее нетто-потока за 90 дней', ctx, buildSeries(ctx, () => avg));
}

// --- 3. weekday: среднее по дню недели за 12 недель --------------------------
export function weekdayBaseline(ctx) {
  const m = dailyNet(ctx.operations);
  const { today } = ctx;
  // среднее нетто каждого дня недели по последним 12 вхождениям (84 дня, включая cut)
  const byWeekday = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  for (let k = 0; k < 84; k++) {
    const d = shift(today, k);
    const w = new Date(Date.parse(d)).getUTCDay();
    byWeekday[w].sum += m.get(d) ?? 0;
    byWeekday[w].n += 1;
  }
  const avg = byWeekday.map((x) => (x.n ? x.sum / x.n : 0));
  return withMeta(
    'weekday',
    'Среднее нетто по дню недели (12 недель)',
    ctx,
    buildSeries(ctx, (i) => avg[new Date(Date.parse(ctx.today) + i * DAY_MS).getUTCDay()]),
  );
}

// --- 4. last30: повтор паттерна последних 30 дней -----------------------------
export function last30Baseline(ctx) {
  const m = dailyNet(ctx.operations);
  // паттерн: день i горизонта повторяет день (i mod 30) последних 30 дней
  // (j = 0 — день cut, 1 — вчерашний; i mod 30 = 0 → j = 0)
  const pattern = Array.from({ length: 30 }, (x, j) => m.get(shift(ctx.today, j)) ?? 0);
  return withMeta('last30', 'Повтор последних 30 дней', ctx, buildSeries(ctx, (i) => pattern[i % 30]));
}

// --- 5. holtwinters: аддитивный Holt-Winters, период 7 (вручную) -------------
// Параметры из forecast.config.js (подбор на тренировочном периоде организаторов не
// проводился — датасет не в репозитории; дефолты, честность зафиксирована в отчёте).
export function holtwintersBaseline(ctx) {
  const cfg = { ...FORECAST_CONFIG, ...(ctx.config ?? {}) };
  const P = cfg.holtwintersPeriod;
  const trainDays = (cfg.holtwintersTrainWeeks ?? 13) * P;
  const m = dailyNet(ctx.operations);
  const { today } = ctx;
  const obs = Array.from({ length: trainDays }, (_, t) => m.get(shift(today, trainDays - t)) ?? 0);
  // календарный день недели obs[t] и i-го дня горизонта
  const wd = (dateIso) => new Date(Date.parse(dateIso)).getUTCDay();
  const wdOfT = (t) => wd(shift(today, trainDays - t));
  const wdOfI = (i) => wd(iso(Date.parse(today) + i * DAY_MS));

  let result;
  if (obs.length >= 2 * P) {
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    let L = mean(obs.slice(0, P));
    let T = (mean(obs.slice(P, 2 * P)) - L) / P;
    const S = Array(P).fill(0);
    for (let w = 0; w < P; w++) {
      const vals = obs.slice(0, P).filter((_, idx) => wdOfT(idx) === w);
      if (vals.length) S[w] = mean(vals) - L;
    }
    // обновление (адаптивные средние) на наблюдениях P..trainDays−1
    const { holtwintersAlpha: a, holtwintersBeta: b, holtwintersGamma: g } = cfg;
    for (let t = P; t < obs.length; t++) {
      const w = wdOfT(t);
      const nextL = L + T;
      L = a * (obs[t] - S[w]) + (1 - a) * nextL;
      T = b * (L - nextL) + (1 - b) * T;
      S[w] = g * (obs[t] - L - T) + (1 - g) * S[w];
    }
    result = buildSeries(ctx, (i) => L + i * T + S[wdOfI(i)]);
  } else {
    // истории для HW мало — деградация до нулевого потока
    result = buildSeries(ctx, () => 0);
  }
  return withMeta('holtwinters', 'Аддитивный Holt-Winters (период 7)', ctx, result);
}

// --- 6. core: основная модель без Монте-Карло ---------------------------------
export function coreBaseline(ctx) {
  const f = calculateForecast(ctx.operations, [], ctx.currentBalance, ctx.horizonDays, ctx.threshold, {
    today: ctx.today,
    mcDisabled: true,
    config: ctx.config,
  });
  return {
    id: 'core',
    label: 'Основная модель без Монте-Карло',
    forecastSeries: f.forecastSeries,
    gapDate: f.gapDate,
    hasProbability: false,
  };
}

// --- 7. full: основная модель полностью (с Монте-Карло) ------------------------
export function fullBaseline(ctx) {
  const f = calculateForecast(ctx.operations, [], ctx.currentBalance, ctx.horizonDays, ctx.threshold, {
    today: ctx.today,
    config: ctx.config,
  });
  return {
    id: 'full',
    label: 'Основная модель (полная, с Монте-Карло)',
    forecastSeries: f.forecastSeries,
    gapDate: f.gapDate,
    gapProbabilityPct: f.gapProbabilityPct,
    minForecastBalance: f.minForecastBalance,
    hasProbability: true,
  };
}

export const BASELINES = {
  naive: naiveBaseline,
  mean90: mean90Baseline,
  weekday: weekdayBaseline,
  last30: last30Baseline,
  holtwinters: holtwintersBaseline,
  core: coreBaseline,
  full: fullBaseline,
};

/** Все ID подходов (порядок таблицы отчёта). */
export const BASELINE_IDS = Object.keys(BASELINES);
