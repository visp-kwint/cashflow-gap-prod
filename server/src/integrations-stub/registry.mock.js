// Справочник статусов открытых реестров (ФНС / ЕГРЮЛ / Федресурс).
// ДЕМО-ПРАВИЛО (не реестр и не имитация реестра): детерминированная классификация
// риска по последним двум цифрам ИНН (ТЗ-доп. §4.2): 12/99/66 → high, 44/55/77 → medium.
export const COUNTERPARTY_RULES = {
  high: {
    suffixes: ['12', '99', '66'],
    status: 'ACTIVE',
    taxDebts: 480000,
    bankruptcy: true,
    riskLevel: 'high',
    delayProbability: 0.75,
    badgeText: 'Риск неплатежа: стадия банкротства / долг ФНС',
    detailsText: 'Реестр ФНС и Федресурс: задолженность по налогам 480 000 ₽, инициировано дело о банкротстве. Вероятность задержки оплаты — 75%.',
  },
  medium: {
    suffixes: ['44', '55', '77'],
    status: 'ACTIVE',
    taxDebts: 145000,
    bankruptcy: false,
    riskLevel: 'medium',
    delayProbability: 0.45,
    badgeText: 'Долг перед ФНС > 100 тыс. ₽',
    detailsText: 'По данным открытого реестра ФНС числится налоговая задолженность 145 000 ₽. Возможна задержка платежа (45%).',
  },
  low: {
    suffixes: [],
    status: 'ACTIVE',
    taxDebts: 0,
    bankruptcy: false,
    riskLevel: 'low',
    delayProbability: 0.05,
    badgeText: 'Надёжный контрагент (ЕГРЮЛ / ФНС)',
    detailsText: 'Действующая организация, долгов перед налоговой и дел о банкротстве не обнаружено.',
  },
};

// Сuffixes: full classification by last 2 digits; null → unknown → low (TZ rule 3)
export function classifyInnSuffix(suffix) {
  if (COUNTERPARTY_RULES.high.suffixes.includes(suffix)) return 'high';
  if (COUNTERPARTY_RULES.medium.suffixes.includes(suffix)) return 'medium';
  return 'low';
}
