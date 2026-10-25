import {
  Area,
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
import type { ScenarioContract } from '@/types/api';
import { formatRub, formatRubShort } from '@/lib/format';

/** Группирует опасные дни в непрерывные интервалы для красных зон. */
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

/**
 * ТЗ-доработка WP-4: сравнение «база vs негативные сценарии» (POST /scenarios/simulate).
 * Две линии (база/сценарий), полоса p10–p90 сценария, красная зона ниже порога T,
 * маркер дня разрыва (gapDate) и порога.
 */
export function NegativeScenarioChart({
  base,
  scenario,
  height = 280,
}: {
  base: ScenarioContract;
  scenario: ScenarioContract;
  height?: number;
}) {
  const byDate = new Map<string, { date: string; base?: number; scenario?: number; p10?: number | null; p90?: number | null; bandWidth?: number }>();
  for (const p of base.series) byDate.set(p.date, { date: p.date, base: p.balance });
  for (const p of scenario.series) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row.scenario = p.balance;
    row.p10 = p.p10;
    row.p90 = p.p90;
    // Полоса p10–p90 для stacked-Area: шина = p90 − p10 (поверх прозрачного p10)
    row.bandWidth = p.p10 != null && p.p90 != null ? p.p90 - p.p10 : 0;
    byDate.set(p.date, row);
  }
  const data = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

  const dangerDays = scenario.dangerDays?.length ? scenario.dangerDays : [];
  const ranges = dangerRanges(dangerDays, data.map((r) => r.date));
  const threshold = scenario.threshold ?? 0;

  // Маркер дня разрыва сценария (ReferenceLine по категориальной оси X)
  const gapDate = scenario.gapDate;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3a3b41" />
        <defs>
          <linearGradient id="negScenarioBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.04} />
          </linearGradient>
        </defs>
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
          formatter={(value: number | string, name: string) => [formatRub(Number(value)), String(name)]}
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
        {gapDate && data.some((r) => r.date === gapDate) && (
          <ReferenceLine
            x={gapDate}
            stroke="#f43f5e"
            strokeWidth={1.5}
            label={{ value: 'Разрыв', fontSize: 10, fill: '#f43f5e', position: 'top' }}
          />
        )}
        {/* Полоса неопределённости сценария p10–p90 (stacked Area: прозрачное p10 + ширина p90−p10) */}
        <Area dataKey="p10" name="p10 сценария" stackId="band" stroke="#f59e0b" strokeOpacity={0.5} strokeWidth={1} fill="transparent" connectNulls />
        <Area
          dataKey="bandWidth"
          name="p90 сценария"
          stackId="band"
          stroke="#f59e0b"
          strokeOpacity={0.3}
          strokeWidth={1}
          fill="url(#negScenarioBand)"
          connectNulls
        />
        <Line dataKey="base" name="Базовый прогноз" stroke="#979aa1" strokeWidth={2} strokeDasharray="6 4" dot={false} />
        <Line dataKey="scenario" name="Сценарий" stroke="#9cad76" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
