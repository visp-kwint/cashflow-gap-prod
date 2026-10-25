/**
 * ТЗ-доработка WP-3 §4: модуль категоризации операций (чистые функции, без БД).
 *
 * categorize(op, ctx?) → { subcategory, category (legacy), confidence (0..1), rule, ruleId }
 *   op  — { direction, purpose, counterpartyName, counterpartyInn, amount, date }
 *   ctx — { userInn?, operations?, innHint? }:
 *     userInn    — ИНН владельца выписки (переводы своих средств);
 *     operations — все операции текущей выписки (окно 24 ч для refund_out, §4 п.2.2);
 *     innHint    — результат ИНН-правила (§4 п.5) для этого контрагента (subcategory или null).
 *
 * Порядок правил (§4 п.3): свои средства → возвраты → налоги → зарплата → кредиты и лизинг
 * → аренда → комиссии банка → эквайринг → маркетплейсы → поставщики → клиенты → прочее.
 * Конфиденс (§4 п.4): ключевое слово — 0.9; ИНН-правило — 0.6; без совпадений — 0.
 * Словари/regex/приоритеты — src/config/categories.config.js.
 */
import {
  SUBCATEGORIES,
  SUBCATEGORY_BY_ID,
  RULES,
  KEYWORD_CONFIDENCE,
  INN_RULE_CONFIDENCE,
  UNKNOWN_CONFIDENCE,
  UNKNOWN_SUB,
  legacyForSub,
  INN_RULE,
  OWN_FUNDS_PATTERN,
  PLANNED_FIXED_SUBS,
  OWNER_DISCRETIONARY_SUBS,
  NON_EXPENSE_SUBS,
  PLANNEDNESS_CAPEX,
  PLANNEDNESS_OPERATIONAL,
  PLANNEDNESS_RECURRENCE,
  PLANNEDNESS_OUTLIERS,
  PLANNEDNESS_CONFIDENCE,
} from '../config/categories.config.js';
import { FORECAST_CONFIG } from '../config/forecast.config.js';
import { normalizeForRules } from '../utils/text.js';

const REFUND_WINDOW_MS = 24 * 3_600_000; // §4 п.2.2: 24 часа

/** legacy-категория по подкатегории и направлению. */
export function legacyCategory(direction, subcategory) {
  return legacyForSub(subcategory, direction);
}

/**
 * Категоризация одной операции.
 * @param {object} op { direction: 'in'|'out', purpose?, counterpartyInn?, counterpartyName?, amount?, date? }
 * @param {{ userInn?: string, operations?: Array, innHint?: string|null }} [ctx]
 * @returns {{ subcategory: string, category: string, confidence: number, rule: string, ruleId: string }}
 */
