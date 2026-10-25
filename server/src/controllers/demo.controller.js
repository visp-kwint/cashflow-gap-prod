// server/src/controllers/demo.controller.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../config/db.js';
import { ApiError } from '../utils/errors.js';
import { parseBankStatement } from '../utils/parser.js';
import { logger } from '../utils/logger.js';

const DEMO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../test-data/demo');

export function demoFiles() {
  if (!fs.existsSync(DEMO_DIR)) return [];
  return fs.readdirSync(DEMO_DIR).filter((f) => f.endsWith('.csv') && f !== 'README.md');
}

/**
 * Читает и разбирает демо-выписку.
 * @param {string|null} company имя файла (без .csv) или null — первая найденная
 * @param {string|null} userInn ИНН владельца (правило own_funds)
 * @returns {Promise<{ file: string, operations: object[], meta: object, warnings: string[], rowErrors: object[] }>}
 */
export function readDemoOperations(company = null, userInn = null) {
  const files = demoFiles();
  if (files.length === 0) {
    throw ApiError.notFound(
      'Демо-выписки не найдены — положите файлы в test-data/demo/ (описание: test-data/demo/README.md, генерация: node server/scripts/pick-demo.mjs)',
      'NOT_FOUND',
    );
  }
  let file;
  if (company) {
    const wanted = String(company).trim().toLowerCase();
    file = files.find((f) => f.toLowerCase() === wanted + '.csv')
      ?? files.find((f) => f.toLowerCase().startsWith(wanted))
      ?? files.find((f) => f.toLowerCase().includes(wanted));
    if (!file) throw ApiError.badRequest('Неизвестная демо-выписка: ' + company);
  } else {
    file = files[0];
  }
  return parseBankStatement(fs.readFileSync(path.join(DEMO_DIR, file)), file, userInn).then((parsed) => {
    if (parsed.operations.length === 0) {
      return Promise.reject(ApiError.badRequest('Демо-выписка пустая: ' + file));
    }
    return { file, ...parsed };
  });
}

/**
 * POST /api/demo { company?: string } — подгрузка выписки в текущий аккаунт:
 * ранее загруженные демо-операции (source='demo') заменяются выбранной.
 */
export async function loadDemo(req, res, next) {
  try {
    const userId = req.user.userId;
    const userRow = await prisma.user.findUnique({ where: { id: userId }, select: { inn: true } });
    const { file, operations, meta, warnings, rowErrors } = await readDemoOperations(req.body?.company ?? null, userRow?.inn || null);

    const opsToCreate = operations.map((op) => {
      const { companyId, categorizeRule, ...rest } = op;
      return { ...rest, userId, source: 'demo' };
    });
    const removed = await prisma.operation.deleteMany({ where: { userId, source: 'demo' } });
    for (let i = 0; i < opsToCreate.length; i += 500) {
      await prisma.operation.createMany({ data: opsToCreate.slice(i, i + 500) });
    }

    const lastOpDate = operations[operations.length - 1].date;
    logger.info('demo', { file, lines: opsToCreate.length, skipped: meta.rowsSkipped, warnings: warnings?.length ?? 0 });
    res.status(201).json({
      file,
      operationsImported: opsToCreate.length,
      replaced: removed.count,
      asOf: String(lastOpDate).slice(0, 10),
      rowErrors: rowErrors?.length ?? 0,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/demo/companies — список доступных демо-выписок (для кнопки в интерфейсе). */
export function listDemo(req, res) {
  res.json({ companies: demoFiles().map((f) => ({ file: f, label: f.replace(/\.csv$/, '') })) });
}
