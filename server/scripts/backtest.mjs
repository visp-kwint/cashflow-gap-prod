/**
 * ТЗ-доработка WP-1: воспроизводимый бэктест прогноза на выписках организаторов.
 *
 * Запуск (из server/):  npm run backtest -- test-data/statements
 * или:                  node scripts/backtest.mjs <csv-или-папка-с-csv>
 *
 * Схема (ТЗ §2 п.4): скользящее начало (rolling origin) с шагом 7 дней; прогноз — только
 * по операциям ≤ cut; факт — остатки balance_eod за следующие H дней; H ∈ {14, 30, 60}.
 * Точки пропускаются при истории < 90 дней до cut или без остатков в окне факта.
 * Периоды (п.5): подбор констант — 2024-10-01…2025-12-31, итоговые метрики —
 * 2026-01-01…2026-09-30 (в текущем запуске константы не менялись — дефолтный конфиг).
 * Выход (п.10): docs/backtest-results.json + docs/BACKTEST.md.
 *
 * Детерминированность: фиксированный seed из forecast.config.js, метки runAt — единственное
 * поле, отличающееся между запусками на одних данных.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseBankStatement } from '../src/utils/parser.js';
import { calculateForecast } from '../src/services/forecast.service.js';
import { FORECAST_CONFIG } from '../src/config/forecast.config.js';
import { BASELINES, BASELINE_IDS } from '../src/services/forecast.baselines.js';
import { calculateUpcomingTaxes } from '../src/services/taxCalendar.service.js';
import {
  mae as maeOf,
  rmse as rmseOf,
  bias as biasOf,
  skill,
  brierScore,
  constantBrier,
  prf1,
  calibrationBins,
  percentile,
  leadTimeStats,
} from '../src/utils/backtestMetrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ТЗ §2 п.4–5: периоды и пороги
const STEP_DAYS = 7;
const HORIZONS = [14, 30, 60]; // основной — 30
const TEST_PERIOD = { from: '2026-01-01', to: '2026-09-30' };
const TRAIN_PERIOD = { from: '2024-10-01', to: '2025-12-31' };
const MIN_HISTORY_DAYS = 90;
const T_LABELS = ['0', 'P5', 'P10', 'P25']; // порог T ∈ {0, P5, P10, P25} до cut
const WARN_AT_PCT = 50; // правило «предупреждение, если gapProbabilityPct ≥ 50»
const DAY_MS = 86_400_000;

function parseArgs() {
  const args = process.argv.slice(2);
  const mi = args.indexOf('--models');
  const models = mi !== -1 && args[mi + 1] === 'all' ? 'all' : 'skip';
  const target = args.find((a, i) => !a.startsWith('--') && !(mi !== -1 && i === mi + 1));
  if (!target) {
    console.error('Использование: node scripts/backtest.mjs <csv-файл | папка с *.csv> [--models all]');
    process.exit(1);
  }
  // --models all: дополнительно сравнение подходов (WP-2): 7 базовых + абляции + налоговый эксперимент
  // → docs/MODEL_COMPARISON.md и docs/model-comparison.json
  return { target, models };
}

/** Собирает файлы: сам CSV или все *.csv в папке. */
function collectFiles(target) {
  const resolved = path.resolve(target);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  return fs
    .readdirSync(resolved)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .map((f) => path.join(resolved, f))
    .sort();
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

async function loadCompany(file) {
  const buf = fs.readFileSync(file);
  const { operations } = await parseBankStatement(buf, path.basename(file), null);
  // День — без времени: парсер отдаёт ISO («2026-09-25T00:00:00.000Z») или «2026-09-25».
  // Все сравнения дат в скрипте идут по YYYY-MM-DD.
  for (const op of operations) op.day = String(op.date).slice(0, 10);
  // остаток к концу дня по дате (последняя операция дня — остаток на конец дня)
  const balanceByDay = new Map();
  for (const op of operations) balanceByDay.set(op.day, op.balanceEndOfDay);
  const days = [...balanceByDay.keys()].sort();
  const balances = days.map((d) => balanceByDay.get(d));
  return { file: path.basename(file), operations, days, balances, balanceByDay };
}

/** Остаток на дату cut (последний известный ≤ cut). */
function balanceAt(company, cut) {
  let b = null;
  for (const d of company.days) {
    if (d <= cut) b = company.balanceByDay.get(d);
    else break;
  }
  return b;
}

/** Переводы собственных средств между счетами (WP-3 §4 п.9): по subcategory или regex-запаске. */
function isOwnFundsOp(op) {
  if (op.subcategory === 'own_funds_in' || op.subcategory === 'own_funds_out') return true;
  return FORECAST_CONFIG.internalTransferPattern.test(op.purpose ?? '');
}

/** Накопленные переводы собственных средств после cut (п.9): расход — +, приход — −. */
function ownFundsCumulative(company, cut, end) {
  let cum = 0;
  for (const op of company.operations) {
    if (op.day <= cut || op.day > end) continue;
    if (!isOwnFundsOp(op)) continue;
    cum += op.direction === 'out' ? op.amount : -op.amount;
  }
  return cum;
}

/**
 * Факты по cut: min/end остатка в окне (cut, cut+H] с (adj) и без (raw) корректировки
 * переводов собственных средств; дата первого факт-разрыва по порогу T.
 */
function actuals(company, cut, H, T) {
  const end = iso(Date.parse(cut) + H * DAY_MS);
  const cum = ownFundsCumulative(company, cut, end);
  let rawMin = Infinity, adjMin = Infinity, rawEnd = null, adjEnd = null;
  let rawGapDate = null, adjGapDate = null;
  for (const d of company.days) {
    if (d <= cut || d > end) continue;
    const raw = company.balanceByDay.get(d);
    const adj = raw + cum;
    if (raw < rawMin) rawMin = raw;
    if (adj < adjMin) adjMin = adj;
    if (raw < T && rawGapDate === null) rawGapDate = d;
    if (adj < T && adjGapDate === null) adjGapDate = d;
    rawEnd = raw;
    adjEnd = adj;
  }
  return { end, hasAny: rawMin !== Infinity, rawMin, adjMin, rawEnd, adjEnd, rawGapDate, adjGapDate, cum };
}

function percentileThresholds(company, cut) {
  const hist = company.days.filter((d) => d <= cut);
  const vals = hist.map((d) => company.balanceByDay.get(d));
  return {
    0: 0,
    P5: percentile(vals, 5),
    P10: percentile(vals, 10),
    P25: percentile(vals, 25),
  };
}

function evaluateCompany(company) {
  const perHorizon = {};
  const pointsByHorizon = {};
  for (const H of HORIZONS) {
    const points = [];
    let skippedNoHistory = 0, skippedNoActuals = 0;
    for (let t = Date.parse(TEST_PERIOD.from); ; t += STEP_DAYS * DAY_MS) {
      const cut = iso(t);
      if (cut > TEST_PERIOD.to) break;
      const b0 = balanceAt(company, cut);
      const end = iso(Date.parse(cut) + H * DAY_MS);
      const hasActuals = company.days.some((d) => d > cut && d <= end);
      const historyDays = company.days.filter((d) => d <= cut).length;
      if (b0 == null || historyDays === 0) { skippedNoHistory += 1; continue; }
      if (historyDays < MIN_HISTORY_DAYS) { skippedNoHistory += 1; continue; }
      if (!hasActuals) { skippedNoActuals += 1; continue; }

      const th = percentileThresholds(company, cut);
      const histOps = company.operations.filter((o) => o.day <= cut);
      // модель: базовый прогноз без порога + прогноз на каждый T
      const base = calculateForecast(histOps, [], b0, H, 0, { today: cut });
      const perT = {};
      for (const label of T_LABELS) {
        const T = th[label];
        const f = calculateForecast(histOps, [], b0, H, T, { today: cut });
        const a = actuals(company, cut, H, T);
        perT[label] = {
          T,
          p: (f.gapProbabilityPct ?? 0) / 100,
          flag: f.gapProbabilityPct != null && f.gapProbabilityPct >= WARN_AT_PCT ? 1 : 0,
          act: a.adjMin < T ? 1 : 0,
          actRaw: a.rawMin < T ? 1 : 0,
          modelGapDate: f.gapDate,
          factGapDate: a.adjGapDate,
          factGapDateRaw: a.rawGapDate,
        };
      }
      points.push({
        cut,
        b0,
        end: base.forecastSeries.at(-1).balance,
        pMin: base.minForecastBalance,
        perT,
      });
      // факты (для агрегации по остаткам) хранятся рядом
      const aP10 = actuals(company, cut, H, th.P10);
      points[points.length - 1].act = aP10;
    }
    pointsByHorizon[H] = points;
    perHorizon[H] = aggregatePoints(points, skippedNoHistory, skippedNoActuals);
  }
  return { perHorizon, pointsByHorizon };
}

function aggregatePoints(points, skippedNoHistory, skippedNoActuals) {
  const out = {
    evaluatedCuts: points.length,
    skipped: { noHistoryOrBalance: skippedNoHistory, noActualsInWindow: skippedNoActuals },
    balance: null,
    balanceUnadjusted: null,
    gaps: {},
  };
  if (!points.length) return out;

  const naiveEndErr = points.map((p) => p.b0 - p.act.adjEnd);
  const modelEndErr = points.map((p) => p.end - p.act.adjEnd);
  const naiveMinErr = points.map((p) => p.b0 - p.act.adjMin);
  const modelMinErr = points.map((p) => p.pMin - p.act.adjMin);
  out.balance = {
    mae: maeOf(modelEndErr),
    rmse: rmseOf(modelEndErr),
    bias: biasOf(modelEndErr),
    naiveMae: maeOf(naiveEndErr),
    skill: skill(maeOf(modelEndErr), maeOf(naiveEndErr)),
    min: {
      mae: maeOf(modelMinErr),
      rmse: rmseOf(modelMinErr),
      bias: biasOf(modelMinErr),
      naiveMae: maeOf(naiveMinErr),
      skill: skill(maeOf(modelMinErr), maeOf(naiveMinErr)),
    },
  };

  // без корректировки переводов
  const modelEndErrRaw = points.map((p) => p.end - p.act.rawEnd);
  const naiveMinErrRaw = points.map((p) => p.b0 - p.act.rawMin);
  out.balanceUnadjusted = {
    mae: maeOf(modelEndErrRaw),
    naiveMae: maeOf(naiveMinErrRaw),
    skill: skill(maeOf(modelEndErrRaw), maeOf(naiveMinErrRaw)),
  };

  for (const label of T_LABELS) {
    const pairs = points.map((p) => ({ p: p.perT[label].p, act: p.perT[label].act }));
    const pairsRaw = points.map((p) => ({ p: p.perT[label].p, act: p.perT[label].actRaw }));
    const facts = pairs.map((x) => x.act);
    const leadDays = points
      .filter((p) => p.perT[label].act === 1 && p.perT[label].flag === 1 && p.perT[label].factGapDate)
      .map((p) => Math.round((Date.parse(p.perT[label].factGapDate) - Date.parse(p.cut)) / DAY_MS));
    out.gaps[label] = {
      T: points[0].perT[label].T,
      factGaps: facts.filter(Boolean).length,
      brierModel: brierScore(pairs),
      brierConstant: constantBrier(facts),
      prf1: prf1(pairs, WARN_AT_PCT / 100),
      prf1Unadjusted: prf1(pairsRaw, WARN_AT_PCT / 100),
      calibration: calibrationBins(pairs),
      leadTime: leadTimeStats(leadDays),
    };
  }
  return out;
}

function main() {
  const { target, models } = parseArgs();
  const files = collectFiles(target);
  if (!files.length) {
    console.error(`Файлы *.csv не найдены: ${path.resolve(target)}`);
    process.exit(1);
  }

  const started = Date.now();
  const result = {
    params: {
      files: files.map((f) => path.basename(f)),
      stepDays: STEP_DAYS,
      horizons: HORIZONS,
      testPeriod: TEST_PERIOD,
      trainPeriod: TRAIN_PERIOD,
      minHistoryDays: MIN_HISTORY_DAYS,
      thresholds: T_LABELS,
      warnAtPct: WARN_AT_PCT,
      monteCarloSimulations: FORECAST_CONFIG.monteCarloSimulations,
      seed: FORECAST_CONFIG.monteCarloSeed,
      constantsNote:
        'Волна C (аудит §2.1): дефолты forecast.config.js переподобраны по абляциям — ownerWithdrawalsEnabled: false, statsWindowMonths: 3 (решение и обоснование — в комментариях конфига и docs/MODEL_COMPARISON.md); подбора на тренировочном периоде не проводилось (датасет организаторов не в репозитории). Вероятность разрыва перекалибрована: изотоническая сетка PAV по бинам калибровки бэктеста (gaps.P25.calibration: 39 точек, 1 факт-разрыв → константа 1/39 ≈ 2,6 %) — см. calibrateGapProbabilityPct в forecast.service.js.',
    },
    runAt: new Date().toISOString(),
    durationSec: 0,
    companies: {},
    overall: null,
  };

  (async () => {
    const pool = {}; // H -> points
    const companies = [];
    for (const file of files) {
      process.stdout.write(`Бэктест ${path.basename(file)}… `);
      const company = await loadCompany(file);
      companies.push(company);
      const { perHorizon, pointsByHorizon } = evaluateCompany(company);
      result.companies[company.file] = perHorizon;
      for (const H of HORIZONS) (pool[H] ??= []).push(...pointsByHorizon[H]);
      const s30 = perHorizon[30];
      console.log(`ok (H=30: ${s30.evaluatedCuts} точек, пропущено ${s30.skipped.noHistoryOrBalance + s30.skipped.noActualsInWindow})`);
    }
    // Общая оценка: пул точек всех компаний
    result.overall = {};
    for (const H of HORIZONS) {
      const pts = pool[H] ?? [];
      result.overall[H] = pts.length ? aggregatePoints(pts, 0, 0) : { evaluatedCuts: 0, skipped: { noHistoryOrBalance: 0, noActualsInWindow: 0 }, balance: null, gaps: {} };
    }
    result.durationSec = Math.round((Date.now() - started) / 1000);

    fs.mkdirSync(path.join(REPO_ROOT, 'docs'), { recursive: true });
    const jsonPath = path.join(REPO_ROOT, 'docs', 'backtest-results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    const mdPath = path.join(REPO_ROOT, 'docs', 'BACKTEST.md');
    fs.writeFileSync(mdPath, renderMarkdown(result, files));
    console.log(`\nГотово за ${result.durationSec}s: ${jsonPath} и ${mdPath}`);

    if (models === 'all') {
      const comparison = runModelComparison(companies);
      const cmpJson = path.join(REPO_ROOT, 'docs', 'model-comparison.json');
      fs.writeFileSync(cmpJson, JSON.stringify(comparison, null, 2));
      const cmpMd = path.join(REPO_ROOT, 'docs', 'MODEL_COMPARISON.md');
      fs.writeFileSync(cmpMd, renderComparisonMarkdown(comparison));
      console.log(`Сравнение подходов (--models all): ${cmpJson} и ${cmpMd}`);
    }
  })().catch((err) => {
    console.error('Ошибка бэктеста:', err.stack ?? err.message);
    process.exit(1);
  });
}

/* --------------------------- WP-2: сравнение подходов (--models all) --------------------------- */

// Абляции: отключение одного компонента полной модели (остальные — дефолтный конфиг)
const ABLATION_MODELS = [
  { id: 'ab-no-transfers', label: 'Полная − исключение переводов собственных средств', config: { excludeInternalTransfers: false } },
  { id: 'ab-no-nonop', label: 'Полная − исключение разовых нерабочих операций', config: { nonOperatingPattern: null } },
  { id: 'ab-no-owner', label: 'Полная − моделирование выводов владельца', config: { ownerWithdrawalsEnabled: false } },
  { id: 'ab-no-winsor', label: 'Полная − винсоризация суточных сумм', config: { statsWinsorQuantile: null } },
  { id: 'ab-no-gaps', label: 'Полная − исключение пропусков в выписке', config: { gapDetection: false } },
  { id: 'ab-mc-normal', label: 'Полная, Монте-Карло: нормальное распределение (без bootstrap)', config: { mcMode: 'normal' } },
  { id: 'ab-stats-3m', label: 'Полная, окно статистики 3 месяца', config: { statsWindowMonths: 3 } },
];

function modelRowDefs() {
  return [
    ...BASELINE_IDS.map((id) => ({ id, kind: 'approach' })),
    ...ABLATION_MODELS.map((m) => ({ id: m.id, label: m.label, kind: 'ablation', config: m.config })),
    { id: 'tax-cal', label: 'Нал. эксперимент: полная модель + налоговый календарь', kind: 'tax', taxEvents: true },
    { id: 'tax-none', label: 'Нал. эксперимент: без календаря (налоги в истории) — опорная строка', kind: 'tax', taxEvents: false },
  ];
}

function runModelRow(def, ctx) {
  if (def.kind === 'approach') {
    const r = BASELINES[def.id](ctx);
    return {
      balance: r.forecastSeries.map((p) => p.balance),
      gapDate: r.gapDate,
      p: r.gapProbabilityPct ?? null,
      label: r.label,
    };
  }
  const opts = { today: ctx.today, config: def.config };
  if (def.taxEvents) opts.plannedEvents = calculateUpcomingTaxes(ctx.operations, new Date(ctx.today), ctx.horizonDays);
  const f = calculateForecast(ctx.operations, [], ctx.currentBalance, ctx.horizonDays, ctx.threshold, opts);
  return {
    balance: f.forecastSeries.map((p) => p.balance),
    gapDate: f.gapDate,
    p: f.gapProbabilityPct ?? null,
    label: def.label,
  };
}

function runModelComparison(companies) {
  const defs = modelRowDefs();
  const points = [];
  const H = 30;
  for (const company of companies) {
    for (let t = Date.parse(TEST_PERIOD.from); ; t += STEP_DAYS * DAY_MS) {
      const cut = iso(t);
      if (cut > TEST_PERIOD.to) break;
      const b0 = balanceAt(company, cut);
      const hasActuals = company.days.some((d) => d > cut && d <= iso(Date.parse(cut) + H * DAY_MS));
      const historyDays = company.days.filter((d) => d <= cut).length;
      if (b0 == null || historyDays < MIN_HISTORY_DAYS || !hasActuals) continue;
      const T = percentileThresholds(company, cut).P10;
      const histOps = company.operations.filter((o) => o.day <= cut);
      const ctx = { operations: histOps, currentBalance: b0, horizonDays: H, threshold: T, today: cut };
      const act = actuals(company, cut, H, T);
      const rows = {};
      for (const def of defs) {
        const r = runModelRow(def, ctx);
        rows[def.id] = {
          label: r.label,
          end: r.balance[r.balance.length - 1],
          min: Math.min(...r.balance),
          gapDate: r.gapDate,
          p: r.p,
        };
      }
      points.push({ cut, b0, act: { end: act.adjEnd, min: act.adjMin, gapDate: act.adjGapDate }, rows });
    }
  }
  return {
    params: {
      files: companies.map((c) => c.file),
      horizonDays: H,
      stepDays: STEP_DAYS,
      testPeriod: TEST_PERIOD,
      minHistoryDays: MIN_HISTORY_DAYS,
      threshold: 'P10',
      approaches: BASELINE_IDS,
      ablations: ABLATION_MODELS.map((m) => m.id),
      taxExperiment: ['tax-cal', 'tax-none'],
      note:
        'Holt-Winters — дефолтные параметры forecast.config.js (подбор на тренировочном периоде не проводился: датасет организаторов не в репозитории). Волна C (аудит §2.1): дефолты переподобраны по абляциям (выводы владельца отключены, окно статистики 3 мес.) — решение и обоснование в forecast.config.js. Вероятности в таблицах — перекалиброванные (изотоническая сетка PAV по бинам калибровки бэктеста, gaps.P25.calibration: 39 точек, 1 факт-разрыв → константа 1/39 ≈ 2,6 %; на P0/P5/P10 факт-разрывов нет, карта дегенеративна). Пересчёт калибровочной карты на датасете организаторов (150 компаний) — план развития.',
    },
    evaluatedCuts: points.length,
    runAt: new Date().toISOString(),
    rows: defs.map((def) => aggregateModelRow(def, points)),
  };
}

function aggregateModelRow(def, points) {
  const n = points.length;
  const out = { id: def.id, label: def.label ?? points[0]?.rows[def.id]?.label ?? def.id, kind: def.kind };
  if (!n) {
    out.maeEnd = out.maeMin = out.skillEnd = out.gapMaeDays = null;
    out.gapMissed = out.gapFalse = 0;
    return out;
  }
  const ends = points.map((pt) => pt.rows[def.id].end - pt.act.end);
  const mins = points.map((pt) => pt.rows[def.id].min - pt.act.min);
  const naiveEnd = points.map((pt) => pt.b0 - pt.act.end);
  out.maeEnd = maeOf(ends);
  out.maeMin = maeOf(mins);
  out.naiveMaeEnd = maeOf(naiveEnd);
  out.skillEnd = skill(maeOf(ends), maeOf(naiveEnd));
  const both = points.filter((pt) => pt.act.gapDate && pt.rows[def.id].gapDate);
  out.gapMaeDays = both.length
    ? both.reduce((s, pt) => s + Math.abs(Date.parse(pt.rows[def.id].gapDate) - Date.parse(pt.act.gapDate)) / DAY_MS, 0) / both.length
    : null;
  out.gapHitCount = both.length;
  out.gapMissed = points.filter((pt) => pt.act.gapDate && !pt.rows[def.id].gapDate).length;
  out.gapFalse = points.filter((pt) => !pt.act.gapDate && pt.rows[def.id].gapDate).length;
  if (points.some((pt) => pt.rows[def.id].p != null)) {
    const pairs = points.map((pt) => ({ p: (pt.rows[def.id].p ?? 0) / 100, act: pt.act.gapDate ? 1 : 0 }));
    out.brierModel = brierScore(pairs);
    out.brierConstant = constantBrier(pairs.map((x) => x.act));
  }
  return out;
}

function renderComparisonMarkdown(cmp) {
  const mae = (x) => (x == null ? '—' : (x / 1000).toFixed(1));
  const lines = [];
  lines.push('# Сравнение подходов прогноза (ТЗ-доработка WP-2)');
  lines.push('');
  lines.push(`Файлы: ${cmp.params.files.join(', ')}. Точек оценено: ${cmp.evaluatedCuts} (горизонт ${cmp.params.horizonDays} дн., шаг ${cmp.params.stepDays} дн., период ${cmp.params.testPeriod.from}…${cmp.params.testPeriod.to}, мин. история ${cmp.params.minHistoryDays} дн., порог T = P10).`);
  lines.push(`Запуск: ${cmp.runAt}.`);
  lines.push('');
  lines.push('## Методика');
  lines.push('- Все подходы прогнозируют от общего cut по общим операциям (≤ cut) и сравниваются с фактом balance_eod (с корректировкой переводов собственных средств) за 30 дней.');
  lines.push('- MAE конца горизонта и минимума; skill против наивного (B0 без изменений); MAE дат разрыва (дни, где разрыв зафиксирован и у модели, и в факте), число пропущенных/ложных разрывов; Brier для подходов с вероятностью (правило ≥ 50 %).');
  lines.push('- Абляция — полная модель с выключенным одним компонентом; налоговый эксперимент — с/без событий налогового календаря (ТЗ-доп. §4.1 В).');
  lines.push('');
  lines.push('## Подходы');
  lines.push('| Подход | MAE конца, к | MAE минимума, к | skill (конец) | MAE дат разрыва, дн. (n) | пропущено | ложных | Brier (P10) | Brier константа |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of cmp.rows) {
    lines.push(
      `| ${r.label} | ${mae(r.maeEnd)} | ${mae(r.maeMin)} | ${r.skillEnd == null ? '—' : r.skillEnd.toFixed(3)} | ${r.gapMaeDays == null ? '—' : r.gapMaeDays.toFixed(1)} (${r.gapHitCount}) | ${r.gapMissed} | ${r.gapFalse} | ${r.brierModel == null ? '—' : r.brierModel.toFixed(3)} | ${r.brierConstant == null ? '—' : r.brierConstant.toFixed(3)} |`,
    );
  }
  lines.push('');
  lines.push('## Налоговый эксперимент');
  const cal = cmp.rows.find((r) => r.id === 'tax-cal');
  const none = cmp.rows.find((r) => r.id === 'tax-none');
  if (cal && none) {
    const better = (cal.brierModel ?? Infinity) <= (none.brierModel ?? Infinity) ? 'с календарём' : 'без календаря';
    lines.push(`| Строка | MAE конца, к | MAE минимума, к | Brier (P10) |`);
    lines.push('| --- | --- | --- | --- |');
    lines.push(`| с налоговым календарём | ${mae(cal.maeEnd)} | ${mae(cal.maeMin)} | ${cal.brierModel?.toFixed(3) ?? '—'} |`);
    lines.push(`| без календаря (налоги в истории) | ${mae(none.maeEnd)} | ${mae(none.maeMin)} | ${none.brierModel?.toFixed(3) ?? '—'} |`);
    lines.push('');
    lines.push(`По вероятностным метрикам на доступных данных лучше вариант ${better} — зафиксировано как наблюдение на текущем датасете (не универсальный вывод).`);
  }
  lines.push('');
  lines.push('## Ограничения');
  lines.push(`- ${cmp.params.note}`);
  lines.push('- Сравнение выполнено на 1 компании (C001, доступный пример CSV); датасет организаторов — 150 компаний, 15 видов бизнеса (test-data/README.md) — в репозиторий не коммитится, ожидается: после подстановки `npm run backtest -- test-data/statements --models all`.');
  lines.push('- Абляции однокомпонентные; совместные эффекты компонентов не оцениваются.');
  lines.push('');
  return lines.join('\n');
}

// evaluateCompany возвращает perHorizon + точки для пула

function renderMarkdown(result, files) {
  const H = 30;
  const c = result.companies[files.map((f) => path.basename(f))[0]];
  const g = c?.[H];
  const lines = [];
  lines.push('# Бэктест прогноза кассового разрыва (ТЗ-доработка WP-1)');
  lines.push('');
  lines.push(`Файлы: ${result.params.files.join(', ')}`);
  lines.push(`Запуск: ${result.runAt} (${result.durationSec} с). Горизонты: ${result.params.horizons.join(', ')} (основной 30).`);
  lines.push(`Точки: шаг ${result.params.stepDays} дн., тестовый период ${result.params.testPeriod.from}…${result.params.testPeriod.to}, минимум истории ${result.params.minHistoryDays} дн.`);
  lines.push('');
  lines.push('## Методика');
  lines.push('- Скользящее начало: прогноз только по операциям ≤ cut; факт — balance_eod за следующие H дней.');
  lines.push('- Метрики по остатку (конец горизонта и минимум): MAE, RMSE, bias, skill против наивного (B0 без изменений).');
  lines.push('- Пороги T ∈ {0, P5, P10, P25} остатков компании до cut. Brier модели и константного прогноза, P/R/F1 при правиле «предупреждение при вероятности ≥ 50 %», калибровка (бины по 10 п.п.).');
  lines.push('- Заблаговременность: дни между cut и датой факт-разрыва для фактов, о которых предупредила модель (медиана и P25).');
  lines.push('- Корректировка: переводы собственных средств добавляются/вычитаются из факт-остатка; метрики даны с корректировкой (основные) и без.');
  lines.push(`- ${result.params.constantsNote}`);
  lines.push('');
  lines.push('## Метрики по остатку, H = 30');
  if (g) {
    const b = g.balance;
    lines.push('| Показатель | Модель | Наивный (B0) | skill |');
    lines.push('| --- | --- | --- | --- |');
    lines.push(`| MAE конца горизонта | ${(b.mae / 1000).toFixed(1)} к | ${(b.naiveMae / 1000).toFixed(1)} к | ${fmtSkill(b.skill)} |`);
    lines.push(`| MAE минимума | ${(b.min.mae / 1000).toFixed(1)} к | ${(b.min.naiveMae / 1000).toFixed(1)} к | ${fmtSkill(b.min.skill)} |`);
    lines.push(`| RMSE минимума | ${(b.min.rmse / 1000).toFixed(1)} к | — | — |`);
    lines.push(`| bias конца | ${(b.bias / 1000).toFixed(1)} к | — | — |`);
    lines.push('');
    lines.push(`Точек оценено: ${g.evaluatedCuts}; пропущено (нет истории/остатка): ${g.skipped.noHistoryOrBalance}; (нет фактов в окне): ${g.skipped.noActualsInWindow}.`);
  }
  lines.push('');
  lines.push('## Метрики по разрывам, H = 30');
  if (g) {
    lines.push('| T | факт-разрывов | Brier модель | Brier константа | precision | recall | F1 | медиана заблаговр., дн. | P25 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const label of T_LABELS) {
      const x = g.gaps[label];
      lines.push(
        `| ${label} (${x.T == null ? '—' : Math.round(x.T).toLocaleString('ru-RU')}) | ${x.factGaps} | ${fmt(x.brierModel)} | ${fmt(x.brierConstant)} | ${x.prf1.precision.toFixed(2)} | ${x.prf1.recall.toFixed(2)} | ${x.prf1.f1.toFixed(2)} | ${x.leadTime.median ?? '—'} | ${x.leadTime.p25 ?? '—'} |`,
      );
    }
    lines.push('');
    const bestLabel = T_LABELS.find((l) => g.gaps[l].factGaps > 0);
    if (bestLabel) {
      const best = g.gaps[bestLabel];
      const wins = best.brierModel != null && best.brierConstant != null && best.brierModel < best.brierConstant;
      lines.push(`Вывод по вероятности: модель ${wins ? 'лучше' : 'НЕ лучше'} константного прогноза (Brier ${fmt(best.brierModel)} против ${fmt(best.brierConstant)} при T=${bestLabel}).`);
    }
    const bSkill = g.balance?.skill;
    lines.push(`Вывод по остаткам: skill против наивного = ${fmtSkill(bSkill)} (${bSkill != null && bSkill > 0 ? 'модель точнее наивного прогноза' : bSkill != null ? 'модель не точнее наивного — ограничение, зафиксировано' : 'н/д'}).`);
  }
  lines.push('');
  lines.push('## Калибровка (бины по 10 п.п.), H = 30, T = P10');
  if (g?.gaps.P10?.calibration?.length) {
    lines.push('| Бин, п.п. | Ср. вероятность | Факт. частота разрывов | n |');
    lines.push('| --- | --- | --- | --- |');
    for (const b of g.gaps.P10.calibration) lines.push(`| ${b.bin} | ${b.meanProbPct.toFixed(0)} | ${b.actualFreq.toFixed(2)} | ${b.n} |`);
  } else lines.push('Нет пар (разрывов не зафиксировано или калибровочных пар недостаточно).');
  lines.push('');
  lines.push('## Ограничения');
  lines.push('- Датасет организаторов: 150 компаний, 15 видов бизнеса, 2 года (test-data/README.md) — в репозиторий не коммитится (test-data/statements/ в .gitignore). Запуск выполнен на 1 компании (C001 — пример из датасета); датасет ожидается, полный прогон: `npm run backtest -- test-data/statements`. Файлы запуска: ' + result.params.files.join(', ') + '.');
  lines.push('');
  return lines.join('\n');
}

function fmt(x) {
  return x == null ? 'н/д' : Number(x).toFixed(3);
}
function fmtSkill(x) {
  return x == null ? 'н/д' : `${x.toFixed(3)} (${x > 0 ? 'модель лучше' : 'модель не лучше'})`;
}

main();
