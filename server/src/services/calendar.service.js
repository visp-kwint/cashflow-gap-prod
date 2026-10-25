import { prisma } from '../config/db.js';
import { calculateForecast } from './forecast.service.js';
import { getAsOfDate } from '../utils/asOf.js';

/** Средние доход/расход по дню недели (сумма / кол-во вхождений). */
function weekdayAverages(operations) {
  const stats = Array.from({ length: 7 }, () => ({ incomeSum: 0, incomeCount: 0, expenseSum: 0, expenseCount: 0 }));
  for (const op of operations) {
    const dow = new Date(op.date).getDay();
    if (op.direction === 'in') {
      stats[dow].incomeSum += op.amount;
      stats[dow].incomeCount += 1;
    } else {
      stats[dow].expenseSum += op.amount;
      stats[dow].expenseCount += 1;
    }
  }
  return stats.map((s) => ({
    avgIncome: s.incomeCount > 0 ? s.incomeSum / s.incomeCount : 0,
    avgExpense: s.expenseCount > 0 ? s.expenseSum / s.expenseCount : 0,
  }));
}

export class CalendarService {
  /**
   * События календаря за месяц: статусы «опасный/хороший/нейтральный»
   * на основе прогноза кассовых разрывов (те же механизмы, что на дашборде).
   * @param {string} userId
   * @param {string} [month] YYYY-MM (по умолчанию текущий месяц)
   */
  async getEvents(userId, month) {
    const [operations, risks, user] = await Promise.all([
      prisma.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
      prisma.risk.findMany({ where: { userId, active: true } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);

    const currentBalance = operations.length > 0 ? operations[operations.length - 1].balanceEndOfDay : 0;
    const minThreshold = user?.minBalance ?? 0;

    // Опорная дата прогноза (ТЗ-доработка WP-7 §9): календарь строится от asOf, не от today
    const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
    const asOf = getAsOfDate(lastOpDate, new Date());

    // ТЗ WP-7 §9: месяц по умолчанию — месяц опорной даты asOf (без операций — настенные часы)
    const anchor = asOf ? new Date(`${asOf}T00:00:00Z`) : new Date();
    const defaultMonth = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}`;
    const [year, mon] = (month || defaultMonth).split('-').map(Number);
    if (Number.isNaN(year) || Number.isNaN(mon)) return [];
    const daysInMonth = new Date(year, mon, 0).getDate();

    // Горизонт от сегодня до конца целевого месяца (минимум дефолтный).
    const horizonDays = Math.max(30, daysInMonth + 14);
    const fc = calculateForecast(operations, risks, currentBalance, horizonDays, minThreshold, {
      today: asOf, // ТЗ WP-7 §9: опорная дата во всех вызовах calculateForecast
    });
    const pointByDate = new Map(fc.forecastSeries.map((p) => [p.date, p]));
    const dangerSet = new Set(fc.dangerDays);
    const goodSet = new Set(fc.goodDays);
    const weekAvg = weekdayAverages(operations);

    const events = [];
    for (let d = 1; d <= daysInMonth; d += 1) {
      const date = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const point = pointByDate.get(date);
      const avg = weekAvg[new Date(year, mon - 1, d).getDay()];

      let status = 'neutral';
      let reasons = [];
      if (point?.isDanger || dangerSet.has(date)) {
        status = 'danger';
        reasons = ['Ожидаемый остаток ниже порога T — кассовый разрыв'];
      } else if (goodSet.has(date)) {
        status = 'good';
        reasons = ['Ожидаемый доход выше желаемого уровня'];
      }

      events.push({
        date,
        status,
        expectedIncome: Math.round(avg.avgIncome * 100) / 100,
        expectedExpense: Math.round(avg.avgExpense * 100) / 100,
        expectedBalance: point ? point.balance : currentBalance,
        reasons,
      });
    }
    return events;
  }
}

export const calendarService = new CalendarService();
