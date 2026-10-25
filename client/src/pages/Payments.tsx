import { useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { Button, Card, EmptyState, Field, Input } from '@/components/ui';
import { IntegrationsPanel } from '@/components/IntegrationsPanel';
import { PlannedEventsSection } from '@/components/PlannedEventsSection';
import { PlannedEventModal } from '@/components/PlannedEventModal';
import { cn } from '@/lib/cn';
import { currentMonth, formatDate, formatRub, shiftMonth, todayISO } from '@/lib/format';
import type { BankPaymentResponse, BankPaymentType, Operation } from '@/types/api';

const TYPES: Array<{ value: BankPaymentType; label: string }> = [
  { value: 'tax', label: 'Налоги' },
  { value: 'salary', label: 'Зарплата' },
  { value: 'rent', label: 'Аренда' },
  { value: 'supplier', label: 'Поставщики' },
  { value: 'other', label: 'Прочее' },
];

export default function Payments() {
  // key — пересоздаёт секцию после внешних изменений (синхронизация, добавление)
  const [eventsVersion, setEventsVersion] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const bumpEvents = () => setEventsVersion((v) => v + 1);

  const [type, setType] = useState<BankPaymentType>('tax');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BankPaymentResponse | null>(null);

  const [pullBusy, setPullBusy] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pulled, setPulled] = useState<Operation[] | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [replacePrev, setReplacePrev] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ imported: number; skipped: number; removed: number; companyId: string | null } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!recipient.trim() || !Number.isFinite(value) || value <= 0 || !date) {
      setError('Заполните получателя, сумму и дату');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api.bank.payments({
          type,
          recipient: recipient.trim(),
          amount: value,
          date,
          purpose: purpose.trim(),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function pull() {
    setPullBusy(true);
    setPullError(null);
    try {
      // Синк записывает новые банковские операции в БД, затем показываем всю выписку
      await api.bank.sync();
      const res = await api.bank.transactions({ from: shiftMonth(currentMonth(), -1), to: todayISO() });
      setPulled(res.operations);
    } catch (err) {
      setPullError(errorMessage(err));
    } finally {
      setPullBusy(false);
    }
  }

  async function uploadStatement() {
    if (!file) return;
    setImportBusy(true);
    setImportError(null);
    setImported(null);
    try {
      const res = await api.bank.importStatement(file, replacePrev);
      setImported({ imported: res.imported, skipped: res.skipped, removed: res.removed, companyId: res.companyId });
      // обновляем список операций из банка
      const tx = await api.bank.transactions({ from: shiftMonth(currentMonth(), -1), to: todayISO() });
      setPulled(tx.operations);
      setFile(null);
      setReplacePrev(false);
    } catch (err) {
      setImportError(errorMessage(err));
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <IntegrationsPanel onSynced={bumpEvents} />
      <PlannedEventsSection key={eventsVersion} onAdd={() => setModalOpen(true)} />
      {modalOpen && (
        <PlannedEventModal onClose={() => setModalOpen(false)} onCreated={bumpEvents} />
      )}

      <Card title="Новый платёж (заглушка банка)">
        <div className="mb-3 flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium',
                type === t.value
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Получатель">
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Название получателя" />
          </Field>
          <Field label="Сумма">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Дата">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Назначение (необязательно)">
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Оплата по договору..." />
          </Field>
          {error && <p className="text-xs text-rose-400 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy}>
              Отправить платёж
            </Button>
          </div>
        </form>

        {result && (
          <div className="mt-4 space-y-2">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
              Платёж принят банком (статус: {result.status}). {formatDate(result.operation.date)} ·{' '}
              {formatRub(result.operation.amount)} записан как расход.
            </div>
            {result.warning?.gapGrows && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
                <b>Внимание:</b> этот платёж увеличивает кассовый разрыв
                {result.warning.newGapAmount != null ? ` — новая сумма: ${formatRub(result.warning.newGapAmount)}` : ''}.
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Загрузить выписку из банка">
        <p className="mb-2 text-xs text-slate-500">
          CSV выписки (формат тестовых данных или стандартный 7-колоночный). Операции записываются в базу
          и сразу учитываются в прогнозе, календаре и истории.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-400 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-200 hover:file:bg-slate-600"
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={replacePrev}
            onChange={(e) => setReplacePrev(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-800"
          />
          Заменить ранее импортированные операции
        </label>
        {imported && (
          <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
            Импортировано: {imported.imported}
            {imported.skipped > 0 ? ` (дубли пропущены: ${imported.skipped})` : ''}
            {imported.removed > 0 ? `, удалено прежних: ${imported.removed}` : ''}
            {imported.companyId ? ` · компания ${imported.companyId}` : ''}
          </div>
        )}
        {importError && <p className="mt-2 text-xs text-rose-400">{importError}</p>}
        <div className="mt-3">
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={importBusy} disabled={!file} onClick={uploadStatement}>
            Загрузить и записать в БД
          </Button>
        </div>
      </Card>

      <Card
        title="Подтянуть операции из банка"
        action={
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={pullBusy} onClick={pull}>
            Подтянуть
          </Button>
        }
      >
        {pullError && <p className="mb-2 text-xs text-rose-400">{pullError}</p>}
        {pulled == null ? (
          <EmptyState title="Данных пока нет" hint="Заглушка банка вернёт последние операции со счёта" />
        ) : pulled.length === 0 ? (
          <EmptyState title="Операций не найдено" />
        ) : (
          <ul className="divide-y divide-slate-800">
            {pulled.map((op) => (
              <li key={op.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-200">{op.counterpartyName}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDate(op.date)} · {op.purpose}
                  </p>
                </div>
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    op.direction === 'in' ? 'text-emerald-400' : 'text-rose-400',
                  )}
                >
                  {op.direction === 'in' ? '+' : '−'}
                  {formatRub(op.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
