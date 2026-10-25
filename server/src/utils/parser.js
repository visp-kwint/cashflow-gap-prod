// server/src/utils/parser.js
// Парсер банковских выписок (ТЗ-доработка WP-7 §2–§4).
// Формат А (организаторы, test-data/*.csv): operation_date;amount;direction;counterparty_inn;…;balance_eod,
//   ИНН — строка (ведущие нули!), назначение — свободный текст (может содержать разделитель и кавычки).
// Формат Б (легаси, 7 колонок): Дата;Сумма;Направление;Контрагент;ИНН;Назначение;Остаток — направление in/out.
// XLSX: первый лист, заголовки английские или русские; даты — строка ГГГГ-ММ-ДД / ДД.ММ.ГГГГ / серийное число Excel;
//   ИНН из числовой ячейки дополняется нулями слева до 10 (или 12) цифр.
// CSV: автоопределение разделителя (; , табуляция) и кодировки (UTF-8 BOM/без; при U+FFFD — windows-1251).
// Категоризация — services/categorizer.service.js (ТЗ-доработка WP-3, p.5).
import { categorizeStatement } from '../services/categorizer.service.js';
import XLSX from 'xlsx';
import { ApiError } from './errors.js';
import { analyzeStatement } from './dataQuality.js';

/* ----------------------------- кодировка и разделитель ----------------------------- */

/** UTF-8 с BOM или без; при наличии U+FFFD — повторное чтение как windows-1251. */
function decodeBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let text = buf.toString('utf-8');
  let hadBom = false;
  if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); hadBom = true; }
  if (text.includes('\uFFFD')) {
    const dec = new TextDecoder('windows-1251');
    const start = !hadBom && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
    text = dec.decode(buf.subarray(start));
  }
  return text;
}

/** Автоопределение разделителя CSV по строке заголовка. */
function detectDelimiter(headerLine) {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const [delim] = Object.entries(counts).sort((a, b) => b[1] - a[1]).map((entry) => entry[0]);
  return counts[delim] > 0 ? delim : ';';
}

/* ----------------------------- разбор строк ----------------------------- */

/** Разбирает одну CSV-строку с учётом кавычек (RFC 4180), разделитель `delimiter`. */
function splitCsvLine(line, delimiter = ';') {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(cur);
      cur = '';
    } else cur += ch;
  }
  fields.push(cur);
  return fields.map(f => f.trim());
}

/** Разбивает текст на CSV-строки с учётом переводов строк внутри кавычек. */
function splitCsvRows(text) {
  const rows = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rows.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') rows.push(cur);
  return rows;
}

/** Направление: «Поступление»/in → 'in', «Списание»/out → 'out'. */
function normalizeDirection(raw) {
  const d = String(raw ?? '').trim().toLowerCase();
  if (['поступление', 'in', 'приход', 'доход'].includes(d)) return 'in';
  if (['списание', 'out', 'расход', 'выбор'].includes(d)) return 'out';
  return null;
}

/** Категоризация (WP-3) — см. services/categorizer.service.js; локальный inferCategory удалён (TZ п.5). */

/** Даты: ГГГГ-ММ-ДД, ДД.ММ.ГГГГ и серийное число Excel → ISO; null — не распознана. */
function parseDate(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = Math.round((raw - 25569) * 86_400_000);
    const d = new Date(ms);
    return Number.isFinite(ms) && d.getUTCFullYear() >= 1990 ? d.toISOString() : null;
  }
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(s + 'T00:00:00Z');
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const ddmm = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (ddmm) {
    const year = ddmm[3].length === 2 ? 2000 + Number(ddmm[3]) : Number(ddmm[3]);
    const t = Date.UTC(year, Number(ddmm[2]) - 1, Number(ddmm[1]));
    const d = new Date(t);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === Number(ddmm[2]) - 1 && d.getUTCDate() === Number(ddmm[1])) {
      return d.toISOString();
    }
    return null; // 31.02.2026 → невалидная дата
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Число: «1 234,56» / «1234.56» / 1234 → float (абсолютное). Запятая — десятичный разделитель. */
function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.abs(raw) : NaN;
  let s = String(raw ?? '').replace(/[\s\u00a0]/g, '');
  if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.abs(n) : NaN;
}

