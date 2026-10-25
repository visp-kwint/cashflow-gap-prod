// server/src/config/env.js
// Единственный источник конфигурации окружения (WP-6 §1).
// Все модули читают env через этот экспорт, а не через process.env.
import { z } from 'zod';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

// Значение-заглушка из .env.example — запрещено в production.
const PLACEHOLDER_JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL не задана'),
  // Не короче 32 символов; заглушка из .env.example запрещена в production.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET слишком короткий (минимум 32 символа)'),
  // Срок жизни JWT по умолчанию 24 часа (WP-6 §4).
  JWT_EXPIRES_IN: z.string().default('24h'),
  // PORT по умолчанию 5000 (WP-6 §1).
  PORT: z.string().default('5000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Список разрешённых CORS-origins через запятую; дефолт для разработки — http://localhost:5173.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Опорная дата прогноза для демо (ТЗ-доработка WP-7 §9): переопределяет asOf на всех вкладках.
  FORECAST_AS_OF: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'FORECAST_AS_OF — дата в формате ГГГГ-ММ-ДД')
    .optional(),
});

function fail(message) {
  // Только имена переменных и причина, без вывода значений секретов.
  logger.error('env_invalid', { message });
  process.exit(1);
}

if (
  process.env.NODE_ENV === 'production' &&
  process.env.JWT_SECRET === PLACEHOLDER_JWT_SECRET
) {
  fail('JWT_SECRET: значение-заглушка из .env.example запрещено в NODE_ENV=production');
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Пути к переменным и их сообщения; значения (в т.ч. секретов) не выводим.
  const issues = parsed.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  fail(issues);
}

export const env = parsed.data;

// CORS_ORIGINS: строка через запятую → массив разрешённых origins.
export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
