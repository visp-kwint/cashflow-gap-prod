// server/src/controllers/dashboard.controller.js
import { prisma } from '../config/db.js';
import { calculateForecast } from '../services/forecast.service.js';
import { FORECAST_CONFIG } from '../config/forecast.config.js';
import { buildPlanFactAlerts, planFactService } from '../services/planFact.service.js';
import { getAsOfDate } from '../utils/asOf.js';
import { analyzeStatement } from '../utils/dataQuality.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { performance } from 'node:perf_hooks';

export async function getDashboard(req, res, next) {
  try {
    const userId = req.user.userId;
    // §3.6 (аудит): ?horizon=abc ранее падал в RangeError → 500; теперь — 400 VALIDATION
    let horizon = 30;
    if (req.query.horizon !== undefined) {
      horizon = Number.parseInt(req.query.horizon, 10);
      if (!Number.isInteger(horizon) || horizon < 1 || horizon > 366) {
        throw ApiError.badRequest('horizon — целое число от 1 до 366 (дней)');
      }
    }

    const operations = await prisma.operation.findMany({
      where: { userId },
      orderBy: { date: 'asc' }
    });

    const risks = await prisma.risk.findMany({
      where: { userId, active: true }
    });

    // ТЗ-доработка WP-5 (дефект 3): сначала СВЕРКА план-факт (статусы paid/partial/paid_late/overdue
    // записаны в БД), ТОМЧИ чтение событий и расчёт прогноза — иначе первый запрос после
    // появления просрочки считает прогноз по устаревшим статусам
    await planFactService.reconcileForUser(userId);

    // Плановые события (ТЗ-доп.): активные и неоплаченные; детектор просрочки обновляет статусы
    const plannedEvents = await prisma.plannedEvent.findMany({
      where: { userId, active: true, status: { not: 'paid' } },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });

    // Текущий баланс — баланс последней операции или 0
    const currentBalance = operations.length > 0 
      ? operations[operations.length - 1].balanceEndOfDay 
      : 0;

    // Опорная дата прогноза (ТЗ-доработка WP-7 §9): свежая выписка (≤ 3 дн.) — текущая дата,
    // старая — последняя дата выписки. FORECAST_AS_OF — только для демо-учётки (контракт
    // demo@cashflow.ru, prisma/seed); обычные пользователи берут asOf из своих данных.
    const DEMO_EMAIL = 'demo@cashflow.ru';
    const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
    const asOf = user?.email === DEMO_EMAIL && env.FORECAST_AS_OF
      ? env.FORECAST_AS_OF
      : getAsOfDate(lastOpDate, new Date()) || new Date().toISOString().slice(0, 10);

    // Рассчитываем прогноз кассовых разрывов (только активные риски)
    const minThreshold = user?.minBalance ?? 0;
    // ТЗ-доработка WP-7 §10: при истории < 14 дней Монте-Карло не запускать
    const historyDays = operations.length > 1 ? Math.round((lastOpDate - operations[0].date) / 86_400_000) + 1 : 0;
    // ТЗ-доработка WP-8 п.7: видимость расчёта — meta.computed + время в мс. Минимум:
    // инкрементальное состояние (ForecastState) не реализовано → всегда "full".
    const t0 = performance.now();
    const forecastResult = calculateForecast(operations, risks, currentBalance, horizon, minThreshold, {
      plannedEvents, // ТЗ-доп. §4.3: плановые события в расчётном ядре и Монте-Карло
      today: asOf,
      mcDisabled: historyDays < 14,
    });
    const computedMs = Math.round(performance.now() - t0);

    // Подсчет итогов за 30 дней от опорной даты (WP-7 §9: итоги от asOf, не от сегодня):
    // окно (asOf − 30 дн … asOf]
    const asOfDate = new Date(`${asOf}T00:00:00Z`);
    const asOfMs = asOfDate.getTime();
    const recentOps = operations.filter(
      (op) => op.date.getTime() <= asOfMs + 86_400_000 - 1 && op.date.getTime() >= asOfMs - 30 * 86_400_000,
    );
    const totalIncome = recentOps.filter(op => op.direction === 'in').reduce((sum, op) => sum + op.amount, 0);
    const totalExpense = recentOps.filter(op => op.direction === 'out').reduce((sum, op) => sum + op.amount, 0);

    // Качество данных выписки (ТЗ-доработка WP-7 §1, §10, §13): пропуски, пустые ИНН, овердрафт
    const statementQuality = analyzeStatement(operations);

    res.json({
      currentBalance,
      // Контрактные ключи (docs/api-contract.md): threshold/loanRatePct
      threshold: minThreshold,
      loanRatePct: FORECAST_CONFIG.loanRatePct,
      asOf, // ТЗ-доработка WP-7 §9: опорная дата прогноза (top-level, дублируется в dataQuality.asOf)
      meta: { computed: 'full', computedMs }, // ТЗ-доработка WP-8 п.7: видимость расчёта (инкрементальность не заявлена — всегда full)
      summary: {
        income: Math.round(totalIncome * 100) / 100,
        expense: Math.round(totalExpense * 100) / 100,
        balanceChange: Math.round((totalIncome - totalExpense) * 100) / 100,
        balance: currentBalance
      },
      ...forecastResult,
      // ТЗ-доработка WP-5 п.6: предупреждения (planned_overdue / regular_missing / разрыв — critical).
      // WP-7 §9: today = опорная дата asOf (имя параметра today — контракт buildPlanFactAlerts)
      alerts: buildPlanFactAlerts({ events: plannedEvents, forecast: forecastResult, operations, today: asOfDate }),
      // Слитое поле качества (ТЗ-доработка §1, §10): уровень ядра + пропуски/пустые ИНН/овердрафт + опорная дата
      dataQuality: {
        ...forecastResult.dataQuality,
        gapsDays: statementQuality.gaps.reduce((sum, g) => sum + Math.round((new Date(g.to) - new Date(g.from)) / 86_400_000) + 1, 0),
        gaps: statementQuality.gaps,
        emptyInnRows: statementQuality.emptyInnCount,
        emptyPurposeRows: statementQuality.emptyPurposeCount,
        overdraftDays: statementQuality.overdraftDays,
        historyLevel: statementQuality.level,
        historyDays: statementQuality.historyDays,
        asOf
      }
    });
  } catch (err) {
    next(err);
  }
}