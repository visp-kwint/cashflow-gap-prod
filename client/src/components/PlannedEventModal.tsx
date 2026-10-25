import { useState } from 'react';
import { X } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { Button } from '@/components/ui/Button';
import type { CreatePlannedEventRequest, Direction, PlannedEventType } from '@/types/api';

const INPUT =
  'w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/60';

/** Модальное окно ручного добавления договора / счёта (ТЗ-доп. §2). */
export function PlannedEventModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    type: 'contract' as PlannedEventType,
    title: '',
    amount: '',
    direction: 'in' as Direction,
    expectedDate: '',
    deferralDays: '0',
    prepaymentPct: '',
    counterpartyName: '',
    counterpartyInn: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    const body: CreatePlannedEventRequest = {
      type: form.type,
      title: form.title.trim(),
      amount: Number(form.amount),
      direction: form.direction,
      expectedDate: form.expectedDate,
      deferralDays: Number(form.deferralDays || 0),
      prepaymentPct: form.type === 'contract' && form.prepaymentPct ? Number(form.prepaymentPct) : undefined,
      counterpartyName: form.counterpartyName.trim() || null,
      counterpartyInn: form.counterpartyInn.trim() || null,
    };
    if (!body.title || !Number.isFinite(body.amount) || body.amount <= 0 || !body.expectedDate) {
      setError('Заполните название, сумму (> 0) и дату');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.plannedEvents.create(body);
      onCreated();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Новый плановый платёж"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Новый плановый платёж</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="col-span-2 text-xs text-slate-400">Тип
            <select className={INPUT} value={form.type} onChange={(e) => set('type', e.target.value as PlannedEventType)}>
              <option value="contract">Договор</option>
              <option value="invoice">Счёт</option>
              <option value="tax">Налог</option>
            </select>
          </label>
          <label className="col-span-2 text-xs text-slate-400">Название
            <input className={INPUT} value={form.title} placeholder="Счёт №42 от ООО Ро***"
              onChange={(e) => set('title', e.target.value)} />
          </label>
          <label className="text-xs text-slate-400">Сумма, ₽
            <input className={INPUT} inputMode="decimal" value={form.amount}
              placeholder="50000" onChange={(e) => set('amount', e.target.value)} />
          </label>
          <label className="text-xs text-slate-400">Направление
            <select className={INPUT} value={form.direction} onChange={(e) => set('direction', e.target.value as Direction)}>
              <option value="in">Входящий</option>
              <option value="out">Исходящий</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">Плановая дата
            <input className={INPUT} type="date" value={form.expectedDate}
              onChange={(e) => set('expectedDate', e.target.value)} />
          </label>
          <label className="text-xs text-slate-400">Отсрочка, дней
            <input className={INPUT} inputMode="numeric" value={form.deferralDays}
              onChange={(e) => set('deferralDays', e.target.value)} />
          </label>
          {form.type === 'contract' && (
            <label className="text-xs text-slate-400">Предоплата, %
              <input className={INPUT} inputMode="decimal" value={form.prepaymentPct} placeholder="0..100"
                onChange={(e) => set('prepaymentPct', e.target.value)} />
            </label>
          )}
          <label className="col-span-2 text-xs text-slate-400">Контрагент (обезличивается автоматически)
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} value={form.counterpartyName} placeholder="ООО Ромашка"
                onChange={(e) => set('counterpartyName', e.target.value)} />
              <input className={INPUT} value={form.counterpartyInn} placeholder="ИНН"
                onChange={(e) => set('counterpartyInn', e.target.value)} />
            </div>
          </label>
        </div>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        <Button className="mt-3 w-full" loading={busy} onClick={submit}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
