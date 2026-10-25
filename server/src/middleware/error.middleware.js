// server/src/middleware/error.middleware.js
// Централизованная обработка ошибок (WP-6 §6, §7).
// Типизированные коды: VALIDATION, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, INTERNAL.
// Логирование: только name и code ошибок, без meta/запроса/значений параметров;
// стек — только при NODE_ENV=development.
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/errors.js';

function logErrorContext(err, req, code, status) {
  const base = {
    event: 'error',
    requestId: req.requestId ?? null,
    userId: req.user?.userId ?? null,
    errorCode: code,
    status,
  };
  if (err.name?.startsWith('PrismaClient')) {
    // Ошибки Prisma логируются по name и code, без meta/стек/значений.
    const data = { ...base, name: err.name, code: err.code };
    if (env.NODE_ENV === 'development' && err.stack) data.stack = err.stack;
    logger.error('db_or_internal_error', data);
    return;
  }
  if (err instanceof ApiError) {
    logger.warn('api_error', { ...base, name: err.name });
    return;
  }
  const data = { ...base, name: err.name ?? 'Error', code: err.code ?? null };
  if (env.NODE_ENV === 'development' && err.stack) data.stack = err.stack;
  logger.error('unhandled_error', data);
}

// Ошибки Prisma → типизированные коды/статусы.
function mapPrismaError(err) {
  if (typeof err.code !== 'string' || !err.code.startsWith('P')) return null;
  switch (err.code) {
    case 'P2025': // запись не найдена
      return { status: 404, code: 'NOT_FOUND', message: 'Ресурс не найден' };
    case 'P2002': // уникальность (например, email уже занят)
      return { status: 400, code: 'VALIDATION', message: 'Запись с таким уникальным значением уже существует' };
    default:
      return { status: 500, code: 'INTERNAL', message: 'Внутренняя ошибка сервера' };
  }
}

export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL';
  let message = 'Внутренняя ошибка сервера';

  if (err instanceof ApiError) {
    status = err.statusCode;
    code = err.code ?? 'API_ERROR';
    message = err.message;
  } else if (err.name?.startsWith('PrismaClient')) {
    // Oшибки Prisma без P-кода (в т.ч. валидация) → 500 INTERNAL, а не падение.
    const mapped = mapPrismaError(err);
    status = mapped?.status ?? 500;
    code = mapped?.code ?? 'INTERNAL';
    message = mapped?.message ?? 'Внутренняя ошибка сервера';
  } else if (err.type === 'entity.parse.failed') {
    // Некорректный JSON в теле запроса.
    status = 400;
    code = 'VALIDATION';
    message = 'Некорректное тело запроса (JSON)';
  } else if (err.type === 'multer' || err.code === 'LIMIT_FILE_SIZE') {
    status = 400;
    code = 'VALIDATION';
    message = 'Файл превышает допустимый размер';
  }

  logErrorContext(err, req, code, status);
  req.errorCode = code; // для HTTP-логирования (finish-хук)
  res.status(status).json({ error: { code, message } });
}
