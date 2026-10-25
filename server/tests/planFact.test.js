// server/tests/planFact.test.js — ТЗ-доработка WP-5 (приёмка):
// 1) reconcile (чистая функция): платёж в окне → paid; на 10 дней позже → paid_late,
//    deviationDays = 10; 60 % суммы → partial; нет платежа после окна → overdue;
//    чужой ИНН не сопоставляется; идемпотентность.
// 2) Контроллер: после создания просроченного входящего события ПЕРВЫЙ GET /api/dashboard
//    возвращает прогноз, где событие сдвинуто на today + plannedOverdueShiftDays,
//    и массив alerts с типом planned_overdue.
import { describe, it, expect } from 'vitest';
import { reconcile, buildPlanFactAlerts } from '../src/services/planFact.service.js';
import { FORECAST_CONFIG } from '../src/config/forecast.config.js';

const CFG = {
  planGraceDays: FORECAST_CONFIG.planGraceDays,
  planMatchAmountTolerancePct: FORECAST_CONFIG.planMatchAmountTolerancePct,
  planPartialMinPct: FORECAST_CONFIG.planPartialMinPct
};

describe('reconcile — чистая функция сверки (ТЗ WP-5, приёмка)', () => {
  const today = new Date('2026-10-25');
  const ev = (over = {}) => ({ id: 'e1', direction: 'in', amount: 1000, counterpartyInn: '7700000001', expectedDate: '2026-10-10', status: 'pending', ...over });

  it('платёж в окне [exp−3, exp+grace] → paid', () => {
    const { results } = reconcile([ev()], [{ id: 'o1', direction: 'in', amount: 1000, counterpartyInn: '7700000001', date: new Date('2026-10-12') }], today, CFG);
    expect(results[0].status).toBe('paid');
    expect(results[0].paidAmount).toBe(1000);
    expect(results[0].factOperationId).toBe('o1');
  });

  it('на 10 дней позже окна → paid_late, deviationDays = 10', () => {
    const { results } = reconcile([ev()], [{ id: 'o2', direction: 'in', amount: 1000, counterpartyInn: '7700000001', date: new Date('2026-10-20') }], today, CFG);
    const r = results[0];
    expect(r.status).toBe('paid_late');
    expect(r.deviationDays).toBe(10);
    expect(r.factOperationId).toBe('o2');
  });

  it('60 % суммы в окне → partial (paidAmount = 600)', () => {
    const { results } = reconcile([ev()], [{ id: 'o3', direction: 'in', amount: 600, counterpartyInn: '7700000001', date: new Date('2026-10-11') }], today, CFG);
    const r = results[0];
    expect(r.status).toBe('partial');
    expect(r.paidAmount).toBe(600);
  });

  it('нет платежа после окна → overdue', () => {
    const { results } = reconcile([ev()], [], today, CFG);
    expect(results[0].status).toBe('overdue');
    expect(results[0].paidAmount).toBe(0);
  });

  it('тот же платёж с чужим ИНН не сопоставляется → overdue', () => {
    const { results } = reconcile([ev()], [{ id: 'o4', direction: 'in', amount: 1000, counterpartyInn: '5099999999', date: new Date('2026-10-12') }], today, CFG);
    expect(results[0].status).toBe('overdue');
  });

  it('совпадение в будущем (today ≤ exp + grace) без платежа → pending', () => {
    const { results } = reconcile([ev({ expectedDate: '2026-11-05' })], [], today, CFG);
    expect(results[0].status).toBe('pending');
  });

  it('идемпотентна: повторный вызов ничего не меняет', () => {
    const ops = [{ id: 'o5', direction: 'in', amount: 600, counterpartyInn: '7700000001', date: new Date('2026-10-11') }];
    const a = reconcile([ev()], ops, today, CFG).results[0];
    const again = reconcile(
      [{ ...ev(), status: a.status, paidAmount: a.paidAmount, factOperationId: a.factOperationId, deviationDays: a.deviationDays }],
      ops, today, CFG
    ).results[0];
    expect(again).toEqual(a);
  });
});