export function categorize(op, ctx = {}) {
  const dir = op.direction === 'in' ? 'in' : 'out';
  const norm = normalizeForRules(op.purpose);
  const ops = ctx.operations ?? [];

  // 1) §4 п.3: «переводы своих средств» — первый приоритет:
  //    текст-маркер или ИНН контрагента = ИНН владельца.
  if (OWN_FUNDS_PATTERN.test(norm) || (ctx.userInn && op.counterpartyInn && ctx.userInn === op.counterpartyInn)) {
    return buildResult(dir, dir === 'in' ? 'own_funds_in' : 'own_funds_out', 'R-own_funds-01', 'text|inn');
  }

  // 2) §4 п.2.2 (возвраты): «возврат» в назначении → refund_in/refund_out;
  //    исходящий тому же контрагенту в 24 ч после его refund_in — тоже refund_out (не выручка).
  const refundRule = RULES.find((r) => r.id === 'R-refund-01');
  if (refundRule.regex.test(norm)) {
    return buildResult(dir, dir === 'in' ? 'refund_in' : 'refund_out', 'R-refund-01', 'regex');
  }
  if (dir === 'out' && op.counterpartyInn) {
    const refundWindow = ops.some(
      (o) =>
        o.direction === 'in' &&
        o.counterpartyInn === op.counterpartyInn &&
        refundRule.regex.test(normalizeForRules(o.purpose)) &&
        Math.abs(new Date(o.date).getTime() - new Date(op.date).getTime()) <= REFUND_WINDOW_MS,
    );
    if (refundWindow) return buildResult(dir, 'refund_out', 'R-refund-01', 'refund-24h');
  }

  // 3) Ключевые слова по приоритету (§4 п.3): налог → зарплата → кредит/лизинг → аренда →
  //    комиссия → эквайринг → маркетплейс → поставщики → клиенты.
  for (const rule of RULES) {
    if (rule.id === 'R-refund-01' || rule.id === 'R-inn-01' || rule.id === 'R-own_funds-01') continue;
    if (!rule.regex || !rule.regex.test(norm)) continue;
    const sub = rule.subcategory(dir);
    const meta = SUBCATEGORY_BY_ID[sub];
    // slug должен быть совместим с направлением операции (иначе пропускаем правило)
    if (meta && meta.direction !== dir) continue;
    return buildResult(dir, sub, rule.id, 'regex');
  }

  // 4) §4 п.5: ИНН-правило — hint из внешнего прохода (categorizeStatement).
  if (ctx.innHint && SUBCATEGORY_BY_ID[ctx.innHint] && SUBCATEGORY_BY_ID[ctx.innHint].direction === dir) {
    return buildResult(dir, ctx.innHint, 'R-inn-01', 'inn-rule');
  }

  // 5) Без совпадений (§4 п.4–5): пустое назначение + пустой ИНН → unknown;
  //    иначе — «прочее» по направлению (confidence 0).
  if (!norm && !op.counterpartyInn) {
    return buildResult(dir, UNKNOWN_SUB, 'none', 'unlabeled');
  }
  return buildResult(dir, dir === 'in' ? 'other_in' : 'other_out', 'none', 'unlabeled');
}

function buildResult(dir, sub, ruleId, ruleSource) {
  const meta = SUBCATEGORY_BY_ID[sub];
  let confidence = UNKNOWN_CONFIDENCE;
  if (ruleId === 'R-inn-01') confidence = INN_RULE_CONFIDENCE;
  else if (ruleId.startsWith('R-')) confidence = KEYWORD_CONFIDENCE;
  return {
    subcategory: sub,
    category: meta?.legacy ?? legacyForSub(sub, dir),
    confidence,
    rule: ruleSource,
    ruleId,
  };
}

/**
 * §4 п.5: ИНН-правило по всей выписке.
 * Контрагент с одним ИНН встречается ≥ INN_RULE.minOccurrences раз,
 * и ≥ 80 % его размеченных операций (confidence ≥ 0.9) — в одной подкатегории:
 * операции этого ИНН с пустым/нераспознанным назначением получают эту категорию (conf 0.6).
 * @param {Array} operations — операции со значением categorize() в поле `__cat`
 * @returns {Map<string, string>} ИНН → subcategory (hint)
 */
export function buildInnHints(operations) {
  const byInn = new Map();
  for (const op of operations) {
    const inn = op.counterpartyInn ? String(op.counterpartyInn) : '';
    if (!inn || !op.__cat) continue;
    if (!byInn.has(inn)) byInn.set(inn, { count: 0, labeled: [] });
    const e = byInn.get(inn);
    e.count += 1;
    if (op.__cat.confidence >= INN_RULE.labeledConfidence && op.__cat.rule === 'regex') {
      e.labeled.push(op.__cat.subcategory);
    }
  }
  const hints = new Map();
  for (const [inn, e] of byInn) {
    if (e.count < INN_RULE.minOccurrences || e.labeled.length === 0) continue;
    const counts = {};
    for (const c of e.labeled) counts[c] = (counts[c] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top[1] / e.labeled.length >= INN_RULE.minLabeledShare) hints.set(inn, top[0]);
  }
  return hints;
}

