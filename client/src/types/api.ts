/**
 * Типы API-контракта. Контракт фиксируется в docs/api-contract.md —
 * при расхождении менять и то, и другое вместе.
 */

export type Direction = 'in' | 'out';

export type OperationCategory = 'income' | 'expense' | 'payment' | 'tax' | 'salary' | 'other';
export type OperationSource = 'import' | 'manual' | 'bank_stub' | 'self_loan' | 'bank_loan' | 'payment';
export type Subcategory =
  | 'own_funds_in' | 'own_funds_out'
  | 'refund_in' | 'refund_out'
  | 'tax' | 'salary' | 'loan_payment' | 'lease'
  | 'rent' | 'bank_fee' | 'acquiring'
  | 'marketplace' | 'suppliers' | 'revenue_clients'
  | 'other_in' | 'other_out'
  | 'unknown';

/** Категоризация (ТЗ-доработка §2.1): источник — 'rule' (авто) или 'manual' (рука). */
export type CategorySource = 'rule' | 'manual';

export interface Operation {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // всегда положительное число
  direction: Direction;
  category: OperationCategory;
  subcategory?: Subcategory | null; // ТЗ-доработка WP-3; null — не категоризовано
  categoryConfidence?: number | null; // 0 / 0.6 (ИНН-правило) / 0.9 (ключевое слово)
  categorySource?: CategorySource; // 'rule' — авто, 'manual' — назначено пользователем
  counterpartyName: string; // обезличено: первые 2 символа + ***
  counterpartyInn: string; // обезличено: 77******12
  purpose: string;
  balanceEndOfDay: number;
  source: OperationSource;
  /** Класс плановости (отчёт §8.2): planned_fixed / planned_scheduled / recurring_variable /
   *  unplanned_operational / unplanned_capex / owner_discretionary / non_expense; null — не классифицирована. */
  plannedness?:
    | 'planned_fixed'
    | 'planned_scheduled'
    | 'recurring_variable'
    | 'unplanned_operational'
    | 'unplanned_capex'
    | 'owner_discretionary'
    | 'non_expense'
    | null;
  plannednessConfidence?: number | null;
  plannednessSource?: 'rule' | 'recurrence' | 'plan_match' | 'manual' | null;
}

export type RiskType = 'income_loss' | 'unplanned_expense';

export interface Risk {
  id: string;
  title: string;
  type: RiskType;
  amount: number;
  dateFrom: string;
  dateTo: string | null;
  probability: number; // 0..1
  source: 'auto' | 'manual';
  active: boolean;
}

export interface CreateRiskRequest {
  title: string;
  type: RiskType;
  amount: number;
  dateFrom: string;
  dateTo?: string | null;
  probability: number; // 0..1
  active?: boolean;
}

// ---------- Плановые события и интеграции (ТЗ-доп.) ----------

export type PlannedEventType = 'contract' | 'invoice' | 'tax';
export type PlannedEventStatus = 'pending' | 'paid' | 'overdue';
export type CounterpartyRisk = 'low' | 'medium' | 'high';

export interface PlannedEvent {
  id: string;
  type: PlannedEventType;
  title: string;
  amount: number;
  direction: Direction;
  expectedDate: string; // ISO
  issueDate?: string | null;
  deferralDays: number;
  prepaymentPct?: number | null;
  counterpartyName?: string | null;
  counterpartyInn?: string | null;
  counterpartyRisk: CounterpartyRisk;
  source: '1c' | 'edo' | 'ofd' | 'marketplace' | 'tax_calendar' | 'manual';
  status: PlannedEventStatus;
  active: boolean;
}

export interface PlannedEventsResponse {
  events: PlannedEvent[];
  summary: {
    totalExpectedIn: number;
    totalExpectedOut: number;
    upcomingTaxes: number;
    overdueCount: number;
    highRiskInAmount: number;
  };
}

