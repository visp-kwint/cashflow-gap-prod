import { useState } from 'react';
import { Check, FileSpreadsheet, Landmark, Network, ReceiptText, X } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { IntegrationProvider } from '@/types/api';

interface ProviderDef {
  code: IntegrationProvider;
  title: string;
  hint: string;
  icon: typeof Network;
}

const PROVIDERS: ProviderDef[] = [
  { code: '1c', title: '1С:Бухгалтерия', hint: 'Счета и договоры', icon: FileSpreadsheet },
  { code: 'edo', title: 'ЭДО (Диадок / СБИС)', hint: 'Договоры и акты', icon: Network },
  { code: 'tax-calendar', title: 'Налоговый календарь ФНС', hint: 'ЕНП, УСН, НДС', icon: Landmark },
  { code: 'marketplace', title: 'Маркетплейсы и ОФД', hint: 'Выплаты за продажи', icon: ReceiptText },
];

// Постоянный статус «когда обновлено»: переживает перезагрузку страницы,
// сбрасывается новой синхронизацией либо снятием синхронизации.
const SYNCED_KEY = 'cf-integrations-synced';
function loadSynced(): Partial<Record<IntegrationProvider, string>> {
  try {
    return JSON.parse(localStorage.getItem(SYNCED_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveSynced(map: Partial<Record<IntegrationProvider, string>>) {
  localStorage.setItem(SYNCED_KEY, JSON.stringify(map));
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Блок синхронизации внешних систем (ТЗ-доп. §5): мультивыбор источников,
 *  постоянный статус, снятие синхронизации, колбэк перечитывания плановых событий. */
export function IntegrationsPanel({ onSynced }: { onSynced?: () => void }) {
  const [selected, setSelected] = useState<Set<IntegrationProvider>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState<IntegrationProvider | null>(null);
  const [synced, setSynced] = useState<Partial<Record<IntegrationProvider, string>>>(loadSynced);
  const [error, setError] = useState<string | null>(null);

  function toggle(code: IntegrationProvider) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function runSync() {
    if (selected.size === 0 || syncing) return;
    setSyncing(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      // последовательно: источники изолированы (idempotency по source), порядок исключает гонки
      for (const code of selected) {
        await api.integrations.sync(code);
        setSynced((cur) => {
          const next = { ...cur, [code]: now };
          saveSynced(next);
          return next;
        });
      }
      onSynced?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSyncing(false);
      setSelected(new Set());
    }
  }

  // Снять синхронизацию: удалить незакрытые события источника, сбросить штамп
  async function runUnsync(code: IntegrationProvider) {
    setRemoving(code);
    setError(null);
    try {
      await api.integrations.unsync(code);
      setSynced((cur) => {
        const next = { ...cur };
        delete next[code];
        saveSynced(next);
        return next;
      });
      onSynced?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card title="Синхронизация">
      <div className="grid grid-cols-2 gap-2">
        {PROVIDERS.map((p) => {
          const Icon = p.icon;
          const isSelected = selected.has(p.code);
          const stamp = synced[p.code];
          return (
            <div
              key={p.code}
              role="button"
              tabIndex={0}
              onClick={() => toggle(p.code)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') toggle(p.code);
              }}
              className={[
                'flex cursor-pointer flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                isSelected ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-700 bg-slate-800/60 hover:bg-slate-800',
                syncing ? 'opacity-60' : '',
              ].join(' ')}
            >
              <span className="flex w-full items-center gap-2">
                {stamp ? <Check size={16} className="shrink-0 text-emerald-400" /> : <Icon size={16} className="shrink-0 text-slate-400" />}
                <span className="min-w-0 truncate text-sm font-medium text-slate-200">{p.title}</span>
                {isSelected && <span className="ml-auto shrink-0 rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-semibold text-emerald-400">выбран</span>}
                {stamp && (
                  <button
                    type="button"
                    title="Убрать синхронизацию (удалит незакрытые события источника)"
                    aria-label={`Убрать синхронизацию: ${p.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void runUnsync(p.code);
                    }}
                    disabled={removing === p.code}
                    className="ml-auto shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
                  >
                    <X size={13} />
                  </button>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {stamp ? `Обновлено ${fmtTime(stamp)}` : p.hint}
                {removing === p.code ? ' · удаляю…' : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2">
        <Button
          size="sm"
          variant="secondary"
          loading={syncing}
          disabled={selected.size === 0}
          onClick={runSync}
          className="w-full sm:w-auto"
        >
          {syncing
            ? 'Синхронизация…'
            : selected.size > 1
              ? `Синхронизировать выбранные (${selected.size})`
              : selected.size === 1
                ? 'Синхронизировать'
                : 'Выберите источники'}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </Card>
  );
}
