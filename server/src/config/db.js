// server/src/config/db.js
// Prisma-клиент (WP-6 §7): ошибки логируются только по name и code — без meta,
// запроса и значений параметров; стек — только при NODE_ENV=development.
// Уровень 'query' выключен: он содержит значения параметров (ИНН, суммы).
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

export const prisma = new PrismaClient({
  log: [{ level: 'error', emit: 'event' }],
});

prisma.$on('error', (e) => {
  const data = { name: e.name ?? e.constructor?.name ?? 'PrismaError', code: e.code ?? null };
  if (process.env.NODE_ENV === 'development' && e.stack) data.stack = e.stack;
  logger.error('prisma_error', data);
});