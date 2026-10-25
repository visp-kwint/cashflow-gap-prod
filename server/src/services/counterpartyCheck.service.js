import { COUNTERPARTY_RULES, classifyInnSuffix } from '../integrations-stub/registry.mock.js';
import { innSuffix, maskInn } from '../utils/masking.js';

// Deterministic check of counterparty risk by INN (masked or unmasked), TZh-Dop §4.2.
export function checkCounterparty(inn) {
  const suffix = innSuffix(inn) ?? '';
  const rule = COUNTERPARTY_RULES[classifyInnSuffix(suffix)];
  // inn в ответе — всегда в маскированном виде
  return {
    inn: inn ? maskInn(inn) : null,
    ...rule,
  };
}

// Auto-generate a Risk record for a high/medium incoming PlannedEvent (dedup by title+userId).
export async function ensureCounterpartyRisk(db, event, result) {
  if (event.direction !== 'in' || result.riskLevel === 'low') return null;
  const title = `Риск задержки оплаты по счёту от ${event.counterpartyName ?? 'контрагента'} (долг перед ФНС / реестр банкротств)`;
  const existing = await db.risk.findFirst({ where: { userId: event.userId, title, active: true } });
  if (existing) return existing;
  return db.risk.create({
    data: {
      userId: event.userId,
      title,
      type: 'income_loss',
      amount: event.amount,
      dateFrom: event.expectedDate,
      dateTo: event.expectedDate,
      probability: result.delayProbability,
      source: 'auto',
      active: true,
    },
  });
}
