// client/src/components/PlanFactCard.tsx
// ТЗ-доработка WP-5: вкладка «План-факт» на главной — график план vs факт по дням/неделям
// (30/60/90 дней), значимые отклонения подсвечены (красный = факт хуже, зелёный = лучше,
// + числовая подпись, чтобы не полагаться на цвет), под графиком — список просроченных ожиданий.
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { DashboardAlert, PlanFactPeriod } from '@/types/api';
import { api } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatRub, formatRubShort } from '@/lib/format';

type Days = 30 | 60 | 90;
type Gran = 'day' | 'week';

const DAYS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '30 дн', value: '30' },
  { label: '60 дн', value: '60' },
  { label: '90 дн', value: '90' }
];
const GRAN_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'День', value: 'day' },
  { label: 'Неделя', value: 'week' }
];

const periodLabel = (p: PlanFactPeriod, gran: Gran) =>
  gran === 'week' ? `нед. с ${p.from.slice(5)}` : p.from.slice(5);

export function PlanFactCard({ alerts = [] }: { alerts?: DashboardAlert[] }) {
  const [days, setDays] = useState<Days>(30);
  const [gran, setGran] = useState<Gran>('week');
  const pf = useAsync(() => api.planFact.periods(days, gran), [days, gran]);

  const data = pf.data;

  return (
    <Card
      title="План-факт"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-800 p-1">
            {DAYS_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setDays(Number(o.value) as Days)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium',
                  days === Number(o.value) ? 'bg-emerald-500 font-medium text-slate-950' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg bg-slate-800 p-1">
            {GRAN_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setGran(o.value as Gran)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium',
                  gran === o.value ? 'bg-emerald-500 font-medium text-slate-950' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {pf.error ? (
        <ErrorState error={pf.error} onRetry={pf.refetch} />
      ) : !data ? (
        <div className="space-y-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            План — прогноз на {data.cut} (mean90, данные известные до начала периода). Значимое
            отклонение: |факт − план| ≥ max(10 % от |план|, 10 000 ₽).
          </p>

          {data.periods.length === 0 ? (
            <EmptyState title="Нет операций за период" />
          ) : (
            <div className="space-y-2">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.periods} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={1}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey={(p: PlanFactPeriod) => periodLabel(p, gran)}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatRubShort(v)}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    width={72}
                  />
                  <Tooltip
                    formatter={(value: number) => formatRub(value)}
                    labelFormatter={(_l, payload) => {
                      const p = payload?.[0]?.payload as PlanFactPeriod | undefined;
                      return p ? `${p.from} – ${p.to}` : '';
                    }}
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  />
                  {/* Подсветка значимых отклонений фоном за столбцами */}
                  {data.periods
                    .filter((p) => p.significant)
                    .map((p) => (
                      <ReferenceArea
                        key={p.from}
                        x1={periodLabel(p, gran)}
                        x2={periodLabel(p, gran)}
                        fill={p.deviationNet < 0 ? 'rgba(244,63,94,0.08)' : 'rgba(52,211,153,0.08)'}
                      />
                    ))}
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="planIn" name="План: поступления" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="factIn" name="Факт: поступления" fill="#34d399" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="planOut" name="План: списания" fill="#f87171" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="factOut" name="Факт: списания" fill="#fb923c" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              {/* Числовые подписи значимых отклонений (ТЗ WP-5 п.5: не только цветом) */}
              {data.periods.some((p) => p.significant) ? (
                <div className="flex flex-wrap gap-1.5">
                  {data.periods
                    .filter((p) => p.significant)
                    .map((p) => (
                      <span
                        key={p.from}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs font-medium tabular-nums',
                          p.deviationNet < 0
                            ? 'bg-rose-500/10 text-rose-300'
                            : 'bg-emerald-500/10 text-emerald-300'
                        )}
                      >
                        {p.from}…{p.to.slice(8)}: {p.deviationNet < 0 ? '−' : '+'}
                        {formatRub(Math.abs(p.deviationNet))}
                      </span>
                    ))}
                </div>
              ) : null}
            </div>
          )}

          {/* Список просроченных ожиданий под графиком (ТЗ WP-5 п.5): из alerts дашборда */}
          <OverdueList alerts={alerts} />
        </div>
      )}
    </Card>
  );
}

/** Просроченные ожидания: planned_overdue из alerts дашборда (единый источник, без доп. запроса) */
function OverdueList({ alerts }: { alerts: DashboardAlert[] }) {
  const overdue = alerts.filter((a) => a.type === 'planned_overdue');
  if (overdue.length === 0) return null;

  return (
    <div className="rounded-lg bg-rose-500/5 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-rose-300">
        Просроченные ожидания ({overdue.length})
      </p>
      <ul className="divide-y divide-slate-800">
        {overdue.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="text-slate-300">{a.message}</span>
            <span className="shrink-0 tabular-nums text-slate-500">{formatRub(a.amount ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
