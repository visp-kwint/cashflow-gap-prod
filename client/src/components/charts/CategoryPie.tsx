import { useEffect, useState } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatRub } from '@/lib/format';
import './category-pie.css';

/**
 * Палитра «In Color Balance»: шалфей/олива — доходные категории,
 * серо-голубые — расходные, оливковый — налоги. Rose (#f43f5e) зарезервана
 * только под danger и для сегментов не используется.
 */
const CATEGORY_COLORS: Record<string, string> = {
  income: '#7f915f', // доход — шалфей
  salary: '#9cad76', // зарплата — светлый шалфей
  expense: '#7c7e86', // расход — серо-голубой
  payment: '#5f616a', // платёж — тёмный серо-голубой
  tax: '#495736', // налоги — тёмная олива
  other: '#979aa1', // прочее — нейтральный серый
};

// Стабильный fallback для неизвестных ключей: цвет зависит только от ключа,
// а не от позиции в списке, чтобы при добавлении категорий цвета не прыгали.
const FALLBACK_PALETTE = ['#9cad76', '#979aa1', '#7f915f', '#7c7e86', '#495736', '#5f616a'];
function fallbackColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}
const colorFor = (key: string) => CATEGORY_COLORS[key] ?? fallbackColor(key);

function PieTooltip({
  active,
  payload,
  items,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; payload?: { fill?: string; label?: string } }>;
  items: Array<{ value: number }>;
}) {
  if (!active || !payload?.length) return null;
  const total = items.reduce((sum, it) => sum + it.value, 0);
  const item = payload[0];
  const value = Number(item.value) || 0;
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  const color = item.payload?.fill ?? '#979aa1';
  const name = item.payload?.label ?? item.name ?? '';
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100 shadow-xl">
      <div className="flex items-center gap-2 font-medium">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
        {name}
      </div>
      <div className="mt-1 tabular-nums">{formatRub(value)} · {share}%</div>
      <div className="mt-0.5 text-slate-400">всего {formatRub(total)}</div>
    </div>
  );
}

// Узкий экран (телефон): легенду переносим снизу сеткой 2×N — вертикальная легенда
// реcharts вбок сжимает пирог и диаграмма «поехалой» (сегменты наезжают на подписи).
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function CategoryPie({
  items,
  height = 240,
}: {
  items: Array<{ key: string; label: string; value: number }>;
  height?: number;
}) {
  const narrow = useNarrow();
  const data = items.map((it) => ({ ...it, fill: colorFor(it.key) }));
  return (
    <div className="category-pie-enter">
      <ResponsiveContainer width="100%" height={narrow ? Math.max(height, 260) : height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={62}
            outerRadius={96}
            paddingAngle={3}
            stroke="#1f2024"
            strokeWidth={2}
            isAnimationActive
            animationBegin={120}
            animationDuration={800}
            animationEasing="ease-out"
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip items={items} />} />
          {!narrow && (
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              iconSize={12}
              wrapperStyle={{ fontSize: 12, color: '#979aa1', lineHeight: 1.8 }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      {narrow && (
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-400">
          {data.map((d) => (
            <li key={d.key} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.fill }} />
              <span className="leading-tight">{d.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