export interface CreatePlannedEventRequest {
  type: PlannedEventType;
  title: string;
  amount: number;
  direction: Direction;
  expectedDate: string; // YYYY-MM-DD
  issueDate?: string;
  deferralDays?: number;
  prepaymentPct?: number;
  counterpartyName?: string | null;
  counterpartyInn?: string | null;
}

export interface CounterpartyCheckResult {
  inn: string | null;
  status: 'ACTIVE' | 'LIQUIDATION' | 'BANKRUPT';
  taxDebts: number;
  bankruptcy: boolean;
  riskLevel: CounterpartyRisk;
  badgeText: string;
  detailsText: string;
  delayProbability: number;
}

export type IntegrationProvider = '1c' | 'edo' | 'tax-calendar' | 'marketplace';

export interface IntegrationSyncResult {
  ok: boolean;
  provider: IntegrationProvider;
  label: string;
  created: number;
}

/** Качество выписки (ТЗ-доработка WP-7 §7, §10). */
export type DataQualityLevel = 'insufficient' | 'low' | 'medium' | 'high';

export interface DashboardDataQuality {
  level: DataQualityLevel;
  historyDays?: number;
  gapsDays?: number;
  gaps?: Array<{ from: string; to: string; missingNet: number }>;
  emptyInnRows?: number;
  emptyPurposeRows?: number;
  overdraftDays?: number;
  warnings: string[];
  /** Опорная дата прогноза (ТЗ WP-7 §9): сейчас или последняя дата выписки. */
  asOf?: string;
}

export interface ForecastPoint {
  date: string;
  income: number;
  expense: number;
  balance: number; // прогноза остаток на конец дня
}

export interface ForecastResult {
  series: ForecastPoint[];
  gapDate: string | null;
  /** 0..100; null — история < 14 дней, Монте-Карло не запускался (ТЗ WP-7 §9/§10). */
  gapProbabilityPct: number | null;
  gapAmount: number;
  /** ТЗ WP-7 §11: остаток на опорной дате уже ниже порога T — разрыв «сейчас». */
  alreadyBelowThreshold?: boolean;
  /** Дни, где остаток ниже порога (красные зоны на графиках) */
  dangerDays?: string[];
  /** Порог T, по которому считаются dangerDays */
  threshold?: number;
}

export type Horizon = 30 | 60 | 90;

export interface DashboardResponse {
  balance: number;
  /** Бэк может не отдавать порог (PATCH /user ещё не реализован) — тогда UI показывает пустое поле. */
  threshold?: number;
  horizon: number;
  /** Условная ставка банковского займа, % (фиксированная константа из конфига, ТЗ §5.7). Опционально. */
  loanRatePct?: number;
  asOf?: string; // ТЗ-доработка WP-7 §9: опорная дата прогноза (top-level)
  meta?: { computed?: 'full' | 'incremental'; computedMs?: number }; // ТЗ-доработка WP-8 п.7: видимость расчёта
  summary: {
    income: number;
    expense: number;
    balanceChange: number;
  };
  forecast: ForecastResult;
  /** Качество выписки + опорная дата прогноза (ТЗ-доработка WP-7 §9/§10). */
  dataQuality?: DashboardDataQuality;
  /** ТЗ WP-7 §11: порог нарушен уже на опорной дате. */
  alreadyBelowThreshold?: boolean;
  dangerDays: string[];
  goodDays: string[];
  /** ТЗ-доработка WP-5 п.6: предупреждения сверки план-факт (planned_overdue / regular_missing / gap_forecast). */
  alerts?: DashboardAlert[];
}

// ТЗ-доработка WP-5: предупреждения на главной
export interface DashboardAlert {
  id: string;
  type: 'planned_overdue' | 'regular_missing' | 'gap_forecast' | 'unplanned_payment';
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  date: string;
  amount: number | null;
}

