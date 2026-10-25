import { useState, useEffect, type FormEvent } from 'react';
import { Info } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { Button, Card, Field, Input, Select } from '@/components/ui';
import { ScenarioCompareChart } from '@/components/charts/ScenarioCompareChart';
import { NegativeScenarioChart } from '@/components/charts/NegativeScenarioChart';
import { cn } from '@/lib/cn';
import { formatDate, formatRub, formatSignedRub, todayISO } from '@/lib/format';
import type {
  SandboxDirection,
  SandboxSimulateResponse,
  ScenarioClient,
  ScenarioItem,
  ScenarioSimulateResponse,
} from '@/types/api';

export default function Sandbox() {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [direction, setDirection] = useState<SandboxDirection>('out');
  const [repeats, setRepeats] = useState('1');
  // ТЗ-доработка WP-4: отрицательные сценарии «что, если»
  const [excludeLoans, setExcludeLoans] = useState(false);
  const [excludeClientPayments, setExcludeClientPayments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SandboxSimulateResponse | null>(null);

  // ТЗ-доработка WP-4: негативные сценарии «что если» (отдельный блок, API /scenarios)
  const [negEnabled, setNegEnabled] = useState<Record<string, boolean>>({
    client_delay: false,
    revenue_drop: false,
    unplanned_expense: false,
    fixed_costs_growth: false,
  });
  const [negClient, setNegClient] = useState<ScenarioClient | null>(null);
  const [negClients, setNegClients] = useState<ScenarioClient[]>([]);
  const [negDays, setNegDays] = useState('21');
  const [negRevenuePct, setNegRevenuePct] = useState('20');
  const [negExpAmount, setNegExpAmount] = useState('');
  const [negExpDate, setNegExpDate] = useState(todayISO());
  const [negFixedPct, setNegFixedPct] = useState('15');
  const [negBusy, setNegBusy] = useState(false);
  const [negError, setNegError] = useState<string | null>(null);
  const [negResult, setNegResult] = useState<ScenarioSimulateResponse | null>(null);

  // Prefill для client_delay: топ-5 клиентов по доле в поступлениях за 6 мес.
  useEffect(() => {
    api.scenarios
      .clients()
      .then((r) => {
        setNegClients(r.clients);
        if (r.clients[0]) setNegClient(r.clients[0]);
      })
      .catch(() => setNegClients([]));
  }, []);

  async function negSubmit(e: FormEvent) {
    e.preventDefault();
    const scenarios: ScenarioItem[] = [];
    if (negEnabled.client_delay) {
      if (!negClient?.inn) {
        setNegError('Для «Клиент задерживает оплату» выберите клиента');
        return;
      }
      const days = Number(negDays);
      if (!Number.isInteger(days) || days < 14 || days > 28) {
        setNegError('Задержка: целое от 14 до 28 дней');
        return;
      }
      scenarios.push({ type: 'client_delay', params: { inn: negClient.inn, days } });
    }
    if (negEnabled.revenue_drop) {
      const p = Number(negRevenuePct);
      if (!Number.isInteger(p) || p < 0 || p > 30) {
        setNegError('Спад выручки: целое от 0 до 30 %');
        return;
      }
      scenarios.push({ type: 'revenue_drop', params: { percent: p } });
    }
    if (negEnabled.unplanned_expense) {
      const a = Number(negExpAmount);
      if (!Number.isFinite(a) || a <= 0) {
        setNegError('Незапланированный расход: сумма должна быть больше нуля');
        return;
      }
      scenarios.push({ type: 'unplanned_expense', params: { amount: a, date: negExpDate } });
    }
    if (negEnabled.fixed_costs_growth) {
      const p = Number(negFixedPct);
      if (!Number.isInteger(p) || p < 0 || p > 50) {
        setNegError('Рост постоянных расходов: целое от 0 до 50 %');
        return;
      }
      scenarios.push({ type: 'fixed_costs_growth', params: { percent: p } });
    }
    if (scenarios.length === 0) {
      setNegError('Выберите хотя бы один негативный сценарий');
      return;
    }
    setNegBusy(true);
    setNegError(null);
    try {
      setNegResult(await api.scenarios.simulate({ scenarios }));
    } catch (err) {
      setNegError(errorMessage(err));
    } finally {
      setNegBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    const rep = Number(repeats);
    if (!name.trim()) {
      setError('Укажите название сценария');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Сумма должна быть больше нуля');
      return;
    }
    if (!Number.isInteger(rep) || rep < 1) {
      setError('Повторение: целое число от 1 (1 = одноразово)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.sandbox.simulate({
          name: name.trim(),
          amount: value,
          date,
          direction,
          repeats: rep,
          excludeLoans,
          excludeClientPayments,
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const probDelta = result?.delta.gapProbabilityPct ?? 0;
  const amountDelta = result?.delta.gapAmount ?? 0;

  return (
    <div className="space-y-4">
      <Card title="Песочница: сценарий без последствий">
        <p className="mb-3 text-sm text-slate-400">
          Эмулируйте возможную трату или доход (например, покупку автомобиля) — система посчитает
          сценарный прогноз на тех же данных и покажет разницу.
        </p>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Название" hint="Например: Покупка автомобиля">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
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
          <Field label="Тип">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as SandboxDirection)}>
              <option value="out">Расход</option>
              <option value="in">Доход</option>
            </Select>
          </Field>
          <Field label="Повторение" hint="1 — одноразово, N — ежемесячно N раз">
            <Input type="number" min="1" step="1" value={repeats} onChange={(e) => setRepeats(e.target.value)} />
          </Field>
          {/* ТЗ-доработка WP-4: отрицательные сценарии «что, если» */}
          <div className="rounded-lg bg-slate-800/60 p-3 sm:col-span-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Отрицательные сценарии «что, если»
            </p>
            <div className="flex flex-wrap gap-4 text-sm text-slate-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={excludeLoans}
                  onChange={(e) => setExcludeLoans(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
                Займ не получен (плановые поступления по кредитам/займам не приходят)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={excludeClientPayments}
                  onChange={(e) => setExcludeClientPayments(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
                Оплата от клиента не получена (плановые оплаты по договорам/счётам не приходят)
              </label>
            </div>
          </div>
          <div className="sm:col-span-2 sm:flex sm:justify-end">
            <Button type="submit" loading={busy} className="w-full sm:w-56">
              Рассчитать сценарий
            </Button>
          </div>
          {error && <p className="text-xs text-rose-400 sm:col-span-2">{error}</p>}
        </form>
      </Card>

      {/* ТЗ-доработка WP-4: негативные сценарии «что если» — 4 карточки + расчёт */}
      <Card title="Негативные сценарии «что если»">
        <p className="mb-3 text-sm text-slate-400">
          Выберите, какие негативные сценарии проверить — система пересчитает прогноз на тех же данных
          и покажет, как изменятся дата, сумма и вероятность разрыва. Сценарии применяются внутри
          расчёта (не создаются фиктивные операции).
        </p>
        <form onSubmit={negSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* client_delay */}
            <div className={cn('rounded-lg border p-3', negEnabled.client_delay ? 'border-rose-500/50 bg-rose-500/5' : 'border-slate-700 bg-slate-800/60')}>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={negEnabled.client_delay}
                  onChange={(e) => setNegEnabled((s) => ({ ...s, client_delay: e.target.checked }))}
                  className="h-4 w-4 accent-rose-500"
                />
                <span className="text-sm font-medium text-slate-200">Клиент задерживает оплату</span>
              </label>
              {negEnabled.client_delay && (
                <div className="mt-3 grid gap-2">
                  <Field label="Клиент" hint={negClients.length ? 'Топ-5 по долям за 6 мес.' : 'Нет клиентов с поступлениями'}>
                    <Select
                      value={negClient?.inn ?? ''}
                      onChange={(e) => {
                        const c = negClients.find((x) => x.inn === e.target.value) ?? null;
                        setNegClient(c);
                      }}
                    >
                      {negClients.length === 0 && <option value="">—</option>}
                      {negClients.map((c) => (
                        <option key={c.inn} value={c.inn}>
                          {c.name} ({c.sharePct}%)
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Задержка, дней" hint="14–28">
                    <Input type="number" min="14" max="28" value={negDays} onChange={(e) => setNegDays(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
            {/* revenue_drop */}
            <div className={cn('rounded-lg border p-3', negEnabled.revenue_drop ? 'border-rose-500/50 bg-rose-500/5' : 'border-slate-700 bg-slate-800/60')}>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={negEnabled.revenue_drop}
                  onChange={(e) => setNegEnabled((s) => ({ ...s, revenue_drop: e.target.checked }))}
                  className="h-4 w-4 accent-rose-500"
                />
                <span className="text-sm font-medium text-slate-200">Спад выручки</span>
              </label>
              {negEnabled.revenue_drop && (
                <div className="mt-3">
                  <Field label="Спад, %" hint="0–30 (0 = нулевой сценарий)">
                    <Input type="number" min="0" max="30" value={negRevenuePct} onChange={(e) => setNegRevenuePct(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
            {/* unplanned_expense */}
            <div className={cn('rounded-lg border p-3', negEnabled.unplanned_expense ? 'border-rose-500/50 bg-rose-500/5' : 'border-slate-700 bg-slate-800/60')}>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={negEnabled.unplanned_expense}
                  onChange={(e) => setNegEnabled((s) => ({ ...s, unplanned_expense: e.target.checked }))}
                  className="h-4 w-4 accent-rose-500"
                />
                <span className="text-sm font-medium text-slate-200">Незапланированный расход</span>
              </label>
              {negEnabled.unplanned_expense && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Field label="Сумма">
                    <Input type="number" min="0.01" step="0.01" placeholder="0,00" value={negExpAmount} onChange={(e) => setNegExpAmount(e.target.value)} />
                  </Field>
                  <Field label="Дата" hint="Не раньше завтра">
                    <Input type="date" value={negExpDate} onChange={(e) => setNegExpDate(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
            {/* fixed_costs_growth */}
            <div className={cn('rounded-lg border p-3', negEnabled.fixed_costs_growth ? 'border-rose-500/50 bg-rose-500/5' : 'border-slate-700 bg-slate-800/60')}>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={negEnabled.fixed_costs_growth}
                  onChange={(e) => setNegEnabled((s) => ({ ...s, fixed_costs_growth: e.target.checked }))}
                  className="h-4 w-4 accent-rose-500"
                />
                <span className="text-sm font-medium text-slate-200">Рост постоянных расходов</span>
              </label>
              {negEnabled.fixed_costs_growth && (
                <div className="mt-3">
                  <Field label="Рост, %" hint="0–50 (0 = нулевой сценарий)">
                    <Input type="number" min="0" max="50" value={negFixedPct} onChange={(e) => setNegFixedPct(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          </div>
          <div className="sm:flex sm:justify-end">
            <Button type="submit" loading={negBusy} variant="secondary" className="w-full sm:w-56">
              Рассчитать негативные сценарии
            </Button>
          </div>
          {negError && <p className="text-xs text-rose-400">{negError}</p>}
        </form>

        {negResult && (
          <div className="mt-4 space-y-3">
            <NegativeScenarioChart base={negResult.base} scenario={negResult.scenario} />
            <p className="text-xs text-slate-500">
              Полоса p10–p90 — неопределённость сценария; красные зоны — дни ниже порога T; маркер — день разрыва.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 pr-4 sm:pr-6">Параметр</th>
                    <th className="pb-2 pr-4 sm:pr-6">База</th>
                    <th className="pb-2 pr-4 sm:pr-6">Сценарий</th>
                    <th className="pb-2">Разница</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  <tr>
                    <td className="py-2 pr-4 text-slate-400 sm:pr-6">Дата разрыва</td>
                    <td className="whitespace-nowrap pr-4 sm:pr-6">{negResult.base.gapDate ? formatDate(negResult.base.gapDate) : '—'}</td>
                    <td className="whitespace-nowrap pr-4 sm:pr-6">{negResult.scenario.gapDate ? formatDate(negResult.scenario.gapDate) : '—'}</td>
                    <td className={cn('font-medium', negResult.delta.gapDateShiftDays > 0 ? 'text-rose-400' : 'text-slate-400')}>
                      {negResult.delta.gapDateShiftDays > 0 ? `+${negResult.delta.gapDateShiftDays} дн.` : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 text-slate-400 sm:pr-6">Сумма разрыва</td>
                    <td className="whitespace-nowrap pr-4 sm:pr-6">{formatRub(negResult.base.gapAmount)}</td>
                    <td className="whitespace-nowrap pr-4 sm:pr-6">{formatRub(negResult.scenario.gapAmount)}</td>
                    <td className={cn('font-medium', negResult.delta.gapAmount > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                      {formatSignedRub(negResult.delta.gapAmount)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 text-slate-400 sm:pr-6">Вероятность разрыва</td>
                    <td className="whitespace-nowrap pr-4 sm:pr-6">{Math.round(negResult.base.gapProbabilityPct)}%</td>
                    <td className="whitespace-nowrap pr-4 sm:pr-6">{Math.round(negResult.scenario.gapProbabilityPct)}%</td>
                    <td className={cn('font-medium', negResult.delta.gapProbabilityPct > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                      {negResult.delta.gapProbabilityPct > 0 ? '+' : ''}
                      {Math.round(negResult.delta.gapProbabilityPct)} п.п.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 text-slate-400 sm:pr-6">Мин. остаток</td>
                    <td className="whitespace-nowrap pr-4 sm:pr-6">{negResult.base.minBalance != null ? formatRub(negResult.base.minBalance) : '—'}</td>
                    <td className="whitespace-nowrap pr-4 sm:pr-6">{negResult.scenario.minBalance != null ? formatRub(negResult.scenario.minBalance) : '—'}</td>
                    <td className={cn('font-medium', negResult.delta.minBalance < 0 ? 'text-rose-400' : 'text-slate-400')}>
                      {formatSignedRub(negResult.delta.minBalance)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-slate-800 p-3 text-xs text-slate-400">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                {negResult.scenario.gapDate
                  ? `Чтобы закрыть разрыв в сценарии, в день разрыва (${formatDate(negResult.scenario.gapDate)}) нужно внести ${formatRub(negResult.scenario.gapAmount)}.`
                  : 'В выбранном сценарии разрыва не образуется — при текущих поступлениях остаток остаётся выше порога.'}
              </span>
            </div>
          </div>
        )}
      </Card>

      {result && (
        <Card title={`Сравнение: ${result.base.series.length > 0 ? 'базовый прогноз vs сценарий' : 'сценарий'}`}>
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4 sm:pr-6">Параметр</th>
                  <th className="pb-2 pr-4 sm:pr-6">Базовый прогноз</th>
                  <th className="pb-2 pr-4 sm:pr-6">Сценарий</th>
                  <th className="pb-2">Изменение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                <tr>
                  <td className="py-2 pr-4 text-slate-400 sm:pr-6">Дата разрыва</td>
                  <td className="whitespace-nowrap pr-4 sm:pr-6">{result.base.gapDate ? formatDate(result.base.gapDate) : '—'}</td>
                  <td className="whitespace-nowrap pr-4 sm:pr-6">{result.scenario.gapDate ? formatDate(result.scenario.gapDate) : '—'}</td>
                  <td className="text-slate-400">—</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-slate-400 sm:pr-6">Вероятность разрыва</td>
                  <td className="whitespace-nowrap pr-4 sm:pr-6">{result.base.gapProbabilityPct != null ? `${Math.round(result.base.gapProbabilityPct)}%` : '—'}</td>
                  <td className="whitespace-nowrap pr-4 sm:pr-6">{result.scenario.gapProbabilityPct != null ? `${Math.round(result.scenario.gapProbabilityPct)}%` : '—'}</td>
                  <td
                    className={cn(
                      'font-medium',
                      probDelta > 0 ? 'text-rose-400' : probDelta < 0 ? 'text-emerald-400' : 'text-slate-400',
                    )}
                  >
                    {probDelta > 0 ? '+' : ''}
                    {Math.round(probDelta)} п.п.
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-slate-400 sm:pr-6">Сумма разрыва</td>
                  <td className="whitespace-nowrap pr-4 sm:pr-6">{formatRub(result.base.gapAmount)}</td>
                  <td className="whitespace-nowrap pr-4 sm:pr-6">{formatRub(result.scenario.gapAmount)}</td>
                  <td
                    className={cn(
                      'font-medium',
                      amountDelta > 0 ? 'text-rose-400' : amountDelta < 0 ? 'text-emerald-400' : 'text-slate-400',
                    )}
                  >
                    {formatSignedRub(amountDelta)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <ScenarioCompareChart base={result.base} scenario={result.scenario} />
          <p className="mt-2 text-xs text-slate-500">
            Красные зоны — дни, где остаток сценария ниже порога T (кассовый разрыв).
          </p>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-800 p-3 text-xs text-slate-400">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              Данные песочницы не сохраняются в реальные операции и не влияют на основной прогноз.
              {result.excludedEvents ? ` Отрицательным сценарием выключено плановых поступлений: ${result.excludedEvents}.` : ''}
            </span>
          </div>
        </Card>
      )}

      {!result && (
        <p className="text-xs text-slate-400">
          После расчёта здесь появятся сравнение вероятности и суммы разрыва, а также графики базового
          прогноза и сценария.
        </p>
      )}
    </div>
  );
}
