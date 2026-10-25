import { http } from './client';
export { errorMessage } from './client';
import type {
  AuthResponse,
  BankLoanRequest,
  BankLoanResponse,
  BankPaymentRequest,
  BankPaymentResponse,
  CalendarDay,
  CategoriesResponse,
  CreateOperationRequest,
  CreatePlannedEventRequest,
  CreateRiskRequest,
  CreateTicketRequest,
  CounterpartyCheckResult,
  DashboardResponse,
  DemoFile,
  DemoLoadResponse,
  CalendarResponse,
  HistoryCategory,
  HistorySummary,
  Horizon,
  ImportSummary,
  IntegrationProvider,
  IntegrationSyncResult,
  Operation,
  Paged,
  PlannedEvent,
  PlannedEventsResponse,
  PlanFactResponse,
  PlanFactPeriodsResponse,
  Risk,
  ScenarioClientsResponse,
  ScenarioSimulateRequest,
  ScenarioSimulateResponse,
  SandboxSimulateRequest,
  SandboxSimulateResponse,
  SupportTicket,
  Subcategory,
  User,
  ForecastPoint,
  GapBreakdown,
} from '@/types/api';

function qs(params: Record<string, string | number | undefined> | null | undefined): string {
  const entries = Object.entries(params ?? {}).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

/** Русские подписи подкатегорий для круговой диаграммы «Истории» (таксономия TZ §4). */
const HISTORY_SUBCATEGORY_LABELS: Record<string, string> = {
  revenue_clients: 'Оплата от клиентов',
  revenue_acquiring: 'Эквайринг',
  revenue_marketplace: 'Выплаты маркетплейсов',
  loan_in: 'Кредиты и займы полученные',
  own_funds_in: 'Перевод своих средств (приход)',
  refund_in: 'Возврат платежа (приход)',
  other_in: 'Прочие поступления',
  salary: 'Зарплата и выплаты сотрудникам',
  tax: 'Налоги и взносы',
  rent: 'Аренда',
  loan_payment: 'Кредиты и лизинг',
  bank_fee: 'Комиссии банка',
  suppliers: 'Поставщики и закупки',
  own_funds_out: 'Перевод своих средств (расход)',
  refund_out: 'Возврат платежа (расход)',
  other_out: 'Прочие расходы',
  unknown: 'Не определено',
  uncategorized: 'Не категоризовано',
};

/** Подпись подкатегории (для списков операций). */
export const subcategoryLabel = (key: string): string => HISTORY_SUBCATEGORY_LABELS[key] ?? key;

export const api = {
  auth: {
    login: (body: { email: string; password: string }) =>
      http.post<AuthResponse>('/auth/login', body),
    /** multipart: email, password, companyName, inn + file (csv/xlsx) или useDemoData=true */
    register: (formData: FormData) => http.upload<AuthResponse>('/auth/register', formData),
    me: () => http.get<{ user: User }>('/auth/me'),
  },
  user: {
    /** Обновление профиля; `minBalance` — порог разрыва T (ТЗ §14). */
    update: (body: Partial<Pick<User, 'companyName' | 'inn' | 'minBalance'>>) =>
      http.patch<User>('/user', body),
  },
  dashboard: async (horizon: Horizon): Promise<DashboardResponse> => {
    // Реальный бэк (ветка Backend) отдаёт другой набор полей:
    // currentBalance / summary.balance / forecastSeries / gapDate… на верхнем уровне.
    // Нормализуем в контрактную форму; контрактные ключи имеют приоритет,
    // чтобы и заглушка, и бэк работали без переключения.
    const d = await http.get<Record<string, unknown>>('/dashboard' + qs({ horizon: String(horizon) }));
    const summary = (d.summary ?? {}) as Record<string, unknown>;
    const series = Array.isArray(d.forecastSeries)
      ? (d.forecastSeries as Array<Record<string, unknown>>).map((p) => ({
          date: String(p.date ?? ''),
          income: Number(p.income ?? 0),
          expense: Number(p.expense ?? 0),
          balance: Number(p.balance ?? 0),
        }))
      : (((d.forecast as Record<string, unknown> | undefined)?.series ?? []) as unknown as ForecastPoint[]);
    const fc = (d.forecast ?? {}) as Record<string, unknown>;
    return {
      balance: Number(d.currentBalance ?? d.balance ?? 0),
      threshold: typeof d.threshold === 'number' ? d.threshold : undefined,
      horizon: Number(d.horizon ?? horizon),
      loanRatePct: typeof d.loanRatePct === 'number' ? d.loanRatePct : undefined,
      summary: {
        income: Number(summary.income ?? 0),
        expense: Number(summary.expense ?? 0),
        balanceChange: Number(summary.balanceChange ?? summary.balance ?? 0),
      },
      forecast: {
        series,
        gapDate: (d.gapDate ?? fc.gapDate ?? null) as string | null,
        // ТЗ WP-7 §9/§10: null — Монте-Карло не запускался (история ≤ 14 дней), не 0
        gapProbabilityPct: (d.gapProbabilityPct ?? fc.gapProbabilityPct ?? null) as number | null,
        gapAmount: Number(d.gapAmount ?? fc.gapAmount ?? 0),
        // ТЗ WP-7 §11
        alreadyBelowThreshold: d.alreadyBelowThreshold === true || undefined,
      },
      // ТЗ WP-7 §9/§10: качество выписки и опорная дата (баннер «Данные выписки на …»)
      dataQuality: d.dataQuality as DashboardResponse['dataQuality'],
      // ТЗ WP-7 §11
      alreadyBelowThreshold: d.alreadyBelowThreshold === true || undefined,
      dangerDays: (Array.isArray(d.dangerDays) ? d.dangerDays : []) as string[],
      goodDays: (Array.isArray(d.goodDays) ? d.goodDays : []) as string[],
      // ТЗ-доработка WP-5 п.6: предупреждения (planned_overdue / regular_missing / gap_forecast)
      alerts: Array.isArray(d.alerts) ? d.alerts : undefined,
    };
  },
  planFact: {
    /** Вкладка «План-факт» (ТЗ-доработка WP-5). */
    month: (month?: string) =>
      http.get<PlanFactResponse>(`/dashboard/plan-fact${qs({ month: month || undefined })}`),
    /** Новый график «План-факт» (ТЗ WP-5): периоды день/неделя, 30/60/90 дней. */
    periods: (days: 30 | 60 | 90, granularity: 'day' | 'week') =>
      http.get<PlanFactPeriodsResponse>(
        `/plan-fact${qs({ days: String(days), granularity })}`,
      ),
    /** Разбивка «из чего складывается нехватка» (отчёт §8.4, минимум §8.7). */
    gapBreakdown: (days?: 30 | 60 | 90) =>
      http.get<GapBreakdown>(`/plan-fact/gap-breakdown${qs({ days: days ? String(days) : undefined })}`),
  },
  categories: {
    /** Каталог категорий и подкатегорий (ТЗ-доработка §2.1). */
    list: () => http.get<CategoriesResponse>('/categories'),
  },
  operations: {
    // Бэк (ветка Backend) отдаёт «голый» массив, а не Paged — оборачиваем.
    // recurring — фильтр «Повторяющиеся платежи» (отчёт §8.2): по классам плановости, в пределах месяца.
    list: async (q: { month: string; category?: string; page?: number; limit?: number; uncategorized?: boolean; recurring?: boolean }): Promise<Paged<Operation>> => {
      const d = await http.get<Operation[] | Paged<Operation>>(
        `/operations${qs({
          ...q,
          uncategorized: q.uncategorized ? 'true' : undefined,
          recurring: q.recurring ? 'true' : undefined,
        })}`,
      );
      if (Array.isArray(d)) return { items: d, total: d.length, page: q.page ?? 1, pages: 1 };
      return d;
    },
    get: (id: string) => http.get<Operation>(`/operations/${id}`),
    create: (body: CreateOperationRequest) => http.post<Operation>('/operations', body),
    /** Перекатегоризация (ТЗ-доработка §2.3): subcategory='' — сброс; без operationIds — все операции пользователя. */
    reassign: (body: { subcategory: Subcategory | ''; operationIds?: string[] }) =>
      http.post<{ updated: number }>('/operations/reassign', body),
    /** ТЗ-доработка §2.3: ручная перекатегоризация одной операции (PATCH /:id). */
    patchOperation: (id: string, body: { subcategory: Subcategory | '' }) =>
      http.patch<Operation>(`/operations/${id}`, body),
    /** Пакетный импорт операций (ТЗ-доработка WP-7). */
    bulk: (body: { operations: Array<Record<string, unknown>> }) =>
      http.post<{ imported: number; asOf: string }>('/operations/bulk', body),
  },
  history: {
    // Бэк отдаёт { items: Operation[] } (без month/groups/total) — собираем сводку сами;
    // контрактная форма {month,total,groups} проходит как есть.
    // ТЗ-доработка §10 (WP-3): диаграмма группируется по subcategory;
    // null/пустая subcategory учитывается отдельно как «Не категоризовано».
    summary: async (q: { month: string; category?: HistoryCategory | string; recurring?: boolean }): Promise<HistorySummary> => {
      const raw = await http.get<HistorySummary | { items?: Operation[] }>(
        `/history/summary${qs({ month: q.month, category: q.category || undefined, recurring: q.recurring ? 'true' : undefined })}`,
      );
      if (raw && !Array.isArray(raw) && 'groups' in raw) return raw as HistorySummary;
      const ops = (raw as { items?: Operation[] } | undefined)?.items ?? [];
      const inMonth = ops.filter((o) => o.date && o.date.slice(0, 7) === q.month);
      const byCat = new Map<string, number>();
      inMonth.forEach((o) => {
        const key = o.subcategory || 'uncategorized';
        byCat.set(key, (byCat.get(key) ?? 0) + o.amount);
      });
      const groups = [...byCat.entries()].map(([key, amount]) => ({
        key,
        label: HISTORY_SUBCATEGORY_LABELS[key] ?? key,
        amount,
      }));
      return {
        month: q.month,
        total: inMonth.reduce((s, o) => s + o.amount, 0),
        groups,
      };
    },
  },
  risks: {
    list: () => http.get<Risk[]>('/risks'),
    create: (body: CreateRiskRequest) => http.post<Risk>('/risks', body),
    update: (id: string, body: Partial<Risk>) => http.patch<Risk>(`/risks/${id}`, body),
    remove: (id: string) => http.del<void>(`/risks/${id}`),
  },
  gap: {
    selfLoans: () => http.get<{ items: Operation[] }>('/gap/self-loans'),
    selfLoan: (body: { amount: number }) =>
      http.post<{ operation: Operation }>('/gap/self-loan', body),
    cancelSelfLoan: (operationId: string) => http.del<void>(`/gap/self-loan/${operationId}`),
  },
  bank: {
    loan: (body: BankLoanRequest) => http.post<BankLoanResponse>('/bank/loan', body),
    payments: (body: BankPaymentRequest) => http.post<BankPaymentResponse>('/bank/payments', body),
    /** Синк с банком (заглушка): новые банковские операции записываются в БД. */
    sync: () => http.post<{ synced: boolean; new: number; operations: Operation[] }>('/bank/sync'),
    transactions: (q: { from: string; to: string }) =>
      http.get<{ operations: Operation[] }>(`/bank/transactions${qs(q)}`),
    /** Импорт банковской выписки (CSV/XLSX, формат тестовых данных организаторов или легаси).
     *  Multipart: file — выписка, replace='true' — заменить ранее импортированные.
     *  Итог импорта — ImportSummary (ТЗ-доработка WP-7 §5). */
    importStatement: (file: File, replace: boolean) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('replace', replace ? 'true' : 'false');
      return http.upload<ImportSummary & { removed: number; format: string; companyId: string | null }>('/operations/import', fd);
    },
  },
  /** Демо-выписки (ТЗ-доработка WP-7 §13): список и подгрузка в аккаунт. */
  demo: {
    companies: () => http.get<{ companies: DemoFile[] }>('/demo/companies'),
    /** Подгружает выбранную (или первую) демо-выписку, заменяя прежние демо-операции. */
    load: (company?: string) =>
      http.post<DemoLoadResponse>('/demo', company ? { company } : {}),
  },
  sandbox: {
    simulate: (body: SandboxSimulateRequest) =>
      http.post<SandboxSimulateResponse>('/sandbox/simulate', body),
  },
  /** ТЗ-доработка WP-4: негативные сценарии «что если» (сценарий внутри ядра, без фиктивных операций). */
  scenarios: {
    /** base + scenario + isolated[] + delta. Валидация границ — 400 VALIDATION. */
    simulate: (body: ScenarioSimulateRequest) =>
      http.post<ScenarioSimulateResponse>('/scenarios/simulate', body),
    /** Топ-5 клиентов по доле в поступлениях за 6 месяцев (prefill для client_delay). */
    clients: () => http.get<ScenarioClientsResponse>('/scenarios/clients'),
  },
  calendar: {
    /** Контрактный GET /calendar/month?month=YYYY-MM; ответ нормализуем к контракту. */
    month: async (month: string): Promise<CalendarResponse> => {
      const data: unknown = await http.get(`/calendar/month?month=${month}`);
      const days: CalendarDay[] = Array.isArray(data)
        ? data.filter(
            (d): d is CalendarDay =>
              !!d && typeof d === 'object' && 'date' in d && 'status' in d,
          )
        : Array.isArray((data as CalendarResponse | null)?.days)
          ? (data as CalendarResponse).days
          : [];
      return { month, days };
    },
  },
  support: {
    createTicket: (body: CreateTicketRequest) => http.post<SupportTicket>('/support/tickets', body),
    listTickets: () => http.get<SupportTicket[]>('/support/tickets'),
  },
  plannedEvents: {
    list: (q?: { type?: string; source?: string }) =>
      http.get<PlannedEventsResponse>(`/planned-events${qs((q ?? {}) as Record<string, string | undefined>)}`),
    create: (body: CreatePlannedEventRequest) => http.post<{ events: PlannedEvent[] }>('/planned-events', body),
    patch: (id: string, body: { status?: string; active?: boolean }) =>
      http.patch<{ event: PlannedEvent }>(`/planned-events/${id}`, body),
  },
  integrations: {
    sync: (provider: IntegrationProvider) =>
      http.post<IntegrationSyncResult>(`/integrations/${provider}/sync`),
    /** Убрать синхронизацию источника: удалить его незакрытые (pending) плановые события. */
    unsync: (provider: IntegrationProvider) =>
      http.del<{ ok: boolean; provider: IntegrationProvider; removed: number }>(`/integrations/${provider}/sync`),
  },
  counterparty: {
    check: (inn: string) => http.get<CounterpartyCheckResult>(`/counterparty${qs({ inn })}`),
  },
};
