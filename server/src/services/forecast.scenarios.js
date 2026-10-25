// server/src/services/forecast.scenarios.js — ТЗ-доработка WP-4: негативные сценарии «что если».
// Чистая математика: парсинг сценариев и по-дневные корректировки ожидаемых потоков.
// Применяется ТОЛЬКО внутри calculateForecast, когда передан options.scenarios (иначе слой инертен —
// базовый ряд побитово не меняется). Подмена фиктивными операциями не используется: сценарии
// корректируют ожидаемые поступления/списания базовой линии и Монте-Карло.

export const REVENUE_SUBCATS = new Set(['revenue_clients', 'revenue_acquiring', 'revenue_marketplace']);
export const FIXED_SUBCATS = new Set(['rent', 'suppliers']);
export const SCENARIO_TYPES = ['client_delay', 'revenue_drop', 'unplanned_expense', 'fixed_costs_growth'];

/**
 * Нормализация и валидация списка сценариев (1..4, разные типы).
 * @returns {{ ok: true, scenarios: Array } | { ok: false, error: string }}
 */
export function parseScenarios(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) {
    return { ok: false, error: 'scenarios: массив из 1–4 сценариев' };
  }
  const seen = new Set();
  const scenarios = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return { ok: false, error: 'scenarios: элемент должен быть объектом { type, params }' };
    const t = s.type;
    if (!SCENARIO_TYPES.includes(t)) return { ok: false, error: `неизвестный type сценария: ${t}` };
    if (seen.has(t)) return { ok: false, error: `повторяющийся тип сценария: ${t}` };
    seen.add(t);
    const p = s.params ?? {};
    const norm = { type: t };
    if (t === 'client_delay') {
      if (typeof p.inn !== 'string' || !p.inn) return { ok: false, error: 'client_delay: нужен inn (ключ из GET /scenarios/clients)' };
      const days = Number(p.days);
      if (!Number.isInteger(days) || days < 14 || days > 28) return { ok: false, error: 'client_delay: days — целое 14..28' };
      norm.inn = p.inn;
      norm.days = days;
    } else if (t === 'revenue_drop') {
      const percent = p.percent == null ? 0 : Number(p.percent);
      if (!Number.isInteger(percent) || percent < 0 || percent > 30) return { ok: false, error: 'revenue_drop: percent — целое 0..30 (0 = нулевой сценарий)' };
      norm.percent = percent;
      norm.fromDate = p.fromDate ?? null; // null = завтра (первый день горизонта)
      norm.durationDays = p.durationDays == null ? null : Number(p.durationDays); // null = до конца горизонта
    } else if (t === 'unplanned_expense') {
      // «amount не задаётся» — нулевой сценарий (влияния нет)
      if (p.amount != null) {
        const amount = Number(p.amount);
        if (!(amount > 0)) return { ok: false, error: 'unplanned_expense: amount > 0' };
        norm.amount = amount;
      }
      if (p.date != null) {
        const d = p.date;
        if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: 'unplanned_expense: date — ISO-дата (YYYY-MM-DD)' };
        norm.date = d;
      }
    } else if (t === 'fixed_costs_growth') {
      const percent = p.percent == null ? 0 : Number(p.percent);
      if (!Number.isInteger(percent) || percent < 0 || percent > 50) return { ok: false, error: 'fixed_costs_growth: percent — целое 0..50 (0 = нулевой сценарий)' };
      norm.percent = percent;
      norm.fromDate = p.fromDate ?? null; // null = завтра
    }
    scenarios.push(norm);
  }
  return { ok: true, scenarios };
}

/** Индекс дня горизонта (0-based) для ISO-даты при опорной todayIdx. */
function dayIndexOf(isoDate, todayIdx) {
  if (isoDate == null) return 0; // завтра = первый день горизонта
  const ms = Date.parse(isoDate);
  if (!Number.isFinite(ms)) return 0;
  const dayIdx = Math.floor(ms / 86_400_000);
  return Math.max(0, dayIdx - todayIdx - 1);
}

/**
 * По-дневные корректировки ожидаемых потоков для списка сценариев.
 * @param ctx { days, stats, clientShareByInn: Map<inn, share 0..1> }
 *   days[i] содержит (при сборке в buildDailyPlan) поля:
 *     regularInRevenue, scheduledInRevenue, regularOutFixed, scheduledOutFixed, inflowsByInn (объект inn→сумма)
 * @returns {{ adjIncome: Float64Array, adjExpense: Float64Array,
 *             revenueIn: Float64Array, fixedOut: Float64Array, inflowsByInn: Array<Object> }}
 */
