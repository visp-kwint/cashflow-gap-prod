/**
 * ТЗ-доработка WP-3 §4: каталог подкатегорий и правила категоризации.
 *
 * Таксономия — 17 категорий (таблица §4): 7 in + 9 out + unknown (in/out).
 * `legacy` — устаревшая `category` (интерфейс и фильтрация), значения:
 *   income / expense / payment / tax / salary / other.
 */

export const SUBCATEGORIES = [
  { id: 'revenue_clients', direction: 'in', legacy: 'income', label: 'Оплата от клиентов' },
  { id: 'revenue_acquiring', direction: 'in', legacy: 'income', label: 'Эквайринг' },
  { id: 'revenue_marketplace', direction: 'in', legacy: 'income', label: 'Выплаты маркетплейсов' },
  { id: 'loan_in', direction: 'in', legacy: 'income', label: 'Кредиты и займы полученные' },
  { id: 'own_funds_in', direction: 'in', legacy: 'income', label: 'Перевод своих средств (приход)' },
  { id: 'refund_in', direction: 'in', legacy: 'income', label: 'Возврат платежа (приход)' },
  { id: 'other_in', direction: 'in', legacy: 'income', label: 'Прочие поступления' },
  { id: 'salary', direction: 'out', legacy: 'salary', label: 'Зарплата и выплаты сотрудникам' },
  { id: 'tax', direction: 'out', legacy: 'tax', label: 'Налоги и взносы (в т. ч. ЕНП)' },
  { id: 'rent', direction: 'out', legacy: 'payment', label: 'Аренда' },
  { id: 'loan_payment', direction: 'out', legacy: 'payment', label: 'Кредиты и лизинг' },
  { id: 'bank_fee', direction: 'out', legacy: 'payment', label: 'Комиссии банка' },
  { id: 'suppliers', direction: 'out', legacy: 'expense', label: 'Поставщики и закупки' },
  { id: 'own_funds_out', direction: 'out', legacy: 'other', label: 'Перевод своих средств (расход)' },
  { id: 'refund_out', direction: 'out', legacy: 'expense', label: 'Возврат платежа (расход)' },
  { id: 'other_out', direction: 'out', legacy: 'expense', label: 'Прочие расходы' },
  { id: 'unknown', direction: 'in', legacy: 'income', label: 'Не определено' }, // in/out: legacy по направлению
];

export const SUBCATEGORY_BY_ID = Object.fromEntries(SUBCATEGORIES.map((s) => [s.id, s]));

export function legacyForSub(subcategory, direction) {
  const s = SUBCATEGORY_BY_ID[subcategory];
  if (s && subcategory === 'unknown') return direction === 'in' ? 'income' : 'expense';
  if (s) return s.legacy;
  return direction === 'in' ? 'income' : 'expense';
}

export const UNKNOWN_SUB = 'unknown';

// ── Правила: порядок = приоритет (§4 п.3), id вида «R-<slug>-01» (§4 п.3) ──
// Конфиденс (§4 п.4): ключевое слово — 0.9; правило по ИНН — 0.6; без совпадений — 0.
export const KEYWORD_CONFIDENCE = 0.9;
export const INN_RULE_CONFIDENCE = 0.6;
export const UNKNOWN_CONFIDENCE = 0;

