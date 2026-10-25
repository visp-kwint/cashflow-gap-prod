// server/tests/forecast.baselines.test.js — WP-2: базовые подходы (Гейт G22)
// Чистые функции без БД; проверка формы результата и отсутствия утечки будущих данных.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  BASELINES,
  BASELINE_IDS,
  naiveBaseline,
  mean90Baseline,
  weekdayBaseline,
  last30Baseline,
  holtwintersBaseline,
  coreBaseline,
  fullBaseline,
} from '../src/services/forecast.baselines.js';

const TODAY = '2026-05-01';
const H = 30;

// Генератор истории: 150 дней до cut (включая сам cut — выписка идёт по cut) — ежедневная
// выручка с недельным ритмом, регулярная зарплата 5-го числа, разовые платежи.
// Будущие операции — отдельно.
function makeOps() {
  const ops = [];
  const day = (k) => new Date(Date.parse(TODAY) - k * 86_400_000).toISOString().slice(0, 10);
  for (let k = 150; k >= 0; k--) {
    const wd = new Date(Date.parse(day(k))).getUTCDay();
    const revenue = wd === 0 || wd === 6 ? 0 : 50_000 + 5_000 * ((k * 7) % 3);
    if (revenue > 0) ops.push({ date: day(k), amount: revenue, direction: 'in', purpose: 'Оплата по УПД', subcategory: 'revenue_clients' });
    if (Number(day(k).slice(8)) === 5 && k >= 120) ops.push({ date: day(k), amount: 240_000, direction: 'out', purpose: 'Зарплата', subcategory: 'salary' });
  }
  return ops;
}

// Будущие операции (после cut) — для anti-утечки
function futureOps() {
  return [
    { date: '2026-05-02', amount: 900_000, direction: 'in', purpose: 'Оплата по договору' },
    { date: '2026-05-05', amount: 400_000, direction: 'out', purpose: 'Поставщик' },
    { date: '2026-05-10', amount: 100_000, direction: 'out', purpose: 'Реклама' },
  ];
}

const ctxOf = (operations, over = {}) => ({
  operations,
  currentBalance: 1_000_000,
  horizonDays: H,
  threshold: 0,
  today: TODAY,
  ...over,
});

const PURE = ['naive', 'mean90', 'weekday', 'last30', 'holtwinters']; // только история ≤ cut

function checkShape(result, id) {
  assert.ok(Array.isArray(result.forecastSeries), `${id}: forecastSeries — массив`);
  assert.equal(result.forecastSeries.length, H);
  assert.ok(result.gapDate === null || typeof result.gapDate === 'string', `${id}: gapDate — null или ISO-дата`);
  for (let i = 0; i < H; i++) {
    const pt = result.forecastSeries[i];
    assert.equal(pt.date, new Date(Date.parse(TODAY) + (i + 1) * 86_400_000).toISOString().slice(0, 10), `${id}: день ${i + 1} — дата горизонта`);
    assert.ok(Number.isFinite(pt.balance), `${id}: баланс конечный`);
  }
}

describe('BASELINES', () => {
  it('реестр: 7 подходов, id совпадают с функциями', () => {
    assert.deepEqual(BASELINE_IDS, ['naive', 'mean90', 'weekday', 'last30', 'holtwinters', 'core', 'full']);
    for (const id of BASELINE_IDS) assert.equal(typeof BASELINES[id], 'function');
  });

  it('форма результата у всех подходов', () => {
    const ops = makeOps();
    for (const id of BASELINE_IDS) {
      checkShape(BASELINES[id](ctxOf(ops)), id);
    }
  });
});

describe('naive', () => {
  it('остаток не меняется; B0 < T → разрыв с первого дня горизонта', () => {
    const r = naiveBaseline(ctxOf(makeOps()));
    for (const pt of r.forecastSeries) assert.equal(pt.balance, 1_000_000);
    assert.equal(r.gapDate, null);
    const r2 = naiveBaseline(ctxOf(makeOps(), { threshold: 2_000_000 }));
    assert.equal(r2.gapDate, '2026-05-02'); // первый день горизонта (прогноз со дня после cut)
  });
});

describe('anti-утечка (G22): замена будущих операций не меняет прогноз чистых подходов', () => {
  it('наивный/mean90/weekday/last30/holtwinters инвариантны к будущим данным', () => {
    const ops = makeOps();
    for (const id of PURE) {
      const base = BASELINES[id](ctxOf(ops, { threshold: 0 })).forecastSeries.map((p) => p.balance);
      const mutated = [...ops, ...futureOps().map((o) => ({ ...o, amount: o.amount * 10 }))];
      const after = BASELINES[id](ctxOf(mutated, { threshold: 0 })).forecastSeries.map((p) => p.balance);
      assert.deepEqual(after, base, `${id}: будущее не влияет на прогноз`);
    }
  });
});

describe('mean90 / weekday / last30', () => {
  it('среднее нетто и повтор паттерна не нулевые на живой истории', () => {
    const ops = makeOps();
    const m90 = mean90Baseline(ctxOf(ops));
    const l30 = last30Baseline(ctxOf(ops));
    const wd = weekdayBaseline(ctxOf(ops));
    for (const r of [m90, l30, wd]) {
      // первый день (i=1) — выходной в данных, поэтому смотрим на всю серию, а не на срез
      const total = r.forecastSeries.at(-1).balance - 1_000_000;
      assert.ok(Math.abs(total) > 0, 'нетто-поток за горизонт не нулевой');
    }
  });
});

