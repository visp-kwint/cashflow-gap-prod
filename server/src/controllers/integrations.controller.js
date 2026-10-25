import { checkCounterparty } from '../services/counterpartyCheck.service.js';
import { ensureCounterpartyRisk } from '../services/counterpartyCheck.service.js';
import { ADAPTERS, PROVIDER_CODES } from '../integrations-stub/providers.mock.js';
import { getAsOfDate } from '../utils/asOf.js';

// Код провайдера → поле source событий (tax-calendar хранит события как "tax_calendar")
const PROVIDER_SOURCE = { 'tax-calendar': 'tax_calendar' };
const sourceOf = (provider) => PROVIDER_SOURCE[provider] ?? provider;

// Идемпотентная синхронизация провайдера (ТЗ-доп. §5):
// старые pending-записи этого источника удаляются, записывается свежий детерминированный набор.
export async function syncProvider(db, userId, provider) {
  if (!PROVIDER_CODES.includes(provider)) return { ok: false, error: 'unknown provider' };
  const { adapter } = ADAPTERS[provider];
  await db.plannedEvent.deleteMany({ where: { userId, source: sourceOf(provider), status: 'pending' } });
  // ТЗ WP-7 §9: даты мок-событий привязаны к опорной дате asOf (последняя операция выписки),
  // а не к настенным часам — адаптеры получают ctx.asOf
  const operations = await db.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } });
  const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
  const asOfStr = getAsOfDate(lastOpDate, new Date()) || new Date().toISOString().slice(0, 10);
  const asOf = new Date(`${asOfStr}T00:00:00Z`);
  const drafts = await adapter.sync({ asOf });
  const created = [];
  for (const d of drafts) {
    const item = await db.plannedEvent.create({ data: { ...d, userId } });
    if (item.direction === 'in' && item.counterpartyRisk !== 'low') {
      const check = checkCounterparty(item.counterpartyInn ?? '');
      await ensureCounterpartyRisk(db, item, check);
    }
    created.push(item);
  }
  return { ok: true, provider, label: adapter.label, created: created.length };
}

// Обратная операция: убрать синхронизацию источника — удалить его pending-события.
// Оплаченные записи и auto-риски не трогаются (оплата уже в выписке, риск живёт сам по себе).
export async function unsyncProvider(db, userId, provider) {
  if (!PROVIDER_CODES.includes(provider)) return { ok: false, error: 'unknown provider' };
  const result = await db.plannedEvent.deleteMany({ where: { userId, source: sourceOf(provider), status: 'pending' } });
  return { ok: true, provider, removed: result.count };
}

// Проверка контрагента по (маскированному) ИНН.
// ВНИМАНИЕ: ДЕМО-ПРАВИЛО, а не реестр: riskLevel/badgeText в ответе (GET /api/counterparty)
// вычисляются по последним двум цифрам ИНН (12/99/66 → high, 44/55/77 → medium,
// остальные → low) — см. COUNTERPARTY_RULES в integrations-stub/registry.mock.js.
export async function checkCounterpartyRoute(db, userId, query = {}) {
  const inn = query.inn;
  if (!inn) return { ok: false, error: 'inn required' };
  return { ok: true, ...checkCounterparty(inn) };
}