/** ИНН из числовой ячейки XLSX: дополняется нулями слева до 10 (если цифр ≤ 10) или 12. */
function normalizeInn(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length <= 10) return digits.padStart(10, '0').slice(-10) || '';
  return digits.padStart(12, '0').slice(-12);
}

/* ----------------------------- заголовки ----------------------------- */

// Заголовки: английские из датасета и русские из шаблона (client/public/statement-template.csv).
const COLUMN_MAP = {
  date: ['operation_date', 'дата', 'date'],
  amount: ['amount', 'сумма'],
  direction: ['direction', 'направление'],
  inn: ['counterparty_inn', 'инн контрагента', 'инн'],
  name: ['counterparty_name', 'контрагент', 'counterparty'],
  purpose: ['payment_purpose', 'назначение', 'purpose'],
  balance: ['balance_eod', 'остаток', 'balance'],
  opId: ['operation_id', 'op_id'],
  companyId: ['company_id'],
};

function mapColumns(headerCells) {
  const lower = headerCells.map((h) => String(h ?? '').trim().toLowerCase());
  const map = {};
  for (const [key, aliases] of Object.entries(COLUMN_MAP)) {
    const idx = lower.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[key] = idx;
  }
  return map;
}

/** Legacy-выписка без заголовка: первая строка — данные (дата в первой колонке) → позиционное сопоставление. */
function positionalLegacyMap(firstRowCells) {
  const first = String(firstRowCells[0] ?? '').trim();
  const looksLikeDate = /^\d{4}-\d{2}-\d{2}$/.test(first) || /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(first);
  if (!looksLikeDate || firstRowCells.length < 7) return null;
  return { date: 0, amount: 1, direction: 2, name: 3, inn: 4, purpose: 5, balance: 6 };
}

/* ----------------------------- XLSX ----------------------------- */

function parseXlsxSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const nonEmpty = rows.filter((r) => r.some((c) => c !== null && String(c ?? '').trim() !== ''));
  if (!nonEmpty.length) return { records: [], rowErrors: [], format: 'empty', map: mapColumns([]) };
  const aliasMap = mapColumns(nonEmpty[0]);
  const positional = Object.keys(aliasMap).length > 0 ? null : positionalLegacyMap(nonEmpty[0]);
  const map = positional ?? aliasMap;
  const requiredFound = ['date', 'amount', 'direction', 'balance'].filter((k) => map[k] !== undefined);
  const hasHeader = requiredFound.length > 0 && !positional;
  const dataRows = hasHeader ? nonEmpty.slice(1) : nonEmpty;
  const rowErrors = [];
  const records = [];
  dataRows.forEach((row, i) => {
    const lineNo = i + (hasHeader ? 2 : 1);
    const pick = (k) => (map[k] !== undefined ? row[map[k]] : null);
    const date = parseDate(pick('date'));
    const amount = parseAmount(pick('amount'));
    const direction = normalizeDirection(pick('direction'));
    const balance = parseAmount(pick('balance'));
    if (!direction) rowErrors.push({ line: lineNo, message: `Строка ${lineNo}: неизвестное направление «${String(pick('direction'))}»` });
    else if (!date) rowErrors.push({ line: lineNo, message: `Строка ${lineNo}: некорректная дата «${String(pick('date'))}»` });
    else if (!Number.isFinite(amount) || amount <= 0) rowErrors.push({ line: lineNo, message: `Строка ${lineNo}: некорректная сумма «${String(pick('amount'))}»` });
    else if (!Number.isFinite(balance)) rowErrors.push({ line: lineNo, message: `Строка ${lineNo}: некорректный остаток «${String(pick('balance'))}»` });
    else records.push({
      date,
      amount,
      direction,
      counterpartyName: String(pick('name') ?? '').trim(),
      counterpartyInn: normalizeInn(pick('inn')),
      purpose: String(pick('purpose') ?? '').trim(),
      balanceEndOfDay: balance,
      externalId: pick('opId') != null && String(pick('opId')).trim() !== '' ? String(pick('opId')).trim() : null,
      companyId: pick('companyId') != null ? String(pick('companyId')).trim() : null,
    });
  });
  return { records, rowErrors, format: 'xlsx', map, rows: dataRows.length };
}