describe('holtwinters', () => {
  it('нет истории вовсе — нулевой поток, разрыва нет', () => {
    const r = holtwintersBaseline(ctxOf([]));
    for (const pt of r.forecastSeries) assert.equal(pt.balance, 1_000_000);
    assert.equal(r.gapDate, null);
  });

  it('история короче двух периодов (trainWeeks=1) — деградация до нулевого потока', () => {
    const short = [
      { date: '2026-04-30', amount: 100, direction: 'in' },
      { date: '2026-04-29', amount: 50, direction: 'out' },
    ];
    const r = holtwintersBaseline(ctxOf(short, { config: { holtwintersTrainWeeks: 1 } }));
    for (const pt of r.forecastSeries) assert.equal(pt.balance, 1_000_000);
  });

  it('полная история — тренд/сезонность дают ненулевой сдвиг за 30 дней', () => {
    const r = holtwintersBaseline(ctxOf(makeOps()));
    const last = r.forecastSeries.at(-1).balance;
    assert.ok(Math.abs(last - 1_000_000) > 0, 'прогноз отличается от B0');
  });

  it('параметры берутся из config (ctx.config переопределяет)', () => {
    const ops = makeOps();
    const a = holtwintersBaseline(ctxOf(ops));
    const b = holtwintersBaseline(ctxOf(ops, { config: { holtwintersAlpha: 0.9, holtwintersBeta: 0.5, holtwintersGamma: 0.5 } }));
    assert.notDeepEqual(
      b.forecastSeries.map((p) => p.balance),
      a.forecastSeries.map((p) => p.balance),
      'другие параметры — другой прогноз',
    );
  });
});

describe('точные свойства на искусственных потоках (G22)', () => {
  const P_BY_WD = [-2000, 5000, 5000, 5000, 5000, 5000, -2000]; // getUTCDay 0..6: сб/вс −2k, пн-пт +5k
  const pureWeeklyOps = (weeks) => {
    const ops = [];
    for (let k = weeks * 7; k >= 0; k--) {
      const d = new Date(Date.parse(TODAY) - k * 86_400_000).toISOString().slice(0, 10);
      const f = P_BY_WD[new Date(Date.parse(d)).getUTCDay()];
      ops.push({ date: d, amount: Math.abs(f), direction: f > 0 ? 'in' : 'out' });
    }
    return ops;
  };
  const truthContinuation = (weeks, horizon) => {
    // фактический продолженный недельный шаблон: остатки от B0
    const series = [];
    let b = 0;
    for (let i = 1; i <= horizon; i++) {
      const wd = new Date(Date.parse(TODAY) + i * 86_400_000).getUTCDay();
      b += P_BY_WD[wd];
      series.push(b);
    }
    return series;
  };

  it('mean90: на постоянном дневном нетто-потоке среднее точное', () => {
    const ops = [];
    for (let k = 91; k >= 0; k--) {
      const d = new Date(Date.parse(TODAY) - k * 86_400_000).toISOString().slice(0, 10);
      ops.push({ date: d, amount: 150, direction: 'in' });
      ops.push({ date: d, amount: 50, direction: 'out' });
    }
    const r = mean90Baseline(ctxOf(ops, { currentBalance: 0 }));
    const deltas = r.forecastSeries.map((p, i) => p.balance - (i ? r.forecastSeries[i - 1].balance : 0));
    for (const d of deltas) assert.equal(d, 100);
  });

  it('weekday: нулевая ошибка на точном недельном шаблоне', () => {
    const r = weekdayBaseline(ctxOf(pureWeeklyOps(12), { currentBalance: 0 }));
    const truth = truthContinuation(12, H);
    for (let i = 0; i < H; i++) assert.equal(r.forecastSeries[i].balance, truth[i]);
  });

  it('holtwinters: < 1 % отклонения на чистом недельном шаблоне', () => {
    const r = holtwintersBaseline(ctxOf(pureWeeklyOps(13), { currentBalance: 0 }));
    const truth = truthContinuation(13, H);
    let maxRel = 0;
    for (let i = 0; i < H; i++) {
      const denom = Math.max(Math.abs(truth[i]), 1);
      maxRel = Math.max(maxRel, Math.abs(r.forecastSeries[i].balance - truth[i]) / denom);
    }
    assert.ok(maxRel < 0.01, `отклонение ${maxRel.toFixed(4)} < 1 %`);
  });
});

describe('core / full', () => {
  it('full: вероятность разрыва и полоса; core: без MC', () => {
    const ops = makeOps();
    const full = fullBaseline(ctxOf(ops, { threshold: 100_000 }));
    assert.equal(full.hasProbability, true);
    assert.ok(typeof full.gapProbabilityPct === 'number' && full.gapProbabilityPct >= 0);
    const core = coreBaseline(ctxOf(ops, { threshold: 100_000 }));
    assert.equal(core.hasProbability, false);
    assert.equal(core.gapDate, full.gapDate); // базовый ряд одинаков
    assert.deepEqual(core.forecastSeries.map((p) => p.balance), full.forecastSeries.map((p) => p.balance));
  });
});
