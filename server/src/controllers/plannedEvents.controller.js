import { z } from 'zod';
import { maskName, maskInn } from '../utils/masking.js';
import { checkCounterparty, ensureCounterpartyRisk } from '../services/counterpartyCheck.service.js';
import { calculateUpcomingTaxes } from '../services/taxCalendar.service.js';
import { planFactService } from '../services/planFact.service.js';
import { getAsOfDate } from '../utils/asOf.js';

const plannedEventBody = z.object({
  type: z.enum(['contract', 'invoice', 'tax']),
  title: z.string().min(1),
  amount: z.number().positive(),
  direction: z.enum(['in', 'out']),
  expectedDate: z.string(),
  issueDate: z.string().optional(),
  deferralDays: z.number().int().min(0).default(0),
  prepaymentPct: z.number().min(0).max(100).optional(),
  counterpartyName: z.string().nullable().optional(),
  counterpartyInn: z.string().nullable().optional(),
});

// Детектор просрочки (ТЗ-доп. §4.1 Б): pending-события с expectedDate < today без оплаты в Operation
// по тому же direction + counterpartyInn + сумма ±1% → status = "overdue".
// today = опорная дата asOf (ТЗ WP-7 §9): передаётся от вызывающего; по умолчанию — настенные часы.
export async function markOverdueEvents(db, userId, today = new Date()) {
  const pending = await db.plannedEvent.findMany({ where: { userId, status: 'pending' } });
  const startOfToday = new Date(today); startOfToday.setUTCHours(0, 0, 0, 0);
  for (const ev of pending) {
    if (new Date(ev.expectedDate) >= startOfToday) continue;
    const ops = await db.operation.findMany({
      where: { userId, direction: ev.direction,
        date: { gte: ev.issueDate ?? ev.expectedDate, lte: startOfToday } },
    });
    const paid = ops.some((o) => Math.abs(o.amount - ev.amount) / Math.max(ev.amount, 1) <= 0.01);
    if (!paid) {
      await db.plannedEvent.update({ where: { id: ev.id }, data: { status: 'overdue' } });
    }
  }
}

// Список + summary + сводка по налогам (GET /api/planned-events)
export async function listPlannedEvents(db, userId, query = {}) {
  // ТЗ-доработка WP-5: перед чтением — полная сверка план-факт (заменяет markOverdueEvents,
  // которая не проверяла ИНН и не переводила в paid/partial)
  await planFactService.reconcileForUser(userId);
  const where = { userId };
  if (query.type) where.type = query.type;
  if (query.source) where.source = query.source;
  const events = await db.plannedEvent.findMany({
    where, orderBy: { expectedDate: 'asc' },
  });

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayIdx = Math.floor(todayStart.getTime() / 86400000);
  const horizonEnd = todayIdx + 30;
  const activeFuture = events.filter((e) => e.active && e.status !== 'paid' && new Date(e.expectedDate).getTime() / 86400000 <= horizonEnd);
  const summary = {
    totalExpectedIn: activeFuture.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0),
    totalExpectedOut: activeFuture.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0),
    upcomingTaxes: activeFuture.filter((e) => e.type === 'tax').reduce((s, e) => s + e.amount, 0),
    overdueCount: events.filter((e) => e.status === 'overdue').length,
    highRiskInAmount: activeFuture.filter((e) => e.direction === 'in' && e.counterpartyRisk === 'high').reduce((s, e) => s + e.amount, 0),
  };

  return { events, summary };
}

// Ручное добавление (POST /api/planned-events)
export async function createPlannedEvents(db, userId, body) {
  const ev = plannedEventBody.parse(body);
  const issueDate = ev.issueDate ? new Date(ev.issueDate) : new Date(ev.expectedDate);
  const counterpartyName = maskName(ev.counterpartyName);
  const counterpartyInn = maskInn(ev.counterpartyInn);
  const check = checkCounterparty(counterpartyInn ?? '');
  const expectedDate = new Date(ev.expectedDate);

  const base = {
    userId, type: ev.type, direction: ev.direction,
    issueDate, deferralDays: ev.deferralDays,
    counterpartyName, counterpartyInn,
    counterpartyRisk: check.riskLevel,
    source: 'manual', status: 'pending', active: true,
  };

  // Договор: 0 < p < 100 → две записи (предоплата + постоплата), иначе одна (ТЗ-доп. §4.1 А)
  const created = [];
  if (ev.type === 'contract' && ev.prepaymentPct != null && ev.prepaymentPct > 0 && ev.prepaymentPct < 100) {
    const p = ev.prepaymentPct;
    const preAmount = Math.round(ev.amount * p) / 100;
    const postAmount = Math.round(ev.amount * (100 - p)) / 100;
    created.push(await db.plannedEvent.create({ data: {
      ...base, prepaymentPct: p,
      title: `[Предоплата ${p}%] ${ev.title}`, amount: preAmount,
      expectedDate: issueDate, deferralDays: 0,
    } }));
    created.push(await db.plannedEvent.create({ data: {
      ...base, prepaymentPct: p,
      title: `[Постоплата, отсрочка ${ev.deferralDays} дн.] ${ev.title}`, amount: postAmount,
      expectedDate: new Date(issueDate.getTime() + ev.deferralDays * 86400000),
      deferralDays: ev.deferralDays,
    } }));
  } else {
    created.push(await db.plannedEvent.create({ data: {
      ...base,
      prepaymentPct: ev.type === 'contract' ? (ev.prepaymentPct ?? 0) : null,
      title: ev.title, amount: ev.amount,
      expectedDate: ev.type === 'invoice'
        ? new Date(issueDate.getTime() + ev.deferralDays * 86400000)
        : expectedDate,
    } }));
  }

  // Входящее событие от ненадёжного контрагента → авто-риск в Risk (ТЗ-доп. §4.2)
  for (const item of created) {
    if (item.direction === 'in' && (check.riskLevel === 'high' || check.riskLevel === 'medium')) {
      await ensureCounterpartyRisk(db, item, check);
    }
  }
  return created;
}

// Обновление status/active (PATCH /api/planned-events/:id)
export async function updatePlannedEvent(db, userId, id, data) {
  const existing = await db.plannedEvent.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const patch = {};
  if (data.status && ['pending', 'paid', 'overdue'].includes(data.status)) patch.status = data.status;
  if (typeof data.active === 'boolean') patch.active = data.active;
  if (Object.keys(patch).length === 0) return existing;
  return db.plannedEvent.update({ where: { id }, data: patch });
}

// Синхронизация налогового календаря (POST /api/integrations/tax-calendar/sync)
// asOf (опционально, ГГГГ-ММ-ДД или Date): старт расчёта от опорной даты (ТЗ WP-7 §9);
// без asOf — опорная дата из выписки пользователя (уровень asOf в getAsOfDate), не настенные часы.
export async function syncTaxCalendar(db, userId, asOf = null) {
  await db.plannedEvent.deleteMany({ where: { userId, source: 'tax_calendar', status: 'pending' } });
  const operations = await db.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } });
  const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
  const refDate = asOf
    ? new Date(asOf)
    : new Date(`${getAsOfDate(lastOpDate, new Date()) || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const drafts = calculateUpcomingTaxes(operations, refDate, 90);
  const created = [];
  for (const d of drafts) {
    created.push(await db.plannedEvent.create({ data: { ...d, userId } }));
  }
  return created;
}
