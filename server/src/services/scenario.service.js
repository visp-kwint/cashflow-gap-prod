// server/src/services/scenario.service.js
// ТЗ-доработка WP-4: негативные сценарии «что если» (client_delay, revenue_drop,
// unplanned_expense, fixed_costs_growth). Сценарии применяются внутри calculateForecast
// через options.scenarios — фиктивные операции НЕ создаются (в отличие от legacy-песочницы).
// base — прогноз с теми же входными, что и GET /dashboard (операции, риски, плановые события,
// порог, горизонт, seed); scenario — все выбранные вместе; isolated — по одному.
import { prisma } from '../config/db.js';
import { calculateForecast } from './forecast.service.js';
import { parseScenarios } from './forecast.scenarios.js';
import { getAsOfDate } from '../utils/asOf.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

const DEMO_EMAIL = 'demo@cashflow.ru';
const DAY_MS = 86_400_000;

const round2 = (v) => Math.round(v * 100) / 100;
const round1 = (v) => Math.round(v * 10) / 10;

function addDaysISO(iso, days) {
  const ms = Date.parse(iso);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Дефолт сценария unplanned_expense (отчёт §8.4): «типичный внеплановый расход» =
 * медиана сумм исторических unplanned_* списаний пользователя (вместо ручного «с нуля»).
 * Нет таких операций — null (клиент остаётся с нулевым/ручным вводом, текущее поведение).
 * @param {Array<{ direction: string, amount: number, plannedness?: string|null }>} operations
 * @returns {number|null} медиана (round2) или null
 */
export function unplannedExpenseMedian(operations) {
  const amounts = (operations || [])
    .filter((o) => o.direction === 'out' && String(o.plannedness ?? '').startsWith('unplanned_'))
    .map((o) => Math.abs(Number(o.amount) || 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (amounts.length === 0) return null;
  const mid = Math.floor(amounts.length / 2);
  return round2(amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2);
}

/** Вводные те же, что у GET /dashboard: операции/риски/плановые события/порог/asOf/seed. */
async function loadInputs(userId) {
  const [operations, risks, user, plannedEvents] = await Promise.all([
    prisma.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
    prisma.risk.findMany({ where: { userId, active: true } }),
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.plannedEvent.findMany({ where: { userId, active: true, status: { not: 'paid' } } }),
  ]);
  const currentBalance = operations.length > 0 ? operations[operations.length - 1].balanceEndOfDay : 0;
  const minThreshold = user?.minBalance ?? 0;
  const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
  const asOf =
    user?.email === DEMO_EMAIL && env.FORECAST_AS_OF
      ? env.FORECAST_AS_OF
      : getAsOfDate(lastOpDate, new Date()) || new Date().toISOString().slice(0, 10);
  const historyDays = operations.length > 1 ? Math.round((lastOpDate - operations[0].date) / DAY_MS) + 1 : 0;
  return { operations, risks, plannedEvents, currentBalance, minThreshold, asOf, historyDays };
}

/** Контрактная форма ряда для ответа: date, остаток, p10, p90. */
function toContract(fc, threshold) {
  return {
    threshold,
    series: fc.forecastSeries.map((p) => ({
      date: p.date,
      balance: p.balance,
      p10: p.balanceLow ?? null,
      p90: p.balanceHigh ?? null,
    })),
    gapDate: fc.gapDate ?? null,
    gapAmount: fc.gapAmount ?? 0,
    gapProbabilityPct: fc.gapProbabilityPct ?? 0,
    minBalance: fc.minForecastBalance ?? null,
    dangerDays: fc.dangerDays ?? [],
  };
}

export class ScenarioService {
  /**
   * POST /scenarios/simulate
   * body: { scenarios: [ {type, params}, ... ] (1..4, разные типы), horizonDays? }
   * Ответ: { base, scenario, isolated[], delta, asOf, scenarios } — формы как в ТЗ-доработке.
   */
  async simulate(userId, body = {}) {
    const rawScenarios = Array.isArray(body.scenarios) ? body.scenarios : [];
    const parsed = parseScenarios(rawScenarios);
    if (!parsed.ok) throw ApiError.badRequest(parsed.error);
    const scenarios = parsed.scenarios;
    const ctx = await loadInputs(userId);

    // unplanned_expense: дата расхода не раньше завтра (опорная дата + 1)
    const minExpenseDate = addDaysISO(ctx.asOf, 1);
    for (const s of scenarios) {
      if (s.type === 'unplanned_expense' && s.date && s.date < minExpenseDate) {
        throw ApiError.badRequest(`unplanned_expense: дата расхода не раньше ${minExpenseDate}`);
      }
    }

    const horizonDays =
      body.horizonDays != null ? Math.trunc(Number(body.horizonDays)) : 30; // «как у главного прогноза» (дефолт 30)
    const opts = {
      today: ctx.asOf,
      plannedEvents: ctx.plannedEvents,
      mcDisabled: ctx.historyDays < 14, // ТЗ-доработка WP-7 §10 — то же, что у главного
    };

    // base — побитово главный прогноз; scenario — все выбранные вместе; isolated — по одному.
    // В ядро передаём ИСХОДНЫЕ сценарии ({type, params}) — ядро само их нормализует (один парсинг).
    const baseFc = calculateForecast(ctx.operations, ctx.risks, ctx.currentBalance, horizonDays, ctx.minThreshold, opts);
    const scenFc = calculateForecast(ctx.operations, ctx.risks, ctx.currentBalance, horizonDays, ctx.minThreshold, {
      ...opts,
      scenarios: rawScenarios,
    });
    const isolated = rawScenarios.map((s) =>
      calculateForecast(ctx.operations, ctx.risks, ctx.currentBalance, horizonDays, ctx.minThreshold, {
        ...opts,
        scenarios: [s],
      })
    );

    // Дата разрыва: сдвиг в днях (0, если в какой-то из прогнозов разрыва нет)
    const gapDateShiftDays =
      baseFc.gapDate && scenFc.gapDate
        ? Math.round((Date.parse(scenFc.gapDate) - Date.parse(baseFc.gapDate)) / DAY_MS)
        : 0;
    const delta = {
      gapDateShiftDays,
      gapAmount: round2((scenFc.gapAmount ?? 0) - (baseFc.gapAmount ?? 0)),
      gapProbabilityPct: round1((scenFc.gapProbabilityPct ?? 0) - (baseFc.gapProbabilityPct ?? 0)),
      minBalance: round2((scenFc.minForecastBalance ?? 0) - (baseFc.minForecastBalance ?? 0)),
    };

    // Карточка на каждый выбранный сценарий (kind — тип, params — JSON; legacy остаётся custom_event)
    const labels = {
      client_delay: 'Клиент задерживает оплату',
      revenue_drop: 'Спад выручки',
      unplanned_expense: 'Незапланированный расход',
      fixed_costs_growth: 'Рост постоянных расходов',
    };
    for (const s of scenarios) {
      await prisma.sandboxScenario.create({
        data: {
          userId,
          name: (labels[s.type] ?? s.type).slice(0, 120),
          amount: 0,
          date: new Date(`${ctx.asOf}T00:00:00Z`),
          repeats: 1,
          kind: s.type,
          params: JSON.stringify(s),
        },
      });
    }

    return {
      base: toContract(baseFc, ctx.minThreshold),
      scenario: toContract(scenFc, ctx.minThreshold),
      isolated: isolated.map((fc) => toContract(fc, ctx.minThreshold)),
      delta,
      asOf: ctx.asOf,
      scenarios,
    };
  }

  /**
   * GET /scenarios/defaults — дефолт unplanned_expense из истории (отчёт §8.4):
   * медиана unplanned_* списаний; нет истории → amount null (текущее поведение — ввод «с нуля»).
   */
  async suggestUnplannedDefault(userId) {
    const operations = await prisma.operation.findMany({
      where: { userId, direction: 'out' },
      select: { direction: true, amount: true, plannedness: true }
    });
    const amount = unplannedExpenseMedian(operations);
    return {
      unplannedExpense: amount == null ? null : { amount, basis: 'history_median' }
    };
  }

  /**
   * GET /scenarios/clients — топ-5 клиентов по доле в поступлениях за последние 6 месяцев.
   * INN здесь же нужен для prefill в client_delay.
   */
  async clients(userId) {
    const operations = await prisma.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } });
    const sixMonthsAgo = Date.now() - 6 * 30 * DAY_MS;
    const totals = new Map();
    let grandTotal = 0;
    const names = new Map();
    for (const op of operations) {
      if (op.direction !== 'in') continue;
      if (op.source === 'self_loan' || op.source === 'bank_loan') continue; // займы — не клиентские поступления
      const ts = op.date.getTime();
      if (ts < sixMonthsAgo) continue;
      const inn = op.counterpartyInn;
      if (!inn || inn === '0000000000' || inn === 'SELF') continue;
      totals.set(inn, (totals.get(inn) ?? 0) + op.amount);
      grandTotal += op.amount;
      if (op.counterpartyName) names.set(inn, op.counterpartyName);
    }
    const clients = [...totals.entries()]
      .map(([inn, sum]) => ({
        inn,
        name: names.get(inn) ?? 'Контрагент',
        totalIn6m: round2(sum),
        sharePct: grandTotal > 0 ? round1((sum / grandTotal) * 100) : 0,
      }))
      .sort((a, b) => b.totalIn6m - a.totalIn6m)
      .slice(0, 5);
    return { clients, windowMonths: 6 };
  }
}

export const scenarioService = new ScenarioService();