/* ----------------------------- CSV ----------------------------- */

const REQUIRED_COLUMNS = ['date', 'amount', 'direction', 'balance'];
const REQUIRED_LABELS = { date: 'дата', amount: 'сумма', direction: 'направление', balance: 'остаток' };

function parseCsvBuffer(buffer) {
  const text = decodeBuffer(buffer);
  const rows = splitCsvRows(text).filter((r) => r.trim() !== '');
  if (rows.length === 0) return { records: [], rowErrors: [], format: 'empty', map: mapColumns([]) };

  const delimiter = detectDelimiter(rows[0]);
  const headerCells = splitCsvLine(rows[0], delimiter);
  const lowered = headerCells.map((h) => String(h).trim().toLowerCase());
  // Формат организаторов: первые 3 колонки — company_id;operation_id;operation_date
  const isOrganizer =
    headerCells.length >= 9 &&
    ['company_id', 'operation_id', 'operation_date'].every((h) => lowered.slice(0, 3).includes(h));
  const aliasMapFirst = isOrganizer ? null : mapColumns(headerCells);
  const positional = isOrganizer ? null : positionalLegacyMap(headerCells);
  const map = isOrganizer
    ? { date: 2, amount: 3, direction: 4, inn: 5, name: 6, purpose: 7, balance: 8, opId: 1, companyId: 0 }
    : (aliasMapFirst && Object.keys(aliasMapFirst).length > 0)
      ? aliasMapFirst
      : (positional ?? aliasMapFirst);

  const hasHeader = isOrganizer || !positional;
  const rowErrors = [];
  const records = [];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  dataRows.forEach((line, i) => {
    const parts = splitCsvLine(line, delimiter);
    const lineNo = i + (hasHeader ? 2 : 1);
    const pick = (k) => (map[k] !== undefined ? parts[map[k]] : '');
    const date = parseDate(pick('date'));
    const amount = parseAmount(pick('amount'));
    const direction = normalizeDirection(pick('direction'));
    const balance = parseAmount(pick('balance'));
    if (!direction) rowErrors.push({ line: lineNo, message: `Строка ${lineNo}: неизвестное направление «${pick('direction')}»` });
    else if (!date) rowErrors.push({ line: lineNo, message: `Строка ${lineNo}: некорректная дата «${pick('date')}»` });
    else if (!Number.isFinite(amount) || amount <= 0) rowErrors.push({ line: lineNo, message: `Строка ${lineNo}: некорректная сумма «${pick('amount')}»` });
    else if (!Number.isFinite(balance)) rowErrors.push({ line: lineNo, message: `Строка ${lineNo}: некорректный остаток «${pick('balance')}»` });
    else records.push({
      date,
      amount,
      direction,
      counterpartyName: String(pick('name') ?? '').trim(),
      counterpartyInn: normalizeInn(pick('inn')),
      purpose: String(pick('purpose') ?? '').trim(),
      balanceEndOfDay: balance,
      externalId: pick('opId') ? String(pick('opId')).trim() : null,
      companyId: pick('companyId') ? String(pick('companyId')).trim() : null,
    });
  });
  return { records, rowErrors, format: isOrganizer ? 'organizer' : 'legacy', map, rows: dataRows.length };
}

/* ----------------------------- дубли и итог импорта ----------------------------- */

/**
 * Дедупликация (ТЗ-доработка WP-7 §6):
 * — полные дубли (совпадают operation_id и все остальные поля) удаляются;
 * — строки, отличающиеся только operation_id, не удаляются: считаются в possibleDuplicates.
 */
function dedupe(records) {
  const fullKey = (r) => [r.externalId, r.date, r.amount, r.direction, r.counterpartyInn, r.counterpartyName, r.purpose, r.balanceEndOfDay].join('|');
  const softKey = (r) => [r.date, r.amount, r.direction, r.counterpartyInn, r.counterpartyName, r.purpose, r.balanceEndOfDay].join('|');
  const seenFull = new Set();
  const softGroups = new Map();
  const out = [];
  let duplicatesRemoved = 0;
  for (const r of records) {
    const fk = fullKey(r);
    if (seenFull.has(fk)) { duplicatesRemoved++; continue; }
    seenFull.add(fk);
    const sk = softKey(r);
    softGroups.set(sk, (softGroups.get(sk) ?? 0) + 1);
    out.push(r);
  }
  let possibleDuplicates = 0;
  for (const count of softGroups.values()) if (count > 1) possibleDuplicates += count - 1;
  return { operations: out, duplicatesRemoved, possibleDuplicates };
}