export function buildScenarioPlan({ days, stats, clientShareByInn = new Map() }) {
  const horizon = days.length;
  const adjIncome = new Float64Array(horizon);
  const adjExpense = new Float64Array(horizon);
  const revenueIn = new Float64Array(horizon); // ожидаемые revenue-поступления дня (до корректировки)
  const fixedOut = new Float64Array(horizon); // ожидаемые rent/suppliers списания дня (до корректировки)
  const inflowsByInn = Array.from({ length: horizon }, () => ({}));

  for (let i = 0; i < horizon; i++) {
    const st = stats.byWeekday[days[i].weekday];
    revenueIn[i] = (st.avgRevenueIn ?? 0) + (days[i].regularInRevenue ?? 0) + (days[i].scheduledInRevenue ?? 0);
    fixedOut[i] = (st.avgRentSupplierOut ?? 0) + (days[i].regularOutFixed ?? 0) + (days[i].scheduledOutFixed ?? 0);
    // Ожидаемый приток по контрагентам: регулярные + плановые + доля нерегулярного (по 6-месячной доле)
    const map = inflowsByInn[i];
    for (const [inn, amt] of Object.entries(days[i].inflowsByInn ?? {})) map[inn] = (map[inn] ?? 0) + amt;
    const irrIncome = st.avgIncome ?? 0;
    if (irrIncome > 0) {
      for (const [inn, share] of clientShareByInn) map[inn] = (map[inn] ?? 0) + irrIncome * share;
    }
  }

  // Применяем сами сценарии (парсятся и валидируются до вызова)
  // Этот вызов принимает уже нормализованные сценарии через поле .scenarios
  return { adjIncome, adjExpense, revenueIn, fixedOut, inflowsByInn };
}

/**
 * Применить нормализованные сценарии к плану (mutates adjIncome/adjExpense).
 * Дополнительно сохраняет «после»-атрибуцию (scenRevenueIn/scenFixedOut/scenInflowsByInn) —
 * ожидаемые потоки категории/контрагента с учётом сценариев, для приёмочных проверок.
 */
export function applyScenariosToPlan(plan, scenarios, todayIdx, horizon) {
  const { adjIncome, adjExpense, revenueIn, fixedOut, inflowsByInn } = plan;
  const scenRevenueIn = Float64Array.from(revenueIn);
  const scenFixedOut = Float64Array.from(fixedOut);
  const scenInflowsByInn = inflowsByInn.map((m) => ({ ...m }));
  for (const s of scenarios) {
    if (s.type === 'revenue_drop' && s.percent > 0) {
      const fromI = dayIndexOf(s.fromDate, todayIdx);
      const toI = s.durationDays != null ? Math.min(horizon - 1, fromI + s.durationDays - 1) : horizon - 1;
      const f = s.percent / 100;
      for (let i = fromI; i <= toI; i++) {
        adjIncome[i] -= revenueIn[i] * f;
        scenRevenueIn[i] = revenueIn[i] * (1 - f);
      }
    } else if (s.type === 'fixed_costs_growth' && s.percent > 0) {
      const fromI = dayIndexOf(s.fromDate, todayIdx);
      const f = s.percent / 100;
      for (let i = fromI; i < horizon; i++) {
        adjExpense[i] += fixedOut[i] * f;
        scenFixedOut[i] = fixedOut[i] * (1 + f);
      }
    } else if (s.type === 'unplanned_expense' && s.amount != null) {
      const i = dayIndexOf(s.date, todayIdx);
      adjExpense[i] += s.amount;
    } else if (s.type === 'client_delay') {
      const inn = s.inn;
      const d = s.days;
      for (let i = 0; i < horizon; i++) {
        const move = inflowsByInn[i][inn] ?? 0;
        if (!move) continue;
        adjIncome[i] -= move; // в текущие дни приток клиента убираем
        scenInflowsByInn[i][inn] = (scenInflowsByInn[i][inn] ?? 0) - move;
        const j = i + d;
        if (j < horizon) {
          adjIncome[j] += move; // добавляем на d дней позже (вне горизонта — теряется)
          scenInflowsByInn[j][inn] = (scenInflowsByInn[j][inn] ?? 0) + move;
        }
      }
    }
  }
  plan.scenRevenueIn = scenRevenueIn;
  plan.scenFixedOut = scenFixedOut;
  plan.scenInflowsByInn = scenInflowsByInn;
  return plan;
}
