import { useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Badge, Button, Card, ErrorState, Skeleton, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, formatRub } from '@/lib/format';
import type { OperationCategory, OperationSource, Subcategory } from '@/types/api';

const CATEGORY_LABELS: Record<OperationCategory, string> = {
  income: 'Доход',
  expense: 'Расход',
  payment: 'Платёж',
  tax: 'Налоги',
  salary: 'Зарплата',
  other: 'Прочее',
};

const SOURCE_LABELS: Record<OperationSource, string> = {
  import: 'Импорт выписки',
  manual: 'Добавлено вручную',
  bank_stub: 'Из банка (заглушка)',
  self_loan: 'Самозайм',
  bank_loan: 'Банковский займ (заглушка)',
  payment: 'Платёж со страницы «Оплата»',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-800 py-3 last:border-0 sm:flex-row sm:gap-4">
      <dt className="w-48 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 sm:pt-0.5">{label}</dt>
      <dd className="flex-1 text-sm text-slate-200">{children}</dd>
    </div>
  );
}

export default function OperationDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const op = useAsync(() => api.operations.get(id ?? ''), [id]);
  // ТЗ-доработка WP-3 §2.3: перекатегоризация — выбор подкатегории, сохранение с confidence='manual'
  const cats = useAsync(() => api.categories.list(), []);
  const [selectedSub, setSelectedSub] = useState<string>(op.data?.subcategory ?? '');
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  if (!id) return <Navigate to="/history" replace />;

  const opData = op.data;
  const subOptions = (cats.data?.subcategories ?? []).filter((s) => {
    if (!opData) return true;
    return s.direction === opData.direction;
  });

  async function saveReassign() {
    if (!opData) return;
    setReassigning(true);
    setReassignError(null);
    try {
      // ТЗ-доработка §2.3: PATCH /operations/:id — ручная перекатегоризация
      await api.operations.patchOperation(opData.id, { subcategory: selectedSub as Subcategory | '' });
      op.refetch();
    } catch (err) {
      setReassignError(errorMessage(err));
    } finally {
      setReassigning(false);
    }
  }

  const subLabel = (id: Subcategory) =>
    cats.data?.subcategories.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/history')}
        className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft size={16} /> Назад к истории
      </button>

      {op.loading && (
        <Card>
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        </Card>
      )}

      {op.error && (
        <Card>
          <ErrorState error={op.error} onRetry={op.refetch} />
        </Card>
      )}

      {opData && (
        <Card title="Операция">
          <dl className="grid">
            <Row label="Дата операции">{formatDate(opData.date)}</Row>
            <Row label="Сумма и направление">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'text-xl font-bold tabular-nums',
                    opData.direction === 'in' ? 'text-emerald-400' : 'text-rose-400',
                  )}
                >
                  {opData.direction === 'in' ? '+' : '−'}
                  {formatRub(opData.amount)}
                </span>
                <Badge tone={opData.direction === 'in' ? 'green' : 'red'}>
                  {opData.direction === 'in' ? 'Поступление' : 'Списание'}
                </Badge>
              </span>
            </Row>
            <Row label="Контрагент">
              <span>
                {opData.counterpartyName} · ИНН {opData.counterpartyInn}
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">Данные обезличены при сохранении</span>
            </Row>
            <Row label="Назначение платежа">{opData.purpose}</Row>
            <Row label="Остаток на счёте (конец дня)">{formatRub(opData.balanceEndOfDay)}</Row>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="gray">{CATEGORY_LABELS[opData.category] ?? opData.category}</Badge>
            <Badge tone="blue">{SOURCE_LABELS[opData.source] ?? opData.source}</Badge>
            {opData.subcategory && (
              <Badge tone="blue">{subLabel(opData.subcategory)}</Badge>
            )}
            {opData.categorySource === 'manual' && <Badge tone="violet">изменено вручную</Badge>}
            {opData.categoryConfidence != null && opData.categoryConfidence > 0 && (
              <Badge tone="gray">достоверность {Math.round(opData.categoryConfidence * 100)}%</Badge>
            )}
          </div>

          {/* ТЗ-доработка WP-3 §2.3: смена подкатегории */}
          <div className="mt-4 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <Select
                  value={selectedSub}
                  onChange={(e) => setSelectedSub(e.target.value)}
                  aria-label="Подкатегория"
                >
                  <option value="">Не категоризовано</option>
                  {subOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="secondary" size="sm" onClick={saveReassign} loading={reassigning}>
                Изменить категорию
              </Button>
            </div>
            {reassignError && <p className="mt-2 text-xs text-rose-400">{reassignError}</p>}
            <p className="mt-2 text-xs text-slate-500">
              Изменённые вручную операции помечаются как «изменено вручную» и учитываются прогнозом по новой категории.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
