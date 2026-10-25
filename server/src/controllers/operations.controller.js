// server/src/controllers/operations.controller.js
import { prisma } from '../config/db.js';
import { anonymizeCounterparty } from '../utils/anonymizer.js';
import { parseBankStatement, buildImportSummary } from '../utils/parser.js';
import { categorize, resolveSubcategory, legacyForSub } from '../services/categorizer.service.js';
import { maskName, maskInn } from '../utils/masking.js';
import { ApiError } from '../utils/errors.js';
import { planFactService } from '../services/planFact.service.js';

/**
 * Фильтр «Повторяющиеся платежи» (отчёт §8.2): фиксированные плановые (налог/зарплата/
 * аренда/кредит/комиссии), повторяющиеся контрагенты и плановые события.
 * Ручные операции plannedness=null — в фильтр не попадают (классифицирует только импорт).
 */
export const RECURRING_PLANNEDNESS = ['planned_fixed', 'planned_scheduled', 'recurring_variable'];

/**
 * Обезличивание в ответах (WP-6 §10): контрагенты идут через maskName/maskInn.
 */
function maskOperation(op) {
  if (!op) return op;
  return {
    ...op,
    counterpartyName: maskName(op.counterpartyName),
    counterpartyInn: maskInn(op.counterpartyInn),
  };
}

/**
 * Фильтр по категории в терминах UI:
 * - income/expense — по направлению (все поступления / все списания, включая налоги и зарплату)
 * - payment — платёжные категории (payment, tax, salary)
 * - остальные — точное совпадение категории
 */
export function categoryWhere(category) {
  switch (category) {
    case 'income':
      return { direction: 'in' };
    case 'expense':
      return { direction: 'out' };
    case 'payment':
      return { category: { in: ['payment', 'tax', 'salary'] } };
    default:
      return { category };
  }
}

export async function getOperations(req, res, next) {
  try {
    const userId = req.user.userId;
    const { month, category, page = 1, limit = 20, uncategorized, recurring } = req.query;

    const where = { userId };
    if (category) Object.assign(where, categoryWhere(category));
    // ТЗ-доработка WP-3: фильтр «Не категоризовано» (subcategory IS NULL)
    if (String(uncategorized) === 'true') where.subcategory = null;
    // Фильтр «Повторяющиеся платежи» (отчёт §8.2): по классам плановости из импорта
    if (String(recurring) === 'true') where.plannedness = { in: RECURRING_PLANNEDNESS };
    if (month) {
      const [year, m] = month.split('-');
      const startDate = new Date(year, parseInt(m, 10) - 1, 1);
      const endDate = new Date(year, parseInt(m, 10), 0, 23, 59, 59);
      where.date = { gte: startDate, lte: endDate };
    }

    const operations = await prisma.operation.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (parseInt(page, 10) - 1) * parseInt(limit, 10),
      take: parseInt(limit, 10)
    });

    res.json(operations.map(maskOperation));
  } catch (err) {
    next(err);
  }
}

export async function createOperation(req, res, next) {
  try {
    const userId = req.user.userId;
    const { date, amount, direction, category, counterpartyName, counterpartyInn, purpose, subcategory: subFromBody } = req.body || {};

    if (!amount || !direction) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Сумма и направление обязательны' },
      });
    }
    if (!['in', 'out'].includes(direction)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Направление: in или out' },
      });
    }

    const { name, inn } = anonymizeCounterparty(counterpartyName, counterpartyInn);

    const lastOp = await prisma.operation.findFirst({
      where: { userId },
      orderBy: { date: 'desc' }
    });

    const currentBalance = lastOp ? lastOp.balanceEndOfDay : 0;
    const newBalance = direction === 'in' ? currentBalance + amount : currentBalance - amount;

    // ТЗ-доработка WP-3: явная подкатегория → categorySource='manual' (confidence=null);
    // иначе автокатегоризация (categorySource='rule', confidence 0..1).
    let explicitSub = null;
    if (subFromBody) {
      explicitSub = resolveSubcategory(subFromBody, direction);
      if (!explicitSub) throw ApiError.badRequest(`Неизвестная или несовместимая подкатегория «${subFromBody}»`);
    }
    const auto = explicitSub ? null : categorize({ direction, counterpartyName: name, counterpartyInn: inn, purpose: purpose || '' });
    const subcategory = explicitSub ?? auto?.subcategory ?? null;
    const categorySource = explicitSub ? 'manual' : 'rule';
    const categoryConfidence = explicitSub ? null : auto?.confidence ?? null;
    const finalCategory = category || (subcategory ? legacyForSub(subcategory, direction) : (direction === 'in' ? 'income' : 'expense'));

    const operation = await prisma.operation.create({
      data: {
        userId,
        date: date ? new Date(date) : new Date(),
        amount,
        direction,
        category: finalCategory,
        subcategory,
        categoryConfidence,
        categorySource,
        counterpartyName: name,
        counterpartyInn: inn,
        purpose: purpose || '',
        balanceEndOfDay: newBalance,
        source: 'manual'
      }
    });

    // ТЗ-доработка WP-5: после добавления операции — сверка план-факт,
    // чтобы следующий GET /dashboard уже содержал свежий прогноз и статусы
    await planFactService.reconcileForUser(userId);

    res.status(201).json(maskOperation(operation));
  } catch (err) {
    next(err);
  }
}

