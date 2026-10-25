import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { CounterpartyShield } from '@/components/CounterpartyShield';
import { formatRub } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { PlannedEventsResponse, PlannedEvent } from '@/types/api';

const STATUS_LABEL: Record<PlannedEvent['status'], string> = {
  pending: 'Ожидается',
  paid: 'Оплачено',
  overdue: 'Просрочено',
};

const SOURCE_LABEL: Record<PlannedEvent['source'], string> = {
  '1c': '1С',
  edo: 'ЭДО',
  ofd: 'ОФД',
  marketplace: 'Маркетплейс',
  tax_calendar: 'Налоги',
  manual: 'Ручной',
};

function EventRow({ event, onChanged }: { event: PlannedEvent; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      await api.plannedEvents.patch(event.id, { active: !event.active });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function markPaid() {
    setBusy(true);
    try {
      await api.plannedEvents.patch(event.id, { status: 'paid' });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const isIn = event.direction === 'in';
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-800/40 p-2.5',
        event.status === 'overdue' && 'border-rose-500/40',
        !event.active && 'opacity-50',
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm text-slate-200">{event.title}</p>
        <p className="mt-0.5 text-xs text-slate-400">
          {SOURCE_LABEL[event.source]} ·{' '}
          <span className={event.status === 'overdue' ? 'text-rose-400' : ''}>
            {new Date(event.expectedDate).toLocaleDateString('ru-RU')}
          </span>{' '}
          · {STATUS_LABEL[event.status]}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={cn('text-sm font-semibold tabular-nums', isIn ? 'text-emerald-400' : 'text-slate-200')}>
            {isIn ? '+' : '−'}{formatRub(event.amount)}
          </span>
          {event.counterpartyInn && <CounterpartyShield risk={event.counterpartyRisk} />}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {event.status !== 'paid' && (
          <Button size="sm" variant="ghost" loading={busy} onClick={markPaid} title="Отметить оплаченным">
            Оплачено
          </Button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={event.active}
            onChange={toggleActive}
            className="h-3.5 w-3.5 accent-emerald-500"
          />
          в прогнозе
        </label>
      </div>
    </div>
  );
}

/** Таблица будущих платежей, договоров, счетов и налогов (ТЗ-доп. §2). */
export function PlannedEventsSection({ onAdd }: { onAdd: () => void }) {
  const [data, setData] = useState<PlannedEventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api.plannedEvents.list());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => { void load(); }, []);

  const events = data?.events ?? [];
  const summary = data?.summary;

  return (
    <Card
      title="Плановые платежи"
      action={
        <Button size="sm" variant="secondary" icon={Plus} onClick={onAdd}>
          Добавить
        </Button>
      }
    >
      {error ? (
        <p className="text-sm text-rose-400">{error}</p>
      ) : !data ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : events.length === 0 ? (
        <EmptyState title="Плановых событий нет" hint="Синхронизируйте источник или добавьте вручную" />
      ) : (
        <div className="space-y-2">
          {summary && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-slate-800/60 p-2">
                <p className="text-slate-400">Приток</p>
                <p className="text-sm font-semibold tabular-nums text-emerald-400">+{formatRub(summary.totalExpectedIn)}</p>
              </div>
              <div className="rounded-lg bg-slate-800/60 p-2">
                <p className="text-slate-400">Отток</p>
                <p className="text-sm font-semibold tabular-nums text-rose-400">−{formatRub(summary.totalExpectedOut)}</p>
              </div>
              <div className="rounded-lg bg-slate-800/60 p-2">
                <p className="text-slate-400">Налоги до 28-го</p>
                <p className="text-sm font-semibold tabular-nums">{formatRub(summary.upcomingTaxes)}</p>
              </div>
              <div className="rounded-lg bg-slate-800/60 p-2">
                <p className="text-slate-400">Просрочено</p>
                <p className={cn('text-sm font-semibold tabular-nums', summary.overdueCount > 0 && 'text-rose-400')}>
                  {summary.overdueCount}
                </p>
              </div>
            </div>
          )}
          {events.map((ev) => (
            <EventRow key={ev.id} event={ev} onChanged={load} />
          ))}
        </div>
      )}
    </Card>
  );
}