describe('GET /api/dashboard — пересчёт с просрочкой (ТЗ WP-5, приёмка)', () => {
  it('первый запрос после создания просроченного события: сдвиг на today + N и alert planned_overdue', async () => {
    const { prisma } = await import('../src/config/db.js');
    const { getDashboard } = await import('../src/controllers/dashboard.controller.js');
    const { planFactService } = await import('../src/services/planFact.service.js');

    const email = `wp5test_${Date.now()}@cashflow.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: 'x', companyName: 'WP5 Test LLC', inn: '7700000999' }
    });
    const shift = FORECAST_CONFIG.plannedOverdueShiftDays;

    // База: 30 дней истории (1 операция), текущий баланс
    const baseDate = new Date(Date.now() - 30 * 86_400_000);
    await prisma.operation.create({
      data: {
        userId: user.id,
        date: baseDate,
        amount: 5000,
        direction: 'in',
        category: 'income',
        counterpartyName: 'Основа',
        counterpartyInn: '7700000042',
        purpose: 'База для истории',
        balanceEndOfDay: 100000,
        source: 'manual'
      }
    });

    // Базовый прогноз без событий — в день сдвига события поступления нет
    const callDashboard = async () => {
      let body = null;
      const req = { user: { userId: user.id }, query: {} };
      const res = { json: (b) => (body = b) };
      await getDashboard(req, res, () => {});
      return body;
    };
    const baseline = await callDashboard();
    const baseIncomeAtShift = baseline.forecastSeries[shift - 1].income;

    // Просроченное входящее событие (expectedDate = today − 10 дн. → сверка поставит overdue)
    const expectedDate = new Date(Date.now() - 10 * 86_400_000);
    const event = await prisma.plannedEvent.create({
      data: {
        userId: user.id,
        type: 'contract',
        title: 'Оплата по договору',
        amount: 50000,
        direction: 'in',
        expectedDate,
        source: 'manual'
      }
    });

    // ПЕРВЫЙ запрос после создания события — сверка уже внутри контроллера
    const after = await callDashboard();
    const incomeAtShift = after.forecastSeries[shift - 1].income;

    // 1) Событие сдвинуто на today + plannedOverdueShiftDays (поступление +50 000 в этот день)
    expect(incomeAtShift).toBeGreaterThanOrEqual(baseIncomeAtShift + 50000);
    // 2) Статус переведён в overdue записью в БД
    const saved = await prisma.plannedEvent.findUnique({ where: { id: event.id } });
    expect(saved.status).toBe('overdue');
    // 3) alerts содержит planned_overdue (severity warning)
    expect(Array.isArray(after.alerts)).toBe(true);
    const alert = after.alerts.find((a) => a.type === 'planned_overdue');
    expect(alert).toBeTruthy();
    expect(alert.severity).toBe('warning');
    // сумма в payload; в сообщении разряды через U+00A0 (Intl ru-RU), поэтому проверяем pattern
    expect(alert.amount).toBe(50000);
    expect(alert.message).toMatch(/50[\s\u00A0]000/);
    expect(alert.message).toContain('просрочка');

    // 4) Идемпотентность повторной сверки (повторный вызов ничего не меняет)
    const changed = await planFactService.reconcileForUser(user.id);
    expect(changed).toBe(0);

    // Уборка
    await prisma.plannedEvent.deleteMany({ where: { userId: user.id } });
    await prisma.operation.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }, 60_000);
});

describe('WP-6 плановость + asOf (отчёт §8.4 / 3.2)', () => {
  const asOf = new Date('2026-10-25');

  it('buildPlanFactAlerts: расход unplanned_* без события в плане → алерт «внеплановый платёж»', () => {
    const operations = [
      { id: 'o1', direction: 'out', amount: 50000, date: new Date('2026-10-20'), plannedness: 'unplanned_capex' },
      { id: 'o2', direction: 'out', amount: 3000, date: new Date('2026-10-21'), plannedness: 'planned_fixed' }, // не внеплановый — алерта нет
    ];
    const alerts = buildPlanFactAlerts({ events: [], forecast: {}, operations, today: asOf });
    const unplanned = alerts.filter((a) => a.type === 'unplanned_payment');
    expect(unplanned.length).toBe(1);
    expect(unplanned[0].amount).toBe(50000);
    expect(unplanned[0].message).toContain('Внеплановый платёж');
    expect(unplanned[0].message).toMatch(/50[0-9\s\u00A0]000/);
  });

  it('расход, совпавший с плановым событием (±3 дня, ±tol) → без алерта', () => {
    const operations = [{ id: 'o1', direction: 'out', amount: 50000, date: new Date('2026-10-20'), plannedness: 'unplanned_operational' }];
    const events = [{ id: 'e1', direction: 'out', amount: 50000, expectedDate: '2026-10-21', status: 'pending', active: true }];
    const alerts = buildPlanFactAlerts({ events, forecast: {}, operations, today: asOf });
    expect(alerts.some((a) => a.type === 'unplanned_payment')).toBe(false);
  });

  it('расход в будущем относительно asOf (today) → без алерта', () => {
    const operations = [{ id: 'o1', direction: 'out', amount: 9000, date: new Date('2026-10-30'), plannedness: 'unplanned_operational' }];
    const alerts = buildPlanFactAlerts({ events: [], forecast: {}, operations, today: asOf });
    expect(alerts.some((a) => a.type === 'unplanned_payment')).toBe(false);
  });

  it('reconcile работает от asOf (business-даты), не от «стены»: статус определяется опорной датой', () => {
    const ev = { id: 'e1', direction: 'in', amount: 1000, counterpartyInn: '7700000001', expectedDate: '2026-10-10', status: 'pending' };
    // asOf до окна платежа → pending (даже если «стена» гораздо позже)
    const pending = reconcile([ev], [], new Date('2026-09-01'), CFG).results[0];
    expect(pending.status).toBe('pending');
    // asOf за окном и без платежа → overdue
    const overdue = reconcile([ev], [], new Date('2026-11-01'), CFG).results[0];
    expect(overdue.status).toBe('overdue');
    // платёж в окне [exp−3, exp+grace] → paid, если asOf не раньше начала окна «late»-ветки
    const paid = reconcile(
      [ev],
      [{ id: 'o1', direction: 'in', amount: 1000, counterpartyInn: '7700000001', date: new Date('2026-10-12') }],
      new Date('2026-10-25'),
      CFG
    ).results[0];
    expect(paid.status).toBe('paid');
  });

  it('gap_forecast-алерт: gapDate из ядра — ISO-строка, вероятность — gapProbabilityPct (процент)', () => {
    const alerts = buildPlanFactAlerts({
      events: [],
      forecast: { gapDate: '2026-11-05', gapProbabilityPct: 42 },
      operations: [],
      today: new Date('2026-09-29T00:00:00Z'),
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('gap_forecast');
    expect(alerts[0].date).toBe('2026-11-05');
    expect(alerts[0].message).toContain('42 %');
  });
});
