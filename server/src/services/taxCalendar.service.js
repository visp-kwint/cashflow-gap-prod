// Детерминированный налоговый календарь (ТЗ-доп. §4.1 В):
// чистый сервис — возвращает черновики PlannedEvent, запись в БД делает контроллер.
// Волна C (аудит §3.1):
// - искусственный «демо-налог» (пол 150 000 ₽ → фиксированные 180 000 ₽) удалён —
//   он попадал в реальные прогнозы и мог создавать разрыв из ничего;
// - квартальные авансы по УСН только апрель/июль/октябрь (январь исключён: 28 января
//   аванса по УСН нет — он завершён годовым расчётом в апреле);
// - дата события, выпавшая на сб/вс, переносится на ближайший рабочий день
//   (аналог regularShiftFromWeekends в forecast.service.js);
// - режим налогообложения — новый опциональный 4-й параметр (дефолт usn6 — сигнатура
//   обратно совместима; в данных режим не указан, поэтому незнакомый режим → без
//   черновиков: честнее не генерировать события, чем выдумывать суммы под чужой режим).
const TAX_BASE_SALARY = 65000;
const SALARY_TAX_RATE = 0.30;
const QUARTERLY_REIMBURSE_CAP_PCT = 0.5;
// Квартальные авансы: 28-е апреля/июля/октября (аванс за I/II/III квартал); января в наборе нет
const QUARTERLY_MONTHS = [3, 6, 9];
// Режимы: usn6 — УСН 6 % от поступлений; usn15 — УСН 15 % от прибыли (поступления − списания);
// osno/eshn — авансов по УСН нет, черновики не генерируются.
const TAX_MODES = {
  usn6: { quarterlyRate: 0.06, title: 'Аванс по УСН (6 %)' },
  usn15: { quarterlyRate: 0.15, title: 'Аванс по УСН (15 %, доходы − расходы)' },
  osno: { quarterlyRate: null, title: null },
  eshn: { quarterlyRate: null, title: null },
};

const round2 = (v) => Math.round(v * 100) / 100;
const toUtcDay = (d) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
const dayUtc = (dayIdx) => new Date(dayIdx * 86400000);
// Сб/вс → ближайший рабочий день: сб → +2 (понедельник), вс → +1 (аналог сдвига выходных в forecast.service.js)
const shiftToWorkday = (dayIdx) => {
  const wd = (((dayIdx + 4) % 7) + 7) % 7; // 0 = воскресенье … 6 = суббота
  return dayIdx + (wd === 6 ? 2 : wd === 0 ? 1 : 0);
};

// Черновик события: базовые поля PlannedEvent (без userId/id — их проставляет контроллер)
function draft(type, title, amount, expectedDate, direction) {
  return {
    type, title, amount: round2(Math.abs(amount)), direction: direction ?? 'out',
    expectedDate: dayUtc(shiftToWorkday(toUtcDay(expectedDate))),
    counterpartyName: 'ФН***',
    counterpartyInn: '77******00',
    counterpartyRisk: 'low',
    source: 'tax_calendar',
    status: 'pending',
    active: true,
    deferralDays: 0,
  };
}

/**
 * @param operations операции с полями date/amount/direction/category/source (в окне и до него)
 * @param fromDate опорная дата asOf (привязан к asOf, а не к new Date() — ТЗ-доработка WP-7 §9)
 * @param horizonDays горизонт
 * @param taxMode режим налогообложения: 'usn6' (дефолт, обратно совместимо) | 'usn15' | 'osno' | 'eshn';
 *                  незнакомый режим — без событий
 */
export function calculateUpcomingTaxes(operations, fromDate, horizonDays, taxMode = 'usn6') {
  const mode = TAX_MODES[taxMode];
  if (!mode) return []; // незнакомый режим — событий нет (см. комментарий к TAX_MODES)
  if (mode.quarterlyRate == null) return []; // osno/eshn: ни ЕНП (механизм для малых режимов), ни УСН-авансов не ожидается —
  // событий не генерируем (честнее пустой календарь, чем выдуманные суммы под чужой режим)
  const from = toUtcDay(fromDate);
  const end = from + horizonDays - 1;
  const byDay = (date) => toUtcDay(new Date(date));
  const result = [];

  // 1) ЕНП: 28-е число каждого месяца окна; база — расходы категории salary прошлого месяца × 0.30, иначе 65 000
  for (let d = from; d <= end; d++) {
    const dt = dayUtc(d);
    if (dt.getUTCDate() === 28) {
      const prev = new Date(dt.getTime() - 30 * 86400000); // предшествующий календарный месяц
      const prevStart = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), 1));
      const prevEnd = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0));
      const salaries = operations
        .filter((op) => op.category === 'salary' && op.direction === 'out'
          && byDay(op.date) >= toUtcDay(prevStart) && byDay(op.date) <= toUtcDay(prevEnd))
        .reduce((s, op) => s + op.amount, 0);
      const base = salaries > 0 ? salaries * SALARY_TAX_RATE : TAX_BASE_SALARY;
      result.push(draft('tax', `Единый налоговый платёж (ЕНП) за ${prev.getUTCMonth() + 1} месяц`, base, dt));
    }
  }

  // 2) Квартальные авансы по УСН: 28-е апреля/июля/октября — ставка режима × база за 90 дней минус взносы (≤50%)
  for (let d = from; d <= end; d++) {
    const dt = dayUtc(d);
    if (dt.getUTCDate() !== 28 || !QUARTERLY_MONTHS.includes(dt.getUTCMonth())) continue;
    const income = operations
      .filter((op) => op.direction === 'in' && !op.source?.includes('loan')
        && byDay(op.date) >= d - 90 && byDay(op.date) <= d)
      .reduce((s, op) => s + op.amount, 0);
    let base = income;
    if (taxMode === 'usn15') {
      // база — прибыль за 90 дней (поступления − списания; займы — не расход)
      const expense = operations
        .filter((op) => op.direction === 'out' && !op.source?.includes('loan')
          && byDay(op.date) >= d - 90 && byDay(op.date) <= d)
        .reduce((s, op) => s + op.amount, 0);
      base = Math.max(0, income - expense);
    }
    const contributions = operations
      .filter((op) => op.category === 'tax' && op.direction === 'out'
        && byDay(op.date) >= d - 90 && byDay(op.date) <= d)
      .reduce((s, op) => s + op.amount, 0);
    const reduced = Math.max(0, base - Math.min(contributions, base * QUARTERLY_REIMBURSE_CAP_PCT));
    result.push(draft('tax', mode.title, reduced * mode.quarterlyRate, dt));
  }

  // Возвращаем события с датами внутри [fromDate, fromDate + horizonDays]
  const fromIdx = toUtcDay(fromDate);
  const endIdx = fromIdx + horizonDays - 1;
  return result.filter((ev) => { const d = byDay(ev.expectedDate); return d >= fromIdx && d <= endIdx; });
}