/**
 * Статистики плановости по выписке (отчёт §8.3, минимум): P95 списаний и набор
 * «регулярных» контрагентов (≥ minMonths разных месяцев, не чаще maxOpsPerMonth раз/мес.).
 * P95 считается по исходящим операциям (без own_funds/refund — они не расходы бизнеса).
 * @param {Array} operations операции со date/amount/direction/counterpartyInn/subcategory
 * @param {object|null} [excludeOp] текущая операция — исключается из статистик
 *   («выброс больше P95» нельзя считать по выборке, включающей сам выброс)
 * @returns {{ p95: number|null, recurringInns: Set<string> }}
 */
export function plannednessStats(operations, excludeOp = null) {
  const excludeKey = excludeOp ? plannednessKey(excludeOp) : null;
  const amounts = [];
  const byInn = new Map();
  for (const o of operations || []) {
    if (o.direction !== 'out') continue;
    const amt = Math.abs(Number(o.amount) || 0);
    if (!amt) continue;
    if (excludeKey != null && plannednessKey(o) === excludeKey) continue; // текущая операция
    if (o.subcategory && ['own_funds_out', 'refund_out'].includes(o.subcategory)) {
      byInnTrack(o, byInn);
      continue; // не тратим в P95, но повторяемость считаем
    }
    amounts.push(amt);
    byInnTrack(o, byInn);
  }
  amounts.sort((a, b) => a - b);
  const q = PLANNEDNESS_OUTLIERS.quantile;
  const p95 = amounts.length ? amounts[Math.min(amounts.length - 1, Math.floor(q * amounts.length))] : null;
  const recurringInns = new Set(
    [...byInn.entries()]
      .filter(([, e]) => e.months.size >= PLANNEDNESS_RECURRENCE.minMonths && e.count <= PLANNEDNESS_RECURRENCE.maxOpsPerMonth * e.months.size)
      .map(([inn]) => inn),
  );
  return { p95, recurringInns };
}

/** Позиция операции в выписке (для исключения текущей при расчёте её статистик). */
function plannednessKey(o) {
  return [o.direction, Math.abs(Number(o.amount) || 0), String(o.date ?? ''), String(o.counterpartyInn ?? ''), String(o.externalId ?? '')].join('|');
}

function byInnTrack(o, byInn) {
  const inn = String(o.counterpartyInn ?? '').trim();
  if (!inn || inn === '0000000000') return; // без ИНН / «своё» — повторяемость не считаем
  const key = new Date(o.date);
  const e = byInn.get(inn) ?? { count: 0, months: new Set() };
  e.count += 1;
  e.months.add(`${key.getFullYear()}-${key.getMonth()}`);
  byInn.set(inn, e);
}

/**
 * Класс плановости операции (отчёт §8.2, эвристика минимального варианта §8.7:
 * подкатегории + словари + owner-класс + P95-правило; без ML).
 * Вызывается ПОСЛЕ категоризации: op.subcategory уже задан.
 * @param {object} op { direction, amount, date, purpose?, counterpartyInn?, subcategory }
 * @param {object} [ctx] { operations?, stats?, plannedEvents?, planGraceDays?, planMatchAmountTolerancePct? }
 *   operations        — история для повторного расчёта статистик (если stats не переданы);
 *   stats             — результат plannednessStats(operations);
 *   plannedEvents     — события плана для planned_scheduled (окно/допуск из FORECAST_CONFIG или ctx);
 * @returns {{ plannedness: string|null, confidence: number|null, source: string|null }}
 */
