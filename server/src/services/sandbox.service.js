import { prisma } from '../config/db.js';
import { calculateForecast } from './forecast.service.js';
import { getAsOfDate } from '../utils/asOf.js';
import { env } from '../config/env.js';

const HORIZON_DAYS = 90;
const LOAN_EVENT_RE = /кредит|займ|loan|банковск/i;

/** Прогноз движка -> контрактная форма ForecastResult (series с income/expense, dangerDays). */
function toContractForecast(fc, threshold) {
  return {
    series: fc.forecastSeries.map((p) => ({ date: p.date, income: p.income ?? 0, expense: p.expense ?? 0, balance: p.balance })),
    gapDate: fc.gapDate ?? null,
    gapProbabilityPct: fc.gapProbabilityPct ?? 0,
    gapAmount: fc.gapAmount ?? 0,
    dangerDays: fc.dangerDays ?? [],
    threshold,
  };
}

export class SandboxService {
  /**
   * Сценарий: базовый прогноз vs прогноз с N синтетическими операциями
   * (amount, direction, начиная с date; repeats>1 — ежемесячно).
   * Отрицательные сценарии «что, если» (ТЗ-доработка WP-4):
   *   excludeLoans — «займ не получен»: плановые поступления по кредитам/займам выключаются из сценария;
   *   excludeClientPayments — «оплата от клиента не получена»: плановые оплаты по договорам/счётам выключаются.
   * Сценарий в БД не пишет (операции не создаются) — только сохраняет карточку для аудита.
   */
  async simulate(userId, data = {}) {
    const name = String(data.name || 'Сценарий');
    const amount = Number(data.amount) || 0;
    const direction = data.direction === 'in' ? 'in' : 'out';
    const repeats = Math.max(1, Math.min(36, Number(data.repeats) || 1));
    const excludeLoans = Boolean(data.excludeLoans);
    const excludeClientPayments = Boolean(data.excludeClientPayments);
    const startDate = data.date ? new Date(data.date) : new Date();
    if (Number.isNaN(startDate.getTime())) startDate.setTime(Date.now());

    const [operations, risks, user, plannedEvents] = await Promise.all([
      prisma.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
      prisma.risk.findMany({ where: { userId, active: true } }),
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.plannedEvent.findMany({ where: { userId, active: true, status: { not: 'paid' } } }),
    ]);
    const currentBalance = operations.length > 0 ? operations[operations.length - 1].balanceEndOfDay : 0;
    const minThreshold = user?.minBalance ?? 0;

    // Опорная дата (ТЗ-доработка WP-7 §9): свежая выписка — сейчас, старая — последняя дата.
    // FORECAST_AS_OF — только для демо-учётки (контракт demo@cashflow.ru); §10: MC отключается
    // при истории < 14 дней.
    const DEMO_EMAIL = 'demo@cashflow.ru';
    const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
    const asOf = user?.email === DEMO_EMAIL && env.FORECAST_AS_OF
      ? env.FORECAST_AS_OF
      : getAsOfDate(lastOpDate, new Date()) || new Date().toISOString().slice(0, 10);
    const historyDays = operations.length > 1 ? Math.round((lastOpDate - operations[0].date) / 86_400_000) + 1 : 0;

    const activeEvents = plannedEvents.filter((e) => e.active !== false && e.status !== 'paid');
    const scenarioEvents = activeEvents.filter((e) => {
      if (e.direction !== 'in') return true; // из сценария выключаются только поступления
      const isLoan = LOAN_EVENT_RE.test(`${e.title ?? ''} ${e.counterpartyName ?? ''}`);
      if (excludeLoans && isLoan) return false;
      if (excludeClientPayments && !isLoan && (e.type === 'invoice' || e.type === 'contract')) return false;
      return true;
    });

    const fcOptions = { today: asOf, mcDisabled: historyDays < 14 };
    const baseFc = calculateForecast(operations, risks, currentBalance, HORIZON_DAYS, minThreshold, {
      ...fcOptions,
      plannedEvents: activeEvents,
    });

    const synthetic = [];
    for (let i = 0; i < repeats; i += 1) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      synthetic.push({
        date: d.toISOString().split('T')[0],
        amount,
        direction,
        category: direction === 'in' ? 'income' : 'expense',
        counterpartyName: 'Песочница',
        counterpartyInn: '0000000000',
        purpose: name,
        source: 'sandbox',
        balanceEndOfDay: 0,
      });
    }
    const scenarioFc = calculateForecast([...operations, ...synthetic], risks, currentBalance, HORIZON_DAYS, minThreshold, {
      ...fcOptions,
      plannedEvents: scenarioEvents,
    });

    const base = toContractForecast(baseFc, minThreshold);
    const scenario = toContractForecast(scenarioFc, minThreshold);

    await prisma.sandboxScenario.create({
      data: {
        userId,
        name: name.slice(0, 120),
        amount,
        date: startDate,
        repeats,
      },
    });

    return {
      base,
      scenario,
      delta: {
        gapProbabilityPct: Math.round((scenario.gapProbabilityPct - base.gapProbabilityPct) * 10) / 10,
        gapAmount: Math.round((scenario.gapAmount - base.gapAmount) * 100) / 100,
      },
      excludedEvents: activeEvents.length - scenarioEvents.length,
    };
  }

  async reset(userId) {
    await prisma.sandboxScenario.deleteMany({ where: { userId } });
    return { reset: true };
  }
}

export const sandboxService = new SandboxService();
