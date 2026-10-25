import fs from 'node:fs';
import { calculateForecast } from './work/server/src/services/forecast.service.js';
import { FORECAST_CONFIG } from './work/server/src/config/forecast.config.js';

const file = process.argv[2];
const H = Number(process.argv[3] ?? 30);
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1).map((l) => l.split(';'));
const ops = rows.map((c) => ({ date: new Date(c[2]), amount: Number(c[3]), direction: c[4] === 'Поступление' ? 'in' : 'out', counterpartyInn: c[5], counterpartyName: c[6], purpose: c[7], source: 'import', bal: Number(c[8]), iso: c[2] }));
const isSweep = (o) => FORECAST_CONFIG.internalTransferPattern.test(o.purpose);
const DAY = 86400000, iso = (t) => new Date(t).toISOString().slice(0, 10);
const days = [...new Set(ops.map((o) => o.iso))];
const eod = new Map(); for (const o of ops) eod.set(o.iso, o.bal);
const sweepByDay = new Map(); for (const o of ops) if (isSweep(o)) sweepByDay.set(o.iso, (sweepByDay.get(o.iso) ?? 0) + (o.direction === 'out' ? o.amount : -o.amount));
const eodAt = (d) => { let b = null; for (const k of days) { if (k <= d) b = eod.get(k); else break; } return b; };

function actuals(cut, end, adjust) {
  const startBal = eodAt(cut);
  let cum = 0, min = Infinity, last = startBal;
  for (const d of days) { if (d <= cut) continue; if (d > end) break; cum += sweepByDay.get(d) ?? 0; const b = eod.get(d) + (adjust ? cum : 0); last = b; if (b < min) min = b; }
  if (min === Infinity) min = startBal;
  return { end: last, min };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const mae = (a) => mean(a.map(Math.abs));
const thresholds = [500000, 800000, 1000000, 1200000];

function evaluate(name, cfg, adjust, from, to) {
  const rs = [];
  for (let t = Date.parse(from); t <= Date.parse(to) - H * DAY; t += 7 * DAY) {
    const cut = iso(t), end = iso(t + H * DAY);
    const hist = ops.filter((o) => o.iso <= cut);
    const B0 = eodAt(cut);
    const a = actuals(cut, end, adjust);
    const f = calculateForecast(hist, [], B0, H, 0, { today: cut, config: cfg });
    const perT = {};
    for (const T of thresholds) { const g = calculateForecast(hist, [], B0, H, T, { today: cut, config: cfg }); perT[T] = { p: g.gapProbabilityPct / 100, flag: g.gapDate !== null, act: a.min < T ? 1 : 0 }; }
    rs.push({ B0, aEnd: a.end, aMin: a.min, pEnd: f.forecastSeries.at(-1).balance, pMin: f.minForecastBalance, perT });
  }
  const eEnd = rs.map((r) => r.pEnd - r.aEnd), nEnd = rs.map((r) => r.B0 - r.aEnd), eMin = rs.map((r) => r.pMin - r.aMin);
  const brier = (T) => mean(rs.map((r) => (r.perT[T].p - r.perT[T].act) ** 2));
  const base = (T) => { const m = mean(rs.map((r) => r.perT[T].act)); return m * (1 - m); };
  const bs = thresholds.map((T) => `${(brier(T)).toFixed(3)}/${base(T).toFixed(3)}`).join('  ');
  const meanP = thresholds.map((T) => (mean(rs.map((r) => r.perT[T].p)) * 100).toFixed(0) + '%').join('/');
  const actR = thresholds.map((T) => (mean(rs.map((r) => r.perT[T].act)) * 100).toFixed(0) + '%').join('/');
  console.log(`${name.padEnd(26)} n=${rs.length} endMAE ${Math.round(mae(eEnd) / 1000)}k (naive ${Math.round(mae(nEnd) / 1000)}k) bias ${Math.round(mean(eEnd) / 1000)}k | minMAE ${Math.round(mae(eMin) / 1000)}k | Brier model/const @T ${bs} | meanP ${meanP} vs act ${actR}`);
}

const variants = [
  ['A baseline', {}, false],
  ['B +exclude transfers', { excludeInternalTransfers: true }, true],
  ['C B+group counterparty', { excludeInternalTransfers: true, regularityGroupBy: 'counterparty' }, true],
  ['D C+amountSpread 0.35', { excludeInternalTransfers: true, regularityGroupBy: 'counterparty', regularityMaxAmountSpread: 0.35 }, true],
  ['E D+stats 12m', { excludeInternalTransfers: true, regularityGroupBy: 'counterparty', regularityMaxAmountSpread: 0.35, statsWindowMonths: 12 }, true],
  ['F D+stats 3m', { excludeInternalTransfers: true, regularityGroupBy: 'counterparty', regularityMaxAmountSpread: 0.35, statsWindowMonths: 3 }, true]
];
const periods = [['TRAIN 2025-04..2025-12', '2025-04-01', '2025-12-31'], ['TEST  2026-01..2026-09', '2026-01-01', '2026-09-29']];
for (const [label, from, to] of periods) {
  console.log('\n== ' + label + ' (horizon ' + H + 'd; Brier: model/constant-rate, T=500k/800k/1M/1.2M)');
  for (const [name, cfg, adjust] of variants) evaluate(name, cfg, adjust, from, to);
}