export async function getOperationById(req, res, next) {
  try {
    const { id } = req.params;
    const operation = await prisma.operation.findFirst({
      where: { id, userId: req.user.userId }
    });
    if (!operation) return res.status(404).json({ error: { message: 'Операция не найдена' } });

    res.json(maskOperation(operation));
  } catch (err) {
    next(err);
  }
}

/**
 * Импорт банковской выписки (CSV/XLSX) в БД пользователя.
 * Multipart: file — выписка (формат организаторов test-data, XLSX или легаси 7 колонок),
 * replace='true' — сначала удалить ранее импортированные операции (source='import').
 * ТЗ-доработка WP-7 §5: полный итог импорта + качество данных.
 */
export async function importStatement(req, res, next) {
  try {
    const userId = req.user.userId;
    if (!req.file) throw ApiError.badRequest('Файл выписки не получен (поле file)');

    // ТЗ-доработка WP-3: ИНН владельца нужен для правила own_funds → читаем из профиля
    const userRow = await prisma.user.findUnique({ where: { id: userId }, select: { inn: true } });
    const parsed = await parseBankStatement(req.file.buffer, req.file.originalname, userRow?.inn || null);
    const { operations, meta, rowErrors } = parsed;
    if (operations.length === 0 && meta.format !== 'empty') {
      throw ApiError.badRequest('В файле не найдено корректных операций выписки');
    }

    // Замена: убираем предыдущие импорты (повторная подгрузка другой выписки)
    let removed = 0;
    if (String(req.body?.replace) === 'true') {
      const r = await prisma.operation.deleteMany({ where: { userId, source: 'import' } });
      removed = r.count;
    }

    // Дедупликация: пропуск операций, уже существующих по externalId
    const existing = await prisma.operation.findMany({
      where: { userId, externalId: { not: null } },
      select: { externalId: true },
    });
    const have = new Set(existing.map((o) => o.externalId));
    const toCreate = operations
      .filter((op) => !op.externalId || !have.has(op.externalId))
      .map((op) => {
        // Категоризация уже выполнена в парсере (WP-3): subcategory/category/categoryConfidence/categorySource.
        // Служебные поля (companyId, categorizeRule) — не в БД.
        const { companyId, categorizeRule, ...rest } = op;
        // Тестовые данные организаторов обезличены на источнике; легаси-выписки маскируем
        const anon = meta.format === 'legacy' ? anonymizeCounterparty(rest.counterpartyName, rest.counterpartyInn) : null;
        return {
          ...rest,
          counterpartyName: anon ? anon.name : rest.counterpartyName,
          counterpartyInn: anon ? anon.inn : rest.counterpartyInn,
          userId,
          source: 'import',
        };
      });

    if (toCreate.length > 0) {
      // ТЗ-доработка WP-7 §1: createMany батчами по 500 (защита от SQLite-лимита)
      for (let i = 0; i < toCreate.length; i += 500) {
        await prisma.operation.createMany({ data: toCreate.slice(i, i + 500) });
      }
    }

    // ТЗ-доработка WP-7 §5: строки, импортировано, пропущено, дубли, предупреждения + качество
    const summary = buildImportSummary({
      rowsTotal: meta.rowsTotal,
      operations: toCreate,
      duplicatesRemoved: meta.duplicatesRemoved,
      possibleDuplicates: meta.possibleDuplicates,
      rowErrors,
    });

    // ТЗ-доработка WP-5: после импорта выписки — сверка план-факт
    await planFactService.reconcileForUser(userId);

    res.status(201).json({
      ...summary,
      removed,
      format: meta.format,
      companyId: meta.companyId,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Пакетный импорт операций (ТЗ-доработка): { operations: [{ date, amount, direction, … }] }
 * Остатки считаются последовательно от текущего последнего баланса; asOf — дата последней операции.
 */
export async function bulkImport(req, res, next) {
  try {
    const userId = req.user.userId;
    const { operations } = req.body || {};
    if (!Array.isArray(operations) || operations.length === 0) {
      throw ApiError.badRequest('operations — непустой массив операций');
    }

    const lastOp = await prisma.operation.findFirst({
      where: { userId },
      orderBy: { date: 'desc' },
    });
    let balance = lastOp ? lastOp.balanceEndOfDay : 0;

    const now = Date.now();
    const rows = operations.map((op, i) => {
      const date = new Date(op.date);
      if (Number.isNaN(date.getTime())) throw ApiError.badRequest(`operations[${i}]: некорректная дата`);
      const amount = Number(op.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw ApiError.badRequest(`operations[${i}]: сумма должна быть числом > 0`);
      const direction = op.direction === 'in' ? 'in' : op.direction === 'out' ? 'out' : null;
      if (!direction) throw ApiError.badRequest(`operations[${i}]: направление — in или out`);
      balance = direction === 'in' ? balance + amount : balance - amount;

      const { name, inn } = anonymizeCounterparty(op.counterpartyName, op.counterpartyInn);
      const purpose = op.purpose ? String(op.purpose) : '';
      const clean = {
        userId,
        date,
        amount,
        direction,
        counterpartyName: name,
        counterpartyInn: inn,
        purpose,
        balanceEndOfDay: balance,
        source: 'manual',
        externalId: null,
        createdAt: new Date(now + i),
      };
      // ТЗ-доработка WP-3: явная подкатегория → manual; иначе автокатегоризация
      const explicitSub = op.subcategory ? resolveSubcategory(op.subcategory, direction) : null;
      const auto = explicitSub ? null : categorize(clean);
      return {
        ...clean,
        subcategory: explicitSub ?? auto?.subcategory ?? null,
        categorySource: explicitSub ? 'manual' : 'rule',
        categoryConfidence: explicitSub ? null : auto?.confidence ?? null,
        category: explicitSub
          ? legacyForSub(explicitSub, direction)
          : auto?.category ?? (direction === 'in' ? 'income' : 'expense'),
      };
    });

    const ts = Date.now();
    await prisma.operation.createMany({
      data: rows.map((r) => ({ ...r, createdAt: new Date(ts) })),
    });

    // ТЗ-доработка WP-5: после пакетного импорта — сверка план-факт
    await planFactService.reconcileForUser(userId);

    res.status(201).json({ imported: rows.length, asOf: rows[rows.length - 1].date.toISOString() });
  } catch (err) {
    next(err);
  }
}

/**
 * Перекатегоризация операций (ТЗ-доработка §2.3): подкатегория из body,
 * изменённые операции получают categorySource='manual', categoryConfidence=null.
 * { subcategory, operationIds? } — без operationIds переключаются все операции пользователя с текущей subcategory.
 */
export async function reassignOperations(req, res, next) {
  try {
    const userId = req.user.userId;
    const { subcategory, operationIds } = req.body || {};
    if (typeof subcategory !== 'string') {
      throw ApiError.badRequest('subcategory — строка (пустая — сбросить подкатегорию)');
    }
    const target = subcategory === '' ? null : resolveSubcategory(subcategory);
    if (subcategory !== '' && target === null) {
      throw ApiError.badRequest(`Неизвестная подкатегория «${subcategory}»`);
    }

    const where = { userId };
    if (Array.isArray(operationIds) && operationIds.length > 0) {
      where.id = { in: operationIds.map(String) };
    }

    const updated = await prisma.operation.updateMany({
      where,
      data: {
        subcategory: target,
        category: target ? legacyForSub(target) : undefined,
        categorySource: 'manual', // ТЗ-доработка §2.3: изменённые вручную — 'manual'
        categoryConfidence: null,
      },
    });

    res.json({ updated: updated.count });
  } catch (err) {
    next(err);
  }
}

/**
 * Точечная перекатегоризация одной операции (ТЗ-доработка WP-3 §2.3, PATCH /api/operations/:id):
 * { subcategory } — валидация по каталогу + ownership (чужая операция — 404).
 */
export async function patchOperationCategory(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const op = await prisma.operation.findFirst({ where: { id, userId } });
    if (!op) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Операция не найдена' } });

    const { subcategory } = req.body || {};
    if (typeof subcategory !== 'string') {
      throw ApiError.badRequest('subcategory — строка (пустая — сбросить подкатегорию)');
    }
    const target = subcategory === '' ? null : resolveSubcategory(subcategory, op.direction);
    if (subcategory !== '' && target === null) {
      throw ApiError.badRequest(`Неизвестная или несовместимая с направлением подкатегория «${subcategory}»`);
    }

    const updated = await prisma.operation.update({
      where: { id },
      data: {
        subcategory: target,
        category: target ? legacyForSub(target, op.direction) : op.category,
        categorySource: 'manual',
        categoryConfidence: null,
      },
    });
    res.json(maskOperation(updated));
  } catch (err) {
    next(err);
  }
}