import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { Button, Card, Field, Input } from '@/components/ui';
import { formatDate, formatRub } from '@/lib/format';
import type { BankLoanResponse } from '@/types/api';

export default function BankStub() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const dashboard = useAsync(() => api.dashboard(30), []);
  const gapAmount = dashboard.data?.forecast.gapAmount ?? 0;
  const paramAmount = params.get('amount');

  const [amount, setAmount] = useState(paramAmount ?? '');
  const [prefilled, setPrefilled] = useState(paramAmount != null);
  const [termDays, setTermDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BankLoanResponse | null>(null);

  useEffect(() => {
    // Сумма займа по умолчанию — размер разрыва
    if (!prefilled && gapAmount > 0) {
      setAmount(String(Math.round(gapAmount)));
      setPrefilled(true);
    }
  }, [gapAmount, prefilled]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Укажите сумму больше нуля');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.bank.loan({ amount: value, termDays: Number(termDays) || 30 }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-300">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>Демо-режим: интеграция с банком в разработке. Заявка обрабатывается заглушкой, деньги не списываются.</p>
      </div>

      {result ? (
        <Card title="Заявка одобрена (демо)">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Сумма займа</dt>
              <dd className="font-medium tabular-nums">{formatRub(result.operation.amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Условная ставка (константа демо)</dt>
              <dd className="font-medium tabular-nums">{result.ratePct}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Дата зачисления</dt>
              <dd className="font-medium">{formatDate(result.operation.date)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Зачисление создано как операция «bank_loan» и уже учтено в прогнозе — кассовый разрыв уменьшен.
          </p>
          <div className="mt-4">
            <Button onClick={() => navigate('/')}>Перейти на главную</Button>
          </div>
        </Card>
      ) : (
        <Card title="Запрос у банка">
          {dashboard.data?.forecast.gapDate && (
            <p className="mb-3 text-sm text-slate-400">
              Ближайший разрыв — <b>{formatDate(dashboard.data.forecast.gapDate)}</b> на{' '}
              <b>{formatRub(dashboard.data.forecast.gapAmount)}</b>. Сумма займа подставлена автоматически.
            </p>
          )}
          <form onSubmit={submit} className="space-y-3">
            <Field label="Сумма займа">
              <Input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Срок (дней)">
              <Input type="number" min="1" step="1" value={termDays} onChange={(e) => setTermDays(e.target.value)} />
            </Field>
            {dashboard.data?.loanRatePct != null && (
              <p className="text-xs text-slate-500">
                Условная ставка: <b className="tabular-nums">{dashboard.data.loanRatePct}%</b> — фиксированная
                константа из конфига (демо).
              </p>
            )}
            {error && <p className="text-xs text-rose-400">{error}</p>}
            <Button type="submit" loading={busy}>
              Оформить
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
