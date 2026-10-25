// server/src/services/forecast.service.js
// Прогноз кассовых разрывов (ТЗ §6): детерминированный расчёт, без БД и LLM.
// Даты — календарные дни UTC; «сегодня» = options.today; прогноз со завтрашнего дня;
// операции с будущими датами (в т. ч. займы) считаются запланированными событиями.
import { FORECAST_CONFIG } from '../config/forecast.config.js';
import { findGaps } from '../utils/dataQuality.js';
// ТЗ-доработка WP-3 п.6: normalizePurpose вынесен в utils/text.js
import { normalizePurpose } from '../utils/text.js';
// ТЗ-доработка WP-4: негативные сценарии «что если» (инертный слой, активен только с options.scenarios)
import { REVENUE_SUBCATS, FIXED_SUBCATS, parseScenarios, buildScenarioPlan, applyScenariosToPlan } from './forecast.scenarios.js';

const DAY_MS = 86_400_000;
const FINANCING_SOURCES = new Set(['self_loan', 'bank_loan']);
const FINANCING_TITLES = {
  self_loan: 'Заём из собственных средств',
  bank_loan: 'Банковский заём'
};

/* ----------------------------- даты и утилиты ----------------------------- */

const round2 = (value) => Math.round(value * 100) / 100;
const toIso = (dayIdx) => new Date(dayIdx * DAY_MS).toISOString().slice(0, 10);
// 1970-01-01 — четверг (4); результат: 0 = воскресенье … 6 = суббота
const weekdayOf = (dayIdx) => (((dayIdx + 4) % 7) + 7) % 7;

function toDayIndex(value) {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / DAY_MS) : null;
}

function resolveToday(today) {
  if (today === undefined || today === null) {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
  }
  const idx = toDayIndex(today);
  if (idx === null) throw new TypeError('options.today: некорректная дата');
  return idx;
}