export function classifyPlannedness(op, ctx = {}) {
  const none = { plannedness: null, confidence: null, source: null };
  const sub = op.subcategory;

  // Шаг 1: подкатегория (белый список → planned_fixed; own/refund/loan → owner_discretionary / non_expense)
  if (sub && PLANNED_FIXED_SUBS.includes(sub)) {
    return { plannedness: 'planned_fixed', confidence: PLANNEDNESS_CONFIDENCE.subcategory, source: 'rule' };
  }
  if (sub && OWNER_DISCRETIONARY_SUBS.includes(sub)) {
    return { plannedness: 'owner_discretionary', confidence: PLANNEDNESS_CONFIDENCE.subcategory, source: 'rule' };
  }
  if (sub && NON_EXPENSE_SUBS.includes(sub)) {
    return { plannedness: 'non_expense', confidence: PLANNEDNESS_CONFIDENCE.subcategory, source: 'rule' };
  }

  const norm = normalizeForRules(op.purpose);
  // Шаг 3: словари по тексту назначения (capex раньше operational: «ремонт помещения» — capex)
  if (PLANNEDNESS_CAPEX.test(norm)) {
    return { plannedness: 'unplanned_capex', confidence: PLANNEDNESS_CONFIDENCE.dictionary, source: 'rule' };
  }
  if (PLANNEDNESS_OPERATIONAL.test(norm)) {
    return { plannedness: 'unplanned_operational', confidence: PLANNEDNESS_CONFIDENCE.dictionary, source: 'rule' };
  }

  const inn = String(op.counterpartyInn ?? '').trim();
  // Статистики — по истории БЕЗ текущей операции («выброс больше P95» не включает сам себя)
  const stats = ctx.operations ? plannednessStats(ctx.operations, op) : ctx.stats ?? plannednessStats([]);
  const isRecurring = Boolean(inn && inn !== '0000000000' && stats.recurringInns.has(inn));

  // Шаг 5: совпадение с планом (только если события плана переданы и это расход)
  if (op.direction === 'out' && Array.isArray(ctx.plannedEvents) && ctx.plannedEvents.length) {
    const grace = ctx.planGraceDays ?? FORECAST_CONFIG.planGraceDays ?? 3;
    const tol = (ctx.planMatchAmountTolerancePct ?? FORECAST_CONFIG.planMatchAmountTolerancePct ?? 1) / 100;
    const t = new Date(op.date).getTime();
    const amt = Math.abs(Number(op.amount) || 0);
    for (const ev of ctx.plannedEvents) {
      if (ev.direction !== 'out' || ev.active === false) continue;
      const exp = new Date(ev.expectedDate).getTime();
      const A = Math.abs(Number(ev.amount) || 0);
      if (Math.abs(exp - t) <= grace * 86_400_000 && A > 0 && Math.abs(A - amt) <= tol * A) {
        return { plannedness: 'planned_scheduled', confidence: PLANNEDNESS_CONFIDENCE.planMatch, source: 'plan_match' };
      }
    }
  }

  // Шаг 2: повторяемость — контрагент ≥4 месяцев из истории, не чаще ~2 раз/мес.
  if (isRecurring) {
    return { plannedness: 'recurring_variable', confidence: PLANNEDNESS_CONFIDENCE.recurrence, source: 'recurrence' };
  }

  if (op.direction === 'out') {
    // Шаг 4: крупная одноразовая (больше P95 расходов, без повторов) → unplanned_capex
    if (stats.p95 != null && Math.abs(Number(op.amount) || 0) > stats.p95) {
      return { plannedness: 'unplanned_capex', confidence: PLANNEDNESS_CONFIDENCE.size, source: 'rule' };
    }
    // Минимум §8.7: нерегулярный расход без признаков плана — внеплановый (операционный:
    // разовые счета поставщикам, канцтовары — «внеплановая» ≠ «плохая», §8.2)
    if (sub && ['suppliers', 'other_out', UNKNOWN_SUB].includes(sub)) {
      return { plannedness: 'unplanned_operational', confidence: PLANNEDNESS_CONFIDENCE.fallback, source: 'rule' };
    }
  }
  return none;
}

