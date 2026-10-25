import { useState } from 'react';
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import { api } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Badge, Button, Card, ErrorState, Modal, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { currentMonth, formatDate, formatRub, monthLabel, shiftMonth } from '@/lib/format';
import type { CalendarDay, DayStatus } from '@/types/api';

const STATUS_CLS: Record<DayStatus, string> = {
  danger: 'border-rose-500/70 bg-rose-500/25 text-rose-300',
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  neutral: 'border-slate-700 bg-slate-800 text-slate-300',
};

const STATUS_LABEL: Record<DayStatus, string> = {
  danger: 'Опасный день',
  good: 'Хороший день',
  neutral: 'Нейтрально',
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export default function Calendar() {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const cal = useAsync(() => api.calendar.month(month), [month]);

  function changeMonth(delta: number) {
    setMonth((m) => shiftMonth(m, delta));
    setSelected(null);
  }

  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const first = new Date(year, mon - 1, 1);
  const offset = (first.getDay() + 6) % 7; // понедельник = 0
  const daysInMonth = new Date(year, mon, 0).getDate();

  const byDate = new Map((cal.data?.days ?? []).map((day) => [day.date, day]));
  const cells: Array<string | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Flame size={12} className="text-rose-400" /> опасные дни
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> хорошие дни
            </span>
          </div>
        </div>

        {cal.error ? (
          <ErrorState error={cal.error} onRetry={cal.refetch} />
        ) : cal.loading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((dayStr, i) => {
                if (!dayStr) return <div key={`blank-${i}`} />;
                const day = byDate.get(dayStr);
                return (
                  <button
                    key={dayStr}
                    type="button"
                    disabled={!day}
                    onClick={() => day && setSelected(day)}
                    className={cn(
                      'flex h-12 flex-col items-center justify-center rounded-lg border text-sm sm:h-14',
                      day ? STATUS_CLS[day.status] : 'border-transparent text-slate-600',
                      day && 'cursor-pointer hover:opacity-80',
                    )}
                  >
                    <span className="font-medium">{Number(dayStr.slice(8))}</span>
                    {day?.status === 'danger' && <Flame size={11} className="mt-0.5 text-rose-400" />}
                    {day?.status === 'good' && <span className="mt-1 h-1 w-1 rounded-full bg-emerald-500" />}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Красные — дни с наибольшим ростом разрыва (остаток ниже порога). Зелёные — дни, когда доход
              превысил желаемый уровень (средний дневной доход × 1,2).
            </p>
          </div>
        )}
      </Card>

      {selected && (
        <Modal open title={formatDate(selected.date)} onClose={() => setSelected(null)}>
          <div className="space-y-3 text-sm">
            <Badge tone={selected.status === 'danger' ? 'red' : selected.status === 'good' ? 'green' : 'gray'}>
              {STATUS_LABEL[selected.status]}
            </Badge>
            <dl className="space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-slate-500">Ожидаемый доход</dt>
                <dd className="font-medium tabular-nums">{formatRub(selected.expectedIncome)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Ожидаемый расход</dt>
                <dd className="font-medium tabular-nums">{formatRub(selected.expectedExpense)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Ожидаемый остаток</dt>
                <dd className="font-medium tabular-nums">{formatRub(selected.expectedBalance)}</dd>
              </div>
            </dl>
            {selected.reasons.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Причины</p>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-300">
                  {selected.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