/** Итог импорта (ТЗ-доработка WP-7 §5): объект для ответа register и POST /api/operations/import. */
export function buildImportSummary({ rowsTotal, operations, duplicatesRemoved = 0, possibleDuplicates = 0, rowErrors = [] }) {
  const skipped = Math.max(0, rowsTotal - operations.length - duplicatesRemoved);
  return {
    rowsTotal,
    imported: operations.length,
    skipped,
    duplicatesRemoved,
    possibleDuplicates,
    warnings: rowErrors.slice(0, 50).map((e) => e.message),
    dataQuality: analyzeStatement(operations),
  };
}

/* ----------------------------- основной парсер ----------------------------- */

/**
 * Основной парсер. CSV (UTF-8 BOM/без, авто-разделитель, windows-1251 при U+FFFD) или XLSX (первый лист).
 * Нет обязательных колонок или ни одной корректной строки — ApiError 422 (код VALIDATION);
 * частичные ошибки строк — в warnings (первые 50 в итоге импорта).
 */
export async function parseBankStatement(buffer, filename = '', userInn = null) {
  const name = String(filename || '').toLowerCase();
  const isXlsx = name.endsWith('.xlsx') || (Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b);
  const parsed = isXlsx ? parseXlsxSheet(buffer) : parseCsvBuffer(buffer);
  const { records, rowErrors, format, map, rows } = parsed;

  if (format === 'empty') {
    return {
      operations: [],
      meta: { format: 'empty', companyId: null, rowsTotal: 0, rowsSkipped: 0, duplicatesRemoved: 0, possibleDuplicates: 0 },
      warnings: ['Файл пуст'],
      rowErrors: [],
    };
  }

  // Обязательные колонки (ТЗ-доработка WP-7 §4): дата, сумма, направление, остаток.
  const missing = REQUIRED_COLUMNS.filter((k) => map[k] === undefined);
  if (missing.length) {
    throw new ApiError(422, `Не найдены обязательные колонки: ${missing.map((m) => REQUIRED_LABELS[m]).join(', ')}`, 'VALIDATION');
  }

  const { operations: deduped, duplicatesRemoved, possibleDuplicates } = dedupe(records);
  // ТЗ-доработка WP-3 п.5: inferCategory заменён на категоризатор (services/categorizer.service.js).
  const operations = categorizeStatement(deduped, userInn).map((op) => ({
    ...op,
    counterpartyName: op.counterpartyName || 'Не указан',
  }));

  // Ни одна строка не прошла проверку (ТЗ-доработка WP-7 §4) — 422 с первыми 10 ошибками.
  if (operations.length === 0 && (rowErrors.length > 0 || duplicatesRemoved > 0 || records.length > 0)) {
    throw new ApiError(422, `В файле нет корректных строк. Первичные ошибки: ${rowErrors.slice(0, 10).map((e) => e.message).join('; ')}`, 'VALIDATION');
  }

  const companyId = deduped.find((o) => o.companyId)?.companyId ?? null;
  return {
    operations,
    meta: {
      format,
      companyId: format === 'organizer' ? companyId : null,
      // ТЗ-доработка WP-7 §5: rowsTotal = все строки данных файла (включая битые),
      // чтобы skipped = rowsTotal − imported − duplicatesRemoved совпадал с числом ошибок строк.
      rowsTotal: rows ?? records.length + duplicatesRemoved,
      rowsSkipped: rowErrors.length,
      duplicatesRemoved,
      possibleDuplicates,
    },
    warnings: rowErrors.map((e) => e.message),
    rowErrors,
  };
}

/** Обёртка для легаси-кода: возвращает массив операций (без мета-информации). */
export async function parseFile(buffer, filename) {
  const { operations } = await parseBankStatement(buffer, filename);
  return operations;
}