/** Разбивка «из чего складывается нехватка» рядом с разрывом (отчёт §8.4, минимум §8.7). */
export interface GapBreakdown {
  days: number;
  asOf: string;
  /** Обязательные платежи: ближайшие PlannedEvent-списания (pending/overdue) */
  mandatoryOut: number;
  mandatoryCount: number;
  /** Ожидаемые поступления: ближайшие PlannedEvent-приход */
  expectedIn: number;
  expectedInCount: number;
  /** Внеплановые резервы: сумма unplanned_* за 12 мес. (нет истории — медиана списаний) */
  unplannedReserve: number | null;
  unplannedBasis: 'sum_12m' | 'median_fallback_12m' | null;
  unplannedCount: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

/** Категории для переключателя «История»: Все / Расходы / Доходы / Платежи */
export type HistoryCategory = '' | 'expense' | 'income' | 'payment';

export interface HistorySummary {
  month: string; // YYYY-MM
  total: number;
  groups: Array<{ key: string; label: string; amount: number }>;
}

export interface User {
  id: string;
  email: string;
  companyName: string;
  inn: string;
  minBalance: number;
}

export interface AuthResponse {
  token: string;
  user: User;
  /** ТЗ-доработка WP-7 §5: итог импорта при регистрации с выпиской (или демо-данными). */
  import?: ImportSummary;
}

export interface CreateOperationRequest {
  date: string;
  amount: number;
  direction: Direction;
  counterpartyName?: string;
  purpose: string;
  category?: OperationCategory;
  subcategory?: Subcategory | ''; // '' — сбросить (не категоризовано)
}

/** Итог импорта выписки (ТЗ-доработка WP-7 §5). */
export interface ImportSummary {
  rowsTotal: number;
  imported: number;
  skipped: number;
  duplicatesRemoved: number;
  possibleDuplicates: number;
  /** Первые 50 с номерами строк: «Строка 12: …» (ТЗ §4, §5). */
  warnings: string[];
  dataQuality: {
    level: DataQualityLevel;
    historyDays: number;
    warnings: string[];
    gaps?: Array<{ from: string; to: string; missingNet: number }>;
  };
}

/** Демо-выписки (ТЗ-доработка WP-7 §13). */
export interface DemoFile {
  file: string;
  label: string;
}

export interface DemoLoadResponse {
  file: string;
  operationsImported: number;
  /** Сколько демо-операций (source='demo') заменено. */
  replaced: number;
  asOf: string;
  rowErrors: number;
}

export interface SupportTicket {
  id: string;
  subject: string;
  kind: 'problem' | 'question';
  message: string;
  status: string; // 'new' | 'in_progress' | 'resolved' | 'closed'
  createdAt: string;
}

export interface CreateTicketRequest {
  subject: string;
  kind: 'problem' | 'question';
  message: string;
}

export type SandboxDirection = 'in' | 'out';

export interface SandboxSimulateRequest {
  name: string;
  amount: number;
  date: string;
  direction: SandboxDirection;
  repeats: number; // 1 = одноразово, N = ежемесячно N раз
  /** ТЗ-доработка WP-4: отрицательные сценарии «что, если» */
  excludeLoans?: boolean; // займ не получен
  excludeClientPayments?: boolean; // оплата от клиента не получена
}

export interface SandboxSimulateResponse {
  base: ForecastResult;
  scenario: ForecastResult;
  /** scenario − base: п.п. для вероятности, рубли для суммы (отрицательное = разрыв меньше) */
  delta: {
    gapProbabilityPct: number;
    gapAmount: number;
  };
  /** Сколько плановых поступлений выключено отрицательным сценарием */
  excludedEvents?: number;
}

/** Каталог категорий и подкатегорий (ТЗ-доработка §2.1). */
export interface SubcategoryInfo {
  id: Subcategory;
  label: string;
  direction: Direction;
  /** Legacy-категория (income/expense/...), в которую маппится подкатегория. */
  legacy?: OperationCategory;
}

export interface CategoryInfo {
  id: OperationCategory | 'uncategorized' | 'unknown';
  label: string;
  subcategoryIds: Subcategory[];
  /** Подписи подкатегорий для этого legacy-категория (slug → label). */
  subcategoryLabels?: Record<string, string>;
}

export interface CategoriesResponse {
  categories: CategoryInfo[];
  subcategories: SubcategoryInfo[];
}

/** Вкладка «План-факт» (ТЗ-доработка WP-5). */
export interface PlanFactPeriod {
  from: string;
  to: string;
  planIn: number;
  planOut: number;
  factIn: number;
  factOut: number;
  planNet: number;
  factNet: number;
  deviationNet: number;
  significant: boolean;
}

// ТЗ-доработка WP-5: GET /plan-fact?days=30|60|90&granularity=day|week
export interface PlanFactPeriodsResponse {
  days: number;
  granularity: 'day' | 'week';
  cut: string;
  base: string;
  periods: PlanFactPeriod[];
}

/** Legacy-вкладка «План-факт» по месяцам (GET /dashboard/plan-fact). */
export interface PlanFactGroup {
  key: string;
  label: string;
  planned: number;
  actual: number;
  delta: number;
}

export interface PlanFactResponse {
  month: string;
  total: {
    plannedIn: number;
    actualIn: number;
    plannedOut: number;
    actualOut: number;
    deltaIn: number;
    deltaOut: number;
  };
  groups: PlanFactGroup[];
}

export type DayStatus = 'danger' | 'good' | 'neutral';

export interface CalendarDay {
  date: string;
  status: DayStatus;
  expectedIncome: number;
  expectedExpense: number;
  expectedBalance: number;
  reasons: string[];
}

export interface CalendarResponse {
  month: string;
  days: CalendarDay[];
}

export type BankPaymentType = 'tax' | 'salary' | 'rent' | 'supplier' | 'other';

export interface BankPaymentRequest {
  type: BankPaymentType;
  recipient: string;
  amount: number;
  date: string;
  purpose: string;
}

export interface BankPaymentResponse {
  status: 'accepted';
  operation: Operation;
  warning?: {
    gapGrows: boolean;
    newGapAmount: number | null;
    message: string | null;
  };
}

export interface BankLoanRequest {
  amount: number;
  termDays: number;
}

export interface BankLoanResponse {
  status: 'approved';
  /** Условная ставка — константа из конфига бэкенда */
  ratePct: number;
  operation: Operation;
}

/* ------------------------------ ТЗ-доработка WP-4: негативные сценарии «что если» ------------------------------ */

export type ScenarioType = 'client_delay' | 'revenue_drop' | 'unplanned_expense' | 'fixed_costs_growth';

export interface ScenarioItem {
  type: ScenarioType;
  params: {
    inn?: string;
    days?: number;
    percent?: number;
    fromDate?: string | null;
    durationDays?: number | null;
    amount?: number;
    date?: string | null;
  };
}

export interface ScenarioSimulateRequest {
  /** 1–4 сценария, типы не повторяются */
  scenarios: ScenarioItem[];
  /** Горизонт — как у главного прогноза (30/60/90) */
  horizonDays?: number;
}

export interface ScenarioSeriesPoint {
  date: string;
  balance: number;
  p10: number | null;
  p90: number | null;
}

export interface ScenarioContract {
  threshold: number;
  series: ScenarioSeriesPoint[];
  gapDate: string | null;
  gapAmount: number;
  gapProbabilityPct: number;
  minBalance: number | null;
  dangerDays: string[];
}

export interface ScenarioSimulateResponse {
  base: ScenarioContract;
  /** Все выбранные сценарии вместе */
  scenario: ScenarioContract;
  /** Каждый тип отдельно */
  isolated: ScenarioContract[];
  delta: {
    gapDateShiftDays: number;
    gapAmount: number;
    gapProbabilityPct: number;
    minBalance: number;
  };
  asOf: string;
  scenarios: ScenarioItem[];
}

export interface ScenarioClient {
  inn: string;
  name: string;
  totalIn6m: number;
  sharePct: number;
}

export interface ScenarioClientsResponse {
  clients: ScenarioClient[];
  windowMonths: number;
}