export const RULES = [
  {
    // §4 п.3: «переводы своих средств» — первый приоритет (поп. §4 п.2: текст «перевод собственных/своих средств»,
    // либо ИНН контрагента = ИНН владельца выписки)
    id: 'R-own_funds-01',
    subcategory: (dir) => (dir === 'in' ? 'own_funds_in' : 'own_funds_out'),
    regex: /перевод\s+(?:собственных|своих)\s+средств|между\s+(?:своими|собственными)\s+(?:счёт|счет|карт)|пополнение\s+своего|внесение\s+(?:в|на)\s+сво/i,
    note: 'ИНН-вариант (ctx.userInn) обрабатывается в служе (свой ИНН = ИНН контрагента)',
  },
  {
    id: 'R-refund-01',
    subcategory: (dir) => (dir === 'in' ? 'refund_in' : 'refund_out'),
    regex: /возврат|возврат\s+средств|вернул\s+средств|отмен(?:а|ен)\s+(?:платеж|оплаты)|спор\s+по\s+оплат|перенаправлен\s+в\s+счёт\s+клиента/i,
    note: 'П.2.2: поступление в 24 ч после refund_in тем же контрагентом остаётся refund_out',
  },
  {
    id: 'R-tax-01',
    subcategory: () => 'tax',
    regex: /налог|налоги|сб\s+в\s+бюджет|едины(?:й|е)\s+налог(?:овый)?\s+плате?ж|\bнп\b|успн|внп|фсфр|сбор(?:а)?\s+по\s+налог|платёж\s+в\s+фнс|страхов(?:ы?е)?\s+взнос|пфр\b|фрс\b/i,
    note: 'ТИН, период, «налог», ЕНП/НП, НДС, страховые взносы; «перевод на 30 дней» — НЕ налог',
  },
  {
    id: 'R-salary-01',
    subcategory: () => 'salary',
    regex: /зарплат|заработн|аванс\s+работни|реестр\s+(?:работн|зарплат)|работника|сотрудни|выплач\s+по\s+смете|расчёт\s+с\s+работни/i,
  },
  {
    id: 'R-loan-01',
    subcategory: (dir) => (dir === 'in' ? 'loan_in' : 'loan_payment'),
    regex: /займ|кредит|лизи(?:н|нга)|погашени(?:е|я)\s+кредит|процент(?:а)?\s+по\s+(?:кредит|займ)/i,
    note: 'loan_in — «займ средств, предоставленный…»; loan_payment — погашение/выплата по договору',
  },
  {
    id: 'R-rent-01',
    subcategory: () => 'rent',
    regex: /аренд(?:а|ы|у)|наём|найм\s+(?:помещен|офис|имущ)|содержание\s+помещ/i,
  },
  {
    id: 'R-bank_fee-01',
    subcategory: () => 'bank_fee',
    regex: /комисси|обслуживани(?:е|я)\s+(?:сч|карт|пласт|платеж)|ведени(?:е|я)\s+(?:сч|карт|счет)/i,
  },
  {
    id: 'R-acquiring-01',
    subcategory: () => 'revenue_acquiring',
    regex: /эквайринг|merch(?:ant)?|клиринг|офис\??\s?магистраль|электрон(?:ный)?\s?\+/i,
  },
  {
    id: 'R-marketplace-01',
    subcategory: () => 'revenue_marketplace',
    regex: /маркетплейс|marketplace|авито|avito|озон|wild\s?berries/i,
  },
  {
    id: 'R-supplier-01',
    subcategory: () => 'suppliers',
    regex: /постав(ш|л)|поставщ|закуп|компл(?:емен|ект)\s+товар|пополнени(?:е|я)\s+(?:расчетн|лицев|карт)|топлив|гсм\b|заправк|провоз|про(?:езд|езд)|услуг(?:и|а)?\s+связ|интернет|бухгалтер|уборк|запчаст|шиномонтаж|шины|лицев(?:ым|ого)\s+сч|расчетн(?:ой|ого)\s+запис|софт|подписк|оплат(?:а|у)?\s+(?:за|по)\s+(?:услуг|груз|перевозк|ремон|канц|шины|шин|софт|подписк|по\s+счет|по\s+смете|по\s+договор|по\s+заявк|счёту)/i,
    note: 'Закупки и оплата услуг/товаров (связь, ПО, ремонт, топливо, провоз)',
  },
  {
    id: 'R-client-01',
    subcategory: () => 'revenue_clients',
    regex: /договор|акт\s+\w*№?|счёт\w*\s+(?:на\s+оплату|№)|упд|заказ(?:а)?\s+на\s+работы|оплат(?:а|у)?\s+по\s+(?:договор|смете|заявк|счет|счёту|упд|акт)|поступ(?:ление|ив)|за\s+(?:товар|услуг|работ|продал)/i,
    note: 'Выручка от юрлиц: УПД/счёт/акт/договор/«оплата по…»',
  },
  {
    id: 'R-inn-01',
    subcategory: null, // заполняется динамически из §4 п.5 (ИНН-правило)
    regex: null,
    confidence: INN_RULE_CONFIDENCE,
  },
];

// §4 п.5: правило по ИНН контрагента
export const INN_RULE = {
  minOccurrences: 3, // контрагент в выписке ≥ 3 раз
  minLabeledShare: 0.8, // ≥ 80 % размеченных операций (confidence ≥ 0.9) — одна категория
  labeledConfidence: KEYWORD_CONFIDENCE,
};

export const OWN_FUNDS_PATTERN = /перевод\s+(?:собственных|своих)\s+средств|между\s+(?:своими|собственными)\s+(?:счёт|счет|карт)/i;

// ── Плановость (отчёт §8.2–8.3, минимальный вариант §8.7): словари и пороги ──
// Классы: planned_fixed / planned_scheduled / recurring_variable / unplanned_operational /
// unplanned_capex / owner_discretionary / non_expense.
export const PLANNED_FIXED_SUBS = ['tax', 'salary', 'rent', 'loan_payment', 'bank_fee'];
export const OWNER_DISCRETIONARY_SUBS = ['own_funds_out']; // переводы владельца — управляемый блок, не расход бизнеса
export const NON_EXPENSE_SUBS = ['own_funds_in', 'loan_in', 'refund_in', 'refund_out']; // исключить из статистики расходов
// §8.3 шаг 3: словари по тексту назначения (нормализованному)
export const PLANNEDNESS_CAPEX = /мебел|оборудован|станок|компьютер|ноутбук|автомобил|ремонт\s+помещ/i;
export const PLANNEDNESS_OPERATIONAL = /ремонт|запчаст|шиномонтаж|штраф|пен[яи]|исполнительн|доначисл/i;
// §8.3 шаг 2: повторяемость по контрагенту (минимум: ≥4 разных месяца, не чаще ~2 раз/мес.)
export const PLANNEDNESS_RECURRENCE = { minMonths: 4, maxOpsPerMonth: 2 };
// §8.3 шаг 4: выброс — больше P95 расходов за историю; окно — последние 12 мес.
export const PLANNEDNESS_OUTLIERS = { quantile: 0.95, windowMonths: 12 };
// Доверие классов
export const PLANNEDNESS_CONFIDENCE = {
  subcategory: 0.9, // правило по подкатегории (белый список / own/refund/loan)
  planMatch: 0.9, // совпадение с PlannedEvent
  dictionary: 0.6, // словарь по тексту назначения
  recurrence: 0.7, // регулярность по истории
  size: 0.7, // крупная одноразовая (выброс > P95)
  fallback: 0.5, // нерегулярный расход без признаков — «внеплановый, операционный»
};


