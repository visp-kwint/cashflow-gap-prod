// server/src/utils/asOf.js
// Опорная дата прогноза (ТЗ-доработка WP-7 §9): единая функция для всех вызовов
// calculateForecast (главная, песочница, сценарии, календарь, план-факт, налоговый календарь).

const DAY_MS = 86_400_000;

const dayIndex = (value) => {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
};

/**
 * Если now − lastOpDate ≤ 3 дней, опорная дата — now, иначе — lastOpDate.
 * @param {Date|string|null} lastOpDate дата последней операции
 * @param {Date} now текущее время (по умолчанию new Date())
 * @returns {string|null} ISO-дата (ГГГГ-ММ-ДД) или null, если операций нет
 */
export function getAsOfDate(lastOpDate, now = new Date()) {
  const last = dayIndex(lastOpDate);
  if (last === null) return null;
  const today = dayIndex(now);
  const diffDays = today - last;
  return new Date((diffDays <= 3 ? today : last) * DAY_MS).toISOString().slice(0, 10);
}
