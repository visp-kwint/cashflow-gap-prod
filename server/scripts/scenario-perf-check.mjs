// server/scripts/scenario-perf-check.mjs — ТЗ-доработка WP-4 (гейт G34):
// производительность: 4 сценария, горизонт 90, выписка 2 года — полный simulate
// (base + комбинированный + 4 изолированных расчёта) < 3 с.
import { calculateForecast } from '../src/services/forecast.service.js';

function makeTwoYearHistory(todayDay) {
  const iso = (d) => new Date(d * 86_400_000).toISOString().slice(0, 10);
  const ops = [];
  for (let d = todayDay - 730; d < todayDay; d++) {
    if (d % 7 === 0) ops.push({ date: iso(d), amount: 8000, direction: 'in', counterpartyInn: '1111', subcategory: 'revenue_clients' });
    if (d % 5 === 0) ops.push({ date: iso(d), amount: 2500 + (d % 30) * 80, direction: 'in', counterpartyInn: '2222', subcategory: 'revenue_clients' });
    ops.push({ date: iso(d), amount: 500 + (d % 10) * 60, direction: 'out', subcategory: 'other' });
    if (d % 14 === 3) ops.push({ date: iso(d), amount: 20000, direction: 'out', subcategory: 'rent' });
    if (d % 14 === 10) ops.push({ date: iso(d), amount: 15000, direction: 'out', subcategory: 'suppliers' });
  }
  return { ops, iso };
}

export function perfCheck() {
  const TODAY = 20454; // 2026-10-01
  const { ops, iso } = makeTwoYearHistory(TODAY);
  const scenarios = [
    { type: 'client_delay', params: { inn: '1111', days: 21 } },
    { type: 'revenue_drop', params: { percent: 20 } },
    { type: 'unplanned_expense', params: { amount: 100000, date: iso(TODAY + 14) } },
    { type: 'fixed_costs_growth', params: { percent: 15 } },
  ];
  const opts = { today: iso(TODAY), seed: 42 };
  const t0 = process.hrtime.bigint();
  // полный simulate = base + комбинированный + 4 изолированных
  calculateForecast(ops, [], 1000000, 90, 0, opts);
  calculateForecast(ops, [], 1000000, 90, 0, { ...opts, scenarios });
  for (const s of scenarios) calculateForecast(ops, [], 1000000, 90, 0, { ...opts, scenarios: [s] });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (ms >= 3000) {
    console.error(`PERF-FAIL: ${ms.toFixed(0)} ms ≥ 3000 ms`);
    process.exit(1);
  }
  console.log(`PERF-OK: полный simulate (6 расчётов, 4 сценария, H=90, 2 года выписки) = ${ms.toFixed(0)} ms`);
}

if (process.argv[1] && process.argv[1].endsWith('scenario-perf-check.mjs')) {
  perfCheck();
}
