/**
 * ТЗ-доработка WP-3 п.6: normalizePurpose вынесен из forecast.service.js сюда.
 * forecast.service использует этот модуль (не свою локальную копию).
 *
 * Каноническая форма назначения платежа: строчные, ё→е,
 * документные номера/даты/суммы → пробел, пробелы схлопнуты.
 * Чистая функция — без БД и без времени.
 */

/** Убирает хвост «НДС …» из назначения (в прогнозе НДС-разметка не важна). */
const VAT_TAIL = /(в\s*т\.?\s*ч\.?|в\s+том\s+числе|без\s+налога|без\s+ндс|ндс|сумма\s)[\s\S]*$/;

/** Названия месяцев → пробел (периоды в назначениях не несут сигнала). */
const MONTH_NAMES = /(?<![а-яе])(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яе]*/g;

/**
 * Нормализация назначения платежа (исходно — из forecast.service.js).
 * @param {string} [purpose]
 * @returns {string}
 */
export function normalizePurpose(purpose) {
  return String(purpose ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\bенп\b|единый\s+налоговый\s+плате?ж/g, 'единый налоговый платеж')
    .replace(VAT_TAIL, ' ')
    .replace(MONTH_NAMES, ' ')
    .replace(/[^а-яеa-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Упрощённая каноническая форма для правил категоризации:
 * строчные, ё→е, документные номера/даты/суммы → пробел.
 */
export function normalizeForRules(purpose) {
  let s = String(purpose ?? '').toLowerCase().replace(/ё/g, 'е');
  s = s.replace(/\b(?:н[оо])\.?\s*[#№]?\s*\d+(?:[/-]?\d+)?/g, ' ');
  s = s.replace(new RegExp(MONTH_NAMES.source, 'g'), ' ');
  s = s.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ');
  s = s.replace(/\b\d[\d\s]{2,}(,\d+)?\b/g, ' ');
  s = s.replace(/[^а-яеa-z\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\bнп\b/g, 'един налог платеж');
  return s;
}

/**
 * Обезличенный ключ контрагента для сценариев (WP-4):
 * детерминированный хэш ИНН (без самой операции, без ПII).
 */
export function opaqueCounterpartyKey(inn) {
  if (!inn) return 'unknown';
  let h = 5381;
  const s = String(inn);
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `cp_${h.toString(36)}`;
}
