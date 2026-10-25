import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, subcategoryLabel } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { CategoryPie } from '@/components/charts/CategoryPie';
import { cn } from '@/lib/cn';
import { currentMonth, formatDate, formatRub, monthLabel, shiftMonth } from '@/lib/format';
import type { HistoryCategory, OperationCategory } from '@/types/api';

const CATEGORIES: Array<{ value: HistoryCategory; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
  { value: 'payment', label: 'Платежи' },
];

const CATEGORY_LABELS: Record<OperationCategory, string> = {
  income: 'Доход',
  expense: 'Расход',
  payment: 'Платёж',
  tax: 'Налоги',
  salary: 'Зарплата',
  other: 'Прочее',
};

const LIMIT = 20;

export default function History() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const [category, setCategory] = useState<HistoryCategory>('');
  // ТЗ-доработка WP-3: фильтр «Не категоризовано»
  const [uncategorized, setUncategorized] = useState(false);
  // Отчёт §8.2: фильтр «Повторяющиеся платежи» (по классам плановости из импорта)
  const [recurring, setRecurring] = useState(false);
  const [page, setPage] = useState(1);
  const [slideDir, setSlideDir] = useState<'next' | 'prev' | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const summary = useAsync(
    () => api.history.summary({ month, category, recurring: recurring || undefined }),
    [month, category, recurring],
  );
  const ops = useAsync(
    () =>
      api.operations.list({
        month,
        category: category || undefined,
        uncategorized: uncategorized || undefined,
        recurring: recurring || undefined,
        page,
        limit: LIMIT,
      }),
    [month, category, uncategorized, recurring, page],
  );

  function changeCategory(c: HistoryCategory) {
    setCategory(c);
    setUncategorized(false);
    setRecurring(false);
    setPage(1);
  }

  function toggleUncategorized() {
    setUncategorized((v) => !v);
    setRecurring(false);
    setCategory('');
    setPage(1);
  }

  function toggleRecurring() {
    setRecurring((v) => !v);
    setUncategorized(false);
    setCategory('');
    setPage(1);
  }

  function changeMonth(delta: number) {
    setSlideDir(delta > 0 ? 'next' : 'prev');
    setMonth((m) => shiftMonth(m, delta));
    setPage(1);
  }

  /** Горизонтальный свайп по области диаграммы листает месяцы */
  function onSwipeUp(e: ReactPointerEvent) {
    if (swipe.current === null) return;
    const dx = e.clientX - swipe.current.x;
    const dy = e.clientY - swipe.current.y;
    swipe.current = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    changeMonth(dx < 0 ? 1 : -1);
  }

  const groups = summary.data?.groups ?? [];
  const pieItems = groups.map((g) => ({ key: g.key, label: g.label, value: g.amount }));
  const opsData = ops.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            icon={ChevronLeft}
            onClick={() => changeMonth(-1)}
            aria-label="Предыдущий месяц"
          />
          <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(month)}</span>
          <Button
            variant="secondary"
            size="sm"
            icon={ChevronRight}
            onClick={() => changeMonth(1)}
            aria-label="Следующий месяц"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.value || 'all'}
              type="button"
              onClick={() => changeCategory(c.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium',
                category === c.value && !uncategorized
                  ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600',
              )}
            >
              {c.label}
            </button>
          ))}
          {/* ТЗ-доработка WP-3: фильтр «Не категоризовано» */}
          <button
            type="button"
            onClick={toggleUncategorized}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium',
              uncategorized
                ? 'border-amber-500 bg-amber-500 text-slate-950'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600',
            )}
          >
            Не категоризовано
          </button>
          {/* Отчёт §8.2: фильтр «Повторяющиеся платежи» (по классам плановости) */}
          <button
            type="button"
            onClick={toggleRecurring}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium',
              recurring
                ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600',
            )}
          >
            Повторяющиеся платежи
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Свайп по области диаграммы (слева/справа) листает месяцы */}
        <div
          className="min-w-0"
          style={{ touchAction: 'pan-y' }}
          onPointerDown={(e) => {
            swipe.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={onSwipeUp}
        >
          <div
            key={`${month}-${slideDir ?? ''}`}
            className={slideDir === 'next' ? 'hist-slide-next' : slideDir === 'prev' ? 'hist-slide-prev' : undefined}
          >
            <Card title={summary.data ? `Итого: ${formatRub(summary.data.total)}` : 'По группам'}>
              {summary.error ? (
                <ErrorState error={summary.error} onRetry={summary.refetch} />
              ) : summary.loading ? (
                <Skeleton className="h-56" />
              ) : groups.length === 0 ? (
                <EmptyState title="Нет данных за этот месяц" />
              ) : (
                <CategoryPie key={`${month}-${groups.length}`} items={pieItems} />
              )}
            </Card>
          </div>
        </div>

        <Card title="Операции">
          {ops.error ? (
            <ErrorState error={ops.error} onRetry={ops.refetch} />
          ) : ops.loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !opsData || opsData.items.length === 0 ? (
            <EmptyState title="Операций не найдено" hint="Попробуйте другой месяц или категорию" />
          ) : (
            <>
              <ul className="divide-y divide-slate-800">
                {opsData.items.map((op) => (
                  <li key={op.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/history/${op.id}`)}
                      className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-800/60"
                    >
                      <Badge tone={op.direction === 'in' ? 'green' : 'red'} className="shrink-0">
                        {op.direction === 'in' ? 'Поступление' : 'Списание'}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-200">
                          {op.counterpartyName}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {formatDate(op.date)} · {op.subcategory ? subcategoryLabel(op.subcategory) : CATEGORY_LABELS[op.category] ?? op.category} · {op.purpose}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-sm font-semibold tabular-nums',
                          op.direction === 'in' ? 'text-emerald-400' : 'text-rose-400',
                        )}
                      >
                        {op.direction === 'in' ? '+' : '−'}
                        {formatRub(op.amount)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {opsData.pages > 1 && (
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <Button variant="secondary" size="sm" disabled={opsData.page <= 1} onClick={() => setPage(opsData.page - 1)}>
                    Назад
                  </Button>
                  <span>
                    Стр. {opsData.page} из {opsData.pages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={opsData.page >= opsData.pages}
                    onClick={() => setPage(opsData.page + 1)}
                  >
                    Вперёд
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
