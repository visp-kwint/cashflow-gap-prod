import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ForecastResult } from '@/types/api';
import { formatRub, formatRubShort } from '@/lib/format';

/** Группирует опасные дни в непрерывные интервалы для красных зон (как на графике дашборда) */
function dangerRanges(dangerDays: string[], allDates: string[]): Array<[string, string]> {
  const set = new Set(dangerDays);
  const ranges: Array<[string, string]> = [];
  let start: string | null = null;
  let prev = '';
  for (const date of allDates) {
    if (set.has(date)) {
      if (!start) start = date;
      prev = date;
    } else if (start) {
      ranges.push([start, prev]);
      start = null;
    }
  }
  if (start) ranges.push([start, prev]);
  return ranges;
}

/** Сравнение «базовый прогноз vs сценарий» для песочницы. Красные зоны — где сценарий уходит ниже порога T. */
export function ScenarioCompareChart({
  base,
  scenario,
  height = 260,
}: {
  base: ForecastResult;
  scenario: ForecastResult;
  height?: number;
}) {
  const byDate = new Map<string, { date: string; base?: number; scenario?: number }>();
  for (const p of base.series) byDate.set(p.date, { date: p.date, base: p.balance });
  for (const p of scenario.series) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row.scenario = p.balance;
    byDate.set(p.date, row);
  }
  const data = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

  // Если бэк не прислал dangerDays сценария — считаем сами по порогу
  const dangerDays =
    scenario.dangerDays && scenario.dangerDays.length > 0
      ? scenario.dangerDays
      : data.filter((r) => r.scenario != null && (scenario.threshold ?? 0) > 0 && r.scenario < (scenario.threshold ?? 0)).map((r) => r.date);
  const ranges = dangerRanges(dangerDays, data.map((r) => r.date));
  const threshold = scenario.threshold ?? 0;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3a3b41" />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => d.slice(5)}
          tick={{ fontSize: 11, fill: '#979aa1' }}
          minTickGap={28}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => formatRubShort(v)}
          tick={{ fontSize: 11, fill: '#979aa1' }}
          width={72}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(value, name) => [formatRub(Number(value)), String(name)]}
          contentStyle={{
            backgroundColor: '#3a3b41',
            border: '1px solid #4a4b52',
            borderRadius: 8,
            fontSize: 12,
            color: '#f5f5f6',
          }}
          labelStyle={{ color: '#979aa1' }}
          itemStyle={{ color: '#f5f5f6' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#979aa1' }} />
        {threshold > 0 && <ReferenceLine y={threshold} stroke="#f43f5e" strokeDasharray="4 4" />}
        {ranges.map(([from, to]) => (
          <ReferenceArea
            key={`${from}-${to}`}
            x1={from}
            x2={to}
            fill="#f43f5e"
            fillOpacity={0.08}
            stroke="#f43f5e"
            strokeOpacity={0.25}
          />
        ))}
        <Line dataKey="base" name="Базовый прогноз" stroke="#979aa1" strokeWidth={2} strokeDasharray="6 4" dot={false} />
        <Line dataKey="scenario" name="Сценарий" stroke="#9cad76" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