function civil(dayIdx) {
  const d = new Date(dayIdx * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function shiftMonths(dayIdx, months) {
  const { y, m, d } = civil(dayIdx);
  return Date.UTC(y, m + months, d) / DAY_MS;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeProbability(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n > 1 ? n / 100 : n, 1); // допускаем и 0..1, и 0..100
}

// «Аренда офиса за март 2026» и «аренда офиса за апрель 2026» → один ключ.

/* ------------- усечённое нормальное распределение с сохранением среднего ------------- */

// max(0, N(m, σ)) завышает среднее, когда σ сопоставима со средним (рваные потоки). preserveMean подбирает m' так, чтобы E[max(0, N(m', σ))] = mu.
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const normalPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const truncatedMean = (m, sd) => (sd > 0 ? m * normalCdf(m / sd) + sd * normalPdf(m / sd) : Math.max(0, m));

function preserveMean(mu, sd) {
  if (!(sd > 0) || mu <= 0) return mu;
  let lo = -8 * sd;
  let hi = mu;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (truncatedMean(mid, sd) < mu) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

/* ------------------------- детерминированный генератор ------------------------- */

// mulberry32: небольшой быстрый PRNG, воспроизводимый по seed
function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Нормальное распределение N(0,1), преобразование Бокса — Мюллера
function createNormalSampler(rng) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    while (u === 0) u = rng();
    const v = rng();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}

/* ------------------------------ подготовка данных ------------------------------ */

function normalizeOperations(operations, cfg) {
  const result = [];
  for (const op of operations ?? []) {
    const day = toDayIndex(op?.date);
    const amount = Math.abs(Number(op?.amount));
    if (day === null || !Number.isFinite(amount) || amount === 0) continue;
    if (op.direction !== 'in' && op.direction !== 'out') continue;
    const { y, m, d } = civil(day);
    const sub = op.subcategory ?? null;
    result.push({
      day,
      dom: d,
      monthKey: y * 12 + m,
      amount,
      direction: op.direction,
      inn: op.counterpartyInn ?? '',
      name: op.counterpartyName ?? '',
      purpose: op.purpose ?? '',
      source: op.source ?? '',
      bal: Number(op.balanceEndOfDay ?? op.bal),
      isFinancing: FINANCING_SOURCES.has(op.source),
      // ТЗ-доработка WP-3 §12 p.9: subcategory имеет приоритет, regex — только fallback (subcategory=null)
      // разовые нерабочие поступления (loan_in) — не регулярный доход
      isNonOp: sub ? sub === 'loan_in' : Boolean(cfg.nonOperatingPattern && cfg.nonOperatingPattern.test(op.purpose ?? '')),
      // переводы между своими счетами (own_funds_*) — не доход и не расход, но выводы владельцем моделируются отдельно
      isTransfer: Boolean(cfg.excludeInternalTransfers && (sub ? sub === 'own_funds_in' || sub === 'own_funds_out' : cfg.internalTransferPattern.test(op.purpose ?? ''))),
      // возвраты ошибочных платежей (ТЗ-доработка WP-7 §12): не попадают в регулярную и нерегулярную статистику
      subcategory: sub,
      isRefund: sub === 'refund_in' || sub === 'refund_out',
    });
  }
  return result;
}

// Регулярный платёж: тот же контрагент + назначение, повторяющийся день месяца (±допуск) в 3+ из последних 6 месяцев. Займы не учитываются.
// Улучшения: (1) операции одного ключа за один день суммируются (зарплата по сотрудникам, платёж частями);
// (2) группы с частым ритмом (недельные выплаты маркетплейсов, ежедневная выручка) — это поток, а не месячный платёж;
// (3) нужно покрытие месяцев ≥ regularityMinCoverage между первым и последним платежом; (4) сумма — медиана последних N повторений.
function detectRegularPayments(history, today, cfg) {
  const windowStart = shiftMonths(today, -cfg.regularityWindowMonths);
  const groups = new Map();

  for (const op of history) {
    if (op.isFinancing || op.isTransfer || op.isNonOp || op.isRefund || op.day < windowStart || op.day > today) continue;
    const purposeKey = normalizePurpose(op.purpose);
    if (!op.inn && !purposeKey) continue;
    // ключ без названия контрагента, если ИНН есть: название может писаться по-разному
    const key = [op.direction, op.inn, op.inn ? '' : op.name, purposeKey].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(op);
  }

  const regular = [];
  for (const [key, groupOps] of groups) {
    // (1) схлопываем операции одного дня
    const byDay = new Map();
    for (const op of groupOps) {
      const e = byDay.get(op.day);
      if (e) { e.amount += op.amount; e.parts.push(op); }
      else byDay.set(op.day, { ...op, parts: [op] });
    }
    const dayOps = [...byDay.values()].sort((x, y) => x.day - y.day);
    if (dayOps.length < cfg.regularityMinMonths) continue;

    // (2) частый ритм → поток (медианный интервал между платежами группы)
    if (cfg.regularityMinMedianGapDays) {
      const gaps = [];
      for (let k = 1; k < dayOps.length; k++) gaps.push(dayOps[k].day - dayOps[k - 1].day);
      if (median(gaps) < cfg.regularityMinMedianGapDays) continue;
    }

    for (const ops of clusterByDayOfMonth(dayOps, cfg.regularityToleranceDays)) {
      if (ops.length < cfg.regularityMinMonths) continue;
      const medianDay = median(ops.map((op) => op.dom));
      const matching = ops.filter((op) => Math.abs(op.dom - medianDay) <= cfg.regularityToleranceDays);
      const months = new Set(matching.map((op) => op.monthKey));
      if (months.size < cfg.regularityMinMonths) continue;
      if (matching.length / months.size > cfg.regularityMaxOpsPerMonth) continue;
      // (3) покрытие месяцев между первым и последним платежом
      const minM = Math.min(...months), maxM = Math.max(...months);
      if (cfg.regularityMinCoverage && months.size / (maxM - minM + 1) < cfg.regularityMinCoverage) continue;
      // «Протухший» платёж (контрагент перестал платить) не проецируем в будущее
      const lastDay = matching.reduce((max, op) => Math.max(max, op.day), -Infinity);
      if (cfg.regularityMaxStaleDays != null && today - lastDay > cfg.regularityMaxStaleDays) continue;

      // (4) сумма: медиана последних N повторений (отражает актуальный уровень, а не усреднение за полгода)
      const recent = cfg.regularAmountLastN ? matching.slice(-cfg.regularAmountLastN) : matching;
      const amounts = matching.map((op) => op.amount);
      regular.push({
        key,
        direction: matching[0].direction,
        dayOfMonth: Math.round(medianDay),
        amount: round2(median(recent.map((op) => op.amount))),
        monthsCount: months.size,
        title: matching[0].purpose || matching[0].name || 'Регулярный платёж',
        amounts,
        ops: matching.flatMap((op) => op.parts),
        // ТЗ-доработка WP-4: атрибуция для сценариев (revenue_drop / fixed_costs_growth / client_delay)
        subcategory: matching[0].subcategory ?? null,
        inn: matching[0].inn ?? '',
      });
    }
  }
  return regular;
}

// Жадная кластеризация по дню месяца: в кластер попадают операции в пределах ±tolerance
function clusterByDayOfMonth(ops, tolerance) {
  const sorted = [...ops].sort((a, b) => a.dom - b.dom || a.day - b.day);
  const clusters = [];
  for (const op of sorted) {
    const current = clusters.at(-1);
    if (current && op.dom - current[0].dom <= tolerance * 2) current.push(op);
    else clusters.push([op]);
  }
  return clusters;
}

// Нерегулярная часть: среднее и σ дневных сумм по дню недели за последние 6 месяцев; регулярные платежи и займы исключены.
// Пропуски в выписке (ТЗ-доработка WP-7 §8) исключаются из статистики; суточные суммы винсоризуются квантилем cfg.statsWinsorQuantile.
function calculateWeekdayStats(history, regularOps, today, cfg, gapDaySet = new Set()) {
  const zero = { avgIncome: 0, avgExpense: 0, stdIncome: 0, stdExpense: 0 };
  const base = history.filter((op) => !op.isFinancing && !op.isTransfer && !op.isNonOp && !op.isRefund && op.day <= today);
  if (!base.length) {
    return { byWeekday: Array.from({ length: 7 }, () => ({ ...zero })), avgDailyIncome: 0, windowDays: 0, daily: null, ownerWithdrawals: null };
  }

  const earliest = base.reduce((min, op) => Math.min(min, op.day), Infinity);
  const windowStart = Math.max(shiftMonths(today, -cfg.statsWindowMonths), earliest);
  const windowDays = today - windowStart + 1;
  const incomes = new Float64Array(windowDays);
  const expenses = new Float64Array(windowDays);
  let totalIncome = 0;
  // ТЗ-доработка WP-4: атрибуция для сценариев — revenue-поступления и rent/suppliers списания по дням окна
  const revenueIncomes = new Float64Array(windowDays);
  const rentSupplierExpenses = new Float64Array(windowDays);

  for (const op of base) {
    if (op.day < windowStart) continue;
    if (op.direction === 'in') totalIncome += op.amount;
    if (regularOps.has(op)) continue;
    const idx = op.day - windowStart;
    if (op.direction === 'in') {
      incomes[idx] += op.amount;
      if (REVENUE_SUBCATS.has(op.subcategory)) revenueIncomes[idx] += op.amount;
    } else {
      expenses[idx] += op.amount;
      if (FIXED_SUBCATS.has(op.subcategory)) rentSupplierExpenses[idx] += op.amount;
    }
  }

  // Винсоризация (ТЗ-доработка WP-7 §12): суточная сумма не превышает k-й квантиль ненулевых сумм своего направления
  if (cfg.statsWinsorQuantile != null && cfg.statsWinsorQuantile < 1) {
    const winsorCap = (arr) => {
      const nonzero = Array.from(arr).filter((v) => v > 0).sort((a, b) => a - b);
      if (!nonzero.length) return Infinity;
      return quantile(nonzero, cfg.statsWinsorQuantile);
    };
    const capIn = winsorCap(incomes);
    const capOut = winsorCap(expenses);
    for (let k = 0; k < windowDays; k++) {
      if (incomes[k] > capIn) incomes[k] = capIn;
      if (expenses[k] > capOut) expenses[k] = capOut;
      // подмножества не могут превысить тот же верх (последовательность winsor'а)
      if (revenueIncomes[k] > capIn) revenueIncomes[k] = capIn;
      if (rentSupplierExpenses[k] > capOut) rentSupplierExpenses[k] = capOut;
    }
  }

  const acc = Array.from({ length: 7 }, () => ({ n: 0, sIn: 0, sOut: 0, qIn: 0, qOut: 0, sInR: 0, sOutF: 0 }));
  for (let k = 0; k < windowDays; k++) {
    if (gapDaySet.has(windowStart + k)) continue; // пропущенные дни в статистику не входят
    const a = acc[weekdayOf(windowStart + k)];
    a.n++;
    a.sIn += incomes[k];
    a.sOut += expenses[k];
    a.qIn += incomes[k] * incomes[k];
    a.qOut += expenses[k] * expenses[k];
    a.sInR += revenueIncomes[k];
    a.sOutF += rentSupplierExpenses[k];
  }

  const stdOf = (sum, sumSq, n) => (n > 1 ? Math.sqrt(Math.max(0, (sumSq - (sum * sum) / n) / (n - 1))) : 0);
  const byWeekday = acc.map((a) => ({
    avgIncome: a.n ? a.sIn / a.n : 0,
    avgExpense: a.n ? a.sOut / a.n : 0,
    stdIncome: stdOf(a.sIn, a.qIn, a.n),
    stdExpense: stdOf(a.sOut, a.qOut, a.n),
    // ТЗ-доработка WP-4: revenue-доля притоков и rent/suppliers-доля списаний в среднем по дню недели
    avgRevenueIn: a.n ? a.sInR / a.n : 0,
    avgRentSupplierOut: a.n ? a.sOutF / a.n : 0
  }));

  return {
    byWeekday,
    avgDailyIncome: totalIncome / windowDays,
    windowDays,
    daily: { start: windowStart, incomes, expenses },
    ownerWithdrawals: calculateOwnerWithdrawals(history, windowStart, windowDays, today, cfg, stdOf)
  };
}

// Выводы владельцем (переводы на личные/свои счета) — не операционный поток: владелец выводит излишек выше некоторого уровня, поэтому
// вывод ограничен остатком над «полом» (квантиль исторических остатков). Без остатков в выписке модель отключается.
function calculateOwnerWithdrawals(history, windowStart, windowDays, today, cfg, stdOf) {
  if (!cfg.ownerWithdrawalsEnabled) return null;
  const amounts = new Float64Array(windowDays);
  const eodByDay = new Map();
  let hasWithdrawals = false;
  for (const op of history) {
    if (op.day < windowStart || op.day > today) continue;
    if (op.isTransfer && op.direction === 'out') {
      amounts[op.day - windowStart] += op.amount;
      hasWithdrawals = true;
    }
    if (Number.isFinite(op.bal)) eodByDay.set(op.day, op.bal);
  }
  if (!hasWithdrawals || eodByDay.size < 10) return null;

  const acc = Array.from({ length: 7 }, () => ({ n: 0, s: 0, q: 0 }));
  for (let k = 0; k < windowDays; k++) {
    const a = acc[weekdayOf(windowStart + k)];
    a.n++;
    a.s += amounts[k];
    a.q += amounts[k] * amounts[k];
  }
  const byWeekday = acc.map((a) => ({ avg: a.n ? a.s / a.n : 0, std: stdOf(a.s, a.q, a.n) }));
  const balances = Array.from(eodByDay.values()).sort((x, y) => x - y);
  return { byWeekday, floor: quantile(balances, cfg.ownerWithdrawalsFloorQuantile) };
}

// Будущие операции (в т. ч. займы), события песочницы и плановые события (ТЗ-доп. §4.3), разложенные по дням горизонта.
function collectScheduledEvents(normalized, extraEvents, today, horizon, plannedEvents, cfg) {
  const byDay = Array.from({ length: horizon }, () => []);

  for (const op of normalized) {
    const i = op.day - today - 1;
    if (i < 0 || i >= horizon) continue;
    byDay[i].push({
      kind: op.isFinancing ? 'financing' : 'scheduled',
      direction: op.direction,
      amount: op.amount,
      title: op.isFinancing ? FINANCING_TITLES[op.source] : op.purpose || op.name || 'Запланированная операция',
      // ТЗ-доработка WP-4: атрибуция для сценариев (revenue_drop / fixed_costs_growth / client_delay)
      subcategory: op.subcategory ?? null,
      inn: op.isFinancing ? '' : op.inn ?? ''
    });
  }

  for (const ev of extraEvents ?? []) {
    const day = toDayIndex(ev?.date);
    const amount = Math.abs(Number(ev?.amount));
    if (day === null || !Number.isFinite(amount) || amount === 0) continue;
    if (ev.direction !== 'in' && ev.direction !== 'out') continue;
    const i = day - today - 1;
    if (i < 0 || i >= horizon) continue;
    byDay[i].push({
      kind: 'scenario',
      direction: ev.direction,
      amount,
      title: ev.title || ev.name || 'Сценарий',
      // ТЗ-доработка WP-4: атрибуция для сценариев
      subcategory: ev.subcategory ?? null,
      inn: ev.inn ?? ev.counterpartyInn ?? ''
    });
  }

  // Плановые события: только активные и неоплаченные; просроченные переносим на today + N (ТЗ-доп. §4.1 Б)
  const plannedInEvents = [];
  for (const ev of plannedEvents ?? []) {
    if (!ev || ev.active === false || ev.status === 'paid') continue;
    let day = toDayIndex(ev.expectedDate);
    if (day === null) continue;
    if (ev.status === 'overdue') day = today + cfg.plannedOverdueShiftDays;
    let amount = Math.abs(Number(ev.amount));
    if (!Number.isFinite(amount) || amount === 0) continue;
    // ТЗ-доработка WP-5: частично оплаченные события учитываются в прогнозе на остаток (amount − paidAmount)
    if (ev.status === 'partial') {
      amount = Math.max(0, amount - Math.abs(Number(ev.paidAmount) || 0));
      if (amount === 0) continue; // полностью покрыт фактом — не учитывается
    }
    const direction = ev.direction === 'in' ? 'in' : 'out';
    if (direction === 'in') {
      plannedInEvents.push({
        day,
        amount,
        delayProb: ev.counterpartyRisk === 'high' ? cfg.plannedDelayProbHigh
          : ev.counterpartyRisk === 'medium' ? cfg.plannedDelayProbMedium : 0,
        // ТЗ-доработка WP-4: контрагент планового поступления (client_delay)
        inn: ev.counterpartyInn ?? ''
      });
    }
    const i = day - today - 1;
    if (i < 0 || i >= horizon) continue;
    byDay[i].push({
      kind: 'planned',
      direction,
      amount,
      title: ev.title || 'Запланированный платёж',
      // ТЗ-доработка WP-4: атрибуция для сценариев
      subcategory: ev.subcategory ?? null,
      inn: ev.counterpartyInn ?? ''
    });
  }
  return { byDay, plannedInEvents };
}

// Активные риски: сумма на весь период равномерно распределяется по дням и умножается на вероятность.
function buildRiskPlans(risks, today, horizon) {
  const plans = [];
  for (const risk of risks ?? []) {
    if (!risk || risk.active === false) continue;
    const from = toDayIndex(risk.dateFrom);
    if (from === null) continue;
    let to = toDayIndex(risk.dateTo);
    if (to === null || to < from) to = from;

    const amount = Math.abs(Number(risk.amount));
    const probability = normalizeProbability(risk.probability);
    if (!Number.isFinite(amount) || amount === 0 || probability === 0) continue;

    const startI = Math.max(from - today - 1, 0);
    const endI = Math.min(to - today - 1, horizon - 1);
    if (endI < startI) continue;

    plans.push({
      title: risk.title || 'Риск',
      type: risk.type,
      probability,
      dailyAmount: amount / (to - from + 1),
      startI,
      endI
    });
  }
  return plans;
}

// Банк проводит платёж с выходного в ближайший рабочий день (в выписках операций в сб/вс практически нет)
function isRegularPaymentDay(pay, dayIdx, d, dim, cfg) {
  if (!cfg.regularShiftFromWeekends) return d === Math.min(pay.dayOfMonth, dim);
  for (let back = 0; back <= 2; back++) {
    const c = dayIdx - back;
    const cv = civil(c);
    if (cv.d !== Math.min(pay.dayOfMonth, daysInMonth(cv.y, cv.m))) continue;
    const wd = weekdayOf(c);
    const effective = wd === 6 ? c + 2 : wd === 0 ? c + 1 : c;
    if (effective === dayIdx) return true;
  }
  return false;
}

function buildDailyPlan({ today, horizon, regular, scheduled, cfg }) {
  const days = [];
  for (let i = 0; i < horizon; i++) {
    const dayIdx = today + 1 + i;
    const { y, m, d } = civil(dayIdx);
    const dim = daysInMonth(y, m);
    const day = {
      date: toIso(dayIdx),
      weekday: weekdayOf(dayIdx),
      regularIn: 0,
      regularOut: 0,
      scheduledIn: 0,
      scheduledOut: 0,
      operatingIn: 0, // доход без займов — для «хороших» дней
      regularEvents: [], // для Монте-Карло: сумма берётся из реальных повторений платежа
      reasons: [],
      // ТЗ-доработка WP-4: атрибуция для сценариев (не выходит в отчёт без сценариев)
      regularInRevenue: 0,
      regularOutFixed: 0,
      scheduledInRevenue: 0,
      scheduledOutFixed: 0,
      inflowsByInn: null
    };
    const inflowsByInn = {};

    // Регулярный платёж срабатывает один раз в месяц; 31-е в коротком месяце → последний день
    for (const pay of regular) {
      if (!isRegularPaymentDay(pay, dayIdx, d, dim, cfg)) continue;
      const signed = pay.direction === 'in' ? pay.amount : -pay.amount;
      if (pay.direction === 'in') {
        day.regularIn += pay.amount;
        day.operatingIn += pay.amount;
        if (REVENUE_SUBCATS.has(pay.subcategory)) day.regularInRevenue += pay.amount;
        if (pay.inn && pay.inn !== 'SELF') inflowsByInn[pay.inn] = (inflowsByInn[pay.inn] ?? 0) + pay.amount;
      } else {
        day.regularOut += pay.amount;
        if (FIXED_SUBCATS.has(pay.subcategory)) day.regularOutFixed += pay.amount;
      }
      day.reasons.push({ type: 'regular', title: pay.title, amount: signed });
      day.regularEvents.push({ sign: pay.direction === 'in' ? 1 : -1, amounts: pay.amounts });
    }

    for (const ev of scheduled[i]) {
      if (ev.direction === 'in') {
        day.scheduledIn += ev.amount;
        if (ev.kind !== 'financing') day.operatingIn += ev.amount;
        if (REVENUE_SUBCATS.has(ev.subcategory)) day.scheduledInRevenue += ev.amount;
        if (ev.inn && ev.inn !== 'SELF') inflowsByInn[ev.inn] = (inflowsByInn[ev.inn] ?? 0) + ev.amount;
      } else {
        day.scheduledOut += ev.amount;
        if (FIXED_SUBCATS.has(ev.subcategory)) day.scheduledOutFixed += ev.amount;
      }
      day.reasons.push({
        type: ev.kind,
        title: ev.title,
        amount: round2(ev.direction === 'in' ? ev.amount : -ev.amount)
      });
    }
    if (Object.keys(inflowsByInn).length) day.inflowsByInn = inflowsByInn;
    days.push(day);
  }
  return days;
}

/* ------------------------------- Монте-Карло ------------------------------- */

// Монте-Карло (ТЗ §6.3): доля прогонов, где остаток ниже T. Нерегулярная часть — блочный bootstrap реальных дней того же дня недели
// (сохраняет среднее, перекос и связь «приход/расход»); при короткой истории — усечённое нормальное с сохранением среднего.
// Риски реализуются целиком со своей вероятностью; выводы владельцем ограничены остатком над «полом».
function simulateGapProbability({ days, stats, riskPlans, plannedInEvents = [], currentBalance, threshold, runs, seed, cfg, gapDaySet = new Set(), scenarioPlan = null }) {
  const rng = createRng(seed);
  const normal = createNormalSampler(rng);
  const horizon = days.length;
  const schedNet = days.map((d) => d.scheduledIn - d.scheduledOut);
  // Задержки входящих плановых платежей (ТЗ-доп. §4.3): в прогоне с вероятностью delayProb деньги поступают не на дату,
  // а на дату + N дней (high-контрагент не успевает к списанию ЕНП на 28-е → разрыв фиксируется)
  const firstDayIdx = days.length ? toDayIndex(days[0].date) : 0;
  const delayEvents = plannedInEvents
    .filter((e) => e.delayProb > 0 && e.day >= firstDayIdx && e.day < firstDayIdx + horizon)
    .map((e) => ({ i: e.day - firstDayIdx, amount: e.amount, p: e.delayProb, laterI: e.day + cfg.plannedDelayDays - firstDayIdx }));
  const paths = new Float64Array(runs * horizon);
  const realized = new Array(riskPlans.length).fill(false);
  const shortfalls = new Float64Array(runs);
  const dangerCounts = new Float64Array(horizon); // в день i остаток ниже T
  const breachedCounts = new Float64Array(horizon); // к дню i порог уже пробит (накопленно)
  const owner = stats.ownerWithdrawals;

  const blockLen = cfg.mcBootstrapBlockDays;
  const daily = stats.daily;
  const useBootstrap = cfg.mcMode === 'bootstrap' && daily && daily.incomes.length >= cfg.mcBootstrapMinDays;
  const starts = Array.from({ length: 7 }, () => []); // допустимые начала блоков по дню недели
  if (useBootstrap) {
    for (let k = 0; k + blockLen <= daily.incomes.length; k++) {
      // ТЗ-доработка WP-7 §8: блок не может начинаться или пересекать пропущенный день
      let blocked = false;
      for (let j = 0; j < blockLen; j++) {
        if (gapDaySet.has(daily.start + k + j)) { blocked = true; break; }
      }
      if (!blocked) starts[weekdayOf(daily.start + k)].push(k);
    }
  }
  const normalMu = stats.byWeekday.map((st) => ({
    income: preserveMean(st.avgIncome, st.stdIncome),
    expense: preserveMean(st.avgExpense, st.stdExpense)
  }));
  const ownerMu = owner ? owner.byWeekday.map((w) => preserveMean(w.avg, w.std)) : null;

  let gaps = 0;
  for (let r = 0; r < runs; r++) {
    for (let k = 0; k < riskPlans.length; k++) realized[k] = rng() < riskPlans[k].probability;

    let balance = currentBalance;
    let minBalance = Infinity;
    let blockStart = 0;
    let breached = false;
    // на прогон: какие входящие плановые платежи задерживаются (решение в начале, чтобы rng-поток был стабильным)
    const delayed = delayEvents.map((e) => rng() < e.p);
    for (let i = 0; i < horizon; i++) {
      const wd = days[i].weekday;
      let income;
      let expense;
      const candidates = useBootstrap ? starts[wd] : null;
      if (candidates && candidates.length) {
        if (i % blockLen === 0) blockStart = candidates[Math.floor(rng() * candidates.length)];
        const j = Math.min(daily.incomes.length - 1, blockStart + (i % blockLen));
        income = daily.incomes[j];
        expense = daily.expenses[j];
      } else {
        const st = stats.byWeekday[wd];
        income = Math.max(0, normalMu[wd].income + st.stdIncome * normal());
        expense = Math.max(0, normalMu[wd].expense + st.stdExpense * normal());
      }

      let loss = 0;
      for (let k = 0; k < riskPlans.length; k++) {
        const plan = riskPlans[k];
        if (realized[k] && i >= plan.startI && i <= plan.endI) loss += plan.dailyAmount;
      }

      let regNet = 0;
      for (const ev of days[i].regularEvents) {
        // сумма регулярного платежа — случайное из реальных повторений (учёт разброса, напр. ЕНП)
        const amt = cfg.mcResampleRegularAmounts && ev.amounts?.length > 1 ? ev.amounts[Math.floor(rng() * ev.amounts.length)] : ev.amounts[ev.amounts.length - 1];
        regNet += ev.sign * amt;
      }

      // корректировка на задержанные/поступившие позже плановые входящие
      let plannedAdjust = 0;
      for (let k = 0; k < delayEvents.length; k++) {
        const e = delayEvents[k];
        if (delayed[k]) {
          if (i === e.i) plannedAdjust -= e.amount; // на дату не поступили
          if (i === e.laterI && e.laterI < horizon) plannedAdjust += e.amount; // поступили с задержкой
        }
      }

      // ТЗ-доработка WP-4: ожидаемые (deterministic) корректировки сценариев
      const scAdjIn = scenarioPlan ? scenarioPlan.adjIncome[i] : 0;
      const scAdjOut = scenarioPlan ? scenarioPlan.adjExpense[i] : 0;

      balance += income - expense + scAdjIn - scAdjOut + schedNet[i] + regNet - loss + plannedAdjust;
      if (owner) {
        const w = owner.byWeekday[wd];
        const draw = Math.max(0, ownerMu[wd] + w.std * normal());
        balance -= Math.min(draw, Math.max(0, balance - owner.floor));
      }
      paths[r * horizon + i] = balance;
      if (balance < minBalance) minBalance = balance;
      if (balance < threshold) {
        dangerCounts[i]++;
        breached = true;
      }
      if (breached) breachedCounts[i]++;
    }

    if (minBalance < threshold) gaps++;
    shortfalls[r] = Math.max(0, threshold - minBalance);
  }

  const sorted = Array.from(shortfalls).sort((a, b) => a - b);
  const band = { low: [], mid: [], high: [] };
  const col = new Float64Array(runs);
  for (let i = 0; i < horizon; i++) {
    for (let r = 0; r < runs; r++) col[r] = paths[r * horizon + i];
    const sc = Array.from(col).sort((a, b) => a - b);
    band.low.push(quantile(sc, cfg.bandLowQuantile));
    band.mid.push(quantile(sc, 0.5));
    band.high.push(quantile(sc, cfg.bandHighQuantile));
  }
  return {
    band,
    probabilityPct: (gaps / runs) * 100,
    medianShortfall: median(shortfalls),
    p90Shortfall: quantile(sorted, 0.9),
    dangerProbabilityByDay: Array.from(dangerCounts, (c) => (c / runs) * 100),
    cumulativeGapProbabilityByDay: Array.from(breachedCounts, (c) => (c / runs) * 100)
  };
}

/* ------------------------- перекалибровка вероятности разрыва (аудит §2.1) ------------------------- */

// Детерминированная перекалибровка gapProbabilityPct по бинам калибровки из бэктеста
// (docs/backtest-results.json → gaps.P25.calibration; запуск на C001: 39 точек, 1 факт-разрыв).
// Пороги P0/P5/P10 в бэктесте дали 0 факт-разрывов → дегенеративная карта «всё 0»;
// P25 — единственный порог с факт-разрывами, поэтому карта построена на его бинах.
// Изотоническая сетка (PAV): все бины складываются в константу 1/39 ≈ 0,026 — сырая модель
// систематически завышала вероятность (бины 25–97 % при факт. частоте 0,00). Без новых
// зависимостей: фиксированная таблица. Пересчёт карты на датасете организаторов (150 компаний)
// — план развития (docs/MODEL_COMPARISON.md, «Ограничения»).
// [верхняя граница бина, п.п.] → [калиброванная вероятность, п.п.]
const GAP_PROB_CALIBRATION = [[100, 2.6]];

// Кусочно-постоянный просмотр по сетке: rawPct (0..100) → калиброванная вероятность (п.п.)
function calibrateGapProbabilityPct(rawPct) {
  if (rawPct <= 0) return 0; // ни один прогон не пробил порог — не выдумываем предупреждение
  for (const [upperPct, calibratedPct] of GAP_PROB_CALIBRATION) {
    if (rawPct <= upperPct) return calibratedPct;
  }
  return GAP_PROB_CALIBRATION.at(-1)[1];
}

/* ---------------------------------- API ---------------------------------- */

/**
 * Прогноз кассовых разрывов.
 * @param operations история/будущие операции; risks — риски; currentBalance — остаток на сегодня;
 *        horizonDays — горизонт; minThreshold — порог T.
 * @param options today (тесты), extraEvents (песочница), goodDayThreshold, seed, config.
 */
export function calculateForecast(
  operations,
  risks = [],
  currentBalance,
  horizonDays = FORECAST_CONFIG.defaultHorizonDays,
  minThreshold = FORECAST_CONFIG.minThresholdDefault,
  options = {}
) {
  const cfg = { ...FORECAST_CONFIG, ...(options.config ?? {}) };
  if (!Number.isFinite(currentBalance)) throw new TypeError('currentBalance должен быть числом');
  const horizon = Math.trunc(Number(horizonDays));
  if (!(horizon >= 1 && horizon <= cfg.maxHorizonDays)) {
    throw new RangeError(`horizonDays должен быть от 1 до ${cfg.maxHorizonDays}`);
  }
  const threshold = Number.isFinite(minThreshold) ? minThreshold : cfg.minThresholdDefault;

  const today = resolveToday(options.today);
  const normalized = normalizeOperations(operations, cfg);
  let history = normalized.filter((op) => op.day <= today);

  // Дедупликация налогов (ТЗ-доп. §4.3): если активны события tax из налогового календаря,
  // исторические операции category === "tax" исключаются — налог учтён по точному расчёту, а не дважды
  const plannedEvents = (options.plannedEvents ?? []).filter((e) => e && e.active !== false && e.status !== 'paid');
  if (plannedEvents.some((e) => e.type === 'tax')) {
    history = history.filter((op) => op.category !== 'tax');
  }

  // 1–2. Регулярная и нерегулярная части
  // Пропуски в выписке (ТЗ-доработка WP-7 §8): дни с «прыжком» остатка исключаются из статистики и bootstrap-блоков
  const { gapDaySet } = cfg.gapDetection === false ? { gapDaySet: new Set() } : findGaps(history);
  const regular = detectRegularPayments(history, today, cfg);
  const regularOps = new Set(regular.flatMap((payment) => payment.ops));
  const stats = calculateWeekdayStats(history, regularOps, today, cfg, gapDaySet);

  // 3. План по дням: регулярные платежи, будущие операции, риски, плановые события
  const { byDay: scheduled, plannedInEvents } = collectScheduledEvents(normalized, options.extraEvents, today, horizon, plannedEvents, cfg);
  const riskPlans = buildRiskPlans(risks, today, horizon);
  const days = buildDailyPlan({ today, horizon, regular, scheduled, cfg });

  const goodDayThreshold = Number.isFinite(options.goodDayThreshold)
    ? options.goodDayThreshold
    : stats.avgDailyIncome * cfg.goodDayMultiplier;

  // ТЗ-доработка WP-4: негативные сценарии «что если» — инертный слой, активен только при options.scenarios.
  // Без сценариев (и со «нулевыми») результат побитово совпадает с прогнозом без hook.
  let scenarios;
  let scenarioPlan = null;
  let scenarioNoOp = false;
  if (Array.isArray(options.scenarios) && options.scenarios.length > 0) {
    const parsed = parseScenarios(options.scenarios);
    if (!parsed.ok) {
      const err = new Error(parsed.error);
      err.httpStatus = 400;
      err.code = 'VALIDATION';
      throw err;
    }
    scenarios = parsed.scenarios;
    let clientShareByInn = new Map();
    if (scenarios.some((s) => s.type === 'client_delay')) {
      clientShareByInn = computeClientInflowShares(history, today, cfg);
    }
    scenarioPlan = applyScenariosToPlan(
      buildScenarioPlan({ days, stats, clientShareByInn }),
      scenarios,
      today,
      horizon
    );
    // Нулевой сценарий (никаких действующих корректировок) — побитово база: без атрибутации
    scenarioNoOp =
      Array.from(scenarioPlan.adjIncome).every((v) => v === 0) &&
      Array.from(scenarioPlan.adjExpense).every((v) => v === 0);
  }
  const attachScenarioAttribution = Boolean(scenarioPlan) && !scenarioNoOp;

  // Вероятность разрыва и полосы неопределённости (считаются до сборки ряда, чтобы вписать p10/p90 в каждую точку).
  // ТЗ-доработка WP-7 §9: при истории ≤ 14 дней MC не запускать (mcDisabled от контроллера).
  const mcDisabled = Boolean(options.mcDisabled);
  const monteCarlo = mcDisabled
    ? { probabilityPct: 0, medianShortfall: 0, p90Shortfall: 0, dangerProbabilityByDay: null, cumulativeGapProbabilityByDay: null, band: null }
    : simulateGapProbability({
        days,
        stats,
        riskPlans,
        plannedInEvents,
        currentBalance,
        threshold,
        runs: cfg.monteCarloSimulations,
        seed: Number.isFinite(options.seed) ? options.seed : cfg.monteCarloSeed,
        cfg,
        gapDaySet,
        // ТЗ-доработка WP-4: ожидаемые корректировки сценариев учитываются и в Монте-Карло
        scenarioPlan
      });

  const monteCarloBand = monteCarlo.band;

  // 4. Базовый прогноз: B(d) = B(d−1) + Δ(d)
  const forecastSeries = [];
  const gapDays = [];
  const goodDays = [];
  let balance = currentBalance;
  let minBalance = Infinity;
  let gapDate = null;

  days.forEach((day, i) => {
    const st = stats.byWeekday[day.weekday];
    // ТЗ-доработка WP-4: корректировки сценариев (0 без сценариев — базовый ряд не меняется)
    const scIn = scenarioPlan ? scenarioPlan.adjIncome[i] : 0;
    const scOut = scenarioPlan ? scenarioPlan.adjExpense[i] : 0;
    const income = st.avgIncome + day.regularIn + day.scheduledIn + scIn;
    const expense = st.avgExpense + day.regularOut + day.scheduledOut + scOut;

    let riskLoss = 0;
    const reasons = [...day.reasons];
    for (const plan of riskPlans) {
      if (i < plan.startI || i > plan.endI) continue;
      const expected = plan.dailyAmount * plan.probability;
      riskLoss += expected;
      reasons.push({ type: 'risk', title: plan.title, amount: -round2(expected) });
    }

    let delta = income - expense - riskLoss;
    let ownerWithdrawal = 0;
    if (stats.ownerWithdrawals) {
      ownerWithdrawal = Math.min(stats.ownerWithdrawals.byWeekday[day.weekday].avg, Math.max(0, balance + delta - stats.ownerWithdrawals.floor));
      if (ownerWithdrawal > 0) reasons.push({ type: 'owner_withdrawal', title: 'Ожидаемый вывод средств владельцем', amount: -round2(ownerWithdrawal) });
      delta -= ownerWithdrawal;
    }
    balance += delta;
    if (balance < minBalance) minBalance = balance;

    const isDanger = balance < threshold;
    if (isDanger) {
      gapDays.push(day.date);
      if (gapDate === null) gapDate = day.date;
    } else if (st.avgIncome + day.operatingIn >= goodDayThreshold && goodDayThreshold > 0) {
      goodDays.push(day.date);
    }

    forecastSeries.push({
      date: day.date,
      balance: round2(balance),
      income: round2(income),
      expense: round2(expense),
      riskLoss: round2(riskLoss),
      ownerWithdrawal: round2(ownerWithdrawal),
      delta: round2(delta),
      balanceLow: monteCarloBand ? round2(monteCarloBand.low[i]) : null,
      balanceMedian: monteCarloBand ? round2(monteCarloBand.mid[i]) : null,
      balanceHigh: monteCarloBand ? round2(monteCarloBand.high[i]) : null,
      isDanger,
      reasons,
      // ТЗ-доработка WP-4: атрибуция для сценариев (только для действующих сценариев; нулевой — побитово база)
      ...(attachScenarioAttribution
        ? {
            scenarioAttribution: {
              revenueIn: round2(scenarioPlan.revenueIn[i]),
              fixedOut: round2(scenarioPlan.fixedOut[i]),
              scenRevenueIn: round2(scenarioPlan.scenRevenueIn[i]),
              scenFixedOut: round2(scenarioPlan.scenFixedOut[i]),
              inflowsByInn: scenarioPlan.inflowsByInn[i],
              scenInflowsByInn: scenarioPlan.scenInflowsByInn[i]
            }
          }
        : {})
    });
  });

  // Дни с наибольшим отрицательным изменением остатка (для календаря, ТЗ §5.11)
  const outflowPeakDays = forecastSeries
    .map((point, i) => ({ date: point.date, delta: point.delta, i }))
    .filter((point) => point.delta < 0)
    .sort((a, b) => a.delta - b.delta || a.i - b.i)
    .slice(0, cfg.outflowPeakDaysCount)
    .map((point) => point.date)
    .sort();

  // Дата, к которой разрыв становится вероятным: накопленная вероятность пробоя порога монотонна и заканчивается на gapProbabilityPct, поэтому
  // дата есть ровно тогда, когда gapProbabilityPct ≥ порога (в отличие от gapDate, считаемого по среднему пути)
  const probableIdx = monteCarlo.cumulativeGapProbabilityByDay
    ? monteCarlo.cumulativeGapProbabilityByDay.findIndex((p) => p >= cfg.probableGapThresholdPct)
    : -1;
  const probableGapDate = probableIdx >= 0 ? forecastSeries[probableIdx].date : null;

  const historyDays = normalized.length ? today - normalized.reduce((m, op) => Math.min(m, op.day), Infinity) + 1 : 0;
  // Последняя операция ≤ today по всей выписке (не после дедупликации налогов): устарелость — свойство данных, а не фильтров
  const lastOpDay = normalized.length ? normalized.reduce((m, op) => (op.day <= today ? Math.max(m, op.day) : m), -Infinity) : null;
  const dataQuality = assessDataQuality(historyDays, stats, cfg, lastOpDay, today);

  // ТЗ-доработка WP-7 §11: остаток на опорную дату уже ниже порога T — разрыв считается «сейчас»:
  // gapDate = asOf, gapAmount = T − остаток на начало прогноза.
  const alreadyBelowThreshold = currentBalance < threshold;
  if (alreadyBelowThreshold) {
    gapDate = toIso(today);
  }

  // gapAmount — сколько внести в день разрыва, чтобы закрыть разрыв на базовом прогнозе; медиана по прогонам — gapAmountMedian.
  const gapAmount = alreadyBelowThreshold
    ? Math.max(0, threshold - currentBalance)
    : gapDate ? Math.max(0, threshold - minBalance) : 0;

  return {
    gapDate,
    alreadyBelowThreshold,
    // Аудит §2.1: headline-вероятность — перекалиброванная (см. calibrateGapProbabilityPct);
    // подневные серии dangerProbabilityByDay/cumulativeGapProbabilityByDay остаются сырыми —
    // калибровка оценена для сводной вероятности горизонта (см. MODEL_COMPARISON.md)
    gapProbabilityPct: mcDisabled ? null : calibrateGapProbabilityPct(monteCarlo.probabilityPct),
    gapAmount: round2(gapAmount),
    gapAmountMedian: mcDisabled ? null : round2(monteCarlo.medianShortfall),
    gapAmountP90: mcDisabled ? null : round2(monteCarlo.p90Shortfall),
    probableGapDate,
    dangerProbabilityByDay: monteCarlo.dangerProbabilityByDay ? monteCarlo.dangerProbabilityByDay.map((p) => Math.round(p * 10) / 10) : null,
    cumulativeGapProbabilityByDay: monteCarlo.cumulativeGapProbabilityByDay ? monteCarlo.cumulativeGapProbabilityByDay.map((p) => Math.round(p * 10) / 10) : null,
    dataQuality,
    minForecastBalance: round2(minBalance),
    forecastSeries,
    dangerDays: gapDays,
    outflowPeakDays,
    goodDays,
    goodDayThreshold: round2(goodDayThreshold),
    regularPayments: regular.map(({ ops, key, ...payment }) => payment)
  };
}

function assessDataQuality(historyDays, stats, cfg, lastOpDay = null, today = 0) {
  const warnings = [];
  let level = 'high';
  // ТЗ-доработка WP-7 §1/§10: история < 14 дней (включая пустую выписку) — insufficient.
  if (historyDays < 14) {
    level = 'insufficient';
    warnings.push('Данных недостаточно для прогноза (история короче 14 дней)');
  } else {
    // Аудит §3.7: выписка устарела — последняя операция далеко до опорной даты (today >> последней операции).
    // Без предупреждения ядро возвращало бы уровень «high» и вероятность «0» без объяснения, на каких данных прогноз построен.
    const staleDays = lastOpDay == null ? null : today - lastOpDay;
    if (staleDays != null && staleDays > cfg.staleHistoryDays) {
      level = 'stale';
      warnings.push(`Выписка устарела: последняя операция ${staleDays} дн. до опорной даты (более ${cfg.staleHistoryDays} дн.) — прогноз построен на устаревших данных`);
    } else if (historyDays < cfg.minHistoryDaysLow) {
      level = 'low';
      warnings.push(`История короче ${cfg.minHistoryDaysLow} дней — прогноз ориентировочный`);
    } else if (historyDays < cfg.minHistoryDaysMedium) {
      level = 'medium';
      warnings.push('История короче 6 месяцев — сезонность и регулярность оцениваются неточно');
    }
  }
  if (stats.ownerWithdrawals) warnings.push('Учтены регулярные выводы средств владельцем (не выше остатка над минимальным уровнем)');
  return { historyDays, level, warnings };
}

// ТЗ-доработка WP-4: доли контрагентов в поступлениях за последние N месяцев (6) — для client_delay
// (доля нерегулярных поступлений конкретного клиента). Используются только сценариями и GET /scenarios/clients.
export function computeClientInflowShares(history, today, cfg) {
  const winStart = shiftMonths(today, -(cfg.scenarioClientShareMonths ?? 6));
  let total = 0;
  const byInn = new Map();
  for (const op of history) {
    if (op.day < winStart || op.day > today) continue;
    if (op.direction !== 'in' || op.isFinancing || op.isTransfer) continue;
    if (!op.inn || op.inn === 'SELF') continue;
    total += op.amount;
    byInn.set(op.inn, (byInn.get(op.inn) ?? 0) + op.amount);
  }
  const shares = new Map();
  if (total > 0) for (const [inn, amt] of byInn) shares.set(inn, amt / total);
  return shares;
}

// События песочницы (ТЗ §5.9): разовый платёж или ежемесячная серия из `repeats`; передаются через options.extraEvents.
export function buildScenarioEvents({ name = 'Сценарий', amount, date, repeats = 1, direction = 'out' }) {
  const start = toDayIndex(date);
  if (start === null) throw new TypeError('date: некорректная дата сценария');
  const { y, m, d } = civil(start);
  const count = Math.max(1, Math.trunc(Number(repeats)) || 1);

  return Array.from({ length: count }, (_, i) => {
    const day = Date.UTC(y, m + i, Math.min(d, daysInMonth(y, m + i))) / DAY_MS;
    return { date: toIso(day), amount: Math.abs(Number(amount)), direction, title: name };
  });
}