import {
  Bar,
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
import type { ForecastPoint } from '@/types/api';
import { formatRub, formatRubShort } from '@/lib/format';

/** Группирует опасные дни в непрерывные интервалы для красных зон графика */
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

export function ForecastChart({
  series,
  dangerDays = [],
  threshold = 0,
  height = 280,
}: {
  series: ForecastPoint[];
  dangerDays?: string[];
  threshold?: number;
  height?: number;
}) {
  const ranges = dangerRanges(dangerDays, series.map((p) => p.date));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          labelFormatter={(label) => String(label).slice(0, 10)}
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
        <ReferenceLine y={threshold} stroke="#f43f5e" strokeDasharray="4 4" />
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
        <Bar dataKey="income" name="Доход" fill="#9cad76" fillOpacity={0.65} barSize={5} />
        <Bar dataKey="expense" name="Расход" fill="#5f616a" fillOpacity={0.65} barSize={5} />
        <Line dataKey="balance" name="Прогноз остатка" stroke="#b9ca9d" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
