// server/src/controllers/auth.controller.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { parseBankStatement, buildImportSummary } from '../utils/parser.js';
import { readDemoOperations } from './demo.controller.js';
import { anonymizeCounterparty } from '../utils/anonymizer.js';

/**
 * Регистрация (ТЗ-доработка WP-7 §1: «parse before write»).
 * Порядок: 1) проверка email/пароля, 2) разбор файла ДО каких-либо записей
 * (при ошибке разбора — 422, пользователь не создаётся), 3) user + operations
 * в одной транзакции (createMany батчами по 500).
 */
export async function register(req, res, next) {
  try {
    const { email, password, companyName, inn, minBalance, useDemoData } = req.body || {};

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw ApiError.badRequest('Пользователь с таким email уже существует');
    }

    // 1) Разбор файла — до создания пользователя (422 → user не появляется).
    let parsed = null;
    let demoOps = null;
    if (useDemoData === 'true' || useDemoData === true) {
      // ТЗ-доработка WP-7 §13: демо-данные — выписки из test-data/demo/, а не генератор.
      demoOps = await readDemoOperations(null, inn || null);
    } else if (req.file) {
      parsed = await parseBankStatement(req.file.buffer, req.file.originalname, inn || null);
      if (parsed.operations.length === 0 && parsed.meta.format !== 'empty') {
        throw ApiError.badRequest('В файле не найдено корректных операций выписки');
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, passwordHash, companyName, inn, minBalance },
      });

      if (demoOps) {
        // Категоризация уже выполнена в парсере (WP-3); служебные поля не в схеме Prisma.
        const ops = demoOps.operations.map((op) => {
          const { companyId, categorizeRule, ...rest } = op;
          return { ...rest, userId: u.id, source: 'demo' };
        });
        for (let i = 0; i < ops.length; i += 500) {
          await tx.operation.createMany({ data: ops.slice(i, i + 500) });
        }
      } else if (parsed) {
        // Данные организаторов (test-data/*.csv) обезличены на источнике;
        // реальные легаси-выписки маскируем.
        const opsToCreate = parsed.operations.map((op) => {
          const { name, inn: mInn } =
            parsed.meta.format === 'organizer'
              ? { name: op.counterpartyName ?? 'Не указан', mInn: op.counterpartyInn ?? '' }
              : anonymizeCounterparty(op.counterpartyName, op.counterpartyInn);
          const { companyId, categorizeRule, ...rest } = op;
          return {
            ...rest,
            counterpartyName: name,
            counterpartyInn: parsed.meta.format === 'organizer' ? op.counterpartyInn : mInn,
            userId: u.id,
            source: 'import',
          };
        });
        for (let i = 0; i < opsToCreate.length; i += 500) {
          await tx.operation.createMany({ data: opsToCreate.slice(i, i + 500) });
        }
      }
      return u;
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN },
    );

    // ТЗ-доработка WP-7 §5: итог импорта — строки, импортировано, пропущено, дубли, предупреждения.
    let importSummary = null;
    if (parsed) {
      importSummary = buildImportSummary({
        rowsTotal: parsed.meta.rowsTotal,
        operations: parsed.operations,
        duplicatesRemoved: parsed.meta.duplicatesRemoved,
        possibleDuplicates: parsed.meta.possibleDuplicates,
        rowErrors: parsed.rowErrors,
      });
      logger.info('import', { lines: parsed.operations.length, skipped: parsed.meta.rowsSkipped, warnings: parsed.warnings.length });
    } else if (demoOps) {
      // ТЗ-доработка WP-7 §5: итог импорта и по демо-выписке (строки, пропущено, предупреждения).
      importSummary = buildImportSummary({
        rowsTotal: demoOps.meta.rowsTotal,
        operations: demoOps.operations,
        duplicatesRemoved: demoOps.meta.duplicatesRemoved,
        possibleDuplicates: demoOps.meta.possibleDuplicates,
        rowErrors: demoOps.rowErrors,
      });
      logger.info('import', { lines: demoOps.operations.length, skipped: demoOps.meta.rowsSkipped, warnings: demoOps.warnings?.length ?? 0 });
    }

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, companyName: user.companyName, inn: user.inn, minBalance: user.minBalance ?? 0 },
      ...(importSummary ? { import: importSummary } : {}),
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw ApiError.unauthorized('Неверный email или пароль', 'INVALID_CREDENTIALS');

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) throw ApiError.unauthorized('Неверный email или пароль', 'INVALID_CREDENTIALS');

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN }
    );

    res.json({ token, user: { id: user.id, email: user.email, companyName: user.companyName, inn: user.inn } });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, companyName: true, inn: true, minBalance: true }
    });
    // Контракт: { user: User }
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req, res, next) {
  try {
    const { minBalance } = req.body;
    const userId = req.user.userId;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { minBalance: Number(minBalance) },
      select: { id: true, email: true, companyName: true, inn: true, minBalance: true }
    });

    res.json(updatedUser);
  } catch (err) {
    next(err);
  }
}