/**
 * Категоризация всей выписки (для импорта): два прохода —
 * 1) правила (текст/ИНН владельца/24-ч окно), 2) ИНН-hints для нераспознанных (§4 п.5).
 * Возвращает операции с полями схемы: subcategory/category/categoryConfidence/categorySource
 * + класс плановости (отчёт §8): plannedness/plannednessConfidence/plannednessSource.
 * @param {Array} operations — операции parseBankStatement()
 * @param {string} [userInn]
 */
export function categorizeStatement(operations, userInn) {
  const pass1 = operations.map((op) => ({ ...op, __cat: categorize(op, { userInn, operations: operations }) }));
  const hints = buildInnHints(pass1);
  // Статистики плановости — один раз по всей выписке (пер-операция plannednessStats был O(n²):
  // импорт 10k строк с 1,5 с до 87 с).
  // shortcut: stats без исключения текущей операции; при n в десятках граница повторяемости/P95
  // может сместиться на 1 операцию — upgrade: пер-операция exclude, если на малых выписках
  // порог классификации начнёт флипаться.
  const stats = plannednessStats(operations);
  return pass1.map((o) => {
    const hint = o.counterpartyInn ? hints.get(String(o.counterpartyInn)) : null;
    const cat =
      o.__cat.rule === 'unlabeled' && hint ? categorize(o, { userInn, operations: operations, innHint: hint }) : o.__cat;
    const { __cat, ...rest } = o;
    // Плановость считается после категоризации: по истории выписки
    const planned = classifyPlannedness({ ...rest, subcategory: cat.subcategory }, { stats });
    return {
      ...rest,
      subcategory: cat.subcategory,
      category: cat.category,
      categoryConfidence: cat.confidence,
      categorySource: 'rule',
      categorizeRule: cat.rule,
      plannedness: planned.plannedness,
      plannednessConfidence: planned.confidence,
      plannednessSource: planned.source,
    };
  });
}

/** Каталог подкатегорий (для GET /categories и UI). */
export function listSubcategories() {
  return SUBCATEGORIES.map((s) => ({ ...s }));
}

/**
 * Проверка slug'а подкатегории (+ совместимость с направлением).
 * `unknown` допустим для обоих направлений.
 * @returns {string|null} slug или null (неизвестный/несовместимый)
 */
export function resolveSubcategory(sub, direction) {
  const meta = typeof sub === 'string' ? SUBCATEGORY_BY_ID[sub] : null;
  if (!meta) return null;
  if (meta.id !== UNKNOWN_SUB && direction && meta.direction !== direction) return null;
  return meta.id;
}

/**
 * Каталог категорий для GET /categories: legacy-категории с подкатегориями
 * и меткой «Не категоризовано» (subcategory IS NULL).
 */
export function categoryCatalog() {
  const byCategory = {};
  for (const sc of SUBCATEGORIES) {
    const key = sc.id === UNKNOWN_SUB ? 'unknown' : sc.legacy;
    (byCategory[key] ??= { id: key, subcategoryIds: [], labels: {} });
    byCategory[key].subcategoryIds.push(sc.id);
    byCategory[key].labels[sc.id] = sc.label;
  }
  const legacyLabels = {
    income: 'Поступления',
    expense: 'Расходы',
    tax: 'Налоги',
    salary: 'Зарплата',
    payment: 'Платежи',
    other: 'Свои средства (расход)',
    unknown: 'Не определено',
  };
  const categories = Object.values(byCategory).map((c) => ({
    id: c.id,
    label: legacyLabels[c.id] ?? c.id,
    subcategoryIds: c.subcategoryIds,
    subcategoryLabels: c.labels,
  }));
  categories.push({ id: 'uncategorized', label: 'Не категоризовано', subcategoryIds: [], subcategoryLabels: {} });
  return { categories, subcategories: listSubcategories() };
}

export { SUBCATEGORIES, SUBCATEGORY_BY_ID, RULES, legacyForSub, UNKNOWN_SUB };
